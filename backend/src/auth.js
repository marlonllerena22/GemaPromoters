import jwt from 'jsonwebtoken';

export function createToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET || 'dev-secret', {
    expiresIn: process.env.JWT_EXPIRES_IN || '365d'
  });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'No autorizado' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    return next();
  } catch {
    return res.status(401).json({ message: 'Sesion expirada' });
  }
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!['admin', 'supreme'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Solo administrador' });
    }
    return next();
  });
}

export function requireSupreme(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'supreme') {
      return res.status(403).json({ message: 'Solo administrador supremo' });
    }
    return next();
  });
}

export function requirePromoter(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'promoter') {
      return res.status(403).json({ message: 'Solo promotor' });
    }
    return next();
  });
}

export function requireProductionUser(req, res, next) {
  requireAuth(req, res, () => {
    if (!['admin', 'supreme', 'production_admin', 'production_vendor'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Acceso exclusivo de Producalza' });
    }
    return next();
  });
}

export function requireProductionAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!['admin', 'supreme', 'production_admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Solo administrador de Producalza' });
    }
    return next();
  });
}
