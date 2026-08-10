# DIAGNOSIS: PeaceSub "Processing" Status Discrepancy

**Audit Date**: 2026-08-10  
**Target Transaction**: PeaceSub Order ID `17753969` / Ident `6917dc5dc2-0ad9-460d-8a88-2d7df69d02a1` / Mobile `09161065280`  
**Purpose**: Investigation only — no code or database records modified.

---

## 1. Current DB State of the Transaction

Querying the production Supabase database yields the following exact record for this transaction:

```json
{
  "id": "ca8aec89-d639-462b-8eb9-c0b034ced42c",
  "user_id": "1230f6b3-f125-45d7-9ead-59eae5d7540c",
  "type": "data",
  "network": "MTN",
  "phone_number": "09161065280",
  "amount": 516,
  "plan_id": 51,
  "status": "failed",
  "reference": "VD-DATA-1786349244747-681164",
  "provider_reference": null,
  "paystack_reference": null,
  "created_at": "2026-08-10T08:07:24.85067+00:00",
  "balance_before": 608,
  "balance_after": 608
}
```

* **Stored Status**: `'failed'`
* **Wallet Debit & Refund Status**:
  * Initial wallet balance before transaction: `₦608`
  * Pre-API call atomic deduction: Debited `₦516` (temporary balance: `₦92`)
  * Post-API response auto-refund: Credited `₦516` back to user wallet (`balance_after`: `₦608`)
  * User record current balance: `₦608`
* **Timestamps**:
  * `created_at` (Transaction record): `2026-08-10T08:07:24.85067+00:00` (UTC) / `09:07:24.850` (GMT+1)
  * `updated_at` (User record timestamp of refund): `2026-08-10T08:07:27.145+00:00` (UTC) / `09:07:27.145` (GMT+1)
  * `status`-change timestamp on transaction: Not tracked separately (overwritten directly on `transactions` table record at `09:07:27`).

---

## 2. Code Locations Touching PeaceSub `Status` Handling

### Location 1: `vickydata-backend/controllers/purchaseController.js`
* **Lines 26–35**: `isProviderSuccess(responseData)` helper
  ```js
  const isProviderSuccess = (responseData) => {
    const status = String(responseData?.status ?? '').toLowerCase();
    return [
      'true',
      'success',
      'successful',
      '1',
      'ok'
    ].includes(status) || responseData?.success === true || responseData?.status === 1;
  };
  ```
* **Lines 273–323** (Data purchase logic in `purchaseData`):
  * **Lines 273–277**: Extract status string:
    ```js
    const psStatus = String(providerResponse.data.Status || providerResponse.data.status || '').toLowerCase();
    ```
  * **When status is `"success"` / `"successful"` / `"true"` (Lines 279–318)**: Marks transaction status as `'successful'`, saves `provider_reference` (`ident` / `id`), dispatches purchase success email, returns HTTP 200.
  * **When status is `"processing"` (Evaluated at Line 279)**: Fails strict equality check (`if (psStatus === 'successful' || psStatus === 'success' || psStatus === 'true')`). Falls into `else` block (Line 320):
    ```js
    const providerMessage = getProviderErrorMessage(providerResponse.data);
    throw new Error(providerMessage);
    ```
    This throws an Error containing `"Order automatically routed to processing after 2 failed attempts in 1 hr for admin reconciliation."` which skips success handling and jumps straight into the `catch` block (Line 325).
  * **When status is anything else (e.g. `"failed"`, `"pending"`, `null`)**: Evaluated as `false` at line 279, drops into `else`, throws an Error, and jumps to `catch` block.

* **Lines 562–612** (Airtime purchase logic in `purchaseAirtime`):
  * Mirrors data purchase status check logic exactly. Accepts only `'successful'`, `'success'`, or `'true'`. Any other status string (including `'processing'`) throws an Error and triggers immediate auto-refund in the catch block.

### Location 2: `vickydata-backend/routes/purchaseRoutes.js`
* **Lines 29–47** (Health check endpoint `/health/peacesub`):
  * Checks general PeaceSub API connectivity via `/user/` endpoint. Evaluates HTTP response to report `{ status: 'success' }` or `{ status: 'failed' }`.

---

## 3. Follow-Up & Reconciliation Mechanism Assessment

* **Polling Job**: **NOT FOUND**. There are no background cron jobs, scheduled tasks, or polling intervals (`setInterval`/`node-cron`) anywhere in the codebase to check updated statuses from PeaceSub.
* **Webhook Endpoint**: **NOT FOUND**. The application only possesses a Paystack webhook listener (`/api/wallet/paystack-webhook`). No webhook receiver exists for PeaceSub status callbacks.
* **Manual Admin Re-Check Route**: **NOT FOUND**. Existing admin transaction endpoints (`/api/admin/transactions`, `/api/admin/transactions/:reference/refund`) allow listing or issuing manual refunds, but do not provide an automated status re-check/query against PeaceSub's `/data/` or `/order/` endpoints.
* **Evidence of Execution**: None found. No recheck mechanism ran for this transaction.

