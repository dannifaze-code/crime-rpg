/**
 * CharacterForgeRenderer.js
 * Sprite stage rendering + 8-direction rotation logic.
 */
(function () {
  'use strict';

  var DEV = false;
  function log() {
    if (DEV) console.log.apply(console, ['[CharacterForge:Renderer]'].concat(Array.prototype.slice.call(arguments)));
  }

  var DIRECTIONS = [
    'front', 'front_right', 'right', 'back_right',
    'back', 'back_left', 'left', 'front_left'
  ];

  var SPRITE_BASE = './sprites/characters/player/';
  var FALLBACK_COLOR = '#555';

  var _dirIndex = 0;
  var _stageEl = null;
  var _spriteEl = null;
  var _hintEl = null;
  var _dragStartX = 0;
  var _dragging = false;
  var _interacted = false;
  var DRAG_THRESHOLD = 30;

  // Bound handler refs for cleanup
  var _onTouchStart, _onTouchMove, _onTouchEnd;
  var _onMouseDown, _onMouseMove, _onMouseUp;

  function buildStage(container) {
    _stageEl = document.createElement('div');
    _stageEl.className = 'cf-stage';

    _spriteEl = document.createElement('div');
    _spriteEl.className = 'cf-sprite';
    _stageEl.appendChild(_spriteEl);

    // Hint overlay
    _hintEl = document.createElement('div');
    _hintEl.className = 'cf-stage-hint';
    _hintEl.textContent = '↔ Drag to rotate';
    _stageEl.appendChild(_hintEl);

    container.appendChild(_stageEl);

    _dirIndex = 0;
    _interacted = false;
    _loadSprite();
    _bindDrag();
    log('Stage built');
  }

  function _loadSprite() {
    var dir = DIRECTIONS[_dirIndex];
    var url = SPRITE_BASE + dir + '.png';
    var img = new Image();
    img.onload = function () {
      if (_spriteEl) {
        _spriteEl.style.backgroundImage = 'url(' + url + ')';
        _spriteEl.style.backgroundColor = 'transparent';
      }
    };
    img.onerror = function () {
      // Try generic fallback
      var fallback = new Image();
      fallback.onload = function () {
        if (_spriteEl) {
          _spriteEl.style.backgroundImage = 'url(' + SPRITE_BASE + 'front.png)';
          _spriteEl.style.backgroundColor = 'transparent';
        }
      };
      fallback.onerror = function () {
        // Pure CSS fallback placeholder
        if (_spriteEl) {
          _spriteEl.style.backgroundImage = 'none';
          _spriteEl.style.backgroundColor = FALLBACK_COLOR;
        }
      };
      fallback.src = SPRITE_BASE + 'front.png';
    };
    img.src = url;
  }

  function _rotate(delta) {
    _dirIndex = (_dirIndex + delta + DIRECTIONS.length) % DIRECTIONS.length;
    _loadSprite();
    log('Rotated to', DIRECTIONS[_dirIndex]);
  }

  function _hideHint() {
    if (!_interacted && _hintEl) {
      _interacted = true;
      _hintEl.style.opacity = '0';
      setTimeout(function () {
        if (_hintEl) _hintEl.style.display = 'none';
      }, 300);
    }
  }

  // --- Drag handling ---
  function _handleStart(x) {
    _dragging = true;
    _dragStartX = x;
  }

  function _handleMove(x) {
    if (!_dragging) return;
    var diff = x - _dragStartX;
    if (Math.abs(diff) >= DRAG_THRESHOLD) {
      _rotate(diff > 0 ? 1 : -1);
      _dragStartX = x;
      _hideHint();
    }
  }

  function _handleEnd() {
    _dragging = false;
  }

  function _bindDrag() {
    if (!_stageEl) return;

    _onTouchStart = function (e) { e.preventDefault(); _handleStart(e.touches[0].clientX); };
    _onTouchMove = function (e) { e.preventDefault(); _handleMove(e.touches[0].clientX); };
    _onTouchEnd = function () { _handleEnd(); };
    _onMouseDown = function (e) { _handleStart(e.clientX); };
    _onMouseMove = function (e) { _handleMove(e.clientX); };
    _onMouseUp = function () { _handleEnd(); };

    _stageEl.addEventListener('touchstart', _onTouchStart, { passive: false });
    _stageEl.addEventListener('touchmove', _onTouchMove, { passive: false });
    _stageEl.addEventListener('touchend', _onTouchEnd);
    _stageEl.addEventListener('mousedown', _onMouseDown);
    document.addEventListener('mousemove', _onMouseMove);
    document.addEventListener('mouseup', _onMouseUp);
  }

  function _unbindDrag() {
    if (_stageEl) {
      _stageEl.removeEventListener('touchstart', _onTouchStart);
      _stageEl.removeEventListener('touchmove', _onTouchMove);
      _stageEl.removeEventListener('touchend', _onTouchEnd);
      _stageEl.removeEventListener('mousedown', _onMouseDown);
    }
    document.removeEventListener('mousemove', _onMouseMove);
    document.removeEventListener('mouseup', _onMouseUp);
  }

  function destroy() {
    _unbindDrag();
    _stageEl = null;
    _spriteEl = null;
    _hintEl = null;
    _dragging = false;
    log('Renderer destroyed');
  }

  window.CharacterForgeRenderer = {
    buildStage: buildStage,
    destroy: destroy,
    setDev: function (flag) { DEV = !!flag; }
  };
})();
