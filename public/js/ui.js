// Utilitários de interface: escape, formatação, ícones, toasts, modais.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf = new Intl.NumberFormat('pt-BR');
export const fmtInt = (n) => nf.format(Number(n) || 0);

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Data e hora exatas, com segundos (usado no histórico de acessos). */
export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDay(isoDate) {
  // 'YYYY-MM-DD' -> 'dd/mm'
  const [, m, d] = String(isoDate).split('-');
  return `${d}/${m}`;
}

export function relTime(iso) {
  if (!iso) return '';
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 45) return 'agora há pouco';
  const mins = Math.round(diff / 60);
  if (mins < 60) return `há ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `há ${hrs} h`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `há ${days} d`;
  return fmtDate(iso).split(' ')[0];
}

export function timeLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expirada';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} min restantes`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} h restantes`;
  return `${Math.floor(hrs / 24)} dias restantes`;
}

export const initials = (s) => String(s || '?').trim().slice(0, 2);

/* ------------------------------- Ícones ---------------------------------- */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.3c2.2.7 3.5 2.6 3.5 5.7"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M16 7l3 3"/><path d="M14 9l2 2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  coins: '<circle cx="9" cy="9" r="6"/><path d="M15.5 9.7A6 6 0 1 1 9.7 15.5"/><path d="M9 7v4M7.5 9h3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 4 5.7 4 9s-1.4 6.4-4 9c-2.6-2.6-4-5.7-4-9s1.4-6.4 4-9z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  smartphone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  tablet: '<rect x="4.5" y="3" width="15" height="18" rx="2.5"/><path d="M11 18h2"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
};

export const icon = (name) =>
  `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

/* ------------------------------- Badges ---------------------------------- */
const LICENSE_STATUS = {
  ACTIVE: ['Ativa', 'ok'],
  EXPIRED: ['Expirada', 'warn'],
  REVOKED: ['Revogada', 'bad'],
};
export const licenseBadge = (status) => {
  const [label, tone] = LICENSE_STATUS[status] || [status, 'muted'];
  return `<span class="badge badge--${tone}">${esc(label)}</span>`;
};
export const userStatusBadge = (status) =>
  status === 'ACTIVE'
    ? '<span class="badge badge--ok">Ativo</span>'
    : '<span class="badge badge--bad">Suspenso</span>';
export const roleBadge = (role) =>
  role === 'ADMIN'
    ? '<span class="badge badge--info badge--plain">ADMIN</span>'
    : '<span class="badge badge--muted badge--plain">USER</span>';

/* ------------------------------- Toasts ---------------------------------- */
export function toast(message, type = 'info') {
  const root = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'bad' ? 'alert' : 'status');
  el.innerHTML = `${icon(type === 'ok' ? 'check' : type === 'bad' ? 'x' : 'info')}<span>${esc(message)}</span>`;
  root.appendChild(el);
  const remove = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 260);
  };
  setTimeout(remove, type === 'bad' ? 6000 : 3800);
  el.addEventListener('click', remove);
}

/* -------------------------------- Modais --------------------------------- */
/**
 * openModal({ title, html, width, actions: [{ label, kind, onClick(ctl), close }], onMount(ctl) })
 * ctl: { el, body, close(), setBusy(bool), setError(msg) }
 */
