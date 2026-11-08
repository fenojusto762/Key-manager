const rateLimit = require('express-rate-limit');
const config = require('../config');
const { AppError } = require('../lib/errors');

/**
 * Proteção CSRF para rotas autenticadas por cookie:
 *  - exige o cabeçalho customizado X-Requested-With (um formulário/site externo não consegue enviá-lo);
 *  - se houver Origin, ele precisa ser o mesmo host da aplicação.
 */
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  if (req.get('x-requested-with') !== 'KeyManager') {
    return next(new AppError(403, 'CSRF_REJECTED', 'Requisição rejeitada.'));
  }
  const origin = req.get('origin');
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return next(new AppError(403, 'CSRF_REJECTED', 'Requisição rejeitada.'));
    }
    const allowed = [req.get('host'), req.get('x-forwarded-host')].filter(Boolean);
    if (!allowed.includes(host)) {
      return next(new AppError(403, 'CSRF_REJECTED', 'Requisição rejeitada.'));
    }
  }
  return next();
}

/** CORS aberto apenas para o endpoint público de validação (usado por softwares de terceiros). */
function publicCors(req, res, next) {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
  next();
}

function makeLimiter({ windowMs, limit, message, keyGenerator, skipSuccessfulRequests = false, handler }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler:
      handler ||
      ((req, res) => {
        res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
      }),
  });
}

const MIN = 60 * 1000;

const apiLimiter = makeLimiter({
  windowMs: 15 * MIN,
  limit: config.limits.apiPer15Min,
  message: 'Muitas requisições. Aguarde alguns minutos e tente novamente.',
});

const loginLimiter = makeLimiter({
  windowMs: 15 * MIN,
  limit: config.limits.loginPer15Min,
  skipSuccessfulRequests: true,
  message: 'Muitas tentativas de login. Aguarde 15 minutos e tente novamente.',
});

const generateLimiter = makeLimiter({
  windowMs: MIN,
  limit: config.limits.generatePerMin,
  keyGenerator: (req) => `user:${req.user?.id ?? 'anon'}`,
  message: 'Muitas gerações em pouco tempo. Aguarde um instante.',
});

const validateLimiter = makeLimiter({
  windowMs: MIN,
  limit: config.limits.validatePerMin,
  handler: (req, res) => {
    res.status(429).json({
      valid: false,
      status: 'RATE_LIMITED',
      reason: 'RATE_LIMITED',
      message: 'Limite de consultas excedido. Tente novamente em instantes.',
      expires_at: null,
    });
  },
});

module.exports = { csrfGuard, publicCors, apiLimiter, loginLimiter, generateLimiter, validateLimiter };
