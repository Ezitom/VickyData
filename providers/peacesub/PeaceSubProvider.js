/**
 * PeaceSubProvider — Adapter for PEACESUB VTU API
 * ------------------------------------------------
 * PRIMARY PROVIDER. This wraps the existing peacesub.js axios client
 * so the existing flow remains 100% identical while exposing the
 * standard BaseProvider interface.
 *
 * IMPORTANT: This does NOT change how PeaceSub works. It simply
 * delegates to the same axios instance already used in production.
 */
const BaseProvider = require('../BaseProvider');
const axios = require('axios');

class PeaceSubProvider extends BaseProvider {
  constructor(config) {
    super(config);

    let baseUrl = process.env.PEACESUB_BASE_URL || config.api_base_url || 'https://peacesub.com/api';
    if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      baseUrl = 'https://' + baseUrl;
    }

    // Create dedicated axios instance using env vars (same as config/peacesub.js)
    this._client = axios.create({
      baseURL: baseUrl,
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${config.api_key || process.env.PEACESUB_API_KEY}`
      }
    });

    // Network ID mapping — same as existing purchaseController.js
    this._networkMap = {
      'mtn': 1,
      'glo': 2,
      '9mobile': 3,
      'airtel': 4
    };

    this._networkNames = {
      1: 'MTN',
      2: 'Glo',
      3: '9mobile',
      4: 'Airtel'
    };
  }

  /**
   * Check provider connectivity and auth.
   */
  async getProviderStatus() {
    try {
      await this._client.get('/user/');
      return { reachable: true, authenticated: true, message: 'PeaceSub API reachable' };
    } catch (err) {
      const isAuth = err.response?.status === 401 || err.response?.status === 403;
      return {
        reachable: !err.code?.includes('ECONNREFUSED') && err.response !== undefined,
        authenticated: false,
        message: isAuth ? 'Authentication failed' : (err.message || 'Unreachable')
      };
    }
  }

  /**
   * Fetch PeaceSub wallet balance.
   */
  async getBalance() {
    try {
      let balance = 0;
      try {
        const res = await this._client.get('/balance/');
        balance = res.data?.balance ?? res.data?.wallet_balance ?? 0;
      } catch {
        const res = await this._client.get('/user/');
        balance = res.data?.wallet_balance ?? res.data?.balance ?? 0;
      }
      return { balance: parseFloat(balance) || 0, currency: 'NGN' };
    } catch (err) {
      throw new Error(`PeaceSub balance check failed: ${err.message}`);
    }
  }

  /**
   * Fetch data plans from PeaceSub.
   */
  async getDataPlans() {
    const res = await this._client.get('/dataplans/');
    const plans = Array.isArray(res.data)
      ? res.data
      : (res.data?.plans || res.data?.data || []);
    return plans;
  }

  /**
   * Purchase data via PeaceSub.
   * Preserves existing request format exactly.
   */
  async purchaseData({ phone_number, network, bundle_id, internal_ref }) {
    const providerNetworkId = this._networkMap[String(network).toLowerCase()] || 1;

    console.log(`[PeaceSub] purchaseData → network:${providerNetworkId} phone:${phone_number} plan:${bundle_id} ref:${internal_ref}`);

    let rawResponse = {};
    try {
      const res = await this._client.post('/data/', {
        network: providerNetworkId,
        mobile_number: phone_number,
        plan: bundle_id,
        Ported_number: true
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
          error_message: 'Request timed out. Status unknown.'
        };
      }
      return this.buildFailureResult(err.message || 'PeaceSub API error', rawResponse);
    }

    const psStatus = String(rawResponse?.Status || rawResponse?.status || '').toLowerCase();
    const providerRef = rawResponse?.ident || String(rawResponse?.id || '') || null;

    if (psStatus === 'successful' || psStatus === 'success' || psStatus === 'true') {
      return this.buildSuccessResult(providerRef, rawResponse);
    } else if (psStatus === 'processing') {
      return this.buildProcessingResult(providerRef, rawResponse);
    } else {
      return this.buildFailureResult(this.extractErrorMessage(rawResponse), rawResponse);
    }
  }

  /**
   * Purchase airtime via PeaceSub.
   * Preserves existing request format exactly.
   */
  async purchaseAirtime({ phone_number, network, amount, internal_ref }) {
    const providerNetworkId = this._networkMap[String(network).toLowerCase()] || 1;

    console.log(`[PeaceSub] purchaseAirtime → network:${providerNetworkId} phone:${phone_number} amount:${amount} ref:${internal_ref}`);

    let rawResponse = {};
    try {
      const res = await this._client.post('/topup/', {
        network: parseInt(providerNetworkId),
        mobile_number: phone_number,
        amount: parseFloat(amount),
        Ported_number: true,
        airtime_type: 'VTU'
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
          error_message: 'Request timed out. Status unknown.'
        };
      }
      return this.buildFailureResult(err.message || 'PeaceSub API error', rawResponse);
    }

    const psStatus = String(rawResponse?.Status || rawResponse?.status || '').toLowerCase();
    const providerRef = rawResponse?.ident || String(rawResponse?.id || '') || null;

    if (psStatus === 'successful' || psStatus === 'success' || psStatus === 'true') {
      return this.buildSuccessResult(providerRef, rawResponse);
    } else if (psStatus === 'processing') {
      return this.buildProcessingResult(providerRef, rawResponse);
    } else {
      return this.buildFailureResult(this.extractErrorMessage(rawResponse), rawResponse);
    }
  }

  /**
   * PeaceSub does not currently expose a status requery endpoint via documented API.
   * This is a stub — webhook-based reconciliation handles this.
   */
  async getTransactionStatus(providerReference) {
    return {
      status: 'REQUIRES_REQUERY',
      raw_response: { note: 'PeaceSub uses webhook-based reconciliation. No polling endpoint documented.' }
    };
  }

  /**
   * Process an incoming PeaceSub webhook.
   * Preserves existing webhook logic from webhookController.js.
   */
  async processWebhook(payload, headers) {
    const rawStatus = String(
      payload?.status ||
      payload?.Status ||
      payload?.order_status ||
      payload?.data?.status ||
      ''
    ).toLowerCase();

    const providerRefCandidates = [
      payload?.ident,
      payload?.id,
      payload?.order_id,
      payload?.reference,
      payload?.ident_id,
      payload?.data?.ident,
      payload?.data?.id,
      payload?.data?.order_id,
      payload?.data?.reference
    ].filter(Boolean).map(v => String(v));

    const providerRef = providerRefCandidates[0] || null;

    return {
      provider_reference: providerRef,
      provider_reference_candidates: providerRefCandidates,
      status: this.normalizeStatus(rawStatus),
      raw_payload: payload
    };
  }
}

module.exports = PeaceSubProvider;
