const express = require('express');
const config = require('../config');
const { asyncHandler, throwDb } = require('../lib/errors');
const { getAdmin } = require('../lib/supabase');
const { parse, schemas } = require('../lib/validation');
const { normalizeKey } = require('../lib/license');
const { publicCors, validateLimiter, generateLimiter } = require('../middleware/security');

/* -------------------------------------------------------------------------- */
/* Rotas PÚBLICAS (sem login): POST /api/licenses/validate                      */
/* -------------------------------------------------------------------------- */
const publicRouter = express.Router();

const REASONS = {
  ACTIVE: null,
  EXPIRED: { reason: 'LICENSE_EXPIRED', message: 'A licença expirou.' },
  REVOKED: { reason: 'LICENSE_REVOKED', message: 'A licença foi revogada.' },
};

publicRouter.options('/validate', publicCors, (req, res) => res.sendStatus(204));

publicRouter.post(
  '/validate',
  publicCors,
  validateLimiter,
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const key = normalizeKey(req.body?.key);
      if (!key) {
        return res.status(400).json({
          valid: false,
          status: 'INVALID_FORMAT',
          reason: 'INVALID_FORMAT',
          message: 'Formato de chave inválido. Use XXXX-XXXX-XXXX-XXXX.',
          expires_at: null,
        });
      }

      const { data, error } = await getAdmin().rpc('validate_license', { p_code: key });
      if (error) throw error;

      if (!data?.found) {
        return res.json({
          valid: false,
          status: 'NOT_FOUND',
          reason: 'LICENSE_NOT_FOUND',
          message: 'Licença não encontrada.',
          expires_at: null,
        });
      }

      const invalid = REASONS[data.status];
      return res.json({
        valid: data.status === 'ACTIVE',
        status: data.status,
        reason: invalid ? invalid.reason : null,
        message: invalid ? invalid.message : 'Licença válida.',
        key,
        expires_at: data.expires_at,
        checked_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[validate]', e?.message ?? e);
      return res.status(503).json({
        valid: false,
        status: 'ERROR',
        reason: 'SERVICE_UNAVAILABLE',
        message: 'Serviço temporariamente indisponível. Tente novamente.',
        expires_at: null,
      });
    }
  }
);

/* -------------------------------------------------------------------------- */
/* Rotas autenticadas: planos e geração                                        */
/* -------------------------------------------------------------------------- */
const router = express.Router();

// GET /api/licenses/plans — tabela de preços (vem do banco: fonte única da verdade)
router.get(
  '/plans',
  asyncHandler(async (req, res) => {
    const { data, error } = await getAdmin()
      .from('license_plans')
      .select('duration_days, credits, label')
      .eq('active', true)
      .order('duration_days', { ascending: true });
    if (error) throwDb(error);
    res.json({
      plans: data.map((p) => ({ days: p.duration_days, credits: p.credits, label: p.label })),
      max_quantity: config.maxLicensesPerRequest,
    });
  })
);

// POST /api/licenses/generate  { quantity, days, idempotency_key? }
// Débito de créditos + criação das licenças acontecem numa única transação no banco.
router.post(
  '/generate',
  generateLimiter,
  asyncHandler(async (req, res) => {
    const { quantity, days, idempotency_key } = parse(schemas.generate, req.body);

    const { data, error } = await getAdmin().rpc('generate_licenses', {
      p_user_id: req.user.id,
      p_quantity: quantity,
      p_days: days,
      p_idempotency_key: idempotency_key ?? null,
      p_ip: req.ip ?? null,
    });
    if (error) throwDb(error);

    res.status(data.replayed ? 200 : 201).json(data);
  })
);

module.exports = { publicRouter, router };
