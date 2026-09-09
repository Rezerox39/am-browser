'use strict';

const logger = require('../logger');

// In-memory alarm store per extension
const alarms = new Map(); // extensionId -> Map<name, alarm>

function handleAlarmCreate(extensionId, name, alarmInfo) {
  if (!alarms.has(extensionId)) alarms.set(extensionId, new Map());
  const extAlarms = alarms.get(extensionId);

  const delay = alarmInfo.delayInMinutes || 0;
  const period = alarmInfo.periodInMinutes || 0;

  // Clear existing timer for this alarm
  const existing = extAlarms.get(name);
  if (existing && existing.timer) clearTimeout(existing.timer);

  const alarmData = {
    name,
    scheduledTime: Date.now() + delay * 60000,
    periodInMinutes: period,
    timer: null,
  };

  const fireAlarm = () => {
    alarmData.scheduledTime = Date.now() + period * 60000;
    // Notify extension via IPC (fire-and-forget event)
    try {
      const { webContents } = require('electron');
      const allWC = webContents.getAllWebContents();
      for (const wc of allWC) {
        if (!wc.isDestroyed() && wc.getURL().startsWith('chrome-extension://')) {
          wc.send(`am-ext-alarm`, extensionId, name);
        }
      }
    } catch {}
    if (period > 0) {
      alarmData.timer = setTimeout(fireAlarm, period * 60000);
    }
  };

  alarmData.timer = setTimeout(fireAlarm, delay * 60000);
  extAlarms.set(name, alarmData);
}

function handleAlarmGet(extensionId, name) {
  const extAlarms = alarms.get(extensionId);
  if (!extAlarms) return null;
  const alarm = extAlarms.get(name);
  if (!alarm) return null;
  return { name: alarm.name, scheduledTime: alarm.scheduledTime, periodInMinutes: alarm.periodInMinutes || undefined };
}

function handleAlarmGetAll(extensionId) {
  const extAlarms = alarms.get(extensionId);
  if (!extAlarms) return [];
  return Array.from(extAlarms.values()).map(a => ({
    name: a.name,
    scheduledTime: a.scheduledTime,
    periodInMinutes: a.periodInMinutes || undefined,
  }));
}

function handleAlarmClear(extensionId, name) {
  const extAlarms = alarms.get(extensionId);
  if (!extAlarms) return true;
  const alarm = extAlarms.get(name);
  if (alarm && alarm.timer) clearTimeout(alarm.timer);
  extAlarms.delete(name);
  return true;
}

function handleAlarmClearAll(extensionId) {
  const extAlarms = alarms.get(extensionId);
  if (!extAlarms) return true;
  for (const alarm of extAlarms.values()) {
    if (alarm.timer) clearTimeout(alarm.timer);
  }
  alarms.delete(extensionId);
  return true;
}

module.exports = {
  handleAlarmCreate,
  handleAlarmGet,
  handleAlarmGetAll,
  handleAlarmClear,
  handleAlarmClearAll,
};
