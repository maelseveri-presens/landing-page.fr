/* GET /espace/api/document?id=DOC — télécharge un document (stream R2).
   La clé R2 n'est JAMAIS fournie par le navigateur : on résout l'id en D1,
   on vérifie la propriété, puis on sert l'objet via le binding privé. */
import { getIdentity, errResp, httpError } from '../../_lib.js';

export async function onRequestGet({ request, env }) {
  try {
    const id = await getIdentity(request, env);
    const docId = new URL(request.url).searchParams.get('id');
    if (!docId) throw httpError(400, 'Document non précisé.');

    const doc = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(docId).first();
    if (!doc) throw httpError(404, 'Document introuvable.');

    // Scoping strict : un client ne peut accéder qu'à ses propres documents.
    if (id.role !== 'admin' && doc.client_id !== id.client.id) {
      throw httpError(403, 'Accès refusé.');
    }

    const obj = await env.DOCS.get(doc.r2_key);
    if (!obj) throw httpError(404, 'Fichier indisponible.');

    const headers = new Headers();
    headers.set('Content-Type', (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.filename)}"`);
    headers.set('Cache-Control', 'private, no-store');
    return new Response(obj.body, { headers });
  } catch (e) { return errResp(e); }
}
