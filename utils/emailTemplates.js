const axios = require('axios');
const supabase = require('../config/supabase');
const { sendMail } = require('../config/mailer');

/**
 * Escapes HTML characters to prevent XSS in email bodies while preserving newlines
 */
const escapeHtml = (text) => {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br/>');
};

const formatNaira = (amount) => {
  return `₦${parseFloat(amount || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
};

/**
 * Master Email Layout Wrapper
 */
const getMasterEmailHtml = ({
  title,
  badgeText = '',
  badgeColor = '#00C6AE',
  badgeBg = '#E6F9F6',
  contentHtml = '',
  ctaUrl = '',
  ctaText = ''
}) => {
  const year = new Date().getFullYear();
  const ctaButtonHtml = ctaUrl && ctaText ? `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 28px auto 0 auto;">
      <tr>
        <td align="center" style="border-radius: 8px; background-color: #00C6AE;">
          <a href="${ctaUrl}" target="_blank" style="font-size: 15px; font-family: Arial, sans-serif; color: #0F172A; text-decoration: none; border-radius: 8px; padding: 14px 28px; border: 1px solid #00C6AE; display: inline-block; font-weight: bold; text-align: center;">
            ${ctaText}
          </a>
        </td>
      </tr>
    </table>
  ` : '';

  const badgeHtml = badgeText ? `
    <div style="display: inline-block; padding: 6px 14px; background-color: ${badgeBg}; color: ${badgeColor}; border-radius: 20px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 16px;">
      ${badgeText}
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || 'VICKYDATA Notification'}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1E293B; -webkit-font-smoothing: antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F8FAFC; padding: 32px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #FFFFFF; border-radius: 12px; border: 1px solid #E2E8F0; overflow: hidden; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05); margin: 0 auto;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background-color: #0F172A; padding: 28px 32px; text-align: center; border-bottom: 3px solid #00C6AE;">
              <h1 style="margin: 0; font-size: 26px; font-weight: 800; font-family: Arial, sans-serif; letter-spacing: 1px;">
                <span style="color: #00C6AE;">VICKY</span><span style="color: #FFFFFF;">DATA</span>
              </h1>
              <p style="margin: 4px 0 0 0; color: #94A3B8; font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;">INSTANT VTU & DATA PLATFORM</p>
            </td>
          </tr>

          <!-- Main Body -->
          <tr>
            <td style="padding: 36px 32px; background-color: #FFFFFF;">
              ${badgeHtml}
              ${title ? `<h2 style="margin-top: 0; margin-bottom: 18px; font-size: 22px; font-weight: 700; color: #0F172A; line-height: 1.3;">${title}</h2>` : ''}
              <div style="font-size: 15px; line-height: 1.6; color: #334155;">
                ${contentHtml}
              </div>
              ${ctaButtonHtml}
            </td>
          </tr>

          <!-- Help & Support Info Box -->
          <tr>
            <td style="padding: 0 32px 28px 32px;">
              <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px; font-size: 13px; color: #64748B; text-align: center;">
                Need assistance? Chat directly with support on WhatsApp: 
                <a href="https://wa.me/2348143905306" target="_blank" style="color: #00C6AE; font-weight: 700; text-decoration: none;">+234 814 390 5306</a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #F1F5F9; padding: 24px 32px; text-align: center; border-top: 1px solid #E2E8F0;">
              <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 600; color: #475569;">
                VICKYDATA Services — Safe, Fast & Reliable
              </p>
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #94A3B8;">
                You are receiving this official update regarding your account activity.<br/>
                &copy; ${year} VICKYDATA. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

/**
 * Renders a key-value details table for transaction summaries
 */
const renderDetailsTable = (items) => {
  const rows = items.map(item => `
    <tr style="border-bottom: 1px solid #E2E8F0;">
      <td style="padding: 12px 16px; font-size: 14px; font-weight: 600; color: #64748B; width: 45%; vertical-align: middle;">
        ${item.label}
      </td>
      <td style="padding: 12px 16px; font-size: 14px; font-weight: 700; color: ${item.highlight ? '#00C6AE' : '#0F172A'}; ${item.mono ? 'font-family: monospace; font-size: 13px;' : ''} width: 55%; vertical-align: middle; text-align: right;">
        ${item.value}
      </td>
    </tr>
  `).join('');

  return `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; margin: 20px 0; border-collapse: separate; border-spacing: 0; overflow: hidden;">
      ${rows}
    </table>
  `;
};

