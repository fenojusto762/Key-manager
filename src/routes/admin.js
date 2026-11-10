const express = require('express');
const config = require('../config');
const { AppError, asyncHandler, throwDb } = require('../lib/errors');
const { getAdmin } = require('../lib/supabase');
const { parse, schemas } = require('../lib/validation');
const { toEmail, sanitizeSearch } = require('../lib/license');
const { logActivity } = require('../lib/activity');
const { listLicenses } = require('../lib/queries');

const router = express.Router();

const USER_COLS = 'id, username, display_name, role, status, credits, created_at, updated_at';
const ACTIVITY_COLS = 'id, actor_id, actor_username, action, target_id, target_username, details, created_at';

async function getUserOr404(id) {
  const { data, error } = await getAdmin().from('profiles').select(USER_COLS).eq('id', id).maybeSingle();
  if (error) throwDb(error);
  if (!data) throw new AppError(404, 'USER_NOT_FOUND', 'Usuário não encontrado.');
  return data;
}

async function isLastActiveAdmin(user) {
  if (user.role !== 'ADMIN' || user.status !== 'ACTIVE') return false;
  const { count, error } = await getAdmin()
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'ADMIN')
    .eq('status', 'ACTIVE')
    .neq('id', user.id);
  if (error) throwDb(error);
  return (count ?? 0) === 0;
}

/* ------------------------------- Dashboard -------------------------------- */

// GET /api/admin/stats
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const admin = getAdmin();
    const [stats, users, activity] = await Promise.all([
      admin.rpc('admin_dashboard_stats', { p_days: 14, p_tz: config.timezone }),
      admin.from('profiles').select(USER_COLS).order('created_at', { ascending: false }).limit(6),
      admin.from('activity_logs').select(ACTIVITY_COLS).order('created_at', { ascending: false }).limit(10),
    ]);
    for (const r of [stats, users, activity]) if (r.error) throwDb(r.error);
    res.json({ stats: stats.data, latest_users: users.data, recent_activity: activity.data });
  })
);

/* -------------------------------- Usuários -------------------------------- */

// GET /api/admin/users?search&status&page&limit
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { page, limit, search, status } = parse(schemas.userList, req.query);
    const from = (page - 1) * limit;

    let q = getAdmin()
      .from('profiles')
      .select(USER_COLS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + limit - 1);

    const s = sanitizeSearch(search);
    if (s) q = q.or(`username.ilike.%${s}%,display_name.ilike.%${s}%`);
    if (status) q = q.eq('status', status);

    const { data, error, count } = await q;
    if (error) throwDb(error);
    res.json({ items: data, page, limit, total: count ?? 0 });
  })
);

// POST /api/admin/users  { username, password, display_name?, role?, credits? }
router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const body = parse(schemas.createUser, req.body);
    const admin = getAdmin();

    const { data: existing, error: existErr } = await admin
      .from('profiles')
      .select('id')
      .eq('username', body.username)
      .maybeSingle();
    if (existErr) throwDb(existErr);
    if (existing) throw new AppError(409, 'USERNAME_TAKEN', 'Este nome de usuário já está em uso.');

    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email: toEmail(body.username),
      password: body.password,
      email_confirm: true,
      user_metadata: { username: body.username },
    });
    if (authErr || !created?.user) {
      const msg = String(authErr?.message ?? '').toLowerCase();
      if (msg.includes('already') || msg.includes('registered')) {
        throw new AppError(409, 'USERNAME_TAKEN', 'Este nome de usuário já está em uso.');
      }
      if (msg.includes('password')) {
        throw new AppError(400, 'PASSWORD_REJECTED', 'Senha rejeitada. Escolha uma senha mais forte.');
      }
      console.error('[admin/createUser]', authErr);
      throw new AppError(500, 'AUTH_ERROR', 'Não foi possível criar o usuário no serviço de autenticação.');
    }

    const userId = created.user.id;
    const rollback = () => admin.auth.admin.deleteUser(userId).catch(() => {});

    const { data: profile, error: profErr } = await admin
      .from('profiles')
      .insert({
        id: userId,
        username: body.username,
        display_name: body.display_name || null,
        role: body.role,
        status: 'ACTIVE',
        credits: 0,
        created_by: req.user.id,
      })
      .select(USER_COLS)
      .single();
    if (profErr) {
      await rollback();
      if (profErr.code === '23505') throw new AppError(409, 'USERNAME_TAKEN', 'Este nome de usuário já está em uso.');
      throwDb(profErr);
    }

    let result = profile;
    if (body.credits > 0) {
      const { error: credErr } = await admin.rpc('adjust_credits', {
        p_user_id: userId,
        p_amount: body.credits,
        p_admin_id: req.user.id,
        p_note: 'Saldo inicial',
        p_ip: req.ip ?? null,
      });
      if (credErr) {
        await rollback(); // o perfil é removido em cascata
        throwDb(credErr);
      }
      result = { ...profile, credits: body.credits };
    }

    await logActivity({
      actor: req.user,
      action: 'USER_CREATED',
      target: profile,
      details: { role: body.role, initial_credits: body.credits },
      ip: req.ip,
    });
    res.status(201).json({ user: result });
  })
);

