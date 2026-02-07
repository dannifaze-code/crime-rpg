/**
 * Cop Car System — Node Patrol (Percent-Space Runtime)
 *
 * IMPORTANT:
 * - Your patrol editor stores nodes in "editor plane units" (x,z) where:
 *     MAP_W = 66.6, MAP_H = 100.0
 *     x ∈ [-MAP_W/2, +MAP_W/2], z ∈ [-MAP_H/2, +MAP_H/2]
 * - The actual game Turf map uses CSS percent space:
 *     x% ∈ [0..100], y% ∈ [0..100]
 *
 * This module converts your editor units into percent space so:
 * - #cop-car (DOM marker) uses left/top in %
 * - CopCar3D reads CopCarSystem.copPose (x/y in %) and stays aligned
 *
 * Source of truth extracted from patrol_system_saved.html (53 nodes with interior grid cross-links).
 */

/* global requestAnimationFrame, performance */

(function () {
  // Editor plane dimensions (must match patrol_system_saved.html)
  const MAP_W = 66.6;
  const MAP_H = 100.0;

  function editorToPercentX(x) { return (x / MAP_W + 0.5) * 100; }
  function editorToPercentY(z) { return (z / MAP_H + 0.5) * 100; }

  // Helpful for debugging / future tools
  function percentToEditorX(px) { return (px / 100 - 0.5) * MAP_W; }
  function percentToEditorY(py) { return (py / 100 - 0.5) * MAP_H; }

  const CopCarSystem = {
    // --- DATA CALIBRATED IN EDITOR (editor units) ---
    _nodesEditor: [
      {"id":"node_1740000000001","x":-31.91386017464439,"y":-45.83552670758757},
      {"id":"node_1740000000002","x":-26.92011444580006,"y":-45.845661362468405},
      {"id":"node_1740000000003","x":-18.39997108421783,"y":-45.81612589648917},
      {"id":"node_1740000000004","x":-10.399740505381065,"y":-45.80703310175251},
      {"id":"node_1740000000005","x":-2.772898850898161,"y":-45.78075471698111},
      {"id":"node_1740000000006","x":6.6266666666666625,"y":-45.74000000000001},
      {"id":"node_1740000000007","x":15.030744336569575,"y":-45.71215094339623},
      {"id":"node_1740000000008","x":23.647213114754087,"y":-45.68430188679245},
      {"id":"node_1740000000009","x":32.137183021108166,"y":-45.65645283018867},
      {"id":"node_1740000000010","x":32.14748362779043,"y":-41.4377358490566},
      {"id":"node_1740000000011","x":32.11475409836067,"y":-31.11886792452831},
      {"id":"node_1740000000012","x":32.081967213114754,"y":-20.799999999999997},
      {"id":"node_1740000000013","x":32.049180327868846,"y":-10.4811320754717},
      {"id":"node_1740000000014","x":32.01639344262295,"y":-0.16226415094340467},
      {"id":"node_1740000000015","x":30.30550185125431,"y":9.599571734475365},
      {"id":"node_1740000000016","x":23.972489015747863,"y":9.63018867924528},
      {"id":"node_1740000000017","x":14.872489015747863,"y":9.63018867924528},
      {"id":"node_1740000000018","x":5.772489015747863,"y":9.63018867924528},
      {"id":"node_1740000000019","x":-3.3275109842521367,"y":9.63018867924528},
      {"id":"node_1740000000020","x":-12.427510984252137,"y":9.63018867924528},
      {"id":"node_1740000000021","x":-21.527510984252137,"y":9.63018867924528},
      {"id":"node_1740000000022","x":-30.627510984252137,"y":9.63018867924528},
      {"id":"node_1740000000023","x":-32.11955557872567,"y":5.786807127259612},
      {"id":"node_1740000000024","x":-32.13333333333334,"y":-2.9792452830188737},
      {"id":"node_1740000000025","x":-32.146510480255754,"y":-15.163235101837068},
      {"id":"node_1740000000026","x":-32.11475409836067,"y":-25.082264150943405},
      {"id":"node_1740000000027","x":-32.081967213114754,"y":-35.401132075471694},
      {"id":"node_1740000000028","x":-26.92011444580006,"y":-35.401132075471694},
      {"id":"node_1740000000029","x":-18.39997108421783,"y":-35.401132075471694},
      {"id":"node_1740000000030","x":-10.399740505381065,"y":-35.401132075471694},
      {"id":"node_1740000000031","x":-2.772898850898161,"y":-35.401132075471694},
      {"id":"node_1740000000032","x":6.6266666666666625,"y":-35.401132075471694},
      {"id":"node_1740000000033","x":15.030744336569575,"y":-35.401132075471694},
      {"id":"node_1740000000034","x":23.647213114754087,"y":-35.401132075471694},
      {"id":"node_1740000000035","x":32.137183021108166,"y":-35.401132075471694},
      {"id":"node_1740000000036","x":32.14748362779043,"y":-25.082264150943405},
      {"id":"node_1740000000037","x":32.14748362779043,"y":-15.163235101837068},
      {"id":"node_1740000000038","x":32.14748362779043,"y":-2.9792452830188737},
      {"id":"node_1740000000039","x":32.14748362779043,"y":5.786807127259612},
      {"id":"node_1740000000040","x":23.647213114754087,"y":5.786807127259612},
      {"id":"node_1740000000041","x":15.030744336569575,"y":5.786807127259612},
      {"id":"node_1740000000042","x":6.6266666666666625,"y":5.786807127259612},
      {"id":"node_1740000000043","x":-2.772898850898161,"y":5.786807127259612},
      {"id":"node_1740000000044","x":-10.399740505381065,"y":5.786807127259612},
      {"id":"node_1740000000045","x":-18.39997108421783,"y":5.786807127259612},
      {"id":"node_1740000000046","x":-26.92011444580006,"y":5.786807127259612},
      {"id":"node_1740000000047","x":-26.92011444580006,"y":-2.9792452830188737},
      {"id":"node_1740000000048","x":-18.39997108421783,"y":-2.9792452830188737},
      {"id":"node_1740000000049","x":-10.399740505381065,"y":-2.9792452830188737},
      {"id":"node_1740000000050","x":-2.772898850898161,"y":-2.9792452830188737},
      {"id":"node_1740000000051","x":6.6266666666666625,"y":-2.9792452830188737},
      {"id":"node_1740000000052","x":15.030744336569575,"y":-2.9792452830188737},
      {"id":"node_1740000000053","x":23.647213114754087,"y":-2.9792452830188737}
    ],
    links: [
      // --- Perimeter links (original outer loop) ---
      ["node_1740000000001","node_1740000000002"],
      ["node_1740000000002","node_1740000000003"],
      ["node_1740000000003","node_1740000000004"],
      ["node_1740000000004","node_1740000000005"],
      ["node_1740000000005","node_1740000000006"],
      ["node_1740000000006","node_1740000000007"],
      ["node_1740000000007","node_1740000000008"],
      ["node_1740000000008","node_1740000000009"],
      ["node_1740000000009","node_1740000000010"],
      ["node_1740000000010","node_1740000000011"],
      ["node_1740000000011","node_1740000000012"],
      ["node_1740000000012","node_1740000000013"],
      ["node_1740000000013","node_1740000000014"],
      ["node_1740000000014","node_1740000000015"],
      ["node_1740000000015","node_1740000000016"],
      ["node_1740000000016","node_1740000000017"],
      ["node_1740000000017","node_1740000000018"],
      ["node_1740000000018","node_1740000000019"],
      ["node_1740000000019","node_1740000000020"],
      ["node_1740000000020","node_1740000000021"],
      ["node_1740000000021","node_1740000000022"],
      ["node_1740000000022","node_1740000000023"],
      ["node_1740000000023","node_1740000000024"],
      ["node_1740000000024","node_1740000000025"],
      ["node_1740000000025","node_1740000000026"],
      ["node_1740000000026","node_1740000000027"],
      // --- Interior E-W rows ---
      ["node_1740000000027","node_1740000000028"],
      ["node_1740000000028","node_1740000000029"],
      ["node_1740000000029","node_1740000000030"],
      ["node_1740000000030","node_1740000000031"],
      ["node_1740000000031","node_1740000000032"],
      ["node_1740000000032","node_1740000000033"],
      ["node_1740000000033","node_1740000000034"],
      ["node_1740000000034","node_1740000000035"],
      ["node_1740000000035","node_1740000000036"],
      ["node_1740000000036","node_1740000000037"],
      ["node_1740000000037","node_1740000000038"],
      ["node_1740000000038","node_1740000000039"],
      ["node_1740000000039","node_1740000000040"],
      ["node_1740000000040","node_1740000000041"],
      ["node_1740000000041","node_1740000000042"],
      ["node_1740000000042","node_1740000000043"],
      ["node_1740000000043","node_1740000000044"],
      ["node_1740000000044","node_1740000000045"],
      ["node_1740000000045","node_1740000000046"],
      ["node_1740000000046","node_1740000000023"],
      // --- Middle row (y~-3) full span ---
      ["node_1740000000046","node_1740000000047"],
      ["node_1740000000047","node_1740000000048"],
      ["node_1740000000048","node_1740000000049"],
      ["node_1740000000049","node_1740000000050"],
      ["node_1740000000050","node_1740000000043"],
      ["node_1740000000050","node_1740000000051"],
      ["node_1740000000051","node_1740000000052"],
      ["node_1740000000052","node_1740000000053"],
      ["node_1740000000053","node_1740000000038"],
      // --- N-S cross-links: top row to y=-35 row ---
      ["node_1740000000002","node_1740000000028"],
      ["node_1740000000003","node_1740000000029"],
      ["node_1740000000004","node_1740000000030"],
      ["node_1740000000005","node_1740000000031"],
      ["node_1740000000006","node_1740000000032"],
      ["node_1740000000007","node_1740000000033"],
      ["node_1740000000008","node_1740000000034"],
      // --- N-S cross-links: y=-35 row to middle row (y~-3) ---
      ["node_1740000000028","node_1740000000047"],
      ["node_1740000000029","node_1740000000048"],
      ["node_1740000000030","node_1740000000049"],
      ["node_1740000000031","node_1740000000050"],
      ["node_1740000000032","node_1740000000051"],
      ["node_1740000000033","node_1740000000052"],
      ["node_1740000000034","node_1740000000053"],
      // --- N-S cross-links: middle row (y~-3) to y=5.8 row ---
      ["node_1740000000048","node_1740000000045"],
      ["node_1740000000049","node_1740000000044"],
      ["node_1740000000051","node_1740000000042"],
      ["node_1740000000052","node_1740000000041"],
      ["node_1740000000053","node_1740000000040"],
      // --- Left edge shortcut ---
      ["node_1740000000024","node_1740000000047"],
      // --- Right-edge inner/outer shortcut ---
      ["node_1740000000011","node_1740000000035"],
      // --- Right-edge outer/inner cross-links ---
      ["node_1740000000012","node_1740000000036"],
      ["node_1740000000013","node_1740000000037"]
    ],

    // --- MOVEMENT CONFIG (percent-space) ---
    speed: 5.0,     // percent units / second (DO NOT set to 15)
    turnSpeed: 8.0, // rotation smoothing

    // Runtime nodes in percent space
    nodes: [],

    // pose in percent space (authoritative for CopCar3D)
    copPose: { x: 0, y: 0, heading: 0, speed: 0 },

    // Compatibility with app.js / older systems that expect these fields
    position: null,
    heading: 0,
    animationFrameId: null,
    patrolInterval: null,

    patrolState: { current: null, target: null, last: null, moving: false },
    lastUpdateTime: 0,

    _getNodeById(id) {
      return this.nodes.find(n => n.id === id) || null;
    },

    _buildPercentNodes() {
      this.nodes = this._nodesEditor.map(n => ({
        id: n.id,
        x: editorToPercentX(n.x),
        y: editorToPercentY(n.y)
      }));
    },

    init() {
      try {
        this._buildPercentNodes();
        console.log('🚓 [CopCarSystem] Node Patrol init (percent-space). Nodes:', this.nodes.length, 'Links:', this.links.length, 'Speed:', this.speed);

        if (this.nodes.length > 0) {
          this.patrolState.current = this.nodes[0].id;
          this.copPose.x = this.nodes[0].x;
          this.copPose.y = this.nodes[0].y;
        }

        this.position = this.copPose; // alias for DOM marker code paths
        this.lastUpdateTime = performance.now();

        // first render
        this.renderCopCar();

        // kick loop
        const tick = (now) => {
          this._update(now);
          this.animationFrameId = requestAnimationFrame(tick);
        };
        this.animationFrameId = requestAnimationFrame(tick);
      } catch (e) {
        console.error('[CopCarSystem] init failed:', e);
      }
    },

    // Optional compatibility: app.js calls this sometimes
    updateHeatLevel() { this.updateLights(); },

    updateLights() {
      const copCar = document.getElementById('cop-car');
      if (!copCar) return;

      // If GameState exists, color siren by heat; otherwise keep default
      const heat = (typeof window !== 'undefined' && window.GameState && window.GameState.player)
        ? Number(window.GameState.player.heat || 0)
        : 0;

      copCar.classList.remove('no-heat', 'medium-heat', 'high-heat');
      if (heat >= 75) copCar.classList.add('high-heat');
      else if (heat >= 30) copCar.classList.add('medium-heat');
      else copCar.classList.add('no-heat');
    },

    renderCopCar() {
      const copCar = document.getElementById('cop-car');
      if (copCar) {
        copCar.style.left = this.copPose.x + '%';
        copCar.style.top = this.copPose.y + '%';
      }
      this.heading = this.copPose.heading;
      this.position = this.copPose;
      this.updateLights();
    },

    _update(now) {
      const dt = (now - this.lastUpdateTime) / 1000;
      this.lastUpdateTime = now;

      if (this.nodes.length < 2) return;

      const state = this.patrolState;

      if (!state.moving) {
        const neighbors = this.links
          .filter(l => l[0] === state.current || l[1] === state.current)
          .map(l => (l[0] === state.current ? l[1] : l[0]));

        if (neighbors.length > 0) {
          let nextId = neighbors[Math.floor(Math.random() * neighbors.length)];
          if (neighbors.length > 1 && nextId === state.last) {
            nextId = neighbors.find(id => id !== state.last) || nextId;
          }
          state.target = nextId;
          state.moving = true;
        }
      } else {
        const targetNode = this._getNodeById(state.target);
        if (!targetNode) { state.moving = false; return; }

        const dx = targetNode.x - this.copPose.x;
        const dy = targetNode.y - this.copPose.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.5) {
          state.last = state.current;
          state.current = state.target;
          state.moving = false;
          this.copPose.speed = 0;
        } else {
          const moveDist = this.speed * dt;
          this.copPose.x += (dx / dist) * moveDist;
          this.copPose.y += (dy / dist) * moveDist;
          this.copPose.speed = this.speed;

          const targetHeading = Math.atan2(dx, dy);
          let diff = targetHeading - this.copPose.heading;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          this.copPose.heading += diff * this.turnSpeed * dt;
        }
      }

      this.renderCopCar();
    },

    // Debug helpers if you ever want to cross-check conversions
    _debug_percentToEditor: { percentToEditorX, percentToEditorY },
    _debug_editorToPercent: { editorToPercentX, editorToPercentY }
  };

  // Node data and patrol logic are now embedded in app.js CopCarSystem.
  // This module is kept as a reference but does NOT auto-init to avoid
  // conflicting with the app.js version which has full feature support
  // (heat, arrest, animation, etc.).
  if (typeof window !== 'undefined') {
    window._CopCarSystemModule = CopCarSystem; // available for debugging
  }
})();
