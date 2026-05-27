require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

const app = express();

app.use(cors());
app.use(express.json());

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'giftdesign-super-secret';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

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

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  secure: false,
  requireTLS: true,
  family: 4,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
  tls: {
    rejectUnauthorized: false,
  },
});

async function sendOrderConfirmationEmail({
  to,
  name,
  orderNumber,
  items,
  total,
  deliveryMethod,
  paymentMethod,
}) {
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
    console.log('EMAIL SKIPPED: SMTP env lipsă.');
    return;
  }

  const productsHtml = items
    .map((item) => {
      const title = item.title || 'Produs';
      const quantity = item.quantity || 1;
      const price = item.price || '';

      return `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">
            ${quantity} x ${title}
          </td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">
            ${price}
          </td>
        </tr>
      `;
    })
    .join('');

  await transporter.sendMail({
    from:
      process.env.SMTP_FROM ||
      `GiftDesign <${process.env.SMTP_USER}>`,
    to,
    subject: `Confirmare comandă ${orderNumber} - GiftDesign`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5;">
        <h2 style="color: #D51F3C;">Mulțumim pentru comandă!</h2>

        <p>Salut ${name || ''},</p>

        <p>
          Comanda ta a fost primită cu succes și este în curs de procesare.
        </p>

        <p>
          <strong>Număr comandă:</strong> ${orderNumber}
        </p>

        <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
          <thead>
            <tr>
              <th style="text-align: left; padding: 8px; border-bottom: 2px solid #ddd;">
                Produs
              </th>
              <th style="text-align: right; padding: 8px; border-bottom: 2px solid #ddd;">
                Preț
              </th>
            </tr>
          </thead>
          <tbody>
            ${productsHtml}
          </tbody>
        </table>

        <p style="font-size: 16px;">
          <strong>Total:</strong> ${total} Lei
        </p>

        <p>
          <strong>Livrare:</strong> ${deliveryMethod}
          <br>
          <strong>Plată:</strong> ${paymentMethod}
        </p>

        <p>
          Te vom anunța când comanda este pregătită sau predată curierului.
        </p>

        <br>

        <p>
          Cu drag,<br>
          Echipa GiftDesign
        </p>
      </div>
    `,
  });

  console.log('EMAIL CONFIRMARE TRIMIS:', to);
}

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
      count: visibleProducts.length,
      data: visibleProducts,
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

app.post('/register', async (req, res) => {
  try {
    const name =
      (req.body.name || '').trim();

    const email =
      (req.body.email || '')
        .trim()
        .toLowerCase();

    const password =
      (req.body.password || '').trim();

    if (!name || !email || !password) {
      return res.status(400).json({
        error:
          'Completează toate câmpurile.',
      });
    }

    const existingResult = await pool.query(
      'select id from public.users where email = $1 limit 1',
      [email]
    );

    if (existingResult.rows.length > 0) {
      return res.status(409).json({
        error:
          'Există deja un cont cu acest email.',
      });
    }

    const id = crypto.randomUUID();
    const passwordHash = hashPassword(password);

    const result = await pool.query(
      `
        insert into public.users (
          id,
          name,
          email,
          password_hash
        )
        values ($1, $2, $3, $4)
        returning id, name, email, created_at
      `,
      [id, name, email, passwordHash]
    );

    const user = result.rows[0];

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

app.post('/login', async (req, res) => {
  try {
    const email =
      (req.body.email || '')
        .trim()
        .toLowerCase();

    const password =
      (req.body.password || '').trim();

    const passwordHash = hashPassword(password);

    const result = await pool.query(
      `
        select
          id,
          name,
          email,
          password_hash,
          created_at
        from public.users
        where email = $1
        limit 1
      `,
      [email]
    );

    const user = result.rows[0];

    if (!user || user.password_hash !== passwordHash) {
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

      const countResult = await pool.query(
        'select count(*)::int as count from public.orders'
      );

      const orderNumber =
        `GD-${String(
          countResult.rows[0].count + 1
        ).padStart(6, '0')}`;

      const orderId = crypto.randomUUID();

      const localOrderResult = await pool.query(
        `
          insert into public.orders (
            id,
            order_number,
            user_id,
            customer,
            items,
            total,
            delivery_method,
            payment_method,
            merchantpro_response,
            merchantpro_order_id,
            status
          )
          values (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11
          )
          returning
            id,
            order_number
        `,
        [
          orderId,
          orderNumber,
          req.user.id,
          JSON.stringify(customer),
          JSON.stringify(items),
          Number(total || 0),
          delivery_method,
          payment_method,
          JSON.stringify(mpResponse.data),
          mpResponse.data?.id?.toString() || null,
          'Trimisă în MerchantPro',
        ]
      );

      const localOrder = localOrderResult.rows[0];

      res.status(201).json({
        message:
          'Comandă trimisă în MerchantPro.',
        order_id: localOrder.id,
        order_number: localOrder.order_number,
        merchantpro:
          mpResponse.data,
      });

      sendOrderConfirmationEmail({
        to: customer.email,
        name: customer.name,
        orderNumber,
        items,
        total,
        deliveryMethod: delivery_method,
        paymentMethod: payment_method,
      }).catch((emailError) => {
        console.log(
          'EMAIL ERROR:',
          emailError.message
        );
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
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          select
            id,
            order_number,
            user_id,
            customer,
            items,
            total,
            delivery_method,
            payment_method,
            merchantpro_response,
            merchantpro_order_id,
            status,
            created_at
          from public.orders
          where user_id = $1
          order by created_at desc
        `,
        [req.user.id]
      );

      res.json({
        count: result.rows.length,
        data: result.rows,
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
  async (req, res) => {
    try {
      if (
        req.user.email !==
        'overclockmanager@gmail.com'
      ) {
        return res.status(403).json({
          error: 'Access interzis.',
        });
      }

      const result = await pool.query(
        `
          select
            id,
            order_number,
            user_id,
            customer,
            items,
            total,
            delivery_method,
            payment_method,
            merchantpro_response,
            merchantpro_order_id,
            status,
            created_at
          from public.orders
          order by created_at desc
        `
      );

      res.json({
        count: result.rows.length,
        data: result.rows,
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
  console.log(
    `Server running on port ${PORT}`
  );
});