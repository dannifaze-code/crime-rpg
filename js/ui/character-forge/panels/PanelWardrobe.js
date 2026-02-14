/**
 * PanelWardrobe.js
 * Wardrobe panel: 2-row grid with horizontal scroll for clothing items.
 */
(function () {
  'use strict';

  var SLOTS = [
    { key: 'jacket', label: 'Jacket', icon: '🧥', items: ['leather', 'hoodie', 'suit', 'bomber', 'trench'] },
    { key: 'shirt', label: 'Shirt', icon: '👕', items: ['tee', 'tank', 'button', 'polo', 'henley'] },
    { key: 'pants', label: 'Pants', icon: '👖', items: ['jeans', 'cargo', 'sweats', 'slacks', 'shorts'] },
    { key: 'shoes', label: 'Shoes', icon: '👟', items: ['sneakers', 'boots', 'loafers', 'sandals'] },
    { key: 'accessory', label: 'Accessory', icon: '🕶️', items: ['shades', 'chain', 'watch', 'bandana', 'earring'] }
  ];

  var _container = null;

  function render(container) {
    _container = container;
    _renderContent();
  }

  function _renderContent() {
    if (!_container) return;
    var state = window.CharacterForgeState.get();
    var html = '<div class="cf-wardrobe-grid">';

    for (var s = 0; s < SLOTS.length; s++) {
      var slot = SLOTS[s];
      var equipped = state.wardrobe[slot.key];
      html += '<div class="cf-wardrobe-slot">';
      html += '<div class="cf-wardrobe-slot-label">' + slot.icon + ' ' + slot.label + '</div>';
      html += '<div class="cf-wardrobe-items">';
      for (var i = 0; i < slot.items.length; i++) {
        var item = slot.items[i];
        var sel = (equipped === item) ? ' cf-item-selected' : '';
        html += '<button class="cf-item-btn' + sel + '" data-slot="' + slot.key + '" data-item="' + item + '">' + item + '</button>';
      }
      html += '</div></div>';
    }

    html += '</div>';
    _container.innerHTML = html;
    _bindEvents();
  }

  function _bindEvents() {
    if (!_container) return;
    var btns = _container.querySelectorAll('.cf-item-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var slot = this.getAttribute('data-slot');
        var item = this.getAttribute('data-item');
        var current = window.CharacterForgeState.get().wardrobe[slot];
        window.CharacterForgeState.updateWardrobe(slot, current === item ? null : item);
        _renderContent();
      });
    }
  }

  function destroy() {
    _container = null;
  }

  window.PanelWardrobe = {
    render: render,
    destroy: destroy
  };
})();
