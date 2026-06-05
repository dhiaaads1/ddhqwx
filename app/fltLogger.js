'use strict';
/* ════════════════════════════════════════════════════════════════════════════
 *  fltLogger.js — Multi-user activity logger for FLT
 *  ─────────────────────────────────────────────────────────────────────────
 *  Copyright © Virus — All rights reserved.
 *  ─────────────────────────────────────────────────────────────────────────
 *
 *  Captures every meaningful action a user takes inside FLT (app start,
 *  license activation, bot runs, errors, etc.) with full identity context:
 *    - stable machine_id (hashed from MAC + hostname + platform)
 *    - per-launch session_id (UUID)
 *    - OS username / hostname
 *    - license key suffix (last 4 chars, never the full key)
 *    - app version
 *    - public-IP (best-effort, cached for the session)
 *    - timestamp + monotonic event sequence
 *
 *  Storage:
 *    - rolling daily log file in userData/fltLogs/YYYY-MM-DD.ndjson
 *    - in-memory ring buffer of the last 500 events (for in-app viewer)
 *    - Discord webhook transport (rate-limited, queued, retried)
 *
 *  Public API:
 *    init({ webhookUrl, appVersion })
 *    log(action, data, severity)   ─ action: 'app.start' / 'follow.run' / ...
 *    getRecent(limit)              ─ ring-buffer dump for in-app viewer
 *    getSessionInfo()              ─ identity + session metadata
 *    setWebhook(url)
 *    flush()                       ─ force-drain the webhook queue
 *
 * ════════════════════════════════════════════════════════════════════════════ */

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');
const https   = require('https');
const http    = require('http');

// ─── Module state ────────────────────────────────────────────────────────────
const RING_SIZE = 500;
let _ring   = [];                         // most recent events (capped)
let _seq    = 0;                          // monotonic per-process sequence
let _initted = false;
let _identity = null;                     // cached after init
let _logDir   = null;
let _adminWebhook = '';        // hardcoded by admin in main.js — friends can't touch
let _userWebhook  = '';        // optional, per-user, configurable in Settings
let _webhookQueueAdmin = [];
let _webhookQueueUser  = [];
let _drainingAdmin = false;
let _drainingUser  = false;
let _appVersion = 'unknown';
let _publicIp   = null;

// ─── Identity helpers ────────────────────────────────────────────────────────
// Build a stable machine ID from MAC + hostname + platform. Same machine →
// same hash forever (until OS reinstall). Different machines → different
// hashes. Hashed so it's not a privacy-sensitive identifier (you can't
// reverse the hash to a MAC address).
function computeMachineId() {
  try {
    const nics = os.networkInterfaces();
    const macs = [];
    for (const name of Object.keys(nics)) {
      for (const ni of (nics[name] || [])) {
        if (ni && ni.mac && ni.mac !== '00:00:00:00:00:00') macs.push(ni.mac);
      }
    }
    macs.sort();   // deterministic order
    const seed = macs.join(',') + '|' + os.hostname() + '|' + process.platform;
    return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
  } catch (_) {
    return 'mid-unknown';
  }
}

function newSessionId() {
  return crypto.randomBytes(8).toString('hex');
}

// Fire-and-forget public-IP lookup. Caches in memory for the session.
function fetchPublicIp() {
  if (_publicIp) return Promise.resolve(_publicIp);
  return new Promise((resolve) => {
    const finish = (ip) => { _publicIp = ip || 'unknown'; resolve(_publicIp); };
    const req = https.get('https://api.ipify.org?format=json', { timeout: 4000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { finish(JSON.parse(body).ip); } catch { finish(null); }
      });
    });
    req.on('error', () => finish(null));
    req.on('timeout', () => { try { req.destroy(); } catch {} finish(null); });
  });
}

// ─── File transport (rolling daily NDJSON) ───────────────────────────────────
function _todayLogPath() {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10);   // YYYY-MM-DD
  return path.join(_logDir, ymd + '.ndjson');
}

function _writeToFile(event) {
  if (!_logDir) return;
  try {
    fs.mkdirSync(_logDir, { recursive: true });
    fs.appendFileSync(_todayLogPath(), JSON.stringify(event) + '\n', 'utf8');
  } catch (_) { /* swallow — never break the app because of logging */ }
}

