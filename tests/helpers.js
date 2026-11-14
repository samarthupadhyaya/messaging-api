const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

// Safety: galti se real DB saaf na ho jaye
function assertTestEnv() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Refusing to reset non-test DB');
}

async function resetDb() {
  assertTestEnv();
  await db.raw('TRUNCATE TABLE webhook_events, messages RESTART IDENTITY');
}

const api = () => request(app);

async function createMessage(overrides = {}, tenant = 'tenant-a') {
  const res = await api()
    .post('/api/v1/messages')
    .set('x-tenant-id', tenant)
    .send({
      tenantId: tenant,
      conversationId: 'conv-1',
      to: '+919876543210',
      text: 'Hello',
      ...overrides,
    });
  return res;
}

const sendEvent = (body) => api().post('/api/v1/webhooks/provider').send(body);

const event = (eventId, messageId, status, occurredAt = new Date().toISOString()) => ({
  eventId,
  messageId,
  status,
  occurredAt,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { api, db, resetDb, createMessage, sendEvent, event, sleep };