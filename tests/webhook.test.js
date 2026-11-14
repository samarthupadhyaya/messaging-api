const { api, db, resetDb, createMessage, sendEvent, event } = require('./helpers');
const { decide } = require('../src/services/webhookService');

beforeEach(resetDb);
afterAll(() => db.destroy());

const getMessage = async (id) =>
  (await api().get(`/api/v1/messages/${id}`).set('x-tenant-id', 'tenant-a')).body.data;
const eventCount = async (eventId) =>
  Number((await db('webhook_events').where({ event_id: eventId }).count('* as c'))[0].c);

describe('POST /api/v1/webhooks/provider', () => {
  test('applies a valid status update', async () => {
    const { body } = await createMessage();
    const id = body.data.id;

    const res = await sendEvent(event('evt-1', id, 'DELIVERED'));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ duplicate: false, result: 'APPLIED', messageStatus: 'DELIVERED' });

    const msg = await getMessage(id);
    expect(msg.status).toBe('DELIVERED');
    expect(msg.deliveredAt).not.toBeNull();
  });

  test('duplicate eventId creates one record and applies once', async () => {
    const { body } = await createMessage();
    const id = body.data.id;

    const first = await sendEvent(event('evt-dup', id, 'DELIVERED'));
    const second = await sendEvent(event('evt-dup', id, 'DELIVERED'));

    expect(first.body.data.duplicate).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.data.duplicate).toBe(true);
    expect(await eventCount('evt-dup')).toBe(1);

    const row = await db('messages').where({ id }).first();
    expect(row.version).toBe(1); // effect sirf ek baar laga
  });

  test('out-of-order: late SENT after READ does not move status backwards', async () => {
    const { body } = await createMessage();
    const id = body.data.id;

    await sendEvent(event('evt-a', id, 'READ'));
    const late = await sendEvent(event('evt-b', id, 'SENT'));

    expect(late.status).toBe(200);
    expect(late.body.data.result).toBe('IGNORED_STALE');
    expect(late.body.data.messageStatus).toBe('READ');

    const msg = await getMessage(id);
    expect(msg.status).toBe('READ');
    expect(msg.sentAt).toBeNull();
    // ignored event audit ke liye save hota hai
    expect(await eventCount('evt-b')).toBe(1);
  });

  test('FAILED is terminal', async () => {
    const { body } = await createMessage();
    const id = body.data.id;

    await sendEvent(event('evt-f', id, 'FAILED'));
    const res = await sendEvent(event('evt-g', id, 'DELIVERED'));

    expect(res.body.data.result).toBe('IGNORED_TERMINAL');
    expect((await getMessage(id)).status).toBe('FAILED');
  });

  test('FAILED after DELIVERED is ignored', async () => {
    const { body } = await createMessage();
    const id = body.data.id;

    await sendEvent(event('evt-1', id, 'DELIVERED'));
    const res = await sendEvent(event('evt-2', id, 'FAILED'));

    expect(res.body.data.result).toBe('IGNORED_STALE');
    expect((await getMessage(id)).status).toBe('DELIVERED');
  });

  test('unknown messageId returns 404 and stores nothing', async () => {
    const res = await sendEvent(event('evt-x', 'msg_missing', 'SENT'));
    expect(res.status).toBe(404);
    expect(await eventCount('evt-x')).toBe(0);
  });

  test('invalid payloads return 400', async () => {
    const { body } = await createMessage();
    const id = body.data.id;

    const badStatus = await sendEvent(event('e1', id, 'BANANA'));
    expect(badStatus.status).toBe(400);

    const badDate = await sendEvent(event('e2', id, 'SENT', 'not-a-date'));
    expect(badDate.status).toBe(400);

    const missing = await sendEvent({ eventId: 'e3' });
    expect(missing.status).toBe(400);
  });

  test('same eventId reused for a different message returns 409', async () => {
    const a = (await createMessage()).body.data.id;
    const b = (await createMessage()).body.data.id;

    await sendEvent(event('evt-shared', a, 'SENT'));
    const res = await sendEvent(event('evt-shared', b, 'SENT'));
    expect(res.status).toBe(409);
  });

  test('concurrent duplicates: 5 parallel identical events apply once', async () => {
    const { body } = await createMessage();
    const id = body.data.id;
    const payload = event('evt-race', id, 'DELIVERED');

    const results = await Promise.all(Array.from({ length: 5 }, () => sendEvent(payload)));

    results.forEach((r) => expect(r.status).toBe(200));
    expect(results.filter((r) => r.body.data.duplicate === false)).toHaveLength(1);
    expect(await eventCount('evt-race')).toBe(1);
    expect((await db('messages').where({ id }).first()).version).toBe(1);
  });

  test('concurrent different events end in the highest status', async () => {
    const { body } = await createMessage();
    const id = body.data.id;

    await Promise.all([
      sendEvent(event('c1', id, 'SENT')),
      sendEvent(event('c2', id, 'DELIVERED')),
      sendEvent(event('c3', id, 'READ')),
    ]);

    expect((await getMessage(id)).status).toBe('READ');
  });
});

describe('decide() transition rules', () => {
  test.each([
    ['QUEUED', 'SENT', 'APPLIED'],
    ['SENT', 'DELIVERED', 'APPLIED'],
    ['DELIVERED', 'READ', 'APPLIED'],
    ['QUEUED', 'READ', 'APPLIED'], // SENT/DELIVERED skip hona allowed
    ['READ', 'DELIVERED', 'IGNORED_STALE'],
    ['READ', 'READ', 'IGNORED_STALE'],
    ['SENT', 'FAILED', 'APPLIED'],
    ['READ', 'FAILED', 'IGNORED_STALE'],
    ['FAILED', 'SENT', 'IGNORED_TERMINAL'],
  ])('%s + %s => %s', (current, incoming, expected) => {
    expect(decide(current, incoming)).toBe(expected);
  });
});