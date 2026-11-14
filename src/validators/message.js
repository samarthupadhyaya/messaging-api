const { z } = require('zod');

const createMessageSchema = z.object({
  tenantId: z.string().trim().min(1).max(64),
  conversationId: z.string().trim().min(1).max(64),
  to: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'must be E.164 format, e.g. +919876543210'),
  text: z.string().min(1).max(4096),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

module.exports = { createMessageSchema, listQuerySchema };