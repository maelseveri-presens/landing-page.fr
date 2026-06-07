/* ============================================================
   Helper GoCardless — partagé par les Pages Functions.
   Le token n'est JAMAIS en dur : uniquement via env.GOCARDLESS_ACCESS_TOKEN.
   Fichier préfixé par _ : non routé par Cloudflare Pages.
   ============================================================ */

// URL de base selon l'environnement (sandbox par défaut)
export function gcBase(env) {
  return env.GOCARDLESS_ENVIRONMENT === 'live'
    ? 'https://api.gocardless.com'
    : 'https://api-sandbox.gocardless.com';
}

// En-têtes requis par l'API GoCardless
export function gcHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GOCARDLESS_ACCESS_TOKEN}`,
    'GoCardless-Version': '2015-07-06',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

// Réponse d'erreur JSON propre (aucune stack trace exposée)
export function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Réponse JSON de succès
export function jsonOk(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
