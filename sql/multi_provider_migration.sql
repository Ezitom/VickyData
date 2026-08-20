-- ============================================================
-- VTU Multi-Provider Architecture — Database Migration
-- ============================================================
-- Run these statements in ORDER in the Supabase SQL editor.
-- These are ADDITIVE only — no existing tables are modified.
-- PEACESUB functionality is not affected.
-- ============================================================

-- 1. VTU PROVIDERS TABLE
-- Stores configuration and status for each VTU provider.
-- Credentials are NOT stored here (they live in .env only).
-- ============================================================
CREATE TABLE IF NOT EXISTS vtu_providers (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug            VARCHAR(50)  UNIQUE NOT NULL,   -- peacesub, rapidbills, billox, vtpass
  name            VARCHAR(100) NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'inactive'
                  CHECK (status IN ('active', 'inactive', 'testing', 'maintenance', 'failed')),
  priority        INTEGER      NOT NULL DEFAULT 99, -- 1 = highest priority
  is_primary      BOOLEAN      NOT NULL DEFAULT false,
  environment     VARCHAR(20)  NOT NULL DEFAULT 'live'
                  CHECK (environment IN ('live', 'sandbox', 'test')),
  api_base_url    TEXT,                            -- Override base URL (optional)
  api_key_hint    VARCHAR(20),                     -- Last 4 chars of API key for display ONLY
  supported_services  TEXT[]   DEFAULT ARRAY['data','airtime'],
  failover_enabled    BOOLEAN  NOT NULL DEFAULT false,
  notes           TEXT,
  last_success_at TIMESTAMP WITH TIME ZONE,
  last_failure_at TIMESTAMP WITH TIME ZONE,
  last_error      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. PROVIDER TRANSACTION MAPPING TABLE
-- Links our internal transaction reference to a provider's reference.
-- ============================================================
CREATE TABLE IF NOT EXISTS vtu_provider_transactions (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  internal_transaction_ref  VARCHAR(150) NOT NULL,  -- Our VD-DATA-xxx reference
  provider_slug             VARCHAR(50)  NOT NULL,
  provider_reference        VARCHAR(200),            -- Provider's transaction ID
  provider_status           VARCHAR(50),             -- Raw status from provider
  internal_status           VARCHAR(30)  DEFAULT 'PENDING'
                            CHECK (internal_status IN ('PENDING','PROCESSING','SUCCESS','FAILED','REFUNDED','REQUIRES_REQUERY')),
  request_payload           JSONB,                   -- Sanitized request (no keys)
  response_payload          JSONB,                   -- Provider response
  attempt_number            INTEGER NOT NULL DEFAULT 1,
  created_at                TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at                TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookup by internal reference
CREATE INDEX IF NOT EXISTS idx_vtu_provider_txns_internal_ref
  ON vtu_provider_transactions(internal_transaction_ref);

-- 3. PROVIDER PLAN MAPPINGS TABLE
-- Maps our internal plans to each provider's plan/bundle ID.
-- ============================================================
CREATE TABLE IF NOT EXISTS provider_plan_mappings (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  data_plan_id    INTEGER REFERENCES data_plans(id) ON DELETE CASCADE,
  provider_slug   VARCHAR(50) NOT NULL,
  provider_plan_id VARCHAR(100) NOT NULL,  -- The provider's bundle/variation ID
  provider_plan_name VARCHAR(200),
  provider_cost   DECIMAL(10,2),           -- What this plan costs from this provider
  is_verified     BOOLEAN DEFAULT false,   -- Admin has confirmed this mapping is correct
  notes           TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (data_plan_id, provider_slug)
);

-- 4. PROVIDER API LOGS TABLE
-- Detailed logs of every provider API call.
-- IMPORTANT: Never log API keys or auth tokens.
-- ============================================================
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

-- Index for fast lookup by transaction ID
CREATE INDEX IF NOT EXISTS idx_vtu_logs_internal_txn
  ON vtu_provider_logs(internal_transaction_id);

-- Index for fast lookup by provider
CREATE INDEX IF NOT EXISTS idx_vtu_logs_provider
  ON vtu_provider_logs(provider_slug);

-- 5. ADD PROVIDER COLUMNS TO TRANSACTIONS TABLE
-- Extends the existing transactions table minimally.
-- ============================================================
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS provider_slug VARCHAR(50);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS provider_cost DECIMAL(10,2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS profit DECIMAL(10,2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS requery_status VARCHAR(30);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- Update the status CHECK constraint to include 'processing' (already used in prod)
-- and new statuses REQUIRES_REQUERY
-- NOTE: In Supabase you may need to drop and recreate the constraint.
-- The below is safe — it does nothing if processing is already allowed.
-- Check your current constraint in Supabase dashboard before running:
-- ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
-- ALTER TABLE transactions ADD CONSTRAINT transactions_status_check
--   CHECK (status IN ('pending','processing','successful','failed','refunded','requires_requery'));

-- 6. SEED INITIAL PROVIDER CONFIGURATIONS
-- PEACESUB = active + primary
-- Others   = inactive + standby
-- ============================================================
INSERT INTO vtu_providers (slug, name, status, priority, is_primary, environment, notes)
VALUES
  ('peacesub',   'PEACESUB',   'active',   1, true,  'live', 'Existing primary provider. Do not deactivate without admin approval.'),
  ('rapidbills', 'RapidBills', 'inactive', 2, false, 'live', 'Standby. Activate only after testing.'),
  ('billox',     'Billox',     'inactive', 3, false, 'live', 'Standby. Activate only after testing.'),
  ('vtpass',     'VTpass',     'inactive', 4, false, 'live', 'Standby. Activate only after testing.')
ON CONFLICT (slug) DO NOTHING;

-- 7. RLS POLICIES (allow all for anon key / backend access)
-- ============================================================
ALTER TABLE vtu_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vtu_provider_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_plan_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vtu_provider_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Allow all for anon" ON vtu_providers
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Allow all for anon" ON vtu_provider_transactions
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Allow all for anon" ON provider_plan_mappings
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Allow all for anon" ON vtu_provider_logs
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- VERIFICATION QUERY (run after migration to confirm setup)
-- ============================================================
-- SELECT slug, name, status, is_primary, priority FROM vtu_providers ORDER BY priority;
-- ============================================================
