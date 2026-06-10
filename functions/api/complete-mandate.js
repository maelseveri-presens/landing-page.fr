/* ============================================================
   GET /api/complete-mandate?br=BRQ...
   Au retour du parcours GoCardless : lit le Billing Request, le finalise
   si besoin, retrouve le client via metadata.client_id et enregistre sur
   son profil le gocardless_mandate_id (et subscription_id le cas échéant).
   Réponse client : uniquement le statut.
   ============================================================ */
import { gcBase, gcHeaders, jsonError, jsonOk } from './_gocardless.js';

export async function onRequestGet({ request, env }) {
  if (!env.GOCARDLESS_ACCESS_TOKEN) {
    console.error('GOCARDLESS_ACCESS_TOKEN manquant.');
    return jsonError('Service de prélèvement indisponible pour le moment.', 503);
  }

  const billingRequestId = new URL(request.url).searchParams.get('br');
  if (!billingRequestId) return jsonError('Référence de mandat manquante.', 400);

  const base = gcBase(env);
  const headers = gcHeaders(env);
  const id = encodeURIComponent(billingRequestId);

  try {
    const getRes = await fetch(`${base}/billing_requests/${id}`, { headers });
    if (!getRes.ok) {
      console.error('GoCardless GET /billing_requests', getRes.status, await getRes.text());
      return jsonError('Mandat introuvable.', 502);
    }
    let br = (await getRes.json()).billing_requests;

    // Filet de sécurité : fulfil si nécessaire (le flow auto-fulfil par défaut).
    if (br.status !== 'fulfilled') {
      const fulfilRes = await fetch(`${base}/billing_requests/${id}/actions/fulfil`, {
        method: 'POST', headers, body: '{}',
      });
      if (fulfilRes.ok) br = (await fulfilRes.json()).billing_requests;
      else console.warn('GoCardless fulfil non appliqué', fulfilRes.status, await fulfilRes.text());
    }

    const links = br.links || {};
    const mandateId = links.mandate_request_mandate || null;
    const subscriptionId = links.subscription_request_subscription || null; // si applicable
    const customerId = links.customer || null;
    const clientId = (br.metadata && br.metadata.client_id) || null;

    // Enregistre les identifiants GoCardless sur le profil du client.
    if (clientId && mandateId) {
      if (subscriptionId) {
        await env.DB.prepare(
          'UPDATE clients SET gocardless_mandate_id = ?, gocardless_subscription_id = ? WHERE id = ?'
        ).bind(mandateId, subscriptionId, clientId).run();
      } else {
        await env.DB.prepare('UPDATE clients SET gocardless_mandate_id = ? WHERE id = ?')
          .bind(mandateId, clientId).run();
      }
    }

    console.log('Mandat Présens finalisé', {
      billing_request: br.id, status: br.status,
      client: clientId, mandate: mandateId, subscription: subscriptionId, customer: customerId,
    });

    return jsonOk({ status: br.status });
  } catch (err) {
    console.error('complete-mandate exception', err);
    return jsonError('Erreur interne.', 500);
  }
}
