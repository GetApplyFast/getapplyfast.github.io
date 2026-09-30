// ApplyFast core - pure parsing and matching logic.
// Must never touch the DOM or NetSuite; content.js owns all reads and writes.
(function (root) {
  'use strict';

  const US_AMOUNT = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;
  const HAS_DECIMALS = /\.\d{1,2}$/;
  const MIN_PARTIAL_LENGTH = 4;

  /**
   * Strict US amount parser for user input.
   * Accepts 1000, 1000.5, 1000.00, 1,000, 1,000.00 and an optional leading "$".
   * Rejects negatives, 3+ decimals, misplaced commas, EU formats and trailing text.
   */
  function parseAmountStrict(input) {
    const s = String(input == null ? '' : input).trim().replace(/^\$\s*/, '');
    if (!s) return { ok: false, reason: 'Missing amount' };
    const m = US_AMOUNT.exec(s);
    if (!m) return { ok: false, reason: `"${String(input).trim()}" is not a valid amount (use 1000, 1000.00, 1,000 or 1,000.00)` };
    const whole = Number(m[1].replace(/,/g, ''));
    const cents = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
    return { ok: true, value: Math.round(whole * 100 + cents) / 100 };
  }

  // Excel's Accounting format shows zero as a lone dash ("-", "$ -"). Only a lone dash counts;
  // "-100.00" is still rejected as a negative amount.
  const ACCOUNTING_ZERO = /^\$?\s*[-\u2013\u2014]$/;

  function isAccountingZero(input) {
    return ACCOUNTING_ZERO.test(String(input == null ? '' : input).trim());
  }

  function normalizeRef(value) {
    return String(value == null ? '' : value).replace(/\s+/g, '').replace(/^#+/, '').toLowerCase();
  }

  function validateRef(ref) {
    if (!ref) return 'Missing reference';
    if (/[=|]/.test(ref)) return 'Reference contains "=" or "|"';
    if (!/\d/.test(ref)) return `"${ref}" has no digits (looks like a header or label)`;
    return '';
  }

  /**
   * Parses one input line. Supported formats:
   *   REF                  apply remaining balance
   *   REF=payment          partial / specific payment
   *   REF|discount|payment discount plus payment (blank, 0 or accounting "-" discount = no discount)
   */
  function parseLine(raw, lineNo) {
    const text = String(raw == null ? '' : raw).trim();
    const entry = { lineNo, raw: text, ref: '', key: '', payment: null, discount: null, format: 'ref', status: 'OK', reason: '' };
    const fail = (reason) => { entry.status = 'INVALID_INPUT'; entry.reason = reason; return entry; };
    const setRef = (ref) => { entry.ref = ref.trim(); entry.key = normalizeRef(entry.ref); return validateRef(entry.ref); };

    if (text.includes('|')) {
      const parts = text.split('|').map(p => p.trim());
      const refError = setRef(parts[0]);
      if (parts.length === 2) return fail('Use REF=amount for a payment, or REF|discount|payment for a discount');
      if (parts.length > 3) return fail('Too many "|" separators; expected REF|discount|payment');
      if (refError) return fail(refError);
      if (!parts[2]) return fail('Payment amount is required when a discount is given');
      const payment = parseAmountStrict(parts[2]);
      if (!payment.ok) return fail(`Payment: ${payment.reason}`);
      if (payment.value <= 0) return fail('Payment must be greater than zero');
      entry.payment = payment.value;
      entry.format = 'payment';
      if (parts[1] && !isAccountingZero(parts[1])) {
        const discount = parseAmountStrict(parts[1]);
        if (!discount.ok) return fail(`Discount: ${discount.reason}`);
        if (discount.value > 0) {
          entry.discount = discount.value;
          entry.format = 'discount';
        }
      }
      return entry;
    }

    if (text.includes('=')) {
      const idx = text.indexOf('=');
      const refError = setRef(text.slice(0, idx));
      if (refError) return fail(refError);
      const payment = parseAmountStrict(text.slice(idx + 1));
      if (!payment.ok) return fail(payment.reason);
      if (payment.value <= 0) return fail('Payment must be greater than zero');
      entry.payment = payment.value;
      entry.format = 'payment';
      return entry;
    }

    const refError = setRef(text);
    if (refError) return fail(refError);
    return entry;
  }

  /**
   * Parses the whole textarea. Empty lines are ignored. A reference that appears
   * on more than one line is flagged DUPLICATE_INPUT on every line (never last-wins).
   */
  function parseInput(text) {
    const entries = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach((line, i) => {
      if (line.trim()) entries.push(parseLine(line, i + 1));
    });

    const byKey = new Map();
    entries.forEach(e => {
      if (e.status !== 'OK') return;
      if (!byKey.has(e.key)) byKey.set(e.key, []);
      byKey.get(e.key).push(e);
    });
    byKey.forEach(list => {
      if (list.length < 2) return;
      const lines = list.map(e => e.lineNo).join(', ');
      list.forEach(e => {
        e.status = 'DUPLICATE_INPUT';
        e.reason = `Reference appears on lines ${lines}`;
      });
    });

    return { entries, valid: entries.filter(e => e.status === 'OK') };
  }

  function fromColumns(cells) {
    const ref = cells[0];
    if (cells.length === 2) return cells[1] ? `${ref}=${cells[1]}` : ref;
    const discount = cells[1] || '';
    const payment = cells[2] || '';
    if (!discount && !payment) return ref;
    if (!discount) return `${ref}=${payment}`;
    return `${ref}|${discount}|${payment}`;
  }

  /**
   * Rewrites pasted spreadsheet rows into ApplyFast syntax.
   *   2 columns: REF, payment            -> REF=payment (blank payment -> REF)
   *   3 columns: REF, discount, payment  -> REF|discount|payment
   * Empty tab cells keep their position, so a blank payment is never read as the discount.
   * Single-space rows are split only when every amount token has explicit decimals.
   */
  function transformPaste(text) {
    const lines = [];
    let transformed = false;

    String(text == null ? '' : text).split(/\r?\n/).forEach(line => {
      if (!line.trim()) return;

      if (line.includes('\t')) {
        const cells = line.split('\t').map(c => c.trim());
        if (cells.length >= 2) {
          lines.push(fromColumns(cells));
          transformed = true;
          return;
        }
      }

      const trimmed = line.trim();
      const spaced = trimmed.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
      if (spaced.length >= 2) {
        lines.push(fromColumns(spaced));
        transformed = true;
        return;
      }

      const tokens = trimmed.split(/\s+/);
      if (tokens.length === 2 || tokens.length === 3) {
        const amounts = tokens.slice(1);
        const isAmount = (t, k) => (HAS_DECIMALS.test(t) && parseAmountStrict(t).ok) ||
          (tokens.length === 3 && k === 0 && isAccountingZero(t));
        if (amounts.every(isAmount)) {
          lines.push(fromColumns(tokens));
          transformed = true;
          return;
        }
      }

      lines.push(trimmed);
    });

    return { lines, transformed };
  }

  /**
   * Decides what a paste into the Payment References box does. Returns
   * { start, end, text, cursor, mode }: replace value[start, end) with text, then put the cursor at cursor.
   *   A remittance (two or more lines, spreadsheet cells, or one copied row ending in a line break)
   *   replaces the whole box (mode 'replace'), unless only part of the text is selected;
   *   then just the selection is replaced.
   *   Anything else (one reference or a fragment) replaces the selection or goes in at the cursor.
   * Spreadsheet rows are converted with transformPaste either way.
   */
  function pasteEdit(value, selStart, selEnd, pasted) {
    const current = String(value == null ? '' : value);
    const raw = String(pasted == null ? '' : pasted);
    const clamp = n => Math.max(0, Math.min(Number.isFinite(n) ? n : current.length, current.length));
    const start = Math.min(clamp(selStart), clamp(selEnd));
    const end = Math.max(clamp(selStart), clamp(selEnd));
    const converted = transformPaste(raw);
    const joined = converted.transformed && converted.lines.length ? converted.lines.join('\n') : null;
    const lineCount = raw.split(/\r?\n/).filter(l => l.trim()).length;
    const remittance = lineCount >= 2 || (lineCount === 1 && (raw.includes('\t') || /\n\s*$/.test(raw)));
    const partial = end > start && !(start === 0 && end === current.length);

    if (remittance && !partial) {
      const text = (joined !== null ? joined : raw.replace(/\r\n?/g, '\n')).replace(/\s+$/, '');
      return { start: 0, end: current.length, text, cursor: text.length, mode: current.trim() ? 'replace' : 'insert' };
    }
    const mode = end > start ? 'selection' : 'insert';
    if (joined !== null) {
      const text = joined + (current.slice(end) ? '\n' : '');
      return { start, end, text, cursor: start + joined.length, mode };
    }
    return { start, end, text: raw, cursor: start + raw.length, mode };
  }

  // A known row type other than Invoice (e.g. Journal). Unknown or blank types are not trusted.
  function isNonInvoiceType(type) {
    const t = String(type == null ? '' : type).trim().toLowerCase();
    return t !== '' && t !== 'invoice';
  }

  function addToIndex(map, key, rowIndex) {
    if (!key) return;
    const list = map.get(key);
    if (!list) map.set(key, [rowIndex]);
    else if (!list.includes(rowIndex)) list.push(rowIndex);
  }

  /**
   * Classifies parsed entries against an in-memory row snapshot.
   * rows: [{ ref, po, type?, otherCells?: string[] }]
   * Priority: exact Ref No. > exact PO > exact whole token in other cells > partial.
   * Partial matches need MIN_PARTIAL_LENGTH characters and are flagged, never auto-selected.
   * Multiple rows are only allowed for a full-balance line (no amount) whose exact match
   * hits rows that are all a known non-Invoice type; each row then uses its own Amt. Due.
   * Lines with an explicit payment or discount always need a unique row.
   * Returns one result per entry: { entry, status, matchType, candidates, multiRow, reason }.
   */
  function matchEntries(entries, rows) {
    const refIndex = new Map();
    const poIndex = new Map();
    const tokenIndex = new Map();
    const normRefs = rows.map(r => normalizeRef(r.ref));
    const normPos = rows.map(r => normalizeRef(r.po));

    rows.forEach((row, i) => {
      addToIndex(refIndex, normRefs[i], i);
      addToIndex(poIndex, normPos[i], i);
      (row.otherCells || []).forEach(cell => {
        const text = String(cell == null ? '' : cell);
        addToIndex(tokenIndex, normalizeRef(text), i);
        text.split(/\s+/).forEach(tok => addToIndex(tokenIndex, normalizeRef(tok), i));
      });
    });

    const results = entries.map(entry => {
      if (entry.status !== 'OK') {
        return { entry, status: entry.status, matchType: null, candidates: [], multiRow: false, reason: entry.reason };
      }
      const key = entry.key;
      let matchType = null;
      let candidates = [];
      if (refIndex.has(key)) { matchType = 'ref'; candidates = refIndex.get(key).slice(); }
      else if (poIndex.has(key)) { matchType = 'po'; candidates = poIndex.get(key).slice(); }
      else if (tokenIndex.has(key)) { matchType = 'token'; candidates = tokenIndex.get(key).slice(); }
      else if (key.length >= MIN_PARTIAL_LENGTH) {
        matchType = 'partial';
        for (let i = 0; i < rows.length; i++) {
          if ((normRefs[i] && normRefs[i].includes(key)) || (normPos[i] && normPos[i].includes(key))) candidates.push(i);
        }
      }

      if (candidates.length === 0) return { entry, status: 'NOT_FOUND', matchType: null, candidates, multiRow: false, reason: 'Not found in the loaded rows' };
      if (candidates.length > 1) {
        const fullBalance = entry.format === 'ref';
        if (fullBalance && matchType !== 'partial' && candidates.every(i => isNonInvoiceType(rows[i].type))) {
          return { entry, status: 'MATCHED', matchType, candidates, multiRow: true, reason: `Applies to ${candidates.length} non-Invoice rows, each at its own Amt. Due` };
        }
        let reason = `Matches ${candidates.length} rows`;
        if (!fullBalance) reason += '; a line with an amount must match exactly one row';
        else if (matchType === 'partial') reason += '; use the exact reference';
        else reason += '; Invoice rows need a unique reference';
        return { entry, status: 'MULTIPLE_MATCH', matchType, candidates, multiRow: false, reason };
      }
      return {
        entry,
        status: matchType === 'partial' ? 'PARTIAL_REF_MATCH' : 'MATCHED',
        matchType,
        candidates,
        multiRow: false,
        reason: matchType === 'partial' ? 'Reference only partially matches this row; review before applying' : ''
      };
    });

    const byRow = new Map();
    results.forEach(r => {
      if (r.status !== 'MATCHED' && r.status !== 'PARTIAL_REF_MATCH') return;
      r.candidates.forEach(row => {
        if (!byRow.has(row)) byRow.set(row, []);
        byRow.get(row).push(r);
      });
    });
    byRow.forEach(list => {
      if (list.length < 2) return;
      const lines = list.map(r => r.entry.lineNo).join(', ');
      list.forEach(r => {
        r.status = 'DUPLICATE_INPUT';
        r.reason = `Lines ${lines} point to the same row`;
      });
    });

    return results;
  }

  /* ---------- Preview / Apply protection ---------- */

  const cents = n => Math.round(n * 100);
  const formatUS = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function amountOrZero(text) {
    const s = String(text == null ? '' : text).trim();
    return s === '' ? { ok: true, value: 0 } : parseAmountStrict(s);
  }

  /**
   * Compares a row's current values with what the plan would write.
   * current: { checked, payment, discount } (raw field text); planned: { payment, discount|null }.
   * Returns { status, overwritable, reason }:
   *   READY            nothing entered yet; will be written
   *   ALREADY_APPLIED  already holds exactly the planned values; not written again
   *   HAS_PAYMENT      a different Payment is entered; written only if the user opts in
   *   HAS_DISCOUNT     a different Disc. Taken is entered; opt-in only when the line has a discount
   *                    (the write sequence never clears a discount)
   *   INCONSISTENT     Apply and Payment disagree; never written
   *   UNREADABLE       a current value is not a strict US amount; never written
   */
  function classifyRowState(current, planned) {
    const pay = amountOrZero(current.payment);
    const disc = amountOrZero(current.discount);
    if (!pay.ok) return { status: 'UNREADABLE', overwritable: false, reason: `Current Payment "${current.payment}" could not be read` };
    if (!disc.ok) return { status: 'UNREADABLE', overwritable: false, reason: `Current Disc. Taken "${current.discount}" could not be read` };

    const p = cents(pay.value), d = cents(disc.value);
    const wantP = cents(planned.payment), wantD = cents(planned.discount || 0);
    if (!current.checked && p === 0 && d === 0) return { status: 'READY', overwritable: false, reason: '' };
    if (!current.checked) return { status: 'INCONSISTENT', overwritable: false, reason: 'Row has values but Apply is not checked' };
    if (p === 0) return { status: 'INCONSISTENT', overwritable: false, reason: 'Apply is checked but Payment is blank' };
    if (p === wantP && d === wantD) return { status: 'ALREADY_APPLIED', overwritable: false, reason: 'Already holds these values' };
    if (d > 0 && wantD === 0) {
      return { status: 'HAS_DISCOUNT', overwritable: false, reason: `Row has Disc. Taken ${formatUS(disc.value)}; clear it in NetSuite, then Preview again` };
    }
    if (p !== wantP) {
      const also = d !== wantD ? ` and Disc. Taken ${formatUS(disc.value)}` : '';
      return { status: 'HAS_PAYMENT', overwritable: true, reason: `Already has Payment ${formatUS(pay.value)}${also}` };
    }
    return { status: 'HAS_DISCOUNT', overwritable: true, reason: `Already has Disc. Taken ${formatUS(disc.value)}` };
  }

  // Row state captured at Preview vs. now: { checked, payment, discount, ref, connected }.
  function sameRowState(before, now) {
    return !!now && now.connected !== false && before.checked === now.checked &&
      before.payment === now.payment && before.discount === now.discount && before.ref === now.ref;
  }

  // Identifies the loaded page; the URL does not change when switching NetSuite pages.
  function pageSignature(meta) {
    const refs = meta.refs || [];
    return [meta.customerId || '', meta.rangeText || '', refs.length, refs[0] || '', refs[refs.length - 1] || ''].join('|');
  }

  /**
   * Decides which rows of one input line are written.
   * items: [{ status, overwritable, overwrite, reason }] for every row the line matched.
   * A row is approved when READY, or when overwritable and the user opted in.
   * A multi-row line is all-or-nothing: every row must be approved or ALREADY_APPLIED.
   */
  function decideGroup(items) {
    const approved = items.map(it => it.status === 'READY' || (!!it.overwritable && !!it.overwrite));
    if (items.length === 1) return { approved, blockedReason: approved[0] ? '' : items[0].reason };
    const failing = items.findIndex((it, i) => !approved[i] && it.status !== 'ALREADY_APPLIED');
    if (failing < 0) return { approved, blockedReason: '' };
    return {
      approved: approved.map(() => false),
      blockedReason: `Row ${failing + 1} of ${items.length}: ${items[failing].reason}; none of this line's rows applied`
    };
  }

  /* ---------- Multi-page scan ---------- */
  // NetSuite shows the Invoices list in pages ("1001 to 2000 of 5555"). Values entered on one page
  // survive switching pages, and rows are numbered across the whole list (applyrow1000 is line 1001),
  // so a scan can index every page and plan across all of them. When the range changes, the range
  // text updates 0.4-1.8 s before the rows do; a page is only read once range and rows agree.

  const SETTLE_QUIET_MS = 800;

  function parseRange(text) {
    const m = /^\s*([\d,]+)\s+to\s+([\d,]+)\s+of\s+([\d,]+)\s*$/i.exec(String(text == null ? '' : text));
    if (!m) return null;
    const n = s => Number(s.replace(/,/g, ''));
    const start = n(m[1]), end = n(m[2]), total = n(m[3]);
    if (!(start >= 1 && end >= start && total >= end)) return null;
    return { start, end, total };
  }

  /**
   * Checks that the loaded rows are the rows the range text describes.
   * lineIndexes: 0-based NetSuite row numbers (applyrowN) of the loaded Invoices rows.
   * The rows agree when they are exactly positions start-1 .. end-1, each once.
   */
  function pageAgreement(rangeText, lineIndexes) {
    const range = parseRange(rangeText);
    if (!range) return { ok: false, range: null, reason: 'The range could not be read' };
    const lines = lineIndexes || [];
    const expected = range.end - range.start + 1;
    if (lines.length !== expected) return { ok: false, range, reason: `The range shows ${expected} rows but ${lines.length} are loaded` };
    const seen = new Set();
    for (const line of lines) {
      if (!Number.isInteger(line) || line < range.start - 1 || line > range.end - 1 || seen.has(line)) {
        return { ok: false, range, reason: 'The loaded rows do not match the range' };
      }
      seen.add(line);
    }
    return { ok: true, range, reason: '' };
  }

  /**
   * One step of the settle gate. Call it on every observation of the page with a clock value.
   * obs: { customerId, rangeText, lineIndexes, signal } where signal is any cheap change marker
   * (for example first and last Ref No.). The page is settled once range and rows agree and
   * nothing has changed for quietMs. Returns the next state plus { settled, reason }.
   */
  function settleStep(state, obs, now, quietMs) {
    const quiet = typeof quietMs === 'number' ? quietMs : SETTLE_QUIET_MS;
    const lines = obs.lineIndexes || [];
    const fp = [obs.customerId || '', obs.rangeText || '', obs.signal || '', lines.length, lines[0], lines[lines.length - 1]].join('|');
    const since = state && state.fp === fp ? state.since : now;
    const agreement = pageAgreement(obs.rangeText, lines);
    const settled = agreement.ok && now - since >= quiet;
    const reason = !agreement.ok ? `Page is still loading: ${agreement.reason}` : settled ? '' : 'Waiting for the page to settle';
    return { fp, since, settled, reason, range: agreement.range };
  }

  const rowDetail = r => [String(r.type || ''), normalizeRef(r.po), String(r.amtDueText || ''),
    (r.otherCells || []).map(c => String(c == null ? '' : c).trim()).join('\u001f')].join('\u001e');

  function makePageRecord(page, range) {
    const rows = page.rows.slice();
    return {
      range, rangeText: String(page.rangeText).trim(), customerId: String(page.customerId || ''),
      rows, refs: rows.map(r => normalizeRef(r.ref)), lines: rows.map(r => r.lineIndex),
      details: rows.map(rowDetail), stale: ''
    };
  }

  /**
   * Differences between a scanned page and a later reading of it, most serious first.
   * Codes: CUSTOMER, RANGE, ROW_COUNT, ROW_SET, ORDER, LINE_NUMBERS, DETAILS.
   */
  function comparePages(before, now) {
    const out = [];
    const add = (code, reason) => out.push({ code, reason });
    if (before.customerId !== now.customerId) add('CUSTOMER', 'The customer changed');
    if (before.rangeText !== now.rangeText) add('RANGE', `The range changed from "${before.rangeText}" to "${now.rangeText}"`);
    if (before.refs.length !== now.refs.length) { add('ROW_COUNT', `Row count changed from ${before.refs.length} to ${now.refs.length}`); return out; }
    const sortedBefore = before.refs.slice().sort().join('\n');
    const sortedNow = now.refs.slice().sort().join('\n');
    if (sortedBefore !== sortedNow) { add('ROW_SET', 'Different rows are on this page'); return out; }
    if (before.refs.join('\n') !== now.refs.join('\n')) { add('ORDER', 'The rows on this page are in a different order'); return out; }
    if (before.lines.join(',') !== now.lines.join(',')) add('LINE_NUMBERS', 'NetSuite row numbers changed');
    if (before.details.join('\n') !== now.details.join('\n')) add('DETAILS', 'Type, PO, Amt. Due or other columns changed');
    return out;
  }

  function createScan(customerId) {
    return { customerId: String(customerId || ''), total: null, pages: new Map() };
  }

  function markStale(scan, reason, exceptStart) {
    scan.pages.forEach((p, start) => { if (start !== exceptStart && !p.stale) p.stale = reason; });
  }

  /**
   * Adds a settled page reading to the scan.
   * page: { customerId, rangeText, rows: [{ ref, po, type, otherCells, amtDueText, lineIndex, ... }] }
   * rows must be the Invoices rows only (never Credits). Re-adding a page replaces it and clears
   * its stale flag. If its rows moved (different set or order), every other page becomes stale,
   * because a sort or refresh can move rows between pages. A change in the total open count
   * stales every page. Pages whose range overlaps the new one (page size changed) are dropped.
   */
  function addPage(scan, page) {
    if (String(page.customerId || '') !== scan.customerId) {
      return { ok: false, code: 'CUSTOMER_CHANGED', reason: 'The customer changed; start a new scan' };
    }
    const agreement = pageAgreement(page.rangeText, page.rows.map(r => r.lineIndex));
    if (!agreement.ok) return { ok: false, code: 'UNSETTLED', reason: `Page not read: ${agreement.reason}` };
    const range = agreement.range;
    const record = makePageRecord(page, range);

    if (scan.total !== null && range.total !== scan.total) {
      markStale(scan, `Open transactions changed from ${scan.total} to ${range.total}; scan this page again`, range.start);
    }
    scan.total = range.total;

    const dropped = [];
    scan.pages.forEach((p, start) => {
      if (start !== range.start && p.range.start <= range.end && range.start <= p.range.end) {
        scan.pages.delete(start);
        dropped.push(p.rangeText);
      }
    });

    const existing = scan.pages.get(range.start);
    const changes = existing ? comparePages(existing, record) : [];
    if (changes.some(c => c.code === 'ROW_SET' || c.code === 'ORDER' || c.code === 'ROW_COUNT' || c.code === 'RANGE')) {
      markStale(scan, `Rows moved on "${record.rangeText}" (sort or refresh); scan this page again`, range.start);
    }
    scan.pages.set(range.start, record);
    return { ok: true, range, replaced: !!existing, changes, dropped };
  }

  /**
   * Which parts of the list are scanned. complete means every row 1..total is covered exactly
   * once by fresh pages whose row numbers are continuous.
   */
  function scanCoverage(scan) {
    const pages = Array.from(scan.pages.values()).sort((a, b) => a.range.start - b.range.start);
    const stale = pages.filter(p => p.stale).map(p => ({ rangeText: p.rangeText, reason: p.stale }));
    const missing = [];
    let next = 1;
    let scannedRows = 0;
    pages.forEach(p => {
      if (p.stale) return;
      if (p.range.start > next) missing.push({ start: next, end: p.range.start - 1 });
      next = Math.max(next, p.range.end + 1);
      scannedRows += p.rows.length;
    });
    if (scan.total !== null && next <= scan.total) missing.push({ start: next, end: scan.total });
    const complete = scan.total !== null && missing.length === 0 && stale.length === 0 && scannedRows === scan.total;
    return {
      total: scan.total, scannedRows, complete, missing, stale,
      pages: pages.map(p => ({ rangeText: p.rangeText, start: p.range.start, end: p.range.end, rows: p.rows.length, stale: p.stale }))
    };
  }

  /**
   * Runs the existing matching over every scanned row at once, so uniqueness, the Invoice vs
   * non-Invoice multiple-match rules and "not found" are decided across all pages.
   * Requires a complete scan. Each result gains locations: [{ pageStart, rangeText, rowIndex, lineIndex }].
   */
  function matchAcrossPages(entries, scan) {
    const coverage = scanCoverage(scan);
    if (!coverage.complete) {
      const why = coverage.stale.length ? `${coverage.stale.length} page(s) need scanning again`
        : `${coverage.scannedRows} of ${coverage.total === null ? '?' : coverage.total} rows scanned`;
      return { ok: false, coverage, reason: `Scan every page first (${why})`, rows: [], results: [] };
    }
    const rows = [];
    const where = [];
    Array.from(scan.pages.values()).sort((a, b) => a.range.start - b.range.start).forEach(p => {
      p.rows.forEach((row, i) => {
        rows.push(row);
        where.push({ pageStart: p.range.start, rangeText: p.rangeText, rowIndex: i, lineIndex: row.lineIndex });
      });
    });
    const pageCount = scan.pages.size;
    const results = matchEntries(entries, rows).map(r => {
      const locations = r.candidates.map(c => where[c]);
      const out = Object.assign({}, r, { locations, pageStarts: Array.from(new Set(locations.map(l => l.pageStart))) });
      if (r.status === 'NOT_FOUND') out.reason = `Not found on any of the ${pageCount} scanned page(s)`;
      return out;
    });
    return { ok: true, coverage, rows, results };
  }

  /**
   * Groups matched lines by page for per-page Apply. Only MATCHED lines are planned; partial
   * matches, multiple matches, duplicates and invalid lines are listed in skipped.
   * A multi-row line whose rows sit on different pages cannot be applied all-or-nothing
   * (Apply works one page at a time), so it is held unless opts.allowCrossPageGroups is set.
   * Items keep the Ref No. (identity) and the NetSuite row number (consistency check).
   */
  function buildPagePlan(match, opts) {
    const allowCrossPage = !!(opts && opts.allowCrossPageGroups);
    const byPage = new Map();
    const held = [];
    const skipped = [];
    match.results.forEach(r => {
      const entry = r.entry;
      if (r.status !== 'MATCHED') { skipped.push({ lineNo: entry.lineNo, raw: entry.raw, status: r.status, reason: r.reason }); return; }
      if (r.multiRow && r.pageStarts.length > 1 && !allowCrossPage) {
        const pages = r.pageStarts.map(s => match.coverage.pages.find(p => p.start === s).rangeText).join('; ');
        held.push({ lineNo: entry.lineNo, raw: entry.raw, status: 'CROSS_PAGE_GROUP',
          reason: `Its ${r.candidates.length} rows are on different pages (${pages}); per-page Apply cannot apply them all-or-nothing` });
        return;
      }
      r.locations.forEach((loc, k) => {
        if (!byPage.has(loc.pageStart)) byPage.set(loc.pageStart, { pageStart: loc.pageStart, rangeText: loc.rangeText, items: [] });
        const row = match.rows[r.candidates[k]];
        byPage.get(loc.pageStart).items.push({
          lineNo: entry.lineNo, entry, ref: row.ref, refKey: normalizeRef(row.ref), lineIndex: loc.lineIndex,
          rowIndex: loc.rowIndex, multiRow: r.multiRow, groupSize: r.candidates.length
        });
      });
    });
    const pages = Array.from(byPage.values()).sort((a, b) => a.pageStart - b.pageStart);
    return { pages, held, skipped, rowCount: pages.reduce((n, p) => n + p.items.length, 0) };
  }

  /**
   * Checks a fresh, settled reading of a page against its scan before anything is applied there.
   * current: { customerId, rangeText, rows } read the same way as for addPage.
   * Returns { fresh, reasons: [{ code, reason }] }. Codes add NOT_SCANNED, STALE and UNSETTLED.
   */
  function checkPageFresh(scan, current) {
    if (String(current.customerId || '') !== scan.customerId) return { fresh: false, reasons: [{ code: 'CUSTOMER', reason: 'The customer changed' }] };
    const agreement = pageAgreement(current.rangeText, current.rows.map(r => r.lineIndex));
    if (!agreement.ok) return { fresh: false, reasons: [{ code: 'UNSETTLED', reason: `Page is still loading: ${agreement.reason}` }] };
    const page = scan.pages.get(agreement.range.start);
    if (!page) return { fresh: false, reasons: [{ code: 'NOT_SCANNED', reason: 'This page was not scanned' }] };
    if (page.stale) return { fresh: false, reasons: [{ code: 'STALE', reason: page.stale }] };
    const reasons = comparePages(page, makePageRecord(current, agreement.range));
    if (agreement.range.total !== scan.total) reasons.unshift({ code: 'TOTAL', reason: `Open transactions changed from ${scan.total} to ${agreement.range.total}` });
    return { fresh: reasons.length === 0, reasons };
  }

  /**
   * Finds each planned item among the rows now loaded on its page. The NetSuite row number must
   * still hold the same Ref No.; otherwise the item is reported as moved and must not be applied.
   * Returns [{ item, rowIndex }] or [{ item, error }].
   */
  function locatePlanItems(pagePlan, currentRows) {
    const byLine = new Map();
    currentRows.forEach((r, i) => byLine.set(r.lineIndex, i));
    return pagePlan.items.map(item => {
      const i = byLine.get(item.lineIndex);
      if (i === undefined) return { item, error: 'Row is not on the loaded page' };
      if (normalizeRef(currentRows[i].ref) !== item.refKey) return { item, error: 'Row moved: a different Ref No. is at this position' };
      return { item, rowIndex: i };
    });
  }

  /* ---------- Scan progress (panel) ---------- */

  /**
   * Page-by-page view of a scan for the panel. Scanned and stale pages are listed as recorded;
   * the rest of the list is cut into pages of pageSize on NetSuite's page grid.
   * Returns [{ start, end, status, reason }] (SCANNED, STALE, NOT_SCANNED) in list order,
   * or [] while the total or the page size is unknown.
   */
  function scanPageList(coverage, pageSize) {
    if (coverage.total === null || !(pageSize > 0)) return [];
    const out = coverage.pages.map(p => ({ start: p.start, end: p.end, status: p.stale ? 'STALE' : 'SCANNED', reason: p.stale || '' }));
    const stale = coverage.pages.filter(p => p.stale);
    const addChunks = (s, e) => {
      while (s <= e) {
        const end = Math.min(e, Math.floor((s - 1) / pageSize) * pageSize + pageSize);
        out.push({ start: s, end, status: 'NOT_SCANNED', reason: '' });
        s = end + 1;
      }
    };
    coverage.missing.forEach(m => {
      let s = m.start;
      while (s <= m.end) {
        const covering = stale.find(p => p.start <= s && s <= p.end);
        if (covering) { s = covering.end + 1; continue; }
        const next = stale.filter(p => p.start > s && p.start <= m.end).sort((a, b) => a.start - b.start)[0];
        const end = next ? next.start - 1 : m.end;
        addChunks(s, end);
        s = end + 1;
      }
    });
    return out.sort((a, b) => a.start - b.start);
  }

  /* ---------- Automatic scan ---------- */
  // ApplyFast can switch pages by clicking the options of NetSuite's own range dropdown. Only the
  // scan navigates; nothing is ever written. The range text changes before the rows, so a requested
  // page is ready only when the settle gate (range and rows agree, then quiet) passes after the click.

  const AUTO_SCAN_PAGE_CAP = 20;
  const AUTO_NAV_TIMEOUT_MS = 15000;

  /**
   * Plans an automatic scan from the range options NetSuite offers. The options must be readable,
   * continuous from row 1 to the total, agree on the total and share one page size (the last page
   * may be shorter), and the loaded range must be one of them.
   * Returns { ok, pages: [{ text, start, end, total }] in list order, total, pageSize, startIndex,
   * order: indexes to visit (the loaded page first, then the rest in list order), capped, cap }
   * or { ok: false, reason }.
   */
  function planAutoScan(optionTexts, currentRangeText, cap) {
    const limit = cap > 0 ? cap : AUTO_SCAN_PAGE_CAP;
    const fail = reason => ({ ok: false, reason });
    const texts = (optionTexts || []).map(t => String(t == null ? '' : t).trim());
    if (!texts.length) return fail('No range options were found');
    const pages = [];
    for (const text of texts) {
      const range = parseRange(text);
      if (!range) return fail(`The range option "${text}" could not be read`);
      pages.push({ text, start: range.start, end: range.end, total: range.total });
    }
    pages.sort((a, b) => a.start - b.start);
    const total = pages[0].total;
    const pageSize = pages[0].end - pages[0].start + 1;
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const size = p.end - p.start + 1;
      if (p.total !== total) return fail('The range options do not agree on the number of open transactions');
      if (p.start !== (i === 0 ? 1 : pages[i - 1].end + 1)) return fail('The range options are not continuous');
      if (i < pages.length - 1 ? size !== pageSize : size > pageSize) return fail('The range options do not share one page size');
    }
    if (pages[pages.length - 1].end !== total) return fail('The range options do not cover every open transaction');
    const current = parseRange(currentRangeText);
    const startIndex = current ? pages.findIndex(p => p.start === current.start && p.end === current.end && p.total === current.total) : -1;
    if (startIndex < 0) return fail('The loaded range is not one of the range options');
    const order = [startIndex].concat(pages.map((_, i) => i).filter(i => i !== startIndex));
    return { ok: true, pages, total, pageSize, startIndex, order: order.slice(0, limit), capped: order.length > limit, cap: limit };
  }

  /**
   * Whether a requested page switch has finished. settle is the latest settleStep result and
   * requestedAt the clock value of the option click. READY needs a settled reading taken after the
   * click (the old page is settled until NetSuite reacts); TIMEOUT after timeoutMs; else WAITING.
   */
  function autoNavStatus(settle, requestedAt, now, timeoutMs) {
    const limit = timeoutMs > 0 ? timeoutMs : AUTO_NAV_TIMEOUT_MS;
    if (settle && settle.settled && settle.since >= requestedAt) return 'READY';
    if (now - requestedAt > limit) return 'TIMEOUT';
    return 'WAITING';
  }

  /**
   * Checks a settled page against what the automatic scan expects before it continues.
   * expected: { customerId, total, pageSize }; target: { start, end }; observed: { customerId, range, rows }.
   * Returns { ok, code, reason } with codes CUSTOMER, UNSETTLED, TOTAL, RANGE, ROW_COUNT.
   */
  function verifyAutoPage(expected, target, observed) {
    const bad = (code, reason) => ({ ok: false, code, reason });
    if (String(observed.customerId || '') !== String(expected.customerId || '')) return bad('CUSTOMER', 'The customer changed');
    const range = observed.range;
    if (!range) return bad('UNSETTLED', 'The range could not be read');
    if (range.total !== expected.total) return bad('TOTAL', `Open transactions changed from ${expected.total} to ${range.total}`);
    const size = range.end - range.start + 1;
    if (range.end < range.total && size !== expected.pageSize) return bad('ROW_COUNT', `The page size changed from ${expected.pageSize} to ${size}`);
    if (range.start !== target.start || range.end !== target.end) {
      return bad('RANGE', `NetSuite shows ${range.start} to ${range.end} instead of the requested ${target.start} to ${target.end}`);
    }
    if (observed.rows !== size) return bad('ROW_COUNT', `The range shows ${size} rows but ${observed.rows} are loaded`);
    return { ok: true, code: '', reason: '' };
  }

  /* ---------- Multi-page Apply ---------- */
  // Apply writes page by page, in list order, only after the user clicks Apply on a Preview of a
  // complete scan. Every page is checked against its scan when it loads and every row again right
  // before its write; anything that differs is skipped or ends the run, never guessed or retried.

  // List-level changes: the whole Apply stops before anything is written on the page.
  const APPLY_HALT_CODES = new Set(['CUSTOMER', 'TOTAL', 'RANGE', 'ROW_COUNT', 'ROW_SET', 'ORDER', 'LINE_NUMBERS', 'UNSETTLED', 'NOT_SCANNED', 'STALE']);

  // The Payment and Discount a line asks for on a scanned row (full balance uses the scanned Amt. Due).
  function plannedAmounts(entry, row) {
    const discount = (typeof entry.discount === 'number' && entry.discount > 0) ? entry.discount : null;
    let payment = entry.payment;
    let reason = '';
    if (payment === null || payment === undefined) {
      if (row.amtDue === null || row.amtDue === undefined) reason = `Amt. Due "${row.amtDueText}" could not be read; enter an amount (REF=0.00)`;
      else if (row.amtDue <= 0) reason = 'Amt. Due is 0.00';
      else payment = row.amtDue;
    }
    return { payment: reason ? null : payment, discount, reason };
  }

  /**
   * One plan item per planned row of a page plan, with everything Apply needs to recognise the row
   * again: page, NetSuite row number, Ref No., internal id, a details fingerprint and the Apply /
   * Payment / Disc. Taken values the Preview showed. Decisions follow the single-page rules.
   */
  function buildMultiApplyPlan(pagePlan, scan) {
    const items = [];
    pagePlan.pages.forEach(page => {
      const record = scan.pages.get(page.pageStart);
      page.items.forEach(pi => {
        const row = record.rows[pi.rowIndex];
        const amounts = plannedAmounts(pi.entry, row);
        const before = { checked: !!row.checked, payment: row.payment || '', discount: row.discount || '' };
        const state = amounts.reason
          ? { status: 'UNPLANNABLE', overwritable: false, reason: amounts.reason }
          : classifyRowState(before, { payment: amounts.payment, discount: amounts.discount });
        items.push({
          id: items.length, lineNo: pi.lineNo, raw: pi.entry.raw, pageStart: page.pageStart, rangeText: page.rangeText,
          lineIndex: pi.lineIndex, ref: row.ref, refKey: pi.refKey, internalId: row.internalId || '', type: row.type || '',
          amtDueText: row.amtDueText || '', detail: rowDetail(row), multiRow: pi.multiRow, groupSize: pi.groupSize,
          payment: amounts.payment, discount: amounts.discount, before, state, overwrite: false, willWrite: false, note: ''
        });
      });
    });
    decideMultiWrites(items);
    return items;
  }

  // Sets willWrite / note on every item, one input line at a time (decideGroup).
  function decideMultiWrites(items) {
    const groups = new Map();
    items.forEach(it => {
      if (!groups.has(it.lineNo)) groups.set(it.lineNo, []);
      groups.get(it.lineNo).push(it);
    });
    groups.forEach(list => {
      const decision = decideGroup(list.map(it => ({ status: it.state.status, overwritable: it.state.overwritable, overwrite: it.overwrite, reason: it.state.reason })));
      list.forEach((it, i) => {
        it.willWrite = decision.approved[i];
        it.note = it.willWrite ? '' : it.state.status === 'ALREADY_APPLIED' ? it.state.reason : (decision.blockedReason || it.state.reason);
      });
    });
    return items;
  }

  // Pages with rows to write, in list order; rows in NetSuite row order.
  function orderApplyPages(items) {
    const byPage = new Map();
    items.filter(it => it.willWrite).forEach(it => {
      if (!byPage.has(it.pageStart)) byPage.set(it.pageStart, { pageStart: it.pageStart, rangeText: it.rangeText, items: [] });
      byPage.get(it.pageStart).items.push(it);
    });
    const pages = Array.from(byPage.values()).sort((a, b) => a.pageStart - b.pageStart);
    pages.forEach(p => p.items.sort((a, b) => a.lineIndex - b.lineIndex));
    return pages;
  }

  /**
   * Why a live row no longer is the planned row in its Preview state, or '' when it still is.
   * now: { connected, lineIndex, ref, internalId, type, po, amtDueText, otherCells, checked, payment, discount }.
   * Returns { status: 'MOVED' | 'CHANGED', reason } or null.
   */
  function rowChangeSincePreview(item, now) {
    if (!now || now.connected === false) return { status: 'MOVED', reason: 'The row is no longer on the page' };
    if (now.lineIndex !== item.lineIndex) return { status: 'MOVED', reason: 'NetSuite row number changed' };
    if (normalizeRef(now.ref) !== item.refKey) return { status: 'MOVED', reason: 'A different Ref No. is at this position' };
    if (item.internalId && now.internalId && item.internalId !== now.internalId) return { status: 'MOVED', reason: 'A different transaction is at this position' };
    if (rowDetail(now) !== item.detail) return { status: 'CHANGED', reason: 'Type, PO, Amt. Due or other columns changed since Preview' };
    if (!!now.checked !== item.before.checked || (now.payment || '') !== item.before.payment || (now.discount || '') !== item.before.discount) {
      return { status: 'CHANGED', reason: 'Apply, Payment or Disc. Taken changed since Preview' };
    }
    return null;
  }

  /**
   * Checks a freshly loaded, settled page before anything is written on it.
   * current: { customerId, rangeText, rows: [{ ref, po, type, otherCells, amtDueText, lineIndex, internalId,
   * checked, payment, discount, writable, discountEditable }] }; items: this page's items to write.
   * Returns { ok: false, halt: { code, reason } } for a list-level change, else
   * { ok: true, results: [{ item, status: 'OK' | 'MOVED' | 'CHANGED' | 'NOT_WRITABLE', reason, rowIndex }] }.
   * A line whose rows are not all OK writes none of them.
   */
  function revalidateApplyPage(scan, current, items) {
    const fresh = checkPageFresh(scan, current);
    const halt = fresh.reasons.find(r => APPLY_HALT_CODES.has(r.code));
    if (halt) return { ok: false, halt };
    const byLine = new Map();
    current.rows.forEach((r, i) => byLine.set(r.lineIndex, i));
    const results = items.map(item => {
      const i = byLine.get(item.lineIndex);
      const row = i === undefined ? null : current.rows[i];
      const change = rowChangeSincePreview(item, row);
      if (change) return { item, status: change.status, reason: change.reason, rowIndex: i };
      if (row.writable === false) return { item, status: 'NOT_WRITABLE', reason: 'Row has no Apply checkbox or Payment field', rowIndex: i };
      if (item.discount && row.discountEditable === false) return { item, status: 'NOT_WRITABLE', reason: 'Disc. Taken field not found or not editable; line not applied', rowIndex: i };
      return { item, status: 'OK', reason: '', rowIndex: i };
    });
    const failedLines = new Set(results.filter(r => r.status !== 'OK').map(r => r.item.lineNo));
    results.forEach(r => {
      if (r.status === 'OK' && failedLines.has(r.item.lineNo)) {
        r.status = 'CHANGED';
        r.reason = `Another row of line ${r.item.lineNo} changed or cannot be written; none of this line's rows written`;
      }
    });
    return { ok: true, results };
  }

  /**
   * Classifies a row read back after writeRow. readBack: { connected, lineIndex, ref, checked, payment, discount }.
   * APPLIED: exactly the planned values; ADJUSTED: NetSuite shows other readable amounts;
   * NOT_CONFIRMED: the row or its values could not be confirmed.
   */
  function verifyWrite(item, readBack) {
    const actual = { actualPayment: readBack ? readBack.payment || '' : '', actualDiscount: readBack ? readBack.discount || '' : '' };
    const out = (status, reason) => Object.assign({ status, reason }, actual);
    if (!readBack || readBack.connected === false || readBack.lineIndex !== item.lineIndex || normalizeRef(readBack.ref) !== item.refKey) {
      return out('NOT_CONFIRMED', 'The row could not be found again after writing');
    }
    const pay = amountOrZero(readBack.payment), disc = amountOrZero(readBack.discount);
    if (!pay.ok || !disc.ok) return out('NOT_CONFIRMED', 'The values NetSuite shows could not be read');
    if (!readBack.checked) return out('NOT_CONFIRMED', 'Apply is not ticked after writing');
    if (cents(pay.value) === cents(item.payment) && cents(disc.value) === cents(item.discount || 0)) return out('APPLIED', '');
    return out('ADJUSTED', `NetSuite shows Payment ${formatUS(pay.value)}` + (disc.value || item.discount ? ` / Disc. ${formatUS(disc.value)}` : ''));
  }

  /**
   * Whether Reset may clear a row ApplyFast wrote in this session.
   * record: { lineIndex, ref, before: { checked, payment, discount }, after: { payment, discount } }
   *   (after = the values read back right after the write).
   * now: the row on the loaded page { lineIndex, ref, checked, payment, discount, disabled }, or null.
   * CLEAR: untick it and blank its Payment (and Disc. Taken if ApplyFast wrote one).
   * NOT_ON_PAGE: the row is not on the loaded page. LOCKED: its fields are disabled (e.g. saved).
   * HAD_VALUES: it held values before ApplyFast wrote it; left as it is.
   * EDITED: it no longer holds what ApplyFast wrote; left as it is.
   */
  function resetRowAction(record, now) {
    if (!now || (record.lineIndex != null && now.lineIndex !== record.lineIndex) || normalizeRef(now.ref) !== normalizeRef(record.ref)) return 'NOT_ON_PAGE';
    if (now.disabled) return 'LOCKED';
    const was = record.before;
    const wasPay = amountOrZero(was.payment), wasDisc = amountOrZero(was.discount);
    if (was.checked || !wasPay.ok || !wasDisc.ok || cents(wasPay.value) || cents(wasDisc.value)) return 'HAD_VALUES';
    const pay = amountOrZero(now.payment), disc = amountOrZero(now.discount);
    const wrote = amountOrZero(record.after.payment), wroteDisc = amountOrZero(record.after.discount);
    if (!now.checked || !pay.ok || !disc.ok || !wrote.ok || !wroteDisc.ok) return 'EDITED';
    if (cents(pay.value) !== cents(wrote.value) || cents(disc.value) !== cents(wroteDisc.value)) return 'EDITED';
    return 'CLEAR';
  }

  function applyEndMessage(kind, applied, planned, reason) {
    const counts = `${applied} of ${planned} planned row${planned === 1 ? '' : 's'} applied.`;
    if (kind === 'STOPPED') return `Apply stopped — ${counts}`;
    if (kind === 'HALTED') return `Apply halted — ${reason}. ${counts}`;
    return `Apply complete — ${counts}`;
  }

  // Public ApplyFast pages linked from the panel and the toolbar popup. Public URLs only.
  const APPLYFAST_WEBSITE_URL = 'https://getapplyfast.github.io/';
  const LINKS = Object.freeze({
    website: APPLYFAST_WEBSITE_URL,
    demo: APPLYFAST_WEBSITE_URL + 'demo/',
    pricing: APPLYFAST_WEBSITE_URL + '#pricing'
  });

  const api = {
    parseAmountStrict, isAccountingZero, normalizeRef, parseLine, parseInput, transformPaste, pasteEdit, matchEntries, MIN_PARTIAL_LENGTH,
    classifyRowState, sameRowState, pageSignature, decideGroup,
    SETTLE_QUIET_MS, parseRange, pageAgreement, settleStep, createScan, addPage, scanCoverage,
    matchAcrossPages, buildPagePlan, checkPageFresh, locatePlanItems, scanPageList,
    AUTO_SCAN_PAGE_CAP, AUTO_NAV_TIMEOUT_MS, planAutoScan, autoNavStatus, verifyAutoPage,
    plannedAmounts, buildMultiApplyPlan, decideMultiWrites, orderApplyPages, rowChangeSincePreview,
    revalidateApplyPage, verifyWrite, resetRowAction, applyEndMessage, LINKS
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ApplyFastCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
