/* /espace/api/admin/clients  (réservé ADMIN_EMAIL)
   GET  → liste des clients.
   POST → création ou édition d'un client (upsert par id ; id absent = création). */
import { getIdentity, requireAdmin, newId, jsonOk, errResp, httpError } from '../../../_lib.js';

export async function onRequestGet({ request, env }) {
  try {
    const id = await getIdentity(request, env);
    requireAdmin(id);
    const rows = await env.DB.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
    return jsonOk({ clients: rows.results || [] });
  } catch (e) { return errResp(e); }
}

export async function onRequestPost({ request, env }) {
  try {
    const id = await getIdentity(request, env);
    requireAdmin(id);

    let b;
    try { b = await request.json(); } catch { throw httpError(400, 'JSON invalide.'); }

    const etablissement = (b.etablissement || '').trim();
    const email = (b.email || '').trim().toLowerCase();
    if (!etablissement || !email) throw httpError(400, 'Établissement et email obligatoires.');

    const fields = {
      etablissement,
      email,
      formule: b.formule || null,
      montant_mensuel: b.montant_mensuel != null ? Number(b.montant_mensuel) : null,
      date_debut: b.date_debut || null,
      duree_engagement_mois: b.duree_engagement_mois != null ? parseInt(b.duree_engagement_mois, 10) : 12,
      statut: b.statut || 'actif',
      gocardless_subscription_id: b.gocardless_subscription_id || null,
      gocardless_mandate_id: b.gocardless_mandate_id || null,
    };

    if (b.id) {
      // Édition
      const exists = await env.DB.prepare('SELECT id, mandate_token FROM clients WHERE id = ?').bind(b.id).first();
      if (!exists) throw httpError(404, 'Client introuvable.');
      // Backfill : si le client n'a pas encore de jeton, on lui en attribue un (sinon on garde le sien).
      const token = exists.mandate_token || crypto.randomUUID();
      await env.DB.prepare(
        `UPDATE clients SET etablissement=?, email=?, formule=?, montant_mensuel=?, date_debut=?,
         duree_engagement_mois=?, statut=?, gocardless_subscription_id=?, gocardless_mandate_id=?,
         mandate_token=?
         WHERE id=?`
      ).bind(
        fields.etablissement, fields.email, fields.formule, fields.montant_mensuel, fields.date_debut,
        fields.duree_engagement_mois, fields.statut, fields.gocardless_subscription_id,
        fields.gocardless_mandate_id, token, b.id
      ).run();
      return jsonOk({ id: b.id, updated: true });
    }

    // Création
    const clientId = newId('cli');
    const mandateToken = crypto.randomUUID(); // jeton unique et imprévisible
    await env.DB.prepare(
      `INSERT INTO clients (id, etablissement, email, formule, montant_mensuel, date_debut,
        duree_engagement_mois, statut, gocardless_subscription_id, gocardless_mandate_id,
        mandate_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      clientId, fields.etablissement, fields.email, fields.formule, fields.montant_mensuel,
      fields.date_debut, fields.duree_engagement_mois, fields.statut,
      fields.gocardless_subscription_id, fields.gocardless_mandate_id,
      mandateToken, new Date().toISOString()
    ).run();
    return jsonOk({ id: clientId, created: true });
  } catch (e) {
    // Violation d'unicité email, etc.
    if (e && !e.response && /UNIQUE/i.test(e.message || '')) {
      return errResp(httpError(409, 'Un client avec cet email existe déjà.'));
    }
    return errResp(e);
  }
}
