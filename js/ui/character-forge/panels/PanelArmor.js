/**
 * PanelArmor.js
 * Armor panel: 3 equipment slots with placeholder stat bars.
 */
(function () {
  'use strict';

  var SLOTS = [
    { key: 'head', label: 'Head', icon: '⛑️', items: [
      { id: 'cap', name: 'Cap', def: 1, wt: 1 },
      { id: 'helmet', name: 'Helmet', def: 3, wt: 3 },
      { id: 'mask', name: 'Mask', def: 2, wt: 1 }
    ]},
    { key: 'chest', label: 'Chest', icon: '🦺', items: [
      { id: 'vest', name: 'Vest', def: 3, wt: 2 },
      { id: 'plate', name: 'Plate', def: 5, wt: 5 },
      { id: 'leather', name: 'Leather', def: 2, wt: 1 }
    ]},
    { key: 'hands', label: 'Hands', icon: '🧤', items: [
      { id: 'gloves', name: 'Gloves', def: 1, wt: 1 },
      { id: 'gauntlets', name: 'Gauntlets', def: 3, wt: 3 }
    ]}
  ];

  var _container = null;

  function render(container) {
    _container = container;
    _renderContent();
  }

  function _renderContent() {
    if (!_container) return;
    var state = window.CharacterForgeState.get();
    var html = '<div class="cf-armor-grid">';

    for (var s = 0; s < SLOTS.length; s++) {
      var slot = SLOTS[s];
      var equipped = state.armor[slot.key];
      html += '<div class="cf-armor-slot">';
      html += '<div class="cf-armor-slot-header">' + slot.icon + ' ' + slot.label;
      if (equipped) html += ' <span class="cf-armor-equipped">(' + equipped + ')</span>';
      html += '</div>';
      html += '<div class="cf-armor-items">';
      for (var i = 0; i < slot.items.length; i++) {
        var item = slot.items[i];
        var sel = (equipped === item.id) ? ' cf-armor-item-selected' : '';
        html += '<button class="cf-armor-item' + sel + '" data-slot="' + slot.key + '" data-id="' + item.id + '">';
        html += '<span class="cf-armor-name">' + item.name + '</span>';
        html += '<div class="cf-stat-bar"><span class="cf-stat-label">DEF</span><div class="cf-stat-fill" style="width:' + (item.def * 20) + '%"></div></div>';
        html += '<div class="cf-stat-bar"><span class="cf-stat-label">WT</span><div class="cf-stat-fill cf-stat-wt" style="width:' + (item.wt * 20) + '%"></div></div>';
        html += '</button>';
      }
      html += '</div></div>';
    }

    html += '</div>';
    _container.innerHTML = html;
    _bindEvents();
  }

  function _bindEvents() {
    if (!_container) return;
    var btns = _container.querySelectorAll('.cf-armor-item');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var slot = this.getAttribute('data-slot');
        var id = this.getAttribute('data-id');
        var current = window.CharacterForgeState.get().armor[slot];
        window.CharacterForgeState.updateArmor(slot, current === id ? null : id);
        _renderContent();
      });
    }
  }

  function destroy() {
    _container = null;
  }

  window.PanelArmor = {
    render: render,
    destroy: destroy
  };
})();
