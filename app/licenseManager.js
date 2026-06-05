'use strict';

/**
 * licenseManager.js — Keygen license validation (main-process only)
 *
 * Credentials never leave the main process. The renderer only receives
 * boolean valid/invalid results over IPC.
 */

const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const { app } = require('electron');

// ── Keygen credentials (main-process only, never sent to renderer) ────────────
const KEYGEN_ACCOUNT_ID = 'acb93fda-8359-4288-b36d-dec37e1aaca8';
const KEYGEN_PRODUCT_ID = '37cb1d92-4a3c-463e-b74e-9e7e1a798fe1';
const KEYGEN_API_BASE   = 'https://api.keygen.sh/v1/accounts/' + KEYGEN_ACCOUNT_ID;

// ── Local license storage ─────────────────────────────────────────────────────
// Stored in app.getPath('userData') — OS user-data dir, not the app bundle
const STORE_PATH = path.join(app.getPath('userData'), 'flt-license.json');

// Simple obfuscation: XOR with a per-machine key so the key isn't stored
// in plaintext. Not cryptographic — just makes casual inspection harder.
function machineKey() {
  // Use app name + platform as a stable salt
  return crypto.createHash('sha256')
    .update(process.platform + '-flt-license-salt-2025')
    .digest('hex').slice(0, 32);
}

function obfuscate(text) {
  const mk  = Buffer.from(machineKey(), 'utf8');
  const buf = Buffer.from(text, 'utf8');
  return buf.map((b, i) => b ^ mk[i % mk.length]).toString('base64');
}

function deobfuscate(encoded) {
  try {
    const mk  = Buffer.from(machineKey(), 'utf8');
    const buf = Buffer.from(encoded, 'base64');
    return buf.map((b, i) => b ^ mk[i % mk.length]).toString('utf8');
  } catch { return ''; }
}

// ── Persistent storage helpers ────────────────────────────────────────────────
function readStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch { return {}; }
}

function writeStore(data) {
  try { fs.writeFileSync(STORE_PATH, JSON.stringify(data), 'utf8'); }
  catch (e) { console.warn('[License] writeStore failed:', e.message); }
}

function saveLicenseKey(key) {
  const store = readStore();
  store.lk = obfuscate(key);
  store.ts = Date.now();
  writeStore(store);
}

function loadLicenseKey() {
  const store = readStore();
  if (!store.lk) return null;
  return deobfuscate(store.lk) || null;
}

function clearLicenseKey() {
  try { fs.unlinkSync(STORE_PATH); } catch {}
}

// ── Keygen API call ───────────────────────────────────────────────────────────
function keygenRequest(method, endpoint, body, licenseKey) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.keygen.sh',
      path: `/v1/accounts/${KEYGEN_ACCOUNT_ID}${endpoint}`,
      method,
      headers: {
        'Accept':          'application/vnd.api+json',
        'Content-Type':    'application/vnd.api+json',
        'Keygen-Version':  '1.1',
      },
    };

    if (licenseKey) {
      // Use the license key as a Bearer token for validation
      options.headers['Authorization'] = 'License ' + licenseKey;
    }
    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const timer = setTimeout(() => reject(new Error('Keygen API timeout')), 10000);
    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', d => data += d);
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: {} }); }
      });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── In-memory license info cache (safe subset — no raw key) ──────────────────
let _cachedInfo = null;

function cacheInfo(info) { _cachedInfo = info; }

/** Returns the cached license info object (safe to send to renderer) */
function getCachedInfo() { return _cachedInfo; }

// ── Core validation logic ─────────────────────────────────────────────────────
/**
 * Validates a license key against the Keygen API.
 * Returns { valid: bool, error?: string, detail?: string, info?: LicenseInfo }
 * LicenseInfo: { name, status, expiry, expiryFormatted, scheme, maxMachines, key (masked) }
 */
