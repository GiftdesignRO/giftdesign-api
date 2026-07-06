const crypto = require('crypto');

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'giftdesign-super-secret';

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

module.exports = {
  hashPassword,
  generateToken,
  verifyToken,
};