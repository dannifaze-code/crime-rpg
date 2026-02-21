/**
 * Turf Defense Enhanced Module
 * Adds 5 major features to the existing Turf Defense system:
 * 1. Enemy Variety (Runner, Tank, Shooter, Demolisher)
 * 2. Between-Wave Shop/Upgrade Phase
 * 3. Placeable Defenses (Turrets & Barricades)
 * 4. Special Abilities (Grenade, Adrenaline Rush, Medkit)
 * 5. Weather Integration (connects WeatherManager to defense gameplay)
 *
 * Dependencies (from global scope):
 * - GameState, TurfDefenseConfig, TurfDefenseRenderer
 * - WeatherOverlay (optional, for weather integration)
 */

// ========================================
// FEATURE 1: ENEMY TYPES
// ========================================

const EnemyTypes = {
  runner: {
    name: 'Runner',
    hp: 60,
    speed: 90,        // Fast
    damage: 6,
    attackCooldown: 1200,
    aggroRadius: 200,  // More aggressive
    attackRange: 60,
    color: '#E91E63',  // Pink
    aggroColor: '#FF1744',
    radius: 12,
    scoreValue: 75,
    lootMultiplier: 0.8
  },
  tank: {
    name: 'Tank',
    hp: 300,
    speed: 25,         // Slow
    damage: 20,
    attackCooldown: 2000,
    aggroRadius: 100,
    attackRange: 70,
    color: '#795548',  // Brown
    aggroColor: '#D84315',
    radius: 22,
    scoreValue: 200,
    lootMultiplier: 1.5
  },
  shooter: {
    name: 'Shooter',
    hp: 80,
    speed: 35,
    damage: 15,
    attackCooldown: 1800,
    aggroRadius: 250,  // Long range aggro
    attackRange: 180,  // Ranged attack
    color: '#FF9800',  // Orange
    aggroColor: '#FF6D00',
    radius: 14,
    scoreValue: 150,
    lootMultiplier: 1.2,
    isRanged: true
  },
  demolisher: {
    name: 'Demolisher',
    hp: 150,
    speed: 40,
    damage: 35,        // High building damage
    attackCooldown: 2500,
    aggroRadius: 80,   // Ignores player unless very close
    attackRange: 60,
    color: '#F44336',  // Red
    aggroColor: '#B71C1C',
    radius: 18,
    scoreValue: 175,
    lootMultiplier: 1.3,
    buildingDamageMultiplier: 2.0  // Double damage to buildings
  },
  // The original "standard" type for wave 1
  standard: {
    name: 'Thug',
    hp: 100,
    speed: 50,
    damage: 10,
    attackCooldown: 1500,
    aggroRadius: 150,
    attackRange: 80,
    color: '#9C27B0',  // Purple (original)
    aggroColor: '#F44336',
    radius: 15,
    scoreValue: 100,
    lootMultiplier: 1.0
  }
};

/**
 * Wave composition: defines which enemy types spawn per wave
 * Each entry is an array of { type, count }
 */
const WaveCompositions = {
  1: [{ type: 'standard', count: 2 }],
  2: [{ type: 'standard', count: 2 }, { type: 'runner', count: 2 }],
  3: [{ type: 'standard', count: 3 }, { type: 'runner', count: 2 }, { type: 'shooter', count: 1 }],
  4: [{ type: 'standard', count: 2 }, { type: 'runner', count: 3 }, { type: 'shooter', count: 2 }, { type: 'tank', count: 1 }],
  5: [{ type: 'standard', count: 2 }, { type: 'runner', count: 3 }, { type: 'shooter', count: 2 }, { type: 'tank', count: 2 }, { type: 'demolisher', count: 1 }],
  // Waves beyond 5 scale up
  6: [{ type: 'runner', count: 4 }, { type: 'shooter', count: 3 }, { type: 'tank', count: 2 }, { type: 'demolisher', count: 2 }],
  7: [{ type: 'runner', count: 5 }, { type: 'shooter', count: 4 }, { type: 'tank', count: 3 }, { type: 'demolisher', count: 3 }],
  8: [{ type: 'runner', count: 6 }, { type: 'shooter', count: 5 }, { type: 'tank', count: 4 }, { type: 'demolisher', count: 4 }]
};

/**
 * Get wave composition, with fallback scaling for high waves
 */
function getWaveComposition(wave) {
  if (WaveCompositions[wave]) return WaveCompositions[wave];
  // Scale beyond defined waves
  const baseCount = Math.min(wave, 20);
  return [
    { type: 'runner', count: Math.floor(baseCount * 0.3) },
    { type: 'shooter', count: Math.floor(baseCount * 0.25) },
    { type: 'tank', count: Math.floor(baseCount * 0.25) },
    { type: 'demolisher', count: Math.floor(baseCount * 0.2) }
  ];
}

/**
 * Create a typed enemy entity (replaces original createEnemy)
 */
function createTypedEnemy(id, spawnPos, typeName) {
  const typeConfig = EnemyTypes[typeName] || EnemyTypes.standard;
  // Apply weather modifiers to enemy stats
  const weatherMods = getTurfWeatherModifiers();

  return {
    id: id,
    x: spawnPos.x,
    y: spawnPos.y,
    hp: typeConfig.hp,
    maxHP: typeConfig.hp,
    visualHP: typeConfig.hp,
    state: 'moving',
    targetBuildingId: 'mainBase',
    targetStructureId: null,
    aggroed: false,
    lastAttackTime: 0,
    velocity: { x: 0, y: 0 },
    attackAnimT: 0,
    // New: enemy type info
    enemyType: typeName,
    typeConfig: typeConfig,
    speed: typeConfig.speed * weatherMods.enemySpeed,
    damage: typeConfig.damage,
    attackCooldown: typeConfig.attackCooldown,
    aggroRadius: typeConfig.aggroRadius,
    attackRange: typeConfig.attackRange,
    isRanged: typeConfig.isRanged || false,
    buildingDamageMultiplier: typeConfig.buildingDamageMultiplier || 1.0,
    // Shooter-specific: last ranged shot time
    lastRangedShotTime: 0,
    rangedProjectile: null
  };
}


// ========================================
// FEATURE 2: BETWEEN-WAVE SHOP
// ========================================

