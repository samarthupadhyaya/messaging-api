const express = require('express');
const logger = require('../config/logger');
const { webhookEventSchema } = require('../validators/webhook');
const { processEvent } = require('../services/webhookService');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// NOTE: yahan x-tenant-id nahi chahiye, kyunki caller provider hai, tenant nahi.
// Production mein ise HMAC signature / shared secret se protect karna chahiye.
router.post('/webhooks/provider', wrap(async (req, res) => {
  const input = webhookEventSchema.parse(req.body);
  const outcome = await processEvent(input);

  // Message text ya phone number log nahi hota, sirf ids aur result
  logger.info(
    { requestId: req.id, eventId: outcome.eventId, messageId: outcome.messageId,
      result: outcome.result, duplicate: outcome.duplicate },
    'webhook processed'
  );

  res.status(200).json({ data: outcome });
}));

module.exports = router;