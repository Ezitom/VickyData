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
  approveFunding,
  rejectFunding,
  getSettings,
  updateSettings,
  getAdminWalletBalance
} = require('../controllers/adminController');

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
router.get('/wallet-funding', getWalletFunding);
router.patch('/wallet-funding/:id/approve', approveFunding);
router.patch('/wallet-funding/:id/reject', rejectFunding);
router.get('/settings', getSettings);
router.patch('/settings', updateSettings);
router.get('/wallet-balance', getAdminWalletBalance);

module.exports = router;