const TurfShop = {
  isOpen: false,
  overlay: null,
  defenseCash: 0,  // Separate currency earned during defense

  items: {
    healthKit: {
      name: '🩹 Health Kit',
      description: 'Restore 50 HP',
      cost: 150,
      action: function() {
        const defense = GameState.turfDefense;
        if (!defense.active) return false;
        if (defense.playerHP >= 100) return false; // Already full
        defense.playerHP = Math.min(100, defense.playerHP + 50);
        return true;
      }
    },
    fullHeal: {
      name: '💊 Full Heal',
      description: 'Restore to max HP',
      cost: 300,
      action: function() {
        const defense = GameState.turfDefense;
        if (!defense.active) return false;
        if (defense.playerHP >= 100) return false;
        defense.playerHP = 100;
        return true;
      }
    },
    ammoBox: {
      name: '📦 Ammo Box',
      description: '+3 Magazines',
      cost: 200,
      action: function() {
        const defense = GameState.turfDefense;
        if (!defense.active) return false;
        defense.magazineCount += 3;
        return true;
      }
    },
    damageBoost: {
      name: '💥 Damage Boost',
      description: '+25% shoot damage this run',
      cost: 400,
      maxPurchases: 3,
      purchased: 0,
      action: function() {
        const defense = GameState.turfDefense;
        if (!defense.active) return false;
        if (this.purchased >= this.maxPurchases) return false;
        if (!defense.damageMultiplier) defense.damageMultiplier = 1.0;
        defense.damageMultiplier += 0.25;
        this.purchased++;
        return true;
      }
    },
    speedBoost: {
      name: '👟 Speed Boots',
      description: '+20% movement speed this run',
      cost: 300,
      maxPurchases: 2,
      purchased: 0,
      action: function() {
        const defense = GameState.turfDefense;
        if (!defense.active) return false;
        if (this.purchased >= this.maxPurchases) return false;
        if (!defense.speedMultiplier) defense.speedMultiplier = 1.0;
        defense.speedMultiplier += 0.20;
        this.purchased++;
        return true;
      }
    },
    turret: {
      name: '🔫 Auto Turret',
      description: 'Place an auto-firing turret',
      cost: 500,
      action: function() {
        const defense = GameState.turfDefense;
        if (!defense.active) return false;
        if (!defense.placingDefense) {
          defense.placingDefense = 'turret';
          TurfShop.close();
          TurfShop.showPlacementMessage('Tap/click to place turret');
          return true;
        }
        return false;
      }
    },
    barricade: {
      name: '🧱 Barricade',
      description: 'Place a barrier that blocks enemies',
      cost: 250,
      action: function() {
        const defense = GameState.turfDefense;
        if (!defense.active) return false;
        if (!defense.placingDefense) {
          defense.placingDefense = 'barricade';
          TurfShop.close();
          TurfShop.showPlacementMessage('Tap/click to place barricade');
          return true;
        }
        return false;
      }
    },
    repairBase: {
      name: '🏗️ Repair Base',
      description: 'Restore 200 HP to main base',
      cost: 350,
      action: function() {
        const defense = GameState.turfDefense;
        if (!defense.active || !defense.structures) return false;
        const base = defense.structures.find(s => s.isCritical);
        if (!base || base.hp >= base.hpMax) return false;
        base.hp = Math.min(base.hpMax, base.hp + 200);
        return true;
      }
    }
  },

  /**
   * Award defense cash when enemies are killed
   */
  awardCash(amount) {
    this.defenseCash += amount;
  },

  /**
   * Open the between-wave shop overlay
   */
  open() {
    if (this.isOpen) return;
    this.isOpen = true;

    // Create overlay
    this.overlay = document.createElement('div');
    this.overlay.id = 'turf-shop-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.85);
      z-index: 10001;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 20px;
      overflow-y: auto;
      font-family: 'Courier New', monospace;
    `;

    // Title
    const title = document.createElement('div');
    title.style.cssText = 'color: #FFD700; font-size: 24px; font-weight: bold; margin-bottom: 5px; text-align: center;';
    title.textContent = '🏪 DEFENSE SHOP';
    this.overlay.appendChild(title);

    // Cash display
    const cashDisplay = document.createElement('div');
    cashDisplay.id = 'turf-shop-cash';
    cashDisplay.style.cssText = 'color: #4CAF50; font-size: 18px; margin-bottom: 15px; text-align: center;';
    cashDisplay.textContent = `Defense Cash: $${this.defenseCash}`;
    this.overlay.appendChild(cashDisplay);

    // Items grid
    const grid = document.createElement('div');
    grid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
      width: 100%;
      max-width: 600px;
    `;

    Object.keys(this.items).forEach(key => {
      const item = this.items[key];
      const canAfford = this.defenseCash >= item.cost;
      const maxedOut = item.maxPurchases && item.purchased >= item.maxPurchases;

      const card = document.createElement('div');
      card.style.cssText = `
        background: ${canAfford && !maxedOut ? 'rgba(76, 175, 80, 0.2)' : 'rgba(100, 100, 100, 0.2)'};
        border: 2px solid ${canAfford && !maxedOut ? '#4CAF50' : '#666'};
        border-radius: 8px;
        padding: 12px;
        text-align: center;
        cursor: ${canAfford && !maxedOut ? 'pointer' : 'not-allowed'};
        transition: transform 0.1s, border-color 0.2s;
        opacity: ${maxedOut ? '0.5' : '1'};
      `;

      card.innerHTML = `
        <div style="font-size: 16px; color: #fff; margin-bottom: 4px;">${item.name}</div>
        <div style="font-size: 11px; color: #aaa; margin-bottom: 6px;">${item.description}</div>
        <div style="font-size: 14px; color: ${canAfford ? '#4CAF50' : '#F44336'}; font-weight: bold;">$${item.cost}</div>
        ${maxedOut ? '<div style="font-size: 10px; color: #FF9800; margin-top: 2px;">MAX</div>' : ''}
      `;

      if (canAfford && !maxedOut) {
        card.addEventListener('click', () => {
          if (this.defenseCash >= item.cost) {
            const success = item.action.call(item);
            if (success) {
              this.defenseCash -= item.cost;
              // Refresh the shop display
              this.close();
              this.open();
            }
          }
        });
        card.addEventListener('mouseenter', () => { card.style.transform = 'scale(1.05)'; card.style.borderColor = '#FFD700'; });
        card.addEventListener('mouseleave', () => { card.style.transform = 'scale(1)'; card.style.borderColor = '#4CAF50'; });
      }

      grid.appendChild(card);
    });

    this.overlay.appendChild(grid);

    // Close button
    const closeBtn = document.createElement('div');
    closeBtn.style.cssText = `
      margin-top: 15px;
      padding: 10px 30px;
      background: #F44336;
      color: #fff;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      font-weight: bold;
      text-align: center;
    `;
    closeBtn.textContent = '▶ CONTINUE TO NEXT WAVE';
    closeBtn.addEventListener('click', () => {
      this.close();
      this.continueToNextWave();
    });
    this.overlay.appendChild(closeBtn);

    document.body.appendChild(this.overlay);
  },

  /**
   * Close the shop overlay
   */
  close() {
    this.isOpen = false;
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
      this.overlay = null;
    }
  },

  /**
   * Show placement instruction message
   */
  showPlacementMessage(text) {
    const msg = document.createElement('div');
    msg.id = 'turf-placement-msg';
    msg.style.cssText = `
      position: fixed;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.85);
      color: #FFD700;
      padding: 10px 24px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 16px;
      z-index: 10002;
      border: 2px solid #FFD700;
    `;
    msg.textContent = text;
    document.body.appendChild(msg);
    // Auto-remove after 5 seconds
    setTimeout(() => { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 5000);
  },

  /**
   * Continue to next wave after shop closes
   */
  continueToNextWave() {
    const defense = GameState.turfDefense;
    if (!defense.active || defense.waveState !== 'shopping') return;

    defense.wave++;
    defense.waveState = 'active';
    defense.waveStartTime = Date.now();
    console.log('🌊 [TurfDefense] Starting wave', defense.wave, '(from shop)');
  },

  /**
   * Reset shop state for new defense session
   */
  reset() {
    this.defenseCash = 0;
    this.isOpen = false;
    // Reset purchased counts
    Object.values(this.items).forEach(item => {
      if (item.purchased !== undefined) item.purchased = 0;
    });
    this.close();
  }
};


// ========================================
// FEATURE 3: PLACEABLE DEFENSES
// ========================================

const PlaceableDefenses = {
  /**
   * Turret configuration
   */
  TURRET_CONFIG: {
    hp: 150,
    range: 160,
    damage: 12,
    fireRate: 600,  // ms between shots
    radius: 16,
    color: '#00BCD4',
    cost: 500
  },

  /**
   * Barricade configuration
   */
  BARRICADE_CONFIG: {
    hp: 300,
    width: 50,
    height: 14,
    color: '#8D6E63',
    slowFactor: 0.3,  // Enemies move at 30% speed through barricades
    cost: 250
  },

  /**
   * Place a defense at given position
   */
  placeDefense(type, x, y) {
    const defense = GameState.turfDefense;
    if (!defense.active) return false;
    if (!defense.defenses) defense.defenses = [];

    if (type === 'turret') {
      defense.defenses.push({
        id: `turret_${Date.now()}`,
        type: 'turret',
        x: x,
        y: y,
        hp: this.TURRET_CONFIG.hp,
        maxHP: this.TURRET_CONFIG.hp,
        lastFireTime: 0,
        config: this.TURRET_CONFIG
      });
      console.log(`🔫 [Defense] Turret placed at (${x.toFixed(0)}, ${y.toFixed(0)})`);
      return true;
    }

    if (type === 'barricade') {
      defense.defenses.push({
        id: `barricade_${Date.now()}`,
        type: 'barricade',
        x: x,
        y: y,
        hp: this.BARRICADE_CONFIG.hp,
        maxHP: this.BARRICADE_CONFIG.hp,
        config: this.BARRICADE_CONFIG
      });
      console.log(`🧱 [Defense] Barricade placed at (${x.toFixed(0)}, ${y.toFixed(0)})`);
      return true;
    }

    return false;
  },

  /**
   * Update all placed defenses (turret AI, barricade damage)
   */
  update(dt) {
    const defense = GameState.turfDefense;
    if (!defense.active || !defense.defenses) return;

    const now = Date.now();

    defense.defenses = defense.defenses.filter(d => {
      if (d.hp <= 0) {
        console.log(`💥 [Defense] ${d.type} destroyed!`);
        return false;
      }

      // Turret AI: auto-target and shoot nearest enemy
      if (d.type === 'turret') {
        if (now - d.lastFireTime >= d.config.fireRate) {
          let nearestEnemy = null;
          let nearestDist = d.config.range;

          defense.enemies.forEach(enemy => {
            if (enemy.state === 'dead') return;
            const dist = Math.hypot(enemy.x - d.x, enemy.y - d.y);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestEnemy = enemy;
            }
          });

          if (nearestEnemy) {
            const dmgMult = defense.damageMultiplier || 1.0;
            const damage = Math.round(d.config.damage * dmgMult);
            nearestEnemy.hp -= damage;
            d.lastFireTime = now;

            // Spawn damage number
            if (typeof spawnDamageNumber === 'function') {
              spawnDamageNumber(nearestEnemy.x, nearestEnemy.y - 20, damage, 'damage');
            }

            // Aggro the enemy
            if (!nearestEnemy.aggroed) nearestEnemy.aggroed = true;

            // Check kill
            if (nearestEnemy.hp <= 0) {
              nearestEnemy.state = 'dead';
              defense.enemiesKilled++;
              const scoreVal = (nearestEnemy.typeConfig && nearestEnemy.typeConfig.scoreValue) || 100;
              defense.totalScore += scoreVal;
              TurfShop.awardCash(Math.round(scoreVal * 0.5));
              if (typeof spawnLoot === 'function') spawnLoot(nearestEnemy.x, nearestEnemy.y);
              setTimeout(() => {
                const idx = defense.enemies.indexOf(nearestEnemy);
                if (idx !== -1) defense.enemies.splice(idx, 1);
              }, 0);
            }
          }
        }
      }

      return true;
    });
  },

  /**
   * Check if an enemy is near a barricade (for slowdown effect)
   */
  getSlowFactor(enemyX, enemyY) {
    const defense = GameState.turfDefense;
    if (!defense.defenses) return 1.0;

    for (const d of defense.defenses) {
      if (d.type !== 'barricade' || d.hp <= 0) continue;
      const bw = d.config.width / 2;
      const bh = d.config.height / 2 + 15; // Extra range for slowdown
      if (enemyX >= d.x - bw && enemyX <= d.x + bw &&
          enemyY >= d.y - bh && enemyY <= d.y + bh) {
        // Enemy inside barricade zone - take damage over time from barricade
        d.hp -= 0.1; // Barricade degrades when enemies walk through
        return d.config.slowFactor;
      }
    }
    return 1.0;
  },

  /**
   * Draw all placed defenses
   */
  draw(ctx) {
    const defense = GameState.turfDefense;
    if (!defense.defenses) return;

    defense.defenses.forEach(d => {
      if (d.hp <= 0) return;

      if (d.type === 'turret') {
        // Draw turret base
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.config.radius, 0, Math.PI * 2);
        ctx.fillStyle = d.config.color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw turret gun barrel
        ctx.save();
        ctx.translate(d.x, d.y);
        // Rotate toward nearest enemy for visual feedback
        let angle = 0;
        if (defense.enemies) {
          let nearestDist = d.config.range;
          defense.enemies.forEach(enemy => {
            if (enemy.state === 'dead') return;
            const dist = Math.hypot(enemy.x - d.x, enemy.y - d.y);
            if (dist < nearestDist) {
              nearestDist = dist;
              angle = Math.atan2(enemy.y - d.y, enemy.x - d.x);
            }
          });
        }
        ctx.rotate(angle);
        ctx.fillStyle = '#37474F';
        ctx.fillRect(0, -3, d.config.radius + 8, 6);
        ctx.restore();

        // Range indicator (subtle)
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.config.range, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 188, 212, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // HP bar
        const hpPct = d.hp / d.maxHP;
        const barW = 30;
        ctx.fillStyle = '#000';
        ctx.fillRect(d.x - barW/2, d.y - d.config.radius - 12, barW, 4);
        ctx.fillStyle = hpPct > 0.5 ? '#4CAF50' : '#F44336';
        ctx.fillRect(d.x - barW/2, d.y - d.config.radius - 12, barW * hpPct, 4);

        // Label
        ctx.fillStyle = '#fff';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('TURRET', d.x, d.y + 4);
      }

      if (d.type === 'barricade') {
        const bw = d.config.width;
        const bh = d.config.height;

        // Draw barricade body
        ctx.fillStyle = d.config.color;
        ctx.fillRect(d.x - bw/2, d.y - bh/2, bw, bh);

        // Draw barricade lines (wood grain effect)
        ctx.strokeStyle = '#5D4037';
        ctx.lineWidth = 1;
        for (let i = 0; i < bw; i += 10) {
          ctx.beginPath();
          ctx.moveTo(d.x - bw/2 + i, d.y - bh/2);
          ctx.lineTo(d.x - bw/2 + i, d.y + bh/2);
          ctx.stroke();
        }

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.strokeRect(d.x - bw/2, d.y - bh/2, bw, bh);

        // HP bar
        const hpPct = d.hp / d.maxHP;
        ctx.fillStyle = '#000';
        ctx.fillRect(d.x - bw/2, d.y - bh/2 - 8, bw, 4);
        ctx.fillStyle = hpPct > 0.5 ? '#4CAF50' : '#F44336';
        ctx.fillRect(d.x - bw/2, d.y - bh/2 - 8, bw * hpPct, 4);
      }
    });

    // Draw placement preview if placing
    if (defense.placingDefense) {
      const mousePos = defense._mousePos;
      if (mousePos) {
        ctx.globalAlpha = 0.5;
        if (defense.placingDefense === 'turret') {
          ctx.beginPath();
          ctx.arc(mousePos.x, mousePos.y, 16, 0, Math.PI * 2);
          ctx.fillStyle = '#00BCD4';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
          // Range preview
          ctx.beginPath();
          ctx.arc(mousePos.x, mousePos.y, 160, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0, 188, 212, 0.3)';
          ctx.stroke();
        } else if (defense.placingDefense === 'barricade') {
          ctx.fillStyle = '#8D6E63';
          ctx.fillRect(mousePos.x - 25, mousePos.y - 7, 50, 14);
          ctx.strokeStyle = '#fff';
          ctx.strokeRect(mousePos.x - 25, mousePos.y - 7, 50, 14);
        }
        ctx.globalAlpha = 1.0;
      }
    }
  },

  /**
   * Reset all defenses
   */
  reset() {
    const defense = GameState.turfDefense;
    if (defense) {
      defense.defenses = [];
      defense.placingDefense = null;
    }
  }
};


