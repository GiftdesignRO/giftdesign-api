const {
  fetchAll,
  getProductById,
} = require('../services/merchantpro.service');

const {
  getProductsCache,
  setProductsCache,
  getCategoriesCache,
  setCategoriesCache,
} = require('../cache/products.cache');

function uniqueById(items) {
  const map = new Map();

  for (const item of items) {
    const id =
      item.id ||
      item.product_id ||
      item.category_id;

    if (!map.has(id)) {
      map.set(id, item);
    }
  }

  return [...map.values()];
}

function imageValue(value) {
  if (!value) return '';

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'object') {
    const keys = [
      'url',
      'path',
      'src',
      'large',
      'medium',
      'thumb',
    ];

    for (const key of keys) {
      const text =
        value[key]?.toString().trim() || '';

      if (text.startsWith('http')) {
        return text;
      }
    }
  }

  return '';
}

function mainImage(product) {
  if (Array.isArray(product.images) && product.images.length > 0) {
    const first = product.images[0];

    if (typeof first === 'string') return first;

    if (first && typeof first === 'object') {
      return imageValue(first);
    }
  }

  return imageValue(product.image_url) ||
    imageValue(product.image_url?.medium) ||
    imageValue(product.image_url?.thumb);
}

function productLite(product) {
  const image = mainImage(product);

  return {
    id: product.id || product.product_id || '',
    name: product.name || '',
    sku: product.sku || product.product_sku || '',
    price_gross: product.price_gross || product.price || product.price_net || '',
    old_price_gross:
      product.old_price_gross ||
      product.price_old_gross ||
      product.old_price ||
      product.price_old ||
      '',
    stock: product.stock || 0,
    category_name: product.category_name || '',
    image_url: {
      medium: image,
      thumb: image,
    },
    images: image ? [{ url: image }] : [],
    date_created: product.date_created || '',
    date_modified: product.date_modified || '',
  };
}

async function getProducts(req, res) {
  try {
    const cached = getProductsCache();

    if (cached) {
      console.log('PRODUCTS FROM CACHE');
      return res.json(cached);
    }

    console.log('PRODUCTS FROM MERCHANTPRO');

    const start = Date.now();
    const productsRaw = await fetchAll('products');
    const products = uniqueById(productsRaw);

    console.log(
      `MerchantPro products fetched in ${Date.now() - start} ms`
    );

    const visibleProducts = products.filter((p) => {
      const stock = Number(p.stock || 0);
      return stock > 0;
    });

    const result = {
      count: visibleProducts.length,
      data: visibleProducts,
    };

    setProductsCache(result);

    res.json(result);
  } catch (error) {
    console.log(
      error.response?.data ||
        error.message
    );

    res.status(500).json({
      error: 'Products API failed',
    });
  }
}

async function getProductsLite(req, res) {
  try {
    const cached = getProductsCache();

    if (cached) {
      console.log('PRODUCTS LITE FROM CACHE');

      return res.json({
        count: cached.count,
        data: cached.data.map(productLite),
      });
    }

    console.log('PRODUCTS LITE FROM MERCHANTPRO');

    const start = Date.now();
    const productsRaw = await fetchAll('products');
    const products = uniqueById(productsRaw);

    const visibleProducts = products.filter((p) => {
      const stock = Number(p.stock || 0);
      return stock > 0;
    });

    const result = {
      count: visibleProducts.length,
      data: visibleProducts,
    };

    setProductsCache(result);

    console.log(
      `MerchantPro products lite fetched in ${Date.now() - start} ms`
    );

    res.json({
      count: visibleProducts.length,
      data: visibleProducts.map(productLite),
    });
  } catch (error) {
    console.log(
      error.response?.data ||
        error.message
    );

    res.status(500).json({
      error: 'Products Lite API failed',
    });
  }
}

async function getProductDetail(req, res) {
  try {
    const productId = String(req.params.id || '').trim();

    if (!productId) {
      return res.status(400).json({
        error: 'ID produs lipsă.',
      });
    }

    console.log('PRODUCT DETAIL DIRECT FROM MERCHANTPRO:', productId);

    const product = await getProductById(productId);

    if (!product) {
      return res.status(404).json({
        error: 'Produsul nu a fost găsit.',
      });
    }

    res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.log(
      'PRODUCT DETAIL ERROR:',
      error.response?.data || error.message
    );

    res.status(500).json({
      error: 'Product detail API failed',
    });
  }
}

async function getCategories(req, res) {
  try {
    const cached = getCategoriesCache();

    if (cached) {
      console.log('CATEGORIES FROM CACHE');
      return res.json(cached);
    }

    console.log('CATEGORIES FROM MERCHANTPRO');

    const start = Date.now();
    const categoriesRaw = await fetchAll('categories');
    const categories = uniqueById(categoriesRaw);

    const formatted = categories.map((cat) => {
      const meta = cat.meta_fields || {};

      return {
        id:
          cat.id ||
          cat.category_id ||
          0,

        name: cat.name || '',

        parent_id:
          cat.parent_id || 0,

        menu_image:
          imageValue(cat.menu_image) ||
          imageValue(meta.menu_image),

        image_subcategory:
          imageValue(cat.image_subcategory) ||
          imageValue(meta.image_subcategory),

        menu_icon:
          imageValue(cat.menu_icon) ||
          imageValue(meta.menu_icon),
      };
    });

    console.log(
      `MerchantPro categories fetched in ${Date.now() - start} ms`
    );

    const result = {
      count: formatted.length,
      data: formatted,
    };

    setCategoriesCache(result);

    res.json(result);
  } catch (error) {
    console.log(
      error.response?.data ||
        error.message
    );

    res.status(500).json({
      error: 'Categories API failed',
    });
  }
}

module.exports = {
  getProducts,
  getProductsLite,
  getProductDetail,
  getCategories,
  productLite,
  uniqueById,
  imageValue,
};
