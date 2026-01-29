/**
 * 3D Cop Car Module
 * Three.js-based 3D cop car overlay for the turf map
 *
 * Dependencies (from global scope):
 * - THREE: Three.js library (loaded via CDN)
 * - GLTFLoader: Three.js GLTF loader
 * - CopCarSystem: Existing cop car patrol logic
 */

const CopCar3D = {
  // Core Three.js components
  scene: null,
  camera: null,
  renderer: null,
  animationFrameId: null,
  container: null,
  canvas: null,
  isInitialized: false,

  // 3D Model
  model: null,
  modelLoaded: false,
  modelPath: 'sprites/3d-models/cop-car.glb',

  // Position tracking for rotation calculation
  lastPosition: { x: 0, y: 0 },
  currentRotation: 0,
  targetRotation: 0,

  // Lighting
  lights: {
    ambient: null,
    directional: null,
    police: [] // Red/blue flashing lights
  },

  // Police light animation
  policeLightsActive: false,
  policeLightTime: 0,

  /**
   * Initialize 3D cop car overlay
   */
  async init() {
    console.log('[CopCar3D] Initializing 3D cop car overlay...');

    // Check if Three.js is available
    if (typeof THREE === 'undefined') {
      console.error('[CopCar3D] THREE.js not loaded!');
      return false;
    }

    // Get the turf map container
    this.container = document.getElementById('city-map');
    if (!this.container) {
      console.error('[CopCar3D] Container #city-map not found!');
      return false;
    }

    // Wait for valid dimensions
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      console.warn('[CopCar3D] Container has zero dimensions - waiting...');
      this._waitForDimensions();
      return false;
    }

    await this._initScene(rect.width, rect.height);
    return true;
  },

  /**
   * Wait for container to have valid dimensions
   */
  _waitForDimensions() {
    if (this._pendingInitObserver) return;

    if (typeof ResizeObserver !== 'undefined') {
      this._pendingInitObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            this._pendingInitObserver.disconnect();
            this._pendingInitObserver = null;
            this.init();
          }
        }
      });
      this._pendingInitObserver.observe(this.container);
    }
  },

  /**
   * Initialize Three.js scene
   */
  async _initScene(width, height) {
    console.log('[CopCar3D] Setting up scene:', width, 'x', height);

    // Create scene
    this.scene = new THREE.Scene();

    // Create camera - isometric-style perspective to match the TurfMap
    // Using perspective camera for better 3D look
    const aspect = width / height;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);

    // Position camera for isometric-ish top-down view
    // Adjust these values to match your TurfMap.png angle
    this.camera.position.set(0, 50, 30);
    this.camera.lookAt(0, 0, 0);

    // Create WebGL renderer with transparency
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: false
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit for mobile performance
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Style canvas
    this.canvas = this.renderer.domElement;
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '5'; // Above map background, below UI
    this.canvas.id = 'cop-car-3d-canvas';

    // Add canvas to container
    const mapViewport = document.getElementById('map-viewport');
    if (mapViewport) {
      mapViewport.appendChild(this.canvas);
    } else {
      this.container.appendChild(this.canvas);
    }

    // Setup lighting
    this._setupLighting();

    // Load 3D model
    await this._loadModel();

    // Hide the emoji cop car
    this._hideEmojiCopCar();

    // Start render loop
    this._startRenderLoop();

    // Handle resize
    this._setupResizeHandler();

    this.isInitialized = true;
    console.log('[CopCar3D] Initialization complete!');
  },

  /**
   * Setup scene lighting
   */
  _setupLighting() {
    // Ambient light for base visibility
    this.lights.ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.lights.ambient);

    // Directional light for shadows (sun-like)
    this.lights.directional = new THREE.DirectionalLight(0xffffff, 0.8);
    this.lights.directional.position.set(10, 20, 10);
    this.lights.directional.castShadow = true;
    this.lights.directional.shadow.mapSize.width = 512;
    this.lights.directional.shadow.mapSize.height = 512;
    this.lights.directional.shadow.camera.near = 0.5;
    this.lights.directional.shadow.camera.far = 50;
    this.scene.add(this.lights.directional);

    // Police lights (red and blue point lights)
    const redLight = new THREE.PointLight(0xff0000, 0, 5);
    redLight.position.set(-0.3, 1, 0);
    this.lights.police.push(redLight);

    const blueLight = new THREE.PointLight(0x0000ff, 0, 5);
    blueLight.position.set(0.3, 1, 0);
    this.lights.police.push(blueLight);
  },

  /**
   * Load the GLB model
   */
  async _loadModel() {
    console.log('[CopCar3D] Loading model:', this.modelPath);

    return new Promise((resolve, reject) => {
      // Check if GLTFLoader is available
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

          // Scale model appropriately (adjust as needed)
          this.model.scale.set(0.5, 0.5, 0.5);

          // Enable shadows on all meshes
          this.model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          // Add police lights to model
          this.lights.police.forEach(light => {
            this.model.add(light);
          });

          // Add model to scene
          this.scene.add(this.model);

          this.modelLoaded = true;
          resolve();
        },
        (progress) => {
          const percent = (progress.loaded / progress.total * 100).toFixed(1);
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
   * Hide the emoji cop car element
   */
  _hideEmojiCopCar() {
    const emojiCopCar = document.getElementById('cop-car');
    if (emojiCopCar) {
      emojiCopCar.style.display = 'none';
      console.log('[CopCar3D] Emoji cop car hidden');
    }
  },

  /**
   * Start the render loop
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
   * Update 3D cop car position and rotation
   */
  _update() {
    if (!this.model || !this.modelLoaded) return;

    // Get position from CopCarSystem
    if (typeof CopCarSystem !== 'undefined' && CopCarSystem.position) {
      const pos = CopCarSystem.position;

      // Convert percentage (0-100) to 3D world coordinates
      // Map dimensions in 3D space
      const mapWidth = 40;  // 3D units
      const mapHeight = 60; // 3D units (taller aspect ratio)

      // Center the coordinate system
      const x = (pos.x / 100) * mapWidth - (mapWidth / 2);
      const z = (pos.y / 100) * mapHeight - (mapHeight / 2);

      // Update model position
      this.model.position.x = x;
      this.model.position.z = z;
      this.model.position.y = 0; // Ground level

      // Calculate rotation based on movement direction
      if (this.lastPosition.x !== pos.x || this.lastPosition.y !== pos.y) {
        const dx = pos.x - this.lastPosition.x;
        const dy = pos.y - this.lastPosition.y;

        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
          // Calculate target angle (atan2 gives angle in radians)
          this.targetRotation = Math.atan2(dx, dy);
        }

        this.lastPosition = { x: pos.x, y: pos.y };
      }

      // Smoothly interpolate rotation
      const rotationSpeed = 0.1;
      let angleDiff = this.targetRotation - this.currentRotation;

      // Handle wrap-around for smooth rotation
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      this.currentRotation += angleDiff * rotationSpeed;
      this.model.rotation.y = this.currentRotation;
    }

    // Update police lights based on heat
    this._updatePoliceLights();
  },

  /**
   * Update police light flashing based on heat level
   */
  _updatePoliceLights() {
    if (!GameState || typeof GameState.player === 'undefined') return;

    const heat = GameState.player.heat || 0;

    // Only flash lights when heat > 50
    if (heat > 50) {
      this.policeLightsActive = true;
      this.policeLightTime += 0.1;

      // Alternating flash pattern
      const flashPhase = Math.sin(this.policeLightTime * 10);

      // Red light
      this.lights.police[0].intensity = flashPhase > 0 ? 2 : 0;

      // Blue light (opposite phase)
      this.lights.police[1].intensity = flashPhase > 0 ? 0 : 2;

      // Increase intensity with heat
      const intensityMultiplier = heat > 80 ? 1.5 : 1;
      this.lights.police[0].intensity *= intensityMultiplier;
      this.lights.police[1].intensity *= intensityMultiplier;
    } else {
      this.policeLightsActive = false;
      this.lights.police[0].intensity = 0;
      this.lights.police[1].intensity = 0;
    }
  },

  /**
   * Setup resize handler
   */
  _setupResizeHandler() {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          this._handleResize(width, height);
        }
      }
    });
    resizeObserver.observe(this.container);
  },

  /**
   * Handle container resize
   */
  _handleResize(width, height) {
    if (!this.camera || !this.renderer) return;

    // Update camera
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // Update renderer
    this.renderer.setSize(width, height);
  },

  /**
   * Cleanup resources
   */
  dispose() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    if (this.renderer) {
      this.renderer.dispose();
    }

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }

    // Show emoji cop car again
    const emojiCopCar = document.getElementById('cop-car');
    if (emojiCopCar) {
      emojiCopCar.style.display = '';
    }

    this.isInitialized = false;
    console.log('[CopCar3D] Disposed');
  }
};

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CopCar3D;
}
