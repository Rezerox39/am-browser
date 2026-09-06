# AM — Chrome Extension Support

AM can run two kinds of Chrome extensions:

1. **Unpacked extensions** dropped into the `extensions/` directory at the project root
2. **Chrome Web Store extensions** installed while browsing (auto-allowed in this build;
   see "Customizing the install prompt" below)

## How it works

`src/main/extensions.js` wires three packages:

| Package | Role |
|---|---|
| `electron-chrome-extensions` | `chrome.*` extension APIs (tabs, windows, storage, actions, context menus, ...) |
| `electron-chrome-web-store` | Extensions from the Chrome Web Store + local unpacked loading |
| `electron-chrome-context-menu` | Native context menu with extension `chrome.contextMenus` items |

The extension system is initialized after the main window and tab manager start
(`main.js` → `extensionsManager.init(win)`). Tab lifecycle is mirrored into the extension
store (`tabs.setLifecycleCallbacks`), so `chrome.tabs` APIs see every AM tab.

## Adding an unpacked extension

1. Create a folder inside `extensions/`, e.g. `extensions/my-extension/`
2. Put a valid `manifest.json` (MV2 or MV3) and the extension's files in it
3. Restart AM — the extension is loaded automatically

Example MV2 manifest:

```json
{
  "manifest_version": 2,
  "name": "My AM Extension",
  "version": "1.0.0",
  "background": { "scripts": ["background.js"], "persistent": true },
  "permissions": ["activeTab", "storage"]
}
```

Startup logs confirm the load (`logs/am.log`):

```
[INFO] [extensions] Loaded 1 extension(s) from local directory
[INFO] [extensions]   • My AM Extension 1.0.0 (abcdefghijklmnop)
```

## Chrome Web Store

Store installs are handled by the web-store package: visiting the Chrome Web Store and clicking
"Add to Chrome" installs the extension. In the current build the prompt is auto-allowed and logged
for audit. To show a real confirmation dialog instead, replace `beforeInstall` in
`src/main/extensions.js` with a `dialog.showMessageBox` flow.

## Known limitations

- Electron's `webRequest` API (used by the built-in ad blocker) suppresses `chrome.webRequest`
  listeners in extensions. Ad-blocking stays on; network-intercepting extensions are not supported.
- MV3 service workers are started at launch, but the extension runtime treats them as persistent
  (see the `electron-chrome-extensions` README).
- `chrome.windows.create` is mapped to the main window — AM is a single-window browser for now.
- Extensions in non-persistent/incognito sessions are unsupported (Electron limitation).

## Permissions pipeline

All permission requests from web content are denied by default in `security.js`. Per-site
permission overrides can be configured per host (see `docs/PER_SITE_SETTINGS.md`);
extension-granted permissions are the extension's own `manifest.permissions`.