// ─── Discord webhook transport ───────────────────────────────────────────────
// Discord rate limits: ~5 req/s per webhook. We queue per webhook and pace at
// 1 message per 1200ms. Both admin + user webhooks fire in parallel — same
// event mirrored to both channels independently.
function _enqueueWebhook(event) {
  if (_adminWebhook) {
    _webhookQueueAdmin.push(event);
    _drainWebhook('admin');
  }
  if (_userWebhook) {
    _webhookQueueUser.push(event);
    _drainWebhook('user');
  }
}

function _severityColor(sev) {
  switch (sev) {
    case 'critical': return 0xff0040;  // red
    case 'error':    return 0xff7a00;  // orange
    case 'warn':     return 0xffd84d;  // yellow
    case 'info':     return 0x3dffa0;  // green (FLT brand)
    default:         return 0x7ad7ff;  // cyan
  }
}

// Post a raw multi-embed message to the admin webhook. Used by logProfile()
// to send the comprehensive user-machine snapshot as a single rich message
// (Discord allows up to 10 embeds per webhook POST, 25 fields per embed).
function _postRawEmbeds(embeds, content) {
  if (!_adminWebhook || !Array.isArray(embeds) || embeds.length === 0) return;
  const payload = JSON.stringify({ content: content || '', embeds: embeds.slice(0, 10) });
  const buf = Buffer.from(payload, 'utf8');
  let url; try { url = new URL(_adminWebhook); } catch { return; }
  const opts = {
    method:   'POST',
    hostname: url.hostname,
    port:     url.port || (url.protocol === 'http:' ? 80 : 443),
    path:     url.pathname + url.search,
    headers:  {
      'content-type':   'application/json',
      'content-length': buf.length,
      'user-agent':     'FLT-Logger/1.0',
    },
    timeout:  10000,
  };
  const lib = url.protocol === 'http:' ? http : https;
  const req = lib.request(opts, (res) => {
    if (res.statusCode === 429) {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let wait = 2000;
        try { wait = (JSON.parse(body).retry_after || 2) * 1000; } catch {}
        setTimeout(() => _postRawEmbeds(embeds, content), Math.min(wait + 200, 10000));
      });
      return;
    }
    res.on('data', () => {});
  });
  req.on('error',   () => {});
  req.on('timeout', () => { try { req.destroy(); } catch {} });
  req.write(buf);
  req.end();
}

// Log a rich user-machine profile snapshot. Saves a digest to ring buffer
// + file, and posts a sectioned multi-embed message to the admin webhook.
function logProfile(profile, embeds, headline) {
  if (!_initted) return null;
  const event = {
    seq:            ++_seq,
    timestamp:      new Date().toISOString(),
    action:         'user.profile',
    severity:       'info',
    message:        headline || 'User profile snapshot',
    data:           profile || {},
    session_id:     _identity.session_id,
    machine_id:     _identity.machine_id,
    username:       _identity.username,
    hostname:       _identity.hostname,
    platform:       _identity.platform,
    license_suffix: _identity.license_suffix,
    app_version:    _identity.app_version,
    ip:             _identity.ip,
  };
  _ring.push(event);
  if (_ring.length > RING_SIZE) _ring.shift();
  _writeToFile(event);
  // Post the rich custom embeds straight to the admin webhook (bypasses the
  // single-embed auto-render). User webhook (if any) gets the digest version.
  if (Array.isArray(embeds) && embeds.length) {
    _postRawEmbeds(embeds, headline || '');
  } else if (_adminWebhook) {
    _webhookQueueAdmin.push(event);
    _drainWebhook('admin');
  }
  if (_userWebhook) {
    _webhookQueueUser.push(event);
    _drainWebhook('user');
  }
  try { console.log('[FLT-LOG] PROFILE', headline || ''); } catch {}
  return event;
}

