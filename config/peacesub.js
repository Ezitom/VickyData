const axios = require('axios');

const peaceSub = axios.create({
  baseURL: process.env.PEACESUB_BASE_URL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Token ${process.env.PEACESUB_API_KEY}`
  }
});

module.exports = peaceSub;
