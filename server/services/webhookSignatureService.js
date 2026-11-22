// Verifies payment gateway webhooks before any payment state can change.
// Secret per gateway: PAYMENT_WEBHOOK_SECRET_<GATEWAY> (e.g. PAYMENT_WEBHOOK_SECRET_STRIPE),
// falling back to PAYMENT_WEBHOOK_SECRET. Without a secret the webhook stays disabled.
const crypto = require('node:crypto');

const STRIPE_TOLERANCE_SECONDS = 300;
const MIN_SECRET_LENGTH = 32;

function webhookError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function secretFor(gateway, env = process.env) {
  const key = 'PAYMENT_WEBHOOK_SECRET_' + String(gateway || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const secret = env[key] || env.PAYMENT_WEBHOOK_SECRET || '';
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function safeEqualHex(expected, received) {
  if (typeof received !== 'string' || !/^[0-9a-f]+$/i.test(received)) return false;
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received.toLowerCase(), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Stripe format: "t=<unix>,v1=<hex>[,v1=<hex>]" signed over "<t>.<raw body>".
function verifyStripe(secret, header, rawBody, nowSeconds) {
  const parts = String(header).split(',').map(part => part.trim().split('='));
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isInteger(timestamp) || !signatures.length) return false;
  if (Math.abs(nowSeconds - timestamp) > STRIPE_TOLERANCE_SECONDS) return false;
  const expected = hmacHex(secret, `${timestamp}.${rawBody}`);
  return signatures.some(signature => safeEqualHex(expected, signature));
}

/**
 * Throws a 503 when the gateway has no configured secret and a 401 when the signature is
 * missing or wrong. rawBody must be the exact bytes received (Buffer or string).
 */
function verifyWebhookSignature({ gateway, headers = {}, rawBody, env = process.env, now = Date.now() }) {
  const secret = secretFor(gateway, env);
  if (!secret) throw webhookError('استقبال إشعارات بوابة الدفع غير مفعّل لهذه البوابة', 503);
  if (rawBody === undefined || rawBody === null) throw webhookError('توقيع إشعار بوابة الدفع غير صالح', 401);
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);

  const stripeHeader = headers['stripe-signature'];
  if (stripeHeader) {
    if (verifyStripe(secret, stripeHeader, body, Math.floor(now / 1000))) return true;
    throw webhookError('توقيع إشعار بوابة الدفع غير صالح', 401);
  }
  const generic = String(headers['x-webhook-signature'] || headers['x-signature'] || '').replace(/^sha256=/i, '');
  if (generic && safeEqualHex(hmacHex(secret, body), generic)) return true;
  throw webhookError('توقيع إشعار بوابة الدفع غير صالح', 401);
}

module.exports = { verifyWebhookSignature, secretFor, hmacHex };
