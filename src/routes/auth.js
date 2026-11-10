const express = require('express');
const config = require('../config');
const { AppError, asyncHandler } = require('../lib/errors');
const { getAdmin, newAnonClient } = require('../lib/supabase');
const { parse, schemas } = require('../lib/validation');
const { toEmail } = require('../lib/license');
const { logActivity } = require('../lib/activity');
const { recordLogin, findProfileByUsername } = require('../lib/accessLog');
const { loginLimiter } = require('../middleware/security');
const { PROFILE_COLS } = require('../middleware/auth');

const router = express.Router();

const cookieBase = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: 'strict',
});

function setSessionCookies(res, session) {
  const maxAge = Math.max(60, Number(session.expires_in) || 3600) * 1000;
  // Access token: enviado a toda a API. Refresh token: restrito ao caminho /api/auth.
  res.cookie(config.cookies.access, session.access_token, { ...cookieBase(), path: '/', maxAge });
  res.cookie(config.cookies.refresh, session.refresh_token, {
    ...cookieBase(),
    path: '/api/auth',
    maxAge: config.cookies.refreshMaxAgeMs,
  });
}

function clearSessionCookies(res) {
  res.clearCookie(config.cookies.access, { ...cookieBase(), path: '/' });
  res.clearCookie(config.cookies.refresh, { ...cookieBase(), path: '/api/auth' });
}

async function loadProfile(userId) {
  const { data, error } = await getAdmin().from('profiles').select(PROFILE_COLS).eq('id', userId).maybeSingle();
  if (error) {
    console.error('[auth]', error.message);
    throw new AppError(500, 'DATABASE_ERROR', 'Erro ao carregar o perfil.');
  }
  return data;
}

// POST /api/auth/login  { username, password }
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = parse(schemas.login, req.body);

    const { data, error } = await newAnonClient().auth.signInWithPassword({
      email: toEmail(username),
      password,
    });

    if (error || !data?.session) {
      if (error?.status === 429) {
        throw new AppError(429, 'RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.');
      }
      await logActivity({
        action: 'LOGIN_FAILED',
        actorUsername: username.slice(0, 64),
        ip: req.ip,
      });
      await recordLogin(req, {
        user: await findProfileByUsername(username),
        username,
        success: false,
        reason: 'INVALID_CREDENTIALS',
      });
      // Mensagem genérica: não revela se o usuário existe.
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Usuário ou senha inválidos.');
    }

    const profile = await loadProfile(data.user.id);
    if (!profile) throw new AppError(403, 'NO_PROFILE', 'Conta sem perfil. Contate o administrador.');
    if (profile.status !== 'ACTIVE') {
      // Só chegamos aqui com a senha correta, então informar a suspensão não vaza nada.
      getAdmin().auth.admin.signOut(data.session.access_token).catch(() => {});
      await recordLogin(req, { user: profile, username, success: false, reason: 'SUSPENDED' });
      throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Sua conta está suspensa. Contate o administrador.');
    }

    setSessionCookies(res, data.session);
    await logActivity({ actor: profile, action: 'LOGIN', ip: req.ip });
    await recordLogin(req, { user: profile, username, success: true, reason: 'OK' });
    res.json({ user: profile });
  })
);

// POST /api/auth/refresh  (usa o cookie httpOnly do refresh token)
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.[config.cookies.refresh];
    if (!refreshToken) throw new AppError(401, 'UNAUTHENTICATED', 'Faça login para continuar.');

    const { data, error } = await newAnonClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session || !data?.user) {
      clearSessionCookies(res);
      throw new AppError(401, 'SESSION_EXPIRED', 'Sessão expirada. Faça login novamente.');
    }

    const profile = await loadProfile(data.user.id);
    if (!profile || profile.status !== 'ACTIVE') {
      clearSessionCookies(res);
      throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Sua conta está suspensa ou indisponível.');
    }

    setSessionCookies(res, data.session);
    res.json({ user: profile });
  })
);

// POST /api/auth/logout
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[config.cookies.access];
    if (token) {
      try {
        const admin = getAdmin();
        const { data } = await admin.auth.getUser(token);
        if (data?.user) {
          const profile = await loadProfile(data.user.id);
          if (profile) await logActivity({ actor: profile, action: 'LOGOUT', ip: req.ip });
        }
        await admin.auth.admin.signOut(token); // revoga os refresh tokens desta sessão
      } catch (e) {
        console.error('[logout]', e?.message ?? e);
      }
    }
    clearSessionCookies(res);
    res.json({ ok: true });
  })
);

module.exports = router;
