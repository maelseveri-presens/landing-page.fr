/* ============================================================
   POST /api/create-mandate   body: { "c": "<mandate_token>" }
   Valide le jeton client, crée un Billing Request (mandat SEPA Core, EUR)
   lié au client via metadata, puis un Billing Request Flow.
   Renvoie UNIQUEMENT l'authorisation_url. Sans jeton valide : rien n'est créé.
   ============================================================ */
import { gcBase, gcHeaders, jsonError, jsonOk } from './_gocardless.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GOCARDLESS_ACCESS_TOKEN) {
    console.error('GOCARDLESS_ACCESS_TOKEN manquant.');
    return jsonError('Service de prélèvement indisponible pour le moment.', 503);
  }

  // 1) Jeton client obligatoire + valide
  let token = null;
  try { token = (await request.json()).c; } catch { /* corps absent */ }
  if (!token) {
    token = new URL(request.url).searchParams.get('c'); // tolérance query
  }
  if (!token) return jsonError('Lien invalide ou expiré.', 403);

  const client = await env.DB
    .prepare('SELECT id, etablissement FROM clients WHERE mandate_token = ?')
    .bind(token).first();
  if (!client) return jsonError('Lien invalide ou expiré.', 403);

  const base = gcBase(env);
  const headers = gcHeaders(env);
  const origin = new URL(request.url).origin;

  try {
    // 2) Billing Request — mandat SEPA Core EUR, lié au client par metadata
    const brRes = await fetch(`${base}/billing_requests`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        billing_requests: {
          mandate_request: { scheme: 'sepa_core', currency: 'EUR' },
          metadata: { source: 'presens.site', client_id: client.id },
        },
      }),
    });
    if (!brRes.ok) {
      console.error('GoCardless /billing_requests', brRes.status, await brRes.text());
      return jsonError("Impossible d'initialiser le mandat.", 502);
    }
    const billingRequestId = (await brRes.json()).billing_requests.id;

    // 3) Billing Request Flow
    const flowRes = await fetch(`${base}/billing_request_flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        billing_request_flows: {
          redirect_uri: `${origin}/mandat/merci?br=${encodeURIComponent(billingRequestId)}`,
          exit_uri: `${origin}/mandat?c=${encodeURIComponent(token)}`,
          links: { billing_request: billingRequestId },
        },
      }),
    });
    if (!flowRes.ok) {
      console.error('GoCardless /billing_request_flows', flowRes.status, await flowRes.text());
      return jsonError('Impossible de démarrer le parcours de signature.', 502);
    }

    const authorisationUrl = (await flowRes.json()).billing_request_flows.authorisation_url;
    return jsonOk({ authorisation_url: authorisationUrl }); // rien d'autre
  } catch (err) {
    console.error('create-mandate exception', err);
    return jsonError('Erreur interne. Réessayez dans un instant.', 500);
  }
}
