/**
 * CharacterForgeState.js
 * Single state object + helpers for the Character Forge UI.
 * Isolated from global GameState — syncs only on confirm.
 */
(function () {
  'use strict';

  var DEV = false;

  function log() {
    if (DEV) console.log.apply(console, ['[CharacterForge:State]'].concat(Array.prototype.slice.call(arguments)));
  }

  var defaultState = {
    selectedTab: 'create',
    appearance: {
      gender: 'male',
      bodyType: 'average',
      facePreset: 'neutral',
      hairStyle: 'short'
    },
    wardrobe: {
      jacket: null,
      shirt: null,
      pants: null,
      shoes: null,
      accessory: null
    },
    armor: {
      head: null,
      chest: null,
      hands: null
    },
    animals: {
      companion: null
    },
    meta: {
      name: 'New Character',
      slotIndex: 0
    }
  };

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  var _state = deepClone(defaultState);
  var _listeners = [];

  window.CharacterForgeState = {
    get: function () {
      return _state;
    },

    reset: function () {
      _state = deepClone(defaultState);
      log('State reset');
      this._notify();
    },

    setTab: function (tab) {
      if (_state.selectedTab !== tab) {
        _state.selectedTab = tab;
        log('Tab changed:', tab);
        this._notify();
      }
    },

    updateAppearance: function (key, value) {
      if (_state.appearance[key] !== value) {
        _state.appearance[key] = value;
        log('Appearance updated:', key, '=', value);
        this._notify();
      }
    },

    updateWardrobe: function (slot, value) {
      if (_state.wardrobe[slot] !== value) {
        _state.wardrobe[slot] = value;
        log('Wardrobe updated:', slot, '=', value);
        this._notify();
      }
    },

    updateArmor: function (slot, value) {
      if (_state.armor[slot] !== value) {
        _state.armor[slot] = value;
        log('Armor updated:', slot, '=', value);
        this._notify();
      }
    },

    updateAnimal: function (companion) {
      if (_state.animals.companion !== companion) {
        _state.animals.companion = companion;
        log('Animal updated:', companion);
        this._notify();
      }
    },

    updateMeta: function (key, value) {
      if (_state.meta[key] !== value) {
        _state.meta[key] = value;
        log('Meta updated:', key, '=', value);
        this._notify();
      }
    },

    onChange: function (fn) {
      _listeners.push(fn);
    },

    removeListener: function (fn) {
      _listeners = _listeners.filter(function (l) { return l !== fn; });
    },

    clearListeners: function () {
      _listeners = [];
    },

    _notify: function () {
      var s = _state;
      for (var i = 0; i < _listeners.length; i++) {
        try { _listeners[i](s); } catch (e) { /* swallow */ }
      }
    },

    setDev: function (flag) { DEV = !!flag; }
  };
})();
