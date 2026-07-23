/**
 * KCB BUNI Funds Transfer provider — v2.11.6
 *
 * Isolated behind a small facade so the payment provider can be swapped
 * (Co-op / Equity / mock) without touching server.js. Zero external
 * dependencies — uses Node's built-in https for the OAuth token exchange
 * and the funds-transfer POST.
 *
 * Exports:
 *   getAccessToken()          → cached OAuth2 client-credentials token
 *   transferFunds(payload, ctx) → raw HTTP POST to KCB Funds Transfer
 *   chargeFarmerViaKCB(args)  → normalized { success, external_transaction_id, ... }
 *
 * Environment (never logged):
 *   KCB_CONSUMER_KEY, KCB_CONSUMER_SECRET
 *   KCB_TOKEN_URL, KCB_TRANSFER_URL
 *   KCB_COMPANY_CODE, KCB_DEBIT_ACCOUNT, KCB_CALLBACK_SECRET
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_TOKEN_URL = 'https://accounts.buni.kcbgroup.com/oauth2/token';
const DEFAULT_TRANSFER_URL = 'https://uat.buni.kcbgroup.com/fundstransfer/1.0.0/api/v1/transfer';
const REQUEST_TIMEOUT_MS = 20000;

let tokenCache = { token: null, expiresAt: 0 };
let inFlightTokenPromise = null;

const requestJson = (targetUrl, { method = 'POST', headers = {}, body } = {}) => {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${targetUrl}`));
    }
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: `${parsed.pathname || '/'}${parsed.search || ''}`,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { /* keep raw */ }
          resolve({ status: res.statusCode || 0, body: json, raw });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('KCB request timeout'));
    });
    if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
};

const fetchNewToken = async () => {
  const key = process.env.KCB_CONSUMER_KEY;
  const secret = process.env.KCB_CONSUMER_SECRET;
  if (!key || !secret) {
    throw new Error('KCB credentials missing (KCB_CONSUMER_KEY / KCB_CONSUMER_SECRET)');
  }
  const url = process.env.KCB_TOKEN_URL || DEFAULT_TOKEN_URL;
  const basic = Buffer.from(`${key}:${secret}`).toString('base64');
  const { status, body, raw } = await requestJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  if (status < 200 || status >= 300 || !body || !body.access_token) {
    throw new Error(`KCB token exchange failed (HTTP ${status}): ${raw ? raw.slice(0, 200) : 'no body'}`);
  }
  const expiresInSec = Number(body.expires_in || 3600);
  tokenCache = {
    token: String(body.access_token),
    expiresAt: Date.now() + Math.max(60, expiresInSec - 60) * 1000,
  };
  console.log(`[PAY][TOKEN] issued expiresIn=${expiresInSec}`);
  return tokenCache.token;
};

const getAccessToken = async () => {
  if (tokenCache.token && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }
  if (inFlightTokenPromise) return inFlightTokenPromise;
  inFlightTokenPromise = fetchNewToken().finally(() => { inFlightTokenPromise = null; });
  return inFlightTokenPromise;
};

const invalidateToken = () => { tokenCache = { token: null, expiresAt: 0 }; };

const transferFunds = async (payload, { requestId } = {}) => {
  const url = process.env.KCB_TRANSFER_URL || DEFAULT_TRANSFER_URL;
  const doPost = async () => {
    const token = await getAccessToken();
    return requestJson(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: payload,
    });
  };
  let res = await doPost();
  if (res.status === 401) {
    console.warn(`[PAY][TRANSFER] 401 — refreshing token requestId=${requestId || 'n/a'}`);
    invalidateToken();
    res = await doPost();
  }
  return res;
};

const isAcceptedStatusCode = (code) => {
  if (code == null) return false;
  const s = String(code).trim().toUpperCase();
  return s === '0' || s === '00' || s === 'SUCCESS' || s === 'ACCEPTED';
};

const chargeFarmerViaKCB = async ({
  ref,
  amount,
  farmerName,
  accountNumber,
  bankCode,
  transactionType,
  ccode,
  requestId,
}) => {
  const companyCode = process.env.KCB_COMPANY_CODE || '';
  const debitAccount = process.env.KCB_DEBIT_ACCOUNT || '';
  const payload = {
    transactionReference: ref,
    companyCode,
    transactionType,          // 'MO' | 'IF' | 'EF'
    debitAccountNumber: debitAccount,
    beneficiaryBankCode: bankCode,
    creditAccountNumber: String(accountNumber || ''),
    beneficiaryName: String(farmerName || '').slice(0, 60),
    amount: Number(amount),
    currency: 'KES',
    narration: `PAYOUT ${ccode} ${ref}`.slice(0, 60),
  };
  try {
    const { status, body, raw } = await transferFunds(payload, { requestId });
    const statusCode = body?.statusCode ?? body?.responseCode ?? body?.status;
    const statusDescription = body?.statusDescription ?? body?.responseDescription ?? body?.message ?? '';
    const merchantID = body?.merchantID ?? body?.merchantId ?? null;
    const retrievalRefNumber = body?.retrievalRefNumber ?? body?.retrievalReference ?? null;
    const ftReference = body?.ftReference ?? body?.transactionReference ?? null;
    const success = status >= 200 && status < 300 && isAcceptedStatusCode(statusCode);
    const externalId = retrievalRefNumber || ftReference || (success ? ref : null);
    if (!success) {
      console.warn(`[PAY][TRANSFER] declined ref=${ref} http=${status} code=${statusCode} desc=${String(statusDescription).slice(0, 120)}`);
    }
    return {
      success,
      external_transaction_id: externalId,
      statusCode: statusCode != null ? String(statusCode) : null,
      statusDescription: String(statusDescription || ''),
      merchantID,
      retrievalRefNumber,
      ftReference,
      httpStatus: status,
      raw: body || raw || null,
      error: success ? null : (String(statusDescription || `HTTP ${status}`) || 'KCB declined'),
    };
  } catch (e) {
    console.error(`[PAY][TRANSFER] error ref=${ref}:`, e?.message || e);
    return {
      success: false,
      external_transaction_id: null,
      statusCode: null,
      statusDescription: e?.message || 'Transport error',
      merchantID: null,
      retrievalRefNumber: null,
      ftReference: null,
      httpStatus: 0,
      raw: null,
      error: e?.message || 'Transport error',
    };
  }
};

module.exports = {
  getAccessToken,
  transferFunds,
  chargeFarmerViaKCB,
  isAcceptedStatusCode,
};
