// ApplyFast Interactive Demo: a spreadsheet-style remittance. Cells can be selected with the mouse
// (click, drag, Shift+click, row numbers) or arrow keys and copied with Ctrl+C / Cmd+C or the Copy
// button. Copied text is tab-separated rows, like cells copied from a spreadsheet; amounts are copied
// as plain numbers (1250.00) while the grid shows them formatted ($1,250.00).
// When editable, remittance cells can be corrected (double-click, Enter, F2 or just type; Enter
// commits, Escape cancels) and selected rows deleted, so a visitor can fix a remittance and copy it again.
(function (root) {
  'use strict';

  const COLS = ['A', 'B', 'C', 'D'];
  const EXTRA_ROWS = 3;
  const money = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // What a spreadsheet would accept as a number in an amount cell: 1250, 1250.00, 1,250.00, $1,250.00.
  const NUMBER = /^\$?\s*(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;

  // Rows of cells ({ text, copy, cls }) for one remittance, plus the range holding its lines.
  // scenario.columns: [{ key, label, money }]; the first column holds the reference.
  function remittanceSheet(scenario, customer, paymentDate) {
    const amount = (n, cls) => ({ text: money(n), copy: n.toFixed(2), cls: `xl-num ${cls || ''}` });
    const columns = scenario.columns;
    const rows = [
      [{ text: 'Remittance Advice', cls: 'xl-title' }],
      [{ text: customer.name, cls: 'xl-spill' }],
      [{ text: 'Payment Date', cls: 'xl-muted' }, {}, { text: paymentDate, cls: 'xl-num' }],
      [{ text: 'Payment Amount', cls: 'xl-muted' }, {}, amount(scenario.totalPaid, 'xl-bold')],
      [],
      columns.map(col => ({ text: col.label, cls: `xl-head${col.money ? ' xl-num' : ''}` }))
    ];
    const amountCell = { r: 3, c: 2 };
    const first = rows.length;
    const typed = (l, col) => l[`${col.key}Text`];
    scenario.lines.forEach(l => rows.push(columns.map(col => {
      if (!col.money) return { text: l[col.key] };
      return typed(l, col) !== undefined ? { text: typed(l, col), copy: typed(l, col), cls: 'xl-num xl-typed' } : amount(l[col.key]);
    })));
    const last = rows.length - 1;
    let totalRow = null;
    if (columns.some(col => col.money)) {
      const totals = { discount: scenario.totalDiscount, paid: scenario.totalPaid };
      totalRow = rows.length;
      rows.push(columns.map((col, i) => (i === 0 ? { text: 'Total', cls: 'xl-bold xl-total' }
        : col.money ? amount(totals[col.key], 'xl-bold xl-total') : { cls: 'xl-total' })));
    }
    return { rows, columns, totalRow, amountCell, dataRange: { r1: first, c1: 0, r2: last, c2: columns.length - 1 } };
  }

  function render(host, sheet, opts) {
    const options = opts || {};
    const editable = !!options.editable;
    const cellAt = (r, c) => (sheet.rows[r] && sheet.rows[r][c]) || {};
    const valueOf = cell => (cell.copy !== undefined ? cell.copy : (cell.text || ''));

    host.innerHTML = `
      <div class="xl" data-testid="excel-remittance">
        <div class="xl-titlebar"><span class="xl-appmark">X</span><span>${esc(options.fileName || 'Remittance.xlsx')}</span><span class="xl-titlenote">Spreadsheet view &middot; fictional data</span></div>
        <div class="xl-formula"><span class="xl-namebox"></span><span class="xl-fx">fx</span><span class="xl-fxvalue"></span>
          <button type="button" class="xl-delrow" hidden></button></div>
        <div class="xl-scroll">
          <table class="xl-grid" tabindex="0" aria-label="Remittance spreadsheet">
            <thead><tr><th class="xl-corner"></th>${COLS.map(c => `<th class="xl-colhead">${c}</th>`).join('')}</tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>`;

    const grid = host.querySelector('.xl-grid');
    const tbody = grid.querySelector('tbody');
    const nameBox = host.querySelector('.xl-namebox');
    const fxValue = host.querySelector('.xl-fxvalue');
    const delRow = host.querySelector('.xl-delrow');
    let tds = [];
    let anchor = { r: sheet.dataRange.r1, c: 0 };
    let sel = Object.assign({}, sheet.dataRange);
    let dragging = false;
    let editing = null;
    let version = 0;
    const lastCol = sheet.dataRange.c2;

    const norm = (a, b) => ({ r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) });
    const addr = (r, c) => `${COLS[c]}${r + 1}`;
    const inSel = (r, c, s) => r >= s.r1 && r <= s.r2 && c >= s.c1 && c <= s.c2;
    const isData = (r, c) => r >= sheet.dataRange.r1 && r <= sheet.dataRange.r2 && c >= 0 && c <= lastCol;
    const tdAt = (r, c) => grid.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
    // Whole remittance rows are selected (and at least one would remain after deleting them).
    const rowsSelected = () => editable && sel.c1 === 0 && sel.c2 === lastCol && sel.r1 >= sheet.dataRange.r1 &&
      sel.r2 <= sheet.dataRange.r2 && (sel.r2 - sel.r1) < (sheet.dataRange.r2 - sheet.dataRange.r1);

    function drawBody() {
      const rowCount = sheet.rows.length + EXTRA_ROWS;
      let body = '';
      for (let r = 0; r < rowCount; r++) {
        body += `<tr><th class="xl-rowhead" data-row="${r}">${r + 1}</th>`;
        COLS.forEach((_, c) => {
          const cell = cellAt(r, c);
          body += `<td data-r="${r}" data-c="${c}" class="${cell.cls || ''}">${cell.text ? esc(cell.text) : ''}</td>`;
        });
        body += '</tr>';
      }
      tbody.innerHTML = body;
      tds = Array.from(tbody.querySelectorAll('td'));
    }

    function paint() {
      tds.forEach(td => {
        const r = Number(td.dataset.r), c = Number(td.dataset.c);
        td.classList.toggle('is-sel', inSel(r, c, sel));
        td.classList.toggle('is-anchor', r === anchor.r && c === anchor.c);
      });
      grid.querySelectorAll('.xl-colhead').forEach((th, c) => th.classList.toggle('is-hl', c >= sel.c1 && c <= sel.c2));
      grid.querySelectorAll('.xl-rowhead').forEach((th, r) => th.classList.toggle('is-hl', r >= sel.r1 && r <= sel.r2));
      nameBox.textContent = sel.r1 === sel.r2 && sel.c1 === sel.c2 ? addr(sel.r1, sel.c1) : `${addr(sel.r1, sel.c1)}:${addr(sel.r2, sel.c2)}`;
      fxValue.textContent = valueOf(cellAt(anchor.r, anchor.c));
      const canDelete = rowsSelected();
      delRow.hidden = !canDelete;
      if (canDelete) delRow.textContent = sel.r1 === sel.r2 ? `Delete row ${sel.r1 + 1}` : `Delete rows ${sel.r1 + 1}–${sel.r2 + 1}`;
    }

    function clearCopied() { tds.forEach(td => td.classList.remove('is-copied', 'xl-et', 'xl-eb', 'xl-el', 'xl-er')); }
    function markCopied(s) {
      clearCopied();
      tds.forEach(td => {
        const r = Number(td.dataset.r), c = Number(td.dataset.c);
        if (!inSel(r, c, s)) return;
        td.classList.add('is-copied');
        if (r === s.r1) td.classList.add('xl-et');
        if (r === s.r2) td.classList.add('xl-eb');
        if (c === s.c1) td.classList.add('xl-el');
        if (c === s.c2) td.classList.add('xl-er');
      });
    }

    function selectionText(s) {
      const range = s || sel;
      const out = [];
      for (let r = range.r1; r <= range.r2; r++) {
        const cells = [];
        for (let c = range.c1; c <= range.c2; c++) cells.push(valueOf(cellAt(r, c)));
        out.push(cells.join('\t'));
      }
      return out.join('\n');
    }

    function copied(text) {
      markCopied(sel);
      if (options.onCopy) options.onCopy(text, Object.assign({}, sel));
    }

    /* ---------- Corrections ---------- */

    function recalc() {
      const sums = {};
      sheet.columns.forEach((col, c) => {
        if (!col.money) return;
        let sum = 0;
        for (let r = sheet.dataRange.r1; r <= sheet.dataRange.r2; r++) {
          const v = valueOf(cellAt(r, c));
          if (/^-?\d+(\.\d+)?$/.test(v)) sum += Number(v);
        }
        sums[col.key] = Math.round(sum * 100) / 100;
        if (sheet.totalRow !== null) sheet.rows[sheet.totalRow][c] = { text: money(sums[col.key]), copy: sums[col.key].toFixed(2), cls: 'xl-num xl-bold xl-total' };
      });
      if (sums.paid !== undefined && sheet.amountCell) {
        sheet.rows[sheet.amountCell.r][sheet.amountCell.c] = { text: money(sums.paid), copy: sums.paid.toFixed(2), cls: 'xl-num xl-bold' };
      }
    }

    function changed() {
      version++;
      recalc();
      drawBody();
      paint();
      if (options.onChange) options.onChange();
    }

    function setCell(r, c, raw) {
      const v = String(raw).trim();
      const before = valueOf(cellAt(r, c));
      let cell;
      if (!sheet.columns[c].money) cell = { text: v, cls: 'xl-edited' };
      else if (NUMBER.test(v)) {
        const n = Number(v.replace(/[$,\s]/g, ''));
        cell = { text: money(n), copy: n.toFixed(2), cls: 'xl-num xl-edited' };
      } else cell = { text: v, copy: v, cls: 'xl-num xl-edited' };
      if (valueOf(cell) === before) return false;
      sheet.rows[r][c] = cell;
      return true;
    }

    function startEdit(r, c, initial) {
      if (!editable || !isData(r, c) || editing) return;
      const td = tdAt(r, c);
      if (!td) return;
      anchor = { r, c };
      sel = norm(anchor, anchor);
      paint();
      const input = document.createElement('input');
      input.className = 'xl-edit';
      input.setAttribute('aria-label', `Edit cell ${addr(r, c)}`);
      input.value = initial !== undefined ? initial : valueOf(cellAt(r, c));
      td.classList.add('is-editing');
      td.textContent = '';
      td.appendChild(input);
      editing = { r, c, input };
      input.focus();
      if (initial === undefined) input.select();
      const finish = save => {
        if (!editing || editing.input !== input) return;
        editing = null;
        const did = save && setCell(r, c, input.value);
        if (did) { clearCopied(); changed(); } else { drawBody(); paint(); }
        grid.focus({ preventScroll: true });
      };
      input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
    }

    function deleteSelectedRows() {
      if (!rowsSelected()) return;
      const n = sel.r2 - sel.r1 + 1;
      sheet.rows.splice(sel.r1, n);
      sheet.dataRange.r2 -= n;
      if (sheet.totalRow !== null) sheet.totalRow -= n;
      const r = Math.min(sel.r1, sheet.dataRange.r2);
      anchor = { r, c: 0 };
      sel = { r1: r, c1: 0, r2: r, c2: 0 };
      clearCopied();
      changed();
      grid.focus({ preventScroll: true });
    }
    delRow.addEventListener('click', deleteSelectedRows);

    /* ---------- Selection ---------- */

    const cellOf = el => {
      const td = el.closest && el.closest('td[data-r]');
      return td ? { r: Number(td.dataset.r), c: Number(td.dataset.c) } : null;
    };
    grid.addEventListener('mousedown', e => {
      if (e.target.closest('.xl-edit')) return;
      const rowHead = e.target.closest('.xl-rowhead');
      const cell = cellOf(e.target);
      if (!cell && !rowHead) return;
      e.preventDefault();
      grid.focus();
      if (rowHead) {
        const r = Number(rowHead.dataset.row);
        if (e.shiftKey) sel = norm(anchor, { r, c: lastCol });
        else { anchor = { r, c: 0 }; sel = { r1: r, c1: 0, r2: r, c2: lastCol }; }
        sel.c1 = 0; sel.c2 = lastCol;
      } else if (e.shiftKey) {
        sel = norm(anchor, cell);
      } else {
        anchor = cell;
        sel = norm(cell, cell);
      }
      dragging = { rows: !!rowHead };
      paint();
    });
    grid.addEventListener('mouseover', e => {
      if (!dragging) return;
      if (dragging.rows) {
        const th = e.target.closest('.xl-rowhead') || e.target.closest('tr');
        const r = th && th.dataset && th.dataset.row !== undefined ? Number(th.dataset.row) : (cellOf(e.target) || {}).r;
        if (r === undefined) return;
        sel = { r1: Math.min(anchor.r, r), c1: 0, r2: Math.max(anchor.r, r), c2: lastCol };
      } else {
        const cell = cellOf(e.target);
        if (!cell) return;
        sel = norm(anchor, cell);
      }
      paint();
    });
    document.addEventListener('mouseup', () => { dragging = false; });
    grid.addEventListener('dblclick', e => {
      const cell = cellOf(e.target);
      if (cell) startEdit(cell.r, cell.c);
    });
    const MOVES = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    grid.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        anchor = { r: 0, c: 0 };
        sel = { r1: 0, c1: 0, r2: sheet.rows.length - 1, c2: Math.max(...sheet.rows.map(row => row.length)) - 1 };
        paint();
      } else if (e.key === 'Escape') {
        clearCopied();
      } else if (MOVES[e.key]) {
        e.preventDefault();
        const [dr, dc] = MOVES[e.key];
        const next = { r: Math.max(0, Math.min(sheet.rows.length + EXTRA_ROWS - 1, anchor.r + dr)), c: Math.max(0, Math.min(COLS.length - 1, anchor.c + dc)) };
        if (e.shiftKey) sel = norm(anchor, next);
        else { anchor = next; sel = norm(next, next); }
        paint();
      } else if (editable && (e.key === 'Enter' || e.key === 'F2')) {
        e.preventDefault();
        startEdit(anchor.r, anchor.c);
      } else if (editable && (e.key === 'Delete' || e.key === 'Backspace' || (mod && e.key === '-')) && rowsSelected()) {
        e.preventDefault();
        deleteSelectedRows();
      } else if (editable && !mod && !e.altKey && e.key.length === 1 && isData(anchor.r, anchor.c)) {
        e.preventDefault();
        startEdit(anchor.r, anchor.c, e.key);
      }
    });
    grid.addEventListener('copy', e => {
      if (editing) return;
      const text = selectionText();
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
      copied(text);
    });

    function selectData() {
      anchor = { r: sheet.dataRange.r1, c: 0 };
      sel = Object.assign({}, sheet.dataRange);
      paint();
    }

    // Copies the remittance lines. Falls back to the grid's own copy handler if the async
    // Clipboard API is unavailable or refused.
    async function copyData() {
      selectData();
      const text = selectionText();
      try {
        await navigator.clipboard.writeText(text);
        copied(text);
        return true;
      } catch (e) {
        grid.focus();
        try { return document.execCommand('copy'); } catch (err) { return false; }
      }
    }

    drawBody();
    paint();
    return {
      selectData,
      copyData,
      selectionText: () => selectionText(),
      dataText: () => selectionText(sheet.dataRange),
      version: () => version,
      addr,
      // The remittance lines as they are now: { r, values } with one copied value per column.
      dataRows: () => {
        const out = [];
        for (let r = sheet.dataRange.r1; r <= sheet.dataRange.r2; r++) {
          const values = [];
          for (let c = 0; c <= lastCol; c++) values.push(valueOf(cellAt(r, c)));
          out.push({ r, values });
        }
        return out;
      },
      cellEl: tdAt,
      rowHeadEl: r => grid.querySelector(`.xl-rowhead[data-row="${r}"]`),
      deleteButton: () => delRow
    };
  }

  root.ApplyFastDemoSheet = { render, remittanceSheet };
})(typeof globalThis !== 'undefined' ? globalThis : this);
