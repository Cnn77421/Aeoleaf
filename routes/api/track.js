const router = require('express').Router();
const https = require('https');
const { db } = require('../../config/db');

function setCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
}

function parseUserAgent(ua) {
  const uaString = ua || '';
  let deviceType = 'PC';
  if (/mobile|iphone|ipod|android/i.test(uaString)) deviceType = '手机';
  if (/ipad|tablet/i.test(uaString)) deviceType = '平板';

  let osName = 'Unknown';
  let osVersion = '';
  if (/Windows NT/i.test(uaString)) {
    osName = 'Windows';
    const m = uaString.match(/Windows NT ([0-9.]+)/i);
    osVersion = m ? m[1] : '';
  } else if (/Android/i.test(uaString)) {
    osName = 'Android';
    const m = uaString.match(/Android ([0-9.]+)/i);
    osVersion = m ? m[1] : '';
  } else if (/iPhone OS|CPU OS/i.test(uaString)) {
    osName = 'iOS';
    const m = uaString.match(/(?:iPhone OS|CPU OS) ([0-9_]+)/i);
    osVersion = m ? m[1].replace(/_/g, '.') : '';
  } else if (/Mac OS X/i.test(uaString)) {
    osName = 'macOS';
    const m = uaString.match(/Mac OS X ([0-9_]+)/i);
    osVersion = m ? m[1].replace(/_/g, '.') : '';
  } else if (/Linux/i.test(uaString)) {
    osName = 'Linux';
  }

  let browserName = 'Unknown';
  let browserVersion = '';
  if (/Edg\/([0-9.]+)/i.test(uaString)) {
    browserName = 'Edge';
    browserVersion = uaString.match(/Edg\/([0-9.]+)/i)?.[1] || '';
  } else if (/Chrome\/([0-9.]+)/i.test(uaString) && !/Edg\//i.test(uaString)) {
    browserName = 'Chrome';
    browserVersion = uaString.match(/Chrome\/([0-9.]+)/i)?.[1] || '';
  } else if (/Firefox\/([0-9.]+)/i.test(uaString)) {
    browserName = 'Firefox';
    browserVersion = uaString.match(/Firefox\/([0-9.]+)/i)?.[1] || '';
  } else if (/Version\/([0-9.]+).*Safari/i.test(uaString) && !/Chrome/i.test(uaString)) {
    browserName = 'Safari';
    browserVersion = uaString.match(/Version\/([0-9.]+)/i)?.[1] || '';
  }

  return { deviceType, osName, osVersion, browserName, browserVersion };
}

function fetchGeoByIp(ip) {
  return new Promise((resolve) => {
    if (!ip) return resolve({ country: '', province: '', city: '', isp: '' });
    const url = `https://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN&fields=status,country,regionName,city,isp`;
    https.get(url, (resp) => {
      let raw = '';
      resp.on('data', (chunk) => { raw += chunk; });
      resp.on('end', () => {
        try {
          const data = JSON.parse(raw || '{}');
          if (data.status === 'success') {
            return resolve({
              country: data.country || '',
              province: data.regionName || '',
              city: data.city || '',
              isp: data.isp || ''
            });
          }
        } catch (err) {
          // Ignore geo lookup errors and fallback to blank location fields.
        }
        return resolve({ country: '', province: '', city: '', isp: '' });
      });
    }).on('error', () => resolve({ country: '', province: '', city: '', isp: '' }));
  });
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  const xrip = req.headers['x-real-ip'];
  if (typeof xrip === 'string' && xrip.trim()) return xrip.trim();
  return (req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '').replace('::ffff:', '');
}

router.options('/', (req, res) => {
  setCors(req, res);
  return res.status(204).end();
});

router.post('/', async (req, res) => {
  setCors(req, res);

  try {
    const now = Date.now();
    const body = req.body || {};
    const ua = req.headers['user-agent'] || '';
    const parsedUA = parseUserAgent(ua);
    const ip = body.publicIp || getClientIp(req);
    const geo = await fetchGeoByIp(ip);
    const trackedAt = Number(body.trackedAt) || now;
    const path = body.path || '/';

    const insert = db.prepare(`
      INSERT INTO visitors (
        fingerprint_id, session_id, ip, tracked_at, full_url, path, query_string, referer, user_agent,
        device_type, os_name, os_version, browser_name, browser_version,
        country, province, city, isp, screen_resolution, viewport_size, device_pixel_ratio,
        language, timezone, cookie_enabled, incognito, network_type, device_memory, cpu_cores,
        canvas_fp, webgl_fp, page_enter_at, page_leave_at, stay_duration_ms, max_scroll_depth, visit_path_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(body.fingerprintId || ''),
      String(body.sessionId || ''),
      String(ip || ''),
      trackedAt,
      String(body.fullUrl || ''),
      String(path),
      String(body.queryString || ''),
      String(body.referer || req.headers.referer || ''),
      ua,
      String(body.deviceType || parsedUA.deviceType),
      String(body.osName || parsedUA.osName),
      String(body.osVersion || parsedUA.osVersion),
      String(body.browserName || parsedUA.browserName),
      String(body.browserVersion || parsedUA.browserVersion),
      String(body.country || geo.country),
      String(body.province || geo.province),
      String(body.city || geo.city),
      String(body.isp || geo.isp),
      String(body.screenResolution || ''),
      String(body.viewportSize || ''),
      Number(body.devicePixelRatio || 1),
      String(body.language || ''),
      String(body.timezone || ''),
      body.cookieEnabled ? 1 : 0,
      body.incognito ? 1 : 0,
      String(body.networkType || ''),
      Number(body.deviceMemory || 0),
      Number(body.cpuCores || 0),
      String(body.canvasFp || ''),
      String(body.webglFp || ''),
      Number(body.pageEnterAt || 0),
      Number(body.pageLeaveAt || 0),
      Number(body.stayDurationMs || 0),
      Number(body.maxScrollDepth || 0),
      JSON.stringify(Array.isArray(body.visitPath) ? body.visitPath : [])
    );

    const visitorId = insert.lastInsertRowid;
    const pathEvents = Array.isArray(body.visitPath) ? body.visitPath : [];
    const insertPath = db.prepare(`
      INSERT INTO visitor_paths (visitor_id, fingerprint_id, path, full_url, ts, sequence_no)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    pathEvents.forEach((item, idx) => {
      insertPath.run(
        visitorId,
        String(body.fingerprintId || ''),
        String(item.path || path),
        String(item.fullUrl || body.fullUrl || ''),
        Number(item.ts || trackedAt),
        Number(item.sequenceNo || idx + 1)
      );
    });

    return res.json({ ok: true, visitorId });
  } catch (err) {
    console.error('track api error:', err);
    return res.status(500).json({ ok: false, error: 'Track failed', detail: err.message });
  }
});

module.exports = router;
