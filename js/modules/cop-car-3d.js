/**
 * 3D Cop Car Module
 * Three.js-based 3D cop car overlay for the turf map.
 *
 * Primary objective: make the 3D cop car reliably appear on the Turf map.
 *
 * Design:
 * - We keep the existing CopCarSystem logic (roads + intersection stops).
 * - The 2D #cop-car remains as a POSITION MARKER only (emoji hidden via CSS/JS).
 * - The 3D car reads CopCarSystem.position/heading directly (authoritative map percent space).
 * - We recenter the GLB pivot to eliminate "sliding"/orbiting during rotation.
 * - Wheel roll + subtle steering + faint exhaust for realism.
 *
 * Requirements satisfied:
 * - 3D cop car shows up (robust init when #city-map becomes visible).
 * - Follows the roads + stops at intersections (inherits CopCarSystem).
 * - No "sliding" (pivot recenter + stop snapping + no CSS transition on marker).
 */

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
  modelPath: 'sprites/3d-models/cop-car.glb',

  // loop
  animationFrameId: null,
  isInitialized: false,

  // init/resize guards
  _initPromise: null,
  _pendingInitObserver: null,
  _pendingInitRAF: null,
  _resizeObserver: null,

  // pose state
  _lastWorldPos: null,
  _currentYaw: 0,
  _targetYaw: 0,
  _currentRoll: 0,
  _hasValidPose: false,

  // dt
  _lastTickTime: 0,

  // ray
  _raycaster: null,
  _groundPlane: null,

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

  config: {
    camera: {
      fov: 45,
      near: 0.1,
      far: 1500,
      position: { x: 0, y: 55, z: 35 },
      lookAt: { x: 0, y: 0, z: 0 }
    },

    // dt-based smoothing strengths (higher = tighter)
    positionLerpStrength: 18,
    yawLerpStrength: 14,
    rollLerpStrength: 10,

    // If your GLB forward axis differs, adjust this (radians)
    modelYawOffset: 0,

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
   */
  init() {
    // Fast path: already initialized
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
      layer.style.zIndex = '6';
      layer.style.transformOrigin = '0 0';
      this.container.appendChild(layer);
    }

    this.layer = layer;

    // Ensure parent is positioned so our absolute layer sizes correctly
    try {
      const pos = getComputedStyle(this.container).position;
      if (!pos || pos === 'static') this.container.style.position = 'relative';
    } catch (e) {}

    this._syncLayerTransform();
  },

  _syncLayerTransform() {
    if (!this.layer) return;
    const world = this.mapWorldEl || document.getElementById('map-world');
    if (!world) return;

    // Mirror the exact transform so the 3D overlay follows pan/zoom 1:1
    // but without being nested inside the transformed element.
    const tf = world.style.transform || getComputedStyle(world).transform || '';
    this.layer.style.transform = (tf && tf !== 'none') ? tf : '';

    // Match the untransformed (base) world size.
    const w = world.offsetWidth || 0;
    const h = world.offsetHeight || 0;
    if (w > 0 && h > 0) {
      this.layer.style.width = `${w}px`;
      this.layer.style.height = `${h}px`;
    }
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

    this.scene = new THREE.Scene();

    // Orthographic camera in "percent space" (0..100) so the 3D car aligns with
    // the 2D marker which is positioned using % left/top.
    // The layer mirrors #map-world's CSS transform (pan/zoom), keeping alignment
    // correct without nesting the canvas inside the transformed element.
    this.camera = new THREE.OrthographicCamera(0, 100, 100, 0, 0.1, 500);
    this.camera.up.set(0, 0, -1); // Set up vector to -Z before lookAt (avoids gimbal lock when looking down Y)
    this.camera.position.set(50, 120, 50);
    this.camera.lookAt(50, 0, 50);

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
    this.canvas.style.zIndex = '6';

    // Ensure parent is positioned
    try {
      const pos = getComputedStyle(this.container).position;
      if (!pos || pos === 'static') this.container.style.position = 'relative';
    } catch (e) {}

    this._ensureLayer();
    if (this.layer) this.layer.appendChild(this.canvas);
    this._syncLayerTransform();

    this._raycaster = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._setupLighting();
    this._ensureSmokeSystem();
    await this._loadModel();

    this._setupResizeHandler();
    this._startLoop();

    this.isInitialized = true;
    console.log('[CopCar3D] Ready');
  },

  _setupLighting() {
    this.lights.ambient = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(this.lights.ambient);

    this.lights.hemi = new THREE.HemisphereLight(0xffffff, 0x2a2a2a, 0.65);
    this.lights.hemi.position.set(0, 100, 0);
    this.scene.add(this.lights.hemi);

    this.lights.directional = new THREE.DirectionalLight(0xffffff, 1.05);
    this.lights.directional.position.set(18, 35, 14);

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

    const red = new THREE.PointLight(0xff0000, 0, 8);
    red.position.set(-0.35, 1.1, 0.05);
    const blue = new THREE.PointLight(0x0000ff, 0, 8);
    blue.position.set(0.35, 1.1, 0.05);

    this.lights.police = [red, blue];
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

  async _loadModel() {
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
          visual.name = 'CopCarVisual';

          // Scale the model to be visible in the 100-unit coordinate space.
          // A typical car model is ~4-5 units long, so scale 2.0 makes it ~8-10 units
          // which is about 8-10% of the map width - reasonably visible.
          visual.scale.set(2.0, 2.0, 2.0);

          // Recenter pivot to bounds center, put wheels on ground (y=0)
          try {
            const box = new THREE.Box3().setFromObject(visual);
            const center = new THREE.Vector3();
            box.getCenter(center);
            const minY = box.min.y;
            visual.position.set(-center.x, -minY, -center.z);
          } catch (e) {
            // fallback: no recenter
          }

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
          this.lights.police.forEach((l) => pivot.add(l));

          pivot.add(visual);

          // Set base ride height (slightly above plane)
          pivot.position.y = 0.15;

          this.model = pivot;
          this.modelVisual = visual;

          // Cache wheels + exhaust anchor
          this._cacheModelParts();

          this.scene.add(this.model);
          this.modelLoaded = true;

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
    this.scene.add(this.model);
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

    // Try a few naming patterns
    const patterns = [
      /wheelsport_(fl|fr|rl|rr)/i,
      /wheel[_-]?(front|rear)?[_-]?(left|right)|wheel[_-]?(fl|fr|rl|rr)/i,
      /(fl|fr|rl|rr).*wheel/i
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

  /**
   * Center point of the marker in container pixel space.
   */
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

    // Keep our overlay layer locked to the current map transform.
    this._syncLayerTransform();

    this._updatePoliceLights();

    if (!this.modelLoaded || !this.model || !this.camera || !this._raycaster) {
      this._updateSmoke(dt, 0);
      return;
    }

    // Keep marker in marker-mode even if other systems touch it
    this._prepareMarkerElement();

    // Prefer authoritative CopCarSystem percent-coordinates.
    // This makes the 3D car movement independent from DOM transforms and prevents zoom-induced spin.
    let targetWorld = null;
    let hasCopSystemPos = false;

    const cs = (typeof window !== 'undefined') ? window.CopCarSystem : null;
    if (!cs || !cs.position) {
      this._updateSmoke(dt, 0);
      return;
    }

    const px = Number(cs.position.x);
    const py = Number(cs.position.y);
    if (!isFinite(px) || !isFinite(py)) {
      this._updateSmoke(dt, 0);
      return;
    }

    targetWorld = new THREE.Vector3(px, 0, py); // x=percentX, z=percentY
    hasCopSystemPos = true;

    this._hasValidPose = true;

    // Determine cop speed from system (for stop snapping + smoke) if available
    const copSpeed = (cs && typeof cs.speed === 'number')
      ? cs.speed
      : 0;

    // Always keep ride height
    targetWorld.y = this.model.position.y;

    // dt-based smoothing (stable across FPS)
    let posAlpha = 1 - Math.pow(0.001, dt * this.config.positionLerpStrength);
    const yawAlpha = 1 - Math.pow(0.001, dt * this.config.yawLerpStrength);
    const rollAlpha = 1 - Math.pow(0.001, dt * this.config.rollLerpStrength);

    // Snap when stopped to avoid micro-glide at intersections
    if (copSpeed <= this.config.stopSnapSpeed) posAlpha = 1;

    const prevPos = this.model.position.clone();

    if (!this._lastWorldPos) {
      this.model.position.copy(targetWorld);
      this._lastWorldPos = this.model.position.clone();
    } else {
      this.model.position.lerp(targetWorld, posAlpha);
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

    if (hasCopSystemPos && cs && typeof cs.heading === 'number' && isFinite(cs.heading)) {
      // CopCarSystem.heading is atan2(dx, dy) measured counter-clockwise from +Y (down on map).
      // Three.js rotation.y rotates counter-clockwise when viewed from above.
      // We negate the heading to convert to clockwise rotation for proper road alignment.
      desiredYaw = -cs.heading + this.config.modelYawOffset;
    } else if (mv > 0.0002) {
      desiredYaw = -Math.atan2(moveVec.x, moveVec.z) + this.config.modelYawOffset;
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
    if (!window.GameState || typeof GameState.player === 'undefined') return;

    const heat = GameState.player.heat || 0;

    if (heat > 50) {
      this.policeLightsActive = true;
      this.policeLightTime += 0.1;

      const phase = Math.sin(this.policeLightTime * 10);
      if (this.lights.police[0]) this.lights.police[0].intensity = phase > 0 ? 2.2 : 0;
      if (this.lights.police[1]) this.lights.police[1].intensity = phase > 0 ? 0 : 2.2;

      const mult = heat > 80 ? 1.45 : 1;
      if (this.lights.police[0]) this.lights.police[0].intensity *= mult;
      if (this.lights.police[1]) this.lights.police[1].intensity *= mult;
    } else {
      this.policeLightsActive = false;
      if (this.lights.police[0]) this.lights.police[0].intensity = 0;
      if (this.lights.police[1]) this.lights.police[1].intensity = 0;
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

    // Keep the frustum at fixed 100x100 units to match the map's percent coordinate system.
    // Any aspect ratio distortion matches the 2D map distortion via CSS.
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.config.maxPixelRatio));
    this.renderer.setSize(width, height, false);
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
    } catch (e) {
      console.warn('[CopCar3D] Dispose error:', e);
    }
  }
};

// Expose globally
window.CopCar3D = CopCar3D;