// ========================================
// FEATURE 4: SPECIAL ABILITIES
// ========================================

const TurfAbilities = {
  abilities: {
    grenade: {
      name: 'Grenade',
      icon: '💣',
      cooldown: 8000,  // 8 seconds
      lastUsed: 0,
      radius: 100,     // AoE radius
      damage: 80,
      description: 'Throw a grenade dealing 80 AoE damage',
      use: function(defense) {
        const now = Date.now();
        if (now - this.lastUsed < this.cooldown) return false;

        // Find cluster of enemies near player
        const px = defense.playerX;
        const py = defense.playerY;

        // Target the densest enemy cluster within range
        let bestX = px;
        let bestY = py - 80; // Default: throw forward
        let bestCount = 0;

        defense.enemies.forEach(e => {
          if (e.state === 'dead') return;
          const dist = Math.hypot(e.x - px, e.y - py);
          if (dist > 200) return; // Max throw range
          // Count enemies near this enemy
          let nearbyCount = 0;
          defense.enemies.forEach(e2 => {
            if (e2.state === 'dead') return;
            if (Math.hypot(e2.x - e.x, e2.y - e.y) < this.radius) nearbyCount++;
          });
          if (nearbyCount > bestCount) {
            bestCount = nearbyCount;
            bestX = e.x;
            bestY = e.y;
          }
        });

        // Apply AoE damage
        let hits = 0;
        defense.enemies.forEach(enemy => {
          if (enemy.state === 'dead') return;
          const dist = Math.hypot(enemy.x - bestX, enemy.y - bestY);
          if (dist < this.radius) {
            const falloffDmg = Math.round(this.damage * (1 - dist / this.radius * 0.5));
            enemy.hp -= falloffDmg;
            if (typeof spawnDamageNumber === 'function') {
              spawnDamageNumber(enemy.x, enemy.y - 20, falloffDmg, 'crit');
            }
            if (!enemy.aggroed) enemy.aggroed = true;
            hits++;

            if (enemy.hp <= 0) {
              enemy.state = 'dead';
              defense.enemiesKilled++;
              const scoreVal = (enemy.typeConfig && enemy.typeConfig.scoreValue) || 100;
              defense.totalScore += scoreVal;
              TurfShop.awardCash(Math.round(scoreVal * 0.5));
              if (typeof spawnLoot === 'function') spawnLoot(enemy.x, enemy.y);
              setTimeout(() => {
                const idx = defense.enemies.indexOf(enemy);
                if (idx !== -1) defense.enemies.splice(idx, 1);
              }, 0);
            }
          }
        });

        // Visual explosion effect stored for rendering
        if (!defense.explosions) defense.explosions = [];
        defense.explosions.push({
          x: bestX, y: bestY,
          radius: this.radius,
          startTime: now,
          duration: 500
        });

        this.lastUsed = now;
        console.log(`💣 [Grenade] Thrown at (${bestX.toFixed(0)}, ${bestY.toFixed(0)}), hit ${hits} enemies`);
        return true;
      }
    },

    adrenaline: {
      name: 'Adrenaline Rush',
      icon: '⚡',
      cooldown: 15000, // 15 seconds
      lastUsed: 0,
      duration: 5000,  // 5 seconds of boost
      speedBoost: 2.0,
      fireRateBoost: 0.5, // Fire 2x faster
      description: 'Double speed & fire rate for 5s',
      use: function(defense) {
        const now = Date.now();
        if (now - this.lastUsed < this.cooldown) return false;

        defense.adrenalineActive = true;
        defense.adrenalineEnd = now + this.duration;
        this.lastUsed = now;
        console.log('⚡ [Adrenaline] Rush activated!');
        return true;
      }
    },

    medkit: {
      name: 'Medkit',
      icon: '🩹',
      cooldown: 20000, // 20 seconds
      lastUsed: 0,
      healAmount: 40,
      description: 'Instantly heal 40 HP',
      use: function(defense) {
        const now = Date.now();
        if (now - this.lastUsed < this.cooldown) return false;
        if (defense.playerHP >= 100) return false;

        defense.playerHP = Math.min(100, defense.playerHP + this.healAmount);
        this.lastUsed = now;

        if (typeof spawnDamageNumber === 'function') {
          spawnDamageNumber(defense.playerX, defense.playerY - 30, `+${this.healAmount}`, 'heal');
        }
        console.log(`🩹 [Medkit] Healed ${this.healAmount} HP`);
        return true;
      }
    }
  },

  /**
   * Try to use an ability by key
   */
  useAbility(abilityKey) {
    const defense = GameState.turfDefense;
    if (!defense.active || defense.waveState !== 'active') return false;

    const ability = this.abilities[abilityKey];
    if (!ability) return false;

    return ability.use.call(ability, defense);
  },

  /**
   * Update abilities (check adrenaline expiry, etc.)
   */
  update(dt) {
    const defense = GameState.turfDefense;
    if (!defense.active) return;

    const now = Date.now();

    // Check adrenaline expiry
    if (defense.adrenalineActive && now >= defense.adrenalineEnd) {
      defense.adrenalineActive = false;
      console.log('⚡ [Adrenaline] Rush ended');
    }

    // Update explosion effects
    if (defense.explosions) {
      defense.explosions = defense.explosions.filter(exp => {
        return (now - exp.startTime) < exp.duration;
      });
    }
  },

  /**
   * Get speed multiplier (for adrenaline)
   */
  getSpeedMultiplier() {
    const defense = GameState.turfDefense;
    if (defense.adrenalineActive) return this.abilities.adrenaline.speedBoost;
    return 1.0;
  },

  /**
   * Get fire rate multiplier (for adrenaline)
   */
  getFireRateMultiplier() {
    const defense = GameState.turfDefense;
    if (defense.adrenalineActive) return this.abilities.adrenaline.fireRateBoost;
    return 1.0;
  },

  /**
   * Draw ability cooldown HUD
   */
  drawHUD(ctx, defense, width, height) {
    const now = Date.now();
    const abilityKeys = Object.keys(this.abilities);
    const barY = height - 50;
    const barStartX = width / 2 - (abilityKeys.length * 55) / 2;

    abilityKeys.forEach((key, i) => {
      const ability = this.abilities[key];
      const elapsed = now - ability.lastUsed;
      const ready = elapsed >= ability.cooldown;
      const cooldownPct = Math.min(1, elapsed / ability.cooldown);
      const x = barStartX + i * 55;

      // Background
      ctx.fillStyle = ready ? 'rgba(76, 175, 80, 0.4)' : 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(x, barY, 48, 40);
      ctx.strokeStyle = ready ? '#4CAF50' : '#666';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, barY, 48, 40);

      // Cooldown overlay
      if (!ready) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(x, barY, 48, 40 * (1 - cooldownPct));
      }

      // Icon
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ability.icon, x + 24, barY + 16);

      // Key binding label
      ctx.font = '9px monospace';
      ctx.fillStyle = ready ? '#fff' : '#888';
      ctx.fillText(`[${i + 1}]`, x + 24, barY + 34);

      // Cooldown timer
      if (!ready) {
        const remaining = Math.ceil((ability.cooldown - elapsed) / 1000);
        ctx.font = 'bold 12px monospace';
        ctx.fillStyle = '#FF9800';
        ctx.fillText(`${remaining}s`, x + 24, barY + 16);
      }
    });
  },

  /**
   * Draw explosion effects
   */
  drawExplosions(ctx) {
    const defense = GameState.turfDefense;
    if (!defense.explosions) return;

    const now = Date.now();
    defense.explosions.forEach(exp => {
      const progress = (now - exp.startTime) / exp.duration;
      if (progress >= 1) return;

      const currentRadius = exp.radius * (0.3 + progress * 0.7);
      const alpha = 1 - progress;

      // Outer blast
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, currentRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 152, 0, ${alpha * 0.3})`;
      ctx.fill();

      // Inner flash
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, currentRadius * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 235, 59, ${alpha * 0.6})`;
      ctx.fill();

      // Core
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, currentRadius * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
      ctx.fill();
    });
  },

  /**
   * Reset ability cooldowns
   */
  reset() {
    Object.values(this.abilities).forEach(ability => {
      ability.lastUsed = 0;
    });
  }
};


