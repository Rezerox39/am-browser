// Test popup script: stores a value and reads it back
chrome.storage.local.set({ testValue: 'working', testTime: Date.now() }, () => {
  chrome.storage.local.get(['testValue', 'testTime'], (data) => {
    const el = document.getElementById('data');
    if (el) {
      el.textContent = 'Storage: ' + JSON.stringify(data);
    }
  });
});
