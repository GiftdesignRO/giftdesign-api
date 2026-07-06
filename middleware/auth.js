const { verifyToken } = require('../utils/auth');

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

module.exports = authMiddleware;