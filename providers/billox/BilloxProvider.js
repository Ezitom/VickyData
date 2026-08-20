/**
 * BilloxProvider — Adapter for Billox VTU API
 * ---------------------------------------------
 * Based on known Billox API details:
 * Base URL:  https://app-api.billox.ng/api
 * Auth:      Authorization: Bearer YOUR_TOKEN
 *
 * NOTE: Billox does not publish a comprehensive public API doc.
 * Endpoints below follow the standard Nigerian VTU API pattern confirmed
 * from their platform info. The admin must verify actual endpoint paths
 * once API access is granted from Billox dashboard.
 *
 * STATUS: STANDBY — Not routed to live customers until admin activates it.
 */
const BaseProvider = require('../BaseProvider');
const axios = require('axios');

class BilloxProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this._client = axios.create({
      baseURL: config.api_base_url || process.env.BILLOX_BASE_URL || 'https://app-api.billox.ng/api',
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.api_key || process.env.BILLOX_API_KEY || ''}`
      }
    });

    // Billox network mapping (update these once you confirm from dashboard)
    this._networkMap = {
      'mtn': 'MTN',
      'glo': 'GLO',
      '9mobile': '9MOBILE',
      'airtel': 'AIRTEL'
    };
  }

  /**
   * Test Billox connectivity and auth.
   */
  async getProviderStatus() {
    try {
      const res = await this._client.get('/user/balance');
      const ok = res.status === 200;
      return {
        reachable: true,
        authenticated: ok,
        message: ok ? 'Billox API reachable' : 'Auth may have failed'
      };
    } catch (err) {
      return {
        reachable: !!err.response,
        authenticated: false,
        message: err.response?.data?.message || err.message || 'Unreachable'
      };
    }
  }

  /**
   * Get Billox wallet balance.
   * Typical endpoint: GET /user/balance  (verify from dashboard)
   */
  async getBalance() {
    try {
      const res = await this._client.get('/user/balance');
      const balance = parseFloat(
        res.data?.data?.balance ||
        res.data?.balance ||
        res.data?.wallet_balance ||
        0
      );
      return { balance, currency: 'NGN' };
    } catch (err) {
      // Try alternative endpoint
      const res = await this._client.get('/balance');
      const balance = parseFloat(res.data?.data?.balance || res.data?.balance || 0);
      return { balance, currency: 'NGN' };
    }
  }

  /**
   * Get data plans from Billox.
   * Typical endpoint: GET /data/plans  (verify from dashboard)
   */
  async getDataPlans() {
    const res = await this._client.get('/data/plans');
    const plans = res.data?.data || res.data?.plans || res.data || [];
    return Array.isArray(plans) ? plans : [];
  }

  /**
   * Purchase data via Billox.
   * Typical endpoint: POST /data/buy  (verify from dashboard)
   *
   * IMPORTANT: Update the request body format once you receive Billox API docs.
   */
  async purchaseData({ phone_number, network, bundle_id, internal_ref }) {
    const networkName = this._networkMap[String(network).toLowerCase()] || String(network).toUpperCase();

    console.log(`[Billox] purchaseData → network:${networkName} phone:${phone_number} plan:${bundle_id} ref:${internal_ref}`);

    let rawResponse = {};
    try {
      const res = await this._client.post('/data/buy', {
        network: networkName,
        phone: phone_number,
        plan_id: bundle_id,
        ref: internal_ref
      });
      rawResponse = res.data;
    } catch (err) {
      rawResponse = err.response?.data || {};
      if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) {
        return {
          success: false,
          status: 'REQUIRES_REQUERY',
          provider_reference: null,
          raw_response: rawResponse,
          error_message: 'Billox request timed out. Status unknown — do not retry blindly.'
        };
      }
      return this.buildFailureResult(
        err.response?.data?.message || err.message || 'Billox API error',
        rawResponse
      );
    }

    const status = String(rawResponse?.status || rawResponse?.success || '').toLowerCase();
    const providerRef = rawResponse?.data?.reference ||
                        rawResponse?.reference ||
                        rawResponse?.transaction_id ||
                        rawResponse?.data?.id ||
                        null;

    const normalized = this.normalizeStatus(status);
    if (normalized === 'SUCCESS') {
      return this.buildSuccessResult(providerRef, rawResponse);
    } else if (normalized === 'PROCESSING') {
      return this.buildProcessingResult(providerRef, rawResponse);
    } else {
      return this.buildFailureResult(
        rawResponse?.message || 'Billox data purchase failed',
        rawResponse
      );
    }
  }

  /**
   * Purchase airtime via Billox.
   * Typical endpoint: POST /airtime/buy  (verify from dashboard)
   */
  async purchaseAirtime({ phone_number, network, amount, internal_ref }) {
    const networkName = this._networkMap[String(network).toLowerCase()] || String(network).toUpperCase();

    console.log(`[Billox] purchaseAirtime → network:${networkName} phone:${phone_number} amount:${amount} ref:${internal_ref}`);

    let rawResponse = {};
    try {
      const res = await this._client.post('/airtime/buy', {
        network: networkName,
        phone: phone_number,
        amount: parseFloat(amount),
        ref: internal_ref
      });
      rawResponse = res.data;
    } catch (err) {
      rawResponse = err.response?.data || {};
      if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) {
        return {
          success: false,
          status: 'REQUIRES_REQUERY',
          provider_reference: null,
          raw_response: rawResponse,
          error_message: 'Billox request timed out. Status unknown.'
        };
      }
      return this.buildFailureResult(
        err.response?.data?.message || err.message || 'Billox API error',
        rawResponse
      );
    }

    const status = String(rawResponse?.status || rawResponse?.success || '').toLowerCase();
    const providerRef = rawResponse?.data?.reference ||
                        rawResponse?.reference ||
                        rawResponse?.transaction_id ||
                        null;

    const normalized = this.normalizeStatus(status);
    if (normalized === 'SUCCESS') {
      return this.buildSuccessResult(providerRef, rawResponse);
    } else if (normalized === 'PROCESSING') {
      return this.buildProcessingResult(providerRef, rawResponse);
    } else {
      return this.buildFailureResult(
        rawResponse?.message || 'Billox airtime purchase failed',
        rawResponse
      );
    }
  }

  /**
   * Requery a Billox transaction status.
   * Typical endpoint: GET /transactions/:reference  (verify from dashboard)
   */
  async getTransactionStatus(providerReference) {
    try {
      const res = await this._client.get(`/transactions/${providerReference}`);
      const status = String(res.data?.data?.status || res.data?.status || '').toLowerCase();
      return {
        status: this.normalizeStatus(status),
        raw_response: res.data
      };
    } catch (err) {
      return {
        status: 'REQUIRES_REQUERY',
        raw_response: { error: err.message }
      };
    }
  }

  /**
   * Process incoming Billox webhook.
   */
  async processWebhook(payload, headers) {
    const providerRef = payload?.reference || payload?.transaction_id || payload?.data?.reference || null;
    const rawStatus = String(payload?.status || payload?.data?.status || '').toLowerCase();

    return {
      provider_reference: providerRef ? String(providerRef) : null,
      provider_reference_candidates: providerRef ? [String(providerRef)] : [],
      status: this.normalizeStatus(rawStatus),
      raw_payload: payload
    };
  }
}

module.exports = BilloxProvider;
