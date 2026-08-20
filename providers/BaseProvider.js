/**
 * BaseProvider — Abstract VTU Provider Interface
 * -----------------------------------------------
 * All provider adapters (PeaceSub, RapidBills, Billox, VTpass) MUST extend
 * this class and implement every method marked @abstract.
 *
 * This ensures the VTU service layer can call any provider interchangeably.
 */
class BaseProvider {
  constructor(config) {
    if (new.target === BaseProvider) {
      throw new Error('BaseProvider is abstract and cannot be instantiated directly.');
    }
    this.config = config;
    this.slug = config.slug;
    this.name = config.name;
  }

  // ── Interface Methods (must be overridden) ─────────────────────────────────

  /**
   * Check provider API connection and authentication.
   * @returns {Promise<{reachable: boolean, authenticated: boolean, message: string}>}
   */
  async getProviderStatus() {
    throw new Error(`${this.name}.getProviderStatus() not implemented.`);
  }

  /**
   * Fetch provider wallet balance.
   * @returns {Promise<{balance: number, currency: string}>}
   */
  async getBalance() {
    throw new Error(`${this.name}.getBalance() not implemented.`);
  }

  /**
   * Fetch available data plans from the provider.
   * @returns {Promise<Array>}
   */
  async getDataPlans() {
    throw new Error(`${this.name}.getDataPlans() not implemented.`);
  }

  /**
   * Purchase a data bundle.
   * @param {object} params
   * @param {string} params.phone_number
   * @param {string} params.network          - Internal network name (mtn, glo, etc.)
   * @param {string|number} params.bundle_id - Provider-specific plan/bundle ID
   * @param {string} params.internal_ref     - Our internal transaction reference (idempotency key)
   * @returns {Promise<{success: boolean, status: string, provider_reference: string|null, raw_response: object, error_message: string|null}>}
   */
  async purchaseData(params) {
    throw new Error(`${this.name}.purchaseData() not implemented.`);
  }

  /**
   * Purchase airtime.
   * @param {object} params
   * @param {string} params.phone_number
   * @param {string} params.network       - Internal network name
   * @param {number} params.amount
   * @param {string} params.internal_ref  - Our internal transaction reference
   * @returns {Promise<{success: boolean, status: string, provider_reference: string|null, raw_response: object, error_message: string|null}>}
   */
  async purchaseAirtime(params) {
    throw new Error(`${this.name}.purchaseAirtime() not implemented.`);
  }

  /**
   * Query the status of a transaction by provider reference.
   * @param {string} providerReference
   * @returns {Promise<{status: string, raw_response: object}>}
   */
  async getTransactionStatus(providerReference) {
    throw new Error(`${this.name}.getTransactionStatus() not implemented.`);
  }

  /**
   * Process an incoming webhook payload from the provider.
   * @param {object} payload  - Raw webhook body
   * @param {object} headers  - Request headers (for signature verification)
   * @returns {Promise<{provider_reference: string|null, status: string, raw_payload: object}>}
   */
  async processWebhook(payload, headers) {
    throw new Error(`${this.name}.processWebhook() not implemented.`);
  }

  // ── Utility: Normalize Status ──────────────────────────────────────────────

  /**
   * Map a provider-specific status string to our internal unified status.
   * @param {string} providerStatus
   * @returns {string} - One of: PENDING, PROCESSING, SUCCESS, FAILED, REFUNDED, REQUIRES_REQUERY
   */
  normalizeStatus(providerStatus) {
    const s = String(providerStatus || '').toLowerCase().trim();

    const SUCCESS_STATES = ['successful', 'success', 'true', '1', 'ok', 'delivered', 'completed', 'paid'];
    const PROCESSING_STATES = ['processing', 'pending', 'queued', 'initiated'];
    const FAILED_STATES = ['failed', 'failure', 'cancelled', 'rejected', 'error', 'false', '0'];

    if (SUCCESS_STATES.includes(s)) return 'SUCCESS';
    if (PROCESSING_STATES.includes(s)) return 'PROCESSING';
    if (FAILED_STATES.includes(s)) return 'FAILED';
    return 'REQUIRES_REQUERY';
  }

  /**
   * Safely extract an error message from a provider response.
   * @param {object} responseData
   * @param {string} defaultMsg
   * @returns {string}
   */
  extractErrorMessage(responseData, defaultMsg = 'Provider error') {
    if (!responseData) return defaultMsg;
    return (
      responseData.message ||
      responseData.error ||
      responseData.detail ||
      responseData.description ||
      String(responseData.status || defaultMsg)
    );
  }

  /**
   * Build a standardized provider result object for success scenarios.
   */
  buildSuccessResult(providerReference, rawResponse) {
    return {
      success: true,
      status: 'SUCCESS',
      provider_reference: providerReference ? String(providerReference) : null,
      raw_response: rawResponse,
      error_message: null
    };
  }

  /**
   * Build a standardized provider result object for processing (pending) scenarios.
   */
  buildProcessingResult(providerReference, rawResponse) {
    return {
      success: false,
      status: 'PROCESSING',
      provider_reference: providerReference ? String(providerReference) : null,
      raw_response: rawResponse,
      error_message: null
    };
  }

  /**
   * Build a standardized provider result object for failure scenarios.
   */
  buildFailureResult(errorMessage, rawResponse) {
    return {
      success: false,
      status: 'FAILED',
      provider_reference: null,
      raw_response: rawResponse || {},
      error_message: errorMessage
    };
  }
}

module.exports = BaseProvider;
