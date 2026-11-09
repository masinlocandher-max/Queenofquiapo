const PHOTO_LIMIT = 5 * 1024 * 1024;
const REQUEST_LIMIT = PHOTO_LIMIT * 2 + 65536;
const CONSENT_VERSION = 'screening-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERENCE = /^QOQ-[A-F0-9]{16}$/;
const APPLICATIONS = '/api/reviewer/applications';
const SAFE_RESPONSE = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

class IntakeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function reject(status, message) { throw new IntakeError(status, message); }
function json(data, status = 200) {
  return Response.json(data, {status, headers: SAFE_RESPONSE});
}

function requireSameOrigin(request) {
  const target = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  let caller = origin;
  if (!origin && request.headers.get('referer')) {
    try { caller = new URL(request.headers.get('referer')).origin; } catch {}
  }
  if (caller !== target || request.headers.get('sec-fetch-site') === 'cross-site') {
    reject(403, 'Please open the form on the Queen of Quiapo website and try again.');
  }
}

function requireReviewer(request, env) {
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  if (!id || !email) reject(401, 'Sign in to review applications.');
  if (!env.REVIEWER_EMAIL || email !== env.REVIEWER_EMAIL.trim().toLowerCase()) {
    reject(403, 'This area is reserved for the pageant organizer.');
  }
}

const encode = new TextEncoder();
async function digest(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
}

async function readMultipart(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) reject(415, 'Use the candidate application form.');
  if (Number(request.headers.get('content-length')) > REQUEST_LIMIT) reject(413, 'Each photograph must be 5 MB or smaller.');
  const reader = request.body?.getReader();
  if (!reader) reject(400, 'The application is empty.');
  const parts = [];
  let length = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > REQUEST_LIMIT) {
      await reader.cancel().catch(() => {});
      reject(413, 'Each photograph must be 5 MB or smaller.');
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of parts) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return await new Response(bytes, {headers: {'Content-Type': contentType}}).formData();
  } catch {
    reject(400, 'The upload is incomplete. Select both photographs and try again.');
  }
}

function field(form, name, max, optional = false) {
  const entries = form.getAll(name);
  if (!entries.length && optional) return '';
  if (entries.length !== 1 || typeof entries[0] !== 'string') reject(422, 'Check the application fields and try again.');
  const value = entries[0].trim();
  if ((!value && !optional) || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    reject(422, 'Check the application fields and their character limits.');
  }
  return value;
}

function measurement(form, name) {
  const value = field(form, name, 8);
  if (!/^\d{1,3}(\.\d)?$/.test(value) || Number(value) <= 0) {
    reject(422, 'Use positive numbers for your height and measurements.');
  }
  return Number(value);
}

function starts(bytes, sequence, at = 0) {
  return sequence.every((value, i) => bytes[at + i] === value);
}

function imageType(bytes) {
  // Accept closed JPEG and PNG containers; match RIFF size and known WebP codecs.
  if (bytes.length >= 16 && starts(bytes, [255,216,255]) && starts(bytes, [255,217], bytes.length - 2)) return 'image/jpeg';
  if (bytes.length >= 45 && starts(bytes, [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]) &&
      starts(bytes, [0,0,0,0,73,69,78,68,174,66,96,130], bytes.length - 12)) return 'image/png';
  if (bytes.length >= 26 && starts(bytes,[82,73,70,70]) && starts(bytes,[87,69,66,80,86,80,56],8) &&
      [32,76,88].includes(bytes[15]) && new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4,true) + 8 === bytes.length) return 'image/webp';
  return '';
}

