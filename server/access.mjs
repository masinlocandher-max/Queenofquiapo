// Staff sign-in that does not need a ChatGPT account.
//
//   Organizer: the REVIEWER_EMAIL address + a password (12+ characters).
//   Judges:    their assigned email + an access code the organizer issues, resets or revokes from the desk.
//   ChatGPT sign-in, where the hosting provides it, still works as an optional alternative.
//
// Secrets are hashed here with PBKDF2-SHA256 (100,000 iterations, random salt); the database stores only the hash.
// A successful sign-in sets a host-only cookie (__Host-, HttpOnly, Secure, SameSite=Strict) signed with a key
// derived from QOQ_SERVER_SECRET. Every request re-checks the credential version in the database, so resetting a
// code or changing a password ends existing sessions at once.
const SESSION_COOKIE = '__Host-qoq_session';
const SESSION_HOURS = {organizer: 12, judge: 16};
const PBKDF2_ITERATIONS = 100000;   // the highest count Cloudflare Workers allow
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no I, L, O, 0 or 1 to misread
const identities = new WeakMap();

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const fromB64url = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - text.length % 4) % 4)), c => c.charCodeAt(0));
const sameBytes = (a, b) => { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]; return diff === 0; };
const normalizeCode = code => String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');

async function pbkdf2(secret, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encode.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations}, key, 256));
}
async function hashSecret(secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return 'pbkdf2-sha256$' + PBKDF2_ITERATIONS + '$' + b64url(salt) + '$' + b64url(await pbkdf2(secret, salt, PBKDF2_ITERATIONS));
}
async function verifySecret(secret, stored) {
  const parts = /^pbkdf2-sha256\$(\d{5,7})\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(stored || '');
  if (!parts || Number(parts[1]) > PBKDF2_ITERATIONS) { await pbkdf2(secret, new Uint8Array(16), PBKDF2_ITERATIONS); return false; }   // same cost either way
  return sameBytes(await pbkdf2(secret, fromB64url(parts[2]), Number(parts[1])), fromB64url(parts[3]));
}
function newAccessCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));   // 12 characters of 31: about 59 bits
  let code = ''; for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];   // 256 % 31 bias is under 1 in 8; immaterial with lockout
  return code.slice(0, 4) + '-' + code.slice(4, 8) + '-' + code.slice(8);
}

const sessionKeys = new Map();
async function sessionKey(env) {
  if (typeof env.QOQ_SERVER_SECRET !== 'string' || env.QOQ_SERVER_SECRET.length < 32) return null;
  if (!sessionKeys.has(env.QOQ_SERVER_SECRET)) {
    const root = await crypto.subtle.importKey('raw', encode.encode(env.QOQ_SERVER_SECRET), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
    const derived = await crypto.subtle.sign('HMAC', root, encode.encode('qoq-staff-session-v1'));
    sessionKeys.set(env.QOQ_SERVER_SECRET, await crypto.subtle.importKey('raw', derived, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']));
  }
  return sessionKeys.get(env.QOQ_SERVER_SECRET);
}
async function sessionCookie(env, {email, role, version}) {
  const now = Math.floor(Date.now() / 1000), maxAge = SESSION_HOURS[role] * 3600;
  const payload = b64url(encode.encode(JSON.stringify({e: email, r: role, v: version, iat: now, exp: now + maxAge})));
  const signature = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await sessionKey(env), encode.encode(payload))));
  return SESSION_COOKIE + '=' + payload + '.' + signature + '; Path=/; Max-Age=' + maxAge + '; HttpOnly; Secure; SameSite=Strict';
}
const clearedCookie = () => SESSION_COOKIE + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';
async function readSession(request, env) {
  const raw = (request.headers.get('cookie') || '').split(/;\s*/).find(part => part.startsWith(SESSION_COOKIE + '='));
  const match = /^([A-Za-z0-9_-]{10,600})\.([A-Za-z0-9_-]{43})$/.exec(raw ? raw.slice(SESSION_COOKIE.length + 1) : '');
  const key = match && await sessionKey(env);
  if (!key || !await crypto.subtle.verify('HMAC', key, fromB64url(match[2]), encode.encode(match[1]))) return null;
  let session; try { session = JSON.parse(new TextDecoder().decode(fromB64url(match[1]))); } catch { return null; }
  const now = Date.now() / 1000;
  if (!session || !['organizer', 'judge'].includes(session.r) || typeof session.e !== 'string' || !Number.isSafeInteger(session.v) ||
      !(session.exp > now) || !(session.iat <= now + 60)) return null;
  return session;
}
const isReviewer = (env, email) => Boolean(email && env.REVIEWER_EMAIL && email === env.REVIEWER_EMAIL.trim().toLowerCase());

