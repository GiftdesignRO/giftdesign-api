require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');
const dns = require('dns');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    role: user.role || 'user',
  };
}

const api = axios.create({
  baseURL: process.env.MERCHANTPRO_BASE_URL,
  auth: {
    username: process.env.MERCHANTPRO_API_KEY,
    password: process.env.MERCHANTPRO_API_SECRET,
  },
});

const smtpPort = Number(process.env.SMTP_PORT || 587);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpPort === 465,
  requireTLS: smtpPort === 587,
  family: 4,
  lookup: (hostname, options, callback) => {
  return dns.lookup(hostname, { family: 4 }, callback);
},
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
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
  if (!process.env.BREVO_API_KEY) {
  console.log('EMAIL SKIPPED: BREVO_API_KEY lipsă.');
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
    const shippingAmount =
  deliveryMethod === 'Curier rapid' && Number(total || 0) < 400
    ? 24.9
    : 0;

const productsSubtotal =
  Number(total || 0) - shippingAmount;

  const fromEmail =
  process.env.SMTP_FROM_EMAIL || 'info@giftdesign.ro';

const fromName =
  process.env.SMTP_FROM_NAME || 'GiftDesign';

await axios.post(
  'https://api.brevo.com/v3/smtp/email',
  {
    sender: {
      name: fromName,
      email: fromEmail,
    },
    to: [
      {
        email: to,
        name: name || '',
      },
    ],
    subject: `Confirmare comandă ${orderNumber} - GiftDesign`,
    htmlContent: `
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

        
          <p style="font-size: 15px;">
  <strong>Subtotal produse:</strong> ${productsSubtotal.toFixed(2)} Lei
</p>

<p style="font-size: 15px;">
  <strong>Transport:</strong> ${shippingAmount.toFixed(2)} Lei
</p>

<p style="font-size: 16px;">
  <strong>Total:</strong> ${Number(total).toFixed(2)} Lei
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
  },
  {
    headers: {
      accept: 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
    },
  }
);

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
    const body = req.body || {};

const name = (body.name || '').trim();
const email = (body.email || '').trim().toLowerCase();
const password = (body.password || '').trim();

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
    const body = req.body || {};

const email =
  (body.email || '')
    .trim()
    .toLowerCase();

const password =
  (body.password || '').trim();

    const passwordHash = hashPassword(password);

    const result = await pool.query(
      `
        select
      id,
      name,
      email,
      password_hash,
      role,
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


app.post('/forgot-password', async (req, res) => {
  try {
    const body = req.body || {};

    const email = (body.email || '').trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        error: 'Emailul este obligatoriu.',
      });
    }

    const result = await pool.query(
      `
        select id, name, email
        from public.users
        where email = $1
        limit 1
      `,
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      return res.json({
        success: true,
        message: 'Dacă emailul există, vei primi un link de resetare.',
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query(
      `
        update public.users
        set reset_token = $1,
            reset_token_expires = $2
        where id = $3
      `,
      [resetToken, resetTokenExpires, user.id]
    );

    const resetLink =
  `${process.env.API_URL || 'https://giftdesign-api.onrender.com'}/reset-password-page?token=${resetToken}`;

    await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: {
          name: process.env.SMTP_FROM_NAME || 'GiftDesign',
          email: process.env.SMTP_FROM_EMAIL || 'info@giftdesign.ro',
        },
        to: [
          {
            email: user.email,
            name: user.name || 'GiftDesign user',
          },
        ],
        subject: 'Resetare parolă GiftDesign',
        htmlContent: `
          <h2>Resetare parolă GiftDesign</h2>
          <p>Ai cerut resetarea parolei pentru contul tău.</p>
          <p>Apasă pe linkul de mai jos pentru a seta o parolă nouă:</p>
          <p><a href="${resetLink}">${resetLink}</a></p>
          <p>Linkul expiră în 60 de minute.</p>
          <p>Dacă nu ai cerut resetarea parolei, poți ignora acest email.</p>
        `,
      },
      {
        headers: {
          accept: 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json',
        },
      }
    );

    res.json({
      success: true,
      message: 'Dacă emailul există, vei primi un link de resetare.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);

    res.status(500).json({
      error: 'Nu am putut trimite emailul de resetare.',
    });
  }
});
app.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        error: 'Token și parola sunt obligatorii.',
      });
    }

    const result = await pool.query(
      `
      select id
      from public.users
      where reset_token = $1
      and reset_token_expires > now()
      limit 1
      `,
      [token]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({
        error: 'Link invalid sau expirat.',
      });
    }

    const passwordHash = hashPassword(password);

    await pool.query(
      `
      update public.users
      set
        password_hash = $1,
        reset_token = null,
        reset_token_expires = null
      where id = $2
      `,
      [passwordHash, user.id]
    );

    res.json({
      success: true,
      message: 'Parola a fost actualizată.',
    });

  } catch (error) {
    console.error('Reset password error:', error);

    res.status(500).json({
      error: 'Nu am putut reseta parola.',
    });
  }
});