// GET /api/admin/users/:id
router.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(schemas.idParam, req.params);
    const user = await getUserOr404(id);
    const { data, error } = await getAdmin().rpc('user_dashboard_stats', {
      p_user_id: id,
      p_days: 14,
      p_tz: config.timezone,
    });
    if (error) throwDb(error);
    res.json({ user, stats: data });
  })
);

// PATCH /api/admin/users/:id/status  { status }
router.patch(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    const { id } = parse(schemas.idParam, req.params);
    const { status } = parse(schemas.userStatus, req.body);
    const user = await getUserOr404(id);

    if (status === 'SUSPENDED') {
      if (id === req.user.id) {
        throw new AppError(400, 'SELF_ACTION', 'Você não pode suspender a própria conta.');
      }
      if (await isLastActiveAdmin(user)) {
        throw new AppError(409, 'LAST_ADMIN', 'Não é possível suspender o último administrador ativo.');
      }
    }
    if (user.status === status) return res.json({ user });

    const { data, error } = await getAdmin()
      .from('profiles')
      .update({ status })
      .eq('id', id)
      .select(USER_COLS)
      .single();
    if (error) throwDb(error);

    await logActivity({
      actor: req.user,
      action: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
      target: user,
      ip: req.ip,
    });
    res.json({ user: data });
  })
);

// POST /api/admin/users/:id/credits  { operation: 'add'|'remove', amount, note? }
router.post(
  '/users/:id/credits',
  asyncHandler(async (req, res) => {
    const { id } = parse(schemas.idParam, req.params);
    const { operation, amount, note } = parse(schemas.credits, req.body);

    const { data, error } = await getAdmin().rpc('adjust_credits', {
      p_user_id: id,
      p_amount: operation === 'add' ? amount : -amount,
      p_admin_id: req.user.id,
      p_note: note ?? null,
      p_ip: req.ip ?? null,
    });
    if (error) throwDb(error);
    res.json({ result: data });
  })
);

// POST /api/admin/users/:id/password  { password }
router.post(
  '/users/:id/password',
  asyncHandler(async (req, res) => {
    const { id } = parse(schemas.idParam, req.params);
    const { password } = parse(schemas.resetPassword, req.body);
    const user = await getUserOr404(id);

    const { error } = await getAdmin().auth.admin.updateUserById(id, { password });
    if (error) throw new AppError(400, 'PASSWORD_REJECTED', 'Senha rejeitada. Escolha uma senha mais forte.');

    await logActivity({ actor: req.user, action: 'PASSWORD_RESET', target: user, ip: req.ip });
    res.json({ ok: true });
  })
);

// DELETE /api/admin/users/:id?revoke_licenses=true
router.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(schemas.idParam, req.params);
    const { revoke_licenses } = parse(schemas.deleteUserQuery, req.query);
    const user = await getUserOr404(id);
    const admin = getAdmin();

    if (id === req.user.id) {
      throw new AppError(400, 'SELF_ACTION', 'Você não pode excluir a própria conta.');
    }
    if (await isLastActiveAdmin(user)) {
      throw new AppError(409, 'LAST_ADMIN', 'Não é possível excluir o último administrador ativo.');
    }

    let revoked = 0;
    if (revoke_licenses === 'true') {
      const { data, error } = await admin
        .from('licenses')
        .update({ revoked_at: new Date().toISOString(), revoked_by: req.user.id })
        .eq('user_id', id)
        .is('revoked_at', null)
        .select('id');
      if (error) throwDb(error);
      revoked = data?.length ?? 0;
    }

    // Exclui no Supabase Auth; o perfil é removido em cascata.
    const { error: delErr } = await admin.auth.admin.deleteUser(id);
    if (delErr) {
      console.error('[admin/deleteUser]', delErr);
      throw new AppError(500, 'AUTH_ERROR', 'Não foi possível excluir o usuário.');
    }

    await logActivity({
      actor: req.user,
      action: 'USER_DELETED',
      details: { user_id: id, username: user.username, role: user.role, licenses_revoked: revoked },
      ip: req.ip,
      // target fica nulo: o perfil não existe mais; os dados ficam em "details".
    });
    res.json({ ok: true, licenses_revoked: revoked });
  })
);

