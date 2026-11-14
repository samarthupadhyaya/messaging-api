const { randomUUID } = require('crypto');
const db = require('../db');
const { badRequest, notFound } = require('../middleware/errors');

const toApi = (row) => ({
  id: row.id,
  tenantId: row.tenant_id,
  conversationId: row.conversation_id,
  to: row.to_number,
  text: row.body,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  sentAt: row.sent_at,
  deliveredAt: row.delivered_at,
  readAt: row.read_at,
  failedAt: row.failed_at,
});

async function createMessage(tenantId, input) {
  const now = new Date(); // JS se set karte hain (ms precision) taaki cursor stable rahe
  const row = {
    id: `msg_${randomUUID()}`,
    tenant_id: tenantId,
    conversation_id: input.conversationId,
    to_number: input.to,
    body: input.text,
    status: 'QUEUED',
    created_at: now,
    updated_at: now,
  };
  const [saved] = await db('messages').insert(row).returning('*');
  return toApi(saved);
}

async function getMessage(tenantId, messageId) {
  const row = await db('messages').where({ id: messageId, tenant_id: tenantId }).first();
  if (!row) throw notFound('Message not found'); // other tenant ka bhi 404
  return toApi(row);
}

const encodeCursor = (row) =>
  Buffer.from(JSON.stringify({ t: row.created_at.toISOString(), id: row.id })).toString('base64url');

function decodeCursor(cursor) {
  try {
    const { t, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof id !== 'string' || Number.isNaN(Date.parse(t))) throw new Error('bad');
    return { t: new Date(t), id };
  } catch {
    throw badRequest('Invalid cursor');
  }
}

async function listConversationMessages(tenantId, conversationId, { limit, cursor }) {
  const q = db('messages')
    .where({ tenant_id: tenantId, conversation_id: conversationId })
    .orderBy([{ column: 'created_at', order: 'asc' }, { column: 'id', order: 'asc' }])
    .limit(limit + 1);

  if (cursor) {
    const c = decodeCursor(cursor);
    q.whereRaw('(created_at, id) > (?, ?)', [c.t, c.id]);
  }

  const rows = await q;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: page.map(toApi),
    pagination: {
      limit,
      hasMore,
      nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
    },
  };
}

module.exports = { createMessage, getMessage, listConversationMessages };