/* ============================================================
   _lib.js — utilitaires partagés des Pages Functions de l'espace client.
   Sécurité : validation du JWT Cloudflare Access dans CHAQUE Function,
   identité scopée (admin vs client), accès D1/R2 toujours restreint
   au client authentifié. Aucun secret en dur : tout via `env`.
   ============================================================ */

/* ---------- Réponses JSON ---------- */
export function jsonOk(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
export function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/* Erreurs typées : on les jette puis on les convertit en réponse. */
export function httpError(status, message) {
  const e = new Error(message);
  e.response = jsonError(message, status);
  return e;
}
export function errResp(e) {
  return e && e.response ? e.response : jsonError('Erreur interne.', 500);
}

/* ---------- base64url ---------- */
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  s += '='.repeat(pad);
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function b64urlToString(s) { return new TextDecoder().decode(b64urlToBytes(s)); }

/* ---------- Cache JWKS (par isolate) ---------- */
let JWKS_CACHE = { url: null, keys: null, at: 0 };
async function getSigningKeys(teamDomain) {
  const url = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const now = Date.now();
  if (JWKS_CACHE.url === url && JWKS_CACHE.keys && now - JWKS_CACHE.at < 3600_000) {
    return JWKS_CACHE.keys;
  }
  const res = await fetch(url);
  if (!res.ok) throw httpError(500, 'Service d\'authentification indisponible.');
  const data = await res.json();
  JWKS_CACHE = { url, keys: data.keys || [], at: now };
  return JWKS_CACHE.keys;
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

/* ============================================================
   validateAccessJwt — vérifie cryptographiquement le JWT Access.
   Ne JAMAIS se fier à un simple en-tête email.
   ============================================================ */
export async function validateAccessJwt(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || getCookie(request, 'CF_Authorization');
  if (!token) throw httpError(401, 'Authentification requise.');

  const parts = token.split('.');
  if (parts.length !== 3) throw httpError(401, 'Jeton invalide.');

  let header, payload;
  try {
    header = JSON.parse(b64urlToString(parts[0]));
    payload = JSON.parse(b64urlToString(parts[1]));
  } catch { throw httpError(401, 'Jeton illisible.'); }

  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const aud = env.CF_ACCESS_AUD;
  if (!teamDomain || !aud) throw httpError(500, 'Configuration Access manquante.');

  // Claims
  if (payload.iss !== `https://${teamDomain}.cloudflareaccess.com`) throw httpError(401, 'Émetteur invalide.');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw httpError(401, 'Audience invalide.');
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw httpError(401, 'Session expirée.');
  if (payload.nbf && now < payload.nbf - 60) throw httpError(401, 'Jeton pas encore valide.');

  // Signature RS256
  const keys = await getSigningKeys(teamDomain);
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw httpError(401, 'Clé de signature inconnue.');
  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), signed);
  if (!ok) throw httpError(401, 'Signature invalide.');

  if (!payload.email) throw httpError(401, 'Identité absente du jeton.');
  return { email: String(payload.email).toLowerCase() };
}

/* ============================================================
   getIdentity — rôle + profil scopé.
   admin si email == ADMIN_EMAIL, sinon recherche client en D1.
   Inconnu => 403.
   ============================================================ */
export async function getIdentity(request, env) {
  const { email } = await validateAccessJwt(request, env);
  if (env.ADMIN_EMAIL && email === String(env.ADMIN_EMAIL).toLowerCase()) {
    return { email, role: 'admin', client: null };
  }
  const client = await env.DB
    .prepare('SELECT * FROM clients WHERE lower(email) = ?')
    .bind(email).first();
  if (!client) throw httpError(403, 'Accès refusé.');
  return { email, role: 'client', client };
}

export function requireAdmin(identity) {
  if (identity.role !== 'admin') throw httpError(403, 'Réservé à l\'administrateur.');
}

/* ============================================================
   Dates d'engagement / d'effet de résiliation
   ============================================================ */
function addMonthsISO(isoDate, months) {
  const d = new Date(isoDate + 'T00:00:00Z');
  if (isNaN(d)) return null;
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() < day) d.setUTCDate(0); // clamp fin de mois (ex. 31 → 30/28)
  return d.toISOString().slice(0, 10);
}

export function computeEngagementEnd(dateDebut, dureeMois) {
  if (!dateDebut) return null;
  return addMonthsISO(dateDebut, parseInt(dureeMois || 12, 10));
}

// Prochaine échéance mensuelle >= aujourd'hui (fin de période en cours)
function nextPeriodEnd(dateDebut, todayISO) {
  let n = 1;
  let candidate = addMonthsISO(dateDebut, n);
  while (candidate && candidate < todayISO && n < 600) {
    n += 1;
    candidate = addMonthsISO(dateDebut, n);
  }
  return candidate;
}

export function computeEffectiveDate(client) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const fin = computeEngagementEnd(client.date_debut, client.duree_engagement_mois);
  if (fin && fin > todayISO) return fin;            // engagement non terminé → fin d'engagement
  return nextPeriodEnd(client.date_debut, todayISO); // sinon → fin de période en cours
}

/* ---------- Identifiants ---------- */
export function newId(prefix) {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

/* ============================================================
   Email transactionnel (Resend) — clé via secret
   ============================================================ */
export async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) { console.warn('RESEND_API_KEY manquant — email non envoyé.'); return; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Présens <noreply@presens.site>', to, subject, html }),
    });
    if (!res.ok) console.error('Resend', res.status, await res.text());
  } catch (e) { console.error('Resend exception', e); }
}

/* ============================================================
   GoCardless — base/headers (token via secret) + annulation abonnement
   ============================================================ */
export function gcBase(env) {
  return env.GOCARDLESS_ENVIRONMENT === 'live'
    ? 'https://api.gocardless.com'
    : 'https://api-sandbox.gocardless.com';
}
export function gcHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GOCARDLESS_ACCESS_TOKEN}`,
    'GoCardless-Version': '2015-07-06',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}
export async function gcCancelSubscription(env, subscriptionId) {
  if (!subscriptionId) return { ok: false, reason: 'no_subscription' };
  const res = await fetch(`${gcBase(env)}/subscriptions/${encodeURIComponent(subscriptionId)}/actions/cancel`, {
    method: 'POST', headers: gcHeaders(env), body: '{}',
  });
  if (!res.ok) {
    console.error('GoCardless cancel', res.status, await res.text());
    return { ok: false, reason: 'gc_error' };
  }
  return { ok: true };
}
