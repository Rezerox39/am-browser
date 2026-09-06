# AM — Security Documentation

## Security Model

AM follows strict privilege separation:

1. **Main process** (Node.js): full OS access — sessions, files, network, windows
2. **Preload script** (`preload.js`): exposes a minimal, explicit whitelist of IPC channels via `contextBridge`
3. **Chrome renderer** (`index.html`): pure DOM over IPC — no Node access
4. **Web views** (`WebContentsView` per tab): fully sandboxed pages with no injected AM preload

## Threat Model & Mitigations

### 1. Code Execution from Web Content
**Risk**: Malicious page JavaScript escapes its sandbox.
**Mitigation**:
- Every tab view: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`,
  `webSecurity: true`, `allowRunningInsecureContent: false`
- Web views share the default session but receive no AM preload; only the extension
  runtime's frame preload is injected (needed for `chrome.*` APIs)
- The chrome renderer uses a strict CSP meta tag and never evaluates web content

### 2. Navigation to Dangerous Schemes
**Risk**: A page navigates to `file:`, `javascript:`, or an OS-level URI.
**Mitigation**:
- `will-navigate` blocks every scheme except `https:`, `http:`, `am:`, `file:`, `about:`,
  `data:`, `chrome-extension:`, and `chrome:`
- `setWindowOpenHandler` routes popups into AM tabs (or denies them); no bare OS windows
  are created from web content

### 3. IPC Channel Abuse
**Risk**: Compromised chrome code invokes privileged channels.
**Mitigation**:
- `contextBridge` exposes only `ALLOWED_INVOKE` (invoke) and `ALLOWED_ON` (events) sets
- Unknown channels are rejected with an error; new channels must be whitelisted explicitly
- IPC handlers live only in the main process and are registered idempotently

### 4. Content Security Policy
**Risk**: Injected inline scripts from compromised chrome content.
**Mitigation**:
- The chrome document ships a CSP meta tag (`script-src 'self' 'unsafe-inline'`, etc.)
- AM deliberately does **not** inject CSP headers on web pages — that breaks modern sites;
  sites manage their own CSP (same tradeoff as Chrome)

### 5. Permission Abuse
**Risk**: A page requests geolocation, notifications, camera, or microphone access.
**Mitigation**:
- `setPermissionRequestHandler` denies all requests by default
- `setPermissionCheckHandler` returns false by default
- Per-site overrides in `siteRules.permissions` are the extension point for users

### 6. Ad Blocker Rules
**Risk**: Malformed filter rules cause ReDoS or slow navigation.
**Mitigation**:
- Rules compile with `try/catch`; malformed patterns are dropped
- Only sub-frame/resources of the main document are filtered
- Exception rules (`@@`) are checked first; failures fall back to allowing the request

### 7. Extensions
**Risk**: A malicious extension reads browsing data or injects scripts.
**Mitigation**:
- Extensions run under Chromium's isolation with their declared `manifest.permissions`
- Web-store installs are logged (and prompted, if the dialog is enabled)
- `chrome.windows.create` is pinned to the existing window in this single-window build

## Potential Attack Vectors

| Vector | Status | Notes |
|---|---|---|
| Renderer RCE | Mitigated | Sandboxed views, contextIsolation |
| IPC escalation | Mitigated | Whitelist-only channels |
| ReDoS in filter rules | Mitigated | try/catch on all regex compilation |
| Dangerous-scheme navigation | Mitigated | `will-navigate` allowlist |
| Permission abuse | Mitigated | Deny-by-default handlers |
| XSS in chrome renderer | Low risk | CSP meta, no eval, no remote content |
| Download path traversal | Low risk | Paths come from Electron's own download flow |