// 1. ANNOUNCEMENT EMAIL
const getAnnouncementEmailHtml = (message) => {
  const formattedMessage = escapeHtml(message);
  return getMasterEmailHtml({
    title: 'Important Update from VICKYDATA',
    badgeText: 'ANNOUNCEMENT',
    badgeColor: '#00C6AE',
    badgeBg: '#E6F9F6',
    contentHtml: `<div style="font-size: 15px; line-height: 1.7; color: #1E293B;">${formattedMessage}</div>`
  });
};

// 2. DATA PURCHASE SUCCESSFUL
const getDataPurchaseSuccessEmailHtml = ({ userName, planName, network, phoneNumber, amount, newBalance, reference }) => {
  const firstName = userName ? userName.split(' ')[0] : 'User';
  const table = renderDetailsTable([
    { label: 'Network', value: network || 'N/A' },
    { label: 'Data Plan', value: planName || 'N/A' },
    { label: 'Recipient Phone', value: phoneNumber || 'N/A', mono: true },
    { label: 'Amount Paid', value: formatNaira(amount) },
    { label: 'Reference Code', value: reference || 'N/A', mono: true },
    { label: 'New Wallet Balance', value: formatNaira(newBalance), highlight: true }
  ]);

  return getMasterEmailHtml({
    title: 'Data Purchase Completed',
    badgeText: 'SUCCESSFUL',
    badgeColor: '#10B981',
    badgeBg: '#D1FAE5',
    contentHtml: `
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>Your data purchase request has been completed successfully!</p>
      ${table}
      <p>Thank you for choosing VICKYDATA!</p>
    `
  });
};

// 3. DATA PURCHASE PROCESSING
const getDataPurchaseProcessingEmailHtml = ({ userName, planName, network, phoneNumber, amount, newBalance, reference }) => {
  const firstName = userName ? userName.split(' ')[0] : 'User';
  const table = renderDetailsTable([
    { label: 'Network', value: network || 'N/A' },
    { label: 'Data Plan', value: planName || 'N/A' },
    { label: 'Recipient Phone', value: phoneNumber || 'N/A', mono: true },
    { label: 'Amount Paid', value: formatNaira(amount) },
    { label: 'Reference Code', value: reference || 'N/A', mono: true },
    { label: 'Wallet Balance', value: formatNaira(newBalance), highlight: true }
  ]);

  return getMasterEmailHtml({
    title: 'Data Purchase Processing',
    badgeText: 'PROCESSING',
    badgeColor: '#F59E0B',
    badgeBg: '#FEF3C7',
    contentHtml: `
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>Your data purchase request has been submitted and is currently being processed by the provider.</p>
      ${table}
      <p>Your order will be completed shortly. Thank you for choosing VICKYDATA!</p>
    `
  });
};

// 4. DATA PURCHASE FAILED (REFUNDED)
const getDataPurchaseFailedEmailHtml = ({ userName, planName, network, phoneNumber, amount, restoredBalance, reference }) => {
  const firstName = userName ? userName.split(' ')[0] : 'User';
  const table = renderDetailsTable([
    { label: 'Network', value: network || 'N/A' },
    { label: 'Data Plan', value: planName || 'N/A' },
    { label: 'Recipient Phone', value: phoneNumber || 'N/A', mono: true },
    { label: 'Refund Amount', value: formatNaira(amount), highlight: true },
    { label: 'Reference Code', value: reference || 'N/A', mono: true },
    { label: 'Restored Wallet Balance', value: formatNaira(restoredBalance) }
  ]);

  return getMasterEmailHtml({
    title: 'Data Purchase Failed (Refunded)',
    badgeText: 'AUTOMATIC REFUND',
    badgeColor: '#EF4444',
    badgeBg: '#FEE2E2',
    contentHtml: `
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>Your data purchase attempt could not be processed by the provider.</p>
      <p><strong>Your wallet balance has been automatically refunded in full.</strong></p>
      ${table}
      <p>We apologize for the inconvenience. Please feel free to retry the transaction.</p>
    `
  });
};