app.get('/reset-password-page', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Resetare parolă GiftDesign</title>
</head>
<body style="font-family:Arial;padding:40px;max-width:500px;margin:auto;">
<h2>Resetare parolă GiftDesign</h2>

<form id="form">
  <input
    type="password"
    id="password"
    placeholder="Parolă nouă"
    style="width:100%;padding:12px;margin-bottom:10px;"
    required
  />

  <input
    type="password"
    id="confirmPassword"
    placeholder="Confirmă parola"
    style="width:100%;padding:12px;margin-bottom:10px;"
    required
  />

  <button
    type="submit"
    style="padding:12px 20px;"
  >
    Resetează parola
  </button>
</form>

<div id="message" style="margin-top:20px;"></div>

<script>
const token =
  new URLSearchParams(window.location.search)
    .get('token');

document
  .getElementById('form')
  .addEventListener('submit', async (e) => {

    e.preventDefault();

    const password =
      document.getElementById('password').value;

    const confirmPassword =
      document.getElementById('confirmPassword').value;

    if (password !== confirmPassword) {
      document.getElementById('message').innerText =
        'Parolele nu coincid.';
      return;
    }

    const response = await fetch('/reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token,
        password
      })
    });

    const data = await response.json();

    document.getElementById('message').innerText =
      data.message || data.error;
});
</script>

