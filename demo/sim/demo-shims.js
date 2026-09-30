// ApplyFast Interactive Demo: stands in for the Chrome extension runtime so the unmodified
// applyfast-core.js and content.js run on this page. Must load before content.js.
// It contains no licensing logic: it always answers "licensed" so All pages can be tried.
(function () {
  'use strict';

  // Inside the guided demo the guide shows the disclaimer banner.
  if (window.top !== window) document.documentElement.classList.add('demo-embedded');

  const runtime = {
    id: 'applyfast-interactive-demo',
    lastError: undefined,
    sendMessage(message, callback) {
      let reply;
      if (message && message.type === 'license:getEntitlement') reply = { entitled: true, status: 'licensed', plan: 'demo' };
      else if (message && message.type === 'license:openActivation') reply = { ok: false };
      setTimeout(() => callback && callback(reply), 0);
    }
  };
  const storage = { onChanged: { addListener() {} } };
  const fake = Object.assign({}, window.chrome, { runtime, storage });
  try {
    Object.defineProperty(window, 'chrome', { value: fake, configurable: true, writable: true });
  } catch (e) {
    window.chrome = fake;
  }

  // The extension's monthly support message is not part of the demo.
  try {
    const now = new Date();
    localStorage.setItem(`applyFast_monthlyMessage_${now.getFullYear()}_${now.getMonth() + 1}`, 'true');
  } catch (e) { /* storage unavailable: the message only shows on the 1st */ }

  const params = new URLSearchParams(location.search);
  if (!params.has('debug')) {
    const noop = () => {};
    console.log = noop;
    console.info = noop;
    console.debug = noop;
  }

  // content.js reports empty or invalid input with alert(); show it as a non-blocking toast.
  window.__demoAlerts = [];
  let hideTimer = null;
  window.alert = message => {
    const text = String(message == null ? '' : message);
    window.__demoAlerts.push(text);
    let toast = document.getElementById('demoToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'demoToast';
      toast.setAttribute('role', 'alert');
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { toast.hidden = true; }, 6000);
  };
})();
