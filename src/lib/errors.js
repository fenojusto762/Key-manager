class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Mensagens levantadas pelas funções SQL (RAISE EXCEPTION 'CODIGO') -> resposta HTTP.
const DB_ERRORS = {
  INSUFFICIENT_CREDITS: [402, 'Créditos insuficientes para esta operação.'],
  USER_NOT_FOUND: [404, 'Usuário não encontrado.'],
  LICENSE_NOT_FOUND: [404, 'Licença não encontrada.'],
  ALREADY_REVOKED: [409, 'Esta licença já está revogada.'],
  ACCOUNT_SUSPENDED: [403, 'Sua conta está suspensa.'],
  INVALID_QUANTITY: [400, 'Quantidade inválida (use de 1 a 100).'],
  INVALID_PLAN: [400, 'Validade inválida. Escolha 1, 7 ou 30 dias.'],
  INVALID_AMOUNT: [400, 'Valor de créditos inválido.'],
  FORBIDDEN: [403, 'Acesso negado.'],
  LAST_ADMIN: [409, 'Não é possível remover ou suspender o último administrador ativo.'],
  CREDITS_PROTECTED: [403, 'Créditos só podem ser alterados por operações autorizadas.'],
  CODE_GENERATION_FAILED: [503, 'Não foi possível gerar códigos únicos. Tente novamente.'],
};

function throwDb(error) {
  const msg = String(error?.message ?? '');
  const code = Object.keys(DB_ERRORS).find((k) => msg.includes(k));
  if (code) {
    const [status, message] = DB_ERRORS[code];
    throw new AppError(status, code, message);
  }
  if (error?.code === '23505') {
    throw new AppError(409, 'CONFLICT', 'Registro já existe.');
  }
  console.error('[db]', error);
  throw new AppError(500, 'DATABASE_ERROR', 'Erro ao acessar o banco de dados.');
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Corpo da requisição não é um JSON válido.' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Requisição grande demais.' } });
  }

  console.error('[erro]', err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.' } });
}

module.exports = { AppError, asyncHandler, throwDb, errorHandler };