</body>
</html>
  `);
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
          product_tax_percent: 21,
          quantity,
          unit_price_net: Number((price / 1.21).toFixed(2)),
          unit_tax_amount: Number((price - price / 1.21).toFixed(2)),
          unit_price_gross: price,
          line_subtotal_net: Number((subtotal / 1.21).toFixed(2)),
          line_tax_amount: Number((subtotal - subtotal / 1.21).toFixed(2)),
          line_subtotal_gross: subtotal,
          meta_fields: {
            source: 'GiftDesign Mobile App',
          },
        };
      });
      const countResult = await pool.query(
  'select count(*)::int as count from public.orders'
);

const orderNumber =
  `GD-${String(
    countResult.rows[0].count + 1
  ).padStart(6, '0')}`;

      const paymentMethodCode =
        payment_method === 'Card online'
          ? 'euplatescro'
          : 'cash_delivery';
       const shippingAmount =
        delivery_method === 'Curier rapid' && Number(total || 0) < 400
         ? 24.9
         : 0;
      const merchantPayload = {
        payment_status: 'awaiting',
        payment_method_code: [paymentMethodCode],
        shipping_status: 'awaiting',
        shipping_method_id: 0,
        shipping_amount: shippingAmount,

        customer_email: customer.email,
        customer_device: 'mobile',
        customer_note:
          `Comandă GiftDesign ${orderNumber}. ` +
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
  JSON.stringify(mpResponse.data, null, 2)
);

      

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

      console.log(
  JSON.stringify(
    {
      status:
        error.response?.status,
      headers:
        error.response?.headers,
      data:
        error.response?.data,
      message:
        error.message,
    },
    null,
    2
  )
);

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

app.put(
  '/orders/:id/cancel',
  authMiddleware,
  async (req, res) => {
    try {
      const orderId = req.params.id;

      const {
        reason,
        custom_reason,
      } = req.body || {};

      const finalReason =
        reason === 'Alt motiv'
          ? (custom_reason || '').trim()
          : (reason || '').trim();
      const orderResult = await pool.query(
  `
    select
      merchantpro_order_id
    from public.orders
    where id = $1
    and user_id = $2
    limit 1
  `,
  [orderId, req.user.id]
);

const order = orderResult.rows[0];

if (!order) {
  return res.status(404).json({
    error: 'Comanda nu există.',
  });
}

if (!order.merchantpro_order_id) {
  return res.status(400).json({
    error: 'Comanda nu are ID MerchantPro.',
  });
}

await api.patch(
  `/api/v2/orders/${order.merchantpro_order_id}/cancelled`
);
      const result = await pool.query(
        `
          update public.orders
          set
            status = 'Anulată',
            cancel_reason = $3,
            cancelled_at = now(),
            cancelled_by = 'client'
          where id = $1
          and user_id = $2
          and status not in (
            'Anulată',
            'Livrată',
            'Expediată'
          )
          returning
            id,
            order_number,
            status,
            cancel_reason,
            cancelled_at
        `,
        [
          orderId,
          req.user.id,
          finalReason,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({
          error:
            'Comanda nu poate fi anulată.',
        });
      }

      res.json({
        success: true,
        message:
          'Comanda a fost anulată.',
        order: result.rows[0],
      });
    } catch (error) {
      console.error(
        'Cancel order error:',
        error
      );

      res.status(500).json({
        error:
          'Nu am putut anula comanda.',
      });
    }
  }
);
app.get(
  '/admin/orders',
  authMiddleware,
  async (req, res) => {
    try {
      const userResult = await pool.query(
  `
    select role
    from public.users
    where id = $1
    limit 1
  `,
  [req.user.id]
);

const currentUser = userResult.rows[0];

if (!currentUser || currentUser.role !== 'admin') {
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
          cancel_reason,
          cancelled_at,
          cancelled_by,
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
app.put(
  '/admin/orders/:id/status',
  authMiddleware,
  async (req, res) => {
    try {
      const adminResult = await pool.query(
        `
          select role
          from public.users
          where id = $1
          limit 1
        `,
        [req.user.id]
      );

      const adminUser = adminResult.rows[0];

      if (!adminUser || adminUser.role !== 'admin') {
        return res.status(403).json({
          error: 'Access interzis.',
        });
      }

      const orderId = req.params.id;
      const status = (req.body?.status || '').trim();

      const handlers = {
        'Procesare': 'in_process',
        'Expediată': 'shipped',
        'Livrată': 'delivered',
        'Anulată': 'cancelled',
      };

      if (!handlers[status]) {
        return res.status(400).json({
          error: 'Status invalid pentru MerchantPro.',
        });
      }

      const orderResult = await pool.query(
        `
          select
            id,
            merchantpro_order_id
          from public.orders
          where id = $1
          limit 1
        `,
        [orderId]
      );

      const order = orderResult.rows[0];

      if (!order) {
        return res.status(404).json({
          error: 'Comanda nu există.',
        });
      }

      if (!order.merchantpro_order_id) {
        return res.status(400).json({
          error: 'Comanda nu are ID MerchantPro.',
        });
      }

      await api.patch(
        `/api/v2/orders/${order.merchantpro_order_id}/${handlers[status]}`
      );

      const updateResult = await pool.query(
        `
          update public.orders
          set
            status = $1,
            cancelled_at = case when $1 = 'Anulată' then now() else cancelled_at end,
            cancelled_by = case when $1 = 'Anulată' then 'admin' else cancelled_by end,
            cancel_reason = case when $1 = 'Anulată' then coalesce(cancel_reason, 'Anulată din Admin') else cancel_reason end
          where id = $2
          returning *
        `,
        [status, orderId]
      );

      res.json({
        success: true,
        message: 'Status comandă actualizat.',
        order: updateResult.rows[0],
      });
    } catch (error) {
      console.error(
        'Admin update order status error:',
        error.response?.data || error.message
      );

      res.status(500).json({
        error: 'Nu am putut actualiza statusul comenzii.',
      });
    }
  }
);
app.get(
  '/admin/merchantpro/orders-test',
  authMiddleware,
  async (req, res) => {
    try {
      const response = await api.get('/api/v2/orders');

      res.json(response.data);
    } catch (error) {
      console.error(
        'MerchantPro test error:',
        error.response?.data || error.message
      );

      res.status(500).json({
        error: 'MerchantPro orders test failed',
        details: error.response?.data || error.message,
      });
    }
  }
);
app.post(
  '/admin/orders/sync-merchantpro',
  authMiddleware,
  async (req, res) => {
    try {
      const adminResult = await pool.query(
        `
        select role
        from public.users
        where id = $1
        limit 1
        `,
        [req.user.id]
      );

      const adminUser = adminResult.rows[0];

      if (!adminUser || adminUser.role !== 'admin') {
        return res.status(403).json({
          error: 'Access interzis.',
        });
      }

      const firstResponse = await api.get('/api/v2/orders');

const totalOrders = Number(firstResponse.data?.meta?.count?.total || 0);
const limit = Number(firstResponse.data?.meta?.count?.limit || 20);

const startPoints = [];

for (
  let start = Math.max(totalOrders - limit, 0);
  start >= Math.max(totalOrders - 200, 0);
  start -= limit
) {
  startPoints.push(start);
}

const merchantOrders = [];

for (const start of startPoints) {
  const pageResponse = await api.get('/api/v2/orders', {
    params: { start },
  });

  merchantOrders.push(...(pageResponse.data?.data || []));
}

      

      let imported = 0;
      let skipped = 0;

      for (const mpOrder of merchantOrders) {
        const merchantOrderId = String(mpOrder.id || '').trim();

        if (!merchantOrderId) {
          skipped++;
          continue;
        }

        const existsResult = await pool.query(
          `
          select id
          from public.orders
          where merchantpro_order_id = $1
          limit 1
          `,
          [merchantOrderId]
        );

        if (existsResult.rows.length > 0) {
          skipped++;
          continue;
        }

        const customerName =
  `${mpOrder.billing_first_name || mpOrder.shipping_first_name || ''} ${
    mpOrder.billing_last_name || mpOrder.shipping_last_name || ''
  }`.trim();

const customer = {
  name:
    mpOrder.billing_name ||
    mpOrder.shipping_name ||
    customerName ||
    mpOrder.customer_name ||
    '',
  email: mpOrder.customer_email || '',
  phone: mpOrder.shipping_phone || mpOrder.customer_phone || '',
  address: mpOrder.shipping_full_address || '',
  city: mpOrder.shipping_city || '',
  county: mpOrder.shipping_state || '',
  country: mpOrder.shipping_country_name || 'România',
};

        const items = Array.isArray(mpOrder.products)
          ? mpOrder.products.map((item) => ({
              title: item.name || '',
              sku: item.sku || '',
              quantity: Number(item.quantity || 1),
              price: Number(item.price || 0),
            }))
          : [];

        await pool.query(
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
            status,
            created_at
          )
          values (
            gen_random_uuid(),
            $1,
            null,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10
          )
          `,
          [
            String(mpOrder.id),
            customer,
            JSON.stringify(items),
            Number(mpOrder.total_amount || 0),
            mpOrder.shipping_method_name || '',
            mpOrder.payment_method_name || '',
            mpOrder,
            merchantOrderId,
            mpOrder.cancelled ? 'Anulată' : 'Procesare',
            mpOrder.date_created || new Date(),
          ]
        );

        imported++;
      }

      res.json({
        imported,
        skipped,
        total: merchantOrders.length,
      });
    } catch (error) {
      console.error(
        'MerchantPro sync error:',
        error.response?.data || error.message
      );

      res.status(500).json({
        error: 'MerchantPro sync failed',
        details: error.response?.data || error.message,
      });
    }
  }
);
app.get('/test-email', async (req, res) => {
  try {
    await axios.post(
  'https://api.brevo.com/v3/smtp/email',
  {
    sender: {
      name: process.env.SMTP_FROM_NAME || 'GiftDesign',
      email: process.env.SMTP_FROM_EMAIL || 'info@giftdesign.ro',
    },
    to: [
      {
        email: 'info@giftdesign.ro',
        name: 'GiftDesign',
      },
    ],
    subject: 'Test email GiftDesign',
    htmlContent: `
      <h2>Email funcțional 🎉</h2>
      <p>Brevo API HTTP + Render funcționează.</p>
    `,
  },
  {
    headers: {
      accept: 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
    },
  }
);

    res.json({
      success: true,
      message: 'Email trimis.',
    });
  } catch (error) {
    console.log(
      'TEST EMAIL ERROR:',
      error
    );

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

const PORT =
  process.env.PORT || 3000;
app.get('/admin/add-reset-password-columns', async (req, res) => {
  try {
    await pool.query(`
      ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS reset_token TEXT,
      ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP;
    `);

    res.json({
      success: true,
      message: 'Coloane reset password adaugate.'
    });
  } catch (error) {
    console.error('DB migration error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.get('/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `
        select
          id,
          name,
          email,
          customer_type,

          billing_name,
          billing_email,
          billing_phone,
          billing_address,
          billing_city,
          billing_county,
          billing_postal_code,

          company_name,
          company_cui,
          company_reg_com,
          company_iban,
          company_bank,
          company_contact_person,

          shipping_same_as_billing,
          shipping_name,
          shipping_email,
          shipping_phone,
          shipping_address,
          shipping_city,
          shipping_county,
          shipping_postal_code,

          created_at
        from public.users
        where id = $1
        limit 1
      `,
      [req.user.id]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({
        error: 'Utilizatorul nu a fost găsit.',
      });
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('Profile fetch error:', error);

    res.status(500).json({
      error: 'Nu am putut încărca profilul.',
    });
  }
});

app.post('/profile', authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};

    const result = await pool.query(
      `
        update public.users
        set
          customer_type = $1,

          billing_name = $2,
          billing_email = $3,
          billing_phone = $4,
          billing_address = $5,
          billing_city = $6,
          billing_county = $7,
          billing_postal_code = $8,

          company_name = $9,
          company_cui = $10,
          company_reg_com = $11,
          company_iban = $12,
          company_bank = $13,
          company_contact_person = $14,

          shipping_same_as_billing = $15,
          shipping_name = $16,
          shipping_email = $17,
          shipping_phone = $18,
          shipping_address = $19,
          shipping_city = $20,
          shipping_county = $21,
          shipping_postal_code = $22
        where id = $23
        returning *
      `,
      [
        body.customer_type || 'individual',

        body.billing_name || '',
        body.billing_email || '',
        body.billing_phone || '',
        body.billing_address || '',
        body.billing_city || '',
        body.billing_county || '',
        body.billing_postal_code || '',

        body.company_name || '',
        body.company_cui || '',
        body.company_reg_com || '',
        body.company_iban || '',
        body.company_bank || '',
        body.company_contact_person || '',

        body.shipping_same_as_billing !== false,
        body.shipping_name || '',
        body.shipping_email || '',
        body.shipping_phone || '',
        body.shipping_address || '',
        body.shipping_city || '',
        body.shipping_county || '',
        body.shipping_postal_code || '',

        req.user.id,
      ]
    );

    res.json({
      success: true,
      message: 'Profil salvat cu succes.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Profile save error:', error);

    res.status(500).json({
      error: 'Nu am putut salva profilul.',
    });
  }
});
app.get('/admin/make-overclock-admin', async (req, res) => {
  try {
    const result = await pool.query(
      `
        update public.users
        set role = 'admin'
        where email = 'overclockmanager@gmail.com'
        returning id, email, role
      `
    );

    res.json({
      success: true,
      user: result.rows[0] || null,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
app.get('/admin/users', authMiddleware, async (req, res) => {
  try {
    const adminResult = await pool.query(
      `
        select role
        from public.users
        where id = $1
        limit 1
      `,
      [req.user.id]
    );

    const adminUser = adminResult.rows[0];

    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({
        error: 'Access interzis.',
      });
    }

    const result = await pool.query(`
      select
        id,
        name,
        email,
        role,
        customer_type,

        billing_name,
        billing_email,
        billing_phone,
        billing_address,
        billing_city,
        billing_county,
        billing_postal_code,

        company_name,
        company_cui,
        company_reg_com,
        company_iban,
        company_bank,
        company_contact_person,

        shipping_same_as_billing,
        shipping_name,
        shipping_email,
        shipping_phone,
        shipping_address,
        shipping_city,
        shipping_county,
        shipping_postal_code,

        created_at
      from public.users
      order by created_at desc
    `);

    res.json({
      success: true,
      count: result.rows.length,
      users: result.rows,
    });
  } catch (error) {
    console.error('Admin users error:', error);

    res.status(500).json({
      error: 'Nu am putut încărca utilizatorii.',
    });
  }
});
app.put('/admin/users/:id', authMiddleware, async (req, res) => {
  try {
    const adminResult = await pool.query(
      `
        select role
        from public.users
        where id = $1
        limit 1
      `,
      [req.user.id]
    );

    const adminUser = adminResult.rows[0];

    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({
        error: 'Access interzis.',
      });
    }

    const userId = req.params.id;
    const body = req.body || {};

    const result = await pool.query(
      `
        update public.users
        set
          name = $1,
          email = $2,
          role = $3,
          customer_type = $4,

          billing_name = $5,
          billing_email = $6,
          billing_phone = $7,
          billing_address = $8,
          billing_city = $9,
          billing_county = $10,
          billing_postal_code = $11,

          company_name = $12,
          company_cui = $13,
          company_reg_com = $14,
          company_iban = $15,
          company_bank = $16,
          company_contact_person = $17,

          shipping_same_as_billing = $18,
          shipping_name = $19,
          shipping_email = $20,
          shipping_phone = $21,
          shipping_address = $22,
          shipping_city = $23,
          shipping_county = $24,
          shipping_postal_code = $25
        where id = $26
        returning *
      `,
      [
        body.name || '',
        (body.email || '').trim().toLowerCase(),
        body.role || 'user',
        body.customer_type || 'individual',

        body.billing_name || '',
        body.billing_email || '',
        body.billing_phone || '',
        body.billing_address || '',
        body.billing_city || '',
        body.billing_county || '',
        body.billing_postal_code || '',

        body.company_name || '',
        body.company_cui || '',
        body.company_reg_com || '',
        body.company_iban || '',
        body.company_bank || '',
        body.company_contact_person || '',

        body.shipping_same_as_billing !== false,
        body.shipping_name || '',
        body.shipping_email || '',
        body.shipping_phone || '',
        body.shipping_address || '',
        body.shipping_city || '',
        body.shipping_county || '',
        body.shipping_postal_code || '',

        userId,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Utilizatorul nu a fost găsit.',
      });
    }

    res.json({
      success: true,
      message: 'Utilizator actualizat.',
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Admin update user error:', error);

    res.status(500).json({
      error: 'Nu am putut actualiza utilizatorul.',
    });
  }
});
app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});