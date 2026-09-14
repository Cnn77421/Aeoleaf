const fs = require('fs');
const path = require('path');
const IP2Region = require('ip2region').default;

const ip2Region = new IP2Region();
let maxMindReaderPromise = null;
let missingDatabaseWarningShown = false;

function emptyGeo() {
  return {
    country: '',
    province: '',
    city: '',
    isp: '',
    geoProvider: '',
    geoAccuracyKm: 0,
    geoUpdatedAt: 0
  };
}

function normalizeIp(ip) {
  if (!ip) return '';
  let value = String(ip).trim();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  return value;
}

function isPrivateOrLocalIp(ip) {
  const value = normalizeIp(ip);
  if (!value) return true;
  if (value === '127.0.0.1' || value === '::1' || value === '0.0.0.0') return true;
  if (value.startsWith('10.') || value.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(value)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(value)) return true;
  return false;
}

function localizedName(record) {
  return String(record?.names?.['zh-CN'] || record?.names?.en || '').trim();
}

function lookupIp2Region(ip, reader = ip2Region) {
  try {
    const result = reader.search(ip);
    if (!result) return emptyGeo();
    return {
      country: String(result.country || ''),
      province: String(result.province || ''),
      city: String(result.city || ''),
      isp: String(result.isp || ''),
      geoProvider: 'ip2region',
      geoAccuracyKm: 0,
      geoUpdatedAt: Date.now()
    };
  } catch (error) {
    console.error('[geo] ip2region lookup failed:', error.message);
    return emptyGeo();
  }
}

function resolveWithReaders(ip, maxMindReader, fallbackReader = ip2Region) {
  const value = normalizeIp(ip);
  if (!value || isPrivateOrLocalIp(value)) return emptyGeo();

  const fallback = lookupIp2Region(value, fallbackReader);
  if (!maxMindReader) return fallback;

  try {
    const result = maxMindReader.city(value);
    const countryRecord = result.country || result.registeredCountry;
    const subdivision = Array.isArray(result.subdivisions) && result.subdivisions.length
      ? result.subdivisions[result.subdivisions.length - 1]
      : null;
    const maxMindGeo = {
      country: localizedName(countryRecord) || String(countryRecord?.isoCode || ''),
      province: localizedName(subdivision),
      city: localizedName(result.city),
      isp: fallback.isp,
      geoProvider: 'maxmind',
      geoAccuracyKm: Math.max(0, Number(result.location?.accuracyRadius || 0)),
      geoUpdatedAt: Date.now()
    };

    // GeoLite sometimes knows only the country. In that case the existing
    // China-oriented database can still provide a more useful province/city.
    if (!maxMindGeo.city && (fallback.city || fallback.province)) return fallback;
    return maxMindGeo.country || maxMindGeo.province || maxMindGeo.city ? maxMindGeo : fallback;
  } catch (error) {
    // AddressNotFound is normal for newly allocated or special-purpose ranges.
    if (error?.name !== 'AddressNotFoundError') {
      console.error('[geo] MaxMind lookup failed:', error.message);
    }
    return fallback;
  }
}

function configuredDatabasePath() {
  const configured = String(process.env.MAXMIND_DB_PATH || '').trim();
  return configured ? path.resolve(configured) : '';
}

async function initializeGeoIp() {
  const databasePath = configuredDatabasePath();
  if (!databasePath || !fs.existsSync(databasePath)) {
    if (databasePath && !missingDatabaseWarningShown) {
      console.warn(`[geo] MaxMind database not found at ${databasePath}; using ip2region fallback`);
      missingDatabaseWarningShown = true;
    }
    return null;
  }

  if (!maxMindReaderPromise) {
    maxMindReaderPromise = import('@maxmind/geoip2-node')
      .then(({ Reader }) => Reader.open(databasePath, {
        watchForUpdates: true,
        watchForUpdatesNonPersistent: true
      }))
      .then((reader) => {
        console.log(`[geo] MaxMind GeoLite2 City loaded from ${databasePath}`);
        return reader;
      })
      .catch((error) => {
        maxMindReaderPromise = null;
        console.error(`[geo] unable to load MaxMind database: ${error.message}`);
        return null;
      });
  }
  return maxMindReaderPromise;
}

async function resolveGeoByIp(ip) {
  const value = normalizeIp(ip);
  if (!value || isPrivateOrLocalIp(value)) return emptyGeo();
  const maxMindReader = await initializeGeoIp();
  return resolveWithReaders(value, maxMindReader);
}

module.exports = {
  emptyGeo,
  initializeGeoIp,
  isPrivateOrLocalIp,
  normalizeIp,
  resolveGeoByIp,
  resolveWithReaders
};
