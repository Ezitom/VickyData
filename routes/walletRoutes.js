const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  initiateFunding,
  createFundingRequest,
  getMyFundingRequests,
  markFundingRequestAsSent,
  verifyFunding,
  paystackWebhook,
  getBalance
} = require('../controllers/walletController');

router.post('/initiate-funding', authMiddleware, initiateFunding);
router.post('/funding-requests', authMiddleware, createFundingRequest);
router.get('/funding-requests/mine', authMiddleware, getMyFundingRequests);
router.post('/funding-requests/:id/mark-sent', authMiddleware, markFundingRequestAsSent);
router.post('/verify-funding', authMiddleware, verifyFunding);
router.post('/paystack-webhook', paystackWebhook); // Public - no auth, Paystack hits this
router.get('/balance', authMiddleware, getBalance);

module.exports = router;
