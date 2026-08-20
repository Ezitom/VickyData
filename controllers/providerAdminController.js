/**
 * ProviderAdminController — Admin API for VTU Provider Management
 * ---------------------------------------------------------------
 * All endpoints require admin authentication (handled by router middleware).
 *
 * Routes:
 *   GET    /api/admin/providers                       — List all providers + health
 *   GET    /api/admin/providers/:slug/status          — Check one provider's live status
 *   GET    /api/admin/providers/:slug/balance         — Get provider wallet balance
 *   GET    /api/admin/providers/:slug/plans           — Fetch provider's data plans
 *   PATCH  /api/admin/providers/:slug/activate        — Activate a provider
 *   PATCH  /api/admin/providers/:slug/deactivate      — Deactivate a provider
 *   PATCH  /api/admin/providers/:slug/set-primary     — Set as primary provider
 *   PATCH  /api/admin/providers/:slug/set-priority    — Update provider priority
 *   PATCH  /api/admin/providers/:slug/maintenance     — Put into maintenance mode
 *   POST   /api/admin/providers/:slug/test-connection — Test API connection
 *   POST   /api/admin/providers/reload                — Reload registry after config change
 *   GET    /api/admin/providers/health                — Health snapshot of all providers
 *   GET    /api/admin/providers/compare-plans         — Compare plan costs across providers
 *   GET    /api/admin/providers/logs                  — Provider API logs
 *   GET    /api/admin/providers/:slug/transactions    — Provider-specific transactions
 *   GET    /api/admin/plan-mappings                   — List all provider plan mappings
 *   POST   /api/admin/plan-mappings                   — Create a plan mapping
 *   DELETE /api/admin/plan-mappings/:id               — Delete a plan mapping
 */
const supabase = require('../config/supabase');
const registry = require('../providers/ProviderRegistry');
const VTUService = require('../providers/VTUService');

// ─── Helper ──────────────────────────────────────────────────────────────────
const VALID_SLUGS = ['peacesub', 'rapidbills', 'billox', 'vtpass'];

const validateSlug = (slug) => {
  if (!VALID_SLUGS.includes(slug)) {
    return { valid: false, message: `Unknown provider slug: ${slug}` };
  }
  return { valid: true };
};

