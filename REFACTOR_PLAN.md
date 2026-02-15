# Refactor Plan: Remove Duplicate HTML from app.js

## Problem
`AccountUI.rebuildAppStructure()` contains ~500+ lines of HTML template strings duplicated **twice** in `app.js` (once in `rebuildAppStructure()` and once in `showSignInSuccess()`). This means:
- Every UI change needs 3 edits (index.html + 2 JS copies)
- The 27K-line app.js is bloated with HTML
- Bugs from stale/divergent copies

## Solution: Show/Hide Pattern
Instead of destroying and rebuilding the DOM on sign-in/sign-out, we:
1. **Keep the app HTML always in the DOM** (in `index.html`, where it already exists)
2. **Hide it with CSS** (`#app { display: none }`) until authenticated
3. **On sign-in**, flip `#app` to visible and reset/populate the state — no DOM rebuild
4. **On sign-out**, hide `#app` and show the login overlay

## Files Changed

### `js/app.js`
| Location | What Changed |
|----------|-------------|
| `AccountUI.rebuildAppStructure()` (was line ~2843-3127) | Replaced with `resetAppState()` — shows #app, resets text values to defaults, no innerHTML |
| `AccountUI.showAccountCreationSuccess()` (was line ~2791) | Changed `app.innerHTML = loading` to just showing app div |
| `showSignInSuccess()` (was line ~3387-3628) | Removed second duplicate HTML template; now just shows #app and calls `resetAppState()` |
| `AuthManager.showLoginScreen()` (line ~2146) | Changed `app.innerHTML = ''` to `app.style.display = 'none'` |
| `GoogleAuthManager.onUserSignedOut()` (line ~1387) | Changed `app.innerHTML = ''` to keeping DOM intact, just hiding |
| Init flow (line ~30960) | Changed `app.innerHTML = ''` to `app.style.display = 'none'` |

### `css/main.css`
| What Changed |
|-------------|
| Added `#app { display: none; }` — app is hidden by default until auth succeeds |

### Key Function: `resetAppState()`
New lightweight function that replaces `rebuildAppStructure()`. It:
- Shows `#app` (`display: flex`)
- Resets profile text values (name, cash, XP, level, rep, heat, stats) to defaults
- Resets tab state to Profile tab active
- Clears dynamic content containers (gang-content, map-icons, etc.)
- Does **NOT** touch the DOM tree structure

## How to Find Things

| To find... | Look for... |
|-----------|------------|
| The single source of truth for app HTML | `index.html`, lines 94-395 (`<div id="app">...</div>`) |
| The show/hide + state reset logic | `js/app.js`, search for `resetAppState` |
| Where #app gets shown | Search for `app.style.display = 'flex'` |
| Where #app gets hidden | Search for `app.style.display = 'none'` |
| The old rebuilt HTML (REMOVED) | No longer exists — was in `rebuildAppStructure()` and `showSignInSuccess()` |

## Benefits
- **One source of truth** for HTML (`index.html`)
- **~500 fewer lines** in `app.js`
- **Faster sign-in** (no DOM thrashing)
- **No orphaned event listeners** from destroyed elements
- **Better WebView performance** with stable DOM
- **Easier maintenance** — UI changes only need 1 edit
