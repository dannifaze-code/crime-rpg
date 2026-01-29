/**
 * 3D Cop Car Module
 * Three.js-based 3D cop car overlay for the turf map.
 *
 * Goals:
 * - Anchor the 3D canvas to #map-world (so it pans/zooms with the map).
 * - Keep the cop car aligned to CopCarSystem.position (% coords) without "sliding".
 * - Rotate the car along its movement direction.
 * - Use proper lighting + sRGB output so the GLB is not black.
 * - Optional shadow receiver plane (toggle via config).
 *
 * Dependencies (from global scope):
 * - THREE: Three.js library (loaded via CDN)
 * - THREE.GLTFLoader: Three.js GLTF loader
 * - CopCarSystem: Existing cop car patrol logic
 * - GameState: heat value for police light flashing
 */

const CopCar3D = {
  // Core Three.js components
  scene: null,
  camera: null,
  renderer: null,
  animationFrameId: null,
  container: null, // #map-world
  canvas: null,
  isInitialized: false,

  // 3D Model
  model: null,
  modelLoaded: false,
  modelPath: 'sprites/3d-models/cop-car.glb',

  // Motion smoothing
  _lastWorldPos: null,
  _currentYaw: 0,
  _targetYaw: 0,

  // Ray / plane for screen->world anchoring
  _raycaster: null,
  _groundPlane: null,
  _tmpVec3: null,

  // Ground shadow receiver
  groundShadowMesh: null,

  // Lighting
  lights: {
    ambient: null,
    hemi: null,
    directional: null,
    police: [] // Red/blue flashing lights
  },

  // Police light animation
  policeLightsActive: false,
  policeLightTime: 0,

  // Config knobs (tweak if needed)
  config: {
    // Camera tuned to match your TurfMap.png "isometric-ish" look.
    camera: {
      fov: 45,
      near: 0.1,
      far: 2000,
      position: { x: 0, y: 55, z: 35 },
      lookAt: { x: 0, y: 0, z: 0 }
    },

    // Damping for position/yaw (higher = snappier)
    positionDamping: 0.22,
    yawDamping: 0.18,

    // Model yaw offset (depends on how your GLB faces forward).
    // If the car drives sideways/backwards, adjust by +/- Math.PI/2 or Math.PI.
    modelYawOffset: 0,

    // Shadows
    shadowsEnabled: true,
    shadowReceiverOpacity: 0.28
  },

  /**
   * Initialize 3D cop car overlay.
   */
  async init() {
    console.log('[CopCar3D] Initializing 3D cop car overlay...');

    if (typeof THREE === 'undefined') {
      console.error('[CopCar3D] THREE.js not loaded!');
      return false;
    }

    // Anchor to map-world so we inherit TurfTab pan/zoom transforms.
    this.container = document.getElementById('map-world');
    if (!this.container) {
      console.error('[CopCar3D] Container #map-world not found!');
      return false;
    }

    const { width, height } = this._getContainerSize();
    if (!width || !height) {
      console.warn('[CopCar3D] #map-world has zero dimensions - waiting...');
      this._waitForDimensions();
      return false;
    }

    await this._initScene(width, height);
    return true;
  },

  _getContainerSize() {
    const w = this.container?.offsetWidth || 0;
    const h = this.container?.offsetHeight || 0;
    return { width: w, height: h };
  },

  /**
   * Wait for container to have valid dimensions.
   */
  _waitForDimensions() {
    if (this._pendingInitObserver || !this.container) return;

    if (typeof ResizeObserver !== 'undefined') {
      this._pendingInitObserver = new ResizeObserver(() => {
        const { width, height } = this._getContainerSize();
        if (width > 0 && height > 0) {
          this._pendingInitObserver.disconnect();
          this._pendingInitObserver = null;
          this.init();
        }
      });
      this._pendingInitObserver.observe(this.container);
    } else {
      // Fallback: retry soon
      setTimeout(() => this.init(), 250);
    }
  },

  /**
   * Initialize Three.js scene.
   */
  async _initScene(width, height) {
    console.log('[CopCar3D] Setting up scene:', width, 'x', height);

    this.scene = new THREE.Scene();

    // Camera (perspective with tilt to match the map look)
    const aspect = width / height;
    const camCfg = this.config.camera;
    this.camera = new THREE.PerspectiveCamera(camCfg.fov, aspect, camCfg.near, camCfg.far);
    this.camera.position.set(camCfg.position.x, camCfg.position.y, camCfg.position.z);
    this.camera.lookAt(camCfg.lookAt.x, camCfg.lookAt.y, camCfg.lookAt.z);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: false
    });

    // r128: use outputEncoding (not outputColorSpace)
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);

    // Shadows (optional)
    this.renderer.shadowMap.enabled = !!this.config.shadowsEnabled;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Canvas styling (must be inside #map-world)
    this.canvas = this.renderer.domElement;
    this.canvas.id = 'cop-car-3d-canvas';
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '3'; // Above background/entities, below global UI

    // Ensure parent is positioned for absolute child
    try {
      const pos = getComputedStyle(this.container).position;
      if (!pos || pos === 'static') this.container.style.position = 'relative';
    } catch (e) {}

    // Attach to #map-world (critical fix: prevents "sliding" during pan/zoom)
    this.container.appendChild(this.canvas);

    // Helpers
    this._raycaster = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // y = 0
    this._tmpVec3 = new THREE.Vector3();

    // Lighting + optional shadow plane
    this._setupLighting();
    this._setupShadowReceiver();

    // Load model
    await this._loadModel();

    // Keep the emoji cop car in DOM for fallback, but make it invisible (do NOT display:none)
    this._hideEmojiCopCar();

    // Start loop
    this._startRenderLoop();

    // Resize: observe #map-world (not #city-map)
    this._setupResizeHandler();

    this.isInitialized = true;
    console.log('[CopCar3D] Initialization complete!');
  },

  /**
   * Setup scene lighting (stronger + more natural so the GLB doesn't render black).
   */
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
      this.lights.directional.shadow.mapSize.width = 1024;
      this.lights.directional.shadow.mapSize.height = 1024;
      this.lights.directional.shadow.camera.near = 0.5;
      this.lights.directional.shadow.camera.far = 200;
      this.lights.directional.shadow.camera.left = -80;
      this.lights.directional.shadow.camera.right = 80;
      this.lights.directional.shadow.camera.top = 80;
      this.lights.directional.shadow.camera.bottom = -80;
      this.lights.directional.shadow.bias = -0.00025;
    }

    this.scene.add(this.lights.directional);

    // Police lights (red/blue)
    const redLight = new THREE.PointLight(0xff0000, 0, 8);
    redLight.position.set(-0.35, 1.1, 0.05);
    this.lights.police.push(redLight);

    const blueLight = new THREE.PointLight(0x0000ff, 0, 8);
    blueLight.position.set(0.35, 1.1, 0.05);
    this.lights.police.push(blueLight);
  },

  /**
   * Optional shadow receiver plane (transparent except for shadows).
   */
  _setupShadowReceiver() {
    if (!this.config.shadowsEnabled) return;

    // Large plane under the car; doesn't need to match the map bounds precisely.
    const geom = new THREE.PlaneGeometry(500, 500);
    const mat = new THREE.ShadowMaterial({ opacity: this.config.shadowReceiverOpacity });
    const plane = new THREE.Mesh(geom, mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0;
    plane.receiveShadow = true;
    plane.renderOrder = 0;
    this.groundShadowMesh = plane;
    this.scene.add(plane);
  },

  /**
   * Load the GLB model.
   */
  async _loadModel() {
    console.log('[CopCar3D] Loading model:', this.modelPath);

    return new Promise((resolve, reject) => {
      if (!THREE.GLTFLoader) {
        console.error('[CopCar3D] GLTFLoader not available!');
        reject(new Error('GLTFLoader not loaded'));
        return;
      }

      const loader = new THREE.GLTFLoader();

      loader.load(
        this.modelPath,
        (gltf) => {
          console.log('[CopCar3D] Model loaded successfully!');

          this.model = gltf.scene;

          // Scale model appropriately (size already looks good per your note).
          this.model.scale.set(0.5, 0.5, 0.5);

          // Ensure materials/textures display correctly (avoid "all black" look).
          this.model.traverse((child) => {
            if (!child.isMesh) return;

            child.castShadow = !!this.config.shadowsEnabled;
            child.receiveShadow = !!this.config.shadowsEnabled;

            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((mat) => {
              if (!mat) return;

              // r128: enforce correct color space for albedo maps.
              if (mat.map) {
                mat.map.encoding = THREE.sRGBEncoding;
                mat.map.needsUpdate = true;
              }
              if (mat.emissiveMap) {
                mat.emissiveMap.encoding = THREE.sRGBEncoding;
                mat.emissiveMap.needsUpdate = true;
              }

              // Mildly boost readability on mobile (without "cartoon" look).
              if (typeof mat.roughness === 'number') mat.roughness = Math.min(1, Math.max(0.2, mat.roughness));
              if (typeof mat.metalness === 'number') mat.metalness = Math.min(1, Math.max(0.0, mat.metalness));

              mat.needsUpdate = true;
            });
          });

          // Attach police lights to the model
          this.lights.police.forEach((light) => this.model.add(light));

          // Slightly lift above plane to avoid z-fighting with shadow receiver
          this.model.position.y = 0.15;

          this.scene.add(this.model);

          this.modelLoaded = true;
          resolve();
        },
        (progress) => {
          if (!progress.total) return;
          const percent = ((progress.loaded / progress.total) * 100).toFixed(1);
          console.log(`[CopCar3D] Loading: ${percent}%`);
        },
        (error) => {
          console.error('[CopCar3D] Failed to load model:', error);
          reject(error);
        }
      );
    });
  },

  /**
   * Hide the emoji cop car element without removing it from layout.
   */
  _hideEmojiCopCar() {
    const emojiCopCar = document.getElementById('cop-car');
    if (!emojiCopCar) return;

    emojiCopCar.style.opacity = '0';
    emojiCopCar.style.pointerEvents = 'none';
    emojiCopCar.style.filter = 'none';
    console.log('[CopCar3D] Emoji cop car hidden (opacity=0)');
  },

  /**
   * Start the render loop.
   */
  _startRenderLoop() {
    const animate = () => {
      this.animationFrameId = requestAnimationFrame(animate);
      this._update();
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  },

  /**
   * Convert a map % position into an NDC ray intersection on the ground plane.
   * This guarantees the 3D car is anchored to the same screen-space position
   * as the 2D map coordinates, even with a tilted camera.
   */
  _screenPointToGroundWorld(posPercent) {
    const w = this.canvas?.width || 0;
    const h = this.canvas?.height || 0;
    if (!w || !h) return null;

    const px = (posPercent.x / 100) * w;
    const py = (posPercent.y / 100) * h;

    const ndcX = (px / w) * 2 - 1;
    const ndcY = -((py / h) * 2 - 1);

    this._raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    const hit = new THREE.Vector3();
    const ok = this._raycaster.ray.intersectPlane(this._groundPlane, hit);
    return ok ? hit : null;
  },

  /**
   * Update 3D cop car position and rotation.
   */
  _update() {
    if (!this.model || !this.modelLoaded || !this.camera || !this.renderer) return;

    // Get latest position from CopCarSystem
    const sys = (typeof CopCarSystem !== 'undefined') ? CopCarSystem : null;
    if (!sys || !sys.position) {
      this._updatePoliceLights();
      return;
    }

    const targetWorld = this._screenPointToGroundWorld(sys.position);
    if (targetWorld) {
      // Smooth position
      const damping = this.config.positionDamping;
      this._tmpVec3.copy(targetWorld);
      this._tmpVec3.y = this.model.position.y; // keep model lifted

      // Initialize at first valid position to avoid a startup "teleport"
      if (!this._lastWorldPos) {
        this.model.position.copy(this._tmpVec3);
        this._lastWorldPos = this.model.position.clone();
      } else {
        this.model.position.lerp(this._tmpVec3, damping);
      }

      // Rotation: follow movement direction in ground plane
      const dx = this.model.position.x - this._lastWorldPos.x;
      const dz = this.model.position.z - this._lastWorldPos.z;

      if (Math.abs(dx) + Math.abs(dz) > 0.0005) {
        this._targetYaw = Math.atan2(dx, dz) + this.config.modelYawOffset;
      }

      // Smooth yaw (shortest-arc)
      let diff = this._targetYaw - this._currentYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this._currentYaw += diff * this.config.yawDamping;

      this.model.rotation.y = this._currentYaw;

      // Update last for next tick
      this._lastWorldPos.copy(this.model.position);
    }

    this._updatePoliceLights();
  },

  /**
   * Update police light flashing based on heat level.
   */
  _updatePoliceLights() {
    if (!window.GameState || typeof GameState.player === 'undefined') return;

    const heat = GameState.player.heat || 0;

    // Only flash lights when heat > 50
    if (heat > 50) {
      this.policeLightsActive = true;
      this.policeLightTime += 0.1;

      const flashPhase = Math.sin(this.policeLightTime * 10);

      this.lights.police[0].intensity = flashPhase > 0 ? 2.2 : 0;
      this.lights.police[1].intensity = flashPhase > 0 ? 0 : 2.2;

      const intensityMultiplier = heat > 80 ? 1.45 : 1;
      this.lights.police[0].intensity *= intensityMultiplier;
      this.lights.police[1].intensity *= intensityMultiplier;
    } else {
      this.policeLightsActive = false;
      if (this.lights.police[0]) this.lights.police[0].intensity = 0;
      if (this.lights.police[1]) this.lights.police[1].intensity = 0;
    }
  },

  /**
   * Observe #map-world for size changes (map load, orientation change, etc.).
   */
  _setupResizeHandler() {
    if (!this.container || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(() => {
      const { width, height } = this._getContainerSize();
      if (width > 0 && height > 0) this._handleResize(width, height);
    });
    ro.observe(this.container);
    this._resizeObserver = ro;
  },

  _handleResize(width, height) {
    if (!this.camera || !this.renderer) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  },

  /**
   * Cleanup resources.
   */
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

    // Restore emoji cop car
    const emojiCopCar = document.getElementById('cop-car');
    if (emojiCopCar) {
      emojiCopCar.style.opacity = '';
      emojiCopCar.style.pointerEvents = '';
    }

    this.isInitialized = false;
    console.log('[CopCar3D] Disposed');
  }
};

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CopCar3D;
}
