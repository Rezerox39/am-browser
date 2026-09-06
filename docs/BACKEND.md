# AM Browser — Backend Choice and Architecture

## Why Electron (Chromium)?

Electron was chosen as the backend for AM based on these criteria:

### Performance
- **Chromium rendering engine**: universal web compatibility and fast page loads
- **V8 JavaScript engine**: industry-leading JS execution
- **Hardware-accelerated compositing**: smooth scrolling and animations
- **`session.webRequest`**: per-session, in-process ad blocking — no proxy or third-party service

### Maintainability
- **Single language**: one JavaScript/Node.js codebase from main to renderer
- **`WebContentsView`**: the modern Electron API (replacement for the deprecated `BrowserView`)
  for isolated, sandboxed page rendering
- **IPC boundary**: main process (OS/session) is cleanly separated from the chrome renderer (UI)
- **Small dependency set**: `electron`, `electron-builder`, and the `electron-chrome-*` packages for
  Chrome extension APIs. Everything else is first-party code.

### Weight
- **A single window renders the entire chrome** — one small HTML/CSS/JS page plus sandboxed views per tab
- **Solid black background** for instant perceived startup (translucency is opt-in, with automatic fallback)
- **No UI framework**: no React/Vue bundles, no node_modules shipped into the chrome renderer

## Architecture Overview

### Main process (`src/main/`)
- `main.js` — entry point, uncaught-exception dialogs, lifecycle
- `window.js` — frameless `BrowserWindow` (solid black by default, acrylic opt-in)
- `tabs.js` — tab manager; one `WebContentsView` per tab
- `extensions.js` — Chrome extension support via `electron-chrome-extensions`
- `adblock.js` — filter engine wired to `session.webRequest`
- `ipc.js` — all IPC channels (idempotent registration)
- `config.js`, `history.js`, `bookmarks.js`, `downloads.js`, `security.js`, `logger.js` — supporting services

### Preload (`src/preload/preload.js`)
A `contextBridge` whitelist. Only channels in `ALLOWED_INVOKE` / `ALLOWED_ON` are reachable
from the chrome renderer. New IPC channels must be added here.

### Renderer (`src/renderer/`)
- `index.html` + `app.js` + `styles/global.css` — the entire browser chrome in the Via design language
- Renders the home screen, top tab strip, url bar, bottom nav pill, and right slide-in panels

### Shared (`src/shared/`)
Pure JS modules with no Electron dependency: `adblock/engine.js`, `i18n/`, `filters/starter.txt`.

## WebContentsView Layer Management (critical)

Electron renders any `WebContentsView` attached to `win.contentView` **above every pixel of the
BrowserWindow's own DOM** — CSS `z-index` cannot raise the chrome above it. This is the root cause
of most "UI is not clickable" bugs in Electron browsers.

AM follows the architecture proven by
[electron-browser-shell](https://github.com/samuelmaddock/electron-browser-shell):

1. **Attach each view exactly once** when the tab is created — never `addChildView`/`removeChildView`
   on navigation (that was the fragile approach used by AM v1.7–v1.9 and is now removed).
2. **Toggle visibility with `view.setVisible(true/false)`** — cheap, synchronous, no re-layout.
3. **Top chrome stays above the page**: every content view starts at `y = 84`
   (tab strip 52px + url bar 32px) so the tab strip, traffic lights, and url bar are never covered.
4. **Content is full-bleed below the top chrome** (`x: 0`, full width, to the bottom edge) —
   there is no reserved strip for navigation UI, so nothing paints as a black bar.
5. **The floating nav pill is its own transparent `WebContentsView`** (`src/renderer/pill.html`),
   added to `contentView` *after* every content view so it is always the topmost layer. Electron
   composites `contentView` children client-side, so the pill's semi-transparent capsule blends
   over the page and the page scrolls underneath it. Only the capsule paints; the rest of the
   view is `transparent: true` + `#00000000`.
6. **`layoutChrome()` is the single source of truth** (`src/main/tabs.js`): it positions the active
   content view and the pill, and re-asserts the pill on top. It runs on window resize/move, tab
   create/close/select, and panel/menu open/close — so the pill can never be "destroyed" by a menu
   cycle (regression-covered by `scripts/smoke.js`).
7. **Shrink the content view only when a right slide-in panel/menu is open** (`tabs:setInset`):
   the panel stays DOM-clickable; the pill is unaffected and remains on top.
8. **Home mode**: when the active tab has no URL (fresh tab) or the user presses the pill's Home,
   the content view is hidden (`uiMode = 'home'`), so the whole home screen — including the search
   input — is clickable. Navigation flips `uiMode` to `'content'` and shows the view.

The main process broadcasts a deterministic `uiMode` with every `tabs:changed` event, so late
page-load events can never re-cover the home screen. The pill overlay receives the same
`tabs:changed` broadcast (plus back/forward state) and forwards menu/home actions to the chrome
window over `ui:openMenu` / `ui:showHome` IPC.

## Extension Support

`src/main/extensions.js` wires `electron-chrome-extensions` + `electron-chrome-web-store` +
`electron-chrome-context-menu`:

- Tab lifecycle is mirrored into the extension system (`addTab`/`selectTab`) so `chrome.tabs` APIs
  see real tabs
- Unpacked extensions in `extensions/` load at startup; Chrome Web Store installs are supported
- MV2 background pages and MV3 service workers are started for installed extensions
- See `docs/EXTENSIONS.md` for details and limitations

## i18n Architecture

Locale JSON files live in `src/shared/i18n/locales/`, loaded by the main process and delivered to
the renderer over IPC (`i18n:getStrings`). This works reliably both unpacked and inside asar.
See `docs/I18N.md` for the translator workflow.

## Security Architecture

- Every tab view: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`,
  `webSecurity: true`, `allowRunningInsecureContent: false`
- Strict IPC whitelist via contextBridge
- Navigation to dangerous schemes is blocked; permission requests are denied by default
- See `docs/SECURITY.md` for the full threat model
