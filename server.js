require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

app.use(cors());
app.use(express.json());

const USERS_FILE = path.join(__dirname, 'users.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'giftdesign-super-secret';

function ensureUsersFile() {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(
      USERS_FILE,
      JSON.stringify([], null, 2)
    );
  }
}

function ensureOrdersFile() {
  if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(
      ORDERS_FILE,
      JSON.stringify([], null, 2)
    );
  }
}

function readUsers() {
  ensureUsersFile();

  try {
    return JSON.parse(
      fs.readFileSync(USERS_FILE, 'utf8')
    );
  } catch (error) {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(
    USERS_FILE,
    JSON.stringify(users, null, 2)
  );
}

function readOrders() {
  ensureOrdersFile();

  try {
    return JSON.parse(
      fs.readFileSync(ORDERS_FILE, 'utf8')
    );
  } catch (error) {
    return [];
  }
}

function writeOrders(orders) {
  fs.writeFileSync(
    ORDERS_FILE,
    JSON.stringify(orders, null, 2)
  );
}

function hashPassword(password) {
  return crypto
    .createHash('sha256')
    .update(password)
    .digest('hex');
}

function generateToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
    ts: Date.now(),
    secret: JWT_SECRET,
  };

  return Buffer.from(
    JSON.stringify(payload)
  ).toString('base64');
}

function verifyToken(token) {
  try {
    const decoded = JSON.parse(
      Buffer.from(token, 'base64').toString()
    );

    if (decoded.secret !== JWT_SECRET) {
      return null;
    }

    return decoded;
  } catch (e) {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const auth =
    req.headers.authorization || '';

  console.log('AUTH HEADER:', auth);

  const token = auth.replace('Bearer ', '');

  if (!token) {
    console.log('TOKEN MISSING');

    return res.status(401).json({
      error: 'Token lipsă.',
    });
  }

  const decoded = verifyToken(token);

  if (!decoded) {
    console.log('TOKEN INVALID');

    return res.status(401).json({
      error: 'Token invalid.',
    });
  }

  console.log('TOKEN OK:', decoded.email);

  req.user = decoded;

  next();
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    created_at: user.created_at,
  };
}

const api = axios.create({
  baseURL: process.env.MERCHANTPRO_BASE_URL,
  auth: {
    username: process.env.MERCHANTPRO_API_KEY,
    password: process.env.MERCHANTPRO_API_SECRET,
  },
});

async function fetchAll(endpoint) {
  const limit = 100;

  let start = 0;

  const all = [];

  let keepGoing = true;

  while (keepGoing) {
    const url =
      `/api/v2/${endpoint}?start=${start}&limit=${limit}`;

    console.log('FETCH:', url);

    try {
      const response = await api.get(url);

      let items = [];

      if (Array.isArray(response.data?.data)) {
        items = response.data.data;
      } else if (Array.isArray(response.data)) {
        items = response.data;
      }

      console.log(
        `FOUND ${endpoint.toUpperCase()}:`,
        items.length
      );

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
      console.log(
        e.response?.data || e.message
      );

      keepGoing = false;
    }
  }

  return all;
}

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

function parsePrice(value) {
  return Number(
    value
      .toString()
      .replace('Lei', '')
      .replace(',', '.')
      .replace(/[^0-9.]/g, '')
      .trim()
  ) || 0;
}

