const router = require('express').Router();
const IP2Region = require('ip2region').default;
const { db } = require('../../config/db');
const { rateLimit } = require('../../middleware/rateLimit');

const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  message: 'Too many tracking requests'
});
const ip2Region = new IP2Region();

function setCors(req, res) {
  const origin = req.headers.origin;
  const configured = String(process.env.BASE_URL || '').trim();
  let allowedOrigin = '';
  try { allowedOrigin = configured ? new URL(configured).origin : ''; } catch { /* validated at startup */ }
  if (origin && origin !== allowedOrigin) return false;
  if (origin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.vary('Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
  return true;
}

function parseUserAgent(ua) {
  const s = ua || '';
  let deviceType = 'PC';
  if (/mobile|iphone|ipod|android/i.test(s)) deviceType = '手机';
  if (/ipad|tablet/i.test(s)) deviceType = '平板';

  let osName = 'Unknown', osVersion = '';
  if (/Windows NT/i.test(s)) {
    osName = 'Windows';
    osVersion = (s.match(/Windows NT ([0-9.]+)/i) || [])[1] || '';
  } else if (/Android/i.test(s)) {
    osName = 'Android';
    osVersion = (s.match(/Android ([0-9.]+)/i) || [])[1] || '';
  } else if (/iPhone OS|CPU OS/i.test(s)) {
    osName = 'iOS';
    osVersion = ((s.match(/(?:iPhone OS|CPU OS) ([0-9_]+)/i) || [])[1] || '').replace(/_/g, '.');
  } else if (/Mac OS X/i.test(s)) {
    osName = 'macOS';
    osVersion = ((s.match(/Mac OS X ([0-9_]+)/i) || [])[1] || '').replace(/_/g, '.');
  } else if (/Linux/i.test(s)) {
    osName = 'Linux';
  }

  let browserName = 'Unknown', browserVersion = '';
  if (/Edg\/([0-9.]+)/i.test(s)) {
    browserName = 'Edge';
    browserVersion = (s.match(/Edg\/([0-9.]+)/i) || [])[1] || '';
  } else if (/Chrome\/([0-9.]+)/i.test(s) && !/Edg\//i.test(s)) {
    browserName = 'Chrome';
    browserVersion = (s.match(/Chrome\/([0-9.]+)/i) || [])[1] || '';
  } else if (/Firefox\/([0-9.]+)/i.test(s)) {
    browserName = 'Firefox';
    browserVersion = (s.match(/Firefox\/([0-9.]+)/i) || [])[1] || '';
  } else if (/Version\/([0-9.]+).*Safari/i.test(s) && !/Chrome/i.test(s)) {
    browserName = 'Safari';
    browserVersion = (s.match(/Version\/([0-9.]+)/i) || [])[1] || '';
  }

  return { deviceType, osName, osVersion, browserName, browserVersion };
}

function normalizeIp(ip) {
  if (!ip) return '';
  let s = String(ip).trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  return s;
}

function isPrivateOrLocalIp(ip) {
  const s = normalizeIp(ip);
  if (!s) return true;
  if (s === '127.0.0.1' || s === '::1' || s === '0.0.0.0') return true;
  if (s.startsWith('10.')) return true;
  if (s.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(s)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(s)) return true;
  return false;
}

function resolveGeoByIp(ip) {
  const s = normalizeIp(ip);
  if (!s) return { country: '', province: '', city: '', isp: '' };
  try {
    const r = ip2Region.search(s);
    if (!r) return { country: '', province: '', city: '', isp: '' };
    return { country: r.country || '', province: r.province || '', city: r.city || '', isp: r.isp || '' };
  } catch (e) {
    console.error('[track] ip2region error for', s, e.message);
    return { country: '', province: '', city: '', isp: '' };
  }
}

function resolveVisitorIp(req) {
  return normalizeIp(req.ip || req.socket?.remoteAddress || '');
}

function readNetworkType(body) {
  if (!body || typeof body !== 'object') return '';
  const raw = body.networkType ?? body.effectiveType ?? '';
  return (typeof raw === 'string' && raw.trim()) ? raw.trim() : '';
}

function detectBot(ua) {
  return /(bot|spider|crawl|slurp|bingpreview|headless|curl|wget|python-requests|facebookexternalhit|googlebot|baiduspider)/i.test(ua || '');
}

function getOrCreateVisitorSession(fingerprintId, trackedAt, eventType, stayDurationMs) {
  const latest = db.prepare(`
    SELECT * FROM visitor_sessions WHERE fingerprint_id = ? ORDER BY id DESC LIMIT 1
  `).get(fingerprintId);

  const shouldCreate = !latest || (trackedAt - Number(latest.end_time || latest.start_time)) > 30 * 60 * 1000;
  if (shouldCreate) {
    const created = db.prepare(`
      INSERT INTO visitor_sessions (fingerprint_id, start_time, end_time, page_count, total_duration)
      VALUES (?, ?, ?, ?, ?)
    `).run(fingerprintId, trackedAt, trackedAt, eventType === 'enter' ? 1 : 0, Number(stayDurationMs || 0));
    return created.lastInsertRowid;
  }

  const nextPageCount = Number(latest.page_count || 0) + (eventType === 'enter' ? 1 : 0);
  const nextEndTime = Math.max(Number(latest.end_time || 0), trackedAt);
  const dur = Math.max(Number(latest.total_duration || 0), nextEndTime - Number(latest.start_time || trackedAt), Number(stayDurationMs || 0));
  db.prepare('UPDATE visitor_sessions SET end_time = ?, page_count = ?, total_duration = ? WHERE id = ?')
    .run(nextEndTime, nextPageCount, dur, latest.id);
  return latest.id;
}

// One-time backfill: resolve geo for existing rows with public IP but empty country
let backfillDone = false;
function backfillGeo() {
  if (backfillDone) return;
  backfillDone = true;
  try {
    const rows = db.prepare(`
      SELECT id, ip FROM visitors WHERE ip != '' AND (country IS NULL OR country = '') LIMIT 200
    `).all();
    let filled = 0;
    for (const row of rows) {
      const ip = normalizeIp(row.ip);
      if (!ip || isPrivateOrLocalIp(ip)) continue;
      const geo = resolveGeoByIp(ip);
      if (geo.country) {
        db.prepare('UPDATE visitors SET country = ?, province = ?, city = ?, isp = ? WHERE id = ?')
          .run(geo.country, geo.province, geo.city, geo.isp, row.id);
        filled++;
      }
    }
    if (filled > 0) console.log(`[track] backfilled geo for ${filled} rows`);
  } catch (e) {
    console.error('[track] backfill error:', e.message);
  }
}

router.options('/', (req, res) => {
  if (!setCors(req, res)) return res.status(403).end();
  return res.status(204).end();
});

router.post('/', trackLimiter, (req, res) => {
  if (!setCors(req, res)) return res.status(403).json({ error: 'Origin not allowed' });
  backfillGeo();
  try {
    const now = Date.now();
    const body = req.body || {};
    const eventType = String(body.eventType || 'enter');
    const pageViewId = String(body.pageViewId || '').trim();

    // --- LEAVE: update existing row ---
    if (eventType === 'leave' && pageViewId) {
      const existing = db.prepare('SELECT id FROM visitors WHERE page_view_id = ? LIMIT 1').get(pageViewId);
      if (existing) {
        db.prepare(`
          UPDATE visitors SET page_leave_at = ?, stay_duration_ms = ?, max_scroll_depth = ? WHERE id = ?
        `).run(
          Number(body.pageLeaveAt || now),
          Number(body.stayDurationMs || 0),
          Number(body.maxScrollDepth || 0),
          existing.id
        );
        const fp = String(body.fingerprintId || '').trim();
        if (fp) getOrCreateVisitorSession(fp, Number(body.trackedAt || now), 'leave', Number(body.stayDurationMs || 0));
        return res.json({ ok: true, updated: true, visitorId: existing.id });
      }
      return res.json({ ok: true, ignored: true });
    }

    // --- ENTER: insert new row ---
    const requestId = String(body.requestId || '').trim();
    if (requestId) {
      const dup = db.prepare('SELECT id FROM visitors WHERE request_id = ? LIMIT 1').get(requestId);
      if (dup) return res.json({ ok: true, duplicate: true, visitorId: dup.id });
    }

    const ua = req.headers['user-agent'] || '';
    const parsed = parseUserAgent(ua);
    const ip = resolveVisitorIp(req);
    const geo = !isPrivateOrLocalIp(ip) ? resolveGeoByIp(ip) : { country: '', province: '', city: '', isp: '' };
    const networkType = readNetworkType(body);
    const trackedAt = Number(body.trackedAt) || now;
    const path = body.path || '/';
    const fingerprintId = String(body.fingerprintId || `fp_${ip || 'unknown'}`);
    const visitorSessionId = getOrCreateVisitorSession(fingerprintId, trackedAt, 'enter', 0);
    const isBot = detectBot(ua) ? 1 : 0;

    // Dedup: same fingerprint + path within 3s
    const DEDUP_MS = 3000;
    const dupWin = db.prepare(`
      SELECT id FROM visitors WHERE fingerprint_id = ? AND path = ? AND tracked_at >= ? AND tracked_at <= ? LIMIT 1
    `).get(fingerprintId, path, trackedAt - DEDUP_MS, trackedAt + DEDUP_MS);
    if (dupWin) return res.json({ ok: true, duplicate: true, visitorId: dupWin.id, reason: 'window' });

    if (geo.country) {
      console.log(`[track] geo: ip=${ip} => ${geo.country}/${geo.province}/${geo.city}/${geo.isp}`);
    }

    const insert = db.prepare(`
      INSERT INTO visitors (
        fingerprint_id, session_id, ip, tracked_at, full_url, path, query_string, referer, user_agent,
        device_type, os_name, os_version, browser_name, browser_version,
        country, province, city, isp, screen_resolution, viewport_size, device_pixel_ratio,
        language, timezone, cookie_enabled, incognito, network_type, downlink, rtt, device_memory, cpu_cores,
        canvas_fp, webgl_fp, page_enter_at, page_leave_at, stay_duration_ms, max_scroll_depth, visit_path_json,
        request_id, event_type, user_agent_raw, http_status, request_method,
        utm_source, utm_medium, utm_campaign, search_keyword, is_bot, visitor_session_id, page_view_id
      ) VALUES (${new Array(49).fill('?').join(',')})
    `).run(
      fingerprintId,
      String(body.sessionId || ''),
      String(ip || ''),
      trackedAt,
      String(body.fullUrl || ''),
      String(path),
      String(body.queryString || ''),
      String(body.referer || req.headers.referer || ''),
      ua,
      parsed.deviceType,
      parsed.osName,
      parsed.osVersion,
      parsed.browserName,
      parsed.browserVersion,
      geo.country,
      geo.province,
      geo.city,
      geo.isp,
      String(body.screenResolution || ''),
      String(body.viewportSize || ''),
      Number(body.devicePixelRatio || 1),
      String(body.language || ''),
      String(body.timezone || ''),
      body.cookieEnabled ? 1 : 0,
      body.incognito ? 1 : 0,
      networkType,
      Number(body.downlink || 0),
      Number(body.rtt || 0),
      Number(body.deviceMemory || 0),
      Number(body.cpuCores || 0),
      String(body.canvasFp || ''),
      String(body.webglFp || ''),
      Number(body.pageEnterAt || 0),
      0,
      0,
      0,
      JSON.stringify(Array.isArray(body.visitPath) ? body.visitPath : []),
      requestId,
      'enter',
      ua,
      200,
      String(req.method || 'POST'),
      String(body.utmSource || ''),
      String(body.utmMedium || ''),
      String(body.utmCampaign || ''),
      String(body.searchKeyword || ''),
      isBot,
      visitorSessionId,
      pageViewId
    );

    const visitorId = insert.lastInsertRowid;
    const pathEvents = Array.isArray(body.visitPath) ? body.visitPath : [];
    if (pathEvents.length > 0) {
      const insertPath = db.prepare('INSERT INTO visitor_paths (visitor_id, fingerprint_id, path, full_url, ts, sequence_no) VALUES (?, ?, ?, ?, ?, ?)');
      pathEvents.forEach((item, idx) => {
        insertPath.run(visitorId, fingerprintId, String(item.path || path), String(item.fullUrl || body.fullUrl || ''), Number(item.ts || trackedAt), Number(item.sequenceNo || idx + 1));
      });
    }

    return res.json({ ok: true, visitorId, visitorSessionId });
  } catch (err) {
    console.error('[track] error:', err);
    const payload = { ok: false, error: 'Track failed' };
    if (process.env.NODE_ENV !== 'production') payload.detail = err.message;
    return res.status(500).json(payload);
  }
});

module.exports = router;
