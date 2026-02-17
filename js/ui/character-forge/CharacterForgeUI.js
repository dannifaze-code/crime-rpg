/**
 * CharacterForgeUI.js
 * Main orchestration: mount/unmount the Character Forge overlay.
 * Supports opening to a specific tab via open(initialTab).
 */
(function () {
  'use strict';

  var DEV = false;
  function log() {
    if (DEV) console.log.apply(console, ['[CharacterForge:UI]'].concat(Array.prototype.slice.call(arguments)));
  }

  var _overlay = null;
  var _panelContainer = null;
  var _onResize = null;
  var _stateListener = null;
  var _isOpen = false;

  var TABS = [
    { id: 'create', icon: '✏️', label: 'Create' },
    { id: 'wardrobe', icon: '👔', label: 'Wardrobe' },
    { id: 'armor', icon: '🛡️', label: 'Armor' },
    { id: 'animals', icon: '🐾', label: 'Animals' }
  ];

  var PANELS = {
    create: window.PanelCreate,
    wardrobe: window.PanelWardrobe,
    armor: window.PanelArmor,
    animals: window.PanelAnimals
  };

  /**
   * Open the Character Forge overlay.
   * @param {string} [initialTab] - Optional tab to open directly ('create','wardrobe','armor','animals').
   *                                 If omitted, opens to the default 'create' tab.
   */
  function open(initialTab) {
    if (_isOpen) return;
    _isOpen = true;

    var startTab = (initialTab && PANELS[initialTab]) ? initialTab : 'create';
    log('Opening Character Forge, tab:', startTab);

    window.CharacterForgeState.reset();
    window.CharacterForgeState.setTab(startTab);
    _buildOverlay();
    _renderActivePanel();
    _bindGlobalEvents();
  }

  function close() {
    if (!_isOpen) return;
    log('Closing Character Forge');
    _cleanup();
  }

  function _buildOverlay() {
    _overlay = document.createElement('div');
    _overlay.id = 'character-forge-overlay';

    var state = window.CharacterForgeState.get();
    var html = '';

    // Resolve section title from TABS
    var activeTabInfo = null;
    for (var ti = 0; ti < TABS.length; ti++) {
      if (TABS[ti].id === state.selectedTab) { activeTabInfo = TABS[ti]; break; }
    }

    // === TOP BAR ===
    html += '<div class="cf-topbar">';
    html += '  <button class="cf-btn cf-btn-back" id="cf-back">✕</button>';
    html += '  <span class="cf-section-title">' + (activeTabInfo ? activeTabInfo.icon + ' ' + activeTabInfo.label : '') + '</span>';
    html += '  <input class="cf-name-input" id="cf-name" type="text" maxlength="20" value="' + _escHtml(state.meta.name) + '" />';
    html += '  <div class="cf-slots">';
    for (var i = 0; i < 3; i++) {
      var act = (state.meta.slotIndex === i) ? ' cf-slot-active' : '';
      html += '<div class="cf-slot' + act + '" data-slot="' + i + '">' + (i + 1) + '</div>';
    }
    html += '  </div>';
    html += '  <button class="cf-btn cf-btn-confirm" id="cf-confirm">✓</button>';
    html += '</div>';

    // === MAIN BODY (stage + panel, no tab sidebar) ===
    html += '<div class="cf-body">';

    // Content: stage + panel (full width, no left tab bar)
    html += '<div class="cf-content">';
    html += '  <div class="cf-stage-wrap" id="cf-stage-wrap"></div>';
    html += '  <div class="cf-panel" id="cf-panel"></div>';
    html += '</div>';

    html += '</div>'; // end cf-body

    _overlay.innerHTML = html;
    document.body.appendChild(_overlay);

    // Build stage
    var stageWrap = _overlay.querySelector('#cf-stage-wrap');
    window.CharacterForgeRenderer.buildStage(stageWrap);

    _panelContainer = _overlay.querySelector('#cf-panel');

    // Bind UI events
    _bindUIEvents();
  }

  function _bindUIEvents() {
    // Back button
    var backBtn = _overlay.querySelector('#cf-back');
    if (backBtn) backBtn.addEventListener('click', close);

    // Confirm button
    var confirmBtn = _overlay.querySelector('#cf-confirm');
    if (confirmBtn) confirmBtn.addEventListener('click', function () {
      log('Confirmed character:', window.CharacterForgeState.get());
      close();
    });

    // Name input
    var nameInput = _overlay.querySelector('#cf-name');
    if (nameInput) nameInput.addEventListener('input', function () {
      window.CharacterForgeState.updateMeta('name', this.value);
    });

    // Slot selectors
    var slots = _overlay.querySelectorAll('.cf-slot');
    for (var i = 0; i < slots.length; i++) {
      slots[i].addEventListener('click', function () {
        var idx = parseInt(this.getAttribute('data-slot'), 10);
        window.CharacterForgeState.updateMeta('slotIndex', idx);
        // Update active state visually
        var all = _overlay.querySelectorAll('.cf-slot');
        for (var j = 0; j < all.length; j++) all[j].classList.remove('cf-slot-active');
        this.classList.add('cf-slot-active');
      });
    }

    // Tab sidebar removed — each section is now opened individually
    // from the Safe House category cards. No tab switching inside the forge.
  }

  function _renderActivePanel() {
    if (!_panelContainer) return;
    var state = window.CharacterForgeState.get();
    var panel = PANELS[state.selectedTab];
    if (panel && panel.render) {
      panel.render(_panelContainer);
    } else {
      _panelContainer.innerHTML = '<div class="cf-panel-empty">Coming soon…</div>';
    }
  }

  function _bindGlobalEvents() {
    _onResize = function () {
      // Overlay is fixed, but re-check if needed
    };
    window.addEventListener('resize', _onResize);

    _stateListener = function () {
      // Could re-render panels on state changes if needed
    };
    window.CharacterForgeState.onChange(_stateListener);
  }

  function _cleanup() {
    _isOpen = false;

    // Remove event listeners
    if (_onResize) {
      window.removeEventListener('resize', _onResize);
      _onResize = null;
    }
    if (_stateListener) {
      window.CharacterForgeState.removeListener(_stateListener);
      _stateListener = null;
    }

    // Destroy sub-systems
    window.CharacterForgeRenderer.destroy();
    Object.keys(PANELS).forEach(function (k) {
      if (PANELS[k] && PANELS[k].destroy) PANELS[k].destroy();
    });
    window.CharacterForgeState.clearListeners();

    // Remove overlay DOM
    if (_overlay && _overlay.parentNode) {
      _overlay.parentNode.removeChild(_overlay);
    }
    _overlay = null;
    _panelContainer = null;

    log('Character Forge closed & cleaned up');
  }

  function _escHtml(str) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  }

  window.CharacterForgeUI = {
    open: open,
    close: close,
    setDev: function (flag) {
      DEV = !!flag;
      window.CharacterForgeState.setDev(flag);
      window.CharacterForgeRenderer.setDev(flag);
    }
  };

  // Expose global shortcut (supports optional tab argument)
  window.openCharacterForge = open;
})();
