require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DOWNLOAD_URL = 'https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz';

function findDatabase(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findDatabase(candidate);
      if (nested) return nested;
    } else if (entry.name === 'GeoLite2-City.mmdb') {
      return candidate;
    }
  }
  return '';
}

async function main() {
  const accountId = String(process.env.MAXMIND_ACCOUNT_ID || '').trim();
  const licenseKey = String(process.env.MAXMIND_LICENSE_KEY || '').trim();
  const configuredPath = String(process.env.MAXMIND_DB_PATH || '').trim();
  if (!accountId || !licenseKey || !configuredPath) {
    throw new Error('MAXMIND_ACCOUNT_ID, MAXMIND_LICENSE_KEY and MAXMIND_DB_PATH are required');
  }

  const targetPath = path.resolve(configuredPath);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeoleaf-geolite-'));
  const stagedPath = `${targetPath}.new-${process.pid}`;
  try {
    const response = await fetch(DOWNLOAD_URL, {
      headers: { Authorization: `Basic ${Buffer.from(`${accountId}:${licenseKey}`).toString('base64')}` },
      redirect: 'follow'
    });
    if (!response.ok) throw new Error(`MaxMind download failed with HTTP ${response.status}`);

    const archivePath = path.join(tempDir, 'GeoLite2-City.tar.gz');
    fs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
    const extracted = spawnSync('tar', ['-xzf', archivePath, '-C', tempDir], { encoding: 'utf8' });
    if (extracted.status !== 0) throw new Error(`Unable to extract GeoLite2 archive: ${extracted.stderr || extracted.stdout}`);

    const sourcePath = findDatabase(tempDir);
    if (!sourcePath) throw new Error('GeoLite2-City.mmdb was not present in the downloaded archive');
    const { Reader } = await import('@maxmind/geoip2-node');
    const reader = await Reader.open(sourcePath);
    reader.city('8.8.8.8');

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, stagedPath);
    fs.chmodSync(stagedPath, 0o600);
    fs.renameSync(stagedPath, targetPath);
    console.log(`[geo] GeoLite2 City updated: ${targetPath}`);
  } finally {
    if (fs.existsSync(stagedPath)) fs.rmSync(stagedPath, { force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[geo] update failed: ${error.message}`);
  process.exitCode = 1;
});