// ========================================
// FEATURE 5: WEATHER INTEGRATION
// ========================================

/**
 * Get current weather type from the WeatherManager system
 */
function getCurrentTurfWeather() {
  try {
    if (typeof WeatherOverlay !== 'undefined' &&
        WeatherOverlay.weatherManager &&
        WeatherOverlay.weatherManager.activeWeatherType) {
      return WeatherOverlay.weatherManager.activeWeatherType;
    }
    if (typeof GameState !== 'undefined' && GameState.weather && GameState.weather.currentType) {
      return GameState.weather.currentType;
    }
  } catch (e) {}
  return 'clear';
}

/**
 * Weather modifiers for turf defense gameplay
 */
const TurfWeatherMods = {
  clear: {
    enemySpeed: 1.0,
    playerVisibility: 1.0,
    playerDamage: 1.0,
    enemyDamage: 1.0,
    description: 'Clear skies — no modifiers',
    icon: '☀️'
  },
  fog: {
    enemySpeed: 0.85,
    playerVisibility: 0.6,   // Reduced visibility
    playerDamage: 0.9,
    enemyDamage: 0.9,
    description: 'Fog — enemies slower, reduced shoot range',
    icon: '🌫️'
  },
  rain: {
    enemySpeed: 0.9,
    playerVisibility: 0.8,
    playerDamage: 1.0,
    enemyDamage: 0.95,
    description: 'Rain — enemies slightly slower',
    icon: '🌧️'
  },
  storm: {
    enemySpeed: 0.75,
    playerVisibility: 0.65,
    playerDamage: 1.1,        // Lightning-charged shots
    enemyDamage: 1.15,
    description: 'Storm — dangerous for everyone, +10% damage',
    icon: '⛈️'
  },
  snow: {
    enemySpeed: 0.7,
    playerVisibility: 0.85,
    playerDamage: 0.95,
    enemyDamage: 0.85,
    description: 'Snow — enemies much slower, less damage',
    icon: '❄️'
  },
  heat: {
    enemySpeed: 1.15,
    playerVisibility: 1.0,
    playerDamage: 1.0,
    enemyDamage: 1.2,
    description: 'Heat wave — enemies faster and hit harder',
    icon: '🔥'
  }
};

/**
 * Get turf defense weather modifiers based on current weather
 */
function getTurfWeatherModifiers() {
  const weather = getCurrentTurfWeather();
  return TurfWeatherMods[weather] || TurfWeatherMods.clear;
}


// ========================================
// INTEGRATION: Hook into existing systems
// ========================================

/**
 * Enhanced enemy spawning (replaces original spawnWaveEnemies logic)
 * Called from the patched spawnWaveEnemies in app.js
 */
function spawnEnhancedWaveEnemies() {
  const defense = GameState.turfDefense;
  const wave = defense.wave;
  const composition = getWaveComposition(wave);

  console.log(`🌊 [Enhanced] Spawning wave ${wave} with composition:`, composition.map(c => `${c.count}x ${c.type}`).join(', '));

  // Get map dimensions
  const mapWidth = (GameState.map && GameState.map.width) || 30;
  const mapHeight = (GameState.map && GameState.map.height) || 30;
  const tileSize = 30;
  const canvasWidth = mapWidth * tileSize;
  const canvasHeight = mapHeight * tileSize;

  // Calculate total enemies
  const totalEnemies = composition.reduce((sum, c) => sum + c.count, 0);

  // Generate spawn positions around edges of map
  const spawnPositions = [];
  const margin = 70;
  const numSpawns = Math.max(8, totalEnemies);

  for (let i = 0; i < numSpawns; i++) {
    const angle = (i / numSpawns) * Math.PI * 2;
    const radius = Math.min(canvasWidth, canvasHeight) / 2 - margin;
    const x = canvasWidth / 2 + Math.cos(angle) * radius;
    const y = canvasHeight / 2 + Math.sin(angle) * radius;
    spawnPositions.push({ x, y });
  }

  // Find structures for targeting
  const mainBase = defense.structures ? defense.structures.find(s => s.isCritical) : null;
  const structures = defense.structures || [];
  const safeStructures = structures.filter(s => !s.nearEdge && s.hp > 0);

  let spawnIdx = 0;

  composition.forEach(entry => {
    for (let i = 0; i < entry.count; i++) {
      const spawnPos = spawnPositions[spawnIdx % spawnPositions.length];
      const enemy = createTypedEnemy(`enemy_${wave}_${spawnIdx}`, spawnPos, entry.type);

      // Assign target structure
      if (entry.type === 'demolisher') {
        // Demolishers always target buildings, preferring non-critical
        const targets = safeStructures.filter(s => !s.isCritical && s.hp > 0);
        if (targets.length > 0) {
          enemy.targetStructureId = targets[spawnIdx % targets.length].id;
        } else if (mainBase) {
          enemy.targetStructureId = mainBase.id;
        }
      } else if (mainBase && (spawnIdx % 3 === 0 || structures.length === 1)) {
        enemy.targetStructureId = mainBase.id;
      } else if (safeStructures.length > 0) {
        const safeNonCritical = safeStructures.filter(s => !s.isCritical);
        if (safeNonCritical.length > 0) {
          enemy.targetStructureId = safeNonCritical[spawnIdx % safeNonCritical.length].id;
        } else {
          enemy.targetStructureId = safeStructures[spawnIdx % safeStructures.length].id;
        }
      } else {
        enemy.targetStructureId = mainBase ? mainBase.id : (structures[0] ? structures[0].id : null);
      }

      defense.enemies.push(enemy);
      spawnIdx++;
    }
  });

  defense.lastSpawnTime = Date.now();
  console.log(`🌊 [Enhanced] Spawned ${spawnIdx} enemies total for wave ${wave}`);
}

/**
 * Enhanced enemy AI update (replaces original updateEnemyAI logic)
 * Adds type-specific behavior, weather effects, and barricade interaction
 */
function updateEnhancedEnemyAI(enemy, dt, defense) {
  if (enemy.state === 'dead') return;

  const playerX = defense.playerX || 450;
  const playerY = defense.playerY || 450;
  const typeConfig = enemy.typeConfig || EnemyTypes.standard;
  const weatherMods = getTurfWeatherModifiers();

  // Apply weather to enemy speed
  const effectiveSpeed = (enemy.speed || typeConfig.speed) * weatherMods.enemySpeed;

  // Check for proximity aggro
  if (!enemy.aggroed) {
    const distToPlayer = Math.hypot(enemy.x - playerX, enemy.y - playerY);
    if (distToPlayer < (enemy.aggroRadius || typeConfig.aggroRadius)) {
      enemy.aggroed = true;
    }
  }

  // Demolishers don't aggro on player (they focus buildings) unless player is very close
  if (enemy.enemyType === 'demolisher' && enemy.aggroed) {
    const distToPlayer = Math.hypot(enemy.x - playerX, enemy.y - playerY);
    if (distToPlayer > 60) {
      enemy.aggroed = false; // De-aggro if player moves away
    }
  }

  // Determine target
  let targetX, targetY, targetType;

  if (enemy.aggroed) {
    targetX = playerX;
    targetY = playerY;
    targetType = 'player';
  } else {
    const structure = defense.structures ? defense.structures.find(s => s.id === enemy.targetStructureId) : null;
    if (structure && structure.hp > 0) {
      targetX = structure.x;
      targetY = structure.y;
      targetType = 'structure';
    } else {
      // Find new target
      const aliveStructures = defense.structures ? defense.structures.filter(s => s.hp > 0) : [];
      if (aliveStructures.length > 0) {
        const safeAlive = aliveStructures.filter(s => !s.nearEdge);
        const pool = safeAlive.length > 0 ? safeAlive : aliveStructures;
        let nearestDist = Infinity;
        let nearest = null;
        pool.forEach(s => {
          const dist = Math.hypot(s.x - enemy.x, s.y - enemy.y);
          if (dist < nearestDist) { nearestDist = dist; nearest = s; }
        });
        if (nearest) {
          enemy.targetStructureId = nearest.id;
          targetX = nearest.x;
          targetY = nearest.y;
          targetType = 'structure';
        }
      }
    }
  }

  if (!targetX || !targetY) return;

  const dx = targetX - enemy.x;
  const dy = targetY - enemy.y;
  const distToTarget = Math.sqrt(dx * dx + dy * dy);
  const attackRange = enemy.attackRange || typeConfig.attackRange;

  if (distToTarget < attackRange) {
    enemy.velocity.x = 0;
    enemy.velocity.y = 0;

    if (targetType === 'player') {
      enemy.state = 'attackingPlayer';
      // Use type-specific damage and cooldown
      const now = Date.now();
      const cd = enemy.attackCooldown || typeConfig.attackCooldown;
      if (now - enemy.lastAttackTime >= cd) {
        const dmg = Math.round((enemy.damage || typeConfig.damage) * weatherMods.enemyDamage);
        defense.playerHP -= dmg;
        enemy.lastAttackTime = now;
        if (typeof spawnDamageNumber === 'function') {
          spawnDamageNumber(playerX, playerY - 30, dmg, 'damage');
        }
        enemy.attackAnimT = 300;
        if (defense.playerHP <= 0) defense.waveState = 'failed';
      }
    } else {
      enemy.state = 'attackingBuilding';
      const now = Date.now();
      const cd = enemy.attackCooldown || typeConfig.attackCooldown;
      if (now - enemy.lastAttackTime >= cd) {
        const baseDmg = enemy.damage || typeConfig.damage;
        const bldgMult = enemy.buildingDamageMultiplier || 1.0;
        const dmg = Math.round(baseDmg * bldgMult * weatherMods.enemyDamage);
        const structure = defense.structures.find(s => s.id === enemy.targetStructureId);
        if (structure && structure.hp > 0) {
          structure.hp -= dmg;
          enemy.lastAttackTime = now;
          structure.hitFlashT = 150;
          structure.hitShakeT = 200;
          structure.lastDamageTime = now;
          enemy.attackAnimT = 300;
          if (typeof spawnDamageNumber === 'function') {
            spawnDamageNumber(structure.x, structure.y - 30, dmg, 'damage');
          }
          if (structure.hp <= 0 && structure.isCritical) {
            defense.waveState = 'failed';
          }
        }
      }
    }
  } else {
    enemy.state = 'moving';
    const dirX = dx / distToTarget;
    const dirY = dy / distToTarget;

    // Check barricade slowdown
    const slowFactor = PlaceableDefenses.getSlowFactor(enemy.x, enemy.y);

    enemy.velocity.x = dirX * effectiveSpeed * slowFactor;
    enemy.velocity.y = dirY * effectiveSpeed * slowFactor;

    enemy.x += enemy.velocity.x * dt;
    enemy.y += enemy.velocity.y * dt;

    // Clamp to map bounds
    const mapWidth = (GameState.map && GameState.map.width) || 30;
    const mapHeight = (GameState.map && GameState.map.height) || 30;
    const canvasWidth = mapWidth * 30;
    const canvasHeight = mapHeight * 30;
    const r = typeConfig.radius || 15;
    enemy.x = Math.max(r, Math.min(canvasWidth - r, enemy.x));
    enemy.y = Math.max(r, Math.min(canvasHeight - r, enemy.y));
  }
}

