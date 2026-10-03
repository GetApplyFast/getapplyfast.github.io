// ApplyFast Interactive Demo guide. Tells the story beside the simulated Customer Payment page,
// which runs the real ApplyFast panel in an iframe. The guide only observes that page (panel state,
// pasted text, page rows) and never drives ApplyFast's matching, edits, applies or saves; the visitor does.
// The one exception: it enters the required Payment Received from the pasted remittance (fillPaymentReceived).
(function () {
  'use strict';

  const DATA = window.ApplyFastDemoData;
  const SCENARIOS = window.ApplyFastDemoScenarios;
  const Sheet = window.ApplyFastDemoSheet;
  const PAYMENT_DATE = '9/28/2026';
  const POLL_MS = 200;
  const SIM_URL = 'sim/custpymt.nl.html';

  const guide = document.getElementById('guide');
  const frame = document.getElementById('simFrame');
  const banner = document.getElementById('demoBanner');
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const pasteKeys = isMac ? '⌘V' : 'Ctrl+V';
  const copyKeys = isMac ? '⌘C' : 'Ctrl+C';
  const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = n => '$' + fmt(n);
  const cents = n => Math.round(n * 100);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const invoice = ref => DATA.invoices.find(i => i.ref === ref);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const STEPS_SINGLE = ['copy', 'open', 'paste', 'review', 'apply', 'check', 'save'];
  const STEPS_MULTI = ['copy', 'open', 'mode', 'scan', 'paste', 'review', 'apply', 'check', 'save'];
  const STEPS_RECON = ['copy', 'open', 'mode', 'scan', 'paste', 'review', 'filters', 'apply', 'recon', 'excel'];
  const STEP_LABELS = {
    copy: 'Copy the remittance from Excel',
    open: 'Open ApplyFast',
    mode: 'Choose All pages',
    scan: 'Scan all pages',
    paste: 'Paste it into ApplyFast',
    review: 'Click Review Cash Application',
    apply: 'Check the review, then Apply',
    filters: 'Walk the reconciliation filters',
    check: 'Review the result, then minimize ApplyFast',
    save: 'Save the payment',
    recon: 'See what Review & Reconciliation found',
    excel: 'Export the reconciliation report'
  };
  const STEP_SLOT = { loading: 'copy', scanning: 'scan', singlemode: 'paste', applying: 'apply', filters: 'filters', results: 'check', recon: 'recon', excel: 'excel' };
  // Step name mirrored onto the simulated page (it highlights the written rows during 'save').
  const FOCUS = { open: 'open', paste: 'paste', review: 'review', filters: 'review', apply: 'apply', mode: 'mode', scan: 'scan', singlemode: 'single', results: 'results', recon: 'results', excel: 'results', save: 'save', saved: 'saved' };
  // After Save: the saved page first, then the confirmation card. The time-savings payoff opens only if the visitor asks.
  const SAVED_PAGE_MS = 2400;
  const SAVED_CARD_MS = 2600;
  const GET_APPLYFAST_URL = 'https://applyfast.store/';
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Dimming starts below the demo header, so branding, Reset and navigation are never dimmed.
  const spot = window.ApplyFastDemoSpotlight.create({ top: () => banner.getBoundingClientRect().bottom });
  const Scale = window.ApplyFastDemoScale;

  let scenario = null;
  let view = 'scenario';
  let copied = false;
  let step = '';
  let sheet = null;
  let firstLoad = true;
  let savedPhase = '';
  let savedTimers = [];
  let dismissedSpot = '';
  // Per run: ApplyFast finished applying (stays true after its own Close resets the panel).
  let appliedSeen = false;
  // Per run: skipped lines in the most recent review (-1 before the first review) and the one before.
  let copiedVersion = 0;
  // Story B: the Cash Application Report captured from ApplyFast's own Excel download.
  let exportSeen = false;
  let exportReport = null;
  // Per session: the time-savings payoff has been opened by the visitor.
  let payoffShown = false;
  // Story B: walk the review's own reconciliation filters. Spotlight only; never a click,
  // so the review stays on All and no result row is hidden.
  let filterKeys = [];
  let filterBeat = 0;
  let filterBeatAt = 0;
  let filterWalkDone = false;
  let filterPulses = [];
  let reconExportAt = 0;
  let storyEndingDone = false;
  const FILTER_BEAT_MS = 800;
  const RECON_HANDOFF_MS = 1400;
  const STORY_ENDING_MS = 3600;

  /* ---------- Simulated page (read-only observation) ---------- */

  function simState() {
    let w;
    try { w = frame.contentWindow; } catch (e) { return null; }
    if (!w || !w.document || !w.ApplyFastDemo) return null;
    const d = w.document;
    const box = d.getElementById('applyFastBox');
    if (!box) return null;
    const area = d.getElementById('matchListArea');
    const op = d.getElementById('afOpStatus');
    const multi = d.querySelector('input[name="afMode"][value="multi"]');
    return {
      w, d, box,
      open: box.style.display !== 'none',
      state: box.dataset.state || 'idle',
      op: op ? op.dataset.op || '' : '',
      text: area ? area.value : '',
      multi: !!(multi && multi.checked),
      saved: w.ApplyFastDemo.saved()
    };
  }

  // The lines ApplyFast's own review skipped, with the reason it gives for each.
  function skippedLines(st) {
    if (!st) return [];
    return Array.from(st.d.querySelectorAll('#afPreview tr.af-skip')).map(tr => {
      const reason = tr.querySelector('.af-reason');
      return { lineNo: tr.dataset.line || '', raw: tr.dataset.raw || '', reason: reason ? reason.textContent.trim() : '' };
    });
  }

  function observe(st) {
    if (!st) return;
    if (st.state.startsWith('done')) appliedSeen = true;
    else if (appliedSeen && st.state === 'idle' && !st.text.trim() && !st.w.ApplyFastDemo.lines().some(l => l.apply)) {
      // ApplyFast's own Reset cleared the session and unticked its rows (its Close keeps both).
      appliedSeen = false;
      exportSeen = false;
      exportReport = null;
    } else if (st.state.startsWith('previewed')) {
      appliedSeen = false;
    }
  }

  function computeStep(st) {
    if (!st) return 'loading';
    if (st.saved) return 'saved';
    if (st.state.startsWith('applying')) return 'applying';
    if (appliedSeen) {
      if (scenario.id === 'exceptions') return exportSeen ? 'excel' : 'recon';
      if (!st.open) return 'save';
      return 'results';
    }
    if (st.state.startsWith('previewed')) {
      if (scenario.id === 'exceptions' && !filterWalkDone) return 'filters';
      return 'apply';
    }
    const pasted = st.text.trim() !== '';
    if (!copied && !pasted) return 'copy';
    if (!st.open) return 'open';
    if (scenario.multi) {
      if (!st.multi) return 'mode';
      if (st.op === 'scanning') return 'scanning';
      if (st.op !== 'ready') return 'scan';
    } else if (st.multi) {
      return 'singlemode';
    }
    return pasted ? 'review' : 'paste';
  }


  // Payment Received is required before ApplyFast reviews. The demo enters the pasted remittance's payment
  // total, as the visitor would from the deposit, unless the visitor has typed their own amount.
  let autoCash = '';
  function fillPaymentReceived(st) {
    const input = st && st.d.getElementById('afPaymentReceived');
    const core = st && st.w.ApplyFastCore;
    if (!input || !core || input.readOnly || !st.text.trim()) return;
    if (input.value && input.value !== autoCash) return;
    const stated = scenario && scenario.paymentReceived;
    const total = core.parseInput(st.text).entries.reduce((sum, e) => sum + cents(e.payment || 0), 0);
    const value = stated ? fmt(stated) : (total > 0 ? fmt(total / 100) : '');
    if (!value || value === input.value) return;
    input.value = autoCash = value;
    input.dispatchEvent(new st.w.Event('input', { bubbles: true }));
  }

  function visibleFilters(st) {
    if (!st) return [];
    return Array.from(st.d.querySelectorAll('#afPreview .af-filter')).map(btn => ({
      key: btn.dataset.filter || '',
      label: (btn.textContent || '').trim()
    })).filter(f => f.key);
  }

  function resetFilterWalk() {
    filterKeys = [];
    filterBeat = 0;
    filterBeatAt = 0;
    filterWalkDone = false;
    filterPulses = [];
  }

  function advanceFilterWalk(st) {
    if (!scenario || scenario.id !== 'exceptions') return;
    const previewing = !!(st && st.state.startsWith('previewed'));
    const applying = !!(st && st.state.startsWith('applying'));
    if (!previewing) {
      if (!applying && !appliedSeen) resetFilterWalk();
      return;
    }
    if (filterWalkDone) return;
    const filters = visibleFilters(st);
    if (!filters.length) return;
    const now = Date.now();
    if (!filterKeys.length) {
      filterKeys = filters.map(f => f.key);
      filterBeat = 0;
      filterBeatAt = now;
      filterPulses = [filterKeys[0]];
      return;
    }
    const beatMs = reducedMotion() ? 0 : FILTER_BEAT_MS;
    if (now - filterBeatAt < beatMs) return;
    if (filterBeat >= filterKeys.length - 1) {
      filterWalkDone = true;
      return;
    }
    filterBeat += 1;
    filterBeatAt = now;
    filterPulses.push(filterKeys[filterBeat]);
  }

  function tick() {
    if (view !== 'scenario' || !scenario) { if (spot.name) spot.hide(); return; }
    const st = simState();
    fillPaymentReceived(st);
    observe(st);
    advanceFilterWalk(st);
    const next = computeStep(st);
    if (next !== step) {
      const prev = step;
      step = next;
      renderStep(st);
      if ((step === 'results' || step === 'recon') && st && prev !== 'save') renderResult(st);
      if (step === 'excel') renderReport();
      else closeReportStage();
      if (step === 'save' && st) {
        if (document.getElementById('tourResult').hidden) renderResult(st);
        renderSaveCall();
      }
      if (step === 'results' && prev === 'save') renderReviewCall();
      if (step === 'saved' && st) renderSaved(st);
    }
    installExportWatch(st);
    if (st) st.d.body.dataset.demoFocus = FOCUS[step] || '';
    if (st) renderProgress(st);
    if (st) paintFilterWalk(st);
    if (step === 'recon') { if (!reconExportAt) reconExportAt = Date.now(); }
    else reconExportAt = 0;
    updateSpotlight(st);
  }

  /* ---------- Spotlight: what the visitor should use next ---------- */

  const inGuide = sel => () => document.querySelector(sel);
  const inSim = sel => () => { const st = simState(); return st ? st.d.querySelector(sel) : null; };
  // A control inside the real panel; while the panel is minimized, its launcher instead.
  const inPanel = sel => () => {
    const st = simState();
    if (!st) return null;
    return st.open ? st.d.querySelector(sel) : st.d.getElementById('afLauncher');
  };
  const modeLabel = value => () => {
    const st = simState();
    if (!st) return null;
    if (!st.open) return st.d.getElementById('afLauncher');
    const input = st.d.querySelector(`input[name="afMode"][value="${value}"]`);
    return input ? input.closest('label') : null;
  };
  const currentItem = { key: 'step', resolve: inGuide('#tourStep li.is-current'), ring: 'none' };
  // The simulated page's own top bar stays readable (half-dimmed) behind every step.
  const erpTopbar = { key: 'erpTopbar', resolve: inSim('.erp-topbar'), ring: 'secondary' };

  function spotlightFor(st) {
    switch (step) {
      case 'copy':
        return [{ key: 'story', resolve: inGuide('#tourStory'), ring: 'none' },
          { key: 'sheet', resolve: inGuide('.tour-sheet'), ring: 'static' },
          { key: 'copyButton', resolve: inGuide('#copyRemittance'), ring: 'pulse' }, currentItem];
      case 'open':
        return [{ key: 'launcher', resolve: inSim('#afLauncher'), ring: 'pulse' }, currentItem];
      case 'mode':
        return [{ key: 'mode', resolve: modeLabel('multi'), ring: 'pulse' },
          { key: 'multipage', resolve: inGuide('#tourMultipage'), ring: 'none' }, currentItem];
      case 'singlemode':
        return [{ key: 'mode', resolve: modeLabel('single'), ring: 'pulse' }, currentItem];
      case 'scan':
        return [{ key: 'scanStart', resolve: inPanel('#afScanStart'), ring: 'pulse' }, currentItem];
      case 'scanning':
        return [{ key: 'scanProgress', resolve: inPanel('#afScan'), ring: 'static' }, currentItem];
      case 'paste':
        return [{ key: 'paste', resolve: inPanel('#matchListArea'), ring: 'pulse' }, currentItem];
      case 'review':
        return [{ key: 'review', resolve: inPanel('#matchBtn'), ring: 'pulse' }, currentItem];
      case 'apply':
        return [{ key: 'preview', resolve: inPanel('#applyFastBox .af-right'), ring: 'static' },
          { key: 'apply', resolve: inPanel(scenario.multi ? '#afMultiApplyBtn' : '#afApplyBtn'), ring: 'pulse' }, currentItem];
      case 'applying':
        return [{ key: 'panel', resolve: inPanel('#applyFastBox'), ring: 'static' }, currentItem];
      case 'filters': {
        const filters = visibleFilters(st);
        const beat = Math.min(filterBeat, Math.max(filters.length - 1, 0));
        const rings = filters.map((f, i) => ({
          key: 'filter:' + f.key,
          resolve: inPanel('#afPreview .af-filter[data-filter="' + f.key + '"]'),
          ring: i === beat ? 'pulse' : 'static'
        }));
        return rings.concat([
          { key: 'reviewTable', resolve: inPanel('#afMultiTable, #afReviewTable'), ring: 'static' },
          currentItem
        ]);
      }
      case 'recon': {
        const handoff = reconExportAt && (Date.now() - reconExportAt > RECON_HANDOFF_MS);
        return [{ key: 'recon', resolve: inPanel('#afPreview .af-table-wrap'), ring: handoff ? 'static' : 'pulse' },
          { key: 'results', resolve: inSim('#afMultiResult, #afApplyResult'), ring: 'static' },
          { key: 'export', resolve: inSim('#afExportBtn'), ring: handoff ? 'pulse' : 'static' }, currentItem];
      }
      case 'excel':
        return [{ key: 'report', resolve: () => document.getElementById('tourReport'), ring: 'pulse' }, currentItem];
      case 'results':
        return [{ key: 'results', resolve: inSim('#applyFastBox .af-right'), ring: 'static' },
          { key: 'minimize', resolve: inSim('#afMinimizeBtn'), ring: 'pulse' }, currentItem];
      case 'save': {
        const rows = st ? Array.from(st.d.querySelectorAll('#apply_splits tr.erp-applied')).map(tr =>
          ({ key: `row:${tr.id}`, resolve: inSim(`#${tr.id}`), ring: 'static' })) : [];
        return [{ key: 'save', resolve: inSim('#btn_multibutton_submitter'), ring: 'pulse' }].concat(rows,
          [currentItem, { key: 'next', resolve: inGuide('#tourNext'), ring: 'none' }]);
      }
      case 'saved':
        if (savedPhase === 'page') {
          return [{ key: 'savedBanner', resolve: inSim('#erpSaved'), ring: 'static' },
            { key: 'savedRows', resolve: inSim('#apply_splits'), ring: 'static' },
            { key: 'savedNote', resolve: inGuide('#tourSavedNote'), ring: 'none' }];
        }
        if (savedPhase === 'card') return [{ key: 'savedCard', resolve: inGuide('#tourSavedWrap'), ring: 'static' }];
        return [];
      default:
        return [];
    }
  }


  function installExportWatch(st) {
    if (!st || st.w.__afExportWatch) return;
    st.w.__afExportWatch = true;
    const orig = st.w.URL.createObjectURL.bind(st.w.URL);
    st.w.URL.createObjectURL = function (blob) {
      const url = orig(blob);
      if (blob && /sheet/.test(blob.type || '')) {
        blob.arrayBuffer().then(buf => {
          exportReport = parseReport(buf);
          exportSeen = !!exportReport;
          tick();
        }).catch(() => {});
      }
      return url;
    };
  }

  function parseReport(buf) {
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);
    const u16 = o => view.getUint16(o, true);
    const u32 = o => view.getUint32(o, true);
    let end = bytes.length - 22;
    while (end >= 0 && u32(end) !== 0x06054b50) end--;
    if (end < 0) return null;
    const count = u16(end + 10);
    let at = u32(end + 16);
    const files = {};
    const dec = new TextDecoder('utf-8');
    for (let i = 0; i < count; i++) {
      if (u32(at) !== 0x02014b50) return null;
      const method = u16(at + 10);
      const size = u32(at + 20);
      const nameLen = u16(at + 28), extraLen = u16(at + 30), commentLen = u16(at + 32);
      const local = u32(at + 42);
      const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
      const dataAt = local + 30 + u16(local + 26) + u16(local + 28);
      if (method !== 0) return null;
      files[name] = dec.decode(bytes.subarray(dataAt, dataAt + size));
      at += 46 + nameLen + extraLen + commentLen;
    }
    const xml = files['xl/worksheets/sheet1.xml'];
    if (!xml) return null;
    const unescapeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const rows = [];
    const rowRe = /<row [^>]*r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
    let m;
    while ((m = rowRe.exec(xml))) {
      const r = Number(m[1]) - 1;
      rows[r] = rows[r] || [];
      const cellRe = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let c;
      while ((c = cellRe.exec(m[2] || ''))) {
        const col = c[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const t = (c[2].match(/t="([^"]+)"/) || [])[1];
        const body = c[3] || '';
        if (t === 'inlineStr') rows[r][col] = unescapeXml((body.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [, ''])[1]);
        else if (/<v>/.test(body)) rows[r][col] = Number(body.match(/<v>([^<]*)<\/v>/)[1]);
      }
    }
    const headers = (rows[10] || []).map(h => (h && String(h).startsWith('Difference') ? 'Difference' : h));
    const endRow = rows.findIndex((r, i) => i > 10 && r && r[0] === 'TOTALS');
    const data = rows.slice(11, endRow < 0 ? rows.length : endRow).map(r => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = r && r[i] !== undefined ? r[i] : null; });
      return obj;
    });
    return { title: rows[0] && rows[0][0], headers: headers.filter(Boolean), rows: data };
  }

  function closeReportStage() {
    const stage = document.getElementById('tourReportStage');
    if (stage) stage.remove();
  }

  function renderReport() {
    if (!exportReport || document.getElementById('tourReport')) {
      if (document.getElementById('tourReport')) scheduleStoryEnding();
      return;
    }
    const headers = exportReport.headers;
    const head = headers.map(h => `<th>${esc(h)}</th>`).join('');
    const body = exportReport.rows.map(row => `<tr>${headers.map(h => `<td>${row[h] === null || row[h] === undefined ? '' : esc(row[h])}</td>`).join('')}</tr>`).join('');
    const stage = document.createElement('div');
    stage.id = 'tourReportStage';
    stage.className = 'tour-report-stage';
    stage.setAttribute('role', 'dialog');
    stage.setAttribute('aria-modal', 'true');
    stage.setAttribute('aria-label', exportReport.title || 'Cash Application Report');
    stage.style.top = Math.round(banner.getBoundingClientRect().bottom) + 'px';
    stage.innerHTML = `
      <div id="tourReport">
        <p class="tour-kicker">${esc(exportReport.title || 'Cash Application Report')}</p>
        <p>This is the report ApplyFast just downloaded. The columns are the report\u2019s own columns.</p>
        <div class="tour-report">
          <table class="tour-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
        </div>
      </div>`;
    document.body.appendChild(stage);
    scheduleStoryEnding();
  }

  function scheduleStoryEnding() {
    if (storyEndingDone || !scenario || scenario.id !== 'exceptions') return;
    storyEndingDone = true;
    // Hold the centered report even when motion is reduced. Reduced motion only
    // stops the pulse animation; it must not skip the report.
    const delay = STORY_ENDING_MS;
    savedTimers.push(setTimeout(() => {
      if (view !== 'scenario' || !scenario || scenario.id !== 'exceptions' || step !== 'excel' || payoffOpen()) return;
      const st = simState();
      const count = st ? st.w.ApplyFastDemo.lines().filter(l => l.apply).length : 0;
      openPayoff(count, { ending: 'reconciliation' });
    }, delay));
  }

  function updateSpotlight(st) {
    const list = view === 'scenario' && !payoffOpen() ? spotlightFor(st) : [];
    const name = list.length ? `${step}${savedPhase && step === 'saved' ? ':' + savedPhase : ''}` : '';
    if (!name || name === dismissedSpot) { if (spot.name) spot.hide(); return; }
    dismissedSpot = '';
    spot.show(name, [erpTopbar].concat(list));
  }

  // Escape closes the payoff if it is open; otherwise it puts the spotlight away until the next step.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (payoffOpen()) { closePayoff(); return; }
    if (spot.name) { dismissedSpot = spot.name; spot.hide(); }
  });

  // Page-by-page progress, read from the real panel's scan list and the page being shown.
  function renderProgress(st) {
    const host = document.getElementById('tourProgress');
    if (!host) return;
    const rows = Array.from(st.d.querySelectorAll('#applyFastBox .af-scan-pages tbody tr'));
    const pages = rows.map((tr, i) => {
      const status = (tr.querySelector('.af-st') || {}).textContent || '';
      const loaded = tr.classList.contains('af-loaded');
      const mark = status === 'Scanned' ? 'is-done' : step === 'scanning' && loaded ? 'is-active' : '';
      return `<li class="${mark}">${mark === 'is-done' ? '&#10003;' : mark ? '&#9679;' : '&#9675;'} Page ${i + 1}</li>`;
    }).join('');
    let status = '';
    if (step === 'applying') {
      const page = st.w.ApplyFastDemo.page();
      status = `<p class="tour-progress-note">Applying&hellip; on page ${page.current} of ${page.total}</p>`;
    }
    const html = (pages ? `<ul class="tour-pages">${pages}</ul>` : '') + status;
    if (host.innerHTML !== html) host.innerHTML = html;
  }

  function clearSaved() {
    savedTimers.forEach(clearTimeout);
    savedTimers = [];
    savedPhase = '';
  }

  function resetLoop() {
    appliedSeen = false;
    exportSeen = false;
    exportReport = null;
  }

  function resetRun() {
    step = '';
    resetLoop();
    copiedVersion = 0;
    clearSaved();
    storyEndingDone = false;
    closeReportStage();
    reconExportAt = 0;
    resetFilterWalk();
    closePayoff(true);
    spot.hide();
  }

  function simSrc() {
    return scenario && scenario.entitled ? SIM_URL + '?license=trial' : SIM_URL;
  }

  function reloadSim() {
    frame.src = simSrc();
  }

  frame.addEventListener('load', () => {
    step = '';
    resetLoop();
    // Capture phase: Payment Received is filled before ApplyFast's own Review click handler runs.
    const fillNow = e => {
      if (view === 'scenario' && scenario && e.target && (e.target.id === 'matchListArea' || e.target.id === 'matchBtn')) fillPaymentReceived(simState());
    };
    try {
      frame.contentDocument.addEventListener('input', fillNow, true);
      frame.contentDocument.addEventListener('click', fillNow, true);
    } catch (e) { /* the simulated page is same-origin; nothing to hook otherwise */ }
    tick();
  });

  /* ---------- Time-savings payoff (full-screen, below the header) ---------- */

  const payoffOpen = () => !!document.getElementById('tourPayoff');

  function openPayoff(count, opts) {
    closeReportStage();
    if (payoffOpen()) return;
    payoffShown = true;
    const ending = !!(opts && opts.ending === 'reconciliation');
    const still = reducedMotion();
    const layer = document.createElement('div');
    layer.className = `tour-payoff${still ? ' is-still' : ''}`;
    layer.id = 'tourPayoff';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'tourScaleTitle');
    layer.style.top = `${Math.round(banner.getBoundingClientRect().bottom)}px`;
    const done = ending
      ? `The reconciliation report is ready. You applied ${plural(count, 'invoice', 'invoices')}, and the exceptions stayed classified.`
      : `&#10003; Payment saved. You just applied ${plural(count, 'invoice', 'invoices')}.`;
    const cta = ending
      ? `<div class="tour-cta" id="tourCta">
          <p class="tour-cta-title">Imagine having these exceptions identified, and the reconciliation report ready to hand off.</p>
          <p>Review &amp; Reconciliation is ApplyFast Premium. Cash application, including multi-page, stays free, and cash application does not expire.</p>
          <div class="tour-actions">
            <a class="tour-btn tour-primary" id="getApplyFast" href="${GET_APPLYFAST_URL}" target="_blank" rel="noopener">Get ApplyFast</a>
            <button type="button" class="tour-btn" id="payoffReplay">Run it again</button>
            <button type="button" class="tour-link" id="payoffExplore">Guided story</button>
          </div>
        </div>`
      : `<div class="tour-cta" id="tourCta">
          <p class="tour-cta-title">Ready to see what ApplyFast can do for your workflow?</p>
          <div class="tour-actions">
            <button type="button" class="tour-btn tour-primary" id="payoffMultiPage">Now let’s try a larger multi-page payment</button>
            <button type="button" class="tour-btn" id="payoffExplore">Guided story</button>
            <button type="button" class="tour-link" id="payoffContinue">Continue exploring this page</button>
          </div>
        </div>`;
    layer.innerHTML = `
      <div class="tour-payoff-card" tabindex="-1">
        <button type="button" class="tour-payoff-close" id="payoffClose" aria-label="Close the time-savings story">&times;</button>
        <p class="tour-payoff-done">${done}</p>
        <section class="tour-scale" id="tourScale" aria-label="What this means at scale"><div id="tourScaleBody"></div></section>
        ${cta}
      </div>`;
    layer.addEventListener('click', e => { if (e.target === layer) closePayoff(); });
    document.body.appendChild(layer);
    Scale.render(document.getElementById('tourScaleBody'), { count, reducedMotion: still });
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('payoffClose', () => closePayoff());
    on('payoffContinue', () => closePayoff());
    on('payoffExplore', () => { closePayoff(true); showPicker(); });
    on('payoffMultiPage', () => { closePayoff(true); loadScenario('multipage'); });
    on('payoffReplay', () => { closePayoff(true); loadScenario('exceptions'); });
    spot.hide();
    requestAnimationFrame(() => layer.classList.add('is-open'));
    layer.querySelector('.tour-payoff-card').focus({ preventScroll: true });
  }

  function closePayoff(quiet) {
    const layer = document.getElementById('tourPayoff');
    if (!layer) return;
    layer.remove();
    if (savedPhase === 'payoff') savedPhase = 'done';
    if (!quiet) {
      const link = document.getElementById('tourPayoffLink');
      if (link) link.focus({ preventScroll: true });
    }
  }

  /* ---------- Views ---------- */

  function loadScenario(id) {
    scenario = SCENARIOS.byId(id);
    view = 'scenario';
    copied = false;
    resetRun();
    renderScenario();
    const want = simSrc();
    if (firstLoad && (frame.getAttribute('src') || '') === want) {
      firstLoad = false;
      tick();
    } else {
      firstLoad = false;
      frame.src = want;
    }
  }

  function showPicker() {
    view = 'picker';
    resetRun();
    let num = 0;
    const cards = SCENARIOS.scenarios.map(s => `
      <button type="button" class="tour-card" data-scenario="${s.id}">
        <span class="tour-card-num">${++num}</span>
        <span class="tour-card-body"><b>${esc(s.title)}</b><span>${esc(s.card)}</span></span>
      </button>`).join('');
    guide.innerHTML = `
      <section class="tour-block">
        <p class="tour-kicker">Guided story</p>
        <h2>Apply the cash. See what needs reconciliation.</h2>
        <p>Start with a clean cash application, then a larger multi-page payment, then a remittance that contains exceptions.</p>
      </section>
      <div class="tour-cards" id="scenarioList">${cards}</div>
      <button type="button" class="tour-link" id="replayBasic">&#8634; Replay basic cash application</button>`;
    guide.querySelectorAll('[data-scenario]').forEach(b => b.addEventListener('click', () => loadScenario(b.dataset.scenario)));
    document.getElementById('replayBasic').addEventListener('click', () => loadScenario('basic'));
    guide.scrollTop = 0;
  }

  function multipageHtml() {
    return `
      <div class="tour-multipage" id="tourMultipage">
        <p class="tour-multipage-title"><span aria-hidden="true">&#9733;</span> Multi-Page Cash Application</p>
        <p class="tour-multipage-lead">Scan and apply across multiple invoice pages automatically.</p>
        <p class="tour-multipage-note">Free in the real extension</p>
        <ul class="tour-multipage-modes">
          <li><b>This page only</b><span>Free</span></li>
          <li><b>All pages</b><span>Free</span></li>
        </ul>
      </div>`;
  }

  function introHtml() {
    const pageList = Array.from(new Set(scenario.lines.map(l => SCENARIOS.pageOf(l.invoice)).filter(n => n >= 1))).sort((a, b) => a - b);
    const pages = scenario.multi && pageList.length > 1
      ? `<p class="tour-muted">These invoices are on pages ${pageList.slice(0, -1).join(', ')} and ${pageList[pageList.length - 1]} of the Invoices list.</p>`
      : '';
    if (scenario.id === 'basic') {
      return `
        <section class="tour-block" id="tourStory">
          <p class="tour-kicker">Story A</p>
          <h2>You\u2019re an AR specialist.</h2>
          <p>${esc(DATA.customer.name)} just sent a payment of <b>${money(scenario.totalPaid)}</b>. The remittance is short: ${plural(scenario.lines.length, 'invoice', 'invoices')}, each one paid in full.</p>
          <p>Every line matches. There is nothing to correct.</p>
          <p class="tour-muted">Normally, you would search for each invoice on the Customer Payment page, tick it and type the amount, one line at a time.</p>
          <h3 class="tour-try">Try ApplyFast.</h3>
          <p class="tour-muted">Cash application is free, on this page and across all pages. Multi-page is not Premium.</p>
        </section>`;
    }
    const kicker = scenario.story === 'B' ? 'Story B' : 'Story A';
    return `
      <section class="tour-block" id="tourStory">
        <button type="button" class="tour-link" id="backToPicker">&larr; Guided story</button>
        <p class="tour-kicker">${kicker}</p>
        <h2>${esc(scenario.title)}</h2>
        ${scenario.highlight ? multipageHtml() : ''}
        <p class="tour-lead">${esc(scenario.intro)}</p>
        ${scenario.introMore ? `<p>${esc(scenario.introMore)}</p>` : ''}
        ${pages}
      </section>`;
  }

  function renderScenario() {
    guide.innerHTML = `
      ${introHtml()}
      <section class="tour-block tour-sheet">
        <p class="tour-instr">Copy the remittance lines from Excel.</p>
        <div id="sheetHost"></div>
        <div class="tour-copyrow">
          <button type="button" class="tour-btn tour-primary" id="copyRemittance">Copy Remittance</button>
          <span class="tour-note" id="copyNote">Or select the cells and press ${copyKeys}.</span>
        </div>
      </section>
      <section class="tour-block tour-steps" id="tourStep" aria-live="polite"></section>
      <section class="tour-block tour-result" id="tourResult" hidden></section>`;

    const fileName = `Remittance_Harborview_2026-09-28${scenario.id === 'basic' ? '' : '_' + scenario.id}.xlsx`;
    sheet = Sheet.render(document.getElementById('sheetHost'), Sheet.remittanceSheet(scenario, DATA.customer, PAYMENT_DATE), {
      fileName,
      editable: false,
      onCopy: text => {
        copied = true;
        copiedVersion = sheet.version();
        const lines = text.split('\n').filter(l => l.trim()).length;
        document.getElementById('copyNote').textContent = `Copied ${plural(lines, 'row', 'rows')}. Now open ApplyFast.`;
        tick();
      }
    });
    document.getElementById('copyRemittance').addEventListener('click', () => sheet.copyData());
    const back = document.getElementById('backToPicker');
    if (back) back.addEventListener('click', showPicker);
    guide.scrollTop = 0;
  }

  function reviewHint() {
    if (scenario.id === 'exceptions') {
      return 'Ready lines will be applied. Lines ApplyFast cannot match are skipped and left in the review. The remittance stays as it is.';
    }
    if (scenario.multi) return 'The review covers every page. Apply writes each invoice on its own page.';
    return 'Each remittance line matched exactly one open invoice and is marked Ready.';
  }

  function reconFound(st) {
    if (!st) return '';
    const rows = Array.from(st.d.querySelectorAll('#afPreview tr[data-recon]'));
    const counts = {};
    rows.forEach(tr => {
      const label = ((tr.querySelector('.af-recon') || {}).textContent || tr.getAttribute('data-recon') || '').trim();
      if (label) counts[label] = (counts[label] || 0) + 1;
    });
    const items = Object.keys(counts).map(k => `<li>${esc(k)}: ${counts[k]}</li>`).join('');
    const title = st.d.querySelector('.af-sum-title');
    return `<p>${title ? esc(title.textContent) : 'Cash application is complete.'}</p>` +
      (items ? `<ul class="tour-exception-list" id="tourReconCounts">${items}</ul>` : '') +
      '<p class="tour-muted">These labels are ApplyFast\u2019s own reconciliation statuses. ApplyFast does not clear the exceptions or decide the accounting treatment.</p>';
  }

  function stepDetail(st) {
    switch (step) {
      case 'loading':
      case 'copy':
        return `<p>This is the remittance advice sitting in Excel.</p>
          <p>Copy the invoice references from the spreadsheet: click <b>Copy Remittance</b>, or select the lines and press ${copyKeys}.</p>`;
      case 'open':
        return `<p><b>Remittance copied.</b></p>
          <p>Now open ApplyFast. Click the ApplyFast icon on the Customer Payment page.</p>`;
      case 'mode':
        return '<p>What if the invoices aren’t all on the current page? In the ApplyFast panel, choose <b>All pages</b>. Scanning and applying across pages is free.</p>' +
          `<div class="tour-multipage tour-multipage-inline" id="tourMultipageStep">
            <p class="tour-multipage-title"><span aria-hidden="true">&#9733;</span> Multi-Page Cash Application</p>
            <p class="tour-multipage-lead">Scan and apply across multiple invoice pages automatically.</p>
            <p class="tour-multipage-note">Free in the real extension &middot; <b>This page only</b> and <b>All pages</b></p>
          </div>`;
      case 'scan':
        return '<p>Click <b>Scan All Pages</b>. ApplyFast switches through every page of the list and reads it. Scanning never writes anything.</p>';
      case 'scanning':
        return '<p>Scanning&hellip; ApplyFast is reading each page of the Invoices list.</p><div id="tourProgress" class="tour-progress"></div>';
      case 'paste':
        return `${scenario.multi ? '<div id="tourProgress" class="tour-progress"></div>' : ''}
          <p><b>Paste your remittance here.</b></p>
          <p>Click the Payment References box in the ApplyFast panel and press ${pasteKeys}.</p>
          <button type="button" class="tour-link" id="pasteForMe">Can’t paste? Paste it for me</button>`;
      case 'singlemode':
        return '<p>This remittance only needs the current page. In the ApplyFast panel, choose <b>This page only</b>.</p>';
      case 'review':
        return '<p>ApplyFast already turned your Excel rows into lines it understands. Click <b>Review Cash Application</b>. Nothing is written yet.</p>' +
          '<p class="tour-muted">Payment Received is required. In this demo it is entered for you' +
          (scenario.paymentReceived ? ', as the cash that arrived.' : ': the remittance\u2019s payment total.') + '</p>';
      case 'filters':
        return filterWalkHtml(st);
      case 'apply':
        return `<p>This is the review. ${esc(reviewHint())}</p>
          <p class="tour-muted">Requested is what the remittance asks for; Applied is the Payment Apply writes.</p>
          ${scenario.id === 'exceptions' ? '<p id="tourFilterNote">The reconciliation filters on this review only change which rows are shown. The walk left every row visible.</p>' : ''}
          <p>When it looks right, click <b>Apply</b>. ${scenario.id === 'exceptions' ? 'You do not change the remittance first.' : ''}</p>`;
      case 'applying':
        return scenario.multi ? '<div id="tourProgress" class="tour-progress"></div>' : '<p>Applying&hellip;</p>';
      case 'recon':
        return `<p><b>Cash application is complete.</b> The lines ApplyFast could apply are on the payment. Nothing was left for you to correct.</p>
          <p>Now see what <b>Review &amp; Reconciliation</b> found. It classifies this application. It does not change what was applied.</p>
          <p>The filters on that review sort these same rows. They never change what was applied.</p>
          ${reconFound(st)}
          <p>Next, click <b>Export Excel</b> for the Cash Application Report.</p>`;
      case 'excel':
        return '<p><b>The reconciliation report is open.</b> The Cash Application Report ApplyFast just downloaded is in the center. Review &amp; Reconciliation is ApplyFast Premium. Cash application, including multi-page, stays free, and cash application does not expire.</p>';
      case 'results':
        return `<p><b>Cash application is complete.</b></p>
          <p>${scenario.id === 'basic' ? 'These invoices were applied. There were no exceptions to correct.' : 'Check the messages and applied amounts.'}</p>
          <p>When you\u2019re satisfied, close or minimize ApplyFast and save the payment.</p>
          <p class="tour-muted">Use the <b>&ndash;</b> button at the top right of the ApplyFast panel.</p>`;
      case 'save':
        return '<p>Click <b>Save</b> at the top of the Customer Payment page.</p>';
      default:
        return '';
    }
  }


  function filterWalkHtml(st) {
    const filters = visibleFilters(st);
    const beat = Math.min(filterBeat, Math.max(filters.length - 1, 0));
    const current = filters[beat];
    const items = filters.map((f, i) => `<li class="${i === beat ? 'is-current' : ''}">${esc(f.label)}</li>`).join('');
    const name = current ? esc(current.label) : 'these filters';
    return `<p>These are the reconciliation filters already on this review. Each one only changes which rows are shown. ApplyFast still writes the full plan, and this walk leaves every row visible.</p>
      <p id="tourFilterBeat">Now: <b>${name}</b></p>
      <ul class="tour-loop" id="tourFilterWalk">${items}</ul>
      <p class="tour-muted">Review &amp; Reconciliation is ApplyFast Premium. Cash application, including multi-page, stays free, and cash application does not expire.</p>`;
  }

  function paintFilterWalk(st) {
    const list = document.getElementById('tourFilterWalk');
    if (!list || step !== 'filters') return;
    const filters = visibleFilters(st);
    const beat = Math.min(filterBeat, Math.max(filters.length - 1, 0));
    if (list.dataset.beat === String(beat)) return;
    list.dataset.beat = String(beat);
    list.querySelectorAll('li').forEach((li, i) => li.classList.toggle('is-current', i === beat));
    const name = document.querySelector('#tourFilterBeat b');
    if (name && filters[beat]) name.textContent = filters[beat].label;
  }

  function renderStep(st) {
    const host = document.getElementById('tourStep');
    if (!host) return;
    const steps = scenario.id === 'exceptions' ? STEPS_RECON : scenario.multi ? STEPS_MULTI : STEPS_SINGLE;
    const slot = STEP_SLOT[step] || step;
    const current = step === 'saved' ? steps.length : steps.indexOf(slot);
    host.innerHTML = `<ol class="tour-checklist">${steps.map((s, i) => {
      const cls = i < current ? 'is-done' : i === current ? 'is-current' : '';
      return `<li class="${cls}" data-step="${s}"><span class="tour-check">${i < current ? '&#10003;' : i + 1}</span><span>${STEP_LABELS[s]}${i === current ? `<div class="tour-detail">${stepDetail(st)}</div>` : ''}</span></li>`;
    }).join('')}</ol>`;
    host.dataset.step = step;
    const item = host.querySelector('li.is-current');
    if (item) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const pasteBtn = document.getElementById('pasteForMe');
    if (pasteBtn) pasteBtn.addEventListener('click', pasteForMe);
    const result = document.getElementById('tourResult');
    if (result && !['results', 'recon', 'excel', 'save', 'saved'].includes(step)) { result.hidden = true; result.innerHTML = ''; delete result.dataset.report; }
  }

  // Fallback for visitors who cannot use the clipboard: delivers the same spreadsheet text through
  // a paste event, so ApplyFast's own paste conversion still runs.
  function pasteForMe() {
    const st = simState();
    if (!st) return;
    const area = st.d.getElementById('matchListArea');
    if (!area) return;
    copied = true;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    const dt = new st.w.DataTransfer();
    dt.setData('text/plain', sheet.dataText());
    area.dispatchEvent(new st.w.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    tick();
  }

  /* ---------- Results (from the page's actual Payment / Disc. Taken values) ---------- */

  function renderResult(st) {
    const host = document.getElementById('tourResult');
    if (!host) return;
    const pageLines = st.w.ApplyFastDemo.lines();
    const byRef = new Map(pageLines.map(l => [l.ref, l]));
    const num = s => Number(String(s || '0').replace(/,/g, '')) || 0;
    const applied = pageLines.filter(l => l.apply);
    const totalPaid = applied.reduce((sum, l) => sum + num(l.amount), 0);
    const totalDisc = applied.reduce((sum, l) => sum + num(l.disc), 0);
    const lines = scenario.lines;

    // Written means the payment row is ticked. The amount on the page can be less than the remittance asked for.
    let notApplied = 0;
    const rows = lines.map(l => {
      const page = byRef.get(l.invoice);
      const inv = invoice(l.invoice);
      const paid = SCENARIOS.amountOf(l);
      const onPage = !!(page && page.apply);
      let result;
      if (!onPage) {
        result = scenario.id === 'exceptions'
          ? '<span class="tour-warn">Not written</span><div class="tour-sub">Left for reconciliation</div>'
          : '<span class="tour-warn">&#9888; Not applied</span>';
        notApplied++;
      } else {
        const amt = num(page.amount);
        const disc = num(page.disc);
        if (disc > 0 && inv && cents(disc) > cents(inv.discAvail)) result = '<span class="tour-ok">&#10003; Applied</span><div class="tour-sub">Disc. Taken is above Disc. Avail.</div>';
        else if (disc > 0) result = '<span class="tour-ok">&#10003; Applied with discount</span>';
        else if (inv && cents(paid) > cents(inv.due) && cents(amt) === cents(inv.due)) result = '<span class="tour-ok">&#10003; Applied up to the open amount</span><div class="tour-sub">The rest of the remittance amount stays unapplied</div>';
        else if (cents(amt) < cents(paid)) result = `<span class="tour-ok">&#10003; Applied ${money(amt)}</span><div class="tour-sub">Payment Received did not cover the full remittance line</div>`;
        else if (inv && cents(amt + disc) < cents(inv.due)) result = `<span class="tour-ok">&#10003; Partial payment</span><div class="tour-sub">${money(inv.due - amt)} stays open</div>`;
        else result = '<span class="tour-ok">&#10003; Applied in full</span>';
      }
      const ref = l.ref === l.invoice || !inv ? esc(l.ref) : `${esc(l.ref)}<div class="tour-sub">Invoice ${esc(l.invoice)}</div>`;
      const shown = onPage ? num(page.amount) : l.paid;
      return `<tr><td>${ref}</td><td class="num">${money(l.discount)}</td><td class="num">${shown === null ? '&mdash;' : money(shown)}</td><td>${result}</td></tr>`;
    }).join('');

    let extra = '';
    if (scenario.similar) {
      const sib = byRef.get(scenario.similar.sibling);
      if (sib && !sib.apply) extra = `<p class="tour-ok-line">&#10003; ${esc(scenario.similar.sibling)} was left untouched (open balance ${money(invoice(scenario.similar.sibling).due)}).</p>`;
    }

    const summary = `<p class="tour-summary" id="tourSummary">&#10003; ${plural(applied.length, 'invoice', 'invoices')} applied &middot; ${money(totalPaid)} applied` +
      (totalDisc ? ` &middot; ${money(totalDisc)} discount taken` : '') + '</p>' +
      (notApplied ? `<p class="tour-warn-line">${plural(notApplied, 'remittance line was', 'remittance lines were')} not written. ${scenario.id === 'exceptions' ? 'Review &amp; Reconciliation classifies them. Nothing here is for you to correct.' : 'The ApplyFast results list the reason for each.'}</p>` : '');

    const refHead = scenario.columns[0].label;
    host.innerHTML = `
      <p class="tour-kicker">Result on the Customer Payment page</p>
      ${summary}
      <table class="tour-table"><thead><tr><th>${esc(refHead)}</th><th class="num">Discount</th><th class="num">Amount Paid</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>
      ${extra}
      <p class="tour-muted">The updated invoices are highlighted on the Customer Payment page.</p>
      <div id="tourNext"></div>`;
    host.hidden = false;
    renderReviewCall();
  }

  function renderReviewCall() {
    const next = document.getElementById('tourNext');
    if (!next) return;
    next.innerHTML = `
      <p class="tour-big" id="tourReviewCall">Application complete. Review the results before saving.</p>
      <p>Check the messages and applied amounts in the ApplyFast panel. When you’re satisfied, minimize ApplyFast and save the payment.</p>`;
  }

  function renderSaveCall() {
    const next = document.getElementById('tourNext');
    if (!next) return;
    next.innerHTML = `
      <p class="tour-big" id="tourSaveCall">One last step: Save the payment.</p>
      <p>ApplyFast matched, wrote and verified the invoices. Saving the payment is still your ERP’s job: click <b>Save</b> at the top of the page.</p>`;
    next.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  function renderSaved(st) {
    const host = document.getElementById('tourResult');
    if (!host) return;
    if (host.hidden) renderResult(st);
    const s = st.w.ApplyFastDemo.saved();
    // Saved while the panel was still open: tuck it away so the saved payment is in view.
    if (st.open) {
      const btn = st.d.getElementById('afMinimizeBtn');
      if (btn) btn.click();
    }
    const next = document.getElementById('tourNext');
    const card = `
      <div class="tour-saved" id="tourSaved">
        <p class="tour-saved-title">&#10003; Payment Saved</p>
        <dl>
          <dt>Customer Payment</dt><dd>${esc(s.customer)}</dd>
          <dt>Payment</dt><dd>${money(s.payment)}</dd>
          <dt>Applied</dt><dd>${plural(s.appliedCount, 'invoice', 'invoices')}</dd>
          <dt>Discount</dt><dd>${money(s.discount)}</dd>
          <dt>Status</dt><dd>${esc(s.status)}</dd>
          <dt>Transaction #</dt><dd>${esc(s.transaction)}</dd>
        </dl>
        <p class="tour-saved-note">Demo transaction &mdash; fictional environment</p>
      </div>`;
    const atScale = scenario.atScale
      ? `<div class="tour-scale-note" id="tourScaleNote">
          <p class="tour-scale-note-title">This is where automation becomes especially useful at scale.</p>
          <p>${esc(scenario.atScale)}</p>
        </div>`
      : '';
    const final = scenario.id === 'basic'
      ? `<div class="tour-final" id="tourFinal">
          <p class="tour-big">Cash application complete.</p>
          <p>Now let\u2019s try a larger multi-page payment.</p>
          <div class="tour-actions">
            <button type="button" class="tour-btn tour-primary" id="tryMultiPage">Try a larger multi-page payment</button>
          </div>
          <button type="button" class="tour-link" id="tourPayoffLink">See the time-savings story</button>
        </div>`
      : scenario.id === 'multipage'
      ? `<div class="tour-final" id="tourFinal">
          <p class="tour-big">Cash application is done.</p>
          <p>${esc(scenario.takeaway)} You do not correct anything.</p>
          ${atScale}
          <div class="tour-actions">
            <button type="button" class="tour-btn tour-primary" id="tryExceptions">See exceptions and reconciliation</button>
          </div>
        </div>`
      : `<div class="tour-final" id="tourFinal">
          <p>${esc(scenario.takeaway)}</p>
          <p class="tour-muted">The reconciliation report above is the handoff. Saving the payment is still optional, and cash application stayed free.</p>
          <div class="tour-actions">
            <button type="button" class="tour-btn" id="rerunScenario">Run it again</button>
          </div>
        </div>`;
    next.innerHTML = `
      <p class="tour-big" id="tourSavedNote">Saved. The payment now lists only the invoices ApplyFast applied.</p>
      <div id="tourSavedWrap" hidden>${card}${final}</div>`;

    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('tourPayoffLink', () => openPayoff(s.appliedCount));
    on('tryMultiPage', () => loadScenario('multipage'));
    on('tryExceptions', () => loadScenario('exceptions'));
    on('rerunScenario', () => loadScenario(scenario.id));
    next.scrollIntoView({ block: 'start', behavior: 'smooth' });

    // The saved page first, then the confirmation card, then (first remittance only) the payoff.
    const still = reducedMotion();
    clearSaved();
    savedPhase = 'page';
    const later = (ms, fn) => savedTimers.push(setTimeout(fn, still ? 0 : ms));
    later(SAVED_PAGE_MS, () => {
      savedPhase = 'card';
      const wrap = document.getElementById('tourSavedWrap');
      if (!wrap) return;
      wrap.hidden = false;
      wrap.classList.add('tour-saved-flash');
      wrap.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
    });
  }

  document.getElementById('tourReset').addEventListener('click', () => {
    firstLoad = false;
    loadScenario('basic');
  });
  document.getElementById('tourScenarios').addEventListener('click', showPicker);

  setInterval(tick, POLL_MS);
  // Links from the website may open a scenario directly (demo.html?scenario=multipage).
  const requested = new URLSearchParams(window.location.search).get('scenario');
  loadScenario(requested && SCENARIOS.byId(requested) ? requested : 'basic');

  // Read-only view for tests.
  window.ApplyFastDemoTour = {
    get step() { return step; },
    get view() { return view; },
    get scenario() { return scenario && scenario.id; },
    get copied() { return copied; },
    get savedPhase() { return savedPhase; },
    get payoffShown() { return payoffShown; },
    get filterPulses() { return filterPulses.slice(); }
  };
})();
