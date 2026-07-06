const axios = require('axios');

const api = axios.create({
  baseURL: process.env.MERCHANTPRO_BASE_URL,
  auth: {
    username: process.env.MERCHANTPRO_API_KEY,
    password: process.env.MERCHANTPRO_API_SECRET,
  },
});

module.exports = api;