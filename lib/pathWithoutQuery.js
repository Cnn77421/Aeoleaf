/**
 * Normalized path without query string or trailing slash (except root).
 * @param {import('express').Request} req
 * @returns {string}
 */
function pathWithoutQuery(req) {
  let u = req.originalUrl || req.url || '';
  const q = u.indexOf('?');
  if (q >= 0) u = u.slice(0, q);
  if (u.length > 1 && u.endsWith('/')) u = u.slice(0, -1);
  return u;
}

module.exports = { pathWithoutQuery };
