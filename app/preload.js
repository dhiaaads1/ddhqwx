'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── License ───────────────────────────────────────────────────────────────
  licenseCheck:        ()    => ipcRenderer.invoke('license-check'),
  licenseActivate:     (key) => ipcRenderer.invoke('license-activate', key),
  licenseClear:        ()    => ipcRenderer.invoke('license-clear'),
  licenseGetInfo:      ()    => ipcRenderer.invoke('license-get-info'),
  licenseGetStoredKey: ()    => ipcRenderer.invoke('license-get-stored-key'),

  // Fired when background revalidation revokes (license gate window)
  onLicenseRevokedReason: (cb) => ipcRenderer.on('license-revoked-reason', (_e, d) => cb(d)),
  // Legacy — in-app revocation overlay in script.js
  onLicenseRevoked: (cb) => ipcRenderer.on('license-revoked', (_e, d) => cb(d)),

  // ── Window controls ───────────────────────────────────────────────────────
  minimize:       () => ipcRenderer.send('win-minimize'),
  maximize:       () => ipcRenderer.send('win-maximize'),
  close:          () => ipcRenderer.send('win-close'),
  setAlwaysOnTop: (v) => ipcRenderer.sendSync('win-toggle-top', v),
  setOpacity:     (v) => ipcRenderer.send('win-set-opacity', v),

  // ── Kick login ────────────────────────────────────────────────────────────
  openKickLogin:      () => ipcRenderer.send('kick-login-open'),
  extractToken:       () => ipcRenderer.send('kick-login-extract'),
  onLoginResult:      (cb) => ipcRenderer.on('kick-login-result', (_e, d) => cb(d)),
  tokenLogin:         (payload) => ipcRenderer.send('kick-token-login', payload),
  onTokenLoginResult: (cb) => ipcRenderer.on('kick-token-login-result', (_e, d) => cb(d)),

  // ── Streams ───────────────────────────────────────────────────────────────
  fetchStreams: (opts) => ipcRenderer.invoke('streams-fetch', opts),

  // ── Token Health + Follow-status checks (main-process, bearer-only) ──────
  kickTokenCheck:        (token)        => ipcRenderer.invoke('kick-token-check',         { token }),
  kickFollowedList:      (token, target)=> ipcRenderer.invoke('kick-followed-list',       { token, target: target || null }),
  kickCheckChannelFollow:(token, slug)  => ipcRenderer.invoke('kick-check-channel-follow',{ token, slug }),
  kickFollowCheckBrowser:(token, slug)  => ipcRenderer.invoke('kick-follow-check-browser',{ token, slug }),

  // ── Follow Bot — Click Mode ──────────────────────────────────────────────
  followClickerStart: (opts) => ipcRenderer.invoke('follow-clicker-start', opts),
  followClickerStop:  ()     => ipcRenderer.invoke('follow-clicker-stop'),
  onFollowClickerProgress: (cb) => {
    ipcRenderer.removeAllListeners('follow-clicker-progress');
    ipcRenderer.on('follow-clicker-progress', (_e, d) => cb(d));
  },

  // ── Proxy Checker ────────────────────────────────────────────────────────
  checkProxies:         (opts) => ipcRenderer.invoke('check-proxies', opts),
  onProxyCheckProgress: (cb)   => ipcRenderer.on('proxy-check-progress', (_e, d) => cb(d)),

  // ── Stream Watcher — authenticated viewer token ─────────────────────────────
  fetchViewerToken: (opts) => ipcRenderer.invoke('viewer-token', opts),

  // ── Stream Watcher — native TLS viewer WebSocket (bypasses Origin restriction) ──
  vwOpen:       (opts) => ipcRenderer.invoke('vw-open',       opts),
  vwClose:      (opts) => ipcRenderer.invoke('vw-close',      opts),
  vwCloseAll:   ()     => ipcRenderer.invoke('vw-close-all'),
  vwStatusAll:  ()     => ipcRenderer.invoke('vw-status-all'),
  // Events pushed from main → renderer
  onVwLog:    (cb) => ipcRenderer.on('vw-log',    (_e, d) => cb(d)),
  onVwStatus: (cb) => ipcRenderer.on('vw-status', (_e, d) => cb(d)),

  // ── File-based store ──────────────────────────────────────────────────────
  storeLoad:  ()     => ipcRenderer.invoke('store-load'),
  storeSave:  (data) => ipcRenderer.invoke('store-save', data),
  storeClear: ()     => ipcRenderer.invoke('store-clear'),

  // ── Kick Account Creator ─────────────────────────────────────────────────
  kickCreatorStart:       (opts)    => ipcRenderer.invoke('kick-creator-start', opts),
  kickCreatorStop:        ()        => ipcRenderer.invoke('kick-creator-stop'),
  kickCreatorOpenFile:    ()        => ipcRenderer.invoke('kick-creator-open-file'),
  kickCreatorSaveToken:   (payload) => ipcRenderer.invoke('kick-creator-save-token', payload),
  kickCreatorListPending: ()        => ipcRenderer.invoke('kick-creator-list-pending'),
  kickCreatorSkipSession: (payload) => ipcRenderer.invoke('kick-creator-skip-session', payload),
  kickCreatorAutofill:    (payload) => ipcRenderer.invoke('kick-creator-autofill', payload),
  kickCreatorAutofillCode:(payload) => ipcRenderer.invoke('kick-creator-autofill-code', payload),
  onKickCreatorProgress: (cb) => {
    ipcRenderer.removeAllListeners('kick-creator-progress');
    ipcRenderer.on('kick-creator-progress', (_e, d) => cb(d));
  },
  onKickCreatorAccount: (cb) => {
    ipcRenderer.removeAllListeners('kick-creator-account');
    ipcRenderer.on('kick-creator-account', (_e, d) => cb(d));
  },

  // ── Discord token login / injection (isolated from Kick) ─────────────────
  dcTokenLogin:         (payload)   => ipcRenderer.send('dc-token-login', payload),
  onDcTokenLoginResult: (cb)        => {
    ipcRenderer.removeAllListeners('dc-token-login-result');
    ipcRenderer.on('dc-token-login-result', (_e, d) => cb(d));
  },
  onDcSessionStatus:    (cb)        => {
    ipcRenderer.removeAllListeners('dc-session-status');
    ipcRenderer.on('dc-session-status', (_e, d) => cb(d));
  },
  dcCloseWindow:        (accountId) => ipcRenderer.invoke('dc-close-window', accountId),
  dcCloseAllWindows:    ()          => ipcRenderer.invoke('dc-close-all-windows'),
  dcListOpenSessions:   ()          => ipcRenderer.invoke('dc-list-open-sessions'),

  // ── Kik — main-process network + proxy checker ───────────────────────────
  kikFetch:       (opts) => ipcRenderer.invoke('kik-net-fetch',   opts),
  kikProxyCheck:  (opts) => ipcRenderer.invoke('kik-proxy-check', opts),
  onKikProxyProgress: (cb) => {
    ipcRenderer.removeAllListeners('kik-proxy-progress');
    ipcRenderer.on('kik-proxy-progress', (_e, d) => cb(d));
  },
  onKikEvent: (cb) => {
    ipcRenderer.removeAllListeners('kik-event');
    ipcRenderer.on('kik-event', (_e, d) => cb(d));
  },

  // ── Kick Create Account (in-app BrowserView) ─────────────────────────────
  kickCreateInApp:     (opts)  => ipcRenderer.invoke('kick-create-inapp',      opts),
  kickCreateInAppStop: ()      => ipcRenderer.invoke('kick-create-inapp-stop'),
  kickProxyTest:       (proxy) => ipcRenderer.invoke('kick-proxy-test',        { proxy }),
  onKickCreateProgress: (cb) => {
    ipcRenderer.removeAllListeners('kick-create-progress');
    ipcRenderer.on('kick-create-progress', (_e, d) => cb(d));
  },
});

