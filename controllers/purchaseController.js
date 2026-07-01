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

// ─── GET LIVE PLANS FROM CHEAPDATAHUB ─────────────────────────
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
    const { data: plan, error: planError } = await supabase
      .from('data_plans')
      .select('*')
      .eq('id', plan_id)
      .eq('is_active', true)
      .single();

    if (planError || !plan) {
      return res.status(404).json({ message: 'Plan not found.' });
    }

    // Fetch user wallet balance
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('wallet_balance, full_name, email')
      .eq('id', req.user.id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Check balance
    if (parseFloat(user.wallet_balance) < parseFloat(plan.selling_price)) {
      return res.status(400).json({
        message: 'Insufficient wallet balance. Please fund your wallet.'
      });
    }

    // Generate reference
    const reference = generateRef('VD-DATA');

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

    // Deduct wallet BEFORE calling CheapDataHub
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

    console.log('Calling PeaceSub data API with:', {
      network: plan.network_id,
      mobile_number: phone_number,
      plan: plan.bundle_id,
      Ported_number: true
    });

    const providerResponse = await peaceSub.post(
      '/data/',
      {
        network: plan.network_id,
        mobile_number: phone_number,
        plan: plan.bundle_id,
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

      await sendMail(
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

    // If it is a timeout error, do not refund immediately
    // The purchase may have gone through on PeaceSub's end
    if (error.code === 'ECONNABORTED' || 
        error.message.includes('timeout')) {
      
      // Update transaction to pending instead of failed
      await supabase
        .from('transactions')
        .update({ status: 'pending' })
        .eq('user_id', req.user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1);

      return res.status(202).json({
        message: 'Your purchase is being processed. ' +
                 'Check your transaction history in a few ' +
                 'minutes to confirm delivery.',
        status: 'processing'
      });
    }

    // For all other errors, refund the wallet
    try {
      const { data: currentUser } = await supabase
        .from('users')
        .select('wallet_balance, full_name, email')
        .eq('id', req.user.id)
        .single();

      const { data: plan } = await supabase
        .from('data_plans')
        .select('selling_price')
        .eq('id', req.body.plan_id)
        .single();

      if (currentUser && plan) {
        await supabase
          .from('users')
          .update({
            wallet_balance: parseFloat(currentUser.wallet_balance) +
              parseFloat(plan.selling_price)
          })
          .eq('id', req.user.id);
      }

      await supabase
        .from('transactions')
        .update({ status: 'failed' })
        .eq('user_id', req.user.id)
        .eq('status', 'pending');

      if (currentUser) {
        const { sendMail } = require('../config/mailer');
        await sendMail(
          currentUser.email,
          'Data Purchase Failed - VICKYDATA',
          `
          <h2>Data Purchase Failed</h2>
          <p>Hi ${currentUser.full_name},</p>
          <p>Your data purchase could not be completed 
             and your wallet has been refunded.</p>
          <p>If you keep experiencing this issue, 
             please contact support.</p>
          `
        );
      }
    } catch (refundError) {
      console.error('Refund error:', refundError);
    }

    res.status(500).json({
      message: 'Data purchase failed. Your wallet has been refunded.'
    });
  }
};

// ─── PURCHASE AIRTIME ─────────────────────────────────────────
exports.purchaseAirtime = async (req, res) => {
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
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('wallet_balance, full_name, email')
      .eq('id', req.user.id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Check balance
    if (parseFloat(user.wallet_balance) < parseFloat(amount)) {
      return res.status(400).json({
        message: 'Insufficient wallet balance. Please fund your wallet.'
      });
    }

    // Generate reference
    const reference = generateRef('VD-AIR');

    const networkMap = {
      'mtn': 1,
      'glo': 2,
      'airtel': 3,
      '9mobile': 4
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

    // Deduct wallet BEFORE calling CheapDataHub
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

      await sendMail(
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

    if (error.code === 'ECONNABORTED' || 
        error.message.includes('timeout')) {
      
      await supabase
        .from('transactions')
        .update({ status: 'pending' })
        .eq('user_id', req.user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1);

      return res.status(202).json({
        message: 'Your purchase is being processed. ' +
                 'Check your transaction history in a few ' +
                 'minutes to confirm delivery.',
        status: 'processing'
      });
    }

    try {
      const { data: currentUser } = await supabase
        .from('users')
        .select('wallet_balance, full_name, email')
        .eq('id', req.user.id)
        .single();

      if (currentUser) {
        await supabase
          .from('users')
          .update({
            wallet_balance: parseFloat(currentUser.wallet_balance) +
              parseFloat(req.body.amount)
          })
          .eq('id', req.user.id);

        await supabase
          .from('transactions')
          .update({ status: 'failed' })
          .eq('user_id', req.user.id)
          .eq('status', 'pending');

        const { sendMail } = require('../config/mailer');
        await sendMail(
          currentUser.email,
          'Airtime Purchase Failed - VICKYDATA',
          `
          <h2>Airtime Purchase Failed</h2>
          <p>Hi ${currentUser.full_name},</p>
          <p>Your airtime purchase could not be completed 
             and your wallet has been refunded.</p>
          `
        );
      }
    } catch (refundError) {
      console.error('Refund error:', refundError);
    }

    res.status(500).json({
      message: 'Airtime purchase failed. Your wallet has been refunded.'
    });
  }
};
