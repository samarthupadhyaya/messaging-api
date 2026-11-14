const { api, db, resetDb, createMessage, sleep } = require('./helpers');

beforeEach(resetDb);
afterAll(() => db.destroy());

describe('POST /api/v1/messages', () => {
  test('creates a message with status QUEUED', async () => {
    const res = await createMessage();
    expect(res.status).toBe(201);
    expect(res.body.data.id).toMatch(/^msg_/);
    expect(res.body.data.status).toBe('QUEUED');
  });

  test('returns 400 for missing fields', async () => {
    const res = await api()
      .post('/api/v1/messages')
      .set('x-tenant-id', 'tenant-a')
      .send({ tenantId: 'tenant-a' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 400 for invalid phone number and too-long text', async () => {
    const bad = await createMessage({ to: '12345' });
    expect(bad.status).toBe(400);
    const long = await createMessage({ text: 'x'.repeat(5000) });
    expect(long.status).toBe(400);
  });

  test('returns 400 for malformed JSON', async () => {
    const res = await api()
      .post('/api/v1/messages')
      .set('x-tenant-id', 'tenant-a')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  test('returns 401 without x-tenant-id header', async () => {
    const res = await api().post('/api/v1/messages').send({});
    expect(res.status).toBe(401);
  });

  test('returns 403 when body tenantId differs from header', async () => {
    const res = await api()
      .post('/api/v1/messages')
      .set('x-tenant-id', 'tenant-a')
      .send({ tenantId: 'tenant-b', conversationId: 'c', to: '+919876543210', text: 'hi' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/messages/:messageId', () => {
  test('returns the message for the owning tenant', async () => {
    const { body } = await createMessage();
    const res = await api().get(`/api/v1/messages/${body.data.id}`).set('x-tenant-id', 'tenant-a');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(body.data.id);
    expect(res.body.data.status).toBe('QUEUED');
  });

  test('tenant isolation: another tenant gets 404', async () => {
    const { body } = await createMessage();
    const res = await api().get(`/api/v1/messages/${body.data.id}`).set('x-tenant-id', 'tenant-b');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/conversations/:id/messages', () => {
  test('paginates in stable order with no duplicates or gaps', async () => {
    const created = [];
    for (let i = 1; i <= 5; i += 1) {
      const r = await createMessage({ text: `m${i}` });
      created.push(r.body.data.id);
      await sleep(5);
    }

    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const url = `/api/v1/conversations/conv-1/messages?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await api().get(url).set('x-tenant-id', 'tenant-a');
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((m) => m.id));
      cursor = res.body.pagination.nextCursor;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toEqual(created);
  });

  test('does not leak messages across tenants', async () => {
    await createMessage();
    const res = await api()
      .get('/api/v1/conversations/conv-1/messages')
      .set('x-tenant-id', 'tenant-b');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('returns 400 for invalid cursor and invalid limit', async () => {
    const c = await api()
      .get('/api/v1/conversations/conv-1/messages?cursor=garbage')
      .set('x-tenant-id', 'tenant-a');
    expect(c.status).toBe(400);
    const l = await api()
      .get('/api/v1/conversations/conv-1/messages?limit=0')
      .set('x-tenant-id', 'tenant-a');
    expect(l.status).toBe(400);
  });
});

describe('GET /health', () => {
  test('reports db up', async () => {
    const res = await api().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });
});