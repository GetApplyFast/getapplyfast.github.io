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
   *   REF                  bare reference: applied for the row's full Amt. Due
   *   REF=payment          the payment to apply (group cap when the reference matches several rows)
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

  // The reference of an input line as parseLine reads it, without amounts or separators ('' for none).
  function remittanceReference(raw) {
    return parseLine(raw, 0).ref;
  }

  /**
   * Duplicate-reference banner. Keys are normalizeRef (trim + case-insensitive); INV1 and INV10
   * are different keys and must not collide. Any format (bare / = / pipe) shares one key.
   */
  function duplicateReferenceReason(ref, lineNos) {
    return 'Duplicate reference ' + ref + ' on lines ' + lineNos.join(', ') +
      '. Combine or remove duplicate references, then preview again.';
  }

  function overlapRowReason(lineNos, rowRef) {
    const lines = lineNos.slice().sort((a, b) => a - b);
    const pair = lines.length === 2
      ? ('Lines ' + lines[0] + ' and ' + lines[1])
      : ('Lines ' + lines.join(', '));
    return pair + ' both match the same invoice row (' + rowRef + '). Combine or remove one, then preview again.';
  }

  /**
   * Parses the whole textarea. Empty lines are ignored.
   * The same reference key on more than one line (any format) is DUPLICATE_INPUT on every
   * appearance — never last-wins, never combined. Duplicate keys block the whole Preview/Apply
   * (see attachMatchBlocks). Normalization: trim + case-insensitive via normalizeRef.
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
    const blocks = [];
    byKey.forEach(list => {
      if (list.length < 2) return;
      const ordered = list.slice().sort((a, b) => a.lineNo - b.lineNo);
      const lineNos = ordered.map(e => e.lineNo);
      const displayRef = ordered[0].ref;
      const reason = duplicateReferenceReason(displayRef, lineNos);
      ordered.forEach(e => {
        e.status = 'DUPLICATE_INPUT';
        e.reason = reason;
      });
      blocks.push({ type: 'DUPLICATE', key: ordered[0].key, ref: displayRef, lineNos: lineNos, message: reason });
    });

    return { entries, valid: entries.filter(e => e.status === 'OK'), blocks: blocks };
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
   *   2 columns: REF, payment            -> REF=payment (blank payment -> REF, which applies the full Amt. Due)
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

  const PIPE_MULTI_REASON = 'Use REF=AMOUNT for multi-row references';
  const SCAN_CAP_GROUP_REASON = (cap) => 'Matching rows may sit beyond the ' + cap + '-page scan limit; held so a partial group is not applied';
  const CAP_NOT_REACHED_REASON = 'Matched, no application: reference amount used by rows above';
  // Unmatched lines that are held (not skipped): shown Held in Preview and in the Results after Apply.
  const HELD_LINE_STATUSES = Object.freeze(['CROSS_PAGE_GROUP', 'SCAN_CAP_GROUP', 'PIPE_MULTI_ROW']);
  const SKIPPED_NO_DUE_REASON = 'Skipped: no positive amount due';

  /**
   * Classifies parsed entries against an in-memory row snapshot.
   * rows: [{ ref, po, type?, otherCells?: string[] }]
   * Priority: exact Ref No. > exact PO > exact whole token in other cells > partial.
   * Partial matches need MIN_PARTIAL_LENGTH characters and are flagged, never auto-selected.
   * Multi-row MATCHED when: PO or other-column (token) match, or a non-Invoice type group.
   * Exact Invoice Ref No. matching several rows stays MULTIPLE_MATCH; partial stays single-row.
   * Overlap: two different input lines that resolve to the same NetSuite row are OVERLAP and
   * block the whole Preview/Apply (no combining). Overlap is evaluated only among the rows
   * passed in — All pages passes every scanned page; This page only passes the loaded page.
   * Returns one result per entry: { entry, status, matchType, candidates, multiRow, reason }.
   */
  function matchEntries(entries, rows, opts) {
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
        const bareRef = entry.format === 'ref';
        const nonInvoiceGroup = matchType !== 'partial' && candidates.every(i => isNonInvoiceType(rows[i].type));
        // PO/token multi-row (any type), or non-Invoice groups. Never exact Ref No. multi; never partial multi.
        const allowPoToken = (matchType === 'po' || matchType === 'token');
        const allowNonInv = nonInvoiceGroup;
        if (allowPoToken || allowNonInv) {
          const label = allowPoToken && !nonInvoiceGroup ? 'rows' : 'non-Invoice rows';
          return { entry, status: 'MATCHED', matchType, candidates, multiRow: true, reason: 'Matches ' + candidates.length + ' ' + label };
        }
        let reason = 'Matches ' + candidates.length + ' rows';
        if (!bareRef && matchType === 'ref') reason += '; an exact Ref No. must match exactly one row';
        else if (!bareRef) reason += '; a line with an amount must match exactly one row';
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

    // Overlap detector: only among `rows` supplied to this call (All pages = union of scanned
    // pages; This page = the loaded page only). Two paste lines claiming the same NetSuite row
    // block the whole Preview/Apply — nothing is combined.
    const byRow = new Map();
    results.forEach(r => {
      if (r.status !== 'MATCHED' && r.status !== 'PARTIAL_REF_MATCH') return;
      r.candidates.forEach(row => {
        if (!byRow.has(row)) byRow.set(row, []);
        byRow.get(row).push(r);
      });
    });
    const overlapBlocks = [];
    byRow.forEach((list, rowIndex) => {
      if (list.length < 2) return;
      const lineNos = list.map(r => r.entry.lineNo);
      const rowRef = rows[rowIndex] && rows[rowIndex].ref ? rows[rowIndex].ref : 'row';
      const reason = overlapRowReason(lineNos, rowRef);
      list.forEach(r => {
        r.status = 'OVERLAP';
        r.reason = reason;
      });
      overlapBlocks.push({ type: 'OVERLAP', rowIndex: rowIndex, ref: rowRef, lineNos: lineNos.slice().sort((a, b) => a - b), message: reason });
    });
    results._overlapBlocks = overlapBlocks;

    return results;
  }

  /**
   * Attach duplicate + overlap blocks to a match object. When blocked is true, Preview shows the
   * banner messages and Apply writes nothing until the paste changes.
   */
  function attachMatchBlocks(match, parseBlocks, overlapBlocks) {
    const derived = [];
    (match.results || []).forEach(r => {
      if (r && r.status === 'OVERLAP' && r.reason && !derived.some(b => b.message === r.reason)) {
        const lineNos = (match.results || []).filter(x => x.status === 'OVERLAP' && x.reason === r.reason).map(x => x.entry.lineNo);
        derived.push({
          type: 'OVERLAP',
          ref: (r.reason.match(/\(([^)]+)\)\./) || [])[1] || '',
          lineNos: Array.from(new Set(lineNos)).sort((a, b) => a - b),
          message: r.reason
        });
      }
    });
    const blocks = [].concat(parseBlocks || [], overlapBlocks && overlapBlocks.length ? overlapBlocks : derived);
    match.blocks = blocks;
    match.blocked = blocks.length > 0;
    match.blockMessages = blocks.map(b => b.message);
    return match;
  }

  /* ---------- Read-only invoice details ---------- */
  // Invoices columns captured for Review & Reconciliation: Date, Orig. Amt. and Disc. Avail.
  // They are read only. They never take part in matching, planning, the scan fingerprint
  // (rowDetail) or any write. Labels arrive as the content script reads the header: lowercase,
  // single spaces ("orig. amt."). "Disc. Date" and "Group Date" are not the Date column.
  const INFO_COLUMNS = Object.freeze({
    date: /^date$/,
    origAmt: /^orig(inal)?\.?\s*(amt|amount)\.?$/,
    discAvail: /^disc(ount)?\.?\s*avail(able)?\.?$/
  });

  // Header labels -> { date, origAmt, discAvail } column positions (first match; absent when not found).
  function infoColumns(labels) {
    const out = {};
    (labels || []).forEach((label, i) => {
      const text = String(label == null ? '' : label).trim();
      Object.keys(INFO_COLUMNS).forEach(name => {
        if (out[name] === undefined && INFO_COLUMNS[name].test(text)) out[name] = i;
      });
    });
    return out;
  }

  // Cell texts -> row fields. Amounts follow the Amt. Due convention: the text as shown, plus the
  // strict US value or null when the cell is blank or not a strict US amount. Date stays as shown.
  function infoValues(texts) {
    const t = texts || {};
    const text = v => String(v == null ? '' : v).trim();
    const amount = s => {
      if (!s) return null;
      const parsed = parseAmountStrict(s);
      return parsed.ok ? parsed.value : null;
    };
    const origAmtText = text(t.origAmt), discAvailText = text(t.discAvail);
    return { date: text(t.date), origAmt: amount(origAmtText), origAmtText, discAvail: amount(discAvailText), discAvailText };
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
    const ignorable = it => it.status === 'ALREADY_APPLIED' || it.status === 'CAP_NOT_REACHED' || it.status === 'SKIPPED_NO_DUE';
    if (items.length === 1) return { approved, blockedReason: approved[0] || ignorable(items[0]) ? '' : items[0].reason };
    const failing = items.findIndex((it, i) => !approved[i] && !ignorable(it));
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
   * True when NetSuite's Invoices range text describes more than one page of open
   * transactions (same signal All pages uses to know further pages exist).
   * Accepts a range object from parseRange or the range text string.
   */
  function listHasMultiplePages(rangeOrText) {
    const range = (rangeOrText && typeof rangeOrText === 'object' && 'total' in rangeOrText)
      ? rangeOrText
      : parseRange(rangeOrText);
    if (!range) return false;
    return range.total > (range.end - range.start + 1);
  }

  // This page only Preview warning when a multi-row match may continue past the loaded page.
  // Warning only — the matched rows on this page are still planned (not held).
  const THIS_PAGE_GROUP_WARN = 'This page only: this group may continue on other pages. Use All pages to cover the whole group.';

  function thisPageGroupWarning(multiRow, rangeOrText) {
    return multiRow && listHasMultiplePages(rangeOrText) ? THIS_PAGE_GROUP_WARN : '';
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
  function matchAcrossPages(entries, scan, opts) {
    // Overlap detection (All pages): runs across every scanned page in the complete scan.
    // Two paste lines that resolve to the same NetSuite row anywhere in the scan block the whole run.
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
    // Overlap covers every scanned page (union of scan.pages). Duplicate keys are attached by the caller via parse blocks.
    const matched = matchEntries(entries, rows, opts);
    const overlapBlocks = matched._overlapBlocks || [];
    const results = matched.map(r => {
      const locations = r.candidates.map(c => where[c]);
      const out = Object.assign({}, r, { locations, pageStarts: Array.from(new Set(locations.map(l => l.pageStart))) });
      if (r.status === 'NOT_FOUND') out.reason = `Not found on any of the ${pageCount} scanned page(s)`;
      return out;
    });
    return attachMatchBlocks({ ok: true, coverage, rows, results }, [], overlapBlocks);
  }

  /**
   * This page only: the loaded Invoices rows as a one-page scan plus the match against them, in the
   * shapes matchAcrossPages and the scan have, so both modes share buildPagePlan, buildMultiApplyPlan,
   * buildCashWritePlan and buildReconciliationResults. Only collection differs: matching sees the loaded
   * rows alone, nothing has to be scanned and no page agreement is required.
   * page: { customerId, rangeText, rows } read as for addPage. A row without a NetSuite row number gets
   * its position on the page (range start - 1 + index) so every plan item points at exactly one row.
   * Returns { scan, match }; page is not modified.
   */
  function matchLoadedPage(entries, page, opts) {
    // Overlap detection (This page): covers only rows on the current loaded page (only those are scanned).
    // Lines that would overlap a row on another page are out of scope until that page is loaded or All pages is used.
    const src = page || {};
    const loaded = src.rows || [];
    const range = parseRange(src.rangeText) || { start: 1, end: Math.max(loaded.length, 1), total: null };
    const rows = loaded.map((r, i) => (Number.isInteger(r.lineIndex) ? r : Object.assign({}, r, { lineIndex: range.start - 1 + i })));
    const record = makePageRecord({ customerId: src.customerId, rangeText: src.rangeText || '', rows }, range);
    const scan = { customerId: record.customerId, total: range.total, pages: new Map([[range.start, record]]) };
    const where = rows.map((row, i) => ({ pageStart: range.start, rangeText: record.rangeText, rowIndex: i, lineIndex: row.lineIndex }));
    // Overlap covers only rows on the current (loaded) page — the only rows This page mode scans.
    const matched = matchEntries(entries, rows, opts);
    const overlapBlocks = matched._overlapBlocks || [];
    const results = matched.map(r => {
      const locations = r.candidates.map(c => where[c]);
      const out = Object.assign({}, r, { locations, pageStarts: locations.length ? [range.start] : [] });
      if (r.status === 'NOT_FOUND') out.reason = 'Not found in the loaded Invoices rows';
      return out;
    });
    const coverage = { total: range.total, scannedRows: rows.length, complete: true, missing: [], stale: [],
      pages: [{ rangeText: record.rangeText, start: range.start, end: range.end, rows: rows.length, stale: '' }] };
    return { scan, match: attachMatchBlocks({ ok: true, coverage, rows, results }, [], overlapBlocks) };
  }

  /**
   * Groups matched lines by page for per-page Apply. Only MATCHED lines are planned; partial
   * matches, multiple matches, duplicates, overlaps and invalid lines are listed in skipped.
   * Cross-page multi-row groups are allowed. Discount-format (pipe) multi-row lines are held
   * (PIPE_MULTI_ROW). When opts.scanCapped is set, multi-row groups that may extend past the
   * scan page cap are held (SCAN_CAP_GROUP).
   * When match.blocked (duplicate keys or row overlaps), nothing is planned — every line is
   * skipped so Preview shows no applyable rows and Apply stays disabled until the paste changes.
   * Items keep the Ref No. (identity) and the NetSuite row number (consistency check).
   */
  function buildPagePlan(match, opts) {
    const scanCapped = !!(opts && opts.scanCapped);
    const scanCap = (opts && opts.scanCap > 0) ? opts.scanCap : 20;
    const byPage = new Map();
    const held = [];
    const skipped = [];
    if (match && match.blocked) {
      (match.results || []).forEach(r => {
        const entry = r.entry;
        skipped.push({ lineNo: entry.lineNo, raw: entry.raw, status: r.status === 'OK' || r.status === 'MATCHED' ? 'BLOCKED_RUN' : r.status,
          reason: (match.blockMessages && match.blockMessages[0]) || r.reason || 'Fix duplicate or overlapping references, then preview again.' });
      });
      return { pages: [], held, skipped, rowCount: 0, blocked: true, blockMessages: match.blockMessages || [] };
    }
    match.results.forEach(r => {
      const entry = r.entry;
      if (r.status !== 'MATCHED') { skipped.push({ lineNo: entry.lineNo, raw: entry.raw, status: r.status, reason: r.reason }); return; }
      if (entry.format === 'discount' && r.multiRow) {
        held.push({ lineNo: entry.lineNo, raw: entry.raw, status: 'PIPE_MULTI_ROW', reason: PIPE_MULTI_REASON });
        return;
      }
      if (r.multiRow && scanCapped) {
        held.push({ lineNo: entry.lineNo, raw: entry.raw, status: 'SCAN_CAP_GROUP', reason: SCAN_CAP_GROUP_REASON(scanCap) });
        return;
      }
      r.locations.forEach((loc, k) => {
        if (!byPage.has(loc.pageStart)) byPage.set(loc.pageStart, { pageStart: loc.pageStart, rangeText: loc.rangeText, items: [] });
        const row = match.rows[r.candidates[k]];
        byPage.get(loc.pageStart).items.push({
          lineNo: entry.lineNo, entry, ref: row.ref, refKey: normalizeRef(row.ref), lineIndex: loc.lineIndex,
          rowIndex: loc.rowIndex, multiRow: r.multiRow, groupSize: r.candidates.length, matchType: r.matchType || null
        });
      });
    });
    const pages = Array.from(byPage.values()).sort((a, b) => a.pageStart - b.pageStart);
    return { pages, held, skipped, rowCount: pages.reduce((n, p) => n + p.items.length, 0) };
  }

  /**
   * Checks a fresh, settled reading of a page against its scan before anything is applied there.  /**
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

  const NO_AMOUNT_REASON = 'No amount — use REF=AMOUNT';

  // The Payment and Discount a line asks for on a row.
  // Bare REF uses the row's full Amt. Due. REF=AMOUNT is a group running cap allotted later.
  // Single-row amount/discount lines keep the typed amounts (overpayment status preserved for Excel).
  function plannedAmounts(entry, row, opts) {
    const discount = (typeof entry.discount === 'number' && entry.discount > 0) ? entry.discount : null;
    const payment = entry.payment === null || entry.payment === undefined ? null : entry.payment;
    if (payment !== null) return { payment, discount, reason: '' };
    if (!row || row.amtDue === null || row.amtDue === undefined) {
      const txt = row && row.amtDueText != null ? row.amtDueText : '';
      return { payment: null, discount: null, reason: 'Amt. Due "' + txt + '" could not be read; enter an amount (REF=0.00)' };
    }
    // Amt. Due <= 0 is skipped. The row reader rejects negative Amt. Due text (parseAmountStrict), so a negative
    // row arrives with amtDue null and is unplannable above; in practice only a 0.00 row reaches this skip.
    if (row.amtDue <= 0) return { payment: null, discount: null, reason: SKIPPED_NO_DUE_REASON, skip: true };
    return { payment: row.amtDue, discount: null, reason: '' };
  }

  function skipsCapConsumption(state) {
    if (!state) return true;
    if (state.status === 'ALREADY_APPLIED' || state.status === 'CAP_NOT_REACHED' || state.status === 'SKIPPED_NO_DUE') return true;
    if (state.status === 'UNPLANNABLE' || state.status === 'INCONSISTENT' || state.status === 'UNREADABLE') return true;
    if (state.status === 'HAS_DISCOUNT' && !state.overwritable) return true;
    return false;
  }

  // True when the row already holds a full Amt. Due application (checked + payment == due).
  // Used before REF=AMOUNT allotment so protected ticks do not consume the group's cap.
  function isAlreadyFullyApplied(it) {
    if (!it || !it.before || !it.before.checked) return false;
    if (typeof it.amtDue !== 'number' || !(it.amtDue > 0)) return false;
    return classifyRowState(it.before, { payment: it.amtDue, discount: null }).status === 'ALREADY_APPLIED';
  }

  function groupCapLeftover(items) {
    let max = 0;
    (items || []).forEach(it => { if (typeof it.capLeftover === 'number' && it.capLeftover > max) max = it.capLeftover; });
    return max;
  }

  /**
   * Allot a REF=AMOUNT cap across a group's items in ascending pageStart then lineIndex.
   * Already-applied and zero-due (Amt. Due <= 0; in practice 0.00) rows do not consume the cap.
   */
  function allotGroupCaps(items, opts) {
    if (!items.length) return { items: items, capLeftover: 0 };
    const byLine = new Map();
    items.forEach((it, idx) => {
      if (!byLine.has(it.lineNo)) byLine.set(it.lineNo, []);
      byLine.get(it.lineNo).push(idx);
    });
    let totalLeftoverC = 0;
    const out = items.map(it => Object.assign({}, it));
    byLine.forEach(idxs => {
      const sample = out[idxs[0]];
      const cap = sample.requestedCap;
      if (cap === null || cap === undefined) return;
      // Single-row REF=AMOUNT keeps the requested payment (v1.6 overpayment). Cap allotment is multi-row only.
      if (idxs.length === 1) return;
      const ordered = idxs.slice().sort((a, b) => (out[a].pageStart - out[b].pageStart) || (out[a].lineIndex - out[b].lineIndex));
      let left = cents(cap);
      ordered.forEach(idx => {
        const copy = out[idx];
        const dueC = copy.amtDue === null || copy.amtDue === undefined ? null : cents(copy.amtDue);
        // D3: Amt. Due <= 0 - skip with info; do not consume cap or block the group. Negative Amt. Due text is
        // rejected by the row reader (amtDue null), so such a row is UNPLANNABLE below and holds the whole line;
        // in practice only a 0.00 row reaches this skip.
        if (dueC !== null && dueC <= 0) {
          copy.payment = null;
          copy.discount = null;
          copy.state = { status: 'SKIPPED_NO_DUE', overwritable: false, reason: SKIPPED_NO_DUE_REASON };
          copy.infoNote = copy.infoNote ? (copy.infoNote + '; ' + SKIPPED_NO_DUE_REASON) : SKIPPED_NO_DUE_REASON;
          copy.note = SKIPPED_NO_DUE_REASON;
          return;
        }
        // D4: already fully applied/ticked — exclude before allotment so they do not consume the cap.
        if (isAlreadyFullyApplied(copy) || (copy.state && copy.state.status === 'ALREADY_APPLIED')) {
          copy.state = { status: 'ALREADY_APPLIED', overwritable: false, reason: 'Already holds these values' };
          copy.payment = copy.amtDue;
          copy.note = copy.state.reason;
          return;
        }
        if (skipsCapConsumption(copy.state)) return;
        if (dueC === null) {
          copy.payment = null;
          copy.state = { status: 'UNPLANNABLE', overwritable: false, reason: copy.amtDueText ? ('Amt. Due "' + copy.amtDueText + '" could not be read') : 'Amt. Due could not be read' };
          copy.note = copy.state.reason;
          return;
        }
        const take = Math.min(left, dueC);
        if (take <= 0) {
          // D1: cap exhausted — info skip; must not cancel the group via decideGroup.
          copy.payment = null;
          copy.state = { status: 'CAP_NOT_REACHED', overwritable: false, reason: CAP_NOT_REACHED_REASON };
          copy.infoNote = copy.infoNote ? (copy.infoNote + '; ' + CAP_NOT_REACHED_REASON) : CAP_NOT_REACHED_REASON;
          copy.note = CAP_NOT_REACHED_REASON;
          copy.capExhausted = true;
          return;
        }
        copy.payment = dollars(take);
        copy.capLimited = take < dueC;
        copy.state = classifyRowState(copy.before, { payment: copy.payment, discount: copy.discount });
        left -= take;
      });
      if (left > 0) {
        totalLeftoverC += left;
        const first = out[ordered[0]];
        first.capLeftover = dollars(left);
        const tip = 'Unapplied cap leftover ' + formatUS(dollars(left));
        first.note = first.note ? (first.note + '; ' + tip) : tip;
      }
    });
    return { items: out, capLeftover: dollars(totalLeftoverC) };
  }

  /**
   * One plan item per planned row of a page plan, with everything Apply needs to recognise the row
   * again: page, NetSuite row number, Ref No., internal id, a details fingerprint and the Apply /
   * Payment / Disc. Taken values the Preview showed. Decisions follow the single-page rules.
   * Bare REF uses Amt. Due; REF=AMOUNT group caps are allotted across the group.
   */
  function buildMultiApplyPlan(pagePlan, scan, opts) {
    const items = [];
    pagePlan.pages.forEach(page => {
      const record = scan.pages.get(page.pageStart);
      page.items.forEach(pi => {
        const row = record.rows[pi.rowIndex];
        const amounts = plannedAmounts(pi.entry, row, opts);
        const before = { checked: !!row.checked, payment: row.payment || '', discount: row.discount || '' };
        const state = amounts.skip
          ? { status: 'SKIPPED_NO_DUE', overwritable: false, reason: amounts.reason }
          : amounts.reason
            ? { status: 'UNPLANNABLE', overwritable: false, reason: amounts.reason }
            : classifyRowState(before, { payment: amounts.payment, discount: amounts.discount });
        const requestedCap = (pi.entry.format === 'payment' && typeof pi.entry.payment === 'number') ? pi.entry.payment : null;
        const infoBits = [];
        if (amounts.skip) infoBits.push(amounts.reason);
        items.push({
          id: items.length, lineNo: pi.lineNo, raw: pi.entry.raw, pageStart: page.pageStart, rangeText: page.rangeText,
          lineIndex: pi.lineIndex, ref: row.ref, refKey: pi.refKey, internalId: row.internalId || '', type: row.type || '',
          amtDue: row.amtDue === undefined ? null : row.amtDue, amtDueText: row.amtDueText || '', detail: rowDetail(row),
          multiRow: pi.multiRow, groupSize: pi.groupSize, matchType: pi.matchType || null,
          payment: amounts.payment, discount: amounts.discount, requestedCap,
          before, state, overwrite: false, willWrite: false, note: amounts.skip ? amounts.reason : '',
          infoNote: infoBits.join('; '),
          capLeftover: 0, capLimited: false, capExhausted: false
        });
      });
    });
    const allotted = allotGroupCaps(items, opts);
    decideMultiWrites(allotted.items);
    let leftover = allotted.capLeftover || 0;
    if (leftover > 0 && allotted.items[0]) allotted.items[0].capLeftover = leftover;
    return allotted.items;
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
        const leftoverNote = (typeof it.capLeftover === 'number' && it.capLeftover > 0)
          ? ('Unapplied cap leftover ' + formatUS(it.capLeftover)) : '';
        const infoSkip = it.state.status === 'CAP_NOT_REACHED' || it.state.status === 'SKIPPED_NO_DUE';
        // Display only: every readable row of a multi-row line that decideGroup held (one row cannot be written),
        // including a row the cap did not reach; a zero-due row keeps its skip.
        it.lineHeld = list.length > 1 && !!decision.blockedReason && !it.willWrite && it.state.status !== 'ALREADY_APPLIED' && it.state.status !== 'SKIPPED_NO_DUE';
        if (it.willWrite) {
          it.note = leftoverNote;
        } else if (it.lineHeld && it.state.status === 'CAP_NOT_REACHED') {
          // Held takes precedence: nothing on the line is applied, so no row above used the reference amount.
          it.note = decision.blockedReason;
          it.infoNote = (it.infoNote || '').split('; ').filter(bit => bit && bit !== CAP_NOT_REACHED_REASON).join('; ');
        } else if (it.state.status === 'ALREADY_APPLIED' || infoSkip) {
          it.note = it.state.reason;
          if (infoSkip && it.state.reason && !(it.infoNote || '').includes(it.state.reason)) {
            it.infoNote = it.infoNote ? (it.infoNote + '; ' + it.state.reason) : it.state.reason;
          }
        } else {
          it.note = decision.blockedReason || it.state.reason;
        }
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

  /* ---------- Reconciliation analysis (Review & Reconciliation) ---------- */
  // Describes a planned cash application in accounting terms. Analysis only: it never decides,
  // changes or filters what is written. The safety state and write decision of every row are
  // copied through untouched; the reconciliation status is a separate dimension.
  //
  // Two separate reconciliations:
  // Cash:    actualCashReceived = totalApplied + unappliedAmount, so
  //          cashVariance = actualCashReceived - totalApplied - unappliedAmount is 0 when every
  //          cent received is accounted for. Unapplied cash is an outcome, not a variance.
  // Invoice: applicationAmount + discountTaken never exceeds invoiceAmountRemaining, and
  //          invoiceDifference = applicationAmount + discountTaken - invoiceAmountRemaining
  //          (0 settled, negative = balance left open; never positive). invoiceVariance is
  //          the sum over the applied rows, i.e. minus remainingInvoiceBalance.
  // All money is compared and summed in whole cents.

  const RECON_STATUS = Object.freeze({
    EXACT: 'EXACT',                             // settled: application + discount = balance
    SHORT_PAYMENT: 'SHORT_PAYMENT',             // the cash received did not cover the planned application
    OVERPAYMENT: 'OVERPAYMENT',                 // cash beyond the balance; the excess stays unapplied
    PARTIAL_APPLICATION: 'PARTIAL_APPLICATION', // a smaller amount was planned on purpose; balance stays open
    NOT_APPLIED: 'NOT_APPLIED',                 // matched, but the write decision leaves the row alone
    NEEDS_REVIEW: 'NEEDS_REVIEW',               // the data needed for the analysis is missing or invalid
    UNMATCHED: 'UNMATCHED',                     // an input line that matched no invoice row
    NO_APPLICATIONS: 'NO_APPLICATIONS'          // summary only: nothing to analyze
  });
  const DISCOUNT_STATUS = Object.freeze({ NONE: 'NONE', TAKEN: 'TAKEN', REVIEW: 'REVIEW' });
  const APPLICATION_KIND = Object.freeze({ NEW: 'NEW', EXISTING: 'EXISTING', NONE: 'NONE' });

  // A money input as whole cents: { ok, cents } or { ok: false, missing, reason }.
  // Numbers must be finite, not negative and whole cents; text must be a strict US amount.
  function moneyCents(value, label) {
    if (value === null || value === undefined || value === '') return { ok: false, missing: true, reason: `${label} is missing` };
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return { ok: false, missing: false, reason: `${label} is not a number` };
      if (value < 0) return { ok: false, missing: false, reason: `${label} is negative` };
      const c = Math.round(value * 100);
      if (Math.abs(value * 100 - c) > 1e-6) return { ok: false, missing: false, reason: `${label} has more than 2 decimals` };
      return { ok: true, cents: c };
    }
    if (typeof value === 'string') {
      if (/^\s*-/.test(value)) return { ok: false, missing: false, reason: `${label} is negative` };
      const parsed = parseAmountStrict(value);
      return parsed.ok ? { ok: true, cents: cents(parsed.value) } : { ok: false, missing: false, reason: `${label}: ${parsed.reason}` };
    }
    return { ok: false, missing: false, reason: `${label} is not an amount` };
  }

  const dollars = c => (c === null ? null : c / 100);
  const usd = c => `$${formatUS(c / 100)}`;

  // Discount Taken against Disc. Avail. A discount is never assumed valid just because it was entered.
  function discountReview(discC, availC, balanceC) {
    if (!discC) return { status: DISCOUNT_STATUS.NONE, reason: '' };
    if (availC === null) return { status: DISCOUNT_STATUS.REVIEW, reason: 'Disc. Avail. is blank or unreadable; the discount cannot be confirmed' };
    if (discC > availC) return { status: DISCOUNT_STATUS.REVIEW, reason: `Disc. Taken ${usd(discC)} exceeds Disc. Avail. ${usd(availC)}` };
    if (balanceC !== null && discC > balanceC) return { status: DISCOUNT_STATUS.REVIEW, reason: `Disc. Taken ${usd(discC)} exceeds the balance ${usd(balanceC)}` };
    return { status: DISCOUNT_STATUS.TAKEN, reason: `Within Disc. Avail. ${usd(availC)}` };
  }

  /**
   * Reconciliation analysis of a full application plan. Pure: inputs are never modified.
   *
   * input.actualCashReceived  cash received (number or US amount text); missing or invalid cash is
   *                           reported, never assumed.
   * input.rows                one per planned invoice row, from either the single-page or the
   *                           multi-page plan, in plan order:
   *   { id, lineNo, raw, page, lineIndex, invoice, type, date, originalAmount, invoiceAmountRemaining,
   *     discountAvailable, requestedAmount, discountTaken,
   *     write: { willWrite, safetyStatus, overwrite, note } }
   *   requestedAmount is the amount the line asks for (REF=AMOUNT); null for a bare REF, which applies the full Amt. Due.
   * input.unmatched           input lines that matched no row: { lineNo, raw, invoice, amount, discount, safetyStatus, reason }
   *
   * Cash is allotted to the rows that end up applied (written now, or already holding the planned
   * values), in plan order: each row takes up to its requestedAmount. Of that, at most the balance
   * less the discount is applied; the rest of the row's share is unapplied cash (OVERPAYMENT: the
   * line itself asked for more than the balance). A row whose share falls short of what it could
   * absorb is SHORT_PAYMENT; a row that got all it asked for but asked for less than the balance is
   * PARTIAL_APPLICATION. Excess on one row is never moved to another. Cash no row asked for is
   * unapplied at cash level only; the rows it came with stay as they are.
   */
  function analyzeApplication(input) {
    const src = input || {};
    const cash = moneyCents(src.actualCashReceived, 'Actual cash received');
    const cashInputStatus = cash.ok ? 'OK' : cash.missing ? 'NOT_PROVIDED' : 'INVALID';
    let cashLeft = cash.ok ? cash.cents : null;
    // Per-row working figures in cents, kept apart from the returned rows.
    const calcs = [];

    const rows = (src.rows || []).map((r, i) => {
      const w = r.write || {};
      const write = { willWrite: !!w.willWrite, safetyStatus: w.safetyStatus || '', overwrite: !!w.overwrite, note: w.note || '' };
      const kind = write.willWrite ? APPLICATION_KIND.NEW
        : write.safetyStatus === 'ALREADY_APPLIED' ? APPLICATION_KIND.EXISTING : APPLICATION_KIND.NONE;
      const balance = moneyCents(r.invoiceAmountRemaining, 'Amt. Due');
      const requested = moneyCents(r.requestedAmount, 'Planned amount');
      const disc = r.discountTaken === null || r.discountTaken === undefined ? { ok: true, cents: 0 } : moneyCents(r.discountTaken, 'Disc. Taken');
      const avail = moneyCents(r.discountAvailable, 'Disc. Avail.');
      const orig = moneyCents(r.originalAmount, 'Orig. Amt.');
      const balanceC = balance.ok ? balance.cents : null;
      const discC = disc.ok ? disc.cents : null;
      const discount = disc.ok ? discountReview(discC, avail.ok ? avail.cents : null, balanceC)
        : { status: DISCOUNT_STATUS.REVIEW, reason: disc.reason };

      const out = {
        id: r.id === undefined ? null : r.id, lineNo: r.lineNo === undefined ? null : r.lineNo, raw: r.raw || '',
        page: r.page === undefined ? null : r.page, lineIndex: r.lineIndex === undefined ? null : r.lineIndex,
        invoice: r.invoice || '', type: r.type || '', date: r.date || '',
        originalAmount: dollars(orig.ok ? orig.cents : null),
        invoiceAmountRemaining: dollars(balanceC),
        discountAvailable: dollars(avail.ok ? avail.cents : null),
        discountTaken: dollars(discC),
        requestedAmount: dollars(requested.ok ? requested.cents : null),
        cashAllotted: null, applicationAmount: null, unappliedAmount: null, shortAmount: null,
        remainingInvoiceBalance: null, invoiceDifference: null,
        applicationKind: kind, safetyStatus: write.safetyStatus,
        reconStatus: '', discountStatus: discount.status, needsReview: false, remarks: '', reasons: [],
        write
      };

      if (kind === APPLICATION_KIND.NONE) {
        out.reconStatus = RECON_STATUS.NOT_APPLIED;
        out.remarks = write.note || 'Not applied';
        calcs[i] = { counted: false, held: requested.ok ? requested.cents : 0 };
        return out;
      }
      const problems = [];
      if (!balance.ok) problems.push(balance.reason);
      if (!requested.ok) problems.push(requested.reason);
      if (!disc.ok) problems.push(disc.reason);
      else if (balance.ok && discC > balanceC) problems.push(`Disc. Taken ${usd(discC)} exceeds the balance ${usd(balanceC)}`);
      if (problems.length) {
        Object.assign(out, { reconStatus: RECON_STATUS.NEEDS_REVIEW, needsReview: true, remarks: problems.join('; '), reasons: problems });
        calcs[i] = { counted: false, held: requested.ok ? requested.cents : 0 };
        return out;
      }

      const absorbable = Math.min(requested.cents, balanceC - discC);
      const share = cashLeft === null ? requested.cents : Math.min(requested.cents, cashLeft);
      if (cashLeft !== null) cashLeft -= share;
      const applied = Math.min(share, absorbable);
      const unapplied = share - applied;
      const short = absorbable - applied;
      const remaining = balanceC - applied - discC;
      Object.assign(out, {
        cashAllotted: dollars(share), applicationAmount: dollars(applied), unappliedAmount: dollars(unapplied),
        shortAmount: dollars(short), remainingInvoiceBalance: dollars(remaining), invoiceDifference: dollars(applied + discC - balanceC)
      });
      calcs[i] = { counted: true, held: 0, balance: balanceC, discount: discC, applied, unapplied, short, remaining };

      if (short > 0) {
        out.reconStatus = RECON_STATUS.SHORT_PAYMENT;
        out.remarks = `Partial/Short payment – ${usd(remaining)} remains open (Payment Received ${usd(short)} short)`;
      } else if (unapplied > 0) {
        out.reconStatus = RECON_STATUS.OVERPAYMENT;
        out.remarks = `Overpayment – ${usd(unapplied)} unapplied`;
      } else if (remaining > 0) {
        out.reconStatus = RECON_STATUS.PARTIAL_APPLICATION;
        out.remarks = `Partial/Short payment – ${usd(remaining)} remains open`;
      } else {
        out.reconStatus = RECON_STATUS.EXACT;
        out.remarks = discC ? `No variance – settled with ${usd(discC)} discount` : 'No variance';
      }
      if (discount.status === DISCOUNT_STATUS.REVIEW) {
        out.needsReview = true;
        out.reasons = [discount.reason];
        out.remarks += `; ${discount.reason}`;
      }
      return out;
    });

    let unmatchedC = 0;
    const unmatched = (src.unmatched || []).map(u => {
      const amount = moneyCents(u.amount, 'Amount');
      const discount = moneyCents(u.discount, 'Discount');
      if (amount.ok) unmatchedC += amount.cents;
      return {
        lineNo: u.lineNo === undefined ? null : u.lineNo, raw: u.raw || '', invoice: u.invoice || '',
        statedAmount: dollars(amount.ok ? amount.cents : null), statedDiscount: dollars(discount.ok ? discount.cents : null), applicationAmount: 0,
        safetyStatus: u.safetyStatus || '', reconStatus: RECON_STATUS.UNMATCHED, needsReview: true,
        remarks: u.reason || 'No matching invoice row'
      };
    });

    const counted = calcs.filter(c => c.counted);
    const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
    const totalInvoiceBalanceC = sum(counted, c => c.balance);
    const totalAppliedC = sum(counted, c => c.applied);
    const totalDiscountsC = sum(counted, c => c.discount);
    const shortC = sum(counted, c => c.short);
    const rowExcessC = sum(counted, c => c.unapplied);
    const heldC = sum(calcs, c => c.held);
    const notApplied = rows.filter(r => r.reconStatus === RECON_STATUS.NOT_APPLIED);
    const review = rows.filter(r => r.needsReview);

    const remainingC = sum(counted, c => c.remaining);
    let unappliedC = null, overpaymentC = null, cashVarianceC = null;
    if (cash.ok) {
      unappliedC = cash.cents - totalAppliedC;
      overpaymentC = rowExcessC + Math.max(0, cashLeft - unmatchedC - heldC);
      cashVarianceC = cash.cents - totalAppliedC - unappliedC;
    }

    // Cash reconciliation: where the cash received went. Open invoice balances do not affect it.
    const cashReasons = [];
    let cashStatus, cashRemarks;
    if (!cash.ok) {
      cashReasons.push(cash.reason);
    } else if (shortC > 0 && overpaymentC > 0) {
      cashReasons.push('Short and over at the same time');
    } else if (unappliedC > overpaymentC) {
      cashReasons.push(`${usd(unappliedC - overpaymentC)} unapplied belongs to lines that matched no invoice or were not applied`);
    }
    if (cashReasons.length) {
      cashStatus = RECON_STATUS.NEEDS_REVIEW;
      cashRemarks = cashReasons.join('; ');
    } else if (shortC > 0) {
      cashStatus = RECON_STATUS.SHORT_PAYMENT;
      cashRemarks = `Partial/Short payment – Payment Received ${usd(shortC)} short`;
    } else if (overpaymentC > 0) {
      cashStatus = RECON_STATUS.OVERPAYMENT;
      cashRemarks = `Overpayment – ${usd(overpaymentC)} unapplied`;
    } else {
      cashStatus = RECON_STATUS.EXACT;
      cashRemarks = 'No variance';
    }

    const reasons = cashReasons.slice();
    if (review.length) reasons.push(`${review.length} invoice row${review.length === 1 ? '' : 's'} need review`);
    if (notApplied.length) reasons.push(`${notApplied.length} matched row${notApplied.length === 1 ? ' is' : 's are'} not applied`);
    if (unmatched.length) reasons.push(`${unmatched.length} line${unmatched.length === 1 ? '' : 's'} matched no invoice`);

    let status, remarks;
    if (!rows.length && !unmatched.length) {
      status = RECON_STATUS.NO_APPLICATIONS;
      remarks = 'Nothing to reconcile';
    } else if (reasons.length) {
      status = RECON_STATUS.NEEDS_REVIEW;
      remarks = reasons.join('; ');
    } else {
      status = cashStatus;
      remarks = cashRemarks;
    }

    const countBy = (list, key) => list.reduce((m, x) => { m[x[key]] = (m[x[key]] || 0) + 1; return m; }, {});
    const summary = {
      status, remarks, reasons,
      // Cash reconciliation
      cashInputStatus, cashStatus, cashRemarks,
      actualCashReceived: dollars(cash.ok ? cash.cents : null),
      totalApplied: dollars(totalAppliedC),
      unappliedAmount: dollars(unappliedC),
      cashVariance: dollars(cashVarianceC),
      shortPaymentAmount: dollars(shortC),
      overpaymentAmount: dollars(overpaymentC),
      // Invoice reconciliation
      totalInvoices: counted.length,
      totalInvoiceBalance: dollars(totalInvoiceBalanceC),
      totalDiscounts: dollars(totalDiscountsC),
      remainingInvoiceBalance: dollars(remainingC),
      invoiceVariance: dollars(totalAppliedC + totalDiscountsC - totalInvoiceBalanceC),
      // Exceptions and counts
      unmatchedCount: unmatched.length,
      unmatchedAmount: dollars(unmatchedC),
      notAppliedCount: notApplied.length,
      needsReviewCount: review.length,
      newApplicationCount: rows.filter(r => r.applicationKind === APPLICATION_KIND.NEW).length,
      existingApplicationCount: rows.filter(r => r.applicationKind === APPLICATION_KIND.EXISTING).length,
      byStatus: countBy(rows.concat(unmatched), 'reconStatus')
    };

    return { rows, unmatched, summary };
  }

  /* ---------- Payment Received ---------- */
  // Payment Received is ApplyFast's own field for the cash actually received from the customer, and the
  // single source of the cash amount. It is optional; an invalid amount blocks Review. Apply enters it
  // as NetSuite's Payment Amount; it is never read from NetSuite.

  /**
   * Payment Received text -> { status: 'EMPTY' | 'VALID' | 'INVALID', value, reason, actualCashReceived }.
   * actualCashReceived is what analyzeApplication receives: null when empty, the amount when valid,
   * and the text as entered when invalid, so the analysis reports INVALID instead of using zero.
   */
  function parsePaymentReceived(input) {
    const text = String(input == null ? '' : input).trim();
    if (!text) return { status: 'EMPTY', value: null, reason: '', actualCashReceived: null };
    if (/^\$?\s*-/.test(text)) return { status: 'INVALID', value: null, reason: 'Payment Received cannot be negative', actualCashReceived: text };
    const parsed = parseAmountStrict(text);
    if (!parsed.ok) return { status: 'INVALID', value: null, reason: parsed.reason, actualCashReceived: text };
    return { status: 'VALID', value: parsed.value, reason: '', actualCashReceived: parsed.value };
  }

  /**
   * The analyzeApplication input for a Preview (a scan, or matchLoadedPage's one-page scan). One row per plan item, in plan order, with
   * the read-only details of its scanned row; one unmatched entry per input line that was not planned
   * (not found, partial or multiple match, held across pages, invalid or duplicate).
   * Reads only: the match, the plan, its items and the scan are not modified.
   */
  function multiPlanAnalysisInput({ match, plan, items, scan, invalid, actualCashReceived }) {
    const rows = (items || []).map(it => {
      const page = scan && scan.pages.get(it.pageStart);
      const row = (page && page.rows.find(r => r.lineIndex === it.lineIndex)) || {};
      return {
        id: it.id, lineNo: it.lineNo, raw: it.raw, page: it.pageStart, lineIndex: it.lineIndex, invoice: it.ref, type: it.type,
        date: row.date, originalAmount: row.origAmt, invoiceAmountRemaining: row.amtDue, discountAvailable: row.discAvail,
        requestedAmount: it.payment, discountTaken: it.discount,
        write: { willWrite: it.willWrite, safetyStatus: it.state.status, overwrite: it.overwrite, note: it.note }
      };
    });
    const entries = new Map(((match && match.results) || []).map(r => [r.entry.lineNo, r.entry]));
    const line = (s, entry) => ({
      lineNo: s.lineNo, raw: s.raw, invoice: entry.ref || '', amount: entry.payment === undefined ? null : entry.payment,
      discount: entry.discount === undefined ? null : entry.discount, safetyStatus: s.status || '', reason: s.reason || ''
    });
    const notPlanned = ((plan && plan.skipped) || []).concat((plan && plan.held) || []).map(s => line(s, entries.get(s.lineNo) || {}));
    const unmatched = notPlanned.concat((invalid || []).map(e => line(e, e))).sort((a, b) => a.lineNo - b.lineNo);
    return { rows, unmatched, actualCashReceived: actualCashReceived === undefined ? null : actualCashReceived };
  }

  /**
   * The final write plan of a Preview (either mode), limited by Payment Received.
   * input: { match, plan, items, scan, invalid, actualCashReceived } as for multiPlanAnalysisInput.
   * Returns { cashInputStatus, applyBlocked, blockedReason, items, analysis }:
   *   NOT_PROVIDED  Payment Received was empty (optional); Apply is not blocked; items are
   *                 unchanged copies; paymentAmountAuto is the sum of planned applied amounts.
   *   INVALID       Apply is blocked until Payment Received is corrected; items are unchanged copies.
   *   OK            every item that will be written carries analysis.applicationAmount as its payment
   *                 (requested, balance less discount and remaining cash, in plan order), with the plan's
   *                 amount kept as requestedAmount. A row with no cash left or no application amount is
   *                 not written. Nothing becomes writable that the plan does not write, and a line whose
   *                 rows cannot all be written writes none of them (the analysis is then repeated without
   *                 that line, so its cash stays unapplied instead of moving to it).
   * The plan items are never modified; analysis is the analysis of the returned write plan.
   */
  function buildCashWritePlan(input) {
    const src = input || {};
    const items = src.items || [];
    const copy = it => Object.assign({}, it);
    const held = new Map();
    for (;;) {
      const masked = items.map(it => (it.willWrite && held.has(it.lineNo) ? Object.assign(copy(it), { willWrite: false, cashHeld: true, note: held.get(it.lineNo) }) : it));
      const analysis = analyzeApplication(multiPlanAnalysisInput(Object.assign({}, src, { items: masked })));
      const status = analysis.summary.cashInputStatus;
      if (status === 'INVALID') {
        return {
          cashInputStatus: status, applyBlocked: true,
          blockedReason: 'Correct Payment Received before applying',
          items: items.map(copy), analysis
        };
      }
      if (status === 'NOT_PROVIDED') {
        // Payment Received is optional: Apply is not blocked; R&R keeps NOT_PROVIDED.
        // Callers fill NetSuite Payment Amount with the sum of planned applied amounts.
        return {
          cashInputStatus: status, applyBlocked: false, blockedReason: '',
          items: items.map(copy), analysis,
          paymentAmountAuto: items.filter(it => it.willWrite).reduce((sum, it) => sum + (typeof it.payment === 'number' ? it.payment : 0), 0)
        };
      }
      const byId = new Map(analysis.rows.map(r => [r.id, r]));
      const out = masked.map(it => {
        if (!it.willWrite) return copy(it);
        const row = byId.get(it.id);
        const amount = row ? row.applicationAmount : null;
        if (amount === null) return Object.assign(copy(it), { willWrite: false, cashHeld: true, note: `Not written: ${row ? row.remarks : 'no analysis'}` });
        if (cents(amount) <= 0) return Object.assign(copy(it), { willWrite: false, cashHeld: true, note: 'Not written: no Payment Received left for this row' });
        return Object.assign(copy(it), { payment: amount, requestedAmount: it.payment, cashLimited: cents(amount) !== cents(it.payment) });
      });
      let changed = false;
      out.forEach((it, i) => {
        if (!masked[i].willWrite || it.willWrite || held.has(it.lineNo)) return;
        const siblings = out.filter((o, k) => o.lineNo === it.lineNo && k !== i && o.willWrite);
        if (siblings.length) {
          held.set(it.lineNo, `Not written: another row of line ${it.lineNo} cannot be written with the Payment Received; none of this line's rows written`);
          changed = true;
        }
      });
      if (!changed) return { cashInputStatus: status, applyBlocked: false, blockedReason: '', items: out, analysis };
    }
  }

  /* ---------- Review & Reconciliation results ---------- */
  const EXCEPTION_STATUSES = [RECON_STATUS.SHORT_PAYMENT, RECON_STATUS.OVERPAYMENT, RECON_STATUS.NEEDS_REVIEW, RECON_STATUS.NOT_APPLIED, RECON_STATUS.UNMATCHED];
  const isReconException = r => r.needsReview || EXCEPTION_STATUSES.includes(r.reconStatus);
  // Shown to users as one "Partial/Short payment" finding: less was applied than the invoice balance.
  const isPartialShort = r => r.reconStatus === RECON_STATUS.PARTIAL_APPLICATION || r.reconStatus === RECON_STATUS.SHORT_PAYMENT;

  // The remittance line as the report shows it: Payment, Discount and Gross Payment (payment + discount).
  function remittanceAmounts(payment, discount) {
    if (payment === null || payment === undefined) return { gross: null, discount: null, payment: null };
    const discC = discount ? cents(discount) : 0;
    return { gross: dollars(cents(payment) + discC), discount: dollars(discC), payment };
  }

  /**
   * The report's Difference for a result row (the Cash Application Report template), kept apart from
   * invoiceDifference: the amount of the row's cash exception, signed as in the template.
   *   EXACT                                    0
   *   OVERPAYMENT                              - unappliedAmount (cash beyond the balance, left unapplied)
   *   PARTIAL_APPLICATION / SHORT_PAYMENT      + remainingInvoiceBalance (balance left open)
   *   UNMATCHED                                - the line's amount (unidentified cash); null without one
   *   NOT_APPLIED, Cap used row (isCapUsedRow) + remainingInvoiceBalance (the whole Amt. Due stays open)
   *   NOT_APPLIED / NEEDS_REVIEW               null: nothing was applied, so there is no difference to
   *                                            report; the row is listed as a review finding instead.
   */
  function reportDifference(r) {
    const neg = v => (v === null || v === undefined ? null : dollars(-cents(v)));
    if (r.reconStatus === RECON_STATUS.EXACT) return 0;
    if (r.reconStatus === RECON_STATUS.OVERPAYMENT) return neg(r.unappliedAmount);
    if (isPartialShort(r)) return r.remainingInvoiceBalance;
    if (r.reconStatus === RECON_STATUS.UNMATCHED) return neg(r.requestedAmount);
    if (isCapUsedRow(r)) return r.remainingInvoiceBalance;
    return null;
  }

  // A Cap used result row: matched on a REF=amount or PO line that is applied, but allotted nothing because the rows
  // above used the amount (CAP_NOT_REACHED on a line that is not held). The report and the Review show it as an open
  // invoice: 0.00 paid and applied, the whole Amt. Due remaining and as the Difference. Writes are unchanged.
  const isCapUsedRow = r => r.rowType === 'INVOICE' && !!r.write && r.write.safetyStatus === 'CAP_NOT_REACHED' && !r.write.lineHeld &&
    r.invoiceAmountRemaining !== null && r.invoiceAmountRemaining !== undefined;

  /**
   * Report figures over the result rows, all taken from reportDifference and the row amounts:
   * exceptions { overpayment, unmatched, partialShort, total } (sums of reportDifference), reviewFindings
   * (matched rows not applied or needing review), exceptionCount, and totals of every report column.
   */
  function reportSummary(rows) {
    const sumC = (list, f) => dollars(list.reduce((s, r) => { const v = f(r); return v === null || v === undefined ? s : s + cents(v); }, 0));
    const diff = list => sumC(list, r => r.reportDifference);
    const by = status => rows.filter(r => r.reconStatus === status);
    return {
      exceptions: {
        overpayment: diff(by(RECON_STATUS.OVERPAYMENT)),
        unmatched: diff(by(RECON_STATUS.UNMATCHED)),
        partialShort: diff(rows.filter(r => isPartialShort(r) || isCapUsedRow(r))),
        total: diff(rows)
      },
      reviewFindings: rows.filter(r => r.rowType === 'INVOICE' && (r.needsReview || r.reconStatus === RECON_STATUS.NOT_APPLIED || r.reconStatus === RECON_STATUS.NEEDS_REVIEW)).length,
      exceptionCount: rows.filter(r => r.exception).length,
      totals: {
        gross: sumC(rows, r => r.remittance.gross),
        discount: sumC(rows, r => r.remittance.discount),
        payment: sumC(rows, r => r.remittance.payment),
        originalAmount: sumC(rows, r => r.originalAmount),
        invoiceAmountRemaining: sumC(rows, r => r.invoiceAmountRemaining),
        applicationAmount: sumC(rows, r => r.applicationAmount),
        discountTaken: sumC(rows, r => r.appliedDiscount),
        remainingInvoiceBalance: sumC(rows, r => r.remainingInvoiceBalance),
        reportDifference: diff(rows)
      }
    };
  }

  // Presentation filters over the result rows, in display order. Filtering never changes what Apply writes.
  const RESULT_FILTERS = Object.freeze([
    { key: 'ALL', label: 'All', test: () => true },
    { key: 'WILL_WRITE', label: 'Will apply', test: r => r.write.willWrite },
    { key: 'EXCEPTIONS', label: 'Exceptions', test: isReconException },
    { key: 'EXACT', label: 'Exact', test: r => r.reconStatus === RECON_STATUS.EXACT },
    { key: 'PARTIAL_SHORT', label: 'Partial/Short payment', test: isPartialShort },
    { key: 'OVERPAYMENT', label: 'Overpayment', test: r => r.reconStatus === RECON_STATUS.OVERPAYMENT },
    { key: 'NOT_APPLIED', label: 'Not applied', test: r => r.reconStatus === RECON_STATUS.NOT_APPLIED },
    { key: 'UNMATCHED', label: 'Unmatched', test: r => r.reconStatus === RECON_STATUS.UNMATCHED },
    { key: 'NEEDS_REVIEW', label: 'Needs review', test: r => r.needsReview || r.reconStatus === RECON_STATUS.NEEDS_REVIEW },
    { key: 'ALREADY_APPLIED', label: 'Already applied', test: r => r.safetyStatus === 'ALREADY_APPLIED' }
  ].map(f => Object.freeze(f)));

  /**
   * The Review & Reconciliation results of a Preview (This page only or All pages): one normalized row
   * per planned invoice row (plan order) followed by one per unmatched input line (line order), and the
   * analysis summary. Consumes buildCashWritePlan's output and nothing else; inputs are not modified.
   *   rows[].rowType          'INVOICE' or 'UNMATCHED'
   *   rows[].write            the final write plan's decision for the row: { willWrite, safetyStatus, overwrite,
   *                           overwritable, note, cashLimited, cashHeld, payment, discount } (payment and discount
   *                           are what Apply writes, null when not written). Unmatched rows are never written.
   *   rows[].reference        the remittance reference alone (remittanceReference): no amounts or separators
   *   rows[].remittance       { gross, discount, payment } of the input line (remittanceAmounts)
   *   rows[].appliedDiscount  the discount of the NetSuite application; null when nothing is applied
   *   rows[].reportDifference the report's Difference (reportDifference); invoiceDifference is unchanged
   *                           (a Cap used row, isCapUsedRow, shows 0.00 paid and applied and its Amt. Due open)
   *   summary.report          reportSummary(rows): exception figures and column totals for the report
   * Amounts and statuses are analyzeApplication's, so applicationAmount of a written row equals the
   * Payment Apply writes. filterCounts holds the number of rows each RESULT_FILTERS entry shows.
   */
  function buildReconciliationResults(writePlan) {
    const src = writePlan || {};
    const analysis = src.analysis || { rows: [], unmatched: [], summary: {} };
    const items = new Map((src.items || []).map(it => [it.id, it]));
    const invoiceRows = analysis.rows.map(r => {
      const it = items.get(r.id) || {};
      const state = it.state || {};
      const row = Object.assign({ rowType: 'INVOICE' }, r, {
        reasons: r.reasons.slice(),
        write: {
          willWrite: !!it.willWrite, safetyStatus: state.status || r.safetyStatus, overwrite: !!it.overwrite,
          overwritable: !!state.overwritable, note: it.note || '', cashLimited: !!it.cashLimited, cashHeld: !!it.cashHeld,
          lineHeld: !!it.lineHeld, payment: it.willWrite ? it.payment : null, discount: it.willWrite ? (it.discount || null) : null
        }
      });
      if (isCapUsedRow(row)) {
        // Report and Review figures only: nothing paid or applied, so the whole Amt. Due stays open.
        Object.assign(row, {
          requestedAmount: 0, discountTaken: 0, applicationAmount: 0, remainingInvoiceBalance: row.invoiceAmountRemaining,
          invoiceDifference: dollars(-cents(row.invoiceAmountRemaining))
        });
      }
      row.exception = isReconException(row);
      row.reference = remittanceReference(row.raw);
      row.remittance = remittanceAmounts(row.requestedAmount, row.discountTaken);
      row.appliedDiscount = row.applicationAmount === null ? null : row.discountTaken;
      row.reportDifference = reportDifference(row);
      return row;
    });
    const unmatchedRows = analysis.unmatched.map(u => {
      const row = {
        rowType: 'UNMATCHED', id: null, lineNo: u.lineNo, raw: u.raw, page: null, lineIndex: null, invoice: '', type: '', date: '',
        originalAmount: null, invoiceAmountRemaining: null, discountAvailable: null, discountTaken: null,
        requestedAmount: u.statedAmount, applicationAmount: 0, remainingInvoiceBalance: null, invoiceDifference: null,
        cashAllotted: null, unappliedAmount: null, shortAmount: null,
        applicationKind: APPLICATION_KIND.NONE, safetyStatus: u.safetyStatus, reconStatus: u.reconStatus,
        discountStatus: DISCOUNT_STATUS.NONE, needsReview: u.needsReview, remarks: u.remarks, reasons: [u.remarks],
        write: {
          willWrite: false, safetyStatus: u.safetyStatus, overwrite: false, overwritable: false, note: u.remarks,
          cashLimited: false, cashHeld: false, lineHeld: false, payment: null, discount: null
        },
        exception: true,
        reference: remittanceReference(u.raw),
        remittance: remittanceAmounts(u.statedAmount, u.statedDiscount),
        appliedDiscount: null
      };
      row.reportDifference = reportDifference(row);
      return row;
    });
    const rows = invoiceRows.concat(unmatchedRows);
    const filterCounts = {};
    RESULT_FILTERS.forEach(f => { filterCounts[f.key] = rows.filter(f.test).length; });
    const summary = Object.assign({}, analysis.summary, {
      reasons: (analysis.summary.reasons || []).slice(),
      byStatus: Object.assign({}, analysis.summary.byStatus),
      report: reportSummary(rows)
    });
    return {
      cashInputStatus: src.cashInputStatus || summary.cashInputStatus || '', applyBlocked: !!src.applyBlocked,
      blockedReason: src.blockedReason || '', rows, summary, filterCounts
    };
  }

  // The rows a filter shows, as a new array; an unknown key shows every row. results is not modified.
  function filterReconciliationResults(results, key) {
    const filter = RESULT_FILTERS.find(f => f.key === key) || RESULT_FILTERS[0];
    return ((results && results.rows) || []).filter(filter.test);
  }

  /**
   * Results after Apply: the reconciliation rows with the outcome of each row's write and read-back.
   * items are the applied write-plan items carrying result { status, reason } and actual values.
   * Unmatched lines were never written: HELD for a held line (HELD_LINE_STATUSES), SKIPPED otherwise.
   * Result statuses stay separate from reconStatus. Returns { rows, counts }; inputs are not modified.
   */
  // After Apply, the result status of a row Apply did not write (display only): Already applied, Held for every
  // readable row of a held line, Cap used, Skipped for a zero-due row, otherwise Blocked by the row's state.
  function unwrittenResultStatus(it) {
    const status = it && it.state ? it.state.status : '';
    if (status === 'ALREADY_APPLIED') return 'ALREADY';
    if (it.lineHeld) return 'HELD';
    if (status === 'CAP_NOT_REACHED') return 'CAP_USED';
    if (status === 'SKIPPED_NO_DUE') return 'SKIPPED';
    return 'BLOCKED';
  }

  function reconciliationApplyResults(results, items) {
    const byId = new Map((items || []).map(it => [it.id, it]));
    const rows = ((results && results.rows) || []).map(r => {
      if (r.rowType === 'UNMATCHED') {
        const status = HELD_LINE_STATUSES.includes(r.safetyStatus) ? 'HELD' : 'SKIPPED';
        return Object.assign({}, r, { result: { status, reason: r.remarks }, actual: null });
      }
      const it = byId.get(r.id) || {};
      const result = it.result ? { status: it.result.status, reason: it.result.reason || '' } : { status: 'NOT_WRITTEN', reason: 'No Apply result' };
      return Object.assign({}, r, { result, actual: it.actual ? Object.assign({}, it.actual) : null });
    });
    const counts = {};
    rows.forEach(r => { counts[r.result.status] = (counts[r.result.status] || 0) + 1; });
    return { rows, counts };
  }

  /* ---------- Excel reconciliation export ---------- */
  const RECONCILIATION_EXPORT_FILE = 'ApplyFast-Reconciliation.xlsx';
  const REPORT_TITLE = 'Cash Application Report';
  const REPORT_BRAND = 'ApplyFast | NetSuite Cash Application Assistant';
  const REPORT_GENERATED = 'Generated by ApplyFast  |  applyfast.store';
  const REPORT_FOOTER = 'ApplyFast — Cash Application Report  |  applyfast.store';
  const REPORT_NOTE = 'Generated from ApplyFast reconciliation results for review and documentation.';
  const REPORT_URL = 'https://applyfast.store/';
  // Report labels of a row's reconStatus and of its NetSuite write (write plan before Apply, result after).
  const REPORT_STATUS_LABELS = Object.freeze({
    EXACT: 'Exact', PARTIAL_APPLICATION: 'Partial/Short payment', SHORT_PAYMENT: 'Partial/Short payment', OVERPAYMENT: 'Overpayment',
    NOT_APPLIED: 'Not applied', NEEDS_REVIEW: 'Needs review', UNMATCHED: 'Unmatched'
  });
  const REPORT_WRITE_LABELS = Object.freeze({
    WILL_WRITE: 'Will apply', NOT_WRITTEN: 'Not written', NEVER_WRITTEN: 'Never written',
    APPLIED: 'Applied', ADJUSTED: 'Adjusted', NOT_CONFIRMED: 'Not confirmed', CHANGED: 'Changed since Preview', MOVED: 'Row moved',
    HELD: 'Held', CAP_USED: 'Not applied (cap used)', BLOCKED: 'Blocked', ALREADY: 'Already applied', SKIPPED: 'Skipped',
    ERROR: 'Error while writing'
  });
  // A row that can never be written (unmatched, or matched without an amount) stays NEVER_WRITTEN after Apply too.
  function reportWrite(r) {
    if (r.rowType === 'UNMATCHED' || r.safetyStatus === 'UNPLANNABLE') return 'NEVER_WRITTEN';
    if (r.result) return r.result.status;
    if (r.safetyStatus === 'CAP_NOT_REACHED' && !(r.write && r.write.lineHeld)) return 'CAP_USED';
    return r.write && r.write.willWrite ? 'WILL_WRITE' : 'NOT_WRITTEN';
  }
  const reportLabel = (labels, key) => (key ? labels[key] || key : null);
  // The report flags every Partial/Short payment finding (partial application or short payment) as an exception.
  const reportException = r => !!(r.exception || isPartialShort(r));
  // The Reconciliation sheet's detail columns (Cash Application Report template), in three groups:
  // what the remittance says, what is applied in NetSuite, and what the review found.
  const REPORT_COLUMNS = Object.freeze([
    { group: 'REMITTANCE', header: 'Line', width: 6, format: 'rInt', value: r => r.lineNo },
    { group: 'REMITTANCE', header: 'Reference', width: 18, format: 'rText', value: r => r.reference },
    { group: 'REMITTANCE', header: 'Gross Payment', width: 13.5, format: 'rMoney', value: r => r.remittance && r.remittance.gross },
    { group: 'REMITTANCE', header: 'Discount', width: 11, format: 'rMoney', value: r => r.remittance && r.remittance.discount },
    { group: 'REMITTANCE', header: 'Payment', width: 13.5, format: 'rMoney', value: r => r.remittance && r.remittance.payment },
    { group: 'NETSUITE APPLICATION', header: 'Invoice', width: 15, format: 'rText', value: r => r.invoice },
    { group: 'NETSUITE APPLICATION', header: 'Original Amount', width: 13.5, format: 'rMoney', value: r => r.originalAmount },
    { group: 'NETSUITE APPLICATION', header: 'Amount Due', width: 13.5, format: 'rMoney', value: r => r.invoiceAmountRemaining },
    { group: 'NETSUITE APPLICATION', header: 'Applied', width: 12.5, format: 'rMoney', value: r => (r.rowType === 'UNMATCHED' ? null : r.applicationAmount) },
    { group: 'NETSUITE APPLICATION', header: 'Discount Taken', width: 12.5, format: 'rMoney', value: r => r.appliedDiscount },
    { group: 'NETSUITE APPLICATION', header: 'Remaining Balance', width: 14.5, format: 'rMoney', value: r => r.remainingInvoiceBalance },
    { group: 'NETSUITE APPLICATION', header: 'Write', width: 13.5, format: 'rText', value: r => reportLabel(REPORT_WRITE_LABELS, reportWrite(r)) },
    { group: 'REVIEW & ANALYSIS', header: 'Status', width: 19, format: 'rText', value: r => reportLabel(REPORT_STATUS_LABELS, r.reconStatus) },
    { group: 'REVIEW & ANALYSIS', header: 'Difference\n(+ open / − unapplied)', width: 19, format: 'rMoney', kind: 'difference', value: r => r.reportDifference },
    { group: 'REVIEW & ANALYSIS', header: 'Exception', width: 10.5, format: 'rText', kind: 'exception', value: r => (reportException(r) ? 'Yes' : 'No') },
    {
      group: 'REVIEW & ANALYSIS', header: 'Remarks', width: 44, format: 'rWrap',
      value: r => (r.result && r.result.reason && r.result.reason !== r.remarks ? `${r.remarks}; Write: ${r.result.reason}` : r.remarks)
    }
  ].map(c => Object.freeze(c)));
  const REPORT_HEADER_ROW = 11;
  // The first column of each group, where the grid draws a group divider.
  const REPORT_GROUP_STARTS = REPORT_COLUMNS.map((c, i) => (i === 0 || REPORT_COLUMNS[i - 1].group !== c.group ? i : -1)).filter(i => i >= 0);

  // The report sheet: title, cash summary, exception tiles, grouped detail table, totals and footer.
  // Every figure is copied from results (summary.report holds the exception figures and totals).
  function reconciliationReportSheet(src, rows, applied) {
    const s = src.summary || {};
    const rep = s.report || { exceptions: {}, totals: {} };
    const ex = rep.exceptions || {};
    const tot = rep.totals || {};
    const W = REPORT_COLUMNS.length;
    const lines = [], merges = [], rowHeights = {}, hyperlinks = [];
    const blankRow = () => new Array(W).fill(null);
    const span = (row, from, to, value, format) => {
      for (let c = from; c <= to; c++) row[c] = { value: c === from ? value : null, format };
      if (to > from) merges.push(`${colName(from)}${lines.length + 1}:${colName(to)}${lines.length + 1}`);
    };
    const put = (row, height) => { lines.push(row); if (height) rowHeights[lines.length] = height; return lines.length; };
    // Group dividers: a medium edge on the left of each group's first column and on the right of the last column.
    const divided = row => row.map((cell, c) => {
      const edge = REPORT_GROUP_STARTS.includes(c) ? ':gs' : c === W - 1 ? ':ge' : '';
      return edge && cell && cell.format ? Object.assign({}, cell, { format: cell.format + edge }) : cell;
    });
    const blank = v => (v === undefined || v === '' ? null : v);
    const cashText = { NOT_PROVIDED: 'Not entered', INVALID: 'Invalid' }[src.cashInputStatus || s.cashInputStatus];
    const kpi = v => (blank(v) === null ? { value: cashText || 'n/a', format: 'kpiText' } : { value: v, format: 'kpiValue' });

    let r = blankRow(); span(r, 0, W - 1, REPORT_TITLE, 'rTitle'); put(r, 34);
    r = blankRow(); span(r, 0, 7, REPORT_BRAND, 'rBrand'); span(r, 8, W - 1, REPORT_GENERATED, 'rGenerated');
    hyperlinks.push({ ref: `I${lines.length + 1}`, url: REPORT_URL }); put(r, 20);
    r = blankRow(); span(r, 0, W - 1, `${applied ? 'After Apply' : 'Review before Apply'}  |  ${blank(s.remarks) || ''}`, 'rMeta'); put(r, 18);
    r = blankRow(); span(r, 0, W - 1, 'CASH SUMMARY', 'rBar'); put(r, 20);
    r = blankRow();
    span(r, 0, 1, 'Payment Received', 'kpiLabel'); r[2] = kpi(s.actualCashReceived);
    span(r, 4, 5, 'Total Applied', 'kpiLabel'); r[6] = kpi(s.totalApplied);
    span(r, 8, 9, 'Unapplied', 'kpiLabel'); r[10] = kpi(s.unappliedAmount);
    span(r, 12, 13, 'Cash Status', 'kpiLabel'); span(r, 14, W - 1, blank(s.cashRemarks), 'kpiNote');
    put(r, 28);
    put(blankRow(), 8);
    r = blankRow(); span(r, 0, W - 1, 'EXCEPTIONS & REVIEW FINDINGS', 'rBarAlt'); put(r, 20);
    r = blankRow();
    span(r, 0, 1, 'Unapplied Overpayment', 'warnLabel'); r[2] = { value: blank(ex.overpayment), format: 'warnValue' };
    span(r, 3, 4, 'Unmatched / Unidentified', 'badLabel'); r[5] = { value: blank(ex.unmatched), format: 'badValue' };
    span(r, 6, 7, 'Partial/Short Payments', 'warnLabel'); r[8] = { value: blank(ex.partialShort), format: 'warnValue' };
    span(r, 9, 10, 'Needs Review', 'reviewLabel'); r[11] = { value: blank(rep.reviewFindings), format: 'reviewValue' };
    span(r, 12, 13, 'Total Exceptions', 'totalLabel'); span(r, 14, W - 1, blank(ex.total), 'totalValue');
    put(r, 30);
    put(blankRow(), 8);
    r = blankRow();
    let from = 0;
    REPORT_COLUMNS.forEach((c, i) => {
      if (i === W - 1 || REPORT_COLUMNS[i + 1].group !== c.group) { span(r, from, i, c.group, 'group'); from = i + 1; }
    });
    put(r, 20);
    put(divided(REPORT_COLUMNS.map(c => ({ value: c.header, format: 'colHeader' }))), 32);
    rows.forEach(row => {
      put(divided(REPORT_COLUMNS.map(c => {
        const value = blank(c.value(row));
        if (c.kind === 'exception') return { value, format: reportException(row) ? 'rYes' : 'rNo' };
        if (c.kind === 'difference' && value) return { value, format: 'rDiffFlag' };
        if (c.format === 'rWrap' && reportException(row)) return { value, format: 'rWrapExc' };
        return { value, format: c.format };
      })));
    });
    const lastDetail = lines.length;
    const totals = {
      'Gross Payment': tot.gross, Discount: tot.discount, Payment: tot.payment, 'Original Amount': tot.originalAmount,
      'Amount Due': tot.invoiceAmountRemaining, Applied: tot.applicationAmount, 'Discount Taken': tot.discountTaken,
      'Remaining Balance': tot.remainingInvoiceBalance, difference: tot.reportDifference
    };
    r = blankRow(); span(r, 0, 1, 'TOTALS', 'totalsLabel');
    REPORT_COLUMNS.forEach((c, i) => {
      if (i < 2) return;
      const v = c.kind === 'difference' ? totals.difference : totals[c.header];
      r[i] = { value: blank(v), format: v === null || v === undefined ? 'totalsCell' : 'totalsMoney' };
    });
    put(divided(r), 22);
    put(blankRow(), 10);
    r = blankRow(); span(r, 0, W - 1, REPORT_FOOTER, 'footer'); hyperlinks.push({ ref: `A${lines.length + 1}`, url: REPORT_URL }); put(r, 18);
    r = blankRow(); span(r, 0, W - 1, REPORT_NOTE, 'footerNote'); put(r, 14);

    return {
      name: 'Reconciliation', header: false, rows: lines, merges, rowHeights, hyperlinks, showGridLines: false,
      columns: REPORT_COLUMNS.map(c => ({ header: c.header, width: c.width, format: c.format })),
      freezeRows: REPORT_HEADER_ROW,
      autoFilterRef: `A${REPORT_HEADER_ROW}:${colName(W - 1)}${Math.max(lastDetail, REPORT_HEADER_ROW)}`,
      printArea: `A1:${colName(W - 1)}${lines.length}`,
      printTitles: `${REPORT_HEADER_ROW - 1}:${REPORT_HEADER_ROW}`,
      pageSetup: { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 } }
    };
  }

  /**
   * The Excel reconciliation report of a Review & Reconciliation result, as plain data.
   * results  buildReconciliationResults output: always exported in full (UI filters do not apply).
   * applied  optional reconciliationApplyResults output after Apply; its rows (same rows, same order)
   *          add the write result of each row, kept apart from the reconciliation status.
   * One sheet, Reconciliation (the Cash Application Report): cash summary, exception tiles and one row per
   * result row in three column groups (REMITTANCE, NETSUITE APPLICATION, REVIEW & ANALYSIS).
   * Returns { fileName, sheets: [{ name, columns: [{ header, width, format }], header, freezeRows, autoFilterRef,
   * rows: [[cell]], merges, rowHeights, hyperlinks, printArea, printTitles, pageSetup, showGridLines }] } where a
   * cell is a value (null = blank) in its column's format, or { value, format } to override it. Every figure is
   * copied from results; nothing is recalculated.
   */
  function buildReconciliationExport(results, applied) {
    const src = results || {};
    const rows = applied && applied.rows ? applied.rows : (src.rows || []);
    return { fileName: RECONCILIATION_EXPORT_FILE, sheets: [reconciliationReportSheet(src, rows, applied)] };
  }

  // Minimal XLSX (Office Open XML) writer for buildReconciliationExport models: inline strings,
  // numeric cells, named cell styles, merged cells, row heights, frozen rows, an autofilter,
  // hyperlinks and print setup, in an uncompressed ZIP.
  // Pure: returns the file bytes (Uint8Array); the same model always gives the same bytes.
  const NAVY = '17324D', TEAL = '2F6B8A', SLATE = '536575', INK = '1F2933', MIST = 'F4F6F8', ICE = 'EAF2F7';
  const AMBER_BG = 'FFF4D6', AMBER = '8A5A00', RED_BG = 'FCE8E8', RED = 'A32929', GREEN_BG = 'E8F5EC', GREEN = '216E3A', WHITE = 'FFFFFF';
  // Cell styles by name: font { b, i, u, sz, color }, fill, border (thin bottom, all thin, medium box, medium top),
  // num ('money' #,##0.00 or 'integer'), align { h, v, wrap }. The first seven keep the order of earlier exports.
  const XLSX_STYLE_SPECS = [
    ['text', { align: { v: 'top' } }],
    ['header', { font: { b: 1 }, fill: 'F2F2F2', border: 'bottom', align: { v: 'top', wrap: 1 } }],
    ['money', { num: 'money', align: { v: 'top' } }],
    ['integer', { num: 'integer', align: { h: 'right', v: 'top' } }],
    ['title', { font: { b: 1, sz: 14 } }],
    ['section', { font: { b: 1 }, border: 'bottom' }],
    ['wrap', { align: { v: 'top', wrap: 1 } }],
    ['rTitle', { font: { b: 1, sz: 20, color: WHITE }, fill: NAVY, align: { v: 'center', indent: 1 } }],
    ['rBrand', { font: { b: 1, sz: 12, color: TEAL }, align: { v: 'center' } }],
    ['rGenerated', { font: { sz: 10, color: TEAL, u: 1 }, align: { h: 'right', v: 'center' } }],
    ['rMeta', { font: { sz: 9, color: SLATE }, align: { v: 'center' } }],
    ['rBar', { font: { b: 1, sz: 12, color: WHITE }, fill: TEAL, align: { v: 'center', indent: 1 } }],
    ['rBarAlt', { font: { b: 1, sz: 12, color: WHITE }, fill: SLATE, align: { v: 'center', indent: 1 } }],
    ['kpiLabel', { font: { b: 1, sz: 11, color: SLATE }, fill: MIST, border: 'all', align: { v: 'center', wrap: 1 } }],
    ['kpiValue', { font: { b: 1, sz: 12, color: INK }, fill: ICE, border: 'all', num: 'money', align: { h: 'right', v: 'center' } }],
    ['kpiText', { font: { b: 1, sz: 11, color: SLATE }, fill: ICE, border: 'all', align: { h: 'right', v: 'center' } }],
    ['kpiNote', { font: { sz: 10, color: INK }, fill: ICE, border: 'all', align: { v: 'center', wrap: 1 } }],
    ['warnLabel', { font: { b: 1, sz: 11, color: AMBER }, fill: AMBER_BG, align: { v: 'center', wrap: 1 } }],
    ['warnValue', { font: { b: 1, sz: 12, color: AMBER }, fill: AMBER_BG, num: 'money', align: { h: 'right', v: 'center' } }],
    ['badLabel', { font: { b: 1, sz: 11, color: RED }, fill: RED_BG, align: { v: 'center', wrap: 1 } }],
    ['badValue', { font: { b: 1, sz: 12, color: RED }, fill: RED_BG, num: 'money', align: { h: 'right', v: 'center' } }],
    ['reviewLabel', { font: { b: 1, sz: 11, color: SLATE }, fill: MIST, align: { v: 'center', wrap: 1 } }],
    ['reviewValue', { font: { b: 1, sz: 12, color: SLATE }, fill: MIST, num: 'integer', align: { h: 'right', v: 'center' } }],
    ['totalLabel', { font: { b: 1, sz: 11, color: WHITE }, fill: NAVY, align: { v: 'center', wrap: 1 } }],
    ['totalValue', { font: { b: 1, sz: 12, color: WHITE }, fill: NAVY, num: 'money', align: { h: 'right', v: 'center' } }],
    ['group', { font: { b: 1, sz: 11, color: WHITE }, fill: NAVY, border: 'box', align: { h: 'center', v: 'center' } }],
    ['colHeader', { font: { b: 1, sz: 10, color: INK }, fill: MIST, border: 'all', align: { h: 'center', v: 'center', wrap: 1 } }],
    ['rText', { font: { sz: 10, color: INK }, border: 'bottom', align: { v: 'center' } }],
    ['rInt', { font: { sz: 10, color: INK }, border: 'bottom', num: 'integer', align: { h: 'center', v: 'center' } }],
    ['rMoney', { font: { sz: 10, color: INK }, border: 'bottom', num: 'money', align: { h: 'right', v: 'center' } }],
    ['rWrap', { font: { sz: 10, color: INK }, border: 'bottom', align: { v: 'center', wrap: 1 } }],
    ['rWrapExc', { font: { sz: 10, color: RED }, border: 'bottom', align: { v: 'center', wrap: 1 } }],
    ['rDiffFlag', { font: { b: 1, sz: 10, color: AMBER }, fill: AMBER_BG, border: 'bottom', num: 'money', align: { h: 'right', v: 'center' } }],
    ['rYes', { font: { b: 1, sz: 10, color: RED }, fill: RED_BG, border: 'bottom', align: { h: 'center', v: 'center' } }],
    ['rNo', { font: { sz: 10, color: GREEN }, fill: GREEN_BG, border: 'bottom', align: { h: 'center', v: 'center' } }],
    ['totalsLabel', { font: { b: 1, sz: 11, color: WHITE }, fill: NAVY, border: 'top', align: { v: 'center', indent: 1 } }],
    ['totalsMoney', { font: { b: 1, sz: 10, color: INK }, fill: ICE, border: 'top', num: 'money', align: { h: 'right', v: 'center' } }],
    ['totalsCell', { font: { b: 1, sz: 10, color: INK }, fill: ICE, border: 'top', align: { v: 'center' } }],
    ['footer', { font: { b: 1, sz: 10, color: TEAL, u: 1 }, align: { v: 'center' } }],
    ['footerNote', { font: { i: 1, sz: 8, color: SLATE }, align: { v: 'center' } }]
  ];
  // Report grid styles with a group divider: ':gs' adds a medium left edge (a group's first column),
  // ':ge' a medium right edge (the last column).
  ['colHeader', 'rText', 'rInt', 'rMoney', 'rWrap', 'rWrapExc', 'rDiffFlag', 'rYes', 'rNo', 'totalsLabel', 'totalsMoney', 'totalsCell'].forEach(name => {
    const spec = XLSX_STYLE_SPECS.find(([n]) => n === name)[1];
    ['gs', 'ge'].forEach(edge => XLSX_STYLE_SPECS.push([`${name}:${edge}`, Object.assign({}, spec, { border: `${spec.border}:${edge}` })]));
  });
  const XLSX_STYLES = {};
  XLSX_STYLE_SPECS.forEach(([name], i) => { XLSX_STYLES[name] = i; });
  const thinSide = color => ({ style: 'thin', color }), mediumSide = { style: 'medium', color: NAVY };
  const BORDER_SPECS = {
    none: {},
    bottom: { bottom: thinSide('D5DBE1') },
    all: { left: thinSide('C9D1D9'), right: thinSide('C9D1D9'), top: thinSide('C9D1D9'), bottom: thinSide('C9D1D9') },
    box: { left: mediumSide, right: mediumSide, top: mediumSide, bottom: mediumSide },
    top: { top: mediumSide, bottom: mediumSide }
  };
  ['bottom', 'all', 'top'].forEach(k => {
    BORDER_SPECS[`${k}:gs`] = Object.assign({}, BORDER_SPECS[k], { left: mediumSide });
    BORDER_SPECS[`${k}:ge`] = Object.assign({}, BORDER_SPECS[k], { right: mediumSide });
  });
  const XLSX_BORDERS = {};
  Object.keys(BORDER_SPECS).forEach(k => {
    const b = BORDER_SPECS[k];
    XLSX_BORDERS[k] = '<border>' + ['left', 'right', 'top', 'bottom']
      .map(s => (b[s] ? `<${s} style="${b[s].style}"><color rgb="FF${b[s].color}"/></${s}>` : `<${s}/>`)).join('') + '<diagonal/></border>';
  });
  // styles.xml for XLSX_STYLE_SPECS; fonts and fills are shared between styles that use the same one.
  function stylesXml() {
    const fonts = [], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    const borders = Object.keys(XLSX_BORDERS);
    const indexOf = (list, xml) => { let i = list.indexOf(xml); if (i < 0) { list.push(xml); i = list.length - 1; } return i; };
    const fontXml = f => `<font>${f.b ? '<b/>' : ''}${f.i ? '<i/>' : ''}${f.u ? '<u/>' : ''}<sz val="${f.sz || 11}"/>` +
      `${f.color ? `<color rgb="FF${f.color}"/>` : ''}<name val="Calibri"/></font>`;
    indexOf(fonts, fontXml({}));
    const xfs = XLSX_STYLE_SPECS.map(([, st]) => {
      const fontId = indexOf(fonts, fontXml(st.font || {}));
      const fillId = st.fill ? indexOf(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${st.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
      const borderId = borders.indexOf(st.border || 'none');
      const numFmtId = st.num === 'money' ? 164 : st.num === 'integer' ? 1 : 0;
      const a = st.align || {};
      const align = (a.h || a.v || a.wrap || a.indent)
        ? `<alignment${a.h ? ` horizontal="${a.h}"` : ''}${a.v ? ` vertical="${a.v}"` : ''}${a.wrap ? ' wrapText="1"' : ''}${a.indent ? ` indent="${a.indent}"` : ''}/>` : '';
      return `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
        `${numFmtId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}${fillId ? ' applyFill="1"' : ''}` +
        `${borderId ? ' applyBorder="1"' : ''}${align ? ' applyAlignment="1"' : ''}>${align}</xf>`;
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;-#,##0.00"/></numFmts>' +
      `<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills>` +
      `<borders count="${borders.length}">${borders.map(b => XLSX_BORDERS[b]).join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(text) {
    const out = [];
    for (const ch of String(text)) {
      let cp = ch.codePointAt(0);
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return Uint8Array.from(out);
  }
  function zipStored(files) {
    const parts = [], central = [];
    let offset = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255];
    const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    // Fixed DOS time/date (1980-01-01 00:00) keeps the bytes deterministic.
    const stamp = [...u16(0), ...u16(33)];
    files.forEach(f => {
      const name = utf8(f.name), data = utf8(f.text), crc = crc32(data);
      const common = [...u16(20), ...u16(0x0800), ...u16(0), ...stamp, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
      const local = Uint8Array.from([...u32(0x04034B50), ...common, ...name]);
      central.push(Uint8Array.from([...u32(0x02014B50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
      parts.push(local, data);
      offset += local.length + data.length;
    });
    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const end = Uint8Array.from([...u32(0x06054B50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
    const all = parts.concat(central, [end]);
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0;
    all.forEach(p => { out.set(p, at); at += p.length; });
    return out;
  }
  const xmlText = v => String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = i => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  // The autofilter range of a sheet ('A1:S12'), or '' without one.
  function sheetFilterRef(sheet) {
    const cols = sheet.columns || [];
    if (sheet.autoFilterRef) return sheet.autoFilterRef;
    if (!sheet.autoFilter || !cols.length) return '';
    return `A1:${colName(cols.length - 1)}${Math.max((sheet.rows || []).length + (sheet.header ? 1 : 0), 1)}`;
  }
  const absRef = ref => ref.split(':').map(p => p.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2')).join(':');
  function sheetXml(sheet) {
    const cols = sheet.columns || [];
    const lines = (sheet.header ? [cols.map(c => ({ value: c.header, format: 'header' }))] : []).concat(sheet.rows || []);
    const heights = sheet.rowHeights || {};
    const rowsXml = lines.map((line, r) => {
      const cells = line.map((cell, c) => {
        const isObj = cell !== null && typeof cell === 'object';
        const value = isObj ? cell.value : cell;
        const ref = `${colName(c)}${r + 1}`;
        if (value === null || value === undefined || value === '') {
          // A styled blank keeps fills and borders across merged and empty report cells.
          return isObj && cell.format ? `<c r="${ref}" s="${XLSX_STYLES[cell.format] || 0}"/>` : '';
        }
        const format = (isObj && cell.format) || (cols[c] && cols[c].format) || 'text';
        const style = XLSX_STYLES[format] || 0;
        if (typeof value === 'number' && Number.isFinite(value) && format !== 'header' && format !== 'colHeader') return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
        return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
      }).join('');
      const ht = heights[r + 1];
      return `<row r="${r + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells}</row>`;
    }).join('');
    const frozen = sheet.freezeRows || (sheet.freezeHeader ? 1 : 0);
    const viewAttrs = `${sheet.showGridLines === false ? ' showGridLines="0"' : ''} workbookViewId="0"`;
    const view = frozen
      ? `<sheetViews><sheetView${viewAttrs}><pane ySplit="${frozen}" topLeftCell="A${frozen + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : `<sheetViews><sheetView${viewAttrs}/></sheetViews>`;
    const setup = sheet.pageSetup;
    const sheetPr = setup && setup.fitToWidth ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '';
    const widths = cols.length ? `<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 12}" customWidth="1"/>`).join('')}</cols>` : '';
    const filterRef = sheetFilterRef(sheet);
    const filter = filterRef ? `<autoFilter ref="${filterRef}"/>` : '';
    const merges = (sheet.merges || []).length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    const links = (sheet.hyperlinks || []).length
      ? `<hyperlinks>${sheet.hyperlinks.map((h, i) => `<hyperlink ref="${h.ref}" r:id="rId${i + 1}"/>`).join('')}</hyperlinks>` : '';
    let print = '';
    if (setup) {
      const m = setup.margins || {};
      print = '<printOptions horizontalCentered="1"/>' +
        `<pageMargins left="${m.left || 0.25}" right="${m.right || 0.25}" top="${m.top || 0.5}" bottom="${m.bottom || 0.5}" header="${m.header || 0.2}" footer="${m.footer || 0.2}"/>` +
        `<pageSetup orientation="${setup.orientation || 'portrait'}"${setup.fitToWidth ? ` fitToWidth="${setup.fitToWidth}" fitToHeight="${setup.fitToHeight || 0}"` : ''}/>`;
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `${sheetPr}${view}${widths}<sheetData>${rowsXml}</sheetData>${filter}${merges}${links}${print}</worksheet>`;
  }
  function buildXlsx(model) {
    const sheets = (model && model.sheets) || [];
    const ns = 'http://schemas.openxmlformats.org/';
    const files = [
      {
        name: '[Content_Types].xml',
        text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          `<Types xmlns="${ns}package/2006/content-types">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
          '</Types>'
      },
      {
        name: '_rels/.rels',
        text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          `<Relationships xmlns="${ns}package/2006/relationships">` +
          `<Relationship Id="rId1" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
      },
      {
        name: 'xl/workbook.xml',
        text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          `<workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets>` +
          sheets.map((s, i) => `<sheet name="${xmlText(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
          '</sheets>' + definedNamesXml(sheets) + '</workbook>'
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          `<Relationships xmlns="${ns}package/2006/relationships">` +
          sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
          `<Relationship Id="rId${sheets.length + 1}" Type="${ns}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
      },
      { name: 'xl/styles.xml', text: stylesXml() }
    ].concat(sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) })));
    sheets.forEach((s, i) => {
      if (!(s.hyperlinks || []).length) return;
      files.push({
        name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          `<Relationships xmlns="${ns}package/2006/relationships">` +
          s.hyperlinks.map((h, k) => `<Relationship Id="rId${k + 1}" Type="${ns}officeDocument/2006/relationships/hyperlink" Target="${xmlText(h.url)}" TargetMode="External"/>`).join('') +
          '</Relationships>'
      });
    });
    return zipStored(files);
  }
  // Workbook names: each sheet's autofilter range, print area and repeated print title rows.
  function definedNamesXml(sheets) {
    const names = [];
    sheets.forEach((s, i) => {
      const sheetRef = `'${xmlText(s.name)}'!`;
      const filterRef = sheetFilterRef(s);
      if (filterRef) names.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${sheetRef}${absRef(filterRef)}</definedName>`);
      if (s.printArea) names.push(`<definedName name="_xlnm.Print_Area" localSheetId="${i}">${sheetRef}${absRef(s.printArea)}</definedName>`);
      if (s.printTitles) names.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${sheetRef}${s.printTitles.split(':').map(n => `$${n}`).join(':')}</definedName>`);
    });
    return names.length ? `<definedNames>${names.join('')}</definedNames>` : '';
  }

  // Public ApplyFast pages linked from the panel and the toolbar popup. Public URLs only.
  const APPLYFAST_WEBSITE_URL = 'https://applyfast.store/';
  const LINKS = Object.freeze({
    website: APPLYFAST_WEBSITE_URL,
    demo: APPLYFAST_WEBSITE_URL + 'demo/',
    pricing: APPLYFAST_WEBSITE_URL + '#pricing'
  });

  const api = {
    parseAmountStrict, isAccountingZero, normalizeRef, parseLine, remittanceReference, parseInput, transformPaste, pasteEdit, matchEntries, MIN_PARTIAL_LENGTH,
    PIPE_MULTI_REASON, CAP_NOT_REACHED_REASON, SKIPPED_NO_DUE_REASON, HELD_LINE_STATUSES, unwrittenResultStatus, allotGroupCaps, groupCapLeftover, attachMatchBlocks, duplicateReferenceReason, overlapRowReason,
    INFO_COLUMNS, infoColumns, infoValues,
    classifyRowState, sameRowState, pageSignature, decideGroup,
    SETTLE_QUIET_MS, parseRange, listHasMultiplePages, THIS_PAGE_GROUP_WARN, thisPageGroupWarning, pageAgreement, settleStep, createScan, addPage, scanCoverage,
    matchAcrossPages, matchLoadedPage, buildPagePlan, checkPageFresh, locatePlanItems, scanPageList,
    AUTO_SCAN_PAGE_CAP, AUTO_NAV_TIMEOUT_MS, planAutoScan, autoNavStatus, verifyAutoPage,
    NO_AMOUNT_REASON, plannedAmounts, buildMultiApplyPlan, decideMultiWrites, orderApplyPages, rowChangeSincePreview,
    revalidateApplyPage, verifyWrite, resetRowAction, applyEndMessage,
    RECON_STATUS, DISCOUNT_STATUS, APPLICATION_KIND, analyzeApplication, parsePaymentReceived, multiPlanAnalysisInput, buildCashWritePlan,
    RESULT_FILTERS, buildReconciliationResults, filterReconciliationResults, reconciliationApplyResults,
    REPORT_COLUMNS, buildReconciliationExport, buildXlsx, LINKS
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ApplyFastCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
