# CLAUDE.md - AI Assistant Guide for Heatline: Underworld

## Project Overview

**Heatline: Underworld** is a browser-based crime RPG game featuring turf wars, real-time combat, character progression, and multiplayer chat. The game runs entirely client-side with Firebase handling backend operations.

**Live URL:** https://dannifaze-code.github.io/crime-rpg/

### Tech Stack
- **UI Framework:** Vue.js 2.6.14 (CDN)
- **3D Graphics:** Three.js r128 (weather effects)
- **Backend:** Firebase (Realtime Database, Authentication, Cloud Functions)
- **Hosting:** GitHub Pages (static files)
- **No Build Process:** Direct HTML/CSS/JS editing

---

## Codebase Structure

```
crime-rpg/
├── index.html              # Main entry point (18MB - contains embedded base64 assets)
├── README.md               # User-facing documentation
├── CLAUDE.md               # This file - AI assistant guide
├── js/
│   ├── app.js              # Main game logic (~27K lines, monolithic)
│   └── modules/
│       ├── weather.js      # Three.js weather system (~1.7K lines)
│       └── cia-intervention.js  # CIA antagonist system (~1K lines)
├── css/
│   └── main.css            # All styling (~5.5K lines)
└── sprites/                # Game assets (~16MB, 457 files)
    ├── Top_Down_Survivor/  # Character sprites, equipment, body parts
    ├── SurvivorSpine/      # Spine animation format assets
    └── cia-agent-pngs/     # CIA NPC portrait animation frames
```

### Key Files by Size
| File | Lines | Purpose |
|------|-------|---------|
| `js/app.js` | ~27,000 | All game logic, managers, UI systems |
| `css/main.css` | ~5,500 | All styling and CSS animations |
| `js/modules/weather.js` | ~1,700 | Three.js weather overlay system |
| `js/modules/cia-intervention.js` | ~1,000 | CIA antagonist event system |

---

## Architecture & Code Patterns

### Singleton Manager Pattern
The codebase uses singleton objects as "managers" for different systems:

```javascript
const GoogleAuthManager = { /* auth logic */ }
const AccountManager = { /* multi-account management */ }
const WeaponsSystem = { /* weapon handling */ }
const ChatSystem = { /* real-time chat */ }
const CopCarSystem = { /* police patrol mechanics */ }
const TurfDefenseSystem = { /* tower defense minigame */ }
const WeatherOverlay = { /* Three.js weather rendering */ }
const CIAIntervention = { /* heat-triggered antagonist */ }
```

### Global State Object
All game state lives in a central `GameState` object:

```javascript
GameState = {
  accountId, player, character, gang,
  map, mapIcons, mapMemory,
  turfDefense, ciaIntervention,
  propertyBuildings, landmarkOwnership,
  weather, UI, /* etc. */
}
```

### Naming Conventions
- **PascalCase:** Object managers and classes (e.g., `ChatSystem`, `WeatherOverlay`)
- **camelCase:** Functions and variables (e.g., `initializeGame`, `playerHealth`)
- **UPPERCASE:** Constants (e.g., `BUILD_STAMP`, `DEBUG_OVERLAY_ENABLED`)
- **Prefixes:** `_private`, `get*`, `set*`, `init*`, `create*`

### Code Style
- ES5-compatible with some ES6+ features (arrow functions, const/let, template literals)
- Synchronous operations with Promises for async
- Heavy inline comments for complex logic
- Vanilla JavaScript DOM manipulation (no jQuery)

---

## Development Workflow

### Running Locally
1. Open `index.html` directly in a modern browser
2. No build step, npm, or server required
3. Uses CDN for all dependencies

### Deployment
1. Push changes to GitHub
2. GitHub Pages automatically serves from the repository
3. Changes are live within minutes

### Browser Requirements
- WebGL support (for Three.js weather)
- ES6+ JavaScript support
- LocalStorage API
- Firebase SDK availability

---

## Key Systems Reference

### Weather System (`js/modules/weather.js`)
- `WeatherOverlay` - Three.js scene for weather effects
- `WeatherManager` - Cycles weather types every 2 hours (synchronized globally)
- Weather types: Clear, Fog, Rain, Storm, Snow, Heat
- Entry: `WeatherOverlay.init()`, `WeatherManager.startWeatherCycle()`

### CIA Intervention (`js/modules/cia-intervention.js`)
- Triggers at 85%+ heat level
- Three UI phases: toast → lockdown overlay → animated portrait
- Portrait frames in `/sprites/cia-agent-pngs/`
- Entry: `CIAIntervention.trigger()`
- Has 2-minute cooldown to prevent spam

