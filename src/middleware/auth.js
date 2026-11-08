const config = require('../config');
const { AppError, asyncHandler } = require('../lib/errors');
const { getAdmin } = require('../lib/supabase');

const PROFILE_COLS = 'id, username, display_name, role, status, credits, created_at';

/**
 * Autentica pela sessão (cookie httpOnly com o access token do Supabase Auth).
 * O token é verificado no Supabase Auth e o papel (role) / status vêm SEMPRE do banco —
 * nada é decidido com base em dados enviados pelo navegador.
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[config.cookies.access];
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Faça login para continuar.');

  const admin = getAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    throw new AppError(401, 'SESSION_INVALID', 'Sessão inválida ou expirada.');
  }

  const { data: profile, error: pErr } = await admin
    .from('profiles')
    .select(PROFILE_COLS)
    .eq('id', data.user.id)
    .maybeSingle();
  if (pErr) {
    console.error('[auth]', pErr.message);
    throw new AppError(500, 'DATABASE_ERROR', 'Erro ao carregar o perfil.');
  }
  if (!profile) throw new AppError(403, 'NO_PROFILE', 'Conta sem perfil. Contate o administrador.');
  if (profile.status !== 'ACTIVE') {
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Sua conta está suspensa. Contate o administrador.');
  }

  req.user = profile;
  req.accessToken = token;
  next();
});

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return next(new AppError(403, 'FORBIDDEN', 'Acesso restrito a administradores.'));
  }
  return next();
}

module.exports = { authenticate, requireAdmin, PROFILE_COLS };
