const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const {
  getOverview,
  getAllTransactions,
  getAllUsers,
  getSingleUser,
  toggleUserStatus,
  getPlans,
  createPlan,
  updatePlan,
  togglePlanStatus,
  getWalletFunding,
  getSettings,
  updateSettings,
  getProviderWalletBalance,
  syncPlans
} = require('../controllers/adminController');
const {
  listAdminFundingRequests,
  confirmFundingRequest,
  rejectFundingRequest
} = require('../controllers/walletController');

// Apply both middlewares to all admin routes
router.use(authMiddleware, adminMiddleware);

router.get('/overview', getOverview);
router.get('/transactions', getAllTransactions);
router.get('/users', getAllUsers);
router.get('/users/:id', getSingleUser);
router.patch('/users/:id/toggle-status', toggleUserStatus);
router.get('/plans', getPlans);
router.post('/plans', createPlan);
router.patch('/plans/:id', updatePlan);
router.patch('/plans/:id/toggle-status', togglePlanStatus);
router.post('/sync-plans', syncPlans);
router.get('/wallet-funding', getWalletFunding);
router.get('/funding-requests', listAdminFundingRequests);
router.post('/funding-requests/:id/confirm', confirmFundingRequest);
router.post('/funding-requests/:id/reject', rejectFundingRequest);
router.get('/settings', getSettings);
router.patch('/settings', updateSettings);
router.put('/settings', updateSettings);
router.get('/wallet-balance', getProviderWalletBalance);

module.exports = router;
