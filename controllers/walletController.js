const crypto = require('crypto');
const axios = require('axios');
const supabase = require('../config/supabase');
const { sendMail } = require('../config/mailer');

const PAYSTACK_BASE = 'https://api.paystack.co';

// Helper: format currency
const formatAmount = (amount) => {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount);
};

// Helper: credit wallet (shared logic for verify & webhook)
const creditWallet = async (reference) => {
  // Look up the pending wallet_funding record
  const { data: funding, error: fundingError } = await supabase
    .from('wallet_funding')
    .select('id, user_id, amount, status')
    .eq('paystack_reference', reference)
    .single();

  if (fundingError || !funding) {
    return { success: false, message: 'Funding record not found.' };
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

  // Credit user wallet
  const { data: updatedUser, error: walletError } = await supabase.rpc('increment_wallet', {
    user_id_input: funding.user_id,
    amount_input: funding.amount
  }).select('wallet_balance').single();

  // Fallback if RPC not available: use raw update
  let newBalance = null;
  if (walletError) {
    // Fetch current balance then add
    const { data: currentUser } = await supabase
      .from('users')
      .select('wallet_balance')
      .eq('id', funding.user_id)
      .single();

    newBalance = parseFloat(currentUser.wallet_balance) + parseFloat(funding.amount);

    await supabase
      .from('users')
      .update({
        wallet_balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('id', funding.user_id);
  } else {
    newBalance = updatedUser ? updatedUser.wallet_balance : null;
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

    // Check min wallet funding from site_settings
    const { data: setting } = await supabase
      .from('site_settings')
      .select('setting_value')
      .eq('setting_key', 'min_wallet_funding')
      .single();

    const minFunding = setting ? parseFloat(setting.setting_value) : 100;

    if (parsedAmount < minFunding) {
      return res.status(400).json({ message: `Minimum funding amount is ${formatAmount(minFunding)}.` });
    }

    // Generate unique reference
    const reference = `VD-FUND-${Date.now()}-${Math.floor(100000 + Math.random() * 900000)}`;

    // Initialize Paystack transaction
    const paystackRes = await axios.post(
      `${PAYSTACK_BASE}/transaction/initialize`,
      {
        email: req.user.email,
        amount: Math.round(parsedAmount * 100), // Paystack uses kobo
        reference,
        callback_url: `${process.env.FRONTEND_URL}/user/dashboard.html`
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const { authorization_url } = paystackRes.data.data;

    // Insert pending wallet_funding record
    await supabase.from('wallet_funding').insert({
      user_id: req.user.id,
      amount: parsedAmount,
      paystack_reference: reference,
      status: 'pending'
    });

    return res.status(200).json({ authorization_url, reference });
  } catch (error) {
    console.error('Initiate funding error:', error);
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

    const { status, amount } = paystackRes.data.data;

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

module.exports = { initiateFunding, verifyFunding, paystackWebhook, getBalance };
