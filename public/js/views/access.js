import { get } from '../api.js';
import { esc, icon, fmtInt, fmtDateTime, relTime, initials, debounce, pagerHtml, countUp } from '../ui.js';

const LIMIT = 20;

const FLAGS = {
  NEW_IP: ['Novo IP', 'warn', 'Primeiro acesso deste usuário com este endereço IP.'],
  NEW_DEVICE: ['Novo dispositivo', 'warn', 'Primeiro acesso deste usuário com este dispositivo e navegador.'],
  NEW_COUNTRY: ['Novo país', 'bad', 'Primeiro acesso deste usuário a partir deste país.'],
  AFTER_FAILURES: ['Após falhas', 'bad', 'Login bem-sucedido depois de 3 ou mais tentativas falhas recentes.'],
  BRUTE_FORCE: ['Força bruta', 'bad', '5 ou mais tentativas falhas em 15 minutos (mesmo usuário ou mesmo IP).'],
  UNKNOWN_USER: ['Usuário inexistente', 'muted', 'Tentativa de login com um usuário que não existe.'],
};

const REASONS = {
  INVALID_CREDENTIALS: 'Senha ou usuário incorretos',
  SUSPENDED: 'Conta suspensa',
};

const deviceIcon = (t) => (t === 'MOBILE' ? 'smartphone' : t === 'TABLET' ? 'tablet' : 'monitor');

const flagBadges = (flags) =>
  (flags || [])
    .map((f) => {
      const [label, tone, hint] = FLAGS[f] || [f, 'muted', ''];
      return `<span class="badge badge--${tone} badge--plain" title="${esc(hint)}">${esc(label)}</span>`;
    })
    .join(' ');

const place = (e) => [e.city, e.region, e.country].filter(Boolean).join(', ');

const statCard = (label, value, sub, ic, tone = '') => `
  <div class="card stat ${tone}">
    <div class="stat__label"><span>${esc(label)}</span>${icon(ic)}</div>
    <div class="stat__value" data-count="${Number(value) || 0}">0</div>
    <div class="stat__sub">${esc(sub)}</div>
  </div>`;

