const crypto = require('crypto');

let serverModule;
async function webauthn() {
  if (!serverModule) serverModule = import('@simplewebauthn/server');
  return serverModule;
}

function relyingParty(req) {
  const configured = String(process.env.BASE_URL || '').trim().replace(/\/+$/, '');
  const origin = configured || `${req.protocol}://${req.get('host')}`;
  const parsed = new URL(origin);
  return { rpID: parsed.hostname, origin: parsed.origin, rpName: 'Aeoleaf Admin' };
}

function passkeys(db) {
  return db.prepare('SELECT * FROM admin_passkeys ORDER BY created_at DESC').all().map((row) => ({
    ...row, transports: JSON.parse(row.transports || '[]')
  }));
}

function userId(db) {
  const existing = db.prepare("SELECT value FROM settings WHERE key = 'passkey_user_id'").get()?.value;
  if (existing) return Buffer.from(existing, 'base64url');
  const generated = crypto.randomBytes(32);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('passkey_user_id', ?)").run(generated.toString('base64url'));
  return generated;
}

async function registrationOptions(db, req) {
  const { generateRegistrationOptions } = await webauthn();
  const rp = relyingParty(req);
  const options = await generateRegistrationOptions({
    rpName: rp.rpName, rpID: rp.rpID, userName: 'administrator', userID: new Uint8Array(userId(db)),
    attestationType: 'none', supportedAlgorithmIDs: [-7, -257],
    excludeCredentials: passkeys(db).map((key) => ({ id: key.id, transports: key.transports })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }
  });
  req.session.passkeyRegistrationChallenge = options.challenge;
  return options;
}

async function verifyRegistration(db, req, response, name) {
  const { verifyRegistrationResponse } = await webauthn();
  const expectedChallenge = req.session.passkeyRegistrationChallenge;
  if (!expectedChallenge) throw new Error('注册挑战已过期');
  const rp = relyingParty(req);
  const verification = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID });
  delete req.session.passkeyRegistrationChallenge;
  if (!verification.verified || !verification.registrationInfo) return false;
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  db.prepare(`INSERT INTO admin_passkeys (id, public_key, counter, transports, device_type, backed_up, name)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(credential.id, Buffer.from(credential.publicKey), credential.counter, JSON.stringify(credential.transports || []), credentialDeviceType, credentialBackedUp ? 1 : 0, String(name || '通行密钥').slice(0, 80));
  return true;
}

async function authenticationOptions(db, req) {
  const { generateAuthenticationOptions } = await webauthn();
  const rp = relyingParty(req);
  const keys = passkeys(db);
  if (!keys.length) throw new Error('尚未注册通行密钥');
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID, userVerification: 'required',
    allowCredentials: keys.map((key) => ({ id: key.id, transports: key.transports }))
  });
  req.session.passkeyAuthenticationChallenge = options.challenge;
  return options;
}

async function verifyAuthentication(db, req, response) {
  const { verifyAuthenticationResponse } = await webauthn();
  const expectedChallenge = req.session.passkeyAuthenticationChallenge;
  if (!expectedChallenge) throw new Error('登录挑战已过期');
  const key = db.prepare('SELECT * FROM admin_passkeys WHERE id = ?').get(response.id);
  if (!key) throw new Error('通行密钥不存在');
  const rp = relyingParty(req);
  const verification = await verifyAuthenticationResponse({
    response, expectedChallenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID,
    credential: { id: key.id, publicKey: new Uint8Array(key.public_key), counter: key.counter, transports: JSON.parse(key.transports || '[]') }
  });
  delete req.session.passkeyAuthenticationChallenge;
  if (!verification.verified) return false;
  db.prepare("UPDATE admin_passkeys SET counter = ?, last_used_at = datetime('now', 'localtime') WHERE id = ?")
    .run(verification.authenticationInfo.newCounter, key.id);
  return true;
}

module.exports = { passkeys, registrationOptions, verifyRegistration, authenticationOptions, verifyAuthentication };
