'use strict';

class AdBlockEngine {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.blockRules = [];
    this.exceptRules = [];
    this.loadedLists = new Set();
    this.skipped = 0;
    this._domainPrefix = [];
    this.hits = { blocked: 0, allowed: 0 };
  }

  loadList(contents, sourceId) {
    if (!contents || this.loadedLists.has(sourceId)) {
      return { added: 0, skipped: 0 };
    }
    let added = 0;
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;
      const parsed = this._parseRule(line);
      if (!parsed) {
        this.skipped++;
        continue;
      }
      if (parsed.exception) this.exceptRules.push(parsed);
      else this.blockRules.push(parsed);
      added++;
    }
    this.loadedLists.add(sourceId);
    this._rebuildIndexes();
    return { added, skipped: this.skipped };
  }

  _parseRule(raw) {
    let rule = raw;
    let exception = false;
    if (rule.startsWith('@@')) {
      exception = true;
      rule = rule.slice(2);
    }
    if (!rule || rule === '*') return null;
    if (rule.includes('##') || rule.includes('#@#')) return null;

    if (rule.startsWith('/') && rule.endsWith('/') && rule.length > 2) {
      const body = rule.slice(1, -1);
      try {
        return { type: 'regex', re: new RegExp(body, 'i'), exception };
      } catch {
        return null;
      }
    }

    if (rule.startsWith('||')) {
      const body = rule.slice(2);
      const hash = body.indexOf('#');
      if (hash !== -1) return null;
      // Handle ^ as separator (end of host or start of path)
      const caretIdx = body.indexOf('^');
      let effective = caretIdx === -1 ? body : body.slice(0, caretIdx);
      const pathIdx = effective.search(/[/:*]/);
      const host = pathIdx === -1 ? effective : effective.slice(0, pathIdx);
      if (!host || !host.includes('.')) return null;
      let suffix = pathIdx === -1 ? '' : effective.slice(pathIdx);
      const fullMatch = !suffix;
      return { type: 'domainPrefix', host: host.toLowerCase(), suffix: suffix.toLowerCase(), exception, fullMatch };
    }

    if (rule.startsWith('|')) {
      const literal = rule.slice(1).toLowerCase();
      if (!literal) return null;
      return { type: 'prefix', literal, exception };
    }

    if (rule.includes('*')) {
      const parts = rule.split('*').map((p) => p.toLowerCase());
      if (parts.some((p) => p.length === 0)) return null;
      return { type: 'wildcard', parts, exception };
    }

    const literal = rule.toLowerCase();
    if (literal.length < 3) return null;
    return { type: 'substring', literal, exception };
  }

  _rebuildIndexes() {
    this._domainPrefix = this.blockRules
      .filter((r) => r.type === 'domainPrefix')
      .map((r) => r.host)
      .sort((a, b) => b.length - a.length);
  }

  shouldBlock(url, originDomain) {
    if (!this.enabled) return false;
    let u;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const lower = url.toLowerCase();
    const host = u.hostname.toLowerCase();
    const path = (u.pathname + (u.search || '')).toLowerCase();

    if (this._matchesAny(this.exceptRules, lower, host, path)) return false;

    const blocked = this._matchesAny(this.blockRules, lower, host, path);
    if (blocked) this.hits.blocked++;
    else this.hits.allowed++;
    return blocked;
  }

  _matchesAny(rules, lower, host, path) {
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.type === 'domainPrefix') {
        if (this._matchDomain(r, host, path)) return true;
      } else if (r.type === 'regex') {
        if (r.re.test(lower)) return true;
      } else if (r.type === 'prefix') {
        if (lower.startsWith(r.literal)) return true;
      } else if (r.type === 'wildcard') {
        if (this._matchWildcard(r.parts, lower)) return true;
      } else if (r.type === 'substring') {
        if (lower.includes(r.literal)) return true;
      }
    }
    return false;
  }

  _matchDomain(rule, host, path) {
    const dot = rule.host[0] === '.' ? '' : '.';
    const hostMatch = host === rule.host || host.endsWith(dot + rule.host);
    if (!hostMatch) return false;
    if (rule.fullMatch) return true;
    return path.startsWith(rule.suffix) || ('' + rule.suffix === '' && true) || (!!rule.suffix && path.startsWith(rule.suffix));
  }

  _matchWildcard(parts, lower) {
    let pos = 0;
    for (let i = 0; i < parts.length; i++) {
      const idx = lower.indexOf(parts[i], pos);
      if (idx === -1) return false;
      pos = idx + parts[i].length;
    }
    return true;
  }

  clear() {
    this.blockRules = [];
    this.exceptRules = [];
    this.loadedLists.clear();
    this.skipped = 0;
    this._rebuildIndexes();
  }

  stats() {
    return { ...this.hits, rules: this.blockRules.length + this.exceptRules.length };
  }
}

module.exports = { AdBlockEngine };
