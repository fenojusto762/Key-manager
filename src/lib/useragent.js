/**
 * Interpreta o User-Agent sem dependências externas.
 * Retorna { device, deviceType, os, browser } em texto legível (ex.: "iPhone", "iOS 17", "Safari 17").
 * deviceType: MOBILE | TABLET | DESKTOP | OTHER
 */
function major(v) {
  return v ? String(v).split(/[._]/)[0] : '';
}

function parseOs(ua) {
  let m;
  if ((m = ua.match(/Windows NT (\d+\.\d+)/))) {
    const map = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
    return { os: `Windows ${map[m[1]] || m[1]}`, family: 'Windows' };
  }
  if (/Windows/.test(ua)) return { os: 'Windows', family: 'Windows' };
  if ((m = ua.match(/(?:iPhone|CPU) OS (\d+)[._]/)) && /iPhone|iPad|iPod/.test(ua)) {
    return { os: `iOS ${m[1]}`, family: 'iOS' };
  }
  if (/iPhone|iPad|iPod/.test(ua)) return { os: 'iOS', family: 'iOS' };
  if ((m = ua.match(/Android (\d+(?:\.\d+)?)/))) return { os: `Android ${major(m[1])}`, family: 'Android' };
  if (/Android/.test(ua)) return { os: 'Android', family: 'Android' };
  if (/CrOS/.test(ua)) return { os: 'ChromeOS', family: 'ChromeOS' };
  if (/Mac OS X|Macintosh/.test(ua)) return { os: 'macOS', family: 'macOS' };
  if (/Linux|X11/.test(ua)) return { os: 'Linux', family: 'Linux' };
  return { os: null, family: null };
}

function parseBrowser(ua) {
  const rules = [
    [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)|Opera\/(\d+)/, 'Opera'],
    [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
    [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
    [/Vivaldi\/(\d+)/, 'Vivaldi'],
    [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
    [/Version\/(\d+)[^]*Safari\//, 'Safari'],
  ];
  for (const [re, name] of rules) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1] || m[2]}`;
  }
  if (/Safari\//.test(ua)) return 'Safari';
  if (/curl\//i.test(ua)) return 'curl';
  if (/PostmanRuntime/i.test(ua)) return 'Postman';
  return null;
}

function parseUserAgent(raw) {
  const ua = typeof raw === 'string' ? raw.slice(0, 400) : '';
  if (!ua) return { device: null, deviceType: 'OTHER', os: null, browser: null };

  const { os, family } = parseOs(ua);
  const browser = parseBrowser(ua);

  let device = null;
  let deviceType = 'OTHER';
  if (/iPhone|iPod/.test(ua)) { device = 'iPhone'; deviceType = 'MOBILE'; }
  else if (/iPad/.test(ua)) { device = 'iPad'; deviceType = 'TABLET'; }
  else if (family === 'Android') {
    const tablet = !/Mobile/.test(ua);
    device = tablet ? 'Android (tablet)' : 'Android';
    deviceType = tablet ? 'TABLET' : 'MOBILE';
  } else if (family === 'Windows') { device = 'Windows'; deviceType = 'DESKTOP'; }
  else if (family === 'macOS') { device = 'Mac'; deviceType = 'DESKTOP'; }
  else if (family === 'ChromeOS') { device = 'Chromebook'; deviceType = 'DESKTOP'; }
  else if (family === 'Linux') { device = 'Linux'; deviceType = 'DESKTOP'; }
  else if (browser === 'curl' || browser === 'Postman') { device = 'Script/API'; }

  return { device, deviceType, os, browser };
}

module.exports = { parseUserAgent };
