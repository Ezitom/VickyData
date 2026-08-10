const supabase = require('../config/supabase');
const { sendMail } = require('../config/mailer');
const { updateUserBalance } = require('./walletController');
const {
  getDataPurchaseSuccessEmailHtml,
  getDataPurchaseFailedEmailHtml,
  getAirtimePurchaseSuccessEmailHtml,
  getAirtimePurchaseFailedEmailHtml,
  getAdminRefundNotificationEmailHtml
} = require('../utils/emailTemplates');

/**
 * Webhook receiver endpoint for PeaceSub status updates
 * POST /api/webhooks/peacesub
 */
const handlePeaceSubWebhook = async (req, res) => {
  // TODO: Implement signature verification once PeaceSub documents their webhook signing mechanism.

  // 1. Immediately log full raw request body and headers to console, unmodified
  console.log('PEACESUB WEBHOOK RAW BODY:', JSON.stringify(req.body, null, 2));
  console.log('PEACESUB WEBHOOK RAW HEADERS:', JSON.stringify(req.headers, null, 2));

  // 2. Respond HTTP 200 immediately after logging, before any database work
  res.status(200).json({ status: 'success', message: 'Webhook received' });

  // 3. Process transaction status reconciliation asynchronously after sending HTTP 200
  try {
    const payload = req.body || {};

    // Extract potential identifier fields present in the payload
    const providerRefCandidates = [
      payload.ident,
      payload.id,
      payload.order_id,
      payload.reference,
      payload.ident_id,
      payload.data?.ident,
      payload.data?.id,
      payload.data?.order_id,
      payload.data?.reference
    ].filter(Boolean).map(v => String(v));

    if (providerRefCandidates.length === 0) {
      console.warn('PEACESUB WEBHOOK WARNING: No identifier fields found in webhook payload.');
      return;
    }

    // Extract potential status string from payload
    const rawStatus = String(
      payload.status ||
      payload.Status ||
      payload.order_status ||
      payload.data?.status ||
      payload.data?.Status ||
      ''
    ).toLowerCase();

    console.log(`PEACESUB WEBHOOK: Searching for processing transaction. Identifier candidates: [${providerRefCandidates.join(', ')}], Payload status: "${rawStatus}"`);

    // Fetch transactions currently in 'processing' status
    const { data: txns, error: fetchErr } = await supabase
      .from('transactions')
      .select('*, users(*)')
      .eq('status', 'processing');

    if (fetchErr) {
      console.error('PEACESUB WEBHOOK DB FETCH ERROR:', fetchErr.message);
      return;
    }

    if (!txns || txns.length === 0) {
      console.warn('PEACESUB WEBHOOK WARNING: No transactions currently in "processing" status.');
      return;
    }

    // Match transaction where provider_reference or reference matches any of providerRefCandidates
    const txn = txns.find(t => 
      (t.provider_reference && providerRefCandidates.includes(String(t.provider_reference))) ||
      (t.reference && providerRefCandidates.includes(String(t.reference)))
    );

    if (!txn) {
      console.warn(`PEACESUB WEBHOOK WARNING: No transaction in "processing" status matched candidates [${providerRefCandidates.join(', ')}]. Taking no action.`);
      return;
    }

    // Double-check status is strictly 'processing' to prevent overwriting an already-final status
    if (txn.status !== 'processing') {
      console.warn(`PEACESUB WEBHOOK WARNING: Transaction ${txn.reference} is currently in status "${txn.status}" (not "processing"). Overwrite skipped.`);
      return;
    }

    const isSuccess = ['success', 'successful', 'true', '1', 'ok', 'delivered', 'completed'].includes(rawStatus);
    const isFailure = ['failed', 'failure', 'cancelled', 'refunded', 'rejected'].includes(rawStatus);

    if (isSuccess) {
      console.log(`PEACESUB WEBHOOK: Transitioning transaction ${txn.reference} from "processing" to "successful".`);

      // 4. Update transaction status to 'successful' (no wallet changes - already debited)
      const { error: updateErr } = await supabase
        .from('transactions')
        .update({ status: 'successful' })
        .eq('id', txn.id);

      if (updateErr) {
        console.error('PEACESUB WEBHOOK UPDATE ERROR:', updateErr.message);
        return;
      }

      // Dispatch success notification email
      const user = txn.users;
      if (user && user.email) {
        try {
          let emailHtml;
          if (txn.type === 'data') {
            emailHtml = getDataPurchaseSuccessEmailHtml({
              userName: user.full_name,
              planName: `Data Plan (${txn.network || 'Data'})`,
              network: txn.network,
              phoneNumber: txn.phone_number,
              amount: txn.amount,
              newBalance: user.wallet_balance,
              reference: txn.reference
            });
          } else {
            emailHtml = getAirtimePurchaseSuccessEmailHtml({
              userName: user.full_name,
              network: txn.network,
              phoneNumber: txn.phone_number,
              amount: txn.amount,
              newBalance: user.wallet_balance,
              reference: txn.reference
            });
          }

          sendMail(
            user.email,
            `${txn.type === 'data' ? 'Data' : 'Airtime'} Purchase Successful - VICKYDATA`,
            emailHtml
          );
        } catch (mailErr) {
          console.error('PEACESUB WEBHOOK MAIL ERROR:', mailErr.message);
        }
      }

    } else if (isFailure) {
      console.log(`PEACESUB WEBHOOK: Transitioning transaction ${txn.reference} from "processing" to "failed" and crediting wallet refund.`);

      // 5. Refund wallet and update transaction status to 'failed'
      const refundAmount = parseFloat(txn.amount);
      const refundResult = await updateUserBalance(txn.user_id, refundAmount);

      const { error: updateErr } = await supabase
        .from('transactions')
        .update({
          status: 'failed',
          balance_after: refundResult.balanceAfter
        })
        .eq('id', txn.id);

      if (updateErr) {
        console.error('PEACESUB WEBHOOK UPDATE ERROR:', updateErr.message);
        return;
      }

      // Dispatch failure/refund notification email
      const user = txn.users;
      if (user && user.email) {
        try {
          let emailHtml;
          if (txn.type === 'data') {
            emailHtml = getDataPurchaseFailedEmailHtml({
              userName: user.full_name,
              planName: `Data Plan (${txn.network || 'Data'})`,
              network: txn.network,
              phoneNumber: txn.phone_number,
              amount: txn.amount,
              restoredBalance: refundResult.balanceAfter,
              reference: txn.reference
            });
          } else {
            emailHtml = getAirtimePurchaseFailedEmailHtml({
              userName: user.full_name,
              network: txn.network,
              phoneNumber: txn.phone_number,
              amount: txn.amount,
              restoredBalance: refundResult.balanceAfter,
              reference: txn.reference
            });
          }

          sendMail(
            user.email,
            `${txn.type === 'data' ? 'Data' : 'Airtime'} Purchase Failed (Refunded) - VICKYDATA`,
            emailHtml
          );

          // Dispatch admin refund notification email
          const adminEmailHtml = getAdminRefundNotificationEmailHtml({
            userName: user.full_name,
            userEmail: user.email,
            type: txn.type,
            network: txn.network,
            phoneNumber: txn.phone_number,
            reference: txn.reference,
            refundAmount: refundAmount,
            previousBalance: refundResult.balanceBefore,
            presentBalance: refundResult.balanceAfter,
            isManual: false
          });
          sendMail(
            process.env.ADMIN_ALERT_EMAIL || 'oniebenezer1@gmail.com',
            `[ADMIN ALERT] PeaceSub Webhook Refund - ${txn.reference}`,
            adminEmailHtml
          );
        } catch (mailErr) {
          console.error('PEACESUB WEBHOOK MAIL ERROR:', mailErr.message);
        }
      }

    } else {
      console.warn(`PEACESUB WEBHOOK WARNING: Unrecognized status "${rawStatus}" for transaction ${txn.reference}. Taking no action.`);
    }

  } catch (err) {
    console.error('PEACESUB WEBHOOK PROCESSING ERROR:', err.message);
  }
};

module.exports = {
  handlePeaceSubWebhook
};