// GET /api/admin/users/:id/activity?page&limit — atividades em que o usuário é autor ou alvo
router.get(
  '/users/:id/activity',
  asyncHandler(async (req, res) => {
    const { id } = parse(schemas.idParam, req.params);
    const { page, limit } = parse(schemas.list, req.query);
    const from = (page - 1) * limit;
    await getUserOr404(id);

    const { data, error, count } = await getAdmin()
      .from('activity_logs')
      .select(ACTIVITY_COLS, { count: 'exact' })
      .or(`actor_id.eq.${id},target_id.eq.${id}`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + limit - 1);
    if (error) throwDb(error);
    res.json({ items: data, page, limit, total: count ?? 0 });
  })
);

// GET /api/admin/users/:id/transactions?page&limit
router.get(
  '/users/:id/transactions',
  asyncHandler(async (req, res) => {
    const { id } = parse(schemas.idParam, req.params);
    await getUserOr404(id);
    const { listTransactions } = require('../lib/queries');
    res.json(await listTransactions(req.query, { userId: id }));
  })
);

/* -------------------------------- Licenças -------------------------------- */

// GET /api/admin/licenses?status&search&user_id&page&limit
router.get(
  '/licenses',
  asyncHandler(async (req, res) => {
    res.json(await listLicenses(req.query));
  })
);

// POST /api/admin/licenses/:id/revoke
router.post(
  '/licenses/:id/revoke',
  asyncHandler(async (req, res) => {
    const { id } = parse(schemas.idParam, req.params);
    const { data, error } = await getAdmin().rpc('revoke_license', {
      p_license_id: id,
      p_admin_id: req.user.id,
      p_ip: req.ip ?? null,
    });
    if (error) throwDb(error);
    res.json({ license: data });
  })
);

/* --------------------------- Histórico de acessos -------------------------- */

const ACCESS_COLS =
  'id, user_id, username, success, reason, ip, device, device_type, os, browser, country, region, city, flags, suspicious, created_at';

// GET /api/admin/access-logs/summary — números do topo da tela (últimas 24 h)
router.get(
  '/access-logs/summary',
  asyncHandler(async (req, res) => {
    const { data, error } = await getAdmin().rpc('access_summary', { p_tz: config.timezone });
    if (error) throwDb(error);
    res.json({ summary: data });
  })
);

// GET /api/admin/access-logs?search&filter=success|failed|suspicious&page&limit
// Cada linha traz usuário, data/hora, IP, dispositivo, navegador e localização aproximada.
router.get(
  '/access-logs',
  asyncHandler(async (req, res) => {
    const { page, limit, search, filter } = parse(schemas.accessList, req.query);
    const from = (page - 1) * limit;

    let q = getAdmin()
      .from('login_events')
      .select(ACCESS_COLS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + limit - 1);

    const s = sanitizeSearch(search);
    if (s) q = q.or(`username.ilike.%${s}%,ip.ilike.%${s}%`);
    if (filter === 'success') q = q.eq('success', true);
    if (filter === 'failed') q = q.eq('success', false);
    if (filter === 'suspicious') q = q.eq('suspicious', true);

    const { data, error, count } = await q;
    if (error) throwDb(error);
    res.json({ items: data, page, limit, total: count ?? 0 });
  })
);

/* ------------------------------- Atividades ------------------------------- */

// GET /api/admin/activity?action&page&limit
router.get(
  '/activity',
  asyncHandler(async (req, res) => {
    const { page, limit, action } = parse(schemas.activityList, req.query);
    const from = (page - 1) * limit;

    let q = getAdmin()
      .from('activity_logs')
      .select(ACTIVITY_COLS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + limit - 1);
    if (action) q = q.eq('action', action);

    const { data, error, count } = await q;
    if (error) throwDb(error);
    res.json({ items: data, page, limit, total: count ?? 0 });
  })
);

module.exports = router;
