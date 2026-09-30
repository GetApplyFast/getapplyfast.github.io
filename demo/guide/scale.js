// ApplyFast Interactive Demo: "what this means at scale". A conceptual picture of how repetitive
// manual cash application grows with invoice volume. Nothing here processes invoices, and no
// ApplyFast speed is claimed: the only number is the visitor's own manual-effort assumption,
// multiplied out in plain sight (invoices x seconds per invoice).
(function (root) {
  'use strict';

  const VOLUMES = [100, 250, 500, 1000, 2500];
  const SECONDS = [15, 30, 45, 60, 90];
  const DEFAULT_VOLUME = 1000;
  const DEFAULT_SECONDS = 30;
  const LADDER = [100, 500, 1000];
  const INVOICES_PER_DOT = 10;
  const DISCLAIMER = 'Illustrative estimate only. Actual time savings vary by workflow, remittance quality, and user.';

  const num = n => n.toLocaleString('en-US');

  function duration(totalSeconds) {
    if (totalSeconds < 3600) {
      const m = Math.round(totalSeconds / 60);
      return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
    }
    return `${(Math.round(totalSeconds / 360) / 10).toFixed(1)} hours`;
  }

  function estimate(volume, secondsPerInvoice) {
    const total = volume * secondsPerInvoice;
    return {
      total,
      duration: duration(total),
      formula: `${num(volume)} invoices × ${secondsPerInvoice} seconds = ${num(total)} seconds ≈ ${duration(total)}`
    };
  }

  function render(host, opts) {
    const count = opts.count;
    const still = !!opts.reducedMotion;
    const ladder = [{ value: count, label: 'this demo' }].concat(LADDER.map(v => ({ value: v })));
    host.innerHTML = `
      <div class="tour-scale-grid">
      <div class="tour-scale-story">
      <p class="tour-kicker">What this means at scale</p>
      <p class="tour-scale-lead">You just applied <b id="tourScaleCount">${num(count)} ${count === 1 ? 'invoice' : 'invoices'}</b>.</p>
      <h3 class="tour-scale-title" id="tourScaleTitle">Imagine doing this with 500+ invoices.</h3>
      <p>What you just did manually in this demo is the same type of repetitive workflow AR teams may perform across hundreds or thousands of invoices.</p>
      <ol class="tour-ladder${still ? ' is-still' : ''}" id="tourLadder" aria-label="Invoice volume">
        ${ladder.map((step, i) => `<li style="--i:${i}"><b data-value="${step.value}">${still ? label(step.value, i === ladder.length - 1) : num(i ? ladder[i - 1].value : 0)}</b><span>${step.label || 'invoices'}</span></li>`).join('')}
      </ol>
      <fieldset class="tour-volume">
        <legend>How many invoices do you typically apply?</legend>
        <div class="tour-seg">${VOLUMES.map(v => `<label><input type="radio" name="tourVolume" value="${v}"${v === DEFAULT_VOLUME ? ' checked' : ''}><span>${num(v)}</span></label>`).join('')}</div>
      </fieldset>
      </div>
      <div class="tour-scale-numbers">
      <div class="tour-compare">
        <div class="tour-col tour-manual">
          <p class="tour-col-title">Manual cash application</p>
          <p class="tour-col-count"><b id="tourManualCount"></b> invoices</p>
          <ol class="tour-flow">
            <li><span aria-hidden="true">&#128270;</span> Find invoice</li>
            <li><span aria-hidden="true">&#128269;</span> Match reference</li>
            <li><span aria-hidden="true">&#9997;&#65039;</span> Enter / apply amount</li>
            <li><span aria-hidden="true">&#128260;</span> Repeat <b id="tourRepeat"></b></li>
          </ol>
          <div class="tour-dots" id="tourDots" aria-hidden="true"></div>
          <p class="tour-dots-key">Each dot = ${INVOICES_PER_DOT} invoices</p>
          <p class="tour-col-foot">Hours of repetitive work</p>
        </div>
        <div class="tour-col tour-auto">
          <p class="tour-col-title">With ApplyFast</p>
          <p class="tour-col-count">The steps you just used</p>
          <ol class="tour-flow">
            <li><span aria-hidden="true">&#128203;</span> Paste references</li>
            <li><span aria-hidden="true">&#128064;</span> Review</li>
            <li><span aria-hidden="true">&#9989;</span> Apply</li>
            <li><span aria-hidden="true">&#128190;</span> Save</li>
          </ol>
          <p class="tour-col-foot">ApplyFast automates the repetitive matching and applying steps.</p>
        </div>
      </div>
      <div class="tour-estimate">
        <label class="tour-assume">Manual effort assumption:
          <select id="tourSeconds">${SECONDS.map(s => `<option value="${s}"${s === DEFAULT_SECONDS ? ' selected' : ''}>${s}</option>`).join('')}</select>
          seconds per invoice</label>
        <p class="tour-formula" id="tourFormula"></p>
        <p class="tour-effort">Potential manual effort: <b id="tourEffort"></b>*</p>
        <p class="tour-disclaimer" id="tourDisclaimer">* ${DISCLAIMER}</p>
      </div>
      </div>
      </div>
      <p class="tour-tagline">Less searching. Less clicking. Less repetitive work.</p>
      <p class="tour-tagline-sub">More time back for your team.</p>`;

    const $ = sel => host.querySelector(sel);
    function update() {
      const volume = Number((host.querySelector('input[name="tourVolume"]:checked') || {}).value || DEFAULT_VOLUME);
      const seconds = Number($('#tourSeconds').value);
      const e = estimate(volume, seconds);
      $('#tourManualCount').textContent = num(volume);
      $('#tourRepeat').textContent = `${num(volume)} times`;
      $('#tourFormula').textContent = e.formula;
      $('#tourEffort').textContent = `~${e.duration}`;
      $('#tourDots').innerHTML = '<i></i>'.repeat(Math.ceil(volume / INVOICES_PER_DOT));
      host.dataset.volume = String(volume);
    }
    host.addEventListener('change', e => { if (e.target.matches('input[name="tourVolume"], #tourSeconds')) update(); });
    update();
    if (!still) countUp(host.querySelectorAll('#tourLadder b'));
  }

  const label = (value, last) => num(value) + (last ? '+' : '');

  // Each number counts up from the previous step once its step has faded in.
  function countUp(nodes) {
    const STEP_MS = 550;
    nodes.forEach((b, i) => {
      const to = Number(b.dataset.value);
      const from = i ? Number(nodes[i - 1].dataset.value) : 0;
      const last = i === nodes.length - 1;
      const startAt = performance.now() + i * STEP_MS;
      function frame(now) {
        if (!b.isConnected) return;
        const t = Math.min(1, Math.max(0, (now - startAt) / STEP_MS));
        const eased = 1 - Math.pow(1 - t, 3);
        b.textContent = t < 1 ? num(Math.round(from + (to - from) * eased)) : label(to, last);
        if (t < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  const api = { VOLUMES, SECONDS, DEFAULT_VOLUME, DEFAULT_SECONDS, INVOICES_PER_DOT, DISCLAIMER, duration, estimate, render };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ApplyFastDemoScale = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
