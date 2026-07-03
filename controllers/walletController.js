const crypto = require('crypto');
const axios = require('axios');
const supabase = require('../config/supabase');
const { sendMail } = require('../config/mailer');
const { generateReferenceCode, isExpired } = require('../utils/fundingRequestUtils');

const PAYSTACK_BASE = 'https://api.paystack.co';

// Helper: format currency
const formatAmount = (amount) => {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount);
};

const ensureWalletForUser = async (userId) => {
  const { data: existingWallet } = await supabase
    .from('wallets')
    .select('id, balance')
    .eq('user_id', userId)
    .maybeSingle();

  if (existingWallet) return existingWallet;

  const { data: insertedWallet, error: walletInsertError } = await supabase
    .from('wallets')
    .insert({ user_id: userId, balance: 0, updated_at: new Date().toISOString() })
    .select('id, balance')
    .single();

  if (walletInsertError || !insertedWallet) {
    throw walletInsertError || new Error('Unable to create wallet record.');
  }

  return insertedWallet;
};

const appendWalletTransaction = async (walletId, fundingRequestId, type, amount, balanceAfter, source = 'manual') => {
  const { error } = await supabase
    .from('wallet_transactions')
    .insert({
      wallet_id: walletId,
      funding_request_id: fundingRequestId || null,
      type,
      amount,
      balance_after: balanceAfter,
      source,
      created_at: new Date().toISOString()
    });

  if (error) throw error;
};

const syncExpiredFundingRequests = async (userId = null) => {
  try {
    const { data: pendingRequests, error } = await supabase
      .from('funding_requests')
      .select('id, created_at')
      .eq('status', 'pending');

    if (error || !pendingRequests) return;

    const stale = pendingRequests.filter((request) => isExpired(request.created_at));
    if (stale.length === 0) return;

    await Promise.all(stale.map((request) => supabase
      .from('funding_requests')
      .update({ status: 'expired', reviewed_at: new Date().toISOString(), reviewed_by: null })
      .eq('id', request.id)));
  } catch (error) {
    console.error('Expiry sync error:', error);
  }
};

const confirmFundingWithRpc = async (fundingRequestId, adminUserId) => {
  const { data, error } = await supabase.rpc('credit_funding_request_wallet', {
    p_funding_request_id: fundingRequestId,
    p_admin_id: adminUserId
  });

  if (error) {
    throw error;
  }

  return data;
};

