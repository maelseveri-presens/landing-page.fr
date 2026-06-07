/* GET /espace/api/admin/resiliations  (réservé ADMIN_EMAIL)
   Liste des demandes de résiliation avec infos client + date d'effet. */
import { getIdentity, requireAdmin, jsonOk, errResp } from '../../../_lib.js';

export async function onRequestGet({ request, env }) {
  try {
    const id = await getIdentity(request, env);
    requireAdmin(id);
    const rows = await env.DB.prepare(
      `SELECT r.id, r.date_demande, r.date_effet, r.traite,
              c.etablissement, c.email, c.gocardless_subscription_id, c.statut
       FROM resiliations r
       JOIN clients c ON c.id = r.client_id
       ORDER BY r.date_effet ASC`
    ).all();
    return jsonOk({ resiliations: rows.results || [] });
  } catch (e) { return errResp(e); }
}
