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

/**
 * Generates standalone, inline-styled table-based HTML email for announcements
 */
const getAnnouncementEmailHtml = (message) => {
  const formattedMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Update from VICKYDATA</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: Arial, Helvetica, sans-serif; color: #1E293B;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F8FAFC; padding: 24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; width: 100%; background-color: #FFFFFF; border-radius: 8px; border: 1px solid #E2E8F0; overflow: hidden; margin: 0 auto;">
          <!-- Header -->
          <tr>
            <td style="background-color: #0F172A; padding: 24px 32px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: bold; font-family: Arial, Helvetica, sans-serif; text-transform: uppercase;">
                <span style="color: #00C6AE;">VICKY</span><span style="color: #FFFFFF;">DATA</span>
              </h1>
            </td>
          </tr>
          <!-- Main Body -->
          <tr>
            <td style="padding: 32px; background-color: #FFFFFF;">
              <h2 style="margin-top: 0; margin-bottom: 20px; font-size: 20px; font-weight: 600; color: #0F172A; font-family: Arial, Helvetica, sans-serif;">
                Update from VICKYDATA
              </h2>
              <div style="font-size: 16px; line-height: 1.6; color: #1E293B; font-family: Arial, Helvetica, sans-serif; margin-bottom: 24px;">
                ${formattedMessage}
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #F1F5F9; padding: 20px 32px; text-align: center; border-top: 1px solid #E2E8F0;">
              <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #64748B; font-family: Arial, Helvetica, sans-serif;">
                You are receiving this email because you are a registered user of VICKYDATA. This is an official service update.
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
    const subject = 'Update from VICKYDATA';

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
  getAnnouncementEmailHtml,
  sendAnnouncementEmails
};