async function validateWithKeygen(licenseKey) {
  if (!licenseKey || typeof licenseKey !== 'string' || licenseKey.trim().length < 6) {
    return { valid: false, error: 'INVALID_FORMAT', detail: 'License key is too short.' };
  }

  const key = licenseKey.trim();

  try {
    // POST /licenses/actions/validate-key — no auth required, uses the key itself
    const res = await keygenRequest('POST', '/licenses/actions/validate-key', {
      meta: {
        key,
        scope: { product: KEYGEN_PRODUCT_ID },
      },
    });

    const meta  = res.body?.meta  || {};
    const attrs = res.body?.data?.attributes || {};
    const code  = meta.code || '';

    if (res.status === 200 && meta.valid === true) {
      // Build a safe info object — never includes the raw key
      const expiry = attrs.expiry || null;
      let expiryFormatted = 'Never';
      let daysLeft = null;
      if (expiry) {
        const d = new Date(expiry);
        expiryFormatted = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        daysLeft = Math.ceil((d - Date.now()) / 86400000);
      }

      const maskedKey = key.length > 8
        ? key.slice(0, 4) + '-****-****-' + key.slice(-4)
        : '****';

      const info = {
        maskedKey,
        name:         attrs.name        || 'FLT License',
        status:       attrs.status      || 'active',
        expiry,
        expiryFormatted,
        daysLeft,
        maxMachines:  attrs.maxMachines ?? null,
        scheme:       attrs.scheme      || 'LICENSE_KEY_V1',
        createdAt:    attrs.created     || null,
        validatedAt:  new Date().toISOString(),
      };

      cacheInfo(info);
      return { valid: true, code, info };
    }

    // Map Keygen's error codes to user-friendly messages
    const messages = {
      EXPIRED:             'Your license has expired. Please renew.',
      SUSPENDED:           'Your license has been suspended.',
      OVERDUE:             'License renewal is overdue.',
      TOO_MANY_MACHINES:   'Too many activations for this license.',
      TOO_MANY_PROCESSES:  'Too many processes for this license.',
      TOO_MANY_CORES:      'Machine limit exceeded.',
      FINGERPRINT_SCOPE_MISMATCH: 'License is not valid for this machine.',
      PRODUCT_SCOPE_REQUIRED:     'Invalid license for this product.',
      PRODUCT_SCOPE_MISMATCH:     'This license belongs to a different product.',
      NOT_FOUND:           'License key not found. Check your key and try again.',
      INVALID:             'License key is invalid.',
    };

    const detail = messages[code] || `Validation failed (${code || res.status}).`;
    return { valid: false, error: code || 'INVALID', detail };

  } catch (e) {
    console.warn('[License] Keygen request failed:', e.message);
    return { valid: false, error: 'NETWORK_ERROR', detail: 'Could not reach the license server. Check your internet connection.' };
  }
}

// ── Periodic revalidation ─────────────────────────────────────────────────────
const REVALIDATION_INTERVAL_MS = 60 * 60 * 1000; // every 60 minutes
let _revalidationTimer = null;
let _onInvalidCallback = null;

function startPeriodicRevalidation(licenseKey, onInvalid) {
  stopPeriodicRevalidation();
  _onInvalidCallback = onInvalid;

  _revalidationTimer = setInterval(async () => {
    console.log('[License] Periodic revalidation…');
    const result = await validateWithKeygen(licenseKey);
    if (!result.valid) {
      console.warn('[License] Periodic check failed:', result.error);
      stopPeriodicRevalidation();
      if (_onInvalidCallback) _onInvalidCallback(result);
    } else {
      console.log('[License] Periodic check OK.');
    }
  }, REVALIDATION_INTERVAL_MS);

  // Unref so the timer doesn't keep the process alive
  if (_revalidationTimer.unref) _revalidationTimer.unref();
}

function stopPeriodicRevalidation() {
  if (_revalidationTimer) { clearInterval(_revalidationTimer); _revalidationTimer = null; }
}

// ── Public API (used by main.js) ─────────────────────────────────────────────
module.exports = {
  /**
   * Check if a stored license key exists and is still valid.
   * Returns { valid, key?, error?, detail?, info? }
   */
  async checkStoredLicense() {
    const key = loadLicenseKey();
    if (!key) return { valid: false, error: 'NO_KEY', detail: 'No license key found.' };
    const result = await validateWithKeygen(key);
    if (result.valid) result.key = key;
    return result;
  },

  /**
   * Validate a user-supplied key, save it if valid.
   * Returns { valid, error?, detail?, info? }
   */
  async activateLicense(licenseKey) {
    const result = await validateWithKeygen(licenseKey);
    if (result.valid) {
      saveLicenseKey(licenseKey.trim());
    }
    return result;
  },

  /** Returns the stored (obfuscated) key in plaintext — for pre-filling the UI */
  getStoredKey: loadLicenseKey,

  /** Returns the last cached license info object (safe, no raw key) */
  getCachedInfo,

  /** Begin hourly background revalidation. Call after successful activation. */
  startPeriodicRevalidation,
  stopPeriodicRevalidation,

  /** Wipe the stored license (e.g. on logout or manual clear) */
  clearStoredLicense: clearLicenseKey,
};
