// Provider-independent payment layer. Production default: OFF.
//
// Three independent switches must all be on before an order can be created:
//   1. QOQ_PAYMENTS_ENABLED=yes on the Worker (deployment authorization)
//   2. a known adapter in QOQ_PAYMENT_PROVIDER with QOQ_PAYMENT_WEBHOOK_SECRET (32+ characters)
//   3. settings.payments_enabled, an approved package catalog and settings.payment_provider in the database
// Points are credited only by the database, only from a webhook whose signature was verified here.
//
// An adapter implements:
//   allowed(env, area)                 -> boolean, optional extra restriction
//   createCheckout(order, env)         -> {providerRef, checkoutUrl}
//   verify(request, rawBody, env)      -> normalized event, or null when the signature is not valid
// A normalized event is {eventId, type, orderRef, amountCentavos, currency, providerRef} with
// type in processing | paid | failed | expired | cancelled | refunded | reversed.
const PAYMENT_EVENT_TYPES = new Set(['processing','paid','failed','expired','cancelled','refunded','reversed']);
const ORDER_REF = /^QV-[A-F0-9]{32}$/;

async function hmacValid(secret, message, hexSignature) {
  if (!/^[a-f0-9]{64}$/.test(hexSignature || '')) return false;
  const key = await crypto.subtle.importKey('raw', encode.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['verify']);
  const signature = Uint8Array.from(hexSignature.match(/../g), byte => parseInt(byte, 16));
  return crypto.subtle.verify('HMAC', key, signature, encode.encode(message)); // constant-time comparison
}

const paymentAdapters = {
  // Rehearsal adapter. It moves no money and is refused on every production hostname.
  sandbox: {
    allowed: (env, area) => env.QOQ_ALLOW_SANDBOX_PAYMENTS === 'yes' && area === 'preview',
    async createCheckout(order) { return {providerRef: 'sbx_' + order.orderRef.slice(3).toLowerCase(), checkoutUrl: null}; },
    async verify(request, raw, env) {
      const header = request.headers.get('x-qoq-signature') || '';
      const parts = Object.fromEntries(header.split(',').map(part => part.split('=').map(text => text.trim())).filter(pair => pair.length === 2));
      const sent = Number(parts.t);
      if (!Number.isSafeInteger(sent) || Math.abs(Date.now() / 1000 - sent) > 300) return null; // replay window
      if (!await hmacValid(env.QOQ_PAYMENT_WEBHOOK_SECRET, parts.t + '.' + raw, parts.v1)) return null;
      let body; try { body = JSON.parse(raw); } catch { return null; }
      return {eventId: body.id, type: body.type, orderRef: body.orderRef, amountCentavos: body.amountCentavos, currency: body.currency, providerRef: body.providerRef};
    }
  }
};

function paymentProvider(env, area) {
  const name = env.QOQ_PAYMENT_PROVIDER;
  if (typeof name !== 'string' || !Object.hasOwn(paymentAdapters, name)) return null;
  if (typeof env.QOQ_PAYMENT_WEBHOOK_SECRET !== 'string' || env.QOQ_PAYMENT_WEBHOOK_SECRET.length < 32) return null;
  const adapter = paymentAdapters[name];
  if (adapter.allowed && !adapter.allowed(env, area)) return null;
  return {name, ...adapter};
}
const paymentsLive = (env, area) => env.QOQ_PAYMENTS_ENABLED === 'yes' && Boolean(paymentProvider(env, area));

function normalizedEvent(event) {
  if (!event || typeof event.eventId !== 'string' || !event.eventId || event.eventId.length > 200) return null;
  if (!PAYMENT_EVENT_TYPES.has(event.type) || !ORDER_REF.test(event.orderRef || '')) return null;
  const amount = event.amountCentavos;
  if (amount != null && (!Number.isSafeInteger(amount) || amount < 0)) return null;
  if (event.providerRef != null && (typeof event.providerRef !== 'string' || event.providerRef.length > 200)) return null;
  return {eventId: event.eventId, type: event.type, orderRef: event.orderRef, amountCentavos: amount ?? null,
    currency: typeof event.currency === 'string' ? event.currency.toUpperCase().slice(0, 3) : null, providerRef: event.providerRef || null};
}

// POST /api/payments/webhook/<provider>. Cross-origin by nature, so authenticity rests on the signature alone.
async function paymentWebhook(request, env, path, area) {
  if (request.method !== 'POST') reject(405, 'Method not allowed.');
  const provider = paymentProvider(env, area);
  if (!provider || path !== '/api/payments/webhook/' + provider.name) reject(404, 'Not found.');
  if (Number(request.headers.get('content-length')) > 65536) reject(413, 'Request is too large.');
  const raw = await request.text();
  if (raw.length > 65536) reject(413, 'Request is too large.');
  const event = normalizedEvent(await provider.verify(request, raw, env));
  if (!event) reject(401, 'Signature verification failed.');
  // A database failure surfaces as 503 so the provider retries; the event id makes the retry safe.
  const result = await qoqRpc(env, 'qoq_points', {p_actor: '', p_email: '', p_organizer: false, p_action: 'payment.event', p_data: {...event, provider: provider.name}});
  return json({received: true, duplicate: result.duplicate === true});
}

async function createOrder(request, env, area) {
  // Refused here before anything is stored. The database enforces the same gate again.
  if (!paymentsLive(env, area)) reject(409, 'Online payment is coming soon. No purchase was created.');
  const input = await smallJson(request);
  const text = (value, max) => typeof value === 'string' && value.length <= max ? value.trim() : '';
  if (!UUID.test(input.candidateId || '') || !UUID.test(input.packageId || '') || !UUID.test(input.requestId || '')) reject(422, 'Choose a candidate and a voting package.');
  const email = text(input.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) reject(422, 'Enter a valid email address for your receipt.');
  const provider = paymentProvider(env, area);
  const call = (action, data) => qoqRpc(env, 'qoq_points', {p_actor: '', p_email: '', p_organizer: false, p_action: action, p_data: data});
  let order = await call('order.create', {candidateId: input.candidateId, packageId: input.packageId, email, name: text(input.name, 120),
    idempotencyKey: await digest(encode.encode('order:' + input.requestId)), gate: 'open'});
  let checkoutUrl = null;
  if (order.status === 'created') {
    const checkout = await provider.createCheckout(order, env);
    checkoutUrl = checkout.checkoutUrl || null;
    order = await call('order.attach', {orderRef: order.orderRef, providerRef: checkout.providerRef});
  }
  return json({order, checkoutUrl}, 201);
}

function csv(rows, columns) {
  // Neutralize spreadsheet formulas in exported text.
  const cell = value => { let text = value == null ? '' : String(value); if (/^[=+\-@\t\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  return '﻿' + [columns.map(([label]) => cell(label)).join(','), ...rows.map(row => columns.map(([, pick]) => cell(pick(row))).join(','))].join('\r\n') + '\r\n';
}
function csvResponse(name, body) {
  return new Response(body, {headers: {...SAFE_RESPONSE, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + name + '"'}});
}
