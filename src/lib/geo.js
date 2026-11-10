/**
 * Localização aproximada a partir do IP.
 * 1) Usa os cabeçalhos que a própria Vercel injeta (x-vercel-ip-*): sem custo e sem chamada externa.
 * 2) Fora da Vercel (ex.: desenvolvimento), tenta o serviço ipwho.is com timeout curto.
 * Nunca lança erro: sem localização, devolve campos nulos.
 */
const BR_STATES = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

let regionNames = null;
function countryName(code) {
  if (!code) return null;
  const c = String(code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  try {
    regionNames = regionNames || new Intl.DisplayNames(['pt-BR'], { type: 'region' });
    return regionNames.of(c) || c;
  } catch {
    return c;
  }
}

function safeDecode(v) {
  if (!v) return null;
  try {
    return decodeURIComponent(String(v)).slice(0, 80) || null;
  } catch {
    return String(v).slice(0, 80);
  }
}

function isPrivateIp(ip) {
  if (!ip) return true;
  const v = ip.replace(/^::ffff:/, '');
  return (
    v === '::1' || v === '127.0.0.1' || /^10\./.test(v) || /^192\.168\./.test(v) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v) || /^169\.254\./.test(v) || /^f[cd]/i.test(v) || /^fe80/i.test(v)
  );
}

function fromHeaders(req) {
  const code = req.get('x-vercel-ip-country');
  if (!code) return null;
  const regionCode = safeDecode(req.get('x-vercel-ip-country-region'));
  const region = code.toUpperCase() === 'BR' && regionCode ? BR_STATES[regionCode.toUpperCase()] || regionCode : regionCode;
  return { country: countryName(code), region, city: safeDecode(req.get('x-vercel-ip-city')) };
}

async function fromLookup(ip) {
  if (isPrivateIp(ip)) return null;
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?lang=pt-BR&fields=success,country,region,city`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || j.success === false) return null;
    return { country: j.country || null, region: j.region || null, city: j.city || null };
  } catch {
    return null;
  }
}

async function locate(req, ip) {
  const empty = { country: null, region: null, city: null };
  return fromHeaders(req) || (await fromLookup(ip)) || empty;
}

module.exports = { locate, countryName, isPrivateIp };