// ─── List All Providers ───────────────────────────────────────────────────────
const listProviders = async (req, res) => {
  try {
    const { data: dbProviders, error } = await supabase
      .from('vtu_providers')
      .select('*')
      .order('priority', { ascending: true });

    if (error) {
      return res.status(500).json({ message: 'Could not fetch providers from database.' });
    }

    // Enrich with runtime info
    const providers = (dbProviders || []).map(p => ({
      ...p,
      api_key_set: !!getEnvKey(p.slug) // boolean: is the API key set in env?
    }));

    return res.json({ providers });
  } catch (err) {
    console.error('listProviders error:', err);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

// ─── Get Provider Live Status ─────────────────────────────────────────────────
const getProviderStatus = async (req, res) => {
  const { slug } = req.params;
  const check = validateSlug(slug);
  if (!check.valid) return res.status(400).json({ message: check.message });

  try {
    const status = await VTUService.getProviderStatus(slug);
    // Update last_error in DB if failed
    if (!status.authenticated) {
      await supabase
        .from('vtu_providers')
        .update({ last_error: status.message, updated_at: new Date().toISOString() })
        .eq('slug', slug);
    } else {
      await supabase
        .from('vtu_providers')
        .update({ last_error: null, updated_at: new Date().toISOString() })
        .eq('slug', slug);
    }
    return res.json({ slug, ...status });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Could not check provider status.' });
  }
};

// ─── Get Provider Wallet Balance ──────────────────────────────────────────────
const getProviderBalance = async (req, res) => {
  const { slug } = req.params;
  const check = validateSlug(slug);
  if (!check.valid) return res.status(400).json({ message: check.message });

  try {
    const result = await VTUService.getProviderBalance(slug);
    return res.json({ slug, ...result });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Could not fetch balance.' });
  }
};

// ─── Get Provider Data Plans ──────────────────────────────────────────────────
const getProviderDataPlans = async (req, res) => {
  const { slug } = req.params;
  const check = validateSlug(slug);
  if (!check.valid) return res.status(400).json({ message: check.message });

  try {
    const plans = await VTUService.getProviderDataPlans(slug);
    const count = Array.isArray(plans) ? plans.length : (plans ? Object.keys(plans).length : 0);
    return res.json({ slug, count, plans });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Could not fetch plans.' });
  }
};

// ─── Activate Provider ────────────────────────────────────────────────────────
const activateProvider = async (req, res) => {
  const { slug } = req.params;
  const check = validateSlug(slug);
  if (!check.valid) return res.status(400).json({ message: check.message });

  if (slug === 'peacesub') {
    // PeaceSub is already active; just confirm
  }

  const { error } = await supabase
    .from('vtu_providers')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('slug', slug);

  if (error) return res.status(500).json({ message: 'Failed to activate provider.' });

  await VTUService.reloadRegistry();
  return res.json({ message: `Provider "${slug}" activated.`, slug, status: 'active' });
};

// ─── Deactivate Provider ──────────────────────────────────────────────────────
const deactivateProvider = async (req, res) => {
  const { slug } = req.params;
  const check = validateSlug(slug);
  if (!check.valid) return res.status(400).json({ message: check.message });

  // Safety: prevent deactivating the current primary without switching first
  const { data: primary } = await supabase
    .from('vtu_providers')
    .select('slug')
    .eq('is_primary', true)
    .eq('status', 'active')
    .maybeSingle();

  if (primary?.slug === slug) {
    return res.status(400).json({
      message: `Cannot deactivate "${slug}" because it is the current PRIMARY provider. Switch primary first.`
    });
  }

  const { error } = await supabase
    .from('vtu_providers')
    .update({ status: 'inactive', updated_at: new Date().toISOString() })
    .eq('slug', slug);

  if (error) return res.status(500).json({ message: 'Failed to deactivate provider.' });

  await VTUService.reloadRegistry();
  return res.json({ message: `Provider "${slug}" deactivated.`, slug, status: 'inactive' });
};

// ─── Set Primary Provider ─────────────────────────────────────────────────────
const setPrimaryProvider = async (req, res) => {
  const { slug } = req.params;
  const check = validateSlug(slug);
  if (!check.valid) return res.status(400).json({ message: check.message });

  // Ensure the target provider is active
  const { data: target } = await supabase
    .from('vtu_providers')
    .select('status')
    .eq('slug', slug)
    .maybeSingle();

  if (!target || target.status !== 'active') {
    return res.status(400).json({
      message: `Provider "${slug}" must be active before it can be set as primary. Activate it first.`
    });
  }

  // Remove primary from all providers
  await supabase
    .from('vtu_providers')
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .neq('slug', 'NONE'); // updates all rows

  // Set new primary
  const { error } = await supabase
    .from('vtu_providers')
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq('slug', slug);

  if (error) return res.status(500).json({ message: 'Failed to set primary provider.' });

  await VTUService.reloadRegistry();

  console.log(`[ADMIN] Primary VTU provider switched to: ${slug}`);
  return res.json({
    message: `Primary provider switched to "${slug}". All new customer transactions will now route through ${slug}.`,
    slug,
    is_primary: true
  });
};

// ─── Set Provider Priority ────────────────────────────────────────────────────
const setProviderPriority = async (req, res) => {
  const { slug } = req.params;
  const { priority } = req.body;
  const check = validateSlug(slug);
  if (!check.valid) return res.status(400).json({ message: check.message });

  if (!priority || isNaN(parseInt(priority))) {
    return res.status(400).json({ message: 'priority must be a number.' });
  }

  const { error } = await supabase
    .from('vtu_providers')
    .update({ priority: parseInt(priority), updated_at: new Date().toISOString() })
    .eq('slug', slug);

  if (error) return res.status(500).json({ message: 'Failed to update priority.' });

  await VTUService.reloadRegistry();
  return res.json({ message: `Provider "${slug}" priority set to ${priority}.` });
};

// ─── Maintenance Mode ─────────────────────────────────────────────────────────
const setMaintenanceMode = async (req, res) => {
  const { slug } = req.params;
  const check = validateSlug(slug);
  if (!check.valid) return res.status(400).json({ message: check.message });

  const { error } = await supabase
    .from('vtu_providers')
    .update({ status: 'maintenance', updated_at: new Date().toISOString() })
    .eq('slug', slug);

  if (error) return res.status(500).json({ message: 'Failed to set maintenance mode.' });

  await VTUService.reloadRegistry();
  return res.json({ message: `Provider "${slug}" put into maintenance mode.`, slug, status: 'maintenance' });
};

// ─── Test Provider Connection ─────────────────────────────────────────────────
const testConnection = async (req, res) => {
  const { slug } = req.params;
  const check = validateSlug(slug);
  if (!check.valid) return res.status(400).json({ message: check.message });

  const tests = { authentication: null, balance: null, data_plans: null };

  // Test 1: Auth + connectivity
  try {
    tests.authentication = await VTUService.getProviderStatus(slug);
  } catch (err) {
    tests.authentication = { reachable: false, authenticated: false, message: err.message };
  }

  // Test 2: Balance
  try {
    tests.balance = await VTUService.getProviderBalance(slug);
    tests.balance.success = true;
  } catch (err) {
    tests.balance = { success: false, error: err.message };
  }

  // Test 3: Data plan fetch
  try {
    const plans = await VTUService.getProviderDataPlans(slug);
    tests.data_plans = { success: true, count: plans.length, sample: plans.slice(0, 3) };
  } catch (err) {
    tests.data_plans = { success: false, error: err.message };
  }

  const overallSuccess = tests.authentication?.authenticated && tests.balance?.success;

  // Update DB with test results
  await supabase
    .from('vtu_providers')
    .update({
      last_error: overallSuccess ? null : (tests.authentication?.message || 'Test failed'),
      updated_at: new Date().toISOString()
    })
    .eq('slug', slug);

  return res.json({
    slug,
    overall_success: overallSuccess,
    tests
  });
};

// ─── Health Snapshot — All Providers ─────────────────────────────────────────
const getHealthSnapshot = async (req, res) => {
  const health = [];
  for (const slug of VALID_SLUGS) {
    let statusResult = { reachable: false, authenticated: false, message: 'Not checked' };
    let balanceResult = { balance: null, currency: 'NGN' };

    try {
      statusResult = await VTUService.getProviderStatus(slug);
    } catch {}

    try {
      if (statusResult.authenticated) {
        balanceResult = await VTUService.getProviderBalance(slug);
      }
    } catch {}

    // Get transaction stats from DB
    const { data: successCount } = await supabase
      .from('vtu_provider_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('provider_slug', slug)
      .eq('internal_status', 'SUCCESS');

    const { data: failCount } = await supabase
      .from('vtu_provider_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('provider_slug', slug)
      .eq('internal_status', 'FAILED');

    const { data: dbConfig } = await supabase
      .from('vtu_providers')
      .select('status, is_primary, priority, last_error, last_success_at, last_failure_at')
      .eq('slug', slug)
      .maybeSingle();

    health.push({
      slug,
      api_status: statusResult,
      balance: balanceResult,
      db_config: dbConfig || {},
      stats: {
        success_count: successCount || 0,
        fail_count: failCount || 0
      }
    });
  }

  return res.json({ health, checked_at: new Date().toISOString() });
};

// ─── Compare Plans Across Providers ──────────────────────────────────────────
const comparePlans = async (req, res) => {
  try {
    const { data: mappings, error } = await supabase
      .from('provider_plan_mappings')
      .select(`
        *,
        data_plans (id, network, plan_name, size, validity, selling_price, cost_price)
      `)
      .order('data_plan_id');

    if (error) return res.status(500).json({ message: 'Could not fetch plan mappings.' });

    // Group by internal plan
    const comparison = {};
    for (const m of (mappings || [])) {
      const planId = m.data_plan_id;
      if (!comparison[planId]) {
        comparison[planId] = {
          internal_plan: m.data_plans,
          providers: {}
        };
      }
      comparison[planId].providers[m.provider_slug] = {
        provider_plan_id: m.provider_plan_id,
        provider_plan_name: m.provider_plan_name,
        provider_cost: m.provider_cost,
        is_verified: m.is_verified
      };
    }

    return res.json({
      comparison: Object.values(comparison),
      total_plans: Object.keys(comparison).length
    });
  } catch (err) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

// ─── Provider API Logs ────────────────────────────────────────────────────────
const getProviderLogs = async (req, res) => {
  const { slug, limit = 50, offset = 0 } = req.query;
  try {
    let query = supabase
      .from('vtu_provider_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit))
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (slug) query = query.eq('provider_slug', slug);

    const { data: logs, error } = await query;
    if (error) return res.status(500).json({ message: 'Could not fetch logs.' });
    return res.json({ logs: logs || [], count: logs?.length || 0 });
  } catch (err) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

// ─── Provider Transactions ────────────────────────────────────────────────────
const getProviderTransactions = async (req, res) => {
  const { slug } = req.params;
  const { limit = 50, status } = req.query;

  try {
    let query = supabase
      .from('transactions')
      .select('*, users(full_name, email)')
      .eq('provider_slug', slug)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (status) query = query.eq('status', status);

    const { data: transactions, error } = await query;
    if (error) return res.status(500).json({ message: 'Could not fetch transactions.' });
    return res.json({ transactions: transactions || [] });
  } catch (err) {
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

// ─── Reload Registry ──────────────────────────────────────────────────────────
const reloadRegistry = async (req, res) => {
  try {
    await VTUService.reloadRegistry();
    const allSlugs = VTUService.getAllProviderSlugs();
    return res.json({ message: 'Provider registry reloaded.', providers: allSlugs });
  } catch (err) {
    return res.status(500).json({ message: 'Reload failed: ' + err.message });
  }
};

// ─── Plan Mappings CRUD ───────────────────────────────────────────────────────
const listPlanMappings = async (req, res) => {
  const { provider_slug, data_plan_id } = req.query;
  let query = supabase
    .from('provider_plan_mappings')
    .select('*, data_plans(network, plan_name, size, validity, selling_price)')
    .order('data_plan_id');

  if (provider_slug) query = query.eq('provider_slug', provider_slug);
  if (data_plan_id) query = query.eq('data_plan_id', data_plan_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ message: 'Could not fetch plan mappings.' });
  return res.json({ mappings: data || [] });
};

const createPlanMapping = async (req, res) => {
  const { data_plan_id, provider_slug, provider_plan_id, provider_plan_name, provider_cost, notes } = req.body;

  if (!data_plan_id || !provider_slug || !provider_plan_id) {
    return res.status(400).json({ message: 'data_plan_id, provider_slug, and provider_plan_id are required.' });
  }

  const { data, error } = await supabase
    .from('provider_plan_mappings')
    .upsert(
      { data_plan_id, provider_slug, provider_plan_id, provider_plan_name, provider_cost, notes, updated_at: new Date().toISOString() },
      { onConflict: 'data_plan_id,provider_slug' }
    )
    .select()
    .single();

  if (error) return res.status(500).json({ message: 'Could not save plan mapping.' });
  return res.status(201).json({ message: 'Plan mapping saved.', mapping: data });
};

const deletePlanMapping = async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('provider_plan_mappings').delete().eq('id', id);
  if (error) return res.status(500).json({ message: 'Could not delete plan mapping.' });
  return res.json({ message: 'Plan mapping deleted.' });
};

// ─── Helper: get env key for a slug ──────────────────────────────────────────
function getEnvKey(slug) {
  const keys = {
    peacesub: process.env.PEACESUB_API_KEY,
    rapidbills: process.env.RAPIDBILLS_API_KEY,
    billox: process.env.BILLOX_API_KEY,
    vtpass: process.env.VTPASS_PUBLIC_KEY
  };
  return keys[slug] || null;
}

module.exports = {
  listProviders,
  getProviderStatus,
  getProviderBalance,
  getProviderDataPlans,
  activateProvider,
  deactivateProvider,
  setPrimaryProvider,
  setProviderPriority,
  setMaintenanceMode,
  testConnection,
  getHealthSnapshot,
  comparePlans,
  getProviderLogs,
  getProviderTransactions,
  reloadRegistry,
  listPlanMappings,
  createPlanMapping,
  deletePlanMapping
};