/**
 * Enhanced enemy drawing (replaces original drawEnemy)
 * Draws enemies with type-specific visuals
 */
function drawEnhancedEnemy(ctx, enemy) {
  if (enemy.state === 'dead') return;

  const typeConfig = enemy.typeConfig || EnemyTypes.standard;
  const hpPercent = (enemy.visualHP || enemy.hp) / enemy.maxHP;
  const scaleFactor = (GameState.turfDefense && GameState.turfDefense._enemyScaleFactor) || 1;
  const r = (typeConfig.radius || 15) * scaleFactor;

  // Try 3D sprite first
  let drew3D = false;
  if (window.Enemy3DRenderer && Enemy3DRenderer._spriteCacheReady) {
    if (!enemy._spriteId) {
      const ids = (typeof ENEMY_SPRITE_IDS !== 'undefined') ? ENEMY_SPRITE_IDS : [];
      enemy._spriteId = ids.length > 0 ? ids[Math.floor(Math.random() * ids.length)] : null;
    }
    const sprite = enemy._spriteId ? Enemy3DRenderer.getCachedSprite(enemy._spriteId) : Enemy3DRenderer.getRandomCachedSprite();
    if (sprite && sprite.complete) {
      const drawSize = r * 3;
      ctx.save();
      if (enemy.state === 'attackingPlayer' || enemy.aggroed) ctx.globalAlpha = 0.85;
      ctx.drawImage(sprite, enemy.x - drawSize / 2, enemy.y - drawSize / 2, drawSize, drawSize);
      ctx.restore();
      drew3D = true;
    }
  }

  // Fallback: type-specific colored circle
  if (!drew3D) {
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, r, 0, Math.PI * 2);

    // Use type-specific color
    if (enemy.aggroed || enemy.state === 'attackingPlayer') {
      ctx.fillStyle = typeConfig.aggroColor || '#F44336';
    } else {
      ctx.fillStyle = typeConfig.color || '#9C27B0';
    }
    ctx.fill();

    ctx.strokeStyle = enemy.aggroed ? '#fff' : '#666';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Type-specific visual indicators
    if (enemy.enemyType === 'tank') {
      // Draw shield icon
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, r * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    } else if (enemy.enemyType === 'shooter') {
      // Draw crosshair
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 1;
      const cr = r * 0.5;
      ctx.beginPath();
      ctx.moveTo(enemy.x - cr, enemy.y);
      ctx.lineTo(enemy.x + cr, enemy.y);
      ctx.moveTo(enemy.x, enemy.y - cr);
      ctx.lineTo(enemy.x, enemy.y + cr);
      ctx.stroke();
    } else if (enemy.enemyType === 'demolisher') {
      // Draw explosion icon
      ctx.fillStyle = '#FFD700';
      ctx.font = `${Math.round(r)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💥', enemy.x, enemy.y);
    } else if (enemy.enemyType === 'runner') {
      // Draw speed lines
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(enemy.x - r - 5, enemy.y - 3);
      ctx.lineTo(enemy.x - r - 12, enemy.y - 3);
      ctx.moveTo(enemy.x - r - 3, enemy.y + 3);
      ctx.lineTo(enemy.x - r - 10, enemy.y + 3);
      ctx.stroke();
    }
  }

  // HP bar
  const barWidth = Math.max(30, r * 2.2);
  const barHeight = 5;
  const barX = enemy.x - barWidth / 2;
  const barY = enemy.y - r - 14;

  ctx.fillStyle = '#000';
  ctx.fillRect(barX, barY, barWidth, barHeight);
  const fillWidth = barWidth * Math.max(0, Math.min(1, hpPercent));
  ctx.fillStyle = hpPercent > 0.5 ? '#4CAF50' : hpPercent > 0.25 ? '#FFC107' : '#F44336';
  ctx.fillRect(barX, barY, fillWidth, barHeight);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barWidth, barHeight);

  // Type name label (small)
  ctx.fillStyle = '#ddd';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(typeConfig.name, enemy.x, barY - 3);

  // Attack animation
  if (enemy.attackAnimT > 0) {
    const animProgress = enemy.attackAnimT / 300;
    if (enemy.state === 'attackingBuilding') {
      ctx.save();
      ctx.globalAlpha = animProgress * 0.8;
      ctx.strokeStyle = '#FF6B00';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, 20, -Math.PI / 6, Math.PI / 6);
      ctx.stroke();
      ctx.restore();
    }
    if (enemy.state === 'attackingPlayer') {
      ctx.save();
      ctx.globalAlpha = animProgress;
      ctx.fillStyle = '#FFFF00';
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Aggro indicator
  if (enemy.aggroed) {
    ctx.fillStyle = '#FF0000';
    ctx.font = '16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('!', enemy.x, enemy.y - r - 20);
  }
}

/**
 * Enhanced HUD drawing - adds weather info, shop cash, and wave preview
 */
function drawEnhancedHUD(ctx, defense, width, height) {
  const weatherMods = getTurfWeatherModifiers();
  const weatherType = getCurrentTurfWeather();
  const weatherInfo = TurfWeatherMods[weatherType] || TurfWeatherMods.clear;

  // Weather indicator (top center)
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFD700';
  ctx.fillText(`${weatherInfo.icon} ${weatherType.toUpperCase()}`, width / 2, 20);
  ctx.font = '10px monospace';
  ctx.fillStyle = '#aaa';
  ctx.fillText(weatherInfo.description, width / 2, 34);

  // Defense cash (top right, below original HUD)
  ctx.textAlign = 'right';
  ctx.font = 'bold 14px monospace';
  ctx.fillStyle = '#4CAF50';
  ctx.fillText(`Defense $: ${TurfShop.defenseCash}`, width - 10, 65);

  // Adrenaline indicator
  if (defense.adrenalineActive) {
    const remaining = Math.max(0, Math.ceil((defense.adrenalineEnd - Date.now()) / 1000));
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#FFEB3B';
    ctx.fillText(`⚡ ADRENALINE ${remaining}s ⚡`, width / 2, 55);
  }

  // Wave composition preview (when preparing/shopping)
  if (defense.waveState === 'preparing' || defense.waveState === 'shopping') {
    const nextWave = defense.wave + 1;
    if (nextWave <= 8) {
      const comp = getWaveComposition(nextWave);
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFD700';
      ctx.fillText(`Next Wave: ${comp.map(c => `${c.count}x ${c.type}`).join(' | ')}`, width / 2, height / 2 - 30);
    }
  }

  // Shop state message
  if (defense.waveState === 'shopping') {
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFD700';
    ctx.fillText('🏪 SHOP OPEN - BUY UPGRADES!', width / 2, height / 2 - 50);
  }

  // Placed defenses count
  if (defense.defenses && defense.defenses.length > 0) {
    const turrets = defense.defenses.filter(d => d.type === 'turret').length;
    const barricades = defense.defenses.filter(d => d.type === 'barricade').length;
    ctx.textAlign = 'left';
    ctx.font = '12px monospace';
    ctx.fillStyle = '#00BCD4';
    ctx.fillText(`Turrets: ${turrets} | Barricades: ${barricades}`, 10, 105);
  }
}


// ========================================
// KEYBOARD BINDINGS FOR ABILITIES
// ========================================

(function setupAbilityKeyBindings() {
  document.addEventListener('keydown', function(e) {
    if (!GameState || !GameState.turfDefense || !GameState.turfDefense.active) return;
    if (GameState.turfDefense.waveState !== 'active') return;

    switch (e.key) {
      case '1':
        TurfAbilities.useAbility('grenade');
        e.preventDefault();
        break;
      case '2':
        TurfAbilities.useAbility('adrenaline');
        e.preventDefault();
        break;
      case '3':
        TurfAbilities.useAbility('medkit');
        e.preventDefault();
        break;
    }
  });
})();


// ========================================
// FEATURE 6: DYNAMIC MAP HAZARDS
// ========================================

const MapHazards = {
  hazardTypes: {
    explodingCar: {
      name: 'Exploding Car',
      triggerRadius: 40,
      fuseTime: 2.0,
      explosionRadius: 80,
      explosionDamage: 60,
      color: '#FF6F00',
      radius: 20,
      symbol: '🚗'
    },
    dumpster: {
      name: 'Dumpster',
      coverRadius: 50,
      damageReduction: 0.4,
      color: '#4E342E',
      radius: 16,
      symbol: '🗑️'
    },
    alleyway: {
      name: 'Alleyway',
      slowRadius: 35,
      slowFactor: 0.5,
      slowDuration: 3.0,
      color: '#37474F',
      width: 60,
      height: 20,
      symbol: '🏚️'
    }
  },

  activeHazards: [],

  /**
   * Spawn 3-5 random hazards at start of each wave
   */
  spawnHazards(defense) {
    const count = 3 + Math.floor(Math.random() * 3); // 3-5
    const types = ['explodingCar', 'dumpster', 'alleyway'];
    const canvasW = defense.canvasWidth || 800;
    const canvasH = defense.canvasHeight || 600;

    this.activeHazards = [];

    for (let i = 0; i < count; i++) {
      const typeKey = types[Math.floor(Math.random() * types.length)];
      const typeDef = this.hazardTypes[typeKey];
      const hazard = {
        type: typeKey,
        x: 60 + Math.random() * (canvasW - 120),
        y: 60 + Math.random() * (canvasH - 120),
        active: true,
        fuseStarted: false,
        fuseTimer: 0,
        exploded: false
      };
      this.activeHazards.push(hazard);
    }

    console.log(`[MapHazards] Spawned ${count} hazards for wave ${defense.wave}`);
  },

  /**
   * Update hazard timers and proximity triggers
   */
  updateHazards(defense, dt) {
    if (!defense || !defense.enemies) return;

    this.activeHazards.forEach(hazard => {
      if (!hazard.active) return;

      if (hazard.type === 'explodingCar' && !hazard.exploded) {
        const carDef = this.hazardTypes.explodingCar;
        // Check if any enemy is within trigger radius
        let enemyNear = false;
        defense.enemies.forEach(e => {
          if (e.state === 'dead') return;
          const dist = Math.hypot(e.x - hazard.x, e.y - hazard.y);
          if (dist < carDef.triggerRadius) enemyNear = true;
        });

        if (enemyNear && !hazard.fuseStarted) {
          hazard.fuseStarted = true;
          hazard.fuseTimer = carDef.fuseTime;
        }

        if (hazard.fuseStarted) {
          hazard.fuseTimer -= dt;
          if (hazard.fuseTimer <= 0) {
            // Explode: deal AoE damage
            hazard.exploded = true;
            hazard.active = false;
            defense.enemies.forEach(e => {
              if (e.state === 'dead') return;
              const dist = Math.hypot(e.x - hazard.x, e.y - hazard.y);
              if (dist < carDef.explosionRadius) {
                e.hp -= carDef.explosionDamage;
                if (e.hp <= 0) {
                  e.state = 'dead';
                  defense.score = (defense.score || 0) + (e.scoreValue || 50);
                }
              }
            });
            console.log('[MapHazards] Car exploded!');
          }
        }
      }

      if (hazard.type === 'dumpster') {
        // Cover effect is checked in damage calculation
        // Just keep it active
      }

      if (hazard.type === 'alleyway') {
        const alleyDef = this.hazardTypes.alleyway;
        defense.enemies.forEach(e => {
          if (e.state === 'dead') return;
          const dist = Math.hypot(e.x - hazard.x, e.y - hazard.y);
          if (dist < alleyDef.slowRadius) {
            if (!e._allewaySlow) {
              e._allewaySlow = true;
              e._allewaySlowTimer = alleyDef.slowDuration;
              e._originalSpeed = e._originalSpeed || e.speed;
              e.speed = e._originalSpeed * alleyDef.slowFactor;
            }
          }
        });
      }
    });

    // Update alleyway slow timers on enemies
    if (defense.enemies) {
      defense.enemies.forEach(e => {
        if (e._allewaySlow) {
          e._allewaySlowTimer -= dt;
          if (e._allewaySlowTimer <= 0) {
            e._allewaySlow = false;
            e.speed = e._originalSpeed || e.speed;
          }
        }
      });
    }
  },

  /**
   * Check if player is near a dumpster for damage reduction
   */
  getPlayerDamageReduction(playerX, playerY) {
    let reduction = 0;
    const dumpsterDef = this.hazardTypes.dumpster;
    this.activeHazards.forEach(hazard => {
      if (!hazard.active || hazard.type !== 'dumpster') return;
      const dist = Math.hypot(playerX - hazard.x, playerY - hazard.y);
      if (dist < dumpsterDef.coverRadius) {
        reduction = dumpsterDef.damageReduction;
      }
    });
    return reduction;
  },

  /**
   * Draw hazards on canvas
   */
  drawHazards(ctx, defense) {
    this.activeHazards.forEach(hazard => {
      if (!hazard.active && !hazard.exploded) return;

      const typeDef = this.hazardTypes[hazard.type];
      if (!typeDef) return;

      if (hazard.type === 'explodingCar') {
        if (hazard.exploded) return;
        ctx.fillStyle = typeDef.color;
        ctx.beginPath();
        ctx.arc(hazard.x, hazard.y, typeDef.radius, 0, Math.PI * 2);
        ctx.fill();
        // Fuse warning
        if (hazard.fuseStarted) {
          ctx.strokeStyle = '#FF0000';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.font = '10px monospace';
          ctx.fillStyle = '#FF0000';
          ctx.textAlign = 'center';
          ctx.fillText(`💥 ${hazard.fuseTimer.toFixed(1)}s`, hazard.x, hazard.y - 25);
        }
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(typeDef.symbol, hazard.x, hazard.y + 5);
      }

      if (hazard.type === 'dumpster') {
        ctx.fillStyle = typeDef.color;
        ctx.fillRect(hazard.x - typeDef.radius, hazard.y - typeDef.radius * 0.7, typeDef.radius * 2, typeDef.radius * 1.4);
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(typeDef.symbol, hazard.x, hazard.y + 5);
        // Cover radius indicator
        ctx.strokeStyle = 'rgba(76, 175, 80, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(hazard.x, hazard.y, this.hazardTypes.dumpster.coverRadius, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (hazard.type === 'alleyway') {
        ctx.fillStyle = typeDef.color;
        ctx.fillRect(hazard.x - typeDef.width / 2, hazard.y - typeDef.height / 2, typeDef.width, typeDef.height);
        ctx.font = '10px monospace';
        ctx.fillStyle = '#90A4AE';
        ctx.textAlign = 'center';
        ctx.fillText('ALLEY', hazard.x, hazard.y + 4);
      }
    });
  }
};


// ========================================
// FEATURE 7: DESTRUCTIBLE ENVIRONMENT
// ========================================

const DestructibleEnv = {
  barriers: [],

  /**
   * Spawn fence/wall segments between buildings
   */
  spawnBarriers(defense) {
    this.barriers = [];
    const canvasW = defense.canvasWidth || 800;
    const canvasH = defense.canvasHeight || 600;
    const count = 4 + Math.floor(Math.random() * 4); // 4-7 barriers

    for (let i = 0; i < count; i++) {
      const isVertical = Math.random() > 0.5;
      const barrier = {
        x: 80 + Math.random() * (canvasW - 160),
        y: 80 + Math.random() * (canvasH - 160),
        width: isVertical ? 10 : (40 + Math.random() * 40),
        height: isVertical ? (40 + Math.random() * 40) : 10,
        hp: 100 + Math.floor(Math.random() * 101), // 100-200
        maxHp: 0,
        destroyed: false,
        type: Math.random() > 0.5 ? 'fence' : 'wall'
      };
      barrier.maxHp = barrier.hp;
      this.barriers.push(barrier);
    }

    console.log(`[DestructibleEnv] Spawned ${count} barriers`);
  },

  /**
   * Damage a barrier, destroy when HP reaches 0
   */
  damageBarrier(barrier, damage) {
    if (!barrier || barrier.destroyed) return;
    barrier.hp -= damage;
    if (barrier.hp <= 0) {
      barrier.hp = 0;
      barrier.destroyed = true;
      console.log(`[DestructibleEnv] Barrier destroyed at (${barrier.x.toFixed(0)}, ${barrier.y.toFixed(0)})`);
    }
  },

  /**
   * Check if an enemy collides with any barrier
   */
  checkCollision(enemy) {
    for (let i = 0; i < this.barriers.length; i++) {
      const b = this.barriers[i];
      if (b.destroyed) continue;
      if (
        enemy.x > b.x - b.width / 2 - (enemy.radius || 10) &&
        enemy.x < b.x + b.width / 2 + (enemy.radius || 10) &&
        enemy.y > b.y - b.height / 2 - (enemy.radius || 10) &&
        enemy.y < b.y + b.height / 2 + (enemy.radius || 10)
      ) {
        return b;
      }
    }
    return null;
  },

  /**
   * Draw barriers with HP indicators
   */
  drawBarriers(ctx) {
    this.barriers.forEach(b => {
      if (b.destroyed) {
        // Draw rubble
        ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
        ctx.fillRect(b.x - b.width / 2, b.y - b.height / 2, b.width, b.height);
        return;
      }

      // Barrier body
      const hpRatio = b.hp / b.maxHp;
      if (b.type === 'wall') {
        ctx.fillStyle = `rgb(${Math.floor(120 + 80 * (1 - hpRatio))}, ${Math.floor(80 * hpRatio)}, ${Math.floor(50 * hpRatio)})`;
      } else {
        ctx.fillStyle = `rgb(${Math.floor(139 * hpRatio)}, ${Math.floor(119 * hpRatio + 60)}, ${Math.floor(101 * hpRatio + 40)})`;
      }
      ctx.fillRect(b.x - b.width / 2, b.y - b.height / 2, b.width, b.height);

      // HP bar
      ctx.fillStyle = '#333';
      ctx.fillRect(b.x - b.width / 2, b.y - b.height / 2 - 6, b.width, 4);
      ctx.fillStyle = hpRatio > 0.5 ? '#4CAF50' : (hpRatio > 0.25 ? '#FF9800' : '#F44336');
      ctx.fillRect(b.x - b.width / 2, b.y - b.height / 2 - 6, b.width * hpRatio, 4);
    });
  }
};


// ========================================
// FEATURE 8: KILL FEED
// ========================================

const KillFeed = {
  entries: [],
  maxEntries: 8,
  entryDuration: 4.0, // seconds
  fadeDuration: 1.0,  // last second fades out

  /**
   * Add a kill entry
   */
  addKill(enemyName, weapon) {
    this.entries.push({
      text: `☠ ${enemyName} eliminated${weapon ? ' with ' + weapon : ''}`,
      type: 'kill',
      time: Date.now(),
      alpha: 1.0
    });
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  },

  /**
   * Add a loot pickup entry
   */
  addLoot(item, amount) {
    this.entries.push({
      text: `💰 +${amount} ${item}`,
      type: 'loot',
      time: Date.now(),
      alpha: 1.0
    });
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  },

  /**
   * Draw kill feed in top-right corner
   */
  draw(ctx, canvasWidth, canvasHeight) {
    const now = Date.now();
    const padding = 10;
    const lineHeight = 18;
    const feedX = canvasWidth - padding;

    // Filter and update entries
    this.entries = this.entries.filter(entry => {
      const age = (now - entry.time) / 1000;
      if (age > this.entryDuration) return false;
      // Calculate alpha for fade
      if (age > this.entryDuration - this.fadeDuration) {
        entry.alpha = (this.entryDuration - age) / this.fadeDuration;
      } else {
        entry.alpha = 1.0;
      }
      return true;
    });

    ctx.textAlign = 'right';
    ctx.font = '12px monospace';

    this.entries.forEach((entry, i) => {
      const y = padding + 20 + i * lineHeight;
      if (entry.type === 'kill') {
        ctx.fillStyle = `rgba(244, 67, 54, ${entry.alpha})`;
      } else {
        ctx.fillStyle = `rgba(255, 215, 0, ${entry.alpha})`;
      }
      ctx.fillText(entry.text, feedX, y);
    });
  }
};


// ========================================
// FEATURE 9: MINI-MAP
// ========================================

const MiniMap = {
  size: 120,

  /**
   * Draw mini-map in bottom-right corner
   */
  draw(ctx, defense, canvasWidth, canvasHeight) {
    const mapSize = this.size;
    const mapX = canvasWidth - mapSize - 10;
    const mapY = canvasHeight - mapSize - 10;
    const scaleX = mapSize / canvasWidth;
    const scaleY = mapSize / canvasHeight;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(mapX, mapY, mapSize, mapSize);

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mapX, mapY, mapSize, mapSize);

    // Buildings as gray rectangles
    if (defense.buildings) {
      ctx.fillStyle = '#9E9E9E';
      defense.buildings.forEach(b => {
        const bx = mapX + (b.x || 0) * scaleX;
        const by = mapY + (b.y || 0) * scaleY;
        const bw = Math.max(3, (b.width || 30) * scaleX);
        const bh = Math.max(3, (b.height || 30) * scaleY);
        ctx.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
      });
    }

    // Placed defenses as blue dots
    if (defense.defenses) {
      ctx.fillStyle = '#2196F3';
      defense.defenses.forEach(d => {
        if (!d.destroyed) {
          const dx = mapX + d.x * scaleX;
          const dy = mapY + d.y * scaleY;
          ctx.beginPath();
          ctx.arc(dx, dy, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // Enemies as red dots
    if (defense.enemies) {
      ctx.fillStyle = '#F44336';
      defense.enemies.forEach(e => {
        if (e.state === 'dead') return;
        const ex = mapX + e.x * scaleX;
        const ey = mapY + e.y * scaleY;
        ctx.beginPath();
        ctx.arc(ex, ey, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Player as white dot
    if (defense.playerX !== undefined && defense.playerY !== undefined) {
      ctx.fillStyle = '#FFFFFF';
      const px = mapX + defense.playerX * scaleX;
      const py = mapY + defense.playerY * scaleY;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Label
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.textAlign = 'center';
    ctx.fillText('MAP', mapX + mapSize / 2, mapY - 2);
  }
};


// ========================================
// FEATURE 10: DAMAGE DIRECTION INDICATOR
// ========================================

const DamageIndicator = {
  indicators: [],

  /**
   * Add a hit indicator from a damage source
   */
  addHit(playerX, playerY, sourceX, sourceY) {
    const angle = Math.atan2(sourceY - playerY, sourceX - playerX);
    this.indicators.push({
      angle: angle,
      opacity: 1.0,
      maxLife: 1.5,
      life: 1.5
    });
  },

  /**
   * Update indicator fade
   */
  update(dt) {
    this.indicators = this.indicators.filter(ind => {
      ind.life -= dt;
      ind.opacity = Math.max(0, ind.life / ind.maxLife);
      return ind.life > 0;
    });
  },

  /**
   * Draw red arc segments around player indicating damage direction
   */
  draw(ctx, playerScreenX, playerScreenY) {
    const arcRadius = 40;
    const arcSpan = Math.PI / 4; // 45-degree arc

    this.indicators.forEach(ind => {
      ctx.save();
      ctx.translate(playerScreenX, playerScreenY);
      ctx.rotate(ind.angle);

      ctx.strokeStyle = `rgba(255, 0, 0, ${ind.opacity})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, arcRadius, -arcSpan / 2, arcSpan / 2);
      ctx.stroke();

      ctx.restore();
    });
  }
};


