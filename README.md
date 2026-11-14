# Multi-Tenant Messaging API

A REST API for a simplified multi-tenant messaging platform. Tenants create outbound messages; an external provider reports delivery progress through an **idempotent webhook**. The service tolerates provider retries and out-of-order events without double-applying effects or moving a message backwards.

**Stack:** Node.js, Express, PostgreSQL, Knex (migrations), Zod (validation), Pino (logging), Jest + Supertest (tests).

---

## 1. Quick start

### Prerequisites
- Node.js LTS (v22+ recommended)
- PostgreSQL 14+ running locally
- Git

### Install and run

```bash
# 1. Install dependencies
npm install

# 2. Create your env file and fill in the real DB password
cp .env.example .env          # Windows: copy .env.example .env

# 3. Create the databases (one time)
psql -U postgres -c "CREATE DATABASE messaging_db;"
psql -U postgres -c "CREATE DATABASE messaging_test_db;"

# 4. Run migrations (creates the schema)
npm run migrate

# 5. Start the server
npm start            # production-style
npm run dev          # auto-restart with nodemon
```

The server listens on `http://localhost:3000` (override with `PORT`).

### Run tests

```bash
npm test
```

Tests use a **separate database** (`TEST_DATABASE_URL`). The schema is migrated automatically before the run (`tests/globalSetup.js`), and tables are truncated before each test. The helper refuses to truncate unless `NODE_ENV=test`, so the real DB cannot be wiped by accident.

### Scripts

| Script | Purpose |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start with nodemon |
| `npm run migrate` | Apply migrations (`knex migrate:latest`) |
| `npm run rollback` | Roll back the last migration batch |
| `npm test` | Run the Jest suite against the test DB |

### Environment variables (`.env.example`)

| Variable | Description |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `NODE_ENV` | `development`, `test` or `production` |
| `DATABASE_URL` | PostgreSQL connection string for the app |
| `TEST_DATABASE_URL` | PostgreSQL connection string for tests |
| `LOG_LEVEL` | Pino log level (default `info`) |

---

## 2. Project structure

```
migrations/            Knex migrations (schema source of truth)
src/
  app.js               Express app (no listen; used by tests)
  server.js            Process entry, graceful shutdown
  config/              env + logger
  db/                  Knex instance
  middleware/          requestId, tenant, errors, errorHandler
  validators/          Zod schemas
  services/            Business logic (messageService, webhookService)
  routes/              messages, webhooks, health
tests/                 Jest + Supertest suites
requests.http          Sample requests (VS Code REST Client)
knexfile.js            Knex config per environment
```

---

## 3. Database schema

### `messages`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `msg_<uuid>` |
| `tenant_id` | text NOT NULL | owner tenant |
| `conversation_id` | text NOT NULL | |
| `to_number` | text NOT NULL | E.164 phone number |
| `body` | text NOT NULL | message text (max 4096 chars) |
| `status` | text NOT NULL | `QUEUED` default; CHECK in (`QUEUED`,`SENT`,`DELIVERED`,`READ`,`FAILED`) |
| `version` | integer NOT NULL | incremented on every applied status change |
| `created_at`, `updated_at` | timestamptz | `created_at` is set by the app (millisecond precision) |
| `sent_at`, `delivered_at`, `read_at`, `failed_at` | timestamptz NULL | set when that status is applied |

Index: `idx_messages_conversation (tenant_id, conversation_id, created_at, id)` serves tenant-scoped, stable pagination.

### `webhook_events`

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `event_id` | text NOT NULL **UNIQUE** | idempotency key |
| `message_id` | text NOT NULL | indexed |
| `tenant_id` | text | copied from the message |
| `status` | text NOT NULL | CHECK in (`SENT`,`DELIVERED`,`READ`,`FAILED`) |
| `occurred_at` | timestamptz NOT NULL | provider timestamp |
| `received_at` | timestamptz NOT NULL | server receive time |
| `processing_result` | text NOT NULL | `APPLIED`, `IGNORED_STALE`, `IGNORED_TERMINAL` (`UNMATCHED` is reserved, see limitations) |
| `raw_payload` | jsonb | original event for audit/debugging |

There is intentionally **no foreign key** from `webhook_events.message_id` to `messages.id`, to keep the door open for an "unmatched event" strategy later.

---

## 4. API reference

