async function test() {
  const status = document.getElementById('status');
  const results = [];

  // Test storage
  try {
    await chrome.storage.local.set({ popupTest: 'works!' });
    const data = await chrome.storage.local.get('popupTest');
    results.push('storage.local: ' + (data.popupTest === 'works!' ? '✓' : '✗'));
  } catch (e) {
    results.push('storage.local: ✗ ' + e.message);
  }

  // Test tabs
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    results.push('tabs.query: ✓ (' + tabs.length + ' tabs)');
  } catch (e) {
    results.push('tabs.query: ✗ ' + e.message);
  }

  // Test cookies
  try {
    const cookies = await chrome.cookies.getAll({});
    results.push('cookies.getAll: ✓ (' + cookies.length + ' cookies)');
  } catch (e) {
    results.push('cookies.getAll: ✗ ' + e.message);
  }

  // Test alarms
  try {
    chrome.alarms.create('popup-test', { delayInMinutes: 1 });
    results.push('alarms.create: ✓');
  } catch (e) {
    results.push('alarms.create: ✗ ' + e.message);
  }

  // Test scripting
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      const results2 = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => document.title
      });
      results.push('scripting.executeScript: ✓ (title=' + results2[0]?.result + ')');
    }
  } catch (e) {
    results.push('scripting.executeScript: ✗ ' + e.message);
  }

  status.innerHTML = results.join('<br>');
}
test();
