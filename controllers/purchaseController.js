const supabase = require('../config/supabase');
const cheapDataHub = require('../config/cheapdatahub');
const { sendMail } = require('../config/mailer');

// Helper: format currency
const formatAmount = (amount) => {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount);
};

// Helper: validate Nigerian phone number
const isValidNigerianPhone = (phone) => {
  return /^(070|080|081|090|091)\d{8}$/.test(phone);
};

// Helper: check maintenance mode
const isMaintenanceMode = async () => {
  const { data } = await supabase
    .from('site_settings')
    .select('setting_value')
    .eq('setting_key', 'maintenance_mode')
    .single();
  return data && data.setting_value === 'true';
};

// Helper: deduct from wallet
const deductWallet = async (userId, amount) => {
  const { data: user } = await supabase
    .from('users')
    .select('wallet_balance')
    .eq('id', userId)
    .single();

  const newBalance = parseFloat(user.wallet_balance) - parseFloat(amount);

  await supabase
    .from('users')
    .update({ wallet_balance: newBalance, updated_at: new Date().toISOString() })
    .eq('id', userId);

  return newBalance;
};

// Helper: refund wallet
const refundWallet = async (userId, amount) => {
  const { data: user } = await supabase
    .from('users')
    .select('wallet_balance')
    .eq('id', userId)
    .single();

  const newBalance = parseFloat(user.wallet_balance) + parseFloat(amount);

  await supabase
    .from('users')
    .update({ wallet_balance: newBalance, updated_at: new Date().toISOString() })
    .eq('id', userId);

  return newBalance;
};

