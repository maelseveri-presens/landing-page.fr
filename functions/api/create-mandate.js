/* ============================================================
   POST /api/create-mandate
   Crée un Billing Request (mandat SEPA Core, EUR) puis un
   Billing Request Flow, et renvoie UNIQUEMENT l'authorisation_url.
   ============================================================ */
import { gcBase, gcHeaders, jsonError, jsonOk } from './_gocardless.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GOCARDLESS_ACCESS_TOKEN) {
    console.error('GOCARDLESS_ACCESS_TOKEN manquant dans l\'environnement.');
    return jsonError('Service de prélèvement indisponible pour le moment.', 503);
  }

  const base = gcBase(env);
  const headers = gcHeaders(env);
  const origin = new URL(request.url).origin;

  try {
    // 1) Billing Request : mandat SEPA Core en EUR
    const brRes = await fetch(`${base}/billing_requests`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        billing_requests: {
          mandate_request: { scheme: 'sepa_core', currency: 'EUR' },
          metadata: { source: 'presens.site' },
        },
      }),
    });

    if (!brRes.ok) {
      console.error('GoCardless /billing_requests', brRes.status, await brRes.text());
      return jsonError("Impossible d'initialiser le mandat.", 502);
    }

    const billingRequestId = (await brRes.json()).billing_requests.id;

    // 2) Billing Request Flow : génère le parcours hébergé GoCardless
    //    On encode l'id du billing request dans la redirect_uri pour pouvoir
    //    finaliser au retour, sans cookie ni état serveur.
    const flowRes = await fetch(`${base}/billing_request_flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        billing_request_flows: {
          redirect_uri: `${origin}/mandat/merci?br=${encodeURIComponent(billingRequestId)}`,
          exit_uri: `${origin}/mandat`,
          links: { billing_request: billingRequestId },
        },
      }),
    });

    if (!flowRes.ok) {
      console.error('GoCardless /billing_request_flows', flowRes.status, await flowRes.text());
      return jsonError('Impossible de démarrer le parcours de signature.', 502);
    }

    const authorisationUrl = (await flowRes.json()).billing_request_flows.authorisation_url;

    // On ne renvoie QUE l'URL d'autorisation. Aucune donnée sensible.
    return jsonOk({ authorisation_url: authorisationUrl });
  } catch (err) {
    console.error('create-mandate exception', err);
    return jsonError('Erreur interne. Réessayez dans un instant.', 500);
  }
}
