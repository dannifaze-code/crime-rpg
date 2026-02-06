/**
 * Cop Car System - Node Patrol Version (Generated from patrol_system_saved.html)
 *
 * Simulates AI-driven 3D police car movement using the Node/Link navigation
 * layout from the Turf Editor. Updates position, heading, and speed for the 3D renderer.
 *
 * Source of truth:
 *  - Nodes/Links/Config were extracted from patrol_system_saved.html (INITIAL_NODES / INITIAL_CONNECTIONS / CONFIG)
 *
 * Coordinate convention:
 *  - copPose.x / copPose.y are in your editor's percent-space.
 *  - heading is radians using Math.atan2(dx, dy) (dx first) to match CopCar3D's convention.
 */

/* global requestAnimationFrame, performance */

(function () {
  const CopCarSystem = {
    // --- DATA EXTRACTED FROM patrol_system_saved.html ---
    nodes: [
  {
    "id": "node_1770342713761910",
    "x": -32.014218009478675,
    "y": -36.580829566765395
  },
  {
    "id": "node_1770342715541766",
    "x": -10.450236966824642,
    "y": -23.14481054223933
  },
  {
    "id": "node_1770342718484543",
    "x": -32.51184834123223,
    "y": -6.225379178021324
  },
  {
    "id": "node_1770343027113607",
    "x": -1.6587677725118422,
    "y": -17.505000087499997
  },
  {
    "id": "node_1770343033468859",
    "x": 13.767772511848339,
    "y": -17.339123309419424
  },
  {
    "id": "node_1770343058711345",
    "x": 15.426540284360193,
    "y": -14.18746452588862
  },
  {
    "id": "node_1770343089971972",
    "x": 8.293838862559248,
    "y": -6.059502399940755
  },
  {
    "id": "node_1770343097431627",
    "x": 3.6492890995260603,
    "y": -5.893625621860187
  },
  {
    "id": "node_1770343198565465",
    "x": -30.687203791469198,
    "y": -37.907843791409945
  },
  {
    "id": "node_1770343315449964",
    "x": -1.9905213270142181,
    "y": 4.888364953376782
  },
  {
    "id": "node_1770343368039293",
    "x": -8.293838862559236,
    "y": 10.528175408116121
  },
  {
    "id": "node_1770343376731237",
    "x": -18.412322274881515,
    "y": 15.670355528613749
  },
  {
    "id": "node_1770343398921631",
    "x": -15.260663507109005,
    "y": 17.660876865580573
  },
  {
    "id": "node_177034341037863",
    "x": 0.0,
    "y": 8.371777293068725
  },
  {
    "id": "node_1770343424699408",
    "x": 5.639810426540291,
    "y": 3.727227506812796
  },
  {
    "id": "node_1770343440621198",
    "x": 9.289099526066352,
    "y": -1.746706169845969
  },
  {
    "id": "node_1770343477583787",
    "x": 12.938388625592411,
    "y": -8.381777293068712
  },
  {
    "id": "node_1770343500297254",
    "x": 17.251184834123222,
    "y": -11.865189632760655
  },
  {
    "id": "node_1770343506646569",
    "x": 23.388625592417064,
    "y": -13.19220385740521
  },
  {
    "id": "node_17703435255247",
    "x": 31.84834123222749,
    "y": -13.19220385740521
  },
  {
    "id": "node_1770343574513389",
    "x": 29.691943127962084,
    "y": -15.016848416291465
  },
  {
    "id": "node_1770343633423112",
    "x": -4.976303317535539,
    "y": 14.509218082049763
  },
  {
    "id": "node_1770343636362495",
    "x": -7.298578199052133,
    "y": 13.182203857405215
  },
  {
    "id": "node_1770343644477390",
    "x": 2.985781990521333,
    "y": 14.675094860130327
  },
  {
    "id": "node_1770343729239580",
    "x": 26.540284360189574,
    "y": -13.19220385740521
  },
  {
    "id": "node_1770343736293772",
    "x": 19.90521327014218,
    "y": -12.860450301244075
  },
  {
    "id": "node_1770343746095650",
    "x": 15.094786729857818,
    "y": -10.538175408116109
  },
  {
    "id": "node_1770343755417105",
    "x": 11.11374407582938,
    "y": -5.56187206569905
  },
  {
    "id": "node_1770343765374373",
    "x": 7.630331753554496,
    "y": 0.9073222794431265
  },
  {
    "id": "node_1770343773314782",
    "x": 3.3175355450236843,
    "y": 5.883625621860192
  },
  {
    "id": "node_1770343781294236",
    "x": -3.815165876777248,
    "y": 11.02580574235782
  },
  {
    "id": "node_1770343857155133",
    "x": 6.469194312796218,
    "y": 16.167985862855446
  },
  {
    "id": "node_1770343863407291",
    "x": -32.51184834123223,
    "y": 38.06372056949052
  },
  {
    "id": "node_1770343891667474",
    "x": -29.857819905213272,
    "y": 41.04950257494075
  },
  {
    "id": "node_1770343910848683",
    "x": 10.947867298578206,
    "y": 17.329123309419433
  },
  {
    "id": "node_1770343937059921",
    "x": 32.18009478672987,
    "y": 7.21063984650474
  },
  {
    "id": "node_1770343954510302",
    "x": 29.691943127962084,
    "y": 4.888364953376782
  },
  {
    "id": "node_1770343967086157",
    "x": -3.483412322274885,
    "y": 21.31016598335308
  },
  {
    "id": "node_1770344234841895",
    "x": 16.58767772511847,
    "y": -21.15428920527251
  },
  {
    "id": "node_1770344246675280",
    "x": 31.682464454976312,
    "y": -29.116374553139806
  },
  {
    "id": "node_1770344261923450",
    "x": 29.526066350710906,
    "y": -30.443388777784353
  },
  {
    "id": "node_1770344271407818",
    "x": 27.2037914691943,
    "y": -29.28225133122037
  },
  {
    "id": "node_1770344277147359",
    "x": 11.11374407582938,
    "y": -20.656658871030796
  },
  {
    "id": "node_1770344324440983",
    "x": -32.51184834123223,
    "y": -17.505000087499997
  },
  {
    "id": "node_1770344367757356",
    "x": -4.312796208530799,
    "y": -6.059502399940755
  },
  {
    "id": "node_1770344380028106",
    "x": -4.478672985781987,
    "y": -7.884146958827008
  },
  {
    "id": "node_1770344381473689",
    "x": -2.8199052132701454,
    "y": -9.377037961552132
  },
  {
    "id": "node_1770344382858717",
    "x": -1.1611374407582906,
    "y": -8.215900514988144
  },
  {
    "id": "node_1770344385496322",
    "x": -1.1611374407582906,
    "y": -6.225379178021324
  },
  {
    "id": "node_1770344386799938",
    "x": -2.8199052132701454,
    "y": -5.230118509537912
  }
],
    links: [
  [
    "node_1770342713761910",
    "node_1770342715541766"
  ],
  [
    "node_1770342715541766",
    "node_1770343027113607"
  ],
  [
    "node_1770343027113607",
    "node_1770343033468859"
  ],
  [
    "node_1770343033468859",
    "node_1770343058711345"
  ],
  [
    "node_1770343097431627",
    "node_1770342718484543"
  ],
  [
    "node_1770343089971972",
    "node_1770343097431627"
  ],
  [
    "node_1770343058711345",
    "node_1770343089971972"
  ],
  [
    "node_1770342713761910",
    "node_1770343198565465"
  ],
  [
    "node_1770343315449964",
    "node_1770343027113607"
  ],
  [
    "node_1770343315449964",
    "node_1770343368039293"
  ],
  [
    "node_1770343368039293",
    "node_1770343376731237"
  ],
  [
    "node_1770343376731237",
    "node_1770343398921631"
  ],
  [
    "node_1770343398921631",
    "node_177034341037863"
  ],
  [
    "node_177034341037863",
    "node_1770343424699408"
  ],
  [
    "node_1770343440621198",
    "node_1770343424699408"
  ],
  [
    "node_1770343440621198",
    "node_1770343477583787"
  ],
  [
    "node_1770343477583787",
    "node_1770343500297254"
  ],
  [
    "node_1770343506646569",
    "node_1770343500297254"
  ],
  [
    "node_17703435255247",
    "node_1770343506646569"
  ],
  [
    "node_1770343574513389",
    "node_17703435255247"
  ],
  [
    "node_1770343633423112",
    "node_1770343636362495"
  ],
  [
    "node_1770343633423112",
    "node_1770343644477390"
  ],
  [
    "node_1770343574513389",
    "node_1770343729239580"
  ],
  [
    "node_1770343729239580",
    "node_1770343736293772"
  ],
  [
    "node_1770343736293772",
    "node_1770343746095650"
  ],
  [
    "node_1770343746095650",
    "node_1770343755417105"
  ],
  [
    "node_1770343755417105",
    "node_1770343765374373"
  ],
  [
    "node_1770343765374373",
    "node_1770343773314782"
  ],
  [
    "node_1770343773314782",
    "node_1770343781294236"
  ],
  [
    "node_1770343636362495",
    "node_1770343781294236"
  ],
  [
    "node_1770343644477390",
    "node_1770343857155133"
  ],
  [
    "node_1770343863407291",
    "node_1770343857155133"
  ],
  [
    "node_1770343863407291",
    "node_1770343891667474"
  ],
  [
    "node_1770343891667474",
    "node_1770343910848683"
  ],
  [
    "node_1770343910848683",
    "node_1770343937059921"
  ],
  [
    "node_1770343954510302",
    "node_1770343937059921"
  ],
  [
    "node_1770343954510302",
    "node_1770343967086157"
  ],
  [
    "node_1770343398921631",
    "node_1770343967086157"
  ],
  [
    "node_1770343033468859",
    "node_1770344234841895"
  ],
  [
    "node_1770344234841895",
    "node_1770344246675280"
  ],
  [
    "node_1770344246675280",
    "node_1770344261923450"
  ],
  [
    "node_1770344261923450",
    "node_1770344271407818"
  ],
  [
    "node_1770344277147359",
    "node_1770344271407818"
  ],
  [
    "node_1770344277147359",
    "node_1770343027113607"
  ],
  [
    "node_1770343027113607",
    "node_1770344324440983"
  ],
  [
    "node_1770342718484543",
    "node_1770344367757356"
  ],
  [
    "node_1770344367757356",
    "node_1770344380028106"
  ],
  [
    "node_1770344381473689",
    "node_1770344380028106"
  ],
  [
    "node_1770344381473689",
    "node_1770344382858717"
  ],
  [
    "node_1770344385496322",
    "node_1770344382858717"
  ],
  [
    "node_1770344385496322",
    "node_1770344386799938"
  ],
  [
    "node_1770344386799938",
    "node_1770344367757356"
  ],
  [
    "node_1770344386799938",
    "node_1770343315449964"
  ]
],

    // --- MOVEMENT CONFIG (from CONFIG in patrol_system_saved.html) ---
    speed: 5.000,      // percent units per second (YES: 5.0)
    turnSpeed: 8.000,  // heading smoothing

    /**
     * The current pose of the cop car. CopCar3D reads these values.
     * x, y: map percentage coordinates.
     * heading: angle in radians.
     * speed: current speed (percent units/sec).
     */
    copPose: {
      x: -32.014218009478675,
      y: -36.580829566765395,
      heading: 0,
      speed: 0
    },

    // Internal Patrol Logic State
    patrolState: {
      current: null,
      target: null,
      last: null,
      moving: false
    },

    // Timing
    lastUpdateTime: 0,

    // Tuning
    arriveDistance: 0.5,     // snap-to-node threshold
    maxDt: 0.05,             // clamp dt to avoid huge jumps after tab-switch/lag spikes

    /**
     * Initialize the system. Builds initial state and starts animation loop.
     */
    init: function () {
      console.log('🚓 [CopCarSystem] Initializing Node Patrol (Speed: ' + this.speed.toFixed(1) + ')...');

      if (!this.nodes || this.nodes.length < 2) {
        console.warn('🚓 [CopCarSystem] Not enough nodes to patrol.');
        return;
      }

      // Start at first node
      this.patrolState.current = this.nodes[0].id;
      this.copPose.x = this.nodes[0].x;
      this.copPose.y = this.nodes[0].y;
      this.copPose.heading = 0;
      this.copPose.speed = 0;

      this.lastUpdateTime = performance.now();
      requestAnimationFrame(this._update.bind(this));
    },

    /**
     * The main movement loop.
     */
    _update: function (now) {
      let dt = (now - this.lastUpdateTime) / 1000;
      this.lastUpdateTime = now;

      if (dt > this.maxDt) dt = this.maxDt;
      if (dt < 0) dt = 0;

      if (!this.nodes || this.nodes.length < 2 || !this.links || this.links.length < 1) {
        requestAnimationFrame(this._update.bind(this));
        return;
      }

      const state = this.patrolState;

      if (!state.current) {
        state.current = this.nodes[0].id;
      }

      if (!state.moving) {
        // Find links connected to current node
        const neighbors = this.links
          .filter(l => l[0] === state.current || l[1] === state.current)
          .map(l => (l[0] === state.current ? l[1] : l[0]));

        if (neighbors.length > 0) {
          let nextId = neighbors[Math.floor(Math.random() * neighbors.length)];

          // Avoid immediate backtrack if other options exist
          if (neighbors.length > 1 && nextId === state.last) {
            nextId = neighbors.find(id => id !== state.last) || nextId;
          }

          state.target = nextId;
          state.moving = true;
        }
      } else {
        const targetNode = this.nodes.find(n => n.id === state.target);
        if (!targetNode) {
          state.moving = false;
          this.copPose.speed = 0;
          requestAnimationFrame(this._update.bind(this));
          return;
        }

        const dx = targetNode.x - this.copPose.x;
        const dy = targetNode.y - this.copPose.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.00001;

        // Arrived?
        if (dist < this.arriveDistance) {
          this.copPose.x = targetNode.x;
          this.copPose.y = targetNode.y;

          state.last = state.current;
          state.current = state.target;
          state.target = null;
          state.moving = false;

          this.copPose.speed = 0;
        } else {
          // Move toward target
          const moveDist = this.speed * dt;
          this.copPose.x += (dx / dist) * moveDist;
          this.copPose.y += (dy / dist) * moveDist;
          this.copPose.speed = this.speed;

          // Smooth heading toward movement direction
          const targetHeading = Math.atan2(dx, dy);
          let diff = targetHeading - this.copPose.heading;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          this.copPose.heading += diff * this.turnSpeed * dt;
        }
      }

      requestAnimationFrame(this._update.bind(this));
    }
  };

  // Expose to window for CopCar3D
  if (typeof window !== 'undefined') {
    window.CopCarSystem = CopCarSystem;

    if (typeof document !== 'undefined') {
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        CopCarSystem.init();
      } else {
        window.addEventListener('DOMContentLoaded', () => CopCarSystem.init());
      }
    } else {
      // No document, just init immediately
      CopCarSystem.init();
    }
  }
})();
