// ApplyFast Interactive Demo guide. Tells the story beside the simulated Customer Payment page,
// which runs the real ApplyFast panel in an iframe. The guide only observes that page (panel state,
// pasted text, page rows) and never drives ApplyFast's matching, edits, applies or saves; the visitor does.
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
  const STEPS_ISSUE = ['copy', 'open', 'paste', 'review', 'fix', 'apply', 'check', 'save'];
  const STEPS_MULTI = ['copy', 'open', 'mode', 'scan', 'paste', 'review', 'apply', 'check', 'save'];
  // The exception loop, as shown to the visitor.
  const LOOP = ['Review', 'Issue detected', 'Correct remittance', 'Copy corrected remittance', 'Paste into ApplyFast', 'Review again', 'Apply'];
  const LOOP_AT = { exception: 2, fixcopy: 3, fixpaste: 4, review: 5, apply: 6 };
  const FIX_STEPS = ['exception', 'fixcopy', 'fixpaste'];
  const STEP_LABELS = {
    copy: 'Copy the remittance from Excel',
    open: 'Open ApplyFast',
    mode: 'Choose All pages',
    scan: 'Scan all pages',
    paste: 'Paste it into ApplyFast',
    review: 'Click Review Cash Application',
    fix: 'Correct the remittance and review again',
    apply: 'Check the review, then Apply',
    check: 'Review the results, then minimize ApplyFast',
    save: 'Save the payment'
  };
  // Which live step belongs to which checklist item.
  const STEP_SLOT = { loading: 'copy', scanning: 'scan', singlemode: 'paste', exception: 'fix', fixcopy: 'fix', fixpaste: 'fix', applying: 'apply', results: 'check' };
  // Step name mirrored onto the simulated page (it highlights the written rows during 'save').
  const FOCUS = { open: 'open', paste: 'paste', review: 'review', apply: 'apply', exception: 'exception', fixcopy: 'exception', fixpaste: 'paste', mode: 'mode', scan: 'scan', singlemode: 'single', results: 'results', save: 'save', saved: 'saved' };
  // After Save: the saved page first, then the confirmation card, then (first remittance) the payoff.
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
  let lastReviewSkips = -1;
  let prevReviewSkips = -1;
  let lastSkipped = [];
  let wasPreviewed = false;
  // Per run: an exception scenario's review flagged lines, so the correction loop is under way.
  let hadException = false;
  // Per run: the spreadsheet version last copied, and whether it was copied since the last review.
  let copiedVersion = 0;
  let copiedSinceReview = false;
  // Per session: the time-savings payoff opens by itself only once.
  let payoffShown = false;

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
      const cells = tr.querySelectorAll('td');
      const reason = tr.querySelector('.af-sub-line');
      return { lineNo: cells[0] ? cells[0].textContent.trim() : '', raw: cells[1] ? cells[1].textContent.trim() : '', reason: reason ? reason.textContent.trim() : '' };
    });
  }

  function observe(st) {
    if (!st) return;
    const previewed = st.state.startsWith('previewed');
    if (st.state.startsWith('done')) appliedSeen = true;
    else if (appliedSeen && st.state === 'idle' && !st.text.trim() && !st.w.ApplyFastDemo.lines().some(l => l.apply)) {
      // ApplyFast's own Reset cleared the session and unticked its rows (its Close keeps both).
      appliedSeen = false;
    } else if (previewed) {
      if (!wasPreviewed) { prevReviewSkips = lastReviewSkips; copiedSinceReview = false; }
      appliedSeen = false;
      const skipped = skippedLines(st);
      lastReviewSkips = skipped.length;
      if (skipped.length) lastSkipped = skipped;
      if (scenario.issue && skipped.length) hadException = true;
    }
    wasPreviewed = previewed;
  }

  const loopActive = () => !!(scenario && scenario.issue && hadException);

  // Which of the scenario's spreadsheet corrections the visitor has made. Read from the sheet itself,
  // only to point at what still needs attention; ApplyFast's review decides whether the result is clean.
  function fixState() {
    if (!scenario.issue || !sheet) return [];
    const rows = sheet.dataRows();
    const isNumber = v => /^-?\d+(\.\d+)?$/.test(v);
    return scenario.issue.fixes.map(f => {
      if (f.remove) {
        const hits = rows.filter(x => x.values[0].trim().toUpperCase() === f.remove.toUpperCase());
        return { fix: f, done: hits.length === 1, row: hits.length > 1 ? hits[hits.length - 1].r : null };
      }
      const c = scenario.columns.findIndex(col => col.key === f.col);
      const money = scenario.columns[c].money;
      const same = v => (money ? isNumber(v) && Number(v) === Number(f.to) : v.trim().toUpperCase() === f.to.toUpperCase());
      const bad = rows.find(x => x.values[c] === f.from);
      return { fix: f, c, done: !bad && rows.some(x => same(x.values[c])), row: bad ? bad.r : null };
    });
  }
  const sheetDirty = () => !!sheet && sheet.version() !== copiedVersion;

  function fixStage() {
    if (copiedSinceReview && !sheetDirty()) return 'fixpaste';
    if (sheetDirty() && fixState().every(f => f.done)) return 'fixcopy';
    return 'exception';
  }

  function computeStep(st) {
    if (!st) return 'loading';
    if (st.saved) return 'saved';
    if (st.state.startsWith('applying')) return 'applying';
    if (appliedSeen) return st.open ? 'results' : 'save';
    if (st.state.startsWith('previewed')) return scenario.issue && lastReviewSkips > 0 ? fixStage() : 'apply';
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
    if (loopActive() && !pasted) return fixStage();
    return pasted ? 'review' : 'paste';
  }

  function tick() {
    if (view !== 'scenario' || !scenario) { if (spot.name) spot.hide(); return; }
    const st = simState();
    observe(st);
    const next = computeStep(st);
    if (next !== step) {
      const prev = step;
      step = next;
      renderStep(st);
      if (step === 'results' && st && prev !== 'save') renderResult(st);
      if (step === 'save' && st) {
        if (document.getElementById('tourResult').hidden) renderResult(st);
        renderSaveCall();
      }
      if (step === 'results' && prev === 'save') renderReviewCall();
      if (step === 'saved' && st) renderSaved(st);
      if (step === 'exception' && prev !== 'exception') {
        const sheetBlock = document.querySelector('.tour-sheet');
        if (sheetBlock) sheetBlock.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
    }
    renderFix(st);
    if (st) st.d.body.dataset.demoFocus = FOCUS[step] || '';
    if (st) renderProgress(st);
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
          { key: 'premium', resolve: inGuide('#tourPremium'), ring: 'none' }, currentItem];
      case 'singlemode':
        return [{ key: 'mode', resolve: modeLabel('single'), ring: 'pulse' }, currentItem];
      case 'scan':
        return [{ key: 'scanStart', resolve: inPanel('#afScanStart'), ring: 'pulse' }, currentItem];
      case 'scanning':
        return [{ key: 'scanProgress', resolve: inPanel('#afScan'), ring: 'static' }, currentItem];
      case 'paste':
        return [{ key: 'paste', resolve: inPanel('#matchListArea'), ring: 'pulse' }, currentItem];
      case 'review':
        return [{ key: 'review', resolve: inPanel('#matchBtn'), ring: 'pulse' }, currentItem,
          { key: 'fixNote', resolve: inGuide('#tourFix'), ring: 'none' }];
      case 'exception': {
        const rows = st && st.open ? Array.from(st.d.querySelectorAll('#afPreview tr.af-skip')) : [];
        const issues = rows.map((tr, i) => ({ key: `skip:${i}`, resolve: () => (tr.isConnected ? tr : null), ring: i ? 'warn-more' : 'warn' }));
        return issues.concat(fixTargets(), [{ key: 'fixNote', resolve: inGuide('#tourFix'), ring: 'none' }]);
      }
      case 'fixcopy':
        return [{ key: 'sheet', resolve: inGuide('.tour-sheet'), ring: 'static' },
          { key: 'copyButton', resolve: inGuide('#copyRemittance'), ring: 'pulse' },
          { key: 'fixNote', resolve: inGuide('#tourFix'), ring: 'none' }];
      case 'fixpaste':
        return [{ key: 'paste', resolve: inPanel('#matchListArea'), ring: 'pulse' },
          { key: 'fixNote', resolve: inGuide('#tourFix'), ring: 'none' }];
      case 'apply':
        return [{ key: 'preview', resolve: inPanel('#applyFastBox .af-right'), ring: 'static' },
          { key: 'apply', resolve: inPanel(scenario.multi ? '#afMultiApplyBtn' : '#afApplyBtn'), ring: 'pulse' }, currentItem,
          { key: 'fixNote', resolve: inGuide('#tourFix'), ring: 'none' }];
      case 'applying':
        return [{ key: 'panel', resolve: inPanel('#applyFastBox'), ring: 'static' }, currentItem];
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

  // The spreadsheet cells or rows still to correct (a selected duplicate row points at Delete row).
  function fixTargets() {
    const out = [];
    fixState().forEach((s, i) => {
      if (s.done || s.row === null) return;
      if (s.fix.remove) {
        const del = sheet.deleteButton();
        out.push(del.hidden ? { key: `fixRow:${s.row}`, resolve: () => sheet.rowHeadEl(s.row), ring: 'pulse' }
          : { key: `fixDelete:${i}`, resolve: () => (del.hidden ? null : del), ring: 'pulse' });
      } else {
        out.push({ key: `fixCell:${s.row}:${s.c}`, resolve: () => sheet.cellEl(s.row, s.c), ring: 'pulse' });
      }
    });
    return out;
  }

  /* ---------- Exception loop: what ApplyFast detected, and what the visitor does about it ---------- */

  const shownAmount = v => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function fixText(s) {
    const f = s.fix;
    if (f.remove) {
      return s.done ? `Duplicate ${f.remove} removed.`
        : `Row ${s.row + 1}: delete the second ${f.remove}. Click row number ${s.row + 1}, then click Delete row.`;
    }
    const to = scenario.columns[s.c].money ? shownAmount(f.to) : f.to;
    return s.done ? `${f.from} corrected to ${to}.`
      : `Cell ${sheet.addr(s.row, s.c)}: change ${f.from} to ${to}. Double-click the cell, type ${to} and press Enter.`;
  }

  function fixNext(st) {
    const partial = lastReviewSkips > 0 && prevReviewSkips > lastReviewSkips;
    switch (step) {
      case 'exception':
        return (partial ? '<b>Correct the remaining item and review again.</b> ' : '') +
          'When the remittance is corrected, copy it with <b>Copy Corrected Remittance</b>.';
      case 'fixcopy':
        return `&#10003; Remittance corrected. Now copy it: click <b>Copy Corrected Remittance</b>, or select the cells and press ${copyKeys}.`;
      case 'fixpaste': {
        const open = st && st.open ? '' : 'open ApplyFast, then ';
        return `Corrected remittance copied. <b>Paste the corrected remittance into ApplyFast</b>: ${open}click the <b>Payment References</b> box and press ${pasteKeys}.` +
          (st && st.text.trim() ? ' It replaces the old remittance.' : '');
      }
      case 'review':
        return 'Click <b>Review Cash Application</b> again so ApplyFast checks the corrected remittance.';
      default:
        return '';
    }
  }

  function renderFix(st) {
    const host = document.getElementById('tourFix');
    if (!host) return;
    const at = loopActive() ? LOOP_AT[step] : undefined;
    if (at === undefined) {
      if (!host.hidden) { host.hidden = true; host.innerHTML = ''; host.dataset.html = ''; }
      return;
    }
    const issue = scenario.issue;
    const resolved = step === 'apply';
    const partial = !resolved && lastReviewSkips > 0 && prevReviewSkips > lastReviewSkips;
    const loop = `<ol class="tour-loop" id="tourLoop" aria-label="Correction loop">${LOOP.map((label, i) =>
      `<li class="${i < at ? 'is-done' : i === at ? 'is-current' : ''}">${esc(label)}</li>`).join('')}</ol>`;
    const detected = resolved
      ? `<div class="tour-resolved" id="tourResolved"><p class="tour-resolved-flag">&#10003; Issue resolved</p>
          <p>ApplyFast’s review of the corrected remittance is clean. Check it, then click <b>Apply</b>.</p></div>`
      : `<div class="tour-exception" id="tourException">
          <p class="tour-exception-flag">&#9888; Issue detected</p>
          ${partial ? '<p class="tour-exception-partial" id="tourPartial">&#10003; One issue is fixed, but another still needs attention.</p>' : ''}
          <p class="tour-exception-head">${esc(issue.headline)}</p>
          <p class="tour-exception-label">ApplyFast’s review skipped ${plural(lastSkipped.length, 'line', 'lines')}:</p>
          <ul class="tour-exception-list">${lastSkipped.map(s => `<li><span class="tour-exc-raw">Line ${esc(s.lineNo)}: ${esc(s.raw)}</span><span class="tour-exc-reason">${esc(s.reason)}</span></li>`).join('')}</ul>
          <p>${esc(issue.explain)}</p>
        </div>`;
    const todo = resolved ? '' : `
        <div class="tour-todo" id="tourTodo">
          <p class="tour-todo-flag">What to do</p>
          <p class="tour-todo-head">${esc(issue.action)}</p>
          <p class="tour-muted">${esc(issue.why)}</p>
          <ol class="tour-fixlist">${fixState().map(s => `<li class="${s.done ? 'is-done' : ''}">${s.done ? '&#10003; ' : ''}${esc(fixText(s))}</li>`).join('')}</ol>
          <p class="tour-todo-next" id="tourFixNext">${fixNext(st)}</p>
        </div>
        <p class="tour-fix-rule">Review this exception before applying. Resolve the issue first. Apply only when the remittance is correct.</p>`;
    const html = `<p class="tour-kicker">Correct the remittance</p>${loop}${detected}${todo}`;
    if (host.dataset.html === html) return;
    host.dataset.html = html;
    host.innerHTML = html;
    host.hidden = false;
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
    lastReviewSkips = -1;
    prevReviewSkips = -1;
    lastSkipped = [];
    wasPreviewed = false;
    hadException = false;
    copiedSinceReview = false;
  }

  function resetRun() {
    step = '';
    resetLoop();
    copiedVersion = 0;
    clearSaved();
    closePayoff(true);
    spot.hide();
  }

  function reloadSim() {
    try { frame.contentWindow.location.reload(); } catch (e) { frame.src = SIM_URL; }
  }

  frame.addEventListener('load', () => {
    step = '';
    resetLoop();
    tick();
  });

  /* ---------- Time-savings payoff (full-screen, below the header) ---------- */

  const payoffOpen = () => !!document.getElementById('tourPayoff');

  function openPayoff(count) {
    if (payoffOpen()) return;
    payoffShown = true;
    const still = reducedMotion();
    const layer = document.createElement('div');
    layer.className = `tour-payoff${still ? ' is-still' : ''}`;
    layer.id = 'tourPayoff';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'tourScaleTitle');
    layer.style.top = `${Math.round(banner.getBoundingClientRect().bottom)}px`;
    layer.innerHTML = `
      <div class="tour-payoff-card" tabindex="-1">
        <button type="button" class="tour-payoff-close" id="payoffClose" aria-label="Close the time-savings story">&times;</button>
        <p class="tour-payoff-done">&#10003; Payment saved. You just applied ${plural(count, 'invoice', 'invoices')}.</p>
        <section class="tour-scale" id="tourScale" aria-label="What this means at scale"><div id="tourScaleBody"></div></section>
        <div class="tour-cta" id="tourCta">
          <p class="tour-cta-title">Ready to see what ApplyFast can do for your workflow?</p>
          <div class="tour-actions">
            <button type="button" class="tour-btn tour-primary" id="payoffExplore">Explore Real-World Scenarios</button>
            <button type="button" class="tour-btn" id="payoffTryAnother">Try Another Payment</button>
            <a class="tour-btn" id="payoffGet" href="${GET_APPLYFAST_URL}" target="_blank" rel="noopener">Get ApplyFast</a>
            <button type="button" class="tour-link" id="payoffContinue">Continue exploring this page</button>
          </div>
          <div class="tour-next-feature" id="payoffNextFeature">
            <p>Want to see the feature built for larger workloads?</p>
            <button type="button" class="tour-btn tour-feature-btn" id="payoffMultiPage">Try Multiple Pages <span aria-hidden="true">&rarr;</span></button>
          </div>
        </div>
      </div>`;
    layer.addEventListener('click', e => { if (e.target === layer) closePayoff(); });
    document.body.appendChild(layer);
    Scale.render(document.getElementById('tourScaleBody'), { count, reducedMotion: still });
    const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
    on('payoffClose', () => closePayoff());
    on('payoffContinue', () => closePayoff());
    on('payoffExplore', () => { closePayoff(true); showPicker(); });
    on('payoffTryAnother', () => { closePayoff(true); loadScenario('full'); });
    on('payoffMultiPage', () => { closePayoff(true); loadScenario('multipage'); });
    on('payoffGet', () => closePayoff());
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
    if (firstLoad) firstLoad = false;
    else reloadSim();
    tick();
  }

  function showPicker() {
    view = 'picker';
    resetRun();
    let num = 0;
    // Featured scenarios sit above the numbered learning sequence (shown once, not duplicated).
    const featured = SCENARIOS.scenarios.filter(s => s.featured).map(s => `
      <section class="tour-featured" aria-label="Featured scenario">
        <p class="tour-featured-label"><span aria-hidden="true">&#9733;</span> Featured</p>
        <button type="button" class="tour-card tour-card-featured is-premium" data-scenario="${s.id}">
          <span class="tour-card-body">
            <em class="tour-premium-badge"><span aria-hidden="true">&#10022;</span> ApplyFast Premium</em>
            <b>${esc(s.title)}</b>
            <span class="tour-featured-summary">${esc(s.featured.summary)}</span>
            <span class="tour-featured-why"><strong>${esc(s.featured.question)}</strong> ${esc(s.featured.benefit)}</span>
            <span class="tour-featured-scale">${esc(s.featured.scale)}</span>
            <span class="tour-featured-foot"><span class="tour-licensed">Licensed feature in the real extension</span>
              <span class="tour-featured-try">Try Multi-Page <span aria-hidden="true">&rarr;</span></span></span>
          </span>
        </button>
      </section>`).join('');
    const cards = SCENARIOS.groups.map(g => {
      const items = SCENARIOS.scenarios.filter(s => s.group === g.id && !s.featured);
      if (!items.length) return '';
      return `<h3 class="tour-group" data-group="${g.id}">${esc(g.title)}</h3>` + items.map(s => `
      <button type="button" class="tour-card" data-scenario="${s.id}">
        <span class="tour-card-num">${++num}</span>
        <span class="tour-card-body"><b>${esc(s.title)}</b><span>${esc(s.card)}</span></span>
      </button>`).join('');
    }).join('');
    guide.innerHTML = `
      <section class="tour-block">
        <p class="tour-kicker">Real-world scenarios</p>
        <h2>What happens when the remittance isn’t perfect?</h2>
        <p>Pick any scenario. Each one starts on a fresh Customer Payment page with its own remittance.</p>
      </section>
      ${featured}
      <div class="tour-cards" id="scenarioList">${cards}</div>
      <button type="button" class="tour-link" id="replayBasic">&#8634; Replay your first remittance</button>`;
    guide.querySelectorAll('[data-scenario]').forEach(b => b.addEventListener('click', () => loadScenario(b.dataset.scenario)));    document.getElementById('replayBasic').addEventListener('click', () => loadScenario('basic'));
    guide.scrollTop = 0;
  }

  function premiumHtml() {
    return `
      <div class="tour-premium" id="tourPremium">
        <p class="tour-premium-title"><span aria-hidden="true">&#9733;</span> ApplyFast Premium</p>
        <p class="tour-premium-lead">Scan and apply across multiple invoice pages automatically.</p>
        <p class="tour-premium-note">Licensed feature in the real extension</p>
        <ul class="tour-premium-modes">
          <li><b>This page only</b><span>Free</span></li>
          <li><b>All pages</b><span>Licensed &middot; unlocked for this demo</span></li>
        </ul>
      </div>`;
  }

  function introHtml() {
    if (scenario.id === 'basic') {
      return `
        <section class="tour-block" id="tourStory">
          <p class="tour-kicker">The situation</p>
          <h2>You’re an AR specialist.</h2>
          <p>${esc(DATA.customer.name)} just sent a payment of <b>${money(scenario.totalPaid)}</b>. Their remittance advice, the list of invoices the payment covers, is sitting in Excel.</p>
          <p>You need to apply the payment against the customer’s open invoices.</p>
          <p class="tour-muted">Normally, you would search for each invoice on the Customer Payment page, tick it and type the amount, one line at a time.</p>
          <h3 class="tour-try">Try ApplyFast.</h3>
        </section>`;
    }
    const pageList = Array.from(new Set(scenario.lines.map(l => SCENARIOS.pageOf(l.invoice)))).sort((a, b) => a - b);
    const pages = scenario.multi
      ? `<p class="tour-muted">These invoices are on pages ${pageList.slice(0, -1).join(', ')} and ${pageList[pageList.length - 1]} of the Invoices list.</p>`
      : '';
    return `
      <section class="tour-block" id="tourStory">
        <button type="button" class="tour-link" id="backToPicker">&larr; All scenarios</button>
        <p class="tour-kicker">Real-world scenario</p>
        <h2>${esc(scenario.title)}</h2>
        ${scenario.premium ? premiumHtml() : ''}
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
      <section class="tour-block tour-fix" id="tourFix" hidden aria-live="polite"></section>
      <section class="tour-block tour-steps" id="tourStep" aria-live="polite"></section>
      <section class="tour-block tour-result" id="tourResult" hidden></section>`;

    const fileName = `Remittance_Harborview_2026-09-28${scenario.id === 'basic' ? '' : '_' + scenario.id}.xlsx`;
    sheet = Sheet.render(document.getElementById('sheetHost'), Sheet.remittanceSheet(scenario, DATA.customer, PAYMENT_DATE), {
      fileName,
      // Exception remittances can be corrected in the spreadsheet, then copied and pasted again.
      editable: !!scenario.issue,
      onCopy: text => {
        copied = true;
        copiedVersion = sheet.version();
        if (loopActive()) copiedSinceReview = true;
        const lines = text.split('\n').filter(l => l.trim()).length;
        document.getElementById('copyNote').textContent = loopActive()
          ? `Copied ${plural(lines, 'row', 'rows')}. Now paste them into ApplyFast.`
          : `Copied ${plural(lines, 'row', 'rows')}. Now open ApplyFast.`;
        tick();
      },
      onChange: () => {
        document.getElementById('copyRemittance').textContent = 'Copy Corrected Remittance';
        tick();
      }
    });
    document.getElementById('copyRemittance').addEventListener('click', () => sheet.copyData());
    const back = document.getElementById('backToPicker');
    if (back) back.addEventListener('click', showPicker);
    guide.scrollTop = 0;
  }

  function reviewHint() {
    const s = scenario;
    const first = s.lines[0];
    if (s.resolved && lastReviewSkips === 0) return 'The corrected remittance is clean: every line is Ready.';
    switch (s.id) {
      case 'full':
        return 'No amounts were pasted, so each line uses the invoice’s remaining Amt. Due as its Payment.';
      case 'other':
        return `Each PO number found its invoice through the PO/Check Number column, for example ${first.ref} is ${first.invoice}.`;
      case 'discount':
        return `New Pay/Disc shows the Payment and the discount together, for example ${fmt(first.paid)} / ${fmt(first.discount)} for ${first.ref}.`;
      case 'partial':
        return `${first.ref} has an Amt. Due of ${fmt(invoice(first.ref).due)}; ApplyFast plans a Payment of ${fmt(first.paid)} only.`;
      case 'multipage':
        return 'The review covers every page. Apply writes each invoice on its own page.';
      default:
        return 'Each remittance line matched exactly one open invoice and is marked Ready.';
    }
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
        return '<p>What if the invoices aren’t all on the current page? In the ApplyFast panel, choose <b>All pages</b>.</p>' +
          `<div class="tour-premium tour-premium-inline" id="tourPremiumStep">
            <p class="tour-premium-title"><span aria-hidden="true">&#9733;</span> ApplyFast Premium</p>
            <p class="tour-premium-lead">Scan and apply across multiple invoice pages automatically.</p>
            <p class="tour-premium-note">Licensed feature in the real extension &middot; <b>This page only</b> stays free</p>
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
        if (loopActive()) {
          return '<p><b>The remittance changed.</b></p><p>Click <b>Review Cash Application</b> again so ApplyFast checks the corrected lines. Nothing is written yet.</p>';
        }
        return '<p>ApplyFast already turned your Excel rows into lines it understands. Click <b>Review Cash Application</b>. Nothing is written yet.</p>';
      case 'exception':
        return '<p><b>Issue detected.</b> Correct the remittance in the spreadsheet, as shown under it.</p>';
      case 'fixcopy':
        return '<p>Copy the corrected remittance from the spreadsheet.</p>';
      case 'fixpaste':
        return '<p>Paste the corrected remittance into ApplyFast.</p>';
      case 'apply':
        return `<p>This is the review. ${esc(reviewHint())}</p>
          <p class="tour-muted">${scenario.columns.some(c => c.money)
            ? 'New Pay/Disc is the Amount Paid / Discount from the remittance.'
            : 'New Pay/Disc is each invoice’s remaining Amt. Due.'}</p>
          <p>When it looks right, click <b>Apply</b>.</p>`;
      case 'applying':
        return scenario.multi ? '<div id="tourProgress" class="tour-progress"></div>' : '<p>Applying&hellip;</p>';
      case 'results':
        return `<p><b>Application complete. Review the results before saving.</b></p>
          <p>Check the messages and applied amounts. When you’re satisfied, close or minimize ApplyFast and save the payment.</p>
          <p class="tour-muted">Use the <b>&ndash;</b> button at the top right of the ApplyFast panel.</p>`;
      case 'save':
        return '<p>Click <b>Save</b> at the top of the Customer Payment page.</p>';
      default:
        return '';
    }
  }

  function renderStep(st) {
    const host = document.getElementById('tourStep');
    if (!host) return;
    const steps = scenario.multi ? STEPS_MULTI : scenario.issue ? STEPS_ISSUE : STEPS_SINGLE;
    const slot = step === 'review' && loopActive() ? 'fix' : STEP_SLOT[step] || step;
    const current = step === 'saved' ? steps.length : steps.indexOf(slot);
    host.innerHTML = `<ol class="tour-checklist">${steps.map((s, i) => {
      const cls = i < current ? 'is-done' : i === current ? 'is-current' : '';
      return `<li class="${cls}" data-step="${s}"><span class="tour-check">${i < current ? '&#10003;' : i + 1}</span><span>${STEP_LABELS[s]}${i === current ? `<div class="tour-detail">${stepDetail(st)}</div>` : ''}</span></li>`;
    }).join('')}</ol>`;
    host.dataset.step = step;
    const item = host.querySelector('li.is-current');
    // During the correction loop the spreadsheet and its correction notes stay in view instead.
    if (item && slot !== 'fix') item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const pasteBtn = document.getElementById('pasteForMe');
    if (pasteBtn) pasteBtn.addEventListener('click', pasteForMe);
    const result = document.getElementById('tourResult');
    if (result && !['results', 'save', 'saved'].includes(step)) { result.hidden = true; result.innerHTML = ''; }
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
    // After the visitor fixed the exceptions, the result is compared with the corrected remittance.
    const lines = scenario.resolved && lastReviewSkips === 0 ? scenario.resolved : scenario.lines;

    // A line counts as applied only when the page holds exactly the amounts it asked for.
    let notApplied = 0;
    const rows = lines.map(l => {
      const page = byRef.get(l.invoice);
      const inv = invoice(l.invoice);
      const paid = SCENARIOS.amountOf(l);
      const written = page && page.apply && cents(num(page.amount)) === cents(paid) && cents(num(page.disc)) === cents(l.discount);
      let result;
      if (!written) { result = '<span class="tour-warn">&#9888; Not applied</span>'; notApplied++; }
      else if (l.discount > 0) result = '<span class="tour-ok">&#10003; Applied with discount</span>';
      else if (l.paid === null) result = '<span class="tour-ok">&#10003; Amount Due applied</span>';
      else if (cents(paid + l.discount) < cents(inv.due)) result = `<span class="tour-ok">&#10003; Partial payment</span><div class="tour-sub">${money(inv.due - paid)} stays open</div>`;
      else result = '<span class="tour-ok">&#10003; Applied in full</span>';
      const ref = l.ref === l.invoice || !inv ? esc(l.ref) : `${esc(l.ref)}<div class="tour-sub">Invoice ${esc(l.invoice)}</div>`;
      const shown = written ? num(page.amount) : l.paid;
      return `<tr><td>${ref}</td><td class="num">${money(l.discount)}</td><td class="num">${shown === null ? '&mdash;' : money(shown)}</td><td>${result}</td></tr>`;
    }).join('');

    let extra = '';
    if (scenario.similar) {
      const sib = byRef.get(scenario.similar.sibling);
      if (sib && !sib.apply) extra = `<p class="tour-ok-line">&#10003; ${esc(scenario.similar.sibling)} was left untouched (open balance ${money(invoice(scenario.similar.sibling).due)}).</p>`;
    }

    const summary = `<p class="tour-summary" id="tourSummary">&#10003; ${plural(applied.length, 'invoice', 'invoices')} applied &middot; ${money(totalPaid)} applied` +
      (totalDisc ? ` &middot; ${money(totalDisc)} discount taken` : '') + '</p>' +
      (notApplied ? `<p class="tour-warn-line">&#9888; ${plural(notApplied, 'remittance line was', 'remittance lines were')} not applied. The ApplyFast results list the reason for each.</p>` : '');

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
    const isBasic = scenario.id === 'basic';
    const atScale = scenario.atScale
      ? `<div class="tour-scale-note" id="tourScaleNote">
          <p class="tour-scale-note-title">This is where automation becomes especially useful at scale.</p>
          <p>${esc(scenario.atScale)}</p>
        </div>`
      : '';
    const final = isBasic
      ? `<div class="tour-final" id="tourFinal">
          <p class="tour-big">You’re done.</p>
          <p>You just applied the customer payment and completed the transaction.</p>
          <div class="tour-actions">
            <button type="button" class="tour-btn tour-primary" id="exploreScenarios">Explore Real-World Scenarios</button>
            <button type="button" class="tour-btn" id="tryAnother">Try Another Payment</button>
            <a class="tour-btn" id="getApplyFast" href="${GET_APPLYFAST_URL}" target="_blank" rel="noopener">Get ApplyFast</a>
          </div>
          <div class="tour-next-feature" id="tourNextFeature">
            <p>Want to see the feature built for larger workloads?</p>
            <button type="button" class="tour-btn tour-feature-btn" id="tryMultiPage">Try Multiple Pages <span aria-hidden="true">&rarr;</span></button>
          </div>
          <button type="button" class="tour-link" id="tourPayoffLink">See the time-savings story</button>
        </div>`
      : `<div class="tour-final" id="tourFinal">
          <p>${esc(scenario.takeaway)}</p>
          ${atScale}
          <div class="tour-actions"><button type="button" class="tour-btn tour-primary" id="anotherScenario">Try another scenario</button>
          <button type="button" class="tour-btn" id="rerunScenario">Run it again</button></div>
        </div>`;
    next.innerHTML = `
      <p class="tour-big" id="tourSavedNote">Saved. The payment now lists only the invoices ApplyFast applied.</p>
      <div id="tourSavedWrap" hidden>${card}${final}</div>`;

    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('exploreScenarios', showPicker);
    on('tryAnother', () => loadScenario('full'));
    on('tourPayoffLink', () => openPayoff(s.appliedCount));
    on('tryMultiPage', () => loadScenario('multipage'));
    on('anotherScenario', showPicker);
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
      if (!isBasic || payoffShown) return;
      later(SAVED_CARD_MS, () => {
        if (step !== 'saved' || view !== 'scenario') return;
        savedPhase = 'payoff';
        openPayoff(s.appliedCount);
      });
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
    get payoffShown() { return payoffShown; }
  };
})();
