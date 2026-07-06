const express = require('express');

const {
  getProducts,
  getProductsLite,
  getProductDetail,
  getCategories,
} = require('../controllers/products.controller');

const router = express.Router();

router.get('/products', getProducts);
router.get('/products-lite', getProductsLite);
router.get('/product/:id', getProductDetail);
router.get('/categories', getCategories);

module.exports = router;
