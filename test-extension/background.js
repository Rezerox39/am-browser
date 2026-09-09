// Test all bridge APIs on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[BridgeTest] Extension installed');

  // Test chrome.storage.local
  try {
    await chrome.storage.local.set({ testKey: 'hello from bridge', count: 42 });
    const data = await chrome.storage.local.get('testKey');
    console.log('[BridgeTest] storage.local:', JSON.stringify(data));
  } catch (e) {
    console.error('[BridgeTest] storage.local FAILED:', e.message);
  }

  // Test chrome.storage.sync
  try {
    await chrome.storage.sync.set({ syncKey: 'synced' });
    const data = await chrome.storage.sync.get('syncKey');
    console.log('[BridgeTest] storage.sync:', JSON.stringify(data));
  } catch (e) {
    console.error('[BridgeTest] storage.sync FAILED:', e.message);
  }

  // Test chrome.alarms
  try {
    chrome.alarms.create('test-alarm', { delayInMinutes: 0.1 });
    console.log('[BridgeTest] alarm created');
  } catch (e) {
    console.error('[BridgeTest] alarms FAILED:', e.message);
  }

  // Test chrome.cookies
  try {
    const cookies = await chrome.cookies.getAll({});
    console.log('[BridgeTest] cookies count:', cookies.length);
  } catch (e) {
    console.error('[BridgeTest] cookies FAILED:', e.message);
  }

  console.log('[BridgeTest] All bridge API tests completed');
});
