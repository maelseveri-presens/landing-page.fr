/* ============================================================
   GET /api/complete-mandate?br=BRQ...
   Appelée au retour du parcours GoCardless. Lit le Billing Request,
   le finalise (fulfil) si nécessaire, logue l'ID mandat + client
   côté serveur, et renvoie au client uniquement le statut.
   ============================================================ */
import { gcBase, gcHeaders, jsonError, jsonOk } from './_gocardless.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.GOCARDLESS_ACCESS_TOKEN) {
    console.error('GOCARDLESS_ACCESS_TOKEN manquant dans l\'environnement.');
    return jsonError('Service de prélèvement indisponible pour le moment.', 503);
  }

  const billingRequestId = new URL(request.url).searchParams.get('br');
  if (!billingRequestId) {
    return jsonError('Référence de mandat manquante.', 400);
  }

  const base = gcBase(env);
  const headers = gcHeaders(env);
  const id = encodeURIComponent(billingRequestId);

  try {
    // Lecture de l'état actuel du Billing Request
    const getRes = await fetch(`${base}/billing_requests/${id}`, { headers });
    if (!getRes.ok) {
      console.error('GoCardless GET /billing_requests', getRes.status, await getRes.text());
      return jsonError('Mandat introuvable.', 502);
    }
    let br = (await getRes.json()).billing_requests;

    // Si pas encore finalisé, on tente le fulfil (le flow auto-fulfil par défaut,
    // ceci est un filet de sécurité).
    if (br.status !== 'fulfilled') {
      const fulfilRes = await fetch(`${base}/billing_requests/${id}/actions/fulfil`, {
        method: 'POST',
        headers,
        body: '{}',
      });
      if (fulfilRes.ok) {
        br = (await fulfilRes.json()).billing_requests;
      } else {
        // Non bloquant : on logue et on continue avec l'état courant.
        console.warn('GoCardless fulfil non appliqué', fulfilRes.status, await fulfilRes.text());
      }
    }

    const mandateId = (br.links && br.links.mandate_request_mandate) || null;
    const customerId = (br.links && br.links.customer) || null;

    // Log serveur uniquement — jamais exposé au client.
    console.log('Mandat Présens finalisé', {
      billing_request: br.id,
      status: br.status,
      mandate: mandateId,
      customer: customerId,
    });

    // Réponse minimale, sans donnée sensible.
    return jsonOk({ status: br.status });
  } catch (err) {
    console.error('complete-mandate exception', err);
    return jsonError('Erreur interne.', 500);
  }
}