// Helper: credit wallet (shared logic for verify & webhook)
const creditWallet = async (reference) => {
  // Look up the pending wallet_funding record
  let { data: funding, error: fundingError } = await supabase
    .from('wallet_funding')
    .select('id, user_id, amount, status')
    .eq('paystack_reference', reference)
    .maybeSingle();

  if (!funding) {
    // If not found, let's fetch details from Paystack to create it!
    try {
      const paystackRes = await axios.get(
        `${PAYSTACK_BASE}/transaction/verify/${reference}`,
        {
          headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
        }
      );

      if (paystackRes.data && paystackRes.data.data && paystackRes.data.data.status === 'success') {
        const txData = paystackRes.data.data;
        const amount = txData.amount / 100;
        const user_id = txData.metadata?.user_id;

        if (!user_id) {
          return { success: false, message: 'User ID missing in transaction metadata.' };
        }

        // Insert new wallet_funding record
        const { data: newFunding, error: insertError } = await supabase
          .from('wallet_funding')
          .insert({
            user_id,
            amount,
            paystack_reference: reference,
            status: 'pending'
          })
          .select('id, user_id, amount, status')
          .single();

        if (insertError || !newFunding) {
          console.error('Auto-create wallet funding record error:', insertError);
          return { success: false, message: 'Could not initialize funding record.' };
        }

        funding = newFunding;
      } else {
        return { success: false, message: 'Transaction not successful on Paystack.' };
      }
    } catch (err) {
      console.error('Paystack verification inside creditWallet failed:', err);
      return { success: false, message: 'Failed to verify transaction with Paystack.' };
    }
  }

  // Prevent double crediting
  if (funding.status === 'successful') {
    return { success: false, message: 'Wallet already credited for this reference.', alreadyDone: true };
  }

  // Update wallet_funding status
  await supabase
    .from('wallet_funding')
    .update({ status: 'successful' })
    .eq('id', funding.id);

  // Credit user wallet atomically via RPC
  const { data: rpcResult, error: walletError } = await supabase.rpc('credit_wallet_atomic', {
    p_user_id: funding.user_id,
    p_amount: funding.amount,
    p_paystack_reference: reference,
    p_source: 'paystack'
  });

  let newBalance = null;
  if (walletError || !rpcResult || !rpcResult.success) {
    console.error('Paystack credit wallet RPC error:', walletError);
    // Fallback: use raw update
    try {
      const wallet = await ensureWalletForUser(funding.user_id);
      newBalance = parseFloat(wallet.balance) + parseFloat(funding.amount);

      // Update wallet balance
      await supabase
        .from('wallets')
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq('id', wallet.id);

      // Insert wallet transaction
      await appendWalletTransaction(wallet.id, null, 'credit', funding.amount, newBalance, 'paystack');

      // Update users.wallet_balance
      await supabase
        .from('users')
        .update({ wallet_balance: newBalance, updated_at: new Date().toISOString() })
        .eq('id', funding.user_id);
    } catch (fallbackErr) {
      console.error('Fallback wallet update failed:', fallbackErr);
    }
  } else {
    newBalance = rpcResult.new_balance;
  }

  // Fetch user for email
  const { data: user } = await supabase
    .from('users')
    .select('full_name, email, wallet_balance')
    .eq('id', funding.user_id)
    .single();

  if (!newBalance && user) newBalance = user.wallet_balance;

  // Insert transaction record
  const txRef = `VD-TXN-${Date.now()}-${Math.floor(100000 + Math.random() * 900000)}`;
  await supabase.from('transactions').insert({
    user_id: funding.user_id,
    type: 'wallet_funding',
    amount: funding.amount,
    reference: txRef,
    paystack_reference: reference,
    status: 'successful'
  });

  // Send email notification
  if (user) {
    const firstName = user.full_name.split(' ')[0];
    const emailHtml = `
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
            .body h2 { color: #333; }
            .body p { color: #555; line-height: 1.7; }
            .amount-box { background: #f0e9ff; border-left: 4px solid #6c3de0; padding: 16px; border-radius: 4px; margin: 16px 0; }
            .amount-box span { font-size: 24px; font-weight: bold; color: #6c3de0; }
            .footer { background: #f9f9f9; padding: 20px; text-align: center; font-size: 12px; color: #999; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>VICKYDATA</h1></div>
            <div class="body">
              <h2>Wallet Funded Successfully! 🎉</h2>
              <p>Hi ${firstName},</p>
              <p>Your VICKYDATA wallet has been credited:</p>
              <div class="amount-box"><span>${formatAmount(funding.amount)}</span></div>
              <p><strong>New Wallet Balance:</strong> ${formatAmount(newBalance)}</p>
              <p><strong>Reference:</strong> ${reference}</p>
              <p>You can now use your wallet to purchase data plans and airtime.</p>
            </div>
            <div class="footer">&copy; ${new Date().getFullYear()} VICKYDATA. All rights reserved.</div>
          </div>
        </body>
      </html>
    `;
    sendMail(user.email, 'Wallet Funded Successfully', emailHtml);
  }

  return { success: true, newBalance, amount: funding.amount };
};

