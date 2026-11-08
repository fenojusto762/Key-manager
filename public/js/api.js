// Cliente da API. A sessão vive em cookies httpOnly — o JavaScript nunca vê os tokens.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onSessionExpired = () => {};
export const setSessionExpiredHandler = (fn) => { onSessionExpired = fn; };

let refreshing = null;

async function send(method, path, body, query) {
  let url = '/api' + path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    }
    const s = qs.toString();
    if (s) url += '?' + s;
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'KeyManager' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* corpo vazio */ }
  return { res, data };
}

function refreshSession() {
  if (!refreshing) {
    refreshing = send('POST', '/auth/refresh')
      .then(({ res }) => res.ok)
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function api(method, path, { body, query, silent = false } = {}) {
  let { res, data } = await send(method, path, body, query);

  // Access token expirado: tenta renovar uma vez (chamadas simultâneas compartilham a mesma renovação).
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) ({ res, data } = await send(method, path, body, query));
    if (res.status === 401 && !silent) onSessionExpired();
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code,
      data?.error?.message || 'Erro inesperado. Tente novamente.',
      data?.error?.details
    );
  }
  return data;
}

export const get = (path, query, opts) => api('GET', path, { query, ...opts });
export const post = (path, body, opts) => api('POST', path, { body: body ?? {}, ...opts });
export const patch = (path, body) => api('PATCH', path, { body });
export const del = (path, query) => api('DELETE', path, { query });
