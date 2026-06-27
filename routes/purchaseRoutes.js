const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  getAllPlans,
  getPlansByNetwork,
  purchaseData,
  purchaseAirtime
} = require('../controllers/purchaseController');

router.get('/plans', authMiddleware, getAllPlans);
router.get('/plans/:network', authMiddleware, getPlansByNetwork);
router.post('/data', authMiddleware, purchaseData);
router.post('/airtime', authMiddleware, purchaseAirtime);

module.exports = router;
