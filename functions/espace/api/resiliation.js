/* /espace/api/resiliation
   GET  → aperçu : date d'effet calculée + rappel "facturé jusque-là".
   POST → confirmation : enregistre la demande, passe le client en
          "resiliation_planifiee", envoie les emails. N'ANNULE PAS
          GoCardless tout de suite (planifié à la date d'effet). */
import {
  getIdentity, computeEffectiveDate, computeEngagementEnd,
  newId, sendEmail, jsonOk, errResp, httpError,
} from '../../_lib.js';

export async function onRequestGet({ request, env }) {
  try {
    const id = await getIdentity(request, env);
    if (id.role !== 'client') throw httpError(400, 'Réservé à l\'espace client.');
    const c = id.client;
    return jsonOk({
      statut: c.statut,
      montant_mensuel: c.montant_mensuel,
      fin_engagement: computeEngagementEnd(c.date_debut, c.duree_engagement_mois),
      date_effet: computeEffectiveDate(c),
    });
  } catch (e) { return errResp(e); }
}

export async function onRequestPost({ request, env }) {
  try {
    const id = await getIdentity(request, env);
    if (id.role !== 'client') throw httpError(400, 'Réservé à l\'espace client.');
    const c = id.client;

    if (c.statut !== 'actif') {
      // Déjà planifiée ou résiliée : on renvoie l'état courant, sans doublon.
      return jsonOk({ statut: c.statut, date_effet: computeEffectiveDate(c), deja: true });
    }

    const today = new Date().toISOString().slice(0, 10);
    const dateEffet = computeEffectiveDate(c);

    // Enregistre la demande + bascule le statut (transaction logique).
    await env.DB.prepare(
      'INSERT INTO resiliations (id, client_id, date_demande, date_effet, traite) VALUES (?, ?, ?, ?, 0)'
    ).bind(newId('res'), c.id, today, dateEffet).run();

    await env.DB.prepare('UPDATE clients SET statut = ? WHERE id = ?')
      .bind('resiliation_planifiee', c.id).run();

    // Emails (best-effort, ne bloquent pas la confirmation).
    const fmt = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    await sendEmail(env, {
      to: c.email,
      subject: 'Présens — confirmation de votre résiliation',
      html: `<p>Bonjour,</p>
        <p>Nous confirmons la demande de résiliation de votre abonnement Présens (${c.etablissement}).</p>
        <p><strong>Date d'effet : ${fmt(dateEffet)}</strong>. Votre abonnement reste actif et facturé
        (${c.montant_mensuel} € / mois) jusqu'à cette date, conformément à votre engagement.</p>
        <p>Aucune action de votre part n'est requise. L'abonnement prendra fin automatiquement à la date indiquée.</p>
        <p>— L'équipe Présens</p>`,
    });
    if (env.ADMIN_EMAIL) {
      await sendEmail(env, {
        to: env.ADMIN_EMAIL,
        subject: `Résiliation planifiée — ${c.etablissement}`,
        html: `<p>Demande de résiliation enregistrée.</p>
          <ul>
            <li>Client : ${c.etablissement} (${c.email})</li>
            <li>Date d'effet : ${fmt(dateEffet)}</li>
            <li>Abonnement GoCardless : ${c.gocardless_subscription_id || '—'}</li>
          </ul>
          <p>L'annulation GoCardless sera exécutée à la date d'effet par le traitement planifié.</p>`,
      });
    }

    return jsonOk({ statut: 'resiliation_planifiee', date_effet: dateEffet });
  } catch (e) { return errResp(e); }
}
