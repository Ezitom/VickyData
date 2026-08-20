/**
 * RapidBillsProvider — Adapter for RapidBills Reseller API
 * ---------------------------------------------------------
 * Base URL: https://www.rapidbills.ng/api/reseller/v1
 * Auth:     Authorization: Bearer <RAPIDBILLS_API_KEY> (and X-API-Key fallback)
 * Headers:  Idempotency-Key: <uuid-v4> required for all purchase POST requests
 *
 * STATUS: STANDBY — Not routed to live customers until activated by admin.
 */
const BaseProvider = require('../BaseProvider');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class RapidBillsProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.apiKey = config.api_key || process.env.RAPIDBILLS_API_KEY || '';
    this._client = axios.create({
      baseURL: config.api_base_url || process.env.RAPIDBILLS_BASE_URL || 'https://www.rapidbills.ng/api/reseller/v1',
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'X-API-Key': this.apiKey
      }
    });

    // RapidBills provider_id mapping for airtime networks (confirm via GET /catalog/)
    this._airtimeNetworkMap = {
      'mtn': 1,
      'glo': 2,
      '9mobile': 3,
      'airtel': 4
    };
  }

  /**
   * Test provider connectivity and authentication.
   * Endpoint: GET /user-balance/
   */
  async getProviderStatus() {
    try {
      const res = await this._client.get('/user-balance/');
      const status = String(res.data?.status || '').toLowerCase();
      const ok = status === 'true';
      return {
        reachable: true,
        authenticated: ok,
        message: ok ? 'RapidBills API reachable and authenticated' : (res.data?.message || 'Auth check failed')
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
   * Get RapidBills wallet balance.
   * Endpoint: GET /user-balance/
   * Response: { status: "true", message, data: { main_balance, cashback_balance, funding_accounts[] } }
   */
  async getBalance() {
    const res = await this._client.get('/user-balance/');
    const status = String(res.data?.status || '').toLowerCase();
    if (status !== 'true') {
      throw new Error(res.data?.message || 'Failed to fetch RapidBills balance');
    }
    const mainBalance = res.data?.data?.main_balance;
    const balance = parseFloat(mainBalance != null ? mainBalance : 0);
    return { balance, currency: 'NGN' };
  }

  /**
   * Get catalog (data bundles, airtime providers, cable, etc.).
   * Endpoint: GET /catalog/
   */
  async getDataPlans() {
    const res = await this._client.get('/catalog/');
    const status = String(res.data?.status || '').toLowerCase();
    if (status === 'false') {
      throw new Error(res.data?.message || 'Failed to fetch RapidBills catalog');
    }
    return res.data?.data || res.data || [];
  }

  /**
   * Purchase data bundle via RapidBills.
   * Endpoint: POST /buy-data/
   * Body:     { bundle_id: number, provider_network_code?: number, number: "phone", wallet: "main" }
   * Header:   Idempotency-Key: <uuid-v4>
   * Response: { status: "true", message, tx_ref }
   */
  async purchaseData({ phone_number, network, bundle_id, provider_network_code, internal_ref }) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(internal_ref);
    const idempotencyKey = isUuid ? internal_ref : uuidv4();

    const netCode = provider_network_code != null 
      ? Number(provider_network_code) 
      : this._airtimeNetworkMap[String(network).toLowerCase()];

    console.log(`[RapidBills] purchaseData → bundle_id:${bundle_id} provider_network_code:${netCode} phone:${phone_number} idem:${idempotencyKey}`);

    let rawResponse = {};
    try {
      const payload = {
        bundle_id: Number(bundle_id),
        number: String(phone_number),
        wallet: 'main'
      };
      if (netCode != null && !isNaN(netCode)) {
        payload.provider_network_code = netCode;
      }

      const res = await this._client.post('/buy-data/', payload, {
        headers: { 'Idempotency-Key': idempotencyKey }
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
          error_message: 'RapidBills request timed out. Status unknown — do not retry blindly.'
        };
      }
      return this.buildFailureResult(
        err.response?.data?.message || err.message || 'RapidBills API error',
        rawResponse
      );
    }

    const status = String(rawResponse?.status || '').toLowerCase();
    const txRef = rawResponse?.tx_ref || rawResponse?.data?.tx_ref || null;

    if (status === 'true') {
      return this.buildSuccessResult(txRef, rawResponse);
    } else {
      return this.buildFailureResult(
        rawResponse?.message || 'RapidBills purchase failed',
        rawResponse
      );
    }
  }

  /**
   * Purchase airtime via RapidBills.
   * Endpoint: POST /buy-airtime/
   * Body:     { provider_id: number, number: "phone", amount: number, wallet: "main" }
   * Header:   Idempotency-Key: <uuid-v4>
   * Response: { status: "true", message, tx_ref }
   */
  async purchaseAirtime({ phone_number, network, amount, internal_ref }) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(internal_ref);
    const idempotencyKey = isUuid ? internal_ref : uuidv4();

    let providerId = parseInt(network, 10);
    if (isNaN(providerId)) {
      providerId = this._airtimeNetworkMap[String(network).toLowerCase()] || 1;
    }

    console.log(`[RapidBills] purchaseAirtime → provider_id:${providerId} phone:${phone_number} amount:${amount} idem:${idempotencyKey}`);

    let rawResponse = {};
    try {
      const res = await this._client.post('/buy-airtime/', {
        provider_id: Number(providerId),
        number: String(phone_number),
        amount: Number(amount),
        wallet: 'main'
      }, {
        headers: { 'Idempotency-Key': idempotencyKey }
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
          error_message: 'RapidBills request timed out. Status unknown.'
        };
      }
      return this.buildFailureResult(
        err.response?.data?.message || err.message || 'RapidBills API error',
        rawResponse
      );
    }

    const status = String(rawResponse?.status || '').toLowerCase();
    const txRef = rawResponse?.tx_ref || rawResponse?.data?.tx_ref || null;

    if (status === 'true') {
      return this.buildSuccessResult(txRef, rawResponse);
    } else {
      return this.buildFailureResult(
        rawResponse?.message || 'RapidBills airtime purchase failed',
        rawResponse
      );
    }
  }

  /**
   * RapidBills transaction status requery stub.
   */
  async getTransactionStatus(providerReference) {
    return {
      status: 'REQUIRES_REQUERY',
      raw_response: { note: 'RapidBills requery endpoint not documented. Flag for manual review.' }
    };
  }

  /**
   * RapidBills webhook stub.
   */
  async processWebhook(payload, headers) {
    const txRef = payload?.tx_ref || payload?.reference || null;
    const rawStatus = String(payload?.status || '').toLowerCase();

    return {
      provider_reference: txRef,
      provider_reference_candidates: txRef ? [String(txRef)] : [],
      status: this.normalizeStatus(rawStatus),
      raw_payload: payload
    };
  }
}

module.exports = RapidBillsProvider;
