import { api, get, post, setSessionExpiredHandler, ApiError } from './api.js';
import { esc, icon, initials, fmtInt, roleBadge, toast, skeletonPage } from './ui.js';
import { dashboardView } from './views/dashboard.js';
import { usersView } from './views/users.js';
import { generateView } from './views/generate.js';
import { licensesView } from './views/licenses.js';
import { activityView } from './views/activity.js';
import { apiDocsView } from './views/apidocs.js';
import { profileView } from './views/profile.js';

const $ = (s) => document.querySelector(s);

const state = { user: null, plans: [], maxQuantity: 100, cleanup: null, renderId: 0 };

const NAV = [
  { path: 'dashboard', label: (u) => (u.role === 'ADMIN' ? 'Dashboard' : 'Meu painel'), icon: 'dashboard', view: dashboardView },
  { path: 'users', label: () => 'Usuários', icon: 'users', view: usersView, admin: true },
  { path: 'generate', label: () => 'Gerar licença', icon: 'key', view: generateView },
  { path: 'licenses', label: (u) => (u.role === 'ADMIN' ? 'Todas as licenças' : 'Minhas licenças'), icon: 'list', view: licensesView },
  { path: 'activity', label: () => 'Atividades', icon: 'activity', view: activityView, admin: true },
  { path: 'api', label: () => 'API', icon: 'code', view: apiDocsView },
  { path: 'profile', label: () => 'Perfil', icon: 'user', view: profileView },
];

const visibleNav = () => NAV.filter((n) => !n.admin || state.user?.role === 'ADMIN');

/* ------------------------------ Contexto --------------------------------- */
const ctx = {
  get user() { return state.user; },
  get plans() { return state.plans; },
  get maxQuantity() { return state.maxQuantity; },
  navigate(path) { location.hash = `#/${path}`; },
  async refreshUser() {
    const { user } = await get('/me');
    state.user = user;
    renderChrome();
    return user;
  },
  setUser(user) {
    state.user = user;
    renderChrome();
  },
};

/* ------------------------------ Telas ------------------------------------ */
function showLogin(message) {
  state.user = null;
  state.cleanup?.();
  state.cleanup = null;
  document.body.classList.remove('nav-open');
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  const err = $('#login-error');
  if (message) { err.textContent = message; err.hidden = false; } else { err.hidden = true; }
  $('#login-password').value = '';
  setTimeout(() => $('#login-username').focus(), 50);
}

function currentPath() {
  return (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
}

function renderChrome() {
  const u = state.user;
  if (!u) return;
  const path = currentPath();

  $('#sidebar').innerHTML = `
    <div class="brand"><span class="brand__mark" aria-hidden="true"></span><span class="brand__name">KEY<b>MANAGER</b></span></div>
    <nav class="nav">
      <div class="nav__label">${u.role === 'ADMIN' ? 'Administração' : 'Painel'}</div>
      ${visibleNav().map((n) => `<a href="#/${n.path}" data-nav="${n.path}" class="${n.path === path ? 'is-active' : ''}">${icon(n.icon)}<span>${esc(n.label(u))}</span></a>`).join('')}
    </nav>
    <div class="me-card">
      <div class="me-card__row">
        <span class="avatar">${esc(initials(u.username))}</span>
        <div style="min-width:0">
          <div class="me-card__name">${esc(u.display_name || u.username)}</div>
          <div class="me-card__sub">@${esc(u.username)}</div>
        </div>
        <span style="margin-left:auto">${roleBadge(u.role)}</span>
      </div>
      <button class="btn btn--sm btn--block" id="logout-btn" type="button" style="height:34px">${icon('logout')} Sair</button>
    </div>`;

  const item = visibleNav().find((n) => n.path === path) || visibleNav()[0];
  $('#topbar').innerHTML = `
    <button class="icon-btn menu-btn" id="menu-btn" type="button" aria-label="Abrir menu">${icon('menu')}</button>
    <h2 class="topbar__title">${esc(item.label(u))}</h2>
    <button class="credit-pill" id="credit-pill" type="button" title="Gerar licenças">${icon('coins')}<span class="num">${fmtInt(u.credits)}</span> créditos</button>`;
}

async function route() {
  if (!state.user) return;
  const nav = visibleNav();
  const item = nav.find((n) => n.path === currentPath()) || nav[0];

  state.cleanup?.();
  state.cleanup = null;
  document.body.classList.remove('nav-open');
  renderChrome();

  const id = ++state.renderId;
  const page = document.createElement('div');
  page.className = 'page';
  page.innerHTML = skeletonPage();
  $('#view').replaceChildren(page);
  window.scrollTo({ top: 0 });

  try {
    const cleanup = await item.view(page, ctx);
    if (id === state.renderId) state.cleanup = cleanup || null;
    else if (typeof cleanup === 'function') cleanup();
  } catch (e) {
    if (id !== state.renderId) return;
    if (e instanceof ApiError && e.status === 401) return; // handler de sessão expirada já tratou
    page.innerHTML = `<div class="card"><div class="empty">
      <strong>Não foi possível carregar esta página</strong>
      <span>${esc(e.message || 'Erro inesperado.')}</span>
      <button class="btn btn--sm" type="button" id="retry-btn">Tentar novamente</button></div></div>`;
    page.querySelector('#retry-btn').addEventListener('click', route);
  }
}

async function enterApp(user) {
  state.user = user;
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  try {
    const { plans, max_quantity } = await get('/licenses/plans');
    state.plans = plans;
    state.maxQuantity = max_quantity;
  } catch (e) {
    toast(e.message, 'bad');
  }
  if (!location.hash) location.hash = '#/dashboard';
  route();
}

/* ------------------------------ Eventos ---------------------------------- */
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-submit');
  const err = $('#login-error');
  err.hidden = true;
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  if (!username || !password) {
    err.textContent = 'Informe usuário e senha.';
    err.hidden = false;
    return;
  }
  btn.classList.add('is-loading');
  btn.disabled = true;
  try {
    const { user } = await post('/auth/login', { username, password });
    await enterApp(user);
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
});

document.addEventListener('click', async (e) => {
  if (e.target.closest('#logout-btn')) {
    try { await post('/auth/logout'); } catch { /* segue para a tela de login */ }
    location.hash = '';
    showLogin();
  } else if (e.target.closest('#menu-btn')) {
    document.body.classList.toggle('nav-open');
  } else if (e.target.closest('#scrim')) {
    document.body.classList.remove('nav-open');
  } else if (e.target.closest('#credit-pill')) {
    ctx.navigate('generate');
  } else if (e.target.closest('[data-nav]')) {
    document.body.classList.remove('nav-open');
  }
});

window.addEventListener('hashchange', route);

setSessionExpiredHandler(() => {
  if (state.user) showLogin('Sua sessão expirou. Entre novamente.');
});

/* -------------------------------- Boot ----------------------------------- */
(async function boot() {
  try {
    const { user } = await api('GET', '/me', { silent: true });
    await enterApp(user);
  } catch {
    showLogin();
  } finally {
    const boot = $('#boot');
    boot.classList.add('is-done');
    setTimeout(() => boot.remove(), 400);
  }
})();
