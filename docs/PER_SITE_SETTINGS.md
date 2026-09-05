# AM — Per-Site Settings System

## Overview

Every website can have its own set of overrides stored in the `siteRules` map inside `settings.json`.

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
| `adblockEnabled` | boolean | true | Toggle ad blocking for this host |
| `javascript` | boolean | true | Enable/disable JavaScript |
| `popups` | boolean | false | Allow pop-up windows |
| `userAgent` | string | "" | Custom user agent (empty = global default) |
| `permissions.geolocation` | boolean | false | Allow location access |
| `permissions.notifications` | boolean | false | Allow notifications |
| `permissions.media` | boolean | false | Allow camera/microphone access |

## How Settings Are Applied

1. **On navigation**: `tabs.js` reads the host rule and calls `webContents.setJavaScriptEnabled()` and `webContents.setUserAgent()`
2. **On ad-block check**: `adblock.js` checks `getSiteAdblock(wcId)` per webContents
3. **On permission request**: `security.js` looks up per-site permission overrides

## Accessing Site Settings in the UI

1. **Omnibox shield button** (shield icon): opens the site settings panel for the current tab's host
2. **Settings panel**: global defaults + language + search engine

## Extending the System

To add a new per-site setting:

1. Add a key to the site rule object (document it here)
2. Apply the setting in `tabs.js` navigate()
3. Add a UI toggle in `renderer/app.js` -> renderSiteSettings()
4. Document it in this file

The system is intentionally simple — a flat JSON map keyed by hostname is sufficient for a lightweight browser.
