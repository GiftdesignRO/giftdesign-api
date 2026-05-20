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

function ensureUsersFile() {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
  }
}

function ensureOrdersFile() {
  if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2));
  }
}

function readUsers() {
  ensureUsersFile();

  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (error) {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
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
      console.log(e.response?.data || e.message);
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

app.get('/products', async (req, res) => {
  try {
    const productsRaw = await fetchAll('products');

    const products = uniqueById(productsRaw);

    const inStock = products.filter((p) => {
      const stock = Number(p.stock || 0);

      const active =
        (p.status || '')
          .toString()
          .toLowerCase() === 'active';

      return stock > 0 && active;
    });

    res.json({
      count: inStock.length,
      data: inStock,
    });
  } catch (error) {
    console.log(
      error.response?.data || error.message
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

    res.json({
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    console.log(
      error.response?.data || error.message
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
        error: 'Completează toate câmpurile.',
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

    res.status(201).json({
      message: 'Cont creat cu succes.',
      user: publicUser(user),
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

    res.json({
      message: 'Login reușit.',
      user: publicUser(user),
    });
  } catch (error) {
    console.log(error.message);

    res.status(500).json({
      error: 'Login failed',
    });
  }
});

app.post('/orders', (req, res) => {
  try {
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

    const orders = readOrders();

    const orderNumber =
  `GD-${String(orders.length + 1).padStart(6, '0')}`;

const order = {
  id: crypto.randomUUID(),

  order_number: orderNumber,

  customer,

      items,

      total,

      delivery_method,

      payment_method,

      status: 'Nouă',

      created_at:
        new Date().toISOString(),
    };

    orders.push(order);

    writeOrders(orders);

    res.status(201).json({
  message: 'Comandă salvată.',
  order_id: order.id,
  order_number: order.order_number,
});
  } catch (error) {
    console.log(error.message);

    res.status(500).json({
      error: 'Order failed',
    });
  }
});

app.get('/orders', (req, res) => {
  try {
    const orders = readOrders();

    res.json({
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    console.log(error.message);

    res.status(500).json({
      error: 'Orders fetch failed',
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  ensureUsersFile();
  ensureOrdersFile();

  console.log(
    `Server running on port ${PORT}`
  );
});