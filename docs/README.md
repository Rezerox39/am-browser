# AM - A Minimal, Fast Desktop Browser

AM is a lightweight browser built with Electron, prioritizing performance, cleanliness, and user control.

## Features

- **Ad blocking** enabled by default (EasyList-compatible pattern engine)
- **Per-site settings**: JavaScript toggle, custom user agent, popup control, permissions
- **Tab management**: create, close, switch - sidebar with capsule pill design
- **History and bookmarks**: full record with search
- **Download manager**: track, open, reveal in folder
- **AMOLED black UI**: pure black palette with luminous accent gradients
- **Windows 11 translucency**: acrylic Mica effect on supported systems
- **i18n**: English, French, German - easy to add more (see docs/I18N.md)
- **Frameless window**: custom titlebar, window controls, drag region

## Project Structure

  am-browser/
  +-- package.json
  +-- assets/icon.png
  +-- src/
  |   +-- main/              <- Electron main process
  |   |   +-- main.js        <- App entry point
  |   |   +-- window.js      <- BrowserWindow creation
  |   |   +-- tabs.js        <- Tab manager (WebContentsView)
  |   |   +-- adblock.js     <- Ad-block filter wiring
  |   |   +-- ipc.js         <- IPC channel registration
  |   |   +-- config.js      <- Settings persistence
  |   |   +-- history.js     <- History manager
  |   |   +-- bookmarks.js   <- Bookmarks manager
  |   |   +-- downloads.js   <- Download manager
  |   |   +-- logger.js      <- File-based logging
  |   |   +-- security.js    <- Security hardening
  |   +-- preload/
  |   |   +-- preload.js     <- ContextBridge whitelist
  |   +-- renderer/          <- Browser chrome (UI)
  |   |   +-- index.html
  |   |   +-- app.js         <- Chrome logic
  |   |   +-- styles/global.css <- AMOLED black theme
  |   +-- shared/            <- Pure JS (no Electron dependency)
  |       +-- adblock/engine.js <- Filter engine
  |       +-- i18n/index.js     <- i18n loader
  |       +-- i18n/locales/     <- en.json, fr.json, de.json
  |       +-- filters/starter.txt <- Built-in filter list
  +-- docs/
  |   +-- BACKEND.md
  |   +-- SECURITY.md
  |   +-- I18N.md
  |   +-- PER_SITE_SETTINGS.md
  +-- scripts/
      +-- check.js           <- Validation script
      +-- gen-icon.js        <- Icon generator

## Build and Run

### Prerequisites

- **Node.js 18+** (https://nodejs.org)
- **Windows 10/11** for full acrylic effects (works on macOS/Linux without translucency)
- **npm** (bundled with Node)

### Install

  cd am-browser
  npm install

### Run in development

  npm start

### Run validation

  node scripts/check.js

### Package for distribution

  npm install -D electron-builder
  npx electron-builder --win portable

Produces an executable in dist/. See package.json build section for configuration.

## Why Electron?

Full rationale in docs/BACKEND.md. Summary:

- Chromium guarantees universal web compatibility
- session.webRequest enables efficient, per-session ad blocking
- WebContentsView provides isolated, sandboxed page rendering
- backgroundMaterial: acrylic gives native Windows 11 translucency
- Zero runtime dependencies - lean, auditable codebase

## License

MIT