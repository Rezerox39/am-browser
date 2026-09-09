'use strict';

const { session } = require('electron');
const logger = require('../logger');

function ses() { return session.defaultSession; }

// chrome.cookies.get
async function handleCookieGet(args) {
  const { url, name } = args || {};
  if (!url || !name) throw new Error('url and name required');
  const cookies = await ses().cookies.get({ url, name });
  return cookies.length > 0 ? formatCookie(cookies[0]) : null;
}

// chrome.cookies.getAll
async function handleCookieGetAll(args) {
  const { url, domain, path, name, secure, session } = args || {};
  const filter = {};
  if (url) filter.url = url;
  if (domain) filter.domain = domain;
  if (path) filter.path = path;
  if (name) filter.name = name;
  if (secure !== undefined) filter.secure = secure;
  if (session !== undefined) filter.session = session;
  const cookies = await ses().cookies.get(filter);
  return cookies.map(formatCookie);
}

// chrome.cookies.set
async function handleCookieSet(args) {
  const { url, name, value, domain, path, secure, httpOnly, expirationDate, sameSite } = args || {};
  if (!url || !name) throw new Error('url and name required');
  const details = { url, name, value: value || '' };
  if (domain) details.domain = domain;
  if (path) details.path = path;
  if (secure !== undefined) details.secure = secure;
  if (httpOnly !== undefined) details.httpOnly = httpOnly;
  if (expirationDate) details.expirationDate = expirationDate;
  if (sameSite) {
    const map = { 'unspecified': 'unspecified', 'no_restriction': 'no_restriction', 'lax': 'lax', 'strict': 'strict' };
    details.sameSite = map[sameSite] || 'unspecified';
  }
  await ses().cookies.set(details);
  const cookies = await ses().cookies.get({ url, name });
  return cookies.length > 0 ? formatCookie(cookies[0]) : null;
}

// chrome.cookies.remove
async function handleCookieRemove(args) {
  const { url, name } = args || {};
  if (!url || !name) throw new Error('url and name required');
  await ses().cookies.remove(url, name);
  return { url, name };
}

function formatCookie(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    hostOnly: c.hostOnly,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    session: c.session,
    expirationDate: c.expirationDate,
    storeId: c.storeId || '0',
  };
}

module.exports = {
  handleCookieGet,
  handleCookieGetAll,
  handleCookieSet,
  handleCookieRemove,
};
