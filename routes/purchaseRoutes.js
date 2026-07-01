const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  getAllPlans,
  getPlansByNetwork,
  getLivePlans,
  purchaseData,
  purchaseAirtime
} = require('../controllers/purchaseController');

router.get('/plans', getAllPlans);
router.get('/live-plans', authMiddleware, getLivePlans);
router.get('/plans/:network', authMiddleware, getPlansByNetwork);
router.post('/data', authMiddleware, purchaseData);
router.post('/airtime', authMiddleware, purchaseAirtime);

router.get('/diagnose', async (req, res) => {
  try {
    const supabase = require('../config/supabase');
    const peaceSub = require('../config/peacesub');

    const { data: latestTransactions, error: dbError } = await supabase
      .from('transactions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    let peaceSubStatus = 'unknown';
    let peaceSubData = null;
    let peaceSubError = null;
    try {
      const psRes = await peaceSub.get('/user/');
      peaceSubStatus = 'success';
      peaceSubData = psRes.data;
    } catch (err) {
      peaceSubStatus = 'failed';
      peaceSubError = {
        message: err.message,
        code: err.code,
        response: err.response?.data
      };
    }

    res.json({
      supabase: dbError ? { status: 'error', error: dbError } : { status: 'ok', count: latestTransactions?.length },
      peaceSub: { status: peaceSubStatus, data: peaceSubData, error: peaceSubError },
      latestTransactions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
