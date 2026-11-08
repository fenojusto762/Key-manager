const { z } = require('zod');
const { AppError } = require('./errors');

function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw new AppError(400, 'VALIDATION_ERROR', issues[0]?.message || 'Dados inválidos.', issues);
  }
  return result.data;
}

const text = (label) =>
  z.string({ required_error: `Informe ${label}.`, invalid_type_error: `${label} inválido.` });

const emptyToUndefined = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const username = text('o usuário')
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9._-]{2,31}$/,
    'Usuário deve ter de 3 a 32 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.'
  );

const password = text('a senha')
  .min(8, 'A senha deve ter no mínimo 8 caracteres.')
  .max(72, 'A senha deve ter no máximo 72 caracteres.');

const displayName = z
  .string({ invalid_type_error: 'Nome inválido.' })
  .trim()
  .max(80, 'O nome deve ter no máximo 80 caracteres.');

const uuid = z.string({ required_error: 'ID inválido.' }).uuid('ID inválido.');

const intIn = (label, min, max) =>
  z.coerce
    .number({ invalid_type_error: `${label} inválido.`, required_error: `Informe ${label}.` })
    .int(`${label} deve ser um número inteiro.`)
    .min(min, `${label} deve ser no mínimo ${min}.`)
    .max(max, `${label} deve ser no máximo ${max}.`);

const schemas = {
  login: z.object({
    username: text('o usuário').trim().toLowerCase().min(1, 'Informe o usuário.').max(64),
    password: text('a senha').min(1, 'Informe a senha.').max(200),
  }),

  changePassword: z.object({
    current_password: text('a senha atual').min(1, 'Informe a senha atual.').max(200),
    new_password: password,
  }),

  profilePatch: z.object({
    display_name: displayName,
  }),

  createUser: z.object({
    username,
    password,
    display_name: displayName.optional(),
    role: z.enum(['ADMIN', 'USER'], { errorMap: () => ({ message: 'Função inválida.' }) }).default('USER'),
    credits: intIn('créditos iniciais', 0, 1000000).default(0),
  }),

  resetPassword: z.object({ password }),

  userStatus: z.object({
    status: z.enum(['ACTIVE', 'SUSPENDED'], { errorMap: () => ({ message: 'Status inválido.' }) }),
  }),

  credits: z.object({
    operation: z.enum(['add', 'remove'], { errorMap: () => ({ message: 'Operação inválida.' }) }),
    amount: intIn('quantidade de créditos', 1, 1000000),
    note: z.string().trim().max(200, 'A observação deve ter no máximo 200 caracteres.').optional(),
  }),

  generate: z.object({
    quantity: intIn('a quantidade', 1, 100),
    days: intIn('a validade', 1, 3650),
    idempotency_key: z.string().uuid().optional(),
  }),

  idParam: z.object({ id: uuid }),

  deleteUserQuery: z.object({
    revoke_licenses: z.enum(['true', 'false']).optional(),
  }),

  list: z.object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),

  userList: z.object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: emptyToUndefined(z.string().max(80)),
    status: emptyToUndefined(z.enum(['ACTIVE', 'SUSPENDED'])),
  }),

  licenseList: z.object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: emptyToUndefined(z.string().max(80)),
    status: emptyToUndefined(z.enum(['ACTIVE', 'EXPIRED', 'REVOKED'])),
    user_id: emptyToUndefined(z.string().uuid()),
  }),

  activityList: z.object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    action: emptyToUndefined(z.string().regex(/^[A-Z_]{3,40}$/)),
  }),
};

module.exports = { parse, schemas };