All success bodies are wrapped as `{ "data": ... }`. All errors use one shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request payload", "details": [ { "field": "to", "message": "..." } ] } }
```

### Authentication assumption
For this exercise, the **`x-tenant-id` header represents the authenticated tenant**. In production this would be derived from a verified credential (JWT or API key) and never trusted from a raw header. Every tenant-facing query is filtered by this tenant. The webhook endpoint does not use it because its caller is the provider, not a tenant.

### `POST /api/v1/messages`
Headers: `x-tenant-id`, `Content-Type: application/json`

```json
{ "tenantId": "tenant-a", "conversationId": "conv-100", "to": "+919876543210", "text": "Your order has shipped" }
```

Validation: all fields required; `tenantId`/`conversationId` 1-64 chars; `to` must be E.164 (`+` and 8-15 digits); `text` 1-4096 chars; body max 100 KB. `tenantId` in the body must equal `x-tenant-id` (else 403).

`201 Created`:
```json
{
  "data": {
    "id": "msg_3ede1b1d-685f-48c1-bb6a-9c4aef2d8779",
    "tenantId": "tenant-a",
    "conversationId": "conv-100",
    "to": "+919876543210",
    "text": "Your order has shipped",
    "status": "QUEUED",
    "createdAt": "2026-11-14T18:57:16.454Z",
    "updatedAt": "2026-11-14T18:57:16.454Z",
    "sentAt": null, "deliveredAt": null, "readAt": null, "failedAt": null
  }
}
```

### `GET /api/v1/messages/:messageId`
Header: `x-tenant-id`. Returns the same `data` object as above with the current status and timestamps. A message belonging to another tenant returns **404** (not 403), so its existence is not revealed.

### `GET /api/v1/conversations/:conversationId/messages?limit=20&cursor=...`
Header: `x-tenant-id`. `limit` is 1-100 (default 20). Messages are ordered by `(created_at ASC, id ASC)`.

```json
{
  "data": [ { "id": "msg_...", "text": "Message one", "status": "QUEUED" } ],
  "pagination": { "limit": 2, "hasMore": true, "nextCursor": "eyJ0IjoiMjAyNi4uLiJ9" }
}
```

Pass `nextCursor` as `cursor` to get the next page. On the last page `hasMore` is `false` and `nextCursor` is `null`. An invalid cursor returns 400.

### `POST /api/v1/webhooks/provider`
No tenant header (caller is the provider).

```json
{ "eventId": "evt-001", "messageId": "msg_...", "status": "DELIVERED", "occurredAt": "2026-10-16T08:30:00.000Z" }
```

`status` is one of `SENT`, `DELIVERED`, `READ`, `FAILED`. `occurredAt` must be an ISO-8601 datetime.

`200 OK`:
```json
{ "data": { "eventId": "evt-001", "messageId": "msg_...", "duplicate": false, "result": "APPLIED", "messageStatus": "DELIVERED" } }
```

| Situation | HTTP | `result` / code |
|---|---|---|
| Valid, moves status forward | 200 | `APPLIED` |
| Same `eventId` sent again | 200 | `duplicate: true`, original result returned, nothing re-applied |
| Out-of-order / not a forward move | 200 | `IGNORED_STALE` |
| Message already `FAILED` | 200 | `IGNORED_TERMINAL` |
| Unknown `messageId` | 404 | `NOT_FOUND` |
| Invalid payload | 400 | `VALIDATION_ERROR` |
| `eventId` reused for a different message | 409 | `EVENT_ID_CONFLICT` |

### `GET /health`
```json
{ "status": "ok", "db": "up", "uptime": 1059.85 }
```
Returns `503 { "status": "degraded", "db": "down" }` if the database check (`SELECT 1`) fails. No connection details are exposed.

### Status codes used
400 validation/invalid JSON/invalid cursor, 401 missing tenant header, 403 tenant mismatch, 404 not found/unknown route, 409 event id conflict, 500 safe generic error (with `requestId`, no stack trace), 503 DB down.

---

## 5. Design note

### Idempotency
Idempotency is enforced by the **database**, not by in-memory state: `webhook_events.event_id` has a `UNIQUE` constraint and the insert uses `ON CONFLICT DO NOTHING`. If no row was inserted, the event is a duplicate; the service returns the originally recorded result with `duplicate: true` and applies nothing. Because this relies on a constraint, it stays correct across restarts and multiple app instances. A test fires 5 identical events in parallel and asserts exactly one record and one applied effect (`version = 1`).

### Status transition rules
```
QUEUED(0) -> SENT(1) -> DELIVERED(2) -> READ(3)
FAILED: allowed only from QUEUED or SENT; terminal afterwards
```
- An event is **applied only if its rank is higher** than the current status. Skipping steps is allowed (for example `QUEUED -> READ` if the `SENT`/`DELIVERED` events were lost or are late).
- Equal or lower rank (for example `DELIVERED` after `READ`) is `IGNORED_STALE`.
- `FAILED` after `DELIVERED`/`READ` is `IGNORED_STALE`; any event on an already `FAILED` message is `IGNORED_TERMINAL`.
- Ignored events are **still stored** for audit, but never change the message or its timestamps.
- Ordering uses a rank, not `occurredAt`, because provider clocks and delivery order are unreliable. `occurredAt` is stored and used as the status timestamp when an event is applied.

### Concurrency and atomicity
Each webhook runs in a **single transaction**: lock the message row (`SELECT ... FOR UPDATE`), decide, insert the event, update the message, commit. The response is sent only **after commit**, so success is never acknowledged before the event is persisted, and a crash cannot leave a half-applied update. The row lock serializes concurrent events for the same message; the `version` column is bumped on every applied change.

### Tenant isolation
- Every tenant-facing query includes `tenant_id` in its `WHERE` clause (single message and conversation listing).
- Cross-tenant reads return 404, not 403, to avoid revealing that an ID exists.
- The body `tenantId` must match the header tenant on create.
- The conversation index starts with `(tenant_id, conversation_id)`.

### Pagination
Keyset (cursor) pagination on `(created_at, id)` using a row-value comparison. Offset pagination would skip or repeat rows as new messages arrive. The cursor is opaque base64url of `{created_at, id}`. The service fetches `limit + 1` rows to compute `hasMore` without a count query. `created_at` is set by the application (millisecond precision) so the cursor round-trips exactly; messages created in the same millisecond are ordered by `id`.

### Logging
Structured JSON logs via Pino with a request ID (`x-request-id` is accepted or generated, and echoed in the response). Request logs contain only method, URL and status. **Message text and phone numbers are never logged**, and auth/cookie headers are redacted. Webhook logs contain only IDs and the result. Unhandled errors are logged server-side with the request ID; the client gets a generic 500.

---

## 6. Trade-offs and limitations

- **Synchronous processing.** Webhook events are processed inside the request. This is simple and gives "persist before acknowledge" for free, but there is no queue, retry/backoff or dead-letter handling, and slow DB work slows the response.
- **Unknown `messageId` returns 404 and the event is not stored.** The provider will retry, so if the event arrives before the message is visible it can succeed later. The cost is that such events are not kept for audit. The `UNMATCHED` result value and the missing FK are reserved for a future "park and reconcile" strategy.
- **No webhook authentication.** Production should verify an HMAC signature or shared secret and use a replay window.
- **Header-based tenant identity** is an exercise simplification (see the assumption above).
- **No outbound sending.** Messages stay `QUEUED` until the provider reports status; there is no real WhatsApp/Meta integration.
- **No rate limiting**, no metrics endpoint, and no Docker Compose in this version.
- **Same-millisecond ordering** uses the random UUID as a tiebreaker, so order within one millisecond is stable but not insertion order.
- **Event/message ID conflict** (same `eventId` for a different message) returns 409 instead of being silently treated as a duplicate.

---

## 7. Production considerations (high throughput)

- Put a **broker** (Kafka, SQS or RabbitMQ) behind the webhook: validate, persist the raw event (or enqueue durably), return 2xx quickly, and process asynchronously with **retry with backoff and a dead-letter queue**.
- **Partition by `messageId`** so events for one message are processed in order by one consumer, while different messages scale out in parallel. Keep the `event_id` unique constraint as the final idempotency guard because brokers deliver at-least-once.
- Replace the row lock with **optimistic concurrency** (`UPDATE ... WHERE version = ?`) or conditional updates (`WHERE status_rank < ?`) to reduce lock contention.
- **Scale the database**: read replicas for history queries, partition `messages` by tenant or time, and shard by `tenant_id` if needed. Archive or TTL old `webhook_events`.
- Add **authentication** (JWT/API keys, tenant derived from credentials), per-tenant **rate limiting**, **metrics** (events received, duplicates, ignored, failures), distributed tracing using the correlation ID, and alerting on DLQ depth.
- Run migrations as a separate deploy step and add health/readiness probes.

---

## 8. Sample requests

See `requests.http` (VS Code REST Client) for a ready-to-run collection. Examples with curl (bash/macOS/Linux):

```bash
# Create a message
curl -X POST http://localhost:3000/api/v1/messages \
  -H "Content-Type: application/json" -H "x-tenant-id: tenant-a" \
  -d '{"tenantId":"tenant-a","conversationId":"conv-100","to":"+919876543210","text":"Your order has shipped"}'

