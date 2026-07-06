const api = require('../config/merchantpro');

async function fetchAll(endpoint) {
  const limit = 100;
  let start = 0;
  const all = [];
  let keepGoing = true;

  while (keepGoing) {
    const url = `/api/v2/${endpoint}?start=${start}&limit=${limit}`;
    console.log('FETCH:', url);

    try {
      const response = await api.get(url);

      let items = [];

      if (Array.isArray(response.data?.data)) {
        items = response.data.data;
      } else if (Array.isArray(response.data)) {
        items = response.data;
      }

      console.log(`FOUND ${endpoint.toUpperCase()}:`, items.length);

      if (items.length === 0) {
        keepGoing = false;
        break;
      }

      all.push(...items);

      if (items.length < limit) {
        keepGoing = false;
      } else {
        start += limit;
      }
    } catch (e) {
      console.log(e.response?.data || e.message);
      keepGoing = false;
    }
  }

  return all;
}

async function getProductById(productId) {
  const response = await api.get(`/api/v2/products/${productId}`);
  return response.data?.data || response.data;
}

module.exports = {
  fetchAll,
  getProductById,
};