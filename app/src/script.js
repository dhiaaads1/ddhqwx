'use strict';
/* ════════════════════════════════════════════════════════════════════════════
 *  FLT v4 — script.js
 *  ─────────────────────────────────────────────────────────────────────────
 *  Copyright © Virus — All rights reserved.
 *  ─────────────────────────────────────────────────────────────────────────
 *  This software, including its source code, design, and all derivative
 *  works, is the intellectual property of Virus. Unauthorized copying,
 *  redistribution, resale, or modification is strictly prohibited.
 * ════════════════════════════════════════════════════════════════════════════ */
try {
  console.log(
    '%c FLT %c Copyright © Virus — All rights reserved ',
    'background:#0b1020;color:#3dffa0;font-weight:700;padding:4px 8px;border-radius:4px 0 0 4px',
    'background:#3dffa0;color:#0b1020;font-weight:700;padding:4px 8px;border-radius:0 4px 4px 0'
  );
} catch (_) {}

/* ══ CONSTANTS ══ */
const FLT_AUTHOR = 'Virus';
const FLT_COPYRIGHT = 'Copyright © Virus — All rights reserved';

const API = 'https://kick.com/api';
const EMOTES = [
  ['KEKW','[emote:37226:KEKW]'],['Clap','[emote:37218:Clap]'],['PogU','[emote:37233:PogU]'],
  ['EZ','[emote:37221:EZ]'],['LULW','[emote:37227:LULW]'],['AYAYA','[emote:37215:AYAYA]'],
  ['ratJAM','[emote:37248:ratJAM]'],['GIGACHAD','[emote:37224:GIGACHAD]'],
  ['KappA','[emote:305040:KappA]'],['NODDERS','[emote:37228:NODDERS]'],
  ['peepoRiot','[emote:37246:peepoRiot]'],['Prayge','[emote:37234:Prayge]'],
  ['kickSadge','[emote:55886:kickSadge]'],
];
const ZWSP = ['\u200b','\u200c','\u200d','\u2060'];

/* ══ UTILS ══ */
const sleep    = ms  => new Promise(r => setTimeout(r, ms));
const randItem = arr => arr[Math.floor(Math.random() * arr.length)];
const esc      = s   => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const maskTok  = t   => (!t||t.length<10) ? '—' : t.slice(0,6)+'••••'+t.slice(-4);
const fmtDate  = ts  => ts ? new Date(ts).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
const initials = n   => (n||'?').slice(0,2).toUpperCase();
const $        = id  => document.getElementById(id);
const copyText = t   => navigator.clipboard.writeText(t).then(()=>notify('Copied!','success')).catch(()=>notify('Copy failed','error'));
const debounce = (fn,ms) => { let t; return function(...a){clearTimeout(t);t=setTimeout(()=>fn.apply(this,a),ms);} };
function randInt(mn, mx) { return Math.floor(Math.random()*(mx-mn+1))+mn; }

let _dupIdx = 0;
const antiDup = msg => msg + ZWSP[_dupIdx++ % ZWSP.length];

/* ══ NOTIFY ══ */
/* ── Toast icons mapped by type ─────────────────────────────────────────── */
const _NOTIF_ICON = {
  success: 'check-circle-fill',
  error:   'x-circle-fill',
  warning: 'exclamation-triangle-fill',
  info:    'info-circle-fill',
};

function notify(msg, type = 'info') {
  if (!S.cfg.notifs && type !== 'error') return;
  const c = $('notifWrap');
  if (!c) return;

  // Deduplicate: if same message + type is already showing, just bump its timer
  const existing = c.querySelector(`.notif.n-${type}[data-msg="${CSS.escape(msg)}"]`);
  if (existing) {
    existing._clearTimer?.();
    const tid = setTimeout(() => {
      existing.classList.remove('show');
      setTimeout(() => existing.remove(), 240);
    }, 3000);
    existing._clearTimer = () => clearTimeout(tid);
    return;
  }

  const el = document.createElement('div');
  el.className = `notif n-${type}`;
  el.dataset.msg = msg;

  const icon = _NOTIF_ICON[type] || 'info-circle-fill';
  el.innerHTML =
    `<i class="bi bi-${icon} notif-ic"></i>` +
    `<span class="notif-tx">${esc(msg)}</span>` +
    `<button class="notif-close" aria-label="Dismiss"><i class="bi bi-x"></i></button>`;

  // Dismiss on X click
  el.querySelector('.notif-close').addEventListener('click', () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 240);
  });

  c.appendChild(el);
  // Force reflow then animate in
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));

  const tid = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 240);
  }, 3200);
  el._clearTimer = () => clearTimeout(tid);
}

/* ══ STATE ══ */
const S = {
  _deletedTokens: new Set(), // tokens permanently deleted — never re-synced
  tokens:   [],
  accounts: [],
  messages: [],
  presets:  [],
  drafts:   {},
  jobs:     new Map(),
  channel:  null,
  chanId:   null,
  stats: { sent:0, failed:0, total:0, bans:0, accBan:0, flagged:0 },
  jobStats: {},
  bannedSet:  new Set(),
  flaggedSet: new Set(),
  tokStats:   {},
  sentRateHistory: [],
  cfg: { concurrent:5, delay:100, autoRotate:true, notifs:true, sound:false },
  sendAccId: null,
  // ── Message Dispatcher state ──────────────────────────────────────
  md: {
    running: false,
    cancel:  false,
    stats:   { sent: 0, failed: 0, skipped: 0 },
  },
  // ── Active Mode state ─────────────────────────────────────────────
  am: {
    running:false, timer:null, countdown:null,
    sent:0, failed:0, banned:0, accQueue:[], nextAt:0,
    history: [],
    stopOnBan: false,
    useEmotes: false,
    multiSend: 1,
    mode: 'normal',
    delayMin: 1.5,
    delayMax: 3,
    thinkingEffect: true,
    turbo:          false,  // turbo mode: skip cooldown/debounce, minimal delay
  },
  accFilter: 'all',
  accEditId: null,
  accFetched: null,
  tokFetched: null,
};

/* ══ STORE ══ */
const Store = {
  save() {
    try {
      const data = {
        flt_tok: S.tokens,
        flt_acc: S.accounts,
        flt_del: [...S._deletedTokens],
        flt_msg: S.messages,
        flt_pre: S.presets,
        flt_drf: S.drafts,
        flt_cfg: S.cfg,
        flt_am_cfg: S.am ? {
          stopOnBan:      S.am.stopOnBan,
          useEmotes:      S.am.useEmotes,
          multiSend:      S.am.multiSend,
          mode:           S.am.mode,
          delayMin:       S.am.delayMin,
          delayMax:       S.am.delayMax,
          thinkingEffect: S.am.thinkingEffect,
        } : {},
      };
      if (window.electronAPI && window.electronAPI.storeSave) {
        window.electronAPI.storeSave(data).catch(()=>{});
      } else {
        try { localStorage.setItem('flt_tok', JSON.stringify(S.tokens)); } catch(_) {}
        try { localStorage.setItem('flt_del', JSON.stringify([...S._deletedTokens])); } catch(_) {}
        try { localStorage.setItem('flt_acc', JSON.stringify(S.accounts)); } catch(_) {}
        try { localStorage.setItem('flt_msg', JSON.stringify(S.messages)); } catch(_) {}
        try { localStorage.setItem('flt_pre', JSON.stringify(S.presets)); } catch(_) {}
        try { localStorage.setItem('flt_drf', JSON.stringify(S.drafts)); } catch(_) {}
        try { localStorage.setItem('flt_cfg', JSON.stringify(S.cfg)); } catch(_) {}
      }
    } catch(e) {}
  },
  async load() {
    try {
      let d = null;
      if (window.electronAPI && window.electronAPI.storeLoad) {
        d = await window.electronAPI.storeLoad();
      }
      if (d) {
        S.tokens   = d.flt_tok   || [];
        S.accounts = d.flt_acc   || [];
        S._deletedTokens = new Set(d.flt_del || []);
        S.messages = d.flt_msg   || [];
        S.presets  = d.flt_pre   || [];
        S.drafts   = d.flt_drf   || {};
        if (d.flt_am_cfg && S.am) {
          if (d.flt_am_cfg.stopOnBan      !== undefined) S.am.stopOnBan      = d.flt_am_cfg.stopOnBan;
          if (d.flt_am_cfg.useEmotes      !== undefined) S.am.useEmotes      = d.flt_am_cfg.useEmotes;
          if (d.flt_am_cfg.multiSend      !== undefined) S.am.multiSend      = d.flt_am_cfg.multiSend;
          if (d.flt_am_cfg.mode           !== undefined) S.am.mode           = d.flt_am_cfg.mode;
          if (d.flt_am_cfg.delayMin       !== undefined) S.am.delayMin       = d.flt_am_cfg.delayMin;
          if (d.flt_am_cfg.delayMax       !== undefined) S.am.delayMax       = d.flt_am_cfg.delayMax;
          if (d.flt_am_cfg.thinkingEffect !== undefined) S.am.thinkingEffect = d.flt_am_cfg.thinkingEffect;
        }
        S.cfg      = { ...S.cfg, ...(d.flt_cfg || {}) };
      } else {
        // Fallback to localStorage (browser / dev mode)
        S.tokens   = JSON.parse(localStorage.getItem('flt_tok') || '[]');
        S.accounts = JSON.parse(localStorage.getItem('flt_acc') || '[]');
        S._deletedTokens = new Set(JSON.parse(localStorage.getItem('flt_del') || '[]'));
        S.messages = JSON.parse(localStorage.getItem('flt_msg') || '[]');
        S.presets  = JSON.parse(localStorage.getItem('flt_pre') || '[]');
        S.drafts   = JSON.parse(localStorage.getItem('flt_drf') || '{}');
        S.cfg      = { ...S.cfg, ...JSON.parse(localStorage.getItem('flt_cfg') || '{}') };
      }
      // Clean legacy junk from any saved drafts
      Object.values(S.drafts).forEach(d=>{
        if(!d||!d.message) return;
        d.message = d.message
          .replace(/^!slot\s+/i,'')
          .replace(/\|\|?/g,'')
          .replace(/\bby\s+[A-Za-z][A-Za-z0-9 ]{2,}/gi,'')
          .replace(/\b(bgaming|pragmatic play|hacksaw gaming|nolimit city|no limit city|backseat gaming|nolimitcity|no limit)\b/gi,'')
          .replace(/\b(cmon|c mon|lets go|letsgo|let s go|CMON|LETS GO|LET S GO)\b/gi,'')
          .replace(/\s{2,}/g,' ').trim();
      });
      S.tokens.forEach(t => {
        if (!t.name||!t.name.trim()) t.name = t.accountInfo?.username || 'Token_'+t.token.slice(0,6);
        if (!t.addedAt) t.addedAt = Date.now();
      });
      // Auto-sync tokens → accounts (skip permanently deleted tokens)
      S.tokens.forEach(t => {
        if (!t.token || S._deletedTokens.has(t.token) || S.accounts.some(a => a.token === t.token)) return;
        const info = t.accountInfo;
        S.accounts.push({
          id: String(t.id||Date.now()), username: t.name||info?.username||'Token_'+t.token.slice(0,6),
          email: info?.email||'', uid: info?.id||'', avatar: info?.profile_pic||'',
          token: t.token, status: info?.username?'valid':'invalid', added: t.addedAt||Date.now(), sel:false,
        });
      });
    } catch(e) { console.error('Store.load', e); }
  },
  backup() {
    const d = { v:'4', at:new Date().toISOString(), tokens:S.tokens, accounts:S.accounts, messages:S.messages, presets:S.presets, cfg:S.cfg };
    const a = document.createElement('a');
    a.href = 'data:application/json,'+encodeURIComponent(JSON.stringify(d,null,2));
    a.download = `FLT-${Date.now()}.json`; a.click();
    notify('Backup exported','success');
  },
  restore() {
    const inp = document.createElement('input'); inp.type='file'; inp.accept='.json';
    inp.onchange = e => {
      const f=e.target.files[0]; if(!f) return;
      const r=new FileReader();
      r.onload = ev => {
        try {
          const d=JSON.parse(ev.target.result);
          if(d.tokens)   S.tokens=d.tokens;
          if(d.accounts) S.accounts=d.accounts;
          if(d.messages) S.messages=d.messages;
          if(d.presets)  S.presets=d.presets;
          if(d.cfg)      S.cfg={...S.cfg,...d.cfg};
          Store.save(); renderAll(); notify('Backup imported','success');
        } catch { notify('Invalid backup file','error'); }
      };
      r.readAsText(f);
    };
    inp.click();
  },
  clearAll() {
    if(!confirm('Clear ALL data? Cannot be undone.')) return;
    if (window.electronAPI && window.electronAPI.storeClear) {
      window.electronAPI.storeClear().catch(()=>{});
    } else {
      ['flt_tok','flt_acc','flt_msg','flt_pre','flt_drf','flt_cfg'].forEach(k=>localStorage.removeItem(k));
    }
    S.tokens=[]; S.accounts=[]; S.messages=[]; S.presets=[]; S.drafts={};
    S.cfg={concurrent:5,delay:100,autoRotate:true,notifs:true,sound:false};
    renderAll(); notify('All data cleared','warning');
  },
};

/* ══ KICK API ══ */
const KickAPI = {
  _h(token) {
    return {
      'accept':'application/json','content-type':'application/json',
      'Authorization':`Bearer ${token}`,
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language':'en-US,en;q=0.9','Origin':'https://kick.com','Referer':'https://kick.com/',
      'Sec-Fetch-Dest':'empty','Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-site',
    };
  },
  async getUser(token) {
    const ctrl=new AbortController(); const tid=setTimeout(()=>ctrl.abort(),7000);
    try { const r=await fetch(`${API}/v1/user`,{headers:this._h(token),signal:ctrl.signal}); clearTimeout(tid); return r.ok?await r.json():null; } catch{return null;}
  },
  async getChannel(slug) {
    const ctrl=new AbortController(); const tid=setTimeout(()=>ctrl.abort(),8000);
    try { const r=await fetch(`${API}/v2/channels/${encodeURIComponent(slug)}`,{signal:ctrl.signal}); clearTimeout(tid); if(!r.ok) throw new Error(`Channel not found (${r.status})`); return await r.json(); } catch(e){throw e;}
  },
  async send(token, chanId, content) {
    try {
      const r=await fetch(`${API}/v2/messages/send/${chanId}`,{method:'POST',headers:this._h(token),body:JSON.stringify({content,type:'message',message_ref:String(Date.now()+Math.random())})});
      return {ok:r.ok,status:r.status};
    } catch(e){return{ok:false,status:0};}
  },
  async sendRetry(token, chanId, content, tries=2) {
    for(let i=0;i<tries;i++){
      const res=await this.send(token,chanId,content);
      if(res.ok) return res;
      if(res.status===401||res.status===403) return res;
      if(i<tries-1) await sleep(150*(i+1));
    }
    return{ok:false,status:0};
  },

  // Check if account follows a channel slug
  async isFollowing(token, channelSlug) {
    const ctrl=new AbortController(); const tid=setTimeout(()=>ctrl.abort(),10000);
    try {
      // GET /api/v1/channels/{slug}/followed — returns { is_followed: true/false }
      const r=await fetch(`${API}/v1/channels/${encodeURIComponent(channelSlug)}/followed`,{headers:this._h(token),signal:ctrl.signal});
      clearTimeout(tid);
      if(r.status===401) return { following: false, status: 401, invalidToken: true };
      if(!r.ok) return { following: false, status: r.status };
      const data = await r.json();
      console.log('[isFollowing raw]', channelSlug, data);
      // Kick returns { is_followed: true/false, follower_count: N }
      const following = data.is_followed === true;
      return { following, status: r.status };
    } catch(e) { return { following: false, status: 0, error: true }; }
  },

  // Check if account is banned in a channel's chatroom
  // The correct approach: try to fetch chatroom info — banned users get a specific error
  async isBanned(token, chatroomId) {
    if(!chatroomId) return { banned: false, status: 0 };
    const ctrl=new AbortController(); const tid=setTimeout(()=>ctrl.abort(),8000);
    try {
      // GET chatroom — banned users get a specific error response
      const r=await fetch(`${API}/v2/chatroom/${chatroomId}/info`,{headers:this._h(token),signal:ctrl.signal});
      clearTimeout(tid);
      if(r.status===401) return { banned: false, status: 401, invalidToken: true };
      if(r.status===403) {
        const body=await r.json().catch(()=>({}));
        const msg=(body?.message||body?.error||'').toLowerCase();
        return { banned: msg.includes('ban') || msg.includes('restrict'), status: 403 };
      }
      if(r.ok) return { banned: false, status: r.status };
      return { banned: false, status: r.status };
    } catch { return { banned: false, status: 0, error: true }; }
  },

  // Full account check: token valid + following + banned
  async fullCheck(token, channelSlug, chatroomId) {
    const result = { valid: false, following: false, banned: false, username: null, reason: null };
    // 1. Check token
    const user = await this.getUser(token);
    if (!user) { result.reason = 'Invalid token'; return result; }
    result.valid = true;
    result.username = user.username;
    // 2. Check following
    if (channelSlug) {
      const fol = await this.isFollowing(token, channelSlug);
      result.following = fol.following;
    }
    // 3. Check banned
    if (chatroomId) {
      // Try to send a test message fetch — if 403 with banned reason, they're banned
      const ctrl=new AbortController(); const tid=setTimeout(()=>ctrl.abort(),6000);
      try {
        const r=await fetch(`${API}/v2/chatroom/${chatroomId}/poll`,{headers:this._h(token),signal:ctrl.signal});
        clearTimeout(tid);
        if (r.status === 403) {
          const body = await r.json().catch(()=>({}));
          result.banned = !!(body?.message?.toLowerCase().includes('ban') || body?.error?.toLowerCase().includes('ban'));
        }
      } catch { clearTimeout(tid); }
    }
    return result;
  },
};

/* ══ TABS ══ */
function switchTab(name) {
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));

  // Hide all pages cleanly
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active', 'page-initial', 'page-switching');
  });

  // Show target page — reflow between remove and add forces CSS animation to restart
  const activePage = document.getElementById('page-' + name);
  if (activePage) {
    void activePage.offsetWidth;
    activePage.classList.add('active');
  }

  // accounts tab now houses both accounts AND tokens
  if(name==='accounts')     { renderAccounts(); renderTokens(); fbUpdateChannelBanner(); swUpdateChannelBanner(); }
  if(name==='tools')        { /* slot/bulk cards — no render needed, JS already live */ }
  if(name==='automation')   { fbUpdateChannelBanner(); swUpdateChannelBanner(); }
  if(name==='activemode')   { amRenderAccountSelect(); liveChatRenderSendAs(); }
}

/* ══ MODALS ══ */
function openModal(id)  { $(id)?.classList.add('open'); }
function closeModal(id) { $(id)?.classList.remove('open'); }
document.addEventListener('click', e => {
  const close=e.target.closest('[data-close]');
  if(close) closeModal(close.dataset.close);
  if(e.target.classList.contains('overlay')) { if(e.target.id==='modalSend') closeSendModal(); else e.target.classList.remove('open'); }
});
document.addEventListener('keydown', e => {
  if(e.key!=='Escape') return;
  document.querySelectorAll('.overlay.open').forEach(m=>{if(m.id==='modalSend') closeSendModal(); else m.classList.remove('open');});
});

/* ══ SOUND ══ */
function playBanSound() {
  if(!S.cfg.sound) return;
  try {
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator(); const g=ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.frequency.value=440; osc.type='square';
    g.gain.setValueAtTime(0.08,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.25);
    osc.start(); osc.stop(ctx.currentTime+0.25);
  } catch{}
}

/* ══ SPAMMER ══ */
async function connectChannel() {
  const raw=$('channelInput').value.trim();
  if(!raw){notify('Enter a channel','error');return;}
  const slug=raw.replace(/^https?:\/\/(www\.)?kick\.com\//i,'').replace(/\/.*$/,'').trim();
  if(!slug){notify('Invalid URL','error');return;}
  $('channelInput').value=slug;
  const el=$('channelStatus');
  el.textContent='○ Connecting…'; el.className='status-line';
  try {
    const d=await KickAPI.getChannel(slug);
    S.channel=d; S.chanId=d.chatroom.id;
    el.textContent=`● Connected: ${d.user.username}  (ID: ${S.chanId})`; el.className='status-line on';
    notify(`Connected to ${d.user.username}!`,'success');
    // Seed the AI's stream context immediately so the first generate() call
    // already knows the title + category. Subsequent refreshes piggyback on
    // amAiGenerate's own refresh (every 5 min).
    if (typeof amRefreshStreamContext === 'function') {
      amRefreshStreamContext(true).catch(() => {});
    }
  } catch(e) {
    el.textContent='● Not connected'; el.className='status-line';
    notify(e.message||'Failed','error');
  }
}

/* ══ MESSAGE DISPATCHER — helper ══ */
function mdBuildMsg(variation_idx) {
  // Base message from textarea
  let msg = $('msgInput').value.trim();
  if (!msg) return '';
  // Smart variation: append a zero-width space variant per account so
  // consecutive sends from different accounts are not identical
  if ($('chkVariation')?.checked && variation_idx >= 0) {
    msg = msg + ZWSP[variation_idx % ZWSP.length];
  }
  return msg;
}

function trackSend(token, ok, status) {
  if(!S.tokStats[token]) S.tokStats[token]={sent:0,failed:0};
  if(ok){ S.tokStats[token].sent++; S.stats.sent++; S.sentRateHistory.push(Date.now()); }
  else{
    S.tokStats[token].failed++; S.stats.failed++;
    if(status===401||status===403){
      if(!S.bannedSet.has(token)){
        S.bannedSet.add(token); S.stats.accBan++; playBanSound();
        const t=S.tokens.find(t=>t.token===token);
        if(t){ t.status='banned'; const ch=S.channel?.user?.username||'unknown'; if(!t.chatroomBans)t.chatroomBans=[]; if(!t.chatroomBans.includes(ch)){t.chatroomBans.push(ch);S.stats.bans++;} const acc=S.accounts.find(a=>a.token===token); if(acc)acc.status='invalid'; Store.save(); RenderQueue.schedule('accounts', renderAccounts); }
      }
    } else if(status===429||status===408){ if(!S.flaggedSet.has(token)){S.flaggedSet.add(token);S.stats.flagged++;notify('Rate-limited','warning');} }
  }
  mdUpdateStats();
}

/* ══ MESSAGE DISPATCHER — Time-Based Broadcast ══
   Sends the SAME message from ALL selected accounts,
   evenly spread across a user-defined total duration.

   Example: 20 accounts, 10s → one send every 0.5s
   No random delays. No burst batches. No rotation.
   All accounts send exactly once, in stable order.
══════════════════════════════════════════════════════════════════════ */

function mdGetAccounts() {
  const mode = $('mdAccMode')?.value || 'all';
  const skipInvalid = $('mdSkipInvalid')?.checked ?? true;
  let pool;
  if (mode === 'custom') {
    pool = S.accounts.filter(a => a.sel);
  } else if (mode === 'valid') {
    pool = S.accounts.filter(a => a.status === 'valid');
  } else {
    pool = [...S.accounts];
  }
  if (skipInvalid) pool = pool.filter(a => a.status === 'valid' || a.status === 'loading');
  return pool.filter(a => a.token);
}

function mdLog(icon, text, color) {
  const log = $('mdLog');
  if (!log) return;
  // Clear placeholder on first real entry
  if (log.querySelector('span[style]')) log.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'md-log-row';
  const ts = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  row.innerHTML =
    `<span class="md-log-ts">${ts}</span>` +
    `<span class="md-log-icon" style="color:${color||'var(--dim)'}">${icon}</span>` +
    `<span class="md-log-text">${esc(text)}</span>`;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  _trimLog(log);
}

function mdUpdateStats() {
  const st = S.md.stats;
  const s = $('mdStatSent');   if (s) s.textContent = st.sent;
  const f = $('mdStatFailed'); if (f) f.textContent = st.failed;
  const k = $('mdStatSkipped');if (k) k.textContent = st.skipped;
}

// ── Shuffle helper — used once before broadcast to vary send order ────────────
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick a random draft message from currently selected (or all valid) accounts.
 * Used as a lightweight fallback when AI is unavailable.
 */
function amPickRandomDraft() {
  const accs = S.accounts.filter(a => a.status === 'valid' && S.drafts[a.id]?.message);
  if (!accs.length) return null;
  const acc = accs[Math.floor(Math.random() * accs.length)];
  return S.drafts[acc.id]?.message || null;
}

/**
 * Apply case variation to a string.
 * mode: 'lower' | 'upper' | 'title' | '' (no change)
 */
// applyCaseBulk — like applyCase but splits on actual emoji codepoints so
// they are never passed through toUpperCase/toLowerCase/charAt transforms.
// Covers Emoticons, Misc Symbols, Dingbats, Supplemental Symbols, flags, etc.
const EMOJI_REGEX = /([\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F1E0}-\u{1F1FF}\u{200D}\u{20E3}]+)/gu;

function applyCaseBulk(str, mode) {
  if (!str || !mode) return str;
  // Split into alternating [text, emoji, text, emoji ...] segments
  const segments = str.split(EMOJI_REGEX);
  return segments.map((seg, idx) => {
    // Odd indices are the emoji capture groups — leave untouched
    if (idx % 2 === 1) return seg;
    return applyCase(seg, mode);
  }).join('');
}

function applyCase(str, mode) {
  if (!str || !mode) return str;
  if (mode === 'lower') return str.toLowerCase();
  if (mode === 'upper') return str.toUpperCase();
  if (mode === 'title') return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  if (mode === 'random') {
    // Pick a different case per call — each account/message gets its own roll
    const roll = Math.random();
    if (roll < 0.33) return str.toLowerCase();
    if (roll < 0.66) return str.toUpperCase();
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }
  return str;
}

// ── Progress display helper ───────────────────────────────────────────────────
function mdUpdateProgress(current, total) {
  const el = $('mdProgressCount');
  if (el) el.textContent = `${current} / ${total} sent`;
}

async function mdDispatch() {
  // FIX 1 — Double-start protection: bail immediately if already running
  if (S.md.running) return;

  if (!S.chanId) { notify('Connect to a channel first', 'error'); return; }

  // FIX 8 — Message validation
  const msg = ($('msgInput')?.value || '').trim();
  if (!msg) { notify('Enter a message', 'error'); return; }

  // FIX 4/5 — Get accounts, hard-filter to valid/loading with a token
  let accounts = mdGetAccounts();
  accounts = accounts.filter(a => a.token && (a.status === 'valid' || a.status === 'loading'));

  if (!accounts.length) {
    notify('No valid accounts in pool \u2014 check Account Pool setting', 'error');
    return;
  }

  // FIX 9 — Duration guard: minimum 0s is fine (simultaneous), but clamp NaN/negative
  const rawDuration = parseFloat($('mdDuration')?.value);
  const durationSec = (!isNaN(rawDuration) && rawDuration > 0) ? rawDuration : 0;
  const totalMs     = durationSec * 1000;

  // Interval: safe for 1 account and duration=0
  let interval;
  if (accounts.length === 1 || totalMs === 0) {
    interval = 0;
  } else {
    interval = totalMs / (accounts.length - 1);
  }

  // Optional one-time shuffle before scheduling
  if ($('mdShuffle')?.checked) accounts = shuffleArray(accounts);

  // FIX 1/2 — Lock state and reset everything atomically before any async work
  S.md.running = true;
  S.md.cancel  = false;
  S.md.stats   = { sent: 0, failed: 0, skipped: 0 };
  S.md._timers = [];   // FIX 7 — start clean, no leftover handles

  // FIX 10 — UI lock: disable Send, enable Cancel
  const sendBtn   = $('mdSendBtn');
  const cancelBtn = $('mdCancelBtn');
  if (sendBtn)   { sendBtn.style.display   = 'none'; }
  if (cancelBtn) { cancelBtn.disabled      = false;
                   cancelBtn.textContent   = 'Cancel';
                   cancelBtn.style.display = ''; }

  // FIX 2 — Reset UI counters to clean state before first send
  mdUpdateStats();
  mdUpdateProgress(0, accounts.length);
  const progEl = $('mdProgressInfo');
  if (progEl) progEl.textContent = 'Preparing\u2026';

  const intDisplay = interval > 0 ? ` (every ${(interval / 1000).toFixed(2)}s)` : '';
  const label = durationSec > 0
    ? `${accounts.length} accounts over ${durationSec}s${intDisplay}`
    : `${accounts.length} accounts simultaneously`;

  notify(`Broadcasting: ${label}`, 'info');
  mdLog('[\u2192]', `Broadcast start \u2014 ${label}`, 'var(--blue)');
  if (progEl) progEl.textContent = `Sending ${accounts.length} accounts over ${durationSec}s`;

  // FIX 6 — Completion counter: more reliable than index check alone
  // (index check can miss if JS reorders microtasks under heavy load)
  let completed = 0;
  const total   = accounts.length;

  // Schedule all accounts with drift-corrected delays
  const startTime = Date.now();

  accounts.forEach((acc, i) => {
    const targetTime = startTime + (i * interval);
    const delay      = Math.max(0, targetTime - Date.now());

    const handle = setTimeout(async () => {
      if (S.md.cancel) return;

      const content = mdBuildMsg(i);

      // FIX 4 — Wrap send in try/catch: network errors go to failed, not uncaught
      try {
        const res = await KickAPI.sendRetry(acc.token, S.chanId, content);
        trackSend(acc.token, res.ok, res.status);

        if (res.ok) {
          S.md.stats.sent++;
          mdLog('[\u2713]', `sent via ${acc.username || maskTok(acc.token)}`, 'var(--green)');
        } else {
          // FIX 5 — Distinguish banned/invalid from generic failure
          const banned  = res.status === 401 || res.status === 403;
          const invalid = res.status === 422;   // token format rejected by server
          if (banned || invalid) {
            S.md.stats.skipped++;
            mdLog('[\u25b7]',
              `skipped ${acc.username || maskTok(acc.token)} (${banned ? 'banned' : 'invalid'})`,
              'var(--dim)');
          } else {
            S.md.stats.failed++;
            mdLog('[\u2717]',
              `failed ${acc.username || maskTok(acc.token)} (${res.status})`,
              'var(--yel)');
          }
        }
      } catch (err) {
        // FIX 4 — Network / timeout exception: count as failed, never crash
        S.md.stats.failed++;
        mdLog('[\u2717]',
          `error ${acc.username || maskTok(acc.token)}: ${err.message || 'network error'}`,
          'var(--yel)');
      }

      mdUpdateStats();

      // FIX 6 — Increment shared counter; finish only when ALL callbacks done
      completed++;
      mdUpdateProgress(completed, total);
      if (completed === total) {
        _mdFinish(false);
      }
    }, delay);

    S.md._timers.push(handle);
  });

  // Safety net: force-finish if any callback silently dropped (JS lag / GC pause)
  const safetyHandle = setTimeout(() => {
    if (S.md.running) _mdFinish(false);
  }, totalMs + 2000);
  S.md._timers.push(safetyHandle);
}

function _mdFinish(cancelled) {
  // FIX 3 — Idempotent guard: ignore if already finished (prevents double-call
  // from last-timer + safety timeout both firing in the same tick)
  if (!S.md.running) return;

  // FIX 7 — Clear ALL timers (safety net + any unsent accounts on cancel)
  (S.md._timers || []).forEach(clearTimeout);
  S.md._timers = [];

  S.md.running = false;
  S.md.cancel  = false;

  // FIX 10 — Restore UI
  const sendBtn   = $('mdSendBtn');
  const cancelBtn = $('mdCancelBtn');
  if (sendBtn)   sendBtn.style.display   = '';
  if (cancelBtn) cancelBtn.style.display = 'none';

  const progEl = $('mdProgressInfo');
  if (progEl) progEl.textContent = cancelled ? 'Cancelled.' : 'Broadcast complete.';

  const { sent, failed, skipped } = S.md.stats;
  mdLog(
    cancelled ? '[\u2715]' : '[\u25a0]',
    cancelled
      ? `Cancelled \u2014 ${sent} sent \u00b7 ${failed} failed \u00b7 ${skipped} skipped`
      : `Done \u2014 ${sent} sent \u00b7 ${failed} failed \u00b7 ${skipped} skipped`,
    'var(--dim)'
  );
  notify(
    cancelled ? `Cancelled \u2014 ${sent} sent` : `Done \u2014 ${sent}\u2713  ${failed}\u2717`,
    cancelled ? 'info' : (failed ? 'warning' : 'success')
  );
}

function mdCancel() {
  if (!S.md.running) return;

  // FIX — Clear timers FIRST (before setting cancel flag) so any
  // callback that fires between now and _mdFinish sees cancel=false
  // and simply doesn't execute — no partial sends after Cancel pressed
  (S.md._timers || []).forEach(clearTimeout);
  S.md._timers = [];
  S.md.cancel  = true;

  const cancelBtn = $('mdCancelBtn');
  if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.textContent = 'Cancelling\u2026'; }

  // FIX 3 — Immediate finish; _mdFinish's guard prevents any double-call
  _mdFinish(true);
}

function mdUpdateCustomHint() {
  const mode = $('mdAccMode')?.value;
  const hint = $('mdCustomHint');
  if (!hint) return;
  if (mode === 'custom') {
    hint.style.display = 'flex';
    const count = S.accounts.filter(a => a.sel).length;
    const el = $('mdCustomCount');
    if (el) el.textContent = count + ' selected';
  } else {
    hint.style.display = 'none';
  }
}

/* ══ TOKENS ══ */
function renderTokens() {
  const active=S.tokens.filter(t=>t.status==='active').length;
  const banned=S.tokens.filter(t=>t.status==='banned').length;
  const badge=$('tokCount');
  if(badge){
    badge.textContent=S.tokens.length?`${active}✓${banned?' '+banned+'✗':''}`:'' ;
    badge.classList.toggle('on',S.tokens.length>0);
  }
}

async function fetchTokPreview(token, ctx) {
  const stEl=$(ctx==='tok'?'tokStatus':'accFetchStatus');
  const prEl=$(ctx==='tok'?'tokPreview':'accPreview');
  stEl.textContent='Fetching…'; stEl.className='fetch-st ld'; prEl.style.display='none';
  const user=await KickAPI.getUser(token);
  if(user){
    if(ctx==='tok'){S.tokFetched=user;$('tpAvatar').src=user.profile_pic||'';$('tpName').textContent=user.username;$('tpEmail').textContent=user.email||'No email';}
    else{S.accFetched=user;$('apAvatar').src=user.profile_pic||'';$('apName').textContent=user.username;$('apEmail').textContent=user.email||'No email';$('apUid').textContent='ID: '+(user.id||'');}
    prEl.style.display='flex'; stEl.textContent='✓ Found: '+user.username; stEl.className='fetch-st ok';
  } else {
    if(ctx==='tok')S.tokFetched=null; else S.accFetched=null;
    prEl.style.display='none'; stEl.textContent='✗ Token invalid or API unreachable'; stEl.className='fetch-st err';
  }
}

async function saveNewToken() {
  const raw=$('tokModalInput').value.trim(); const token=raw.replace(/^Bearer\s+/i,'');
  if(!token){notify('Paste a token','error');return;}
  if(S.tokens.some(t=>t.token===token)){notify('Token already exists','error');return;}
  if(!S.tokFetched) await fetchTokPreview(token,'tok');
  const user=S.tokFetched;
  const name=user?user.username:'Token_'+token.slice(0,6);
  const id=String(Date.now());
  S.tokens.push({id,name,token,status:'active',addedAt:Date.now(),accountInfo:user});
  if(user&&!S.accounts.some(a=>a.token===token))
    S.accounts.push({id,username:user.username,email:user.email||'',uid:user.id||'',avatar:user.profile_pic||'',token,status:'valid',added:Date.now(),sel:false});
  Store.save(); renderTokens(); renderAccounts(); closeModal('modalAddToken');
  notify(`Token added: ${name}`,'success');
}

// Called from Electron login result
async function quickAddTokenDirect(token) {
  const t=token.replace(/^Bearer\s+/i,'');
  if(!t||S.tokens.some(x=>x.token===t)){if(S.tokens.some(x=>x.token===t))notify('Token already exists','info'); return;}
  notify('Fetching account info…','info');
  const user=await KickAPI.getUser(t);
  const name=user?user.username:'Token_'+t.slice(0,6);
  const id=String(Date.now());
  S.tokens.push({id,name,token:t,status:'active',addedAt:Date.now(),accountInfo:user});
  if(user&&!S.accounts.some(a=>a.token===t))
    S.accounts.push({id,username:user.username,email:user.email||'',uid:user.id||'',avatar:user.profile_pic||'',token:t,status:'valid',added:Date.now(),sel:false});
  Store.save(); renderTokens(); renderAccounts();
  notify(`Token added: ${name}`,'success');
}


function reactivateAllTokens() {
  const banned=S.tokens.filter(t=>t.status==='banned');
  if(!banned.length){notify('No banned tokens','info');return;}
  banned.forEach(t=>{t.status='active';t.chatroomBans=[];const a=S.accounts.find(a=>a.token===t.token);if(a)a.status='valid';});
  Store.save(); renderTokens(); renderAccounts(); notify(`Reactivated ${banned.length} tokens`,'success');
}

/** Force-reactivate a single invalid account — marks it valid regardless of token state */
function reactivateInvalidAccount(id) {
  const a = S.accounts.find(a => a.id === id);
  if (!a) return;
  a.status = 'valid';
  const tok = S.tokens.find(t => t.token === a.token);
  if (tok && tok.status !== 'active') {
    tok.status = 'active';
    tok.chatroomBans = [];
  }
  Store.save();
  renderAccounts();
  renderTokens();
  notify(`${a.username || 'Account'} force-reactivated`, 'success');
}

function deleteAllTokens() {
  if(!S.tokens.length||!confirm(`Delete all ${S.tokens.length} token(s)?`)) return;
  const tokVals=new Set(S.tokens.map(t=>t.token));
  S.tokens=[]; S.accounts=S.accounts.filter(a=>!tokVals.has(a.token));
  Store.save(); renderTokens(); renderAccounts(); notify('All tokens deleted','info');
}

async function doBatchImport() {
  const text=$('batchText').value.trim(); if(!text){notify('Paste tokens first','error');return;}
  const lines=text.split('\n').map(l=>l.trim()).filter(Boolean);
  const prog=$('batchStatus');
  prog.textContent=`Processing 0/${lines.length}…`; prog.className='fetch-st ld';
  let added=0,skipped=0;
  for(let i=0;i<lines.length;i+=5){
    const batch=lines.slice(i,i+5);
    await Promise.all(batch.map(async raw=>{
      const token=raw.replace(/^Bearer\s+/i,'');
      if(S.tokens.some(t=>t.token===token)){skipped++;return;}
      const user=await KickAPI.getUser(token);
      const name=user?user.username:'Token_'+token.slice(0,6);
      const id=String(Date.now()+Math.random());
      S.tokens.push({id,name,token,status:'active',addedAt:Date.now(),accountInfo:user});
      if(user&&!S.accounts.some(a=>a.token===token))
        S.accounts.push({id,username:user.username,email:user.email||'',uid:user.id||'',avatar:user.profile_pic||'',token,status:user?'valid':'invalid',added:Date.now(),sel:false});
      added++;
    }));
    prog.textContent=`Processing ${Math.min(i+5,lines.length)}/${lines.length}…`;
  }
  Store.save(); renderTokens(); renderAccounts();
  closeModal('modalBatch'); $('batchText').value=''; prog.textContent=''; prog.className='fetch-st';
  notify(`Done: ${added} added, ${skipped} skipped`,'success');
}

/* ══ ACCOUNTS ══ */
/* ══ ACCOUNT SEARCH CACHE ═══════════════════════════════════════════════════
   Built once per query change (not per render, not per account).
   Each entry is a single pre-lowercased string covering every searchable field:
     username  |  draft message / slot text  |  status
   O(1) lookup during filter — fast even with thousands of accounts.
═══════════════════════════════════════════════════════════════════════════ */

let _accSearchCache = new Map(); // id → combined lowercase search string
let _accSearchCacheQ = null;     // the query that was active when cache was built

/**
 * Rebuild the search cache for all accounts.
 * Called whenever: search input changes, drafts change, accounts are added/removed.
 * Slots are covered automatically — they live in S.drafts[id].message after apply.
 */
function _buildSearchCache() {
  _accSearchCache = new Map();
  for (const a of S.accounts) {
    const draft = (S.drafts[a.id] || {}).message || '';
    // Strip the !slot prefix so "book of dead" matches even with the prefix present
    const draftClean = draft.replace(/^!slot\s+/i, '');
    _accSearchCache.set(a.id,
      (a.username     || '') + '\x00' +
      (a.email        || '') + '\x00' +
      (String(a.uid  || '')) + '\x00' +
      (a.status       || '') + '\x00' +
      draftClean              + '\x00'
      // All lowercased in one shot below ↓
    );
  }
  // Lowercase the whole map once — avoids per-account toLowerCase calls
  _accSearchCache.forEach((v, k) => _accSearchCache.set(k, v.toLowerCase()));
  _accSearchCacheQ = ($('accSearch')?.value || '').toLowerCase().trim();
}

/** Returns true if account passes the current text query. Pure O(1) lookup. */
function _accMatchesQuery(a, q) {
  if (!q) return true;
  // Rebuild if cache is stale (query changed externally, e.g. programmatic clear)
  if (_accSearchCacheQ !== q) _buildSearchCache();
  const haystack = _accSearchCache.get(a.id);
  return haystack !== undefined && haystack.includes(q);
}

/** Invalidate cache — call after any draft or account mutation. */
function _invalidateSearchCache() {
  _accSearchCacheQ = null;
}

/**
 * Shared filter predicate used by both renderAccounts() and getFilteredAccounts().
 * Applies active tab filter then text search — single source of truth.
 */
function _accPassesFilter(a, q) {
  const st = a.status || 'pending';
  if (S.accFilter === 'valid'        && st !== 'valid' && st !== 'loading')      return false;
  if (S.accFilter === 'invalid'      && st !== 'invalid' && st !== 'pending')    return false;
  if (S.accFilter === 'running'      && !S.jobs.has(a.id))                       return false;
  if (S.accFilter === 'following'    && a.followStatus !== 'following')           return false;
  if (S.accFilter === 'notfollowing' && a.followStatus !== 'not_following')       return false;
  return _accMatchesQuery(a, q);
}

/** Used by Select Visible — same list renderAccounts() will show. */
function getFilteredAccounts() {
  const q = ($('accSearch')?.value || '').toLowerCase().trim();
  if (q !== _accSearchCacheQ) _buildSearchCache();
  return S.accounts.filter(a => _accPassesFilter(a, q));
}

function renderAccounts() {
  const tbody = $('accBody');
  const empty  = $('accEmpty');
  if (!tbody) return;

  const q   = ($('accSearch')?.value || '').toLowerCase().trim();
  const all = S.accounts;

  // Ensure cache is fresh for this query
  if (q !== _accSearchCacheQ) _buildSearchCache();

  const filtered = all.filter(a => _accPassesFilter(a, q));

  const validCount        = all.filter(a => a.status === 'valid').length;
  const invalidCount      = all.filter(a => a.status === 'invalid').length;
  const runningCount      = S.jobs.size;
  const draftCount        = all.filter(a => (S.drafts[a.id] || {}).message).length;
  if ($('fAll'))          $('fAll').textContent          = all.length;
  if ($('fValid'))        $('fValid').textContent        = validCount;
  if ($('fInvalid'))      $('fInvalid').textContent      = invalidCount;
  if ($('fRunning'))      $('fRunning').textContent      = runningCount;
  if ($('qsValid'))   $('qsValid').textContent   = validCount;
  if ($('qsInvalid')) $('qsInvalid').textContent = invalidCount;
  if ($('qsJobs'))    $('qsJobs').textContent    = runningCount;
  if ($('qsDrafts'))  $('qsDrafts').textContent  = draftCount;

  const badge = $('accCount');
  if (badge) { badge.textContent = all.length; badge.classList.toggle('on', all.length > 0); }

  const ljb = $('liveJobsBadge');
  if (ljb) { ljb.textContent = runningCount; ljb.classList.toggle('on', runningCount > 0); }

  empty.style.display = filtered.length ? 'none' : 'block';

  // Show selection-contextual buttons when accounts are checked
  const selCount = all.filter(a => a.sel).length;
  if ($('delSelBtn'))   $('delSelBtn').style.display   = selCount > 0 ? '' : 'none';
  if ($('startSelBtn')) $('startSelBtn').style.display = selCount > 0 ? '' : 'none';
  const ca = $('chkAll'); if (ca) ca.checked = all.length > 0 && all.every(a => a.sel);

  // ── Row rendering (VT-aware) ────────────────────────────────────────
  if (filtered.length > VT.THRESHOLD) {
    // Virtual table: only render visible slice
    VT.render(filtered);
  } else {
    // Small list: full render with fingerprint guard
    VT.deactivate();
    const _fp = filtered.map(a =>
      `${a.id}:${a.status}:${+!!a.sel}:${+S.jobs.has(a.id)}:${(S.drafts[a.id]||{}).message||''}`
    ).join('|') + `|${S.accFilter}|${q}`;
    if (tbody._flt_fp !== _fp) {
      tbody._flt_fp = _fp;
      tbody.innerHTML = filtered.map(_renderAccountRow).join("");
    }
  }
  tbody.onclick = _accTableClick;

  amRenderAccountSelect();

  // Update Follow Bot + Stream Watcher "selected" hints
  const _selCount = S.accounts.filter(a => a.sel).length;
  const _selLabel = _selCount > 0 ? `${_selCount} selected` : '0 selected';
  const _selHint = $('fbSelectedHint'); if (_selHint) _selHint.textContent = _selLabel;
  const _swHint  = $('swSelectedHint'); if (_swHint)  _swHint.textContent  = _selLabel;
}

/* ══════════════════════════════════════════════════════════════════════════════
   RENDER ENGINE v2
   ══════════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────────────────────
   R1 · Standalone row renderer
   Identical to the inline template that was inside renderAccounts().
   Extracted so both the standard path and VT path share one code path.
   ───────────────────────────────────────────────────────────────────────────── */
function _renderAccountRow(a) {
  const st      = a.status || 'pending';
  const avHtml  = a.avatar
    ? `<img src="${esc(a.avatar)}" alt="" onerror="this.style.display='none'">`
    : initials(a.username);
  const isRun   = S.jobs.has(a.id);
  const job     = S.jobs.get(a.id);
  const draftMsg = (S.drafts[a.id] || {}).message || '';

  const draftCell = draftMsg
    ? `<span class="draft-msg-cell has-draft" title="${esc(draftMsg)}">${esc(draftMsg.length > 28 ? draftMsg.slice(0, 28) + '…' : draftMsg)}</span>`
    : `<span class="draft-msg-none">—</span>`;

  const jobCell = isRun && job
    ? `<div style="font-size:9px;color:var(--green);white-space:nowrap"><i class="bi bi-activity"></i> ${job.count} sent<br><span style="color:var(--dim)">${job.randMin}–${job.randMax}s</span></div>`
    : `<span class="dim" style="font-size:10px">—</span>`;

  const stLabel = st === 'loading' ? '…'
                : st === 'valid'   ? 'VALID'
                : st === 'invalid' ? 'INVALID'
                : st.toUpperCase();

  return `<tr class="${a.sel ? 'sel' : ''} ${isRun ? 'job-running' : ''}" data-aid="${esc(a.id)}">
    <td><input type="checkbox" class="chk acc-chk" ${a.sel ? 'checked' : ''}></td>
    <td><div class="acc-info"><div class="av-wrap">${avHtml}</div><div>
      <div class="acc-name">${esc(a.username || '—')}</div>
      ${a.uid ? `<div class="acc-uid">uid:${esc(String(a.uid))}</div>` : ''}
    </div></div></td>
    <td>${draftCell}</td>
    <td><span class="tok-mask">${maskTok(a.token)}</span><button class="copy-btn acc-copy-tok" data-v="${esc(a.token)}">COPY</button></td>
    <td>
      <div style="display:flex;flex-direction:column;gap:3px">
        <span class="badge ${st}">${stLabel}</span>
        ${st === 'invalid' ? `<button class="ic-btn acc-reactivate" title="Force reactivate">↺ REACTIVATE</button>` : ''}
      </div>
    </td>
    <td>${jobCell}</td>
    <td style="font-size:10px;color:var(--dim)">${fmtDate(a.added)}</td>
    <td><div class="act-btns">
      <button class="ic-btn blue-btn acc-login" title="Login"><i class="bi bi-box-arrow-in-right"></i> LOGIN</button>
      <button class="ic-btn ${isRun ? 'running' : 'g'} acc-send">
        <i class="bi bi-${isRun ? 'pause' : 'play'}-fill"></i> ${isRun ? 'RUNNING' : 'SEND'}
      </button>
      ${isRun ? `<button class="ic-btn d acc-stop-job"><i class="bi bi-stop-fill"></i> STOP</button>` : ''}
      <span class="act-divider"></span>
      <button class="ic-btn acc-edit" title="Edit"><i class="bi bi-pencil"></i></button>
      <button class="ic-btn d acc-delete" title="Delete"><i class="bi bi-x-lg"></i></button>
    </div></td>
  </tr>`;
}

/* ─────────────────────────────────────────────────────────────────────────────
   R2 · Standalone click handler (previously inlined inside renderAccounts)
   Bound directly to tbody — survives tbody.innerHTML replacements because
   it's a property of tbody, not of its children.
   ───────────────────────────────────────────────────────────────────────────── */
function _accTableClick(e) {
  const row = e.target.closest('[data-aid]');
  if (!row) return;
  const id = row.dataset.aid;

  if      (e.target.closest('.acc-login'))      { accLogin(id);                                           return; }
  else if (e.target.closest('.acc-send'))       { openSendModal(id);                                     return; }
  else if (e.target.closest('.acc-stop-job'))   { stopJob(id);                                           return; }
  else if (e.target.closest('.acc-reactivate')) { reactivateInvalidAccount(id);                          return; }
  else if (e.target.closest('.acc-edit'))       { accEdit(id);                                           return; }
  else if (e.target.closest('.acc-delete'))     { accDelete(id);                                         return; }
  else if (e.target.closest('.acc-copy-tok'))   { copyText(e.target.closest('.acc-copy-tok').dataset.v); return; }

  const a = S.accounts.find(a => a.id === id);
  if (!a) return;
  a.sel = !a.sel;
  const chk = row.querySelector('.acc-chk');
  if (chk) chk.checked = a.sel;
  row.classList.toggle('sel', a.sel);
  _accUpdateSelectionUI();
}

/* ─────────────────────────────────────────────────────────────────────────────
   R3 · RenderQueue — rAF-batched render scheduling
   Multiple rapid state mutations within one animation frame collapse into a
   single DOM update. Use RenderQueue.schedule('key', fn) instead of calling
   render functions directly in hot paths.

   Why: Active Mode can trigger 5+ simultaneous ban detections; without
   batching each one would call renderAccounts() synchronously, rebuilding
   the table 5× in the same 16ms frame.
   ───────────────────────────────────────────────────────────────────────────── */
const RenderQueue = (() => {
  const _q   = new Map(); // key → fn  (keyed so duplicate-key calls replace, not stack)
  let   _raf = null;

  function _flush() {
    _raf = null;
    // Copy + clear before executing so re-entrant schedules queue for NEXT frame
    const tasks = [..._q.values()];
    _q.clear();
    for (const fn of tasks) fn();
  }

  return {
    /** Schedule a render. Multiple calls with the same key within one frame → one execution. */
    schedule(key, fn) {
      _q.set(key, fn);
      if (!_raf) _raf = requestAnimationFrame(_flush);
    },
    /** Flush immediately (used for urgent renders that must not be deferred). */
    flush() {
      if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
      _flush();
    },
  };
})();

/* ─────────────────────────────────────────────────────────────────────────────
   R4 · VirtualTable (VT) — windowed rendering for large account lists
   Activates when filtered.length > VT.THRESHOLD (default 60).

   Mechanism:
   · The scroll container (.acc-table-wrap) fires passive scroll events.
   · On each scroll tick (rAF-gated), we recalculate the visible row window.
   · tbody.innerHTML is rebuilt with:
       <tr class="vt-spacer" style="height: topPx px">   ← fills scroll space above
       [visible rows]
       <tr class="vt-spacer" style="height: botPx px">   ← fills scroll space below
   · This gives the browser the correct scroll height while only ~20 rows
     are in the DOM at any time.
   · tbody.onclick is bound on tbody (not its children) so it survives
     innerHTML replacement — event delegation always works.

   Performance target: 5 000 accounts, < 2ms per scroll tick at 60fps.
   ───────────────────────────────────────────────────────────────────────────── */
const VT = (() => {
  const ROW_H     = 44;   // px — MUST match CSS .acc-tbl tbody tr { height }
  const OVERSCAN  = 10;   // extra rows above/below visible area
  const THRESHOLD = 60;   // activate above this many filtered rows
  const COLS      = 8;    // colspan for spacer tds

  let _el         = null; // .acc-table-wrap scroll container
  let _tbody      = null; // #accBody
  let _filtered   = [];   // current filtered account array
  let _raf        = null; // pending rAF id
  let _lastStart  = -1;   // last rendered window start
  let _lastEnd    = -1;   // last rendered window end

  // ── Core draw ─────────────────────────────────────────────────────────────
  function _draw(force) {
    _raf = null;
    if (!_el || !_tbody || !_filtered.length) return;

    const scrollTop = _el.scrollTop;
    const viewH     = _el.clientHeight || 480;
    const total     = _filtered.length;

    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
    const endIdx   = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);

    // Skip DOM work if the visible window is identical to last render
    if (!force && _lastStart === startIdx && _lastEnd === endIdx) return;
    _lastStart = startIdx;
    _lastEnd   = endIdx;

    const topH = startIdx * ROW_H;
    const botH = (total - endIdx) * ROW_H;

    // Build HTML: top-spacer + visible rows + bottom-spacer
    const rows = _filtered.slice(startIdx, endIdx).map(_renderAccountRow).join('');
    _tbody.innerHTML =
      (topH > 0 ? `<tr class="vt-spacer"><td colspan="${COLS}" style="height:${topH}px;padding:0;border:0;pointer-events:none"></td></tr>` : '') +
      rows +
      (botH > 0 ? `<tr class="vt-spacer"><td colspan="${COLS}" style="height:${botH}px;padding:0;border:0;pointer-events:none"></td></tr>` : '');
  }

  return {
    ROW_H,
    THRESHOLD,

    // ── Call once from DOMContentLoaded ───────────────────────────────────
    init() {
      _el    = document.querySelector('.acc-table-wrap');
      _tbody = document.getElementById('accBody');
      if (!_el || !_tbody) return;

      // Passive scroll listener — rAF gated so we never do DOM work > 60fps
      _el.addEventListener('scroll', () => {
        if (_raf) return; // already scheduled this frame
        _raf = requestAnimationFrame(() => _draw(false));
      }, { passive: true });
    },

    // ── Called by renderAccounts() when filtered.length > THRESHOLD ───────
    render(filtered) {
      _filtered = filtered;
      _lastStart = -1; // force full redraw on data change
      _lastEnd   = -1;
      if (_raf) cancelAnimationFrame(_raf);
      _raf = requestAnimationFrame(() => _draw(true));
    },

    // ── Called when list shrinks below threshold — resets VT state ───────
    deactivate() {
      _filtered  = [];
      _lastStart = -1;
      _lastEnd   = -1;
      if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
    },
  };
})();

/* ─────────────────────────────────────────────────────────────────────────────
   R5 · Log trimmer — prevents unbounded DOM growth in long automation runs
   Call after appending to any log element.
   ───────────────────────────────────────────────────────────────────────────── */
const LOG_MAX = 500;

function _trimLog(el) {
  if (!el) return;
  // Remove oldest entries until we're at or below the cap
  while (el.children.length > LOG_MAX) el.removeChild(el.firstChild);
}

// Lightweight selection UI sync — called after row-click to avoid full re-render
function _accUpdateSelectionUI() {
  const all      = S.accounts;
  const selCount = all.filter(a => a.sel).length;

  // Header checkbox: checked if all selected, indeterminate if some
  const ca = $('chkAll');
  if (ca) {
    if (selCount === 0)          { ca.checked = false; ca.indeterminate = false; }
    else if (selCount === all.length) { ca.checked = true;  ca.indeterminate = false; }
    else                          { ca.checked = false; ca.indeterminate = true;  }
  }

  // Del button visibility
  const del = $('delSelBtn');
  if (del) del.style.display = selCount > 0 ? '' : 'none';

  // Selection counter badge
  const badge = $('accSelCount');
  if (badge) {
    badge.textContent = selCount > 0 ? `${selCount} selected` : '';
    badge.style.display = selCount > 0 ? '' : 'none';
  }

  // Show/hide "Start Selected" button alongside the del button
  const startSel = $('startSelBtn');
  if (startSel) startSel.style.display = selCount > 0 ? '' : 'none';

  // Follow Bot hint
  const hint = $('fbSelectedHint');
  if (hint) hint.textContent = selCount > 0 ? `${selCount} selected` : '0 selected';
}

// ── Selection action handlers ────────────────────────────────────────────────

function accSelectAll() {
  S.accounts.forEach(a => a.sel = true);
  renderAccounts();
  notify(`${S.accounts.length} account${S.accounts.length !== 1 ? 's' : ''} selected`, 'info');
}

function accSelectNone() {
  S.accounts.forEach(a => a.sel = false);
  renderAccounts();
}

function accSelectVisible() {
  const visible = new Set(getFilteredAccounts().map(a => a.id));
  S.accounts.forEach(a => { a.sel = visible.has(a.id); });
  renderAccounts();
  const n = visible.size;
  notify(`${n} visible account${n !== 1 ? 's' : ''} selected`, 'info');
}

function accOpenAdd() {
  $('accModalTitle').textContent='Add Account';
  $('accTokInput').value=''; $('accTokInput').type='password';
  if($('accChromeProfile')) $('accChromeProfile').value='';
  $('accPreview').style.display='none'; $('accFetchStatus').className='fetch-st';
  openModal('modalAddAcc'); $('accTokInput').focus();
  $('accTokInput').oninput=debounce(async function(){const v=this.value.trim().replace(/^Bearer\s+/i,'');if(v.length>20) await fetchTokPreview(v,'acc');},600);
}

function accEdit(id) {
  const a=S.accounts.find(a=>a.id===id); if(!a) return;
  S.accEditId=id; S.accFetched={username:a.username,email:a.email,id:a.uid,profile_pic:a.avatar};
  $('accModalTitle').textContent='Edit Account';
  $('accTokInput').value=a.token||''; $('accTokInput').type='text';
  if($('accChromeProfile')) $('accChromeProfile').value=a.chromeProfile||'';
  $('apAvatar').src=a.avatar||''; $('apName').textContent=a.username||''; $('apEmail').textContent=a.email||'No email'; $('apUid').textContent='ID: '+(a.uid||'');
  $('accPreview').style.display='flex'; $('accFetchStatus').className='fetch-st';
  openModal('modalAddAcc');
}

async function saveAcc() {
  const token=$('accTokInput').value.trim().replace(/^Bearer\s+/i,'');
  if(!token){notify('Token required','error');return;}
  if(!S.accFetched){notify('Fetching…','info');await fetchTokPreview(token,'acc');}
  const user=S.accFetched;
  const chromeProfile=($('accChromeProfile')?.value||'').trim();
  const data={username:user?.username||'Token_'+token.slice(0,6),email:user?.email||'',uid:user?.id||'',avatar:user?.profile_pic||'',token,chromeProfile,status:user?'valid':'invalid',added:Date.now(),sel:false};
  if(S.accEditId){
    const idx=S.accounts.findIndex(a=>a.id===S.accEditId);
    if(idx>=0) S.accounts[idx]={...S.accounts[idx],...data};
    notify('Account updated','success');
  } else {
    if(S.accounts.some(a=>a.token===token)){notify('Token already exists','error');return;}
    data.id=String(Date.now()); S.accounts.push(data);
    notify('Account added: '+data.username,'success');
  }
  _invalidateSearchCache(); Store.save(); renderAccounts(); closeModal('modalAddAcc');
}

function accDelete(id) {
  const a = S.accounts.find(a => a.id === id);
  if (!a) return;
  if (!confirm(`Delete "${a.username || '?'}"?`)) return;
  if (S.jobs.has(id)) stopJob(id);
  // Remove account from state
  S.accounts = S.accounts.filter(a => a.id !== id);
  // Remove matching token — without this, Store.load()'s auto-sync recreates the account on next launch
  if (a.token) {
    S.tokens = S.tokens.filter(t => t.token !== a.token);
    S._deletedTokens.add(a.token); // permanent blacklist — survives Store.load auto-sync
  }
  delete S.drafts[id];
  _invalidateSearchCache();
  Store.save();
  renderAccounts();
  renderTokens();
  notify('Deleted', 'info');
}

function accDeleteSelected() {
  const toDelete = S.accounts.filter(a => a.sel);
  const n = toDelete.length;
  if (!n) return;
  if (!confirm(`Delete ${n} account${n !== 1 ? 's' : ''}?`)) return;
  // Stop any running jobs and collect tokens to remove
  const tokensToRemove = new Set();
  toDelete.forEach(a => {
    if (S.jobs.has(a.id)) stopJob(a.id);
    if (a.token) tokensToRemove.add(a.token);
    delete S.drafts[a.id];
  });
  // Remove accounts and their tokens from state
  S.accounts = S.accounts.filter(a => !a.sel);
  S.tokens   = S.tokens.filter(t => !tokensToRemove.has(t.token));
  tokensToRemove.forEach(tok => S._deletedTokens.add(tok)); // permanent blacklist
  _invalidateSearchCache();
  Store.save();
  renderAccounts();
  renderTokens();
  notify(`Deleted ${n} account${n !== 1 ? 's' : ''}`, 'info');
}

async function accVerify(id) {
  const a=S.accounts.find(a=>a.id===id); if(!a) return;
  a.status='loading'; a.checkInfo = null; renderAccounts();

  const channelSlug = S.channel?.user?.username || null;
  const chatroomId  = S.chanId || null;

  const result = await KickAPI.fullCheck(a.token, channelSlug, chatroomId);

  if (!result.valid) {
    a.status = 'invalid';
    a.checkInfo = { reason: result.reason || 'Invalid token' };
    const t=S.tokens.find(t=>t.token===a.token); if(t) t.status='banned';
    notify((a.username||id)+': INVALID — '+a.checkInfo.reason, 'error');
  } else {
    a.username = result.username || a.username;
    a.checkInfo = {
      following: result.following,
      banned:    result.banned,
      channel:   channelSlug,
    };
    // Determine status
    if (result.banned) {
      a.status = 'invalid';
      notify(`${a.username}: BANNED in @${channelSlug||'channel'}`, 'error');
    } else {
      a.status = 'valid';
      const flags = [];
      if (channelSlug) flags.push(result.following ? `✓ Following @${channelSlug}` : `✗ Not following @${channelSlug}`);
      notify(`${a.username}: VALID  ${flags.join(' · ')}`, 'success');
    }
    const t=S.tokens.find(t=>t.token===a.token);
    if(t){t.name=a.username;if(t.accountInfo)t.accountInfo.username=a.username;}
  }
  Store.save(); renderAccounts(); renderTokens();
}

/* ── Skeleton helpers ── */
function showAccSkeleton(n=5) {
  const tbody=$('accBody'); if(!tbody) return;
  tbody.innerHTML=Array.from({length:n},()=>`
    <tr><td colspan="8">
      <div class="acc-skel-row">
        <div class="acc-skel-cell skel" style="width:13px;height:13px;border-radius:3px"></div>
        <div class="acc-skel-cell skel" style="width:100%;height:12px"></div>
        <div class="acc-skel-cell skel" style="width:80%;height:12px"></div>
        <div class="acc-skel-cell skel" style="width:60%;height:12px"></div>
        <div class="acc-skel-cell skel" style="width:50px;height:18px;border-radius:20px"></div>
        <div class="acc-skel-cell skel" style="width:40px;height:12px"></div>
        <div class="acc-skel-cell skel" style="width:50px;height:12px"></div>
        <div class="acc-skel-cell skel" style="width:90px;height:24px;border-radius:6px"></div>
      </div>
    </td></tr>`).join('');
}

async function accVerifyAll() {
  const total = S.accounts.length;
  if(!total){notify('No accounts','error');return;}
  showAccSkeleton(Math.min(total,8));

  let valid=0, invalid=0, following=0, banned=0;
  for(let i=0;i<total;i++){
    notify(`Verifying ${i+1}/${total}…`,'info');
    await accVerify(S.accounts[i].id);
    const a=S.accounts[i];
    if(a.status==='valid')   valid++;
    if(a.status==='invalid') invalid++;
    if(a.checkInfo?.following) following++;
    if(a.checkInfo?.banned)    banned++;
    await sleep(400);
  }
  renderAccounts();

  const ch = S.channel?.user?.username;
  const parts = [`✓ ${valid} valid`, `✗ ${invalid} invalid`];
  if(ch) parts.push(`↳ ${following} following @${ch}`, `⊘ ${banned} banned`);
  notify(parts.join(' · '),'success');
}

/* ══ FOLLOW BOT ══ */
const FB = {
  running: false,
  stop:    false,
  ok:      0,
  fail:    0,
  total:   0,
  done:    0,
};


/* ══════════════════════════════════════════════════════════════════════════
   AVATAR UPLOAD SYSTEM
   ─────────────────────────────────────────────────────────────────────────
   Flow per account:
     1. POST /api/v2/presigned-post   → get { url, fields } (S3 presigned)
     2. POST {url} multipart/form-data with fields + file
     3. PATCH /api/v1/user            → { profile_pic: s3_key }
   ══════════════════════════════════════════════════════════════════════════ */

const AV = {
  running: false, stop: false,
  ok: 0, fail: 0, skip: 0, done: 0, total: 0,
  // Uploaded image File objects — keyed by account id for 1:1 mode
  images: [],       // Array<File> for pool mode
  assigned: {},     // { [accId]: File } for 1:1 mode
};

// ── Log helper ─────────────────────────────────────────────────────────────
function avLog(msg, type = 'dim') {
  const el = $('avLog'); if (!el) return;
  const colors = { green:'#3dffa0', red:'#ff3a6e', yel:'#ffcc44', dim:'#555577', info:'#60a5fa', white:'#cccccc' };
  const ts  = new Date().toTimeString().slice(0, 8);
  const line = document.createElement('div');
  line.style.color = colors[type] || colors.dim;
  line.textContent = `${ts}  ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
  _trimLog(el);
}

// ── Progress ───────────────────────────────────────────────────────────────
function avUpdateProgress() {
  const pct = AV.total > 0 ? Math.round(AV.done / AV.total * 100) : 0;
  if ($('avProgressText')) $('avProgressText').textContent = AV.running
    ? `${AV.done} / ${AV.total} · ${pct}%`
    : (AV.done > 0 ? `Done — ${AV.done} / ${AV.total}` : 'Ready');
  if ($('avProgressBar'))  $('avProgressBar').style.width  = pct + '%';
  if ($('avOkCount'))      $('avOkCount').textContent      = AV.ok;
  if ($('avFailCount'))    $('avFailCount').textContent     = AV.fail;
  if ($('avSkipCount'))    $('avSkipCount').textContent     = AV.skip;
}

/* ── Avatar upload — clean minimal headers (no KickAPI._h pollution) ────────
   Kick's presigned-post endpoint is strict:
   - Must send only Authorization + Accept + standard browser headers
   - content-type for the presigned step must be application/json explicitly
   - S3 upload: multipart/form-data (browser sets boundary automatically)
   - Profile patch: PUT to /api/v1/user with profile_pic field
   ─────────────────────────────────────────────────────────────────────────── */
function avBaseHeaders(token, extra = {}) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Origin': 'https://kick.com',
    'Referer': 'https://kick.com/',
    ...extra,
  };
}

/* ── REAL Kick Avatar Upload Flow (confirmed from network capture) ───────────
   Step 1: GET  /api/v2/presigned-post          → { url, fields } S3 presigned
   Step 2: POST {S3 url} multipart              → 204 No Content
   Step 3: POST /profile/update-profile-picture → { profile_pic } JSON
   ─────────────────────────────────────────────────────────────────────────── */

// Step 1: GET presigned S3 URL — no body, just Authorization header
async function avGetPresignedPost(token, contentType) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 10000);
  // Kick's presigned-post endpoint requires content_type as a query param
  // so it can bake the correct Content-Type condition into the S3 policy.
  // Without it the signed policy won't match what we send and S3 returns 403.
  const ct  = encodeURIComponent(contentType || 'image/jpeg');
  const url = `https://kick.com/api/v2/presigned-post?content_type=${ct}`;
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: avBaseHeaders(token),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!r.ok) {
      const raw = await r.text().catch(() => '');
      avLog(`  [1/3] error: ${raw.slice(0, 150)}`, 'dim');
      return { ok: false, status: r.status };
    }
    const data = await r.json();
    // Response: { formAttributes: { action, method, ... }, formInputs: { key, ... } }
    // formAttributes.action = the S3 URL to POST to
    // formInputs = the fields to include in the multipart POST
    const s3Url  = data.formAttributes?.action || data.url || data.presigned_url;
    const fields = data.formInputs            || data.fields || data.data?.fields || {};
    const key    = fields.key                 || data.key;
    // uuid is required by /profile/update-profile-picture as awsResponse.uuid
    // It lives at the top-level response or inside formInputs/formAttributes
    const uuid   = data.uuid || data.formAttributes?.uuid || fields.uuid || key?.split('/').pop()?.split('-').slice(0,5).join('-') || null;
    avLog(`  [1/3] S3 url: ${s3Url?.slice(0,50)}… key: ${key?.slice(0,30)}…`, 'dim');
    if (!s3Url) return { ok: false, status: r.status, error: `no url — keys: ${Object.keys(data).join(',')}` };
    return { ok: true, url: s3Url, fields, key, uuid };
  } catch (e) {
    clearTimeout(tid);
    return { ok: false, status: 0, error: e.message };
  }
}

// Step 2: POST image to S3 via presigned multipart — no auth header
async function avUploadToS3(presignedUrl, fields, file) {
  const form = new FormData();
  // S3 presigned POST: all policy fields must come BEFORE the file.
  // Skip any Content-Type already in fields — we set it explicitly below
  // so it matches the signed policy condition exactly.
  Object.entries(fields || {}).forEach(([k, v]) => {
    if (k.toLowerCase() !== 'content-type') form.append(k, v);
  });
  // Content-Type MUST be an explicit form field matching what Kick signed into
  // the S3 policy. S3 validates it against the policy condition and returns 403
  // if absent or mismatched — this was the root cause of the upload failure.
  const contentType = fields['Content-Type'] || fields['content-type'] || file.type || 'image/jpeg';
  form.append('Content-Type', contentType);
  // File field must be LAST — S3 ignores everything after it.
  form.append('file', file, file.name);

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(presignedUrl, {
      method: 'POST',
      body: form,  // no Content-Type header — browser sets multipart + boundary
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    return { ok: r.status === 204 || r.status === 201 || r.ok, status: r.status };
  } catch (e) {
    clearTimeout(tid);
    return { ok: false, status: 0, error: e.message };
  }
}

// Step 3: POST to /profile/update-profile-picture with awsResponse payload
// Kick requires: { awsResponse: { key, uuid } } — NOT a flat profile_pic field.
async function avUpdateProfilePicture(token, s3Key, s3Uuid) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 10000);
  // uuid: prefer the explicit value; fall back to the UUID portion of the key path
  const uuid = s3Uuid || s3Key?.split('/').pop()?.split('-').slice(0, 5).join('-') || s3Key;
  const body = JSON.stringify({ awsResponse: { key: s3Key, uuid } });
  try {
    const r = await fetch('https://kick.com/profile/update-profile-picture', {
      method: 'POST',
      headers: avBaseHeaders(token, { 'Content-Type': 'application/json' }),
      body,
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!r.ok) {
      const raw = await r.text().catch(() => '');
      avLog(`  [3/3] error body: ${raw.slice(0, 150)}`, 'dim');
      return { ok: false, status: r.status };
    }
    const data = await r.json().catch(() => ({}));
    return { ok: true, status: r.status, profile_pic: data.profile_pic || data.data?.profile_pic || s3Key };
  } catch (e) {
    clearTimeout(tid);
    return { ok: false, status: 0, error: e.message };
  }
}

// ── Upload one avatar for one account (full 3-step flow) ─────────────────
async function avUploadOne(acc, file) {
  const name        = acc.username || maskTok(acc.token);
  const contentType = file.type || 'image/jpeg';

  // Step 1: GET presigned URL — pass contentType so Kick signs the correct
  // Content-Type condition into the S3 policy (missing = 403 from S3).
  avLog(`  [1/3] requesting presigned URL…`, 'dim');
  const presigned = await avGetPresignedPost(acc.token, contentType);
  if (!presigned.ok) {
    const reason = presigned.status === 401 ? 'invalid token'
                 : presigned.status === 403 ? 'forbidden (check token)'
                 : presigned.status === 405 ? 'method not allowed — endpoint may have changed'
                 : presigned.status === 422 ? 'unprocessable (bad content_type?)'
                 : presigned.error          ? presigned.error
                 : `HTTP ${presigned.status || 0}`;
    avLog(`  [1/3] ✗ presigned: ${reason}`, 'red');
    return { ok: false, reason: `presigned failed — ${reason}` };
  }
  avLog(`  [1/3] ✓ got presigned URL · key: ${presigned.key?.slice(0,30)}…`, 'dim');

  // Step 2: upload to S3
  avLog(`  [2/3] uploading ${(file.size/1024).toFixed(1)}KB to S3…`, 'dim');
  const upload = await avUploadToS3(presigned.url, presigned.fields, file);
  if (!upload.ok) {
    const reason = upload.error || `HTTP ${upload.status}`;
    avLog(`  [2/3] ✗ S3 upload: ${reason}`, 'red');
    return { ok: false, reason: `S3 upload failed — ${reason}` };
  }
  avLog(`  [2/3] ✓ S3 upload OK (${upload.status})`, 'dim');

  // Step 3: POST to /profile/update-profile-picture
  avLog(`  [3/3] updating profile picture…`, 'dim');
  const patch = await avUpdateProfilePicture(acc.token, presigned.key, presigned.uuid);
  if (!patch.ok) {
    const reason = patch.status === 401 ? 'invalid token'
                 : patch.status === 403 ? 'forbidden'
                 : patch.status === 422 ? 'image rejected by Kick (try JPG < 2MB)'
                 : patch.error          ? patch.error
                 : `HTTP ${patch.status || 0}`;
    avLog(`  [3/3] ✗ profile update: ${reason}`, 'red');
    return { ok: false, reason: `profile update failed — ${reason}` };
  }
  avLog(`  [3/3] ✓ profile updated`, 'dim');

  acc.avatar = patch.profile_pic || presigned.key;
  return { ok: true };
}

// ── Build thumbnail strip for uploaded images ─────────────────────────────
function avRenderThumbs() {
  const el = $('avThumbStrip'); if (!el) return;
  if (!AV.images.length) { el.innerHTML = ''; return; }
  el.innerHTML = AV.images.map((f, i) => {
    const url = URL.createObjectURL(f);
    return `<div style="position:relative;flex-shrink:0">
      <img src="${url}" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" title="${esc(f.name)}">
      <span style="position:absolute;bottom:1px;right:2px;font-size:8px;color:#fff;text-shadow:0 0 3px #000">${i+1}</span>
    </div>`;
  }).join('');
}

// ── Main run ──────────────────────────────────────────────────────────────
async function avRun() {
  if (AV.running) return;

  // Account pool
  const accMode = document.querySelector('input[name="avAccMode"]:checked')?.value || 'all';
  let accs = [];
  if      (accMode === 'valid')    accs = S.accounts.filter(a => a.status === 'valid' && a.token);
  else if (accMode === 'selected') accs = S.accounts.filter(a => a.sel && a.token);
  else                             accs = S.accounts.filter(a => a.token);

  if (!accs.length) { notify('No accounts available', 'error'); return; }

  // Image pool
  const imgMode = $('avImgMode')?.value || 'pool';
  if (!AV.images.length) { notify('Upload images first', 'error'); return; }

  const delayMs = Math.max(500, parseInt($('avDelay')?.value) || 3000);

  // Reset
  AV.running = true; AV.stop = false;
  AV.ok = 0; AV.fail = 0; AV.skip = 0; AV.done = 0; AV.total = accs.length;
  if ($('avStartBtn')) $('avStartBtn').style.display = 'none';
  if ($('avStopBtn'))  $('avStopBtn').style.display  = '';
  if ($('avBadge'))    $('avBadge').textContent       = 'RUNNING';
  if ($('avTotalLabel')) $('avTotalLabel').textContent = `${accs.length} accounts`;
  avUpdateProgress();

  avLog(`Starting — ${accs.length} accounts · ${AV.images.length} image${AV.images.length !== 1 ? 's' : ''} · mode: ${imgMode} · ${delayMs}ms delay`, 'info');

  for (let i = 0; i < accs.length; i++) {
    if (AV.stop) { avLog('Stopped by user.', 'yel'); break; }
    const acc  = accs[i];
    const name = acc.username || maskTok(acc.token);

    // Pick image
    let file;
    if (imgMode === 'sequential') {
      file = AV.images[i % AV.images.length];
    } else if (imgMode === 'random') {
      file = AV.images[Math.floor(Math.random() * AV.images.length)];
    } else {
      // pool: cycle through
      file = AV.images[i % AV.images.length];
    }

    avLog(`[${i+1}/${accs.length}] ${name} → ${file.name}…`, 'dim');

    const result = await avUploadOne(acc, file);

    if (result.ok) {
      AV.ok++;
      avLog(`✓ ${name} → avatar updated`, 'green');
      // Refresh account row avatar in UI
      Store.save();
      renderAccounts();
    } else {
      AV.fail++;
      avLog(`✗ ${name} → ${result.reason}`, 'red');
    }

    AV.done++;
    avUpdateProgress();

    if (i < accs.length - 1 && !AV.stop) {
      const jitter = Math.floor(delayMs * 0.15 * (Math.random() * 2 - 1));
      await sleep(delayMs + jitter);
    }
  }

  AV.running = false;
  if ($('avStartBtn')) $('avStartBtn').style.display = '';
  if ($('avStopBtn'))  $('avStopBtn').style.display  = 'none';
  if ($('avBadge'))    $('avBadge').textContent       = AV.stop ? 'Stopped' : 'Done';
  avLog(`Done — ✓${AV.ok} updated  ✗${AV.fail} failed  ${AV.skip} skipped  out of ${accs.length}`, AV.ok > 0 ? 'green' : 'yel');
  avUpdateProgress();
}

function avStop() {
  AV.stop = true;
  if ($('avBadge')) $('avBadge').textContent = 'Stopping…';
}

// ── Init (called from DOMContentLoaded) ───────────────────────────────────
function initAvatarUploader() {
  if (!$('avDropzone')) return;

  // Dropzone — click or drag-and-drop
  const dz  = $('avDropzone');
  const inp = $('avFileInput');

  dz.addEventListener('click', () => inp?.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag-over');
    avHandleFiles([...e.dataTransfer.files]);
  });
  inp?.addEventListener('change', () => {
    avHandleFiles([...inp.files]);
    inp.value = '';
  });

  // Clear images
  $('avClearImgBtn')?.addEventListener('click', () => {
    AV.images = [];
    avRenderThumbs();
    avUpdateImgCount();
    avLog('Image pool cleared.', 'yel');
  });

  // Start / Stop
  $('avStartBtn')?.addEventListener('click', avRun);
  $('avStopBtn')?.addEventListener('click', avStop);
  $('avClearLogBtn')?.addEventListener('click', () => { const el = $('avLog'); if (el) el.innerHTML = ''; });

  // Collapse toggle
  $('avCardToggle')?.addEventListener('click', () => {
    const body = $('avCardBody');
    const hd   = $('avCardToggle');
    const chev = $('avCardToggle')?.querySelector('.auto-mod-chevron');
    if (!body) return;
    const open = body.classList.toggle('open');
    body.style.display = open ? 'block' : 'none';
    if (hd)   hd.classList.toggle('open', open);
    if (chev) chev.classList.toggle('open', open);
  });
}

function avHandleFiles(files) {
  const valid = files.filter(f => f.type.startsWith('image/'));
  if (!valid.length) { notify('No valid image files selected', 'error'); return; }
  AV.images.push(...valid);
  avRenderThumbs();
  avUpdateImgCount();
  avLog(`Added ${valid.length} image${valid.length !== 1 ? 's' : ''} — pool: ${AV.images.length} total`, 'info');
}

function avUpdateImgCount() {
  const el = $('avImgCount');
  if (el) el.textContent = AV.images.length
    ? `${AV.images.length} image${AV.images.length !== 1 ? 's' : ''} loaded`
    : 'No images loaded';
}

function fbLog(msg, type='dim') {
  const el = $('fbLog'); if (!el) return;
  const colors = { green:'#3dffa0', red:'#ff3a6e', yel:'#ffcc44', dim:'#555577', info:'#60a5fa', white:'#cccccc' };
  const ts = new Date().toTimeString().slice(0,8);
  const line = document.createElement('div');
  line.style.color = colors[type] || colors.dim;
  line.textContent = `${ts}  ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
  _trimLog(el);
}

function fbUpdateProgress() {
  const pct = FB.total > 0 ? Math.round(FB.done / FB.total * 100) : 0;
  if ($('fbProgressText')) $('fbProgressText').textContent = FB.running
    ? `${FB.done} / ${FB.total} · ${pct}%`
    : (FB.done > 0 ? `Done — ${FB.done} / ${FB.total}` : 'Ready');
  if ($('fbProgressBar'))  $('fbProgressBar').style.width  = pct + '%';
  if ($('fbOkCount'))      $('fbOkCount').textContent      = FB.ok;
  if ($('fbFailCount'))    $('fbFailCount').textContent     = FB.fail;
}

function fbUpdateChannelBanner() {
  const el = $('fbChannelBanner'); if (!el) return;
  if (S.channel && S.chanId) {
    const name = S.channel.user?.username || '?';
    el.style.color = 'var(--ac,#3dffa0)';
    el.innerHTML = `<i class="bi bi-broadcast-pin"></i> @${esc(name)}`;
  } else {
    el.style.color = 'var(--dim)';
    el.textContent = 'No channel connected';
  }
}

// ── Follow Bot — Click Mode (token-based, real Chrome window) ──────────────
//
// Pipeline (per account):
//   1. Spawn real visible Chrome window with a small helper extension
//   2. Extension authenticates the page using the account's BEARER TOKEN
//      (fetches /api/v2/user with Authorization: Bearer <token>) — this
//      sets the session cookies on kick.com without needing email/password
//   3. Extension navigates to https://kick.com/<channelSlug>
//   4. Extension clicks the green Follow button
//   5. Reports success/failure back to FLT, Chrome window closes, next runs
async function followBotRun() {
  if (FB.running) { notify('Already running', 'info'); return; }
  if (!S.channel) { notify('Connect to a channel first (Chat Spammer tab)', 'error'); return; }
  const channelSlug = S.channel.user?.username || S.channel.slug;
  if (!channelSlug) { notify('Could not determine channel slug', 'error'); return; }

  const delayMs = Math.max(1000, parseInt($('fbDelay')?.value) || 6000);

  // Browser choice — Chrome (default) or Firefox
  const browser = (document.querySelector('.fb-browser-btn.active')?.dataset?.browser === 'firefox')
    ? 'firefox' : 'chrome';

  // ── Account selection mode (same as before) ───────────────────────────────
  const accMode = document.querySelector('input[name="fbAccMode"]:checked')?.value || 'all';
  let accs = [];
  if (accMode === 'selected') {
    accs = S.accounts.filter(a => a.sel && a.token);
    if (!accs.length) { notify('No accounts selected — check boxes in the Accounts table', 'error'); return; }
  } else if (accMode === 'count') {
    const n = Math.max(1, parseInt($('fbCount')?.value) || 10);
    accs = S.accounts.filter(a => a.token).slice(0, n);
    if (!accs.length) { notify('No accounts with tokens found', 'error'); return; }
  } else {
    accs = S.accounts.filter(a => a.token);
    if (!accs.length) { notify('No accounts with tokens found', 'error'); return; }
  }

  // Reset state
  FB.running = true; FB.stop = false;
  FB.ok = 0; FB.fail = 0; FB.done = 0; FB.total = accs.length;
  if ($('fbStartBtn'))     $('fbStartBtn').style.display     = 'none';
  if ($('fbStopBtn'))      $('fbStopBtn').style.display      = '';
  if ($('followBotBadge')) $('followBotBadge').textContent   = 'RUNNING';
  if ($('fbTotalLabel'))   $('fbTotalLabel').textContent     = `${accs.length} accounts`;
  fbUpdateProgress();

  const modeLabel = accMode === 'all' ? 'all accounts' : accMode === 'count' ? `first ${accs.length}` : `${accs.length} selected`;
  fbLog(`Follow Bot — ${accs.length} accounts (${modeLabel}) → @${channelSlug} · ${delayMs}ms gap`, 'info');
  fbLog(`Click-mode · Real ${browser === 'firefox' ? 'Firefox' : 'Chrome'} · token-based login`, 'green');

  // Bind progress listener (idempotent — preload uses removeAllListeners first)
  window.electronAPI?.onFollowClickerProgress?.((d) => {
    if (!d) return;
    if (d.step === 'ok')        { FB.ok++;   FB.done++; fbLog(d.msg, 'green'); fbUpdateProgress(); }
    else if (d.step === 'fail') { FB.fail++; FB.done++; fbLog(d.msg, 'red');   fbUpdateProgress(); }
    else if (d.step === 'cycle') fbLog(d.msg, 'dim');
    else if (d.step === 'ext')   fbLog(d.msg, 'yel');
    else if (d.step === 'done')  fbLog(d.msg, 'green');
    else                         fbLog(d.msg || '', d.type === 'err' ? 'red' : 'dim');
  });

  try {
    await window.electronAPI.followClickerStart({
      accounts: accs.map(a => ({
        id:       a.id,
        username: a.username,
        email:    a.email    || null,
        password: a.password || null,
        token:    a.token    || null,
      })),
      channelSlug,
      gapMs: delayMs,
      browser,                                // 'chrome' | 'firefox'
    });
  } catch (e) {
    fbLog('✗ ' + (e.message || e), 'red');
  }

  FB.running = false;
  if ($('fbStartBtn'))     $('fbStartBtn').style.display    = '';
  if ($('fbStopBtn'))      $('fbStopBtn').style.display     = 'none';
  if ($('followBotBadge')) $('followBotBadge').textContent  = FB.stop ? 'Stopped' : 'Done';
}

function followBotStop() {
  FB.stop = true;
  if ($('followBotBadge')) $('followBotBadge').textContent = 'Stopping…';
  try { window.electronAPI?.followClickerStop?.(); } catch (_) {}
}

/* ══════════════════════════════════════════════════════════════════════════
 * TOKEN HEALTH CHECKER
 * Iterates every saved account, pings /api/v1/user via main-process IPC.
 * Updates a.status to 'valid' or 'invalid' in-place + re-renders.
 * Logs summary to admin webhook so you can spot mass-bans across users.
 * ══════════════════════════════════════════════════════════════════════════ */
const HC = { running: false, abort: false };

async function accCheckHealth() {
  if (HC.running) { notify('Health check already running', 'info'); return; }
  const accs = S.accounts.slice();
  if (!accs.length) { notify('No accounts to check', 'info'); return; }
  HC.running = true; HC.abort = false;

  // UI toggles — always RESET the Stop button to its original content first
  // (in case a previous run left it on "Stopping…")
  if ($('accHealthBtn'))      $('accHealthBtn').style.display      = 'none';
  if ($('accHealthStopBtn')) {
    $('accHealthStopBtn').innerHTML   = '<i class="bi bi-stop-fill"></i> Stop Check';
    $('accHealthStopBtn').style.display = '';
  }
  if ($('accHealthProgress')) $('accHealthProgress').style.display = '';
  const setProg = (done, total, deadCount) => {
    if ($('accHealthText')) {
      $('accHealthText').textContent =
        `${done} / ${total}` + (deadCount ? `  ·  ${deadCount} dead` : '');
    }
    if ($('accHealthFill')) {
      $('accHealthFill').style.width = (total > 0 ? Math.round(done / total * 100) : 0) + '%';
    }
  };
  setProg(0, accs.length, 0);
  notify(`Checking ${accs.length} accounts…`, 'info');

  let dead = 0, alive = 0, errors = 0;
  // Modest parallelism — 4 concurrent requests keeps Kick happy + stays fast
  const CONCURRENCY = 4;
  let cursor = 0;
  async function worker() {
    while (cursor < accs.length && !HC.abort) {
      const i = cursor++;
      const a = accs[i];
      // Show "checking" state while we wait
      a.status = 'loading';
      RenderQueue.schedule('renderAccounts', renderAccounts);
      let res;
      try {
        res = await window.electronAPI.kickTokenCheck(a.token);
      } catch (e) {
        res = { ok: false, error: String(e && e.message || e) };
      }
      if (res && res.ok && res.valid) {
        a.status = 'valid';
        if (res.username && !a.username) a.username = res.username;
        if (res.uid      && !a.uid)      a.uid      = res.uid;
        if (res.email    && !a.email)    a.email    = res.email;
        if (res.avatar   && !a.avatar)   a.avatar   = res.avatar;
        a.lastHealthCheck = new Date().toISOString();
        alive++;
      } else if (res && res.ok && !res.valid) {
        a.status = 'invalid';
        a.lastHealthCheck = new Date().toISOString();
        a.healthReason = res.reason || ('http-' + (res.status || '?'));
        dead++;
      } else {
        errors++; // network/parse error — leave status alone
      }
      setProg(alive + dead + errors, accs.length, dead);
    }
  }
  // Run the workers, then GUARANTEE UI restore via finally — earlier bug was
  // that an exception inside Store.save / renderAccounts would prevent the
  // cleanup lines from running, leaving the Stop button stuck on "Stopping…".
  let stopped = false;
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, accs.length) }, () => worker()));
    stopped = HC.abort;
    // Persist + final render (best-effort — failures must not block UI restore)
    try { invalidateSearchCache?.(); } catch (_) {}
    try { await Store.save(); } catch (_) {}
    try { renderAccounts(); } catch (_) {}
  } catch (e) {
    try { console.warn('[HC] worker chain threw:', e); } catch (_) {}
  } finally {
    HC.running = false;
    HC.abort   = false;
    if ($('accHealthBtn')) $('accHealthBtn').style.display = '';
    if ($('accHealthStopBtn')) {
      $('accHealthStopBtn').style.display = 'none';
      $('accHealthStopBtn').innerHTML     = '<i class="bi bi-stop-fill"></i> Stop Check';
    }
    if ($('accHealthProgress')) $('accHealthProgress').style.display = 'none';
  }

  const summary =
    `Health check ${stopped ? 'stopped' : 'done'} — ` +
    `${alive} valid · ${dead} dead · ${errors} errors (of ${accs.length})`;
  notify(summary, dead > 0 ? 'info' : 'success');

  // Webhook log — bulk-dead alert lands in admin channel
  try {
    await window.fltLogger?.emit?.({
      action:   'accounts.health.check',
      severity: dead >= 5 ? 'warn' : 'info',
      message:  summary,
      data: {
        total:    accs.length,
        valid:    alive,
        invalid:  dead,
        errors,
        stopped,
      },
    });
  } catch (_) {}
}

function accCheckHealthStop() {
  HC.abort = true;
  if ($('accHealthStopBtn')) $('accHealthStopBtn').textContent = 'Stopping…';
}

/* ══════════════════════════════════════════════════════════════════════════
 * FOLLOW STATUS CHECKER (Dispatcher → "Check Follow Status")
 * For the currently-connected channel, fetches each account's followed list
 * and reports who is / isn't already following. Surfaces a modal where the
 * user can dispatch "send not-following to Follow Bot" in one click.
 * ══════════════════════════════════════════════════════════════════════════ */
const FS = {
  running:  false,
  abort:    false,
  rows:     [],     // { id, username, status: 'pending'|'yes'|'no'|'err', followCount, reason }
  channel:  null,   // slug
};

async function dispatcherCheckFollowStatus() {
  if (FS.running) { notify('Follow-status check already running', 'info'); return; }
  if (!S.channel) { notify('Connect to a channel first', 'error'); return; }
  const slug = (S.channel.user?.username || S.channel.slug || '').toLowerCase();
  if (!slug) { notify('Could not resolve channel slug', 'error'); return; }
  const accs = S.accounts.filter(a => a.token);
  if (!accs.length) { notify('No accounts with tokens', 'error'); return; }

  // Reset Stop button content from any previous run that left it on "Stopping…"
  if ($('followCheckStopBtn')) $('followCheckStopBtn').innerHTML = '<i class="bi bi-stop-fill"></i> Stop';

  FS.running = true; FS.abort = false;
  FS.channel = slug;
  FS.rows = accs.map(a => ({
    id:           a.id,
    username:     a.username || '?',
    status:       'pending',
    followCount:  null,
    reason:       null,
  }));

  // Modal open + initial render
  if ($('fsChannelName')) $('fsChannelName').textContent = '@' + slug;
  if ($('fsTotal'))       $('fsTotal').textContent       = accs.length;
  if ($('fsFollowing'))   $('fsFollowing').textContent   = '0';
  if ($('fsNotFollowing'))$('fsNotFollowing').textContent= '0';
  if ($('fsErrors'))      $('fsErrors').textContent      = '0';
  fsRenderRows();
  openModal('modalFollowStatus');

  // UI toggles in the channel strip
  if ($('followCheckBtn'))      $('followCheckBtn').style.display      = 'none';
  if ($('followCheckStopBtn'))  $('followCheckStopBtn').style.display  = '';
  if ($('followCheckProgress')) $('followCheckProgress').style.display = '';
  const setProg = (done, total) => {
    if ($('followCheckText')) $('followCheckText').textContent = `${done} / ${total}`;
    if ($('followCheckFill')) $('followCheckFill').style.width = (total > 0 ? Math.round(done / total * 100) : 0) + '%';
  };
  setProg(0, accs.length);

  let yes = 0, no = 0, err = 0;
  let firstRespLogged = false;
  // Browser-context check: each call spins up a hidden Chromium window, loads
  // kick.com authenticated, and calls /api/v2/channels/followed from inside
  // the page. Same context the Follow Bot uses — Kasada-safe. Heavier than
  // a raw HTTP call so we cap concurrency to 2 to keep memory reasonable.
  const CONCURRENCY = 2;
  let cursor = 0;
  async function worker() {
    while (cursor < accs.length && !FS.abort) {
      const i = cursor++;
      const a = accs[i];
      const row = FS.rows[i];
      let res;
      try {
        res = await window.electronAPI.kickFollowCheckBrowser(a.token, slug);
      } catch (e) {
        res = { ok: false, error: String(e && e.message || e) };
      }
      // DevTools log on first response — confirms what we're actually getting
      if (!firstRespLogged && res) {
        firstRespLogged = true;
        try {
          console.log('[FS] first response from @' + slug + ' for ' + (a.username || '?'),
            '\n  ok='         + res.ok,
            '\n  following='  + JSON.stringify(res.following),
            '\n  total='      + res.count,
            '\n  dom_count='  + (res.dom_count    ?? '—'),
            '\n  api_count='  + (res.api_count    ?? '—'),
            '\n  sample='     + JSON.stringify(res.slugs_sample || []),
            (res.api_error ? '\n  api_error=' + res.api_error : ''),
            (res.error     ? '\n  error='     + res.error     : ''));
        } catch (_) {}
      }
      if (res && res.ok && typeof res.following === 'boolean') {
        row.status      = res.following ? 'yes' : 'no';
        row.followCount = res.count || 0;
        if (res.following) yes++; else no++;
      } else {
        row.status = 'err';
        row.reason = (res && (res.error || res.status)) || 'unknown';
        err++;
      }
      if ($('fsFollowing'))    $('fsFollowing').textContent    = yes;
      if ($('fsNotFollowing')) $('fsNotFollowing').textContent = no;
      if ($('fsErrors'))       $('fsErrors').textContent       = err;
      setProg(yes + no + err, accs.length);
      fsRenderRows();
    }
  }
  // Same try/finally pattern — UI restore must run no matter what happens
  // inside the worker chain (Kick going down, BrowserWindow crash, etc.).
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, accs.length) }, () => worker()));
  } catch (e) {
    try { console.warn('[FS] worker chain threw:', e); } catch (_) {}
  } finally {
    FS.running = false;
    FS.abort   = false;
    if ($('followCheckBtn')) $('followCheckBtn').style.display = '';
    if ($('followCheckStopBtn')) {
      $('followCheckStopBtn').style.display = 'none';
      $('followCheckStopBtn').innerHTML     = '<i class="bi bi-stop-fill"></i> Stop';
    }
    if ($('followCheckProgress')) $('followCheckProgress').style.display = 'none';
  }

  // Webhook summary
  try {
    await window.fltLogger?.emit?.({
      action:   'channel.follow.check',
      severity: 'info',
      message:  `Follow-status check on @${slug}: ${yes} following · ${no} not following · ${err} errors`,
      data: { channel: slug, total: accs.length, following: yes, not_following: no, errors: err },
    });
  } catch (_) {}
}

function dispatcherCheckFollowStatusStop() {
  FS.abort = true;
  if ($('followCheckStopBtn')) $('followCheckStopBtn').textContent = 'Stopping…';
}

function fsRenderRows() {
  const wrap = $('fsRows'); if (!wrap) return;
  const filter = (document.querySelector('input[name="fsFilter"]:checked')?.value) || 'all';
  let rows = FS.rows;
  if      (filter === 'not') rows = rows.filter(r => r.status === 'no');
  else if (filter === 'yes') rows = rows.filter(r => r.status === 'yes');
  else if (filter === 'err') rows = rows.filter(r => r.status === 'err');
  wrap.innerHTML = rows.map(r => {
    const cls = r.status === 'yes' ? 'yes' : r.status === 'no' ? 'no' : r.status === 'err' ? 'err' : 'pend';
    const lbl = r.status === 'yes' ? 'FOLLOWING'
              : r.status === 'no'  ? 'NOT FOLLOWING'
              : r.status === 'err' ? 'ERROR'
              : 'checking…';
    const ct = (r.followCount != null) ? `follows: ${r.followCount}` : '';
    return `<div class="fs-row" data-aid="${esc(r.id)}">
      <span style="font-size:13px">${r.status === 'yes' ? '✅' : r.status === 'no' ? '❌' : r.status === 'err' ? '⚠' : '⌛'}</span>
      <span class="fs-name">${esc(r.username)}</span>
      <span class="fs-followct">${esc(ct)}</span>
      <span class="fs-state ${cls}">${lbl}</span>
    </div>`;
  }).join('') || '<div class="fs-row"><span></span><span class="fs-name dim">No accounts match this filter.</span><span></span><span></span></div>';
}

// "Select all not-following" — tick a.sel=true for those accounts, switch
// Follow Bot to "Selected" mode, jump there.
function fsSelectAllNotFollowing() {
  const notFollowing = new Set(FS.rows.filter(r => r.status === 'no').map(r => r.id));
  if (!notFollowing.size) { notify('No "not following" accounts to select', 'info'); return; }
  S.accounts.forEach(a => { a.sel = notFollowing.has(a.id); });
  invalidateSearchCache?.();
  renderAccounts();
  notify(`${notFollowing.size} account(s) selected (not following @${FS.channel})`, 'success');
}

function fsRunFollowBotForNotFollowing() {
  fsSelectAllNotFollowing();
  const cnt = S.accounts.filter(a => a.sel).length;
  if (!cnt) return;
  closeModal('modalFollowStatus');
  // Switch Follow Bot mode to "selected" and kick it off
  const selRadio = $('fbModeSelected'); if (selRadio) selRadio.checked = true;
  switchTab('automation');
  setTimeout(() => {
    notify(`Starting Follow Bot for ${cnt} accounts → @${FS.channel}`, 'info');
    followBotRun();
  }, 250);
}

/* ══════════════════════════════════════════════════════════════════════════
 * STREAM WATCHER — opens viewer WebSockets per account to gain watchtime.
 *
 * Pipeline per account:
 *   1. fetchViewerToken({ bearerToken })  → main process fetches viewer JWT
 *   2. vwOpen({ accountId, username, viewerToken, channelId, livestreamId })
 *      → main process opens a native TLS WebSocket to websockets.kick.com,
 *        pings every 12–17s; Kick counts the account as a live viewer.
 *
 * Stop: vwCloseAll() destroys all sockets.
 * The backend infrastructure is already complete in main.js — this is just
 * the renderer-side orchestration + UI plumbing.
 * ══════════════════════════════════════════════════════════════════════════ */
const SW = {
  running: false,
  stop:    false,
  total:   0,
  alive:   0,
  fail:    0,
  done:    0,
  byAcc:   new Map(),    // accountId → { username, status }
  _bound:  false,
  // ── Kick-side verification ─────────────────────────────────────────────
  baselineCount: null,   // channel's viewer count when Start was clicked
  kickCount:    null,    // most recent observed count
  peakDelta:    0,       // highest delta we ever observed (so transient dips don't reset our hint)
  verifyTimer:  null,
  channelSlug:  null,
};

// Fetch the current viewer count from Kick's public API.
// Returns the integer count, or null on error.
async function swFetchKickViewerCount(slug) {
  if (!slug) return null;
  try {
    const r = await fetch('https://kick.com/api/v2/channels/' + encodeURIComponent(slug), {
      headers: { accept: 'application/json' },
      credentials: 'omit',           // public endpoint — don't need cookies
      cache: 'no-store',
    });
    if (!r.ok) return null;
    const j = await r.json();
    // viewer_count lives under .livestream — null when offline
    const c = j?.livestream?.viewer_count;
    return (typeof c === 'number') ? c : null;
  } catch (_) {
    return null;
  }
}

function swLog(msg, kind) {
  const el = $('swLog'); if (!el) return;
  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const cls = ({ green:'log-green', red:'log-red', yel:'log-yel', dim:'log-dim', info:'log-info' })[kind] || 'log-dim';
  const ln = document.createElement('div');
  ln.className = 'log-ln';
  ln.innerHTML = `<span class="log-ts">${ts}</span> <span class="${cls}">${esc(msg)}</span>`;
  el.appendChild(ln);
  el.scrollTop = el.scrollHeight;
  _trimLog(el);
}

function swUpdateProgress() {
  if ($('swAliveCount'))   $('swAliveCount').textContent   = SW.alive;
  if ($('swFailCount'))    $('swFailCount').textContent    = SW.fail;
  if ($('swTotalLabel'))   $('swTotalLabel').textContent   = `${SW.total} accs`;

  // STATUS field shows Kick's verified count when we have it, our internal
  // count otherwise. This is the "are they real viewers?" answer.
  if ($('swLiveCount')) {
    if (SW.kickCount != null && SW.baselineCount != null) {
      const delta = SW.kickCount - SW.baselineCount;
      const sign  = delta >= 0 ? '+' : '';
      $('swLiveCount').value =
        `Kick: ${SW.kickCount} (baseline ${SW.baselineCount}, ${sign}${delta}) · ours: ${SW.alive}/${SW.total}`;
    } else {
      $('swLiveCount').value = `${SW.alive} / ${SW.total} connected (awaiting Kick verification…)`;
    }
  }

  const pct = SW.total > 0 ? Math.round(SW.alive / SW.total * 100) : 0;
  if ($('swProgressText')) $('swProgressText').textContent = SW.running
    ? `${SW.alive} / ${SW.total} watching · ${pct}%`
    : (SW.done > 0 ? `Stopped — peak +${SW.peakDelta} on Kick` : 'Ready');
  if ($('swProgressBar'))  $('swProgressBar').style.width  = pct + '%';
}

function swUpdateChannelBanner() {
  const el = $('swChannelBanner'); if (!el) return;
  if (S.channel && S.chanId) {
    const name = S.channel.user?.username || '?';
    el.style.display = '';
    el.innerHTML = `<i class="bi bi-broadcast-pin"></i> @${esc(name)}`;
  } else {
    el.style.display = 'none';
  }
}

function swBindEvents() {
  if (SW._bound) return;
  SW._bound = true;
  try {
    window.electronAPI?.onVwStatus?.((d) => {
      if (!d || !d.accountId) return;
      const slot = SW.byAcc.get(d.accountId) || { username: '?', status: '?' };
      slot.status = d.status;
      SW.byAcc.set(d.accountId, slot);
      const u = slot.username;
      if (d.status === 'watching' || d.status === 'connected' || d.status === 'alive') {
        // count once per account
        if (slot.status !== 'counted-alive') {
          SW.alive++;
          slot.status = 'counted-alive';
          SW.byAcc.set(d.accountId, slot);
          swLog(`● ${u}: live viewer`, 'green');
        }
      } else if (d.status === 'closed' || d.status === 'timeout' || d.status === 'error') {
        if (slot.status === 'counted-alive') {
          SW.alive = Math.max(0, SW.alive - 1);
        }
        SW.fail++;
        swLog(`✗ ${u}: ${d.status}${d.error ? ' — ' + d.error : ''}`, 'red');
      }
      swUpdateProgress();
    });
    window.electronAPI?.onVwLog?.((d) => {
      if (!d) return;
      const tag = d.username ? `[${d.username}] ` : '';
      const kind = d.type === 'err' ? 'red' : d.type === 'warn' ? 'yel' : 'dim';
      swLog(tag + (d.msg || ''), kind);
    });
  } catch (_) {}
}

async function streamWatcherRun() {
  if (SW.running) { notify('Stream Watcher already running', 'info'); return; }
  if (!S.channel || !S.chanId) { notify('Connect to a channel first (Chat Spammer tab)', 'error'); return; }

  // Channel slug is enough — the BrowserWindow viewer just loads kick.com/<slug>
  // as the logged-in account, and Kick handles all viewer-tracking internally.
  const channelSlug = S.channel.user?.username || S.channel.slug;
  if (!channelSlug) { notify('Could not resolve channel slug', 'error'); return; }

  const delayMs = Math.max(0, parseInt($('swDelay')?.value) || 800);

  // Account selection (same modes as Follow Bot)
  const accMode = document.querySelector('input[name="swAccMode"]:checked')?.value || 'all';
  let accs = [];
  if (accMode === 'selected') {
    accs = S.accounts.filter(a => a.sel && a.token);
    if (!accs.length) { notify('No accounts selected — check boxes in the Accounts table', 'error'); return; }
  } else if (accMode === 'count') {
    const n = Math.max(1, parseInt($('swCount')?.value) || 50);
    accs = S.accounts.filter(a => a.token).slice(0, n);
    if (!accs.length) { notify('No accounts with tokens found', 'error'); return; }
  } else {
    accs = S.accounts.filter(a => a.token);
    if (!accs.length) { notify('No accounts with tokens found', 'error'); return; }
  }

  SW.running = true; SW.stop = false;
  SW.total = accs.length; SW.alive = 0; SW.fail = 0; SW.done = 0;
  SW.byAcc.clear();
  SW.channelSlug = channelSlug;
  SW.baselineCount = null;
  SW.kickCount    = null;
  SW.peakDelta    = 0;

  if ($('swStartBtn')) $('swStartBtn').style.display = 'none';
  if ($('swStopBtn'))  $('swStopBtn').style.display  = '';
  if ($('swBadge'))    $('swBadge').textContent     = 'RUNNING';
  swUpdateProgress();
  swBindEvents();

  swLog(`Stream Watcher — ${accs.length} accounts → @${channelSlug}`, 'info');
  swLog(`Mode: hidden Electron BrowserWindow per account · auto-refresh every 5min`, 'dim');

  // ── Capture baseline viewer count BEFORE opening watchers ─────────────────
  swLog('Fetching baseline viewer count from Kick API…', 'dim');
  SW.baselineCount = await swFetchKickViewerCount(channelSlug);
  if (SW.baselineCount == null) {
    swLog('⚠ Could not read baseline (channel offline or API blocked). Verification will be best-effort.', 'yel');
  } else {
    swLog(`Baseline: Kick reports ${SW.baselineCount} viewers on @${channelSlug}`, 'info');
  }
  swUpdateProgress();

  for (let i = 0; i < accs.length; i++) {
    if (SW.stop) break;
    const a = accs[i];
    SW.byAcc.set(String(a.id), { username: a.username || '?', status: 'opening' });

    try {
      const openRes = await window.electronAPI.vwOpen({
        accountId:    String(a.id),
        username:     a.username || '?',
        bearerToken:  a.token,
        channelSlug,
      });
      if (!openRes || !openRes.ok) {
        SW.fail++;
        swLog(`✗ ${a.username}: vw-open failed${openRes?.error ? ' — ' + openRes.error : ''}`, 'red');
      } else {
        swLog(`→ ${a.username}: viewer window opened`, 'dim');
      }
    } catch (e) {
      SW.fail++;
      swLog(`✗ ${a.username}: ${e.message || e}`, 'red');
    }
    swUpdateProgress();
    if (delayMs > 0 && i < accs.length - 1 && !SW.stop) await sleep(delayMs);
  }

  if ($('swBadge')) $('swBadge').textContent = SW.stop ? 'Stopped' : 'WATCHING';
  swLog(`All ${accs.length} accounts dispatched · ${SW.alive} live viewers so far`, 'green');

  // ── Start the Kick-side verification poll ─────────────────────────────────
  // Polls every 20s. The first reading lands ~25s after dispatch (giving
  // Kick time to register us). If delta matches our watcher count → Kick
  // is counting them. If delta stays 0 → we're being silently dropped.
  if (SW.verifyTimer) clearInterval(SW.verifyTimer);
  const doVerify = async () => {
    if (!SW.running) return;
    const cur = await swFetchKickViewerCount(SW.channelSlug);
    SW.kickCount = cur;
    if (cur == null) {
      swLog('Verify: API returned null (channel may have gone offline)', 'yel');
      swUpdateProgress();
      return;
    }
    let line;
    if (SW.baselineCount == null) {
      line = `Kick now reports ${cur} viewers on @${SW.channelSlug} (no baseline)`;
    } else {
      const delta = cur - SW.baselineCount;
      if (delta > SW.peakDelta) SW.peakDelta = delta;
      const sign = delta >= 0 ? '+' : '';
      const ourAlive = SW.alive;
      let verdict;
      if (delta >= Math.max(1, Math.floor(ourAlive * 0.6))) {
        verdict = `✓ COUNTED — Kick credited ~${delta} extra viewers (we have ${ourAlive} watchers active)`;
      } else if (delta > 0) {
        verdict = `~ PARTIAL — delta ${sign}${delta} but we have ${ourAlive} watchers. Some may not be counted.`;
      } else if (delta === 0) {
        verdict = `✗ NOT counted — Kick reports same ${cur} viewers as baseline (peak observed: +${SW.peakDelta})`;
      } else {
        verdict = `viewer count DROPPED (organic viewers leaving). delta ${sign}${delta}, peak +${SW.peakDelta}`;
      }
      line = `Kick: ${cur} viewers (baseline ${SW.baselineCount}, delta ${sign}${delta}) — ${verdict}`;
    }
    swLog(line, (SW.baselineCount != null && cur >= SW.baselineCount + Math.max(1, Math.floor(SW.alive * 0.6))) ? 'green' : 'dim');
    swUpdateProgress();
  };
  // First check after 25s, then every 20s
  setTimeout(doVerify, 25000);
  SW.verifyTimer = setInterval(doVerify, 20000);
}

async function streamWatcherStop() {
  if (!SW.running && SW.alive === 0) { notify('Not running', 'info'); return; }
  SW.stop = true;
  if ($('swBadge')) $('swBadge').textContent = 'Stopping…';
  if (SW.verifyTimer) { clearInterval(SW.verifyTimer); SW.verifyTimer = null; }
  try { await window.electronAPI?.vwCloseAll?.(); } catch (_) {}
  SW.running = false;
  SW.alive = 0;
  if ($('swStartBtn')) $('swStartBtn').style.display = '';
  if ($('swStopBtn'))  $('swStopBtn').style.display  = 'none';
  if ($('swBadge'))    $('swBadge').textContent     = 'Idle';
  swUpdateProgress();
  if (SW.baselineCount != null) {
    swLog(`Session summary — peak delta over baseline: +${SW.peakDelta} viewers (we ran ${SW.total} watchers)`, 'info');
  }
  swLog('All viewer windows closed.', 'yel');
}

function accLogin(id) {
  const a=S.accounts.find(a=>a.id===id);
  if(!a){notify('Account not found','error');return;}
  if(!a.token){notify('No token','error');return;}
  if(!window.electronAPI?.tokenLogin){notify('Electron API unavailable','error');return;}
  const rawCh=($('channelInput')&&$('channelInput').value.trim())||'';
  const targetUrl=rawCh?((/^https?:\/\//i.test(rawCh)?rawCh:'https://kick.com/'+rawCh.replace(/^\/+/,''))):('https://kick.com');
  notify('Opening Kick for '+(a.username||'account')+'…','info');
  try {
    window.electronAPI.tokenLogin({token:String(a.token||''),accountId:String(a.id||''),username:String(a.username||''),email:String(a.email||''),uid:String(a.uid||''),avatar:String(a.avatar||''),targetUrl});
  } catch(err){notify('Login error: '+err.message,'error');}
}

function accExportCSV() {
  const rows=[['Username','Email','UID','Status','Jobs Sent','Added']].concat(S.accounts.map(a=>{
    const job=S.jobs.get(a.id);
    return[a.username||'',a.email||'',a.uid||'',a.status||'',job?job.count:0,fmtDate(a.added)];
  }));
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download=`flt_accounts_${Date.now()}.csv`; a.click();
  notify(`Exported ${S.accounts.length} accounts`,'success');
}


/* ══ START ALL AUTO-SEND ══ */
async function startAllAutoSend() {
  if(!S.chanId){notify('Connect to a channel first','error');return;}
  const valid=S.accounts.filter(a=>a.status==='valid'&&a.token);
  if(!valid.length){notify('No valid accounts','error');return;}
  const mn=Math.max(1,parseInt($('randMin')?.value)||10);
  const mx=Math.max(mn,parseInt($('randMax')?.value)||25);
  let started=0;
  for(const a of valid){
    if(S.jobs.has(a.id)) continue;
    const draft=S.drafts[a.id]||{};
    const msg=draft.message||''; const maxCount=parseInt(draft.maxCount)||0;
    if(!msg) continue;
    const job={message:msg,randMin:mn,randMax:mx,maxCount,count:0,timer:null};

    const run=async()=>{
      if(!S.jobs.has(a.id)) return;
      if(maxCount>0&&job.count>=maxCount){stopJob(a.id);notify(`Done: ${a.username} — ${job.count} sent`,'success');return;}
      if(!S.chanId){stopJob(a.id);return;}
      const res=await KickAPI.sendRetry(a.token,S.chanId,job.message);
      if(res.ok){job.count++;if($('modalSend')?.classList.contains('open'))renderJobs();}
      else{stopJob(a.id);notify(`[${a.username}] failed (${res.status})`,'error');return;}
      if(S.jobs.has(a.id)) job.timer=setTimeout(run,randInt(job.randMin,job.randMax)*1000);
    };

    // Register job FIRST then schedule
    S.jobs.set(a.id,job);
    // Stagger start: each account waits a different initial delay
    job.timer=setTimeout(run,started*randInt(500,2000)+randInt(500,1500));
    started++;
  }
  renderAccounts();
  $('stopAllAccBtn').style.display=''; $('startAllBtn').style.display='none';
  if(started===0) notify('No accounts have a draft message — open SEND on each account first','warning');
  else notify(`Started ${started} account(s) — random ${mn}–${mx}s interval`,'success');
}

function stopAllAutoSend() {
  S.jobs.forEach(j=>{clearTimeout(j.timer);clearInterval(j.timer);}); 
  const count=S.jobs.size; S.jobs.clear();
  renderAccounts();
  $('stopAllAccBtn').style.display='none'; $('startAllBtn').style.display='';
  notify(`Stopped ${count} auto-send job(s)`,'info');
}

// Start only selected (checked) accounts — unselected ones are untouched.
async function startSelectedAutoSend() {
  if (!S.chanId) { notify('Connect to a channel first', 'error'); return; }

  const selected = S.accounts.filter(a => a.sel && a.status === 'valid' && a.token);
  if (!selected.length) {
    notify('No valid accounts selected — check some rows first', 'warning');
    return;
  }

  const mn = Math.max(1, parseInt($('randMin')?.value) || 10);
  const mx = Math.max(mn, parseInt($('randMax')?.value) || 25);
  let started = 0;

  for (const a of selected) {
    if (S.jobs.has(a.id)) continue; // already running — skip silently
    const draft    = S.drafts[a.id] || {};
    const msg      = draft.message  || '';
    const maxCount = parseInt(draft.maxCount) || 0;
    if (!msg) continue; // no draft — skip

    const job = { message: msg, randMin: mn, randMax: mx, maxCount, count: 0, timer: null };

    const run = async () => {
      if (!S.jobs.has(a.id)) return;
      if (maxCount > 0 && job.count >= maxCount) {
        stopJob(a.id);
        notify(`Done: ${a.username} — ${job.count} sent`, 'success');
        return;
      }
      if (!S.chanId) { stopJob(a.id); return; }
      const res = await KickAPI.sendRetry(a.token, S.chanId, job.message);
      if (res.ok) {
        job.count++;
        if ($('modalSend')?.classList.contains('open')) renderJobs();
      } else {
        stopJob(a.id);
        notify(`[${a.username}] failed (${res.status})`, 'error');
        return;
      }
      if (S.jobs.has(a.id)) job.timer = setTimeout(run, randInt(job.randMin, job.randMax) * 1000);
    };

    S.jobs.set(a.id, job);
    job.timer = setTimeout(run, started * randInt(500, 2000) + randInt(500, 1500));
    started++;
  }

  renderAccounts();
  if (started === 0) notify('Selected accounts have no draft messages — open SEND on each first', 'warning');
  else notify(`Started ${started} selected account${started !== 1 ? 's' : ''} — ${mn}\u2013${mx}s interval`, 'success');
}

/* ══ SEND MODAL ══ */
function openSendModal(id) {
  S.sendAccId=id;
  const a=S.accounts.find(a=>a.id===id); if(!a) return;
  $('sendTitle').textContent='SEND — '+(a.username||'').toUpperCase();
  const draft=S.drafts[id]||{}; const job=S.jobs.get(id);
  const src=job||draft;
  const chInp=$('sendChannelInput'); const chSt=$('sendChannelStatus');
  const spamCh=$('channelInput')?.value.trim();
  if(chInp){
    if(S.chanId&&spamCh){chInp.value=spamCh;chSt.textContent='✓ Connected: '+(S.channel?.user?.username||spamCh)+' (ID: '+S.chanId+')';chSt.style.color='var(--green)';}
    else if(draft.channel){chInp.value=draft.channel;chSt.textContent='Last: '+draft.channel+' — click CONNECT';chSt.style.color='var(--dim)';}
    else{chInp.value=spamCh||'';chSt.textContent=S.chanId?'':'Enter channel above and click CONNECT';chSt.style.color='var(--dim)';}
  }
  $('sendMsgInput').value=(src.message||'').replace(/^!slot\s+/i,'');
  $('sendChr').textContent=(src.message||'').length+'/150';
  $('sendInterval').value=src.interval||'13';
  $('sendMaxCount').value=src.maxCount||'0';
  // Restore per-account random interval — separate from the global "Start All" range
  if($('sendRandMin')) $('sendRandMin').value=src.randMin||'10';
  if($('sendRandMax')) $('sendRandMax').value=src.randMax||'25';
  const autoOn=!!job||!!draft.autoOn;
  $('autoSendChk').checked=autoOn;
  $('autoSendPanel').style.display=autoOn?'block':'none';
  $('autoSendLbl').textContent=autoOn?'AutoSend: ON':'AutoSend: OFF';
  $('sendMainBtn').innerHTML=autoOn?(job?'<i class="bi bi-activity"></i> Running…':'<i class="bi bi-play-fill"></i> Start AutoSend'):'<i class="bi bi-send"></i> Send';
  if(job)$('sendMainBtn').disabled=true; else $('sendMainBtn').disabled=false;
  renderPresets(); renderJobs(); openModal('modalSend');
  setTimeout(()=>$('sendMsgInput')?.focus(),120);
}

function closeSendModal(){saveDraft(S.sendAccId);closeModal('modalSend');}

async function sendPickSlot(){
  const btn = $('sendSlotBtn');
  if(btn) btn.disabled = true;
  const platform = document.querySelector('input[name="slotPlatform"]:checked')?.value || 'rainbet_shuffle';
  // Temporarily reset format pool just for this single pick
  const savedPool = [..._slotFormatPool];
  _slotFormatPool = SLOT_MSG_FORMATS.map((_,i)=>i);
  const games = await slotFetchGames(platform);
  const filtered = slotFilterGames(games, platform);
  if(!filtered.length){ notify('No matching slots found','error'); _slotFormatPool = savedPool; if(btn) btn.disabled=false; return; }
  const pick = _rnd(filtered);
  const msg  = slotBuildMsg(pick);
  const inp  = $('sendMsgInput');
  if(inp){ inp.value = msg; $('sendChr').textContent = msg.length+'/150'; saveDraft(S.sendAccId); }
  notify('Slot picked: '+(pick.name||''),'success');
  _slotFormatPool = savedPool;
  if(btn) btn.disabled = false;
}
function saveDraft(id){
  _invalidateSearchCache(); // draft changed — search cache stale
  if(!id) return;
  S.drafts[id]={message:$('sendMsgInput')?.value||'',interval:$('sendInterval')?.value||'13',randMin:$('sendRandMin')?.value||'10',randMax:$('sendRandMax')?.value||'25',maxCount:$('sendMaxCount')?.value||'0',autoOn:$('autoSendChk')?.checked||false,channel:$('sendChannelInput')?.value||''};
  Store.save();
}

function toggleAutoSend(){
  const on=$('autoSendChk').checked; const job=S.jobs.get(S.sendAccId);
  $('autoSendPanel').style.display=on?'block':'none';
  $('autoSendLbl').textContent=on?'AutoSend: ON':'AutoSend: OFF';
  $('sendMainBtn').innerHTML=on?(job?'<i class="bi bi-activity"></i> Running…':'<i class="bi bi-play-fill"></i> Start AutoSend'):'<i class="bi bi-send"></i> Send';
  $('sendMainBtn').disabled=on&&!!job;
  if(on) renderJobs(); saveDraft(S.sendAccId);
}

function doSendOrStart(){if($('autoSendChk').checked)startAutoSend();else sendSingleMsg();}

async function connectSendChannel(){
  const raw=$('sendChannelInput')?.value.trim(); const st=$('sendChannelStatus');
  if(!raw){if(st){st.textContent='Enter a channel name first';st.style.color='var(--red)';}return;}
  const slug=raw.replace(/^https?:\/\/(www\.)?kick\.com\//i,'').replace(/\/.*$/,'').trim();
  if(!slug){if(st){st.textContent='Invalid channel';st.style.color='var(--red)';}return;}
  if(st){st.textContent='Connecting…';st.style.color='var(--yel)';}
  const btn=$('sendConnectBtn'); if(btn){btn.disabled=true;btn.textContent='…';}
  try{
    const d=await KickAPI.getChannel(slug);
    S.channel=d; S.chanId=d.chatroom.id;
    const chInp=$('channelInput'); if(chInp) chInp.value='https://kick.com/'+slug;
    const chSt=$('channelStatus'); if(chSt){chSt.textContent=`● Connected: ${d.user.username}  (ID: ${S.chanId})`;chSt.className='status-line on';}
    if(st){st.textContent='✓ Connected: '+d.user.username+' (ID: '+S.chanId+')';st.style.color='var(--green)';}
    saveDraft(S.sendAccId); notify('Connected to '+d.user.username,'success');
  }catch(e){if(st){st.textContent='✗ '+e.message;st.style.color='var(--red)';}notify('Channel not found: '+e.message,'error');}
  finally{if(btn){btn.disabled=false;btn.innerHTML='<i class="bi bi-plug"></i> CONNECT';}}
}

async function sendSingleMsg(){
  const a=S.accounts.find(a=>a.id===S.sendAccId);
  if(!a?.token){notify('No token','error');return;}
  const msg=$('sendMsgInput').value.trim();
  if(!msg){notify('Enter a message','error');return;}
  if(!S.chanId){
    const raw=$('sendChannelInput')?.value.trim();
    if(raw){await connectSendChannel();if(!S.chanId)return;}
    else{const st=$('sendChannelStatus');if(st){st.textContent='✗ Enter a channel and click CONNECT';st.style.color='var(--red)';}notify('No channel connected','error');return;}
  }
  saveDraft(S.sendAccId);
  const btn=$('sendMainBtn'); if(btn){btn.disabled=true;btn.innerHTML='<i class="bi bi-hourglass-split"></i> Sending…';}
  const res=await KickAPI.sendRetry(a.token,S.chanId,msg);
  if(btn){btn.disabled=false;btn.innerHTML='<i class="bi bi-send"></i> Send';}
  if(res.ok){notify(`Sent as ${a.username}!`,'success');}
  else{
    const reason=res.status===401?' — token expired':res.status===403?' — forbidden/banned':res.status===422?' — rejected':res.status===429?' — rate limited':'';
    notify(`Failed (${res.status})${reason}`,'error');
    if(res.status===401||res.status===403){a.status='invalid';const t=S.tokens.find(t=>t.token===a.token);if(t)t.status='banned';Store.save();RenderQueue.schedule('accounts', renderAccounts);renderTokens();}
  }
}

function startAutoSend(){
  const a=S.accounts.find(a=>a.id===S.sendAccId);
  if(!a?.token){notify('No token','error');return;}
  const msg=$('sendMsgInput').value.trim();
  const interval=parseInt($('sendInterval').value)||13;
  const maxCount=parseInt($('sendMaxCount').value)||0;
  if(!msg){notify('Enter a message','error');return;}
  if(!S.chanId){
    const raw=$('sendChannelInput')?.value.trim();
    if(raw){connectSendChannel().then(()=>{if(S.chanId)startAutoSend();});return;}
    const st=$('sendChannelStatus'); if(st){st.textContent='✗ Enter a channel and click CONNECT';st.style.color='var(--red)';}
    notify('No channel connected','error'); return;
  }
  saveDraft(S.sendAccId); stopJob(S.sendAccId);
  // Use the per-account min/max from the send modal — NOT the global "Start All" range
  const mn=Math.max(1,parseInt($('sendRandMin')?.value)||interval);
  const mx=Math.max(mn,parseInt($('sendRandMax')?.value)||interval);
  const job={message:msg,randMin:mn,randMax:mx,maxCount,count:0,timer:null};

  const run=async()=>{
    if(!S.jobs.has(a.id)) return;
    if(maxCount>0&&job.count>=maxCount){stopJob(a.id);notify(`Done: ${job.count} sent`,'success');return;}
    if(!S.chanId){stopJob(a.id);return;}
    const res=await KickAPI.sendRetry(a.token,S.chanId,job.message);
    if(res.ok){job.count++;notify(`[${a.username}] #${job.count}`,'success');}
    else{stopJob(a.id);notify(`[${a.username}] failed (${res.status})`,'error');return;}
    if($('modalSend')?.classList.contains('open')) renderJobs();
    if(S.jobs.has(a.id)) job.timer=setTimeout(run,randInt(job.randMin,job.randMax)*1000);
  };

  // Register FIRST, then schedule
  S.jobs.set(a.id,job);
  job.timer=setTimeout(run,randInt(mn,mx)*1000);
  notify(`AutoSend started: ${a.username} — ${mn}–${mx}s random`,'success');
  closeSendModal(); renderAccounts();
}

function stopJob(id){
  const job=S.jobs.get(id);
  if(job){clearTimeout(job.timer);clearInterval(job.timer);S.jobs.delete(id);const a=S.accounts.find(a=>a.id===id);notify(`Stopped ${a?.username||id} — ${job.count} sent`,'info');}
  renderAccounts();
  if(id===S.sendAccId){$('sendMainBtn').disabled=false;$('sendMainBtn').innerHTML=$('autoSendChk').checked?'<i class="bi bi-play-fill"></i> Start AutoSend':'<i class="bi bi-send"></i> Send';}
  if($('modalSend')?.classList.contains('open')) renderJobs();
}

function stopThisJob(){if(S.sendAccId) stopJob(S.sendAccId);}
function stopAllJobs(){
  S.jobs.forEach(j=>{clearTimeout(j.timer);clearInterval(j.timer);}); S.jobs.clear();
  notify('All jobs stopped','info'); renderAccounts();
  $('stopAllAccBtn').style.display='none'; $('startAllBtn').style.display='';
  if($('modalSend')?.classList.contains('open')) renderJobs();
}

function renderJobs(){
  const c=$('jobsList'); if(!c) return;
  if(!S.jobs.size){c.innerHTML='<span class="dim" style="font-size:11px">No active AutoSends</span>';return;}
  let html='';
  S.jobs.forEach((job,id)=>{
    const a=S.accounts.find(a=>a.id===id);
    html+=`<div class="job-row">
      <div>
        <span style="color:var(--green);font-weight:600">${esc(a?.username||id)}</span>
        <span class="dim" style="margin-left:8px;font-size:10px">every ${job.randMin}–${job.randMax}s</span>
        <span class="dim" style="margin-left:8px;font-size:10px">sent: <b style="color:var(--text)">${job.count}</b></span>
        <div class="dim" style="font-size:10px;margin-top:2px">${esc(job.message.slice(0,45))}${job.message.length>45?'…':''}</div>
      </div>
      <button class="btn danger xs job-stop" data-jid="${esc(id)}"><i class="bi bi-stop-fill"></i></button>
    </div>`;
  });
  c.innerHTML=html;
  c.querySelectorAll('.job-stop').forEach(btn=>btn.addEventListener('click',()=>stopJob(btn.dataset.jid)));
}

/* ══ PRESETS ══ */
function savePreset(){
  const msg=$('sendMsgInput').value.trim(); if(!msg){notify('Type a message first','error');return;}
  const rawName=$('presetName').value.trim();
  const name=rawName||(msg.length>32?msg.slice(0,32)+'…':msg);
  S.presets=S.presets.filter(p=>p.name!==name);
  S.presets.push({name,msg}); Store.save(); $('presetName').value=''; renderPresets(); notify('Preset saved!','success');
}

function toggleImportPanel(){
  const panel=$('importPresetsPanel'); const isOpen=panel.style.display!=='none';
  panel.style.display=isOpen?'none':'block';
  if(!isOpen){$('importPresetsText').value='';$('importPresetCount').textContent='0 lines';setTimeout(()=>$('importPresetsText').focus(),80);}
}

function doImportPresets(){
  const raw=$('importPresetsText').value; const lines=raw.split('\n').map(l=>l.trim()).filter(Boolean);
  if(!lines.length){notify('No lines to import','error');return;}
  let added=0;
  lines.forEach(line=>{const name=line.length>40?line.slice(0,40)+'…':line;if(S.presets.some(p=>p.msg===line))return;S.presets.push({name,msg:line});added++;});
  Store.save(); renderPresets(); $('importPresetsPanel').style.display='none'; $('importPresetsText').value='';
  notify(`Imported ${added} preset(s)!`,'success');
}

function clearAllPresets(){if(!S.presets.length)return;if(!confirm(`Delete all ${S.presets.length} presets?`))return;S.presets=[];Store.save();renderPresets();notify('Presets cleared','info');}

function renderPresets(){
  const c=$('presetList'); if(!c) return;
  if(!S.presets.length){c.innerHTML='<span class="dim" style="font-size:11px">No presets saved</span>';return;}
  c.innerHTML=S.presets.map(p=>`<span class="preset-tag" data-pname="${esc(p.name)}">${esc(p.name)}<button class="preset-del" data-pdel="${esc(p.name)}"><i class="bi bi-x-lg" style="font-size:9px;pointer-events:none"></i></button></span>`).join('');
  c.querySelectorAll('[data-pname]').forEach(el=>{
    el.addEventListener('click',e=>{
      if(e.target.dataset.pdel){S.presets=S.presets.filter(p=>p.name!==e.target.dataset.pdel);Store.save();renderPresets();return;}
      const p=S.presets.find(p=>p.name===el.dataset.pname);if(p){$('sendMsgInput').value=p.msg;$('sendChr').textContent=p.msg.length+'/150';saveDraft(S.sendAccId);}
    });
  });
}

/* ══ BULK MSG ══ */
/* ══ MESSAGE SYSTEM ════════════════════════════════════════════════ */

// --- State ---
const MS = {
  // Slot mode
  formats: [
    '{slot} {emoji}',
    '{slot} {emoji} {emoji}',
    '{emoji} {slot}',
    '{emoji} {slot} {emoji}',
  ],
  slotGenerated: [],
  customSel: new Set(),
  // Bulk mode
  bulkGenerated: [],
  bulkCustomSel: new Set(),
};

// ── Shared helpers ─────────────────────────────────────────────────

function msGetAccounts(namePrefix){
  // namePrefix = 'ms' (slots) or 'msBulk' (bulk)
  const mode = document.querySelector(`input[name="${namePrefix}AccMode"]:checked`)?.value || 'all';
  const all  = S.accounts;
  const sel  = namePrefix === 'ms' ? MS.customSel : MS.bulkCustomSel;
  if(mode === 'valid') return all.filter(a => a.token && a.status !== 'banned' && a.status !== 'invalid');
  if(mode === 'custom') return all.filter(a => sel.has(a.id));
  return all;
}

function msShuffle(arr){
  for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}
  return arr;
}

function msPickEmoji(){
  return SLOT_EMOTES[Math.floor(Math.random()*SLOT_EMOTES.length)];
}

function msUpdateAccBadge(){
  const accs = msGetAccounts('ms');
  const el = $('msAccBadge');
  if(el) el.textContent = accs.length + ' account' + (accs.length===1?'':'s');
}

function msBulkUpdateAccBadge(){
  const accs = msGetAccounts('msBulk');
  const el = $('msBulkAccBadge');
  if(el) el.textContent = accs.length + ' account' + (accs.length===1?'':'s');
}

function msRenderChecklist(wrapId, sel, countId, onchange){
  const wrap = $(wrapId);
  if(!wrap) return;
  const all = S.accounts;
  if(!all.length){ wrap.innerHTML = '<span style="font-size:10px;color:var(--dim)">No accounts yet</span>'; return; }
  wrap.innerHTML = all.map(a =>
    `<span class="ms-check-chip ${sel.has(a.id)?'selected':''}" data-aid="${esc(a.id)}" title="${esc(a.token?a.token.slice(0,14)+'…':'')}">
      ${esc(a.username || a.id.slice(0,8))}
    </span>`
  ).join('');
  wrap.querySelectorAll('.ms-check-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      const id = chip.dataset.aid;
      if(sel.has(id)) sel.delete(id); else sel.add(id);
      chip.classList.toggle('selected', sel.has(id));
      const cnt = $(countId);
      if(cnt) cnt.textContent = sel.size + ' selected';
      onchange();
    });
  });
}

function msWireAccMode(radioName, listId, checklistId, selSet, countId, badgeFn, checklistFn){
  document.querySelectorAll(`input[name="${radioName}"]`).forEach(r=>{
    r.addEventListener('change', ()=>{
      const wrap = $(listId);
      if(wrap) wrap.style.display = r.value==='custom' && r.checked ? 'block' : 'none';
      if(r.checked){ checklistFn(); badgeFn(); }
    });
  });
  $(listId.replace('List','SelAllBtn') || '_nx')?.addEventListener?.('click',()=>{ /* handled below */ });
}

// ── SLOT MODE ──────────────────────────────────────────────────────

function msUpdateSlotCount(){
  const raw = $('msSlotInput')?.value || '';
  const slots = [...new Set(raw.split('\n').map(x=>x.trim()).filter(x=>x.length>0))];
  const el = $('msSlotCount');
  if(el) el.textContent = slots.length + ' slot' + (slots.length===1?'':'s');
}

function msGetSlots(){
  const raw = $('msSlotInput')?.value || '';
  const slots = [...new Set(raw.split('\n').map(x=>x.trim()).filter(x=>x.length>0))];
  return slots.length ? slots : [''];
}

function msGetFormats(){
  return MS.formats.filter(f=>f.trim().length>0);
}

function msUpdateFmtCount(){
  const el = $('msFmtCount');
  if(el) el.textContent = MS.formats.length + ' format' + (MS.formats.length===1?'':'s');
}

function msRenderFormats(){
  const list = $('msFmtList');
  if(!list) return;
  list.innerHTML = MS.formats.map((f,i) =>
    `<div class="ms-fmt-row" data-fidx="${i}">
      <input value="${esc(f)}" data-fidx="${i}" class="ms-fmt-inp">
      <span class="ms-fmt-del" data-fidx="${i}" title="Remove">✕</span>
    </div>`
  ).join('');
  list.querySelectorAll('.ms-fmt-inp').forEach(inp=>{
    inp.addEventListener('input', e=>{ MS.formats[parseInt(e.target.dataset.fidx)]=e.target.value; msUpdateFmtCount(); });
  });
  list.querySelectorAll('.ms-fmt-del').forEach(btn=>{
    btn.addEventListener('click', e=>{ MS.formats.splice(parseInt(e.target.dataset.fidx),1); msRenderFormats(); msUpdateFmtCount(); });
  });
  msUpdateFmtCount();
}

// applyCasePreserveEmoji — applies case only to non-emoji segments.
// {emoji} placeholders are substituted LAST so case logic never touches them.
function applyCasePreserveEmoji(format, slot, index, caseMode) {
  // Step 1: replace text-only tags first (slot, index, random)
  let s = format
    .replaceAll('{slot}',   slot)
    .replaceAll('{index}',  index + 1)
    .replaceAll('{random}', Math.random().toString(36).slice(2, 6));

  // Step 2: split on {emoji} placeholder — apply case to text segments only
  const EMOJI_PH = '\x00EMOJI\x00';
  const parts = s.split('{emoji}');
  const cased = parts.map(p => applyCase(p, caseMode)).join(EMOJI_PH);

  // Step 3: substitute actual emoji characters (untouched by case)
  return cased
    .replaceAll(EMOJI_PH, () => msPickEmoji())
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function msApplySlotTags(format, slot, i, caseMode) {
  // Legacy path (no case) — used internally when caseMode not needed
  return applyCasePreserveEmoji(format, slot, i, caseMode || '');
}

function msSlotGenerate(){
  const accs = msGetAccounts('ms');
  if(!accs.length){ notify('No accounts in selection','error'); return; }
  let slots = msGetSlots();
  if(slots[0]==='') { notify('Fetch or enter at least one slot','error'); return; }
  let fmts = msGetFormats();
  if(!fmts.length){ notify('Add at least one format','error'); return; }
  if($('msShufSlot')?.checked) msShuffle(slots);
  if($('msShufFmt')?.checked)  msShuffle(fmts);

  const slotCase = $('msCaseMode')?.value || '';
  MS.slotGenerated = accs.map((acc, i) => {
    const slot = slots[i % slots.length];
    const fmt  = fmts[i % fmts.length];
    // applyCasePreserveEmoji handles both case + emoji substitution in correct order
    const msg  = applyCasePreserveEmoji(fmt, slot, i, slotCase);
    return { accId: acc.id, username: acc.username||acc.id.slice(0,8), message: msg };
  });

  msRenderOutput('msOutputList','msOutputWrap','msOutputEmpty','msTotalCount','msOutputMore', MS.slotGenerated);
  const btn=$('msApplyBtn'); if(btn) btn.disabled=false;
  const inf=$('msApplyInfo'); if(inf) inf.textContent=MS.slotGenerated.length+' message(s) ready — click Apply';
}

function msSlotApply(){
  if(!MS.slotGenerated.length){ notify('Generate first','error'); return; }
  MS.slotGenerated.forEach(r=>{
    S.drafts[r.accId] = Object.assign({}, S.drafts[r.accId]||{}, { message: appendGlobalTag(r.message) });
  });
  Store.save(); renderAccounts();
  notify(`Applied ${MS.slotGenerated.length} slot message(s) to accounts!`, 'success');
}

async function msFetchSlots(){
  const btn = $('msSlotFetchBtn');
  const status = $('slotPickerStatus');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="bi bi-hourglass-split"></i> Fetching…'; }
  if(status) status.textContent = '';
  const platform = document.querySelector('input[name="slotPlatform"]:checked')?.value || 'rainbet_shuffle';
  try {
    const games    = await slotFetchGames(platform);
    const filtered = slotFilterGames(games, platform);
    if(!filtered.length){ notify('No slots found','error'); return; }
    const names = [...new Set(filtered.map(g=>slotClean(g.name||g.title||'').replace(/\s{2,}/g,' ').trim()).filter(Boolean))];
    msShuffle(names);  // random order so each run is fresh
    const inp=$('msSlotInput');
    if(inp){ inp.value=names.join('\n'); msUpdateSlotCount(); }
    notify(names.length+' slots fetched!','success');
  } catch(e){ notify('Slot fetch error: '+e.message,'error'); }
  finally {
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="bi bi-cloud-download"></i> Fetch Slots'; }
  }
}

// ── BULK MODE ──────────────────────────────────────────────────────

function msBulkGetMessages(){
  const raw = $('msBulkMsgInput')?.value || '';
  return raw.split('\n').map(x=>x.trim()).filter(x=>x.length>0);
}

function msBulkUpdateMsgCount(){
  const msgs = msBulkGetMessages();
  const el = $('msBulkMsgCount');
  if(el) el.textContent = msgs.length + ' message' + (msgs.length===1?'':'s');
}

function msBulkGenerate(){
  const accs = msGetAccounts('msBulk');
  if(!accs.length){ notify('No accounts in selection','error'); return; }
  let msgs = msBulkGetMessages();
  if(!msgs.length){ notify('Enter at least one message','error'); return; }
  if($('msBulkShuf')?.checked) msShuffle(msgs);
  const bulkCase = $('msBulkCaseMode')?.value || '';

  MS.bulkGenerated = accs.map((acc, i) => ({
    accId:    acc.id,
    username: acc.username || acc.id.slice(0,8),
    message:  applyCaseBulk(msgs[i % msgs.length], bulkCase),
  }));

  msRenderOutput('msBulkOutputList','msBulkOutputWrap','msBulkOutputEmpty','msBulkTotalCount','msBulkOutputMore', MS.bulkGenerated);
  const btn=$('msBulkApplyBtn'); if(btn) btn.disabled=false;
  const inf=$('msBulkApplyInfo'); if(inf) inf.textContent=MS.bulkGenerated.length+' message(s) ready — click Apply';
}

function msBulkApply(){
  if(!MS.bulkGenerated.length){ notify('Generate first','error'); return; }
  MS.bulkGenerated.forEach(r=>{
    S.drafts[r.accId] = Object.assign({}, S.drafts[r.accId]||{}, { message: appendGlobalTag(r.message) });
  });
  Store.save(); renderAccounts();
  notify(`Applied ${MS.bulkGenerated.length} message(s) to accounts!`, 'success');
}

// ── Shared output render ───────────────────────────────────────────

function msRenderOutput(listId, wrapId, emptyId, badgeId, moreId, data){
  const list  = $(listId);
  const wrap  = $(wrapId);
  const empty = $(emptyId);
  const badge = $(badgeId);
  const more  = $(moreId);
  if(!list) return;
  const LIMIT = 20;
  list.innerHTML = data.slice(0,LIMIT).map(r =>
    `<div class="ms-output-row">
      <span class="ms-out-acc" title="${esc(r.username)}">${esc(r.username)}</span>
      <span class="ms-out-arrow">→</span>
      <span class="ms-out-msg">${esc(r.message)}</span>
    </div>`
  ).join('');
  if(more) more.textContent = data.length>LIMIT ? `+${data.length-LIMIT} more (all applied)` : '';
  if(wrap)  wrap.style.display  = 'block';
  if(empty) empty.style.display = 'none';
  if(badge) badge.textContent   = data.length + ' generated';
}

// ── Init ───────────────────────────────────────────────────────────

function initBulkMsg(){ /* replaced by initMsgSystem */ }

function mountCreatorInAutomation() {
  const panel = $('msPanelCreator');
  const host  = $('kacAutomationHost');
  if (!panel || !host) return;
  if (panel.parentElement !== host) host.appendChild(panel);
  panel.style.display = 'block';
  panel.classList.add('kac-automation-panel');
}

function initMsgSystem(){
  if(!$('msTabSlots')) return;
  mountCreatorInAutomation();

  // ── Tabs
  document.querySelectorAll('#msgSystemCard .ms-tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      document.querySelectorAll('#msgSystemCard .ms-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.mode;
      const slots   = $('msPanelSlots');
      const bulk    = $('msPanelBulk');
      if (slots)   slots.style.display   = mode==='slots'   ? 'block' : 'none';
      if (bulk)    bulk.style.display    = mode==='bulk'    ? 'block' : 'none';
    });
  });

  // ── SLOT mode wiring

  // Account source
  document.querySelectorAll('input[name="msAccMode"]').forEach(r=>{
    r.addEventListener('change', ()=>{
      const cl = $('msCustomList');
      if(cl) cl.style.display = r.value==='custom'&&r.checked ? 'block' : 'none';
      if(r.checked){ msRenderChecklist('msAccChecklist',MS.customSel,'msCustomCount',msUpdateAccBadge); msUpdateAccBadge(); }
    });
  });
  $('msSelectAllBtn')?.addEventListener('click',()=>{
    S.accounts.forEach(a=>MS.customSel.add(a.id));
    msRenderChecklist('msAccChecklist',MS.customSel,'msCustomCount',msUpdateAccBadge);
    const cnt=$('msCustomCount'); if(cnt) cnt.textContent=MS.customSel.size+' selected';
    msUpdateAccBadge();
  });
  $('msClearSelBtn')?.addEventListener('click',()=>{
    MS.customSel.clear();
    msRenderChecklist('msAccChecklist',MS.customSel,'msCustomCount',msUpdateAccBadge);
    const cnt=$('msCustomCount'); if(cnt) cnt.textContent='0 selected';
    msUpdateAccBadge();
  });
  msUpdateAccBadge();

  // Slots
  $('msSlotInput')?.addEventListener('input', msUpdateSlotCount);
  $('msSlotClearBtn')?.addEventListener('click',()=>{ $('msSlotInput').value=''; msUpdateSlotCount(); });
  $('msSlotFetchBtn')?.addEventListener('click', msFetchSlots);
  document.querySelectorAll('input[name="slotPlatform"]').forEach(r=>r.addEventListener('change', slotUpdateHint));
  slotUpdateHint();

  // Format builder
  msRenderFormats();
  $('msFmtAddBtn')?.addEventListener('click',()=>{
    const inp=$('msFmtNewInput'); if(!inp) return;
    const val=inp.value.trim(); if(!val){notify('Enter a format','error');return;}
    MS.formats.push(val); inp.value=''; msRenderFormats();
  });
  $('msFmtResetBtn')?.addEventListener('click',()=>{
    MS.formats=['{slot} {emoji}','{slot} {emoji} {emoji}','{emoji} {slot}','{emoji} {slot} {emoji}'];
    msRenderFormats();
  });

  // Generate + Apply (slots)
  $('msGenerateBtn')?.addEventListener('click', msSlotGenerate);
  $('msApplyBtn')?.addEventListener('click',    msSlotApply);

  // ── BULK mode wiring

  document.querySelectorAll('input[name="msBulkAccMode"]').forEach(r=>{
    r.addEventListener('change', ()=>{
      const cl=$('msBulkCustomList');
      if(cl) cl.style.display = r.value==='custom'&&r.checked ? 'block' : 'none';
      if(r.checked){ msRenderChecklist('msBulkChecklist',MS.bulkCustomSel,'msBulkCustomCount',msBulkUpdateAccBadge); msBulkUpdateAccBadge(); }
    });
  });
  $('msBulkSelAllBtn')?.addEventListener('click',()=>{
    S.accounts.forEach(a=>MS.bulkCustomSel.add(a.id));
    msRenderChecklist('msBulkChecklist',MS.bulkCustomSel,'msBulkCustomCount',msBulkUpdateAccBadge);
    const cnt=$('msBulkCustomCount'); if(cnt) cnt.textContent=MS.bulkCustomSel.size+' selected';
    msBulkUpdateAccBadge();
  });
  $('msBulkSelNoneBtn')?.addEventListener('click',()=>{
    MS.bulkCustomSel.clear();
    msRenderChecklist('msBulkChecklist',MS.bulkCustomSel,'msBulkCustomCount',msBulkUpdateAccBadge);
    const cnt=$('msBulkCustomCount'); if(cnt) cnt.textContent='0 selected';
    msBulkUpdateAccBadge();
  });
  msBulkUpdateAccBadge();

  $('msBulkMsgInput')?.addEventListener('input', msBulkUpdateMsgCount);
  $('msBulkClearBtn')?.addEventListener('click',()=>{ $('msBulkMsgInput').value=''; msBulkUpdateMsgCount(); });

  $('msBulkGenerateBtn')?.addEventListener('click', msBulkGenerate);
  $('msBulkApplyBtn')?.addEventListener('click',    msBulkApply);
}

// Legacy shims
function updateBulkPreview(){}
function applyBulkMessages(){ msBulkApply(); }
function getBulkLines(){ return msBulkGetMessages ? msBulkGetMessages() : []; }
function msGetMessages(){ return []; }


/* ══════════════════════════════════════════════════════════════════════════
   KICK ACCOUNT CREATOR — renderer logic
   Wires the new Tools panel to the main-process creator pipeline.
   ══════════════════════════════════════════════════════════════════════════ */
const KAC = {
  running:   false,
  total:     0,
  done:      0,
  created:   [],
  sessionId: null,  // current pending session (set when 'await' event arrives)
};

function kacFmtTime(ts) {
  const d = new Date(ts || Date.now());
  return String(d.getHours()).padStart(2,'0') + ':' +
         String(d.getMinutes()).padStart(2,'0') + ':' +
         String(d.getSeconds()).padStart(2,'0');
}

function kacPushLog(step, msg, type) {
  const log = $('kacLog');
  if (!log) return;
  const empty = log.querySelector('.kac-log-empty');
  if (empty) empty.remove();
  const row = document.createElement('div');
  row.className = 'kac-log-entry ' + (type || 'info');
  row.innerHTML =
    `<span class="kac-log-time">${kacFmtTime()}</span>` +
    `<span class="kac-log-step">${esc(step || '')}</span>` +
    `<span class="kac-log-msg">${esc(msg || '')}</span>`;
  log.appendChild(row);
  // trim
  while (log.children.length > 400) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function kacSetButtons(running) {
  KAC.running = running;
  const start = $('kacStartBtn');
  const stop  = $('kacStopBtn');
  if (start) start.disabled = running;
  if (stop)  stop.disabled  = !running;
  const badge = $('kacBadge');
  if (badge) {
    badge.textContent = running ? 'Running' : 'Idle';
    badge.style.color = running ? 'var(--green)' : '';
  }
}

function kacUpdateProgress() {
  const el = $('kacProgress');
  if (el) el.textContent = `${KAC.done} / ${KAC.total || 0}`;
}

function kacShowCurrent(creds) {
  const box  = $('kacCurrent');
  const e    = $('kacCurEmail');
  const u    = $('kacCurUser');
  const p    = $('kacCurPass');
  const b    = $('kacCurBday');
  if (!box) return;
  box.style.display = 'block';
  if (e) e.textContent = creds.email        || '—';
  if (u) u.textContent = creds.kickUsername || '—';
  if (p) p.textContent = creds.password     || '—';
  if (b) b.textContent = creds.birthday     || '—';
  // Hide any leftover code from a previous account
  const codeRow = $('kacCodeRow');
  if (codeRow) codeRow.style.display = 'none';
  const codeVal = $('kacCurCode');
  if (codeVal) codeVal.textContent = '—';
}

function kacShowCode(code) {
  const codeRow = $('kacCodeRow');
  const codeVal = $('kacCurCode');
  if (codeRow) codeRow.style.display = '';
  if (codeVal) codeVal.textContent = code || '—';
}

function kacShowFinish(sessionId) {
  KAC.sessionId = sessionId || null;
  const finish = $('kacFinish');
  if (finish) finish.style.display = 'block';
  const ti = $('kacTokenInput');
  if (ti) { ti.value = ''; ti.focus(); }
  const st = $('kacSaveStatus');
  if (st) st.textContent = '';
}

function kacHideFinish() {
  KAC.sessionId = null;
  const finish = $('kacFinish');
  if (finish) finish.style.display = 'none';
  const ti = $('kacTokenInput');
  if (ti) ti.value = '';
}

function kacCopyToClipboard(text) {
  if (!text) return;
  try {
    navigator.clipboard?.writeText(text).catch(() => {});
  } catch (_) {}
}

function kacAppendCreated(acc) {
  KAC.created.push(acc);
  const wrap = $('kacCreatedList');
  if (!wrap) return;
  const empty = wrap.querySelector('.kac-log-empty');
  if (empty) empty.remove();
  const idx = KAC.created.length;
  const row = document.createElement('div');
  row.className = 'kac-created-row';
  row.innerHTML =
    `<div class="kac-created-idx">${idx}</div>` +
    `<div class="kac-created-user" title="${esc(acc.username || '')}">${esc(acc.username || '—')}</div>` +
    `<div class="kac-created-email" title="${esc(acc.email || '')}">${esc(acc.email || '')}</div>` +
    `<button class="kac-created-copy" data-kac-copy="${esc(acc.email + ':' + acc.password + ':' + acc.token)}">COPY</button>`;
  wrap.appendChild(row);
  const cnt = $('kacCreatedCount');
  if (cnt) cnt.textContent = String(KAC.created.length);
}

async function kacAutoAddToAccounts(acc) {
  if (!$('kacAutoAdd')?.checked) return;
  // Reuse the existing direct-add path so the token is fetched + validated
  if (typeof quickAddTokenDirect === 'function') {
    try { await quickAddTokenDirect(acc.token); } catch (_) {}
    // Backfill email + password onto the row that quickAddTokenDirect created
    // — the Follow Bot's click-mode needs these to do real form logins.
    const row = S.accounts.find(a => a.token === acc.token);
    if (row) {
      if (!row.email    && acc.email)    row.email    = acc.email;
      if (!row.password && acc.password) row.password = acc.password;
      Store.save();
    }
    return;
  }
  // Fallback: insert directly into S.accounts
  if (!S.accounts.some(a => a.token === acc.token)) {
    const id = String(Date.now()) + '-' + Math.floor(Math.random() * 1000);
    S.accounts.push({
      id,
      username: acc.username,
      email:    acc.email,
      password: acc.password,
      token:    acc.token,
      status:   'valid',
      added:    Date.now(),
      sel:      false,
    });
    Store.save();
    if (typeof renderAccounts === 'function') renderAccounts();
  }
}

function kacInit() {
  mountCreatorInAutomation();
  if (!$('kacStartBtn')) return;

  // Start
  $('kacStartBtn').addEventListener('click', async () => {
    if (KAC.running) return;
    const count = Math.max(1, Math.min(50, parseInt($('kacCount')?.value, 10) || 1));
    const gap   = Math.max(0, Math.min(600, parseInt($('kacGap')?.value, 10) || 10));
    KAC.total = count;
    KAC.done  = 0;
    kacUpdateProgress();
    kacSetButtons(true);
    kacPushLog('start', `Batch of ${count} · gap ${gap}s · fresh profile`, 'info');
    const status = $('kacStatus');
    if (status) status.textContent = 'Running…';
    try {
      const res = await window.electronAPI.kickCreatorStart({
        count, gapMs: gap * 1000,
      });
      if (!res || !res.ok) {
        kacPushLog('error', (res && res.error) || 'Failed to start', 'err');
      }
    } catch (e) {
      kacPushLog('error', e.message || String(e), 'err');
    } finally {
      kacSetButtons(false);
      if (status) status.textContent = 'Idle.';
    }
  });

  // Stop
  $('kacStopBtn').addEventListener('click', async () => {
    if (!KAC.running) return;
    kacPushLog('stop', 'Stop requested…', 'warn');
    try { await window.electronAPI.kickCreatorStop(); } catch (_) {}
  });

  // Open file
  $('kacOpenFileBtn').addEventListener('click', async () => {
    try { await window.electronAPI.kickCreatorOpenFile(); } catch (_) {}
  });

  // Clear log
  $('kacClearLog').addEventListener('click', () => {
    const log = $('kacLog');
    if (log) log.innerHTML = '<div class="kac-log-empty">No activity yet — press Start Creating to begin.</div>';
  });

  // Copy buttons inside created list (delegated)
  $('kacCreatedList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kac-copy]');
    if (!btn) return;
    const v = btn.getAttribute('data-kac-copy') || '';
    if (typeof copyText === 'function') copyText(v);
    else navigator.clipboard?.writeText(v).catch(() => {});
    const orig = btn.textContent;
    btn.textContent = 'COPIED';
    setTimeout(() => { btn.textContent = orig; }, 900);
  });

  // Click-to-copy on each credential row + the verification code
  $('kacCurrent')?.addEventListener('click', (e) => {
    const el = e.target.closest('.copyable');
    if (!el) return;
    const v = (el.textContent || '').trim();
    if (!v || v === '—') return;
    kacCopyToClipboard(v);
    const orig = el.style.color;
    el.style.color = 'var(--green)';
    setTimeout(() => { el.style.color = orig; }, 700);
    if (typeof notify === 'function') notify('Copied', 'success');
  });

  // Snippet copy button inside the how-to
  $('kacSnippetCopy')?.addEventListener('click', () => {
    const code = $('kacSnippet')?.textContent || '';
    if (!code) return;
    kacCopyToClipboard(code);
    if (typeof notify === 'function') notify('Snippet copied — paste in Chrome console', 'success');
  });

  // Save token → main process validates + persists
  $('kacSaveTokenBtn')?.addEventListener('click', async () => {
    const token = ($('kacTokenInput')?.value || '').trim().replace(/^Bearer\s+/i, '');
    const st = $('kacSaveStatus');
    if (!token) {
      if (st) st.textContent = 'Paste a token first.';
      return;
    }
    if (token.length < 20) {
      if (st) st.textContent = 'Token looks too short — paste the full JWT.';
      return;
    }
    if (!KAC.sessionId) {
      if (st) st.textContent = 'No active session — press Start first.';
      return;
    }
    if (st) st.textContent = 'Validating with Kick…';
    try {
      const res = await window.electronAPI.kickCreatorSaveToken({
        sessionId: KAC.sessionId, token,
      });
      if (res && res.ok) {
        if (st) st.textContent = res.validated ? '✓ Validated & saved.' : 'Saved (couldn’t validate live).';
        kacHideFinish();
      } else {
        if (st) st.textContent = '✗ ' + ((res && res.error) || 'Save failed');
      }
    } catch (e) {
      if (st) st.textContent = '✗ ' + (e.message || String(e));
    }
  });

  // ── Auto-Fill form ─ types email/birthday/username/password into the
  //    currently focused window via OS-level Win32 SendKeys. Kasada can't
  //    detect this because the events come from the real input subsystem.
  $('kacAutofillBtn')?.addEventListener('click', async () => {
    if (!KAC.sessionId) {
      kacPushLog('autofill', 'No active session — press Start first.', 'warn');
      return;
    }
    const btn = $('kacAutofillBtn');
    const lbl = btn?.querySelector('.kac-af-label');
    const originalLabel = lbl?.textContent || 'Auto-Fill Form';
    if (btn) btn.disabled = true;

    // 3-2-1 countdown so the user can focus the email field in Chrome
    for (let n = 3; n >= 1; n--) {
      if (lbl) lbl.textContent = `Focus the email field in Chrome — typing in ${n}…`;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (lbl) lbl.textContent = 'Typing…';

    try {
      const res = await window.electronAPI.kickCreatorAutofill({ sessionId: KAC.sessionId });
      if (res && res.ok) {
        kacPushLog('autofill', 'Form auto-filled — click Sign Up in Chrome now.', 'ok');
      } else {
        kacPushLog('autofill', 'Auto-fill failed: ' + ((res && res.error) || 'unknown'), 'err');
      }
    } catch (e) {
      kacPushLog('autofill', 'Auto-fill error: ' + (e.message || e), 'err');
    } finally {
      if (btn) btn.disabled = false;
      if (lbl) lbl.textContent = originalLabel;
    }
  });

  // Auto-type the verification code into whatever input is focused
  $('kacAutofillCodeBtn')?.addEventListener('click', async () => {
    const code = ($('kacCurCode')?.textContent || '').trim();
    if (!code || code === '—') {
      kacPushLog('autofill', 'No code yet — wait for the email.', 'warn');
      return;
    }
    const btn = $('kacAutofillCodeBtn');
    if (btn) btn.disabled = true;
    // Brief countdown so user can focus the code field
    for (let n = 2; n >= 1; n--) {
      if (btn) btn.innerHTML = `<i class="bi bi-keyboard"></i> Typing in ${n}…`;
      await new Promise((r) => setTimeout(r, 1000));
    }
    try {
      const res = await window.electronAPI.kickCreatorAutofillCode({ code });
      if (res && res.ok) kacPushLog('autofill', 'Code auto-typed.', 'ok');
      else kacPushLog('autofill', 'Code type failed: ' + ((res && res.error) || ''), 'err');
    } catch (e) {
      kacPushLog('autofill', 'Code type error: ' + (e.message || e), 'err');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-keyboard"></i> Auto-type';
      }
    }
  });

  // Skip — burn current mailbox, runner immediately starts next account
  $('kacSkipBtn')?.addEventListener('click', async () => {
    if (!KAC.sessionId) {
      // No active session — fall back to a full stop
      try { await window.electronAPI.kickCreatorStop(); } catch (_) {}
      kacHideFinish();
      return;
    }
    try {
      await window.electronAPI.kickCreatorSkipSession({
        sessionId: KAC.sessionId,
        reason:    'Skipped by user',
      });
      kacPushLog('skip', '↷ Skipped this account — generating new mailbox…', 'warn');
    } catch (e) {
      kacPushLog('skip', 'Skip failed: ' + (e.message || e), 'err');
    }
    kacHideFinish();
  });

  // ── Subscribe to main-process events ────────────────────────────────────
  window.electronAPI?.onKickCreatorProgress?.((d) => {
    if (!d) return;
    const status = $('kacStatus');
    switch (d.step) {
      case 'cycle':
        if (typeof d.index === 'number' && typeof d.total === 'number') {
          KAC.total = d.total;
        }
        kacPushLog('cycle', d.msg, 'info');
        if (status) status.textContent = d.msg;
        break;
      case 'mail':    kacPushLog('mail',    d.msg, 'info'); break;
      case 'creds':
        kacPushLog('creds', 'Generated random credentials', 'info');
        if (d.creds) kacShowCurrent(d.creds);
        break;
      case 'browser': kacPushLog('browser', d.msg, 'info'); break;
      case 'fill':   kacPushLog('fill',   d.msg, 'info'); break;
      case 'submitted': kacPushLog('submit', d.msg, 'info'); break;
      case 'skip':   kacPushLog('skip',   d.msg, 'warn'); break;
      case 'kick-api': kacPushLog('kick-api', d.msg, 'err'); break;
      case 'ext':    kacPushLog('ext',    d.msg, d.type || 'info'); break;
      case 'code':
        kacPushLog('code', d.msg, 'ok');
        if (d.code) kacShowCode(d.code);
        break;
      case 'await':
        // Automation handles the token now — but keep manual fallback available
        kacPushLog('await', d.msg, 'info');
        if (d.sessionId) kacShowFinish(d.sessionId);
        if (status) status.textContent = 'Awaiting…';
        break;
      case 'verify': kacPushLog('verify', d.msg, 'info'); break;
      case 'ok':
        kacPushLog('ok', d.msg, 'ok');
        KAC.done++;
        kacUpdateProgress();
        break;
      case 'warn':   kacPushLog('warn', d.msg, 'warn'); break;
      case 'error':  kacPushLog('error', d.msg, 'err'); break;
      case 'done':
        kacPushLog('done', d.msg, d.type === 'ok' ? 'ok' : (d.type || 'info'));
        if (status) status.textContent = d.msg;
        kacSetButtons(false);
        break;
      case 'log':
        kacPushLog('log', d.msg, d.type || 'info');
        break;
      default:
        kacPushLog(d.step || 'info', d.msg || '', d.type || 'info');
    }
  });

  window.electronAPI?.onKickCreatorAccount?.(async (acc) => {
    if (!acc) return;
    kacAppendCreated(acc);
    kacPushLog('saved', `Saved ${acc.email}:${(acc.password||'').slice(0,3)}***:${(acc.token||'').slice(0,6)}…`, 'ok');
    try { await kacAutoAddToAccounts(acc); } catch (_) {}
    if (typeof notify === 'function') notify(`Created: ${acc.username}`, 'success');
  });
}


/* ══ SETTINGS ══ */
function saveSettings(){
  S.cfg.concurrent=parseInt($('setConcurrent').value)||5;
  S.cfg.delay=parseInt($('setDelay').value)||100;
  S.cfg.autoRotate=$('setAutoRotate').checked;
  S.cfg.notifs=$('setNotifs').checked;
  S.cfg.sound=$('setSound').checked;
  Store.save(); notify('Settings saved!','success');
}
function applySettings(){
  $('setConcurrent').value=S.cfg.concurrent;
  $('setDelay').value=S.cfg.delay;
  $('setAutoRotate').checked=S.cfg.autoRotate;
  $('setNotifs').checked=S.cfg.notifs;
  $('setSound').checked=S.cfg.sound;
}

/* ══ EMOTES ══ */
function getEmoteId(c){const m=c.match(/\[emote:(\d+):/);return m?m[1]:null;}
function renderEmotes(){
  const bar=$('emoteBar'); if(!bar) return;
  bar.innerHTML=EMOTES.map(([l,c])=>{
    const id=getEmoteId(c);
    const imgUrl=id?`https://files.kick.com/emotes/${id}/fullsize`:'';
    const inner=imgUrl?`<img src="${esc(imgUrl)}" alt="${esc(l)}" title="${esc(l)}" class="emote-img" onerror="this.style.display='none';this.nextSibling.style.display=''"><span class="emote-fallback" style="display:none">${esc(l)}</span>`:esc(l);
    return`<button class="emote-btn" data-emote="${esc(c)}" title="${esc(l)}">${inner}</button>`;
  }).join('');
  bar.addEventListener('click',e=>{const btn=e.target.closest('.emote-btn');if(!btn)return;const mi=$('msgInput');mi.value=mi.value.trim()?mi.value+' '+btn.dataset.emote:btn.dataset.emote;mi.focus();$('msgLen').textContent=mi.value.length+'/500';});
}

/* ══ CLOCK ══ */
function tickClock(){const n=new Date(),el=$('clock');if(!el)return;el.textContent=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0')+':'+String(n.getSeconds()).padStart(2,'0');}

/* ══ ACTIVE MODE ══ */
function amPickAccount() {
  const selId = $('amAccount')?.value || 'random';

  // Cycle through checked accounts from the accounts table
  if (selId === 'selected') {
    const pool = S.accounts.filter(a => a.sel && a.status === 'valid' && a.token);
    if (!pool.length) {
      const valid = S.accounts.filter(a => a.status === 'valid' && a.token);
      return valid.length ? valid[0] : null;
    }
    if (!S.am.accQueue.length) S.am.accQueue = [...pool];
    return S.am.accQueue.shift();
  }

  const valid = S.accounts.filter(a => a.status === 'valid' && a.token);
  if (!valid.length) return null;
  if (selId !== 'random') {
    const found = valid.find(a => a.id === selId);
    if (found) return found;
  }
  return valid[Math.floor(Math.random() * valid.length)];
}

/* ── Status display (called every second by the countdown interval) ─────── */
function amUpdateStatus() {
  if ($('amSent'))   $('amSent').textContent   = S.am.sent;
  if ($('amFailed')) $('amFailed').textContent = S.am.failed;
  if ($('amBanned')) $('amBanned').textContent = S.am.banned;

  const nextEl = $('amNext');
  if (nextEl) {
    if (S.am.running && S.am.nextAt > 0) {
      const rem = Math.max(0, Math.ceil((S.am.nextAt - Date.now()) / 1000));
      nextEl.textContent = rem > 0 ? rem + 's' : '…';
    } else {
      nextEl.textContent = S.am.running ? '…' : '—';
    }
  }

  // Queue progress indicator
  const qEl = $('amQueueLeft');
  if (qEl) qEl.textContent = `${AM_AI.generated} generated`;

  // Render send history log (last 50, newest first)
  amRenderHistory();
}

/* ── Send history log ───────────────────────────────────────────────────── */
function amAddHistory(entry) {
  // entry: { ts, account, msg, ok, status }
  S.am.history.unshift(entry);
  if (S.am.history.length > 50) S.am.history.length = 50;
}

function amRenderHistory() {
  const el = $('amHistory'); if (!el) return;
  if (!S.am.history.length) {
    el.innerHTML = '<span style="color:var(--dim);font-size:10px">No sends yet</span>';
    return;
  }
  el.innerHTML = S.am.history.slice(0, 20).map(h => {
    const ts   = new Date(h.ts).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const col  = h.ok ? 'var(--ac,#3dffa0)' : 'var(--red,#ff3a6e)';
    const icon = h.ok ? '✓' : '✗';
    const acc  = esc(h.account || '—');
    const msg  = esc((h.msg || '').length > 38 ? h.msg.slice(0, 38) + '…' : h.msg);
    return `<div style="display:flex;gap:6px;align-items:baseline;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
      <span style="color:var(--dim);font-size:9px;flex-shrink:0">${ts}</span>
      <span style="color:${col};font-size:10px;flex-shrink:0">${icon}</span>
      <span style="color:var(--dim);font-size:9.5px;flex-shrink:0">${acc}</span>
      <span style="font-size:10px;color:var(--text,#ebebff)">${msg}</span>
    </div>`;
  }).join('');
}

// ── AM_AI Kick emote pool — full list available to the AI bot ──────────────
const AM_AI_EMOTES = [
  '[emote:4147873:YouTried]','[emote:37239:WeSmart]','[emote:37240:WeirdChamp]',
  '[emote:4147884:vibePls]','[emote:3645849:TRUEING]','[emote:37237:TriKool]',
  '[emote:4147896:TOXIC]','[emote:37236:ThisIsFine]','[emote:4148085:SUSSY]',
  '[emote:4055801:SIT]','[emote:5380973:shoulderRoll]','[emote:28633:SenpaiWhoo]',
  '[emote:4147869:SaltT]','[emote:4148081:Sadge]','[emote:37248:ratJAM]',
  '[emote:37234:Prayge]','[emote:4147888:ppJedi]','[emote:39277:politeCat]',
  '[emote:37230:POLICE]','[emote:37233:PogU]','[emote:39275:peepoShy]',
  '[emote:37246:peepoRiot]','[emote:37245:peepoDJ]','[emote:37232:PeepoClap]',
  '[emote:4147892:PatrickBoo]','[emote:4147814:OuttaPocket]','[emote:37229:OOOO]',
  '[emote:4055796:ODAJAM]','[emote:28631:NugTime]','[emote:37228:NODDERS]',
  '[emote:39273:MuteD]','[emote:5273241:MOGGED]','[emote:37244:modCheck]',
  '[emote:4148128:mericCat]','[emote:37227:LULW]','[emote:5273243:lowCortisol]',
  '[emote:39272:LetMeIn]','[emote:39261:kkHuh]','[emote:5339426:kickDrops]',
  '[emote:37226:KEKW]','[emote:37225:KEKLEO]','[emote:4147902:KEKBye]',
  '[emote:305040:Kappa]','[emote:4148074:HYPERCLAP]','[emote:5273247:highCortisol]',
  '[emote:4148076:HaHaa]','[emote:4055795:GnomeDisco]','[emote:37224:GIGACHAD]',
  '[emote:37243:gachiGASM]','[emote:39402:Flowie]','[emote:3645852:FLASHBANG]',
  '[emote:37221:EZ]','[emote:39265:EDMusiC]','[emote:3645850:EDDIE]',
  '[emote:4147914:duckPls]','[emote:37220:DonoWall]','[emote:39260:DanceDance]',
  '[emote:4147909:coffinPls]','[emote:37218:Clap]','[emote:4147900:catKISS]',
  '[emote:4148144:catblobDance]','[emote:39254:CaptFail]','[emote:37217:Bwop]',
  '[emote:39251:beeBobble]','[emote:4147910:BBoomer]','[emote:37215:AYAYA]',
  '[emote:5380971:AURAPULSE]','[emote:3753119:asmonSmash]',
];

// Tracks last emote used — prevents back-to-back identical emotes
let _amAiLastEmote = '';

/** Pick a random emote, never repeating the last one used */
function amAiPickEmote() {
  const pool = AM_AI_EMOTES.filter(e => e !== _amAiLastEmote);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  _amAiLastEmote = pick;
  return pick;
}

/* ══════════════════════════════════════════════════════════════════════════
   AM_AI — Active Mode AI Engine v6 (Stream Hearing removed)
   Human-feel chat simulation · lightweight · imperfect by design
   ══════════════════════════════════════════════════════════════════════════ */

/* ─── Constants ─────────────────────────────────────────────────────────── */

// LIGHTWEIGHT spam filter — only catches truly worthless input
// Does NOT block: lol, gg, ok, nice, fr, etc. — those are real chat
const AM_AI_SPAM_RE = [
  /^(.)\1{4,}$/,           // aaaaa  ?????  — same char 5+ times
  /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\s]+$/u,  // pure emoji string
  /^[^\w\s]{1,3}$/,        // pure symbols: ^^  <>  !!!
];

// Swap pairs for per-account variation
const AM_AI_SWAPS = [
  ['bro','man'],   ['man','bro'],   ['ngl','tbh'],  ['tbh','ngl'],
  ['lol','lmao'],  ['lmao','lol'],  ['yeah','yea'], ['yea','yeah'],
  ['fr','for real'],['for real','fr'],['idk','no idea'],
  ['nah','no way'],['lowkey','kinda'],['wtf','what'],
  ['honestly','ngl'],['actually','tbh'],
];

// Fillers used to differentiate multi-account sends
const AM_AI_FILLERS = [
  'fr','ngl','tbh','lowkey','honestly',
  'for real','bro','man','deadass','no cap',
];

const AM_AI_URL = 'https://api.deepseek.com/v1/chat/completions';

/* ─── Stream Context — title + category + streamer name pulled from the
 *    connected channel. Refreshed every 5 min so category changes are picked
 *    up. Keeps the AI grounded in WHAT is actually being streamed, not just
 *    what chat happens to be saying right now. ─────────────────────────── */
const AM_STREAM = {
  streamer:    '',     // channel display name
  title:       '',     // current livestream title
  category:    '',     // current category (e.g. "Grand Theft Auto V")
  subCategory: '',     // optional sub-category
  isLive:      false,
  refreshedAt: 0,
};

async function amRefreshStreamContext(force) {
  if (!S.channel) return;
  const now = Date.now();
  if (!force && AM_STREAM.refreshedAt && now - AM_STREAM.refreshedAt < 5 * 60 * 1000) return;
  AM_STREAM.refreshedAt = now;

  const slug = S.channel.user?.username || S.channel.slug;
  if (!slug) return;
  try {
    // Re-fetch the channel — S.channel is cached from connect, livestream
    // info goes stale within minutes. Hit the API directly each refresh.
    const r = await fetch('https://kick.com/api/v2/channels/' + encodeURIComponent(slug), {
      headers: { accept: 'application/json' }, credentials: 'omit', cache: 'no-store',
    });
    if (!r.ok) return;
    const j = await r.json();
    const ls = j?.livestream;
    AM_STREAM.streamer    = j?.user?.username || slug;
    AM_STREAM.title       = ls?.session_title || '';
    AM_STREAM.category    = ls?.categories?.[0]?.name || j?.recent_categories?.[0]?.name || '';
    AM_STREAM.subCategory = ls?.categories?.[0]?.parent_category?.name || '';
    AM_STREAM.isLive      = !!ls;
  } catch (_) {}
}

function amStreamContextString() {
  if (!AM_STREAM.streamer) return '';
  const parts = [];
  parts.push('Streamer: ' + AM_STREAM.streamer);
  if (AM_STREAM.category)    parts.push('Category: ' + AM_STREAM.category + (AM_STREAM.subCategory ? ' (' + AM_STREAM.subCategory + ')' : ''));
  if (AM_STREAM.title)       parts.push('Stream title: ' + AM_STREAM.title);
  if (!AM_STREAM.isLive)     parts.push('(channel is OFFLINE)');
  return parts.join('\n');
}

/* ─── Per-account personality — assigns a distinct chat persona to each
 *    bot account so the chat doesn't sound like 50 clones of the same AI.
 *    Personality is sticky: stored on the account object, set once on
 *    first use, persisted with the account.  ──────────────────────────── */
const AM_PERSONALITIES = [
  { id: 'chill',     traits: 'casual, lowercase, says fr / ngl / lowkey / no cap, rarely uses punctuation, short reactions' },
  { id: 'hype',      traits: 'high energy, EXCITED about everything, frequent !! and CAPS bursts, hype moments get pog or gigachad' },
  { id: 'sarcastic', traits: 'dry wit, deadpan, mildly sarcastic, often disagrees lightly, never hyped' },
  { id: 'thinker',   traits: 'curious, asks short follow-up questions, makes observations, slightly more thoughtful replies' },
  { id: 'gen-z',     traits: 'gen z slang heavy (bussin, real, fr fr, mid, slay, no shot, deadass), short bursts, abbreviations' },
  { id: 'emote-fan', traits: 'leans on emote reactions, short text with 1 emote, uses LULW / PogU / KEKW based on mood' },
  { id: 'lurker',    traits: 'rarely talks, when they do its 1-3 words max, kind of zoned out, simple reactions like w / l / yeah / nah' },
  { id: 'fan',       traits: 'admires the streamer, friendly tone, occasionally compliments without being sycophantic' },
];

function amGetAccountPersonality(account) {
  if (!account) return AM_PERSONALITIES[0];
  if (account.aiPersonality) {
    const found = AM_PERSONALITIES.find(p => p.id === account.aiPersonality);
    if (found) return found;
  }
  // Deterministic assignment based on username so the same account always
  // gets the same personality across sessions (until persisted on first send).
  const seed = (account.username || account.id || 'x').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const p = AM_PERSONALITIES[seed % AM_PERSONALITIES.length];
  account.aiPersonality = p.id;
  return p;
}

/* ─── State ──────────────────────────────────────────────────────────────── */
const AM_AI = {
  apiKey:      '',
  contextSize: 15,

  thinking:    false,
  errors:      0,
  generated:   0,
  silenced:    0,

  // Topic
  lastTopic:       '',
  topicCandidate:  '',
  topicHits:       0,
  topicMsgCounter: 0,
  TOPIC_EVERY:     5,

  // Timing
  lastSentAt: 0,

  // Activity window (msgs in last 30 s)
  activityWindow: [],
  recentActivity: 0,

  // Smoothing: last 8 respond decisions (bool)
  respondHistory: [],

  // Message buffer  { username, content, ts }
  buffer: [],

  // Anti-repeat: last 12 sent messages (rolling window)
  lastMessages: [],

  // Blacklist: strip these words/phrases before sending
  // Covers: cross-platform mentions, filler hype, bot-like phrases
  blacklist: [
    // platform names (not relevant to current stream)
    'twitch', 'youtube', 'tiktok', 'facebook', 'discord',
    // generic filler phrases that sound bot-like
    'amazing', 'incredible', 'unbelievable', 'awesome sauce',
    // forced hype triggers
    'lets gooo', 'lesgooo', 'letsgooo',
    // context-breaking phrases
    'follow me', 'check out my', 'sub to', 'hit the bell',
    'click the link', 'use code', 'promo code',
  ],

  /* ── Prompt ── */
  PROMPT: `You are a real human inside a live chat room

CORE RULES
Never act like an AI
Never explain yourself
Keep replies short 1 sentence max 2
Stay strictly on the current topic
Write like a normal internet user casual imperfect if needed

CHAT AWARENESS
Read the latest messages carefully
Match the tone funny toxic serious hype
Match the speed of the chat
If chat is fast short quick reactions
If chat is slow slightly more engaging replies

ACTIVITY LOGIC
Do NOT reply to every message
Prefer replying when someone asks a question
Prefer replying when something interesting or emotional happens
Prefer replying when people are reacting to something hype drama win loss
Ignore spam or low value messages

HUMAN BEHAVIOR
Sometimes agree sometimes disagree
Sometimes react emotionally lol wtf nah fr etc
Occasionally ask a short follow-up question
Do not sound perfect or structured

VARIATION
Avoid repeating phrases or patterns
Change wording naturally every time
Use different tones occasionally dry funny sarcastic chill

REALISM BOOST
Sometimes send very short reactions 1 to 3 words
Sometimes be slightly more expressive
Do not always try to be smart
Blend in dont dominate the chat

EMOTE LOGIC
use emotes ONLY when emotion is strong and fitting
most messages must contain no emotes
if unsure do not use emote
hype or win moment [emote:37233:PogU] or [emote:37224:GIGACHAD]
something funny [emote:37227:LULW] or [emote:37226:KEKW]
confused [emote:37240:WeirdChamp]
sad or unlucky [emote:4148081:Sadge]
never pair an emote with text describing the same thing

DECISION MAKING
Prioritize replying when a question is asked
Prioritize replying when multiple users react to the same topic
Prioritize replying when something emotional or surprising happens
Lower priority when messages are repetitive
Lower priority when messages are too short or meaningless
If nothing interesting is happening stay silent or give a very short reaction
Do not force replies just to stay active

CONSISTENCY
Stay aligned with the current topic
Do not suddenly change subject
Build on what others are saying

FLOW AWARENESS
Treat the chat as an ongoing conversation not isolated messages
Remember what was said recently and build on it naturally
Refer indirectly to previous points when relevant
Do not repeat the same idea again unless adding something new

SUBTLE PRESENCE
Do not always try to stand out
Sometimes blend in with short reactions
Sometimes add a slightly more meaningful message when timing is right

INTERACTION AWARENESS
Pay attention to who is talking
Occasionally respond to the same person if they continue the topic
If multiple users are interacting treat it like a group conversation
Do not always reply randomly sometimes follow a mini back and forth

SOCIAL BEHAVIOR
Sometimes acknowledge another user directly by name if available
Sometimes react to ongoing exchanges between others
Do not dominate conversations participate naturally

CONVERSATION FLOW
If a topic is ongoing stay within it
If a new topic starts adapt naturally without forcing transition

EVENT AWARENESS
Not all stream content is worth reacting to
Focus on moments like wins losses or big changes
Focus on emotional reactions hype anger surprise
Focus on jokes or unexpected moments
Focus on anything the chat would naturally react to
Ignore neutral or filler speech
React only when something stands out
If nothing important is happening stay silent or give a very short reaction
If silence has gone on too long send a low energy short reaction just to maintain presence

OUTPUT RULES
Only output the message
No explanations
No formatting
No quotes
No prefixes

STREAM YOU ARE WATCHING
{stream}

YOUR PERSONA
You are a chatter with this style: {persona}
Lock into this style. Other chatters in this chat have different styles - keep yours distinct.
Do not announce or describe your style. Just write in it.

CHAT CONTEXT (last messages, oldest first)
{context}

CURRENT TOPIC
{topic}

Reply like a real participant in this chat, in your persona, about what is actually happening on stream`,
};

/* ─── Buffer ─────────────────────────────────────────────────────────────── */

function amAiPushMsg(username, content) {
  const now = Date.now();

  // Activity window: msgs in last 30 s
  AM_AI.activityWindow = AM_AI.activityWindow.filter(t => now - t < 30000);
  AM_AI.activityWindow.push(now);
  AM_AI.recentActivity = AM_AI.activityWindow.length;

  // Only deduplicate exact same user + exact same content back-to-back
  const last = AM_AI.buffer[AM_AI.buffer.length - 1];
  if (last && last.username === username && last.content === content) return;

  AM_AI.buffer.push({ username, content, ts: now });
  while (AM_AI.buffer.length > Math.max(3, AM_AI.contextSize)) AM_AI.buffer.shift();

  AM_AI.topicMsgCounter++;

  const el = $('amAiContextCount');
  if (el) el.textContent = AM_AI.buffer.length;
  amAiRenderBufferFeed();
}

function amAiContextString() {
  if (!AM_AI.buffer.length) return 'no recent messages';
  return AM_AI.buffer.map(m => m.username + ': ' + m.content).join('\n');
}

/* ─── Spam filter (lightweight) ─────────────────────────────────────────── */

// Returns true ONLY for content that is genuinely worthless to the AI
function amAiIsSpam(content) {
  const c = content.trim();
  if (!c || c.length === 0) return true;
  // Single character
  if (c.length === 1) return true;
  return AM_AI_SPAM_RE.some(r => r.test(c));
}

// Buffer is junk only if ALL recent messages are spam (not 70% — too aggressive)
function amAiBufferIsJunk() {
  if (!AM_AI.buffer.length) return true;
  const recent = AM_AI.buffer.slice(-4);
  return recent.every(m => amAiIsSpam(m.content));
}

/* ─── Topic detection ────────────────────────────────────────────────────── */

async function amAiTopicDetect() {
  // Use cached topic unless enough new messages came in
  if (AM_AI.topicMsgCounter < AM_AI.TOPIC_EVERY && AM_AI.lastTopic) {
    return AM_AI.lastTopic;
  }
  if (AM_AI.buffer.length < 2) return AM_AI.lastTopic || 'the stream';

  AM_AI.topicMsgCounter = 0;

  let detected = '';
  try {
    const resp = await fetch(AM_AI_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AM_AI.apiKey },
      body: JSON.stringify({
        model:       'deepseek-chat',
        max_tokens:  12,
        temperature: 0.1,
        stream:      false,
        messages: [
          { role: 'system', content: 'Identify the main topic of this chat in 3-5 words. Reply with ONLY the topic, nothing else.' },
          { role: 'user',   content: amAiContextString() },
        ],
      }),
    });
    if (resp.ok) {
      const j = await resp.json();
      detected = (j.choices?.[0]?.message?.content || '')
        .trim().toLowerCase()
        .replace(/^["'\s]+|["'\s]+$/g, '')
        .split('\n')[0]
        .slice(0, 40);
    }
  } catch(_) {}

  if (!detected) return AM_AI.lastTopic || 'the stream';

  // Stability gate: 2 consistent detections required
  if (detected === AM_AI.topicCandidate) {
    AM_AI.topicHits++;
    if (AM_AI.topicHits >= 2) {
      AM_AI.lastTopic      = detected;
      AM_AI.topicCandidate = '';
      AM_AI.topicHits      = 0;
      // Show "topic · category — title" so the user can see what the AI sees
      const el = $('amAiTopic');
      if (el) {
        const bits = [AM_AI.lastTopic];
        if (AM_STREAM.category) bits.push(AM_STREAM.category);
        if (AM_STREAM.title)    bits.push('"' + AM_STREAM.title.slice(0, 40) + (AM_STREAM.title.length > 40 ? '…' : '') + '"');
        el.textContent = bits.join(' · ');
      }
    }
  } else {
    AM_AI.topicCandidate = detected;
    AM_AI.topicHits      = 1;
  }

  return AM_AI.lastTopic || detected;
}

/* ─── Sanitiser ──────────────────────────────────────────────────────────── */

function amAiSanitise(text) {
  // Preserve [emote:ID:name] tags — extract them first, sanitise the rest, reinsert
  const emoteRe = /(\[emote:\d+:[^\]]+\])/g;
  const parts    = text.split(emoteRe);

  const cleaned = parts.map((part, i) => {
    // Odd indices are captured emote tags — keep verbatim
    if (i % 2 === 1) return part;
    // Even indices are plain text — sanitise normally
    return part
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
      .replace(/[\u{2600}-\u{26FF}]/gu,   '')
      .replace(/[\u{2700}-\u{27BF}]/gu,   '')
      .replace(/[,\.!\?\u201C\u201D"£$%^&*()\-_+=\[\]{}<>|;:'@#~\/`\\]/g, '')
      .toLowerCase();
  });

  return cleaned.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/* ─── Message variation ──────────────────────────────────────────────────── */

function amAiVaryMsg(base, seed) {
  // Pick strategy randomly using seed, not deterministically
  const r = (seed * 1103515245 + 12345) & 0x7fffffff; // LCG for seed diversity
  const strategies = [
    // word swap
    () => {
      for (let i = 0; i < AM_AI_SWAPS.length; i++) {
        const [f, t] = AM_AI_SWAPS[(r + i) % AM_AI_SWAPS.length];
        const re = new RegExp('\\b' + f + '\\b', 'i');
        if (re.test(base)) return base.replace(re, t);
      }
      return null;
    },
    // prepend filler
    () => AM_AI_FILLERS[r % AM_AI_FILLERS.length] + ' ' + base,
    // append filler
    () => base + ' ' + AM_AI_FILLERS[(r + 4) % AM_AI_FILLERS.length],
    // trim to first N words
    () => {
      const w = base.split(' ');
      return w.length > 3 ? w.slice(0, Math.max(2, Math.ceil(w.length * 0.6))).join(' ') : null;
    },
    // drop first word
    () => {
      const w = base.split(' ');
      return w.length > 2 ? w.slice(1).join(' ') : null;
    },
  ];

  // Try strategies in shuffled order
  const order = [0, 1, 2, 3, 4].sort(() => Math.sin(r) - 0.5);
  for (const idx of order) {
    const result = strategies[idx]();
    if (result && result.trim() !== base.trim() && result.trim().length > 1) {
      return amAiSanitise(result);
    }
  }
  return amAiSanitise(AM_AI_FILLERS[r % AM_AI_FILLERS.length] + ' ' + base);
}

/* ─── Respond gate ───────────────────────────────────────────────────────── */

function amAiShouldRespond() {
  // ── Hard rejects ──────────────────────────────────────────────────────
  if (!AM_AI.buffer.length) return false;
  if (amAiBufferIsJunk())   return false;

  // ── Activity-based base probability (human-realistic: 5%–30%) ────────
  // Real viewers do NOT react to every message — they respond to a small
  // fraction of what flows past. High-activity chats get ignored more.
  const act = AM_AI.recentActivity;  // msgs in last 30s
  let prob;
  if      (act === 0)  prob = 0.08;  // dead chat — very rare ghost ping
  else if (act < 3)    prob = 0.25;  // slow chat — moderate engagement
  else if (act < 7)    prob = 0.18;  // normal pace — selective
  else if (act < 15)   prob = 0.12;  // busy — mostly lurk
  else if (act < 30)   prob = 0.07;  // fast — barely chime in
  else                 prob = 0.05;  // flood — stay quiet almost always

  // ── Recency: skip if last gen was too recent (redundant with cooldown) ─
  const msSinceLast = Date.now() - AM_AI.lastSentAt;
  if (msSinceLast < 6000) return false;  // never fire faster than 6s

  // ── Hysteresis: spoke 2+ times in a row → pull back hard ─────────────
  const hist = AM_AI.respondHistory;
  if (hist.length >= 2 && hist.slice(-2).every(Boolean)) prob *= 0.40;

  // ── Re-engagement nudge: silent 6+ times → slight push ───────────────
  if (hist.length >= 6 && !hist.slice(-6).some(Boolean)) prob = Math.min(prob * 1.8, 0.28);

  // ── Rare imperfection (4%): completely random fire or silence ─────────
  // Models the "nothing interesting but I said something anyway" human moment.
  if (Math.random() < 0.04) {
    const rnd = Math.random() < 0.40;  // 40% random speak, 60% random silence
    hist.push(rnd);
    if (hist.length > 10) hist.shift();
    if (!rnd) AM_AI.silenced++;
    return rnd;
  }

  const decision = Math.random() < prob;
  hist.push(decision);
  if (hist.length > 10) hist.shift();
  if (!decision) AM_AI.silenced++;
  return decision;
}

/* ─── Core generation ────────────────────────────────────────────────────── */

// ── Global AI call cooldown: 8–14s random between successful generations ──────
// Prevents spam-triggering even if amDoSend() is called rapidly.
// TURBO MODE: bypasses cooldown + debounce — raw speed, no humanisation delay.
let _amAiLastCallAt = 0;
const AM_AI_COOLDOWN_MIN = 8000;
const AM_AI_COOLDOWN_MAX = 14000;
const AM_AI_TURBO_COOLDOWN = 800; // turbo: minimum 0.8s between calls

// ── Debounce: cancel pending AI trigger if a new chat message arrives quickly ─
let _amAiDebounceTimer = null;
const AM_AI_DEBOUNCE_MS = 1200;  // wait 1.2s of "silence" after last chat msg

/** Schedule an AI generation with debounce — skipped entirely in turbo mode.
 *  Pass the sending account so its personality drives the prompt. */
function amAiScheduleGenerate(resolve, account) {
  if (S.am.turbo) {
    amAiGenerate(account).then(resolve);
    return;
  }
  clearTimeout(_amAiDebounceTimer);
  _amAiDebounceTimer = setTimeout(async () => {
    const result = await amAiGenerate(account);
    resolve(result);
  }, AM_AI_DEBOUNCE_MS);
}

async function amAiGenerate(account) {
  // ── Hard mutex: only ONE call at a time, ever ────────────────────────────
  if (AM_AI.thinking) return null;

  // ── Global cooldown: turbo uses 0.8s floor; normal uses 8–14s ───────────
  const now = Date.now();
  const cooldown = S.am.turbo
    ? AM_AI_TURBO_COOLDOWN
    : AM_AI_COOLDOWN_MIN + Math.random() * (AM_AI_COOLDOWN_MAX - AM_AI_COOLDOWN_MIN);
  if (now - _amAiLastCallAt < cooldown) return null;

  if (!AM_AI.apiKey) {
    notify('Active Mode: set DeepSeek API key', 'error');
    return null;
  }

  if (!amAiShouldRespond()) return null;

  // ── Acquire mutex ────────────────────────────────────────────────────────
  AM_AI.thinking = true;
  _amAiLastCallAt = now;

  const badge = $('amAiBadge');
  if (badge) { badge.textContent = 'thinking…'; badge.style.color = '#f59e0b'; }

  try {
    // Fire-and-forget refresh of stream context (title + category). The first
    // call after connect populates it; subsequent calls only re-fetch every
    // 5 min. We don't await in the hot path — uses the cached values if the
    // refresh is still in flight.
    amRefreshStreamContext().catch(() => {});

    const [topic, context] = await Promise.all([
      amAiTopicDetect(),
      Promise.resolve(amAiContextString()),
    ]);

    const persona = amGetAccountPersonality(account);
    const streamCtx = amStreamContextString() || '(stream details unavailable)';

    const sysPrompt = AM_AI.PROMPT
      .replace('{topic}',   topic     || 'the stream')
      .replace('{context}', context   || 'no recent messages')
      .replace('{stream}',  streamCtx)
      .replace('{persona}', persona.traits);

    // Turbo: shorter tokens + higher temp = faster API latency + punchier output
    const isTurbo = !!S.am.turbo;
    const resp = await fetch(AM_AI_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AM_AI.apiKey },
      body: JSON.stringify({
        model:       'deepseek-chat',
        max_tokens:  isTurbo ? 18 : 30,       // turbo: shorter = faster response
        temperature: isTurbo ? 1.25 : 1.08,   // turbo: more spontaneous
        top_p:       isTurbo ? 0.85 : 0.92,
        frequency_penalty: 0.6,
        presence_penalty:  0.4,
        stream:      false,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user',   content: isTurbo ? 'quick reaction now' : 'write your message now' },
        ],
      }),
    });

    if (!resp.ok) {
      // ── Silent fail: log but do NOT retry or crash ───────────────────────
      const errText = await resp.text().catch(() => String(resp.status));
      console.warn('[AM_AI] API error ' + resp.status + ':', errText.slice(0, 80));
      AM_AI.errors++;
      amAiUpdateStats();
      if (badge) { badge.textContent = 'skip'; badge.style.color = 'var(--dim)'; }
      setTimeout(() => { if (badge) { badge.textContent = 'active'; badge.style.color = 'var(--ac,#3dffa0)'; } }, 2000);
      return null;  // silent skip — no retry, no notify spam
    }

    const json  = await resp.json();
    let   reply = (json.choices?.[0]?.message?.content || '').trim();
    if (!reply) return null;  // silent skip on empty

    reply = amAiSanitise(reply);
    if (!reply || reply.length < 2) return null;

    // Soft cap: 8 words max — take first 8 if longer
    const words = reply.split(' ');
    if (words.length > 8) reply = words.slice(0, 8).join(' ');

    // ── Blacklist filter — strip platform names and bot-like phrases ────
    reply = amApplyBlacklist(reply);
    if (!reply || reply.length < 2) return null;

    // ── Anti-repeat — vary if too similar to a recent send ──────────────
    if (amIsRepeat(reply)) {
      reply = amVaryMessage(reply, AM_AI.generated);
      reply = amApplyBlacklist(reply); // re-clean after variation
      if (!reply || reply.length < 2) return null;
    }

    // Emote injection — 25% chance (slightly reduced for realism), 1 max
    if (Math.random() < 0.25 && AM_AI_EMOTES.length) {
      reply = reply + ' ' + amAiPickEmote();
    }

    AM_AI.generated++;
    AM_AI.lastSentAt = Date.now();

    if (badge) { badge.textContent = 'sent'; badge.style.color = 'var(--ac,#3dffa0)'; }
    const lastEl = $('amAiLastMsg');
    if (lastEl) lastEl.textContent = reply.length > 38 ? reply.slice(0, 38) + '\u2026' : reply;
    amAiUpdateStats();
    setTimeout(() => { if (badge) { badge.textContent = 'active'; badge.style.color = 'var(--ac,#3dffa0)'; } }, 3000);

    return reply;

  } catch(e) {
    // ── Fail-safe: silent fail, skip cycle, no retry ─────────────────────
    console.warn('[AM_AI] generate error (skipping cycle):', e.message);
    AM_AI.errors++;
    amAiUpdateStats();
    if (badge) { badge.textContent = 'skip'; badge.style.color = 'var(--dim)'; }
    setTimeout(() => { if (badge) { badge.textContent = 'active'; badge.style.color = 'var(--ac,#3dffa0)'; } }, 2000);
    return null;  // never crash, never retry
  } finally {
    // ── Always release mutex ─────────────────────────────────────────────
    AM_AI.thinking = false;
  }
}

/* ─── UI helpers ─────────────────────────────────────────────────────────── */

function amAiUpdateStats() {
  const g = $('amAiGenCount'), s = $('amAiSilCount'), e = $('amAiErrCount');
  if (g) g.textContent = AM_AI.generated;
  if (s) s.textContent = AM_AI.silenced;
  if (e) e.textContent = AM_AI.errors;
}

function amAiRenderBufferFeed() {
  const feed = $('amAiBufferFeed');
  if (!feed) return;
  if (!AM_AI.buffer.length) {
    feed.innerHTML = '<span style="color:var(--dim);font-size:10px">Waiting for chat…</span>';
    return;
  }
  feed.innerHTML = AM_AI.buffer.slice(-6).map(m => {
    // Render [emote:ID:name] as inline kick images in the buffer feed
    const rendered = esc(m.content).replace(
      /\[emote:(\d+):([^\]]+)\]/g,
      (_, id, name) =>
        `<img src="https://files.kick.com/emotes/${id}/fullsize" ` +
        `alt="${name}" title="${name}" ` +
        `style="height:16px;width:auto;vertical-align:middle;display:inline-block" ` +
        `onerror="this.outerHTML=this.title">`
    );
    return `<div style="font-size:10px;line-height:1.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">` +
      `<span style="color:var(--ac,#3dffa0);font-weight:600">${esc(m.username)}</span>` +
      `<span style="color:var(--dim)">: </span>` +
      `<span style="color:var(--text)">${rendered}</span></div>`;
  }).join('');
}

/* ─── Init ───────────────────────────────────────────────────────────────── */

function amAiInit() {
  AM_AI.apiKey = localStorage.getItem('am_ai_key') || '';
  if ($('amAiApiKey') && AM_AI.apiKey) $('amAiApiKey').value = AM_AI.apiKey;

  $('amAiApiKey')?.addEventListener('change', () => {
    const v = ($('amAiApiKey')?.value || '').trim();
    AM_AI.apiKey = v;
    if (v) localStorage.setItem('am_ai_key', v);
  });

  $('amAiContextSize')?.addEventListener('input', () => {
    AM_AI.contextSize = Math.max(3, parseInt($('amAiContextSize')?.value) || 15);
  });

  $('amAiTopicEvery')?.addEventListener('input', () => {
    AM_AI.TOPIC_EVERY = Math.max(1, parseInt($('amAiTopicEvery')?.value) || 5);
  });

  // Force-refresh topic on demand
  $('amAiRefreshTopicBtn')?.addEventListener('click', async () => {
    const btn = $('amAiRefreshTopicBtn');
    const topicEl = $('amAiTopic');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> …'; }
    if (topicEl) topicEl.style.opacity = '0.4';
    // Force counter reset so amAiTopicDetect skips the cache check
    AM_AI.topicMsgCounter = AM_AI.TOPIC_EVERY;
    const topic = await amAiTopicDetect();
    if (topicEl) { topicEl.textContent = topic || 'unknown'; topicEl.style.opacity = '1'; }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refresh'; }
    notify('Topic refreshed: ' + (topic || 'unknown'), 'info');
  });

  amAiRenderBufferFeed();
  amAiUpdateStats();
}


/* ═══════════════════════════════════════════════════════════════════════════
   ACTIVE MODE ENGINE — v5 clean (Stream Hearing removed)
   1. Failover system (tries next account on ban/error)
   2. Smart delay per mode: fast / normal / slow (seconds-based)
   3. AM_AI context buffer — last 10–15 chat messages
   4. Human-like probability gating: 5%–30% response rate
   5. Global cooldown (8–14s random) + strict mutex lock
   6. Debounced generation — no spam-triggering from rapid chat
   7. Silent fail-safe — errors skip cycle, never crash or retry-loop
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── [MODIFIED] Delay config per mode (seconds) ─────────────────────────── */
const AM_MODE_DELAYS = {
  // ⚡⚡ SUPER TURBO — fires every 100–350 ms, ALL accounts in parallel,
  //                  each with its own message variation. Used when the
  //                  Turbo button is toggled ON.
  superTurbo: { min: 0.10, max: 0.35 },
  turbo:      { min: 0.3,  max: 0.8 },
  fast:       { min: 1,    max: 1.5 },
  normal:     { min: 1.5,  max: 3   },
  slow:       { min: 3,    max: 6   },
};
// In Super Turbo, the per-tick parallel-send cap. Each tick fires this many
// accounts at the same time, then schedules the next tick almost immediately.
const AM_SUPER_TURBO_MAX_PARALLEL = 20;

/** Get delay in ms based on current mode + optional thinking effect */
function amGetDelay(msgLength = 0) {
  const mode   = S.am.mode || 'normal';
  const range  = AM_MODE_DELAYS[mode] || AM_MODE_DELAYS.normal;
  let   minMs  = (S.am.delayMin ?? range.min) * 1000;
  let   maxMs  = (S.am.delayMax ?? range.max) * 1000;

  // [MODIFIED] Thinking effect: longer messages get up to 2x base delay
  if (S.am.thinkingEffect && msgLength > 0) {
    const factor = Math.min(1 + msgLength / 80, 2.0);
    minMs *= factor;
    maxMs *= factor;
  }

  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

/* ── [MODIFIED] Mark account as banned inside Active Mode ───────────────── */
function amBanAccount(acc) {
  acc.status = 'invalid';
  S.am.banned++;
  const tok = S.tokens.find(t => t.token === acc.token);
  if (tok) {
    tok.status = 'banned';
    const ch = S.channel?.user?.username || 'unknown';
    if (!tok.chatroomBans) tok.chatroomBans = [];
    if (!tok.chatroomBans.includes(ch)) tok.chatroomBans.push(ch);
  }
  Store.save();
  RenderQueue.schedule('accounts', renderAccounts); // deferred — ban detection can fire rapidly in active mode
  notify('[Active Mode] ' + acc.username + ' banned', 'warning');
}


/* ── Anti-repeat + variation helpers ───────────────────────────────────── */

/**
 * Strip blacklisted words from a message.
 * Returns cleaned string — never mutates original.
 */
function amApplyBlacklist(msg) {
  if (!msg || !AM_AI.blacklist.length) return msg;
  let out = msg;
  for (const word of AM_AI.blacklist) {
    // Case-insensitive whole-word replacement with empty string
    const re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    out = out.replace(re, '');
  }
  // Collapse multiple spaces left by removals
  return out.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Lightweight message variation — used when a message would repeat.
 * Tries word-swaps first, then filler strip, then prefix filler.
 * Never returns empty — falls back to original if all strategies fail.
 */
function amVaryMessage(msg, seed) {
  if (!msg) return msg;
  const r = Math.abs((seed || Date.now()) * 1103515245 + 12345) & 0x7fffffff;

  // Strategy 1: word swap using existing AM_AI_SWAPS pool
  for (let i = 0; i < AM_AI_SWAPS.length; i++) {
    const [from, to] = AM_AI_SWAPS[(r + i) % AM_AI_SWAPS.length];
    const re = new RegExp('\\b' + from + '\\b', 'i');
    if (re.test(msg)) {
      const varied = msg.replace(re, to);
      if (varied !== msg) return varied;
    }
  }

  // Strategy 2: strip common filler words to shorten the message
  const fillerRe = /\b(just|really|very|quite|maybe|probably|actually|basically|literally|simply|totally|absolutely)\b/gi;
  const stripped = msg.replace(fillerRe, '').replace(/\s{2,}/g, ' ').trim();
  if (stripped && stripped !== msg && stripped.length >= 3) return stripped;

  // Strategy 3: prepend a casual filler word for surface-level difference
  const fillers = AM_AI_FILLERS || ['fr','ngl','tbh','lowkey','bro'];
  const filler  = fillers[r % fillers.length];
  return filler + ' ' + msg;
}

/**
 * Returns true if msg is too similar to a recently sent message.
 * Checks: exact match, same first 3 words, >70% word overlap.
 */
function amIsRepeat(msg) {
  if (!msg || !AM_AI.lastMessages.length) return false;
  const lower  = msg.toLowerCase().trim();
  const words  = lower.split(/\s+/).filter(Boolean);
  const first3 = words.slice(0, 3).join(' ');

  return AM_AI.lastMessages.some(prev => {
    const p = prev.toLowerCase().trim();
    if (p === lower) return true;
    // Same opening — feels repetitive even if ending differs
    if (first3.length > 4 && p.startsWith(first3)) return true;
    // Word overlap > 70%
    const pWords  = new Set(p.split(/\s+/).filter(w => w.length > 2));
    const matches = words.filter(w => w.length > 2 && pWords.has(w)).length;
    const denom   = Math.max(pWords.size, words.filter(w => w.length > 2).length);
    return denom > 0 && (matches / denom) > 0.70;
  });
}

/**
 * Record a sent message in the rolling window (max 12).
 */
function amTrackSent(msg) {
  if (!msg) return;
  AM_AI.lastMessages.push(msg);
  if (AM_AI.lastMessages.length > 12) AM_AI.lastMessages.shift();
}


/* ── [MODIFIED] Send with failover: try next account if current fails ────── */
async function amSendWithFailover(msg, preferredAcc, allValid) {
  // Build ordered account queue: preferred first, then rotate others
  const queue = preferredAcc
    ? [preferredAcc, ...allValid.filter(a => a.id !== preferredAcc.id)]
    : [...allValid];

  for (const acc of queue) {
    if (!S.am.running) return; // stopped while retrying

    const content = $('chkAntiDup')?.checked
      ? msg + ['​', '‌', '‍', '⁠'][S.am.sent % 4]
      : msg;

    const res = await KickAPI.sendRetry(acc.token, S.chanId, content);

    if (res.ok) {
      // ── SUCCESS ──
      S.am.sent++;
      acc._amLastSentAt = Date.now();
      amTrackSent(msg); // record for anti-repeat window
      amAddHistory({ ts: Date.now(), account: acc.username || maskTok(acc.token), msg: msg.slice(0, 60), ok: true, status: 200 });
      if ($('amLastMsg')) $('amLastMsg').textContent = msg.length > 40 ? msg.slice(0, 40) + '…' : msg;
      if ($('amLastAcc')) $('amLastAcc').textContent = acc.username || maskTok(acc.token);
      amUpdateStatus();
      return; // done — message delivered
    }

    // ── FAIL ──
    S.am.failed++;
    amAddHistory({ ts: Date.now(), account: acc.username || maskTok(acc.token), msg: msg.slice(0, 60), ok: false, status: res.status });

    if (res.status === 401 || res.status === 403) {
      // Account banned or token invalid — mark it and try next
      amBanAccount(acc);
      if (S.am.stopOnBan) { amStop(); return; }
      notify(`[Failover] ${acc.username} failed (${res.status}) → trying next account`, 'warning');
      continue; // failover to next account in queue
    }

    // Other errors (rate limit, network) — don't failover, just skip this tick
    notify(`[Active Mode] Send failed (${res.status})`, 'error');
    amUpdateStatus();
    return;
  }

  // All accounts exhausted
  notify('[Active Mode] All accounts failed — message dropped', 'error');
  amUpdateStatus();
}

/* ── [MODIFIED] Core send tick ───────────────────────────────────────────── */



async function amDoSend() {
  if (!S.am.running || !S.chanId) return;

  const valid = S.accounts.filter(a => a.status === 'valid' && a.token);
  if (!valid.length) return;

  // Pick the "lead account" up-front — its personality drives the AI prompt
  // for this tick. In super-turbo, this account is also the i=0 sender; the
  // rest get amVaryMessage variants of the same base.
  const leadAccount = amPickAccount() || valid[Math.floor(Math.random() * valid.length)];

  // Generate the base message via AI (single call — variations come next)
  const baseMsg = await new Promise(resolve => amAiScheduleGenerate(resolve, leadAccount));
  if (!baseMsg) return;   // source declined or cooldown — skip tick

  // ⚡⚡ ── SUPER TURBO PATH ──────────────────────────────────────────────────
  // Pick up to N random accounts (no repeats), fire them ALL in parallel.
  // Each gets a different variation of the base message so no two accounts
  // post the same text.
  if (S.am.superTurbo) {
    const blastCount = Math.min(
      valid.length,
      Math.max(1, parseInt($('amMultiSend')?.value) || AM_SUPER_TURBO_MAX_PARALLEL),
      AM_SUPER_TURBO_MAX_PARALLEL
    );
    // Fisher-Yates-style shuffle, take first N
    const shuffled = valid.slice().sort(() => Math.random() - 0.5);
    const picked   = shuffled.slice(0, blastCount);

    // Build a unique message per account
    const seedBase = Date.now() ^ (AM_AI.generated || 0);
    const sends = picked.map((acc, i) => {
      let msg = i === 0 ? baseMsg : amVaryMessage(baseMsg, seedBase + i * 9973);
      msg = amApplyBlacklist(msg) || baseMsg;
      // Fire-and-forget — we don't await individual sends so they overlap
      return amSendWithFailover(msg, acc, [acc]).catch(() => {});
    });

    // Wait for the whole blast to settle before the next tick
    await Promise.all(sends);
    return;
  }

  // ── NORMAL / FAST / SLOW / TURBO path (existing behavior) ────────────────
  const countTarget = Math.min(2, Math.max(1, parseInt($('amMultiSend')?.value) || 1));
  const used = new Set();

  for (let i = 0; i < countTarget; i++) {
    if (!S.am.running) break;

    let acc;
    if (countTarget === 1) {
      acc = amPickAccount();
    } else {
      const pool = valid.filter(a => !used.has(a.id));
      if (!pool.length) break;
      acc = pool[Math.floor(Math.random() * pool.length)];
    }
    if (!acc) break;
    used.add(acc.id);

    let msg = i === 0
      ? baseMsg
      : amVaryMessage(baseMsg, i + (AM_AI.generated || i));
    msg = amApplyBlacklist(msg);
    if (!msg) msg = baseMsg;

    if (i > 0) await sleep(1500 + Math.random() * 2000);

    await amSendWithFailover(msg, acc, valid.filter(a => !used.has(a.id) || a.id === acc.id));
  }
}

/* ── [MODIFIED] Schedule next tick using seconds-based smart delay ───────── */
function amScheduleNext() {
  if (!S.am.running) return;

  // Get delay in ms using mode + config (replaces interval/variance minutes)
  const delayMs = amGetDelay(0); // base delay; thinking effect applied per-message

  S.am.nextAt = Date.now() + delayMs;
  amUpdateStatus();

  S.am.timer = setTimeout(async () => {
    if (!S.am.running) return;
    await amDoSend();
    amScheduleNext();
  }, delayMs);
}

/* ── [MODIFIED] Start / Stop ─────────────────────────────────────────────── */
/** Toggle Turbo Mode on/off — can be switched while AM is running */
function amTurboToggle() {
  S.am.turbo      = !S.am.turbo;
  S.am.superTurbo = S.am.turbo;   // turbo button = super turbo mode
  const btn = $('amTurbo');
  if (!btn) return;
  if (S.am.turbo) {
    btn.classList.add('turbo-on');
    btn.style.background  = '#ff3a6e';   // hot pink to signal SUPER mode
    btn.style.color       = '#000';
    btn.style.borderColor = '#ff3a6e';
    // Apply the super-turbo delay range
    S.am.delayMin = AM_MODE_DELAYS.superTurbo.min;
    S.am.delayMax = AM_MODE_DELAYS.superTurbo.max;
    if ($('amDelayMin')) $('amDelayMin').value = S.am.delayMin;
    if ($('amDelayMax')) $('amDelayMax').value = S.am.delayMax;
    const validCount = S.accounts.filter(a => a.status === 'valid' && a.token).length;
    const parallel   = Math.min(validCount, AM_SUPER_TURBO_MAX_PARALLEL);
    notify('⚡⚡ SUPER TURBO ON — ' + parallel + ' accounts blasting in parallel, unique message per account', 'success');
  } else {
    btn.classList.remove('turbo-on');
    btn.style.background  = 'transparent';
    btn.style.color       = '#f59e0b';
    btn.style.borderColor = '#f59e0b';
    // Restore previous mode delays
    const range = AM_MODE_DELAYS[S.am.mode] || AM_MODE_DELAYS.normal;
    S.am.delayMin = range.min;
    S.am.delayMax = range.max;
    if ($('amDelayMin')) $('amDelayMin').value = S.am.delayMin;
    if ($('amDelayMax')) $('amDelayMax').value = S.am.delayMax;
    notify('Super Turbo OFF', 'info');
  }
}

function amStart() {
  if (!S.chanId) { notify('Connect to a channel first', 'error'); return; }
  const valid = S.accounts.filter(a => a.status === 'valid' && a.token);
  if (!valid.length) { notify('No valid accounts', 'error'); return; }

  // Sync all options from UI
  S.am.stopOnBan      = $('amStopOnBan')?.checked ?? false;
  S.am.useEmotes      = $('amUseEmotes')?.checked ?? false;
  S.am.multiSend      = Math.max(1, parseInt($('amMultiSend')?.value) || 1);
  S.am.mode           = $('amMode')?.value || 'normal';
  S.am.thinkingEffect = $('amThinking')?.checked ?? true;
  S.am.turbo          = $('amTurbo')?.classList.contains('turbo-on') ?? false;
  S.am.superTurbo     = S.am.turbo;   // Turbo button → super turbo

  // Apply mode delays to state — super turbo overrides
  const modeRange = S.am.superTurbo
    ? AM_MODE_DELAYS.superTurbo
    : (AM_MODE_DELAYS[S.am.mode] || AM_MODE_DELAYS.normal);
  S.am.delayMin = parseFloat($('amDelayMin')?.value) || modeRange.min;
  S.am.delayMax = parseFloat($('amDelayMax')?.value) || modeRange.max;

  S.am.running  = true;
  S.am.sent     = 0;
  S.am.failed   = 0;
  S.am.banned   = 0;
  S.am.history  = [];
  S.am.accQueue = [];

  $('amStartBtn').style.display = 'none';
  $('amStopBtn').style.display  = '';
  $('activeDot').classList.add('on');
  $('activeBadge').style.display = '';
  $('activeModeCard').classList.add('running');
  $('stStatus').textContent = 'Active';

  amUpdateStatus();
  amDoSend().then(() => { if (S.am.running) amScheduleNext(); });
  S.am.countdown = setInterval(amUpdateStatus, 1000);

  const modeLabel = S.am.mode.toUpperCase();
  notify(`Active Mode started — AI · ${modeLabel} (${S.am.delayMin}–${S.am.delayMax}s)`, 'success');
}

function amStop() {
  S.am.running = false;
  if (S.am.timer)     { clearTimeout(S.am.timer);      S.am.timer     = null; }
  if (S.am.countdown) { clearInterval(S.am.countdown); S.am.countdown = null; }
  S.am.nextAt = 0;

  $('amStartBtn').style.display  = '';
  $('amStopBtn').style.display   = 'none';
  $('activeDot').classList.remove('on');
  $('activeBadge').style.display = 'none';
  $('activeModeCard').classList.remove('running');

  amUpdateStatus();
  if ($('stStatus')?.textContent === 'Active') $('stStatus').textContent = 'Idle';
  notify(`Active Mode stopped — ✓${S.am.sent} sent  ✗${S.am.failed} failed`, 'info');
}

/* ── Account selector ───────────────────────────────────────────────────── */
function amRenderAccountSelect() {
  aiRenderReplyAs();
  const sel = $('amAccount'); if (!sel) return;
  const valid = S.accounts.filter(a => a.status === 'valid' && a.token);
  // Fingerprint — skip <option> rebuild if the visible set + labels are unchanged
  const _fp = valid.map(a => `${a.id}:${a.username||''}:${a.token}`).join('|');
  if (sel._am_fp !== _fp) {
    sel._am_fp = _fp;
    const prev = sel.value;
    sel.innerHTML = '<option value="random">🔀 Random Account</option>' +
      '<option value="selected">☑ Selected Accounts (from table)</option>' +
      valid.map(a => `<option value="${esc(a.id)}">${esc(a.username || maskTok(a.token))}</option>`).join('');
    if (prev) sel.value = prev;
  }
  liveChatRenderSendAs();
}

/* ── Apply settings ─────────────────────────────────────────────────────── */
function amApplySettings() {
  if ($('amStopOnBan'))  $('amStopOnBan').checked  = !!S.am.stopOnBan;
  if ($('amUseEmotes'))  $('amUseEmotes').checked  = !!S.am.useEmotes;
  if ($('amMultiSend'))  $('amMultiSend').value    = S.am.multiSend  || 1;
  if ($('amMode'))       $('amMode').value         = S.am.mode       || 'normal';
  if ($('amThinking'))   $('amThinking').checked   = S.am.thinkingEffect !== false;
  if ($('amDelayMin'))   $('amDelayMin').value     = S.am.delayMin   ?? 2;
  if ($('amDelayMax'))   $('amDelayMax').value     = S.am.delayMax   ?? 4;
  // Sync delay inputs when mode changes
  $('amMode')?.addEventListener('change', () => {
    const range = AM_MODE_DELAYS[$('amMode').value] || AM_MODE_DELAYS.normal;
    if ($('amDelayMin')) $('amDelayMin').value = range.min;
    if ($('amDelayMax')) $('amDelayMax').value = range.max;
    S.am.mode     = $('amMode').value;
    S.am.delayMin = range.min;
    S.am.delayMax = range.max;
    Store.save();
  });
  // Source toggle wires
}


/* ══ STREAMS ══ */
const StreamsState = {
  keyword: '',
  loading: false,
  allResults: [],   // full list from API
  filtered: [],     // after keyword filter
};

function streamsHighlight(text, kw) {
  if (!kw) return esc(text);
  const re = new RegExp('(' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  return esc(text).replace(re, '<mark>$1</mark>');
}

function streamsRender() {
  const grid  = $('streamGrid');
  const empty = $('streamEmpty');
  const label = $('streamCountLabel');
  const badge = $('streamCount');
  if (!grid) return;

  const kw = StreamsState.keyword.trim().toLowerCase();

  // Filter allResults by keyword
  StreamsState.filtered = kw
    ? StreamsState.allResults.filter(function(s) {
        var title = (s.title || '').toLowerCase();
        var user  = ((s.channel && (s.channel.username || s.channel.slug)) || '').toLowerCase();
        return title.includes(kw) || user.includes(kw);
      })
    : StreamsState.allResults;

  const list = StreamsState.filtered;
  if (badge) { badge.textContent = list.length; badge.classList.toggle('on', list.length > 0); }
  if (label) label.textContent = list.length ? '— ' + list.length + ' streams' : '';

  if (!list.length) {
    grid.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  grid.innerHTML = list.map(function(s) {
    var ch       = s.channel || {};
    var slug     = ch.slug || '';
    var title    = s.title || 'Untitled';
    var viewers  = s.viewer_count || 0;
    var username = ch.username || ch.slug || '??';
    var avatar   = ch.profile_pic || '';
    var thumb    = (s.thumbnail && s.thumbnail.src) || '';
    var kickUrl  = 'https://kick.com/' + esc(slug);
    var fmtV     = viewers >= 1000 ? (viewers/1000).toFixed(1)+'K' : String(viewers);

    var thumbHtml = thumb
      ? '<img class="stream-thumb" src="' + esc(thumb) + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'"><div class="stream-thumb-placeholder" style="display:none"><i class="bi bi-display"></i></div>'
      : '<div class="stream-thumb-placeholder"><i class="bi bi-display"></i></div>';

    var avatarHtml = avatar
      ? '<img class="stream-avatar" src="' + esc(avatar) + '" alt="" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'"><div class="stream-avatar-placeholder" style="display:none">' + esc(initials(username)) + '</div>'
      : '<div class="stream-avatar-placeholder">' + esc(initials(username)) + '</div>';

    return '<div class="stream-card" onclick="window.open(\'' + kickUrl + '\',\'_blank\')">'
      + thumbHtml
      + '<div class="stream-body">'
      + '<div class="stream-title">' + streamsHighlight(title, kw) + '</div>'
      + '<div class="stream-meta">'
      + '<div class="stream-streamer">' + avatarHtml + '<span class="stream-name">' + esc(username) + '</span></div>'
      + '<div class="stream-viewers">' + fmtV + '</div>'
      + '</div>'
      + '<a class="stream-open-link" href="' + kickUrl + '" target="_blank" onclick="event.stopPropagation()">'
      + '<i class="bi bi-box-arrow-up-right"></i> Open on Kick</a>'
      + '</div></div>';
  }).join('');
}

async function streamsFetch() {
  if (StreamsState.loading) return;
  StreamsState.loading = true;

  var loading    = $('streamLoading');
  var empty      = $('streamEmpty');
  var grid       = $('streamGrid');
  var refreshBtn = $('streamRefreshBtn');

  // Show skeleton, hide grid/empty
  if (loading) loading.style.display = '';
  if (empty)   empty.style.display   = 'none';
  if (grid)    grid.innerHTML        = '';
  if (refreshBtn) refreshBtn.classList.add('spinning');

  try {
    var result = await window.electronAPI.fetchStreams({});
    if (!result.ok) throw new Error(result.error || 'Unknown error');
    StreamsState.allResults = result.data || [];
  } catch(e) {
    notify('Could not fetch streams — ' + e.message, 'error');
    StreamsState.allResults = [];
  }

  if (loading)    loading.style.display    = 'none';
  if (refreshBtn) refreshBtn.classList.remove('spinning');
  StreamsState.loading = false;
  streamsRender();
  if (StreamsState.allResults.length) notify(StreamsState.allResults.length + ' streams loaded', 'success');
}

function streamsInit() {
  var kwInput    = $('streamKeyword');
  var searchBtn  = $('streamSearchBtn');
  var refreshBtn = $('streamRefreshBtn');

  if (kwInput) {
    kwInput.addEventListener('input', debounce(function() {
      StreamsState.keyword = kwInput.value;
      streamsRender();
    }, 150));
    kwInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { StreamsState.keyword = kwInput.value; streamsRender(); }
    });
  }

  if (searchBtn)  searchBtn.addEventListener('click', function() {
    StreamsState.keyword = kwInput ? kwInput.value : '';
    if (!StreamsState.allResults.length) streamsFetch();
    else streamsRender();
  });
  if (refreshBtn) refreshBtn.addEventListener('click', function() { streamsFetch(); });
}

/* ══ UTILS ══ */
function renderAll(){renderAccounts();renderTokens();applySettings();}


/* ══ INIT ══ */
/* ══ SLOT PICKER ══ */
const SLOT_API = 'https://www.stakepicker.com/api/games/filter';

// Providers available on Rainbet & Shuffle (Bonus Buy only)
const SLOT_PROVIDERS_RAINBET = [
  'pragmatic play','pragmaticplay','pragmatic',
  'hacksaw gaming','hacksaw',
  'backseat gaming','backseat',
  'no limit city','nolimitcity','nolimit city','no limit',
  'bgaming','b gaming',
  'massive studios','massive',
  'push gaming','push',
  'twist gaming','twist',
  'relax gaming','relax',
  'play n go','play\'n go','playngo',
  'yggdrasil','thunderkick','netent',
  'red tiger','elk studios','elk',
];

// Kick emotes pool
const SLOT_EMOTES = [
  '[emote:37217:Bwop]','[emote:39251:beeBobble]','[emote:4147910:BBoomer]',
  '[emote:37215:AYAYA]','[emote:3753119:asmonSmash]','[emote:4147900:catKISS]',
  '[emote:39254:CaptFail]','[emote:4148144:catblobDance]','[emote:37218:Clap]',
  '[emote:4147909:coffinPls]','[emote:39260:DanceDance]','[emote:37220:DonoWall]',
  '[emote:4147914:duckPls]','[emote:39265:EDMusiC]','[emote:37221:EZ]',
  '[emote:37234:Prayge]','[emote:4148081:Sadge]','[emote:39275:peepoShy]',
  '[emote:37246:peepoRiot]','[emote:37245:peepoDJ]','[emote:37232:PeepoClap]',
  '[emote:39277:politeCat]','[emote:4147896:TOXIC]','[emote:37230:POLICE]',
  '[emote:37236:ThisIsFine]',
];

/* ══ GLOBAL TAG ENGINE ═══════════════════════════════════════════════════════ */

function getGlobalTag() {
  const raw = ($('globalTagInput')?.value || '').trim();
  return raw;
}

function appendGlobalTag(msg) {
  const tag = getGlobalTag();
  if (!tag) return msg;
  const m = (msg || '').trimEnd();
  if (m.endsWith(tag)) return m;
  return m + ' ' + tag;
}

function globalTagApplyNow() {
  const tag = getGlobalTag();
  if (!tag) { notify('Enter a tag first', 'error'); return; }
  let count = 0;
  S.accounts.forEach(a => {
    const draft = S.drafts[a.id];
    if (!draft || !draft.message) return;
    const updated = appendGlobalTag(draft.message);
    if (updated !== draft.message) {
      S.drafts[a.id] = Object.assign({}, draft, { message: updated });
      count++;
    }
  });
  Store.save();
  renderAccounts();
  const statusEl = $('globalTagStatus');
  if (statusEl) {
    statusEl.style.display = '';
    statusEl.style.color = count > 0 ? 'var(--ac,#3dffa0)' : 'var(--dim)';
    statusEl.textContent = count > 0
      ? '✓ Tag appended to ' + count + ' account' + (count !== 1 ? 's' : '')
      : 'No accounts had existing draft messages';
    setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
  }
  if (count > 0) notify('Global tag appended to ' + count + ' account drafts', 'success');
}

// Message format templates — only {slot}, {emote}, {emote2}, {tag}
// All formats are unique — no duplicates; pool system prevents repeats across picks
const SLOT_MSG_FORMATS = [
  '{slot} {emote}{tag}',
  '{slot} {emote} {emote2}{tag}',
  '{slot} {emote2} {emote}{tag}',
  '{slot} {emote2}{tag}',
  '{emote} {slot}{tag}',
  '{emote} {slot} {emote2}{tag}',
  '{emote2} {slot} {emote}{tag}',
  '{slot} {emote} {emote2} {emote}{tag}',
  '{emote}{slot} {emote2}{tag}',
  '{emote2}{slot} {emote}{tag}',
];


// Cached slot data per platform
const _slotCache = { rainbet_shuffle: null, stake: null };
// Generated assignments
let _slotAssignments = [];
// Tracks which format indexes are still available (for no-repeat)
let _slotFormatPool = [];
// Tracks which slot indexes are still available (for no-repeat)
let _slotGamePool = [];
// Tracks which emote indexes are still available (for no-repeat per generation batch)
let _slotEmotePool = [];

function _rnd(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function slotPickEmote(exclude=null){
  // Use pool so emotes don't repeat until all have been used
  if(!_slotEmotePool.length) _slotEmotePool = SLOT_EMOTES.map((_,i)=>i);
  // Filter out excluded emote index if provided
  const available = exclude
    ? _slotEmotePool.filter(i => SLOT_EMOTES[i] !== exclude)
    : [..._slotEmotePool];
  if(!available.length){
    // Edge case: all remaining are excluded, refill and try again
    _slotEmotePool = SLOT_EMOTES.map((_,i)=>i).filter(i => SLOT_EMOTES[i] !== exclude);
    if(!_slotEmotePool.length) _slotEmotePool = SLOT_EMOTES.map((_,i)=>i);
    const idx2 = Math.floor(Math.random()*_slotEmotePool.length);
    const pick2 = _slotEmotePool.splice(idx2,1)[0];
    return SLOT_EMOTES[pick2];
  }
  const pick = available[Math.floor(Math.random()*available.length)];
  // Remove from pool
  const poolIdx = _slotEmotePool.indexOf(pick);
  if(poolIdx !== -1) _slotEmotePool.splice(poolIdx,1);
  return SLOT_EMOTES[pick];
}

function slotPickFormat(){
  // Refill pool when empty
  if(!_slotFormatPool.length) _slotFormatPool = SLOT_MSG_FORMATS.map((_,i)=>i);
  const idx = Math.floor(Math.random()*_slotFormatPool.length);
  const fmtIdx = _slotFormatPool.splice(idx,1)[0];
  return SLOT_MSG_FORMATS[fmtIdx];
}

function slotProviderMatchesRainbet(provider=''){
  const p = provider.toLowerCase();
  return SLOT_PROVIDERS_RAINBET.some(x => p.includes(x) || x.includes(p));
}


async function slotFetchGames(platform){
  if(_slotCache[platform]) return _slotCache[platform];
  $('slotPickerStatus').textContent = 'Fetching…';
  try {
    const res = await fetch(SLOT_API);
    if(!res.ok) throw new Error('API error '+res.status);
    const data = await res.json();
    const raw = Array.isArray(data) ? data : (data.games || data.data || []);
    _slotCache[platform] = raw;
    return raw;
  } catch(e) {
    $('slotPickerStatus').textContent = 'API error';
    notify('Slot API error: '+e.message,'error');
    return [];
  }
}

function slotGetProvider(g){
  return (g.groupTranslation || g.provider || g.providerName || '').trim();
}

function slotHasBonusBuy(g){
  return !!(g.bonusBuyCategoryId || g.bonusBuy || g.bonus_buy || g.hasBonusBuy);
}

function slotFilterGames(games, platform){
  return games.filter(g => {
    if(!slotHasBonusBuy(g)) return false;
    if(platform === 'rainbet_shuffle'){
      const provider = slotGetProvider(g);
      return slotProviderMatchesRainbet(provider);
    }
    // stake: only games with "Only on Stake" tag + bonus buy
    return !!(g.onlyOnStakeId || g.onlyOnStake);
  });
}

function slotClean(s){
  // Strip apostrophes, pipes, provider names, cmon/letsgo, leftover tokens, extra spaces
  return s
    .replace(/'/g,'').replace(/\u2019/g,'').replace(/`/g,'')
    .replace(/\|\|?/g,'')
    .replace(/\{[^}]+\}/g,'')
    .replace(/\bby\s+[A-Za-z][A-Za-z0-9 ]{2,}/gi,'')
    .replace(/\b(bgaming|b gaming|pragmatic play|hacksaw gaming|hacksaw|massive studios|twist gaming|titan gaming|paperclip gaming|paperclip|backseat gaming|backseat|push gaming|uppercut gaming|uppercut|nolimit city|no limit city|nolimitcity|no limit)\b/gi,'')
    .replace(/\b(cmon|c mon|lets go|letsgo|let s go)\b/gi,'')
    .replace(/\s{2,}/g,' ')
    .trim();
}

function slotBuildMsg(game){
  const rawName = slotClean(game.name || game.title || '???');
  const name    = Math.random()<0.5 ? rawName.toUpperCase() : rawName.toLowerCase();
  const tagRaw  = slotClean($('slotTagInput')?.value||'');
  const tag     = tagRaw ? ' '+tagRaw : '';

  // 40% chance of no emotes, 60% chance of emote(s)
  const useEmotes = Math.random() < 0.6;
  if(!useEmotes){
    // plain: just slot name + tag
    return slotClean(name + tag);
  }

  const e1  = slotPickEmote();
  const e2  = slotPickEmote(e1);
  const fmt = slotPickFormat();
  return slotClean(fmt
    .replace('{slot}',   name)
    .replace('{emote}',  e1)
    .replace('{emote2}', e2)
    .replace('{tag}',    tag));
}

async function slotPickOne(){
  const platform = document.querySelector('input[name="slotPlatform"]:checked')?.value || 'rainbet_shuffle';
  const games = await slotFetchGames(platform);
  const filtered = slotFilterGames(games, platform);
  if(!filtered.length){ notify('No matching slots found','error'); $('slotPickerStatus').textContent='No slots found'; return null; }
  // Pool-based no-repeat: refill when exhausted
  if(!_slotGamePool.length || _slotGamePool[0].__platform !== platform){
    _slotGamePool = filtered.map((_,i)=>i);
    _slotGamePool.__platform = platform;
  }
  const idx = Math.floor(Math.random()*_slotGamePool.length);
  const gameIdx = _slotGamePool.splice(idx,1)[0];
  return filtered[gameIdx];
}

async function slotPickOneAndShow(){
  $('slotPickOneBtn').disabled = true;
  const pick = await slotPickOne();
  $('slotPickOneBtn').disabled = false;
  if(!pick) return;
  const msg = slotBuildMsg(pick);
  $('slotPreviewBox').style.display = 'block';
  $('slotPreviewName').textContent  = pick.name || pick.title || '???';
  $('slotPreviewProvider').textContent = slotGetProvider(pick);
  $('slotPreviewMsg').textContent   = msg;
  $('slotPickerStatus').textContent = 'Picked!';
}

async function slotGenerateAll(){
  const platform = document.querySelector('input[name="slotPlatform"]:checked')?.value || 'rainbet_shuffle';
  const accs = S.accounts;
  if(!accs.length){ notify('No accounts added','error'); return; }
  $('slotGenAllBtn').disabled = true;
  $('slotGenStatus').textContent = 'Fetching slots…';
  const games = await slotFetchGames(platform);
  const filtered = slotFilterGames(games, platform);
  if(!filtered.length){ notify('No matching slots found','error'); $('slotGenStatus').textContent='No slots found'; $('slotGenAllBtn').disabled=false; return; }

  // Reset all pools so every account gets a unique slot, format, and emotes
  _slotFormatPool = SLOT_MSG_FORMATS.map((_,i)=>i);
  _slotEmotePool  = SLOT_EMOTES.map((_,i)=>i);
  // Build a shuffled slot pool (no repeats until all slots used)
  const slotPool = filtered.map((_,i)=>i).sort(()=>Math.random()-0.5);
  let slotPoolIdx = 0;

  _slotAssignments = accs.map(a => {
    // Cycle through slot pool — guarantees no repeat until all slots used
    if(slotPoolIdx >= slotPool.length) slotPoolIdx = 0;
    const pick = filtered[slotPool[slotPoolIdx++]];
    const msg  = slotBuildMsg(pick);
    return { accId: a.id, username: a.username||'acc', slot: pick.name||'???', provider: slotGetProvider(pick), msg };
  });

  $('slotGenPreview').style.display = 'block';
  $('slotGenList').innerHTML = _slotAssignments.slice(0,12).map(a =>
    `<span class="bulk-preview-chip has-msg" title="${esc(a.msg)}">${esc(a.username)}: ${esc(a.msg.length>28?a.msg.slice(0,28)+'…':a.msg)}</span>`
  ).join('') + (_slotAssignments.length>12?`<span class="bulk-preview-chip">+${_slotAssignments.length-12} more…</span>`:'');

  $('slotBulkApplyBtn').style.display = 'inline-flex';
  $('slotGenStatus').textContent = `Generated for ${_slotAssignments.length} account(s)`;
  $('slotPickerStatus').textContent = `${_slotAssignments.length} generated`;
  $('slotGenAllBtn').disabled = false;
  notify(`Slot messages generated for ${_slotAssignments.length} accounts!`,'success');
}

function slotBulkApply(){
  if(!_slotAssignments.length){ notify('Generate first','error'); return; }
  let applied = 0;
  _slotAssignments.forEach(a => {
    S.drafts[a.accId] = Object.assign({}, S.drafts[a.accId]||{}, { message: appendGlobalTag(a.msg.replace(/^!slot\s+/i,'')) });
    applied++;
  });
  Store.save(); renderAccounts();
  const lines = _slotAssignments.map(a => a.msg);
  if($('bulkMsgInput')) $('bulkMsgInput').value = lines.join('\n');
  updateBulkPreview();
  notify(`Applied ${applied} slot messages to accounts!`,'success');
}

function slotUpdateHint(){
  const platform = document.querySelector('input[name="slotPlatform"]:checked')?.value || 'rainbet_shuffle';
  const hint = $('slotPlatformHintText');
  if(!hint) return;
  if(platform === 'rainbet_shuffle'){
    hint.textContent = 'Providers: Pragmatic Play · Hacksaw Gaming · Backseat Gaming · No Limit City · BGaming — Bonus Buy only';
  } else {
    hint.textContent = 'Stake: Only on Stake exclusives — Bonus Buy only';
  }
  // clear cache so next pick re-applies filters
  _slotCache.rainbet_shuffle = null;
  _slotCache.stake = null;
  // reset slot pool so platform change gives fresh picks
  _slotGamePool = [];
}

function initSlotPicker(){
  // Old slot picker elements are now hidden stubs.
  // Slot fetch is handled by initMsgSystem (msSlotFetchBtn).
  // slotUpdateHint() is called from initMsgSystem.

  // Global Tag wiring
  $('globalTagClearBtn')?.addEventListener('click', () => {
    if ($('globalTagInput')) $('globalTagInput').value = '';
    const statusEl = $('globalTagStatus');
    if (statusEl) statusEl.style.display = 'none';
  });
  $('globalTagApplyNowBtn')?.addEventListener('click', globalTagApplyNow);
  // Bidirectional sync: globalTagInput ↔ slotTagInput
  $('globalTagInput')?.addEventListener('input', () => {
    const v = $('globalTagInput')?.value || '';
    if ($('slotTagInput')) $('slotTagInput').value = v;
  });
  $('slotTagInput')?.addEventListener('input', () => {
    const v = $('slotTagInput')?.value || '';
    if ($('globalTagInput')) $('globalTagInput').value = v;
  });
}



/* ══════════════════════════════════════════════════════════════════════════
   [MODIFIED] AI CHAT BOT — old standalone bot REMOVED
   AM_AI handles all AI generation — single integrated system
   This stub keeps aiRenderReplyAs() for the account selector UI
   ══════════════════════════════════════════════════════════════════════════ */

// Stub — aiRenderReplyAs is called by amRenderAccountSelect
function aiRenderReplyAs() {
  const sel = $('aiReplyAs'); if (!sel) return;
  const valid = S.accounts.filter(a => a.status === 'valid' && a.token);
  const _fp = valid.map(a => `${a.id}:${a.username||''}:${a.token}`).join('|');
  if (sel._ai_fp === _fp) return;
  sel._ai_fp = _fp;
  const prev = sel.value;
  sel.innerHTML = '<option value="">pick account</option>' +
    valid.map(a => '<option value="' + esc(a.id) + '">' + esc(a.username || maskTok(a.token)) + '</option>').join('');
  if (prev) sel.value = prev;
}

/* ── Hook called on every incoming chat message — feeds AM_AI buffer only ── */
function aiOnChatMessage(data) {
  const username = data.sender?.username || '';
  const content  = data.content || '';
  const isOwn    = S.accounts.some(a => a.username === username);
  // Feed AM_AI context buffer (last 10-15 messages, capped by AM_AI.contextSize)
  if (!isOwn) amAiPushMsg(username, content);
}

// No-op init — old standalone AI system removed; AM_AI handles everything
function aiChatInit() {}


/* ══════════════════════════════════════════════════════════════════════════
   LIVE CHAT — Kick Pusher WebSocket
   Kick uses Pusher (app key: 32cbd69e4b950bf97679, cluster: us2)
   Channel: chatrooms.{chatroomId}.v2
   Event:   App\Events\ChatMessageEvent
   ══════════════════════════════════════════════════════════════════════════ */

const LC = {
  ws:          null,
  connected:   false,
  chatroomId:  null,
  msgCount:    0,
  pingTimer:   null,
  autoScroll:  true,
  reconnectTimer: null,
  reconnectAttempts: 0,
};

const LC_PUSHER_KEY = '32cbd69e4b950bf97679';
const LC_CLUSTER    = 'us2';
let   LC_MAX_MSGS   = 100; // cap DOM nodes — synced to lcMsgLimit selector

/* ── Helpers ────────────────────────────────────────────────────────────── */
function lcSetStatus(text, on) {
  const s   = $('liveChatStatus');
  const dot = $('liveChatDot');
  if (s)   s.innerHTML = `<span id="liveChatDot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${on ? 'var(--ac,#3dffa0)' : on === null ? '#f59e0b' : 'var(--dim)'};margin-right:4px;vertical-align:middle"></span>${text}`;
}

function lcShowChannelBar(show) {
  const bar = $('liveChatChannelBar');
  if (bar) bar.style.display = show ? 'flex' : 'none';
}

function lcUpdateMsgCount() {
  const el = $('liveChatMsgCount');
  if (el) el.textContent = LC.msgCount + ' messages';
}

/* ── Render a single chat message into the feed ─────────────────────────── */
function lcAppendMsg(data) {
  const feed = $('liveChatFeed'); if (!feed) return;

  // Clear placeholder on first message
  if (LC.msgCount === 0) feed.innerHTML = '';

  LC.msgCount++;
  lcUpdateMsgCount();

  const sender   = data.sender   || {};
  const content  = data.content  || '';
  const username = esc(sender.username || '?');
  const identity = sender.identity || {};
  const badges   = (identity.badges || []);
  const color    = identity.color || '#a0a0c0';

  // Build badge HTML
  const badgeHtml = badges.slice(0, 3).map(b => {
    const icon = b.type === 'broadcaster' ? '📡'
               : b.type === 'moderator'   ? '🛡'
               : b.type === 'subscriber'  ? '⭐'
               : b.type === 'og'          ? '👑'
               : b.type === 'vip'         ? '💎' : '';
    return icon ? `<span title="${esc(b.type)}" style="font-size:10px">${icon}</span>` : '';
  }).join('');

  // Highlight own account messages
  const isOwn = S.accounts.some(a => a.username === sender.username);
  const rowBg = isOwn ? 'rgba(61,255,160,0.06)' : 'transparent';

  const ts = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const row = document.createElement('div');
  row.style.cssText = `display:flex;gap:6px;align-items:baseline;padding:2px 4px;border-radius:4px;background:${rowBg};flex-shrink:0`;
  row.innerHTML = `
    <span style="color:var(--dim);font-size:9px;flex-shrink:0;font-family:monospace">${ts}</span>
    ${badgeHtml}
    <span style="color:${esc(color)};font-weight:600;font-size:11px;flex-shrink:0;white-space:nowrap">${username}</span>
    <span style="color:var(--dim);font-size:10px;flex-shrink:0">:</span>
    <span style="font-size:11.5px;color:var(--text,#ebebff);word-break:break-word">${esc(content)}</span>
  `;
  feed.appendChild(row);

  // Trim old messages
  while (feed.children.length > LC_MAX_MSGS) feed.removeChild(feed.firstChild);

  // Auto-scroll to bottom
  if (LC.autoScroll) feed.scrollTop = feed.scrollHeight;

  // AI bot hook — non-blocking
  aiOnChatMessage(data);
}

/* ── Pusher handshake + subscription ───────────────────────────────────── */
function lcConnect() {
  const chatroomId = S.chanId;
  if (!chatroomId) {
    notify('Connect to a channel first (Chat Spammer tab)', 'error');
    return;
  }

  lcDisconnect(false); // close any existing connection

  LC.chatroomId = chatroomId;
  LC.reconnectAttempts++;
  lcSetStatus('Connecting…', null);

  const wsUrl = `wss://ws-${LC_CLUSTER}.pusher.com/app/${LC_PUSHER_KEY}?protocol=7&client=js&version=7.4.0&flash=false`;

  try {
    LC.ws = new WebSocket(wsUrl);
  } catch (e) {
    lcSetStatus('Error', false);
    notify('Live Chat: WebSocket failed — ' + e.message, 'error');
    return;
  }

  LC.ws.onopen = () => {
    // Pusher: subscribe to chatroom channel
    const channel = `chatrooms.${LC.chatroomId}.v2`;
    LC.ws.send(JSON.stringify({
      event: 'pusher:subscribe',
      data:  { auth: '', channel }
    }));

    // Ping every 30s to keep connection alive
    LC.pingTimer = setInterval(() => {
      if (LC.ws && LC.ws.readyState === WebSocket.OPEN) {
        LC.ws.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
      }
    }, 30000);
  };

  LC.ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }

    const event = msg.event || '';

    if (event === 'pusher:connection_established') {
      LC.connected = true;
      LC.reconnectAttempts = 0;
      lcSetStatus('Connected', true);
      $('liveChatConnectBtn').style.display    = 'none';
      $('liveChatDisconnectBtn').style.display = '';
      $('amBadgeNav').style.display = '';
      $('amBadgeNav').textContent = '🔴 LIVE';

      // Populate channel bar from S.channel
      if (S.channel) {
        const avatar = S.channel.user?.profile_pic || S.channel.chatroom?.skin?.thumbnail || '';
        const name   = S.channel.user?.username || S.channel.slug || '?';
        const imgEl  = $('liveChatAvatar');
        if (imgEl) { imgEl.src = avatar; imgEl.style.display = avatar ? '' : 'none'; }
        const nameEl = $('liveChatChannelName');
        if (nameEl) nameEl.textContent = name;
        lcShowChannelBar(true);
      }
      return;
    }

    if (event === 'pusher:pong') return;

    if (event === 'pusher_internal:subscription_succeeded') return;

    // Real chat message event
    if (event === 'App\\Events\\ChatMessageEvent' || event === 'App\\Events\\Chatroom\\MessageSentEvent') {
      let data = msg.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { return; }
      }
      lcAppendMsg(data);
    }
  };

  LC.ws.onerror = () => {
    lcSetStatus('Error', false);
  };

  LC.ws.onclose = (evt) => {
    LC.connected = false;
    clearInterval(LC.pingTimer);
    LC.pingTimer = null;

    $('liveChatConnectBtn').style.display    = '';
    $('liveChatDisconnectBtn').style.display = 'none';
    $('amBadgeNav').style.display = 'none';

    if (evt.code === 1000 || !S.chanId) {
      // Clean disconnect
      lcSetStatus('Disconnected', false);
    } else {
      // Unexpected — auto-reconnect with backoff
      const delay = Math.min(2000 * LC.reconnectAttempts, 30000);
      lcSetStatus(`Reconnecting in ${Math.round(delay/1000)}s…`, null);
      LC.reconnectTimer = setTimeout(lcConnect, delay);
    }
  };
}

function lcDisconnect(clearChannel = true) {
  clearTimeout(LC.reconnectTimer);
  clearInterval(LC.pingTimer);
  LC.reconnectTimer = null;
  LC.pingTimer = null;

  if (LC.ws) {
    LC.ws.onclose = null; // suppress reconnect
    LC.ws.close(1000, 'user disconnect');
    LC.ws = null;
  }

  LC.connected = false;
  if (clearChannel) {
    LC.chatroomId = null;
    LC.reconnectAttempts = 0;
    lcSetStatus('Disconnected', false);
    $('liveChatConnectBtn').style.display    = '';
    $('liveChatDisconnectBtn').style.display = 'none';
    $('amBadgeNav').style.display = 'none';
    lcShowChannelBar(false);
  }
}

function lcClear() {
  const feed = $('liveChatFeed');
  if (feed) {
    feed.innerHTML = `<div style="text-align:center;color:var(--dim);font-size:11px;margin:auto">
      <i class="bi bi-broadcast" style="font-size:22px;opacity:0.3;display:block;margin-bottom:8px"></i>
      Chat cleared
    </div>`;
  }
  LC.msgCount = 0;
  lcUpdateMsgCount();
}

/* ── Send-as dropdown ───────────────────────────────────────────────────── */
function liveChatRenderSendAs() {
  const sel = $('liveChatSendAs'); if (!sel) return;
  const valid = S.accounts.filter(a => a.status === 'valid' && a.token);
  const _fp = valid.map(a => `${a.id}:${a.username||''}:${a.token}`).join('|');
  if (sel._lc_fp !== _fp) {
    sel._lc_fp = _fp;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Account —</option>' +
      valid.map(a => `<option value="${esc(a.id)}">${esc(a.username || maskTok(a.token))}</option>`).join('');
    if (prev) sel.value = prev;
  }

  const hint = $('liveChatInputHint');
  if (hint) {
    const newText = valid.length
      ? 'Select an account above to send messages as'
      : 'No valid accounts — add accounts first';
    if (hint.textContent !== newText) hint.textContent = newText;
  }
}

/* ── Send a message from the live chat input ────────────────────────────── */
async function lcSendMessage() {
  const input  = $('liveChatInput');
  const selEl  = $('liveChatSendAs');
  const msg    = (input?.value || '').trim();
  if (!msg) return;
  if (!S.chanId) { notify('Not connected to a channel', 'error'); return; }

  const accId = selEl?.value;
  const acc   = accId ? S.accounts.find(a => a.id === accId) : null;
  if (!acc) { notify('Select an account to send as', 'error'); return; }

  const btn = $('liveChatSendBtn');
  if (btn) btn.disabled = true;

  const res = await KickAPI.sendRetry(acc.token, S.chanId, msg);
  if (res.ok) {
    input.value = '';
    // Inject own message immediately into feed (won't duplicate since Pusher
    // echoes back via the subscription)
    // We leave the echo to arrive naturally via WebSocket
  } else {
    notify(`Send failed (${res.status})`, 'error');
  }

  if (btn) btn.disabled = false;
  input?.focus();
}

/* ── Auto-scroll detection ──────────────────────────────────────────────── */
function lcInitScrollDetection() {
  const feed = $('liveChatFeed'); if (!feed) return;
  feed.addEventListener('scroll', () => {
    // User scrolled up → pause auto-scroll; at bottom → resume
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    LC.autoScroll = atBottom;
  });
}

document.addEventListener('DOMContentLoaded', async ()=>{
  await Store.load(); renderAll(); renderEmotes(); VT.init();
  tickClock(); setInterval(tickClock,1000);
  initMsgSystem();
  initSlotPicker();
  kacInit();

  // Mark the initially active page so CSS can apply longer startup delays
  const firstPage = document.querySelector('.page.active');
  if (firstPage) firstPage.classList.add('page-initial');

  // Nav
  document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

  // Channel
  $('connectBtn').addEventListener('click', connectChannel);
  $('channelInput').addEventListener('keydown', e => { if (e.key === 'Enter') connectChannel(); });

  // Message input char counter
  $('msgInput').addEventListener('input', function() {
    $('msgLen').textContent = this.value.length + '/500';
  });

  // Message Dispatcher
  $('mdSendBtn').addEventListener('click', mdDispatch);
  $('mdCancelBtn').addEventListener('click', mdCancel);
  $('mdResetStats').addEventListener('click', () => {
    S.md.stats = { sent: 0, failed: 0, skipped: 0 };
    mdUpdateStats();
    notify('Stats reset', 'info');
  });
  $('mdClearLog').addEventListener('click', () => {
    const log = $('mdLog');
    if (log) log.innerHTML = '<span style="color:var(--dim);font-size:10px">No activity yet — press Send Now to begin.</span>';
  });
  $('mdAccMode').addEventListener('change', mdUpdateCustomHint);

  // Token / batch internals
  $('addTokBtn')?.addEventListener('click', () => {
    S.tokFetched = null; $('tokModalInput').value = '';
    $('tokPreview').style.display = 'none'; $('tokStatus').className = 'fetch-st';
    openModal('modalAddToken'); $('tokModalInput')?.focus();
  });
  $('tokModalInput')?.addEventListener('input', debounce(async function() {
    const v = this.value.trim().replace(/^Bearer\s+/i, '');
    if (v.length > 20) await fetchTokPreview(v, 'tok');
  }, 600));
  $('saveTokBtn')?.addEventListener('click', saveNewToken);
  $('doBatchBtn')?.addEventListener('click', doBatchImport);
  $('batchFile')?.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => { $('batchText').value = ev.target.result; };
    r.readAsText(f);
  });
  $('reactivateAllBtn')?.addEventListener('click', reactivateAllTokens);
  $('deleteAllBtn')?.addEventListener('click', deleteAllTokens);

  // Accounts
  $('addAccBtn')?.addEventListener('click', accOpenAdd);
  $('accFetchBtn')?.addEventListener('click', async () => {
    const v = $('accTokInput').value.trim().replace(/^Bearer\s+/i, '');
    if (v.length > 10) await fetchTokPreview(v, 'acc');
  });
  $('saveAccBtn')?.addEventListener('click', saveAcc);
  // [#5] Live search — debounced 160ms so typing doesn't rebuild table on every keystroke
  $('accSearch')?.addEventListener('input', debounce(() => {
    _invalidateSearchCache(); // query changed — invalidate before render
    renderAccounts();
  }, 160));
  $('chkAll')?.addEventListener('change', e => { S.accounts.forEach(a => a.sel = e.target.checked); renderAccounts(); });
  // [#2] Renamed: Del Accounts
  $('delSelBtn')?.addEventListener('click', accDeleteSelected);
  // [#4] Start All (shuffled)
  $('startAllBtn')?.addEventListener('click', startAllAutoSend);
  $('stopAllAccBtn')?.addEventListener('click', stopAllAutoSend);
  // [#2] Renamed: Batch Accounts
  $('batchAccBtn')?.addEventListener('click', () => openModal('modalBatch'));
  $('csvBtn')?.addEventListener('click', accExportCSV);

  // Token Health Checker (Accounts tab)
  $('accHealthBtn')    ?.addEventListener('click', accCheckHealth);
  $('accHealthStopBtn')?.addEventListener('click', accCheckHealthStop);

  // Follow Status Checker (Dispatcher channel strip)
  $('followCheckBtn')    ?.addEventListener('click', dispatcherCheckFollowStatus);
  $('followCheckStopBtn')?.addEventListener('click', dispatcherCheckFollowStatusStop);
  $('fsSelectNotBtn')    ?.addEventListener('click', fsSelectAllNotFollowing);
  $('fsRunFollowBtn')    ?.addEventListener('click', fsRunFollowBotForNotFollowing);
  document.querySelectorAll('input[name="fsFilter"]').forEach(r => r.addEventListener('change', fsRenderRows));

  // Follow Bot
  $('followBotToggleBtn')?.addEventListener('click', () => {
    const card = $('followBotCard');
    if (!card) return;
    const showing = card.style.display !== 'none';
    card.style.display = showing ? 'none' : '';
    if (!showing) fbUpdateChannelBanner();
  });
  $('followBotToggle')?.addEventListener('click', () => {
    const body = $('followBotBody');
    const chev = $('followBotChevron');
    if (!body) return;
    const collapsed = body.style.display === 'none';
    body.style.display = collapsed ? 'block' : 'none';
    if (chev) chev.textContent = collapsed ? '▾' : '▸';
  });
  $('fbStartBtn')?.addEventListener('click', followBotRun);

  // Browser selector (Chrome / Firefox) — exclusive toggle, restores last choice
  document.querySelectorAll('.fb-browser-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fb-browser-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      try { localStorage.setItem('flt_fb_browser', btn.dataset.browser || 'chrome'); } catch (_) {}
    });
  });
  try {
    const saved = localStorage.getItem('flt_fb_browser');
    if (saved === 'firefox') {
      document.querySelectorAll('.fb-browser-btn').forEach(b => b.classList.remove('active'));
      $('fbBrowserFirefox')?.classList.add('active');
    }
  } catch (_) {}

  // Select All / Clear buttons in Follow Bot
  $('fbSelectAllBtn')?.addEventListener('click', () => {
    S.accounts.forEach(a => a.sel = true);
    renderAccounts();
    notify(`${S.accounts.length} accounts selected`, 'success');
  });
  $('fbClearSelBtn')?.addEventListener('click', () => {
    S.accounts.forEach(a => a.sel = false);
    renderAccounts();
    notify('Selection cleared', 'info');
  });

  // Click on "N selected" radio label auto-activates selected mode
  $('fbSelectedHint')?.addEventListener('click', () => {
    const radio = $('fbModeSelected');
    if (radio) { radio.checked = true; }
  });

  $('fbStopBtn')?.addEventListener('click', followBotStop);
  $('fbClearLogBtn')?.addEventListener('click', () => { const el=$('fbLog'); if(el) el.innerHTML=''; });

  // ── Stream Watcher ───────────────────────────────────────────────────────
  $('swToggle')?.addEventListener('click', () => {
    const body = $('swBody');
    const head = $('swToggle');
    if (!body) return;
    const open = body.classList.contains('open');
    body.classList.toggle('open', !open);
    if (head) head.classList.toggle('open', !open);
    body.style.display = !open ? 'block' : 'none';
  });
  $('swStartBtn')?.addEventListener('click', streamWatcherRun);
  $('swStopBtn') ?.addEventListener('click', streamWatcherStop);
  $('swClearLogBtn')?.addEventListener('click', () => { const el=$('swLog'); if(el) el.innerHTML=''; });
  // Click the "N selected" pill → switch radio to selected mode automatically
  $('swSelectedHint')?.addEventListener('click', () => {
    const radio = $('swModeSelected'); if (radio) radio.checked = true;
  });
  // Keep the selected-account count + channel banner in sync with main state
  swUpdateChannelBanner();

  // Filter buttons
  document.querySelectorAll('.fil').forEach(b=>b.addEventListener('click',()=>{S.accFilter=b.dataset.f;document.querySelectorAll('.fil').forEach(x=>x.classList.toggle('active',x.dataset.f===b.dataset.f));renderAccounts();}));

  // Send modal
  $('autoSendChk').addEventListener('change',toggleAutoSend);
  $('sendMsgInput').addEventListener('input',function(){$('sendChr').textContent=this.value.length+'/150';});
  $('sendSlotBtn').addEventListener('click', sendPickSlot);
  $('sendMainBtn').addEventListener('click',doSendOrStart);
  $('savePresetBtn').addEventListener('click',savePreset);
  $('importPresetsBtn').addEventListener('click',toggleImportPanel);
  $('cancelImportBtn').addEventListener('click',()=>{$('importPresetsPanel').style.display='none';});
  $('doImportPresetsBtn').addEventListener('click',doImportPresets);
  $('clearPresetsBtn').addEventListener('click',clearAllPresets);
  $('importPresetsText').addEventListener('input',function(){const n=this.value.split('\n').map(l=>l.trim()).filter(Boolean).length;$('importPresetCount').textContent=n+(n===1?' line':' lines');});
  $('stopThisBtn').addEventListener('click',stopThisJob);
  $('stopAllBtn').addEventListener('click',stopAllJobs);
  $('sendCloseBtn').addEventListener('click',closeSendModal);
  $('sendCloseBtn2').addEventListener('click',closeSendModal);
  $('sendConnectBtn').addEventListener('click',connectSendChannel);
  $('sendChannelInput').addEventListener('keydown',e=>{if(e.key==='Enter')connectSendChannel();});

  // Settings
  $('saveSettingsBtn').addEventListener('click',saveSettings);
  $('exportBtn').addEventListener('click',()=>Store.backup());
  $('importBtn').addEventListener('click',()=>Store.restore());
  $('clearAllBtn').addEventListener('click',()=>Store.clearAll());

  // Active Mode
  amRenderAccountSelect();
  amApplySettings();
  $('amStartBtn').addEventListener('click', amStart);
  $('amStopBtn').addEventListener('click',  amStop);

  $('amStopOnBan')?.addEventListener('change', e => { S.am.stopOnBan = e.target.checked; Store.save(); });
  $('amUseEmotes')?.addEventListener('change', e => { S.am.useEmotes = e.target.checked; Store.save(); });
  $('amMultiSend')?.addEventListener('input',  e => { S.am.multiSend = Math.max(1, parseInt(e.target.value)||1); Store.save(); });
  // [MODIFIED] new controls
  $('amDelayMin')?.addEventListener('input',  e => { S.am.delayMin = parseFloat(e.target.value)||2; Store.save(); });
  $('amDelayMax')?.addEventListener('input',  e => { S.am.delayMax = parseFloat(e.target.value)||4; Store.save(); });
  $('amThinking')?.addEventListener('change', e => { S.am.thinkingEffect = e.target.checked; Store.save(); });
  // Clear history log button
  $('amClearHistory')?.addEventListener('click', () => { S.am.history = []; amRenderHistory(); });

  // Live Chat
  $('liveChatConnectBtn')?.addEventListener('click', lcConnect);
  $('liveChatDisconnectBtn')?.addEventListener('click', () => lcDisconnect(true));
  $('liveChatClearBtn')?.addEventListener('click', lcClear);
  $('liveChatSendBtn')?.addEventListener('click', lcSendMessage);
  $('liveChatInput')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); lcSendMessage(); } });
  $('liveChatSendAs')?.addEventListener('change', () => {
    const hint = $('liveChatInputHint');
    const sel  = $('liveChatSendAs');
    const acc  = S.accounts.find(a => a.id === sel?.value);
    if (hint) hint.textContent = acc ? `Sending as ${acc.username}` : 'Select an account above to send messages as';
  });
  // Wire lcMsgLimit selector → update LC_MAX_MSGS live
  $('lcMsgLimit')?.addEventListener('change', e => {
    LC_MAX_MSGS = parseInt(e.target.value) || 100;
    // Trim immediately if current feed exceeds new limit
    const feed = $('liveChatFeed');
    if (feed) while (feed.children.length > LC_MAX_MSGS) feed.removeChild(feed.firstChild);
  });
  lcInitScrollDetection();
  liveChatRenderSendAs();
  lcSetStatus('Disconnected', false);
  aiChatInit();
  amAiInit();

  // Streams
  streamsInit();
  if (window._swInit) window._swInit();

  // Auto-load streams when tab is opened
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.dataset.tab === 'streams' && !StreamsState.allResults.length && !StreamsState.loading) {
        streamsFetch(1);
      }
    });
  });

  notify('FLT v4 ready','success');

  // ── License revocation listener ──────────────────────────────────────────
  // If the periodic background check detects the license is no longer valid,
  // the main process fires 'license-revoked'. We block the UI immediately.
  if (window.electronAPI?.onLicenseRevoked) {
    window.electronAPI.onLicenseRevoked((result) => {
      const msg = (result && result.detail) ? result.detail : 'Your license is no longer valid.';
      // Blur + overlay — user must restart with a valid key
      document.body.style.filter = 'blur(6px) brightness(0.3)';
      document.body.style.pointerEvents = 'none';

      const overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:fixed','inset:0','z-index:99999',
        'display:flex','flex-direction:column',
        'align-items:center','justify-content:center','gap:14px',
        'background:rgba(5,5,14,0.92)',
        'font-family:"JetBrains Mono",monospace',
        'color:#e4e4f8','text-align:center','padding:40px',
      ].join(';');

      overlay.innerHTML = `
        <div style="font-size:36px;color:#ff3a6e"><i class="bi bi-shield-x-fill"></i></div>
        <div style="font-family:'Syne',sans-serif;font-size:17px;font-weight:700;color:#ff3a6e;letter-spacing:0.06em">LICENSE INVALID</div>
        <div style="font-size:11px;color:#9292bc;max-width:320px;line-height:1.7">${msg}</div>
        <div style="font-size:10px;color:#46466e;margin-top:4px">Please restart FLT and enter a valid license key.</div>
      `;
      document.body.appendChild(overlay);
    });
  }

  // ── Multi-platform foundation (Kick / Discord) ──
  // Initialised at the very end so all Kick wiring is already in place.
  try { if (window.Platform && typeof Platform.init === 'function') Platform.init(); } catch(e) { console.error('Platform.init', e); }
  try { if (window.Discord  && typeof Discord.init  === 'function') Discord.init();  } catch(e) { console.error('Discord.init',  e); }

});


/* ══════════════════════════════════════════════════════════════
   PLATFORM SWITCH — Kick / Discord
   Lives at the end of the file. Self-contained namespace.
   Does NOT modify any existing Kick state, function, or render.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const PLATFORM_KEY = 'flt_platform';           // localStorage — UI preference only
  const VALID = ['kick', 'discord', 'kik'];
  const KICK_DEFAULT_TAB    = 'spammer';
  const DISCORD_DEFAULT_TAB = 'discord-dashboard';
  const KIK_DEFAULT_TAB     = 'kik-accounts';

  const Platform = {
    current: 'kick',

    /** Read persisted platform (localStorage); default 'kick'. */
    _readPersisted() {
      try {
        const v = localStorage.getItem(PLATFORM_KEY);
        return VALID.includes(v) ? v : 'kick';
      } catch (_) { return 'kick'; }
    },

    /** Persist platform choice. */
    _writePersisted(p) {
      try { localStorage.setItem(PLATFORM_KEY, p); } catch (_) {}
    },

    /** Set body class so CSS hides off-platform nav buttons + pages. */
    _applyBodyClass() {
      document.body.classList.remove('platform-kick', 'platform-discord', 'platform-kik');
      document.body.classList.add('platform-' + this.current);
    },

    /** Reflect the active button in the switcher UI. */
    _applySwitchUI() {
      const btns = document.querySelectorAll('#platformSwitch .ps-btn');
      btns.forEach(b => b.classList.toggle('active', b.dataset.platform === this.current));
    },

    /**
     * Switch to a tab that belongs to the current platform.
     * Uses existing switchTab() — does NOT reinvent navigation.
     */
    _activateDefaultTab() {
      const targetTab = this.current === 'discord' ? DISCORD_DEFAULT_TAB
                      : this.current === 'kik'     ? KIK_DEFAULT_TAB
                      : KICK_DEFAULT_TAB;
      // Clear .active from ALL pages and nav buttons first so we don't end up with
      // an off-platform page still flagged active.
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

      // Activate the right one.
      if (typeof window.switchTab === 'function') {
        window.switchTab(targetTab);
      } else {
        // Fallback (shouldn't happen — switchTab is defined globally)
        const page = document.getElementById('page-' + targetTab);
        const nav  = document.querySelector('.nav-btn[data-tab="' + targetTab + '"]');
        if (page) page.classList.add('active');
        if (nav)  nav.classList.add('active');
      }
    },

    /**
     * Public — switch platforms.
     * If `silent` is true, no notify() is fired (used at boot).
     */
    set(platform, silent) {
      if (!VALID.includes(platform)) return;
      if (platform === this.current) return;

      this.current = platform;
      this._writePersisted(platform);
      this._applyBodyClass();
      this._applySwitchUI();
      this._activateDefaultTab();

      // If switching INTO Discord, let the Discord module refresh its UI.
      if (platform === 'discord' && window.Discord && typeof Discord.onActivate === 'function') {
        try { Discord.onActivate(); } catch (e) { console.error('Discord.onActivate', e); }
      }

      if (!silent && typeof notify === 'function') {
        const label = platform === 'discord' ? 'Discord'
                    : platform === 'kik'     ? 'Kik'
                    : 'Kick';
        notify('Switched to ' + label + ' mode', 'info');
      }
    },

    /** Convenience accessor. */
    is(platform) { return this.current === platform; },

    /** Init — called once from DOMContentLoaded after Kick wiring is done. */
    init() {
      this.current = this._readPersisted();
      this._applyBodyClass();
      this._applySwitchUI();

      // Wire switcher buttons
      document.querySelectorAll('#platformSwitch .ps-btn').forEach(btn => {
        btn.addEventListener('click', () => this.set(btn.dataset.platform));
      });

      // If we booted into Discord (persisted preference), switch the visible tab.
      // (Kick boots naturally because index.html has data-tab="spammer" .active by default.)
      if (this.current === 'discord') {
        this._activateDefaultTab();
        if (window.Discord && typeof Discord.onActivate === 'function') {
          try { Discord.onActivate(); } catch (e) { console.error('Discord.onActivate', e); }
        }
      }
    },
  };

  // Expose globally
  window.Platform = Platform;
})();

/* ══════════════════════════════════════════════════════════════
   DISCORD — Isolated module
   Lives at the end of the file. Self-contained namespace.
   Does NOT share state with Kick. Does NOT touch S.tokens / S.accounts.
   Persists into the same flt-data.json file via dedicated keys
   (flt_dc_acc, flt_dc_del) using a read-modify-write cycle so the
   Kick keys are never overwritten.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── State (Discord-only) ─────────────────────────────────────
  const DiscordState = {
    accounts:    [],          // { id, token, discordId, username, globalName, avatarUrl, status, added, sel, chromeProfile, note }
    _deleted:    new Set(),   // permanent token blacklist
    filter:      'all',       // 'all' | 'valid' | 'locked' | 'invalid'
    editId:      null,
    fetched:     null,        // last successful Discord API user lookup (for the modal)
    _searchCacheQ: null,
    _searchCache:  new Map(),
    sort:        { col: 'added', dir: -1 }, // col: 'name'|'status'|'added', dir: 1 asc / -1 desc
    _verifyingAll: false,
    _verifyAllStop: false,
  };

  // ── Tiny helpers (do NOT use Kick's $ / esc / notify here to keep boundary clean,
  //    but they are available globally — we just re-reference them defensively) ──
  const _$       = (id) => document.getElementById(id);
  const _esc     = (s)  => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const _initials= (n)  => (n || '?').slice(0, 2).toUpperCase();
  const _fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' }) : '—';
  const _notify  = (msg, type) => {
    if (typeof window.notify === 'function') return window.notify(msg, type || 'info');
    console.log('[discord]', type || 'info', msg);
  };
  const _copy    = (t) => {
    if (typeof window.copyText === 'function') return window.copyText(t);
    navigator.clipboard.writeText(t).then(() => _notify('Copied!', 'success')).catch(() => _notify('Copy failed', 'error'));
  };
  const _maskTok  = (t) => (!t || t.length < 10) ? '—' : t.slice(0, 6) + '••••' + t.slice(-4);
  const _setField = (id, val) => { const el = _$(id); if (el) el.value = val; };
  const _openModal  = (id) => { const el = _$(id); if (el) el.classList.add('open'); };
  const _closeModal = (id) => { const el = _$(id); if (el) el.classList.remove('open'); };
  const _debounce   = (fn, ms) => { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; };

  const DC_STATUS_LABEL = { valid: 'VALID', locked: 'LOCKED', pending: 'PENDING' };

  /** Apply a DcAPI.getMe() result onto an account object in-place. */
  function _applyVerifyResult(acc, res) {
    if (res && !res._error && res.id) {
      acc.discordId  = res.id          || acc.discordId;
      acc.username   = res.username    || acc.username;
      acc.globalName = res.global_name || res.username || acc.globalName;
      acc.avatarUrl  = res.avatar_url  || acc.avatarUrl;
      acc.status     = 'valid';
    } else {
      acc.status = (res && res._status === 403) ? 'locked' : 'invalid';
    }
  }


  // ── Discord API wrapper ──────────────────────────────────────
  const DcAPI = {
    _base: 'https://discord.com/api/v10',
    _h(token) {
      return {
        // Discord user tokens are sent raw in the Authorization header
        // (no "Bearer " prefix — that is for OAuth2 tokens, not user tokens).
        'Authorization': token,
        'Content-Type':  'application/json',
      };
    },

    /** Fetch /users/@me. Returns user object or { _error, _status }. */
    async getMe(token) {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(this._base + '/users/@me', {
          method:  'GET',
          headers: this._h(token),
          signal:  ctrl.signal,
        });
        clearTimeout(tid);
        if (!r.ok) return { _error: true, _status: r.status };
        const d = await r.json();
        if (d && d.id && d.avatar) {
          // Animated avatars start with 'a_'
          const ext = String(d.avatar).startsWith('a_') ? 'gif' : 'png';
          d.avatar_url = `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.${ext}?size=128`;
        }
        return d || { _error: true, _status: 0 };
      } catch (_) {
        clearTimeout(tid);
        return { _error: true, _status: 0 };
      }
    },
  };


  // ── Persistence (file-backed, isolated keys) ─────────────────
  // Read-modify-write: read full store, mutate ONLY Discord keys, write back.
  // This guarantees Kick keys (flt_tok / flt_acc / flt_drf / etc.) are never overwritten.
  async function persistSave() {
    const payload = {
      flt_dc_acc: DiscordState.accounts,
      flt_dc_del: [...DiscordState._deleted],
    };
    try {
      if (window.electronAPI && window.electronAPI.storeLoad && window.electronAPI.storeSave) {
        const existing = (await window.electronAPI.storeLoad()) || {};
        const merged = Object.assign({}, existing, payload);
        await window.electronAPI.storeSave(merged);
      } else {
        try { localStorage.setItem('flt_dc_acc', JSON.stringify(payload.flt_dc_acc)); } catch (_) {}
        try { localStorage.setItem('flt_dc_del', JSON.stringify(payload.flt_dc_del)); } catch (_) {}
      }
    } catch (e) { console.error('Discord persistSave', e); }
  }

  async function persistLoad() {
    try {
      let d = null;
      if (window.electronAPI && window.electronAPI.storeLoad) {
        d = await window.electronAPI.storeLoad();
      }
      if (d) {
        DiscordState.accounts = Array.isArray(d.flt_dc_acc) ? d.flt_dc_acc : [];
        DiscordState._deleted = new Set(Array.isArray(d.flt_dc_del) ? d.flt_dc_del : []);
      } else {
        try { DiscordState.accounts = JSON.parse(localStorage.getItem('flt_dc_acc') || '[]'); } catch (_) { DiscordState.accounts = []; }
        try { DiscordState._deleted = new Set(JSON.parse(localStorage.getItem('flt_dc_del') || '[]')); } catch (_) { DiscordState._deleted = new Set(); }
      }
      // Ensure sel defaults
      DiscordState.accounts.forEach(a => { a.sel = false; });
    } catch (e) { console.error('Discord persistLoad', e); }
  }


  // ── Search cache (Discord-only — does NOT touch _accSearchCache) ──
  function buildSearchCache() {
    DiscordState._searchCache.clear();
    for (const a of DiscordState.accounts) {
      const blob = [
        a.username   || '',
        a.globalName || '',
        a.discordId  || '',
        a.status     || '',
      ].join('\x00').toLowerCase();
      DiscordState._searchCache.set(a.id, blob);
    }
    DiscordState._searchCacheQ = (_$('dcSearch')?.value || '').toLowerCase().trim();
  }
  function invalidateSearchCache() { DiscordState._searchCacheQ = null; }

  function passesFilter(a, q) {
    const st = a.status || 'invalid';
    if (DiscordState.filter === 'valid'   && st !== 'valid')   return false;
    if (DiscordState.filter === 'locked'  && st !== 'locked')  return false;
    if (DiscordState.filter === 'invalid' && st !== 'invalid') return false;
    if (!q) return true;
    if (DiscordState._searchCacheQ !== q) buildSearchCache();
    const blob = DiscordState._searchCache.get(a.id);
    return blob !== undefined && blob.includes(q);
  }

  function applySorted(list) {
    const { col, dir } = DiscordState.sort;
    return [...list].sort((a, b) => {
      let av, bv;
      if      (col === 'name')   { av = (a.globalName || a.username || '').toLowerCase(); bv = (b.globalName || b.username || '').toLowerCase(); }
      else if (col === 'status') { av = a.status || ''; bv = b.status || ''; }
      else                       { av = a.added  || 0; bv = b.added  || 0; }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }

  function updateSortIcons() {
    ['name', 'status', 'added'].forEach(col => {
      const el = _$('dcSort' + col.charAt(0).toUpperCase() + col.slice(1));
      if (!el) return;
      if (DiscordState.sort.col !== col) { el.textContent = ''; return; }
      el.textContent = DiscordState.sort.dir === 1 ? '↑' : '↓';
    });
  }


  // ── Rendering ────────────────────────────────────────────────
  function renderAccounts() {
    const tbody = _$('dcAccBody');
    const empty = _$('dcAccEmpty');
    if (!tbody) return;

    const q   = (_$('dcSearch')?.value || '').toLowerCase().trim();
    const all = DiscordState.accounts;

    if (q !== DiscordState._searchCacheQ) buildSearchCache();
    const filtered  = applySorted(all.filter(a => passesFilter(a, q)));

    const totalCount = all.length;
    let validCount = 0, lockedCount = 0, invalidCount = 0;
    for (const a of all) {
      if      (a.status === 'valid')  validCount++;
      else if (a.status === 'locked') lockedCount++;
      else                            invalidCount++;
    }

    const set = (id, n) => { const el = _$(id); if (el) el.textContent = String(n); };
    set('dcFAll',           totalCount);
    set('dcFValid',         validCount);
    set('dcFLocked',        lockedCount);
    set('dcFInvalid',       invalidCount);
    set('dcQsTotal',        totalCount);
    set('dcQsValid',        validCount);
    set('dcQsLocked',       lockedCount);
    set('dcQsInvalid',      invalidCount);
    set('dcDashAccTotal',   totalCount);
    set('dcDashAccValid',   validCount);
    set('dcDashAccInvalid', invalidCount);

    const navBadge = _$('dcAccCount');
    if (navBadge) {
      navBadge.textContent = String(totalCount);
      navBadge.classList.toggle('on', totalCount > 0);
    }

    if (empty) empty.style.display = filtered.length ? 'none' : 'flex';

    // ── Fingerprint guard ─ skip rebuild if visible row data is unchanged ──
    const _fp = filtered.map(a =>
      `${a.id}:${a.status}:${+!!a.sel}:${a.username||''}:${a.globalName||''}:${a.avatarUrl||''}:${a.note||''}:${a.chromeProfile||''}`
    ).join('|') + `|${DiscordState.sort.col}:${DiscordState.sort.dir}|q:${q}`;
    if (tbody._dc_fp === _fp) { updateSortIcons(); updateSelCount(); return; }
    tbody._dc_fp = _fp;

    tbody.innerHTML = filtered.map(a => {
      const st      = a.status || 'invalid';
      const stLabel = DC_STATUS_LABEL[st] || 'INVALID';
      const dispName= _esc(a.globalName || a.username || '—');
      const userName= a.username ? _esc('@' + a.username) : '';
      const avHtml  = a.avatarUrl
        ? `<img src="${_esc(a.avatarUrl)}" alt="" onerror="this.style.display='none'">`
        : `<span class="dc-av-initials">${_initials(a.username || a.globalName || '?')}</span>`;
      const selAttr = a.sel ? 'checked' : '';
      const noteTag = a.note       ? `<span class="dc-note-tag">${_esc(a.note)}</span>` : '';
      const chromeSub = a.chromeProfile ? `<div class="dc-acc-sub dc-chrome-sub"><i class="bi bi-display"></i> ${_esc(a.chromeProfile)}</div>` : '';
      const lockBadge = st === 'locked' ? '<span class="dc-av-lock"><i class="bi bi-lock-fill"></i></span>' : '';

      return `<tr data-dcid="${_esc(a.id)}" class="${a.sel ? 'sel' : ''}${st === 'locked' ? ' dc-row-locked' : ''}">
        <td><input type="checkbox" class="chk dc-row-chk" ${selAttr}></td>
        <td>
          <div class="dc-acc-info">
            <div class="dc-av-wrap">${avHtml}${lockBadge}</div>
            <div>
              <div class="dc-acc-name">${dispName}${noteTag}</div>
              ${userName ? `<div class="dc-acc-sub">${userName}</div>` : ''}
              ${a.discordId ? `<div class="dc-acc-sub">ID: ${_esc(String(a.discordId))}</div>` : ''}
              ${chromeSub}
            </div>
          </div>
        </td>
        <td>
          <span class="dc-tok-mask">${_maskTok(a.token)}</span>
          <button class="dc-copy-btn" data-action="copy">COPY</button>
        </td>
        <td><span class="dc-badge ${st}">${stLabel}</span></td>
        <td class="dc-td-date">${_fmtDate(a.added)}</td>
        <td>
          <div class="dc-act-btns">
            <button class="dc-ic-btn edit"   data-action="edit"   title="Edit account"><i class="bi bi-pencil"></i></button>
            <button class="dc-ic-btn verify" data-action="verify" title="Re-verify token"><i class="bi bi-arrow-clockwise"></i></button>
            <button class="dc-ic-btn delete" data-action="delete" title="Delete"><i class="bi bi-x-lg"></i></button>
          </div>
        </td>
      </tr>`;
    }).join('');

    updateSortIcons();
    updateSelCount();
  }

  function updateSelCount() {
    const selCount = DiscordState.accounts.filter(a => a.sel).length;
    const show = selCount > 0 ? '' : 'none';
    const badge = _$('dcAccSelCount');
    if (badge) { badge.textContent = selCount + ' selected'; badge.style.display = show; }
    ['dcDelSelBtn', 'dcVerifySelBtn', 'dcExportSelBtn'].forEach(id => {
      const el = _$(id); if (el) el.style.display = show;
    });
  }


  // ── CRUD ─────────────────────────────────────────────────────
  function openAddModal() {
    DiscordState.editId  = null;
    DiscordState.fetched = null;

    const title    = _$('dcModalTitle');
    const tokInput = _$('dcTokInput');
    const preview  = _$('dcAccPreview');
    const status   = _$('dcFetchStatus');
    if (title)    title.textContent = 'Add Discord Account';
    if (tokInput) { tokInput.value = ''; tokInput.type = 'password'; }
    if (preview)  preview.style.display = 'none';
    if (status)   { status.textContent = ''; status.className = 'fetch-st'; }
    _setField('dcChromeProfile', '');
    _setField('dcNote', '');

    _openModal('modalDcAdd');
    tokInput?.focus();
  }

  function openEditModal(id) {
    const a = DiscordState.accounts.find(x => x.id === id);
    if (!a) return;
    DiscordState.editId  = id;
    DiscordState.fetched = {
      id: a.discordId, username: a.username, global_name: a.globalName, avatar_url: a.avatarUrl,
    };
    const title    = _$('dcModalTitle');
    const tokInput = _$('dcTokInput');
    if (title)    title.textContent = 'Edit Discord Account';
    if (tokInput) { tokInput.value = a.token || ''; tokInput.type = 'text'; }

    const av     = _$('dcAvPreview');
    const nameEl = _$('dcNamePreview');
    const tagEl  = _$('dcTagPreview');
    const idEl   = _$('dcIdPreview');
    if (av)     av.src = a.avatarUrl || '';
    if (nameEl) nameEl.textContent = a.globalName || a.username || '—';
    if (tagEl)  tagEl.textContent  = a.username ? '@' + a.username : '';
    if (idEl)   idEl.textContent   = 'ID: ' + (a.discordId || '');
    const preview = _$('dcAccPreview');
    if (preview) preview.style.display = 'flex';
    const status = _$('dcFetchStatus');
    if (status)  { status.textContent = ''; status.className = 'fetch-st'; }
    _setField('dcChromeProfile', a.chromeProfile || '');
    _setField('dcNote', a.note || '');

    _openModal('modalDcAdd');
  }

  /** Live preview fetch as user types/pastes into the Add modal. */
  async function fetchPreview(token) {
    const st = _$('dcFetchStatus');
    const pr = _$('dcAccPreview');
    if (st) { st.textContent = 'Fetching…'; st.className = 'fetch-st ld'; }
    if (pr) pr.style.display = 'none';

    const res = await DcAPI.getMe(token);
    if (res && !res._error && res.id) {
      DiscordState.fetched = res;
      const av    = _$('dcAvPreview');
      const name  = _$('dcNamePreview');
      const tag   = _$('dcTagPreview');
      const idEl  = _$('dcIdPreview');
      if (av)   av.src = res.avatar_url || '';
      if (name) name.textContent = res.global_name || res.username || '—';
      if (tag)  tag.textContent  = res.username ? '@' + res.username : '';
      if (idEl) idEl.textContent = 'ID: ' + (res.id || '');
      if (pr)   pr.style.display = 'flex';
      if (st) {
        st.textContent = '✓ Found: ' + (res.global_name || res.username);
        st.className   = 'fetch-st ok';
      }
    } else {
      DiscordState.fetched = null;
      if (pr) pr.style.display = 'none';
      if (st) {
        const label = res && res._status === 401 ? '✗ Token unauthorized (invalid or expired)'
                    : res && res._status === 403 ? '✗ Account locked / disabled'
                    : '✗ Token invalid or unreachable';
        st.textContent = label;
        st.className   = 'fetch-st err';
      }
    }
  }

  /** Save (add OR edit). Validates against Discord API before committing. */
  async function saveAccount() {
    const tokInput = _$('dcTokInput');
    const token = (tokInput?.value || '').trim();
    if (!token) { _notify('Token required', 'error'); return; }

    // Force a fresh validation if no preview is cached for this token
    if (!DiscordState.fetched) await fetchPreview(token);

    const user = DiscordState.fetched;
    if (!user || !user.id) {
      _notify('Could not verify token — not saved', 'error');
      return;
    }

    const data = {
      username:      user.username   || '',
      globalName:    user.global_name || user.username || ('User_' + token.slice(0, 6)),
      discordId:     user.id         || '',
      avatarUrl:     user.avatar_url || '',
      token:         token,
      status:        'valid',
      chromeProfile: (_$('dcChromeProfile')?.value || '').trim(),
      note:          (_$('dcNote')?.value           || '').trim(),
    };

    if (DiscordState.editId) {
      const idx = DiscordState.accounts.findIndex(a => a.id === DiscordState.editId);
      if (idx >= 0) {
        DiscordState.accounts[idx] = Object.assign({}, DiscordState.accounts[idx], data);
        _notify('Discord account updated', 'success');
      }
    } else {
      if (DiscordState.accounts.some(a => a.token === token)) {
        _notify('Token already exists', 'error');
        return;
      }
      data.id    = 'dc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      data.added = Date.now();
      data.sel   = false;
      DiscordState.accounts.push(data);
      _notify('Discord account added: ' + data.globalName, 'success');
    }

    invalidateSearchCache();
    await persistSave();
    renderAccounts();
    _closeModal('modalDcAdd');
  }

  /** Batch import — validates each token in small parallel groups. */
  async function batchImport() {
    const textEl = _$('dcBatchText');
    const text = (textEl?.value || '').trim();
    if (!text) { _notify('Paste tokens first', 'error'); return; }

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const prog      = _$('dcBatchStatus');
    const progWrap  = _$('dcBatchProg');
    const fill      = _$('dcBatchFill');
    const progTxt   = _$('dcBatchProgText');
    const savBtn    = _$('dcDoBatchBtn');

    if (savBtn) savBtn.disabled = true;
    if (progWrap) progWrap.style.display = '';
    if (prog) { prog.textContent = ''; prog.className = 'fetch-st'; }

    let added = 0, skipped = 0, invalid = 0, done = 0;
    const total = lines.length;
    const BATCH = 3;
    const existingTokens = new Set(DiscordState.accounts.map(a => a.token));

    for (let i = 0; i < total; i += BATCH) {
      const batch = lines.slice(i, i + BATCH);
      await Promise.all(batch.map(async token => {
        if (existingTokens.has(token)) { skipped++; done++; return; }
        const acc = {
          id: 'dc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          token, discordId: '', username: '', globalName: 'Unknown',
          avatarUrl: '', status: 'invalid', added: Date.now(),
          sel: false, chromeProfile: '', note: '',
        };
        const res = await DcAPI.getMe(token);
        _applyVerifyResult(acc, res);
        existingTokens.add(token);
        DiscordState.accounts.push(acc);
        if (acc.status === 'valid') added++; else invalid++;
        done++;
      }));
      const pct = Math.round((done / total) * 100);
      if (fill)    fill.style.width    = pct + '%';
      if (progTxt) progTxt.textContent = `${done} / ${total}`;
    }

    invalidateSearchCache();
    await persistSave();
    renderAccounts();
    _closeModal('modalDcBatch');
    if (textEl)   textEl.value = '';
    if (progWrap) progWrap.style.display = 'none';
    if (fill)     fill.style.width = '0%';
    if (savBtn)   savBtn.disabled = false;
    _notify(`Imported: ${added} valid · ${invalid} invalid · ${skipped} duplicates`, 'success');
  }

  /** Re-verify a single token. */
  async function verifyAccount(id) {
    const a = DiscordState.accounts.find(x => x.id === id);
    if (!a) return;
    _notify('Verifying ' + (a.globalName || a.username || 'account') + '…', 'info');
    const res = await DcAPI.getMe(a.token);
    _applyVerifyResult(a, res);
    _notify((a.globalName || 'Account') + ': ' + (DC_STATUS_LABEL[a.status] || 'INVALID'),
            a.status === 'valid' ? 'success' : 'error');
    invalidateSearchCache();
    await persistSave();
    renderAccounts();
  }

  /** Delete one account (permanent — token added to _deleted blacklist). */
  async function deleteAccount(id) {
    const a = DiscordState.accounts.find(x => x.id === id);
    if (!a) return;
    if (!confirm(`Delete "${a.globalName || a.username || '?'}"?`)) return;
    if (a.token) DiscordState._deleted.add(a.token);
    DiscordState.accounts = DiscordState.accounts.filter(x => x.id !== id);
    invalidateSearchCache();
    await persistSave();
    renderAccounts();
    _notify('Account deleted', 'info');
  }

  /** Delete all currently selected accounts. */
  async function deleteSelected() {
    const sel = DiscordState.accounts.filter(a => a.sel);
    if (!sel.length) return;
    if (!confirm(`Delete ${sel.length} selected account(s)?`)) return;
    sel.forEach(a => { if (a.token) DiscordState._deleted.add(a.token); });
    const ids = new Set(sel.map(a => a.id));
    DiscordState.accounts = DiscordState.accounts.filter(a => !ids.has(a.id));
    invalidateSearchCache();
    await persistSave();
    renderAccounts();
    _notify(`Deleted ${sel.length} account(s)`, 'info');
  }


  // ── Verify All / Export ───────────────────────────────────────

  async function verifyAll(overrideList) {
    if (DiscordState._verifyingAll) return;
    const q = (_$('dcSearch')?.value || '').toLowerCase().trim();
    const accounts = overrideList
      ? [...overrideList]
      : DiscordState.accounts.filter(a => passesFilter(a, q));
    if (!accounts.length) { _notify('No accounts to verify', 'info'); return; }

    DiscordState._verifyingAll  = true;
    DiscordState._verifyAllStop = false;

    const progWrap = _$('dcVerifyProgress');
    const fill     = _$('dcVpFill');
    const text     = _$('dcVpText');
    const vaBtn    = _$('dcVerifyAllBtn');
    if (progWrap) progWrap.style.display = 'flex';
    if (fill)     fill.style.width = '0%';
    if (vaBtn)    vaBtn.disabled = true;

    const total = accounts.length;
    let done = 0, batchesSinceRender = 0;
    const CONCUR = 3;

    try {
      for (let i = 0; i < total && !DiscordState._verifyAllStop; i += CONCUR) {
        const batch = accounts.slice(i, i + CONCUR);
        await Promise.all(batch.map(async acc => {
          if (DiscordState._verifyAllStop) return;
          _applyVerifyResult(acc, await DcAPI.getMe(acc.token));
          done++;
          const pct = Math.round((done / total) * 100);
          if (fill) fill.style.width = pct + '%';
          if (text) text.textContent = `Verifying ${done} / ${total}…`;
        }));
        // Re-render every 5 batches (15 accounts) to avoid per-row repaint storms
        if (++batchesSinceRender >= 5) {
          batchesSinceRender = 0;
          invalidateSearchCache();
          renderAccounts();
        }
      }
    } finally {
      DiscordState._verifyingAll = false;
      if (progWrap) progWrap.style.display = 'none';
      if (vaBtn)    vaBtn.disabled = false;
    }

    invalidateSearchCache();
    await persistSave();
    renderAccounts();
    const verb = DiscordState._verifyAllStop ? 'Stopped after' : 'Done —';
    _notify(`${verb} verified ${done} / ${total} accounts`, 'success');
  }

  function exportTokens(selOnly) {
    const q = (_$('dcSearch')?.value || '').toLowerCase().trim();
    const accounts = selOnly
      ? DiscordState.accounts.filter(a => a.sel)
      : DiscordState.accounts.filter(a => passesFilter(a, q));
    if (!accounts.length) { _notify('No accounts to export', 'info'); return; }
    const tokens = accounts.map(a => a.token).filter(Boolean).join('\n');
    _copy(tokens);
    _notify(`Copied ${accounts.length} token(s) to clipboard`, 'success');
  }

  // ── Wiring (event listeners — runs once at init) ─────────────
  function wire() {
    // Nav-button refresh: when the user clicks the Discord Accounts/Dashboard
    // nav button, re-render so badges & rows are fresh. We hook BEFORE the
    // existing switchTab() runs (it was wired in DOMContentLoaded earlier and
    // listens for the same click — both run independently).
    document.querySelectorAll('.nav-btn[data-platform="discord"]').forEach(btn => {
      btn.addEventListener('click', () => {
        // Defer to the next frame so switchTab() has already swapped .active classes
        requestAnimationFrame(() => renderAccounts());
      });
    });

    // Add / Batch / Export / Verify All
    _$('dcAddAccBtn')?.addEventListener('click', openAddModal);
    _$('dcBatchAccBtn')?.addEventListener('click', () => {
      const t = _$('dcBatchText'); if (t) t.value = '';
      const s = _$('dcBatchStatus'); if (s) { s.textContent = ''; s.className = 'fetch-st'; }
      const lc = _$('dcBatchLineCount'); if (lc) lc.textContent = '0 tokens';
      _openModal('modalDcBatch');
    });
    _$('dcVerifyAllBtn')?.addEventListener('click', () => verifyAll());
    _$('dcVpStopBtn')?.addEventListener('click', () => { DiscordState._verifyAllStop = true; });
    _$('dcExportBtn')?.addEventListener('click', () => exportTokens(false));
    _$('dcVerifySelBtn')?.addEventListener('click', () => {
      verifyAll(DiscordState.accounts.filter(a => a.sel));
    });
    _$('dcExportSelBtn')?.addEventListener('click', () => exportTokens(true));

    // Modal — fetch on input (debounced)
    _$('dcTokInput')?.addEventListener('input', _debounce(async function () {
      const v = (this.value || '').trim();
      if (v.length > 20) await fetchPreview(v);
    }, 600));
    _$('dcFetchBtn')?.addEventListener('click', async () => {
      const v = (_$('dcTokInput')?.value || '').trim();
      if (v.length > 5) await fetchPreview(v);
    });

    // Modal — Save / Batch
    _$('dcSaveAccBtn')?.addEventListener('click', saveAccount);
    _$('dcDoBatchBtn')?.addEventListener('click', batchImport);

    // Filter tabs
    document.querySelectorAll('.dc-fil').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.dc-fil').forEach(b => b.classList.toggle('active', b === btn));
        DiscordState.filter = btn.dataset.f || 'all';
        renderAccounts();
      });
    });

    // Search — debounced to avoid re-rendering on every keystroke
    _$('dcSearch')?.addEventListener('input', _debounce(renderAccounts, 160));

    // Check-all
    _$('dcChkAll')?.addEventListener('change', (e) => {
      const on = !!e.target.checked;
      DiscordState.accounts.forEach(a => { a.sel = on; });
      renderAccounts();
    });

    // Delete selected
    _$('dcDelSelBtn')?.addEventListener('click', deleteSelected);

    // Batch textarea — live line count
    _$('dcBatchText')?.addEventListener('input', function () {
      const lc = _$('dcBatchLineCount');
      if (!lc) return;
      const n = (this.value || '').split('\n').map(l => l.trim()).filter(Boolean).length;
      lc.textContent = n + ' token' + (n !== 1 ? 's' : '');
    });

    // Sort column headers
    document.querySelectorAll('.dc-th-sort').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (DiscordState.sort.col === col) {
          DiscordState.sort.dir *= -1;
        } else {
          DiscordState.sort.col = col;
          DiscordState.sort.dir = col === 'added' ? -1 : 1;
        }
        renderAccounts();
      });
    });

    // Delegated clicks inside the table
    const tbody = _$('dcAccBody');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-dcid]');
        if (!tr) return;
        const id = tr.dataset.dcid;

        // Row checkbox
        if (e.target.classList.contains('dc-row-chk')) {
          const a = DiscordState.accounts.find(x => x.id === id);
          if (a) { a.sel = !!e.target.checked; tr.classList.toggle('sel', a.sel); updateSelCount(); }
          return;
        }

        const actionBtn = e.target.closest('[data-action]');
        if (!actionBtn) return;
        const action = actionBtn.dataset.action;
        if (action === 'edit')   return openEditModal(id);
        if (action === 'verify') return verifyAccount(id);
        if (action === 'delete') return deleteAccount(id);
        if (action === 'copy') {
          const a = DiscordState.accounts.find(x => x.id === id);
          if (a) _copy(a.token);
          return;
        }
      });
    }
  }


  // ── Public surface ───────────────────────────────────────────
  const Discord = {
    state: DiscordState,
    api:   DcAPI,

    async init() {
      await persistLoad();
      wire();
      // Render once at boot so badges in the Dashboard are accurate
      // even before the user opens the Accounts page.
      renderAccounts();
    },

    /** Called by Platform.set('discord') — refresh UI for the visible page. */
    onActivate() {
      renderAccounts();
    },

    // Expose for future Discord features / debugging
    renderAccounts,
    persistSave,
    persistLoad,
  };

  window.Discord = Discord;
})();


/* ══════════════════════════════════════════════════════════════
   DISCORD LOGIN / SESSION INJECTION — extends window.Discord
   Fully append-only. Does not modify the existing Discord module.
   Hooks Discord.renderAccounts via decorator wrapping.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (!window.Discord) {
    console.warn('[FLT-DC] DiscordLogin: window.Discord missing — skipping.');
    return;
  }

  // ── Session state (Discord-only, NOT in Kick state) ───────────
  // Stored in script-module-local memory + persisted under flt_dc_sessions.
  // Per accountId we record:
  //   loginStatus:  'unknown' | 'pending' | 'valid' | 'invalid'
  //   open:         boolean (window currently open in main process)
  //   lastLoginAt:  timestamp
  //   verifyStatus: last HTTP status from /users/@me at login time
  //   lastError:    last error string (if any)
  const DiscordSessions = {
    map: new Map(),        // Map<accountId, sessionEntry>
    pending: new Set(),    // accountIds currently waiting on login result

    get(id) { return this.map.get(id) || null; },
    set(id, entry) {
      this.map.set(id, Object.assign({}, this.map.get(id) || {}, entry));
      return this.map.get(id);
    },
    delete(id) { this.map.delete(id); this.pending.delete(id); },
    all() { return Array.from(this.map.entries()).map(([id, v]) => Object.assign({ id }, v)); },
  };

  // Expose for debugging / future modules
  window.Discord.sessions = DiscordSessions;

  // ── Helpers ──────────────────────────────────────────────────
  const _$       = (id) => document.getElementById(id);
  const _esc     = (s)  => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const _notify  = (m, t) => {
    if (typeof window.notify === 'function') return window.notify(m, t || 'info');
    console.log('[discord-login]', t || 'info', m);
  };
  const _debounce = (fn, ms) => {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fn.apply(this, args); }, ms);
    };
  };
  const _fmtTime = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  };

  // ── Persistence: separate key flt_dc_sessions, read-modify-write ──
  async function persistSessionsSave() {
    try {
      // Plain object form for JSON
      const obj = {};
      for (const [id, entry] of DiscordSessions.map.entries()) {
        obj[id] = {
          loginStatus:  entry.loginStatus  || 'unknown',
          lastLoginAt:  entry.lastLoginAt  || 0,
          verifyStatus: entry.verifyStatus || 0,
          // intentionally NOT persisting `open` — that is live-only
        };
      }
      if (window.electronAPI && window.electronAPI.storeLoad && window.electronAPI.storeSave) {
        const existing = (await window.electronAPI.storeLoad()) || {};
        const merged = Object.assign({}, existing, { flt_dc_sessions: obj });
        await window.electronAPI.storeSave(merged);
      } else {
        try { localStorage.setItem('flt_dc_sessions', JSON.stringify(obj)); } catch (_) {}
      }
    } catch (e) { console.error('[FLT-DC] persistSessionsSave', e); }
  }

  async function persistSessionsLoad() {
    try {
      let raw = null;
      if (window.electronAPI && window.electronAPI.storeLoad) {
        const d = await window.electronAPI.storeLoad();
        raw = d && d.flt_dc_sessions;
      } else {
        try { raw = JSON.parse(localStorage.getItem('flt_dc_sessions') || '{}'); } catch (_) {}
      }
      if (raw && typeof raw === 'object') {
        DiscordSessions.map.clear();
        for (const id of Object.keys(raw)) {
          DiscordSessions.map.set(id, {
            loginStatus:  raw[id].loginStatus  || 'unknown',
            lastLoginAt:  raw[id].lastLoginAt  || 0,
            verifyStatus: raw[id].verifyStatus || 0,
            open:         false,
          });
        }
      }
    } catch (e) { console.error('[FLT-DC] persistSessionsLoad', e); }
  }

  // Debounced persistence — avoids spamming disk during rapid updates
  const _persistSessionsDebounced = _debounce(persistSessionsSave, 350);


  // ── Row decorator — adds login UI to a single row ─────────────
  // Called for every row after each renderAccounts(). Idempotent.
  function decorateRow(tr) {
    if (!tr) return;
    const id = tr.dataset.dcid;
    if (!id) return;

    const sess = DiscordSessions.get(id) || {};
    const acc  = window.Discord.state.accounts.find(a => a.id === id);
    if (!acc) return;

    // ── Augment STATUS cell with a session badge ─────
    const statusTd = tr.children[3]; // [chk, account, token, status, added, actions]
    if (statusTd && !statusTd.querySelector('.dc-sess-badge')) {
      const sb = document.createElement('span');
      sb.className = 'dc-sess-badge';
      statusTd.appendChild(document.createTextNode(' '));
      statusTd.appendChild(sb);
    }
    const sb = statusTd ? statusTd.querySelector('.dc-sess-badge') : null;
    if (sb) {
      let label, cls;
      if (sess.open)                       { label = 'LOGGED';  cls = 'logged';  }
      else if (sess.loginStatus === 'pending')  { label = 'LOGIN…';  cls = 'pending'; }
      else if (sess.loginStatus === 'invalid')  { label = 'AUTH-X';  cls = 'invalid'; }
      else if (sess.loginStatus === 'valid')    { label = 'READY';   cls = 'ready';   }
      else                                       { label = '';        cls = ''; }
      sb.className = 'dc-sess-badge' + (cls ? ' ' + cls : '');
      sb.textContent = label;
      sb.title = sess.lastLoginAt
        ? 'Last login: ' + new Date(sess.lastLoginAt).toLocaleString()
        : 'Never logged in';
      sb.style.display = label ? '' : 'none';
    }

    // ── Augment ACTIONS cell with LOGIN / OPEN / LOGOUT buttons ────
    const actTd = tr.children[5];
    if (actTd) {
      let btnWrap = actTd.querySelector('.dc-act-btns');
      if (btnWrap && !btnWrap.querySelector('[data-action="login"]')) {
        // Insert LOGIN button BEFORE the existing Verify button
        const verifyBtn = btnWrap.querySelector('[data-action="verify"]');
        const loginBtn = document.createElement('button');
        loginBtn.className = 'dc-ic-btn login';
        loginBtn.dataset.action = 'login';
        loginBtn.title = 'Open authenticated session';
        loginBtn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Login';
        if (verifyBtn) btnWrap.insertBefore(loginBtn, verifyBtn);
        else           btnWrap.appendChild(loginBtn);
      }
      // Update LOGIN button label depending on session state
      const loginBtn = btnWrap ? btnWrap.querySelector('[data-action="login"]') : null;
      if (loginBtn) {
        if (sess.open) {
          loginBtn.innerHTML = '<i class="bi bi-window"></i> Open';
          loginBtn.dataset.action = 'open';
          loginBtn.title = 'Bring Discord window to front';
          loginBtn.classList.add('open');
          loginBtn.classList.remove('login', 'pending');
        } else if (sess.loginStatus === 'pending' || DiscordSessions.pending.has(id)) {
          loginBtn.innerHTML = '<i class="bi bi-hourglass-split"></i>';
          loginBtn.dataset.action = 'login';
          loginBtn.title = 'Logging in…';
          loginBtn.disabled = true;
          loginBtn.classList.add('pending');
          loginBtn.classList.remove('open');
        } else {
          loginBtn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Login';
          loginBtn.dataset.action = 'login';
          loginBtn.title = 'Open authenticated session';
          loginBtn.disabled = false;
          loginBtn.classList.remove('open', 'pending');
          loginBtn.classList.add('login');
        }
      }
    }

    // ── Update row class for "open" indicator (subtle row tint) ──
    tr.classList.toggle('dc-row-open', !!sess.open);
  }

  /** Decorate every row currently in the table. */
  function decorateAllRows() {
    const tbody = _$('dcAccBody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr[data-dcid]');
    for (const tr of rows) decorateRow(tr);
  }

  /** Update a single row by accountId — no full re-render. */
  function updateRow(accountId) {
    const tr = document.querySelector('tr[data-dcid="' + CSS.escape(accountId) + '"]');
    if (!tr) return;
    decorateRow(tr);
  }

  // ── Auto-decorate via MutationObserver ────────────────────────
  // The internal `renderAccounts()` inside the Discord IIFE uses a closure
  // reference, so we cannot reliably patch it from outside. Instead we watch
  // the tbody for childList mutations — every full re-render triggers our
  // decorator. Cheap, decoupled, idempotent.
  let _decoratorObserver = null;
  function startDecoratorObserver() {
    const tbody = _$('dcAccBody');
    if (!tbody || _decoratorObserver) return;
    _decoratorObserver = new MutationObserver(() => {
      try { decorateAllRows(); } catch (e) { console.error('[FLT-DC] decoratorObserver', e); }
    });
    _decoratorObserver.observe(tbody, { childList: true });
  }


  // ── Action: trigger login for an account ──────────────────────
  function triggerLogin(accountId) {
    if (!accountId) return;
    if (DiscordSessions.pending.has(accountId)) {
      _notify('Login already in progress', 'info');
      return;
    }
    const acc = window.Discord.state.accounts.find(a => a.id === accountId);
    if (!acc) { _notify('Account not found', 'error'); return; }
    if (!window.electronAPI || !window.electronAPI.dcTokenLogin) {
      _notify('Login bridge unavailable (running outside Electron?)', 'error');
      return;
    }

    DiscordSessions.pending.add(accountId);
    DiscordSessions.set(accountId, { loginStatus: 'pending' });
    updateRow(accountId);

    try {
      window.electronAPI.dcTokenLogin({
        accountId,
        token:      acc.token,
        username:   acc.username,
        globalName: acc.globalName,
        discordId:  acc.discordId,
        avatar:     acc.avatarUrl,
      });
    } catch (e) {
      DiscordSessions.pending.delete(accountId);
      DiscordSessions.set(accountId, { loginStatus: 'invalid', lastError: String(e && e.message || e) });
      updateRow(accountId);
      _notify('Login failed: ' + (e && e.message || e), 'error');
    }
  }

  // ── Action: bring open window to front (when window is already open) ──
  function triggerOpen(accountId) {
    // The main process treats a duplicate "open" request as focus; reuse the
    // same IPC to avoid maintaining a separate "focus" IPC channel.
    triggerLogin(accountId);
  }

  // ── Action: explicitly close a Discord window ──────────────────
  async function triggerCloseWindow(accountId) {
    if (!accountId) return;
    if (!window.electronAPI || !window.electronAPI.dcCloseWindow) return;
    try {
      await window.electronAPI.dcCloseWindow(accountId);
      // Main process will emit dc-session-status with type:'closed' once
      // the window actually closes; we update state there.
    } catch (e) {
      _notify('Close failed: ' + (e && e.message || e), 'error');
    }
  }


  // ── Handle login result event from main process ──────────────
  function onLoginResult(d) {
    if (!d || !d.accountId) return;
    DiscordSessions.pending.delete(d.accountId);

    // Update account info if the main process fetched fresh data
    if (d.ok && d.user) {
      const acc = window.Discord.state.accounts.find(a => a.id === d.accountId);
      if (acc) {
        let changed = false;
        if (d.user.id          && d.user.id          !== acc.discordId)  { acc.discordId  = d.user.id;          changed = true; }
        if (d.user.username    && d.user.username    !== acc.username)   { acc.username   = d.user.username;    changed = true; }
        if (d.user.global_name && d.user.global_name !== acc.globalName) { acc.globalName = d.user.global_name; changed = true; }
        if (changed) {
          // Persist the refreshed user info into the accounts store
          try { window.Discord.persistSave(); } catch (_) {}
        }
      }
    }

    DiscordSessions.set(d.accountId, {
      loginStatus:  d.loginStatus || (d.ok ? 'valid' : 'invalid'),
      verifyStatus: d.verifyStatus || 0,
      lastLoginAt:  d.at || Date.now(),
      lastError:    d.error || '',
      open:         !!d.ok, // window is open if login reported ok
    });

    updateRow(d.accountId);
    _persistSessionsDebounced();

    if (d.ok && !d.already) {
      const acc = window.Discord.state.accounts.find(a => a.id === d.accountId);
      _notify('Logged in: ' + (acc?.globalName || acc?.username || 'account'), 'success');
    } else if (!d.ok) {
      _notify('Login failed: ' + (d.error || 'invalid token'), 'error');
    }
  }

  // ── Handle async status events (closed, etc.) ─────────────────
  function onStatusEvent(d) {
    if (!d || !d.accountId) return;
    if (d.type === 'closed') {
      DiscordSessions.set(d.accountId, { open: false });
      updateRow(d.accountId);
      _persistSessionsDebounced();
    }
  }

  // ── Delegated click handler for new login/open/logout buttons ──
  // We attach this once and let the existing tbody delegated handler
  // continue to handle verify/delete/copy/row-chk. Both listeners run
  // independently — no conflict.
  function wireRowActions() {
    const tbody = _$('dcAccBody');
    if (!tbody || tbody._dcLoginWired) return;
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action !== 'login' && action !== 'open' && action !== 'logout') return;
      const tr = btn.closest('tr[data-dcid]');
      if (!tr) return;
      e.stopPropagation();
      const id = tr.dataset.dcid;
      if (action === 'login')  return triggerLogin(id);
      if (action === 'open')   return triggerOpen(id);
      if (action === 'logout') return triggerCloseWindow(id);
    });
    tbody._dcLoginWired = true;
  }

  // ── Restore: query main process for currently-open Discord windows ──
  // (Useful if the renderer reloaded mid-session — accountIds tracked in
  // main.js are authoritative.)
  async function restoreOpenSessions() {
    if (!window.electronAPI || !window.electronAPI.dcListOpenSessions) return;
    try {
      const r = await window.electronAPI.dcListOpenSessions();
      if (r && r.ok && Array.isArray(r.accountIds)) {
        for (const id of r.accountIds) {
          DiscordSessions.set(id, { open: true });
        }
        decorateAllRows();
      }
    } catch (e) { console.warn('[FLT-DC] restoreOpenSessions', e); }
  }


  // ── Init ─────────────────────────────────────────────────────
  async function init() {
    await persistSessionsLoad();

    // Wire result listeners (main → renderer)
    if (window.electronAPI && window.electronAPI.onDcTokenLoginResult) {
      window.electronAPI.onDcTokenLoginResult(onLoginResult);
    }
    if (window.electronAPI && window.electronAPI.onDcSessionStatus) {
      window.electronAPI.onDcSessionStatus(onStatusEvent);
    }

    // Wire row action delegation
    wireRowActions();

    // Start watching tbody for any future re-renders so the decorator stays in sync
    startDecoratorObserver();

    // Re-decorate rows so any persisted login state shows up immediately
    decorateAllRows();

    // Query main process for windows that might still be open
    await restoreOpenSessions();
  }

  // Expose
  window.Discord.login = {
    sessions:    DiscordSessions,
    trigger:     triggerLogin,
    close:       triggerCloseWindow,
    init,
    decorateRow,
    decorateAllRows,
    updateRow,
  };

  // Hook into the existing Discord init lifecycle — run our init AFTER
  // Discord.init() has populated accounts and wired its own table.
  // Discord.init() is called from DOMContentLoaded at the very end.
  // We use a microtask gate: wait until the tbody exists, then init.
  function waitForTbodyAndInit(retries) {
    retries = (retries == null) ? 60 : retries; // ~3s max at 50ms
    if (document.getElementById('dcAccBody')) {
      init().catch(e => console.error('[FLT-DC] login init', e));
      return;
    }
    if (retries <= 0) return;
    setTimeout(() => waitForTbodyAndInit(retries - 1), 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForTbodyAndInit());
  } else {
    waitForTbodyAndInit();
  }
})();

/* ============================================================================
   (Interaction Tester removed)
============================================================================ */
if (false) (function () {
  'use strict';

  const DCT = {
    busy: false,
    payloadOverride: '',
    history: [],
    maxHistory: 12,
    maxLogRows: 300,
    previewTimer: null,
    // Queue runner
    queue: [],
    queueActiveCount: 0,
    queueStopped: false,
    // Topbar counters
    statSent: 0,
    statFailed: 0,
  };

  const $dct = (id) => document.getElementById(id);
  const dctEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const dctJson = (obj) => JSON.stringify(obj, null, 2);

  function dctBindOnce(el, event, fn, key) {
    if (!el) return;
    const flag = '_dct_' + (key || event);
    if (el[flag]) return;
    el.addEventListener(event, fn);
    el[flag] = true;
  }

  function dctSchedulePreview() {
    clearTimeout(DCT.previewTimer);
    DCT.previewTimer = setTimeout(() => {
      DCT.previewTimer = null;
      if (!DCT.payloadOverride) dctRenderPreview();
      else dctRenderHeaders();
    }, 90);
  }

  function dctNotify(msg, type) {
    if (typeof notify === 'function') notify(msg, type || 'info');
  }

  function dctMaskToken(token) {
    const t = String(token || '');
    if (t.length < 16) return t ? '***' : '';
    return t.slice(0, 6) + '...' + t.slice(-4);
  }

  function dctAccounts() {
    return (window.Discord && window.Discord.state && Array.isArray(window.Discord.state.accounts))
      ? window.Discord.state.accounts.filter(a => a && a.token)
      : [];
  }

  function dctInsertUi() {
    if ($dct('page-discord-tools')) return;

    const nav = document.querySelector('#sidebar .nav');
    const after = document.querySelector('.nav-btn[data-tab="discord-accounts"]');
    if (nav && !document.querySelector('.nav-btn[data-tab="discord-tools"]')) {
      const btn = document.createElement('button');
      btn.className = 'nav-btn';
      btn.type = 'button';
      btn.dataset.tab = 'discord-tools';
      btn.dataset.platform = 'discord';
      btn.innerHTML = '<span class="nav-ic"><i class="bi bi-tools"></i></span><span>Tools</span>';
      btn.addEventListener('click', () => {
        if (typeof switchTab === 'function') switchTab('discord-tools');
        dctRefresh();
      });
      if (after && after.parentNode) after.parentNode.insertBefore(btn, after.nextSibling);
      else nav.appendChild(btn);
    }

    const main = document.getElementById('main');
    if (main) {
      const section = document.createElement('section');
      section.className = 'page';
      section.id = 'page-discord-tools';
      section.innerHTML = `
        <div class="dc-topbar">
          <div class="dc-topbar-left">
            <div class="dc-title-group">
              <div class="dc-title-icon"><i class="bi bi-lightning-charge-fill"></i></div>
              <div>
                <div class="dc-title">Interaction Tester</div>
                <div class="dc-subtitle">Dispatch component interactions — single fire or multi-account queue</div>
              </div>
            </div>
          </div>
          <div class="dc-topbar-right">
            <div class="dct-topbar-stats">
              <div class="dct-ts-item">
                <span class="dct-ts-num ok" id="dctStatSent">0</span>
                <span class="dct-ts-lbl">Sent</span>
              </div>
              <div class="dct-ts-sep"></div>
              <div class="dct-ts-item">
                <span class="dct-ts-num err" id="dctStatFailed">0</span>
                <span class="dct-ts-lbl">Failed</span>
              </div>
              <div class="dct-ts-sep"></div>
              <div class="dct-ts-item">
                <span class="dct-ts-num busy" id="dctStatActive">0</span>
                <span class="dct-ts-lbl">Active</span>
              </div>
            </div>
            <span class="dct-status" id="dctStatusBadge">Ready</span>
          </div>
        </div>

        <div class="dct-shell">
          <div class="dct-left-stack">

            <!-- ── Single Fire ── -->
            <div class="dct-card">
              <div class="dct-card-hd">
                <span><i class="bi bi-ui-checks"></i> Request Inputs</span>
                <span class="dct-status" id="dctSingleBadge">Single Fire</span>
              </div>
              <div class="dct-card-bd">

                <div class="dct-field" style="margin-bottom:10px">
                  <label class="dct-label" for="dctAccount">Discord Account</label>
                  <select id="dctAccount" class="dct-select"></select>
                </div>

                <div class="dct-section-hd">Target</div>
                <div class="dct-form-grid" style="margin-bottom:6px">
                  <div class="dct-field dct-wide">
                    <label class="dct-label" for="dctChannelUrl">Channel URL <span class="dct-hint">— auto-fills IDs below</span></label>
                    <div class="dct-input-wrap">
                      <i class="bi bi-link-45deg dct-input-icon"></i>
                      <input id="dctChannelUrl" class="dct-input dct-input-icn" type="text" placeholder="https://discord.com/channels/guild/channel/message">
                    </div>
                  </div>
                  <div class="dct-field">
                    <label class="dct-label" for="dctGuildId">Guild ID</label>
                    <input id="dctGuildId" class="dct-input" type="text" inputmode="numeric">
                  </div>
                  <div class="dct-field">
                    <label class="dct-label" for="dctChannelId">Channel ID</label>
                    <input id="dctChannelId" class="dct-input" type="text" inputmode="numeric">
                  </div>
                  <div class="dct-field dct-wide">
                    <label class="dct-label" for="dctMessageId">Message ID</label>
                    <input id="dctMessageId" class="dct-input" type="text" inputmode="numeric">
                  </div>
                </div>

                <div class="dct-section-hd">Component</div>
                <div class="dct-form-grid">
                  <div class="dct-field">
                    <label class="dct-label" for="dctApplicationId">Application ID</label>
                    <input id="dctApplicationId" class="dct-input" type="text" inputmode="numeric">
                  </div>
                  <div class="dct-field">
                    <label class="dct-label" for="dctCustomId">Custom ID</label>
                    <input id="dctCustomId" class="dct-input" type="text">
                  </div>
                  <div class="dct-field">
                    <label class="dct-label" for="dctComponentType">Component Type</label>
                    <select id="dctComponentType" class="dct-select">
                      <option value="2">Button</option>
                      <option value="3">String Select</option>
                      <option value="5">User Select</option>
                      <option value="6">Role Select</option>
                      <option value="7">Mentionable Select</option>
                      <option value="8">Channel Select</option>
                    </select>
                  </div>
                  <div class="dct-field">
                    <label class="dct-label" for="dctSessionId">Session ID</label>
                    <input id="dctSessionId" class="dct-input" type="text">
                  </div>
                  <div class="dct-field">
                    <label class="dct-label" for="dctButtonLabel">Button Label <span class="dct-hint">preview</span></label>
                    <input id="dctButtonLabel" class="dct-input" type="text" placeholder="Optional">
                  </div>
                  <div class="dct-field">
                    <label class="dct-label" for="dctTimeoutMs">Timeout MS</label>
                    <input id="dctTimeoutMs" class="dct-input" type="number" min="3000" max="30000" step="1000" value="15000">
                  </div>
                  <div class="dct-field dct-wide">
                    <label class="dct-label" for="dctValues">Select Values JSON</label>
                    <textarea id="dctValues" class="dct-textarea" style="min-height:58px" placeholder='Optional — ["value"]'></textarea>
                  </div>
                </div>

                <div class="dct-actions">
                  <button class="btn primary dct-send-btn" id="dctSendBtn" type="button"><i class="bi bi-send-fill"></i> Send One</button>
                  <button class="btn ghost" id="dctEditPayloadBtn" type="button"><i class="bi bi-code-square"></i> Edit Payload</button>
                  <button class="btn ghost" id="dctCopyPayloadBtn" type="button"><i class="bi bi-clipboard"></i> Copy</button>
                </div>

              </div>
            </div>

            <!-- ── Queue Runner ── -->
            <div class="dct-card" id="dctQueueCard">
              <div class="dct-card-hd">
                <span><i class="bi bi-stack"></i> Queue Runner</span>
                <span class="dct-status" id="dctQueueBadge">Idle</span>
              </div>
              <div class="dct-card-bd">

                <div class="dct-field" style="margin-bottom:10px">
                  <div class="dct-acc-list-hd">
                    <span class="dct-label">Accounts</span>
                    <button class="dct-acc-selall" id="dctQueueSelAll" type="button">Select All</button>
                  </div>
                  <div class="dct-acc-list" id="dctQueueAccounts"></div>
                </div>

                <div class="dct-section-hd">Settings</div>
                <div class="dct-form-grid" style="margin-bottom:4px">
                  <div class="dct-field">
                    <label class="dct-label">Concurrency</label>
                    <input id="dctQueueConcurrency" class="dct-input" type="number" min="1" max="20" value="3">
                  </div>
                  <div class="dct-field">
                    <label class="dct-label">Repeat / account</label>
                    <input id="dctQueueRepeat" class="dct-input" type="number" min="1" max="500" value="1">
                  </div>
                  <div class="dct-field">
                    <label class="dct-label">Max Retries</label>
                    <input id="dctQueueMaxRetries" class="dct-input" type="number" min="0" max="10" value="2">
                  </div>
                  <div class="dct-field">
                    <label class="dct-label">Retry Delay MS</label>
                    <input id="dctQueueRetryDelay" class="dct-input" type="number" min="500" max="60000" step="500" value="3000">
                  </div>
                </div>

                <div class="dct-q-stats" id="dctQueueStats">
                  <div class="dct-q-stat"><span id="dctQPending">0</span><span>Pending</span></div>
                  <div class="dct-q-stat ok"><span id="dctQDone">0</span><span>Done</span></div>
                  <div class="dct-q-stat err"><span id="dctQFailed">0</span><span>Failed</span></div>
                  <div class="dct-q-stat busy"><span id="dctQActive">0</span><span>Active</span></div>
                </div>

                <div class="dct-q-progressbar" id="dctQProgressOuter" style="display:none">
                  <div class="dct-q-progressbar-fill" id="dctQProgressFill" style="width:0%"></div>
                </div>

                <div class="dct-actions">
                  <button class="btn primary" id="dctQueueRunBtn" type="button"><i class="bi bi-play-fill"></i> Queue &amp; Run</button>
                  <button class="btn danger" id="dctQueueStopBtn" type="button" style="display:none"><i class="bi bi-stop-fill"></i> Stop</button>
                  <button class="btn ghost xs" id="dctQueueClearBtn" type="button"><i class="bi bi-trash"></i> Clear</button>
                </div>

                <div class="dct-q-list" id="dctQueueList"></div>

              </div>
            </div>

          </div><!-- /dct-left-stack -->

          <!-- ── Right panel (tabbed) ── -->
          <div class="dct-panel-wrap">
            <div class="dct-tabs">
              <button class="dct-tab-btn active" data-dctab="preview" type="button"><i class="bi bi-braces"></i> Preview</button>
              <button class="dct-tab-btn" data-dctab="response" type="button"><i class="bi bi-receipt"></i> Response</button>
              <button class="dct-tab-btn" data-dctab="console" type="button"><i class="bi bi-terminal"></i> Console</button>
            </div>
            <div class="dct-tab-pane active" id="dctTabPreview">
              <div id="dctHeaderPreview" class="dct-header-block"></div>
              <pre class="dct-preview dct-preview-grow" id="dctPayloadPreview">{}</pre>
              <div class="dct-tab-foot">
                <span class="dct-status" id="dctPreviewBadge">JSON</span>
              </div>
            </div>
            <div class="dct-tab-pane" id="dctTabResponse">
              <pre class="dct-preview dct-preview-grow" id="dctResponsePreview">No request sent yet.</pre>
              <div class="dct-tab-foot">
                <span class="dct-status" id="dctResponseBadge">Waiting</span>
              </div>
            </div>
            <div class="dct-tab-pane" id="dctTabConsole">
              <div class="dct-history" id="dctHistory"></div>
              <div class="dct-console dct-console-grow" id="dctConsole"></div>
              <div class="dct-tab-foot">
                <button class="btn ghost xs" id="dctClearHistoryBtn" type="button"><i class="bi bi-trash"></i> Clear</button>
              </div>
            </div>
          </div>

        </div>`;
      main.appendChild(section);
    }

    if (!$dct('modalDctPayload')) {
      const modal = document.createElement('div');
      modal.className = 'overlay';
      modal.id = 'modalDctPayload';
      modal.innerHTML = `
        <div class="modal wide">
          <div class="modal-head">
            <h3>Edit Interaction Payload</h3>
            <button class="modal-x" data-close="modalDctPayload" type="button">&#x2715;</button>
          </div>
          <div class="modal-body">
            <textarea id="dctPayloadEditor" class="dct-textarea dct-modal-textarea" spellcheck="false"></textarea>
            <div id="dctPayloadEditorStatus" class="fetch-st" style="margin-top:8px"></div>
          </div>
          <div class="modal-foot">
            <button class="btn ghost" data-close="modalDctPayload" type="button">Cancel</button>
            <button class="btn ghost" id="dctResetPayloadBtn" type="button"><i class="bi bi-arrow-counterclockwise"></i> Reset</button>
            <button class="btn primary" id="dctSavePayloadBtn" type="button"><i class="bi bi-check-lg"></i> Use Payload</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }
  }

  function dctSelectedAccount() {
    const id = $dct('dctAccount')?.value || '';
    return dctAccounts().find(a => String(a.id) === id) || null;
  }

  function dctReadValues() {
    const raw = ($dct('dctValues')?.value || '').trim();
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Select values must be a JSON array.');
    return parsed;
  }

  function dctBuildPayload() {
    if (DCT.payloadOverride.trim()) return JSON.parse(DCT.payloadOverride);
    const componentType = Number($dct('dctComponentType')?.value || 2);
    const data = {
      component_type: componentType,
      custom_id: ($dct('dctCustomId')?.value || '').trim(),
    };
    const values = dctReadValues();
    if (values !== undefined) data.values = values;
    const guildId = ($dct('dctGuildId')?.value || '').trim();
    const payload = {
      type: 3,
      nonce: String(Date.now()),
      guild_id: guildId || null,
      channel_id: ($dct('dctChannelId')?.value || '').trim(),
      message_id: ($dct('dctMessageId')?.value || '').trim(),
      application_id: ($dct('dctApplicationId')?.value || '').trim(),
      session_id: ($dct('dctSessionId')?.value || '').trim(),
      data,
    };
    if (!guildId) delete payload.guild_id;
    return payload;
  }

  function dctValidate(payload) {
    const acc = dctSelectedAccount();
    if (!acc) throw new Error('Select one Discord account.');
    if (!payload.channel_id) throw new Error('Channel ID is required.');
    if (!payload.message_id) throw new Error('Message ID is required.');
    if (!payload.application_id) throw new Error('Application ID is required.');
    if (!payload.session_id) throw new Error('Session ID is required.');
    if (!payload.data || !payload.data.custom_id) throw new Error('Custom ID is required.');
    return acc;
  }

  function dctParseChannelUrl() {
    const raw = ($dct('dctChannelUrl')?.value || '').trim();
    const m = raw.match(/discord(?:app)?\.com\/channels\/([^/]+)\/(\d+)\/?(\d+)?/i);
    if (!m) return;
    if (m[1] && m[1] !== '@me') $dct('dctGuildId').value = m[1];
    if (m[2]) $dct('dctChannelId').value = m[2];
    if (m[3]) $dct('dctMessageId').value = m[3];
  }

  function dctHeadersPreview() {
    const acc = dctSelectedAccount();
    return {
      Authorization: acc ? dctMaskToken(acc.token) : '(select account)',
      'Content-Type': 'application/json',
      Origin: 'https://discord.com',
      Referer: 'https://discord.com/channels/@me',
      Endpoint: 'POST https://discord.com/api/v9/interactions',
      Timeout: (($dct('dctTimeoutMs')?.value || '15000') + 'ms'),
    };
  }

  function dctRenderHeaders() {
    const wrap = $dct('dctHeaderPreview');
    if (!wrap) return;
    const h = dctHeadersPreview();
    wrap.innerHTML = Object.keys(h).map(k => (
      '<div class="dct-header-row"><b>' + dctEsc(k) + '</b><span>' + dctEsc(h[k]) + '</span></div>'
    )).join('');
  }

  function dctRenderPreview() {
    dctRenderHeaders();
    const pre = $dct('dctPayloadPreview');
    const badge = $dct('dctPreviewBadge');
    if (!pre) return;
    try {
      pre.textContent = dctJson(dctBuildPayload());
      if (badge) { badge.textContent = DCT.payloadOverride ? 'Edited' : 'JSON'; badge.className = 'dct-status ok'; }
    } catch (e) {
      pre.textContent = String(e.message || e);
      if (badge) { badge.textContent = 'Invalid'; badge.className = 'dct-status err'; }
    }
  }

  function dctRenderAccounts() {
    const sel = $dct('dctAccount');
    if (!sel) return;
    const old = sel.value;
    const accounts = dctAccounts();
    sel.innerHTML = '<option value="">Select one account...</option>' + accounts.map(a => {
      const name = a.globalName || a.username || a.discordId || a.id;
      const status = a.status ? ' - ' + a.status : '';
      return '<option value="' + dctEsc(a.id) + '">' + dctEsc(name + status) + '</option>';
    }).join('');
    if (old && accounts.some(a => String(a.id) === old)) sel.value = old;
  }

  function dctSetBusy(on) {
    DCT.busy = !!on;
    const btn = $dct('dctSendBtn');
    const badge = $dct('dctStatusBadge');
    if (btn) btn.disabled = DCT.busy;
    if (badge) {
      badge.textContent = DCT.busy ? 'Sending' : 'Ready';
      badge.className = 'dct-status ' + (DCT.busy ? 'busy' : '');
    }
  }

  function dctLog(msg, cls) {
    const c = $dct('dctConsole');
    if (!c) return;
    const line = document.createElement('div');
    line.className = 'dct-console-line ' + (cls || '');
    line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    c.appendChild(line);
    while (c.children.length > DCT.maxLogRows) c.removeChild(c.firstElementChild);
    c.scrollTop = c.scrollHeight;
  }

  function dctRenderHistory() {
    const box = $dct('dctHistory');
    if (!box) return;
    if (!DCT.history.length) {
      box.innerHTML = '<div class="dct-history-meta">No requests yet.</div>';
      return;
    }
    box.innerHTML = DCT.history.map((h, i) => `
      <div class="dct-history-item" data-i="${i}">
        <span class="dct-status ${h.ok ? 'ok' : 'err'}">${dctEsc(h.status)}</span>
        <div>
          <div class="dct-history-title">${dctEsc(h.label || h.customId || 'Interaction')}</div>
          <div class="dct-history-meta">${dctEsc(h.category || 'response')} - ${dctEsc(h.timestamp)} - ${dctEsc(h.durationMs || 0)}ms</div>
        </div>
        <i class="bi bi-chevron-right"></i>
      </div>
    `).join('');
  }

  function dctShowResponse(res) {
    dctSwitchTab('response');
    const badge = $dct('dctResponseBadge');
    const pre = $dct('dctResponsePreview');
    if (badge) {
      badge.textContent = res.status ? String(res.status) : 'Error';
      badge.className = 'dct-status ' + (res.ok ? 'ok' : 'err');
    }
    if (pre) {
      let parsedBody = res.body;
      try { parsedBody = JSON.parse(res.body); } catch (_) {}
      let errorCodes = null;
      if (parsedBody && typeof parsedBody === 'object') {
        errorCodes = { code: parsedBody.code, message: parsedBody.message, errors: parsedBody.errors };
      }
      pre.textContent = dctJson({
        httpStatus: res.status,
        ok: !!res.ok,
        timestamp: res.timestamp,
        durationMs: res.durationMs,
        error: res.error || null,
        classification: res.classification || null,
        errorCodes,
        rateLimitHeaders: res.headers || {},
        body: parsedBody || '',
      });
    }
  }

  function dctCopy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return Promise.resolve();
  }

  async function dctSend() {
    if (DCT.busy) return;
    let payload;
    let acc;
    try {
      payload = dctBuildPayload();
      acc = dctValidate(payload);
    } catch (e) {
      dctNotify(String(e.message || e), 'error');
      dctLog(String(e.message || e), 'err');
      dctRenderPreview();
      return;
    }
    if (!window.discordToolsAPI || !window.discordToolsAPI.sendInteraction) {
      dctNotify('Discord Tools bridge is unavailable.', 'error');
      return;
    }
    dctSetBusy(true);
    dctLog('Outgoing payload: ' + JSON.stringify(payload), '');
    try {
      const timeoutMs = Number($dct('dctTimeoutMs')?.value || 15000);
      const res = await window.discordToolsAPI.sendInteraction({ token: acc.token, payload, timeoutMs });
      dctShowResponse(res);
      dctTrackResult(!!res.ok);
      DCT.history.unshift({
        ok: !!res.ok,
        status: res.status || 'ERR',
        category: res.classification && res.classification.category,
        timestamp: new Date(res.timestamp || Date.now()).toLocaleString(),
        durationMs: res.durationMs || 0,
        customId: payload.data && payload.data.custom_id,
        label: $dct('dctButtonLabel')?.value || '',
        response: res,
      });
      DCT.history = DCT.history.slice(0, DCT.maxHistory);
      dctRenderHistory();
      dctLog('Response status ' + (res.status || 'ERR') + ' (' + ((res.classification && res.classification.category) || 'unknown') + ') in ' + (res.durationMs || 0) + 'ms', res.ok ? 'ok' : 'err');
      if (res.error) dctLog('Error: ' + res.error, 'err');
    } catch (e) {
      const res = { ok: false, status: 0, body: '', headers: {}, error: String(e.message || e), timestamp: new Date().toISOString() };
      dctShowResponse(res);
      dctTrackResult(false);
      dctLog('Error: ' + res.error, 'err');
    } finally {
      dctSetBusy(false);
    }
  }

  function dctOpenPayloadModal() {
    const ed = $dct('dctPayloadEditor');
    const st = $dct('dctPayloadEditorStatus');
    if (ed) ed.value = DCT.payloadOverride || dctJson(dctBuildPayload());
    if (st) { st.textContent = ''; st.className = 'fetch-st'; }
    if (typeof openModal === 'function') openModal('modalDctPayload');
    else $dct('modalDctPayload').style.display = 'flex';
  }

  function dctSavePayloadModal() {
    const ed = $dct('dctPayloadEditor');
    const st = $dct('dctPayloadEditorStatus');
    try {
      const parsed = JSON.parse(ed.value || '{}');
      DCT.payloadOverride = dctJson(parsed);
      if (st) { st.textContent = 'Payload override active.'; st.className = 'fetch-st ok'; }
      dctRenderPreview();
      if (typeof closeModal === 'function') closeModal('modalDctPayload');
      else $dct('modalDctPayload').style.display = 'none';
    } catch (e) {
      if (st) { st.textContent = String(e.message || e); st.className = 'fetch-st err'; }
    }
  }

  function dctSwitchTab(id) {
    document.querySelectorAll('.dct-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.dctab === id));
    const pid = 'dctTab' + id.charAt(0).toUpperCase() + id.slice(1);
    document.querySelectorAll('.dct-tab-pane').forEach(p => p.classList.toggle('active', p.id === pid));
  }

  function dctTrackResult(ok) {
    if (ok) DCT.statSent++; else DCT.statFailed++;
    const s = $dct('dctStatSent'), f = $dct('dctStatFailed');
    if (s) s.textContent = DCT.statSent;
    if (f) f.textContent = DCT.statFailed;
  }

  // ── Queue Runner ────────────────────────────────────────────────────────────

  function dctQueueRenderAccounts() {
    const box = $dct('dctQueueAccounts');
    if (!box) return;
    const accounts = dctAccounts();
    if (!accounts.length) {
      box.innerHTML = '<div class="dct-acc-empty">No accounts loaded.</div>';
      return;
    }
    const prevChecked = new Set(
      Array.from(box.querySelectorAll('.dct-acc-check:checked')).map(c => c.value)
    );
    box.innerHTML = accounts.map(a => {
      const name = dctEsc(a.globalName || a.username || a.discordId || a.id);
      const chk = prevChecked.size ? (prevChecked.has(String(a.id)) ? ' checked' : '') : ' checked';
      return `<label class="dct-acc-item"><input type="checkbox" class="dct-acc-check" value="${dctEsc(a.id)}"${chk}><span class="dct-acc-name">${name}</span></label>`;
    }).join('');
  }

  function dctQueueSelectedAccounts() {
    return dctAccounts().filter(a =>
      !!document.querySelector('#dctQueueAccounts .dct-acc-check[value="' + CSS.escape(String(a.id)) + '"]:checked')
    );
  }

  function dctQueueRenderStats() {
    const pending = DCT.queue.filter(j => j.status === 'pending').length;
    const done    = DCT.queue.filter(j => j.status === 'done').length;
    const failed  = DCT.queue.filter(j => j.status === 'failed').length;
    const active  = DCT.queue.filter(j => j.status === 'active').length;
    const total   = DCT.queue.length;
    if ($dct('dctQPending')) $dct('dctQPending').textContent = pending;
    if ($dct('dctQDone'))    $dct('dctQDone').textContent    = done;
    if ($dct('dctQFailed'))  $dct('dctQFailed').textContent  = failed;
    if ($dct('dctQActive'))  $dct('dctQActive').textContent  = active;
    // topbar active counter
    const ta = $dct('dctStatActive');
    if (ta) ta.textContent = active;
    // progress bar
    const bar  = $dct('dctQProgressOuter');
    const fill = $dct('dctQProgressFill');
    if (bar) bar.style.display = total ? '' : 'none';
    if (fill) fill.style.width = total ? Math.round(((done + failed) / total) * 100) + '%' : '0%';
    // badge
    const badge = $dct('dctQueueBadge');
    if (badge) {
      if (!total) { badge.textContent = 'Idle'; badge.className = 'dct-status'; }
      else if (active) { badge.textContent = active + ' Running'; badge.className = 'dct-status busy'; }
      else if (pending) { badge.textContent = pending + ' Pending'; badge.className = 'dct-status'; }
      else { badge.textContent = done + '/' + total + ' Done'; badge.className = failed ? 'dct-status err' : 'dct-status ok'; }
    }
  }

  function dctQueueRenderList() {
    const box = $dct('dctQueueList');
    if (!box) return;
    if (!DCT.queue.length) { box.innerHTML = ''; return; }
    box.innerHTML = DCT.queue.map(j => {
      const statusClass = { pending: '', active: 'busy', done: 'ok', failed: 'err' }[j.status] || '';
      const activeClass = j.status === 'active' ? ' is-active' : '';
      const meta = j.durationMs ? j.durationMs + 'ms' : (j.error ? j.error.slice(0, 60) : '');
      const attempt = j.attempt > 0 ? ' · retry ' + j.attempt : '';
      return `<div class="dct-q-job${activeClass}">
        <span class="dct-status ${statusClass}">${dctEsc(j.status)}</span>
        <div class="dct-q-job-info">
          <div class="dct-q-job-name">${dctEsc(j.accountName)}</div>
          <div class="dct-q-job-meta">${dctEsc(meta)}${attempt}</div>
        </div>
      </div>`;
    }).join('');
  }

  function dctQueueUpdateUI(running) {
    const runBtn  = $dct('dctQueueRunBtn');
    const stopBtn = $dct('dctQueueStopBtn');
    if (runBtn)  runBtn.disabled = !!running;
    if (stopBtn) stopBtn.style.display = running ? '' : 'none';
    dctQueueRenderStats();
    dctQueueRenderList();
  }

  async function dctQueueRunJob(job) {
    const timeoutMs = Number($dct('dctTimeoutMs')?.value || 15000);
    job.status = 'active';
    dctQueueRenderStats();
    dctQueueRenderList();

    let res;
    while (true) {
      try {
        const payload = Object.assign({}, job.payload, { nonce: String(Date.now()) });
        res = await window.discordToolsAPI.sendInteraction({ token: job.token, payload, timeoutMs });
      } catch (e) {
        res = { ok: false, status: 0, error: String(e.message || e), timestamp: new Date().toISOString() };
      }
      if (res.ok) break;
      if (DCT.queueStopped) break;
      if (job.attempt >= job.maxRetries) break;
      job.attempt++;
      dctLog('[Queue] ' + job.accountName + ' retry ' + job.attempt + '/' + job.maxRetries, 'err');
      await new Promise(r => setTimeout(r, job.retryDelay));
      if (DCT.queueStopped) break;
    }

    job.durationMs = res.durationMs || 0;
    job.status = res.ok ? 'done' : 'failed';
    job.error = res.ok ? '' : (res.error || ('HTTP ' + res.status));
    dctTrackResult(res.ok);
    dctLog(
      '[Queue] ' + job.accountName + ' → ' + job.status +
      (job.durationMs ? ' ' + job.durationMs + 'ms' : '') +
      (job.error ? ' – ' + job.error : ''),
      res.ok ? 'ok' : 'err'
    );
    DCT.history.unshift({
      ok: res.ok,
      status: res.status || 'ERR',
      category: res.classification && res.classification.category,
      timestamp: new Date(res.timestamp || Date.now()).toLocaleString(),
      durationMs: res.durationMs || 0,
      customId: job.payload.data && job.payload.data.custom_id,
      label: '[Queue] ' + job.accountName,
      response: res,
    });
    DCT.history = DCT.history.slice(0, DCT.maxHistory);
    dctRenderHistory();
  }

  function dctQueueProcess() {
    const concurrency = Math.max(1, Number($dct('dctQueueConcurrency')?.value || 3));
    if (DCT.queueStopped) {
      DCT.queueActiveCount = 0;
      dctQueueUpdateUI(false);
      return;
    }
    const pending = DCT.queue.filter(j => j.status === 'pending');
    if (!pending.length) {
      if (DCT.queueActiveCount <= 0) dctQueueUpdateUI(false);
      return;
    }
    while (DCT.queueActiveCount < concurrency && !DCT.queueStopped) {
      const job = DCT.queue.find(j => j.status === 'pending');
      if (!job) break;
      DCT.queueActiveCount++;
      dctQueueRunJob(job).finally(() => {
        DCT.queueActiveCount = Math.max(0, DCT.queueActiveCount - 1);
        dctQueueUpdateUI(DCT.queueActiveCount > 0 || DCT.queue.some(j => j.status === 'pending'));
        dctQueueProcess();
      });
    }
    dctQueueUpdateUI(true);
  }

  function dctQueueStart() {
    if (!window.discordToolsAPI || !window.discordToolsAPI.sendInteraction) {
      dctNotify('Discord Tools bridge is unavailable.', 'error');
      return;
    }
    const accounts = dctQueueSelectedAccounts();
    if (!accounts.length) { dctNotify('Select at least one account in Queue Runner.', 'error'); return; }

    let basePayload;
    try {
      basePayload = dctBuildPayload();
      dctValidate(basePayload);
    } catch (e) {
      dctNotify(String(e.message || e), 'error');
      return;
    }

    const repeat    = Math.max(1, Number($dct('dctQueueRepeat')?.value || 1));
    const maxRetries = Math.max(0, Number($dct('dctQueueMaxRetries')?.value || 2));
    const retryDelay = Math.max(500, Number($dct('dctQueueRetryDelay')?.value || 3000));

    DCT.queue = [];
    DCT.queueActiveCount = 0;
    DCT.queueStopped = false;

    for (let r = 0; r < repeat; r++) {
      for (const acc of accounts) {
        DCT.queue.push({
          id: String(Date.now()) + '_' + Math.random(),
          accountName: acc.globalName || acc.username || acc.discordId || acc.id,
          token: acc.token,
          payload: JSON.parse(JSON.stringify(basePayload)),
          status: 'pending',
          attempt: 0,
          maxRetries,
          retryDelay,
          durationMs: 0,
          error: '',
        });
      }
    }

    dctLog('[Queue] Started – ' + DCT.queue.length + ' job(s), concurrency ' + ($dct('dctQueueConcurrency')?.value || 3));
    dctQueueUpdateUI(true);
    dctQueueProcess();
  }

  function dctQueueStop() {
    DCT.queueStopped = true;
    DCT.queue.filter(j => j.status === 'pending').forEach(j => { j.status = 'failed'; j.error = 'Stopped'; });
    dctLog('[Queue] Stopped by user.', 'err');
    dctQueueUpdateUI(false);
  }

  function dctQueueClear() {
    DCT.queueStopped = true;
    DCT.queue = [];
    DCT.queueActiveCount = 0;
    dctQueueUpdateUI(false);
    dctLog('[Queue] Cleared.');
  }

  // ── /Queue Runner ────────────────────────────────────────────────────────────

  function dctWire() {
    ['dctChannelUrl','dctGuildId','dctChannelId','dctMessageId','dctApplicationId','dctCustomId','dctSessionId','dctButtonLabel','dctTimeoutMs','dctComponentType','dctValues','dctAccount'].forEach(id => {
      const el = $dct(id);
      if (!el || el._dctWired) return;
      el.addEventListener('input', () => { if (id === 'dctChannelUrl') dctParseChannelUrl(); dctSchedulePreview(); });
      el.addEventListener('change', () => dctSchedulePreview());
      el._dctWired = true;
    });
    dctBindOnce($dct('dctSendBtn'), 'click', dctSend, 'send');
    dctBindOnce($dct('dctEditPayloadBtn'), 'click', dctOpenPayloadModal, 'editPayload');
    dctBindOnce($dct('dctSavePayloadBtn'), 'click', dctSavePayloadModal, 'savePayload');
    dctBindOnce($dct('dctResetPayloadBtn'), 'click', () => {
      DCT.payloadOverride = '';
      const ed = $dct('dctPayloadEditor');
      if (ed) ed.value = dctJson(dctBuildPayload());
      dctRenderPreview();
    }, 'resetPayload');
    dctBindOnce($dct('dctCopyPayloadBtn'), 'click', async () => {
      try { await dctCopy(dctJson(dctBuildPayload())); dctNotify('Payload copied', 'success'); }
      catch (e) { dctNotify('Copy failed: ' + String(e.message || e), 'error'); }
    }, 'copyPayload');
    dctBindOnce($dct('dctClearHistoryBtn'), 'click', () => {
      DCT.history = [];
      dctRenderHistory();
      const c = $dct('dctConsole');
      if (c) c.innerHTML = '';
    }, 'clearHistory');
    dctBindOnce($dct('dctQueueRunBtn'),   'click', dctQueueStart, 'queueRun');
    dctBindOnce($dct('dctQueueStopBtn'),  'click', dctQueueStop,  'queueStop');
    dctBindOnce($dct('dctQueueClearBtn'), 'click', dctQueueClear, 'queueClear');
    dctBindOnce($dct('dctQueueSelAll'), 'click', () => {
      const checks = Array.from(document.querySelectorAll('#dctQueueAccounts .dct-acc-check'));
      const allOn = checks.every(c => c.checked);
      checks.forEach(c => { c.checked = !allOn; });
      $dct('dctQueueSelAll').textContent = allOn ? 'Select All' : 'Deselect All';
    }, 'queueSelAll');
    document.querySelectorAll('.dct-tab-btn').forEach(btn => {
      if (btn._dctTabWired) return;
      btn.addEventListener('click', () => dctSwitchTab(btn.dataset.dctab));
      btn._dctTabWired = true;
    });
    dctBindOnce($dct('dctHistory'), 'click', (e) => {
      const item = e.target.closest('.dct-history-item');
      if (!item) return;
      const h = DCT.history[Number(item.dataset.i)];
      if (h && h.response) dctShowResponse(h.response);
    }, 'history');
    document.querySelectorAll('#modalDctPayload [data-close="modalDctPayload"]').forEach(btn => {
      if (btn._dctCloseWired) return;
      btn.addEventListener('click', () => {
        if (typeof closeModal === 'function') closeModal('modalDctPayload');
        else $dct('modalDctPayload').style.display = 'none';
      });
      btn._dctCloseWired = true;
    });
  }

  function dctRefresh() {
    dctRenderAccounts();
    dctQueueRenderAccounts();
    dctRenderPreview();
    dctRenderHistory();
    dctQueueRenderStats();
    dctQueueRenderList();
  }

  function dctInit() {
    dctInsertUi();
    dctWire();
    dctRefresh();
    dctLog('Interaction Tester ready. Single-send + multi-account queue runner available.');
  }

  window.DiscordTools = {
    state: DCT,
    init: dctInit,
    refresh: dctRefresh,
    sendOne: dctSend,
  };

  function dctBoot(retries) {
    retries = retries == null ? 80 : retries;
    if (document.getElementById('main') && document.querySelector('#sidebar .nav')) {
      dctInit();
      return;
    }
    if (retries <= 0) return;
    setTimeout(() => dctBoot(retries - 1), 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => dctBoot());
  } else {
    dctBoot();
  }
})();

/* ============================================================================
   DISCORD GIVEAWAY - Multi-account interaction runner
   Prefix: dga-
============================================================================ */
(function () {
  'use strict';

  const DGA = {
    running: false,
    queue: [],
    active: 0,
    cooldowns: new Map(),
    results: [],
    logs: [],
    logFlushPending: false,
    tableFlushPending: false,
    stats: { total: 0, success: 0, failed: 0, ratelimited: 0 },
    startTime: 0,
    controllers: new Set(),
    timers: new Set(),
    retryableJobs: [],
    maxLogs: 300,
    etaInterval: null,
    rawPayloadExtra: null,
    logFilter: 'all',
  };

  const $dga = id => document.getElementById(id);
  const dgaEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function dgaNotify(msg, type) {
    if (typeof notify === 'function') notify(msg, type || 'info');
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  function dgaInsertUi() {
    if ($dga('page-discord-giveaway')) return;

    const nav = document.querySelector('#sidebar .nav');
    const after = document.querySelector('.nav-btn[data-tab="discord-tools"]') ||
                  document.querySelector('.nav-btn[data-tab="discord-accounts"]');
    if (nav && !document.querySelector('.nav-btn[data-tab="discord-giveaway"]')) {
      const btn = document.createElement('button');
      btn.className = 'nav-btn';
      btn.type = 'button';
      btn.dataset.tab = 'discord-giveaway';
      btn.dataset.platform = 'discord';
      btn.innerHTML = '<span class="nav-ic"><i class="bi bi-gift"></i></span><span>Giveaway</span>';
      btn.addEventListener('click', () => {
        if (typeof switchTab === 'function') switchTab('discord-giveaway');
        dgaRefresh();
      });
      if (after && after.parentNode) after.parentNode.insertBefore(btn, after.nextSibling);
      else nav.appendChild(btn);
    }

    const main = document.getElementById('main');
    if (!main) return;

    const section = document.createElement('section');
    section.className = 'page';
    section.id = 'page-discord-giveaway';
    section.innerHTML = `
      <div class="dc-topbar">
        <div class="dc-topbar-left">
          <div class="dc-title-group">
            <div class="dc-title-icon"><i class="bi bi-gift-fill"></i></div>
            <div>
              <div class="dc-title">Giveaway Entry</div>
              <div class="dc-subtitle">Multi-account runner — queue, retries, rate-limit handling</div>
            </div>
          </div>
        </div>
        <div class="dc-topbar-right">
          <div class="dga-stat-bar">
            <div class="dga-stat"><span class="dga-stat-n" id="dgaStTotal">0</span><span class="dga-stat-l">Total</span></div>
            <div class="dga-stat-sep"></div>
            <div class="dga-stat ok"><span class="dga-stat-n" id="dgaStSuccess">0</span><span class="dga-stat-l">Success</span></div>
            <div class="dga-stat-sep"></div>
            <div class="dga-stat err"><span class="dga-stat-n" id="dgaStFailed">0</span><span class="dga-stat-l">Failed</span></div>
            <div class="dga-stat-sep"></div>
            <div class="dga-stat warn"><span class="dga-stat-n" id="dgaStRL">0</span><span class="dga-stat-l">RL</span></div>
            <div class="dga-stat-sep"></div>
            <div class="dga-stat busy"><span class="dga-stat-n" id="dgaStRunning">0</span><span class="dga-stat-l">Running</span></div>
            <div class="dga-stat-sep"></div>
            <div class="dga-stat"><span class="dga-stat-n" id="dgaStEta" style="font-size:12px">--:--</span><span class="dga-stat-l">ETA</span></div>
          </div>
        </div>
      </div>

      <div class="dga-shell">

        <!-- ════ LEFT COLUMN ════ -->
        <div class="dga-left">

          <!-- STEP 1 — Giveaway Target -->
          <div class="dct-card">
            <div class="dct-card-hd">
              <span><span class="dga-step-badge">1</span> Giveaway Target</span>
              <span class="dct-status" id="dgaPayloadBadge">Not set</span>
            </div>
            <div class="dct-card-bd">

              <!-- ⭐ QUICK AUTO-DETECT — paste a channel link, fetches latest
                   message with a button, auto-fills every field below ───── -->
              <div class="dct-field" style="margin-bottom:10px">
                <label class="dct-label" for="dgaChannelLink">
                  <i class="bi bi-magic" style="color:var(--ac,#3dffa0)"></i>
                  Quick auto-detect
                  <span class="dct-hint">— paste a Discord channel link, we'll find the giveaway button</span>
                </label>
                <div style="display:flex;gap:6px">
                  <input id="dgaChannelLink" class="dct-input" type="text"
                         placeholder="https://discord.com/channels/<guild>/<channel>  (or just channel ID)"
                         autocomplete="off"
                         style="flex:1">
                  <button class="btn primary xs" id="dgaDetectBtn" type="button" style="flex:0 0 auto">
                    <i class="bi bi-search"></i> Detect
                  </button>
                </div>
                <div id="dgaDetectStatus" class="dga-raw-status" style="margin-top:6px"></div>
              </div>

              <div class="dct-field" style="margin-bottom:6px">
                <label class="dct-label" for="dgaRawPayload">
                  Or paste the full payload JSON
                  <span class="dct-hint">— from DevTools → Network tab</span>
                </label>
                <textarea id="dgaRawPayload" class="dct-textarea dga-raw-ta" spellcheck="false"
                  placeholder='{"type":3,"guild_id":"...","channel_id":"...","message_id":"...","application_id":"...","session_id":"...","data":{"component_type":2,"custom_id":"enter-giveaway"}}'></textarea>
              </div>
              <div id="dgaRawStatus" class="dga-raw-status"></div>
              <div id="dgaFieldsSummary" class="dga-fields-summary" style="display:none"></div>

              <div class="dct-section-hd" style="margin-top:14px">Or fill manually</div>

              <div class="dct-field" style="margin-bottom:10px">
                <label class="dct-label" for="dgaMsgLink">Message Link <span class="dct-hint">— paste a Discord message URL to auto-fill IDs</span></label>
                <div class="dct-input-wrap">
                  <i class="bi bi-link-45deg dct-input-icon"></i>
                  <input id="dgaMsgLink" class="dct-input dct-input-icn" type="text" placeholder="https://discord.com/channels/guild/channel/message">
                </div>
              </div>

              <div class="dct-form-grid">
                <div class="dct-field">
                  <label class="dct-label" for="dgaGuildId">Guild ID <span class="dct-hint">(optional)</span></label>
                  <input id="dgaGuildId" class="dct-input" type="text" inputmode="numeric" placeholder="server ID">
                </div>
                <div class="dct-field">
                  <label class="dct-label" for="dgaChannelId">Channel ID</label>
                  <input id="dgaChannelId" class="dct-input" type="text" inputmode="numeric">
                </div>
                <div class="dct-field dct-wide">
                  <label class="dct-label" for="dgaMessageId">Message ID</label>
                  <input id="dgaMessageId" class="dct-input" type="text" inputmode="numeric">
                </div>
                <div class="dct-field">
                  <label class="dct-label" for="dgaCustomId">Button / Interaction ID</label>
                  <input id="dgaCustomId" class="dct-input" type="text" placeholder="e.g. enter-giveaway">
                </div>
                <div class="dct-field">
                  <label class="dct-label" for="dgaApplicationId">Application ID</label>
                  <input id="dgaApplicationId" class="dct-input" type="text" inputmode="numeric">
                </div>
                <div class="dct-field">
                  <label class="dct-label" for="dgaSessionId">Session ID</label>
                  <input id="dgaSessionId" class="dct-input" type="text">
                </div>
                <div class="dct-field">
                  <label class="dct-label" for="dgaComponentType">Component Type</label>
                  <select id="dgaComponentType" class="dct-select">
                    <option value="2">Button (2)</option>
                    <option value="3">String Select (3)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <!-- STEP 2 — Accounts -->
          <div class="dct-card">
            <div class="dct-card-hd">
              <span><span class="dga-step-badge">2</span> Accounts</span>
              <span class="dct-status" id="dgaAccBadge">0 accounts</span>
            </div>
            <div class="dct-card-bd">
              <div class="dga-mode-row">
                <label class="dga-mode-opt">
                  <input type="radio" name="dgaAccMode" value="all" checked class="dga-radio">
                  <span>All <span class="dga-mode-count" id="dgaCntAll">0</span></span>
                </label>
                <label class="dga-mode-opt">
                  <input type="radio" name="dgaAccMode" value="valid" class="dga-radio">
                  <span>Valid <span class="dga-mode-count" id="dgaCntValid">0</span></span>
                </label>
                <label class="dga-mode-opt">
                  <input type="radio" name="dgaAccMode" value="selected" class="dga-radio">
                  <span>Pick <span class="dga-mode-count" id="dgaCntSelected">0</span></span>
                </label>
              </div>
              <div id="dgaAccListWrap" style="display:none;margin-top:8px">
                <div class="dct-acc-list-hd">
                  <span class="dct-label">Choose accounts</span>
                  <button class="dct-acc-selall" id="dgaSelAll" type="button">Select All</button>
                </div>
                <div class="dct-acc-list" id="dgaAccList"></div>
              </div>
            </div>
          </div>

          <!-- STEP 3 — Runner Settings -->
          <div class="dct-card">
            <div class="dct-card-hd"><span><span class="dga-step-badge">3</span> Runner Settings</span></div>
            <div class="dct-card-bd">
              <div class="dga-preset-row">
                <span class="dct-label" style="margin-right:6px;flex-shrink:0">Quick preset:</span>
                <button class="dga-preset-btn" data-dgapreset="safe"   type="button">Safe</button>
                <button class="dga-preset-btn" data-dgapreset="normal" type="button">Normal</button>
                <button class="dga-preset-btn" data-dgapreset="fast"   type="button">Fast</button>
                <button class="dga-preset-btn" data-dgapreset="snipe"  type="button" title="Maximum speed — fire all accounts in parallel. Use for time-sensitive giveaways.">⚡ Snipe</button>
              </div>
              <div class="dct-field" style="margin-bottom:10px">
                <label class="dct-label">Concurrency — <span id="dgaConcurVal">3</span> accounts at once</label>
                <input id="dgaConcur" class="dga-range" type="range" min="1" max="20" value="3">
              </div>
              <div class="dct-form-grid">
                <div class="dct-field">
                  <label class="dct-label">Min Delay <span class="dct-hint">ms</span></label>
                  <input id="dgaDelayMin" class="dct-input" type="number" min="0" max="30000" step="100" value="500">
                </div>
                <div class="dct-field">
                  <label class="dct-label">Max Delay <span class="dct-hint">ms</span></label>
                  <input id="dgaDelayMax" class="dct-input" type="number" min="0" max="60000" step="100" value="2000">
                </div>
                <div class="dct-field">
                  <label class="dct-label">Max Retries</label>
                  <input id="dgaMaxRetries" class="dct-input" type="number" min="0" max="10" value="2">
                </div>
                <div class="dct-field">
                  <label class="dct-label">Timeout <span class="dct-hint">ms</span></label>
                  <input id="dgaTimeout" class="dct-input" type="number" min="3000" max="30000" step="1000" value="15000">
                </div>
              </div>
            </div>
          </div>

          <!-- Controls -->
          <div class="dga-controls">
            <button class="btn primary dga-start-btn" id="dgaStartBtn" type="button">
              <i class="bi bi-play-fill"></i> <span id="dgaStartLabel">Start Entry</span>
            </button>
            <div class="dga-controls-row2">
              <button class="btn danger" id="dgaStopBtn" type="button" disabled><i class="bi bi-stop-fill"></i> Stop</button>
              <button class="btn ghost" id="dgaRetryBtn" type="button"><i class="bi bi-arrow-repeat"></i> Retry Failed</button>
              <button class="btn ghost xs" id="dgaClearBtn" type="button"><i class="bi bi-trash"></i> Clear</button>
            </div>
          </div>

        </div>

        <!-- ════ RIGHT COLUMN ════ -->
        <div class="dga-right">
          <div class="dct-tabs">
            <button class="dct-tab-btn active" data-dgatab="logs" type="button"><i class="bi bi-terminal"></i> Live Logs</button>
            <button class="dct-tab-btn" data-dgatab="results" type="button"><i class="bi bi-table"></i> Results</button>
          </div>
          <div class="dga-tab-body">

            <div class="dga-tab-pane active" id="dgaTabLogs">
              <div class="dga-filter-row">
                <span class="dga-filter-lbl">Filter:</span>
                <button class="dga-filter-chip active" data-dgafilter="all"  type="button">All</button>
                <button class="dga-filter-chip"        data-dgafilter="ok"   type="button">✓ OK</button>
                <button class="dga-filter-chip"        data-dgafilter="err"  type="button">✗ Failed</button>
                <button class="dga-filter-chip"        data-dgafilter="warn" type="button">⚡ RL</button>
              </div>
              <div class="dga-log-console" id="dgaConsole"></div>
            </div>

            <div class="dga-tab-pane" id="dgaTabResults">
              <div class="dga-results-toolbar">
                <button class="btn ghost xs" id="dgaCopyCSV" type="button"><i class="bi bi-clipboard"></i> Copy CSV</button>
              </div>
              <div class="dga-table-wrap">
                <table class="dga-table">
                  <thead><tr>
                    <th>Username</th><th>Status</th><th>Response</th><th>Time</th><th>Retries</th>
                  </tr></thead>
                  <tbody id="dgaResultBody"></tbody>
                </table>
              </div>
            </div>

          </div>
        </div>

      </div>
    `;
    main.appendChild(section);
  }

  // ── Accounts ──────────────────────────────────────────────────────────────

  function dgaAllAccounts() {
    return (window.Discord && window.Discord.state && Array.isArray(window.Discord.state.accounts))
      ? window.Discord.state.accounts.filter(a => a && a.token)
      : [];
  }

  function dgaMode() {
    const el = document.querySelector('input[name="dgaAccMode"]:checked');
    return el ? el.value : 'all';
  }

  function dgaGetAccounts() {
    const all = dgaAllAccounts();
    const mode = dgaMode();
    if (mode === 'all') return all;
    if (mode === 'valid') return all.filter(a => !a.invalid && a.status !== 'invalid' && a.status !== 'locked');
    return all.filter(a =>
      !!document.querySelector('#dgaAccList .dga-acc-check[value="' + CSS.escape(String(a.id)) + '"]:checked')
    );
  }

  function dgaRenderAccList() {
    const box = $dga('dgaAccList');
    const badge = $dga('dgaAccBadge');
    if (!box) return;
    const accounts = dgaAllAccounts();
    if (badge) { badge.textContent = accounts.length + ' accounts'; badge.className = 'dct-status'; }
    if (!accounts.length) { box.innerHTML = '<div class="dct-acc-empty">No accounts loaded.</div>'; dgaUpdateAccCounts(); dgaUpdateStartBtn(); return; }
    const prev = new Set(Array.from(box.querySelectorAll('.dga-acc-check:checked')).map(c => c.value));
    box.innerHTML = accounts.map(a => {
      const name = dgaEsc(a.globalName || a.username || a.discordId || a.id);
      const chk = prev.size ? (prev.has(String(a.id)) ? ' checked' : '') : ' checked';
      return `<label class="dct-acc-item"><input type="checkbox" class="dga-acc-check dct-acc-check" value="${dgaEsc(a.id)}"${chk}><span class="dct-acc-name">${name}</span></label>`;
    }).join('');
    dgaUpdateAccCounts();
    dgaUpdateStartBtn();
  }

  // ── Payload ───────────────────────────────────────────────────────────────

  function dgaParseMsgLink() {
    const raw = ($dga('dgaMsgLink')?.value || '').trim();
    const m = raw.match(/discord(?:app)?\.com\/channels\/([^/]+)\/(\d+)\/?(\d+)?/i);
    if (!m) return;
    if (m[1] && m[1] !== '@me' && $dga('dgaGuildId')) $dga('dgaGuildId').value = m[1];
    if (m[2] && $dga('dgaChannelId')) $dga('dgaChannelId').value = m[2];
    if (m[3] && $dga('dgaMessageId')) $dga('dgaMessageId').value = m[3];
  }

  // ── Auto-detect giveaway from a channel link ────────────────────────────
  // Uses the first valid Discord account to fetch the channel's latest
  // messages, finds one with a button, and pre-fills every payload field.
  async function dgaAutoDetect() {
    const btn    = $dga('dgaDetectBtn');
    const status = $dga('dgaDetectStatus');
    const setStatus = (text, kind) => {
      if (!status) return;
      status.textContent = text;
      status.className   = 'dga-raw-status' + (kind ? ' ' + kind : '');
    };

    const raw = ($dga('dgaChannelLink')?.value || '').trim();
    if (!raw) { setStatus('Paste a Discord channel link or ID first.', 'err'); return; }

    // Pick from accounts — try in order until one works. The "valid" status
    // we have stored can lie (Discord may have killed the token since we
    // last verified), so we iterate through candidates until we find one
    // with a working token. This fixes the "Token rejected (401)" bug when
    // the first account happens to be dead.
    const allDcAccounts = (typeof dgaAllAccounts === 'function')
      ? dgaAllAccounts()
      : ((window.Discord && window.Discord.state && Array.isArray(window.Discord.state.accounts))
          ? window.Discord.state.accounts.filter(a => a && a.token)
          : []);
    if (!allDcAccounts.length) {
      setStatus('No Discord accounts loaded. Add one in the Discord Accounts tab first.', 'err');
      return;
    }
    // Sort: not-invalid first, then any with a token. Stops at the first 200.
    const candidates = allDcAccounts
      .slice()
      .sort((a, b) => {
        const aValid = !a.invalid && a.status !== 'invalid' && a.status !== 'locked' ? 0 : 1;
        const bValid = !b.invalid && b.status !== 'invalid' && b.status !== 'locked' ? 0 : 1;
        return aValid - bValid;
      });

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Detecting…'; }

    let res = null;
    let usedAccount = null;
    let lastError = null;
    const MAX_TRY = Math.min(5, candidates.length);
    for (let i = 0; i < MAX_TRY; i++) {
      const acc = candidates[i];
      if (!acc || !acc.token) continue;
      setStatus('Trying account @' + (acc.globalName || acc.username || acc.id) + '  (' + (i + 1) + '/' + MAX_TRY + ')…', '');
      try {
        res = await window.discordToolsAPI.detectGiveaway({ token: acc.token, channelInput: raw, limit: 20 });
      } catch (e) {
        res = { ok: false, error: String(e && e.message || e) };
      }
      // If 401 (token dead) or 403 (no access for this account), try the next
      const errStr = String(res?.error || '').toLowerCase();
      const isDeadToken     = errStr.includes('401') || errStr.includes('token rejected');
      const isAccessForbidden = errStr.includes('403') || errStr.includes('access denied');
      if (!isDeadToken && !isAccessForbidden) {
        usedAccount = acc;
        break;  // got a definitive answer (success or genuine failure)
      }
      lastError = res?.error;
      // Mark this account as invalid client-side so the next time we pick
      // the right one. Don't persist — we don't want one bad API call to
      // permanently nuke an account.
      acc._scratchBadForDetect = true;
    }

    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-search"></i> Detect'; }

    if (!res || !res.ok) {
      let msg = '✗ ' + (res?.error || lastError || 'Detection failed');
      if (res?.last_message) {
        msg += '  ·  last msg from @' + (res.last_message.author || '?') + ': "' + (res.last_message.preview || '').slice(0, 80) + '"';
      }
      msg += '  ·  tried ' + MAX_TRY + ' account(s)';
      setStatus(msg, 'err');
      return;
    }
    const acc = usedAccount;

    // ── Auto-fill every payload field ─────────────────────────────────────
    const set = (id, v) => { const el = $dga(id); if (el && v != null) el.value = String(v); };
    set('dgaGuildId',       res.guild_id);
    set('dgaChannelId',     res.channel_id);
    set('dgaMessageId',     res.message_id);
    set('dgaApplicationId', res.application_id);
    set('dgaCustomId',      res.custom_id);
    if (res.component_type != null) set('dgaComponentType', res.component_type);

    // Auto-generate a session_id — Discord interactions require one. Without
    // a real Gateway WebSocket we can't get a "true" session_id, but Discord
    // accepts random 32-char hex strings for most non-modal component
    // interactions. Only fill if the field is currently empty so the user
    // can override with a real DevTools-captured one if they have it.
    const sessEl = $dga('dgaSessionId');
    if (sessEl && !sessEl.value.trim()) {
      let hex = '';
      try {
        const b = new Uint8Array(16);
        (crypto || window.crypto).getRandomValues(b);
        hex = Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
      } catch (_) {
        hex = (Date.now().toString(16) + Math.random().toString(16).slice(2)).slice(0, 32).padEnd(32, '0');
      }
      sessEl.value = hex;
    }

    // Show a rich success summary
    const lbl  = res.button_label ? '"' + res.button_label + '"' : '(no label)';
    const bot  = res.bot_name ? ' from ' + res.bot_name : '';
    const ttl  = res.embed_title ? '  ·  embed: "' + res.embed_title.slice(0, 60) + '"' : '';
    const more = res.button_count > 1 ? '  ·  ' + (res.button_count - 1) + ' other button(s)' : '';
    setStatus('✓ Found button ' + lbl + bot + ttl + more + '  ·  session_id auto-generated', 'ok');

    // Update the fields-summary + badge so the rest of the UI reflects it
    if (typeof dgaUpdateFieldsSummary === 'function') dgaUpdateFieldsSummary();
    const badge = $dga('dgaPayloadBadge');
    if (badge) { badge.textContent = 'Ready'; badge.className = 'dct-status ok'; }

    notify('Giveaway detected — fields auto-filled. Pick accounts + press Start Entry.', 'success');
  }

  function dgaParseRawPayload() {
    const raw = ($dga('dgaRawPayload')?.value || '').trim();
    const status = $dga('dgaRawStatus');
    const badge  = $dga('dgaPayloadBadge');
    if (!raw) {
      DGA.rawPayloadExtra = null;
      if (status) { status.textContent = ''; status.className = 'dga-raw-status'; }
      if (badge)  { badge.textContent = 'Not set'; badge.className = 'dct-status'; }
      dgaUpdateFieldsSummary();
      return;
    }
    try {
      const p = JSON.parse(raw);
      const set = (id, val) => { const el = $dga(id); if (el && val != null) el.value = String(val); };
      set('dgaGuildId',       p.guild_id);
      set('dgaChannelId',     p.channel_id);
      set('dgaMessageId',     p.message_id);
      set('dgaApplicationId', p.application_id);
      set('dgaSessionId',     p.session_id);
      set('dgaCustomId',      p.data?.custom_id);
      if (p.data?.component_type != null) set('dgaComponentType', p.data.component_type);
      DGA.rawPayloadExtra = {
        type:          p.type          ?? 3,
        message_flags: p.message_flags ?? 0,
      };
      if (status) { status.textContent = 'Parsed — all fields filled automatically'; status.className = 'dga-raw-status ok'; }
      if (badge)  { badge.textContent = 'Ready'; badge.className = 'dct-status ok'; }
      dgaUpdateFieldsSummary();
    } catch (e) {
      DGA.rawPayloadExtra = null;
      if (status) { status.textContent = 'Invalid JSON: ' + String(e.message || e).slice(0, 70); status.className = 'dga-raw-status err'; }
      if (badge)  { badge.textContent = 'Error'; badge.className = 'dct-status err'; }
      dgaUpdateFieldsSummary();
    }
  }

  function dgaBuildPayload() {
    const extra = DGA.rawPayloadExtra || {};
    const guildId = ($dga('dgaGuildId')?.value || '').trim();
    const p = {
      type:          extra.type          ?? 3,
      nonce:         String(Date.now()),
      guild_id:      guildId || null,
      channel_id:    ($dga('dgaChannelId')?.value    || '').trim(),
      message_flags: extra.message_flags ?? 0,
      message_id:    ($dga('dgaMessageId')?.value    || '').trim(),
      application_id:($dga('dgaApplicationId')?.value|| '').trim(),
      session_id:    ($dga('dgaSessionId')?.value    || '').trim(),
      data: {
        component_type: Number($dga('dgaComponentType')?.value || 2),
        custom_id:      ($dga('dgaCustomId')?.value  || '').trim(),
      },
    };
    if (!guildId) delete p.guild_id;
    return p;
  }

  function dgaValidatePayload(p) {
    if (!p.channel_id)       throw new Error('Channel ID is required.');
    if (!p.message_id)       throw new Error('Message ID is required.');
    if (!p.application_id)   throw new Error('Application ID is required.');
    if (!p.data.custom_id)   throw new Error('Interaction / Button ID is required.');
  }

  // ── Request system ────────────────────────────────────────────────────────

  function dgaClassify(res) {
    if (!res) return 'failed';
    if (res.ok || res.status === 204 || res.status === 200) return 'success';
    if (res.status === 429) return 'ratelimited';
    if (res.status === 401) return 'invalid_token';
    if (res.status === 403) return 'locked';
    const cat = res.classification?.category;
    if (cat) return cat;
    try {
      const b = JSON.parse(res.body || '{}');
      if (b.captcha_key) return 'captcha';
      if (b.code === 40002) return 'locked';
    } catch (_) {}
    return 'failed';
  }

  function dgaRetryAfter(res) {
    try { const b = JSON.parse(res.body || '{}'); if (b.retry_after) return Math.ceil(b.retry_after * 1000); } catch (_) {}
    if (res.headers?.['retry-after']) return Math.ceil(Number(res.headers['retry-after']) * 1000);
    return 5000;
  }

  async function dgaSleep(ms) {
    return new Promise(resolve => {
      const tid = setTimeout(resolve, Math.max(0, ms));
      DGA.timers.add(tid);
    });
  }

  async function dgaRunJob(job) {
    if (!window.discordToolsAPI?.sendInteraction) return;
    const timeoutMs  = Math.max(3000, Number($dga('dgaTimeout')?.value   || 15000));
    const maxRetries = Math.max(0,    Number($dga('dgaMaxRetries')?.value || 2));
    const delayMin   = Math.max(0,    Number($dga('dgaDelayMin')?.value   || 500));
    const delayMax   = Math.max(delayMin, Number($dga('dgaDelayMax')?.value || 2000));
    const acc  = job.account;
    const name = acc.globalName || acc.username || String(acc.id || '');
    let rlRetries = 0;

    for (let attempt = 0; attempt <= maxRetries && DGA.running; attempt++) {
      // per-account cooldown
      const cd = DGA.cooldowns.get(String(acc.id));
      if (cd && Date.now() < cd) {
        const wait = cd - Date.now();
        dgaLog(name + ' — cooldown ' + Math.ceil(wait / 1000) + 's', 'warn');
        await dgaSleep(wait);
        if (!DGA.running) break;
      }

      // inter-request delay
      if (delayMax > 0) {
        await dgaSleep(delayMin + Math.random() * (delayMax - delayMin));
        if (!DGA.running) break;
      }

      let res;
      try {
        const payload = Object.assign({}, job.payload, { nonce: String(Date.now()) });
        res = await window.discordToolsAPI.sendInteraction({ token: acc.token, payload, timeoutMs });
      } catch (e) {
        res = { ok: false, status: 0, body: '', headers: {}, error: String(e.message || e), timestamp: new Date().toISOString(), durationMs: 0 };
      }

      const cat = dgaClassify(res);
      // Surface what Discord ACTUALLY said for non-success responses. The
      // classification eats the body — this puts the real error back in the
      // log so the user can see "session_id required" / "Verify your phone"
      // / "interaction failed" / etc. instead of just the bucket name.
      let detail = '';
      if (cat !== 'success' && res && res.body) {
        let snippet = '';
        try {
          const j = JSON.parse(res.body);
          snippet = j.message || (j.errors && JSON.stringify(j.errors)) || res.body;
        } catch (_) { snippet = res.body; }
        snippet = String(snippet || '').replace(/\s+/g, ' ').slice(0, 140);
        if (snippet) detail = '  ·  ' + snippet;
      }
      dgaLog(
        name + ' → ' + cat +
        (res.durationMs ? ' ' + res.durationMs + 'ms' : '') +
        (attempt > 0 ? ' (attempt ' + (attempt + 1) + ')' : '') +
        detail,
        cat === 'success' ? 'ok' : (cat === 'ratelimited' ? 'warn' : 'err')
      );

      if (cat === 'success') {
        DGA.stats.success++;
        dgaAddResult(acc, cat, res, attempt);
        dgaUpdateStats();
        return;
      }

      if (cat === 'invalid_token' || cat === 'locked' || cat === 'captcha') {
        DGA.stats.failed++;
        dgaAddResult(acc, cat, res, attempt);
        DGA.retryableJobs.push(job);
        dgaUpdateStats();
        return;
      }

      if (cat === 'ratelimited') {
        DGA.stats.ratelimited++;
        dgaUpdateStats();
        rlRetries++;
        if (rlRetries > 5) {
          DGA.stats.failed++;
          dgaAddResult(acc, 'ratelimited_limit', res, attempt);
          DGA.retryableJobs.push(job);
          return;
        }
        const wait = dgaRetryAfter(res) + 500;
        DGA.cooldowns.set(String(acc.id), Date.now() + wait);
        dgaLog(name + ' — RL retry after ' + Math.ceil(wait / 1000) + 's', 'warn');
        await dgaSleep(wait);
        attempt--; // don't count RL waits as retry attempts
        continue;
      }

      // generic failure — retry with backoff
      if (attempt < maxRetries) {
        dgaLog(name + ' — failed (' + (res.status || 'ERR') + ') retrying…', 'err');
        await dgaSleep(1500 * (attempt + 1));
        continue;
      }

      DGA.stats.failed++;
      dgaAddResult(acc, cat, res, attempt);
      DGA.retryableJobs.push(job);
      dgaUpdateStats();
    }
  }

  // ── Queue processor ───────────────────────────────────────────────────────

  function dgaProcess() {
    if (!DGA.running) return;
    const concurrency = Math.max(1, Number($dga('dgaConcur')?.value || 3));
    while (DGA.active < concurrency && DGA.queue.length && DGA.running) {
      const job = DGA.queue.shift();
      DGA.active++;
      DGA.stats.total++;
      dgaUpdateStats();
      dgaRunJob(job).finally(() => {
        DGA.active = Math.max(0, DGA.active - 1);
        dgaUpdateStats();
        dgaProcess();
        if (!DGA.active && !DGA.queue.length && DGA.running) dgaFinish();
      });
    }
    dgaUpdateStats();
  }

  function dgaFinish() {
    DGA.running = false;
    clearInterval(DGA.etaInterval);
    DGA.etaInterval = null;
    dgaLog('Run complete — ' + DGA.stats.success + ' success · ' + DGA.stats.failed + ' failed · ' + DGA.stats.ratelimited + ' RL', 'ok');
    dgaSetControls(false);
    dgaUpdateStats();
  }

  // ── Start / Stop / Retry / Clear ──────────────────────────────────────────

  function dgaStart(retryJobs) {
    if (DGA.running) return;
    if (!window.discordToolsAPI?.sendInteraction) { dgaNotify('Discord API bridge unavailable.', 'error'); return; }

    let basePayload;
    try {
      basePayload = dgaBuildPayload();
      dgaValidatePayload(basePayload);
    } catch (e) { dgaNotify(String(e.message || e), 'error'); return; }

    if (retryJobs) {
      if (!retryJobs.length) { dgaNotify('No failed jobs to retry.', 'info'); return; }
      DGA.queue = retryJobs.map(j => ({ account: j.account, payload: j.payload || JSON.parse(JSON.stringify(basePayload)) }));
    } else {
      const accounts = dgaGetAccounts();
      if (!accounts.length) { dgaNotify('No accounts selected.', 'error'); return; }
      DGA.queue = accounts.map(acc => ({ account: acc, payload: JSON.parse(JSON.stringify(basePayload)) }));
      DGA.stats = { total: 0, success: 0, failed: 0, ratelimited: 0 };
      DGA.results = [];
      DGA.logs = [];
      DGA.retryableJobs = [];
      const c = $dga('dgaConsole');
      if (c) c.innerHTML = '';
      dgaFlushTable();
    }

    DGA.running = true;
    DGA.active = 0;
    DGA.cooldowns.clear();
    DGA.startTime = Date.now();
    dgaSetControls(true);
    dgaLog('Started — ' + DGA.queue.length + ' job(s), concurrency ' + ($dga('dgaConcur')?.value || 3));
    dgaStartEta();
    dgaProcess();
  }

  function dgaStop() {
    DGA.running = false;
    DGA.queue = [];
    DGA.controllers.forEach(c => { try { c.abort(); } catch (_) {} });
    DGA.controllers.clear();
    DGA.timers.forEach(t => clearTimeout(t));
    DGA.timers.clear();
    clearInterval(DGA.etaInterval);
    DGA.etaInterval = null;
    DGA.active = 0;
    dgaSetControls(false);
    dgaUpdateStats();
    dgaLog('Stopped by user.', 'err');
  }

  function dgaRetryFailed() {
    if (DGA.running) return;
    const jobs = DGA.retryableJobs.splice(0);
    if (!jobs.length) { dgaNotify('No failed jobs to retry.', 'info'); return; }
    dgaLog('Retrying ' + jobs.length + ' failed job(s)…');
    dgaStart(jobs);
  }

  function dgaClear() {
    if (DGA.running) dgaStop();
    DGA.stats = { total: 0, success: 0, failed: 0, ratelimited: 0 };
    DGA.results = [];
    DGA.logs = [];
    DGA.retryableJobs = [];
    DGA.cooldowns.clear();
    DGA.rawPayloadExtra = null;
    const c = $dga('dgaConsole');
    if (c) c.innerHTML = '';
    dgaFlushTable();
    dgaUpdateStats();
    dgaLog('Cleared.');
  }

  // ── Stats + ETA ───────────────────────────────────────────────────────────

  function dgaUpdateStats() {
    if ($dga('dgaStTotal'))   $dga('dgaStTotal').textContent   = DGA.stats.total;
    if ($dga('dgaStSuccess')) $dga('dgaStSuccess').textContent = DGA.stats.success;
    if ($dga('dgaStFailed'))  $dga('dgaStFailed').textContent  = DGA.stats.failed;
    if ($dga('dgaStRL'))      $dga('dgaStRL').textContent      = DGA.stats.ratelimited;
    if ($dga('dgaStRunning')) $dga('dgaStRunning').textContent = DGA.active;
  }

  function dgaStartEta() {
    clearInterval(DGA.etaInterval);
    DGA.etaInterval = setInterval(() => {
      const el = $dga('dgaStEta');
      if (!el) return;
      const elapsed = (Date.now() - DGA.startTime) / 1000;
      const done = DGA.stats.success + DGA.stats.failed;
      const remaining = DGA.queue.length + DGA.active;
      if (done < 1 || remaining < 1) { el.textContent = '--:--'; return; }
      const secs = Math.round(remaining / (done / elapsed));
      el.textContent = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
    }, 1000);
  }

  function dgaSetControls(on) {
    const s = $dga('dgaStartBtn'), t = $dga('dgaStopBtn');
    if (s) s.disabled = !!on;
    if (t) t.disabled = !on;
  }

  // ── Log (debounced, max 300 rows) ─────────────────────────────────────────

  function dgaLog(msg, cls) {
    DGA.logs.push({ t: new Date().toLocaleTimeString(), msg: String(msg || ''), cls: cls || '' });
    if (DGA.logs.length > DGA.maxLogs) DGA.logs.shift();
    if (DGA.logFlushPending) return;
    DGA.logFlushPending = true;
    requestAnimationFrame(() => {
      DGA.logFlushPending = false;
      const c = $dga('dgaConsole');
      if (!c) return;
      const f = DGA.logFilter || 'all';
      const rows = f === 'all' ? DGA.logs : DGA.logs.filter(e => e.cls === f);
      c.innerHTML = rows.map(e =>
        '<div class="dga-log-line' + (e.cls ? ' ' + e.cls : '') + '">[' + dgaEsc(e.t) + '] ' + dgaEsc(e.msg) + '</div>'
      ).join('');
      c.scrollTop = c.scrollHeight;
    });
  }

  // ── Results table (debounced) ─────────────────────────────────────────────

  function dgaAddResult(acc, cat, res, retries) {
    const name = acc.globalName || acc.username || String(acc.id || '');
    let resp = '';
    try {
      const b = JSON.parse(res.body || '{}');
      resp = b.message ? b.message.slice(0, 80) : (res.status ? 'HTTP ' + res.status : '');
      if (b.code) resp += ' [' + b.code + ']';
    } catch (_) { resp = res.status ? 'HTTP ' + res.status : (res.error || '').slice(0, 80); }
    DGA.results.unshift({
      username: name,
      statusLabel: cat,
      cls: cat === 'success' ? 'ok' : (cat === 'ratelimited' || cat === 'ratelimited_limit' ? 'warn' : 'err'),
      response: resp,
      ts: new Date().toLocaleTimeString(),
      retries,
    });
    if (DGA.tableFlushPending) return;
    DGA.tableFlushPending = true;
    requestAnimationFrame(() => {
      DGA.tableFlushPending = false;
      dgaFlushTable();
    });
  }

  function dgaFlushTable() {
    const tbody = $dga('dgaResultBody');
    if (!tbody) return;
    if (!DGA.results.length) { tbody.innerHTML = ''; return; }
    tbody.innerHTML = DGA.results.map(r =>
      '<tr class="dga-tr-' + dgaEsc(r.cls) + '">' +
      '<td class="dga-td-name">' + dgaEsc(r.username) + '</td>' +
      '<td><span class="dga-badge ' + dgaEsc(r.cls) + '">' + dgaEsc(r.statusLabel) + '</span></td>' +
      '<td class="dga-td-resp">' + dgaEsc(r.response) + '</td>' +
      '<td class="dga-td-ts">' + dgaEsc(r.ts) + '</td>' +
      '<td class="dga-td-rt">' + r.retries + '</td>' +
      '</tr>'
    ).join('');
  }

  // ── Tab switch ────────────────────────────────────────────────────────────

  function dgaSwitchTab(id) {
    document.querySelectorAll('#page-discord-giveaway .dct-tab-btn')
      .forEach(b => b.classList.toggle('active', b.dataset.dgatab === id));
    const pid = 'dgaTab' + id.charAt(0).toUpperCase() + id.slice(1);
    document.querySelectorAll('#page-discord-giveaway .dga-tab-pane')
      .forEach(p => p.classList.toggle('active', p.id === pid));
  }

  // ── Helpers — fields summary, account counts, start btn, presets, CSV ─────

  function dgaUpdateFieldsSummary() {
    const wrap = $dga('dgaFieldsSummary');
    if (!wrap) return;
    const chips = [
      ['Guild',   ($dga('dgaGuildId')?.value     || '').trim()],
      ['Channel', ($dga('dgaChannelId')?.value   || '').trim()],
      ['Msg',     ($dga('dgaMessageId')?.value   || '').trim()],
      ['Btn ID',  ($dga('dgaCustomId')?.value    || '').trim()],
      ['App',     ($dga('dgaApplicationId')?.value || '').trim()],
    ].filter(([, v]) => v);
    if (!chips.length) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
    wrap.style.display = 'flex';
    wrap.innerHTML = chips.map(([k, v]) => {
      const disp = v.length > 22 ? v.slice(0, 9) + '…' + v.slice(-5) : v;
      return '<span class="dga-field-chip"><span class="dga-chip-key">' + dgaEsc(k) + '</span>' + dgaEsc(disp) + '</span>';
    }).join('');
  }

  function dgaUpdateAccCounts() {
    const all   = dgaAllAccounts();
    const valid = all.filter(a => !a.invalid && a.status !== 'invalid' && a.status !== 'locked');
    const sel   = document.querySelectorAll('#dgaAccList .dga-acc-check:checked').length;
    const set = (id, n) => { const el = $dga(id); if (el) el.textContent = n; };
    set('dgaCntAll',      all.length);
    set('dgaCntValid',    valid.length);
    set('dgaCntSelected', sel);
  }

  function dgaUpdateStartBtn() {
    const lbl = $dga('dgaStartLabel');
    if (!lbl) return;
    const n = dgaGetAccounts().length;
    lbl.textContent = 'Start Entry — ' + n + ' account' + (n !== 1 ? 's' : '');
  }

  function dgaSetPreset(name) {
    // All presets pinned to concurrency 1 — the bot serving this giveaway
    // has a per-IP bucket so concurrency >1 always 429s on this user's setup.
    // Speed comes from cutting the inter-request delay, not parallelism.
    //   At concurrency 1 + 0ms delay: ~300-500ms per Discord round-trip,
    //   so 39 accounts ≈ 15 seconds total wall-clock. That's the theoretical
    //   floor — only proxies/multiple IPs would beat it.
    const presets = {
      safe:   { concur: 1, delayMin: 1500, delayMax: 3000, retries: 3, timeout: 15000 },
      normal: { concur: 1, delayMin:  500, delayMax: 1000, retries: 2, timeout: 12000 },
      fast:   { concur: 1, delayMin:  100, delayMax:  300, retries: 1, timeout:  8000 },
      // ⚡ SNIPE — concurrency 1, zero delay, no retries. As fast as Discord
      // will let a single IP go. Each round-trip happens back-to-back.
      snipe:  { concur: 1, delayMin:    0, delayMax:    0, retries: 0, timeout:  5000 },
    };
    const p = presets[name];
    if (!p) return;
    const setV = (id, v) => { const el = $dga(id); if (el) el.value = v; };
    setV('dgaConcur',    p.concur);
    setV('dgaDelayMin',  p.delayMin);
    setV('dgaDelayMax',  p.delayMax);
    setV('dgaMaxRetries', p.retries);
    if (p.timeout != null) setV('dgaTimeout', p.timeout);
    const cv = $dga('dgaConcurVal');
    if (cv) cv.textContent = p.concur;
    document.querySelectorAll('.dga-preset-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.dgapreset === name));
  }

  function dgaApplyLogFilter(name) {
    DGA.logFilter = name;
    document.querySelectorAll('.dga-filter-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.dgafilter === name));
    DGA.logFlushPending = false;
    const c = $dga('dgaConsole');
    if (!c) return;
    const rows = name === 'all' ? DGA.logs : DGA.logs.filter(e => e.cls === name);
    c.innerHTML = rows.map(e =>
      '<div class="dga-log-line' + (e.cls ? ' ' + e.cls : '') + '">[' + dgaEsc(e.t) + '] ' + dgaEsc(e.msg) + '</div>'
    ).join('');
    c.scrollTop = c.scrollHeight;
  }

  function dgaCopyCSV() {
    if (!DGA.results.length) { dgaNotify('No results to copy.', 'info'); return; }
    const rows = [['Username', 'Status', 'Response', 'Time', 'Retries']];
    DGA.results.forEach(r => rows.push([r.username, r.statusLabel, r.response, r.ts, String(r.retries)]));
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    navigator.clipboard.writeText(csv)
      .then(()  => dgaNotify('Copied ' + (rows.length - 1) + ' rows as CSV.', 'success'))
      .catch(()  => dgaNotify('Clipboard access denied.', 'error'));
  }

  // ── Wire ──────────────────────────────────────────────────────────────────

  function dgaWire() {
    function once(el, ev, fn, k) {
      if (!el || el['_dga_' + (k || ev)]) return;
      el.addEventListener(ev, fn);
      el['_dga_' + (k || ev)] = true;
    }
    const rp = $dga('dgaRawPayload');
    if (rp && !rp._dgaParsed) { rp.addEventListener('input', dgaParseRawPayload); rp._dgaParsed = true; }
    const ml = $dga('dgaMsgLink');
    if (ml && !ml._dgaParsed) { ml.addEventListener('input', dgaParseMsgLink); ml._dgaParsed = true; }

    // Auto-detect: button click + Enter-in-input shortcut
    once($dga('dgaDetectBtn'), 'click', dgaAutoDetect, 'detect');
    const cl = $dga('dgaChannelLink');
    if (cl && !cl._dgaWired) {
      cl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dgaAutoDetect(); } });
      cl._dgaWired = true;
    }

    once($dga('dgaStartBtn'), 'click', () => dgaStart(),    'start');
    once($dga('dgaStopBtn'),  'click', dgaStop,             'stop');
    once($dga('dgaRetryBtn'), 'click', dgaRetryFailed,      'retry');
    once($dga('dgaClearBtn'), 'click', dgaClear,            'clear');

    once($dga('dgaSelAll'), 'click', () => {
      const chks = Array.from(document.querySelectorAll('#dgaAccList .dga-acc-check'));
      const allOn = chks.every(c => c.checked);
      chks.forEach(c => { c.checked = !allOn; });
      const b = $dga('dgaSelAll');
      if (b) b.textContent = allOn ? 'Select All' : 'Deselect All';
      dgaUpdateAccCounts();
      dgaUpdateStartBtn();
    }, 'selall');

    const slider = $dga('dgaConcur');
    if (slider && !slider._dgaWired) {
      slider.addEventListener('input', () => { const v = $dga('dgaConcurVal'); if (v) v.textContent = slider.value; });
      slider._dgaWired = true;
    }

    document.querySelectorAll('input[name="dgaAccMode"]').forEach(r => {
      if (r._dgaWired) return;
      r.addEventListener('change', () => {
        const w = $dga('dgaAccListWrap');
        if (w) w.style.display = r.value === 'selected' ? '' : 'none';
        dgaUpdateStartBtn();
      });
      r._dgaWired = true;
    });

    document.querySelectorAll('#page-discord-giveaway .dct-tab-btn').forEach(btn => {
      if (btn._dgaTabWired) return;
      btn.addEventListener('click', () => dgaSwitchTab(btn.dataset.dgatab));
      btn._dgaTabWired = true;
    });

    document.querySelectorAll('.dga-preset-btn').forEach(btn => {
      if (btn._dgaPresetWired) return;
      btn.addEventListener('click', () => dgaSetPreset(btn.dataset.dgapreset));
      btn._dgaPresetWired = true;
    });

    document.querySelectorAll('.dga-filter-chip').forEach(chip => {
      if (chip._dgaFilterWired) return;
      chip.addEventListener('click', () => dgaApplyLogFilter(chip.dataset.dgafilter));
      chip._dgaFilterWired = true;
    });

    once($dga('dgaCopyCSV'), 'click', dgaCopyCSV, 'copycsv');
  }

  // ── Refresh / Init / Boot ─────────────────────────────────────────────────

  function dgaRefresh() {
    dgaRenderAccList();
    dgaUpdateAccCounts();
    dgaUpdateStartBtn();
    dgaUpdateStats();
  }

  function dgaInit() {
    dgaInsertUi();
    dgaWire();
    dgaRefresh();
    dgaLog('Giveaway Entry Runner ready.');
  }

  function dgaBoot(n) {
    n = n == null ? 80 : n;
    if (document.getElementById('main') && document.querySelector('#sidebar .nav')) { dgaInit(); return; }
    if (n <= 0) return;
    setTimeout(() => dgaBoot(n - 1), 50);
  }

  window.DiscordGiveaway = { state: DGA, start: dgaStart, stop: dgaStop, refresh: dgaRefresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => dgaBoot());
  else dgaBoot();
})();


/* ══════════════════════════════════════════════════════════════════════════
 *  REMOVED: In-app Activity viewer.
 *  The fltLogger backend still fires every event to your hardcoded admin
 *  Discord webhook (set in main.js). Nothing renders in the panel.
 * ══════════════════════════════════════════════════════════════════════════ */


/* ══════════════════════════════════════════════════════════════
   KIK — Isolated module
   All HTTP requests run via main-process IPC (kikFetch) so no
   browser window ever opens.  Proxy support is built-in with a
   pre-seeded pool + checker UI.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────── */
  const TEMPMAIL_API  = 'https://tempmails.me/api.php';
  const TEMPMAIL_KEY  = 'vm_2cb7522806fd603ee245cc063a293b4c46adf0d14c8fa3d00270be65b0f419da';
  const TEMPMAIL_DOM  = 'tempmails.me';
  const KIK_REG_URL   = 'https://registration.kik.com/v1/register';
  const STORE_KEY     = 'flt_kik_acc';
  const MAX_LOG_ROWS  = 300;
  const INBOX_POLL_MS = 4000;
  const INBOX_TIMEOUT = 120000;

  /* ── Built-in proxy pool ───────────────────────────────────── */
  const BUILTIN_PROXIES = [
    'core-asia.aura-solutions.io:8603:pool-mobile-target-mobile-country-in:kbvw4yi3csmjhbko',
    'core-eu.aura-solutions.io:8603:pool-mobile-target-mobile-country-fm:kbvw4yi3csmjhbko',
    'core-eu.aura-solutions.io:8603:pool-mobile-target-mobile-country-ml:kbvw4yi3csmjhbko',
  ];

  // Working proxies after health check (null = unchecked, use any)
  let _workingProxies = null;
  let _proxyIdx = 0;

  function getNextProxy() {
    const pool = _workingProxies || BUILTIN_PROXIES;
    if (!pool.length) return null;
    const p = pool[_proxyIdx % pool.length];
    _proxyIdx++;
    return p;
  }

  /* ── Utilities ─────────────────────────────────────────────── */
  function $k(id) { return document.getElementById(id); }
  function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function randStr(len, chars) {
    chars = chars || 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[rand(0, chars.length - 1)];
    return s;
  }
  function randUsername() {
    const adj  = ['cool','dark','fast','wild','blue','red','free','epic','neo','zen','top','mega'];
    const noun = ['wolf','hawk','storm','fire','blade','dash','fox','star','byte','noir','ace','king'];
    return adj[rand(0,adj.length-1)] + noun[rand(0,noun.length-1)] + rand(10,9999);
  }
  function randPassword() {
    const up  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lo  = 'abcdefghijklmnopqrstuvwxyz';
    const di  = '0123456789';
    const sp  = '!@#$%';
    return up[rand(0,25)] + randStr(5,lo) + di[rand(0,9)] + sp[rand(0,4)] + randStr(3,di);
  }
  const FIRST = ['Alex','Jordan','Taylor','Morgan','Casey','Riley','Avery','Quinn','Jamie','Skyler','Sam','Drew'];
  const LAST  = ['Smith','Jones','Brown','Davis','Wilson','Moore','Taylor','Anderson','Thomas','Jackson','White','Lee'];
  function randFirst() { return FIRST[rand(0,FIRST.length-1)]; }
  function randLast()  { return LAST[rand(0,LAST.length-1)]; }
  function randBirth() {
    return rand(1990,2000) + '-' + String(rand(1,12)).padStart(2,'0') + '-' + String(rand(1,28)).padStart(2,'0');
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ── Main-process fetch via IPC ────────────────────────────── */
  function mainFetch(url, opts, proxy) {
    if (window.electronAPI && window.electronAPI.kikFetch) {
      return window.electronAPI.kikFetch({ url, opts: opts || {}, proxy: proxy || null, timeoutMs: 20000 });
    }
    // Fallback for dev without Electron
    return fetch(url, opts || {}).then(r => r.text().then(body => ({ ok: r.ok, status: r.status, body })));
  }

  /* ── Storage ────────────────────────────────────────────────── */
  function loadAccounts() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }
  function saveAccounts(arr) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(arr)); } catch (_) {}
  }

  /* ── Log ─────────────────────────────────────────────────────── */
  let _logBuf = [];
  let _logPending = false;
  function kikLog(msg, cls) {
    const ts = new Date().toLocaleTimeString();
    _logBuf.push({ ts, msg: String(msg || ''), cls: cls || '' });
    if (_logBuf.length > MAX_LOG_ROWS) _logBuf.shift();
    if (_logPending) return;
    _logPending = true;
    requestAnimationFrame(() => {
      _logPending = false;
      const el = $k('kikLog');
      if (!el) return;
      el.innerHTML = _logBuf.map(r =>
        '<div class="kik-log-row' + (r.cls ? ' kl-' + r.cls : '') + '">' +
        '<span class="kl-ts">' + r.ts + '</span> ' +
        '<span class="kl-msg">' + r.msg.replace(/</g,'&lt;') + '</span></div>'
      ).join('');
      el.scrollTop = el.scrollHeight;
    });
  }

  /* ── Tempmail API ───────────────────────────────────────────── */
  async function tmGenerate(proxy) {
    const url = TEMPMAIL_API + '?action=generate&domain=' + TEMPMAIL_DOM + '&api_key=' + TEMPMAIL_KEY;
    const r = await mainFetch(url, { method: 'GET' }, proxy);
    let j;
    try { j = JSON.parse(r.body); } catch (_) { throw new Error('Tempmail parse error'); }
    if (!j.success) throw new Error('Tempmail generate: ' + (j.error || r.body));
    return j.email;
  }

  async function tmPollInbox(email, proxy) {
    const deadline = Date.now() + INBOX_TIMEOUT;
    while (Date.now() < deadline) {
      if (KIK._stopped) throw new Error('Stopped by user');
      await sleep(INBOX_POLL_MS);
      const url = TEMPMAIL_API + '?action=check&email=' + encodeURIComponent(email) + '&api_key=' + TEMPMAIL_KEY;
      try {
        const r = await mainFetch(url, { method: 'GET' }, proxy);
        const j = JSON.parse(r.body);
        if (j.success && j.count > 0) return true;
      } catch (_) {}
    }
    throw new Error('Verification email not received within 2 min');
  }

  async function tmGetInbox(email, proxy) {
    const url = TEMPMAIL_API + '?action=inbox&email=' + encodeURIComponent(email) + '&api_key=' + TEMPMAIL_KEY;
    const r = await mainFetch(url, { method: 'GET' }, proxy);
    const j = JSON.parse(r.body);
    if (!j.success) throw new Error('Inbox fetch failed');
    return j.messages || [];
  }

  async function tmGetMessage(email, id, proxy) {
    const url = TEMPMAIL_API + '?action=message&email=' + encodeURIComponent(email) + '&id=' + id + '&api_key=' + TEMPMAIL_KEY;
    const r = await mainFetch(url, { method: 'GET' }, proxy);
    const j = JSON.parse(r.body);
    return j.message || null;
  }

  /* ── Kik registration (via main process — no browser window) ── */
  async function kikRegister(email, password, username, firstName, lastName, birthdate, proxy) {
    const body = JSON.stringify({
      email, password, username,
      first_name: firstName, last_name: lastName, birthdate,
      captcha_type: 'none',
    });
    const r = await mainFetch(KIK_REG_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'User-Agent':    'com.kik.android/15.44.0 (Android 13; mobile)',
        'X-Kik-Version': '15.44.0',
      },
      body,
    }, proxy);
    let j = {};
    try { j = JSON.parse(r.body); } catch (_) {}
    if (r.ok || j.user_id || j.uid || j.username) return j;
    throw new Error('Kik API ' + r.status + ': ' + (j.message || j.error || r.body).slice(0, 200));
  }

  function extractVerifyLink(html) {
    const m = (html || '').match(/https?:\/\/[^\s"'<>]*kik\.com[^\s"'<>]*/i);
    return m ? m[0] : null;
  }

  /* ── Single account flow ───────────────────────────────────── */
  async function createOneAccount(proxyOverride) {
    const proxy = proxyOverride !== undefined ? proxyOverride : getNextProxy();
    const email     = await tmGenerate(proxy);
    const password  = randPassword();
    const username  = randUsername();
    const firstName = randFirst();
    const lastName  = randLast();
    const birthdate = randBirth();

    kikLog('→ Email: ' + email + (proxy ? '  [proxy]' : '  [direct]'), 'info');
    kikLog('  User: ' + username + '  Pass: ' + password, 'dim');

    let regResult = {};
    try {
      regResult = await kikRegister(email, password, username, firstName, lastName, birthdate, proxy);
      kikLog('  Registration OK' + (regResult.user_id ? ' uid:' + regResult.user_id : ''), 'ok');
    } catch (e) {
      kikLog('  Registration error: ' + e.message, 'err');
    }

    kikLog('  Polling inbox for verification email…', 'dim');
    let verified = false;
    try {
      await tmPollInbox(email, proxy);
      const msgs = await tmGetInbox(email, proxy);
      if (msgs.length > 0) {
        const msg = await tmGetMessage(email, msgs[0].id, proxy);
        if (msg && msg.body) {
          const link = extractVerifyLink(msg.body);
          if (link) {
            try {
              await mainFetch(link, { method: 'GET' }, proxy);
              verified = true;
              kikLog('  Email verified ✓', 'ok');
            } catch (_) {
              verified = true;
              kikLog('  Verify link clicked (network ignored)', 'ok');
            }
          } else {
            kikLog('  No verify link in email body', 'warn');
          }
        }
      }
    } catch (e) {
      if (e.message === 'Stopped by user') throw e;
      kikLog('  Verification skipped: ' + e.message, 'warn');
    }

    const account = {
      id:        Date.now() + '_' + randStr(4),
      username, email, password, firstName, lastName, birthdate,
      verified,
      proxy:     proxy || null,
      createdAt: new Date().toLocaleString(),
    };
    const arr = loadAccounts();
    arr.unshift(account);
    saveAccounts(arr);
    KIK.stats.created++;
    updateKikCountBadge();
    renderKikAccounts();
    return account;
  }

  /* ── Batch creation ────────────────────────────────────────── */
  const KIK = { running: false, _stopped: false, stats: { created: 0, failed: 0 } };

  async function kikCreateBatch() {
    if (KIK.running) return;
    KIK.running  = true;
    KIK._stopped = false;

    const qty   = Math.max(1, Math.min(50, parseInt(($k('kikQty') || {}).value) || 1));
    const delay = Math.max(1, parseInt(($k('kikDelay') || {}).value) || 3) * 1000;
    // Manual proxy override (empty = use built-in pool)
    const manualProxy = (($k('kikProxy') || {}).value || '').trim() || undefined;

    setKikBtns(true);
    $k('kikProgressWrap') && ($k('kikProgressWrap').style.display = '');
    setKikProgress(0, qty);

    kikLog('Batch start: ' + qty + ' account(s)' + (manualProxy ? ' via manual proxy' : ' via built-in pool'), 'info');

    for (let i = 0; i < qty; i++) {
      if (KIK._stopped) { kikLog('Stopped.', 'warn'); break; }
      setKikProgress(i, qty);
      kikLog('── Account ' + (i+1) + ' / ' + qty + ' ──', 'head');
      try {
        const acc = await createOneAccount(manualProxy);
        kikLog('✓ Saved: ' + acc.username + ' / ' + acc.email, 'ok');
      } catch (e) {
        if (e.message === 'Stopped by user') { kikLog('Stopped.', 'warn'); break; }
        KIK.stats.failed++;
        kikLog('✗ Failed: ' + e.message, 'err');
      }
      updateKikStats();
      if (i < qty - 1 && !KIK._stopped) await sleep(delay);
    }

    setKikProgress(qty, qty);
    kikLog('Done. Created: ' + KIK.stats.created + '  Failed: ' + KIK.stats.failed, 'info');
    KIK.running = false;
    KIK._stopped = false;
    setKikBtns(false);
  }

  function setKikBtns(running) {
    if ($k('kikCreateBtn')) $k('kikCreateBtn').style.display = running ? 'none' : '';
    if ($k('kikStopBtn'))   $k('kikStopBtn').style.display   = running ? '' : 'none';
  }
  function setKikProgress(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    if ($k('kikProgFill')) $k('kikProgFill').style.width = pct + '%';
    if ($k('kikProgText')) $k('kikProgText').textContent = done + ' / ' + total;
  }
  function updateKikStats() {
    if ($k('kikCreatedTotal')) $k('kikCreatedTotal').textContent = KIK.stats.created;
    if ($k('kikFailedTotal'))  $k('kikFailedTotal').textContent  = KIK.stats.failed;
  }
  function updateKikCountBadge() {
    const arr = loadAccounts();
    if ($k('kikAccCount')) $k('kikAccCount').textContent = arr.length || '';
    if ($k('kikQsTotal'))  $k('kikQsTotal').textContent  = arr.length;
  }

  /* ── Proxy Checker ─────────────────────────────────────────── */
  let _checkRunning = false;

  async function runProxyCheck() {
    if (_checkRunning) return;
    _checkRunning = true;
    if ($k('kikCheckBtn'))     $k('kikCheckBtn').style.display     = 'none';
    if ($k('kikCheckStopBtn')) $k('kikCheckStopBtn').style.display = '';
    if ($k('kikProxyResults')) $k('kikProxyResults').innerHTML = '';
    KIK._pxyStop = false;

    // Gather proxies from textarea (fallback to built-in list)
    const raw = ($k('kikProxyList') || {}).value || '';
    const lines = raw.split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
    const pool  = lines.length ? lines : BUILTIN_PROXIES.slice();

    kikProxyLog('Checking ' + pool.length + ' proxy/proxies…', 'info');

    if (window.electronAPI && window.electronAPI.kikProxyCheck) {
      // Register progress listener
      try {
        window.electronAPI.onKikProxyProgress((data) => {
          if (data && data.latest) data.latest.forEach(r => addProxyResultRow(r));
        });
      } catch (_) {}
      try {
        const res = await window.electronAPI.kikProxyCheck({ proxies: pool, timeoutMs: 10000 });
        if (res && res.results) {
          _workingProxies = res.results.filter(r => r.ok).map(r => r.proxy);
          kikProxyLog(
            'Done. ' + _workingProxies.length + ' working / ' + (res.results.length - _workingProxies.length) + ' failed.',
            _workingProxies.length > 0 ? 'ok' : 'err'
          );
          if (_workingProxies.length) {
            kikLog('Proxy check complete — ' + _workingProxies.length + ' working proxies loaded.', 'ok');
          }
        }
      } catch (e) {
        kikProxyLog('Checker error: ' + e.message, 'err');
      }
    } else {
      // Fallback: manual fetch check
      for (const p of pool) {
        if (KIK._pxyStop) break;
        const start = Date.now();
        try {
          const r = await fetch('https://httpbin.org/ip');
          addProxyResultRow({ proxy: p, ok: r.ok, latency: Date.now() - start });
        } catch (e) {
          addProxyResultRow({ proxy: p, ok: false, error: e.message, latency: Date.now() - start });
        }
      }
      kikProxyLog('Done (fallback mode — no proxy routing in browser context).', 'warn');
    }

    _checkRunning = false;
    if ($k('kikCheckBtn'))     $k('kikCheckBtn').style.display     = '';
    if ($k('kikCheckStopBtn')) $k('kikCheckStopBtn').style.display = 'none';
  }

  function addProxyResultRow(r) {
    const el = $k('kikProxyResults');
    if (!el) return;
    const cls = r.ok ? 'kpr-ok' : 'kpr-fail';
    const label = r.ok
      ? '✓ ' + (r.ip || '') + ' (' + (r.latency || 0) + 'ms)'
      : '✗ ' + (r.error || 'failed');
    const div = document.createElement('div');
    div.className = 'kik-proxy-result ' + cls;
    div.textContent = r.proxy + '  →  ' + label;
    el.appendChild(div);
  }

  function kikProxyLog(msg, cls) {
    const el = $k('kikProxyLog');
    if (!el) return;
    const d = document.createElement('div');
    d.className = 'kik-log-row' + (cls ? ' kl-' + cls : '');
    d.innerHTML = '<span class="kl-ts">' + new Date().toLocaleTimeString() + '</span> <span class="kl-msg">' + msg.replace(/</g,'&lt;') + '</span>';
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
  }

  /* ── Account list rendering ────────────────────────────────── */
  function renderKikAccounts() {
    const tbody = $k('kikAccBody');
    const empty = $k('kikAccEmpty');
    if (!tbody) return;
    const q   = (($k('kikSearch') || {}).value || '').toLowerCase();
    const arr = loadAccounts().filter(a => !q || (a.username||'').toLowerCase().includes(q) || (a.email||'').toLowerCase().includes(q));
    if (!arr.length) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    tbody.innerHTML = arr.map((a, i) =>
      '<tr>' +
      '<td class="kik-td-num">' + (i+1) + '</td>' +
      '<td><b>' + esc(a.username) + '</b>' + (a.verified ? ' <span class="kik-badge-ok">✓</span>' : '') + '</td>' +
      '<td class="kik-td-mono">' + esc(a.email) + '</td>' +
      '<td class="kik-td-mono kik-td-pass">' + esc(a.password) + '</td>' +
      '<td class="kik-td-dim">' + esc(a.createdAt) + '</td>' +
      '<td><button class="btn danger xs kik-del-btn" data-id="' + esc(a.id) + '" type="button">Del</button></td>' +
      '</tr>'
    ).join('');
    tbody.querySelectorAll('.kik-del-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        saveAccounts(loadAccounts().filter(x => x.id !== this.dataset.id));
        updateKikCountBadge();
        renderKikAccounts();
      });
    });
  }
  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── Bootstrap proxy list into textarea ────────────────────── */
  function populateProxyTextarea() {
    const ta = $k('kikProxyList');
    if (!ta || ta.value.trim()) return;
    ta.value = BUILTIN_PROXIES.join('\n');
  }

  /* ── Wire events ───────────────────────────────────────────── */
  function kikBoot() {
    const cb = $k('kikCreateBtn');
    if (cb) cb.addEventListener('click', kikCreateBatch);

    const sb = $k('kikStopBtn');
    if (sb) sb.addEventListener('click', function() { KIK._stopped = true; });

    const cl = $k('kikClearLogBtn');
    if (cl) cl.addEventListener('click', function() { _logBuf = []; const el=$k('kikLog'); if(el) el.innerHTML=''; });

    const exp = $k('kikExportBtn');
    if (exp) exp.addEventListener('click', function() {
      const arr = loadAccounts();
      if (!arr.length) return;
      navigator.clipboard.writeText(arr.map(a => a.username + ':' + a.password + ':' + a.email).join('\n')).then(function() {
        if (typeof notify === 'function') notify('Copied ' + arr.length + ' accounts', 'success');
      });
    });

    const da = $k('kikDeleteAllBtn');
    if (da) da.addEventListener('click', function() {
      if (!confirm('Delete ALL Kik accounts? This cannot be undone.')) return;
      saveAccounts([]);
      updateKikCountBadge();
      renderKikAccounts();
    });

    const srch = $k('kikSearch');
    if (srch) srch.addEventListener('input', renderKikAccounts);

    // Proxy checker wiring
    const chk = $k('kikCheckBtn');
    if (chk) chk.addEventListener('click', runProxyCheck);

    const chkStop = $k('kikCheckStopBtn');
    if (chkStop) chkStop.addEventListener('click', function() { KIK._pxyStop = true; _checkRunning = false; });

    const addBuiltin = $k('kikLoadBuiltinBtn');
    if (addBuiltin) addBuiltin.addEventListener('click', function() {
      const ta = $k('kikProxyList');
      if (!ta) return;
      const existing = new Set(ta.value.split('\n').map(l=>l.trim()).filter(Boolean));
      BUILTIN_PROXIES.forEach(p => existing.add(p));
      ta.value = Array.from(existing).join('\n');
    });

    populateProxyTextarea();
    updateKikCountBadge();
    renderKikAccounts();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kikBoot);
  else kikBoot();

  window.Kik = { createBatch: kikCreateBatch, loadAccounts, renderAccounts: renderKikAccounts, checkProxies: runProxyCheck };
})();
