-- ============================================================
-- VICKYDATA: Data Plan Price List Update — 2026-07-24
-- Run in the Supabase SQL editor.
-- Uses UPDATE + INSERT pattern — no UNIQUE constraint needed.
-- Only columns that exist in the live table are referenced.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 9MOBILE — CORPORATE GIFTING (bundle_ids: 255,257,259–264)
-- ────────────────────────────────────────────────────────────

-- Updates existing rows
UPDATE data_plans SET plan_name='9mobile 100MB 30 Days',  size='100MB',  validity='30 days', cost_price=80.00,   selling_price=80.00,   is_active=true WHERE bundle_id=255;
UPDATE data_plans SET plan_name='9mobile 500MB 30 Days',  size='500MB',  validity='30 days', cost_price=110.00,  selling_price=110.00,  is_active=true WHERE bundle_id=257;
UPDATE data_plans SET plan_name='9mobile 1GB 1 Month',    size='1GB',    validity='1 month', cost_price=200.00,  selling_price=200.00,  is_active=true WHERE bundle_id=259;
UPDATE data_plans SET plan_name='9mobile 2GB 30 Days',    size='2GB',    validity='30 days', cost_price=400.00,  selling_price=400.00,  is_active=true WHERE bundle_id=260;
UPDATE data_plans SET plan_name='9mobile 3GB 1 Month',    size='3GB',    validity='1 month', cost_price=600.00,  selling_price=600.00,  is_active=true WHERE bundle_id=261;
UPDATE data_plans SET plan_name='9mobile 4.5GB 1 Month',  size='4.5GB',  validity='1 month', cost_price=900.00,  selling_price=900.00,  is_active=true WHERE bundle_id=262;
UPDATE data_plans SET plan_name='9mobile 5GB 1 Month',    size='5GB',    validity='1 month', cost_price=1000.00, selling_price=1000.00, is_active=true WHERE bundle_id=263;
UPDATE data_plans SET plan_name='9mobile 10GB 1 Month',   size='10GB',   validity='1 month', cost_price=2000.00, selling_price=2000.00, is_active=true WHERE bundle_id=264;

-- Inserts rows that don't exist yet
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT '9mobile','9mobile 100MB 30 Days', '100MB','30 days',255, 80.00,   80.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=255);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT '9mobile','9mobile 500MB 30 Days', '500MB','30 days',257, 110.00, 110.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=257);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT '9mobile','9mobile 1GB 1 Month',   '1GB',  '1 month',259, 200.00, 200.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=259);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT '9mobile','9mobile 2GB 30 Days',   '2GB',  '30 days',260, 400.00, 400.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=260);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT '9mobile','9mobile 3GB 1 Month',   '3GB',  '1 month',261, 600.00, 600.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=261);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT '9mobile','9mobile 4.5GB 1 Month', '4.5GB','1 month',262, 900.00, 900.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=262);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT '9mobile','9mobile 5GB 1 Month',   '5GB',  '1 month',263,1000.00,1000.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=263);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT '9mobile','9mobile 10GB 1 Month',  '10GB', '1 month',264,2000.00,2000.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=264);


-- ────────────────────────────────────────────────────────────
-- AIRTEL — GIFTING (bundle_ids: 222,223,224,225,228,230,333)
-- ────────────────────────────────────────────────────────────

UPDATE data_plans SET plan_name='Airtel 600MB 2 Days',  size='600MB', validity='2 days',  cost_price=400.00,  selling_price=400.00,  is_active=true WHERE bundle_id=222;
UPDATE data_plans SET plan_name='Airtel 1.5GB 1 Day',   size='1.5GB', validity='1 day',   cost_price=650.00,  selling_price=650.00,  is_active=true WHERE bundle_id=223;
UPDATE data_plans SET plan_name='Airtel 2GB 2 Days',    size='2GB',   validity='2 days',  cost_price=900.00,  selling_price=900.00,  is_active=true WHERE bundle_id=224;
UPDATE data_plans SET plan_name='Airtel 3GB 2 Days',    size='3GB',   validity='2 days',  cost_price=1000.00, selling_price=1000.00, is_active=true WHERE bundle_id=225;
UPDATE data_plans SET plan_name='Airtel 300MB 2 Days',  size='300MB', validity='2 days',  cost_price=250.00,  selling_price=250.00,  is_active=true WHERE bundle_id=228;
UPDATE data_plans SET plan_name='Airtel 10GB 30 Days',  size='10GB',  validity='30 days', cost_price=4050.00, selling_price=4050.00, is_active=true WHERE bundle_id=230;
UPDATE data_plans SET plan_name='Airtel 150MB Daily',   size='150MB', validity='Daily',   cost_price=100.00,  selling_price=100.00,  is_active=true WHERE bundle_id=333;

INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Airtel','Airtel 600MB 2 Days', '600MB','2 days', 222, 400.00,  400.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=222);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Airtel','Airtel 1.5GB 1 Day',  '1.5GB','1 day',  223, 650.00,  650.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=223);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Airtel','Airtel 2GB 2 Days',   '2GB',  '2 days', 224, 900.00,  900.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=224);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Airtel','Airtel 3GB 2 Days',   '3GB',  '2 days', 225,1000.00, 1000.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=225);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Airtel','Airtel 300MB 2 Days', '300MB','2 days', 228, 250.00,  250.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=228);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Airtel','Airtel 10GB 30 Days', '10GB', '30 days',230,4050.00, 4050.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=230);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Airtel','Airtel 150MB Daily',  '150MB','Daily',  333, 100.00,  100.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=333);


-- ────────────────────────────────────────────────────────────
-- GLO — CORPORATE GIFTING (bundle_ids: 239–245, 339–344)
-- ────────────────────────────────────────────────────────────

UPDATE data_plans SET plan_name='Glo 500MB 14 Days', size='500MB', validity='14 days', cost_price=250.00,  selling_price=250.00,  is_active=true WHERE bundle_id=239;
UPDATE data_plans SET plan_name='Glo 1GB 30 Days',   size='1GB',   validity='30 days', cost_price=450.00,  selling_price=450.00,  is_active=true WHERE bundle_id=240;
UPDATE data_plans SET plan_name='Glo 2GB 30 Days',   size='2GB',   validity='30 days', cost_price=900.00,  selling_price=900.00,  is_active=true WHERE bundle_id=241;
UPDATE data_plans SET plan_name='Glo 3GB 30 Days',   size='3GB',   validity='30 days', cost_price=1350.00, selling_price=1350.00, is_active=true WHERE bundle_id=242;
UPDATE data_plans SET plan_name='Glo 5GB 30 Days',   size='5GB',   validity='30 days', cost_price=2250.00, selling_price=2250.00, is_active=true WHERE bundle_id=243;
UPDATE data_plans SET plan_name='Glo 10GB 30 Days',  size='10GB',  validity='30 days', cost_price=4500.00, selling_price=4500.00, is_active=true WHERE bundle_id=244;
UPDATE data_plans SET plan_name='Glo 200MB 14 Days', size='200MB', validity='14 days', cost_price=110.00,  selling_price=110.00,  is_active=true WHERE bundle_id=245;
UPDATE data_plans SET plan_name='Glo 1GB 3 Days',    size='1GB',   validity='3 days',  cost_price=300.00,  selling_price=300.00,  is_active=true WHERE bundle_id=339;
UPDATE data_plans SET plan_name='Glo 3GB 3 Days',    size='3GB',   validity='3 days',  cost_price=900.00,  selling_price=900.00,  is_active=true WHERE bundle_id=340;
UPDATE data_plans SET plan_name='Glo 5GB 3 Days',    size='5GB',   validity='3 days',  cost_price=1500.00, selling_price=1500.00, is_active=true WHERE bundle_id=341;
UPDATE data_plans SET plan_name='Glo 1GB 7 Days',    size='1GB',   validity='7 days',  cost_price=400.00,  selling_price=400.00,  is_active=true WHERE bundle_id=342;
UPDATE data_plans SET plan_name='Glo 3GB 7 Days',    size='3GB',   validity='7 days',  cost_price=1200.00, selling_price=1200.00, is_active=true WHERE bundle_id=343;
UPDATE data_plans SET plan_name='Glo 5GB 7 Days',    size='5GB',   validity='7 days',  cost_price=2000.00, selling_price=2000.00, is_active=true WHERE bundle_id=344;

INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Glo','Glo 500MB 14 Days','500MB','14 days',239, 250.00,  250.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=239);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Glo','Glo 1GB 30 Days',  '1GB',  '30 days',240, 450.00,  450.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=240);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Glo','Glo 2GB 30 Days',  '2GB',  '30 days',241, 900.00,  900.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=241);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Glo','Glo 3GB 30 Days',  '3GB',  '30 days',242,1350.00, 1350.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=242);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Glo','Glo 5GB 30 Days',  '5GB',  '30 days',243,2250.00, 2250.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=243);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Glo','Glo 10GB 30 Days', '10GB', '30 days',244,4500.00, 4500.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=244);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Glo','Glo 200MB 14 Days','200MB','14 days',245, 110.00,  110.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=245);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Glo','Glo 1GB 3 Days',   '1GB',  '3 days', 339, 300.00,  300.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=339);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Glo','Glo 3GB 3 Days',   '3GB',  '3 days', 340, 900.00,  900.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=340);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Glo','Glo 5GB 3 Days',   '5GB',  '3 days', 341,1500.00, 1500.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=341);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Glo','Glo 1GB 7 Days',   '1GB',  '7 days', 342, 400.00,  400.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=342);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Glo','Glo 3GB 7 Days',   '3GB',  '7 days', 343,1200.00, 1200.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=343);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'Glo','Glo 5GB 7 Days',   '5GB',  '7 days', 344,2000.00, 2000.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=344);


