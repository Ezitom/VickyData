-- ============================================================
-- VICKYDATA — RapidBills & Multi-Provider Supabase Update SQL
-- ============================================================
-- Copy and paste this script into your Supabase SQL Editor.
-- Safe to run multiple times (idempotent).
-- ============================================================

-- 1. Ensure VTU Providers Table Exists
CREATE TABLE IF NOT EXISTS vtu_providers (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug                VARCHAR(50)  UNIQUE NOT NULL,   -- peacesub, rapidbills, billox, vtpass
  name                VARCHAR(100) NOT NULL,
  status              VARCHAR(20)  NOT NULL DEFAULT 'inactive'
                      CHECK (status IN ('active', 'inactive', 'testing', 'maintenance', 'failed')),
  priority            INTEGER      NOT NULL DEFAULT 99,
  is_primary          BOOLEAN      NOT NULL DEFAULT false,
  environment         VARCHAR(20)  NOT NULL DEFAULT 'live'
                      CHECK (environment IN ('live', 'sandbox', 'test')),
  api_base_url        TEXT,
  api_key_hint        VARCHAR(20),                     -- Key hint (last 4 chars ONLY, secrets stay in .env)
  supported_services  TEXT[]       DEFAULT ARRAY['data','airtime'],
  failover_enabled    BOOLEAN      NOT NULL DEFAULT false,
  notes               TEXT,
  last_success_at     TIMESTAMP WITH TIME ZONE,
  last_failure_at     TIMESTAMP WITH TIME ZONE,
  last_error          TEXT,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Ensure Provider Transaction Mapping Table Exists
CREATE TABLE IF NOT EXISTS vtu_provider_transactions (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  internal_transaction_ref  VARCHAR(150) NOT NULL,
  provider_slug             VARCHAR(50)  NOT NULL,
  provider_reference        VARCHAR(200),
  provider_status           VARCHAR(50),
  internal_status           VARCHAR(30)  DEFAULT 'PENDING'
                            CHECK (internal_status IN ('PENDING','PROCESSING','SUCCESS','FAILED','REFUNDED','REQUIRES_REQUERY')),
  request_payload           JSONB,
  response_payload          JSONB,
  attempt_number            INTEGER NOT NULL DEFAULT 1,
  created_at                TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at                TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vtu_provider_txns_internal_ref
  ON vtu_provider_transactions(internal_transaction_ref);

-- 3. Ensure Provider Plan Mappings Table Exists
CREATE TABLE IF NOT EXISTS provider_plan_mappings (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  data_plan_id        INTEGER REFERENCES data_plans(id) ON DELETE CASCADE,
  provider_slug       VARCHAR(50) NOT NULL,
  provider_plan_id    VARCHAR(100) NOT NULL,
  provider_plan_name  VARCHAR(200),
  provider_cost       DECIMAL(10,2),
  is_verified         BOOLEAN DEFAULT false,
  notes               TEXT,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (data_plan_id, provider_slug)
);

-- 4. Ensure Provider API Logs Table Exists
CREATE TABLE IF NOT EXISTS vtu_provider_logs (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  internal_transaction_id   VARCHAR(150),
  provider_slug             VARCHAR(50),
  endpoint                  VARCHAR(200),
  request_timestamp         TIMESTAMP WITH TIME ZONE,
  response_timestamp        TIMESTAMP WITH TIME ZONE,
  http_status               INTEGER,
  provider_reference        VARCHAR(200),
  internal_status           VARCHAR(30),
  error_message             TEXT,
  created_at                TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vtu_logs_internal_txn ON vtu_provider_logs(internal_transaction_id);
CREATE INDEX IF NOT EXISTS idx_vtu_logs_provider ON vtu_provider_logs(provider_slug);

-- 5. Extend Transactions Table for Multi-Provider Metadata
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS provider_slug VARCHAR(50);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS provider_cost DECIMAL(10,2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS profit DECIMAL(10,2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS requery_status VARCHAR(30);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- 6. Upsert/Update VTU Providers Rows
-- Seeds PEACESUB, RapidBills, Billox, and VTpass
INSERT INTO vtu_providers (slug, name, status, priority, is_primary, environment, api_base_url, api_key_hint, notes)
VALUES
  ('peacesub',   'PEACESUB',   'active',   1, true,  'live', 'https://peacesub.com/api/v1', '91da', 'Existing primary provider.'),
  ('rapidbills', 'RapidBills', 'active',   2, false, 'live', 'https://www.rapidbills.ng/api/reseller/v1', '84g',  'RapidBills Reseller API (Live)'),
  ('billox',     'Billox',     'inactive', 3, false, 'live', 'https://app-api.billox.ng/api', NULL, 'Standby.'),
  ('vtpass',     'VTpass',     'inactive', 4, false, 'live', 'https://vtpass.com/api', NULL, 'Standby.')
ON CONFLICT (slug) DO UPDATE SET
  api_base_url = EXCLUDED.api_base_url,
  api_key_hint = EXCLUDED.api_key_hint,
  status = EXCLUDED.status,
  updated_at = NOW();

-- 7. Enable RLS and Add Permissive Access Policies
ALTER TABLE vtu_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vtu_provider_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_plan_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vtu_provider_logs ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all for anon' AND tablename = 'vtu_providers') THEN
    CREATE POLICY "Allow all for anon" ON vtu_providers FOR ALL USING (true) WITH CHECK (true);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all for anon' AND tablename = 'vtu_provider_transactions') THEN
    CREATE POLICY "Allow all for anon" ON vtu_provider_transactions FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all for anon' AND tablename = 'provider_plan_mappings') THEN
    CREATE POLICY "Allow all for anon" ON provider_plan_mappings FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all for anon' AND tablename = 'vtu_provider_logs') THEN
    CREATE POLICY "Allow all for anon" ON vtu_provider_logs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 8. Verify Table Contents
SELECT slug, name, status, is_primary, priority, api_key_hint, api_base_url 
FROM vtu_providers 
ORDER BY priority ASC;
