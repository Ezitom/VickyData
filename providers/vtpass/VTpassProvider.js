/**
 * VTpassProvider — Adapter for VTpass VTU API
 * ---------------------------------------------
 * Based on official VTpass API Documentation:
 * https://vtpass.com/documentation/
 *
 * Live Base URL:    https://vtpass.com/api
 * Sandbox Base URL: https://sandbox.vtpass.com/api
 *
 * Auth: API Key + Secret Key via Basic Auth header
 * Endpoint: POST /pay
 * Request ID format: YYYYMMDDHHII + random (min 12 chars)
 *
 * STATUS: STANDBY — Not routed to live customers until admin activates it.
 */
const BaseProvider = require('../BaseProvider');
const axios = require('axios');

class VTpassProvider extends BaseProvider {
  constructor(config) {
    super(config);

    const isSandbox = config.environment === 'sandbox';
    const baseURL = isSandbox
      ? 'https://sandbox.vtpass.com/api'
      : (config.api_base_url || process.env.VTPASS_BASE_URL || 'https://vtpass.com/api');

    // VTpass uses Basic Auth: base64(publicKey:secretKey)
    const publicKey = config.public_key || process.env.VTPASS_PUBLIC_KEY || '';
    const secretKey = config.secret_key || process.env.VTPASS_SECRET_KEY || '';
    const basicAuth = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');

    this._client = axios.create({
      baseURL,
      timeout: 90000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${basicAuth}`,
        'api-key': publicKey,
        'secret-key': secretKey
      }
    });

    // VTpass network serviceID mappings
    // For airtime: mtn, glo, airtel, etisalat (9mobile)
    // For data: mtn-data, glo-data, airtel-data, etisalat-data
    this._airtimeServiceMap = {
      'mtn': 'mtn',
      'glo': 'glo',
      'airtel': 'airtel',
      '9mobile': 'etisalat'
    };

    this._dataServiceMap = {
      'mtn': 'mtn-data',
      'glo': 'glo-data',
      'airtel': 'airtel-data',
      '9mobile': 'etisalat-data'
    };
  }

  /**
   * Generate a VTpass-compatible request ID.
   * Format: YYYYMMDDHHII + 6-char random alphanumeric
   */
  _generateRequestId(internal_ref) {
    // Prefer the internal reference as a seed for traceability
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${datePart}${randomPart}`;
  }

  /**
   * Test VTpass connectivity and authentication.
   */
  async getProviderStatus() {
    try {
      const res = await this._client.get('/balance');
      const ok = res.status === 200 && res.data?.code === '000';
      return {
        reachable: true,
        authenticated: ok,
        message: ok
          ? 'VTpass API reachable and authenticated'
          : (res.data?.response_description || 'Auth may have failed')
      };
    } catch (err) {
      return {
        reachable: !!err.response,
        authenticated: false,
        message: err.response?.data?.response_description || err.message || 'Unreachable'
      };
    }
  }

  /**
   * Get VTpass wallet balance.
   * Endpoint: GET /balance
   * Response: { code: "000", Contents: { balance: "5000.00" } }
   */
  async getBalance() {
    const res = await this._client.get('/balance');
    const balance = parseFloat(
      res.data?.contents?.balance ||
      res.data?.Contents?.balance ||
      res.data?.balance ||
      0
    );
    return { balance, currency: 'NGN' };
  }

  /**
   * Get VTpass data plans (variation codes) for a network.
   * Endpoint: GET /service-variations?serviceID=mtn-data
   */
  async getDataPlans(network) {
    const networks = network
      ? [String(network).toLowerCase()]
      : ['mtn', 'glo', 'airtel', '9mobile'];

    const allPlans = [];
    for (const net of networks) {
      const serviceID = this._dataServiceMap[net];
      if (!serviceID) continue;
      try {
        const res = await this._client.get(`/service-variations?serviceID=${serviceID}`);
        const variations = res.data?.content?.varations || res.data?.content?.variations || [];
        variations.forEach(v => allPlans.push({ ...v, _network: net, _serviceID: serviceID }));
      } catch (err) {
        console.warn(`[VTpass] Could not fetch plans for ${net}:`, err.message);
      }
    }
    return allPlans;
  }

  /**
   * Purchase data via VTpass.
   * Endpoint: POST /pay
   * Payload: { request_id, serviceID, billersCode, variation_code, amount, phone }
   */
  async purchaseData({ phone_number, network, bundle_id, amount, internal_ref }) {
    const requestId = this._generateRequestId(internal_ref);
    const serviceID = this._dataServiceMap[String(network).toLowerCase()] || 'mtn-data';

    console.log(`[VTpass] purchaseData → serviceID:${serviceID} phone:${phone_number} variation:${bundle_id} request_id:${requestId}`);

    let rawResponse = {};
    try {
      const res = await this._client.post('/pay', {
        request_id: requestId,
        serviceID: serviceID,
        billersCode: phone_number,
        variation_code: String(bundle_id),
        amount: parseFloat(amount || 0),
        phone: phone_number
      });
      rawResponse = res.data;
    } catch (err) {
      rawResponse = err.response?.data || {};
      if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) {
        return {
          success: false,
          status: 'REQUIRES_REQUERY',
          provider_reference: requestId, // VTpass: requery using request_id
          raw_response: rawResponse,
          error_message: 'VTpass request timed out. Use request_id to requery status.'
        };
      }
      return this.buildFailureResult(
        err.response?.data?.response_description || err.message || 'VTpass API error',
        rawResponse
      );
    }

    // VTpass success code is "000"
    const code = String(rawResponse?.code || '').trim();
    const transactionId = rawResponse?.content?.transactions?.transactionId ||
                          rawResponse?.requestId ||
                          requestId;

    if (code === '000') {
      return this.buildSuccessResult(transactionId, rawResponse);
    } else if (code === '099') {
      // 099 = processing / pending
      return this.buildProcessingResult(transactionId, rawResponse);
    } else {
      return this.buildFailureResult(
        rawResponse?.response_description || rawResponse?.message || `VTpass code: ${code}`,
        rawResponse
      );
    }
  }

  /**
   * Purchase airtime via VTpass.
   * Endpoint: POST /pay
   * Payload: { request_id, serviceID, amount, phone }
   * (Airtime does not need variation_code or billersCode)
   */
  async purchaseAirtime({ phone_number, network, amount, internal_ref }) {
    const requestId = this._generateRequestId(internal_ref);
    const serviceID = this._airtimeServiceMap[String(network).toLowerCase()] || 'mtn';

    console.log(`[VTpass] purchaseAirtime → serviceID:${serviceID} phone:${phone_number} amount:${amount} request_id:${requestId}`);

    let rawResponse = {};
    try {
      const res = await this._client.post('/pay', {
        request_id: requestId,
        serviceID: serviceID,
        amount: parseFloat(amount),
        phone: phone_number
      });
      rawResponse = res.data;
    } catch (err) {
      rawResponse = err.response?.data || {};
      if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) {
        return {
          success: false,
          status: 'REQUIRES_REQUERY',
          provider_reference: requestId,
          raw_response: rawResponse,
          error_message: 'VTpass request timed out. Use request_id to requery.'
        };
      }
      return this.buildFailureResult(
        err.response?.data?.response_description || err.message || 'VTpass API error',
        rawResponse
      );
    }

    const code = String(rawResponse?.code || '').trim();
    const transactionId = rawResponse?.content?.transactions?.transactionId ||
                          rawResponse?.requestId ||
                          requestId;

    if (code === '000') {
      return this.buildSuccessResult(transactionId, rawResponse);
    } else if (code === '099') {
      return this.buildProcessingResult(transactionId, rawResponse);
    } else {
      return this.buildFailureResult(
        rawResponse?.response_description || `VTpass code: ${code}`,
        rawResponse
      );
    }
  }

