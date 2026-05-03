-- VKG persistence tables
CREATE TABLE IF NOT EXISTS vkg_nodes (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  type          TEXT NOT NULL,
  species_scope TEXT[],
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vkg_edges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node     TEXT NOT NULL REFERENCES vkg_nodes(id) ON DELETE CASCADE,
  to_node       TEXT NOT NULL,
  type          TEXT NOT NULL,
  weight        FLOAT NOT NULL CHECK (weight >= 0 AND weight <= 1),
  evidence      TEXT NOT NULL DEFAULT 'moderate',
  species_scope TEXT[],
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vkg_edges_from_node_idx ON vkg_edges(from_node);
CREATE INDEX IF NOT EXISTS vkg_edges_to_node_idx   ON vkg_edges(to_node);
CREATE INDEX IF NOT EXISTS vkg_edges_type_idx      ON vkg_edges(type);
CREATE INDEX IF NOT EXISTS vkg_nodes_type_idx      ON vkg_nodes(type);

ALTER TABLE vkg_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vkg_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_vkg_nodes" ON vkg_nodes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_vkg_edges" ON vkg_edges
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE vkg_nodes IS 'VKG nodes — persisted overlay for VKG singleton';
COMMENT ON TABLE vkg_edges IS 'VKG edges — persisted relationships for VKG singleton';