// ========================================
// FEATURE 11: PAUSE MENU (BETWEEN WAVES)
// ========================================

const PauseMenu = {
  isOpen: false,

  /**
   * Open pause menu between waves
   */
  open(defense) {
    this.isOpen = true;
    console.log('[PauseMenu] Opened - wave summary');
  },

  /**
   * Close pause menu and resume
   */
  close() {
    this.isOpen = false;
    console.log('[PauseMenu] Closed - resuming');
  },

  /**
   * Draw pause menu overlay
   */
  draw(ctx, defense, canvasWidth, canvasHeight) {
    if (!this.isOpen) return;

    // Dim overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    const panelW = 320;
    const panelH = 260;

    // Panel background
    ctx.fillStyle = 'rgba(30, 30, 50, 0.95)';
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2;
    ctx.fillRect(centerX - panelW / 2, centerY - panelH / 2, panelW, panelH);
    ctx.strokeRect(centerX - panelW / 2, centerY - panelH / 2, panelW, panelH);

    ctx.textAlign = 'center';

    // Title
    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = '#FFD700';
    ctx.fillText('⚔ WAVE COMPLETE ⚔', centerX, centerY - panelH / 2 + 35);

    // Stats
    ctx.font = '14px monospace';
    ctx.fillStyle = '#E0E0E0';
    const wave = defense.wave || 0;
    const score = defense.score || 0;
    const killed = defense.enemiesKilled || 0;
    const playerHP = defense.playerHP || 0;

    let lineY = centerY - panelH / 2 + 70;
    ctx.fillText(`Wave: ${wave}`, centerX, lineY);
    lineY += 25;
    ctx.fillText(`Enemies Killed: ${killed}`, centerX, lineY);
    lineY += 25;
    ctx.fillText(`Score: ${score}`, centerX, lineY);
    lineY += 25;
    ctx.fillText(`Player HP: ${playerHP}`, centerX, lineY);

    // Building status
    lineY += 30;
    if (defense.buildings) {
      const alive = defense.buildings.filter(b => !b.destroyed).length;
      const total = defense.buildings.length;
      ctx.fillStyle = alive === total ? '#4CAF50' : '#FF9800';
      ctx.fillText(`Buildings: ${alive}/${total} standing`, centerX, lineY);
    }

    // Continue prompt
    lineY += 40;
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#00E676';
    const blink = Math.floor(Date.now() / 500) % 2 === 0;
    if (blink) {
      ctx.fillText('▶ CONTINUE TO NEXT WAVE ▶', centerX, lineY);
    }
  }
};