export async function accessView(root) {
  const q = { page: 1, search: '', filter: '' };
  let seq = 0;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Histórico de acessos</h1><p>Quem entrou, quando, de onde e com qual dispositivo. Acessos suspeitos aparecem em destaque.</p></div>
      <div class="page-head__actions"><button class="btn" type="button" id="a-refresh">${icon('refresh')} Atualizar</button></div>
    </div>
    <div class="grid grid--stats" id="a-stats"></div>
    <div class="card card--flush">
      <div class="toolbar">
        <label class="search">${icon('search')}<input class="input" id="a-search" type="search" placeholder="Buscar por usuário ou IP" autocomplete="off" aria-label="Buscar acessos"></label>
        <select class="select" id="a-filter" aria-label="Filtrar acessos">
          <option value="">Todos os acessos</option>
          <option value="success">Somente logins com sucesso</option>
          <option value="failed">Somente tentativas falhas</option>
          <option value="suspicious">Somente suspeitos</option>
        </select>
      </div>
      <div id="a-table"></div>
    </div>
    <p class="muted" style="margin-top:14px;font-size:12.5px">
      Um acesso é marcado como <b>suspeito</b> quando vem de um país novo para o usuário, quando IP e dispositivo são ambos novos,
      quando acontece após várias falhas seguidas ou quando há 5 ou mais falhas em 15 minutos. A localização é aproximada, baseada no IP.
    </p>`;

  const statsEl = root.querySelector('#a-stats');
  const holder = root.querySelector('#a-table');

  async function loadStats() {
    try {
      const { summary: s } = await get('/admin/access-logs/summary');
      statsEl.innerHTML =
        statCard('Acessos hoje', s.logins_today, `${fmtInt(s.unique_users_24h)} usuário(s) nas últimas 24 h`, 'user', 'stat--accent') +
        statCard('Tentativas falhas', s.failed_24h, 'últimas 24 horas', 'ban') +
        statCard('Acessos suspeitos', s.suspicious_24h, 'últimas 24 horas', 'alert') +
        statCard('IPs distintos', s.unique_ips_24h, 'últimas 24 horas', 'globe');
      statsEl.querySelectorAll('[data-count]').forEach((el) => countUp(el, el.dataset.count));
    } catch {
      statsEl.innerHTML = '';
    }
  }

  async function load() {
    const my = ++seq;
    holder.style.opacity = '.6';
    let data;
    try {
      data = await get('/admin/access-logs', { page: q.page, limit: LIMIT, search: q.search, filter: q.filter });
    } catch (e) {
      if (my === seq) holder.innerHTML = `<div class="empty"><strong>Erro ao carregar</strong><span>${esc(e.message)}</span></div>`;
      holder.style.opacity = '1';
      return;
    }
    if (my !== seq) return;
    holder.style.opacity = '1';

    if (!data.items.length) {
      holder.innerHTML = `<div class="empty">${icon('globe')}<strong>Nenhum acesso encontrado</strong><span>Os logins feitos a partir de agora aparecerão aqui.</span></div>`;
      return;
    }

    holder.innerHTML = `<div class="table-wrap"><table class="table stack">
      <thead><tr><th>Usuário</th><th>Data e hora</th><th>IP</th><th>Dispositivo</th><th>Navegador</th><th>Localização</th><th>Status</th></tr></thead>
      <tbody>${data.items.map((e) => `
        <tr class="${e.suspicious ? 'row--alert' : ''}">
          <td class="cell-main"><div class="user-cell"><span class="avatar avatar--sm">${esc(initials(e.username))}</span>
            <div><div class="user-cell__name">${esc(e.username)}</div>
            <div class="user-cell__sub">${e.success ? 'Login' : 'Tentativa de login'}</div></div></div></td>
          <td data-label="Data e hora" class="nowrap"><div class="num">${esc(fmtDateTime(e.created_at))}</div><div class="muted" style="font-size:12px">${esc(relTime(e.created_at))}</div></td>
          <td data-label="IP"><span class="code">${esc(e.ip || '—')}</span></td>
          <td data-label="Dispositivo"><span class="dev">${icon(deviceIcon(e.device_type))}<span>${esc(e.device || 'Desconhecido')}${e.os ? `<small>${esc(e.os)}</small>` : ''}</span></span></td>
          <td data-label="Navegador">${esc(e.browser || 'Desconhecido')}</td>
          <td data-label="Localização">${place(e) ? `<span class="dev">${icon('pin')}<span>${esc(place(e))}</span></span>` : '<span class="muted">Não identificada</span>'}</td>
          <td data-label="Status"><div class="status-cell">
            ${e.success ? '<span class="badge badge--ok">Sucesso</span>' : `<span class="badge badge--bad" title="${esc(REASONS[e.reason] || '')}">Falhou</span>`}
            ${e.suspicious ? '<span class="badge badge--bad badge--plain">Suspeito</span>' : ''}
            ${!e.success && REASONS[e.reason] ? `<small class="muted">${esc(REASONS[e.reason])}</small>` : ''}
            ${flagBadges(e.flags)}
          </div></td>
        </tr>`).join('')}</tbody></table></div>${pagerHtml({ page: data.page, limit: data.limit, total: data.total })}`;
  }

  root.querySelector('#a-search').addEventListener('input', debounce((e) => { q.search = e.target.value.trim(); q.page = 1; load(); }, 300));
  root.querySelector('#a-filter').addEventListener('change', (e) => { q.filter = e.target.value; q.page = 1; load(); });
  root.querySelector('#a-refresh').addEventListener('click', () => { loadStats(); load(); });
  holder.addEventListener('click', (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { q.page = Number(pg.dataset.page); load(); }
  });

  await Promise.all([loadStats(), load()]);
}
