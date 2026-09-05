# AM — Backend Choice & Architectural Reasoning

## Chosen Backend: Electron (Chromium)

AM uses **Electron** with the bundled **Chromium** rendering engine. This combination was chosen after evaluating Chromium (via CEF), Firefox (GeckoView), and Tauri (Rust + system WebView).

### Why Electron + Chromium?

1. **Web compatibility**: Chromium ensures any site AM navigates to renders correctly.
2. **API surface**: Electron provides `session.webRequest.onBeforeRequest` for ad blocking, `WebContentsView` for isolated page rendering, and full access to Chromium's security model.
3. **Windows 11 integration**: `backgroundMaterial: 'acrylic'` provides native OS translucency effects without custom hacks.
4. **Security**: Electron's `contextIsolation` + `sandbox` + preload model allows a fully privileged main process with zero renderer access to Node.

### What about size?

The ~150 MB bundle is acceptable for a desktop browser; users expect a substantial binary. The codebase itself is minimal with zero runtime dependencies.

## Architecture Overview

```
+------------------------------------------------------+
|  Main Process (Node.js)                             |
|  |-- Window manager     (window.js)                 |
|  |-- Tab manager        (tabs.js + WebContentsView) |
|  |-- Ad-block engine    (adblock.js + engine.js)    |
|  |-- Data managers      (history, bookmarks, dl)    |
|  |-- Security layer     (security.js)               |
|  |-- Config store       (config.js -> settings.json)|
|  |-- IPC bridge         (ipc.js)                    |
|                     [ipcMain <-> ipcRenderer]        |
|  Preload (contextBridge)                            |
|                     |                               |
|  Renderer: Chrome UI  (index.html + app.js + CSS)   |
|  |-- Floating sidebar (tab list)                    |
|  |-- Omnibox capsule  (URL/search input)            |
|  |-- Overlay panels   (settings, history, etc.)     |
|  |-- AMOLED black shell                             |
|                                                    |
|  Child Views: WebContentsView[] (one per tab)       |
|  |-- Sandboxed, contextIsolated                    |
|  |-- Per-tab JS toggle + user agent override       |
```

### Key design decisions:

- **Frameless window** with custom drag region for a clean, native-free look
- **WebContentsView** (not iframes) for real browser isolation per tab
- **AMOLED black** palette as base; aurora accent gradients on active elements
- **No native Node integration** in the renderer — all communication via a whitelist-secured preload bridge
- **JSON persistence** for settings, bookmarks, history, downloads — zero database dependencies

## Build & Run

See `docs/README.md` for full build instructions.
