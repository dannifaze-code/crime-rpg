/**
 * PanelCreate.js
 * Character creation panel: Gender, Body, Face, Skin, Hair with horizontal paging.
 */
(function () {
  'use strict';

  var PAGES = [
    {
      title: 'Gender & Body',
      rows: [
        { label: 'Gender', key: 'gender', stateKey: 'appearance', options: ['male', 'female'] },
        { label: 'Body Type', key: 'bodyType', stateKey: 'appearance', options: ['average', 'slim', 'athletic', 'heavy'] }
      ]
    },
    {
      title: 'Face & Skin',
      rows: [
        { label: 'Face', key: 'facePreset', stateKey: 'appearance', options: ['neutral', 'sharp', 'round', 'weathered'] },
        { label: 'Skin Tone', key: 'skinTone', stateKey: 'appearance', options: ['light', 'medium', 'tan', 'dark'] }
      ]
    },
    {
      title: 'Hair',
      rows: [
        { label: 'Hair Style', key: 'hairStyle', stateKey: 'appearance', options: ['short', 'long', 'bald', 'mohawk', 'ponytail', 'buzz'] }
      ]
    }
  ];

  var _currentPage = 0;
  var _container = null;

  function render(container) {
    _container = container;
    _currentPage = 0;
    _renderPage();
  }

  function _renderPage() {
    if (!_container) return;
    var page = PAGES[_currentPage];
    var state = window.CharacterForgeState.get();
    var html = '';

    // Page header with arrows
    html += '<div class="cf-panel-header">';
    html += '<button class="cf-page-arrow cf-page-prev" ' + (_currentPage === 0 ? 'disabled' : '') + '>◀</button>';
    html += '<span class="cf-page-title">' + page.title + ' (' + (_currentPage + 1) + '/' + PAGES.length + ')</span>';
    html += '<button class="cf-page-arrow cf-page-next" ' + (_currentPage === PAGES.length - 1 ? 'disabled' : '') + '>▶</button>';
    html += '</div>';

    // Rows
    for (var r = 0; r < page.rows.length; r++) {
      var row = page.rows[r];
      html += '<div class="cf-panel-row">';
      html += '<div class="cf-row-label">' + row.label + '</div>';
      html += '<div class="cf-row-options">';
      var currentVal = state.appearance[row.key] || '';
      for (var o = 0; o < row.options.length; o++) {
        var opt = row.options[o];
        var sel = (currentVal === opt) ? ' cf-opt-selected' : '';
        html += '<button class="cf-opt-btn' + sel + '" data-skey="' + row.stateKey + '" data-key="' + row.key + '" data-val="' + opt + '">' + opt + '</button>';
      }
      html += '</div></div>';
    }

    _container.innerHTML = html;
    _bindEvents();
  }

  function _bindEvents() {
    if (!_container) return;
    var prev = _container.querySelector('.cf-page-prev');
    var next = _container.querySelector('.cf-page-next');
    if (prev) prev.addEventListener('click', function () {
      if (_currentPage > 0) { _currentPage--; _renderPage(); }
    });
    if (next) next.addEventListener('click', function () {
      if (_currentPage < PAGES.length - 1) { _currentPage++; _renderPage(); }
    });

    var btns = _container.querySelectorAll('.cf-opt-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var key = this.getAttribute('data-key');
        var val = this.getAttribute('data-val');
        window.CharacterForgeState.updateAppearance(key, val);
        _renderPage();
      });
    }
  }

  function destroy() {
    _container = null;
    _currentPage = 0;
  }

  window.PanelCreate = {
    render: render,
    destroy: destroy
  };
})();
