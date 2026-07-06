let productsCache = null;
let productsCacheTime = 0;

let categoriesCache = null;
let categoriesCacheTime = 0;

const CACHE_TTL = 5 * 60 * 1000;

function getProductsCache() {
  if (
    productsCache &&
    Date.now() - productsCacheTime < CACHE_TTL
  ) {
    return productsCache;
  }

  return null;
}

function setProductsCache(value) {
  productsCache = value;
  productsCacheTime = Date.now();
}

function getCategoriesCache() {
  if (
    categoriesCache &&
    Date.now() - categoriesCacheTime < CACHE_TTL
  ) {
    return categoriesCache;
  }

  return null;
}

function setCategoriesCache(value) {
  categoriesCache = value;
  categoriesCacheTime = Date.now();
}

module.exports = {
  CACHE_TTL,
  getProductsCache,
  setProductsCache,
  getCategoriesCache,
  setCategoriesCache,
};