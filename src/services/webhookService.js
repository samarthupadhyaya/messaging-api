const db = require('../db');
const { AppError, notFound } = require('../middleware/errors');

const RANK = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };
const TIMESTAMP_COLUMN = {
  SENT: 'sent_at',
  DELIVERED: 'delivered_at',
  READ: 'read_at',
  FAILED: 'failed_at',
};

// Pure function: sirf decide karta hai ki event apply hoga ya nahi
function decide(current, incoming) {
  if (current === 'FAILED') return 'IGNORED_TERMINAL';
  if (incoming === 'FAILED') {
    return current === 'QUEUED' || current === 'SENT' ? 'APPLIED' : 'IGNORED_STALE';
  }
  return RANK[incoming] > RANK[current] ? 'APPLIED' : 'IGNORED_STALE';
}

async function processEvent(input) {
  const occurredAt = new Date(input.occurredAt);

  return db.transaction(async (trx) => {
    // 1. Message row lock (FOR UPDATE): same message ke do events ek saath aaye
    //    to ek wait karega, isse race condition nahi hoti
    const message = await trx('messages').where({ id: input.messageId }).forUpdate().first();
    if (!message) throw notFound('Unknown messageId');

    const result = decide(message.status, input.status);

    // 2. Event save. Unique(event_id) + ON CONFLICT DO NOTHING = idempotency
    const inserted = await trx('webhook_events')
      .insert({
        event_id: input.eventId,
        message_id: input.messageId,
        tenant_id: message.tenant_id,
        status: input.status,
        occurred_at: occurredAt,
        processing_result: result,
        raw_payload: JSON.stringify(input),
      })
      .onConflict('event_id')
      .ignore()
      .returning('id');

    // 3. Duplicate: pehle wala result wapas do, kuch dobara apply nahi
    if (inserted.length === 0) {
      const existing = await trx('webhook_events').where({ event_id: input.eventId }).first();
      if (existing.message_id !== input.messageId) {
        throw new AppError(409, 'EVENT_ID_CONFLICT', 'eventId already used for a different message');
      }
      return {
        eventId: input.eventId,
        messageId: input.messageId,
        duplicate: true,
        result: existing.processing_result,
        messageStatus: message.status,
      };
    }

    // 4. Apply (sirf agar allowed)
    if (result === 'APPLIED') {
      await trx('messages')
        .where({ id: input.messageId })
        .update({
          status: input.status,
          [TIMESTAMP_COLUMN[input.status]]: occurredAt,
          updated_at: new Date(),
          version: trx.raw('version + 1'),
        });
    }

    return {
      eventId: input.eventId,
      messageId: input.messageId,
      duplicate: false,
      result,
      messageStatus: result === 'APPLIED' ? input.status : message.status,
    };
  });
}

module.exports = { processEvent, decide };