const axios = require('axios');

const baseURL = String(process.env.CHEAPDATAHUB_BASE_URL || '')
  .trim()
  .replace(/\/+$/g, '') + '/';

const cheapDataHub = axios.create({
  baseURL,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.CHEAPDATAHUB_API_KEY}`
  }
});

module.exports = cheapDataHub;
