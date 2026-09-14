require('dotenv').config();
const { closeDB, db, initDB } = require('../config/db');
const { initializeGeoIp, isPrivateOrLocalIp, normalizeIp, resolveGeoByIp } = require('../lib/geoIp');

async function main() {
  const reader = await initializeGeoIp();
  if (!reader) throw new Error('MaxMind database is unavailable; run npm run geo:update first');

  initDB();
  const rows = db.prepare("SELECT ip, COUNT(*) AS row_count FROM visitors WHERE TRIM(COALESCE(ip, '')) != '' GROUP BY ip").all();
  const resolved = [];
  let skipped = 0;
  for (const row of rows) {
    const ip = normalizeIp(row.ip);
    if (!ip || isPrivateOrLocalIp(ip)) {
      skipped += Number(row.row_count || 0);
      continue;
    }
    resolved.push({ ip: row.ip, rowCount: Number(row.row_count || 0), geo: await resolveGeoByIp(ip) });
  }

  const update = db.prepare(`
    UPDATE visitors
    SET country = ?, province = ?, city = ?, isp = ?,
        geo_provider = ?, geo_accuracy_km = ?, geo_updated_at = ?
    WHERE ip = ?
  `);
  const apply = db.transaction((items) => {
    for (const item of items) {
      const geo = item.geo;
      update.run(
        geo.country, geo.province, geo.city, geo.isp,
        geo.geoProvider, geo.geoAccuracyKm, geo.geoUpdatedAt,
        item.ip
      );
    }
  });
  apply(resolved);

  const updatedRows = resolved.reduce((sum, item) => sum + item.rowCount, 0);
  const maxMindRows = resolved.filter((item) => item.geo.geoProvider === 'maxmind').reduce((sum, item) => sum + item.rowCount, 0);
  const fallbackRows = updatedRows - maxMindRows;
  console.log(`[geo] rebuilt ${updatedRows} visitor rows (${maxMindRows} MaxMind, ${fallbackRows} ip2region fallback); skipped ${skipped} local/private rows`);
}

main()
  .catch((error) => {
    console.error(`[geo] rebuild failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => closeDB());
