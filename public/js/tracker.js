(function () {
  var TRACK_URL = '/api/track';
  var FP_KEY = 'aeoleaf_device_fingerprint';
  var SID_KEY = 'aeoleaf_track_session_id';
  var PATH_KEY = 'aeoleaf_visit_path';
  var PAGE_ENTER_AT = Date.now();
  var PAGE_VIEW_ID = 'pv_' + Date.now() + '_' + Math.random().toString(16).slice(2, 10);
  var maxScrollDepth = 0;
  var enterSent = false;
  var leaveSent = false;
  var cachedFingerprintId = '';
  var memoryStore = {};

  function storageGet(key) {
    try { return localStorage.getItem(key); }
    catch (e) { return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); }
    catch (e) { memoryStore[key] = value; }
  }

  function safeString(v) { return v == null ? '' : String(v); }

  function getScreenResolution() {
    return window.screen ? window.screen.width + 'x' + window.screen.height : '';
  }

  function getViewportSize() {
    return (window.innerWidth || 0) + 'x' + (window.innerHeight || 0);
  }

  function getNetworkInfo() {
    try {
      var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!c) return { effectiveType: 'unknown', downlink: 0, rtt: 0 };
      return {
        effectiveType: (typeof c.effectiveType === 'string' && c.effectiveType) ? c.effectiveType : 'unknown',
        downlink: Number(c.downlink) || 0,
        rtt: Number(c.rtt) || 0
      };
    } catch (e) {
      return { effectiveType: 'unknown', downlink: 0, rtt: 0 };
    }
  }

  function detectIncognito() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().then(function (est) {
          return !!(est && est.quota && est.quota < 120000000);
        });
      }
    } catch (e) { /* ignore */ }
    return Promise.resolve(false);
  }

  function hashText(text) {
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.resolve(btoa(unescape(encodeURIComponent(text))).slice(0, 32));
    }
    return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }

  var _canvasFpCache = null;
  function canvasFingerprint() {
    if (_canvasFpCache !== null) return _canvasFpCache;
    try {
      var c = document.createElement('canvas'), ctx = c.getContext('2d');
      c.width = 280; c.height = 60;
      ctx.textBaseline = 'top'; ctx.font = '16px Arial';
      ctx.fillStyle = '#f60'; ctx.fillRect(10, 10, 120, 24);
      ctx.fillStyle = '#069'; ctx.fillText('aeoleaf-fp', 14, 14);
      ctx.strokeStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.arc(180, 30, 20, 0, Math.PI * 2, true); ctx.stroke();
      _canvasFpCache = c.toDataURL();
    } catch (e) { _canvasFpCache = 'canvas-unavailable'; }
    return _canvasFpCache;
  }

  var _webglFpCache = null;
  function webglFingerprint() {
    if (_webglFpCache !== null) return _webglFpCache;
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) { _webglFpCache = 'webgl-unavailable'; return _webglFpCache; }
      var d = gl.getExtension('WEBGL_debug_renderer_info');
      var vendor = d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      var renderer = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      _webglFpCache = vendor + '::' + renderer;
    } catch (e) { _webglFpCache = 'webgl-error'; }
    return _webglFpCache;
  }

  function getOrCreateSessionId() {
    var existing = storageGet(SID_KEY);
    if (existing) return existing;
    var id = 'sess_' + Date.now() + '_' + Math.random().toString(16).slice(2, 10);
    storageSet(SID_KEY, id);
    return id;
  }

  var CURRENT_PATH_ENTRY = null;
  var PATH_HISTORY_CAP = 50;

  function trackPath() {
    var list = [];
    try { list = JSON.parse(storageGet(PATH_KEY) || '[]'); if (!Array.isArray(list)) list = []; }
    catch (e) { list = []; }
    var lastSeq = list.length ? Number(list[list.length - 1].sequenceNo || list.length) : 0;
    var entry = {
      path: window.location.pathname,
      fullUrl: window.location.href,
      ts: Date.now(),
      sequenceNo: lastSeq + 1
    };
    list.push(entry);
    if (list.length > PATH_HISTORY_CAP) list = list.slice(-PATH_HISTORY_CAP);
    storageSet(PATH_KEY, JSON.stringify(list));
    CURRENT_PATH_ENTRY = entry;
  }

  function computeMaxScrollDepth() {
    var st = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    var sh = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight,
                      document.body.offsetHeight, document.documentElement.offsetHeight);
    var ch = document.documentElement.clientHeight || window.innerHeight || 1;
    maxScrollDepth = Math.max(maxScrollDepth, Math.min(100, ((st + ch) / Math.max(sh, 1)) * 100));
  }

  function getVisitPath() {
    // Only send the current page entry to the server to avoid re-inserting
    // the entire local history into `visitor_paths` on every page view.
    return CURRENT_PATH_ENTRY ? [CURRENT_PATH_ENTRY] : [];
  }

  function getCampaignData() {
    var p = new URLSearchParams(window.location.search || '');
    return { utmSource: p.get('utm_source') || '', utmMedium: p.get('utm_medium') || '', utmCampaign: p.get('utm_campaign') || '' };
  }

  function getSearchKeyword() {
    var p = new URLSearchParams(window.location.search || '');
    var d = p.get('q') || p.get('keyword') || p.get('query') || '';
    if (d) return d;
    try {
      if (!document.referrer) return '';
      var rp = new URL(document.referrer).searchParams;
      return rp.get('q') || rp.get('wd') || rp.get('query') || '';
    } catch (e) { return ''; }
  }

  function getFingerprintId() {
    var existing = storageGet(FP_KEY);
    if (existing) return Promise.resolve(existing);
    var raw = [
      navigator.userAgent, navigator.platform, navigator.language,
      getScreenResolution(),
      safeString(window.devicePixelRatio),
      safeString(navigator.deviceMemory),
      safeString(navigator.hardwareConcurrency),
      canvasFingerprint(), webglFingerprint()
    ].join('|');
    return hashText(raw).then(function (hash) {
      var fid = 'fp_' + hash;
      storageSet(FP_KEY, fid);
      return fid;
    });
  }

  function beacon(payload) {
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(TRACK_URL, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    }
  }

  function sendEnter() {
    if (enterSent) return;
    enterSent = true;
    var net = getNetworkInfo();
    Promise.all([getFingerprintId(), detectIncognito()]).then(function (results) {
      var fingerprintId = results[0], incognito = results[1];
      cachedFingerprintId = fingerprintId;
      var campaign = getCampaignData();
      beacon({
        pageViewId: PAGE_VIEW_ID,
        requestId: PAGE_VIEW_ID + '_enter_' + Date.now(),
        eventType: 'enter',
        trackedAt: Date.now(),
        sessionId: getOrCreateSessionId(),
        fullUrl: window.location.href,
        path: window.location.pathname,
        queryString: window.location.search || '',
        referer: document.referrer || '',
        screenResolution: getScreenResolution(),
        viewportSize: getViewportSize(),
        devicePixelRatio: Number(window.devicePixelRatio || 1),
        language: navigator.language || '',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        cookieEnabled: !!navigator.cookieEnabled,
        incognito: incognito,
        deviceMemory: Number(navigator.deviceMemory || 0),
        cpuCores: Number(navigator.hardwareConcurrency || 0),
        canvasFp: canvasFingerprint(),
        webglFp: webglFingerprint(),
        fingerprintId: fingerprintId,
        pageEnterAt: PAGE_ENTER_AT,
        visitPath: getVisitPath(),
        utmSource: campaign.utmSource,
        utmMedium: campaign.utmMedium,
        utmCampaign: campaign.utmCampaign,
        searchKeyword: getSearchKeyword(),
        networkType: net.effectiveType,
        downlink: net.downlink,
        rtt: net.rtt
      });
    }).catch(function () {});
  }

  function sendLeave() {
    if (leaveSent || !enterSent) return;
    leaveSent = true;
    var now = Date.now();
    beacon({
      pageViewId: PAGE_VIEW_ID,
      eventType: 'leave',
      trackedAt: now,
      pageLeaveAt: now,
      stayDurationMs: now - PAGE_ENTER_AT,
      maxScrollDepth: Number(maxScrollDepth.toFixed(2)),
      fingerprintId: cachedFingerprintId
    });
  }

  trackPath();
  computeMaxScrollDepth();
  window.addEventListener('scroll', computeMaxScrollDepth, { passive: true });
  setTimeout(sendEnter, 200);
  window.addEventListener('pagehide', sendLeave);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sendLeave();
  });
})();
