/**
 * CIA Intervention Module
 * Handles the "Visitor" intervention when player heat reaches 85%+
 *
 * Dependencies (from global scope):
 * - GameState: Main game state object
 * - AccountManager: For toast notifications (optional)
 * - Storage: For saving state changes
 */

// CIA "Visitor" Intervention — Phase 1 (Systems Only, No Art)
// =========================================================
const CIAIntervention = (() => {
      const HEAT_THRESHOLD = 85;
      const CIA_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes safety cooldown to prevent loops

      function _now() { return Date.now(); }
      function _clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

      function _toast(msg) {
        try {
          if (typeof AccountManager !== 'undefined' && AccountManager?.showToast) {
            AccountManager.showToast(msg);
            return;
          }
        } catch (e) {}
        // Fallback DOM toast (works even when UI systems aren't ready)
        try {
          const id = 'cia-phase1-toast';
          let el = document.getElementById(id);
          if (!el) {
            el = document.createElement('div');
            el.id = id;
            el.style.cssText = [
              'position:fixed',
              'left:50%',
              'top:12%',
              'transform:translateX(-50%)',
              'z-index:999999',
              'padding:10px 14px',
              'border-radius:12px',
              'background:rgba(0,0,0,0.75)',
              'color:#fff',
              'font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
              'font-size:14px',
              'border:1px solid rgba(255,255,255,0.15)',
              'max-width:90vw',
              'text-align:center',
              'pointer-events:none',
              'opacity:0',
              'transition:opacity 180ms ease'
            ].join(';');
            document.body.appendChild(el);
          }
          el.textContent = msg;
          requestAnimationFrame(() => { el.style.opacity = '1'; });
          setTimeout(() => { try { el.style.opacity = '0'; } catch(e) {} }, 1800);
        } catch (e) {}
      }

      
      // ---------------------------
      // Phase 2 UI: Visual Lockdown + Dialog
      // ---------------------------
      const UI = {
        mounted: false,
        overlay: null,
        clouds: null,
        dialog: null,
        titleEl: null,
        bodyEl: null,
        actionsEl: null,
        dimmerEl: null,
        portraitWrapEl: null,
        portraitImgEl: null,
        agentSprite: null,
        activeStep: 'main',
        pickListener: null,
        pickRefreshTimer: null
      };

// ---------------------------
// Phase 3: CIA Operative Sprite (PNG frame animation, DOM-based)
// ---------------------------
const CIA_SPRITE_PATH = {
  idle: [
    'sprites/cia-agent-pngs/idle_01.png',
    'sprites/cia-agent-pngs/idle_02.png'
  ],
  talk: [
    'sprites/cia-agent-pngs/talk_01.png',
    'sprites/cia-agent-pngs/talk_02.png',
    'sprites/cia-agent-pngs/talk_03.png',
    'sprites/cia-agent-pngs/talk_04.png'
  ]
};

class CIAAgentSprite {
  constructor(imgEl) {
    this.imgEl = imgEl || null;
    this.mode = 'idle';
    this.frame = 0;
    this.timer = null;
    this.preloaded = new Set();
    this.failed = new Set();
    this._lastSrc = '';
    this._ensureImgHandlers();
    this.setMode('idle');
  }

  _ensureImgHandlers() {
    if (!this.imgEl) return;
    this.imgEl.addEventListener('error', () => {
      try {
        const src = this.imgEl?.src || '';
        if (src) this.failed.add(src);
      } catch(e) {}
    });
  }

  preloadAll() {
    try {
      const all = [...CIA_SPRITE_PATH.idle, ...CIA_SPRITE_PATH.talk];
      all.forEach(src => this._preload(src));
    } catch(e) {}
  }

  _preload(src) {
    if (!src || this.preloaded.has(src) || this.failed.has(src)) return;
    this.preloaded.add(src);
    try {
      const im = new Image();
      im.onload = () => {};
      im.onerror = () => { try { this.failed.add(src); } catch(e) {} };
      im.src = src;
    } catch(e) {}
  }

  setMode(mode) {
    const next = (mode === 'talk') ? 'talk' : 'idle';
    this.mode = next;
    this.frame = 0;

    const ms = (this.mode === 'talk') ? 220 : 520;

    this.stop();
    this._tick();
    this.timer = setInterval(() => this._tick(), ms);
  }

  _tick() {
    if (!this.imgEl) return;
    const frames = CIA_SPRITE_PATH[this.mode] || CIA_SPRITE_PATH.idle;
    if (!frames || !frames.length) return;

    const src = frames[this.frame % frames.length];
    this.frame = (this.frame + 1) % frames.length;

    const nextSrc = frames[this.frame % frames.length];
    this._preload(nextSrc);

    if (src && src !== this._lastSrc && !this.failed.has(src)) {
      this._lastSrc = src;
      try {
        this.imgEl.classList.remove('cia-sprite-ready');
        const onload = () => {
          try { this.imgEl.classList.add('cia-sprite-ready'); } catch(e) {}
        };
        this.imgEl.addEventListener('load', onload, { once: true });
        this.imgEl.src = src;
      } catch(e) {}
    }
  }

  stop() {
    if (this.timer) { try { clearInterval(this.timer); } catch(e) {} }
    this.timer = null;
  }

  destroy() {
    this.stop();
    try {
      if (this.imgEl) {
        this.imgEl.classList.remove('cia-sprite-ready');
        this.imgEl.removeAttribute('src');
      }
    } catch(e) {}
  }
}



      function _injectStylesOnce() {
        try {
          if (document.getElementById('cia-phase2-styles')) return;
          const style = document.createElement('style');
          style.id = 'cia-phase2-styles';
          style.textContent = `
            .cia-lockdown-overlay{
              position:fixed; inset:0; z-index: 999997;
              display:none; align-items:center; justify-content:center;
              pointer-events:auto;
              font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
            }
            .cia-lockdown-overlay.cia-open{ display:flex; }
            .cia-lockdown-dimmer{
              position:absolute; inset:0;
              background: rgba(0,0,0,0.62);
              backdrop-filter: blur(2px);
            }
            .cia-lockdown-clouds{
              position:absolute; inset:-20%;
              opacity:0.75;
              background:
                radial-gradient(circle at 20% 30%, rgba(255,255,255,0.18) 0 30%, transparent 35%),
                radial-gradient(circle at 60% 20%, rgba(255,255,255,0.14) 0 28%, transparent 34%),
                radial-gradient(circle at 80% 60%, rgba(255,255,255,0.12) 0 34%, transparent 40%),
                radial-gradient(circle at 35% 75%, rgba(255,255,255,0.10) 0 30%, transparent 36%),
                radial-gradient(circle at 55% 55%, rgba(255,255,255,0.08) 0 35%, transparent 42%);
              filter: blur(8px);
              transform: translate3d(0,0,0);
              animation: ciaCloudDrift 14s linear infinite;
            }
            @keyframes ciaCloudDrift{
              0%{ transform: translate3d(-3%, -2%, 0) scale(1.02); }
              50%{ transform: translate3d(3%, 2%, 0) scale(1.05); }
              100%{ transform: translate3d(-3%, -2%, 0) scale(1.02); }
            }
            .cia-dialog{
              position:relative;
              width:min(92vw, 420px);
              border-radius: 18px;
              background: rgba(12,12,14,0.92);
              border: 1px solid rgba(255,255,255,0.14);
              box-shadow: 0 18px 70px rgba(0,0,0,0.55);
              padding: 14px 14px 12px;
              transform: translateY(10px);
              opacity:0;
              animation: ciaPop 220ms ease forwards;
              z-index: 2;
            }
            @keyframes ciaPop{
              to { transform: translateY(0); opacity:1; }
            }
            .cia-dialog .cia-badge{
              display:flex; align-items:center; gap:8px;
              font-size: 12px; letter-spacing: 0.12em;
              text-transform: uppercase;
              color: rgba(171, 216, 255, 0.92);
              margin-bottom: 8px;
              font-weight: 700;
            }
            .cia-dialog .cia-title{
              font-size: 18px;
              font-weight: 800;
              color: #fff;
              margin: 0 0 8px 0;
              line-height: 1.2;
            }
            .cia-dialog .cia-body{
              font-size: 13px;
              color: rgba(255,255,255,0.82);
              line-height: 1.45;
              margin-bottom: 12px;
            }

.cia-portrait-row{
  display:flex; align-items:center; justify-content:center;
  margin: 10px 0 8px;
}
.cia-portrait-frame{
  width: min(78vw, 340px);
  max-width: 340px;
  aspect-ratio: 1 / 1;
  border-radius: 16px;
  overflow:hidden;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.25);
  display:flex; align-items:center; justify-content:center;
}
.cia-portrait-row img{
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: auto;
  transform: translateZ(0);
  opacity: 0;
  transition: opacity 200ms ease-in-out;
}
.cia-portrait-row img.cia-sprite-ready{ opacity: 1; }
            .cia-dialog .cia-actions{
              display:flex;
              flex-direction:column;
              gap: 8px;
            }
            .cia-btn{
              border: 1px solid rgba(255,255,255,0.14);
              background: rgba(255,255,255,0.06);
              color: #fff;
              padding: 11px 12px;
              border-radius: 14px;
              font-size: 14px;
              font-weight: 700;
              cursor: pointer;
              display:flex;
              align-items:center;
              justify-content:space-between;
              gap:10px;
              -webkit-tap-highlight-color: transparent;
            }
            .cia-btn:active{ transform: scale(0.99); }
            .cia-btn small{
              font-size: 12px;
              color: rgba(255,255,255,0.70);
              font-weight: 600;
            }
            .cia-btn[disabled]{
              opacity: 0.45;
              cursor: not-allowed;
              transform: none !important;
            }
            .cia-btn.primary{
              border-color: rgba(138,180,248,0.45);
              background: rgba(138,180,248,0.16);
            }
            .cia-btn.danger{
              border-color: rgba(255,90,90,0.38);
              background: rgba(255,90,90,0.12);
            }
            .cia-btn.ghost{
              background: transparent;
            }
            .cia-hint{
              margin-top: 10px;
              font-size: 11px;
              color: rgba(255,255,255,0.62);
              opacity: 0.95;
            }
            /* Property highlight system */
            .property-building.cia-highlight{
              filter: drop-shadow(0 0 10px rgba(255, 70, 70, 0.9));
              animation: ciaPulseRed 950ms ease-in-out infinite;
            }
            .property-building.cia-selected{
              filter: drop-shadow(0 0 14px rgba(255, 110, 110, 1));
              animation: ciaPulseRed 650ms ease-in-out infinite;
            }
            @keyframes ciaPulseRed{
              0%{ transform: translate(-50%, -50%) scale(1.00); }
              50%{ transform: translate(-50%, -50%) scale(1.10); }
              100%{ transform: translate(-50%, -50%) scale(1.00); }
            }
          
            /* Mobile + reduced motion tuning */
            @media (max-width: 480px), (pointer: coarse) {
              .cia-lockdown-clouds{
                opacity:0.55;
                filter: blur(6px);
                inset:-12%;
                animation-duration: 20s;
              }
              .cia-lockdown-dimmer{
                background: rgba(0,0,0,0.66);
              }
              .cia-dialog{
                width:min(94vw, 420px);
              }
            }
            @media (prefers-reduced-motion: reduce) {
              .cia-lockdown-clouds{ animation: none !important; }
              .cia-dialog{ animation: none !important; opacity:1 !important; transform:none !important; }
              .cia-btn:active{ transform:none !important; }
            }
`;
          document.head.appendChild(style);
        } catch (e) {}
      }

      function _ensureUI() {
        if (UI.mounted) return;
        _injectStylesOnce();

        const overlay = document.createElement('div');
        overlay.className = 'cia-lockdown-overlay';
        overlay.id = 'cia-lockdown-overlay';

        const dimmer = document.createElement('div');
        dimmer.className = 'cia-lockdown-dimmer';

        const clouds = document.createElement('div');
        clouds.className = 'cia-lockdown-clouds';

        const dialog = document.createElement('div');
        dialog.className = 'cia-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');

        dialog.innerHTML = `
          <div class="cia-badge">🕶️ SPECIAL EVENT • LOCKDOWN</div>
          <div class="cia-title" id="cia-dialog-title">The Visitor</div>
          <div class=\"cia-portrait-row\" id=\"cia-portrait-row\"><div class=\"cia-portrait-frame\"><img id=\"cia-portrait-img\" alt=\"CIA operative\" /></div></div>
          <div class="cia-body" id="cia-dialog-body"></div>
          <div class="cia-actions" id="cia-dialog-actions"></div>
          <div class="cia-hint" id="cia-dialog-hint"></div>
        `;

        overlay.appendChild(dimmer);
        overlay.appendChild(clouds);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // Prevent taps behind the overlay on mobile
        overlay.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
        dimmer.addEventListener('click', (e) => {
          // Don't allow dismiss by tapping outside during an active choice
          e.preventDefault();
          e.stopPropagation();
          _toast('🕶️ The Visitor is waiting.');
        });

        UI.mounted = true;
        UI.overlay = overlay;
        UI.clouds = clouds;
        UI.dialog = dialog;
        UI.titleEl = dialog.querySelector('#cia-dialog-title');
        UI.bodyEl = dialog.querySelector('#cia-dialog-body');
        UI.actionsEl = dialog.querySelector('#cia-dialog-actions');
        UI.hintEl = dialog.querySelector('#cia-dialog-hint');
        UI.portraitWrapEl = dialog.querySelector('#cia-portrait-row');
        UI.portraitImgEl = dialog.querySelector('#cia-portrait-img');
        if (!UI.agentSprite) {
          try { UI.agentSprite = new CIAAgentSprite(UI.portraitImgEl); } catch(e) { UI.agentSprite = null; }
        }

      }

      function _openUI() {
        _ensureUI();
        try { UI.overlay.classList.add('cia-open'); } catch(e) {}
        try { document.body.style.overflow = 'hidden'; } catch(e) {}
      }

      function _closeUI() {
        try {
          _stopPropertyPickMode();
          if (UI.overlay) UI.overlay.classList.remove('cia-open');
          // Phase 3: fade out agent sprite then destroy to stop timers.
          try {
            if (UI.portraitImgEl) UI.portraitImgEl.classList.remove('cia-sprite-ready');
            if (UI.agentSprite) setTimeout(() => { try { UI.agentSprite.destroy(); } catch(e) {} }, 180);
          } catch(e) {}
          document.body.style.overflow = '';
        } catch (e) {}
      }

      function _fmtMoney(n) {
        const v = Math.max(0, Math.floor(Number(n || 0)));
        try { return '$' + v.toLocaleString(); } catch(e) { return '$' + v; }
      }

      function _setDialog(title, bodyHtml, actions, hintText, opts) {
        _openUI();
        const o = opts && typeof opts === 'object' ? opts : {};
        const delayActionsMs = Math.max(0, Math.floor(Number(o.delayActionsMs || 0)));
        if (UI.titleEl) UI.titleEl.textContent = title || 'The Visitor';
        if (UI.bodyEl) UI.bodyEl.innerHTML = bodyHtml || '';
        if (UI.hintEl) UI.hintEl.textContent = hintText || '';
        // Phase 3 sprite behavior:
        // talk while dialog is "landing" (before choices), idle once choices are visible.
        try {
          if (UI.agentSprite) {
            UI.agentSprite.preloadAll();
            const force = (o && typeof o.spriteMode === 'string') ? o.spriteMode : '';
            if (force === 'talk' || force === 'idle') {
              UI.agentSprite.setMode(force);
            } else {
              UI.agentSprite.setMode(delayActionsMs > 0 ? 'talk' : 'idle');
            }
          }
        } catch(e) {}
        if (!UI.actionsEl) return;

        UI.actionsEl.innerHTML = '';
        (actions || []).forEach(btn => {
          const b = document.createElement('button');
          b.className = 'cia-btn ' + (btn.kind || '');
          b.type = 'button';

          const origDisabled = !!btn.disabled;
          b.dataset.ciaOrigDisabled = origDisabled ? '1' : '0';

          // Pacing: optionally "hold" buttons for a beat, but preserve original disabled state.
          if (delayActionsMs > 0) {
            b.disabled = true;
            b.dataset.ciaDelay = '1';
          } else {
            b.disabled = origDisabled;
          }

          b.innerHTML = btn.html || btn.label || 'Choose';
          b.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            try { btn.onClick && btn.onClick(); } catch(err) { console.warn('[CIA UI] button click error', err); }
          });
          UI.actionsEl.appendChild(b);
        });

        if (delayActionsMs > 0) {
          setTimeout(() => {
            try {
              UI.actionsEl.querySelectorAll('button[data-cia-delay="1"]').forEach(b => {
                const wasDisabled = (b.dataset.ciaOrigDisabled === '1');
                b.disabled = wasDisabled;
                b.removeAttribute('data-cia-delay');
              });
            } catch(e) {}
            // Phase 3: once choices are active, go idle.
            try { if (UI.agentSprite) UI.agentSprite.setMode('idle'); } catch(e) {}
          }, delayActionsMs);
        }
      }

      function _applyAndExit(type, payload, flavor) {
        // Tiny pacing beat so the player can feel the choice "land"
        try {
          const msg = (typeof flavor === 'string' && flavor.trim()) ? flavor.trim() : 'Processing…';
          _setDialog('The Visitor', `<div style="opacity:.92">🕶️ ${msg}</div><div style="opacity:.70; margin-top:6px;">The fog shuffles paperwork.</div>`, [], '', { spriteMode: 'talk' });
        } catch(e) {}
        setTimeout(() => {
          try {
            const ok = apply(type, payload);
            if (!ok) _toast('⚠️ Could not apply that deal.');
          } catch(e) {
            console.warn('[CIA UI] apply failed', e);
            _toast('⚠️ Something went wrong.');
          }
        }, 260);
      }


      
      function _renderIntroDialog(st) {
        const snap = st.snapshot || {};
        const heat = Number(snap.globalHeat || GameState.player?.globalHeat || 0);

        const body = `
          <div style="opacity:.92; margin-bottom:6px;">
            The air gets thicker. Phones go quiet.
          </div>
          <div style="opacity:.82">
            Somewhere nearby, a door you didn’t see before… <b>opens</b>.
          </div>
          <div style="opacity:.78; margin-top:8px;">
            Heat: <b>${Math.floor(heat)}%</b>
          </div>
        `;

        const actions = [
          {
            kind: 'primary',
            html: `<span>😐 Continue</span><small>Hear the offer</small>`,
            onClick: () => { try { _renderMainDialog(st); } catch(e) {} }
          },
          {
            kind: 'ghost',
            html: `<span>🧾 Skip the poetry</span><small>Show options</small>`,
            onClick: () => { try { _renderMainDialog(st); } catch(e) {} }
          }
        ];

        _setDialog('Lockdown', body, actions, 'No pausing. No escaping. Just choices.', { delayActionsMs: 500 });
      }