# Get a message
curl http://localhost:3000/api/v1/messages/<MESSAGE_ID> -H "x-tenant-id: tenant-a"

# List a conversation (paginated)
curl "http://localhost:3000/api/v1/conversations/conv-100/messages?limit=20" -H "x-tenant-id: tenant-a"

# Webhook event
curl -X POST http://localhost:3000/api/v1/webhooks/provider \
  -H "Content-Type: application/json" \
  -d '{"eventId":"evt-001","messageId":"<MESSAGE_ID>","status":"DELIVERED","occurredAt":"2026-10-16T08:30:00.000Z"}'

# Health
curl http://localhost:3000/health
```

PowerShell users can use `Invoke-RestMethod`:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/messages" `
  -Headers @{ "x-tenant-id" = "tenant-a" } -ContentType "application/json" `
  -Body '{"tenantId":"tenant-a","conversationId":"conv-100","to":"+919876543210","text":"Your order has shipped"}'
```

---

## 9. Test coverage

31 automated tests (`npm test`):
- **Success paths:** create, read, paginate, webhook apply, health.
- **Idempotency:** duplicate `eventId` (one record, applied once), 5 parallel duplicates.
- **Out-of-order:** late `SENT` after `READ` is ignored and keeps the status; `FAILED` is terminal; `FAILED` after `DELIVERED` is ignored.
- **Failures:** invalid payloads, malformed JSON, invalid cursor/limit, unknown `messageId` (404), event ID conflict (409), missing or mismatched tenant (401/403).
- **Tenant isolation:** cross-tenant read returns 404; conversation listing does not leak.
- **Transition table:** unit tests for the pure `decide()` function.
- **Concurrency:** parallel different events converge to the highest status.
