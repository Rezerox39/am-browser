# AM — A Minimal, Fast Desktop Browser

AM is a lightweight browser built with Electron, prioritizing performance, cleanliness, and user control.
It follows the **Via Browser** design language: pure black, white text, muted grays, accent blue, pill search,
bottom navigation pill, slim top tab strip, and right slide-in panels.

## Features

- **Ad blocking** enabled by default (EasyList-compatible pattern engine, no third-party service)
- **Per-site settings**: JavaScript on/off, custom user agent, ad-block override, popups, permissions
- **Tabs**: create, switch, and close from the slim top chip strip (Ctrl+T / Ctrl+W also work)
- **Home search** is the sole search surface — fully functional, honors the configured search engine
- **Bottom navigation pill**: back, forward, home, new tab, menu — all wired
- **Right slide-in panels**: history, bookmarks, downloads, settings, per-site settings
- **Chrome extensions**: load unpacked extensions from `extensions/`, install from the Chrome Web Store
- **History, bookmarks, downloads**: full record with search and management
- **AMOLED black UI**: pure `#000` palette, `#5a83ff` accent, 20px backdrop blur materials
- **macOS-style window controls** on the right: red/yellow/green traffic lights
- **i18n**: English, French, German — adding a language needs no code changes (see `docs/I18N.md`)
- **Frameless window** with native drag regions

## Project Structure

```
am-browser/
+-- package.json
+-- assets/icon.png
+-- extensions/               <- Drop unpacked Chrome extensions here
+-- src/
|   +-- main/                 <- Electron main process
|   |   +-- main.js           <- App entry, lifecycle, error dialogs
|   |   +-- window.js         <- BrowserWindow creation (frameless, solid black)
|   |   +-- tabs.js           <- Tab manager (WebContentsView + setVisible)
|   |   +-- extensions.js     <- Chrome extension support (MV2 + MV3 service workers)
|   |   +-- adblock.js        <- Ad-block filter wiring (session.webRequest)
|   |   +-- ipc.js            <- IPC registration (idempotent)
|   |   +-- config.js         <- Settings persistence
|   |   +-- history.js        <- History manager
|   |   +-- bookmarks.js      <- Bookmarks manager
|   |   +-- downloads.js      <- Download manager
|   |   +-- security.js       <- Security hardening
|   |   +-- logger.js         <- File-based, rotating logs
|   +-- preload/
|   |   +-- preload.js        <- contextBridge channel whitelist
|   +-- renderer/             <- Browser chrome (UI)
|   |   +-- index.html
|   |   +-- app.js            <- Chrome logic (search, tabs, panels, i18n)
|   |   +-- styles/global.css <- Via design language (AMOLED black)
|   +-- shared/               <- Pure JS, no Electron dependency
|       +-- adblock/engine.js
|       +-- i18n/index.js
|       +-- i18n/locales/     <- en.json, fr.json, de.json
+-- docs/
|   +-- BACKEND.md            <- Backend choice + architecture (incl. layering)
|   +-- EXTENSIONS.md         <- Extension support guide
|   +-- SECURITY.md           <- Threat model and mitigations
|   +-- I18N.md               <- Translator workflow
|   +-- PER_SITE_SETTINGS.md  <- Per-site rule system + how to extend it
+-- scripts/
    +-- check.js              <- Validation (syntax, locales, structure)
    +-- smoke.js              <- Headless end-to-end smoke test
    +-- gen-icon.js           <- Icon generator
```

## Build and Run

### Prerequisites

- **Node.js 18+** (https://nodejs.org)
- **Windows 10/11** for the full acrylic effect (Linux/macOS run without translucency)

### Install

```
cd am-browser
npm install
```

### Run in development

```
npm start
```

### Run validation

```
node scripts/check.js
```

### Run the headless smoke test (Linux/macOS with Xvfb)

Verified end-to-end: home search → page view, home button, tab create/switch/close,
nav pill, slide-in panel insets, window-control IPC, extension loading.

```
xvfb-run -a ./node_modules/.bin/electron scripts/smoke.js --no-sandbox --disable-dev-shm-usage
```

### Package for distribution

```
npx electron-builder --win portable
```

Produces `dist/AM-<version>-win.exe` (portable, no installer).

## Why Electron?

Full rationale in `docs/BACKEND.md`. Summary:

- Chromium guarantees universal web compatibility
- `session.webRequest` enables efficient, per-session ad blocking
- `WebContentsView` provides isolated, sandboxed page rendering that never blocks the chrome
- `backgroundMaterial: acrylic` gives native Windows 11 translucency
- Dependency footprint is intentionally small: Electron + the `electron-chrome-*` extension packages

## License

MIT
