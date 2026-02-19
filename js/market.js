// js/market.js
const MarketSystem = {
  items: [
    { id: 'neuro_stim', name: 'Neuro-Stims', basePrice: 50, volatility: 0.15 },
    { id: 'data_chip', name: 'Encrypted Chips', basePrice: 200, volatility: 0.10 },
    { id: 'plasma_cell', name: 'Plasma Cells', basePrice: 120, volatility: 0.08 },
    { id: 'cyber_organ', name: 'Syn-Organs', basePrice: 1500, volatility: 0.25 }
  ],
  prices: {},
  inventory: {},

  init() {
    // Setup initial prices and sync with GameState
    this.items.forEach(item => {
      this.prices[item.id] = item.basePrice;

      // Hook into your existing GameState to save inventory
      if (typeof GameState !== 'undefined' && !GameState.marketInventory) {
          GameState.marketInventory = {};
      }
      this.inventory[item.id] = (typeof GameState !== 'undefined' && GameState.marketInventory[item.id]) ? GameState.marketInventory[item.id] : 0;
    });

    // Update market prices every 4 seconds
    setInterval(() => this.updateMarket(), 4000);
    this.render();
  },

  updateMarket() {
    this.items.forEach(item => {
      // Calculate random price fluctuation based on volatility
      const change = 1 + (Math.random() * item.volatility * 2 - item.volatility);
      this.prices[item.id] = Math.max(1, Math.floor(this.prices[item.id] * change));

      // Pull prices back toward the base price slightly if they inflate too high
      if (this.prices[item.id] > item.basePrice * 3) {
          this.prices[item.id] = Math.floor(this.prices[item.id] * 0.85);
      }
    });

    // Only re-render if the market tab is currently visible
    const marketTab = document.getElementById('market-tab');
    if (marketTab && marketTab.classList.contains('active')) {
        this.render();
    }
  },

  trade(itemId, action) {
    if (typeof GameState === 'undefined' || !GameState.player) {
        this.log("Error: Player data not loaded.", "error");
        return;
    }

    const price = this.prices[itemId];

    if (action === 'buy') {
      if (GameState.player.cash >= price) {
        GameState.player.cash -= price;
        GameState.marketInventory[itemId] = (GameState.marketInventory[itemId] || 0) + 1;
        this.inventory[itemId] = GameState.marketInventory[itemId];
        this.log(`Bought ${itemId} for $${price}`);
        this.updateProfileCash();
      } else {
        this.log("Insufficient funds!", "error");
      }
    } else if (action === 'sell') {
      if (this.inventory[itemId] > 0) {
        GameState.player.cash += price;
        GameState.marketInventory[itemId]--;
        this.inventory[itemId] = GameState.marketInventory[itemId];
        this.log(`Sold ${itemId} for $${price}`);
        this.updateProfileCash();
      } else {
        this.log("You don't own any!", "error");
      }
    }

    // Trigger your game's auto-save if available
    if (typeof Storage !== 'undefined' && typeof Storage.save === 'function') Storage.save();

    this.render();
  },

  // Updates your existing Profile UI cash text
  updateProfileCash() {
      const cashEl = document.getElementById('player-cash');
      if (cashEl && typeof GameState !== 'undefined') {
          // Formats numbers with commas (e.g. $1,000)
          cashEl.textContent = '$' + GameState.player.cash.toLocaleString();
      }
  },

  log(msg, type='info') {
    const feed = document.getElementById('market-feed');
    if(feed) {
      const line = document.createElement('div');
      line.textContent = `> ${msg}`;
      line.style.color = type === 'error' ? '#ff6b6b' : '#4ade80';
      feed.prepend(line);
      // Keep only the last 4 log messages
      if(feed.children.length > 4) feed.lastChild.remove();
    }
  },

  render() {
    const list = document.getElementById('market-list');
    if (!list) return;

    // Uses your existing CSS classes (.stat-card, .stat-label, .stat-value)
    list.innerHTML = this.items.map(item => {
      const price = this.prices[item.id];
      const owned = this.inventory[item.id] || 0;
      const isUp = price >= item.basePrice;
      const color = isUp ? '#4ade80' : '#f87171'; // Green for up, Red for down
      const arrow = isUp ? '▲' : '▼';

      return `
        <div class="stat-card" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div>
            <div class="stat-label">${item.name}</div>
            <div class="stat-value" style="color:${color}">${arrow} $${price}</div>
          </div>
          <div style="text-align:right;">
            <div class="stat-label">Owned: ${owned}</div>
            <div style="display:flex; gap:8px; margin-top:6px;">
              <button onclick="MarketSystem.trade('${item.id}', 'buy')" style="padding:6px 12px; border-radius:4px; background:rgba(255,255,255,0.1); color:#fff; border:1px solid rgba(255,255,255,0.2); cursor:pointer;">BUY</button>
              <button onclick="MarketSystem.trade('${item.id}', 'sell')" style="padding:6px 12px; border-radius:4px; background:rgba(255,255,255,0.1); color:#fff; border:1px solid rgba(255,255,255,0.2); cursor:pointer;">SELL</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
};

// Initialize the market when the page is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => MarketSystem.init());
} else {
  MarketSystem.init();
}