  /**
   * Requery a VTpass transaction status.
   * Endpoint: POST /requery
   * Payload: { request_id: "..." }
   */
  async getTransactionStatus(providerReference) {
    try {
      const res = await this._client.post('/requery', {
        request_id: providerReference
      });
      const code = String(res.data?.code || '').trim();
      let status;
      if (code === '000') status = 'SUCCESS';
      else if (code === '099') status = 'PROCESSING';
      else if (['016', '010', '012'].includes(code)) status = 'FAILED';
      else status = 'REQUIRES_REQUERY';

      return { status, raw_response: res.data };
    } catch (err) {
      return {
        status: 'REQUIRES_REQUERY',
        raw_response: { error: err.message }
      };
    }
  }

  /**
   * Process VTpass webhook/callback.
   * VTpass sends transaction update webhooks to the configured callback URL.
   */
  async processWebhook(payload, headers) {
    const transactionId = payload?.content?.transactions?.transactionId ||
                          payload?.transactionId ||
                          payload?.requestId ||
                          null;

    const rawStatus = String(
      payload?.content?.transactions?.status ||
      payload?.status ||
      ''
    ).toLowerCase();

    // VTpass transaction status values: "delivered", "initiated", "failed"
    let normalizedStatus;
    if (['delivered', 'successful', 'success'].includes(rawStatus)) {
      normalizedStatus = 'SUCCESS';
    } else if (['initiated', 'processing', 'pending'].includes(rawStatus)) {
      normalizedStatus = 'PROCESSING';
    } else if (['failed', 'failure', 'reversed'].includes(rawStatus)) {
      normalizedStatus = 'FAILED';
    } else {
      normalizedStatus = 'REQUIRES_REQUERY';
    }

    return {
      provider_reference: transactionId ? String(transactionId) : null,
      provider_reference_candidates: transactionId ? [String(transactionId)] : [],
      status: normalizedStatus,
      raw_payload: payload
    };
  }
}

module.exports = VTpassProvider;
