/**
 * 3D Cop Car Module
 * Three.js-based 3D cop car overlay for the turf map.
 *
 * Goals:
 * - Anchor the WebGL canvas to #map-world so it inherits TurfTab pan/zoom transforms.
 * - Follow CopCarSystem.position (% coords) precisely (no "sliding") with smooth damping.
 * - Rotate using CopCarSystem.heading (stable, road-accurate turns).
 * - Improved lighting + sRGB + anisotropy for crisp textures (no "black model").
 * - Subtle exhaust smoke particle effect behind the car while moving.
 *
 * Dependencies (global):
 * - THREE
 * - THREE.GLTFLoader
 * - CopCarSystem
 * - GameState (heat for police lights)
 */

const CopCar3D = {
  scene: null,
  camera: null,
  renderer: null,
  canvas: null,
  container: null, // #map-world
  animationFrameId: null,
  isInitialized: false,

  model: null,
  modelLoaded: false,
  modelPath: 'sprites/3d-models/cop-car.glb',

  // Motion
  _lastFrameTs: 0,
  _currentYaw: 0,
  _targetYaw: 0,

  // Screen->world anchoring
  _raycaster: null,
  _groundPlane: null,

  // Lighting
  lights: {
    ambient: null,
    hemi: null,
    directional: null,
    police: []
  },

  // Exhaust particles
  exhaust: {
    enabled: true,
    spawnAcc: 0,
    spawnRatePerSec: 12, // base rate at cruise
    maxParticles: 48,
    particles: [],
    texture: null
  },

  config: {
    camera: {
      fov: 45,
      near: 0.1,
      far: 2000,
      position: { x: 0, y: 55, z: 35 },
      lookAt: { x: 0, y: 0, z: 0 }
    },

    // Damping (higher = tighter lock)
    positionDampingK: 16, // exponential smoothing strength
    yawDampingK: 14,

    modelYawOffset: 0,

    shadowsEnabled: true,
    shadowReceiverOpacity: 0.22,

    // Prefer clarity over perf (user request)
    maxPixelRatio: 3
  },

  async init() {
    if (typeof THREE === 'undefined') {
      console.error('[CopCar3D] THREE.js not loaded');
      return false;
    }

    this.container = document.getElementById('map-world');
    if (!this.container) {
      console.error('[CopCar3D] #map-world not found');
      return false;
    }

    const { width, height } = this._getContainerSize();
    if (!width || !height) {
      this._waitForDimensions();
      return false;
    }

    await this._initScene(width, height);
    return true;
  },

  _getContainerSize() {
    return {
      width: this.container?.offsetWidth || 0,
      height: this.container?.offsetHeight || 0
    };
  },

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
      setTimeout(() => this.init(), 250);
    }
  },

  async _initScene(width, height) {
    this.scene = new THREE.Scene();

    const aspect = width / height;
    const camCfg = this.config.camera;
    this.camera = new THREE.PerspectiveCamera(camCfg.fov, aspect, camCfg.near, camCfg.far);
    this.camera.position.set(camCfg.position.x, camCfg.position.y, camCfg.position.z);
    this.camera.lookAt(camCfg.lookAt.x, camCfg.lookAt.y, camCfg.lookAt.z);

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: false
    });

    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.physicallyCorrectLights = true;

    const pr = Math.min(window.devicePixelRatio || 1, this.config.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(width, height, false);

    this.renderer.shadowMap.enabled = !!this.config.shadowsEnabled;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.canvas = this.renderer.domElement;
    this.canvas.id = 'cop-car-3d-canvas';
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '3';

    try {
      const pos = getComputedStyle(this.container).position;
      if (!pos || pos === 'static') this.container.style.position = 'relative';
    } catch (e) {}

    // Critical: attach to #map-world (not body/viewport)
    this.container.appendChild(this.canvas);

    this._raycaster = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._setupLighting();
    this._setupShadowReceiver();
    this._initExhaust();

    await this._loadModel();
    this._hideEmojiCopCar();
    this._setupResizeHandler();
    this._startRenderLoop();

    this.isInitialized = true;
  },

  _setupLighting() {
    this.lights.ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(this.lights.ambient);

    this.lights.hemi = new THREE.HemisphereLight(0xffffff, 0x1f1f1f, 0.75);
    this.lights.hemi.position.set(0, 100, 0);
    this.scene.add(this.lights.hemi);

    this.lights.directional = new THREE.DirectionalLight(0xffffff, 1.15);
    this.lights.directional.position.set(18, 35, 14);

    if (this.config.shadowsEnabled) {
      this.lights.directional.castShadow = true;
      this.lights.directional.shadow.mapSize.width = 1024;
      this.lights.directional.shadow.mapSize.height = 1024;
      this.lights.directional.shadow.camera.near = 0.5;
      this.lights.directional.shadow.camera.far = 220;
      this.lights.directional.shadow.camera.left = -80;
      this.lights.directional.shadow.camera.right = 80;
      this.lights.directional.shadow.camera.top = 80;
      this.lights.directional.shadow.camera.bottom = -80;
      this.lights.directional.shadow.bias = -0.00025;
    }

    this.scene.add(this.lights.directional);

    const red = new THREE.PointLight(0xff2a2a, 0, 8);
    red.position.set(-0.35, 1.1, 0.05);
    this.lights.police.push(red);

    const blue = new THREE.PointLight(0x2a5cff, 0, 8);
    blue.position.set(0.35, 1.1, 0.05);
    this.lights.police.push(blue);
  },

  _setupShadowReceiver() {
    if (!this.config.shadowsEnabled) return;

    const geom = new THREE.PlaneGeometry(500, 500);
    const mat = new THREE.ShadowMaterial({ opacity: this.config.shadowReceiverOpacity });
    const plane = new THREE.Mesh(geom, mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0;
    plane.receiveShadow = true;
    plane.renderOrder = 0;
    this.scene.add(plane);
    this.groundShadowMesh = plane;
  },

  _initExhaust() {
    if (!this.exhaust.enabled) return;

    // Procedural smoke texture (no external asset)
    const size = 128;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.needsUpdate = true;
    this.exhaust.texture = tex;
  },

  async _loadModel() {
    if (!THREE.GLTFLoader) {
      console.error('[CopCar3D] GLTFLoader not available');
      return;
    }

    return new Promise((resolve, reject) => {
      const loader = new THREE.GLTFLoader();
      loader.load(
        this.modelPath,
        (gltf) => {
          this.model = gltf.scene;
          this.model.scale.set(0.5, 0.5, 0.5);

          const maxAniso = this.renderer.capabilities.getMaxAnisotropy?.() || 1;

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
                mat.map.minFilter = THREE.LinearMipmapLinearFilter;
                mat.map.magFilter = THREE.LinearFilter;
                mat.map.generateMipmaps = true;
                mat.map.needsUpdate = true;
              }
              if (mat.emissiveMap) {
                mat.emissiveMap.encoding = THREE.sRGBEncoding;
                mat.emissiveMap.anisotropy = maxAniso;
                mat.emissiveMap.needsUpdate = true;
              }

              // Keep a bit of gloss so details pop
              if (typeof mat.roughness === 'number') mat.roughness = Math.min(1, Math.max(0.18, mat.roughness));
              if (typeof mat.metalness === 'number') mat.metalness = Math.min(1, Math.max(0.0, mat.metalness));

              mat.needsUpdate = true;
            });
          });

          this.lights.police.forEach((l) => this.model.add(l));
          this.model.position.y = 0.15;

          this.scene.add(this.model);
          this.modelLoaded = true;
          resolve();
        },
        undefined,
        (err) => reject(err)
      );
    });
  },

  _hideEmojiCopCar() {
    const emojiCopCar = document.getElementById('cop-car');
    if (!emojiCopCar) return;
    emojiCopCar.style.opacity = '0';
    emojiCopCar.style.pointerEvents = 'none';
    emojiCopCar.style.filter = 'none';
  },

  _startRenderLoop() {
    const loop = (ts) => {
      this.animationFrameId = requestAnimationFrame(loop);
      this._update(ts);
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  },

  _percentToCanvasPixel(posPercent) {
    const w = this.canvas?.width || 0;
    const h = this.canvas?.height || 0;
    return {
      w,
      h,
      px: (posPercent.x / 100) * w,
      py: (posPercent.y / 100) * h
    };
  },

  _screenPointToGroundWorld(posPercent) {
    const { w, h, px, py } = this._percentToCanvasPixel(posPercent);
    if (!w || !h) return null;

    const ndcX = (px / w) * 2 - 1;
    const ndcY = -((py / h) * 2 - 1);

    this._raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = new THREE.Vector3();
    const ok = this._raycaster.ray.intersectPlane(this._groundPlane, hit);
    return ok ? hit : null;
  },

  _smoothFactor(k, dt) {
    // Exponential smoothing: 1 - e^(-k*dt)
    return 1 - Math.exp(-k * dt);
  },

  _update(ts) {
    if (!this.modelLoaded || !this.model) {
      this._updatePoliceLights(0);
      return;
    }

    const now = typeof ts === 'number' ? ts : performance.now();
    if (!this._lastFrameTs) this._lastFrameTs = now;
    const dt = Math.min(0.05, Math.max(0.001, (now - this._lastFrameTs) / 1000));
    this._lastFrameTs = now;

    const sys = (typeof CopCarSystem !== 'undefined') ? CopCarSystem : null;
    if (sys && sys.position) {
      // Position: lock to map percent using ray-to-ground
      const targetWorld = this._screenPointToGroundWorld(sys.position);
      if (targetWorld) {
        targetWorld.y = this.model.position.y;

        const a = this._smoothFactor(this.config.positionDampingK, dt);
        this.model.position.lerp(targetWorld, a);
      }

      // Rotation: trust CopCarSystem.heading for stable road turns
      if (typeof sys.heading === 'number' && isFinite(sys.heading)) {
        this._targetYaw = sys.heading + this.config.modelYawOffset;
      }

      const yawA = this._smoothFactor(this.config.yawDampingK, dt);
      let diff = this._targetYaw - this._currentYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this._currentYaw += diff * yawA;
      this.model.rotation.y = this._currentYaw;

      // Exhaust intensity based on speed (percent units/sec)
      const speed = typeof sys.speed === 'number' ? sys.speed : 0;
      this._updateExhaust(dt, Math.max(0, speed));
    } else {
      this._updateExhaust(dt, 0);
    }

    this._updatePoliceLights(dt);
  },

  _updatePoliceLights(dt) {
    if (!window.GameState || !this.lights.police.length) return;

    const heat = GameState.player?.heat || 0;

    if (heat > 50) {
      this.policeLightTime = (this.policeLightTime || 0) + dt;
      const flash = Math.sin(this.policeLightTime * 18);

      const mult = heat > 80 ? 1.45 : 1.0;
      this.lights.police[0].intensity = (flash > 0 ? 2.2 : 0) * mult;
      this.lights.police[1].intensity = (flash > 0 ? 0 : 2.2) * mult;
    } else {
      this.lights.police[0].intensity = 0;
      this.lights.police[1].intensity = 0;
    }
  },

  _spawnSmokeParticle() {
    if (!this.exhaust.texture) return;

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.exhaust.texture,
        transparent: true,
        opacity: 0.12,
        depthWrite: false
      })
    );

    sprite.scale.setScalar(0.65);
    sprite.renderOrder = 10;

    const p = {
      sprite,
      life: 0.9,
      age: 0,
      vel: new THREE.Vector3()
    };

    this.scene.add(sprite);
    this.exhaust.particles.push(p);

    return p;
  },

  _updateExhaust(dt, speed) {
    if (!this.exhaust.enabled) return;

    // Update existing particles
    for (let i = this.exhaust.particles.length - 1; i >= 0; i--) {
      const p = this.exhaust.particles[i];
      p.age += dt;

      const t = p.age / p.life;
      if (t >= 1) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.exhaust.particles.splice(i, 1);
        continue;
      }

      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.material.opacity = 0.12 * (1 - t);
      const s = 0.65 + t * 1.25;
      p.sprite.scale.set(s, s, s);
    }

    // Spawn rate proportional to motion
    const moving = speed > 0.15;
    if (!moving) return;

    const rate = this.exhaust.spawnRatePerSec * Math.min(1.0, speed / 6.2);
    this.exhaust.spawnAcc += dt * rate;

    while (this.exhaust.spawnAcc >= 1) {
      this.exhaust.spawnAcc -= 1;

      if (this.exhaust.particles.length >= this.exhaust.maxParticles) break;

      const p = this._spawnSmokeParticle();
      if (!p) break;

      // Place behind the car, slightly above ground
      const yaw = this._currentYaw;
      const back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

      const pos = new THREE.Vector3().copy(this.model.position);
      pos.addScaledVector(back, 1.05);
      pos.addScaledVector(side, (Math.random() - 0.5) * 0.15);
      pos.y += 0.28;

      p.sprite.position.copy(pos);

      // Drift slightly upward and backward
      p.vel.copy(back).multiplyScalar(0.35 + Math.random() * 0.15);
      p.vel.y = 0.22 + Math.random() * 0.08;
      p.vel.addScaledVector(side, (Math.random() - 0.5) * 0.12);
    }
  },

  _setupResizeHandler() {
    if (!this.container || typeof ResizeObserver === 'undefined') return;

    this._resizeObserver = new ResizeObserver(() => {
      const { width, height } = this._getContainerSize();
      if (width > 0 && height > 0) this._handleResize(width, height);
    });
    this._resizeObserver.observe(this.container);
  },

  _handleResize(width, height) {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  },

  dispose() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);

    if (this._resizeObserver) {
      try { this._resizeObserver.disconnect(); } catch (e) {}
      this._resizeObserver = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);

    const emojiCopCar = document.getElementById('cop-car');
    if (emojiCopCar) {
      emojiCopCar.style.opacity = '';
      emojiCopCar.style.pointerEvents = '';
    }

    this.isInitialized = false;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CopCar3D;
}
