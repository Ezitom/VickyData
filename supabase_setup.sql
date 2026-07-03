-- ============================================================
-- VICKYDATA Supabase SQL Setup
-- Run these statements in order in the Supabase SQL editor
-- ============================================================

-- 1. USERS TABLE
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  phone VARCHAR(15) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  wallet_balance DECIMAL(12,2) DEFAULT 0.00,
  role VARCHAR(10) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. DATA PLANS TABLE
CREATE TABLE data_plans (
  id SERIAL PRIMARY KEY,
  network VARCHAR(20) NOT NULL CHECK (network IN ('MTN', 'Airtel', 'Glo', '9mobile')),
  plan_name VARCHAR(100) NOT NULL,
  size VARCHAR(20) NOT NULL,
  validity VARCHAR(30) NOT NULL,
  bundle_id INTEGER NOT NULL,
  cost_price DECIMAL(10,2) NOT NULL,
  selling_price DECIMAL(10,2) NOT NULL,
  peyflex_network_id VARCHAR(50),
  plan_code VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. TRANSACTIONS TABLE
CREATE TABLE transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('data', 'airtime', 'wallet_funding')),
  network VARCHAR(20),
  phone_number VARCHAR(15),
  amount DECIMAL(10,2) NOT NULL,
  plan_id INTEGER REFERENCES data_plans(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'successful', 'failed')),
  reference VARCHAR(100) UNIQUE NOT NULL,
  provider_reference VARCHAR(100),
  paystack_reference VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. WALLET FUNDING TABLE
CREATE TABLE wallet_funding (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL,
  paystack_reference VARCHAR(100) UNIQUE NOT NULL,
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'successful', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. MANUAL WALLET FUNDING TABLES
CREATE TABLE IF NOT EXISTS wallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance DECIMAL(12,2) DEFAULT 0.00,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS funding_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference_code VARCHAR(20) UNIQUE NOT NULL,
  amount_claimed DECIMAL(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),
  proof_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  funding_request_id UUID REFERENCES funding_requests(id) ON DELETE SET NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('credit', 'debit')),
  amount DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'paystack')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migrations/Alters (for existing databases)
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'paystack'));

CREATE OR REPLACE FUNCTION credit_funding_request_wallet(p_funding_request_id UUID, p_admin_id UUID)
RETURNS JSON AS $$
DECLARE
  v_request funding_requests%ROWTYPE;
  v_wallet wallets%ROWTYPE;
  v_new_balance DECIMAL(12,2);
BEGIN
  SELECT * INTO v_request FROM funding_requests WHERE id = p_funding_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funding request not found';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Funding request already processed';
  END IF;

  INSERT INTO wallets (user_id, balance, updated_at)
  VALUES (v_request.user_id, 0, NOW())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet FROM wallets WHERE user_id = v_request.user_id FOR UPDATE;

  v_new_balance := COALESCE(v_wallet.balance, 0) + v_request.amount_claimed;

  UPDATE wallets
  SET balance = v_new_balance,
      updated_at = NOW()
  WHERE id = v_wallet.id;

  INSERT INTO wallet_transactions (wallet_id, funding_request_id, type, amount, balance_after, source, created_at)
  VALUES (v_wallet.id, v_request.id, 'credit', v_request.amount_claimed, v_new_balance, 'manual', NOW());

  -- Update user's wallet_balance in users table to keep it in sync
  UPDATE users
  SET wallet_balance = v_new_balance,
      updated_at = NOW()
  WHERE id = v_request.user_id;

  UPDATE funding_requests
  SET status = 'confirmed',
      reviewed_at = NOW(),
      reviewed_by = p_admin_id
  WHERE id = v_request.id;

  RETURN json_build_object('success', true, 'new_balance', v_new_balance, 'wallet_id', v_wallet.id);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION credit_wallet_atomic(
  p_user_id UUID,
  p_amount DECIMAL(12,2),
  p_paystack_reference VARCHAR(100),
  p_source VARCHAR(20)
)
RETURNS JSON AS $$
DECLARE
  v_wallet wallets%ROWTYPE;
  v_new_balance DECIMAL(12,2);
  v_wallet_txn_id UUID;
BEGIN
  -- 1. Ensure wallet exists for user
  INSERT INTO wallets (user_id, balance, updated_at)
  VALUES (p_user_id, 0, NOW())
  ON CONFLICT (user_id) DO NOTHING;

  -- 2. Select wallet for update
  SELECT * INTO v_wallet FROM wallets WHERE user_id = p_user_id FOR UPDATE;

  -- 3. Calculate new balance
  v_new_balance := COALESCE(v_wallet.balance, 0) + p_amount;

  -- 4. Update wallet balance
  UPDATE wallets
  SET balance = v_new_balance,
      updated_at = NOW()
  WHERE id = v_wallet.id;

  -- 5. Insert wallet transaction
  INSERT INTO wallet_transactions (wallet_id, funding_request_id, type, amount, balance_after, source, created_at)
  VALUES (v_wallet.id, NULL, 'credit', p_amount, v_new_balance, p_source, NOW())
  RETURNING id INTO v_wallet_txn_id;

  -- 6. Update user's wallet_balance in users table to keep it in sync
  UPDATE users
  SET wallet_balance = v_new_balance,
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN json_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'wallet_transaction_id', v_wallet_txn_id
  );