function _eventToDiscordEmbed(event) {
  const fields = [
    { name: '👤 User',     value: '`' + (event.username || '?') + '@' + (event.hostname || '?') + '`', inline: true },
    { name: '🔑 License',  value: '`' + (event.license_suffix || 'none') + '`',                       inline: true },
    { name: '🖥 Machine',  value: '`' + (event.machine_id || '?') + '`',                              inline: true },
    { name: '🌍 IP',       value: '`' + (event.ip || 'unknown') + '`',                                inline: true },
    { name: '🔖 Session',  value: '`' + (event.session_id || '?') + '`',                              inline: true },
    { name: '📦 Version',  value: '`' + (event.app_version || '?') + '`',                             inline: true },
  ];
  // Add a data field if there's meaningful payload (kept short)
  if (event.data && Object.keys(event.data).length) {
    let dataStr = JSON.stringify(event.data, null, 2);
    if (dataStr.length > 900) dataStr = dataStr.slice(0, 900) + '...';
    fields.push({ name: '📋 Data', value: '```json\n' + dataStr + '\n```', inline: false });
  }
  const emoji =
    event.severity === 'critical' ? '🚨' :
    event.severity === 'error'    ? '❌' :
    event.severity === 'warn'     ? '⚠️' : '✅';
  return {
    embeds: [{
      title:       emoji + '  ' + event.action,
      description: event.message || '',
      color:       _severityColor(event.severity),
      timestamp:   event.timestamp,
      fields,
      footer:      { text: 'FLT Logger · seq #' + event.seq },
    }],
  };
}

function _drainWebhook(which) {
  const isAdmin = which === 'admin';
  const url     = isAdmin ? _adminWebhook : _userWebhook;
  const queue   = isAdmin ? _webhookQueueAdmin : _webhookQueueUser;
  if (isAdmin ? _drainingAdmin : _drainingUser) return;
  if (!url || queue.length === 0) return;
  if (isAdmin) _drainingAdmin = true; else _drainingUser = true;

  const setDraining = (v) => { if (isAdmin) _drainingAdmin = v; else _drainingUser = v; };

  const send = () => {
    const liveUrl   = isAdmin ? _adminWebhook : _userWebhook;
    const liveQueue = isAdmin ? _webhookQueueAdmin : _webhookQueueUser;
    if (!liveUrl || liveQueue.length === 0) {
      setDraining(false);
      return;
    }
    const event = liveQueue.shift();
    const body  = JSON.stringify(_eventToDiscordEmbed(event));
    const buf   = Buffer.from(body, 'utf8');

    let u;
    try { u = new URL(liveUrl); } catch (_) { setDraining(false); return; }
    const opts = {
      method:   'POST',
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'http:' ? 80 : 443),
      path:     u.pathname + u.search,
      headers:  {
        'content-type':   'application/json',
        'content-length': buf.length,
        'user-agent':     'FLT-Logger/1.0',
      },
      timeout:  8000,
    };
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(opts, (res) => {
      // 429 = rate limited → respect retry-after
      if (res.statusCode === 429) {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let wait = 2000;
          try { wait = (JSON.parse(body).retry_after || 2) * 1000; } catch {}
          liveQueue.unshift(event);            // retry this event
          setTimeout(send, Math.min(wait + 200, 10000));
        });
        return;
      }
      res.on('data', () => {});
      res.on('end', () => setTimeout(send, 1200));
    });
    req.on('error',   () => setTimeout(send, 1500));
    req.on('timeout', () => { try { req.destroy(); } catch {} setTimeout(send, 1500); });
    req.write(buf);
    req.end();
  };
  send();
}

// ─── Public API ──────────────────────────────────────────────────────────────
function init({ userDataDir, adminWebhookUrl, userWebhookUrl, appVersion, licenseSuffix }) {
  if (_initted) return _identity;
  _initted = true;
  _logDir = path.join(userDataDir, 'fltLogs');
  _adminWebhook = String(adminWebhookUrl || '').trim();
  _userWebhook  = String(userWebhookUrl  || '').trim();
  _appVersion = String(appVersion || 'unknown');
  _identity = {
    machine_id:     computeMachineId(),
    session_id:     newSessionId(),
    username:       (os.userInfo().username || 'user'),
    hostname:       os.hostname(),
    platform:       process.platform,
    arch:           process.arch,
    license_suffix: licenseSuffix ? String(licenseSuffix).slice(-4) : null,
    app_version:    _appVersion,
    ip:             null,
    session_start:  new Date().toISOString(),
  };
  // Best-effort public IP — populates _identity.ip asynchronously
  fetchPublicIp().then((ip) => { _identity.ip = ip; });
  return _identity;
}

