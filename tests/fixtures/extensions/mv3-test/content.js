// Test content script: adds a non-destructive marker to the page
(() => {
  const marker = document.createElement('div');
  marker.id = 'am-ext-test-marker';
  marker.textContent = 'AM Extension Active';
  marker.style.cssText = 'position:fixed;bottom:4px;right:4px;font-size:9px;color:rgba(90,131,255,0.4);z-index:999999;pointer-events:none;font-family:monospace;';
  (document.body || document.documentElement).appendChild(marker);
})();
