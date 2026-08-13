const PLACEHOLDER_SECRETS = new Set([
  'change-this-secret',
  'change-this-to-a-long-random-string'
]);

function validateRuntimeConfig(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const trustProxyRaw = String(env.TRUST_PROXY || 'false').trim().toLowerCase();
  const trustProxy = trustProxyRaw === 'false' ? false : Number.parseInt(trustProxyRaw, 10);
  const trustProxyValid = trustProxy === false || (Number.isInteger(trustProxy) && trustProxy >= 1 && trustProxy <= 10);
  if (!isProd) {
    if (!trustProxyValid) throw new Error('TRUST_PROXY must be false or an integer from 1 to 10');
    return { isProd: false, baseUrl: String(env.BASE_URL || '').trim(), trustProxy };
  }

  const errors = [];
  const baseUrl = String(env.BASE_URL || '').trim();
  const sessionSecret = String(env.SESSION_SECRET || '');
  const adminPassword = String(env.ADMIN_PASSWORD || '');

  let parsedBaseUrl = null;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    errors.push('BASE_URL must be an absolute HTTPS URL');
  }
  if (parsedBaseUrl && parsedBaseUrl.protocol !== 'https:') {
    errors.push('BASE_URL must use HTTPS in production');
  }
  if (sessionSecret.length < 24 || PLACEHOLDER_SECRETS.has(sessionSecret)) {
    errors.push('SESSION_SECRET must be a non-placeholder random string of at least 24 characters');
  }
  if (adminPassword.length < 8) {
    errors.push('ADMIN_PASSWORD must contain at least 8 characters');
  }
  if (env.SESSION_COOKIE_SECURE !== 'true') {
    errors.push('SESSION_COOKIE_SECURE must be true in production');
  }
  if (!Object.prototype.hasOwnProperty.call(env, 'TRUST_PROXY') || !trustProxyValid) {
    errors.push('TRUST_PROXY must be explicitly set to false or an integer from 1 to 10');
  }

  if (errors.length) {
    const err = new Error(`Invalid production configuration:\n- ${errors.join('\n- ')}`);
    err.code = 'INVALID_RUNTIME_CONFIG';
    throw err;
  }

  return { isProd: true, baseUrl: parsedBaseUrl.toString().replace(/\/$/, ''), trustProxy };
}

module.exports = { validateRuntimeConfig };