---

## 4. Refund Trigger Analysis

* **Was a refund issued?**: **YES**. An immediate automatic wallet refund of `₦516` was issued synchronously during the request execution.
* **Location of Refund Code**: `vickydata-backend/controllers/purchaseController.js`, lines 331–340 (within `purchaseData` catch block):
  ```js
  if (reference && balanceResult && plan) {
    const refundAmount = parseFloat(plan.selling_price);
    const refundResult = await updateUserBalance(req.user.id, refundAmount);
    finalBalance = refundResult.balanceAfter;
  ...
  ```
* **Condition That Triggered It**:
  1. PeaceSub returned HTTP status 200 with response payload:
     `{"Status": "processing", "message": "Order automatically routed to processing after 2 failed attempts in 1 hr for admin reconciliation.", "ident": "6917dc5dc2-0ad9-460d-8a88-2d7df69d02a1", "id": 17753969}`
  2. Because `"processing"` did not equal `"success"`, `"successful"`, or `"true"`, `purchaseData` threw an Error.
  3. The `catch (error)` block intercepted the thrown Error and executed `updateUserBalance(user_id, +516)`, crediting the user's wallet back instantly from `₦92` to `₦608`.

---

## 5. Full Sequence Log Timeline

All timestamps converted to local server time (GMT+1):

| Timestamp (GMT+1) | Component | Action / Event Description |
| :--- | :--- | :--- |
| **09:07:24.850** | `purchaseController.js` | User `1230f6b3-f125-45d7-9ead-59eae5d7540c` submits data request for 1GB MTN (`09161065280`). Inserted transaction record `ca8aec89-d639-462b-8eb9-c0b034ced42c` (`status: "pending"`, `reference: "VD-DATA-1786349244747-681164"`). |
| **09:07:24.890** | `walletController.js` | `updateUserBalance` called with `-516`. User wallet balance decremented from `₦608` to `₦92`. |
| **09:07:25.100** | `peacesub.js` | Sent POST `/data/` request to PeaceSub API with `{ network: 1, mobile_number: "09161065280", plan: 317, Ported_number: true }`. |
| **09:07:27.100** | `purchaseController.js` | PeaceSub responded with `Status: "processing"` and message `"Order automatically routed to processing after 2 failed attempts in 1 hr for admin reconciliation."`. |
| **09:07:27.120** | `purchaseController.js` | `psStatus` (`"processing"`) evaluated. Did not match `'successful'`, `'success'`, or `'true'`. Error thrown. |
| **09:07:27.145** | `walletController.js` | `catch` block caught error. Auto-refund invoked via `updateUserBalance(user_id, +516)`. User wallet balance restored from `₦92` to `₦608`. User record `updated_at` timestamp: `2026-08-10 09:07:27.145`. |
| **09:07:27.160** | `purchaseController.js` | Transaction record status updated to `'failed'`, `balance_after` set to `608`. `provider_reference` left `null`. |
| **09:07:27.180** | `mailer.js` | Asynchronously sent failure/refund notification emails to user (`victoriaatureta@gmail.com`) and admin. |
| **09:07:27.200** | HTTP Response | Returned HTTP 400 to client: `"Data purchase failed: Order automatically routed to processing after 2 failed attempts in 1 hr for admin reconciliation.. Your wallet has been automatically refunded N516.00."` |

---

## 6. Root Cause Hypothesis

> **HYPOTHESIS ONLY (UNCONFIRMED)**:
>
> 1. **Binary Status Enforcement vs. Provider Lifecycle States**:
>    PeaceSub's API operates with multi-state transaction lifecycles (`"success"`, `"processing"`, `"failed"`). When PeaceSub detects duplicate recent orders or requires internal reconciliation, it returns `"Status": "processing"`. VICKYDATA's backend handles responses strictly as binary (`success` vs `error`).
>
> 2. **Premature Auto-Refund & Financial Desynchronization**:
>    Because `"processing"` was interpreted as an error, VICKYDATA immediately executed a full wallet refund (`+₦516`) and marked the local transaction as `'failed'`.
>
> 3. **Asynchronous Provider Fulfillment (Free Data Delivery)**:
>    When PeaceSub's admin completed the queued order (`17753969`) on their side, the data bundle was delivered to `09161065280`. However, VICKYDATA had already refunded the user's wallet, resulting in data being delivered while the user retained their full wallet balance.
