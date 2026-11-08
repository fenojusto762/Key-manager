const express = require('express');
const config = require('../config');
const { AppError, asyncHandler, throwDb } = require('../lib/errors');
const { getAdmin, newAnonClient } = require('../lib/supabase');
const { parse, schemas } = require('../lib/validation');
const { toEmail } = require('../lib/license');
const { logActivity } = require('../lib/activity');
const { listLicenses, listTransactions } = require('../lib/queries');
const { PROFILE_COLS } = require('../middleware/auth');

const router = express.Router();

// GET /api/me
router.get('/', (req, res) => {
  res.json({ user: req.user });
});

// PATCH /api/me  { display_name }   (único campo que o próprio usuário pode alterar)
router.patch(
  '/',
  asyncHandler(async (req, res) => {
    const { display_name } = parse(schemas.profilePatch, req.body);
    const { data, error } = await getAdmin()
      .from('profiles')
      .update({ display_name: display_name || null })
      .eq('id', req.user.id)
      .select(PROFILE_COLS)
      .single();
    if (error) throwDb(error);
    await logActivity({ actor: req.user, action: 'PROFILE_UPDATED', target: req.user, ip: req.ip });
    res.json({ user: data });
  })
);

// POST /api/me/password  { current_password, new_password }
router.post(
  '/password',
  asyncHandler(async (req, res) => {
    const { current_password, new_password } = parse(schemas.changePassword, req.body);
    if (current_password === new_password) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A nova senha deve ser diferente da atual.');
    }

    const { error: signErr } = await newAnonClient().auth.signInWithPassword({
      email: toEmail(req.user.username),
      password: current_password,
    });
    if (signErr) throw new AppError(400, 'WRONG_PASSWORD', 'A senha atual está incorreta.');

    const { error } = await getAdmin().auth.admin.updateUserById(req.user.id, { password: new_password });
    if (error) {
      throw new AppError(400, 'PASSWORD_REJECTED', 'Não foi possível definir esta senha. Escolha uma senha mais forte.');
    }
    await logActivity({ actor: req.user, action: 'PASSWORD_CHANGED', target: req.user, ip: req.ip });
    res.json({ ok: true });
  })
);

// GET /api/me/stats
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const { data, error } = await getAdmin().rpc('user_dashboard_stats', {
      p_user_id: req.user.id,
      p_days: 14,
      p_tz: config.timezone,
    });
    if (error) throwDb(error);
    res.json({ stats: data });
  })
);

// GET /api/me/licenses?page&limit&status&search   (SEMPRE filtrado pelo usuário autenticado)
router.get(
  '/licenses',
  asyncHandler(async (req, res) => {
    res.json(await listLicenses(req.query, { userId: req.user.id }));
  })
);

// GET /api/me/transactions?page&limit
router.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    res.json(await listTransactions(req.query, { userId: req.user.id }));
  })
);

module.exports = router;
