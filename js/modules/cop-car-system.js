/**
 * Cop Car System
 *
 * Simulates AI-driven 3D police car movement along roads on the turf map.
 * Keeps the car on roads, stops at intersections, exits and re‑enters the map,
 * and updates position (x, y), heading and speed in percent coordinates.
 *
 * This implementation uses a simple network of road segments defined in percent space.
 * Roads, intersections and entry/exit points can be customized to match your map layout.
 *
 * To enable the 3D cop car overlay, load this script (after three.js) before
 * `cop-car-3d.js`.  CopCar3D reads `window.CopCarSystem.copPose` for its
 * position and heading.  If you already have a CopCarSystem in your game,
 * you can merge the logic from this file into that system instead of
 * duplicating it.
 */

/* global requestAnimationFrame, performance */

(function () {
  /**
   * The main cop car system object.  It manages movement along a road
   * network, handles random stops at intersections and wraps around the
   * edges of the map.  Coordinates are stored in percentage units (0–100).
   */
  const CopCarSystem = {
    /**
     * A list of road definitions.  Each road is an object with an array
     * of points and a `bidirectional` flag.  Points are specified in
     * percent units relative to the city map.  You should modify these
     * values to match the roads in your own map.  The first and last
     * points may be outside the [0,100] range to allow the car to leave
     * the visible map before wrapping around to the other side.
     */
    roads: [
      // Vertical roads
      { points: [{ x: 20, y: -20 }, { x: 20, y: 120 }], bidirectional: true },
      { points: [{ x: 50, y: -20 }, { x: 50, y: 120 }], bidirectional: true },
      { points: [{ x: 80, y: -20 }, { x: 80, y: 120 }], bidirectional: true },
      // Horizontal roads
      { points: [{ x: -20, y: 20 }, { x: 120, y: 20 }], bidirectional: true },
      { points: [{ x: -20, y: 50 }, { x: 120, y: 50 }], bidirectional: true },
      { points: [{ x: -20, y: 80 }, { x: 120, y: 80 }], bidirectional: true }
    ],

    // Internal graph of nodes keyed by coordinate string to outgoing edges.
    _graph: null,
    // The currently active edge the car is traversing.
    currentEdge: null,
    // Progress along the current edge (0 ≤ progress < 1).
    progress: 0,
    /**
     * The current pose of the cop car.  CopCar3D reads these values to
     * position and orient the 3D model on the map.
     *  - `x` and `y` are percent coordinates on the map (0–100 is visible).
     *  - `heading` is measured as `Math.atan2(dx, dy)` – the angle from
     *    map north (positive Y) in radians.  This matches the convention
     *    expected by CopCar3D which negates the heading to get the yaw.
     *  - `speed` is the car’s velocity in percent units per second.
     */
    copPose: { x: 50, y: 50, heading: 0, speed: 0 },
    /**
     * The nominal cruise speed of the car (percent units per second).
     * Increase for a faster patrol; decrease for slower.  If you set
     * `minSpeed` and `maxSpeed`, the system will randomize speeds in
     * that range instead of using this constant value.
     */
    speed: 35,
    // Optional random speed range.  If both values are present the
    // system will pick a speed between minSpeed and maxSpeed.
    minSpeed: 15,
    maxSpeed: 40,
    // Range of stop durations at intersections, in seconds.
    intersectionStopRange: [1.0, 3.0],
    // Timestamp (ms) until which the car is paused at an intersection.
    pauseUntil: 0,
    // Internal timestamp of the previous update.
    lastUpdate: null,

    /**
     * Initialize the system.  Builds the road graph, chooses an initial
     * edge at random and starts the animation loop.
     */
    init() {
      this._buildGraph();
      this._chooseInitialEdge();
      this.lastUpdate = performance.now();
      requestAnimationFrame(this._update.bind(this));
    },

    /**
     * Build an adjacency list from the `roads` definitions.  Each entry in
     * `_graph` maps a node (keyed by x,y) to a list of outgoing edges.
     */
    _buildGraph() {
      this._graph = {};
      const roads = this.roads || [];
      const nodeKey = (pt) => `${pt.x.toFixed(3)},${pt.y.toFixed(3)}`;
      roads.forEach((road, rIdx) => {
        const pts = road.points;
        for (let i = 0; i < pts.length - 1; i++) {
          const from = pts[i];
          const to = pts[i + 1];
          // Add forward edge
          const addEdge = (a, b, dir) => {
            const k = nodeKey(a);
            if (!this._graph[k]) this._graph[k] = [];
            this._graph[k].push({ roadIndex: rIdx, segmentIdx: i, dir, from: a, to: b });
          };
          addEdge(from, to, 1);
          // Add reverse edge if bidirectional
          if (road.bidirectional) {
            addEdge(to, from, -1);
          }
        }
      });
    },

    /**
     * Choose a starting edge at random.  This picks a random node
     * in the graph and then chooses one of its outgoing edges.  It
     * initializes the car’s position and heading accordingly.
     */
    _chooseInitialEdge() {
      const nodes = Object.keys(this._graph);
      if (!nodes.length) return;
      const startKey = nodes[Math.floor(Math.random() * nodes.length)];
      const edges = this._graph[startKey];
      if (!edges || !edges.length) return;
      this.currentEdge = edges[Math.floor(Math.random() * edges.length)];
      this.progress = 0;
      const { from, to } = this.currentEdge;
      this.copPose.x = from.x;
      this.copPose.y = from.y;
      this.copPose.heading = Math.atan2(to.x - from.x, to.y - from.y);
      this.copPose.speed = 0;
    },

    /**
     * Choose the next edge when the car reaches the end of the current one.
     * Avoid reversing along the same road segment if possible.
     */
    _chooseNextEdge() {
      const key = (pt) => `${pt.x.toFixed(3)},${pt.y.toFixed(3)}`;
      const current = this.currentEdge;
      const toKey = key(current.to);
      const outgoing = this._graph[toKey] || [];
      // Filter out the direct reverse of our current segment
      const candidates = outgoing.filter((edge) => {
        return !(
          edge.roadIndex === current.roadIndex &&
          edge.segmentIdx === current.segmentIdx &&
          edge.dir === -current.dir
        );
      });
      let next = null;
      if (candidates.length) {
        next = candidates[Math.floor(Math.random() * candidates.length)];
      } else if (outgoing.length) {
        // If only option is to reverse, allow it
        next = outgoing[Math.floor(Math.random() * outgoing.length)];
      }
      return next;
    },

    /**
     * The main update loop.  Advances the car along the current edge
     * based on elapsed time and speed.  Handles stops at intersections,
     * chooses new edges as needed and wraps the car around map edges.
     */
    _update() {
      const now = performance.now();
      const dt = (now - this.lastUpdate) / 1000; // convert ms to seconds
      this.lastUpdate = now;
      if (!this.currentEdge) {
        requestAnimationFrame(this._update.bind(this));
        return;
      }
      // Pause at intersections if pauseUntil is in the future
      if (now < this.pauseUntil) {
        this.copPose.speed = 0;
        requestAnimationFrame(this._update.bind(this));
        return;
      }
      const from = this.currentEdge.from;
      const to = this.currentEdge.to;
      // Vector and length of the current segment
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const segLen = Math.sqrt(dx * dx + dy * dy) || 0.0001;
      // Determine speed: if minSpeed/maxSpeed are defined, randomize, otherwise use constant speed
      let moveSpeed;
      if (typeof this.minSpeed === 'number' && typeof this.maxSpeed === 'number') {
        moveSpeed = this.minSpeed + Math.random() * (this.maxSpeed - this.minSpeed);
      } else {
        moveSpeed = this.speed;
      }
      this.copPose.speed = moveSpeed;
      // Advance progress
      this.progress += (moveSpeed * dt) / segLen;
      if (this.progress >= 1) {
        // Snap to endpoint
        this.copPose.x = to.x;
        this.copPose.y = to.y;
        // Check for intersection: more than one outgoing edge
        const key = `${to.x.toFixed(3)},${to.y.toFixed(3)}`;
        const outEdges = this._graph[key] || [];
        if (outEdges.length > 1) {
          const [min, max] = this.intersectionStopRange;
          this.pauseUntil = now + (min + Math.random() * (max - min)) * 1000;
        }
        // Choose next edge
        const nextEdge = this._chooseNextEdge();
        if (!nextEdge) {
          // If we somehow end up with no next edge, choose a fresh starting edge
          this._chooseInitialEdge();
        } else {
          this.currentEdge = nextEdge;
          this.progress = 0;
        }
      } else {
        // Interpolate along the edge
        const p = this.progress;
        this.copPose.x = from.x + dx * p;
        this.copPose.y = from.y + dy * p;
      }
      // Compute heading for current edge (based solely on segment orientation)
      this.copPose.heading = Math.atan2(dx, dy);
      // Wrap around the edges: if car moves outside ±10% of map, re‑enter from opposite side
      if (
        this.copPose.x < -10 ||
        this.copPose.x > 110 ||
        this.copPose.y < -10 ||
        this.copPose.y > 110
      ) {
        if (this.copPose.x < -10) this.copPose.x = 110;
        if (this.copPose.x > 110) this.copPose.x = -10;
        if (this.copPose.y < -10) this.copPose.y = 110;
        if (this.copPose.y > 110) this.copPose.y = -10;
        // Reset to a random edge near the new position
        this._chooseInitialEdge();
      }
      // Queue the next frame
      requestAnimationFrame(this._update.bind(this));
    }
  };

  // Expose the system on the global window object
  if (typeof window !== 'undefined') {
    window.CopCarSystem = CopCarSystem;
  }
  // Auto‑initialize once the document is ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      CopCarSystem.init();
    } else {
      window.addEventListener('DOMContentLoaded', () => CopCarSystem.init());
    }
  }
})();