// ========================================
// FEATURE 12: HEAT SYSTEM TIE-IN
// ========================================

const HeatIntegration = {
  /**
   * Get current heat level from GameState
   */
  getHeatLevel() {
    return (typeof GameState !== 'undefined' && GameState.player && GameState.player.heat) || 0;
  },

  /**
   * Get wave difficulty multiplier based on heat (1.0 to 1.5)
   */
  getWaveDifficultyMultiplier() {
    const heat = this.getHeatLevel();
    return 1.0 + (heat / 100) * 0.5;
  },

  /**
   * Get reward multiplier based on heat (1.0 to 1.75)
   */
  getRewardMultiplier() {
    const heat = this.getHeatLevel();
    return 1.0 + (heat / 100) * 0.75;
  },

  /**
   * Scale enemy HP and damage by difficulty multiplier
   */
  applyHeatToWave(enemies) {
    if (!enemies || !enemies.length) return;
    const mult = this.getWaveDifficultyMultiplier();
    if (mult <= 1.0) return;

    enemies.forEach(e => {
      e.hp = Math.round(e.hp * mult);
      e.maxHp = Math.round((e.maxHp || e.hp) * mult);
      e.damage = Math.round(e.damage * mult);
    });

    console.log(`[HeatIntegration] Applied ${mult.toFixed(2)}x difficulty (heat: ${this.getHeatLevel()})`);
  },

  /**
   * Scale rewards by reward multiplier
   */
  applyHeatToRewards(baseReward) {
    return Math.round(baseReward * this.getRewardMultiplier());
  }
};


