import { esc, icon, copyText } from '../ui.js';

const SAMPLE = 'ABCD-EFGH-JKMN-PQRS';

export async function apiDocsView(root) {
  const base = location.origin;
  const curl = `curl -X POST ${base}/api/licenses/validate \\\n  -H "Content-Type: application/json" \\\n  -d '{"key":"${SAMPLE}"}'`;
  const js = `const res = await fetch("${base}/api/licenses/validate", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ key: "${SAMPLE}" }),\n});\nconst data = await res.json();\nif (data.valid) {\n  // licença ativa até data.expires_at\n} else {\n  // data.reason: LICENSE_NOT_FOUND | LICENSE_EXPIRED | LICENSE_REVOKED\n}`;
  const ok = `{\n  "valid": true,\n  "status": "ACTIVE",\n  "reason": null,\n  "message": "Licença válida.",\n  "key": "${SAMPLE}",\n  "expires_at": "2026-12-01T15:04:05.000Z",\n  "checked_at": "2026-11-08T12:00:00.000Z"\n}`;
  const bad = `{\n  "valid": false,\n  "status": "EXPIRED",\n  "reason": "LICENSE_EXPIRED",\n  "message": "A licença expirou.",\n  "key": "${SAMPLE}",\n  "expires_at": "2026-11-01T15:04:05.000Z",\n  "checked_at": "2026-11-08T12:00:00.000Z"\n}`;
  const nf = `{\n  "valid": false,\n  "status": "NOT_FOUND",\n  "reason": "LICENSE_NOT_FOUND",\n  "message": "Licença não encontrada.",\n  "expires_at": null\n}`;

  const block = (id, title, code) => `
    <div class="card" style="margin-bottom:16px"><div class="card__head"><div class="card__title">${title}</div>
      <button class="btn btn--sm" type="button" data-copy="${id}">${icon('copy')} Copiar</button></div>
      <div class="card__body"><pre id="${id}" class="mono" style="margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12.5px;line-height:1.65;color:#cfdcff">${esc(code)}</pre></div></div>`;

  root.innerHTML = `
    <div class="page-head"><div><h1>API de validação</h1><p>Consulte o estado de uma licença a partir do seu software.</p></div></div>
    <div class="card" style="margin-bottom:16px"><div class="card__body">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><span class="badge badge--info badge--plain">POST</span><span class="code">${esc(base)}/api/licenses/validate</span></div>
      <p class="muted">Endpoint público: não exige login nem chave de API. Envie JSON com o campo <span class="mono">key</span>. A consulta é limitada por IP e não expõe dados do proprietário.</p>
    </div></div>

    <div class="card card--flush" style="margin-bottom:16px"><div class="card__head" style="padding-bottom:12px"><div class="card__title">Respostas</div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>HTTP</th><th>valid</th><th>status</th><th>reason</th><th>Quando</th></tr></thead><tbody>
        <tr><td>200</td><td><span class="badge badge--ok">true</span></td><td class="mono">ACTIVE</td><td class="mono">null</td><td>Licença existe e está ativa</td></tr>
        <tr><td>200</td><td><span class="badge badge--bad">false</span></td><td class="mono">NOT_FOUND</td><td class="mono">LICENSE_NOT_FOUND</td><td>Licença não existe</td></tr>
        <tr><td>200</td><td><span class="badge badge--bad">false</span></td><td class="mono">EXPIRED</td><td class="mono">LICENSE_EXPIRED</td><td>Licença expirada</td></tr>
        <tr><td>200</td><td><span class="badge badge--bad">false</span></td><td class="mono">REVOKED</td><td class="mono">LICENSE_REVOKED</td><td>Licença revogada</td></tr>
        <tr><td>400</td><td><span class="badge badge--bad">false</span></td><td class="mono">INVALID_FORMAT</td><td class="mono">INVALID_FORMAT</td><td>Chave fora do formato XXXX-XXXX-XXXX-XXXX</td></tr>
        <tr><td>429</td><td><span class="badge badge--bad">false</span></td><td class="mono">RATE_LIMITED</td><td class="mono">RATE_LIMITED</td><td>Limite de consultas por minuto excedido</td></tr>
        <tr><td>503</td><td><span class="badge badge--bad">false</span></td><td class="mono">ERROR</td><td class="mono">SERVICE_UNAVAILABLE</td><td>Falha temporária — tente novamente</td></tr>
      </tbody></table></div></div>

    ${block('d-curl', 'Exemplo — cURL', curl)}
    ${block('d-js', 'Exemplo — JavaScript', js)}
    ${block('d-ok', 'Resposta — licença válida', ok)}
    ${block('d-bad', 'Resposta — licença expirada', bad)}
    ${block('d-nf', 'Resposta — licença inexistente', nf)}
    <p class="muted">Documentação completa de todos os endpoints: arquivo <span class="mono">docs/API.md</span> do projeto.</p>`;

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (b) copyText(root.querySelector(`#${b.dataset.copy}`).textContent, 'Copiado!');
  });
}
