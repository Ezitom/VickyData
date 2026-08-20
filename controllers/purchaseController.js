const supabase = require('../config/supabase');
const { sendMail } = require('../config/mailer');
const VTUService = require('../providers/VTUService');
const { resolveProviderBundleId } = require('../utils/providerPlanResolver');
const { updateUserBalance } = require('./walletController');
const {
  getDataPurchaseSuccessEmailHtml,
  getDataPurchaseProcessingEmailHtml,
  getDataPurchaseFailedEmailHtml,
  getAirtimePurchaseSuccessEmailHtml,
  getAirtimePurchaseProcessingEmailHtml,
  getAirtimePurchaseFailedEmailHtml,
  getAdminRefundNotificationEmailHtml
} = require('../utils/emailTemplates');

// Keep backward-compat peaceSub client for the plan resolver utility
const peaceSub = require('../config/peacesub');

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

// ─── GET ALL PLANS (user-facing: only shows primary provider's active plans) ─
exports.getAllPlans = async (req, res) => {
  try {
    // Resolve the current primary active provider
    const { data: primaryProvider } = await supabase
      .from('vtu_providers')
      .select('id')
      .eq('is_primary', true)
      .eq('status', 'active')
      .order('priority', { ascending: true })
      .limit(1)
      .maybeSingle();

    let query = supabase
      .from('data_plans')
      .select('*')
      .eq('is_active', true)
      .order('selling_price', { ascending: true });

    if (primaryProvider) {
      query = query.eq('provider_id', primaryProvider.id);
    }

    const { data: plans, error } = await query;
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

    // Resolve the current primary active provider
    const { data: primaryProvider } = await supabase
      .from('vtu_providers')
      .select('id')
      .eq('is_primary', true)
      .eq('status', 'active')
      .order('priority', { ascending: true })
      .limit(1)
      .maybeSingle();

    let query = supabase
      .from('data_plans')
      .select('*')
      .eq('network', network)
      .eq('is_active', true)
      .order('selling_price', { ascending: true });

    if (primaryProvider) {
      query = query.eq('provider_id', primaryProvider.id);
    }

    const { data: plans, error } = await query;
    if (error) throw error;

    res.json({ plans: plans || [] });
  } catch (error) {
    console.error('Get plans by network error:', error);
    res.status(500).json({ message: 'Something went wrong.' });
  }
};

