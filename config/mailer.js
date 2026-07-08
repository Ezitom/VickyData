const nodemailer = require('nodemailer');
const axios = require('axios');

// Set up SMTP transporter fallback
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'smtp-relay.brevo.com',
  port: parseInt(process.env.MAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000
});

const sendMail = async (to, subject, html) => {
  try {
    const mailFrom = process.env.MAIL_FROM || 'VICKYDATA <oniebenezer1@gmail.com>';
    const match = mailFrom.match(/^(.*?)\s*<(.*?)>$/);
    const senderName = match ? match[1].trim() : 'VICKYDATA';
    const senderEmail = match ? match[2].trim() : 'oniebenezer1@gmail.com';

    // If using Brevo key, call HTTP API directly (bypasses Render SMTP port blocking on free tier)
    if (process.env.MAIL_PASS && process.env.MAIL_PASS.startsWith('xkeysib')) {
      await axios.post('https://api.brevo.com/v3/smtp/email', {
        sender: {
          name: senderName,
          email: senderEmail
        },
        to: [
          {
            email: to
          }
        ],
        subject,
        htmlContent: html
      }, {
        headers: {
          'accept': 'application/json',
          'api-key': process.env.MAIL_PASS,
          'content-type': 'application/json'
        }
      });
      console.log('Email sent successfully via Brevo API to:', to);
      return;
    }

    // SMTP Fallback
    await transporter.sendMail({
      from: mailFrom,
      to,
      subject,
      html
    });
    console.log('Email sent successfully via SMTP to:', to);
  } catch (error) {
    const errMsg = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
    console.error('Failed to send email to', to, ':', errMsg);
  }
};

module.exports = { sendMail };
