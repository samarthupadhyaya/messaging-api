const express = require('express');
const tenant = require('../middleware/tenant');
const { forbidden } = require('../middleware/errors');
const { createMessageSchema, listQuerySchema } = require('../validators/message');
const svc = require('../services/messageService');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.post('/messages', tenant, wrap(async (req, res) => {
  const input = createMessageSchema.parse(req.body);
  if (input.tenantId !== req.tenantId) {
    throw forbidden('tenantId in body does not match x-tenant-id header');
  }
  const message = await svc.createMessage(req.tenantId, input);
  res.status(201).json({ data: message });
}));

router.get('/messages/:messageId', tenant, wrap(async (req, res) => {
  const message = await svc.getMessage(req.tenantId, req.params.messageId);
  res.json({ data: message });
}));

router.get('/conversations/:conversationId/messages', tenant, wrap(async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  const result = await svc.listConversationMessages(req.tenantId, req.params.conversationId, query);
  res.json(result);
}));

module.exports = router;