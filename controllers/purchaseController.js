const supabase = require('../config/supabase');
const peaceSub = require('../config/peacesub');
const { sendMail } = require('../config/mailer');
const { resolveProviderBundleId } = require('../utils/providerPlanResolver');

const generateRef = (prefix) => {
  const timestamp = Date.now();
  const random = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${timestamp}-${random}`;
};

const formatNaira = (amount) => {
  return `N${Number(amount).toLocaleString('en-NG', {
    minimumFractionDigits: 2
  })}`;
};

const isProviderSuccess = (responseData) => {
  const status = String(responseData?.status ?? '').toLowerCase();
  return [
    'true',
    'success',
    'successful',
    '1',
    'ok'
  ].includes(status) || responseData?.success === true || responseData?.status === 1;
};

const getProviderErrorMessage = (responseData, defaultMsg = 'Provider returned failure status') => {
  if (!responseData) return defaultMsg;
  return responseData.message || responseData.error || responseData.detail || String(responseData.status || defaultMsg);
};

// ─── GET ALL PLANS ────────────────────────────────────────────
exports.getAllPlans = async (req, res) => {
  try {
    const { data: plans, error } = await supabase
      .from('data_plans')
      .select('*')
      .eq('is_active', true)
      .order('selling_price', { ascending: true });

    if (error) throw error;

    const grouped = plans.reduce((acc, plan) => {
      if (!acc[plan.network]) acc[plan.network] = [];
      acc[plan.network].push(plan);
      return acc;
    }, {});

    res.json({ plans: grouped });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ message: 'Something went wrong.' });
  }
};

// ─── GET PLANS BY NETWORK ─────────────────────────────────────
exports.getPlansByNetwork = async (req, res) => {
  try {
    const { network } = req.params;

    const { data: plans, error } = await supabase
      .from('data_plans')
      .select('*')
      .eq('network', network)
      .eq('is_active', true)
      .order('selling_price', { ascending: true });

    if (error) throw error;

    res.json({ plans });
  } catch (error) {
    console.error('Get plans by network error:', error);
    res.status(500).json({ message: 'Something went wrong.' });
  }
};

// ─── GET LIVE PLANS FROM PEACESUB (via Supabase cache) ──────────
exports.getLivePlans = async (req, res) => {
  try {
    const { data: plans, error } = await supabase
      .from('data_plans')
      .select('*')
      .eq('is_active', true)
      .order('selling_price', { ascending: true });

    if (error) throw error;

    const grouped = plans.reduce((acc, plan) => {
      if (!acc[plan.network]) acc[plan.network] = [];
      acc[plan.network].push(plan);
      return acc;
    }, {});

    res.json({ plans: grouped });
  } catch (error) {
    console.error('Get live plans error:', error);
    res.status(500).json({ 
      message: 'Could not fetch plans.' 
    });
  }
};

// ─── PURCHASE DATA ────────────────────────────────────────────
exports.purchaseData = async (req, res) => {
  let reference = null;
  let plan = null;
  let user = null;

  try {
    const { plan_id, phone_number } = req.body;

    // Validate inputs
    if (!plan_id || !phone_number) {
      return res.status(400).json({
        message: 'Plan and phone number are required.'
      });
    }

    // Validate Nigerian phone number
    const phoneRegex = /^(070|080|081|090|091)\d{8}$/;
    if (!phoneRegex.test(phone_number)) {
      return res.status(400).json({
        message: 'Enter a valid 11-digit Nigerian phone number.'
      });
    }

    // Check maintenance mode
    const { data: maintenance } = await supabase
      .from('site_settings')
      .select('setting_value')
      .eq('setting_key', 'maintenance_mode')
      .single();

    if (maintenance?.setting_value === 'true') {
      return res.status(503).json({
        message: 'Platform is under maintenance. Try again later.'
      });
    }

    // Fetch the plan from Supabase
    const { data: planData, error: planError } = await supabase
      .from('data_plans')
      .select('*')
      .eq('id', plan_id)
      .eq('is_active', true)
      .single();

    if (planError || !planData) {
      return res.status(404).json({ message: 'Plan not found.' });
    }
    plan = planData;

    // Fetch user wallet balance
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('wallet_balance, full_name, email')
      .eq('id', req.user.id)
      .single();

    if (userError || !userData) {
      return res.status(404).json({ message: 'User not found.' });
    }
    user = userData;

    // Check balance
    if (parseFloat(user.wallet_balance) < parseFloat(plan.selling_price)) {
      return res.status(400).json({
        message: 'Insufficient wallet balance. Please fund your wallet.'
      });
    }

    // Generate reference
    reference = generateRef('VD-DATA');

    // Insert pending transaction
    await supabase.from('transactions').insert({
      user_id: req.user.id,
      type: 'data',
      network: plan.network,
      phone_number,
      amount: plan.selling_price,
      plan_id: plan.id,
      reference,
      status: 'pending'
    });

    // Deduct wallet BEFORE calling PeaceSub
    await supabase
      .from('users')
      .update({
        wallet_balance: parseFloat(user.wallet_balance) -
          parseFloat(plan.selling_price)
      })
      .eq('id', req.user.id);

    // ── CALL PEACESUB DATA API ──────────────────────────
    let resolvedBundleId = plan.bundle_id;

    try {
      const providerBundleId = await resolveProviderBundleId(plan, peaceSub);
      if (providerBundleId) {
        resolvedBundleId = providerBundleId;
        await supabase
          .from('data_plans')
          .update({ bundle_id: providerBundleId })
          .eq('id', plan.id);
      }
    } catch (bundleError) {
      console.warn('Bundle resolution warning:', bundleError.message);
    }

    if (!resolvedBundleId) {
      throw new Error('No valid bundle ID found for the selected plan.');
    }

    const networkMap = {
      'mtn': 1,
      'glo': 2,
      '9mobile': 3,
      'airtel': 4
    };
    const providerNetworkId = networkMap[String(plan.network).toLowerCase()] || plan.network_id;

    console.log('Calling PeaceSub data API with:', {
      network: providerNetworkId,
      mobile_number: phone_number,
      plan: resolvedBundleId,
      Ported_number: true
    });

    const providerResponse = await peaceSub.post(
      '/data/',
      {
        network: providerNetworkId,
        mobile_number: phone_number,
        plan: resolvedBundleId,
        Ported_number: true
      }
    );
    // ────────────────────────────────────────────────────────

    console.log('PeaceSub data response:', 
      JSON.stringify(providerResponse.data));

    const psStatus = String(
      providerResponse.data.Status ||
      providerResponse.data.status ||
      ''
    ).toLowerCase();

    if (psStatus === 'successful' ||
        psStatus === 'success' ||
        psStatus === 'true') {
      await supabase
        .from('transactions')
        .update({
          status: 'successful',
          provider_reference: 
            providerResponse.data.ident || 
            String(providerResponse.data.id) || 
            null
        })
        .eq('reference', reference);

      const newBalance = parseFloat(user.wallet_balance) -
        parseFloat(plan.selling_price);

      sendMail(
        user.email,
        'Data Purchase Successful - VICKYDATA',
        `
        <h2>Data Purchase Successful</h2>
        <p>Hi ${user.full_name},</p>
        <p>Your data purchase was successful. Details:</p>
        <ul>
          <li><strong>Plan:</strong> ${plan.plan_name}</li>
          <li><strong>Network:</strong> ${plan.network}</li>
          <li><strong>Phone:</strong> ${phone_number}</li>
          <li><strong>Amount Deducted:</strong>
            ${formatNaira(plan.selling_price)}</li>
          <li><strong>New Balance:</strong>
            ${formatNaira(newBalance)}</li>
          <li><strong>Reference:</strong> ${reference}</li>
        </ul>
        <p>Thank you for using VICKYDATA.</p>
        `
      );

      return res.json({
        message: 'Data purchased successfully.',
        reference,
        new_balance: newBalance
      });

    } else {
      const providerMessage = getProviderErrorMessage(providerResponse.data);
      throw new Error(providerMessage);
    }

  } catch (error) {
    console.error('Data purchase error:', error.message);
    console.error('Error code:', error.code);

    // Mark the transaction as failed (do NOT auto-refund)
    // Admin will review and manually refund from the dashboard
    try {
      if (reference) {
        await supabase
          .from('transactions')
          .update({ status: 'failed' })
          .eq('reference', reference);
      }
    } catch (markErr) {
      console.error('Failed to mark transaction as failed:', markErr.message);
    }

    if (error.code === 'ECONNABORTED' ||
        error.message.includes('timeout')) {
      console.warn('Data purchase timeout for reference:', reference);
      return res.status(500).json({
        message: 'Purchase timed out. ' +
                 'Please contact support to request a refund ' +
                 'if your wallet was deducted. ' +
                 'Reference: ' + reference
      });
    }

    return res.status(500).json({
      message: 'Data purchase failed. ' +
               'Please contact support to request a refund ' +
               'if your wallet was deducted. ' +
               'Reference: ' + reference
    });
  }
};

// ─── PURCHASE AIRTIME ─────────────────────────────────────────
exports.purchaseAirtime = async (req, res) => {
  let reference = null;
  let user = null;

  try {
    const { network, phone_number, amount } = req.body;

    // Validate inputs
    if (!network || !phone_number || !amount) {
      return res.status(400).json({
        message: 'Network, phone number and amount are required.'
      });
    }

    // Validate amount
    if (parseFloat(amount) < 50 || parseFloat(amount) > 50000) {
      return res.status(400).json({
        message: 'Amount must be between N50 and N50,000.'
      });
    }

    // Validate Nigerian phone number
    const phoneRegex = /^(070|080|081|090|091)\d{8}$/;
    if (!phoneRegex.test(phone_number)) {
      return res.status(400).json({
        message: 'Enter a valid 11-digit Nigerian phone number.'
      });
    }

    // Check maintenance mode
    const { data: maintenance } = await supabase
      .from('site_settings')
      .select('setting_value')
      .eq('setting_key', 'maintenance_mode')
      .single();

    if (maintenance?.setting_value === 'true') {
      return res.status(503).json({
        message: 'Platform is under maintenance. Try again later.'
      });
    }

    // Fetch user wallet balance
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('wallet_balance, full_name, email')
      .eq('id', req.user.id)
      .single();

    if (userError || !userData) {
      return res.status(404).json({ message: 'User not found.' });
    }
    user = userData;

    // Check balance
    if (parseFloat(user.wallet_balance) < parseFloat(amount)) {
      return res.status(400).json({
        message: 'Insufficient wallet balance. Please fund your wallet.'
      });
    }

    // Generate reference
    reference = generateRef('VD-AIR');

    const networkMap = {
      'mtn': 1,
      'glo': 2,
      '9mobile': 3,
      'airtel': 4
    };
    const provider_id = networkMap[String(network).toLowerCase()] || network;

    // Network name map
    const networkNames = {
      1: 'MTN',
      2: 'Glo',
      3: '9mobile',
      4: 'Airtel'
    };

    const providerNetwork = networkNames[provider_id] || String(network).toUpperCase();

    // Insert pending transaction
    await supabase.from('transactions').insert({
      user_id: req.user.id,
      type: 'airtime',
      network: providerNetwork,
      phone_number,
      amount: parseFloat(amount),
      reference,
      status: 'pending'
    });

    // Deduct wallet BEFORE calling PeaceSub
    await supabase
      .from('users')
      .update({
        wallet_balance: parseFloat(user.wallet_balance) -
          parseFloat(amount)
      })
      .eq('id', req.user.id);

    // ── CALL PEACESUB AIRTIME API ───────────────────────
    console.log('Calling PeaceSub airtime API with:', {
      network: parseInt(provider_id),
      mobile_number: phone_number,
      amount: parseFloat(amount),
      Ported_number: true,
      airtime_type: 'VTU'
    });

    const providerResponse = await peaceSub.post(
      '/topup/',
      {
        network: parseInt(provider_id),
        mobile_number: phone_number,
        amount: parseFloat(amount),
        Ported_number: true,
        airtime_type: 'VTU'
      }
    );
    // ────────────────────────────────────────────────────────

    console.log('PeaceSub airtime response:', 
      JSON.stringify(providerResponse.data));

    const psStatus = String(
      providerResponse.data.Status ||
      providerResponse.data.status ||
      ''
    ).toLowerCase();

    if (psStatus === 'successful' ||
        psStatus === 'success' ||
        psStatus === 'true') {
      await supabase
        .from('transactions')
        .update({
          status: 'successful',
          provider_reference: 
            providerResponse.data.ident || 
            String(providerResponse.data.id) || 
            null
        })
        .eq('reference', reference);

      const newBalance = parseFloat(user.wallet_balance) -
        parseFloat(amount);

      sendMail(
        user.email,
        'Airtime Purchase Successful - VICKYDATA',
        `
        <h2>Airtime Purchase Successful</h2>
        <p>Hi ${user.full_name},</p>
        <p>Your airtime purchase was successful. Details:</p>
        <ul>
          <li><strong>Network:</strong>
            ${networkNames[provider_id] || network}</li>
          <li><strong>Phone:</strong> ${phone_number}</li>
          <li><strong>Amount:</strong> ${formatNaira(amount)}</li>
          <li><strong>New Balance:</strong>
            ${formatNaira(newBalance)}</li>
          <li><strong>Reference:</strong> ${reference}</li>
        </ul>
        <p>Thank you for using VICKYDATA.</p>
        `
      );

      return res.json({
        message: 'Airtime sent successfully.',
        reference,
        new_balance: newBalance
      });

    } else {
      const providerMessage = getProviderErrorMessage(providerResponse.data);
      throw new Error(providerMessage);
    }

  } catch (error) {
    console.error('Airtime purchase error:', error.message);
    console.error('Error code:', error.code);

    // Mark the transaction as failed (do NOT auto-refund)
    // Admin will review and manually refund from the dashboard
    try {
      if (reference) {
        await supabase
          .from('transactions')
          .update({ status: 'failed' })
          .eq('reference', reference);
      }
    } catch (markErr) {
      console.error('Failed to mark transaction as failed:', markErr.message);
    }

    if (error.code === 'ECONNABORTED' ||
        error.message.includes('timeout')) {
      console.warn('Airtime purchase timeout for reference:', reference);
      return res.status(500).json({
        message: 'Purchase timed out. ' +
                 'Please contact support to request a refund ' +
                 'if your wallet was deducted. ' +
                 'Reference: ' + reference
      });
    }

    return res.status(500).json({
      message: 'Airtime purchase failed. ' +
               'Please contact support to request a refund ' +
               'if your wallet was deducted. ' +
               'Reference: ' + reference
    });
  }
};