// Establishes who is calling, once per request. ChatGPT identity headers are set by the hosting platform, never by a browser.
async function resolveIdentity(request, env) {
  if (identities.has(request)) return identities.get(request);
  let identity = headerIdentity(request, env);
  if (!identity.actor) {
    const session = await readSession(request, env);
    if (session) {
      try {
        const check = await qoqRpc(env, 'qoq_access', {p_actor: '', p_email: '', p_organizer: false, p_action: 'verify', p_data: {email: session.e, role: session.r, version: session.v}});
        if (check.valid === true) identity = {actor: 'qoq:' + session.r + ':' + session.e, email: session.e, organizer: session.r === 'organizer' && isReviewer(env, session.e), via: 'session', role: session.r};
      } catch { identity = {...identity, unavailable: true}; }
    }
  }
  identities.set(request, identity);
  return identity;
}
function headerIdentity(request, env) {
  const actor = request.headers.get('oai-authenticated-user-id') || '';
  const email = (request.headers.get('oai-authenticated-user-email') || '').trim().toLowerCase();
  return actor && email ? {actor, email, organizer: isReviewer(env, email), via: 'chatgpt', role: null} : {actor: '', email: '', organizer: false, via: null, role: null};
}

const accessRpc = (env, action, data, identity = {actor: '', email: '', organizer: false}) =>
  qoqRpc(env, 'qoq_access', {p_actor: identity.actor, p_email: identity.email, p_organizer: identity.organizer, p_action: action, p_data: data});

// /api/access/*
async function access(request, env, path, area) {
  const identity = await resolveIdentity(request, env);
  if (path === '/api/access/me') {
    if (request.method !== 'GET') reject(405, 'Method not allowed.');
    return json({signedIn: Boolean(identity.actor), email: identity.email || null, via: identity.via, role: identity.role, organizer: identity.organizer});
  }
  if (request.method !== 'POST') reject(405, 'Method not allowed.');
  requireSameOrigin(request);
  if (path === '/api/access/logout') return new Response(JSON.stringify({ok: true}), {headers: {...SAFE_RESPONSE, 'Content-Type': 'application/json', 'Set-Cookie': clearedCookie()}});

  if (path === '/api/access/login') {
    await edgeLimit(request, env, 'login', 30, 600);
    const input = await smallJson(request);
    const role = area === 'org' ? 'organizer' : area === 'judge' ? 'judge' : area === 'preview' ? input.role : null;
    if (!['organizer', 'judge'].includes(role)) reject(404, 'Not found.');
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const secret = typeof input.secret === 'string' ? (role === 'judge' ? normalizeCode(input.secret) : input.secret) : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !secret || secret.length > 200) reject(422, 'Enter your email and ' + (role === 'judge' ? 'access code.' : 'password.'));
    const wrong = role === 'judge' ? 'That email and access code do not match an assigned judge.' : 'That email and password are not correct.';
    const known = role === 'organizer' && !isReviewer(env, email) ? {} : await accessRpc(env, 'credential', {email, role});
    if (known.locked) reject(429, 'Too many attempts. Try again in 15 minutes.');
    const ok = await verifySecret(secret, known.hash);   // runs the full hash even when the account does not exist
    if (!known.hash) reject(401, wrong);
    const result = await accessRpc(env, 'attempt', {email, role, ok});
    if (result.locked) reject(429, 'Too many attempts. Try again in 15 minutes.');
    if (!ok || !Number.isSafeInteger(result.version)) reject(401, wrong);
    return new Response(JSON.stringify({ok: true, role}), {status: 200, headers: {...SAFE_RESPONSE, 'Content-Type': 'application/json',
      'Set-Cookie': await sessionCookie(env, {email, role, version: result.version})}});
  }

  // Organizer-only credential management. A browser never supplies a hash.
  if (!['org', 'preview'].includes(area)) reject(404, 'Not found.');
  if (!identity.actor) reject(401, 'Sign in to manage access.');
  if (!identity.organizer) reject(403, 'This area is reserved for the pageant organizer.');
  const input = await smallJson(request);
  if (path === '/api/access/judge-code') {
    if (!UUID.test(input.judgeId || '')) reject(422, 'Choose a judge.');
    const code = newAccessCode();
    await accessRpc(env, 'organizer.setJudgeCode', {judgeId: input.judgeId, hash: await hashSecret(normalizeCode(code))}, identity);
    return json({code});
  }
  if (path === '/api/access/password') {
    const next = typeof input.password === 'string' ? input.password : '';
    if (next.length < 12 || next.length > 200) reject(422, 'Use a password of at least 12 characters.');
    const local = identity.email.split('@')[0];
    if ((local.length >= 4 && next.toLowerCase().includes(local)) || /^(.)\1+$/.test(next)) reject(422, 'Choose a password that does not contain your email name or repeat one character.');
    if (identity.via === 'session') {
      // A stolen session must not be enough to take over the account.
      const current = await accessRpc(env, 'credential', {email: identity.email, role: 'organizer'});
      if (!await verifySecret(typeof input.current === 'string' ? input.current : '', current.hash)) reject(401, 'Your current password is not correct.');
    }
    await accessRpc(env, 'organizer.setPassword', {hash: await hashSecret(next)}, identity);
    const fresh = await accessRpc(env, 'credential', {email: identity.email, role: 'organizer'});
    const headers = {...SAFE_RESPONSE, 'Content-Type': 'application/json'};
    if (identity.via === 'session') headers['Set-Cookie'] = await sessionCookie(env, {email: identity.email, role: 'organizer', version: fresh.version});
    return new Response(JSON.stringify({ok: true}), {headers});
  }
  reject(404, 'Not found.');
}
