const express = require('express');
const { webhookLimiter } = require('../middleware/security');
const { handleMisticWebhook } = require('../lib/webhookHandler');

const router = express.Router();

// POST /api/webhooks/mistic?token=SEGREDO
router.post('/mistic', webhookLimiter, handleMisticWebhook);

module.exports = router;
