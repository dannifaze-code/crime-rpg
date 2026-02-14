/**
 * PanelAnimals.js
 * Animal companion panel: swipeable cards with equip button.
 */
(function () {
  'use strict';

  var ANIMALS = [
    { id: 'dog', name: 'Guard Dog', icon: '🐕', bonus: '+10% Alert', desc: 'Barks at intruders.' },
    { id: 'cat', name: 'Street Cat', icon: '🐈', bonus: '+5% Stealth', desc: 'Silent and sneaky.' },
    { id: 'hawk', name: 'Hawk', icon: '🦅', bonus: '+15% Scout', desc: 'Eyes in the sky.' },
    { id: 'snake', name: 'Snake', icon: '🐍', bonus: '+10% Intimidation', desc: 'Strikes fear.' },
    { id: 'rat', name: 'Rat', icon: '🐀', bonus: '+5% Scavenge', desc: 'Finds hidden loot.' }
  ];

  var _container = null;
  var _scrollEl = null;

  function render(container) {
    _container = container;
    _renderContent();
  }

  function _renderContent() {
    if (!_container) return;
    var state = window.CharacterForgeState.get();
    var equipped = state.animals.companion;

    var html = '<div class="cf-animals-scroll">';
    for (var i = 0; i < ANIMALS.length; i++) {
      var a = ANIMALS[i];
      var sel = (equipped === a.id) ? ' cf-animal-equipped' : '';
      html += '<div class="cf-animal-card' + sel + '" data-id="' + a.id + '">';
      html += '<div class="cf-animal-icon">' + a.icon + '</div>';
      html += '<div class="cf-animal-name">' + a.name + '</div>';
      html += '<div class="cf-animal-bonus">' + a.bonus + '</div>';
      html += '<div class="cf-animal-desc">' + a.desc + '</div>';
      html += '<button class="cf-animal-equip">' + (equipped === a.id ? 'Unequip' : 'Equip') + '</button>';
      html += '</div>';
    }
    html += '</div>';

    _container.innerHTML = html;
    _scrollEl = _container.querySelector('.cf-animals-scroll');
    _bindEvents();
  }

  function _bindEvents() {
    if (!_container) return;
    var btns = _container.querySelectorAll('.cf-animal-equip');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var card = this.closest('.cf-animal-card');
        if (!card) return;
        var id = card.getAttribute('data-id');
        var current = window.CharacterForgeState.get().animals.companion;
        window.CharacterForgeState.updateAnimal(current === id ? null : id);
        _renderContent();
      });
    }
  }

  function destroy() {
    _container = null;
    _scrollEl = null;
  }

  window.PanelAnimals = {
    render: render,
    destroy: destroy
  };
})();
