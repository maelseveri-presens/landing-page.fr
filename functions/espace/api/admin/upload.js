/* POST /espace/api/admin/upload  (réservé ADMIN_EMAIL)
   multipart/form-data : client_id, type (audit|rapport|facture), periode, file
   → dépôt R2 sous clients/{client_id}/... + ligne en D1. */
import { getIdentity, requireAdmin, newId, jsonOk, errResp, httpError } from '../../../_lib.js';

const TYPES = ['audit', 'rapport', 'facture'];

export async function onRequestPost({ request, env }) {
  try {
    const id = await getIdentity(request, env);
    requireAdmin(id);

    const form = await request.formData();
    const clientId = form.get('client_id');
    const type = form.get('type');
    const periode = form.get('periode') || '';
    const file = form.get('file');

    if (!clientId || !type || !file || typeof file === 'string') {
      throw httpError(400, 'Champs manquants (client, type, fichier).');
    }
    if (!TYPES.includes(type)) throw httpError(400, 'Type de document invalide.');

    const client = await env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first();
    if (!client) throw httpError(404, 'Client introuvable.');

    // Nom de fichier assaini ; la clé R2 est construite côté serveur, jamais fournie par le client.
    const safeName = String(file.name || 'document').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
    const docId = newId('doc');
    const r2Key = `clients/${clientId}/${type}/${Date.now()}-${safeName}`;

    await env.DOCS.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });

    await env.DB.prepare(
      `INSERT INTO documents (id, client_id, type, periode, filename, r2_key, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(docId, clientId, type, periode, safeName, r2Key, new Date().toISOString()).run();

    return jsonOk({ id: docId, created: true });
  } catch (e) { return errResp(e); }
}
