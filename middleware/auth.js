const jwt = require('jsonwebtoken');

/**
 * Protects admin routes.
 * Expects: Authorization: Bearer <token>
 */
function requireAdmin(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = header.slice(7);
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.admin = payload; // { id, email }
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

module.exports = { requireAdmin };
