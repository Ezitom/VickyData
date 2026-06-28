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

-- 5. SITE SETTINGS TABLE
CREATE TABLE site_settings (
  id SERIAL PRIMARY KEY,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. DEFAULT SITE SETTINGS
INSERT INTO site_settings (setting_key, setting_value) VALUES
  ('site_name', 'VICKYDATA'),
  ('min_wallet_funding', '100'),
  ('maintenance_mode', 'false'),
  ('email_new_transaction', 'true'),
  ('email_new_user', 'true'),
  ('email_failed_transaction', 'true');

-- 7. DEFAULT ADMIN USER
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

-- 8. SEED DATA PLANS
-- NOTE: Replace bundle_id values with real IDs from your CheapDataHub dashboard!
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

-- 10. RLS POLICIES (allow all access via service role / bypass for backend)
-- If using anon key on backend, add these permissive policies:
CREATE POLICY "Allow all for anon" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON wallet_funding FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON data_plans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON site_settings FOR ALL USING (true) WITH CHECK (true);

-- ALTERNATIVE: Use the Supabase service_role key in .env instead of anon key,
-- which bypasses RLS entirely. Recommended for backend-only access.