// 5. AIRTIME PURCHASE SUCCESSFUL
const getAirtimePurchaseSuccessEmailHtml = ({ userName, network, phoneNumber, amount, newBalance, reference }) => {
  const firstName = userName ? userName.split(' ')[0] : 'User';
  const table = renderDetailsTable([
    { label: 'Network', value: network || 'N/A' },
    { label: 'Recipient Phone', value: phoneNumber || 'N/A', mono: true },
    { label: 'Airtime Amount', value: formatNaira(amount) },
    { label: 'Reference Code', value: reference || 'N/A', mono: true },
    { label: 'New Wallet Balance', value: formatNaira(newBalance), highlight: true }
  ]);

  return getMasterEmailHtml({
    title: 'Airtime Sent Successfully',
    badgeText: 'SUCCESSFUL',
    badgeColor: '#10B981',
    badgeBg: '#D1FAE5',
    contentHtml: `
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>Your airtime request has been delivered successfully!</p>
      ${table}
      <p>Thank you for using VICKYDATA!</p>
    `
  });
};

// 6. AIRTIME PURCHASE PROCESSING
const getAirtimePurchaseProcessingEmailHtml = ({ userName, network, phoneNumber, amount, newBalance, reference }) => {
  const firstName = userName ? userName.split(' ')[0] : 'User';
  const table = renderDetailsTable([
    { label: 'Network', value: network || 'N/A' },
    { label: 'Recipient Phone', value: phoneNumber || 'N/A', mono: true },
    { label: 'Airtime Amount', value: formatNaira(amount) },
    { label: 'Reference Code', value: reference || 'N/A', mono: true },
    { label: 'Wallet Balance', value: formatNaira(newBalance), highlight: true }
  ]);

  return getMasterEmailHtml({
    title: 'Airtime Purchase Processing',
    badgeText: 'PROCESSING',
    badgeColor: '#F59E0B',
    badgeBg: '#FEF3C7',
    contentHtml: `
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>Your airtime request has been submitted and is currently being processed by the provider.</p>
      ${table}
      <p>Your order will be completed shortly. Thank you for using VICKYDATA!</p>
    `
  });
};

// 5. AIRTIME PURCHASE FAILED (REFUNDED)
const getAirtimePurchaseFailedEmailHtml = ({ userName, network, phoneNumber, amount, restoredBalance, reference }) => {
  const firstName = userName ? userName.split(' ')[0] : 'User';
  const table = renderDetailsTable([
    { label: 'Network', value: network || 'N/A' },
    { label: 'Recipient Phone', value: phoneNumber || 'N/A', mono: true },
    { label: 'Refund Amount', value: formatNaira(amount), highlight: true },
    { label: 'Reference Code', value: reference || 'N/A', mono: true },
    { label: 'Restored Wallet Balance', value: formatNaira(restoredBalance) }
  ]);

  return getMasterEmailHtml({
    title: 'Airtime Purchase Failed (Refunded)',
    badgeText: 'AUTOMATIC REFUND',
    badgeColor: '#EF4444',
    badgeBg: '#FEE2E2',
    contentHtml: `
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>Your airtime purchase attempt could not be delivered by the provider.</p>
      <p><strong>Your wallet balance has been automatically refunded in full.</strong></p>
      ${table}
      <p>We apologize for the inconvenience. Please try again shortly.</p>
    `
  });
};

