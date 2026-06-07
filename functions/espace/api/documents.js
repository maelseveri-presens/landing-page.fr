/* GET /espace/api/documents — liste des documents DU client authentifié. */
import { getIdentity, jsonOk, errResp, httpError } from '../../_lib.js';

export async function onRequestGet({ request, env }) {
  try {
    const id = await getIdentity(request, env);
    // Un client ne voit que SES documents. (L'admin passe par l'espace admin.)
    if (id.role !== 'client') throw httpError(400, 'Réservé à l\'espace client.');
    const rows = await env.DB
      .prepare('SELECT id, type, periode, filename, uploaded_at FROM documents WHERE client_id = ? ORDER BY uploaded_at DESC')
      .bind(id.client.id).all();
    return jsonOk({ documents: rows.results || [] });
  } catch (e) { return errResp(e); }
}
