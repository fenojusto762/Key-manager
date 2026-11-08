import { get } from '../api.js';
import { esc, icon, fmtDate, pagerHtml, describeActivity, ACTION_LABELS } from '../ui.js';

const LIMIT = 25;

export async function activityView(root) {
  const q = { page: 1, action: '' };
  let seq = 0;

  root.innerHTML = `
    <div class="page-head"><div><h1>Atividades</h1><p>Trilha de auditoria de todas as operações do sistema.</p></div></div>
    <div class="card card--flush">
      <div class="toolbar">
        <select class="select" id="a-action" aria-label="Filtrar por tipo">
          <option value="">Todas as atividades</option>
          ${Object.entries(ACTION_LABELS).map(([k]) => `<option value="${k}">${esc(k.replaceAll('_', ' ').toLowerCase())}</option>`).join('')}
        </select>
      </div>
      <div id="a-table"></div>
    </div>`;

  const holder = root.querySelector('#a-table');

  async function load() {
    const my = ++seq;
    holder.style.opacity = '.6';
    let data;
    try {
      data = await get('/admin/activity', { page: q.page, limit: LIMIT, action: q.action });
    } catch (e) {
      if (my === seq) holder.innerHTML = `<div class="empty"><strong>Erro ao carregar</strong><span>${esc(e.message)}</span></div>`;
      holder.style.opacity = '1';
      return;
    }
    if (my !== seq) return;
    holder.style.opacity = '1';
    if (!data.items.length) {
      holder.innerHTML = `<div class="empty">${icon('activity')}<strong>Nenhuma atividade encontrada</strong></div>`;
      return;
    }
    holder.innerHTML = `<ul class="timeline" style="padding:8px 0">${data.items.map((a) => {
      const d = describeActivity(a);
      return `<li><span class="timeline__dot ${d.tone ? `timeline__dot--${d.tone}` : ''}"></span>
        <div><div class="timeline__text">${d.html}</div><div class="timeline__time">${esc(fmtDate(a.created_at))}</div></div></li>`;
    }).join('')}</ul>${pagerHtml({ page: data.page, limit: data.limit, total: data.total })}`;
  }

  root.querySelector('#a-action').addEventListener('change', (e) => { q.action = e.target.value; q.page = 1; load(); });
  holder.addEventListener('click', (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { q.page = Number(pg.dataset.page); load(); }
  });
  await load();
}
