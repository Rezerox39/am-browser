# AM — Security Documentation

## Security Model

AM follows a strict privilege separation:

1. **Main process** (Node.js): has full access — file system, network, sessions, downloads
2. **Preload script** (contextBridge): exposes a minimal whitelist of IPC channels
3. **Chrome renderer** (index.html): pure DOM, no Node access
4. **Web views** (WebContentsView): fully sandboxed, no Node access, no preload injection

## Threat Model & Mitigations

### 1. Code Execution from Web Content
**Risk**: Malicious JavaScript runs in a web page and attempts to escape the sandbox.
**Mitigation**:
- Every WebContentsView is created with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`
- No preload scripts are injected into web views
- `webSecurity: true` prevents cross-origin access
- `allowRunningInsecureContent: false` blocks HTTP resources on HTTPS pages

### 2. Navigation to Dangerous Schemes
**Risk**: A web page navigates to `file://`, `javascript://`, or OS-level URIs.
**Mitigation**:
- `will-navigate` event handler blocks all schemes except `https:`, `http:`, `am:`, `about:`, and `data:`
- Popup creation is intercepted by `setWindowOpenHandler` and routed to AM tabs

### 3. IPC Channel Abuse
**Risk**: Renderer code attempts to invoke privileged IPC channels.
**Mitigation**:
- Preload uses `contextBridge.exposeInMainWorld` with a strict whitelist
- Three separate whitelists: `ALLOWED_INVOKE`, `ALLOWED_SEND`, `ALLOWED_ON`
- Any channel not in the whitelist is rejected

### 4. Content Security Policy
**Risk**: Injected inline scripts from compromised content.
**Mitigation**:
- Response headers include a restrictive CSP on mainFrame
- The renderer HTML includes a CSP meta tag

### 5. Permission Abuse
**Risk**: A web page requests geolocation, notifications, or media access.
**Mitigation**:
- `setPermissionRequestHandler` denies all by default
- Per-site permission overrides are configurable in site settings

### 6. Ad Blocker Rules
**Risk**: Malformed filter lists could cause ReDoS or slow navigation.
**Mitigation**:
- All regex rules are compiled with `try/catch` — malformed patterns are silently dropped
- Non-mainFrame requests are not filtered
- Exception rules (`@@`) are checked first

## Potential Attack Vectors

| Vector | Status | Notes |
|---|---|---|
| Renderer RCE | Mitigated | Sandboxed + contextIsolated |
| IPC escalation | Mitigated | Whitelist-only channels |
| ReDoS in filter rules | Mitigated | try/catch on all regex |
| XSS in chrome renderer | Low risk | No eval, CSP enforced |
| Download directory traversal | Low risk | savePath validated by Electron dialog |
