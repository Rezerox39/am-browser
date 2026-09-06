// Test background service worker: responds to runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'ping') {
    sendResponse({ type: 'pong', from: 'background', time: Date.now() });
  }
  if (message && message.type === 'test-storage') {
    chrome.storage.local.set({ bgTest: 'active' }, () => {
      sendResponse({ type: 'storage-set', success: true });
    });
    return true; // async response
  }
});
