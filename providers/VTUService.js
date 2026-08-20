/**
 * VTUService — Provider Abstraction / Service Layer
 * --------------------------------------------------
 * The single point of contact between the purchase controller and
 * all VTU provider adapters. No controller code needs to know which
 * provider is active.
 *
 * Flow:
 *   purchaseController → VTUService → ProviderRegistry → ActiveProvider
 *
 * PEACESUB IS PRIMARY. No live transaction is ever routed to a standby
 * provider unless the admin explicitly activates it in the database.
 *
 * Safety guarantees:
 *  • ONE wallet deduction per internal_ref (idempotency is enforced at
 *    controller level before calling this service).
 *  • Timeout → REQUIRES_REQUERY (never auto-retry without requery).
 *  • Fallback is architecturally available but DISABLED by default.
 */
const registry = require('./ProviderRegistry');
const supabase = require('../config/supabase');

// ─── Provider Transaction Logger ─────────────────────────────────────────────
/**
 * Log every provider API interaction to the vtu_provider_logs table.
 * Never logs API keys, tokens, or raw credentials.
 */
const logProviderTransaction = async ({
  internal_transaction_id,
  provider_slug,
  endpoint,
  request_timestamp,
  response_timestamp,
  http_status,
  provider_reference,
  internal_status,
  error_message
}) => {
  try {
    await supabase.from('vtu_provider_logs').insert({
      internal_transaction_id: internal_transaction_id || null,
      provider_slug: provider_slug || null,
      endpoint: endpoint || null,
      request_timestamp: request_timestamp || new Date().toISOString(),
      response_timestamp: response_timestamp || new Date().toISOString(),
      http_status: http_status || null,
      provider_reference: provider_reference || null,
      internal_status: internal_status || null,
      error_message: error_message || null
    });
  } catch (err) {
    // Log errors must never interrupt the main flow
    console.error('[VTUService] Log error:', err.message);
  }
};

// ─── VTU Service ─────────────────────────────────────────────────────────────
const VTUService = {

  /**
   * Purchase data through the active primary provider.
   *
   * @param {object} params
   * @param {string} params.internal_ref   - Our internal transaction reference (VD-DATA-xxx)
   * @param {string} params.phone_number
   * @param {string} params.network        - mtn|glo|airtel|9mobile
   * @param {string|number} params.bundle_id - Provider plan ID (from provider_plan_mappings)
   * @param {number} params.amount         - Selling price (used for VTpass which needs amount)
   * @returns {Promise<ProviderResult>}
   */
  async purchaseData(params) {
    const provider = await registry.getPrimaryProvider();
    if (!provider) {
      throw new Error('No active VTU provider available.');
    }

    const started = new Date().toISOString();
    let result;

    try {
      result = await provider.purchaseData(params);
    } catch (err) {
      result = {
        success: false,
        status: 'FAILED',
        provider_reference: null,
        raw_response: {},
        error_message: err.message
      };
    }

    const ended = new Date().toISOString();

    await logProviderTransaction({
      internal_transaction_id: params.internal_ref,
      provider_slug: provider.slug,
      endpoint: 'purchaseData',
      request_timestamp: started,
      response_timestamp: ended,
      provider_reference: result.provider_reference,
      internal_status: result.status,
      error_message: result.error_message
    });

    return { ...result, provider_slug: provider.slug };
  },

  /**
   * Purchase airtime through the active primary provider.
   */
  async purchaseAirtime(params) {
    const provider = await registry.getPrimaryProvider();
    if (!provider) {
      throw new Error('No active VTU provider available.');
    }

    const started = new Date().toISOString();
    let result;

    try {
      result = await provider.purchaseAirtime(params);
    } catch (err) {
      result = {
        success: false,
        status: 'FAILED',
        provider_reference: null,
        raw_response: {},
        error_message: err.message
      };
    }

    const ended = new Date().toISOString();

    await logProviderTransaction({
      internal_transaction_id: params.internal_ref,
      provider_slug: provider.slug,
      endpoint: 'purchaseAirtime',
      request_timestamp: started,
      response_timestamp: ended,
      provider_reference: result.provider_reference,
      internal_status: result.status,
      error_message: result.error_message
    });

    return { ...result, provider_slug: provider.slug };
  },

  /**
   * Get the primary active provider instance.
   */
  async getPrimaryProvider() {
    return registry.getPrimaryProvider();
  },

  /**
   * Get the primary provider's wallet balance.
   */
  async getPrimaryBalance() {
    const provider = await registry.getPrimaryProvider();
    return provider.getBalance();
  },

  /**
   * Get wallet balance for a specific provider slug.
   */
  async getProviderBalance(slug) {
    const provider = registry.get(slug);
    if (!provider) throw new Error(`Provider "${slug}" not found.`);
    return provider.getBalance();
  },

  /**
   * Check provider status/health.
   */
  async getProviderStatus(slug) {
    const provider = registry.get(slug);
    if (!provider) throw new Error(`Provider "${slug}" not found.`);
    return provider.getProviderStatus();
  },

  /**
   * Get data plans from a specific provider.
   */
  async getProviderDataPlans(slug) {
    const provider = registry.get(slug);
    if (!provider) throw new Error(`Provider "${slug}" not found.`);
    return provider.getDataPlans();
  },

  /**
   * Requery a transaction status from a specific provider.
   */
  async requeryTransaction(slug, providerReference) {
    const provider = registry.get(slug);
    if (!provider) throw new Error(`Provider "${slug}" not found.`);
    return provider.getTransactionStatus(providerReference);
  },

  /**
   * Process a webhook from a specific provider.
   */
  async processWebhook(slug, payload, headers) {
    const provider = registry.get(slug);
    if (!provider) throw new Error(`Provider "${slug}" not found.`);
    return provider.processWebhook(payload, headers);
  },

  /**
   * Get all provider slugs known to the system.
   */
  getAllProviderSlugs() {
    return registry.getAllProviders().map(p => p.slug);
  },

  /**
   * Force-reload the provider registry (after admin changes DB config).
   */
  async reloadRegistry() {
    return registry.reload();
  }
};

module.exports = VTUService;