// GET /api/purchase/plans
const getAllPlans = async (req, res) => {
  try {
    const { data: plans, error } = await supabase
      .from('data_plans')
      .select('*')
      .eq('is_active', true)
      .order('network')
      .order('selling_price');

    if (error) {
      console.error('Get all plans error:', error);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    // Group by network
    const grouped = {};
    plans.forEach((plan) => {
      if (!grouped[plan.network]) grouped[plan.network] = [];
      grouped[plan.network].push(plan);
    });

    return res.status(200).json({ plans: grouped });
  } catch (error) {
    console.error('Get all plans error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// GET /api/purchase/plans/:network
const getPlansByNetwork = async (req, res) => {
  try {
    const { network } = req.params;

    const validNetworks = ['MTN', 'Airtel', 'Glo', '9mobile'];
    if (!validNetworks.includes(network)) {
      return res.status(400).json({ message: 'Invalid network. Must be MTN, Airtel, Glo, or 9mobile.' });
    }

    const { data: plans, error } = await supabase
      .from('data_plans')
      .select('*')
      .eq('is_active', true)
      .eq('network', network)
      .order('selling_price');

    if (error) {
      console.error('Get plans by network error:', error);
      return res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }

    return res.status(200).json({ plans });
  } catch (error) {
    console.error('Get plans by network error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// POST /api/purchase/data
const purchaseData = async (req, res) => {
  try {
    const { plan_id, phone_number } = req.body;

    if (!plan_id || !phone_number) {
      return res.status(400).json({ message: 'plan_id and phone_number are required.' });
    }

    if (!isValidNigerianPhone(phone_number)) {
      return res.status(400).json({ message: 'Invalid phone number. Must be 11 digits starting with 070, 080, 081, 090, or 091.' });
    }

    // Fetch plan
    const { data: plan, error: planError } = await supabase
      .from('data_plans')
      .select('*')
      .eq('id', plan_id)
      .single();

    if (planError || !plan) {
      return res.status(404).json({ message: 'Data plan not found.' });
    }

    if (!plan.is_active) {
      return res.status(404).json({ message: 'This data plan is currently unavailable.' });
    }

    // Check wallet balance
    const { data: userRecord } = await supabase
      .from('users')
      .select('wallet_balance, full_name, email')
      .eq('id', req.user.id)
      .single();

    if (parseFloat(userRecord.wallet_balance) < parseFloat(plan.selling_price)) {
      return res.status(400).json({ message: 'Insufficient wallet balance. Please fund your wallet.' });
    }

    // Check maintenance mode
    if (await isMaintenanceMode()) {
      return res.status(503).json({ message: 'Service is currently under maintenance. Please try again later.' });
    }

    // Generate reference
    const reference = `VD-DATA-${Date.now()}-${Math.floor(100000 + Math.random() * 900000)}`;

    // Insert pending transaction
    const { data: transaction } = await supabase
      .from('transactions')
      .insert({
        user_id: req.user.id,
        type: 'data',
        network: plan.network,
        phone_number,
        amount: plan.selling_price,
        plan_id,
        reference,
        status: 'pending'
      })
      .select()
      .single();

    // Deduct wallet BEFORE calling provider
    const newBalance = await deductWallet(req.user.id, plan.selling_price);

    // Call CheapDataHub API
    let providerSuccess = false;
    let providerReference = null;

    try {
      const providerRes = await cheapDataHub.post('/data/purchase/', {
        bundle_id: plan.bundle_id,
        phone_number
      });

      if (providerRes.data && providerRes.data.status === true) {
        providerSuccess = true;
        providerReference = providerRes.data.reference || providerRes.data.order_id || null;
      }
    } catch (providerError) {
      console.error('CheapDataHub data error:', providerError.response?.data || providerError.message);
      providerSuccess = false;
    }

    if (providerSuccess) {
      // Update transaction to successful
      await supabase
        .from('transactions')
        .update({ status: 'successful', provider_reference: providerReference })
        .eq('id', transaction.id);

      // Send success email
      const firstName = userRecord.full_name.split(' ')[0];
      const successHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
              .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #6c3de0, #a855f7); padding: 30px; text-align: center; }
              .header h1 { color: #fff; margin: 0; font-size: 28px; letter-spacing: 2px; }
              .body { padding: 30px; }
              .body h2 { color: #22c55e; }
              .body p { color: #555; line-height: 1.7; }
              .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
              .footer { background: #f9f9f9; padding: 20px; text-align: center; font-size: 12px; color: #999; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header"><h1>VICKYDATA</h1></div>
              <div class="body">
                <h2>Data Purchase Successful! ✅</h2>
                <p>Hi ${firstName}, your data purchase was successful.</p>
                <div class="detail-row"><span><strong>Plan:</strong></span><span>${plan.plan_name}</span></div>
                <div class="detail-row"><span><strong>Network:</strong></span><span>${plan.network}</span></div>
                <div class="detail-row"><span><strong>Size:</strong></span><span>${plan.size}</span></div>
                <div class="detail-row"><span><strong>Validity:</strong></span><span>${plan.validity}</span></div>
                <div class="detail-row"><span><strong>Phone:</strong></span><span>${phone_number}</span></div>
                <div class="detail-row"><span><strong>Amount Deducted:</strong></span><span>${formatAmount(plan.selling_price)}</span></div>
                <div class="detail-row"><span><strong>New Balance:</strong></span><span>${formatAmount(newBalance)}</span></div>
                <div class="detail-row"><span><strong>Reference:</strong></span><span>${reference}</span></div>
              </div>
              <div class="footer">&copy; ${new Date().getFullYear()} VICKYDATA. All rights reserved.</div>
            </div>
          </body>
        </html>
      `;
      sendMail(userRecord.email, 'Data Purchase Successful', successHtml);

      return res.status(200).json({
        message: 'Data purchased successfully.',
        reference,
        new_balance: newBalance
      });
    } else {
      // Update transaction to failed
      await supabase
        .from('transactions')
        .update({ status: 'failed' })
        .eq('id', transaction.id);

      // Refund wallet
      const refundedBalance = await refundWallet(req.user.id, plan.selling_price);

      // Send failure email
      const firstName = userRecord.full_name.split(' ')[0];
      const failHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
              .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #6c3de0, #a855f7); padding: 30px; text-align: center; }
              .header h1 { color: #fff; margin: 0; font-size: 28px; letter-spacing: 2px; }
              .body { padding: 30px; }
              .body h2 { color: #ef4444; }
              .body p { color: #555; line-height: 1.7; }
              .footer { background: #f9f9f9; padding: 20px; text-align: center; font-size: 12px; color: #999; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header"><h1>VICKYDATA</h1></div>
              <div class="body">
                <h2>Data Purchase Failed ❌</h2>
                <p>Hi ${firstName},</p>
                <p>Your data purchase for <strong>${phone_number}</strong> (${plan.plan_name} - ${plan.network}) failed.</p>
                <p><strong>${formatAmount(plan.selling_price)}</strong> has been refunded to your wallet.</p>
                <p><strong>New Wallet Balance:</strong> ${formatAmount(refundedBalance)}</p>
                <p><strong>Reference:</strong> ${reference}</p>
                <p>Please try again. If the issue persists, contact our support team.</p>
              </div>
              <div class="footer">&copy; ${new Date().getFullYear()} VICKYDATA. All rights reserved.</div>
            </div>
          </body>
        </html>
      `;
      sendMail(userRecord.email, 'Data Purchase Failed', failHtml);

      return res.status(500).json({ message: 'Data purchase failed. Wallet refunded.' });
    }
  } catch (error) {
    console.error('Purchase data error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// POST /api/purchase/airtime
const purchaseAirtime = async (req, res) => {
  try {
    const { provider_id, phone_number, amount } = req.body;

    if (!provider_id || !phone_number || !amount) {
      return res.status(400).json({ message: 'provider_id, phone_number, and amount are required.' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < 50) {
      return res.status(400).json({ message: 'Minimum airtime amount is NGN 50.' });
    }
    if (parsedAmount > 50000) {
      return res.status(400).json({ message: 'Maximum airtime amount is NGN 50,000.' });
    }

    if (!isValidNigerianPhone(phone_number)) {
      return res.status(400).json({ message: 'Invalid phone number. Must be 11 digits starting with 070, 080, 081, 090, or 091.' });
    }

    // Map provider_id to network name
    const networkMap = { 1: 'MTN', 2: 'Airtel', 3: 'Glo', 4: '9mobile' };
    const network = networkMap[parseInt(provider_id)];
    if (!network) {
      return res.status(400).json({ message: 'Invalid provider_id. Use 1=MTN, 2=Airtel, 3=Glo, 4=9mobile.' });
    }

    // Check wallet balance
    const { data: userRecord } = await supabase
      .from('users')
      .select('wallet_balance, full_name, email')
      .eq('id', req.user.id)
      .single();

    if (parseFloat(userRecord.wallet_balance) < parsedAmount) {
      return res.status(400).json({ message: 'Insufficient wallet balance. Please fund your wallet.' });
    }

    // Check maintenance mode
    if (await isMaintenanceMode()) {
      return res.status(503).json({ message: 'Service is currently under maintenance. Please try again later.' });
    }

    // Generate reference
    const reference = `VD-AIR-${Date.now()}-${Math.floor(100000 + Math.random() * 900000)}`;

    // Insert pending transaction
    const { data: transaction } = await supabase
      .from('transactions')
      .insert({
        user_id: req.user.id,
        type: 'airtime',
        network,
        phone_number,
        amount: parsedAmount,
        reference,
        status: 'pending'
      })
      .select()
      .single();

    // Deduct wallet BEFORE calling provider
    const newBalance = await deductWallet(req.user.id, parsedAmount);

    // Call CheapDataHub API
    let providerSuccess = false;
    let providerReference = null;

    try {
      const providerRes = await cheapDataHub.post('/airtime/purchase/', {
        provider_id: parseInt(provider_id),
        phone_number,
        amount: parsedAmount
      });

      if (providerRes.data && providerRes.data.status === true) {
        providerSuccess = true;
        providerReference = providerRes.data.reference || providerRes.data.order_id || null;
      }
    } catch (providerError) {
      console.error('CheapDataHub airtime error:', providerError.response?.data || providerError.message);
      providerSuccess = false;
    }

    const firstName = userRecord.full_name.split(' ')[0];

    if (providerSuccess) {
      // Update transaction to successful
      await supabase
        .from('transactions')
        .update({ status: 'successful', provider_reference: providerReference })
        .eq('id', transaction.id);

      // Send success email
      const successHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
              .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #6c3de0, #a855f7); padding: 30px; text-align: center; }
              .header h1 { color: #fff; margin: 0; font-size: 28px; letter-spacing: 2px; }
              .body { padding: 30px; }
              .body h2 { color: #22c55e; }
              .body p { color: #555; line-height: 1.7; }
              .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
              .footer { background: #f9f9f9; padding: 20px; text-align: center; font-size: 12px; color: #999; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header"><h1>VICKYDATA</h1></div>
              <div class="body">
                <h2>Airtime Sent Successfully! ✅</h2>
                <p>Hi ${firstName}, your airtime purchase was successful.</p>
                <div class="detail-row"><span><strong>Network:</strong></span><span>${network}</span></div>
                <div class="detail-row"><span><strong>Phone:</strong></span><span>${phone_number}</span></div>
                <div class="detail-row"><span><strong>Amount:</strong></span><span>${formatAmount(parsedAmount)}</span></div>
                <div class="detail-row"><span><strong>New Balance:</strong></span><span>${formatAmount(newBalance)}</span></div>
                <div class="detail-row"><span><strong>Reference:</strong></span><span>${reference}</span></div>
              </div>
              <div class="footer">&copy; ${new Date().getFullYear()} VICKYDATA. All rights reserved.</div>
            </div>
          </body>
        </html>
      `;
      sendMail(userRecord.email, 'Airtime Sent Successfully', successHtml);

      return res.status(200).json({
        message: 'Airtime sent successfully.',
        reference,
        new_balance: newBalance
      });
    } else {
      // Update transaction to failed
      await supabase
        .from('transactions')
        .update({ status: 'failed' })
        .eq('id', transaction.id);

      // Refund wallet
      const refundedBalance = await refundWallet(req.user.id, parsedAmount);

      // Send failure email
      const failHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
              .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #6c3de0, #a855f7); padding: 30px; text-align: center; }
              .header h1 { color: #fff; margin: 0; font-size: 28px; letter-spacing: 2px; }
              .body { padding: 30px; }
              .body h2 { color: #ef4444; }
              .body p { color: #555; line-height: 1.7; }
              .footer { background: #f9f9f9; padding: 20px; text-align: center; font-size: 12px; color: #999; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header"><h1>VICKYDATA</h1></div>
              <div class="body">
                <h2>Airtime Purchase Failed ❌</h2>
                <p>Hi ${firstName},</p>
                <p>Your airtime purchase of <strong>${formatAmount(parsedAmount)}</strong> for <strong>${phone_number}</strong> (${network}) failed.</p>
                <p><strong>${formatAmount(parsedAmount)}</strong> has been refunded to your wallet.</p>
                <p><strong>New Wallet Balance:</strong> ${formatAmount(refundedBalance)}</p>
                <p><strong>Reference:</strong> ${reference}</p>
                <p>Please try again. If the issue persists, contact our support team.</p>
              </div>
              <div class="footer">&copy; ${new Date().getFullYear()} VICKYDATA. All rights reserved.</div>
            </div>
          </body>
        </html>
      `;
      sendMail(userRecord.email, 'Airtime Purchase Failed', failHtml);

      return res.status(500).json({ message: 'Airtime purchase failed. Wallet refunded.' });
    }
  } catch (error) {
    console.error('Purchase airtime error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

module.exports = { getAllPlans, getPlansByNetwork, purchaseData, purchaseAirtime };
