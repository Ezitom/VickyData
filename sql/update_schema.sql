-- Run these statements in the Supabase SQL Editor to update the schema for refunds and balance tracking.

-- 1. Update status check constraint on transactions table to allow 'refunded'
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_status_check CHECK (status IN ('pending', 'successful', 'failed', 'refunded'));

-- 2. Add balance_before and balance_after columns to transactions table
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS balance_before NUMERIC(12,2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS balance_after NUMERIC(12,2);

-- 3. Add balance_before and balance_after columns to wallet_funding table
ALTER TABLE wallet_funding ADD COLUMN IF NOT EXISTS balance_before NUMERIC(12,2);
ALTER TABLE wallet_funding ADD COLUMN IF NOT EXISTS balance_after NUMERIC(12,2);