function _renderMainDialog(type, payload) {
        try {
          const ok = apply(type, payload);
          if (!ok) _toast('⚠️ Could not apply that deal.');
        } catch(e) {
          console.warn('[CIA UI] apply failed', e);
          _toast('⚠️ Something went wrong.');
        }
      }

      function _renderMainDialog(st) {
        const offers = st.offers || {};
        const snap = st.snapshot || {};
        const heat = Number(snap.globalHeat || GameState.player?.globalHeat || 0);

        const actions = [];

        // Cash
        if (offers.cash) {
          const canPay = Number(GameState.player?.cash || 0) >= Number(offers.cash.cost || 0);
          actions.push({
            kind: 'primary',
            disabled: !canPay,
            html: `<span>💰 Pay ${_fmtMoney(offers.cash.cost)} <small style="opacity:.9">(hush money)</small></span><small>Heat −${offers.cash.heatReduction}</small>`,
            onClick: () => _applyAndExit('cash', offers.cash, 'Payment received. Nothing personal.')
          });
        }

        // Weapons
        if (offers.weapons) {
          actions.push({
            kind: '',
            html: `<span>🔫 Hand over ${offers.weapons.weaponsTaken} piece${offers.weapons.weaponsTaken === 1 ? '' : 's'}</span><small>Heat −${offers.weapons.heatReduction}</small>`,
            onClick: () => _applyAndExit('weapons', offers.weapons, 'Weapons logged. Safely “stored”.')
          });
        }

        // Property
        const propOffers = Array.isArray(offers.properties) ? offers.properties : [];
        if (propOffers.length) {
          actions.push({
            kind: 'danger',
            html: `<span>🏢 Let them “lease” a property</span><small>Pick 1 • Heat −${Math.max(...propOffers.map(o => Number(o.heatReduction || 0)))} max</small>`,
            onClick: () => _startPropertyPickMode(st)
          });
        }

        // Refuse
        actions.push({
          kind: 'ghost',
          html: `<span>🙅 Refuse</span><small>No deal</small>`,
          onClick: () => { _toast('The fog closes. The Visitor is gone.'); end(); }
        });

        const body = `
          <div style="opacity:.92; margin-bottom:6px;">
            Lockdown is in effect. Your Heat is <b>${Math.floor(heat)}%</b>.
          </div>
          <div style="opacity:.82">
            A voice, smooth as a velvet threat: <i>“We can make this… quieter.”</i>
          </div>
        `;

        _setDialog('The Visitor', body, actions, 'Choose your exit. Choose carefully.', { delayActionsMs: 420 });
      }

      function _clearPropertyHighlights() {
        try {
          const icons = document.getElementById('map-icons');
          if (!icons) return;
          icons.querySelectorAll('.property-building.cia-highlight, .property-building.cia-selected')
            .forEach(el => { el.classList.remove('cia-highlight'); el.classList.remove('cia-selected'); });
        } catch(e) {}
      }

      function _applyPropertyHighlights(eligibleIds, selectedId) {
        try {
          const icons = document.getElementById('map-icons');
          if (!icons) return;
          const set = new Set((eligibleIds || []).map(String));
          icons.querySelectorAll('.property-building').forEach(el => {
            const id = String(el.dataset.id || '');
            if (set.has(id)) el.classList.add('cia-highlight'); else el.classList.remove('cia-highlight');
            if (selectedId && id === String(selectedId)) el.classList.add('cia-selected'); else el.classList.remove('cia-selected');
          });
        } catch(e) {}
      }

      function _startPropertyPickMode(st) {
        const offers = st.offers || {};
        const list = Array.isArray(offers.properties) ? offers.properties : [];
        const eligibleIds = list.map(o => String(o.propertyId));

        UI.activeStep = 'pick_property';

        const actions = [
          {
            kind: 'ghost',
            html: `<span>⬅️ Back</span><small>Choose a different deal</small>`,
            onClick: () => { _stopPropertyPickMode(); _renderMainDialog(st); }
          }
        ];

        const body = `
          <div style="opacity:.92; margin-bottom:6px;">
            Pick a property on the map. They “lease” it for 24h.
          </div>
          <div style="opacity:.80">
            Eligible properties will pulse red.
          </div>
        `;

        _setDialog('Lease a Property', body, actions, 'Tap a highlighted property on the Turf map.', { delayActionsMs: 260 });

        // Best effort: switch to Turf tab so the player can actually see buildings
        try {
          if (typeof showTab === 'function') showTab('turf');
        } catch(e) {}

        _applyPropertyHighlights(eligibleIds, null);

        // Capture clicks on properties (override modal open)
        const pickHandler = (ev) => {
          const t = ev.target;
          const el = t && t.closest ? t.closest('.property-building') : null;
          if (!el) return;
          const pid = String(el.dataset.id || '');
          if (!eligibleIds.includes(pid)) return;

          ev.preventDefault();
          ev.stopPropagation();

          const offer = list.find(o => String(o.propertyId) === pid) || null;
          if (!offer) return;

          _applyPropertyHighlights(eligibleIds, pid);
          _toast('🏢 Marked: ' + (offer.propertyName || pid));
          setTimeout(() => _applyAndExit('property', offer, 'Lease paperwork stamped.'), 220);
        };

        UI.pickListener = pickHandler;

        // Use capture to beat existing handlers
        const icons = document.getElementById('map-icons');
        if (icons) icons.addEventListener('click', pickHandler, true);

        // Re-apply highlights periodically (map can re-render on mobile tab swaps)
        UI.pickRefreshTimer = setInterval(() => {
          try {
            const st2 = GameState.ciaIntervention;
            if (!st2 || !st2.active || !st2.pendingChoice) return;
            _applyPropertyHighlights(eligibleIds, null);
          } catch(e) {}
        }, 650);
      }

      function _stopPropertyPickMode() {
        try {
          if (UI.pickRefreshTimer) { clearInterval(UI.pickRefreshTimer); UI.pickRefreshTimer = null; }
          const icons = document.getElementById('map-icons');
          if (icons && UI.pickListener) icons.removeEventListener('click', UI.pickListener, true);
          UI.pickListener = null;
          _clearPropertyHighlights();
        } catch(e) {}
      }
