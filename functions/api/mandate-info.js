/* GET /api/mandate-info?c=TOKEN
   Valide le jeton de mandat (public, pas derrière Access). Renvoie un
   minimum d'infos pour personnaliser la page /mandat. Aucune donnée sensible. */
import { jsonOk, jsonError } from './_gocardless.js';

export async function onRequestGet({ request, env }) {
  try {
    const token = new URL(request.url).searchParams.get('c');
    if (!token) return jsonError('Lien invalide.', 400);

    const client = await env.DB
      .prepare('SELECT etablissement, statut FROM clients WHERE mandate_token = ?')
      .bind(token).first();

    if (!client) return jsonError('Lien invalide ou expiré.', 404);

    return jsonOk({ ok: true, etablissement: client.etablissement });
  } catch (err) {
    console.error('mandate-info exception', err);
    return jsonError('Erreur interne.', 500);
  }
}
