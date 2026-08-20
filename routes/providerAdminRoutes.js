const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const {
  listProviders,
  getProviderStatus,
  getProviderBalance,
  getProviderDataPlans,
  activateProvider,
  deactivateProvider,
  setPrimaryProvider,
  setProviderPriority,
  setMaintenanceMode,
  testConnection,
  getHealthSnapshot,
  comparePlans,
  getProviderLogs,
  getProviderTransactions,
  reloadRegistry,
  listPlanMappings,
  createPlanMapping,
  deletePlanMapping
} = require('../controllers/providerAdminController');

// All routes require admin authentication
router.use(authMiddleware, adminMiddleware);

// ─── Provider Management ──────────────────────────────────────────────────────
router.get('/',                              listProviders);
router.get('/health',                        getHealthSnapshot);
router.get('/compare-plans',                 comparePlans);
router.get('/logs',                          getProviderLogs);
router.post('/reload',                       reloadRegistry);

router.get('/:slug/status',                  getProviderStatus);
router.get('/:slug/balance',                 getProviderBalance);
router.get('/:slug/plans',                   getProviderDataPlans);
router.get('/:slug/transactions',            getProviderTransactions);
router.patch('/:slug/activate',              activateProvider);
router.patch('/:slug/deactivate',            deactivateProvider);
router.patch('/:slug/set-primary',           setPrimaryProvider);
router.patch('/:slug/set-priority',          setProviderPriority);
router.patch('/:slug/maintenance',           setMaintenanceMode);
router.post('/:slug/test-connection',        testConnection);

// ─── Plan Mappings ────────────────────────────────────────────────────────────
router.get('/plan-mappings',                 listPlanMappings);
router.post('/plan-mappings',                createPlanMapping);
router.delete('/plan-mappings/:id',          deletePlanMapping);

module.exports = router;
