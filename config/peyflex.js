const axios = require('axios');

const peyflex = axios.create({
  baseURL: process.env.PEYFLEX_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Token ${process.env.PEYFLEX_API_KEY}`
  }
});

module.exports = peyflex;