// Discord Tools is exposed as a separate bridge so the existing Discord account
// bridge stays untouched.
contextBridge.exposeInMainWorld('discordToolsAPI', {
  sendInteraction: (payload) => ipcRenderer.invoke('dc-tools-send-interaction', payload),
  detectGiveaway:  (payload) => ipcRenderer.invoke('dc-tools-detect-giveaway',   payload),
});

// ── FLT Activity Logger bridge ───────────────────────────────────────────────
// Exposed on its own namespace so it can't be confused with other APIs.
contextBridge.exposeInMainWorld('fltLogger', {
  emit:       (payload) => ipcRenderer.invoke('flt-log-emit',        payload),
  recent:     (limit)   => ipcRenderer.invoke('flt-log-recent',      limit),
  stats:      ()        => ipcRenderer.invoke('flt-log-stats'),
  session:    ()        => ipcRenderer.invoke('flt-log-session'),
  clear:      ()        => ipcRenderer.invoke('flt-log-clear'),
  setWebhook: (url)     => ipcRenderer.invoke('flt-log-set-webhook', url),
  exportFile: ()        => ipcRenderer.invoke('flt-log-export'),
  onLive:     (cb)      => {
    ipcRenderer.removeAllListeners('flt-log-live');
    ipcRenderer.on('flt-log-live', (_e, ev) => cb(ev));
  },
});
