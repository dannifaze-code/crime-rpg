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

console.log('✅ [TurfDefense Enhanced] Module loaded - Enemy Types, Shop, Defenses, Abilities, Weather');
