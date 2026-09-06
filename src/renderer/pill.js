'use strict';
(() => {
  const api = window.am;
  if (!api) return;

  const $ = (id) => document.getElementById(id);
  const btnBack = $('pillBack');
  const btnForward = $('pillForward');
  const btnHome = $('pillHome');
  const btnTabs = $('pillTabs');
  const btnExtensions = $('pillExtensions');
  const btnMenu = $('pillMenu');
  const tabBadge = $('pillTabCount');

  async function act(channel, ...args) {
    try { await api.invoke(channel, ...args); } catch (e) { console.error('[pill]', channel, e); }
    try { await api.invoke('ui:focusChrome'); } catch {}
  }

  function setDisabled(btn, disabled) {
    btn.classList.toggle('disabled', !!disabled);
  }

  // i18n tooltips
  (async () => {
    try {
      const strings = await api.invoke('i18n:getStrings');
      if (strings && typeof strings === 'object') {
        const apply = (btn, key) => { if (strings[key]) btn.title = strings[key]; };
        apply(btnBack, 'nav.back');
        apply(btnForward, 'nav.forward');
        apply(btnHome, 'nav.home');
        apply(btnTabs, 'tab.new');
        apply(btnExtensions, 'nav.extensions');
        apply(btnMenu, 'settings.title');
      }
    } catch {}
  })();

  btnBack.addEventListener('click', () => act('tabs:goBack'));
  btnForward.addEventListener('click', () => act('tabs:goForward'));
  btnHome.addEventListener('click', () => act('ui:showHome'));
  btnTabs.addEventListener('click', () => act('tabs:create'));
  btnExtensions.addEventListener('click', () => act('ui:openExtensions'));
  btnMenu.addEventListener('click', () => act('ui:openMenu'));

  api.on('tabs:changed', (tabs, aid, url, title, mode, canBack, canFwd) => {
    if (tabBadge) tabBadge.textContent = String((Array.isArray(tabs) ? tabs.length : 1) || 1);
    setDisabled(btnBack, !canBack);
    setDisabled(btnForward, !canFwd);
  });
})();