-- ────────────────────────────────────────────────────────────
-- MTN — SME (PeaceSub API plans: 353, 354, 355, 356 ONLY)
-- ────────────────────────────────────────────────────────────

UPDATE data_plans SET plan_name='MTN SME 1GB Monthly', size='1GB', validity='1 month', cost_price=240.00,  selling_price=240.00,  is_active=true WHERE bundle_id=353;
UPDATE data_plans SET plan_name='MTN SME 2GB 30 Days', size='2GB', validity='30 days', cost_price=480.00,  selling_price=480.00,  is_active=true WHERE bundle_id=354;
UPDATE data_plans SET plan_name='MTN SME 3GB Monthly', size='3GB', validity='Monthly', cost_price=720.00,  selling_price=720.00,  is_active=true WHERE bundle_id=355;
UPDATE data_plans SET plan_name='MTN SME 5GB Monthly', size='5GB', validity='Monthly', cost_price=1200.00, selling_price=1200.00, is_active=true WHERE bundle_id=356;

INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'MTN','MTN SME 1GB Monthly','1GB','1 month',353, 240.00,  240.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=353);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'MTN','MTN SME 2GB 30 Days','2GB','30 days',354, 480.00,  480.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=354);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'MTN','MTN SME 3GB Monthly','3GB','Monthly', 355, 720.00,  720.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=355);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'MTN','MTN SME 5GB Monthly','5GB','Monthly', 356,1200.00, 1200.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=356);


-- ────────────────────────────────────────────────────────────
-- MTN — GIFTING (bundle_ids: 247,327,348,349,350,351,352)
-- ────────────────────────────────────────────────────────────

UPDATE data_plans SET plan_name='MTN Gifting 1GB 1 Day',    size='1GB',    validity='1 day',   cost_price=250.00,  selling_price=250.00,  is_active=true WHERE bundle_id=247;
UPDATE data_plans SET plan_name='MTN Gifting 2.56GB 1 Day', size='2.56GB', validity='1 day',   cost_price=630.00,  selling_price=630.00,  is_active=true WHERE bundle_id=327;
UPDATE data_plans SET plan_name='MTN Gifting 1GB 1 Day B',  size='1GB',    validity='1 day',   cost_price=290.00,  selling_price=290.00,  is_active=true WHERE bundle_id=348;
UPDATE data_plans SET plan_name='MTN Gifting 2.5GB 1 Day',  size='2.5GB',  validity='1 day',   cost_price=615.00,  selling_price=615.00,  is_active=true WHERE bundle_id=349;
UPDATE data_plans SET plan_name='MTN Gifting 2GB 1 Day',    size='2GB',    validity='1 day',   cost_price=580.00,  selling_price=580.00,  is_active=true WHERE bundle_id=350;
UPDATE data_plans SET plan_name='MTN Gifting 3GB 1 Day',    size='3GB',    validity='1 day',   cost_price=735.00,  selling_price=735.00,  is_active=true WHERE bundle_id=351;
UPDATE data_plans SET plan_name='MTN Gifting 5GB 2 Weeks',  size='5GB',    validity='2 weeks', cost_price=1500.00, selling_price=1500.00, is_active=true WHERE bundle_id=352;

INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'MTN','MTN Gifting 1GB 1 Day',    '1GB',   '1 day',  247, 250.00,  250.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=247);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'MTN','MTN Gifting 2.56GB 1 Day', '2.56GB','1 day',  327, 630.00,  630.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=327);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'MTN','MTN Gifting 1GB 1 Day B',  '1GB',   '1 day',  348, 290.00,  290.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=348);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'MTN','MTN Gifting 2.5GB 1 Day',  '2.5GB', '1 day',  349, 615.00,  615.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=349);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'MTN','MTN Gifting 2GB 1 Day',    '2GB',   '1 day',  350, 580.00,  580.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=350);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'MTN','MTN Gifting 3GB 1 Day',    '3GB',   '1 day',  351, 735.00,  735.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=351);
INSERT INTO data_plans (network, plan_name, size, validity, bundle_id, cost_price, selling_price, is_active)
SELECT 'MTN','MTN Gifting 5GB 2 Weeks',  '5GB',   '2 weeks',352,1500.00, 1500.00,  true WHERE NOT EXISTS (SELECT 1 FROM data_plans WHERE bundle_id=352);


-- ============================================================
-- ⚠️  FLAGGED FOR REVIEW — Not in new provider list
-- These are the original seed placeholder plans.
-- Run the query below to check if they still exist, then
-- deactivate manually if confirmed stale.
--
-- SELECT id, network, plan_name, bundle_id, is_active
-- FROM data_plans
-- WHERE bundle_id IN (101,102,103,104,201,202,203,204,301,302,303,304,401,402,403,404)
-- ORDER BY bundle_id;
--
-- To deactivate:
-- UPDATE data_plans SET is_active = false
-- WHERE bundle_id IN (101,102,103,104,201,202,203,204,301,302,303,304,401,402,403,404);
-- ============================================================
