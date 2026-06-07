/* POST /espace/api/admin/process  — exécute les résiliations arrivées à échéance.
   Auth : soit admin (JWT Access), soit un déclencheur planifié via l'en-tête
   X-Cron-Key == env.CRON_SECRET (pour un Cron Worker quotidien).
   Pour chaque résiliation due (date_effet <= aujourd'hui, non traitée) :
   annule l'abonnement GoCardless, passe le client en "resilie", marque traitée. */
import { getIdentity, requireAdmin, gcCancelSubscription, jsonOk, errResp, httpError } from '../../../_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    // Autorisation : clé cron OU admin authentifié.
    const cronKey = request.headers.get('X-Cron-Key');
    const viaCron = env.CRON_SECRET && cronKey && cronKey === env.CRON_SECRET;
    if (!viaCron) {
      const id = await getIdentity(request, env);
      requireAdmin(id);
    }

    const today = new Date().toISOString().slice(0, 10);
    const due = await env.DB.prepare(
      `SELECT r.id AS res_id, c.id AS client_id, c.gocardless_subscription_id
       FROM resiliations r JOIN clients c ON c.id = r.client_id
       WHERE r.traite = 0 AND r.date_effet <= ?`
    ).bind(today).all();

    const results = [];
    for (const row of (due.results || [])) {
      const cancel = await gcCancelSubscription(env, row.gocardless_subscription_id);
      // On marque traité même si pas d'abonnement GC (rien à annuler) ;
      // en cas d'erreur GC réelle, on laisse traite=0 pour réessayer.
      if (cancel.ok || cancel.reason === 'no_subscription') {
        await env.DB.prepare('UPDATE clients SET statut = ? WHERE id = ?').bind('resilie', row.client_id).run();
        await env.DB.prepare('UPDATE resiliations SET traite = 1 WHERE id = ?').bind(row.res_id).run();
        results.push({ res_id: row.res_id, status: 'resilie' });
      } else {
        results.push({ res_id: row.res_id, status: 'echec_gocardless' });
      }
    }

    console.log('process-resiliations', { date: today, traites: results.length });
    return jsonOk({ processed: results.length, results });
  } catch (e) { return errResp(e); }
}
