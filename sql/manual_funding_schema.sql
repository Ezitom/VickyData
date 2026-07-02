CREATE TABLE IF NOT EXISTS wallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance NUMERIC(12,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS funding_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference_code VARCHAR(20) UNIQUE NOT NULL,
  amount_claimed NUMERIC(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected','expired')),
  proof_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  funding_request_id UUID REFERENCES funding_requests(id) ON DELETE SET NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('credit','debit')),
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION credit_funding_request_wallet(p_funding_request_id UUID, p_admin_id UUID)
RETURNS JSON AS $$
DECLARE
  v_request funding_requests%ROWTYPE;
  v_wallet wallets%ROWTYPE;
  v_new_balance NUMERIC(12,2);
  v_tx_id UUID;
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

  INSERT INTO wallet_transactions (wallet_id, funding_request_id, type, amount, balance_after, created_at)
  VALUES (v_wallet.id, v_request.id, 'credit', v_request.amount_claimed, v_new_balance, NOW());

  UPDATE funding_requests
  SET status = 'confirmed',
      reviewed_at = NOW(),
      reviewed_by = p_admin_id
  WHERE id = v_request.id;

  RETURN json_build_object('success', true, 'new_balance', v_new_balance, 'wallet_id', v_wallet.id);
END;
$$ LANGUAGE plpgsql;
