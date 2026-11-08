const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const config = require('./config');
const { errorHandler, AppError } = require('./lib/errors');
const { csrfGuard, apiLimiter } = require('./middleware/security');
const { authenticate, requireAdmin } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const adminRoutes = require('./routes/admin');
const { publicRouter: publicLicenseRoutes, router: licenseRoutes } = require('./routes/licenses');

const app = express();

// Atrás de proxy (Vercel): necessário para obter o IP real e aplicar rate limit corretamente.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '10kb' }));

// Saúde (não revela detalhes de configuração)
app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: config.missing.length === 0, service: 'key-manager', time: new Date().toISOString() });
});

// Endpoint PÚBLICO de validação (CORS aberto, sem cookies, limite próprio)
app.use('/api/licenses', publicLicenseRoutes);

// Daqui em diante: sessão por cookie + proteção CSRF + limite geral
app.use('/api', csrfGuard, apiLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/me', authenticate, meRoutes);
app.use('/api/licenses', authenticate, licenseRoutes);
app.use('/api/admin', authenticate, requireAdmin, adminRoutes); // papel ADMIN conferido no banco a cada requisição

app.use('/api', (req, res, next) => next(new AppError(404, 'NOT_FOUND', 'Rota não encontrada.')));

// Frontend estático (em produção na Vercel os arquivos de /public são servidos pela CDN)
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    index: 'index.html',
    maxAge: config.isProd ? '1h' : 0,
  })
);

app.use(errorHandler);

module.exports = app;