export function openModal({ title, html, width = 480, actions = [], onMount }) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `
    <div class="modal__backdrop" data-close></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal__head"><h3>${esc(title)}</h3>
        <button class="icon-btn" type="button" data-close aria-label="Fechar">${icon('x')}</button></header>
      <div class="modal__body">${html || ''}</div>
      ${actions.length ? '<footer class="modal__foot"></footer>' : ''}
    </div>`;
  const panel = wrap.querySelector('.modal__panel');
  panel.style.setProperty('--w', `${width}px`);
  root.appendChild(wrap);
  const previouslyFocused = document.activeElement;

  const body = wrap.querySelector('.modal__body');
  const foot = wrap.querySelector('.modal__foot');
  let busy = false;

  const onKey = (e) => { if (e.key === 'Escape' && !busy) close(); };
  document.addEventListener('keydown', onKey);

  function close() {
    document.removeEventListener('keydown', onKey);
    wrap.remove();
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
  }

  const ctl = {
    el: wrap,
    body,
    close,
    setBusy(v) {
      busy = v;
      wrap.querySelectorAll('.modal__foot .btn').forEach((b) => { b.disabled = v; });
    },
    setError(msg) {
      let box = body.querySelector('.alert--bad[data-modal-error]');
      if (!msg) { box?.remove(); return; }
      if (!box) {
        box = document.createElement('div');
        box.className = 'alert alert--bad';
        box.setAttribute('data-modal-error', '');
        box.setAttribute('role', 'alert');
        body.prepend(box);
      }
      box.textContent = msg;
    },
  };

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') && !busy) close();
  });

  actions.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${a.kind === 'primary' ? 'btn--primary' : a.kind === 'danger' ? 'btn--danger' : ''}`;
    b.textContent = a.label;
    b.addEventListener('click', async () => {
      if (!a.onClick) { close(); return; }
      b.classList.add('is-loading');
      ctl.setBusy(true);
      try {
        await a.onClick(ctl);
      } finally {
        b.classList.remove('is-loading');
        if (wrap.isConnected) ctl.setBusy(false);
      }
    });
    foot.appendChild(b);
  });

  onMount?.(ctl);
  const first = body.querySelector('input:not([type=hidden]), select, textarea');
  (first || panel).focus?.({ preventScroll: true });
  return ctl;
}

/** Pergunta de confirmação simples. Resolve true/false. */
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (!answered) { answered = true; resolve(v); } };
    const ctl = openModal({
      title,
      html: `<p>${esc(message)}</p>`,
      actions: [
        { label: 'Cancelar', onClick: (c) => { done(false); c.close(); } },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: (c) => { done(true); c.close(); } },
      ],
    });
    ctl.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) done(false); });
  });
}

/* ------------------------------ Clipboard -------------------------------- */
export async function copyText(text, okMessage = 'Copiado!') {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error('copy failed');
    }
    toast(okMessage, 'ok');
    return true;
  } catch {
    toast('Não foi possível copiar automaticamente. Selecione e copie manualmente.', 'bad');
    return false;
  }
}

/* ------------------------------- Helpers --------------------------------- */
export function countUp(el, value, ms = 700) {
  const target = Number(value) || 0;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || target === 0) {
    el.textContent = fmtInt(target);
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmtInt(Math.round(target * eased));
    if (p < 1 && el.isConnected) requestAnimationFrame(tick);
    else el.textContent = fmtInt(target);
  };
  requestAnimationFrame(tick);
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function skeletonPage() {
  return `<div class="grid grid--stats">${'<div class="card stat"><div class="skeleton" style="height:12px;width:50%"></div><div class="skeleton" style="height:30px;width:40%;margin-top:16px"></div></div>'.repeat(4)}</div>
  <div class="card"><div class="card__body"><div class="skeleton" style="height:220px"></div></div></div>`;
}

export function pagerHtml({ page, limit, total }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return `<div class="pager">
    <span>${fmtInt(from)}–${fmtInt(to)} de ${fmtInt(total)}</span>
    <div class="pager__btns">
      <button class="btn btn--sm" type="button" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Página anterior">${icon('left')}</button>
      <span>Página ${page} de ${pages}</span>
      <button class="btn btn--sm" type="button" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Próxima página">${icon('right')}</button>
    </div>
  </div>`;
}

export const ACTION_LABELS = {
  LOGIN: ['fez login', 'ok'],
  LOGIN_FAILED: ['tentativa de login falhou', 'bad'],
  LOGOUT: ['saiu do sistema', ''],
  USER_CREATED: ['criou o usuário', 'ok'],
  USER_DELETED: ['excluiu o usuário', 'bad'],
  USER_SUSPENDED: ['suspendeu o usuário', 'warn'],
  USER_REACTIVATED: ['reativou o usuário', 'ok'],
  CREDITS_ADDED: ['adicionou créditos para', 'ok'],
  CREDITS_REMOVED: ['removeu créditos de', 'warn'],
  LICENSES_GENERATED: ['gerou licenças', ''],
  LICENSE_REVOKED: ['revogou uma licença de', 'bad'],
  PASSWORD_CHANGED: ['alterou a própria senha', ''],
  PASSWORD_RESET: ['redefiniu a senha de', 'warn'],
  PROFILE_UPDATED: ['atualizou o perfil', ''],
};

/** Descrição legível de um registro de atividade (todo texto dinâmico é escapado). */
export function describeActivity(a) {
  const [verb, tone] = ACTION_LABELS[a.action] || [a.action, ''];
  const actor = a.actor_username || (a.details?.attempted_username) || 'sistema';
  let target = a.target_username || a.details?.username || '';
  if (a.target_username && a.target_username === a.actor_username) target = '';
  let extra = '';
  const d = a.details || {};
  if (a.action === 'LICENSES_GENERATED') extra = ` — ${fmtInt(d.quantity)} × ${fmtInt(d.duration_days)} dia(s), ${fmtInt(d.total_cost)} crédito(s)`;
  if (a.action === 'CREDITS_ADDED' || a.action === 'CREDITS_REMOVED') extra = ` — ${fmtInt(d.amount)} crédito(s)`;
  if (a.action === 'LICENSE_REVOKED' && d.code) extra = ` — ${d.code}`;
  if (a.action === 'USER_CREATED' && d.initial_credits) extra = ` — saldo inicial ${fmtInt(d.initial_credits)}`;
  const html = `<b>${esc(actor)}</b> ${esc(verb)}${target ? ` <b>${esc(target)}</b>` : ''}${esc(extra)}`;
  return { html, tone };
}
