'use strict';

// Per-extension timer maps: extensionId -> Map<name, { timer, alarm }>
const timers = new Map();

function extensionTimers(extensionId) {
  if (!timers.has(extensionId)) timers.set(extensionId, new Map());
  return timers.get(extensionId);
}

function create({ context, args }) {
  const [name = '', alarmInfo = {}] = args;
  const extId = context.extensionId;
  const map = extensionTimers(extId);

  const delay = typeof alarmInfo.delayInMinutes === 'number'
    ? alarmInfo.delayInMinutes * 60 * 1000
    : typeof alarmInfo.when === 'number'
      ? Math.max(0, alarmInfo.when - Date.now())
      : 0;

  const period = typeof alarmInfo.periodInMinutes === 'number'
    ? alarmInfo.periodInMinutes * 60 * 1000
    : null;

  // Clear existing timer
  const old = map.get(name);
  if (old) clearTimeout(old.timer);

  const fire = () => {
    context.dispatchEvent('alarms.onAlarm', { name, scheduledTime: Date.now() });
    if (period != null) {
      const timer = setTimeout(fire, period);
      map.set(name, { timer, alarm: { name, scheduledTime: Date.now() + period, periodInMinutes: alarmInfo.periodInMinutes } });
    } else {
      map.delete(name);
    }
  };

  const timer = setTimeout(fire, Math.max(0, delay));
  map.set(name, { timer, alarm: { name, scheduledTime: Date.now() + delay, periodInMinutes: alarmInfo.periodInMinutes } });
  return undefined;
}

function get({ context, args }) {
  const [name = ''] = args;
  return extensionTimers(context.extensionId).get(name)?.alarm || null;
}

function getAll({ context }) {
  return Array.from(extensionTimers(context.extensionId).values()).map(e => e.alarm);
}

function clear({ context, args }) {
  const [name = ''] = args;
  const map = extensionTimers(context.extensionId);
  const entry = map.get(name);
  if (!entry) return false;
  clearTimeout(entry.timer);
  map.delete(name);
  return true;
}

function clearAll({ context }) {
  const map = extensionTimers(context.extensionId);
  for (const entry of map.values()) clearTimeout(entry.timer);
  const had = map.size > 0;
  map.clear();
  return had;
}

function destroyExtension(extensionId) {
  const map = timers.get(extensionId);
  if (!map) return;
  for (const entry of map.values()) clearTimeout(entry.timer);
  timers.delete(extensionId);
}

module.exports = { create, get, getAll, clear, clearAll, destroyExtension };
