/**
 * 3D Cop Car Module
 * Three.js-based 3D cop car overlay for the turf map.
 *
 * Primary objective: make the 3D cop car reliably appear on the Turf map.
 *
 * Design:
 * - We keep the existing CopCarSystem logic (roads + intersection stops).
 * - The 2D #cop-car remains as a POSITION MARKER only (emoji hidden via CSS/JS).
 * - The 3D car reads CopCarSystem.position/heading directly (authoritative map percent space, no DOM fallback).
 * - We recenter the GLB pivot to eliminate "sliding"/orbiting during rotation.
 * - Wheel roll + subtle steering + faint exhaust for realism.
 *
 * Requirements satisfied:
 * - 3D cop car shows up (robust init when #city-map becomes visible).
 * - Follows the roads + stops at intersections (inherits CopCarSystem).
 * - No "sliding" (pivot recenter + stop snapping + no CSS transition on marker).
 */

const LANE_PX = 28;

const CopCar3D = {
  // three.js objects
  scene: null,
  camera: null,
  renderer: null,
  canvas: null,

  // DOM
  // IMPORTANT: we do NOT mount the canvas inside #map-world.
  // #map-world is transform-scaled for pan/zoom; if we nest the WebGL canvas inside it,
  // the renderer can end up being double-affected by CSS transforms (size drift, 360 spins
  // during zoom gestures on some mobile browsers).
  //
  // Instead, we mount a dedicated overlay layer inside #map-viewport and *mirror* the
  // current #map-world transform onto that layer. This keeps the 3D overlay visually
  // locked to the map while remaining isolated from layout/measurement weirdness.
  container: null,      // #map-viewport (preferred) or #city-map (fallback)
  layer: null,          // #cop-car-3d-layer (inside container)
  mapWorldEl: null,     // #map-world (transform source)
  copCarElement: null,  // #cop-car (2D marker)

  // Model
  model: null,          // pivot group we move/rotate
  modelVisual: null,    // gltf.scene (offset inside pivot)
  modelLoaded: false,
  copRoot: null,
  _pendingModelRoot: null,
  modelPath: 'sprites/3d-models/cop-car.glb',

  // Drug Lab building (static 3D building on Turf Grid #35)
  drugLabEnabled: true,
  drugLabModelPath: 'sprites/3d-models/base_basic_pbr_glow_window_orange.glb',
  drugLabRoot: null,
  _drugLabLoaded: false,
  // Grid #35 bounds (percent) derived from trufgridoverlay.png
  drugLabCellBoundsPct: { left: 25.390625, right: 37.402344, top: 37.532552, bottom: 45.735677 },

  // loop
  animationFrameId: null,
  isInitialized: false,

  // Session tracking: ensure init() runs once per turf tab session
  _turfSessionId: null,

  // init/resize guards
  _initPromise: null,
  _pendingInitObserver: null,
  _pendingInitRAF: null,
  _resizeObserver: null,

  // Throttle pending model attach warnings to prevent spam
  _lastPendingAttachWarn: 0,
  _pendingAttachWarnCooldown: 2000, // ms

  // pose state
  _lastWorldPos: null,
  _currentYaw: 0,
  _targetYaw: 0,
  _currentRoll: 0,
  _hasValidPose: false,

  // dt
  _lastTickTime: 0,

  // aspect ratio for coordinate mapping
  _mapAspect: 1,

  // ray
  _raycaster: null,
  _groundPlane: null,
  _cameraLookAt: null,
  _lastDebugLog: 0,
  _debugAxes: null,
  _debugCube: null,
  _debugLaneRect: null,
  _laneWidthPercent: null,
  _laneWidthPx: null,
  _carScaledLength: null,
  _laneWidthRetryAt: 0,
  _mapBackgroundEl: null,

  // wheels
  _wheels: [],
  _frontWheels: [],
  _wheelRadius: 0.45,
  _steerCurrent: 0,

  // exhaust smoke
  _smokeGroup: null,
  _smokeBaseMaterial: null,
  _smokeParticles: [],
  _smokeEmitAcc: 0,
  _exhaustAnchor: null,

  // police lights
  policeLightsActive: false,
  policeLightTime: 0,
  lights: { ambient: null, hemi: null, directional: null, police: [] },

  // Scaling fix: track if initial scale has been applied
  _initialScaleApplied: false,
  _scaleRetryCount: 0,
  _maxScaleRetries: 10,

  // Visibility toggle (for instant tab-switch without full dispose/reinit)
  _hidden: false,

  config: {
    camera: {
      fov: 45,
      near: 0.1,
      far: 1500,
      position: { x: 0, y: 55, z: 35 },
      lookAt: { x: 0, y: 0, z: 0 }
    },
    debug: {
      enabled: false,
      logIntervalMs: 1000,
      ambientIntensity: 1.0,
      directionalIntensity: 1.0,
      directionalPosition: { x: 50, y: 100, z: 50 },
      rideHeight: 0
    },

    lanePx: LANE_PX,
    laneWidthFactor: 0.35,
    laneDebugLengthFactor: 1.6,
    // Percent-based sample pairs on the turf map used to estimate lane width in CSS px.
    laneSamplePairs: [
      { a: { x: 28, y: 33.5 }, b: { x: 28, y: 36.5 } },
      { a: { x: 55.5, y: 40 }, b: { x: 58.5, y: 40 } },
      { a: { x: 72, y: 63.5 }, b: { x: 72, y: 66.5 } }
    ],
    carWidthPercentUnits: 0.9,
    carLengthPercentUnits: 1.5,
    carWidthSlimFactor: 1.0,
    carLengthStretchFactor: 1.0,

    // dt-based smoothing strengths (higher = tighter)
    positionLerpStrength: 18,
    yawLerpStrength: 10,
    rollLerpStrength: 8,

    // GLB model's forward is along the X-axis.
    // -PI/2 rotates so the front faces the direction of travel.
    modelYawOffset: -Math.PI / 2,

    // When CopCarSystem.speed is basically 0, snap position to prevent micro-glide
    stopSnapSpeed: 0.03,

    shadowsEnabled: true,
    maxPixelRatio: 4,

    wheels: {
      enabled: true,
      spinAxis: 'x',
      spinMultiplier: 1.0,
      maxSteerAngle: 0.35,
      steerResponsiveness: 10
    },

    bodyRoll: {
      enabled: true,
      maxRoll: 0.12,
      rollFromYawRate: 0.018
    },

    exhaust: {
      enabled: true,
      localOffset: { x: 0.0, y: 0.65, z: -1.95 },
      minSpeedToEmit: 0.12,
      rate: 10,
      maxParticles: 60,
      baseOpacity: 0.12,
      baseScale: 0.6,
      lifeMin: 0.55,
      lifeMax: 1.05
    }
  },

  /**
   * Safe to call repeatedly (e.g. on each Turf tab entry).
   * Uses session tracking to ensure only one init per tab session.
   */
  init() {
    // Session guard: prevent duplicate init() calls for the same tab session
    const currentSessionId = this._getCurrentTurfSessionId();
    if (this._turfSessionId === currentSessionId && this.isInitialized) {
      // Already initialized for this session
      return Promise.resolve(true);
    }

    // Update session ID
    this._turfSessionId = currentSessionId;

    // Fast path: already initialized (from previous session)
    if (this.isInitialized && this.renderer && this.container) {
      try {
        this.container = document.getElementById('map-viewport') || document.getElementById('city-map');
        this.mapWorldEl = document.getElementById('map-world');
        this._ensureLayer();

        this.copCarElement = document.getElementById('cop-car');
        this._prepareMarkerElement();

        if (this.canvas && this.layer && !this.layer.contains(this.canvas)) {
          this.layer.appendChild(this.canvas);
        }

        const dims = this._getWorldBaseSize();
        const w = dims.w;
        const h = dims.h;
        if (w > 0 && h > 0) {
          this._handleResize(w, h);
        } else {
          this._waitForDimensions();
        }

        if (!this.animationFrameId) this._startLoop();
      } catch (e) {
        console.warn('[CopCar3D] Re-init fastpath failed:', e);
      }
      return Promise.resolve(true);
    }

    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      console.log('[CopCar3D] Initializing...');

      if (typeof THREE === 'undefined') {
        console.error('[CopCar3D] THREE.js not loaded');
        this._initPromise = null;
        return false;
      }
      if (!THREE.GLTFLoader) {
        console.error('[CopCar3D] GLTFLoader not loaded');
        this._initPromise = null;
        return false;
      }

      this.container = document.getElementById('map-viewport') || document.getElementById('city-map');
      this.mapWorldEl = document.getElementById('map-world');
      if (!this.container) {
        console.error('[CopCar3D] #map-viewport/#city-map not found');
        this._initPromise = null;
        return false;
      }

      this._ensureLayer();

      this.copCarElement = document.getElementById('cop-car');
      if (!this.copCarElement) {
        console.warn('[CopCar3D] #cop-car not found (marker missing)');
      } else {
        this._prepareMarkerElement();
      }

      const dims = this._getWorldBaseSize();
      const w = dims.w;
      const h = dims.h;
      if (!w || !h) {
        console.warn('[CopCar3D] Map container has zero size - waiting for layout...');
        this._waitForDimensions();
        this._initPromise = null;
        return false;
      }

      await this._initScene(w, h);
      this._initPromise = null;
      return true;
    })();

    return this._initPromise;
  },

  /**
   * Generate a session ID based on tab visibility timestamp.
   * Each time the turf tab is shown, this returns a new session ID.
   */
  _getCurrentTurfSessionId() {
    if (!window.__turfTabSessionId) {
      window.__turfTabSessionId = Date.now();
    }
    return window.__turfTabSessionId;
  },

  /**
   * Make #cop-car a stable, invisible marker (no emoji, fixed hitbox).
   * This prevents the old emoji fade/transition artifacts and gives a stable bounding box.
   */
  _prepareMarkerElement() {
    if (!this.copCarElement) return;

    // Remove emoji text (CSS also hides it, but this is an extra guarantee)
    try {
      if (!this.copCarElement.dataset.cop3dMarkerPrepared) {
        this.copCarElement.dataset.cop3dMarkerPrepared = '1';
        this.copCarElement.textContent = '';
      }
    } catch (e) {}

    // Ensure stable box even with no text
    const s = this.copCarElement.style;
    s.width = s.width || '32px';
    s.height = s.height || '32px';
    s.lineHeight = '0';
    s.fontSize = '0';
    s.transition = 'none';
    s.opacity = '0';
    s.pointerEvents = 'none';
    s.filter = 'none';
  },

  _isDebugEnabled() {
    return !!(this.config?.debug?.enabled || (typeof window !== 'undefined' && window.COP3D_DEBUG));
  },

  _getWorldBaseSize() {
    // NOTE: offsetWidth/offsetHeight ignore CSS transforms, which is what we want.
    const world = this.mapWorldEl || document.getElementById('map-world');
    if (world) {
      return { w: world.offsetWidth || 0, h: world.offsetHeight || 0 };
    }
    if (this.container) {
      return { w: this.container.offsetWidth || 0, h: this.container.offsetHeight || 0 };
    }
    return { w: 0, h: 0 };
  },

  _calculateLaneWidthPercent() {
    const lanePx = this.config?.lanePx ?? LANE_PX;
    const world = this.mapWorldEl || document.getElementById('map-world');
    if (!world) return null;
    const rect = world.getBoundingClientRect();
    const worldWidth = rect?.width || world.offsetWidth || 0;
    if (!worldWidth) return null;
    let measuredLaneWidthPx = null;
    const samples = this.config?.laneSamplePairs;
    if (Array.isArray(samples) && samples.length) {
      this._mapBackgroundEl = this._mapBackgroundEl || document.getElementById('map-background');
      const container = (this._mapBackgroundEl && this._mapBackgroundEl.getBoundingClientRect)
        ? this._mapBackgroundEl
        : world;
      const containerRect = container.getBoundingClientRect();
      if (containerRect?.width && containerRect?.height) {
        let total = 0;
        let count = 0;
        samples.forEach((pair) => {
          if (!pair || !pair.a || !pair.b) return;
          const ax = containerRect.left + (pair.a.x / 100) * containerRect.width;
          const ay = containerRect.top + (pair.a.y / 100) * containerRect.height;
          const bx = containerRect.left + (pair.b.x / 100) * containerRect.width;
          const by = containerRect.top + (pair.b.y / 100) * containerRect.height;
          const dx = ax - bx;
          const dy = ay - by;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (isFinite(dist) && dist > 0) {
            total += dist;
            count += 1;
          }
        });
        if (count > 0) measuredLaneWidthPx = total / count;
      }
    }
    const lanePxMeasured = (isFinite(measuredLaneWidthPx) && measuredLaneWidthPx > 0)
      ? measuredLaneWidthPx
      : lanePx;
    this._laneWidthPx = lanePxMeasured;
    return (lanePxMeasured / worldWidth) * 100;
  },

  _ensureLayer() {
    if (!this.container) return;
    this.mapWorldEl = this.mapWorldEl || document.getElementById('map-world');

    let layer = this.layer;
    if (!layer || !layer.isConnected) {
      layer = document.getElementById('cop-car-3d-layer');
    }

    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'cop-car-3d-layer';
      layer.style.position = 'absolute';
      layer.style.left = '0';
      layer.style.top = '0';
      layer.style.pointerEvents = 'none';
      layer.style.zIndex = '1';
      layer.style.transformOrigin = '0 0';
      // Place inside #map-world so it shares the same stacking context as
      // #map-entities (z-index 2). This ensures all buildings, landmarks,
      // and the player character render ON TOP of the cop car.
      const mapWorld = this.mapWorldEl || document.getElementById('map-world');
      if (mapWorld) {
        mapWorld.appendChild(layer);
      } else {
        this.container.appendChild(layer);
      }
    }

    this.layer = layer;

    // Ensure parent is positioned so our absolute layer sizes correctly
    const layerParent = this.layer.parentElement || this.container;
    try {
      const pos = getComputedStyle(layerParent).position;
      if (!pos || pos === 'static') layerParent.style.position = 'relative';
    } catch (e) {}

    this._syncLayerTransform();
  },

  _attachPendingModel() {
    const pending = this._pendingModelRoot;
    if (!pending) return;
    const attachResult = this._addModelToScene(pending, false);
    if (attachResult.success) {
      this._pendingModelRoot = null;
    } else {
      // Throttle warning to prevent spam (max once per cooldown period)
      const now = performance.now();
      if (now - this._lastPendingAttachWarn >= this._pendingAttachWarnCooldown) {
        this._lastPendingAttachWarn = now;
        const reason = attachResult.error
          ? (attachResult.error.message || attachResult.error.toString())
          : (this.copRoot ? 'attach failed' : 'root not ready');
        console.warn('[CopCar3D] Pending model attach deferred:', reason);
      }
    }
  },

  _addModelToScene(model, allowDefer = true) {
    const result = { success: false, deferred: false, error: null };
    if (!model) return result;
    const debugEnabled = this._isDebugEnabled();
    if (this.copRoot) {
      // Prevent adding duplicate: if model is already a child, skip
      if (this.copRoot.children.includes(model)) {
        result.success = true;
        return result;
      }
      try {
        if (model.parent && model.parent !== this.copRoot) {
          model.parent.remove(model);
        }
        this.copRoot.add(model);
        result.success = true;
        if (debugEnabled) {
          console.log('[CopCar3D] Model attached to copRoot', {
            copRootChildren: this.copRoot.children.length,
            modelName: model.name || 'unnamed',
            modelPosition: { x: model.position.x, y: model.position.y, z: model.position.z },
            modelScale: model.scale ? { x: model.scale.x, y: model.scale.y, z: model.scale.z } : null
          });
        }
        return result;
      } catch (e) {
        console.warn('[CopCar3D] Model attach failed:', e);
        result.error = e;
        return result;
      }
    }
    if (allowDefer) {
      this._pendingModelRoot = model;
      result.deferred = true;
      if (debugEnabled) {
        console.log('[CopCar3D] Model attach deferred (copRoot not ready)');
      }
    }
    return result;
  },

  _syncLayerTransform() {
    if (!this.layer) return;
    const world = this.mapWorldEl || document.getElementById('map-world');
    if (!world) return;

    // The layer is nested inside #map-world, so it inherits pan/zoom
    // transforms automatically. We only need to clear any stale transform
    // and keep the dimensions in sync.
    const isInsideWorld = world.contains(this.layer);
    if (isInsideWorld) {
      // Inside #map-world: do NOT copy transform (would double it)
      this.layer.style.transform = '';
    } else {
      // Fallback: outside #map-world, mirror the transform (legacy path)
      const tf = world.style.transform || getComputedStyle(world).transform || '';
      this.layer.style.transform = (tf && tf !== 'none') ? tf : '';
    }

    // Match the untransformed (base) world size.
    const w = world.offsetWidth || 0;
    const h = world.offsetHeight || 0;
    if (w > 0 && h > 0) {
      this.layer.style.width = `${w}px`;
      this.layer.style.height = `${h}px`;
    }
  },

  _tickPendingModelAttach() {
    if (!this._pendingModelRoot) return;
    this._attachPendingModel();
  },

  _waitForDimensions() {
    if (!this.container) return;

    // ResizeObserver path
    if (!this._pendingInitObserver && typeof ResizeObserver !== 'undefined') {
      this._pendingInitObserver = new ResizeObserver(() => {
        if (!this.container) return;
          const dims = this._getWorldBaseSize();
          const w = dims.w;
          const h = dims.h;
        if (w > 0 && h > 0) {
          try { this._pendingInitObserver.disconnect(); } catch (e) {}
          this._pendingInitObserver = null;
          this.init();
        }
      });
      try {
        this._pendingInitObserver.observe(this.container);
        if (this.mapWorldEl) this._pendingInitObserver.observe(this.mapWorldEl);
      } catch (e) {}
    }

    // RAF polling fallback
    if (!this._pendingInitRAF) {
      let frames = 0;
      const maxFrames = 240; // ~4s at 60fps
      const poll = () => {
        this._pendingInitRAF = requestAnimationFrame(poll);
        frames++;

        if (!this.container || !this.container.isConnected) return;
        const dims = this._getWorldBaseSize();
        const w = dims.w;
        const h = dims.h;

        if (w > 0 && h > 0) {
          cancelAnimationFrame(this._pendingInitRAF);
          this._pendingInitRAF = null;
          this.init();
          return;
        }

        if (frames >= maxFrames) {
          cancelAnimationFrame(this._pendingInitRAF);
          this._pendingInitRAF = null;
          console.warn('[CopCar3D] Still zero-size after polling; will retry on next tab show.');
        }
      };
      this._pendingInitRAF = requestAnimationFrame(poll);
    }
  },

  async _initScene(width, height) {
    console.log('[CopCar3D] Scene setup:', width, 'x', height);

    // Remove old canvas if present
    try {
      if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    } catch (e) {}

    // Clean up any previous scene objects to prevent duplicate cop cars
    if (this.scene) {
      try {
        if (this.copRoot && this.scene.children.includes(this.copRoot)) {
          this.scene.remove(this.copRoot);
        }
        if (this.model && this.model.parent) {
          this.model.parent.remove(this.model);
        }
      } catch (e) {
        console.warn('[CopCar3D] Scene cleanup error:', e);
      }
    }
    if (this.renderer) {
      try { this.renderer.dispose(); } catch (e) {
        console.warn('[CopCar3D] Renderer dispose error:', e);
      }
      this.renderer = null;
    }

    this.scene = new THREE.Scene();
    this.copRoot = new THREE.Group();
    this.copRoot.name = 'CopCarRoot';
    this.scene.add(this.copRoot);
    this._attachPendingModel();

    // Orthographic camera in "percent space" (0..100) centered on (50,50) so the 3D car aligns with
    // the 2D marker which is positioned using % left/top.
    // The layer mirrors #map-world's CSS transform (pan/zoom), keeping alignment
    // correct without nesting the canvas inside the transformed element.
    //
    // ASPECT-CORRECT frustum: We adjust the frustum based on the canvas aspect ratio
    // so that 1 world unit in X equals 1 world unit in Z on screen. This prevents the
    // cop car from appearing to change shape when rotating.
    // The X coordinate mapping accounts for the wider frustum: worldX = (pctX - 50) * aspect.
    const aspect = width / height;
    this._mapAspect = aspect;
    const halfW = 50 * aspect;  // Wider frustum for portrait displays
    const halfH = 50;
    this.camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 500);
    this.camera.up.set(0, 0, -1); // Set up vector to -Z before lookAt (avoids gimbal lock when looking down Y)
    this.camera.position.set(0, 120, 0);
    this._cameraLookAt = new THREE.Vector3(0, 0, 0);
    this.camera.lookAt(this._cameraLookAt);

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.config.maxPixelRatio));
    this.renderer.setSize(width, height, false);

    // Color correctness + detail
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.renderer.shadowMap.enabled = !!this.config.shadowsEnabled;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.canvas = this.renderer.domElement;
    this.canvas.id = 'cop-car-3d-canvas';
    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '1';

    // Ensure parent is positioned
    const layerParent = (this.layer && this.layer.parentElement) || this.container;
    try {
      const pos = getComputedStyle(layerParent).position;
      if (!pos || pos === 'static') layerParent.style.position = 'relative';
    } catch (e) {}

    this._ensureLayer();
    if (this.layer) this.layer.appendChild(this.canvas);
    this._syncLayerTransform();

    this._raycaster = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._setupLighting();
    this._setupDebugHelpers();
    this._ensureSmokeSystem();
    await this._loadModel();
    this._attachPendingModel();

    this._setupResizeHandler();
    this._startLoop();

    this.isInitialized = true;
    console.log('[CopCar3D] Ready');
  },

  _setupLighting() {
    const debug = this.config?.debug;
    // Debug visibility: use debug-configured light intensities for cop car troubleshooting.
    const ambientIntensity = debug?.ambientIntensity ?? 1.0;
    this.lights.ambient = new THREE.AmbientLight(0xffffff, ambientIntensity);
    this.scene.add(this.lights.ambient);

    this.lights.hemi = new THREE.HemisphereLight(0xffffff, 0x2a2a2a, 0.65);
    this.lights.hemi.position.set(0, 100, 0);
    this.scene.add(this.lights.hemi);

    const directionalIntensity = debug?.directionalIntensity ?? 1.0;
    this.lights.directional = new THREE.DirectionalLight(0xffffff, directionalIntensity);
    const directionalPos = debug?.directionalPosition || { x: 50, y: 100, z: 50 };
    this.lights.directional.position.set(directionalPos.x, directionalPos.y, directionalPos.z);

    if (this.config.shadowsEnabled) {
      this.lights.directional.castShadow = true;
      this.lights.directional.shadow.mapSize.set(1024, 1024);
      this.lights.directional.shadow.camera.near = 0.5;
      this.lights.directional.shadow.camera.far = 200;
      this.lights.directional.shadow.camera.left = -80;
      this.lights.directional.shadow.camera.right = 80;
      this.lights.directional.shadow.camera.top = 80;
      this.lights.directional.shadow.camera.bottom = -80;
      this.lights.directional.shadow.bias = -0.00025;
    }

    this.scene.add(this.lights.directional);

    // Create police lights with higher intensity for better visibility
    const red = new THREE.PointLight(0xff0000, 0, 12);
    red.position.set(-0.45, 1.3, 0.1);
    red.distance = 15;
    red.decay = 1.5;
    
    const blue = new THREE.PointLight(0x0000ff, 0, 12);
    blue.position.set(0.45, 1.3, 0.1);
    blue.distance = 15;
    blue.decay = 1.5;

    this.lights.police = [red, blue];
    
    // Add lights to scene immediately (will be repositioned to pivot when model loads)
    this.scene.add(red);
    this.scene.add(blue);
  },

  _ensureSmokeSystem() {
    if (this._smokeGroup) return;

    this._smokeGroup = new THREE.Group();
    this._smokeGroup.renderOrder = 999;
    this.scene.add(this._smokeGroup);

    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0.0, 'rgba(255,255,255,0.60)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.25)');
    g.addColorStop(1.0, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);

    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.needsUpdate = true;

    this._smokeBaseMaterial = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: this.config.exhaust.baseOpacity,
      depthWrite: false
    });
  },

  _setupDebugHelpers() {
    if (!this._isDebugEnabled()) return;
    if (!this.scene) return;

    if (!this._debugAxes) {
      this._debugAxes = new THREE.AxesHelper(50);
    this._debugAxes.position.set(0, 0, 0);
      this.scene.add(this._debugAxes);
    }

    if (!this._debugCube) {
      const geometry = new THREE.BoxGeometry(5, 5, 5);
      const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      this._debugCube = new THREE.Mesh(geometry, material);
    this._debugCube.position.set(0, 2.5, 0);
      this.scene.add(this._debugCube);
    }

    if (!this._debugLaneRect) {
      const geometry = new THREE.PlaneGeometry(1, 1);
      const material = new THREE.MeshBasicMaterial({
        color: 0x2cc5ff,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      this._debugLaneRect = new THREE.Mesh(geometry, material);
      this._debugLaneRect.rotation.x = -Math.PI / 2;
      this._debugLaneRect.position.y = 0.02;
      this.scene.add(this._debugLaneRect);
    }
  },

  async _loadModel() {
    // Prevent loading a duplicate model if one is already loaded
    if (this.modelLoaded && this.model && this.copRoot && this.copRoot.children.includes(this.model)) {
      console.log('[CopCar3D] Model already loaded, skipping duplicate load');
      return;
    }

    console.log('[CopCar3D] Loading:', this.modelPath);

    return new Promise((resolve, reject) => {
      const loader = new THREE.GLTFLoader();
      loader.load(
        this.modelPath,
        (gltf) => {
          // Build pivot group and recenter model to eliminate rotation "orbit" / sliding.
          const pivot = new THREE.Group();
          pivot.name = 'CopCarPivot';

          const visual = gltf.scene;
          const debugEnabled = this._isDebugEnabled();
          visual.name = 'CopCarVisual';
          if (debugEnabled) {
            let meshCount = 0;
            let totalVertices = 0;
            visual.traverse((obj) => {
              if (obj.isMesh) {
                meshCount++;
                if (obj.geometry && obj.geometry.attributes && obj.geometry.attributes.position) {
                  totalVertices += obj.geometry.attributes.position.count;
                }
              }
            });
            console.log('[CopCar3D] GLB LOADED', {
              children: visual.children?.length || 0,
              meshCount,
              totalVertices,
              visible: visual.visible
            });
          }

          // Apply scaling with fallback for when lane width can't be calculated
          this._applyModelScaling(visual, debugEnabled);

          // Material / texture sharpening
          const maxAniso = this.renderer?.capabilities?.getMaxAnisotropy?.() || 1;
          visual.traverse((child) => {
            if (!child.isMesh) return;

            child.castShadow = !!this.config.shadowsEnabled;
            child.receiveShadow = !!this.config.shadowsEnabled;

            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((mat) => {
              if (!mat) return;
              if (mat.map) {
                mat.map.encoding = THREE.sRGBEncoding;
                mat.map.anisotropy = maxAniso;
                mat.map.needsUpdate = true;
              }
              if (mat.emissiveMap) {
                mat.emissiveMap.encoding = THREE.sRGBEncoding;
                mat.emissiveMap.anisotropy = maxAniso;
                mat.emissiveMap.needsUpdate = true;
              }
              mat.needsUpdate = true;
            });
          });

          // Attach police lights to the pivot so they follow yaw/roll
          this.lights.police.forEach((l) => {
            // Remove from scene and add to pivot
            if (l.parent) l.parent.remove(l);
            pivot.add(l);
          });

          pivot.add(visual);

          // Debug: keep on the ground plane without ride height offset.
          const rideHeight = this.config?.debug?.rideHeight ?? 0;
          pivot.position.set(0, rideHeight, 0);

          this.model = pivot;
          this.modelVisual = visual;

          // Cache wheels + exhaust anchor
          this._cacheModelParts();

          this._addModelToScene(this.model);
          this.modelLoaded = true;

          // Also load the Drug Lab building once the Three.js scene is ready.
          this._ensureDrugLab();

          console.log('[CopCar3D] Model loaded');
          resolve();
        },
        undefined,
        (err) => {
          console.error('[CopCar3D] Model load failed:', err);
          // Fallback: create a simple colored box so the car is at least visible
          this._createFallbackModel();
          resolve(); // Don't reject - use fallback instead
        }
      );
    });
  }
,
  async _ensureDrugLab() {
    try {
      if (!this.drugLabEnabled) return;
      if (this._drugLabLoaded) return;
      if (!this.scene || typeof THREE === 'undefined' || typeof THREE.GLTFLoader === 'undefined') return;

      // If app.js created DrugLabSystem, prefer its bounds (keeps one source of truth)
      if (typeof window !== 'undefined' && window.DrugLabSystem && window.DrugLabSystem.cellBoundsPct) {
        this.drugLabCellBoundsPct = window.DrugLabSystem.cellBoundsPct;
      }

      const loader = new THREE.GLTFLoader();
      loader.load(
        this.drugLabModelPath,
        (gltf) => {
          const root = gltf.scene;
          root.name = 'DrugLabBuilding';

          // Position: center of the target grid cell in world space (percent -> world)
          const b = this.drugLabCellBoundsPct;
          const cx = (b.left + b.right) / 2;
          const cy = (b.top + b.bottom) / 2;
          const asp = this._mapAspect || 1;
          const worldX = (cx - 50) * asp;
          const worldZ = cy - 50;

          // Target footprint in world units (scaled by aspect for X)
          const cellW = (b.right - b.left) * asp;
          const cellH = (b.bottom - b.top);

          // Compute bounds for scaling
          const box = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3();
          box.getSize(size);

          // If model is degenerate, fallback scale
          let s = 1;
          if (size.x > 0.0001 && size.z > 0.0001) {
            s = Math.min(cellW / size.x, cellH / size.z);
          } else if (size.x > 0.0001) {
            s = (cellW / size.x);
          }

          root.scale.setScalar(s);

          // Recompute bounds after scaling and lift so it sits on y=0 ground
          const box2 = new THREE.Box3().setFromObject(root);
          const minY = box2.min.y;

          root.position.set(worldX, -minY, worldZ);

          // Face toward camera on initial load (will be billboarded each frame)
          if (this.camera) {
            root.rotation.y = Math.atan2(
              this.camera.position.x - worldX,
              this.camera.position.z - worldZ
            );
          }

          this.scene.add(root);
          this.drugLabRoot = root;
          this._drugLabLoaded = true;
          console.log('[CopCar3D] ✅ Drug Lab building loaded at grid #35');
        },
        undefined,
        (err) => {
          console.warn('[CopCar3D] Drug Lab building failed to load:', err);
        }
      );
    } catch (e) {
      console.warn('[CopCar3D] _ensureDrugLab error:', e);
    }
  }
,

  /**
   * Apply scaling to the model with proper fallback when lane width can't be calculated
   */
  _applyModelScaling(visual, debugEnabled) {
    try {
      const box = new THREE.Box3().setFromObject(visual);
      const size = new THREE.Vector3();
      box.getSize(size);
      
      const lengthAxis = size.x >= size.z ? 'x' : 'z';
      const widthAxis = lengthAxis === 'x' ? 'z' : 'x';
      const bboxLength = lengthAxis === 'x' ? size.x : size.z;
      const bboxWidth = widthAxis === 'x' ? size.x : size.z;
      
      // Try to calculate lane width, but use fallback if not available
      let lanePercent = this._calculateLaneWidthPercent();
      let usedFallback = false;
      
      if (lanePercent == null) {
        // Fallback: use a reasonable default based on typical map proportions
        lanePercent = 2.5; // Default lane width in percent
        usedFallback = true;

        // Schedule a retry to get proper scaling once map is ready
        if (this._scaleRetryCount < this._maxScaleRetries) {
          this._scaleRetryCount++;
          setTimeout(() => {
            if (this.modelVisual) {
              console.log('[CopCar3D] Retrying scale calculation...');
              this._applyModelScaling(this.modelVisual, this._isDebugEnabled());
            }
          }, 500);
        }
      } else {
        // Real lane width obtained — mark scaling as final
        this._initialScaleApplied = true;
      }
      
      const laneWidthFactor = this.config?.laneWidthFactor ?? 0.8;
      const fallbackWidth = this.config?.carWidthPercentUnits ?? 3.0;
      const desiredWidth = (lanePercent != null) ? (lanePercent * laneWidthFactor) : fallbackWidth;
      const baseScale = (isFinite(bboxWidth) && bboxWidth > 0) ? (desiredWidth / bboxWidth) : 0.5;
      
      visual.scale.setScalar(baseScale);
      
      const widthSlim = this.config?.carWidthSlimFactor ?? 0.9;
      if (isFinite(bboxWidth) && bboxWidth > 0) {
        if (widthAxis === 'x') visual.scale.x *= widthSlim;
        if (widthAxis === 'z') visual.scale.z *= widthSlim;
      }
      
      const lengthStretch = this.config?.carLengthStretchFactor ?? 1.05;
      if (isFinite(bboxLength) && bboxLength > 0) {
        if (lengthAxis === 'x') visual.scale.x *= lengthStretch;
        if (lengthAxis === 'z') visual.scale.z *= lengthStretch;
      }

      const scaledBox = new THREE.Box3().setFromObject(visual);
      const center = new THREE.Vector3();
      scaledBox.getCenter(center);
      visual.position.set(-center.x, -center.y, -center.z);
      
      this._laneWidthPercent = lanePercent ?? null;
      this._carScaledLength = lengthAxis === 'x'
        ? (scaledBox.max.x - scaledBox.min.x)
        : (scaledBox.max.z - scaledBox.min.z);
        
      if (debugEnabled || usedFallback) {
        console.log('[CopCar3D] GLB bbox', {
          size: { x: size.x, y: size.y, z: size.z },
          lengthAxis,
          widthAxis,
          lanePercent,
          desiredWidth,
          usedFallback,
          widthSlim,
          lengthStretch,
          scale: baseScale,
          center: { x: center.x, y: center.y, z: center.z }
        });
      }
    } catch (e) {
      console.warn('[CopCar3D] Scaling failed, using default:', e);
      // Apply a safe default scale
      visual.scale.setScalar(0.5);
    }
  },

  /**
   * Create a simple colored box as fallback if GLB model fails to load.
   * Also makes the 2D marker visible as additional fallback.
   */
  _createFallbackModel() {
    console.warn('[CopCar3D] Using fallback box model');

    // Create a simple police-car-colored box
    const geometry = new THREE.BoxGeometry(2.5, 1.2, 4.5);
    const material = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e, // Dark blue/black
      metalness: 0.3,
      roughness: 0.7
    });
    const box = new THREE.Mesh(geometry, material);
    box.castShadow = true;
    box.receiveShadow = true;

    // Add a light bar on top (red/blue)
    const lightBarGeo = new THREE.BoxGeometry(1.8, 0.3, 0.6);
    const lightBarMat = new THREE.MeshStandardMaterial({
      color: 0x4444ff,
      emissive: 0x2222ff,
      emissiveIntensity: 0.5
    });
    const lightBar = new THREE.Mesh(lightBarGeo, lightBarMat);
    lightBar.position.y = 0.75;
    box.add(lightBar);

    const pivot = new THREE.Group();
    pivot.name = 'CopCarPivot';
    pivot.add(box);
    pivot.position.y = 0.6; // Raise above ground

    // Attach police lights
    this.lights.police.forEach((l) => pivot.add(l));

    this.model = pivot;
    this.modelVisual = box;
    this._addModelToScene(this.model);
    this.modelLoaded = true;

    // Also show the 2D marker as additional fallback
    if (this.copCarElement) {
      this.copCarElement.style.opacity = '1';
      this.copCarElement.style.fontSize = '24px';
      this.copCarElement.textContent = '🚔';
    }
  },

  _cacheModelParts() {
    this._wheels = [];
    this._frontWheels = [];

    const root = this.modelVisual || this.model;
    if (!root) return;

    // Try a few naming patterns - expanded list for better compatibility
    const patterns = [
      /wheelsport_(fl|fr|rl|rr)/i,
      /wheel[_-]?(front|rear)?[_-]?(left|right)|wheel[_-]?(fl|fr|rl|rr)/i,
      /(fl|fr|rl|rr).*wheel/i,
      /wheel/i,
      /tire/i,
      /rim/i
    ];

    root.traverse((obj) => {
      const n = (obj.name || '');
      let tag = null;

      for (const re of patterns) {
        const m = n.match(re);
        if (m) { tag = m[1] || m[3] || ''; break; }
      }

      if (!tag) return;

      this._wheels.push(obj);
      const t = String(tag).toLowerCase();
      if (t.includes('fl') || t.includes('fr') || (t.includes('front') && (t.includes('left') || t.includes('right')))) {
        this._frontWheels.push(obj);
      }
    });

    // Estimate wheel radius from first wheel bounds
    try {
      if (this._wheels.length) {
        const box = new THREE.Box3().setFromObject(this._wheels[0]);
        const size = new THREE.Vector3();
        box.getSize(size);
        const diameter = Math.max(size.x, size.y, size.z);
        if (isFinite(diameter) && diameter > 0.001) this._wheelRadius = Math.max(0.05, diameter * 0.5);
      }
    } catch (e) {}

    // Exhaust anchor in local model space
    try {
      if (this._exhaustAnchor && this._exhaustAnchor.parent) {
        this._exhaustAnchor.parent.remove(this._exhaustAnchor);
      }
      this._exhaustAnchor = new THREE.Object3D();
      const eo = this.config.exhaust.localOffset;
      this._exhaustAnchor.position.set(eo.x, eo.y, eo.z);
      (this.modelVisual || this.model).add(this._exhaustAnchor);
    } catch (e) {}

    if (this._wheels.length) {
      console.log('[CopCar3D] Wheels cached:', this._wheels.length, 'radius≈', this._wheelRadius.toFixed(3));
    } else {
      console.warn('[CopCar3D] No wheel nodes matched (wheel roll disabled)');
    }
  },

  _startLoop() {
    if (this.animationFrameId) return;

    const tick = () => {
      this.animationFrameId = requestAnimationFrame(tick);
      try {
        this._update();
        if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
      } catch (e) {
        console.error('[CopCar3D] Render error:', e);
      }
    };

    tick();
  },

  _angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  },

  _update() {
    // dt
    const now = performance.now();
    const dt = this._lastTickTime ? Math.min(0.05, (now - this._lastTickTime) / 1000) : (1 / 60);
    this._lastTickTime = now;

    if (this._isDebugEnabled() && (now - this._lastDebugLog >= this.config.debug.logIntervalMs)) {
      this._lastDebugLog = now;
      const cam = this.camera;
      const look = this._cameraLookAt;
      const root = this.copRoot;
      const mdl = this.model;
      console.log('[CopCar3D] Debug', {
        camera: cam ? { x: cam.position.x, y: cam.position.y, z: cam.position.z } : null,
        lookAt: look ? { x: look.x, y: look.y, z: look.z } : null,
        copRoot: root ? { x: root.position.x, y: root.position.y, z: root.position.z, children: root.children.length } : null,
        model: mdl ? { x: mdl.position.x, y: mdl.position.y, z: mdl.position.z, visible: mdl.visible } : null,
        modelLoaded: this.modelLoaded,
        modelInCopRoot: root && mdl ? root.children.includes(mdl) : false,
        sceneChildren: this.scene ? this.scene.children.length : 0
      });
    }

    // Keep our overlay layer locked to the current map transform.
    this._syncLayerTransform();

    // Update police lights based on heat
    this._updatePoliceLights();

    if (!this.modelLoaded || !this.model || !this.camera || !this._raycaster) {
      this._tickPendingModelAttach();
      this._updateSmoke(dt, 0);
      this._updateDebugLaneRect();
      return;
    }

    // Keep marker in marker-mode even if other systems touch it
    this._prepareMarkerElement();

    // Prefer authoritative CopCarSystem percent-coordinates.
    // This makes the 3D car movement independent from DOM transforms and prevents zoom-induced spin.
    let targetWorld = null;
    let hasValidPosition = false;

    const cs = (typeof window !== 'undefined') ? window.CopCarSystem : null;
    
    // Try to get position from CopCarSystem - check multiple possible sources
    let positionData = null;
    if (cs) {
      positionData = cs.copPose || cs.position || null;
    }
    
    if (!positionData) {
      // No authoritative cop position yet; use a default position and wait
      console.log('[CopCar3D] Waiting for CopCarSystem position...');
      targetWorld = new THREE.Vector3(0, 0, 0);
      hasValidPosition = false;
    } else {
      const px = Number(positionData.x);
      const py = Number(positionData.y);
      
      if (!isFinite(px) || !isFinite(py)) {
        targetWorld = new THREE.Vector3(0, 0, 0);
        hasValidPosition = false;
      } else {
        // Center percent space at (0,0) so camera centered at (50,50) sees full map.
        // X is scaled by the map aspect ratio to match the aspect-correct frustum.
        const asp = this._mapAspect || 1;
        targetWorld = new THREE.Vector3((px - 50) * asp, 0, py - 50);
        hasValidPosition = true;
      }
    }

    this._hasValidPose = hasValidPosition;

    // Determine cop speed from system (for stop snapping + smoke) if available
    let copSpeed = 0;
    if (cs) {
      if (typeof cs.copPose?.speed === 'number') {
        copSpeed = cs.copPose.speed;
      } else if (typeof cs.speed === 'number') {
        copSpeed = cs.speed;
      }
    }

    // Always keep ride height
    if (targetWorld) {
      targetWorld.y = this.model.position.y;
    }

    // dt-based smoothing (stable across FPS)
    let posAlpha = 1 - Math.pow(0.001, dt * this.config.positionLerpStrength);
    const yawAlpha = 1 - Math.pow(0.001, dt * this.config.yawLerpStrength);
    const rollAlpha = 1 - Math.pow(0.001, dt * this.config.rollLerpStrength);

    // Snap when stopped to avoid micro-glide at intersections
    if (copSpeed <= this.config.stopSnapSpeed) posAlpha = 1;

    const prevPos = this.model.position.clone();

    if (!this._lastWorldPos) {
      if (targetWorld) {
        this.model.position.copy(targetWorld);
        this._lastWorldPos = this.model.position.clone();
      }
    } else {
      if (targetWorld) {
        this.model.position.lerp(targetWorld, posAlpha);
      }
    }

    const moveVec = new THREE.Vector3(
      this.model.position.x - prevPos.x,
      0,
      this.model.position.z - prevPos.z
    );

    // Desired yaw:
    // - Prefer CopCarSystem.heading (stable across zoom/pan and matches the road-following system).
    // - Fallback to derived movement vector.
    let desiredYaw = null;
    const mv = Math.abs(moveVec.x) + Math.abs(moveVec.z);

    // Get heading from CopCarSystem if available
    let headingFromSystem = null;
    if (cs && typeof cs.copPose?.heading === 'number' && isFinite(cs.copPose.heading)) {
      headingFromSystem = cs.copPose.heading;
    } else if (cs && typeof cs.heading === 'number' && isFinite(cs.heading)) {
      headingFromSystem = cs.heading;
    }

    if (headingFromSystem !== null) {
      // CopCarSystem.heading is atan2(dx, dy) where dx,dy are in percent-space.
      // But the 3D scene maps X by aspect ratio: worldX = (pctX - 50) * aspect.
      // A straight-line move in percent-space traces a different visual angle
      // on screen when aspect != 1, causing "crabbing" (car points off-axis).
      // Fix: decompose the percent-space heading, scale dx by aspect, recompute.
      const asp = this._mapAspect || 1;
      const sinH = Math.sin(headingFromSystem);
      const cosH = Math.cos(headingFromSystem);
      const worldHeading = Math.atan2(sinH * asp, cosH);
      desiredYaw = worldHeading + this.config.modelYawOffset;
    } else if (mv > 0.0002) {
      desiredYaw = Math.atan2(moveVec.x, moveVec.z) + this.config.modelYawOffset;
    } else {
      // If stopped, keep current yaw. (prevents jitter at intersections)
      desiredYaw = this._currentYaw;
    }

    this._targetYaw = desiredYaw;
    const diff = this._angleDiff(this._targetYaw, this._currentYaw);
    this._currentYaw += diff * yawAlpha;

    // Subtle body roll on turns
    if (this.config.bodyRoll.enabled) {
      const yawRate = diff / Math.max(0.001, dt);
      const speedFactor = Math.min(1.0, Math.max(0, copSpeed) / 6.0);
      const rollTarget = THREE.MathUtils.clamp(-yawRate * this.config.bodyRoll.rollFromYawRate * speedFactor, -this.config.bodyRoll.maxRoll, this.config.bodyRoll.maxRoll);
      this._currentRoll += (rollTarget - this._currentRoll) * rollAlpha;
    } else {
      this._currentRoll += (0 - this._currentRoll) * rollAlpha;
    }

    this.model.rotation.y = this._currentYaw;
    this.model.rotation.z = this._currentRoll;

    this._lastWorldPos.copy(this.model.position);

    // Derived speed in world-units/sec for wheel spin intensity
    const speedDerived = Math.max(0, Math.sqrt(moveVec.x * moveVec.x + moveVec.z * moveVec.z) / Math.max(0.001, dt));
    const speedForEffects = (copSpeed > 0) ? copSpeed : speedDerived;

    // Wheels + exhaust
    this._updateWheels(moveVec, dt, speedDerived, copSpeed);
    this._updateSmoke(dt, speedForEffects);
    this._updateDebugLaneRect();

    // Sync Drug Lab 3D position from DrugLabSystem bounds (supports real-time move)
    if (this.drugLabRoot) {
      const dls = (typeof window !== 'undefined') ? window.DrugLabSystem : null;
      if (dls && dls.cellBoundsPct) {
        const b = dls.cellBoundsPct;
        const cx = (b.left + b.right) / 2;
        const cy = (b.top + b.bottom) / 2;
        const asp = this._mapAspect || 1;
        this.drugLabRoot.position.x = (cx - 50) * asp;
        this.drugLabRoot.position.z = cy - 50;
      }

      // Billboard the Drug Lab building so it always faces the camera
      if (this.camera) {
        const dlPos = this.drugLabRoot.position;
        this.drugLabRoot.rotation.y = Math.atan2(
          this.camera.position.x - dlPos.x,
          this.camera.position.z - dlPos.z
        );
      }
    }
  },

  _updateDebugLaneRect() {
    const enabled = this._isDebugEnabled();
    if (enabled && !this._debugLaneRect) {
      this._setupDebugHelpers();
    }
    if (!this._debugLaneRect) return;
    this._debugLaneRect.visible = !!enabled;
    if (!enabled || !this.model) return;
    if (this._laneWidthPercent == null && performance.now() >= this._laneWidthRetryAt) {
      this._laneWidthPercent = this._calculateLaneWidthPercent();
      if (this._laneWidthPercent == null) {
        this._laneWidthRetryAt = performance.now() + 500;
      }
    }
    const lanePercent = this._laneWidthPercent;
    if (!lanePercent) return;
    const debugLengthFactor = this.config?.laneDebugLengthFactor ?? 1.6;
    const length = this._carScaledLength || (lanePercent * debugLengthFactor);
    const widthFactor = this.config?.laneWidthFactor ?? 0.8;
    this._debugLaneRect.scale.set(lanePercent * widthFactor, length, 1);
    this._debugLaneRect.position.x = this.model.position.x;
    this._debugLaneRect.position.z = this.model.position.z;
    this._debugLaneRect.rotation.y = this._currentYaw;
  },

  _updateWheels(moveVec, dt, speedWorld, speedCop) {
    if (!this.config.wheels.enabled) return;
    if (!this._wheels || this._wheels.length === 0) return;

    const dist = Math.sqrt(moveVec.x * moveVec.x + moveVec.z * moveVec.z);

    // Roll
    if (dist > 0.000001) {
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.model.quaternion);
      const dot = forward.x * moveVec.x + forward.z * moveVec.z;
      const sign = (dot >= 0) ? 1 : -1;

      const radius = Math.max(0.05, this._wheelRadius || 0.45);
      const spin = sign * (dist / radius) * this.config.wheels.spinMultiplier;

      for (const w of this._wheels) {
        if (!w) continue;
        if (this.config.wheels.spinAxis === 'x') w.rotation.x += spin;
        else if (this.config.wheels.spinAxis === 'y') w.rotation.y += spin;
        else w.rotation.z += spin;
      }
    }

    // Steering (inferred from yaw rate)
    const yawErr = this._angleDiff(this._targetYaw, this._currentYaw);
    const yawRate = yawErr / Math.max(0.001, dt);

    let steerTarget = THREE.MathUtils.clamp(yawRate * 0.06, -this.config.wheels.maxSteerAngle, this.config.wheels.maxSteerAngle);
    if ((speedCop > 0 ? speedCop : speedWorld) < 0.05) steerTarget = 0;

    const steerAlpha = 1 - Math.pow(0.001, dt * this.config.wheels.steerResponsiveness);
    this._steerCurrent += (steerTarget - this._steerCurrent) * steerAlpha;

    for (const fw of this._frontWheels) {
      if (!fw) continue;
      fw.rotation.y = this._steerCurrent;
    }
  },

  _spawnSmoke(worldPos, forwardDir) {
    if (!this._smokeGroup || !this._smokeBaseMaterial) return;
    if (this._smokeParticles.length >= this.config.exhaust.maxParticles) return;

    const mat = this._smokeBaseMaterial.clone();
    mat.opacity = this.config.exhaust.baseOpacity;

    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(worldPos);
    sprite.scale.setScalar(this.config.exhaust.baseScale * (0.85 + Math.random() * 0.3));
    sprite.renderOrder = 999;

    const vel = new THREE.Vector3();
    vel.copy(forwardDir).multiplyScalar(-0.55 - Math.random() * 0.25);
    vel.y += 0.35 + Math.random() * 0.25;
    vel.x += (Math.random() - 0.5) * 0.18;
    vel.z += (Math.random() - 0.5) * 0.18;

    const life = this.config.exhaust.lifeMin + Math.random() * (this.config.exhaust.lifeMax - this.config.exhaust.lifeMin);

    sprite.userData = {
      age: 0,
      life,
      vel,
      startOpacity: mat.opacity,
      startScale: sprite.scale.x,
      spin: (Math.random() - 0.5) * 0.8
    };

    this._smokeGroup.add(sprite);
    this._smokeParticles.push(sprite);
  },

  _updateSmoke(dt, speed) {
    if (!this.config.exhaust.enabled) return;
    if (!this.model || !this._exhaustAnchor) return;

    // Emit
    if (speed >= this.config.exhaust.minSpeedToEmit) {
      const rate = this.config.exhaust.rate * Math.min(3, speed);
      this._smokeEmitAcc += dt * rate;
      const count = Math.min(4, Math.floor(this._smokeEmitAcc));
      if (count > 0) this._smokeEmitAcc -= count;

      const worldPos = new THREE.Vector3();
      this._exhaustAnchor.getWorldPosition(worldPos);

      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.model.quaternion);

      for (let i = 0; i < count; i++) {
        this._spawnSmoke(worldPos, forward);
      }
    } else {
      this._smokeEmitAcc = Math.max(0, this._smokeEmitAcc - dt * 2);
    }

    // Update particles
    for (let i = this._smokeParticles.length - 1; i >= 0; i--) {
      const p = this._smokeParticles[i];
      if (!p || !p.userData) {
        this._smokeParticles.splice(i, 1);
        continue;
      }

      const u = p.userData;
      u.age += dt;

      if (u.age >= u.life) {
        try { if (p.parent) p.parent.remove(p); } catch (e) {}
        try { if (p.material) p.material.dispose(); } catch (e) {}
        this._smokeParticles.splice(i, 1);
        continue;
      }

      p.position.addScaledVector(u.vel, dt);
      u.vel.multiplyScalar(0.92);
      u.vel.y += 0.08 * dt;

      const t = u.age / u.life;
      const fade = (1 - t);
      p.material.opacity = u.startOpacity * fade * fade;

      const s = u.startScale * (1 + t * 1.35);
      p.scale.setScalar(s);

      if (p.material) p.material.rotation += u.spin * dt;
    }
  },

  _updatePoliceLights() {
    // Get heat from GameState with fallback
    let heat = 0;
    if (window.GameState && typeof GameState.player !== 'undefined') {
      heat = GameState.player.heat || 0;
    }

    if (heat > 50) {
      this.policeLightsActive = true;
      this.policeLightTime += 0.1;

      // More dramatic flashing pattern
      const flashSpeed = heat > 80 ? 15 : 10;
      const phase = Math.sin(this.policeLightTime * flashSpeed);
      
      // Alternate between red and blue with higher intensity
      const baseIntensity = heat > 80 ? 3.5 : 2.5;
      
      if (this.lights.police[0]) {
        this.lights.police[0].intensity = phase > 0 ? baseIntensity : 0.1;
        this.lights.police[0].color.setHex(0xff0000);
      }
      if (this.lights.police[1]) {
        this.lights.police[1].intensity = phase > 0 ? 0.1 : baseIntensity;
        this.lights.police[1].color.setHex(0x0000ff);
      }

      // Add emergency boost at very high heat
      if (heat > 90) {
        const boost = 1 + Math.sin(this.policeLightTime * 20) * 0.3;
        if (this.lights.police[0]) this.lights.police[0].intensity *= boost;
        if (this.lights.police[1]) this.lights.police[1].intensity *= boost;
      }
    } else {
      this.policeLightsActive = false;
      // Dim lights at low heat but keep slight visibility
      const lowHeatIntensity = heat > 25 ? 0.3 : 0;
      if (this.lights.police[0]) this.lights.police[0].intensity = lowHeatIntensity;
      if (this.lights.police[1]) this.lights.police[1].intensity = lowHeatIntensity;
    }
  },

  _setupResizeHandler() {
    if (!this.container || typeof ResizeObserver === 'undefined') return;

    if (this._resizeObserver) {
      try { this._resizeObserver.disconnect(); } catch (e) {}
      this._resizeObserver = null;
    }

    this._resizeObserver = new ResizeObserver(() => {
      if (!this.container) return;
      this._syncLayerTransform();
      const dims = this._getWorldBaseSize();
      if (dims.w > 0 && dims.h > 0) this._handleResize(dims.w, dims.h);
    });

    try {
      this._resizeObserver.observe(this.container);
      if (this.mapWorldEl) this._resizeObserver.observe(this.mapWorldEl);
    } catch (e) {}
  },

  _handleResize(width, height) {
    if (!this.camera || !this.renderer) return;

    // Update aspect-correct frustum so the car doesn't distort when rotating.
    const aspect = width / height;
    this._mapAspect = aspect;
    const halfW = 50 * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = 50;
    this.camera.bottom = -50;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.config.maxPixelRatio));
    this.renderer.setSize(width, height, false);
    this._laneWidthPercent = this._calculateLaneWidthPercent();
  },

  /**
   * Lightweight hide: pause rendering and hide the overlay layer.
   * The scene, renderer, and loaded model are kept alive so re-showing is instant.
   */
  hide() {
    this._hidden = true;
    // Pause render loop
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Hide the overlay layer via CSS (no layout recalculation)
    if (this.layer) {
      this.layer.style.visibility = 'hidden';
    }
  },

  /**
   * Lightweight show: resume rendering and show the overlay layer.
   * If the scene was never initialized, falls through to full init().
   */
  show() {
    this._hidden = false;
    if (!this.isInitialized || !this.renderer || !this.scene) {
      // Not yet initialized — do a full init
      return this.init();
    }
    // Re-attach DOM references in case they changed
    this.container = document.getElementById('map-viewport') || document.getElementById('city-map');
    this.mapWorldEl = document.getElementById('map-world');
    this.copCarElement = document.getElementById('cop-car');
    this._prepareMarkerElement();
    this._ensureLayer();
    // Show the overlay layer
    if (this.layer) {
      this.layer.style.visibility = '';
      if (this.canvas && !this.layer.contains(this.canvas)) {
        this.layer.appendChild(this.canvas);
      }
    }
    // Resize to current container dimensions
    const dims = this._getWorldBaseSize();
    if (dims.w > 0 && dims.h > 0) {
      this._handleResize(dims.w, dims.h);
    }
    this._syncLayerTransform();
    // Restart render loop
    if (!this.animationFrameId) this._startLoop();
    return Promise.resolve(true);
  },

  dispose() {
    try {
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }

      if (this._pendingInitObserver) {
        try { this._pendingInitObserver.disconnect(); } catch (e) {}
        this._pendingInitObserver = null;
      }

      if (this._pendingInitRAF) {
        cancelAnimationFrame(this._pendingInitRAF);
        this._pendingInitRAF = null;
      }

      if (this._resizeObserver) {
        try { this._resizeObserver.disconnect(); } catch (e) {}
        this._resizeObserver = null;
      }

      // Smoke cleanup
      if (this._smokeParticles && this._smokeParticles.length) {
        for (const p of this._smokeParticles) {
          try { if (p.parent) p.parent.remove(p); } catch (e) {}
          try { if (p.material) p.material.dispose(); } catch (e) {}
        }
      }
      this._smokeParticles = [];

      if (this._smokeBaseMaterial) {
        try { if (this._smokeBaseMaterial.map) this._smokeBaseMaterial.map.dispose(); } catch (e) {}
        try { this._smokeBaseMaterial.dispose(); } catch (e) {}
        this._smokeBaseMaterial = null;
      }

      if (this._smokeGroup) {
        try { this.scene?.remove(this._smokeGroup); } catch (e) {}
        this._smokeGroup = null;
      }

      // Model cleanup
      if (this.model) {
        try {
          this.model.traverse((obj) => {
            if (!obj) return;
            if (obj.isMesh) {
              try { if (obj.geometry) obj.geometry.dispose(); } catch (e) {}
              const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
              mats.forEach((m) => {
                if (!m) return;
                try { if (m.map) m.map.dispose(); } catch (e) {}
                try { if (m.emissiveMap) m.emissiveMap.dispose(); } catch (e) {}
                try { m.dispose(); } catch (e) {}
              });
            }
          });
        } catch (e) {}
      }

      if (this.scene && this.model) {
        try { this.scene.remove(this.model); } catch (e) {}
      }
      if (this.scene && this.copRoot) {
        try { this.scene.remove(this.copRoot); } catch (e) {}
      }
    if (this._debugAxes && this.scene) {
      try { this.scene.remove(this._debugAxes); } catch (e) {}
    }
    if (this._debugCube && this.scene) {
      try { this.scene.remove(this._debugCube); } catch (e) {}
    }
    if (this._debugLaneRect && this.scene) {
      try { this.scene.remove(this._debugLaneRect); } catch (e) {}
    }

      if (this.renderer) {
        this.renderer.dispose();
        this.renderer = null;
      }

      if (this.canvas && this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }

      this.canvas = null;
      this.scene = null;
      this.camera = null;
      this.model = null;
      this.modelVisual = null;
      this.modelLoaded = false;
      this.copRoot = null;
      this._pendingModelRoot = null;
      this._cameraLookAt = null;
      this._debugAxes = null;
      this._debugCube = null;
      this._debugLaneRect = null;

      this._wheels = [];
      this._frontWheels = [];
      this._exhaustAnchor = null;

      this.isInitialized = false;
      this._initPromise = null;
      this._lastTickTime = 0;
      this._lastWorldPos = null;
      this._currentYaw = 0;
      this._targetYaw = 0;
      this._currentRoll = 0;
      this._steerCurrent = 0;

      // Clear session tracking to allow fresh init on next tab entry
      this._turfSessionId = null;
      this._lastPendingAttachWarn = 0;
      
      // Reset scaling flags
      this._initialScaleApplied = false;
      this._scaleRetryCount = 0;
    } catch (e) {
      console.warn('[CopCar3D] Dispose error:', e);
    }
  }
};

// Expose globally
window.CopCar3D = CopCar3D;
