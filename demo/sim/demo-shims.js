// ApplyFast Interactive Demo: stands in for the Chrome extension runtime so the unmodified
// applyfast-core.js and content.js run on this page. Must load before content.js.
// Cash application stays free. Review & Reconciliation (capability reviewReconciliation only)
// is a local 14-day trial: unlicensed until license:startTrial, then entitled while the trial
// is active. No backend and no chrome.storage. ?license=free (the default) is unlicensed.
// ?license=premium and ?license=trial start already on an active trial. ?license=warning is an
// active trial inside the last 24 hours. ?license=expired is a consumed trial: reconciliation
// stays locked. A demo:expireTrial message does the same without a reload.
(function () {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const TRIAL_MS = 14 * DAY_MS;
  const CAPABILITY = 'reviewReconciliation';
  const mode = (new URLSearchParams(window.location.search).get('license') || 'free').toLowerCase();

  // Inside the guided demo the guide shows the disclaimer banner.
  if (window.top !== window) document.documentElement.classList.add('demo-embedded');

  // null: no trial record. A record is never replaced, restarted or extended.
  let trial = null;

  function seed(now) {
    if (mode === 'expired') {
      trial = { trialStartedAt: now - 15 * DAY_MS, trialEndsAt: now - DAY_MS, trialConsumed: true, trialWarningShown: true };
    } else if (mode === 'warning') {
      trial = { trialStartedAt: now - 13 * DAY_MS, trialEndsAt: now + 12 * 60 * 60 * 1000, trialConsumed: true, trialWarningShown: false };
    } else if (mode === 'premium' || mode === 'trial') {
      trial = { trialStartedAt: now, trialEndsAt: now + TRIAL_MS, trialConsumed: true, trialWarningShown: false };
    }
  }
  seed(Date.now());

  function warningDue(now) {
    return !!(trial && trial.trialConsumed === true && now < trial.trialEndsAt &&
      trial.trialWarningShown !== true && trial.trialEndsAt - now <= DAY_MS);
  }

  function entitlement(now) {
    if (trial && trial.trialConsumed === true && now < trial.trialEndsAt) {
      return {
        entitled: true,
        status: 'trial',
        validUntil: trial.trialEndsAt,
        capabilities: [CAPABILITY],
        trialEndsAt: trial.trialEndsAt,
        trialWarningDue: warningDue(now)
      };
    }
    const locked = { entitled: false, status: 'unlicensed', capabilities: [] };
    if (trial) return Object.assign({}, locked, { trialConsumed: true });
    return locked;
  }

  function startTrial(now) {
    const status = entitlement(now).status;
    if (trial || (status !== 'unlicensed' && status !== 'transition_ended')) return { ok: true, started: false };
    trial = { trialStartedAt: now, trialEndsAt: now + TRIAL_MS, trialConsumed: true, trialWarningShown: false };
    return { ok: true, started: true };
  }

  function markTrialWarning(now) {
    if (!warningDue(now)) return { ok: true, shown: !!(trial && trial.trialWarningShown === true) };
    trial = Object.assign({}, trial, { trialWarningShown: true });
    return { ok: true, shown: true };
  }

  function expireTrial(now) {
    const started = trial ? trial.trialStartedAt : now - 15 * DAY_MS;
    trial = { trialStartedAt: started, trialEndsAt: now - 1000, trialConsumed: true, trialWarningShown: true };
    return { ok: true };
  }

  const runtime = {
    id: 'applyfast-interactive-demo',
    lastError: undefined,
    sendMessage(message, callback) {
      const now = Date.now();
      let reply;
      const type = message && message.type;
      if (type === 'license:getEntitlement') reply = entitlement(now);
      else if (type === 'license:startTrial') reply = startTrial(now);
      else if (type === 'license:markTrialWarning') reply = markTrialWarning(now);
      else if (type === 'license:openActivation') reply = { ok: false };
      else if (type === 'demo:expireTrial') reply = expireTrial(now);
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
    localStorage.setItem('applyFast_monthlyMessage_' + now.getFullYear() + '_' + (now.getMonth() + 1), 'true');
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