app.get('/products', async (req, res) => {
  try {
    const productsRaw =
      await fetchAll('products');

    const products =
      uniqueById(productsRaw);

    const visibleProducts = products.filter((p) => {
      const stock = Number(p.stock || 0);
      return stock > 0;
    });

    res.json({
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.log(
      error.response?.data ||
        error.message
    );

    res.status(500).json({
      error: 'Products API failed',
    });
  }
});

app.get('/categories', async (req, res) => {
  try {
    const categoriesRaw =
      await fetchAll('categories');

    const categories =
      uniqueById(categoriesRaw);

    const formatted = categories.map(
      (cat) => {
        const meta =
          cat.meta_fields || {};

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
            imageValue(
              cat.image_subcategory
            ) ||
            imageValue(
              meta.image_subcategory
            ),

          menu_icon:
            imageValue(cat.menu_icon) ||
            imageValue(meta.menu_icon),
        };
      }
    );

    res.json({
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    console.log(
      error.response?.data ||
        error.message
    );

    res.status(500).json({
      error: 'Categories API failed',
    });
  }
});

app.post('/register', (req, res) => {
  try {
    const name =
      (req.body.name || '').trim();

    const email =
      (req.body.email || '')
        .trim()
        .toLowerCase();

    const password =
      req.body.password || '';

    if (!name || !email || !password) {
      return res.status(400).json({
        error:
          'Completează toate câmpurile.',
      });
    }

    const users = readUsers();

    const existing = users.find(
      (user) => user.email === email
    );

    if (existing) {
      return res.status(409).json({
        error:
          'Există deja un cont cu acest email.',
      });
    }

    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      password_hash:
        hashPassword(password),
      created_at:
        new Date().toISOString(),
    };

    users.push(user);

    writeUsers(users);

    const token =
      generateToken(user);

    res.status(201).json({
      message:
        'Cont creat cu succes.',
      token,
      user: {
        ...publicUser(user),
        token,
      },
    });
  } catch (error) {
    console.log(error.message);

    res.status(500).json({
      error: 'Register failed',
    });
  }
});

app.post('/login', (req, res) => {
  try {
    const email =
      (req.body.email || '')
        .trim()
        .toLowerCase();

    const password =
      req.body.password || '';

    const users = readUsers();

    const user = users.find(
      (item) =>
        item.email === email &&
        item.password_hash ===
          hashPassword(password)
    );

    if (!user) {
      return res.status(401).json({
        error:
          'Email sau parolă greșită.',
      });
    }

    const token =
      generateToken(user);

    res.json({
      message: 'Login reușit.',
      token,
      user: {
        ...publicUser(user),
        token,
      },
    });
  } catch (error) {
    console.log(error.message);

    res.status(500).json({
      error: 'Login failed',
    });
  }
});

app.post(
  '/orders',
  authMiddleware,
  async (req, res) => {
    try {
      console.log(
        'ORDER BODY:',
        JSON.stringify(req.body, null, 2)
      );

      const {
        customer,
        items,
        total,
        delivery_method,
        payment_method,
      } = req.body;

      if (
        !customer ||
        !items ||
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return res.status(400).json({
          error: 'Date comandă invalide.',
        });
      }

      const lineItems = items.map((item) => {
        const price = parsePrice(item.price);
        const quantity = Number(item.quantity || 1);
        const subtotal = price * quantity;

        return {
          item_type: 'product',
          product_id: 0,
          product_sku: item.sku || null,
          product_ean: null,
          product_name: item.title,
          product_tax_name: 'TVA',
          product_tax_percent: 19,
          quantity,
          unit_price_net: Number((price / 1.19).toFixed(2)),
          unit_tax_amount: Number((price - price / 1.19).toFixed(2)),
          unit_price_gross: price,
          line_subtotal_net: Number((subtotal / 1.19).toFixed(2)),
          line_tax_amount: Number((subtotal - subtotal / 1.19).toFixed(2)),
          line_subtotal_gross: subtotal,
          meta_fields: {
            source: 'GiftDesign Mobile App',
          },
        };
      });

      const paymentMethodCode =
        payment_method === 'Card online'
          ? 'mobilpay'
          : 'cash_delivery';

      const merchantPayload = {
        payment_status: 'awaiting',
        payment_method_code: paymentMethodCode,
        shipping_status: 'awaiting',
        shipping_method_id: 0,
        shipping_amount: null,

        customer_email: customer.email,
        customer_device: 'mobile',
        customer_note:
          `Comandă din aplicația mobilă GiftDesign. ` +
          `Livrare: ${delivery_method}. Plată: ${payment_method}.`,

        billing_type: 'individual',
        billing_name: customer.name,
        billing_country_code: 'RO',
        billing_country_name: 'România',
        billing_state: customer.county || '',
        billing_city: customer.city || '',
        billing_address: customer.address || '',
        billing_postal_code: '',
        billing_phone: customer.phone || '',

        shipping_name: customer.name,
        shipping_country_code: 'RO',
        shipping_country_name: 'România',
        shipping_state: customer.county || '',
        shipping_city: customer.city || '',
        shipping_address: customer.address || '',
        shipping_postal_code: '',
        shipping_phone: customer.phone || '',

        line_items: lineItems,
      };

      console.log(
        'SEND ORDER TO MERCHANTPRO:',
        JSON.stringify(
          merchantPayload,
          null,
          2
        )
      );

      const mpResponse =
        await api.post(
          '/api/v2/orders',
          merchantPayload
        );

      console.log(
        'MERCHANTPRO RESPONSE:',
        mpResponse.data
      );

      const orders = readOrders();

      const orderNumber =
        `GD-${String(
          orders.length + 1
        ).padStart(6, '0')}`;

      const localOrder = {
        id: crypto.randomUUID(),
        order_number: orderNumber,
        user_id: req.user.id,
        customer,
        items,
        total,
        delivery_method,
        payment_method,
        merchantpro_response: mpResponse.data,
        merchantpro_order_id:
          mpResponse.data?.id || null,
        status: 'Trimisă în MerchantPro',
        created_at:
          new Date().toISOString(),
      };

      orders.push(localOrder);

      writeOrders(orders);

      res.status(201).json({
        message:
          'Comandă trimisă în MerchantPro.',
        order_id: localOrder.id,
        order_number: localOrder.order_number,
        merchantpro:
          mpResponse.data,
      });
    } catch (error) {
      console.log(
        'ORDER ERROR FULL:'
      );

      console.log({
        status:
          error.response?.status,
        data:
          error.response?.data,
        message:
          error.message,
      });

      res.status(500).json({
        error:
          error.response?.data ||
          'Order failed',
      });
    }
  }
);

app.get(
  '/orders',
  authMiddleware,
  (req, res) => {
    try {
      const orders = readOrders();

      const mine = orders.filter(
        (o) =>
          o.user_id === req.user.id
      );

      res.json({
        count: mine.length,
        data: mine,
      });
    } catch (error) {
      console.log(error.message);

      res.status(500).json({
        error:
          'Orders fetch failed',
      });
    }
  }
);

app.get(
  '/admin/orders',
  authMiddleware,
  (req, res) => {
    try {
      if (
        req.user.email !==
        'overclockmanager@gmail.com'
      ) {
        return res.status(403).json({
          error: 'Access interzis.',
        });
      }

      const orders = readOrders();

      res.json({
        count: orders.length,
        data: orders,
      });
    } catch (error) {
      console.log(error.message);

      res.status(500).json({
        error:
          'Orders fetch failed',
      });
    }
  }
);

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  ensureUsersFile();
  ensureOrdersFile();

  console.log(
    `Server running on port ${PORT}`
  );
});