// Sets the USER (renderer-configurable) webhook. The admin webhook is
// hardcoded at init time and cannot be changed at runtime.
function setWebhook(url) {
  _userWebhook = String(url || '').trim();
}

function setLicenseSuffix(suffix) {
  if (_identity) _identity.license_suffix = suffix ? String(suffix).slice(-4) : null;
}

function getSessionInfo() {
  return _identity ? Object.assign({}, _identity) : null;
}

// ── log(action, data, severity, message?) ────────────────────────────────────
//
//  action    string  dot-namespaced action key (e.g. 'follow.run', 'app.start')
//  data      object  arbitrary structured payload (no secrets!)
//  severity  string  'info' | 'warn' | 'error' | 'critical'
//  message   string  optional human-readable summary (shown in Discord title)
//
//  Returns the event object that was logged.
function log(action, data, severity, message) {
  if (!_initted) return null;
  const event = {
    seq:            ++_seq,
    timestamp:      new Date().toISOString(),
    action:         String(action || 'unknown'),
    severity:       severity || 'info',
    message:        message || '',
    data:           data || {},
    // identity (copied so later mutations don't taint historical events)
    session_id:     _identity.session_id,
    machine_id:     _identity.machine_id,
    username:       _identity.username,
    hostname:       _identity.hostname,
    platform:       _identity.platform,
    license_suffix: _identity.license_suffix,
    app_version:    _identity.app_version,
    ip:             _identity.ip,
  };
  // Ring buffer
  _ring.push(event);
  if (_ring.length > RING_SIZE) _ring.shift();
  // File
  _writeToFile(event);
  // Webhook (async, non-blocking)
  _enqueueWebhook(event);
  // Stdout — useful in dev
  try { console.log('[FLT-LOG]', event.severity.toUpperCase(), event.action, JSON.stringify(event.data)); } catch {}
  return event;
}

function getRecent(limit) {
  const n = Math.max(1, Math.min(RING_SIZE, parseInt(limit, 10) || 200));
  return _ring.slice(-n);
}

function getStats() {
  const stats = { total: _ring.length, by_action: {}, by_severity: {} };
  for (const e of _ring) {
    stats.by_action[e.action]     = (stats.by_action[e.action]     || 0) + 1;
    stats.by_severity[e.severity] = (stats.by_severity[e.severity] || 0) + 1;
  }
  return stats;
}

function clearRing() { _ring = []; _seq = 0; }

async function flush(maxWaitMs = 10000) {
  const deadline = Date.now() + maxWaitMs;
  while ((_webhookQueueAdmin.length > 0 || _webhookQueueUser.length > 0) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
  }
}

// ─── Action-name constants (for callers, not enforced) ──────────────────────
const ACTIONS = Object.freeze({
  APP_START:       'app.start',
  APP_QUIT:        'app.quit',
  APP_CRASH:       'app.crash',
  LICENSE_ACTIVATE:'license.activate',
  LICENSE_FAIL:    'license.activate.fail',
  LICENSE_REVOKED: 'license.revoked',
  LICENSE_CLEAR:   'license.clear',
  KICK_LOGIN:      'kick.login',
  KICK_TOKEN_USE:  'kick.token.use',
  CHANNEL_CONNECT: 'channel.connect',
  CHAT_SEND:       'chat.send',
  FOLLOW_RUN:      'follow.run',
  FOLLOW_STOP:     'follow.stop',
  FOLLOW_RESULT:   'follow.result',
  KAC_RUN:         'kac.run',
  KAC_STOP:        'kac.stop',
  KAC_ACCOUNT:     'kac.account.created',
  SW_RUN:          'streamwatcher.run',
  SW_STOP:         'streamwatcher.stop',
  SW_VERIFY:       'streamwatcher.verify',
  PROXY_CHECK:     'proxy.check',
  DC_LOGIN:        'discord.login',
  ERROR:           'error',
});

module.exports = {
  init,
  log,
  logProfile,
  getRecent,
  getStats,
  getSessionInfo,
  setWebhook,
  setLicenseSuffix,
  clearRing,
  flush,
  ACTIONS,
};