END;
$$ LANGUAGE plpgsql;

-- 6. SITE SETTINGS TABLE
CREATE TABLE site_settings (
  id SERIAL PRIMARY KEY,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. DEFAULT SITE SETTINGS
INSERT INTO site_settings (setting_key, setting_value) VALUES
  ('site_name', 'VICKYDATA'),
  ('min_wallet_funding', '100'),
  ('maintenance_mode', 'false'),
  ('email_new_transaction', 'true'),
  ('email_new_user', 'true'),
  ('email_failed_transaction', 'true');

-- 8. DEFAULT ADMIN USER
-- IMPORTANT: After setup, use the /api/auth/change-password endpoint
-- or re-insert with a proper bcrypt hash generated from your chosen password.
INSERT INTO users (full_name, email, phone, password_hash, role)
VALUES (
  'VICKYDATA Admin',
  'admin@vickydata.com',
  '08000000000',
  '$2a$10$placeholderHashReplaceThisAfterSetup',
  'admin'
);

-- 9. SEED DATA PLANS
-- NOTE: Replace bundle_id values with real IDs from your PeaceSub dashboard!
INSERT INTO data_plans
  (network, plan_name, size, validity, bundle_id, cost_price, selling_price, peyflex_network_id, plan_code)
VALUES
  ('MTN', '1GB Daily', '1GB', '1 Day', 101, 280.00, 350.00, 'mtn_gifting_data', 'M1GBS'),
  ('MTN', '2GB Weekly', '2GB', '7 Days', 102, 560.00, 700.00, 'mtn_gifting_data', 'M2GBS'),
  ('MTN', '5GB Monthly', '5GB', '30 Days', 103, 1200.00, 1500.00, 'mtn_gifting_data', 'M10GBS'),
  ('MTN', '10GB Monthly', '10GB', '30 Days', 104, 2200.00, 2800.00, 'mtn_gifting_data', 'M14m5GBS'),
  ('Airtel', '1GB Daily', '1GB', '1 Day', 201, 240.00, 300.00, 'airtel_data', 'A1GBS'),
  ('Airtel', '2GB Weekly', '2GB', '7 Days', 202, 520.00, 650.00, 'airtel_data', 'A1GBS'),
  ('Airtel', '5GB Monthly', '5GB', '30 Days', 203, 1100.00, 1400.00, 'airtel_data', 'A1GBS'),
  ('Airtel', '10GB Monthly', '10GB', '30 Days', 204, 2160.00, 2700.00, 'airtel_data', 'A1GBS'),
  ('Glo', '1.5GB Daily', '1.5GB', '1 Day', 301, 240.00, 300.00, 'glo_data', 'G1GBS'),
  ('Glo', '3GB Weekly', '3GB', '7 Days', 302, 560.00, 700.00, 'glo_data', 'G1GBS'),
  ('Glo', '7.5GB Monthly', '7.5GB', '30 Days', 303, 1200.00, 1500.00, 'glo_data', 'G1GBS'),
  ('Glo', '15GB Monthly', '15GB', '30 Days', 304, 2200.00, 2800.00, 'glo_data', 'G1GBS'),
  ('9mobile', '1GB Weekly', '1GB', '7 Days', 401, 320.00, 400.00, '9mobile_data', 'E1GBS'),
  ('9mobile', '2.5GB Monthly', '2.5GB', '30 Days', 402, 800.00, 1000.00, '9mobile_data', 'E1GBS'),
  ('9mobile', '5GB Monthly', '5GB', '30 Days', 403, 1200.00, 1500.00, '9mobile_data', 'E1GBS'),
  ('9mobile', '11.5GB Monthly', '11.5GB', '30 Days', 404, 2400.00, 3000.00, '9mobile_data', 'E1GBS');

-- 9. ROW LEVEL SECURITY
-- Enable RLS but backend uses anon key with RLS in mind.
-- For full security, use service_role key on backend or add RLS policies.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_funding ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

-- 10. RLS POLICIES (allow all access via service role / bypass for backend)
-- If using anon key on backend, add these permissive policies:
CREATE POLICY "Allow all for anon" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON wallet_funding FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON data_plans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON site_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON wallets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON funding_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON wallet_transactions FOR ALL USING (true) WITH CHECK (true);

-- ALTERNATIVE: Use the Supabase service_role key in .env instead of anon key,
-- which bypasses RLS entirely. Recommended for backend-only access.

-- ============================================================
-- 11. PASSWORD RESETS TABLE
-- Stores short-lived OTP tokens for the forgot-password flow.
-- Run this in the Supabase SQL editor if not already present.
-- ============================================================
CREATE TABLE IF NOT EXISTS password_resets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(6) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by user_id
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);

-- RLS
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON password_resets FOR ALL USING (true) WITH CHECK (true);