async function photo(form, key) {
  const files = form.getAll(key);
  const file = files[0];
  if (files.length !== 1 || typeof file?.arrayBuffer !== 'function' || !file.size) {
    reject(422, key === 'portrait' ? 'Attach a close-up photograph.' : 'Attach a full-body swimsuit photograph.');
  }
  if (file.size > PHOTO_LIMIT) reject(413, 'Each photograph must be 5 MB or smaller.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = imageType(bytes);
  if (!type) reject(415, 'Upload a complete JPEG, PNG or WebP photograph.');
  return {bytes, type};
}

function objectKey(reference, kind) {
  return 'candidate-applications/' + reference + '/' + kind;
}
function keys(reference) {
  return [objectKey(reference, 'portrait'), objectKey(reference, 'swimsuit')];
}

function receiptForRetry(row, fingerprint) {
  if (row.fingerprint !== fingerprint) reject(409, 'This submission ID was already used. Reload the form for a new application.');
  return json({reference: row.reference});
}

// Transitional adapter for the current private site. Selection is explicit and never depends on an RPC failure.
async function legacyIntakeRpc(db, action, d) {
  if (!db) throw Error('Legacy application database unavailable');
  let sql, bindings;
  switch (action) {
  case 'find':
    sql='SELECT reference,fingerprint FROM applications WHERE request_key=?';bindings=[d.requestKey];break;
  case 'create': {
    const p=d.profile;
    sql='INSERT INTO applications (reference,request_key,fingerprint,storage_key,submitted_at,legal_name,female_name,email,mobile,locality,height_cm,bust_in,waist_in,hips_in,talent,experience,motivation,consent_version,portrait_type,swimsuit_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(request_key) DO NOTHING RETURNING reference';
    bindings=[d.reference,d.requestKey,d.fingerprint,d.storageKey,new Date().toISOString(),p.legalName,p.femaleName,p.email,p.mobile,p.locality,p.heightCm,p.bustIn,p.waistIn,p.hipsIn,p.talent,p.experience,p.motivation,p.consentVersion,d.portraitType,d.swimsuitType];break;
  }
  case 'withdrawal':
    sql='SELECT reference,storage_key AS storageKey FROM applications WHERE reference=? AND request_key=?';bindings=[d.reference,d.requestKey];break;
  case 'details':
    sql='SELECT reference,storage_key AS storageKey,submitted_at AS submittedAt,legal_name AS legalName,female_name AS femaleName,email,mobile,locality,height_cm AS heightCm,bust_in AS bustIn,waist_in AS waistIn,hips_in AS hipsIn,talent,experience,motivation,consent_version AS consentVersion,portrait_type AS portraitType,swimsuit_type AS swimsuitType FROM applications WHERE reference=?';bindings=[d.reference];break;
  case 'remove':
    await db.prepare('DELETE FROM applications WHERE reference=? AND storage_key=?').bind(d.reference,d.storageKey).run();
    return {ok:true};
  case 'list': {
    const result=await db.prepare('SELECT id,reference,female_name AS femaleName,locality,submitted_at AS submittedAt FROM applications WHERE id < ? ORDER BY id DESC LIMIT ?').bind(d.cursor||Number.MAX_SAFE_INTEGER,d.limit+1).all();
    const rows=result.results.slice(0,d.limit);
    return {applications:rows.map(({id,...value})=>value),nextCursor:result.results.length>d.limit?rows.at(-1).id:null};
  }
  default: throw Error('Unknown intake operation');
  }
  return await db.prepare(sql).bind(...bindings).first() || {};
}

function intakeRpc(env, action, data) {
  if (env.QOQ_INTAKE_BACKEND === 'legacy') return legacyIntakeRpc(env.DB,action,data);
  return qoqRpc(env,'qoq_intake',{p_action:action,p_data:data});
}

async function submit(request, env) {
  requireSameOrigin(request);
  const form = await readMultipart(request);
  const allowed = new Set(['legalName','femaleName','email','mobile','locality','heightCm','bustIn','waistIn','hipsIn',
    'talent','experience','motivation','consent','portrait','swimsuit','submissionId']);
  for (const key of form.keys()) if (!allowed.has(key)) reject(422, 'The application includes an unsupported field.');
  const id = field(form,'submissionId',36);
  if (!UUID.test(id)) reject(422, 'Reload the application form and try again.');
  if (field(form,'consent',3) !== 'yes') reject(422, 'Please confirm the screening consent.');
  const legalName = field(form,'legalName',120), femaleName = field(form,'femaleName',120);
  const email = field(form,'email',254).toLowerCase(), mobile = field(form,'mobile',32,true);
  const locality = field(form,'locality',120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) reject(422, 'Check your email address.');
  const profile = {legalName,femaleName,email,mobile,locality,heightCm:measurement(form,'heightCm'),bustIn:measurement(form,'bustIn'),
    waistIn:measurement(form,'waistIn'),hipsIn:measurement(form,'hipsIn'),talent:field(form,'talent',160,true),
    experience:field(form,'experience',240,true),motivation:field(form,'motivation',600,true),consentVersion:CONSENT_VERSION};
  const portrait = await photo(form,'portrait'), swimsuit = await photo(form,'swimsuit');
  const [portraitHash, swimsuitHash, requestKey] = await Promise.all([
    digest(portrait.bytes), digest(swimsuit.bytes), digest(encode.encode(id))
  ]);
  const fingerprint = await digest(encode.encode(JSON.stringify([
    Object.values(profile),portraitHash,swimsuitHash,request.headers.get('oai-authenticated-user-id') || ''
  ])));
  const find = () => intakeRpc(env,'find',{requestKey});
  const prior = await find();
  if (prior.reference) return receiptForRetry(prior, fingerprint);

  const reference = 'QOQ-' + crypto.randomUUID().replaceAll('-','').slice(0,16).toUpperCase();
  const storageKey = crypto.randomUUID();
  const owned = keys(storageKey);
  // A distinct storage prefix for each concurrent attempt keeps losing retries from overwriting a winner.
  let inserting = false;
  try {
    await mediaStore(env).put(owned[0], portrait.bytes, {httpMetadata:{contentType:portrait.type}});
    await mediaStore(env).put(owned[1], swimsuit.bytes, {httpMetadata:{contentType:swimsuit.type}});
    inserting = true;
    const result = await intakeRpc(env,'create',{reference,requestKey,fingerprint,storageKey,profile,portraitType:portrait.type,swimsuitType:swimsuit.type});
    if (result.reference) return json({reference:result.reference},201);
  } catch (err) {
    if (inserting) {
      // A database acknowledgement can be lost after commit. Preserve a committed record and its uploads.
      const saved = await find();
      if (saved?.reference === reference) return receiptForRetry(saved, fingerprint);
    }
    await mediaStore(env).delete(owned);
    throw err;
  }
  await mediaStore(env).delete(owned);
  const winner = await find();
  if (winner.reference) return receiptForRetry(winner,fingerprint);
  reject(503, 'The application could not be saved. Please retry.');
}

async function removeApplication(env, row) {
  await mediaStore(env).delete(keys(row.storageKey));
  await intakeRpc(env,'remove',{reference:row.reference,storageKey:row.storageKey});
  return json({ok:true});
}

async function withdraw(request,env,reference) {
  requireSameOrigin(request);
  const token = request.headers.get('x-application-token') || '';
  if (!REFERENCE.test(reference) || !UUID.test(token)) reject(404,'Application not found.');
  const key = await digest(encode.encode(token));
  const row = await intakeRpc(env,'withdrawal',{reference,requestKey:key});
  if (!row.reference) reject(404,'Application not found.');
  return removeApplication(env,row);
}

async function review(request, env, pathname) {
  requireReviewer(request,env);
  const suffix = pathname.slice(APPLICATIONS.length);
  if (!suffix && request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const cursor = params.get('cursor'), rawLimit = params.get('limit') || '25';
    if ((cursor != null && (!/^\d{1,15}$/.test(cursor) || Number(cursor)<1)) ||
        !/^\d{1,2}$/.test(rawLimit) || Number(rawLimit)<1 || Number(rawLimit)>50) reject(400, 'Invalid page parameters.');
    const limit = Number(rawLimit);
    return json(await intakeRpc(env,'list',{cursor:cursor?Number(cursor):null,limit}));
  }
  const parts = suffix.split('/').slice(1);
  const [reference, kind] = parts;
  if (!REFERENCE.test(reference || '') || parts.length>2 || (parts.length===2 && !['portrait','swimsuit'].includes(kind))) reject(404, 'Application not found.');
  if (request.method !== 'GET' && !(request.method==='DELETE' && parts.length===1)) reject(405, 'Method not allowed.');
  if (request.method==='DELETE') requireSameOrigin(request);
  const row = await intakeRpc(env,'details',{reference});
  if (!row.reference) reject(404,'Application not found.');
  if (request.method==='DELETE') return removeApplication(env,row);
  if (kind) {
    const object = await mediaStore(env).get(objectKey(row.storageKey,kind));
    if (!object) reject(404,'Photograph not found.');
    return new Response(object.body, {headers:{...SAFE_RESPONSE,
      'Content-Type': kind==='portrait' ? row.portraitType : row.swimsuitType,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline'
    }});
  }
  const {storageKey,portraitType,swimsuitType,...application} = row;
  return json({application});
}

export async function handleApi(request,env) {
  try {
    const path = new URL(request.url).pathname;
    if (path === '/api/applications') {
      if (request.method !== 'POST') reject(405,'Method not allowed.');
      return await submit(request,env);
    }
    if (request.method==='DELETE' && path.startsWith('/api/applications/')) {
      return await withdraw(request,env,path.slice('/api/applications/'.length));
    }
    if (path===APPLICATIONS || path.startsWith(APPLICATIONS+'/')) return await review(request,env,path);
    reject(404,'Not found.');
  } catch (error) {
    if (error instanceof IntakeError) return json({error:error.message},error.status);
    // Keep applicant details, raw files and backend errors out of responses and logs.
    return json({error:'The service is temporarily unavailable. Please try again.'},503);
  }
}