// ========================================
// FEATURE 13: CIA INTERVENTION CROSSOVER
// ========================================

// Add CIA Agent enemy type to EnemyTypes
EnemyTypes.ciaAgent = {
  name: 'CIA Agent',
  hp: 250,
  speed: 55,
  damage: 25,
  attackCooldown: 1500,
  aggroRadius: 180,
  attackRange: 80,
  color: '#1A237E',
  aggroColor: '#283593',
  radius: 16,
  scoreValue: 300,
  lootMultiplier: 2.0
};

const CIACrossover = {
  /**
   * Check if CIA agents should spawn based on heat
   */
  shouldSpawnCIA() {
    const heat = (typeof GameState !== 'undefined' && GameState.player && GameState.player.heat) || 0;
    return heat >= 70;
  },

  /**
   * Get number of CIA agents for a given wave (only waves 4+)
   */
  getCIACount(wave) {
    if (wave < 4) return 0;
    return Math.min(wave - 3, 3);
  },

  /**
   * Inject CIA agents into enemy spawn list
   */
  injectCIAEnemies(enemies, wave) {
    if (!this.shouldSpawnCIA()) return enemies;
    const count = this.getCIACount(wave);
    if (count <= 0) return enemies;

    for (let i = 0; i < count; i++) {
      enemies.push({ type: 'ciaAgent', count: 1 });
    }

    console.log(`[CIACrossover] Injecting ${count} CIA agents into wave ${wave}`);
    return enemies;
  }
};


// ========================================
// FEATURE 14: GANG REPUTATION
// ========================================

const GangReputation = {
  /**
   * Calculate reputation gain from turf defense performance
   */
  calculateRepGain(wavesCompleted, enemiesKilled, buildingsAlive) {
    let rep = 0;
    rep += wavesCompleted * 10;
    rep += enemiesKilled * 2;
    rep += buildingsAlive * 15;
    return Math.floor(rep);
  },

  /**
   * Apply reputation gain to GameState
   */
  applyRepGain(repPoints) {
    if (typeof GameState === 'undefined') return;
    if (!GameState.gang) return;
    if (typeof GameState.gang.reputation === 'undefined') {
      GameState.gang.reputation = 0;
    }
    GameState.gang.reputation += repPoints;
    console.log(`[GangReputation] Added ${repPoints} reputation (total: ${GameState.gang.reputation})`);
  }
};


// ========================================
// FEATURE 15: BUILDING INVESTMENT
// ========================================

const BuildingInvestment = {
  upgradeBonuses: [1.0, 1.2, 1.5, 1.8, 2.0, 2.5],

  /**
   * Get HP multiplier based on building upgrade level
   */
  getUpgradeBonus(building) {
    const level = (building && building.ref && building.ref.upgradeLevel) || 0;
    const clampedLevel = Math.min(level, this.upgradeBonuses.length - 1);
    return this.upgradeBonuses[clampedLevel];
  },

  /**
   * Apply upgrade bonuses to structure HP
   */
  applyUpgradeBonuses(structures) {
    if (!structures || !structures.length) return;
    structures.forEach(s => {
      const mult = this.getUpgradeBonus(s);
      if (mult > 1.0) {
        s.hp = Math.round((s.hp || 100) * mult);
        s.maxHp = Math.round((s.maxHp || s.hp) * mult);
        console.log(`[BuildingInvestment] ${s.name || 'Building'} HP boosted to ${s.hp} (${mult}x)`);
      }
    });
  }
};


// ========================================
// FEATURE 16: TUTORIAL WAVE
// ========================================

const TutorialSystem = {
  steps: [
    { text: '🎮 Move with WASD keys', icon: '⌨️' },
    { text: '🎯 Shoot by clicking enemies', icon: '🖱️' },
    { text: '🏠 Defend your buildings!', icon: '🛡️' },
    { text: '💥 Press 1/2/3 for abilities', icon: '⚡' }
  ],
  currentStep: 0,
  active: false,

  /**
   * Check if this is the player's first time
   */
  isFirstTime() {
    try {
      return !localStorage.getItem('turfDefenseTutorialComplete');
    } catch (e) {
      return false;
    }
  },

  /**
   * Start the tutorial
   */
  start() {
    if (!this.isFirstTime()) return false;
    this.active = true;
    this.currentStep = 0;
    console.log('[TutorialSystem] Tutorial started');
    return true;
  },

  /**
   * Advance to next tutorial step
   */
  advance() {
    this.currentStep++;
    if (this.currentStep >= this.steps.length) {
      this.complete();
    }
  },

  /**
   * Mark tutorial as completed
   */
  complete() {
    this.active = false;
    this.currentStep = 0;
    try {
      localStorage.setItem('turfDefenseTutorialComplete', 'true');
    } catch (e) {
      // localStorage may be unavailable
    }
    console.log('[TutorialSystem] Tutorial completed');
  },

  /**
   * Draw tutorial overlay
   */
  draw(ctx, canvasWidth, canvasHeight) {
    if (!this.active || this.currentStep >= this.steps.length) return;

    const step = this.steps[this.currentStep];
    const centerX = canvasWidth / 2;
    const boxW = 300;
    const boxH = 70;
    const boxY = 50;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(centerX - boxW / 2, boxY, boxW, boxH);
    ctx.strokeStyle = '#00E5FF';
    ctx.lineWidth = 2;
    ctx.strokeRect(centerX - boxW / 2, boxY, boxW, boxH);

    // Step counter
    ctx.font = '10px monospace';
    ctx.fillStyle = '#90A4AE';
    ctx.textAlign = 'center';
    ctx.fillText(`Step ${this.currentStep + 1}/${this.steps.length}`, centerX, boxY + 18);

    // Instruction text
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(step.text, centerX, boxY + 42);

    // Continue hint
    ctx.font = '11px monospace';
    ctx.fillStyle = '#76FF03';
    ctx.fillText('Press SPACE to continue', centerX, boxY + 60);
  }
};


// ========================================
// FEATURE 17: AUTO-AIM ASSIST
// ========================================

const AutoAim = {
  enabled: true,
  assistRadius: 80,

  /**
   * Find nearest enemy within assist radius
   */
  findNearestEnemy(playerX, playerY, enemies) {
    if (!enemies || !enemies.length) return null;

    let nearest = null;
    let nearestDist = this.assistRadius;

    enemies.forEach(e => {
      if (e.state === 'dead') return;
      const dist = Math.hypot(e.x - playerX, e.y - playerY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = e;
      }
    });

    return nearest;
  },

  /**
   * Lerp aim point toward nearest enemy by 30%
   */
  adjustAimPoint(targetX, targetY, aimX, aimY) {
    if (!this.enabled) return { x: aimX, y: aimY };

    const lerpFactor = 0.3;
    return {
      x: aimX + (targetX - aimX) * lerpFactor,
      y: aimY + (targetY - aimY) * lerpFactor
    };
  }
};


// ========================================
// FEATURE 18: SCREEN SHAKE ENHANCEMENT
// ========================================

const ScreenShake = {
  shakes: [],

  intensities: {
    explosion: 8,
    heavyHit: 4,
    gunshot: 1.5
  },

  /**
   * Add a new shake event
   */
  addShake(intensity, duration) {
    this.shakes.push({
      intensity: intensity,
      duration: duration,
      remaining: duration
    });
  },

  /**
   * Update all active shakes, remove expired ones
   */
  update(dt) {
    this.shakes = this.shakes.filter(s => {
      s.remaining -= dt;
      return s.remaining > 0;
    });
  },

  /**
   * Get combined screen offset from all active shakes
   */
  getOffset() {
    let totalX = 0;
    let totalY = 0;

    this.shakes.forEach(s => {
      const progress = s.remaining / s.duration;
      const currentIntensity = s.intensity * progress;
      totalX += (Math.random() * 2 - 1) * currentIntensity;
      totalY += (Math.random() * 2 - 1) * currentIntensity;
    });

    return { x: totalX, y: totalY };
  }
};


// ========================================
// EXPOSE TO GLOBAL SCOPE
// ========================================

window.EnemyTypes = EnemyTypes;
window.WaveCompositions = WaveCompositions;
window.getWaveComposition = getWaveComposition;
window.createTypedEnemy = createTypedEnemy;
window.spawnEnhancedWaveEnemies = spawnEnhancedWaveEnemies;
window.updateEnhancedEnemyAI = updateEnhancedEnemyAI;
window.drawEnhancedEnemy = drawEnhancedEnemy;
window.drawEnhancedHUD = drawEnhancedHUD;
window.TurfShop = TurfShop;
window.PlaceableDefenses = PlaceableDefenses;
window.TurfAbilities = TurfAbilities;
window.TurfWeatherMods = TurfWeatherMods;
window.getTurfWeatherModifiers = getTurfWeatherModifiers;
window.getCurrentTurfWeather = getCurrentTurfWeather;
window.MapHazards = MapHazards;
window.DestructibleEnv = DestructibleEnv;
window.KillFeed = KillFeed;
window.MiniMap = MiniMap;
window.DamageIndicator = DamageIndicator;
window.PauseMenu = PauseMenu;
window.HeatIntegration = HeatIntegration;
window.CIACrossover = CIACrossover;
window.GangReputation = GangReputation;
window.BuildingInvestment = BuildingInvestment;
window.TutorialSystem = TutorialSystem;
window.AutoAim = AutoAim;
window.ScreenShake = ScreenShake;

console.log('✅ [TurfDefense Enhanced] Module loaded - Enemy Types, Shop, Defenses, Abilities, Weather, Map Hazards, Destructible Env, Kill Feed, Mini-Map, Damage Indicator, Pause Menu, Heat Integration, CIA Crossover, Gang Reputation, Building Investment, Tutorial, Auto-Aim, Screen Shake');
