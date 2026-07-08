const axios = require('axios');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const { sendMail } = require('../config/mailer');

const PAYSTACK_BASE = 'https://api.paystack.co';

const formatAmount = (amount) => {
  return `N${parseFloat(amount).toLocaleString('en-NG', {
    minimumFractionDigits: 2
  })}`;
};

const updateUserBalance = async (userId, amount) => {
  let retries = 5;
  while (retries > 0) {
    const { data: user, error: fetchErr } = await supabase
      .from('users')
      .select('wallet_balance, updated_at')
      .eq('id', userId)
      .single();

    if (fetchErr || !user) {
      throw new Error(fetchErr ? fetchErr.message : 'User not found');
    }

    const currentBalance = parseFloat(user.wallet_balance || 0);
    const newBalance = currentBalance + parseFloat(amount);

    if (newBalance < 0) {
      throw new Error('Insufficient wallet balance.');
    }

    const { data: updatedRows, error: updateErr } = await supabase
      .from('users')
      .update({
        wallet_balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .eq('updated_at', user.updated_at)
      .select('wallet_balance');

    if (updateErr) {
      retries--;
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
      continue;
    }

    if (updatedRows && updatedRows.length > 0) {
      return {
        balanceBefore: currentBalance,
        balanceAfter: parseFloat(updatedRows[0].wallet_balance)
      };
    } else {
      retries--;
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
    }
  }
  throw new Error('Failed to update wallet balance due to concurrent updates.');
};

const creditWallet = async (reference) => {
  try {
    // Find the pending wallet_funding record
    let { data: funding } = await supabase
      .from('wallet_funding')
      .select('id, user_id, amount, status')
      .eq('paystack_reference', reference)
      .maybeSingle();

    // If not found create it from Paystack data
    if (!funding) {
      try {
        const paystackRes = await axios.get(
          `${PAYSTACK_BASE}/transaction/verify/${reference}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
            }
          }
        );

        if (paystackRes.data?.data?.status === 'success') {
          const txData = paystackRes.data.data;
          const amount = txData.amount / 100;
          const user_id = txData.metadata?.user_id;

          if (!user_id) {
            return { 
              success: false, 
              message: 'User ID missing in transaction metadata.' 
            };
          }

          const { data: newFunding, error: insertError } = 
            await supabase
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
            console.error(
              'Auto-create wallet funding error:', 
              insertError
            );
            return { 
              success: false, 
              message: 'Could not initialize funding record.' 
            };
          }

          funding = newFunding;
        } else {
          return { 
            success: false, 
            message: 'Transaction not successful on Paystack.' 
          };
        }
      } catch (err) {
        console.error('Paystack verify in creditWallet:', err);
        return { 
          success: false, 
          message: 'Failed to verify transaction with Paystack.' 
        };
      }
    }

    // Prevent double crediting
    if (funding.status === 'successful') {
      return { 
        success: false, 
        message: 'Wallet already credited.', 
        alreadyDone: true 
      };
    }

    // Fetch user details for email
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('full_name, email')
      .eq('id', funding.user_id)
      .single();

    if (userError || !user) {
      return { 
        success: false, 
        message: 'User not found.' 
      };
    }

    const fundingAmount = parseFloat(funding.amount);
    let balanceResult;
    try {
      balanceResult = await updateUserBalance(funding.user_id, fundingAmount);
    } catch (updateErr) {
      console.error('Wallet update error:', updateErr);
      return { 
        success: false, 
        message: updateErr.message || 'Could not update wallet balance.' 
      };
    }

    const newBalance = balanceResult.balanceAfter;

    // Mark wallet_funding as successful AFTER 
    // wallet is credited
    await supabase
      .from('wallet_funding')
      .update({
        status: 'successful',
        balance_before: balanceResult.balanceBefore,
        balance_after: balanceResult.balanceAfter
      })
      .eq('id', funding.id);

    // Insert transaction record
    const txRef = `VD-TXN-${Date.now()}-${Math.floor(
      100000 + Math.random() * 900000
    )}`;

    await supabase.from('transactions').insert({
      user_id: funding.user_id,
      type: 'wallet_funding',
      amount: fundingAmount,
      reference: txRef,
      paystack_reference: reference,
      status: 'successful',
      balance_before: balanceResult.balanceBefore,
      balance_after: balanceResult.balanceAfter
    });

    // Send email to user (non-blocking)
    try {
      sendMail(
        user.email,
        'Wallet Funded Successfully - VICKYDATA',
        `
        <div style="font-family:Arial,sans-serif;
                    max-width:600px;margin:0 auto;">
          <div style="background:#0D0D0D;padding:24px;
                      text-align:center;
                      border-radius:12px 12px 0 0;">
            <h1 style="color:#00C6AE;margin:0;
                       letter-spacing:2px;">
              VICKY<span style="color:#fff;">DATA</span>
            </h1>
          </div>
          <div style="background:#fff;padding:32px;
                      border-radius:0 0 12px 12px;
                      border:1px solid #eee;">
            <h2 style="color:#111;margin-top:0;">
              Wallet Funded Successfully!
            </h2>
            <p style="color:#555;">
              Hi ${user.full_name.split(' ')[0]},
            </p>
            <p style="color:#555;">
              Your VICKYDATA wallet has been credited.
            </p>
            <div style="background:#f5f5f5;
                        border-radius:8px;
                        padding:20px;margin:16px 0;">
              <p style="margin:0 0 8px;color:#666;">
                Amount Funded
              </p>
              <p style="margin:0;font-size:1.5rem;
                        font-weight:700;color:#00C6AE;">
                ${formatAmount(fundingAmount)}
              </p>
            </div>
            <p style="color:#555;">
              <strong>New Balance:</strong> 
              ${formatAmount(newBalance)}
            </p>
            <p style="color:#555;">
              <strong>Reference:</strong> ${reference}
            </p>
            <a href="${process.env.FRONTEND_URL}/user/dashboard.html"
               style="display:block;background:#00C6AE;
                      color:#0D0D0D;text-decoration:none;
                      padding:14px 24px;border-radius:8px;
                      text-align:center;font-weight:700;
                      margin-top:24px;">
              Go to Dashboard
            </a>
          </div>
        </div>
        `
      );
    } catch (mailErr) {
      console.error('Wallet funded email failed:', mailErr.message);
    }

    return { 
      success: true, 
      newBalance, 
      amount: fundingAmount 
    };

  } catch (error) {
    console.error('creditWallet error:', error);
    return { 
      success: false, 
      message: 'Wallet credit failed.' 
    };
  }
};

// POST /api/wallet/initiate-funding
const initiateFunding = async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ 
        message: 'Amount is required.' 
      });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ 
        message: 'Invalid amount.' 
      });
    }

    const { data: setting } = await supabase
      .from('site_settings')
      .select('setting_value')
      .eq('setting_key', 'min_wallet_funding')
      .single();

    const minFunding = setting ? 
      parseFloat(setting.setting_value) : 100;

    if (parsedAmount < minFunding) {
      return res.status(400).json({
        message: `Minimum funding amount is 
          ${formatAmount(minFunding)}.`
      });
    }

    const reference = 'VD-' + Date.now() + '-' + 
      Math.floor(Math.random() * 1000000);

    const { error: insertError } = await supabase
      .from('wallet_funding')
      .insert({
        user_id: req.user.id,
        amount: parsedAmount,
        paystack_reference: reference,
        status: 'pending'
      });

    if (insertError) {
      console.error(
        'Pre-create wallet_funding error:', 
        insertError
      );
      return res.status(500).json({
        message: 'Could not initialize payment. Try again.'
      });
    }

    const paystackRes = await axios.post(
      `${PAYSTACK_BASE}/transaction/initialize`,
      {
        email: req.user.email,
        amount: Math.round(parsedAmount * 100),
        reference,
        callback_url: `${process.env.FRONTEND_URL}/user/dashboard.html`,
        metadata: { user_id: req.user.id }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const { authorization_url, access_code } = 
      paystackRes.data.data;

    return res.status(200).json({
      success: true,
      authorization_url,
      access_code,
      reference
    });

  } catch (error) {
    console.error(
      'Initiate funding error:', 
      error?.response?.data || error.message
    );
    return res.status(500).json({
      message: 'Could not initiate payment. Try again.'
    });
  }
};

// POST /api/wallet/verify-funding
const verifyFunding = async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({ 
        message: 'Reference is required.' 
      });
    }

    // Verify with Paystack first
    const paystackRes = await axios.get(
      `${PAYSTACK_BASE}/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const { status } = paystackRes.data.data;

    if (status !== 'success') {
      await supabase
        .from('wallet_funding')
        .update({ status: 'failed' })
        .eq('paystack_reference', reference);

      return res.status(400).json({ 
        message: 'Payment not successful on Paystack.' 
      });
    }

    const result = await creditWallet(reference);

    if (!result.success) {
      if (result.alreadyDone) {
        return res.status(200).json({
          message: 'Wallet already credited for this payment.',
          new_balance: result.newBalance
        });
      }
      return res.status(400).json({ 
        message: result.message 
      });
    }

    // Send admin notification (non-blocking)
    const { data: user } = await supabase
      .from('users')
      .select('full_name, email')
      .eq('id', req.user.id)
      .single();

    if (user) {
      try {
        sendMail(
          process.env.MAIL_USER,
          'VICKYDATA - New Wallet Funding Alert',
          `
          <div style="font-family:Arial,sans-serif;
                      max-width:600px;margin:0 auto;">
            <h2 style="color:#00C6AE;">
              New Wallet Funding Alert
            </h2>
            <p>A user has funded their wallet.</p>
            <table style="width:100%;
                          border-collapse:collapse;">
              <tr style="border-bottom:1px solid #eee;">
                <td style="padding:10px;color:#666;
                           font-weight:600;">
                  User
                </td>
                <td style="padding:10px;">
                  ${user.full_name}
                </td>
              </tr>
              <tr style="border-bottom:1px solid #eee;">
                <td style="padding:10px;color:#666;
                           font-weight:600;">
                  Email
                </td>
                <td style="padding:10px;">
                  ${user.email}
                </td>
              </tr>
              <tr style="border-bottom:1px solid #eee;">
                <td style="padding:10px;color:#666;
                           font-weight:600;">
                  Amount
                </td>
                <td style="padding:10px;color:#00C6AE;
                           font-weight:700;">
                  ${formatAmount(result.amount)}
                </td>
              </tr>
              <tr style="border-bottom:1px solid #eee;">
                <td style="padding:10px;color:#666;
                           font-weight:600;">
                  New Balance
                </td>
                <td style="padding:10px;">
                  ${formatAmount(result.newBalance)}
                </td>
              </tr>
              <tr>
                <td style="padding:10px;color:#666;
                           font-weight:600;">
                  Reference
                </td>
                <td style="padding:10px;">
                  ${reference}
                </td>
              </tr>
            </table>
          </div>
          `
        );
      } catch (mailErr) {
        console.error('Wallet funding alert email failed:', mailErr.message);
      }
    }

    return res.status(200).json({
      message: 'Wallet funded successfully.',
      new_balance: result.newBalance
    });

  } catch (error) {
    console.error('Verify funding error:', error);
    if (req.body.reference) {
      try {
        await supabase
          .from('wallet_funding')
          .update({ status: 'failed' })
          .eq('paystack_reference', req.body.reference);
      } catch (err) {
        console.error('Failed to update abandoned status to failed:', err.message);
      }
    }
    return res.status(500).json({ 
      message: 'Something went wrong. Please try again.' 
    });
  }
};

// POST /api/wallet/paystack-webhook
const paystackWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.body;

    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest('hex');

    if (hash !== signature) {
      return res.status(401).json({ 
        message: 'Invalid webhook signature.' 
      });
    }

    const event = JSON.parse(rawBody.toString());

    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      console.log('Webhook: crediting wallet for', reference);
      await creditWallet(reference);
      console.log('Webhook: wallet credited for', reference);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Paystack webhook error:', error);
    return res.status(200).json({ received: true });
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
      return res.status(404).json({ 
        message: 'User not found.' 
      });
    }

    return res.status(200).json({ 
      balance: user.wallet_balance 
    });

  } catch (error) {
    console.error('Get balance error:', error);
    return res.status(500).json({ 
      message: 'Something went wrong.' 
    });
  }
};

module.exports = {
  initiateFunding,
  verifyFunding,
  paystackWebhook,
  getBalance,
  updateUserBalance
};
