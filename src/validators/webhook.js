const { z } = require('zod');

const webhookEventSchema = z.object({
  eventId: z.string().trim().min(1).max(128),
  messageId: z.string().trim().min(1).max(128),
  status: z.enum(['SENT', 'DELIVERED', 'READ', 'FAILED']),
  occurredAt: z.iso.datetime({ offset: true }), // jaise 2026-10-16T08:30:00.000Z
});

module.exports = { webhookEventSchema };