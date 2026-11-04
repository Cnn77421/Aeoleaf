function isPrivatePath(requestPath) {
  let decoded;
  try { decoded = decodeURIComponent(String(requestPath).split('?')[0]); }
  catch { return true; }
  const segments = decoded.split('/');
  if (segments.some((part) => part === '.git' || part.startsWith('.env'))) return true;
  const filename = segments[segments.length - 1];
  return /\.(?:bak|backup|old|orig|save|swp)(?:[.-].*)?$|~$/i.test(filename)
    || /\.(?:db(?:-wal|-shm|-journal)?|sqlite3?|sql|aebak|pem|key|p12|pfx)$/i.test(filename);
}

function denyPrivateFiles(req, res, next) {
  if (isPrivatePath(req.path)) return res.status(404).end();
  return next();
}

module.exports = { isPrivatePath, denyPrivateFiles };