function _ensureState() {
        try { ensureGameStateSchema(); } catch(e) {}
        if (!GameState.ciaIntervention || typeof GameState.ciaIntervention !== 'object') {
          GameState.ciaIntervention = JSON.parse(JSON.stringify(DEFAULT_STATE.ciaIntervention));
        }
        return GameState.ciaIntervention;
      }

      function _captureSnapshot() {
        const p = GameState.player || {};
        const weapons = Array.isArray(p.weapons) ? p.weapons.slice() : [];
        const weaponParts = (p.weaponParts && typeof p.weaponParts === 'object') ? { ...p.weaponParts } : {};
        const properties = [];
// Preferred source: propertyBuildings (real estate + optional landmark properties)
if (Array.isArray(GameState.propertyBuildings)) {
  GameState.propertyBuildings.forEach(b => {
    if (!b || !b.owned) return;
    properties.push({
      id: b.id,
      name: b.name || ('Property ' + b.id),
      dailyIncome: Number(b.dailyIncome || b.income || 0),
      tier: Number(b.tier || b.upgradeLevel || 1)
    });
  });
}

// Fallbacks for older schemas
if (properties.length === 0 && Array.isArray(GameState.turf?.properties)) {
  GameState.turf.properties
    .filter(x => x && x.owned)
    .forEach(x => {
      properties.push({
        id: x.id,
        name: x.name || ('Property ' + x.id),
        dailyIncome: Number(x.dailyIncome || x.income || 0),
        tier: Number(x.tier || 1)
      });
    });
}

// Optional: owned landmarks (future-proof)
try {
  const ownership = GameState.landmarkOwnership || {};
  if (Array.isArray(GameState.mapIcons)) {
    GameState.mapIcons.forEach(icon => {
      if (!icon) return;
      const owned = !!icon.owned || !!ownership[icon.type];
      if (!owned) return;
      // Landmarks may not have income yet; keep it 0 for Phase 1 unless defined later
      properties.push({
        id: icon.type,
        name: icon.label || icon.type,
        dailyIncome: Number(icon.dailyIncome || icon.income || 0),
        tier: Number(icon.tier || 1)
      });
    });
  }
} catch(e) {}
return {
          cash: Number(p.cash || 0),
          weapons,
          weaponParts,
          properties,
          globalHeat: Number(p.globalHeat || 0),
          timestamp: _now()
        };
      }

      function _computeOffers(snapshot) {
        const heat = snapshot.globalHeat || 0;
        const cash = snapshot.cash || 0;

        // Cash offer: percentage scales gently with wealth; heat reduction is meaningful but not free.
        const cashOffer = (cash > 0) ? (() => {
          const pct = _clamp(0.10 + (cash / 250000) * 0.10, 0.10, 0.35); // 10%..35%
          const cost = Math.max(1, Math.floor(cash * pct));
          const reduction = _clamp(Math.floor(heat * pct), 10, 70);
          return { cost, pct, heatReduction: reduction };
        })() : null;

        // Weapons offer: take all weapons in Phase 1 stub (Phase 2 adds selection)
        const weaponsOffer = (snapshot.weapons.length > 0) ? (() => {
          const count = snapshot.weapons.length;
          const reduction = _clamp(count * 8, 10, 60);
          return { weaponsTaken: count, heatReduction: reduction };
        })() : null;

        // Property offer list (Phase 2 will add UI selection)
        const propertyOffers = (snapshot.properties.length > 0)
  ? snapshot.properties.map(p => ({
      propertyId: p.id,
      propertyName: p.name,
      durationHours: 24,
      heatReduction: _clamp(Math.floor((p.dailyIncome || 0) / 10), 5, 40)
    }))
  : [];;

        return { cash: cashOffer, weapons: weaponsOffer, properties: propertyOffers };
      }

      function _reduceGlobalHeat(amount) {
        const p = GameState.player || (GameState.player = {});
        const cur = Number(p.globalHeat || 0);
        p.globalHeat = _clamp(cur - Number(amount || 0), 0, 100);
      }

      function stage(reason = 'lockdown') {
        const st = _ensureState();
        st.active = true;
        st.pendingChoice = true; // systems-only; Phase 2 UI will resolve this
        st.reason = reason;
        st.triggeredAt = _now();

        // Create a stable lockdownId (used to avoid re-trigger spam)
        const lockdownUntil = GameState.cityState?.lockdownUntil || 0;
        st.lockdownId = String(lockdownUntil || st.triggeredAt);

        st.snapshot = _captureSnapshot();
        st.offers = _computeOffers(st.snapshot);

        // Toast rate limit
        if (_now() - (st.lastToastAt || 0) > 1500) {
          st.lastToastAt = _now();
          _toast('👤 The Visitor has arrived');
        }

                try { _renderIntroDialog(st); } catch(e) { console.warn('[CIA UI] render failed', e); }

console.log('[CIA] Intervention staged (Phase 2)', st);
        return st;
      }

      function maybeAutoStage() {
        const st = _ensureState();
        const heat = Number(GameState.player?.globalHeat || 0);
        const lockdown = !!GameState.cityState?.lockdown;

        // If we're already mid-intervention, don't re-stage.
        if (st.pendingChoice || st.active) return false;

        // Heat-only trigger (outside lockdown)
        if (!lockdown && heat < HEAT_THRESHOLD) return false;

        const now = _now();

        // Global cooldown guard (prevents rapid re-trigger loops on mobile ticks)
        if (st.cooldownUntil && now < Number(st.cooldownUntil || 0)) return false;

        // If we're in a lockdown window, allow ONLY one intervention per lockdownId
        const lockdownId = String(GameState.cityState?.lockdownUntil || 'lockdown');
        if (lockdown) {
          if (st.lockdownId && st.lockdownId === lockdownId) return false; // already staged for this lockdownId previously
          if (st.lastResolvedLockdownId && st.lastResolvedLockdownId === lockdownId) return false; // already resolved for this lockdownId
        } else {
          // Outside lockdown: space out interventions even if heat stays high
          if (st.lastResolvedAt && (now - Number(st.lastResolvedAt || 0) < CIA_COOLDOWN_MS)) return false;
        }

        return !!stage('lockdown');
      }

      function apply(type, payload) {
        const st = _ensureState();
        if (!st.active || !st.pendingChoice) {
          console.warn('[CIA] apply() called but no pending intervention.');
          return false;
        }

        if (type === 'cash' && payload?.cost != null && payload?.heatReduction != null) {
          GameState.player.cash = Math.max(0, Number(GameState.player.cash || 0) - Number(payload.cost || 0));
          _reduceGlobalHeat(payload.heatReduction);
        } else if (type === 'weapons' && payload?.heatReduction != null) {
          // stub: remove all weapons
          if (Array.isArray(GameState.player.weapons)) GameState.player.weapons.length = 0;
          _reduceGlobalHeat(payload.heatReduction);

} else if (type === 'property') {
  // Allow payload to be:
  //  - an offer object: { propertyId, heatReduction, durationHours }
  //  - a propertyId string (we'll resolve to an offer)
  //  - undefined (we'll auto-pick the first offer)
  const stOffers = st.offers || {};
  const offerList = Array.isArray(stOffers.properties) ? stOffers.properties : [];
  let offer = null;

  if (typeof payload === 'string') {
    offer = offerList.find(o => o && o.propertyId === payload) || null;
  } else if (payload && typeof payload === 'object') {
    offer = payload;
  } else {
    offer = offerList[0] || null;
  }

  if (!offer || offer.propertyId == null || offer.heatReduction == null) {
    console.warn('[CIA] Unknown apply type or malformed payload:', type, payload);
    return false;
  }

  // Mark the property as temporarily "leased"/compromised (Phase 1 placeholder)
  const pid = String(offer.propertyId);
  const p = Array.isArray(GameState.propertyBuildings)
    ? GameState.propertyBuildings.find(x => x && String(x.id) === pid)
    : null;

  if (p) {
    p.heatLeasedUntil = _now() + (Number(offer.durationHours || 24) * 3600 * 1000);
  }

  _reduceGlobalHeat(offer.heatReduction);
        } else {
          console.warn('[CIA] Unknown apply type or malformed payload:', type, payload);
          return false;
        }

        // End Phase 1 stub (UI resolves later; for now, mark resolved)
        st.pendingChoice = false;
        st.active = false;

        // Mark resolved to prevent immediate re-trigger loops
        st.lastResolvedAt = _now();
        st.lastResolvedLockdownId = st.lockdownId;
        st.cooldownUntil = _now() + CIA_COOLDOWN_MS;

                try { _closeUI(); } catch(e) {}
_toast('🕶️ Deal done. Heat adjusted.');
        console.log('[CIA] Resolution applied', type, payload, 'new heat=', GameState.player.globalHeat);
        return true;
      }

      function end() {
        const st = _ensureState();
        st.active = false;
        st.pendingChoice = false;

        // Treat manual end as a resolution for cooldown purposes
        st.lastResolvedAt = _now();
        st.lastResolvedLockdownId = st.lockdownId;
        st.cooldownUntil = _now() + CIA_COOLDOWN_MS;

        try { _closeUI(); } catch(e) {}
        return true;
      }

      return { stage, maybeAutoStage, apply, end };
    })();

// Export for ES6 module usage
export { CIAIntervention };

// Also make it globally available for legacy code compatibility
if (typeof window !== 'undefined') {
  window.CIAIntervention = CIAIntervention;
}