### Chat System (in `app.js`)
- Real-time Firebase Realtime Database
- Global and private messaging
- Entry: `ChatSystem.openChat()`, `ChatSystem.sendMessage()`

### Turf Defense (in `app.js`)
- Tower defense minigame on city map
- Canvas overlay, 60fps render loop
- Entry: `TurfDefenseSystem.startTurfDefense()`

### Authentication (in `app.js`)
- `GoogleAuthManager` - Google Sign-In integration
- `AccountManager` - Multi-account local storage
- Firebase Auth for cloud sync

---

## Firebase Configuration

Firebase config is embedded in `app.js`:
```
Project: crime-rpg-leaderboards
Database: https://crime-rpg-leaderboards-default-rtdb.firebaseio.com
Services: Realtime Database, Auth, Cloud Functions, Storage
```

**Note:** API keys are public in the code. Security relies on Firebase security rules, not key secrecy.

---

## Common Tasks

### Adding a New Game System
1. Create a new singleton object in `app.js` or as a module in `js/modules/`
2. Follow the manager pattern with `init()`, relevant methods
3. Register initialization in the startup sequence
4. Add any state to `GameState` object

### Modifying UI
1. HTML structure is in `index.html`
2. Styles are in `css/main.css`
3. Tab components: `#profile-tab`, `#turf-tab`, `#crimes-tab`, `#safehouse-tab`
4. Dynamic overlays are created in JavaScript

### Adding Sprites/Assets
1. Add files to appropriate `/sprites/` subdirectory
2. Reference in JavaScript by path
3. For embedded assets, base64 encode and add to `index.html` (not recommended for large files)

### Debugging
- `BUILD_STAMP` system verifies cache (search for it in app.js)
- `DEBUG_OVERLAY_ENABLED` flag for visual debugging (line ~74 in app.js)
- Eruda console available for mobile debugging
- Use browser DevTools console for debugging

---

## Important Considerations

### Monolithic Architecture
- `app.js` is ~27,000 lines - search carefully
- Recent refactoring extracted `weather.js` and `cia-intervention.js`
- Future work should continue modularization

### Large HTML File
- `index.html` is 18MB due to embedded base64 assets
- Opening/editing may be slow
- Avoid adding more embedded assets

### No Tests
- No automated test suite exists
- Test manually in browser
- Check console for errors

### Client-Side Security
- All validation is client-side
- Firebase security rules are the actual security layer
- Don't add sensitive logic that must be server-validated

---

## File Locations for Common Changes

| To Change... | Look In... |
|--------------|------------|
| Game logic, mechanics | `js/app.js` |
| Weather effects | `js/modules/weather.js` |
| CIA intervention system | `js/modules/cia-intervention.js` |
| Styling, animations | `css/main.css` |
| HTML structure | `index.html` |
| Character sprites | `sprites/Top_Down_Survivor/` |
| CIA portrait frames | `sprites/cia-agent-pngs/` |

---

## Git Workflow

- **Main branch:** Production code served by GitHub Pages
- **Feature branches:** Use `claude/` prefix for AI-assisted work
- **Commits:** Descriptive messages explaining the change
- **Recent activity:** Bug fixes, CSS extraction, JavaScript modularization

---

## Pitfalls to Avoid

1. **Don't add to index.html size** - Already 18MB with embedded assets
2. **Don't forget Firebase rules** - Backend security depends on them
3. **Don't create circular dependencies** - Modules import carefully
4. **Don't break mobile** - Game has mobile users; test responsiveness
5. **Don't skip the init sequence** - Systems depend on proper initialization order
6. **Search before adding** - The codebase likely has what you need already

---

## Quick Reference: Initialization Sequence

```javascript
// In app.js, startup order:
1. loadFirebase()           // Load Firebase SDKs
2. Firebase initialization  // Connect to database
3. initializeGame()         // Load game state, setup systems
4. WeatherOverlay.init()    // Start weather rendering
5. UI rendering             // Show appropriate tab
```

---

## Summary

This is a feature-rich browser RPG with real-time multiplayer capabilities. The architecture is unconventional (monolithic, no build process) but functional. When making changes:

1. **Read existing code first** - Patterns are established
2. **Follow the manager pattern** - Consistency matters
3. **Test in browser** - No automated tests
4. **Keep it simple** - Avoid over-engineering
5. **Consider mobile** - Users play on phones too
