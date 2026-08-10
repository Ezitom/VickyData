const express = require('express');
const router = express.Router();
const { handlePeaceSubWebhook } = require('../controllers/webhookController');

// POST /api/webhooks/peacesub
router.post('/peacesub', handlePeaceSubWebhook);

module.exports = router;
