# Extensions Directory

Place unpacked Chrome extensions here. Each extension should be in its own folder
with a valid `manifest.json` file.

### Loading Local Extensions
1. Create a folder inside this directory (e.g., `extensions/my-extension/`)
2. Add a `manifest.json` file (Manifest V2 or V3)
3. Restart AM Browser — extensions load automatically at startup

### Installing from Chrome Web Store
Navigate to the Chrome Web Store and install extensions like you would in Chrome.
AM Browser supports extension installation prompts.

### Example Extension Structure
```
extensions/
  my-extension/
    manifest.json
    background.js
    content.js
    popup.html
```
