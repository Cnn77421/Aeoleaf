const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPrivateOrLocalIp,
  normalizeIp,
  resolveWithReaders
} = require('../lib/geoIp');

test('normalizes mapped IPv4 addresses and rejects private/local ranges', () => {
  assert.equal(normalizeIp('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(isPrivateOrLocalIp('127.0.0.1'), true);
  assert.equal(isPrivateOrLocalIp('192.168.1.8'), true);
  assert.equal(isPrivateOrLocalIp('172.31.0.8'), true);
  assert.equal(isPrivateOrLocalIp('8.8.8.8'), false);
});

test('uses localized MaxMind city data and keeps ip2region ISP', () => {
  const maxMindReader = {
    city() {
      return {
        country: { isoCode: 'US', names: { en: 'United States', 'zh-CN': '美国' } },
        subdivisions: [{ names: { en: 'California', 'zh-CN': '加利福尼亚州' } }],
        city: { names: { en: 'Los Angeles', 'zh-CN': '洛杉矶' } },
        location: { accuracyRadius: 20 }
      };
    }
  };
  const fallbackReader = { search: () => ({ country: '美国', province: '', city: '', isp: 'Example ISP' }) };
  const result = resolveWithReaders('8.8.8.8', maxMindReader, fallbackReader);
  assert.deepEqual(
    {
      country: result.country,
      province: result.province,
      city: result.city,
      isp: result.isp,
      provider: result.geoProvider,
      accuracy: result.geoAccuracyKm
    },
    {
      country: '美国',
      province: '加利福尼亚州',
      city: '洛杉矶',
      isp: 'Example ISP',
      provider: 'maxmind',
      accuracy: 20
    }
  );
});

test('falls back to ip2region when MaxMind has no province or city', () => {
  const maxMindReader = {
    city: () => ({ country: { isoCode: 'CN', names: { en: 'China', 'zh-CN': '中国' } } })
  };
  const fallbackReader = {
    search: () => ({ country: '中国', province: '浙江省', city: '杭州市', isp: '示例网络' })
  };
  const result = resolveWithReaders('8.8.8.8', maxMindReader, fallbackReader);
  assert.equal(result.geoProvider, 'ip2region');
  assert.equal(result.city, '杭州市');
});
