'use strict';

function ses(context) {
  if (!context.session) throw new Error('Extension session unavailable');
  return context.session;
}

function formatCookie(c) {
  return {
    name: c.name, value: c.value, domain: c.domain, hostOnly: c.hostOnly,
    path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
    session: c.session, expirationDate: c.expirationDate, storeId: c.storeId || '0',
  };
}

async function get({ context, args }) {
  const [details = {}] = args;
  const cookies = await ses(context).cookies.get({ url: details.url, name: details.name, storeId: details.storeId });
  return cookies.length > 0 ? formatCookie(cookies[0]) : null;
}

async function getAll({ context, args }) {
  const [details = {}] = args;
  const filter = {};
  if (details.url) filter.url = details.url;
  if (details.domain) filter.domain = details.domain;
  if (details.path) filter.path = details.path;
  if (details.name) filter.name = details.name;
  if (details.secure !== undefined) filter.secure = details.secure;
  if (details.session !== undefined) filter.session = details.session;
  const cookies = await ses(context).cookies.get(filter);
  return cookies.map(formatCookie);
}

async function set({ context, args }) {
  const [details = {}] = args;
  if (!details.url || !details.name) throw new Error('url and name required');
  const opts = { url: details.url, name: details.name, value: details.value || '' };
  if (details.domain) opts.domain = details.domain;
  if (details.path) opts.path = details.path;
  if (details.secure !== undefined) opts.secure = details.secure;
  if (details.httpOnly !== undefined) opts.httpOnly = details.httpOnly;
  if (details.expirationDate) opts.expirationDate = details.expirationDate;
  if (details.sameSite) {
    const map = { unspecified: 'unspecified', no_restriction: 'no_restriction', lax: 'lax', strict: 'strict' };
    opts.sameSite = map[details.sameSite] || 'unspecified';
  }
  await ses(context).cookies.set(opts);
  const updated = await ses(context).cookies.get({ url: details.url, name: details.name });
  return updated.length > 0 ? formatCookie(updated[0]) : null;
}

async function remove({ context, args }) {
  const [details = {}] = args;
  await ses(context).cookies.remove(details.url, details.name);
  return { url: details.url, name: details.name };
}

async function getAllCookieStores() { return []; }

module.exports = { get, getAll, set, remove, getAllCookieStores };
