const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUserAgent } = require('../src/lib/useragent');
const { countryName, isPrivateIp } = require('../src/lib/geo');

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.67',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
};

test('iPhone + Safari', () => {
  assert.deepEqual(parseUserAgent(UA.iphone), { device: 'iPhone', deviceType: 'MOBILE', os: 'iOS 17', browser: 'Safari 17' });
});
test('iPhone + Chrome (CriOS)', () => {
  const r = parseUserAgent(UA.iphoneChrome);
  assert.equal(r.device, 'iPhone');
  assert.equal(r.browser, 'Chrome 124');
});
test('Android celular e Samsung Internet', () => {
  assert.deepEqual(parseUserAgent(UA.android), { device: 'Android', deviceType: 'MOBILE', os: 'Android 14', browser: 'Chrome 124' });
  assert.equal(parseUserAgent(UA.samsung).browser, 'Samsung Internet 23');
});
test('Windows com Chrome e Edge', () => {
  assert.deepEqual(parseUserAgent(UA.winChrome), { device: 'Windows', deviceType: 'DESKTOP', os: 'Windows 10/11', browser: 'Chrome 124' });
  assert.equal(parseUserAgent(UA.winEdge).browser, 'Edge 124');
});
test('Mac, Linux/Firefox e iPad', () => {
  assert.equal(parseUserAgent(UA.mac).device, 'Mac');
  assert.equal(parseUserAgent(UA.mac).browser, 'Safari 17');
  assert.deepEqual(parseUserAgent(UA.firefox), { device: 'Linux', deviceType: 'DESKTOP', os: 'Linux', browser: 'Firefox 125' });
  assert.equal(parseUserAgent(UA.ipad).deviceType, 'TABLET');
});
test('UA vazio ou inválido não quebra', () => {
  assert.deepEqual(parseUserAgent(''), { device: null, deviceType: 'OTHER', os: null, browser: null });
  assert.equal(parseUserAgent(undefined).deviceType, 'OTHER');
  assert.equal(parseUserAgent('x'.repeat(5000)).deviceType, 'OTHER');
});
test('geo: nome do país e IPs privados', () => {
  assert.equal(countryName('BR'), 'Brasil');
  assert.equal(countryName('xx1'), null);
  assert.equal(isPrivateIp('192.168.0.5'), true);
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('186.205.19.172'), false);
});
