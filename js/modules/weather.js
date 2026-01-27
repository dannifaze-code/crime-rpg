/**
 * Weather System Module
 * Three.js-based weather overlay with rain, snow, fog, storm, and heat effects
 *
 * Dependencies (from global scope):
 * - THREE: Three.js library (loaded via CDN)
 * - GameState: Main game state object
 */

// WEATHER SYSTEM: Three.js Overlay (Phase 1)
// ========================================
const WeatherOverlay = {
      // Core Three.js components
      scene: null,
      camera: null,
      renderer: null,
      animationFrameId: null,
      container: null,
      canvas: null,
      isInitialized: false,  // Track initialization state
      
      // Weather management (Phase 2)
      weatherManager: null,
      lastFrameTime: null,
      
      /**
       * Initialize Three.js overlay for weather effects
       * Creates a transparent WebGL canvas inside the turf map container
       */
      async init() {
        console.log('[WeatherOverlay] Initializing Three.js overlay...');
        
        // Get the turf map container
        this.container = document.getElementById('city-map');
        if (!this.container) {
          console.error('[WeatherOverlay] Container #city-map not found!');
          return false;
        }
        
        // Check if container is visible
        const rect = this.container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          console.warn('[WeatherOverlay] Container has zero dimensions - refusing to initialize');
          console.warn('[WeatherOverlay] Rect:', rect);

          // Set up a ResizeObserver to automatically initialize when container gets valid dimensions
          if (!this._pendingInitObserver && typeof ResizeObserver !== 'undefined') {
            console.log('[WeatherOverlay] Setting up ResizeObserver to detect valid dimensions...');
            this._pendingInitObserver = new ResizeObserver((entries) => {
              for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                  console.log('[WeatherOverlay] ✅ Container now has valid dimensions:', width, 'x', height);
                  console.log('[WeatherOverlay] Automatically initializing...');

                  // Disconnect observer
                  this._pendingInitObserver.disconnect();
                  this._pendingInitObserver = null;

                  // Initialize now that we have valid dimensions
                  this.init();
                }
              }
            });
            this._pendingInitObserver.observe(this.container);
          }

          return false;
        }

        // Create Three.js scene
        this.scene = new THREE.Scene();

        // Create orthographic camera (2D projection for weather effects)
        const width = this.container.clientWidth || rect.width;
        const height = this.container.clientHeight || rect.height;

        // Double-check we have valid dimensions
        if (width <= 0 || height <= 0) {
          console.error('[WeatherOverlay] Failed to get valid dimensions:', width, 'x', height);
          return false;
        }
        
        console.log('[WeatherOverlay] Using dimensions:', width, 'x', height);
        
        this.camera = new THREE.OrthographicCamera(
          width / -2,   // left
          width / 2,    // right
          height / 2,   // top
          height / -2,  // bottom
          0.1,          // near
          1000          // far
        );
        this.camera.position.z = 10;
        
        // Create WebGL renderer with transparency
        this.renderer = new THREE.WebGLRenderer({
          alpha: true,           // Enable transparency
          antialias: true,       // Smooth edges
          premultipliedAlpha: false
        });
        this.renderer.setSize(width, height);
        this.renderer.setClearColor(0x000000, 0); // Fully transparent background
        
        // Get the canvas element
        this.canvas = this.renderer.domElement;
        
        // Style canvas for overlay (no pointer events, positioned absolutely)
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none'; // Let clicks pass through to map UI
        this.canvas.style.zIndex = '10'; // Above map but below UI controls
        this.canvas.style.display = 'block'; // Ensure visibility
        this.canvas.style.opacity = '1'; // Ensure fully opaque
        
        // Add canvas to container
        this.container.appendChild(this.canvas);
        
        // Setup window resize handler
        this.setupResizeHandler();
        
        // Initialize WeatherManager (Phase 2)
        this.weatherManager = new WeatherManager(this.scene, this.camera, this.renderer);
        this.lastFrameTime = performance.now();
        console.log('[WeatherOverlay] WeatherManager initialized');
        
        // Start render loop
        this.startRenderLoop();
        
        // Mark as initialized
        this.isInitialized = true;
        
        console.log('[WeatherOverlay] ✅ Initialization complete');
        console.log('[WeatherOverlay] Canvas size:', width, 'x', height);
        return true;
      },
      
      /**
       * Setup automatic resizing when container dimensions change
       */
      setupResizeHandler() {
        // Use ResizeObserver for precise container size tracking
        if (typeof ResizeObserver !== 'undefined') {
          const resizeObserver = new ResizeObserver(() => {
            this.handleResize();
          });
          resizeObserver.observe(this.container);
          this.resizeObserver = resizeObserver;
        } else {
          // Fallback to window resize event
          window.addEventListener('resize', () => this.handleResize());
        }
      },
      
      /**
       * Handle container resize
       */
      handleResize() {
        if (!this.container || !this.renderer || !this.camera) return;
        
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        // Update camera projection
        this.camera.left = width / -2;
        this.camera.right = width / 2;
        this.camera.top = height / 2;
        this.camera.bottom = height / -2;
        this.camera.updateProjectionMatrix();
        
        // Update renderer size
        this.renderer.setSize(width, height);
        
        // Notify weather effects of camera bounds change (Phase 3)
        if (this.weatherManager && this.weatherManager.activeWeather) {
          if (typeof this.weatherManager.activeWeather.updateCameraBounds === 'function') {
            this.weatherManager.activeWeather.updateCameraBounds();
          }
        }
        
        console.log('[WeatherOverlay] Resized to:', width, 'x', height);
      },
      
      /**
       * Start the render loop using requestAnimationFrame
       */
      startRenderLoop() {
        const animate = () => {
          this.animationFrameId = requestAnimationFrame(animate);
          this.render();
        };
        animate();
        console.log('[WeatherOverlay] Render loop started');
      },
      
      /**
       * Render the current frame
       */
      render() {
        if (!this.renderer || !this.scene || !this.camera) return;
        
        // Calculate delta time
        const currentTime = performance.now();
        const delta = (currentTime - (this.lastFrameTime || currentTime)) / 1000; // Convert to seconds
        this.lastFrameTime = currentTime;
        
        // Update weather effects (Phase 2)
        if (this.weatherManager) {
          this.weatherManager.update(delta);
          // Update weather cycle (Prompt 2)
          this.weatherManager.updateCycle();
        }
        
        // Render scene
        this.renderer.render(this.scene, this.camera);
      },
      
      /**
       * Clean up and dispose of all Three.js resources
       * Call this when closing the Turf Map or changing tabs
       */
      dispose() {
        console.log('[WeatherOverlay] Disposing Three.js overlay...');
        
        // Dispose WeatherManager (Phase 2)
        if (this.weatherManager) {
          this.weatherManager.dispose();
          this.weatherManager = null;
        }
        
        // Stop animation loop
        if (this.animationFrameId) {
          cancelAnimationFrame(this.animationFrameId);
          this.animationFrameId = null;
        }
        
        // Remove resize observer
        if (this.resizeObserver) {
          this.resizeObserver.disconnect();
          this.resizeObserver = null;
        }
        
        // Dispose renderer
        if (this.renderer) {
          this.renderer.dispose();
          this.renderer = null;
        }
        
        // Remove canvas from DOM
        if (this.canvas && this.canvas.parentNode) {
          this.canvas.parentNode.removeChild(this.canvas);
          this.canvas = null;
        }
        
        // Clear scene
        if (this.scene) {
          this.scene.clear();
          this.scene = null;
        }
        
        // Clear camera
        this.camera = null;
        this.container = null;
        this.lastFrameTime = null;
        
        // Mark as not initialized
        this.isInitialized = false;
        
        console.log('[WeatherOverlay] ✅ Disposal complete');
      },
      
      // ========================================
      // Public API for Weather Control (Phase 2)
      // ========================================
      
      /**
       * Set weather effect
       * @param {string} type - Weather type ('rain', 'snow', 'fog', 'storm')
       * @param {number} intensity - Intensity (0.0 to 1.0)
       */
      /**
       * Set weather effect
       * @param {string} type - Weather type ('rain', 'snow', 'fog', 'storm')
       * @param {number} intensity - Intensity (0.0 to 1.0)
       * @param {string} source - Source of the change (for debugging)
       */
      setWeather(type, intensity = 0.5, source = 'overlay') {
        if (!this.weatherManager) {
          console.warn('[WeatherOverlay] WeatherManager not initialized');
          return false;
        }
        return this.weatherManager.setWeather(type, intensity, source);
      },
      
      /**
       * Clear active weather
       */
      clearWeather() {
        if (this.weatherManager) {
          this.weatherManager.clearWeather();
        }
      },
      
      /**
       * Set weather control mode (Phase 7 fix)
       * @param {string} mode - 'manual' or 'turf'
       */
      setMode(mode) {
        if (this.weatherManager) {
          this.weatherManager.setMode(mode);
        }
      },
      
      /**
       * Get weather control mode (Phase 7 fix)
       */
      getMode() {
        if (!this.weatherManager) return null;
        return this.weatherManager.getMode();
      },
      
      /**
       * Get current weather info
       */
      getWeatherInfo() {
        if (!this.weatherManager) return null;
        return this.weatherManager.getWeatherInfo();
      }
    };
    
    // ========================================
    // WEATHER SYSTEM: Manager & Effects (Phase 2)
    // ========================================
    
    /**
     * WeatherManager
     * Core system for managing weather effects on the turf map
     * Handles initialization, effect switching, and frame updates
     */
    class WeatherManager {
      constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        
        // Active weather state
        this.activeWeather = null;
        this.activeWeatherType = null;
        this.activeWeatherIntensity = 0;
        
        // Weather control mode
        // We run an always-on real-time cycle (2h) on the Turf map.
        // Turf/area logic no longer overrides weather; the cycle determines the current effect.
        this.mode = 'cycle'; // 'turf' or 'cycle'

        // Weather cycle state (2h real-time)
        this.cycleEnabled = true;
        this.cycleStartTime = null;
        this.cycleIndex = 0;
        this.cycleDuration = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

        // GLOBAL WEATHER SYSTEM: Use a fixed epoch time that's the same for ALL players
        // This ensures weather is synchronized across all accounts and continues offline
        // Weather epoch: January 1, 2025, 00:00:00 UTC
        const GLOBAL_WEATHER_EPOCH = 1704067200000; // Fixed timestamp
        this.cycleStartTime = GLOBAL_WEATHER_EPOCH;
        
        console.log(`[WeatherManager] Global weather epoch initialized: ${new Date(GLOBAL_WEATHER_EPOCH).toISOString()}`);

        this.weatherCycle = [
          { type: 'clear', intensity: 0 },
          { type: 'fog', intensity: 0.4 },
          { type: 'rain', intensity: 0.5 },
          { type: 'storm', intensity: 0.7 },
          { type: 'snow', intensity: 0.6 },
          { type: 'heat', intensity: 0.5 }
        ];

        // Apply the current weather immediately based on the global real-time cycle
        if (this.cycleEnabled && this.cycleStartTime) {
          const elapsed = Date.now() - this.cycleStartTime;
          this.cycleIndex = Math.floor(elapsed / this.cycleDuration) % this.weatherCycle.length;
          const weather = this.weatherCycle[this.cycleIndex];
          
          // Calculate how long until next weather change
          const timeInCurrentCycle = elapsed % this.cycleDuration;
          const timeUntilNext = this.cycleDuration - timeInCurrentCycle;
          const minutesUntilNext = Math.floor(timeUntilNext / 60000);
          
          console.log(`[WeatherManager] Current global weather: ${weather.type} (${weather.intensity})`);
          console.log(`[WeatherManager] Time until next weather: ${minutesUntilNext} minutes`);
          
          if (weather.type === 'clear') {
            this.clearWeather();
          } else {
            this.setWeather(weather.type, weather.intensity, 'cycle-init');
          }
        }

        
        // Performance tracking
        this.lastUpdateTime = performance.now();
        
        console.log('[WeatherManager] Initialized in turf mode');
      }
      
      /**
       * Set weather control mode
       * @param {string} mode - 'manual', 'turf', or 'cycle'
       */
      setMode(mode) {
        if (mode !== 'manual' && mode !== 'turf' && mode !== 'cycle') {
          console.warn(`[WeatherManager] Invalid mode: ${mode}. Using 'turf'`);
          mode = 'turf';
        }
        
        this.mode = mode;
        
        // Start cycle if switching to cycle mode
        if (mode === 'cycle' && !this.cycleEnabled) {
          this.startCycle();
        } else if (mode !== 'cycle' && this.cycleEnabled) {
          this.stopCycle();
        }
        
        console.log(`[WeatherManager] Mode changed to: ${mode}`);
      }
      
      /**
       * Get current weather control mode
       */
      getMode() {
        return this.mode;
      }
      
      /**
       * Set active weather effect
       * @param {string} type - Weather type ('rain', 'snow', 'fog', etc)
       * @param {number} intensity - Intensity level (0.0 to 1.0)
       * @param {string} source - Source of the change (for logging)
       */
      setWeather(type, intensity = 0.5, source = 'unknown') {
        console.log(`[WeatherManager] setWeather called: ${type} (intensity: ${intensity}) [source: ${source}, mode: ${this.mode}]`);
        
        // Validate intensity
        intensity = Math.max(0, Math.min(1, intensity));
        
        // Clear existing weather if changing type
        if (this.activeWeatherType !== type) {
          this.clearWeather();
        }
        
        // Get weather effect class
        const WeatherEffect = WeatherEffects[type];
        if (!WeatherEffect) {
          console.error(`[WeatherManager] Unknown weather type: ${type}`);
          return false;
        }
        
        // Create or update weather effect
        if (!this.activeWeather) {
          this.activeWeather = new WeatherEffect(this.scene, this.camera);
          this.activeWeatherType = type;
          console.log(`[WeatherManager] Created ${type} weather effect`);
        }
        
        // Update intensity
        this.activeWeatherIntensity = intensity;
        if (this.activeWeather.setIntensity) {
          this.activeWeather.setIntensity(intensity);
        }
        
        return true;
      }
      
      /**
       * Clear active weather effect
       */
      clearWeather() {
        if (!this.activeWeather) return;
        
        console.log(`[WeatherManager] Clearing weather: ${this.activeWeatherType}`);
        
        // Dispose weather effect
        if (this.activeWeather.dispose) {
          this.activeWeather.dispose();
        }
        
        this.activeWeather = null;
        this.activeWeatherType = null;
        this.activeWeatherIntensity = 0;
      }
      
      /**
       * Update active weather effect
       * Called every frame from render loop
       * @param {number} delta - Time since last frame (seconds)
       */
      update(delta) {
        if (!this.activeWeather) return;
        
        // Update weather effect
        if (this.activeWeather.update) {
          this.activeWeather.update(delta);
        }
      }
      
      /**
       * Get current weather info
       */
      getWeatherInfo() {
        return {
          type: this.activeWeatherType,
          intensity: this.activeWeatherIntensity,
          active: this.activeWeather !== null
        };
      }
      
      /**
       * Start weather cycle (Prompt 2)
       */
      startCycle() {
        this.cycleEnabled = true;
        // Use global epoch instead of current time to maintain synchronization
        const GLOBAL_WEATHER_EPOCH = 1704067200000;
        this.cycleStartTime = GLOBAL_WEATHER_EPOCH;
        
        // Calculate current cycle index based on global time
        const elapsed = Date.now() - this.cycleStartTime;
        this.cycleIndex = Math.floor(elapsed / this.cycleDuration) % this.weatherCycle.length;
        
        // Apply weather based on current global cycle position
        const weather = this.weatherCycle[this.cycleIndex];
        if (weather.type === 'clear') {
          this.clearWeather();
        } else {
          this.setWeather(weather.type, weather.intensity, 'cycle-start');
        }
        
        console.log(`[WeatherManager] 🔄 Cycle started - synced to global weather (${weather.type})`);
      }
      
      /**
       * Stop weather cycle (Prompt 2)
       */
      stopCycle() {
        this.cycleEnabled = false;
        this.cycleStartTime = null;
        console.log('[WeatherManager] ⏹️ Cycle stopped');
      }
      
      /**
       * Update weather cycle (Prompt 2)
       * Checks if it's time to advance to next weather
       */
      updateCycle() {
        if (!this.cycleEnabled || !this.cycleStartTime) return;
        
        const elapsed = Date.now() - this.cycleStartTime;
        const newIndex = Math.floor(elapsed / this.cycleDuration) % this.weatherCycle.length;
        
        // If index changed, apply new weather
        if (newIndex !== this.cycleIndex) {
          this.cycleIndex = newIndex;
          const weather = this.weatherCycle[this.cycleIndex];
          
          console.log(`[WeatherManager] 🔄 Cycle advance: ${weather.type} (${weather.intensity})`);
          
          if (weather.type === 'clear') {
            this.clearWeather();
          } else {
            this.setWeather(weather.type, weather.intensity, 'cycle-auto');
          }
        }
      }
      
      /**
       * Fast-forward cycle by one step (Prompt 2)
       * DISABLED in global weather mode to maintain synchronization across all players
       */
      fastForwardCycle() {
        console.warn('[WeatherManager] ⚠️ Fast-forward disabled: Global weather is synchronized for all players');
        return;
        
        /* Original code disabled for global weather
        if (!this.cycleEnabled) return;
        
        // Advance to next weather
        this.cycleIndex = (this.cycleIndex + 1) % this.weatherCycle.length;
        
        // Reset start time to match the new index
        this.cycleStartTime = Date.now() - (this.cycleIndex * this.cycleDuration);
        
        // Apply new weather
        const weather = this.weatherCycle[this.cycleIndex];
        console.log(`[WeatherManager] ⏭️ Fast-forward: ${weather.type} (${weather.intensity})`);
        
        if (weather.type === 'clear') {
          this.clearWeather();
        } else {
          this.setWeather(weather.type, weather.intensity, 'cycle-fastforward');
        }
        */
      }
      
      /**
       * Get current cycle info (Prompt 2)
       */
      getCycleInfo() {
        if (!this.cycleEnabled) {
          return { enabled: false };
        }
        
        const elapsed = Date.now() - this.cycleStartTime;
        const progress = (elapsed % this.cycleDuration) / this.cycleDuration;
        const timeUntilNext = this.cycleDuration - (elapsed % this.cycleDuration);
        
        return {
          enabled: true,
          currentIndex: this.cycleIndex,
          currentWeather: this.weatherCycle[this.cycleIndex],
          nextWeather: this.weatherCycle[(this.cycleIndex + 1) % this.weatherCycle.length],
          progress: progress,
          timeUntilNext: timeUntilNext
        };
      }
      
      /**
       * Dispose all resources
       */
      dispose() {
        console.log('[WeatherManager] Disposing...');
        this.stopCycle();
        this.clearWeather();
        this.scene = null;
        this.camera = null;
        this.renderer = null;
      }
    }
    
    // ========================================
    // GLOBAL WEATHER DEBUG FUNCTION
    // ========================================
    
    /**
     * Global helper function to check current synchronized weather across all players
     * Call from console: getGlobalWeather()
     */
    window.getGlobalWeather = function() {
      const GLOBAL_WEATHER_EPOCH = 1704067200000; // Same epoch used in WeatherManager
      const cycleDuration = 2 * 60 * 60 * 1000; // 2 hours
      const weatherCycle = [
        { type: 'clear', intensity: 0 },
        { type: 'fog', intensity: 0.4 },
        { type: 'rain', intensity: 0.5 },
        { type: 'storm', intensity: 0.7 },
        { type: 'snow', intensity: 0.6 },
        { type: 'heat', intensity: 0.5 }
      ];
      
      const elapsed = Date.now() - GLOBAL_WEATHER_EPOCH;
      const cycleIndex = Math.floor(elapsed / cycleDuration) % weatherCycle.length;
      const currentWeather = weatherCycle[cycleIndex];
      const nextWeather = weatherCycle[(cycleIndex + 1) % weatherCycle.length];
      
      const timeInCurrentCycle = elapsed % cycleDuration;
      const timeUntilNext = cycleDuration - timeInCurrentCycle;
      const minutesUntilNext = Math.floor(timeUntilNext / 60000);
      const hoursUntilNext = Math.floor(minutesUntilNext / 60);
      const remainingMinutes = minutesUntilNext % 60;
      
      console.log('='.repeat(60));
      console.log('🌍 GLOBAL WEATHER STATUS (Synchronized Across All Players)');
      console.log('='.repeat(60));
      console.log(`Current Time: ${new Date().toLocaleString()}`);
      console.log(`Weather Epoch: ${new Date(GLOBAL_WEATHER_EPOCH).toLocaleString()}`);
      console.log('');
      console.log(`Current Weather: ${currentWeather.type.toUpperCase()} (Intensity: ${currentWeather.intensity})`);
      console.log(`Next Weather: ${nextWeather.type.toUpperCase()} (Intensity: ${nextWeather.intensity})`);
      console.log(`Time Until Change: ${hoursUntilNext}h ${remainingMinutes}m`);
      console.log('');
      console.log('Weather Cycle (2h each):');
      weatherCycle.forEach((w, i) => {
        const marker = i === cycleIndex ? '→ ' : '  ';
        console.log(`${marker}${i + 1}. ${w.type.toUpperCase()} (${w.intensity})`);
      });
      console.log('='.repeat(60));
      
      return {
        currentWeather: currentWeather,
        nextWeather: nextWeather,
        timeUntilNextMs: timeUntilNext,
        timeUntilNextMinutes: minutesUntilNext,
        cycleIndex: cycleIndex,
        weatherCycle: weatherCycle
      };
    };
    
    // ========================================
    // WEATHER EFFECTS: Modular Effect Classes
    // ========================================
    
    /**
     * Base Weather Effect
     * Abstract class that all weather effects extend
     */
    class BaseWeatherEffect {
      constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        this.intensity = 0.5;
        
        console.log(`[${this.constructor.name}] Created`);
      }
      
      /**
       * Set effect intensity (0.0 to 1.0)
       */
      setIntensity(intensity) {
        this.intensity = Math.max(0, Math.min(1, intensity));
        console.log(`[${this.constructor.name}] Intensity set to ${this.intensity}`);
      }
      
      /**
       * Update effect (called every frame)
       * @param {number} delta - Time since last frame
       */
      update(delta) {
        // Override in subclasses
      }
      
      /**
       * Clean up effect resources
       */
      dispose() {
        console.log(`[${this.constructor.name}] Disposed`);
      }
    }
    
    /**
     * Rain Weather Effect (Phase 3)
     * Particle-based rain system optimized for mobile
     */
    class RainEffect extends BaseWeatherEffect {
      constructor(scene, camera) {
        super(scene, camera);
        this.name = 'Rain';
        
        // Rain parameters (adjustable)
        this.baseParticleCount = 300;  // Base count for intensity 1.0
        this.particleCount = 0;
        this.fallSpeed = 400;          // Pixels per second (downward)
        this.horizontalDrift = 50;     // Pixels per second (horizontal wind)
        this.particleSize = 2;         // Particle size in pixels
        
        // Three.js components
        this.particles = null;
        this.particleGeometry = null;
        this.particleMaterial = null;
        this.velocities = [];
        
        // Camera bounds tracking
        this.cameraBounds = this.getCameraBounds();
        
        // Initialize rain particles
        this.initRainParticles();
        
        console.log(`[RainEffect] Initialized with ${this.particleCount} particles`);
      }
      
      /**
       * Get camera viewport bounds in world coordinates
       */
      getCameraBounds() {
        const halfWidth = this.camera.right;
        const halfHeight = this.camera.top;
        
        return {
          left: -halfWidth,
          right: halfWidth,
          top: halfHeight,
          bottom: -halfHeight,
          width: halfWidth * 2,
          height: halfHeight * 2
        };
      }
      
      /**
       * Initialize rain particle system
       */
      initRainParticles() {
        // Calculate particle count based on intensity
        this.particleCount = Math.floor(this.baseParticleCount * this.intensity);
        
        // Create geometry for particles
        this.particleGeometry = new THREE.BufferGeometry();
        
        // Position array for all particles
        const positions = new Float32Array(this.particleCount * 3);
        
        // Initialize particle positions randomly across viewport
        const bounds = this.cameraBounds;
        for (let i = 0; i < this.particleCount; i++) {
          const i3 = i * 3;
          
          // Random X position across screen width
          positions[i3] = bounds.left + Math.random() * bounds.width;
          
          // Random Y position across screen height (with extra height for spawn buffer)
          positions[i3 + 1] = bounds.bottom + Math.random() * (bounds.height + 200);
          
          // Z position (slight variation for depth)
          positions[i3 + 2] = Math.random() * 10 - 5;
          
          // Initialize velocity for this particle
          this.velocities.push({
            x: this.horizontalDrift * (0.8 + Math.random() * 0.4), // Slight variation
            y: -this.fallSpeed * (0.9 + Math.random() * 0.2)       // Slight variation
          });
        }
        
        // Set positions to geometry
        this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        // Create material for rain particles
        // Use PointsMaterial for optimal mobile performance
        this.particleMaterial = new THREE.PointsMaterial({
          color: 0xaaaaaa,              // Light gray
          size: this.particleSize,
          transparent: true,
          opacity: 0.6,                 // Semi-transparent
          blending: THREE.NormalBlending,
          depthWrite: false,            // Optimization for transparent particles
          sizeAttenuation: false        // Constant size regardless of distance
        });
        
        // Create particle system
        this.particles = new THREE.Points(this.particleGeometry, this.particleMaterial);
        
        // Add to scene
        this.scene.add(this.particles);
        
        console.log(`[RainEffect] Created ${this.particleCount} rain particles`);
      }
      
      /**
       * Update rain particle positions
       * @param {number} delta - Time since last frame (seconds)
       */
      update(delta) {
        if (!this.particles || !this.particleGeometry) return;
        
        const positions = this.particleGeometry.attributes.position.array;
        const bounds = this.cameraBounds;
        
        // Update each particle
        for (let i = 0; i < this.particleCount; i++) {
          const i3 = i * 3;
          const velocity = this.velocities[i];
          
          // Update position based on velocity and delta time
          positions[i3] += velocity.x * delta;       // X (horizontal drift)
          positions[i3 + 1] += velocity.y * delta;   // Y (downward fall)
          
          // Recycle particle if it goes below screen or off sides
          if (positions[i3 + 1] < bounds.bottom - 50) {
            // Reset to top with random X position
            positions[i3] = bounds.left + Math.random() * bounds.width;
            positions[i3 + 1] = bounds.top + 50;
          }
          
          // Wrap horizontally if drift pushes particle off screen
          if (positions[i3] < bounds.left - 50) {
            positions[i3] = bounds.right + 50;
          } else if (positions[i3] > bounds.right + 50) {
            positions[i3] = bounds.left - 50;
          }
        }
        
        // Mark positions for update
        this.particleGeometry.attributes.position.needsUpdate = true;
      }
      
      /**
       * Set rain intensity
       * @param {number} intensity - 0.0 to 1.0
       */
      setIntensity(intensity) {
        const oldIntensity = this.intensity;
        super.setIntensity(intensity);
        
        // If intensity changed significantly, recreate particles
        const newCount = Math.floor(this.baseParticleCount * this.intensity);
        if (Math.abs(newCount - this.particleCount) > 50) {
          console.log(`[RainEffect] Adjusting particle count: ${this.particleCount} → ${newCount}`);
          this.dispose();
          this.initRainParticles();
        } else {
          // Just adjust opacity
          if (this.particleMaterial) {
            this.particleMaterial.opacity = 0.4 + (this.intensity * 0.4);
          }
        }
      }
      
      /**
       * Update camera bounds when viewport changes
       * Called from external resize handler if needed
       */
      updateCameraBounds() {
        this.cameraBounds = this.getCameraBounds();
        console.log('[RainEffect] Camera bounds updated');
      }
      
      /**
       * Clean up rain particles
       */
      dispose() {
        console.log('[RainEffect] Disposing rain particles...');
        
        // Remove from scene
        if (this.particles) {
          this.scene.remove(this.particles);
        }
        
        // Dispose geometry
        if (this.particleGeometry) {
          this.particleGeometry.dispose();
          this.particleGeometry = null;
        }
        
        // Dispose material
        if (this.particleMaterial) {
          this.particleMaterial.dispose();
          this.particleMaterial = null;
        }
        
        // Clear references
        this.particles = null;
        this.velocities = [];
        
        super.dispose();
      }
    }
    
    /**
     * Snow Weather Effect (Phase 5)
     * Multi-layered particle system with depth and varying speeds
     */
    class SnowEffect extends BaseWeatherEffect {
      constructor(scene, camera) {
        super(scene, camera);
        this.name = 'Snow';
        
        // Snow parameters
        this.baseParticleCount = 400;    // Base count for intensity 1.0
        this.numLayers = 3;               // Depth layers for parallax
        this.fallSpeedBase = 80;          // Base fall speed (px/s)
        this.horizontalDrift = 30;        // Horizontal wind drift
        this.swayAmount = 20;             // Horizontal sway amount
        this.swaySpeed = 1.5;             // Sway frequency
        
        // Layer configurations (foreground to background)
        this.layerConfig = [
          { 
            depth: 0,                     // Foreground
            sizeMin: 3, 
            sizeMax: 5,
            speed: 1.0,                   // Full speed
            opacity: 0.8,                 // Increased to 80%
            particleRatio: 0.2            // 20% of particles
          },
          { 
            depth: -3,                    // Middle
            sizeMin: 2, 
            sizeMax: 3,
            speed: 0.7,                   // 70% speed
            opacity: 0.8,                 // Increased to 80%
            particleRatio: 0.5            // 50% of particles
          },
          { 
            depth: -6,                    // Background
            sizeMin: 1, 
            sizeMax: 2,
            speed: 0.4,                   // 40% speed
            opacity: 0.8,                 // Increased to 80%
            particleRatio: 0.3            // 30% of particles
          }
        ];
        
        // Three.js components (one per layer)
        this.layers = [];
        this.cameraBounds = this.getCameraBounds();
        
        // Initialize snow layers
        this.initSnowLayers();
        
        const totalParticles = this.layers.reduce((sum, layer) => sum + layer.particleCount, 0);
        console.log(`[SnowEffect] Initialized with ${totalParticles} particles across ${this.numLayers} layers`);
      }
      
      /**
       * Get camera viewport bounds
       */
      getCameraBounds() {
        const halfWidth = this.camera.right;
        const halfHeight = this.camera.top;
        
        return {
          left: -halfWidth,
          right: halfWidth,
          top: halfHeight,
          bottom: -halfHeight,
          width: halfWidth * 2,
          height: halfHeight * 2
        };
      }
      
      /**
       * Initialize multi-layered snow particle system
       */
      initSnowLayers() {
        const totalParticles = Math.floor(this.baseParticleCount * this.intensity);
        const bounds = this.cameraBounds;
        
        // Create each depth layer
        for (let layerIndex = 0; layerIndex < this.numLayers; layerIndex++) {
          const config = this.layerConfig[layerIndex];
          const particleCount = Math.floor(totalParticles * config.particleRatio);
          
          // Create geometry
          const geometry = new THREE.BufferGeometry();
          const positions = new Float32Array(particleCount * 3);
          const sizes = new Float32Array(particleCount);
          const velocities = [];
          const swayOffsets = [];
          
          // Initialize particles for this layer
          for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            
            // Random position
            positions[i3] = bounds.left + Math.random() * bounds.width;
            positions[i3 + 1] = bounds.bottom + Math.random() * (bounds.height + 200);
            positions[i3 + 2] = config.depth + (Math.random() * 2 - 1); // Slight z variation
            
            // Random size within layer range
            sizes[i] = config.sizeMin + Math.random() * (config.sizeMax - config.sizeMin);
            
            // Velocity with variation
            const speedVariation = 0.8 + Math.random() * 0.4;
            velocities.push({
              x: this.horizontalDrift * speedVariation,
              y: -this.fallSpeedBase * config.speed * speedVariation
            });
            
            // Random sway offset for organic movement
            swayOffsets.push(Math.random() * Math.PI * 2);
          }
          
          // Set attributes
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
          
          // Create material
          const material = new THREE.PointsMaterial({
            color: 0xffffff,              // Pure white snow
            size: config.sizeMax,         // Max size for this layer
            transparent: true,
            opacity: config.opacity * this.intensity,
            blending: THREE.NormalBlending, // Normal blending for pure white (not glowing)
            depthWrite: false,
            sizeAttenuation: false,
            map: this.createSnowflakeTexture()
          });
          
          // Create particle system
          const particles = new THREE.Points(geometry, material);
          
          // Store layer data
          this.layers.push({
            particles,
            geometry,
            material,
            velocities,
            swayOffsets,
            particleCount,
            config
          });
          
          // Add to scene
          this.scene.add(particles);
          
          console.log(`[SnowEffect] Layer ${layerIndex + 1}: ${particleCount} particles (depth ${config.depth})`);
        }
      }
      
      /**
       * Create a circular snowflake texture
       */
      createSnowflakeTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        
        // Draw circular snowflake
        const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 32, 32);
        
        // Create texture
        const texture = new THREE.CanvasTexture(canvas);
        return texture;
      }
      
      /**
       * Update snow animation
       * @param {number} delta - Time since last frame (seconds)
       */
      update(delta) {
        if (this.layers.length === 0) return;
        
        const bounds = this.cameraBounds;
        const time = performance.now() / 1000;
        
        // Update each layer
        this.layers.forEach(layer => {
          const positions = layer.geometry.attributes.position.array;
          
          // Update each particle in this layer
          for (let i = 0; i < layer.particleCount; i++) {
            const i3 = i * 3;
            const velocity = layer.velocities[i];
            const swayOffset = layer.swayOffsets[i];
            
            // Calculate horizontal sway (side-to-side drifting)
            const sway = Math.sin(time * this.swaySpeed + swayOffset) * this.swayAmount * delta;
            
            // Update position
            positions[i3] += (velocity.x * delta) + sway;  // X with drift and sway
            positions[i3 + 1] += velocity.y * delta;       // Y (downward)
            
            // Recycle particle if it goes below screen
            if (positions[i3 + 1] < bounds.bottom - 50) {
              positions[i3] = bounds.left + Math.random() * bounds.width;
              positions[i3 + 1] = bounds.top + 50;
            }
            
            // Wrap horizontally
            if (positions[i3] < bounds.left - 50) {
              positions[i3] = bounds.right + 50;
            } else if (positions[i3] > bounds.right + 50) {
              positions[i3] = bounds.left - 50;
            }
          }
          
          // Mark for update
          layer.geometry.attributes.position.needsUpdate = true;
        });
      }
      
      /**
       * Set snow intensity
       * @param {number} intensity - 0.0 to 1.0
       */
      setIntensity(intensity) {
        const oldIntensity = this.intensity;
        super.setIntensity(intensity);
        
        // Calculate new total particle count
        const newTotal = Math.floor(this.baseParticleCount * this.intensity);
        const oldTotal = Math.floor(this.baseParticleCount * oldIntensity);
        
        // If particle count changed significantly, recreate layers
        if (Math.abs(newTotal - oldTotal) > 50) {
          console.log(`[SnowEffect] Recreating layers: ${oldTotal} → ${newTotal} particles`);
          this.dispose();
          this.initSnowLayers();
        } else {
          // Just adjust opacity
          this.layers.forEach(layer => {
            layer.material.opacity = layer.config.opacity * this.intensity;
          });
        }
      }
      
      /**
       * Update camera bounds when viewport changes
       */
      updateCameraBounds() {
        this.cameraBounds = this.getCameraBounds();
        console.log('[SnowEffect] Camera bounds updated');
      }
      
      /**
       * Clean up snow particles
       */
      dispose() {
        console.log('[SnowEffect] Disposing snow layers...');
        
        this.layers.forEach((layer, index) => {
          // Remove from scene
          if (layer.particles) {
            this.scene.remove(layer.particles);
          }
          
          // Dispose geometry
          if (layer.geometry) {
            layer.geometry.dispose();
          }
          
          // Dispose material and texture
          if (layer.material) {
            if (layer.material.map) {
              layer.material.map.dispose();
            }
            layer.material.dispose();
          }
        });
        
        // Clear array
        this.layers = [];
        
        super.dispose();
      }
    }
    
    /**
     * Fog Weather Effect (Phase 4)
     * Animated fog overlay using fullscreen plane with subtle movement
     */
    class FogEffect extends BaseWeatherEffect {
      constructor(scene, camera) {
        super(scene, camera);
        this.name = 'Fog';
        
        // Fog parameters
        this.baseOpacity = 0.4;          // Base opacity at intensity 1.0
        this.fogColor = 0xcccccc;        // Light gray fog
        this.animationSpeed = 0.02;      // Slow drift animation speed
        this.currentOpacity = 0;         // Current opacity (for fade in/out)
        this.targetOpacity = 0;          // Target opacity (based on intensity)
        this.fadeSpeed = 0.5;            // Fade in/out speed
        
        // Three.js components
        this.fogMesh = null;
        this.fogGeometry = null;
        this.fogMaterial = null;
        
        // Animation state
        this.time = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        
        // Get camera bounds
        this.cameraBounds = this.getCameraBounds();
        
        // Initialize fog overlay
        this.initFogOverlay();
        
        console.log(`[FogEffect] Initialized with opacity ${this.targetOpacity}`);
      }
      
      /**
       * Get camera viewport bounds
       */
      getCameraBounds() {
        const halfWidth = this.camera.right;
        const halfHeight = this.camera.top;
        
        return {
          width: halfWidth * 2,
          height: halfHeight * 2
        };
      }
      
      /**
       * Initialize fog overlay plane
       */
      initFogOverlay() {
        // Calculate target opacity based on intensity
        this.targetOpacity = this.baseOpacity * this.intensity;
        this.currentOpacity = 0; // Start invisible for fade in
        
        // Create a fullscreen plane geometry
        const bounds = this.cameraBounds;
        this.fogGeometry = new THREE.PlaneGeometry(bounds.width, bounds.height);
        
        // Create shader material for animated fog
        // Using simple vertex colors and transparency for mobile performance
        this.fogMaterial = new THREE.MeshBasicMaterial({
          color: this.fogColor,
          transparent: true,
          opacity: this.currentOpacity,
          depthWrite: false,
          depthTest: false,
          blending: THREE.NormalBlending
        });
        
        // Create mesh
        this.fogMesh = new THREE.Mesh(this.fogGeometry, this.fogMaterial);
        
        // Position fog plane just in front of camera
        this.fogMesh.position.z = 5;
        
        // Add to scene
        this.scene.add(this.fogMesh);
        
        console.log(`[FogEffect] Fog overlay created (${bounds.width}x${bounds.height})`);
      }
      
      /**
       * Update fog animation
       * @param {number} delta - Time since last frame (seconds)
       */
      update(delta) {
        if (!this.fogMesh || !this.fogMaterial) return;
        
        // Update time
        this.time += delta;
        
        // Subtle drifting animation (very slow movement)
        this.offsetX = Math.sin(this.time * this.animationSpeed * 0.5) * 20;
        this.offsetY = Math.cos(this.time * this.animationSpeed * 0.3) * 15;
        
        // Apply position offset for subtle movement
        this.fogMesh.position.x = this.offsetX;
        this.fogMesh.position.y = this.offsetY;
        
        // Smooth fade in/out to target opacity
        if (Math.abs(this.currentOpacity - this.targetOpacity) > 0.001) {
          if (this.currentOpacity < this.targetOpacity) {
            // Fade in
            this.currentOpacity = Math.min(
              this.targetOpacity,
              this.currentOpacity + (this.fadeSpeed * delta)
            );
          } else {
            // Fade out
            this.currentOpacity = Math.max(
              this.targetOpacity,
              this.currentOpacity - (this.fadeSpeed * delta)
            );
          }
          
          // Update material opacity
          this.fogMaterial.opacity = this.currentOpacity;
        }
        
        // Subtle pulsing effect (breathing fog)
        const pulseAmount = 0.05;
        const pulse = Math.sin(this.time * 0.5) * pulseAmount;
        this.fogMaterial.opacity = this.currentOpacity + (pulse * this.currentOpacity);
      }
      
      /**
       * Set fog intensity
       * @param {number} intensity - 0.0 to 1.0
       */
      setIntensity(intensity) {
        super.setIntensity(intensity);
        
        // Update target opacity (will smoothly transition)
        this.targetOpacity = this.baseOpacity * this.intensity;
        
        console.log(`[FogEffect] Target opacity set to ${this.targetOpacity.toFixed(2)}`);
      }
      
      /**
       * Update camera bounds when viewport changes
       */
      updateCameraBounds() {
        if (!this.fogMesh || !this.fogGeometry) return;
        
        this.cameraBounds = this.getCameraBounds();
        const bounds = this.cameraBounds;
        
        // Recreate geometry with new size
        this.fogGeometry.dispose();
        this.fogGeometry = new THREE.PlaneGeometry(bounds.width, bounds.height);
        this.fogMesh.geometry = this.fogGeometry;
        
        console.log(`[FogEffect] Resized to ${bounds.width}x${bounds.height}`);
      }
      
      /**
       * Fade out fog (for smooth exit)
       */
      fadeOut() {
        this.targetOpacity = 0;
      }
      
      /**
       * Clean up fog resources
       */
      dispose() {
        console.log('[FogEffect] Disposing fog...');
        
        // Fade out before disposal
        this.fadeOut();
        
        // Wait a moment for fade out, then clean up
        setTimeout(() => {
          // Remove from scene
          if (this.fogMesh) {
            this.scene.remove(this.fogMesh);
          }
          
          // Dispose geometry
          if (this.fogGeometry) {
            this.fogGeometry.dispose();
            this.fogGeometry = null;
          }
          
          // Dispose material
          if (this.fogMaterial) {
            this.fogMaterial.dispose();
            this.fogMaterial = null;
          }
          
          // Clear references
          this.fogMesh = null;
        }, 500); // 500ms fade out time
        
        super.dispose();
      }
    }
    
    /**
     * Storm Weather Effect
     * Will render heavy rain + lightning (Phase 3)
     */
    class StormEffect extends BaseWeatherEffect {
      constructor(scene, camera) {
        super(scene, camera);
        this.name = 'Storm';
        
        // Storm-specific properties (to be used in Phase 3)
        this.particleCount = 0;
        this.particles = null;
        this.lightningFlashTime = 0;
        
        console.log('[StormEffect] Ready for storm implementation');
      }
      
      update(delta) {
        // Storm animation logic will be added in Phase 3
      }
      
      dispose() {
        // Clean up storm effects (Phase 3)
        super.dispose();
      }
    }
    
    /**
     * Heat Shimmer Weather Effect (Phase 6)
     * Shader-based distortion effect for heat waves
     */
    class HeatShimmerEffect extends BaseWeatherEffect {
      constructor(scene, camera) {
        super(scene, camera);
        this.name = 'Heat Shimmer';
        
        // Heat shimmer parameters
        this.distortionStrength = 0.015;  // Max distortion at intensity 1.0
        this.waveSpeed = 0.5;             // Speed of wave animation
        this.waveFrequency = 3.0;         // Frequency of waves
        
        // Three.js components
        this.shimmerMesh = null;
        this.shimmerGeometry = null;
        this.shimmerMaterial = null;
        
        // Animation state
        this.time = 0;
        
        // Get camera bounds
        this.cameraBounds = this.getCameraBounds();
        
        // Initialize shader overlay
        this.initHeatShimmer();
        
        console.log(`[HeatShimmerEffect] Initialized with strength ${this.distortionStrength * this.intensity}`);
      }
      
      /**
       * Get camera viewport bounds
       */
      getCameraBounds() {
        const halfWidth = this.camera.right;
        const halfHeight = this.camera.top;
        
        return {
          width: halfWidth * 2,
          height: halfHeight * 2
        };
      }
      
      /**
       * Initialize heat shimmer shader overlay
       */
      initHeatShimmer() {
        const bounds = this.cameraBounds;
        
        // Create fullscreen plane geometry
        this.shimmerGeometry = new THREE.PlaneGeometry(bounds.width, bounds.height);
        
        // Custom shader material for heat distortion
        this.shimmerMaterial = new THREE.ShaderMaterial({
          uniforms: {
            time: { value: 0.0 },
            intensity: { value: this.intensity },
            distortionStrength: { value: this.distortionStrength },
            waveSpeed: { value: this.waveSpeed },
            waveFrequency: { value: this.waveFrequency },
            resolution: { value: new THREE.Vector2(bounds.width, bounds.height) }
          },
          vertexShader: `
            varying vec2 vUv;
            
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform float time;
            uniform float intensity;
            uniform float distortionStrength;
            uniform float waveSpeed;
            uniform float waveFrequency;
            uniform vec2 resolution;
            
            varying vec2 vUv;
            
            // Simple noise function for wave distortion
            float noise(vec2 p) {
              return sin(p.x * 10.0 + time) * sin(p.y * 10.0 + time * 0.7) * 0.5 + 0.5;
            }
            
            void main() {
              vec2 uv = vUv;
              
              // Create vertical heat wave pattern
              float wave1 = sin(uv.y * waveFrequency * 3.14159 + time * waveSpeed) * 0.5 + 0.5;
              float wave2 = sin(uv.y * waveFrequency * 2.0 * 3.14159 - time * waveSpeed * 0.7) * 0.5 + 0.5;
              
              // Combine waves with noise
              float distortion = (wave1 * 0.6 + wave2 * 0.4) * noise(uv * 5.0 + time * 0.1);
              
              // Apply subtle horizontal distortion (heat rises vertically)
              float offsetX = (distortion - 0.5) * distortionStrength * intensity;
              
              // Create subtle vertical shimmer (stronger at top, weaker at bottom - heat rises)
              float heightFactor = 1.0 - uv.y * 0.5; // Stronger at top
              offsetX *= heightFactor;
              
              // Very subtle opacity variation for heat wave visibility
              float alpha = 0.15 * intensity * distortion;
              
              // Output color with subtle tint
              vec3 heatTint = vec3(1.0, 0.95, 0.85); // Slight warm tint
              vec3 color = mix(vec3(1.0), heatTint, alpha);
              
              gl_FragColor = vec4(color, alpha);
            }
          `,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          blending: THREE.NormalBlending
        });
        
        // Create mesh
        this.shimmerMesh = new THREE.Mesh(this.shimmerGeometry, this.shimmerMaterial);
        
        // Position in front of camera
        this.shimmerMesh.position.z = 8;
        
        // Add to scene
        this.scene.add(this.shimmerMesh);
        
        console.log(`[HeatShimmerEffect] Shader overlay created (${bounds.width}x${bounds.height})`);
      }
      
      /**
       * Update heat shimmer animation
       * @param {number} delta - Time since last frame (seconds)
       */
      update(delta) {
        if (!this.shimmerMesh || !this.shimmerMaterial) return;
        
        // Update time uniform
        this.time += delta;
        this.shimmerMaterial.uniforms.time.value = this.time;
        
        // Update intensity uniform
        this.shimmerMaterial.uniforms.intensity.value = this.intensity;
      }
      
      /**
       * Set heat shimmer intensity
       * @param {number} intensity - 0.0 to 1.0
       */
      setIntensity(intensity) {
        super.setIntensity(intensity);
        
        // Update shader uniform
        if (this.shimmerMaterial) {
          this.shimmerMaterial.uniforms.intensity.value = this.intensity;
        }
        
        console.log(`[HeatShimmerEffect] Intensity set to ${this.intensity.toFixed(2)}`);
      }
      
      /**
       * Update camera bounds when viewport changes
       */
      updateCameraBounds() {
        if (!this.shimmerMesh || !this.shimmerGeometry) return;
        
        this.cameraBounds = this.getCameraBounds();
        const bounds = this.cameraBounds;
        
        // Recreate geometry with new size
        this.shimmerGeometry.dispose();
        this.shimmerGeometry = new THREE.PlaneGeometry(bounds.width, bounds.height);
        this.shimmerMesh.geometry = this.shimmerGeometry;
        
        // Update resolution uniform
        if (this.shimmerMaterial) {
          this.shimmerMaterial.uniforms.resolution.value.set(bounds.width, bounds.height);
        }
        
        console.log(`[HeatShimmerEffect] Resized to ${bounds.width}x${bounds.height}`);
      }
      
      /**
       * Clean up heat shimmer resources
       */
      dispose() {
        console.log('[HeatShimmerEffect] Disposing heat shimmer...');
        
        // Remove from scene
        if (this.shimmerMesh) {
          this.scene.remove(this.shimmerMesh);
        }
        
        // Dispose geometry
        if (this.shimmerGeometry) {
          this.shimmerGeometry.dispose();
          this.shimmerGeometry = null;
        }
        
        // Dispose material
        if (this.shimmerMaterial) {
          this.shimmerMaterial.dispose();
          this.shimmerMaterial = null;
        }
        
        // Clear references
        this.shimmerMesh = null;
        
        super.dispose();
      }
    }
    
    // Weather Effects Registry
    const WeatherEffects = {
      rain: RainEffect,
      snow: SnowEffect,
      fog: FogEffect,
      storm: StormEffect,
      heat: HeatShimmerEffect
    };

// Export for ES6 module usage
export { WeatherOverlay, WeatherEffects };

// Also make globally available for legacy code compatibility
if (typeof window !== 'undefined') {
  window.WeatherOverlay = WeatherOverlay;
  window.WeatherEffects = WeatherEffects;
}

    // ========================================
