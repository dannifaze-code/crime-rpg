/**
 * 3D Enemy Renderer Module
 * Renders GLB enemy models in the battle scene and provides snapshots for 2D contexts.
 *
 * Uses Three.js + GLTFLoader (already loaded globally for CopCar3D).
 *
 * Usage:
 *   Enemy3DRenderer.renderInBattle(containerId, glbPath)  — shows a 3D enemy facing the player in the battle scene
 *   Enemy3DRenderer.dispose()                              — cleans up the current scene
 *   Enemy3DRenderer.preloadBattleModels()                  — preloads all enemy GLBs for instant battle rendering
 */

// Shared rendering constants
var ENEMY_3D_CAM_POS = { x: 0, y: 1.2, z: 3.5 };
var ENEMY_3D_CAM_TARGET = { x: 0, y: 0.8, z: 0 };
var ENEMY_3D_TARGET_HEIGHT = 2.0;
var ENEMY_3D_CAM_FOV = 40;

const Enemy3DRenderer = {
  // Three.js objects for the battle scene inline renderer
  scene: null,
  camera: null,
  renderer: null,
  canvas: null,
  model: null,
  animationFrameId: null,
  mixer: null,       // THREE.AnimationMixer for GLB animations
  clock: null,
  _idleTime: 0,      // elapsed time for idle animation

  // Current state
  currentModelPath: null,
  isInitialized: false,

  // GLB model cache for instant battle loading
  _modelCache: {},        // { glbPath: gltf }
  _modelCacheLoading: false,

  /**
   * Preload all enemy GLB models into memory for instant battle rendering.
   * Call once at game startup so battles load instantly.
   */
  preloadBattleModels: function() {
    if (this._modelCacheLoading) return;
    if (typeof THREE === 'undefined' || !THREE.GLTFLoader) return;
    if (typeof ENEMY_SPRITES === 'undefined' || typeof ENEMY_SPRITE_IDS === 'undefined') return;

    this._modelCacheLoading = true;
    var self = this;
    var loader = new THREE.GLTFLoader();
    var ids = ENEMY_SPRITE_IDS.slice();

    ids.forEach(function(enemyId) {
      var glbPath = ENEMY_SPRITES[enemyId];
      if (!glbPath || self._modelCache[glbPath]) return;

      loader.load(glbPath, function(gltf) {
        self._modelCache[glbPath] = gltf;
        console.log('[Enemy3D] Preloaded model:', glbPath);
      }, undefined, function(err) {
        console.warn('[Enemy3D] Preload failed:', glbPath, err);
      });
    });
  },

  /**
   * Render a 3D enemy model inside a given container element (battle scene).
   * Replaces any previous model. The container should be the enemy sprite area.
   *
   * @param {string|HTMLElement} container - DOM element or ID to mount the canvas in
   * @param {string} glbPath - path to the .glb file (e.g. 'sprites/Enemies/thug_batidle.glb')
   */
  renderInBattle(container, glbPath) {
    if (typeof container === 'string') {
      container = document.getElementById(container);
    }
    if (!container) {
      console.warn('[Enemy3D] Container not found');
      return;
    }

    // If same model already loaded, skip reload
    if (this.isInitialized && this.currentModelPath === glbPath && this.canvas && this.canvas.parentNode === container) {
      return;
    }

    // Clean up previous
    this.dispose();

    if (typeof THREE === 'undefined') {
      console.error('[Enemy3D] THREE.js not available');
      return;
    }
    if (!THREE.GLTFLoader) {
      console.error('[Enemy3D] GLTFLoader not available');
      return;
    }

    this.currentModelPath = glbPath;
    this.clock = new THREE.Clock();

    // Create WebGL renderer with transparent background
    const canvas = document.createElement('canvas');
    canvas.className = 'enemy-3d-canvas';
    // Size matches the container
    const w = container.offsetWidth || 180;
    const h = container.offsetHeight || 200;
    canvas.width = w * (window.devicePixelRatio || 1);
    canvas.height = h * (window.devicePixelRatio || 1);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    this.canvas = canvas;

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true,
        premultipliedAlpha: false
      });
      this.renderer.setPixelRatio(window.devicePixelRatio || 1);
      this.renderer.setSize(w, h);
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.2;
    } catch (e) {
      console.error('[Enemy3D] WebGL init failed:', e);
      return;
    }

    // Scene
    this.scene = new THREE.Scene();

    // Camera — perspective, looking at the model
    this.camera = new THREE.PerspectiveCamera(ENEMY_3D_CAM_FOV, w / h, 0.1, 100);
    this.camera.position.set(ENEMY_3D_CAM_POS.x, ENEMY_3D_CAM_POS.y, ENEMY_3D_CAM_POS.z);
    this.camera.lookAt(ENEMY_3D_CAM_TARGET.x, ENEMY_3D_CAM_TARGET.y, ENEMY_3D_CAM_TARGET.z);

    // Lighting — dramatic crime-game feel
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffe0c0, 1.2);
    keyLight.position.set(2, 3, 2);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8090ff, 0.4);
    fillLight.position.set(-2, 1, -1);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xff6040, 0.6);
    rimLight.position.set(0, 2, -3);
    this.scene.add(rimLight);

    // Append canvas to container
    container.appendChild(canvas);

    // Load model
    this._loadModel(glbPath);

    // Start render loop
    this._startLoop();
    this.isInitialized = true;

    console.log('[Enemy3D] Initialized with model:', glbPath);
  },

  /**
   * Load a GLB model into the scene. Uses preloaded cache if available.
   */
  _loadModel(glbPath) {
    const self = this;

    // Use cached model if available for instant loading
    var cachedGltf = this._modelCache[glbPath];
    if (cachedGltf) {
      this._setupModel(cachedGltf, glbPath);
      return;
    }

    // Fallback: load from network
    const loader = new THREE.GLTFLoader();

    loader.load(
      glbPath,
      function (gltf) {
        // Cache for future use
        self._modelCache[glbPath] = gltf;
        self._setupModel(gltf, glbPath);
      },
      undefined,
      function (err) {
        console.error('[Enemy3D] Model load failed:', glbPath, err);
      }
    );
  },

  /**
   * Setup a loaded GLTF model in the scene (shared by cached and network-loaded paths).
   */
  _setupModel(gltf, glbPath) {
    const self = this;
    const root = gltf.scene.clone(true);
    root.name = 'EnemyModel';

    // Auto-scale model to fit nicely in view
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Normalize to fit in view
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0.0001 ? ENEMY_3D_TARGET_HEIGHT / maxDim : 1;
    root.scale.setScalar(scale);

    // Re-center so model is grounded and centered
    box.setFromObject(root);
    box.getCenter(center);
    root.position.sub(center);
    // Recompute after centering
    box.setFromObject(root);
    root.position.y -= box.min.y; // Sit on ground plane (y=0)

    // Face toward the camera (player) — models face +Z by default, camera is at +Z
    root.rotation.y = 0;

    // Enhance materials for better rendering
    const maxAniso = self.renderer?.capabilities?.getMaxAnisotropy?.() || 1;
    root.traverse(function (child) {
      if (!child.isMesh) return;
      var mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(function (mat) {
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

    // Play animations if the GLB has them
    if (gltf.animations && gltf.animations.length > 0) {
      self.mixer = new THREE.AnimationMixer(root);
      gltf.animations.forEach(function (clip) {
        self.mixer.clipAction(clip).play();
      });
    }

    if (self.model && self.scene) {
      self.scene.remove(self.model);
    }
    self.model = root;
    self._idleTime = 0;
    self.scene.add(root);

    console.log('[Enemy3D] Model loaded:', glbPath, '| meshes:', root.children.length);
  },

  /**
   * Animation loop — renders the 3D enemy with a subtle idle animation (no rotation).
   */
  _startLoop() {
    var self = this;

    function animate() {
      self.animationFrameId = requestAnimationFrame(animate);

      if (!self.renderer || !self.scene || !self.camera) return;

      // Update animation mixer
      var delta = 0;
      if (self.clock) {
        delta = self.clock.getDelta();
      }
      if (self.mixer && delta > 0) {
        self.mixer.update(delta);
      }

      // Subtle idle animation — gentle breathing sway (no rotation)
      if (self.model) {
        self._idleTime += delta || 0.016;
        // Gentle vertical bob (breathing)
        var baseY = self.model.userData._baseY;
        if (baseY === undefined) {
          baseY = self.model.position.y;
          self.model.userData._baseY = baseY;
        }
        self.model.position.y = baseY + Math.sin(self._idleTime * 1.8) * 0.015;
        // Subtle side-to-side sway
        var baseX = self.model.userData._baseX;
        if (baseX === undefined) {
          baseX = self.model.position.x;
          self.model.userData._baseX = baseX;
        }
        self.model.position.x = baseX + Math.sin(self._idleTime * 1.1) * 0.008;
        // Subtle scale pulse (breathing effect)
        var baseScale = self.model.userData._baseScale;
        if (baseScale === undefined) {
          baseScale = self.model.scale.x;
          self.model.userData._baseScale = baseScale;
        }
        var breathScale = baseScale + Math.sin(self._idleTime * 2.0) * 0.005;
        self.model.scale.setScalar(breathScale);
      }

      self.renderer.render(self.scene, self.camera);
    }

    animate();
  },

  /**
   * Dispose all Three.js resources and DOM elements.
   */
  dispose() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }

    if (this.model && this.scene) {
      this.scene.remove(this.model);
      // Dispose geometries and materials
      this.model.traverse(function (child) {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          var mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(function (mat) {
            if (mat) {
              if (mat.map) mat.map.dispose();
              if (mat.normalMap) mat.normalMap.dispose();
              if (mat.roughnessMap) mat.roughnessMap.dispose();
              if (mat.metalnessMap) mat.metalnessMap.dispose();
              if (mat.emissiveMap) mat.emissiveMap.dispose();
              mat.dispose();
            }
          });
        }
      });
      this.model = null;
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
    this.clock = null;
    this.currentModelPath = null;
    this.isInitialized = false;
    this._idleTime = 0;
  },

  /**
   * Generate a 2D snapshot of the current 3D enemy for use in 2D contexts (turf defense).
   * Returns a data URL (PNG) or null if no model is loaded.
   */
  getSnapshot(width, height) {
    if (!this.renderer || !this.scene || !this.camera) return null;

    width = width || 64;
    height = height || 64;

    // Store logical dimensions for restoration
    var prevW = parseInt(this.canvas.style.width) || 180;
    var prevH = parseInt(this.canvas.style.height) || 200;

    // Temporarily resize for snapshot
    this.renderer.setSize(width, height);
    this.renderer.render(this.scene, this.camera);
    var dataUrl = this.canvas.toDataURL('image/png');

    // Restore original logical dimensions
    this.renderer.setSize(prevW, prevH);
    return dataUrl;
  },

  // ====== Turf Defense Sprite Cache ======
  // Pre-renders all enemy GLB models to Image objects for 2D canvas drawing

  _spriteCache: {},       // { enemyId: Image }
  _spriteCacheReady: false,
  _spriteCacheLoading: false,

  /**
   * Pre-render all enemy types to cached Image objects for turf defense canvas.
   * Call once at startup or when turf defense starts.
   */
  preloadEnemySprites: function() {
    if (this._spriteCacheReady || this._spriteCacheLoading) return;
    if (typeof THREE === 'undefined' || !THREE.GLTFLoader) return;
    if (typeof ENEMY_SPRITES === 'undefined' || typeof ENEMY_SPRITE_IDS === 'undefined') return;

    this._spriteCacheLoading = true;
    var self = this;
    var ids = ENEMY_SPRITE_IDS.slice();
    var loaded = 0;

    ids.forEach(function(enemyId) {
      var glbPath = ENEMY_SPRITES[enemyId];
      if (!glbPath) { loaded++; return; }

      self._renderOffscreen(glbPath, 64, 64, function(img) {
        if (img) {
          self._spriteCache[enemyId] = img;
        }
        loaded++;
        if (loaded >= ids.length) {
          self._spriteCacheReady = true;
          self._spriteCacheLoading = false;
          console.log('[Enemy3D] Sprite cache ready:', Object.keys(self._spriteCache).length, 'enemies');
        }
      });
    });
  },

  /**
   * Get a cached Image for a given enemy ID (for 2D canvas drawing).
   * Returns null if not yet loaded.
   */
  getCachedSprite: function(enemyId) {
    return this._spriteCache[enemyId] || null;
  },

  /**
   * Get any available cached enemy sprite (random pick for generic enemies).
   */
  getRandomCachedSprite: function() {
    var keys = Object.keys(this._spriteCache);
    if (keys.length === 0) return null;
    return this._spriteCache[keys[Math.floor(Math.random() * keys.length)]];
  },

  /**
   * Render a GLB model to an offscreen canvas and return as an Image via callback.
   */
  _renderOffscreen: function(glbPath, width, height, callback) {
    var offCanvas = document.createElement('canvas');
    offCanvas.width = width;
    offCanvas.height = height;

    var offRenderer;
    try {
      offRenderer = new THREE.WebGLRenderer({
        canvas: offCanvas,
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true
      });
      offRenderer.setSize(width, height);
      offRenderer.outputEncoding = THREE.sRGBEncoding;
    } catch (e) {
      console.warn('[Enemy3D] Offscreen renderer failed:', e);
      callback(null);
      return;
    }

    var offScene = new THREE.Scene();
    var offCamera = new THREE.PerspectiveCamera(ENEMY_3D_CAM_FOV, width / height, 0.1, 100);
    offCamera.position.set(ENEMY_3D_CAM_POS.x, ENEMY_3D_CAM_POS.y, ENEMY_3D_CAM_POS.z);
    offCamera.lookAt(ENEMY_3D_CAM_TARGET.x, ENEMY_3D_CAM_TARGET.y, ENEMY_3D_CAM_TARGET.z);

    // Lighting
    offScene.add(new THREE.AmbientLight(0xffffff, 0.6));
    var light = new THREE.DirectionalLight(0xffe0c0, 1.0);
    light.position.set(2, 3, 2);
    offScene.add(light);

    var loader = new THREE.GLTFLoader();
    loader.load(glbPath, function(gltf) {
      var root = gltf.scene;

      // Auto-scale
      var box = new THREE.Box3().setFromObject(root);
      var size = new THREE.Vector3();
      box.getSize(size);
      var center = new THREE.Vector3();
      box.getCenter(center);

      var maxDim = Math.max(size.x, size.y, size.z);
      var scale = maxDim > 0.0001 ? ENEMY_3D_TARGET_HEIGHT / maxDim : 1;
      root.scale.setScalar(scale);

      box.setFromObject(root);
      box.getCenter(center);
      root.position.sub(center);
      box.setFromObject(root);
      root.position.y -= box.min.y;

      offScene.add(root);
      offRenderer.render(offScene, offCamera);

      var dataUrl = offCanvas.toDataURL('image/png');
      var img = new Image();
      img.onload = function() {
        // Clean up offscreen renderer
        offRenderer.dispose();
        root.traverse(function(child) {
          if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            var mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(function(m) { if (m) m.dispose(); });
          }
        });
        callback(img);
      };
      img.onerror = function() {
        offRenderer.dispose();
        callback(null);
      };
      img.src = dataUrl;
    }, undefined, function(err) {
      console.warn('[Enemy3D] Offscreen load failed:', glbPath, err);
      offRenderer.dispose();
      callback(null);
    });
  }
};

// Make globally available
window.Enemy3DRenderer = Enemy3DRenderer;