// POST /api/wallet/initiate-funding
const initiateFunding = async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ message: 'Amount is required.' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: 'Invalid amount.' });
    }

    const { data: setting } = await supabase
      .from('site_settings')
      .select('setting_value')
      .eq('setting_key', 'min_wallet_funding')
      .single();

    const minFunding = setting ? parseFloat(setting.setting_value) : 100;

    if (parsedAmount < minFunding) {
      return res.status(400).json({ message: `Minimum funding amount is ${formatAmount(minFunding)}.` });
    }

    const { data: pendingCountData, error: pendingCountError } = await supabase
      .from('funding_requests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('status', 'pending');

    if (pendingCountError) {
      console.error('Pending funding count error:', pendingCountError);
      return res.status(500).json({ message: 'Could not validate funding request limit.' });
    }

    if ((pendingCountData || 0) >= 5) {
      return res.status(429).json({ message: 'You already have too many pending funding requests. Please wait for review.' });
    }

    let reference = generateReferenceCode();
    let attempts = 0;
    while (attempts < 10) {
      const { data: existing } = await supabase
        .from('funding_requests')
        .select('id')
        .eq('reference_code', reference)
        .maybeSingle();
      if (!existing) break;
      reference = generateReferenceCode();
      attempts += 1;
    }

    const { data: inserted, error: insertError } = await supabase
      .from('funding_requests')
      .insert({
        user_id: req.user.id,
        reference_code: reference,
        amount_claimed: parsedAmount,
        status: 'pending',
        proof_note: null
      })
      .select('id, reference_code, amount_claimed, status')
      .single();

    if (insertError || !inserted) {
      console.error('Create funding request error:', insertError);
      return res.status(500).json({ message: 'Failed to create funding request.' });
    }

    return res.status(200).json({
      success: true,
      reference_code: inserted.reference_code,
      amount_claimed: inserted.amount_claimed,
      status: inserted.status,
      bank_details: {
        account_name: process.env.BANK_ACCOUNT_NAME || 'VICKYDATA LIMITED',
        account_number: process.env.BANK_ACCOUNT_NUMBER || '0000000000',
        bank_name: process.env.BANK_NAME || 'Access Bank'
      },
      instructions: 'Include this reference code in your transfer narration/remark.'
    });
  } catch (error) {
    console.error('Initiate funding error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// POST /api/funding-requests
const createFundingRequest = async (req, res) => {
  try {
    const { amount, proof_note } = req.body;

    if (!amount) {
      return res.status(400).json({ message: 'Amount is required.' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: 'Invalid amount.' });
    }

    const { data: setting } = await supabase
      .from('site_settings')
      .select('setting_value')
      .eq('setting_key', 'min_wallet_funding')
      .single();

    const minFunding = setting ? parseFloat(setting.setting_value) : 100;
    if (parsedAmount < minFunding) {
      return res.status(400).json({ message: `Minimum funding amount is ${formatAmount(minFunding)}.` });
    }

    const { data: pendingCountData, error: pendingCountError } = await supabase
      .from('funding_requests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('status', 'pending');

    if (pendingCountError) {
      console.error('Pending funding count error:', pendingCountError);
      return res.status(500).json({ message: 'Could not validate funding request limit.' });
    }

    if ((pendingCountData || 0) >= 5) {
      return res.status(429).json({ message: 'You already have too many pending funding requests. Please wait for review.' });
    }

    let reference = generateReferenceCode();
    let attempts = 0;
    while (attempts < 10) {
      const { data: existing } = await supabase
        .from('funding_requests')
        .select('id')
        .eq('reference_code', reference)
        .maybeSingle();
      if (!existing) break;
      reference = generateReferenceCode();
      attempts += 1;
    }

    const { data: inserted, error: insertError } = await supabase
      .from('funding_requests')
      .insert({
        user_id: req.user.id,
        reference_code: reference,
        amount_claimed: parsedAmount,
        status: 'pending',
        proof_note: proof_note || null
      })
      .select('id, reference_code, amount_claimed, status, proof_note, created_at')
      .single();

    if (insertError || !inserted) {
      console.error('Create funding request error:', insertError);
      return res.status(500).json({ message: 'Failed to create funding request.' });
    }

    return res.status(201).json({
      message: 'Funding request created successfully.',
      funding_request: inserted,
      bank_details: {
        account_name: process.env.BANK_ACCOUNT_NAME || 'VICKYDATA LIMITED',
        account_number: process.env.BANK_ACCOUNT_NUMBER || '0000000000',
        bank_name: process.env.BANK_NAME || 'Access Bank'
      },
      instructions: 'Include this reference code in your transfer narration/remark.'
    });
  } catch (error) {
    console.error('Create funding request error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

const getMyFundingRequests = async (req, res) => {
  try {
    await syncExpiredFundingRequests(req.user.id);

    let query = supabase
      .from('funding_requests')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) {
      console.error('Get my funding requests error:', error);
      return res.status(500).json({ message: 'Could not fetch funding requests.' });
    }

    const normalized = (data || []).map((request) => ({
      ...request,
      expired: isExpired(request.created_at)
    }));

    return res.status(200).json({ funding_requests: normalized });
  } catch (error) {
    console.error('Get my funding requests error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

const markFundingRequestAsSent = async (req, res) => {
  try {
    const { id } = req.params;
    const { proof_note } = req.body;

    const { data: request, error: fetchError } = await supabase
      .from('funding_requests')
      .select('id, user_id, status')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ message: 'Funding request not found.' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be marked as sent.' });
    }

    const { error: updateError } = await supabase
      .from('funding_requests')
      .update({ proof_note: proof_note || null })
      .eq('id', id);

    if (updateError) {
      console.error('Mark funding request as sent error:', updateError);
      return res.status(500).json({ message: 'Could not update funding request.' });
    }

    return res.status(200).json({ message: 'Funding request updated successfully.' });
  } catch (error) {
    console.error('Mark funding request as sent error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

const listAdminFundingRequests = async (req, res) => {
  try {
    await syncExpiredFundingRequests();

    const { status } = req.query;
    let query = supabase
      .from('funding_requests')
      .select(`
        *,
        users!user_id (id, full_name, email, phone)
      `)
      .order('created_at', { ascending: true });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      console.error('List admin funding requests error:', error);
      return res.status(500).json({ message: 'Could not fetch funding requests.' });
    }

    const normalized = (data || []).map((request) => ({
      ...request,
      expired: isExpired(request.created_at)
    }));

    return res.status(200).json({ funding_requests: normalized });
  } catch (error) {
    console.error('List admin funding requests error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

const confirmFundingRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: request, error: fetchError } = await supabase
      .from('funding_requests')
      .select('id, user_id, status, amount_claimed')
      .eq('id', id)
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ message: 'Funding request not found.' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'This funding request has already been processed.' });
    }

    let rpcResult = null;
    try {
      rpcResult = await confirmFundingWithRpc(id, req.user.id);
    } catch (rpcError) {
      console.error('Funding credit RPC error:', rpcError);
      return res.status(500).json({ message: 'Could not confirm funding request due to wallet update failure.' });
    }

    const wallet = await ensureWalletForUser(request.user_id);
    const newBalance = rpcResult?.new_balance ?? Number(wallet.balance) + Number(request.amount_claimed);

    if (rpcResult?.new_balance !== undefined || rpcResult?.wallet_id) {
      await supabase
        .from('users')
        .update({ wallet_balance: newBalance, updated_at: new Date().toISOString() })
        .eq('id', request.user_id);
    }

    return res.status(200).json({ message: 'Funding request confirmed successfully.', new_balance: newBalance });
  } catch (error) {
    console.error('Confirm funding request error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

const rejectFundingRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: 'A rejection reason is required.' });
    }

    const { data: request, error: fetchError } = await supabase
      .from('funding_requests')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ message: 'Funding request not found.' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'This funding request has already been processed.' });
    }

    const { error: updateError } = await supabase
      .from('funding_requests')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: req.user.id,
        proof_note: reason
      })
      .eq('id', id);

    if (updateError) {
      console.error('Reject funding request error:', updateError);
      return res.status(500).json({ message: 'Could not reject funding request.' });
    }

    return res.status(200).json({ message: 'Funding request rejected successfully.' });
  } catch (error) {
    console.error('Reject funding request error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// POST /api/wallet/verify-funding
const verifyFunding = async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({ message: 'Reference is required.' });
    }

    // Verify with Paystack
    const paystackRes = await axios.get(
      `${PAYSTACK_BASE}/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      }
    );

    const { status } = paystackRes.data.data;

    if (status !== 'success') {
      return res.status(400).json({ message: 'Payment not successful.' });
    }

    const result = await creditWallet(reference);

    if (!result.success) {
      if (result.alreadyDone) {
        return res.status(400).json({ message: 'Wallet already credited for this payment.' });
      }
      return res.status(400).json({ message: result.message });
    }

    const userId = req.user.id;
    const amount = result.amount;
    const newBalance = result.newBalance;

    const { data: user } = await supabase
      .from('users')
      .select('full_name, email')
      .eq('id', userId)
      .single();

    // Send admin alert (non-blocking — do not await so SMTP issues don't delay the user's response)
    if (user) {
      const safeBalance = newBalance != null
        ? parseFloat(newBalance).toLocaleString('en-NG', { minimumFractionDigits: 2 })
        : 'N/A';

      sendMail(
        process.env.MAIL_USER,
        'VICKYDATA - New Wallet Funding',
        `
        <div style="font-family: Arial, sans-serif; 
                    max-width: 600px; margin: 0 auto;">
          <h2 style="color: #00C6AE;">
            New Wallet Funding Alert
          </h2>
          <p>A user has successfully funded their wallet 
             on VICKYDATA.</p>
          <table style="width:100%; border-collapse:collapse; 
                        margin-top:16px;">
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:10px; 
                         color:#666; 
                         font-weight:600;">
                User Name
              </td>
              <td style="padding:10px;">
                ${user.full_name}
              </td>
            </tr>
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:10px; 
                         color:#666; 
                         font-weight:600;">
                Email
              </td>
              <td style="padding:10px;">
                ${user.email}
              </td>
            </tr>
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:10px; 
                         color:#666; 
                         font-weight:600;">
                Amount Funded
              </td>
              <td style="padding:10px; 
                         color:#00C6AE; 
                         font-weight:700;
                         font-size:1.1rem;">
                ₦${parseFloat(amount).toLocaleString('en-NG', {
                  minimumFractionDigits: 2
                })}
              </td>
            </tr>
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:10px; 
                         color:#666; 
                         font-weight:600;">
                Paystack Reference
              </td>
              <td style="padding:10px;">
                ${reference}
              </td>
            </tr>
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:10px; 
                         color:#666; 
                         font-weight:600;">
                New Wallet Balance
              </td>
              <td style="padding:10px;">
                ₦${safeBalance}
              </td>
            </tr>
            <tr>
              <td style="padding:10px; 
                         color:#666; 
                         font-weight:600;">
                Date
              </td>
              <td style="padding:10px;">
                ${new Date().toLocaleString('en-NG')}
              </td>
            </tr>
          </table>
          <p style="margin-top:24px; 
                    color:#666; 
                    font-size:0.85rem;">
            Log into your admin dashboard to view all 
            transactions.
          </p>
        </div>
        `
      );
    }

    return res.status(200).json({
      message: 'Wallet funded successfully.',
      new_balance: result.newBalance
    });
  } catch (error) {
    console.error('Verify funding error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

// POST /api/wallet/paystack-webhook (uses raw body for signature verification)
const paystackWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.body; // express.raw() gives Buffer

    // Verify HMAC SHA512 signature
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest('hex');

    if (hash !== signature) {
      return res.status(401).json({ message: 'Invalid webhook signature.' });
    }

    const event = JSON.parse(rawBody.toString());

    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      await creditWallet(reference);
    }

    // Always return 200 to Paystack
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Paystack webhook error:', error);
    return res.status(200).json({ received: true }); // Still 200 so Paystack doesn't retry endlessly
  }
};

// GET /api/wallet/balance
const getBalance = async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('wallet_balance')
      .eq('id', req.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.status(200).json({ balance: user.wallet_balance });
  } catch (error) {
    console.error('Get balance error:', error);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
};

module.exports = {
  initiateFunding,
  createFundingRequest,
  getMyFundingRequests,
  markFundingRequestAsSent,
  listAdminFundingRequests,
  confirmFundingRequest,
  rejectFundingRequest,
  verifyFunding,
  paystackWebhook,
  getBalance
};
