const { z } = require('zod');

const webhookEventSchema = z.object({
  eventId: z.string().trim().min(1).max(128),
  messageId: z.string().trim().min(1).max(128),
  status: z.enum(['SENT', 'DELIVERED', 'READ', 'FAILED']),
  occurredAt: z.iso.datetime({ offset: true }), 
});

module.exports = { webhookEventSchema };

