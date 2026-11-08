try {
  require('dotenv').config(); // opcional: em produção (Vercel) as variáveis já vêm do ambiente
} catch {
  /* dotenv ausente: segue com process.env */
}

const str = (name, fallback = '') => String(process.env[name] ?? fallback).trim();
const int = (name, fallback) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const config = {
  isProd: process.env.NODE_ENV === 'production',
  port: int('PORT', 3000),

  supabaseUrl: str('SUPABASE_URL'),
  supabaseAnonKey: str('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: str('SUPABASE_SERVICE_ROLE_KEY'),

  authEmailDomain: str('AUTH_EMAIL_DOMAIN', 'keymanager.app').toLowerCase(),
  timezone: str('APP_TIMEZONE', 'America/Sao_Paulo'),

  limits: {
    validatePerMin: int('VALIDATE_RATE_LIMIT_PER_MIN', 60),
    loginPer15Min: int('LOGIN_RATE_LIMIT_PER_15MIN', 10),
    apiPer15Min: int('API_RATE_LIMIT_PER_15MIN', 600),
    generatePerMin: int('GENERATE_RATE_LIMIT_PER_MIN', 20),
  },

  cookies: {
    access: 'km_at',
    refresh: 'km_rt',
    refreshMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },

  maxLicensesPerRequest: 100,
};

config.missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].filter(
  (k) => !process.env[k] || !String(process.env[k]).trim()
);

module.exports = config;
