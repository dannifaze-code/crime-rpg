/**
 * 3D Cop Car Module
 * Three.js-based 3D cop car overlay for the turf map.
 *
 * Fixes:
 * - Prevents the 2D cop from fading out unless the 3D cop is confirmed visible.
 * - Anchors the 3D cop to the *map* by sampling the 2D cop element's on-screen
 *   position (which already includes TurfTab pan/zoom transforms), then raycasting
 *   from the 3D camera to a ground plane. This eliminates "sliding".
 * - Improves model clarity (sRGB output, ACES tone mapping, anisotropy).
 */

const CopCar3D = {
  scene: null,
  camera: null,
  renderer: null,
  canvas: null,
  container: null, // #city-map (stable viewport-sized container)
  copCarElement: null, // #cop-car (2D marker used as truth for screen position)

  model: null,
  modelLoaded: false,
  modelPath: 'sprites/3d-models/cop-car.glb',

  animationFrameId: null,
  isInitialized: false,

  // Pose smoothing
  _lastWorldPos: null,
  _currentYaw: 0,
  _targetYaw: 0,
  _emojiHidden: false,
  _hasValidPose: false,

  // Ray helpers
  _raycaster: null,
  _groundPlane: null,

  // Police lights
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
    positionDamping: 0.22,
    yawDamping: 0.18,
    modelYawOffset: 0, // adjust if your GLB forward axis differs
    shadowsEnabled: true,
    maxPixelRatio: 3
  },

  async init() {
    console.log('[CopCar3D] Initializing...');

    if (typeof THREE === 'undefined') {
      console.error('[CopCar3D] THREE.js not loaded');
      return false;
    }
    if (!THREE.GLTFLoader) {
      console.error('[CopCar3D] GLTFLoader not loaded');
      return false;
    }

    this.container = document.getElementById('city-map');
    if (!this.container) {
      console.error('[CopCar3D] #city-map not found');
      return false;
    }

    this.copCarElement = document.getElementById('cop-car');
    if (!this.copCarElement) {
      console.warn('[CopCar3D] #cop-car not found (2D fallback marker missing)');
    }

    const rect = this.container.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      console.warn('[CopCar3D] #city-map has zero size - waiting for layout...');
      this._waitForDimensions();
      return false;
    }

    await this._initScene(rect.width, rect.height);
    return true;
  },

  _waitForDimensions() {
    if (this._pendingInitObserver || typeof ResizeObserver === 'undefined') return;

    this._pendingInitObserver = new ResizeObserver(() => {
      const rect = this.container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this._pendingInitObserver.disconnect();
        this._pendingInitObserver = null;
        this.init();
      }
    });

    this._pendingInitObserver.observe(this.container);
  },

  async _initScene(width, height) {
    console.log('[CopCar3D] Scene setup:', width, 'x', height);

    this.scene = new THREE.Scene();

    const aspect = width / height;
    const camCfg = this.config.camera;
    this.camera = new THREE.PerspectiveCamera(camCfg.fov, aspect, camCfg.near, camCfg.far);
    this.camera.position.set(camCfg.position.x, camCfg.position.y, camCfg.position.z);
    this.camera.lookAt(camCfg.lookAt.x, camCfg.lookAt.y, camCfg.lookAt.z);

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.config.maxPixelRatio));
    this.renderer.setSize(width, height, false);

    // Color correctness + punchier detail (fixes "muddy" / "black" looking textures)
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
    this.canvas.style.zIndex = '6'; // above map-entities, below global UI

    // Ensure parent is positioned
    try {
      const pos = getComputedStyle(this.container).position;
      if (!pos || pos === 'static') this.container.style.position = 'relative';
    } catch (e) {}

    this.container.appendChild(this.canvas);

    this._raycaster = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._setupLighting();
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

  async _loadModel() {
    console.log('[CopCar3D] Loading:', this.modelPath);

    return new Promise((resolve, reject) => {
      const loader = new THREE.GLTFLoader();
      loader.load(
        this.modelPath,
        (gltf) => {
          this.model = gltf.scene;
          this.model.scale.set(0.5, 0.5, 0.5);
          this.model.position.y = 0.15;

          const maxAniso = this.renderer?.capabilities?.getMaxAnisotropy?.() || 1;

          this.model.traverse((child) => {
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

          // Attach police lights
          this.lights.police.forEach((l) => this.model.add(l));

          this.scene.add(this.model);
          this.modelLoaded = true;

          console.log('[CopCar3D] Model loaded');
          resolve();
        },
        undefined,
        (err) => {
          console.error('[CopCar3D] Model load failed:', err);
          // Keep 2D visible on failure
          this._showEmojiCopCar();
          reject(err);
        }
      );
    });
  },

  _startLoop() {
    const tick = () => {
      this.animationFrameId = requestAnimationFrame(tick);
      try {
        this._update();
        this.renderer.render(this.scene, this.camera);
      } catch (e) {
        console.error('[CopCar3D] Render error:', e);
        this._showEmojiCopCar();
      }
    };
    tick();
  },

  /**
   * Use the on-screen position of the 2D cop element (#cop-car) as ground truth.
   * This automatically includes pan/zoom transforms applied to #map-world.
   */
  _getCopScreenPoint() {
    if (!this.copCarElement || !this.container) return null;

    const copRect = this.copCarElement.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();

    const cx = (copRect.left + copRect.right) * 0.5 - containerRect.left;
    const cy = (copRect.top + copRect.bottom) * 0.5 - containerRect.top;

    if (!isFinite(cx) || !isFinite(cy)) return null;
    if (containerRect.width <= 0 || containerRect.height <= 0) return null;

    return { x: cx, y: cy, w: containerRect.width, h: containerRect.height };
  },

  _screenToGroundWorld(screenPt) {
    const ndcX = (screenPt.x / screenPt.w) * 2 - 1;
    const ndcY = -((screenPt.y / screenPt.h) * 2 - 1);

    this._raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    const hit = new THREE.Vector3();
    const ok = this._raycaster.ray.intersectPlane(this._groundPlane, hit);
    return ok ? hit : null;
  },

  _update() {
    if (!this.modelLoaded || !this.model || !this.camera) {
      this._updatePoliceLights();
      return;
    }

    const screenPt = this._getCopScreenPoint();
    if (!screenPt) {
      this._updatePoliceLights();
      return;
    }

    const targetWorld = this._screenToGroundWorld(screenPt);
    if (!targetWorld) {
      this._updatePoliceLights();
      return;
    }

    this._hasValidPose = true;

    targetWorld.y = this.model.position.y;

    if (!this._lastWorldPos) {
      this.model.position.copy(targetWorld);
      this._lastWorldPos = this.model.position.clone();
    } else {
      this.model.position.lerp(targetWorld, this.config.positionDamping);
    }

    // Rotation: prefer CopCarSystem.heading if present; fallback to movement delta
    let desiredYaw = null;
    if (typeof CopCarSystem !== 'undefined' && CopCarSystem && typeof CopCarSystem.heading === 'number') {
      desiredYaw = CopCarSystem.heading + this.config.modelYawOffset;
    } else {
      const dx = this.model.position.x - this._lastWorldPos.x;
      const dz = this.model.position.z - this._lastWorldPos.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.0005) desiredYaw = Math.atan2(dx, dz) + this.config.modelYawOffset;
    }

    if (desiredYaw != null) {
      this._targetYaw = desiredYaw;

      let diff = this._targetYaw - this._currentYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      this._currentYaw += diff * this.config.yawDamping;
      this.model.rotation.y = this._currentYaw;
    }

    this._lastWorldPos.copy(this.model.position);

    // Hide emoji ONLY after we have a confirmed valid 3D pose
    if (!this._emojiHidden) this._hideEmojiCopCarInstant();

    this._updatePoliceLights();
  },

  _hideEmojiCopCarInstant() {
    if (!this.copCarElement || this._emojiHidden) return;

    // Disable the CSS transition so we don't see a "fade out" artifact.
    this.copCarElement.style.transition = 'none';
    this.copCarElement.style.opacity = '0';
    this.copCarElement.style.pointerEvents = 'none';
    this.copCarElement.style.filter = 'none';

    this._emojiHidden = true;
    console.log('[CopCar3D] Emoji cop hidden (instant)');
  },

  _showEmojiCopCar() {
    const el = document.getElementById('cop-car');
    if (!el) return;

    el.style.opacity = '1';
    el.style.pointerEvents = 'none';
    // leave transition alone; visibility recovery is more important
    this._emojiHidden = false;
  },

  _updatePoliceLights() {
    if (!window.GameState || typeof GameState.player === 'undefined') return;

    const heat = GameState.player.heat || 0;

    if (heat > 50) {
      this.policeLightsActive = true;
      this.policeLightTime += 0.1;

      const phase = Math.sin(this.policeLightTime * 10);
      this.lights.police[0].intensity = phase > 0 ? 2.2 : 0;
      this.lights.police[1].intensity = phase > 0 ? 0 : 2.2;

      const mult = heat > 80 ? 1.45 : 1;
      this.lights.police[0].intensity *= mult;
      this.lights.police[1].intensity *= mult;
    } else {
      this.policeLightsActive = false;
      if (this.lights.police[0]) this.lights.police[0].intensity = 0;
      if (this.lights.police[1]) this.lights.police[1].intensity = 0;
    }
  },

  _setupResizeHandler() {
    if (!this.container || typeof ResizeObserver === 'undefined') return;

    this._resizeObserver = new ResizeObserver(() => {
      const rect = this.container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) this._handleResize(rect.width, rect.height);
    });

    this._resizeObserver.observe(this.container);
  },

  _handleResize(width, height) {
    if (!this.camera || !this.renderer) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.config.maxPixelRatio));
    this.renderer.setSize(width, height, false);
  },

  dispose() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this._resizeObserver) {
      try { this._resizeObserver.disconnect(); } catch (e) {}
      this._resizeObserver = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this._showEmojiCopCar();
    this.isInitialized = false;
  }
};

// Expose globally
window.CopCar3D = CopCar3D;