// 6. WALLET FUNDING SUCCESSFUL
const getWalletFundingSuccessEmailHtml = ({ userName, amount, newBalance, reference }) => {
  const firstName = userName ? userName.split(' ')[0] : 'User';
  const table = renderDetailsTable([
    { label: 'Amount Funded', value: formatNaira(amount), highlight: true },
    { label: 'Payment Reference', value: reference || 'N/A', mono: true },
    { label: 'New Wallet Balance', value: formatNaira(newBalance) }
  ]);

  return getMasterEmailHtml({
    title: 'Wallet Funded Successfully',
    badgeText: 'WALLET CREDITED',
    badgeColor: '#10B981',
    badgeBg: '#D1FAE5',
    contentHtml: `
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>Great news! Your VICKYDATA wallet has been credited and is ready for use.</p>
      ${table}
    `,
    ctaUrl: 'https://vickydata.netlify.app/user/dashboard.html',
    ctaText: 'Go to Dashboard'
  });
};

// 7. ADMIN REFUND ALERT
const getAdminRefundNotificationEmailHtml = ({ userName, userEmail, type, network, phoneNumber, reference, refundAmount, previousBalance, presentBalance, isManual = false }) => {
  const table = renderDetailsTable([
    { label: 'User Name', value: userName || 'N/A' },
    { label: 'User Email', value: userEmail || 'N/A' },
    { label: 'Transaction Type', value: `${type || 'N/A'} ${network ? `(${network})` : ''}` },
    { label: 'Phone Number', value: phoneNumber || 'N/A', mono: true },
    { label: 'Reference', value: reference || 'N/A', mono: true },
    { label: 'Amount Refunded', value: formatNaira(refundAmount), highlight: true },
    { label: 'Previous Balance', value: formatNaira(previousBalance) },
    { label: 'Present Balance', value: formatNaira(presentBalance) }
  ]);

  return getMasterEmailHtml({
    title: `[ADMIN ALERT] ${isManual ? 'Manual' : 'Automatic'} Refund Processed`,
    badgeText: 'ADMIN NOTIFICATION',
    badgeColor: '#F59E0B',
    badgeBg: '#FEF3C7',
    contentHtml: `
      <p>A ${isManual ? 'manual admin' : 'failed transaction automatic'} refund has been completed for a user account.</p>
      ${table}
    `
  });
};

// 8. USER MANUAL REFUND NOTIFICATION
const getUserRefundNotificationEmailHtml = ({ userName, amount, newBalance, reference }) => {
  const firstName = userName ? userName.split(' ')[0] : 'User';
  const table = renderDetailsTable([
    { label: 'Refund Amount', value: formatNaira(amount), highlight: true },
    { label: 'Reference Code', value: reference || 'N/A', mono: true },
    { label: 'New Wallet Balance', value: formatNaira(newBalance) }
  ]);

  return getMasterEmailHtml({
    title: 'Wallet Refund Credited',
    badgeText: 'REFUND CREDITED',
    badgeColor: '#10B981',
    badgeBg: '#D1FAE5',
    contentHtml: `
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>Your wallet has been refunded for a transaction.</p>
      ${table}
      <p>Thank you for using VICKYDATA!</p>
    `
  });
};

// 9. WELCOME EMAIL
const getWelcomeEmailHtml = ({ userName }) => {
  const firstName = userName ? userName.split(' ')[0] : 'User';

  return getMasterEmailHtml({
    title: `Welcome to VICKYDATA, ${firstName}!`,
    badgeText: 'WELCOME',
    badgeColor: '#00C6AE',
    badgeBg: '#E6F9F6',
    contentHtml: `
      <p>Your account has been created successfully. You can now purchase affordable data bundles and send airtime to all Nigerian networks instantly.</p>

      <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <h3 style="margin-top: 0; font-size: 16px; color: #0F172A;">What you can do on VICKYDATA:</h3>
        <ul style="color: #475569; line-height: 1.9; padding-left: 20px; margin-bottom: 0;">
          <li>Instant data top-ups for MTN, Airtel, Glo and 9mobile</li>
          <li>Direct airtime recharge to any line</li>
          <li>Instant automated wallet funding</li>
          <li>Real-time transaction tracking and receipt history</li>
        </ul>
      </div>
    `,
    ctaUrl: 'https://vickydata.netlify.app/login.html',
    ctaText: 'Login to Your Account'
  });
};

