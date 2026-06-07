-- ============================================================
-- Présens — schéma D1 (espace client)
-- Appliquer avec :
--   npx wrangler d1 execute presens-db --remote --file=./schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS clients (
  id                     TEXT PRIMARY KEY,
  etablissement          TEXT NOT NULL,
  email                  TEXT NOT NULL UNIQUE,
  formule                TEXT,
  montant_mensuel        REAL,
  date_debut             TEXT,                 -- ISO 8601 (YYYY-MM-DD)
  duree_engagement_mois  INTEGER NOT NULL DEFAULT 12,
  statut                 TEXT NOT NULL DEFAULT 'actif',  -- actif | resiliation_planifiee | resilie
  gocardless_subscription_id TEXT,
  gocardless_mandate_id      TEXT,
  created_at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clients_email ON clients (email);

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  type        TEXT NOT NULL,                   -- audit | rapport | facture
  periode     TEXT,
  filename    TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients (id)
);

CREATE INDEX IF NOT EXISTS idx_documents_client ON documents (client_id);

CREATE TABLE IF NOT EXISTS resiliations (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  date_demande TEXT NOT NULL,
  date_effet   TEXT NOT NULL,
  traite       INTEGER NOT NULL DEFAULT 0,     -- 0 = en attente, 1 = traité (abonnement annulé)
  FOREIGN KEY (client_id) REFERENCES clients (id)
);

CREATE INDEX IF NOT EXISTS idx_resiliations_client ON resiliations (client_id);
