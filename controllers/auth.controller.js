const crypto = require('crypto');
const axios = require('axios');

const pool = require('../config/database');

const {
  hashPassword,
  generateToken,
} = require('../utils/auth');

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    created_at: user.created_at,
    role: user.role || 'user',
  };
}

async function register(req, res) {
  try {
    const body = req.body || {};

    const name = (body.name || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    const password = (body.password || '').trim();

    if (!name || !email || !password) {
      return res.status(400).json({
        error: 'Completează toate câmpurile.',
      });
    }

    const existingResult = await pool.query(
      'select id from public.users where email = $1 limit 1',
      [email]
    );

    if (existingResult.rows.length > 0) {
      return res.status(409).json({
        error: 'Există deja un cont cu acest email.',
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
    const token = generateToken(user);

    res.status(201).json({
      message: 'Cont creat cu succes.',
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
}

async function login(req, res) {
  try {
    const body = req.body || {};

    const email = (body.email || '').trim().toLowerCase();
    const password = (body.password || '').trim();

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
        error: 'Email sau parolă greșită.',
      });
    }

    const token = generateToken(user);

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
}

async function forgotPassword(req, res) {
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
}

async function resetPassword(req, res) {
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
}

function resetPasswordPage(req, res) {
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
}

module.exports = {
  register,
  login,
  forgotPassword,
  resetPassword,
  resetPasswordPage,
};