// 10. PASSWORD RESET OTP EMAIL
const getPasswordResetEmailHtml = ({ userName, token }) => {
  const firstName = userName ? userName.split(' ')[0] : 'User';

  return getMasterEmailHtml({
    title: 'Password Reset Request',
    badgeText: 'SECURITY CODE',
    badgeColor: '#6366F1',
    badgeBg: '#EEF2FF',
    contentHtml: `
      <p>Hi <strong>${firstName}</strong>,</p>
      <p>We received a request to reset your VICKYDATA account password. Use the verification code below to reset your password. This code will expire in <strong>15 minutes</strong>.</p>
      
      <div style="background-color: #F0FFFE; border: 2px dashed #00C6AE; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
        <div style="font-size: 38px; font-weight: 800; color: #00C6AE; letter-spacing: 10px; font-family: monospace;">${token}</div>
      </div>

      <p style="color: #64748B; font-size: 13px;">If you did not request a password reset, please ignore this message — your account remains completely secure.</p>
    `
  });
};

/**
 * Sends announcement email to all active users via Brevo API in background batches
 */
const sendAnnouncementEmails = async (messageText) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('email')
      .eq('is_active', true);

    if (error || !users || users.length === 0) {
      console.log('No active user emails found for announcement dispatch.');
      return;
    }

    const recipientEmails = users
      .map(u => u.email)
      .filter(email => email && email.includes('@'));

    if (recipientEmails.length === 0) {
      console.log('No valid recipient emails found.');
      return;
    }

    const htmlContent = getAnnouncementEmailHtml(messageText);
    const mailFrom = process.env.MAIL_FROM || 'VICKYDATA <oniebenezer1@gmail.com>';
    const match = mailFrom.match(/^(.*?)\s*<(.*?)>$/);
    const senderName = match ? match[1].trim() : 'VICKYDATA';
    const senderEmail = match ? match[2].trim() : 'oniebenezer1@gmail.com';
    const subject = 'Important Update from VICKYDATA';

    // If using Brevo HTTP API (starts with xkeysib)
    if (process.env.MAIL_PASS && process.env.MAIL_PASS.startsWith('xkeysib')) {
      const BATCH_SIZE = 100; // Batch into chunks of 100 messageVersions per API call
      for (let i = 0; i < recipientEmails.length; i += BATCH_SIZE) {
        const chunk = recipientEmails.slice(i, i + BATCH_SIZE);
        const messageVersions = chunk.map(email => ({
          to: [{ email }]
        }));

        try {
          await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: {
              name: senderName,
              email: senderEmail
            },
            subject,
            htmlContent,
            messageVersions
          }, {
            headers: {
              'accept': 'application/json',
              'api-key': process.env.MAIL_PASS,
              'content-type': 'application/json'
            }
          });
          console.log(`Announcement individual email batch (${chunk.length} recipients) sent via Brevo API.`);
        } catch (batchError) {
          const errMsg = batchError.response && batchError.response.data
            ? JSON.stringify(batchError.response.data)
            : batchError.message;
          console.error('Failed sending Brevo announcement batch:', errMsg);
        }
      }
    } else {
      // Fallback batch dispatch via sendMail (individual recipient per call)
      const BATCH_SIZE = 10;
      for (let i = 0; i < recipientEmails.length; i += BATCH_SIZE) {
        const chunk = recipientEmails.slice(i, i + BATCH_SIZE);
        await Promise.all(
          chunk.map(email => sendMail(email, subject, htmlContent))
        );
      }
    }
  } catch (err) {
    console.error('Error in sendAnnouncementEmails background task:', err.message);
  }
};

module.exports = {
  getMasterEmailHtml,
  getAnnouncementEmailHtml,
  getDataPurchaseSuccessEmailHtml,
  getDataPurchaseProcessingEmailHtml,
  getDataPurchaseFailedEmailHtml,
  getAirtimePurchaseSuccessEmailHtml,
  getAirtimePurchaseProcessingEmailHtml,
  getAirtimePurchaseFailedEmailHtml,
  getWalletFundingSuccessEmailHtml,
  getAdminRefundNotificationEmailHtml,
  getUserRefundNotificationEmailHtml,
  getWelcomeEmailHtml,
  getPasswordResetEmailHtml,
  sendAnnouncementEmails
};
