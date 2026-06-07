/* GET /espace/api/me — profil de l'utilisateur authentifié (scopé). */
import { getIdentity, computeEngagementEnd, computeEffectiveDate, jsonOk, errResp } from '../../_lib.js';

export async function onRequestGet({ request, env }) {
  try {
    const id = await getIdentity(request, env);
    if (id.role === 'admin') {
      return jsonOk({ role: 'admin', email: id.email });
    }
    const c = id.client;
    return jsonOk({
      role: 'client',
      email: id.email,
      etablissement: c.etablissement,
      formule: c.formule,
      montant_mensuel: c.montant_mensuel,
      date_debut: c.date_debut,
      duree_engagement_mois: c.duree_engagement_mois,
      fin_engagement: computeEngagementEnd(c.date_debut, c.duree_engagement_mois),
      statut: c.statut,
      date_effet_si_resiliation: computeEffectiveDate(c),
    });
  } catch (e) { return errResp(e); }
}
