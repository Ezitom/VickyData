const axios = require('axios');

const cheapDataHub = axios.create({
  baseURL: process.env.CHEAPDATAHUB_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.CHEAPDATAHUB_API_KEY}`
  }
});

module.exports = cheapDataHub;
