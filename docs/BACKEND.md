# AM Browser — Backend Choice and Architecture

## Why Electron (Chromium)?

Electron was chosen as the backend for AM Browser based on the following criteria:

### Performance
- **Chromium rendering engine**: Guarantees universal web compatibility and fast page loads
- **V8 JavaScript engine**: Industry-leading JS performance
- **Hardware-accelerated GPU rendering**: Smooth scrolling and compositing
- **session.webRequest API**: Enables efficient per-session ad blocking without third-party dependencies

### Maintainability
- **Single codebase**: JavaScript/Node.js throughout — no mixed language stacks
- **WebContentsView**: Modern Electron API (replaces deprecated BrowserView) for isolated, sandboxed page rendering
- **IPC architecture**: Clean separation between main process (OS integration) and renderer (UI chrome)
- **Minimal dependencies**: Only `electron` and `electron-builder` — no runtime bloat

### User Experience
- **backgroundMaterial: 'acrylic'**: Native Windows 11 Mica/Acrylic translucency (opt-in via settings)
- **Frameless window**: Custom macOS-style traffic light controls, custom tab strip, bottom navigation pill
- **Isolated web views**: Web content runs in sandboxed WebContentsView, separated from the browser chrome
- **Per-session ad blocking**: Powered by Electron's session.webRequest API with our own filter engine

### Weight
- **Zero runtime dependencies**: No Chromium/embedded browser bloat — Electron IS Chromium
- **Lean renderer**: The entire browser chrome is a single HTML/CSS/JS file
- **Fast startup**: Solid black background for instant perceived launch

## Architecture Overview

### Main Process (`src/main/`)
- `main.js` — App entry, error handling, lifecycle
- `window.js` — BrowserWindow creation (frameless, solid black default)
- `tabs.js` — Tab manager using WebContentsView (one per tab, sandboxed)
- `ipc.js` — All IPC channel registration (ipcMain.handle)
- `config.js` — JSON settings persistence
- `adblock.js` — Ad blocking via session.webRequest
- `history.js`, `bookmarks.js`, `downloads.js` — Feature managers
- `security.js` — Security hardening (CSP, permission denials, navigation restrictions)
- `logger.js` — File-based logging with rotation

### Preload (`src/preload/`)
- `preload.js` — contextBridge whitelist (only whitelisted channels are callable)

### Renderer (`src/renderer/`)
- `index.html` — Browser chrome markup
- `app.js` — All chrome logic (search, navigation, panels, i18n)
- `styles/global.css` — Via Browser design language (AMOLED black palette)

### Shared (`src/shared/`)
- `adblock/engine.js` — Pure JS filter engine (EasyList-compatible)
- `i18n/index.js` — i18n loader (filesystem-based locale loading)
- `physics/spring.js` — Spring physics for UI animations
- `filters/starter.txt` — Built-in ad blocking filter list

## WebContentsView Layer Management

A critical architectural decision is how the WebContentsView (native layer) interacts with the renderer DOM:

1. **Problem**: WebContentsView sits ON TOP of all renderer DOM regardless of z-index
2. **Solution**: The renderer tells the main process to `showHome()` or `showContent()`:
   - `showHome()` removes the active WebContentsView from contentView, allowing the home screen's search input to be clickable
   - `showContent()` adds the WebContentsView back when navigating to a URL
3. **This prevents the native view from blocking the home search input**

## i18n Architecture

### Loading Strategy
The i18n system loads locale strings via IPC from the main process (not via fetch from renderer):

1. Main process reads locale JSON files from the filesystem
2. Renderer calls `api.invoke('i18n:getStrings')` to get the current locale strings
3. This works reliably in both development and packaged asar mode
4. Renderer applies translations via `data-i18n` and `data-i18n-placeholder` attributes

### Adding a New Language
See docs/I18N.md for the complete guide.

## Security Architecture

### WebContentsView Sandboxing
Each tab's WebContentsView runs with:
- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webSecurity: true`
- `allowRunningInsecureContent: false`

### IPC Whitelist
The preload script's `ALLOWED_INVOKE` set restricts which IPC channels the renderer can call.
New channels must be added to this set before they work.

### Additional Protections
- Navigation to dangerous schemes (file:, data:, javascript:) is blocked
- Permission requests are denied by default
- CSP headers are injected on all mainFrame responses
- Mixed content is blocked by default
