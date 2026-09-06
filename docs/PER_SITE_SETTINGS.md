# AM — Per-Site Settings System

## Overview

Every website can have its own overrides, stored in the `siteRules` map inside `settings.json`
(located in Electron's `userData` directory).

```json
{
  "siteRules": {
    "www.youtube.com": {
      "adblockEnabled": false,
      "javascript": true,
      "popups": true,
      "userAgent": "",
      "permissions": {
        "geolocation": false,
        "notifications": true,
        "media": true
      }
    }
  }
}
```

## Available Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `adblockEnabled` | boolean | (global) | Toggle ad blocking for this host only |
| `javascript` | boolean | true | Enable/disable JavaScript for this host |
| `popups` | boolean | false | Allow pop-up windows for this host |
| `userAgent` | string | "" | Custom user agent (empty = session default) |
| `permissions.geolocation` | boolean | false | Allow location access |
| `permissions.notifications` | boolean | false | Allow notifications |
| `permissions.media` | boolean | false | Allow camera/microphone access |

## How Settings Are Applied

1. **On navigation**: `tabs.js` (`loadURL`) reads the host rule and applies
   `webContents.setJavaScriptEnabled()`, `webContents.setUserAgent()`, and the per-host
   ad-block override (`adblock.setSiteAdblock` / `adblock.removeSite`).
2. **On rule change**: `ipc.js` → `site:setRule` re-applies the rule immediately to the active tab
   if its host matches.
3. **On ad-block check**: `adblock.js` resolves `getSiteAdblock(wcId)` per webContents —
   a per-host override wins; otherwise the global setting applies.

## Accessing Site Settings in the UI

1. Menu pill → **Site Settings** opens the per-site panel for the current tab's host
   (JavaScript, Ad Blocking, Pop-ups, and custom User Agent).
2. Settings panel (menu → Settings) holds global preferences: language, search engine,
   ad-blocking default, and data clearing.

## Extending the System

To add a new per-site setting:

1. Add a key to the site rule object in `src/main/config.js` defaults (and document it here)
2. Apply it in `tabs.js` → `loadURL()` (and in `ipc.js` → `site:setRule` for live updates)
3. Add a toggle/input in `renderer/app.js` → `renderSiteSettings()`
4. Optionally localize its label in `src/shared/i18n/locales/*.json`

The system is intentionally simple: a flat JSON map keyed by hostname is sufficient for a
lightweight browser.