// ─── GET LIVE PLANS (user-facing: only shows primary provider's active plans) ─
exports.getLivePlans = async (req, res) => {
  try {
    // Resolve the current primary active provider
    const { data: primaryProvider } = await supabase
      .from('vtu_providers')
      .select('id')
      .eq('is_primary', true)
      .eq('status', 'active')
      .order('priority', { ascending: true })
      .limit(1)
      .maybeSingle();

    let query = supabase
      .from('data_plans')
      .select('*')
      .eq('is_active', true)
      .order('selling_price', { ascending: true });

    if (primaryProvider) {
      query = query.eq('provider_id', primaryProvider.id);
    }

    const { data: plans, error } = await query;
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
  let balanceResult = null;
  let phone_number = null;

  try {
    const { plan_id } = req.body;
    phone_number = req.body?.phone_number;

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

    // Deduct wallet BEFORE calling PeaceSub using atomic updateUserBalance helper
    try {
      balanceResult = await updateUserBalance(req.user.id, -parseFloat(plan.selling_price));
    } catch (updateErr) {
      await supabase
        .from('transactions')
        .update({ status: 'failed' })
        .eq('reference', reference);

      return res.status(400).json({
        message: updateErr.message || 'Insufficient wallet balance.'
      });
    }

    // Update transactions with balance_before and balance_after
    await supabase
      .from('transactions')
      .update({
        balance_before: balanceResult.balanceBefore,
        balance_after: balanceResult.balanceAfter
      })
      .eq('reference', reference);

    // ── CALL VTU SERVICE (routes to active primary provider) ─────────────────
    let resolvedBundleId = plan.bundle_id;

    try {
      const activeProvider = await VTUService.getPrimaryProvider();
      const providerBundleId = await resolveProviderBundleId(plan, activeProvider);
      if (providerBundleId) {
        resolvedBundleId = providerBundleId;
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

    console.log('Calling VTU provider (primary) data API with:', {
      network: plan.network,
      mobile_number: phone_number,
      plan: resolvedBundleId,
    });

    const providerResult = await VTUService.purchaseData({
      internal_ref: reference,
      phone_number,
      network: plan.network,
      bundle_id: resolvedBundleId,
      provider_network_code: plan.provider_network_code,
      amount: plan.selling_price
    });
    // ────────────────────────────────────────────────────────────────────────

    console.log('VTU provider data response:', JSON.stringify({
      status: providerResult.status,
      provider_reference: providerResult.provider_reference,
      provider_slug: providerResult.provider_slug
    }));

    // Store provider info in provider_transactions table
    try {
      await supabase.from('vtu_provider_transactions').insert({
        internal_transaction_ref: reference,
        provider_slug: providerResult.provider_slug,
        provider_reference: providerResult.provider_reference,
        provider_status: providerResult.status,
        internal_status: providerResult.status,
        response_payload: providerResult.raw_response
      });
    } catch (logErr) {
      console.warn('Provider transaction log error:', logErr.message);
    }

    // Update transactions table with provider info
    await supabase
      .from('transactions')
      .update({ provider_slug: providerResult.provider_slug })
      .eq('reference', reference);

    if (providerResult.status === 'SUCCESS') {
      await supabase
        .from('transactions')
        .update({
          status: 'successful',
          provider_reference:
            providerResult.provider_reference || null
        })
        .eq('reference', reference);

      const newBalance = balanceResult.balanceAfter;

      try {
        const emailHtml = getDataPurchaseSuccessEmailHtml({
          userName: user.full_name,
          planName: plan.plan_name,
          network: plan.network,
          phoneNumber: phone_number,
          amount: plan.selling_price,
          newBalance: newBalance,
          reference: reference
        });
        sendMail(
          user.email,
          'Data Purchase Successful - VICKYDATA',
          emailHtml
        );
      } catch (mailErr) {
        console.error('Data purchase success email failed:', mailErr.message);
      }

      return res.json({
        message: 'Data purchased successfully.',
        reference,
        new_balance: newBalance
      });

    // 'processing' orders resolved later via webhook/reconciliation
    } else if (providerResult.status === 'PROCESSING') {
      await supabase
        .from('transactions')
        .update({
          status: 'processing',
          provider_reference:
            providerResult.provider_reference || null
        })
        .eq('reference', reference);

      const newBalance = balanceResult.balanceAfter;

      try {
        const emailHtml = getDataPurchaseProcessingEmailHtml({
          userName: user.full_name,
          planName: plan.plan_name,
          network: plan.network,
          phoneNumber: phone_number,
          amount: plan.selling_price,
          newBalance: newBalance,
          reference: reference
        });
        sendMail(
          user.email,
          'Data Purchase Processing - VICKYDATA',
          emailHtml
        );
      } catch (mailErr) {
        console.error('Data purchase processing email failed:', mailErr.message);
      }

      return res.json({
        message: 'Your order is being processed by the provider.',
        reference,
        new_balance: newBalance
      });

    } else {
      const providerMessage = providerResult.error_message || 'Provider returned failure status';
      throw new Error(providerMessage);
    }

  } catch (error) {
    console.error('Data purchase error:', error.message);
    console.error('Error code:', error.code);

    let finalBalance = balanceResult ? balanceResult.balanceAfter : (user ? user.wallet_balance : 0);

    if (reference && balanceResult && plan) {
      const refundAmount = parseFloat(plan.selling_price);

      // Perform automatic refund crediting wallet back
      try {
        const refundResult = await updateUserBalance(req.user.id, refundAmount);
        finalBalance = refundResult.balanceAfter;
      } catch (refundErr) {
        console.error('Auto-refund failed for data purchase:', refundErr.message);
      }

      // Mark transaction as failed with updated final balance
      try {
        await supabase
          .from('transactions')
          .update({
            status: 'failed',
            balance_after: finalBalance
          })
          .eq('reference', reference);
      } catch (markErr) {
        console.error('Failed to mark transaction as failed:', markErr.message);
      }

      // Send refund email to user
      if (user && user.email) {
        try {
          const userRefundHtml = getDataPurchaseFailedEmailHtml({
            userName: user.full_name,
            planName: plan.plan_name,
            network: plan.network,
            phoneNumber: phone_number,
            amount: refundAmount,
            restoredBalance: finalBalance,
            reference: reference
          });
          sendMail(
            user.email,
            'Data Purchase Failed (Refunded) - VICKYDATA',
            userRefundHtml
          );
        } catch (mailErr) {
          console.error('Data purchase failure email failed:', mailErr.message);
        }
      }

      // Send refund email to admin
      const adminEmail = process.env.MAIL_USER || 'oniebenezer1@gmail.com';
      try {
        const adminRefundHtml = getAdminRefundNotificationEmailHtml({
          userName: user ? user.full_name : 'N/A',
          userEmail: user ? user.email : 'N/A',
          type: 'Data',
          network: plan ? plan.network : '',
          phoneNumber: phone_number,
          reference: reference,
          refundAmount: refundAmount,
          previousBalance: balanceResult.balanceAfter,
          presentBalance: finalBalance,
          isManual: false
        });
        sendMail(
          adminEmail,
          `[ADMIN ALERT] Automatic Refund Processed - ${reference}`,
          adminRefundHtml
        );
      } catch (adminMailErr) {
        console.error('Admin refund notification email failed:', adminMailErr.message);
      }
    }

    const isTimeout = error.code === 'ECONNABORTED' || (error.message && error.message.includes('timeout'));
    const refundNote = balanceResult && plan ? ` Your wallet has been automatically refunded ${formatNaira(plan.selling_price)}.` : '';
    const failureMsg = isTimeout
      ? `Purchase timed out.${refundNote} Reference: ${reference}`
      : `Data purchase failed: ${error.message || 'Provider error'}.${refundNote} Reference: ${reference}`;

    return res.status(400).json({
      message: failureMsg,
      reference,
      new_balance: finalBalance
    });
  }
};

// ─── PURCHASE AIRTIME ─────────────────────────────────────────
exports.purchaseAirtime = async (req, res) => {
  let reference = null;
  let user = null;
  let balanceResult = null;
  let phone_number = null;
  let amount = null;

  try {
    const { network } = req.body;
    phone_number = req.body?.phone_number;
    amount = req.body?.amount;

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

    // Deduct wallet BEFORE calling provider using atomic updateUserBalance helper
    try {
      balanceResult = await updateUserBalance(req.user.id, -parseFloat(amount));
    } catch (updateErr) {
      await supabase
        .from('transactions')
        .update({ status: 'failed' })
        .eq('reference', reference);

      return res.status(400).json({
        message: updateErr.message || 'Insufficient wallet balance.'
      });
    }

    // Update transactions with balance_before and balance_after
    await supabase
      .from('transactions')
      .update({
        balance_before: balanceResult.balanceBefore,
        balance_after: balanceResult.balanceAfter
      })
      .eq('reference', reference);

    // ── CALL VTU SERVICE (routes to active primary provider: PEACESUB) ──────
    console.log('Calling VTU provider (primary) airtime API with:', {
      network,
      mobile_number: phone_number,
      amount: parseFloat(amount)
    });

    const providerResult = await VTUService.purchaseAirtime({
      internal_ref: reference,
      phone_number,
      network,
      amount: parseFloat(amount)
    });
    // ────────────────────────────────────────────────────────────────────────

    console.log('VTU provider airtime response:', JSON.stringify({
      status: providerResult.status,
      provider_reference: providerResult.provider_reference,
      provider_slug: providerResult.provider_slug
    }));

    // Store provider info
    try {
      await supabase.from('vtu_provider_transactions').insert({
        internal_transaction_ref: reference,
        provider_slug: providerResult.provider_slug,
        provider_reference: providerResult.provider_reference,
        provider_status: providerResult.status,
        internal_status: providerResult.status,
        response_payload: providerResult.raw_response
      });
    } catch (logErr) {
      console.warn('Provider transaction log error:', logErr.message);
    }

    await supabase
      .from('transactions')
      .update({ provider_slug: providerResult.provider_slug })
      .eq('reference', reference);

    if (providerResult.status === 'SUCCESS') {
      await supabase
        .from('transactions')
        .update({
          status: 'successful',
          provider_reference:
            providerResult.provider_reference || null
        })
        .eq('reference', reference);

      const newBalance = balanceResult.balanceAfter;

      try {
        const emailHtml = getAirtimePurchaseSuccessEmailHtml({
          userName: user.full_name,
          network: networkNames[provider_id] || network,
          phoneNumber: phone_number,
          amount: amount,
          newBalance: newBalance,
          reference: reference
        });
        sendMail(
          user.email,
          'Airtime Purchase Successful - VICKYDATA',
          emailHtml
        );
      } catch (mailErr) {
        console.error('Airtime purchase success email failed:', mailErr.message);
      }

      return res.json({
        message: 'Airtime sent successfully.',
        reference,
        new_balance: newBalance
      });

    // 'processing' orders resolved later via webhook/reconciliation
    } else if (providerResult.status === 'PROCESSING') {
      await supabase
        .from('transactions')
        .update({
          status: 'processing',
          provider_reference:
            providerResult.provider_reference || null
        })
        .eq('reference', reference);

      const newBalance = balanceResult.balanceAfter;

      try {
        const emailHtml = getAirtimePurchaseProcessingEmailHtml({
          userName: user.full_name,
          network: networkNames[provider_id] || network,
          phoneNumber: phone_number,
          amount: amount,
          newBalance: newBalance,
          reference: reference
        });
        sendMail(
          user.email,
          'Airtime Purchase Processing - VICKYDATA',
          emailHtml
        );
      } catch (mailErr) {
        console.error('Airtime purchase processing email failed:', mailErr.message);
      }

      return res.json({
        message: 'Your order is being processed by the provider.',
        reference,
        new_balance: newBalance
      });

    } else {
      const providerMessage = providerResult.error_message || 'Provider returned failure status';
      throw new Error(providerMessage);
    }

  } catch (error) {
    console.error('Airtime purchase error:', error.message);
    console.error('Error code:', error.code);

    let finalBalance = balanceResult ? balanceResult.balanceAfter : (user ? user.wallet_balance : 0);

    if (reference && balanceResult && amount) {
      const refundAmount = parseFloat(amount);

      // Perform automatic refund crediting wallet back
      try {
        const refundResult = await updateUserBalance(req.user.id, refundAmount);
        finalBalance = refundResult.balanceAfter;
      } catch (refundErr) {
        console.error('Auto-refund failed for airtime purchase:', refundErr.message);
      }

      // Mark transaction as failed with updated final balance
      try {
        await supabase
          .from('transactions')
          .update({
            status: 'failed',
            balance_after: finalBalance
          })
          .eq('reference', reference);
      } catch (markErr) {
        console.error('Failed to mark transaction as failed:', markErr.message);
      }

      // Send refund email to user
      if (user && user.email) {
        try {
          const userRefundHtml = getAirtimePurchaseFailedEmailHtml({
            userName: user.full_name,
            network: networkNames[provider_id] || network,
            phoneNumber: phone_number,
            amount: refundAmount,
            restoredBalance: finalBalance,
            reference: reference
          });
          sendMail(
            user.email,
            'Airtime Purchase Failed (Refunded) - VICKYDATA',
            userRefundHtml
          );
        } catch (mailErr) {
          console.error('Airtime purchase failure email failed:', mailErr.message);
        }
      }

      // Send refund email to admin
      const adminEmail = process.env.MAIL_USER || 'oniebenezer1@gmail.com';
      try {
        const adminRefundHtml = getAdminRefundNotificationEmailHtml({
          userName: user ? user.full_name : 'N/A',
          userEmail: user ? user.email : 'N/A',
          type: 'Airtime',
          network: networkNames[provider_id] || network,
          phoneNumber: phone_number,
          reference: reference,
          refundAmount: refundAmount,
          previousBalance: balanceResult.balanceAfter,
          presentBalance: finalBalance,
          isManual: false
        });
        sendMail(
          adminEmail,
          `[ADMIN ALERT] Automatic Refund Processed - ${reference}`,
          adminRefundHtml
        );
      } catch (adminMailErr) {
        console.error('Admin refund notification email failed:', adminMailErr.message);
      }
    }

    const isTimeout = error.code === 'ECONNABORTED' || (error.message && error.message.includes('timeout'));
    const refundNote = balanceResult && amount ? ` Your wallet has been automatically refunded ${formatNaira(amount)}.` : '';
    const failureMsg = isTimeout
      ? `Purchase timed out.${refundNote} Reference: ${reference}`
      : `Airtime purchase failed: ${error.message || 'Provider error'}.${refundNote} Reference: ${reference}`;

    return res.status(400).json({
      message: failureMsg,
      reference,
      new_balance: finalBalance
    });
  }
};
