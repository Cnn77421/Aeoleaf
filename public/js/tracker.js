(function () {
  const TRACK_URL = '/api/track';
  const FP_KEY = 'aeoleaf_device_fingerprint';
  const SID_KEY = 'aeoleaf_track_session_id';
  const PATH_KEY = 'aeoleaf_visit_path';
  const PAGE_ENTER_AT = Date.now();
  let maxScrollDepth = 0;
  const memoryStore = {};

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      memoryStore[key] = value;
      return false;
    }
  }

  function safeString(value) {
    if (value === null || value === undefined) return '';
    return String(value);
  }

  function getScreenResolution() {
    return window.screen ? `${window.screen.width}x${window.screen.height}` : '';
  }

  function getViewportSize() {
    return `${window.innerWidth || 0}x${window.innerHeight || 0}`;
  }

  function getNetworkType() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return conn && conn.effectiveType ? conn.effectiveType : 'unknown';
  }

  async function detectIncognito() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        if (estimate && estimate.quota && estimate.quota < 120000000) return true;
      }
    } catch (e) {
      // ignore
    }
    return false;
  }

  function hashText(text) {
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.resolve(btoa(unescape(encodeURIComponent(text))).slice(0, 32));
    }
    const data = new TextEncoder().encode(text);
    return window.crypto.subtle.digest('SHA-256', data).then((buf) => {
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    });
  }

  function canvasFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 280;
      canvas.height = 60;
      ctx.textBaseline = 'top';
      ctx.font = '16px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(10, 10, 120, 24);
      ctx.fillStyle = '#069';
      ctx.fillText('aeoleaf-fp', 14, 14);
      ctx.strokeStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.arc(180, 30, 20, 0, Math.PI * 2, true);
      ctx.stroke();
      return canvas.toDataURL();
    } catch (e) {
      return 'canvas-unavailable';
    }
  }

  function webglFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return 'webgl-unavailable';
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return `${vendor}::${renderer}`;
    } catch (e) {
      return 'webgl-error';
    }
  }

  async function getPublicIp() {
    try {
      const resp = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
      const data = await resp.json();
      return data && data.ip ? data.ip : '';
    } catch (e) {
      return '';
    }
  }

  function getOrCreateSessionId() {
    const existing = storageGet(SID_KEY);
    if (existing) return existing;
    const id = `sess_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    storageSet(SID_KEY, id);
    return id;
  }

  function trackPath() {
    let list = [];
    try {
      list = JSON.parse(storageGet(PATH_KEY) || '[]');
      if (!Array.isArray(list)) list = [];
    } catch (e) {
      list = [];
    }
    const item = {
      path: window.location.pathname,
      fullUrl: window.location.href,
      ts: Date.now(),
      sequenceNo: list.length + 1
    };
    list.push(item);
    if (list.length > 500) list = list.slice(-500);
    storageSet(PATH_KEY, JSON.stringify(list));
    return list;
  }

  function computeMaxScrollDepth() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const scrollHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight
    );
    const clientHeight = document.documentElement.clientHeight || window.innerHeight || 1;
    const ratio = ((scrollTop + clientHeight) / Math.max(scrollHeight, 1)) * 100;
    maxScrollDepth = Math.max(maxScrollDepth, Math.min(100, ratio));
  }

  function getVisitPath() {
    try {
      const val = JSON.parse(storageGet(PATH_KEY) || '[]');
      return Array.isArray(val) ? val : [];
    } catch (e) {
      return [];
    }
  }

  async function getFingerprintId() {
    const existing = storageGet(FP_KEY);
    if (existing) return existing;

    const canvasFp = canvasFingerprint();
    const webglFp = webglFingerprint();
    const raw = [
      navigator.userAgent,
      navigator.platform,
      navigator.language,
      getScreenResolution(),
      getViewportSize(),
      safeString(window.devicePixelRatio),
      safeString(navigator.deviceMemory),
      safeString(navigator.hardwareConcurrency),
      canvasFp,
      webglFp
    ].join('|');
    const hash = await hashText(raw);
    const fid = `fp_${hash}`;
    storageSet(FP_KEY, fid);
    return fid;
  }

  async function sendTracking(useBeacon) {
    const visitPath = getVisitPath();
    const pageLeaveAt = Date.now();
    const stayDurationMs = pageLeaveAt - PAGE_ENTER_AT;
    const canvasFp = canvasFingerprint();
    const webglFp = webglFingerprint();
    const [fingerprintId, publicIp, incognito] = await Promise.all([
      getFingerprintId(),
      getPublicIp(),
      detectIncognito()
    ]);

    const payload = {
      eventType: useBeacon ? 'leave' : 'enter',
      trackedAt: Date.now(),
      sessionId: getOrCreateSessionId(),
      publicIp: publicIp,
      fullUrl: window.location.href,
      path: window.location.pathname,
      queryString: window.location.search || '',
      referer: document.referrer || '',
      userAgent: navigator.userAgent,
      deviceType: /mobile|iphone|ipod|android/i.test(navigator.userAgent) ? '手机' : (/ipad|tablet/i.test(navigator.userAgent) ? '平板' : 'PC'),
      osName: navigator.platform || '',
      osVersion: '',
      browserName: '',
      browserVersion: '',
      screenResolution: getScreenResolution(),
      viewportSize: getViewportSize(),
      devicePixelRatio: Number(window.devicePixelRatio || 1),
      language: navigator.language || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      cookieEnabled: !!navigator.cookieEnabled,
      incognito: incognito,
      networkType: getNetworkType(),
      deviceMemory: Number(navigator.deviceMemory || 0),
      cpuCores: Number(navigator.hardwareConcurrency || 0),
      canvasFp: canvasFp,
      webglFp: webglFp,
      fingerprintId: fingerprintId,
      pageEnterAt: PAGE_ENTER_AT,
      pageLeaveAt: pageLeaveAt,
      stayDurationMs: stayDurationMs,
      maxScrollDepth: Number(maxScrollDepth.toFixed(2)),
      visitPath: visitPath
    };

    const body = JSON.stringify(payload);
    if (useBeacon && navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(TRACK_URL, blob);
      return;
    }

    try {
      await fetch(TRACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      });
    } catch (e) {
      // ignore tracking transport errors
    }
  }

  trackPath();
  computeMaxScrollDepth();
  window.addEventListener('scroll', computeMaxScrollDepth, { passive: true });
  setTimeout(function () { sendTracking(false); }, 1500);
  window.addEventListener('pagehide', function () { sendTracking(true); });
  window.addEventListener('beforeunload', function () { sendTracking(true); });
})();
