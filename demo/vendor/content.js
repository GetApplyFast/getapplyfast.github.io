// ApplyFast - Content Script (custpymt.nl only, US-only number handling)
(function () {
  'use strict';

  console.log('ApplyFast content script loaded at', location.href);

  /***********************
   * ROW / INPUT DETECTION
   ***********************/
  const PRIMARY_AMOUNT_SELECTOR = 'input[id^="amount"][id$="_formattedValue"]';
  const FALLBACK_SELECTORS = [
    'input[id*="amount"]',
    'input[name*="amount"]',
    'input[type="number"]',
    'input[type="text"][aria-label*="amount"]',
    'input[class*="amount"]'
  ];
  const DISCOUNT_SELECTORS = [
    'input[id^="disc"][id$="_formattedValue"]',  // Primary: disc1_formattedValue, disc2_formattedValue, etc.
    'input[name^="disc"][name$="_formattedValue"]',  // By name: disc1_formattedValue
    'input[id*="discount"][id$="_formattedValue"]',
    'input[id*="discount"]',
    'input[name*="discount"]',
    'input[aria-label*="discount" i]',
    'input[aria-labelledby*="disc" i]',  // aria-labelledby="apply_disc1_fs_lbl"
    'input[class*="discount"]'
  ];

  // Helper function to find editable discount field (not disabled/greyed out)
  function findEditableDiscountField(row) {
    console.log('🔍 Searching for discount field in row...');
    
    // Strategy 1: Find the table header for "Disc. Taken" and get the column index
    const table = row.closest('table');
    let discTakenColumnIndex = -1;
    
    if (table) {
      // Look for header row
      const headerRow = table.querySelector('thead tr, tr:first-child, .uir-list-header-row');
      if (headerRow) {
        const headers = headerRow.querySelectorAll('th, td');
        headers.forEach((header, index) => {
          const headerText = (header.innerText || header.textContent || '').toLowerCase().trim();
          if (headerText.includes('disc') && headerText.includes('taken')) {
            discTakenColumnIndex = index;
            console.log('✅ Found "Disc. Taken" column at index:', discTakenColumnIndex);
          }
        });
      }
      
      // If we found the column index, get the input in that column
      if (discTakenColumnIndex >= 0) {
        const cells = row.querySelectorAll('td');
        if (cells[discTakenColumnIndex]) {
          const input = cells[discTakenColumnIndex].querySelector('input');
          if (input && !input.disabled && !input.readOnly) {
            console.log('✅ Found discount field via column index:', input.id || input.name);
            return input;
          }
        }
      }
    }
    
    // Strategy 2: Try all discount selectors but filter out disabled fields
    console.log('Trying discount selectors...');
    for (const sel of DISCOUNT_SELECTORS) {
      const inputs = row.querySelectorAll(sel);
      console.log(`Selector "${sel}" found ${inputs.length} inputs`);
      
      for (const input of inputs) {
        // Skip disabled or readonly fields
        if (input.disabled || input.readOnly) {
          console.log(`  ⏭️ Skipping disabled/readonly field: ${input.id || input.name}`);
          continue;
        }
        
        // Check if field is visible and not greyed out
        const style = window.getComputedStyle(input);
        if (style.display === 'none' || style.visibility === 'hidden' || 
            style.opacity === '0' || input.style.display === 'none') {
          console.log(`  ⏭️ Skipping hidden field: ${input.id || input.name}`);
          continue;
        }
        
        // Check the field ID/name to avoid "date" and "avail"
        const id = (input.id || '').toLowerCase();
        const name = (input.name || '').toLowerCase();
        if (id.includes('date') || id.includes('avail') || 
            name.includes('date') || name.includes('avail')) {
          console.log(`  ⏭️ Skipping date/avail field: ${input.id || input.name}`);
          continue;
        }
        
        // Check aria-labelledby for "taken"
        const ariaLabelledBy = input.getAttribute('aria-labelledby') || '';
        if (ariaLabelledBy.toLowerCase().includes('taken')) {
          console.log(`✅ Found "Disc. Taken" field via aria-labelledby: ${input.id || input.name}`);
          return input;
        }
        
        // Check nearby label text
        const cell = input.closest('td') || input.parentElement;
        if (cell) {
          const cellText = (cell.innerText || cell.textContent || '').toLowerCase();
          if (cellText.includes('taken') || 
              (cellText.includes('disc') && !cellText.includes('date') && !cellText.includes('avail'))) {
            console.log(`✅ Found "Disc. Taken" field via label text: ${input.id || input.name}`);
            return input;
          }
        }
        
        // If it's a disc field and editable, use it (but log for debugging)
        console.log(`✅ Found editable discount field: ${input.id || input.name}`);
        return input;
      }
    }
    
    // Strategy 3: Search all inputs in row
    console.log('Searching all inputs in row...');
    const allInputs = row.querySelectorAll('input[type="text"], input[type="number"]');
    console.log(`Found ${allInputs.length} total inputs in row`);
    
    for (const input of allInputs) {
      if (input.disabled || input.readOnly) {
        continue;
      }
      
      const id = (input.id || '').toLowerCase();
      const name = (input.name || '').toLowerCase();
      
      // Look for discount fields
      if (id.includes('disc') || name.includes('disc')) {
        // Skip date and avail
        if (id.includes('date') || id.includes('avail') || 
            name.includes('date') || name.includes('avail')) {
          console.log(`  ⏭️ Skipping date/avail: ${input.id || input.name}`);
          continue;
        }
        
        // Check visibility
        const style = window.getComputedStyle(input);
        if (style.display !== 'none' && style.visibility !== 'hidden' && 
            style.opacity !== '0') {
          console.log(`✅ Found discount field via fallback: ${input.id || input.name}`);
          return input;
        }
      }
    }
    
    console.warn('❌ No editable discount field found in row');
    console.log('Row HTML snippet:', row.innerHTML.substring(0, 1000));
    return null;
  }

  function findAmountInputs(doc = document) {
    try {
      let inputs = Array.from(doc.querySelectorAll(PRIMARY_AMOUNT_SELECTOR));
      if (inputs.length > 0) return inputs;
      for (const sel of FALLBACK_SELECTORS) {
        inputs = Array.from(doc.querySelectorAll(sel));
        if (inputs.length > 0) return inputs;
      }
      return [];
    } catch (e) { console.error('findAmountInputs error', e); return []; }
  }

  window.applyFast_debug_findAmountInputsCount = function () {
    try { return findAmountInputs().length; } catch (e) { console.error('debug findAmountInputs error', e); return -1; }
  };

  /***********************
   * INVOICES SUBLIST SNAPSHOT (read-only)
   * Only table#apply_splits is read. The Credits sublist (#credit_splits) reuses
   * the same input ids (apply1, amount1_formattedValue), so every lookup is
   * scoped to an Invoices row and never done by id.
   ***********************/
  const COLUMN_PATTERNS = {
    ref: /^ref(erence)?\.?\s*(no\.?|number|#)?$/,
    type: /^type$/,
    po: /\bpo\b/,
    amtDue: /\b(amt\.?|amount)\s*due\b/,
    discTaken: /\bdisc(ount)?\.?\s*taken\b/
  };
  // Standard NetSuite columns never used for reference matching (numbers, dates, fixed values),
  // compared without punctuation. Every other column, including custom ones, is searchable.
  const NON_MATCHABLE_COLUMNS = new Set([
    'apply', 'date', 'type', 'currency', 'payment', 'amount',
    'orig amt', 'orig amount', 'original amount', 'amt due', 'amount due', 'amount remaining',
    'disc date', 'discount date', 'disc avail', 'discount available', 'disc taken', 'discount taken',
    'group date'
  ]);

  function isMatchableColumn(label) {
    return !!label && !NON_MATCHABLE_COLUMNS.has(label.replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim());
  }

  function isInlineHidden(el) {
    return !!(el.style && el.style.display === 'none');
  }

  // NetSuite renders hidden helper cells (userenteredamount/discount) between the
  // Disc. Taken and Payment cells, so header positions only line up with visible cells.
  function visibleCells(tr) {
    const out = [];
    for (const cell of tr.cells) if (!isInlineHidden(cell)) out.push(cell);
    return out;
  }

  // Ref No. cells start with a hidden zero-padded sort key; textContent would include it.
  function visibleText(node) {
    let text = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) text += child.nodeValue;
      else if (child.nodeType === 1 && !isInlineHidden(child)) text += visibleText(child);
    }
    return text;
  }

  function cellText(cell) {
    return cell ? visibleText(cell).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() : '';
  }

  function headerLabel(cell) {
    const raw = cell.getAttribute('data-label') || cell.textContent || '';
    return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function findInvoicesTable(doc) {
    const table = doc.getElementById('apply_splits');
    if (table && table.tagName === 'TABLE') return table;
    const header = doc.getElementById('applyheader');
    return header ? header.closest('table') : null;
  }

  function readApplyRows(doc) {
    const core = globalThis.ApplyFastCore;
    const table = findInvoicesTable(doc);
    if (!table) return { error: 'The Invoices sublist was not found on this page.' };
    const headerRow = table.querySelector('tr.uir-machine-headerrow') || table.rows[0];
    if (!headerRow) return { error: 'The Invoices sublist has no header row.' };

    const headerCells = visibleCells(headerRow);
    const columns = {};
    const otherColumns = [];
    headerCells.forEach((cell, i) => {
      const label = headerLabel(cell);
      const name = Object.keys(COLUMN_PATTERNS).find(n => columns[n] === undefined && COLUMN_PATTERNS[n].test(label));
      if (name) columns[name] = i;
      else if (isMatchableColumn(label)) otherColumns.push(i);
    });
    if (columns.ref === undefined) return { error: 'The Ref No. column was not found in the Invoices sublist.', columns };

    // Read-only Date / Orig. Amt. / Disc. Avail. positions; kept apart from columns and otherColumns.
    const infoColumns = core.infoColumns(headerCells.map(headerLabel));
    const layout = { columns, otherColumns, infoColumns, width: headerCells.length };
    const rows = [];
    let unrecognizedRows = 0;
    for (const tr of table.rows) {
      if (tr === headerRow || tr.classList.contains('uir-machine-headerrow')) continue;
      const cells = visibleCells(tr);
      if (cells.length !== headerCells.length) { unrecognizedRows++; continue; }
      rows.push(readRowCells(tr, cells, layout, core));
    }

    const rangeInput = doc.querySelector('input[name="inpt_applyrange"]');
    const range = rangeInput ? /(\d[\d,]*)\s*to\s*(\d[\d,]*)\s*of\s*(\d[\d,]*)/i.exec(rangeInput.value || '') : null;
    const customerInput = doc.querySelector('input[name="customer"]');
    return {
      rows,
      columns,
      layout,
      unrecognizedRows,
      rangeText: rangeInput ? rangeInput.value : '',
      totalOpen: range ? Number(range[3].replace(/,/g, '')) : null,
      customerId: customerInput ? customerInput.value : ''
    };
  }

  // One Invoices row, read with the column layout of its table header.
  function readRowCells(tr, cells, layout, core) {
    const { columns, otherColumns, infoColumns } = layout;
    const infoText = name => (infoColumns[name] === undefined ? '' : cellText(cells[infoColumns[name]]));
    const info = core.infoValues({ date: infoText('date'), origAmt: infoText('origAmt'), discAvail: infoText('discAvail') });
    const checkbox = tr.querySelector('input[type="checkbox"]');
    let amountInput = tr.querySelector(PRIMARY_AMOUNT_SELECTOR);
    if (!amountInput) {
      for (const sel of FALLBACK_SELECTORS) {
        amountInput = tr.querySelector(sel);
        if (amountInput) break;
      }
    }
    const amtDueText = columns.amtDue === undefined ? '' : cellText(cells[columns.amtDue]);
    const amtDue = amtDueText ? core.parseAmountStrict(amtDueText) : null;
    const link = tr.querySelector('a[href*="id="]');
    const idMatch = link ? /[?&]id=(\d+)/.exec(link.getAttribute('href')) : null;
    const lineMatch = checkbox ? /(\d+)$/.exec(checkbox.name || checkbox.id || '') : null;
    const rowIdMatch = /^applyrow(\d+)$/.exec(tr.id || '');

    return {
      tr,
      checkbox,
      amountInput,
      discountCell: columns.discTaken === undefined ? null : cells[columns.discTaken],
      ref: cellText(cells[columns.ref]),
      type: columns.type === undefined ? '' : cellText(cells[columns.type]),
      po: columns.po === undefined ? '' : cellText(cells[columns.po]),
      otherCells: otherColumns.map(i => cellText(cells[i])),
      amtDue: amtDue && amtDue.ok ? amtDue.value : null,
      amtDueText,
      // Read only; never used for matching, planning or writes.
      date: info.date,
      origAmt: info.origAmt,
      origAmtText: info.origAmtText,
      discAvail: info.discAvail,
      discAvailText: info.discAvailText,
      internalId: idMatch ? idMatch[1] : '',
      line: lineMatch ? Number(lineMatch[1]) : null,
      // NetSuite numbers rows across the whole list (applyrow1000 is the first row of 1001 to 2000).
      lineIndex: rowIdMatch ? Number(rowIdMatch[1]) : null
    };
  }

  // Reads one row again (same column layout); null when its cells no longer fit the header.
  function rereadRow(tr, layout) {
    const cells = visibleCells(tr);
    return cells.length === layout.width ? readRowCells(tr, cells, layout, globalThis.ApplyFastCore) : null;
  }

  function resolveDiscountInput(row) {
    if (row.discountCell) {
      const input = row.discountCell.querySelector('input[type="text"], input[type="number"]');
      if (input && !input.disabled && !input.readOnly) return input;
    }
    return findEditableDiscountField(row.tr);
  }

  /***********************
   * FRAME AWARENESS
   ***********************/
  function getFrameWithInputs() {
    try {
      const frames = Array.from(window.frames);
      for (const f of frames) {
        try {
          const doc = f.document;
          if (!doc) continue;
          if (findAmountInputs(doc).length > 0) { console.log('ApplyFast: inputs found inside iframe', f.frameElement); return { win: f, doc }; }
        } catch (e) { /* cross-origin or inaccessible frame */ }
      }
    } catch (e) {}
    return { win: window, doc: document };
  }

  /***********************
   * STRICT CREATE PAYMENT DETECTION (custpymt.nl only)
   ***********************/
  function isCreatePaymentPage(doc = document) {
    try {
      const href = (doc && doc.location && doc.location.href) ? doc.location.href.toLowerCase() : '';
      if (!href.includes('custpymt.nl')) return false;

      const hasCustomerInput = !!doc.querySelector('input[name="inpt_customer"], input[id^="inpt_customer"], select[name="inpt_customer"]');
      const hasApplyRange = !!doc.querySelector('input[name="inpt_applyrange"], input[id*="applyrange"], input[role="combobox"]');
      const hasApplySublistHeader = Array.from(doc.querySelectorAll('th, td')).some(td => (td.innerText || '').toLowerCase().includes('apply'));

      if ((hasCustomerInput && hasApplyRange) || (hasApplySublistHeader && hasApplyRange)) return true;

      const title = (doc.title || '').toLowerCase();
      if (title.includes('customer payment') || title.includes('create payment')) return true;
      const h1 = doc.querySelector('h1, .uir-page-title, .page-title, .ns-title');
      if (h1 && (h1.innerText || '').toLowerCase().includes('customer payment')) return true;

      return false;
    } catch (e) {
      console.warn('isCreatePaymentPage detection error', e);
      return false;
    }
  }

  /***********************
   * DRAGGABLE UI
   ***********************/
  function makeDraggable(box, handle) {
    let offsetX = 0, offsetY = 0, dragging = false;
    handle.addEventListener('mousedown', e => {
      dragging = true;
      offsetX = e.clientX - box.offsetLeft;
      offsetY = e.clientY - box.offsetTop;
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      box.style.left = e.clientX - offsetX + 'px';
      box.style.top = e.clientY - offsetY + 'px';
      box.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
      document.body.style.userSelect = '';
    });
  }

  /***********************
   * MONTHLY SUPPORT MESSAGE
   * Optional, once a month. It is not shown when the panel opens, and it never covers
   * cash-application results or a Review & Reconciliation trial offer. A clean Apply only
   * arms it. The results Close button shows it after those results are dismissed, and not
   * while a trial offer is still open. The same premium flag renderApplyResults already
   * computed with licenseActive suppresses it while Review & Reconciliation is usable,
   * including a paid license or an active trial. It does not read or write license state.
   ***********************/
  let monthlySupportAfterClean = false;

  function shouldShowMonthlyMessage() {
    try {
      const now = new Date();
      const isFirstOfMonth = now.getDate() === 1;
      if (!isFirstOfMonth) return false;

      const storageKey = 'applyFast_monthlyMessage_' + now.getFullYear() + '_' + (now.getMonth() + 1);
      const lastShown = localStorage.getItem(storageKey);
      return !lastShown; // Show if not shown this month
    } catch (e) {
      console.error('shouldShowMonthlyMessage error', e);
      return false;
    }
  }

  function markMonthlyMessageShown() {
    try {
      const now = new Date();
      const storageKey = 'applyFast_monthlyMessage_' + now.getFullYear() + '_' + (now.getMonth() + 1);
      localStorage.setItem(storageKey, 'true');
    } catch (e) {
      console.error('markMonthlyMessageShown error', e);
    }
  }

  function showMonthlySupportMessage() {
    try {
      if (document.getElementById('applyFastSupportModal')) return;

      const overlay = document.createElement('div');
      overlay.id = 'applyFastSupportModal';
      Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        bottom: '0',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
      });

      const modal = document.createElement('div');
      Object.assign(modal.style, {
        background: '#ffffff',
        borderRadius: '16px',
        padding: '0',
        maxWidth: '500px',
        width: '90%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        position: 'relative',
        overflow: 'hidden'
      });

      modal.innerHTML = `
        <div style="background:#0F2D4A; color:#fff; padding:20px; text-align:center;">
          <div style="font-size:24px; margin-bottom:8px;">☕</div>
          <h2 style="margin:0; font-size:20px; font-weight:600;">Enjoying ApplyFast?</h2>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 20px 0; font-size:15px; line-height:1.6; color:#333;">
            Cash application is free, including multi-page. Review & Reconciliation stays a separate Premium upgrade. If ApplyFast is saving you time, you can support development. That is optional and does not change what you can use.
          </p>
          <div style="display:flex; gap:12px; flex-direction:column;">
            <a href="https://buymeacoffee.com/jerald23siv" target="_blank" rel="noopener" style="display:block; padding:12px; background:#FFDD00; color:#3D2E00; text-align:center; text-decoration:none; border-radius:8px; font-weight:600; font-size:15px;">Support ApplyFast</a>
            <button id="supportModalClose" style="padding:12px; background:#f0f0f0; color:#666; border:none; border-radius:8px; cursor:pointer; font-weight:500; font-size:14px; transition:background 0.2s;" onmouseover="this.style.background='#e0e0e0';" onmouseout="this.style.background='#f0f0f0';">Not now</button>
          </div>
        </div>
      `;
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const closeBtn = document.getElementById('supportModalClose');
      let closeModal;
      const onEscape = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      };
      closeModal = () => {
        document.removeEventListener('keydown', onEscape);
        markMonthlyMessageShown();
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.3s ease';
        setTimeout(() => {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 300);
      };

      closeBtn.addEventListener('click', closeModal);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
      });
      document.addEventListener('keydown', onEscape);

      // The support link opens its own tab. Record the month and close, without touching Apply.
      const coffeeLink = modal.querySelector('a[href*="buymeacoffee"]');
      if (coffeeLink) {
        coffeeLink.addEventListener('click', () => {
          closeModal();
        });
      }

      console.log('Monthly support message shown');
    } catch (e) {
      console.error('showMonthlySupportMessage error', e);
    }
  }

  // A clean Apply may ask for support later. An unclean Apply clears that. Nothing is shown here.
  function noteMonthlySupportAfterApply(clean) {
    try {
      monthlySupportAfterClean = !!clean;
    } catch (e) {
      console.error('noteMonthlySupportAfterApply error', e);
    }
  }

  // Called only after the results Close button has already removed the results. trialOfferStillOpen
  // means the user dismissed the results before declining or starting the trial, so the support
  // request waits. reconciliationUsable is the premium flag from this results render.
  function maybeShowMonthlySupportAfterResultsClose(trialOfferStillOpen, reconciliationUsable) {
    try {
      if (!monthlySupportAfterClean) return;
      monthlySupportAfterClean = false;
      if (trialOfferStillOpen) return;
      if (reconciliationUsable) return;
      if (applyRun || multiApply) return;
      if (document.getElementById('applyFastSupportModal')) return;
      if (!shouldShowMonthlyMessage()) return;
      showMonthlySupportMessage();
    } catch (e) {
      console.error('maybeShowMonthlySupportAfterResultsClose error', e);
    }
  }

  /***********************
   * LICENSE GATE
   * Cash application is free and never gated, on the loaded page and across all pages: scan, Payment
   * Received, the operational Review (what will be written and why a row will not be), Apply and its
   * results. Premium (capability "reviewReconciliation") is Review & Reconciliation: reconciliation
   * labels, variance remarks and Diff., the cash reconciliation verdict and variances, the Review
   * filters and the Cash Application Report export. Premium is presentation only: renderReview,
   * renderApplyResults and exportReconciliation check licenseActive(); the analysis is always
   * computed and never changes what Apply writes. background.js decides entitlement; this script only
   * asks. Anything other than an explicit { entitled: true } answer that lists the capability keeps
   * Premium locked. No action is gated, so a license change never interrupts a scan or Apply.
   * The banner appears only after a locked Premium control was used.
   * A 14-day trial of that capability is offered only after a clean Apply, from renderApplyResults.
   * background.js is the only writer of afTrial; this script can only request the fixed start.
   ***********************/
  const REVIEW_RECONCILIATION = 'reviewReconciliation';
  const LICENSE_TIMEOUT_MS = 3000;
  const LICENSE_MAX_AGE_MS = 5 * 60 * 1000;
  const LICENSE_TEXT = {
    checking: 'Checking your ApplyFast license…',
    unlicensed: 'ApplyFast Premium adds Review & Reconciliation (reconciliation statuses, variance analysis, Review filters and the Cash Application Report export) and requires an ApplyFast license. Cash application stays free, on this page and across all pages.',
    transition_ended: 'Your ApplyFast transition period has ended. Activate a license to keep using ApplyFast Premium (Review & Reconciliation). Cash application stays free.',
    expired: 'Your ApplyFast license has expired. Renew or activate a license to use ApplyFast Premium (Review & Reconciliation). Cash application stays free.',
    disabled: 'Your ApplyFast license has been disabled. Activate a valid license to use ApplyFast Premium (Review & Reconciliation). Cash application stays free.',
    invalid: 'Your ApplyFast license is not valid. Activate a valid license to use ApplyFast Premium (Review & Reconciliation). Cash application stays free.',
    grace_expired: 'Your ApplyFast license could not be verified for 7 days. Open ApplyFast from the toolbar and click Re-check to use ApplyFast Premium.',
    unavailable: 'Licensing could not be checked. Reload the page to try ApplyFast Premium again.'
  };
  let license = { entitled: false, status: 'checking', answered: false };
  let licenseRequest = null;
  // The capability of the last locked action the user tried; the banner stays hidden until then.
  let licensePrompted = null;
  // Decline dismisses the trial offer for this results object only. Nothing is stored.
  let trialDeclinedCtx = null;

  function askBackground(message) {
    return new Promise(resolve => {
      let done = false;
      const finish = reply => { if (!done) { done = true; clearTimeout(timer); resolve(reply); } };
      const timer = setTimeout(() => finish(null), LICENSE_TIMEOUT_MS);
      try {
        chrome.runtime.sendMessage(message, reply => finish(chrome.runtime.lastError ? null : reply));
      } catch (e) { finish(null); }
    });
  }

  function refreshLicense() {
    if (licenseRequest) return licenseRequest;
    licenseRequest = askBackground({ type: 'license:getEntitlement' }).then(reply => {
      licenseRequest = null;
      if (reply && typeof reply === 'object' && typeof reply.status === 'string') {
        license = { entitled: reply.entitled === true, status: reply.status, answered: true, checkedAt: Date.now(),
          validUntil: Number.isFinite(reply.validUntil) ? reply.validUntil : null,
          capabilities: Array.isArray(reply.capabilities) ? reply.capabilities.filter(c => typeof c === 'string') : [],
          trialWarningDue: reply.trialWarningDue === true, trialConsumed: reply.trialConsumed === true };
      } else if (!license.answered) {
        license = { entitled: false, status: 'unavailable', answered: false };
      }
      renderLicense();
      if (!applyRun && !multiApply) renderReview();
      return license;
    });
    return licenseRequest;
  }

  function watchLicense() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.afLicense || changes.afTransition || changes.afTrial)) refreshLicense();
      });
    } catch (e) { /* the next gated click asks again */ }
  }

  function hasCapability(capability) {
    return license.entitled === true && Array.isArray(license.capabilities) && license.capabilities.includes(capability);
  }

  function renderLicense() {
    const el = document.getElementById('afLicense');
    if (!el) return;
    if (!licensePrompted || hasCapability(licensePrompted)) { el.hidden = true; el.innerHTML = ''; return; }
    const canActivate = license.status !== 'checking' && license.status !== 'unavailable';
    const pricing = canActivate && globalThis.ApplyFastCore && globalThis.ApplyFastCore.LINKS.pricing;
    el.hidden = false;
    el.innerHTML = `<div>${esc(LICENSE_TEXT[license.status] || LICENSE_TEXT.unlicensed)}</div>` +
      (canActivate ? '<button id="afLicenseBtn" class="af-btn af-primary" type="button">Activate license</button>' : '') +
      (pricing ? `<a id="afPricingLink" class="af-license-link" href="${esc(pricing)}" target="_blank" rel="noopener noreferrer">See ApplyFast Premium pricing</a>` : '');
  }

  function openActivation() {
    askBackground({ type: 'license:openActivation' }).then(reply => {
      const el = document.getElementById('afLicense');
      if (!(reply && reply.ok) && el) el.firstElementChild.textContent = 'The activation page could not be opened. Click the ApplyFast icon in the Chrome toolbar to activate.';
    });
  }

  // A cached "entitled" answer is re-asked after LICENSE_MAX_AGE_MS and dropped once its validUntil
  // (transition end or grace end) has passed, so an open tab never relies on it indefinitely.
  // background.js still decides when Lemon Squeezy is actually called.
  function licenseActive(capability) {
    const now = Date.now();
    if (license.entitled && license.validUntil !== null && license.validUntil !== undefined && now >= license.validUntil) {
      license = { entitled: false, status: 'checking', answered: false };
    }
    if (!hasCapability(capability)) return false;
    if (!(now - license.checkedAt < LICENSE_MAX_AGE_MS)) refreshLicense();
    return true;
  }

  // Shows the license banner (Activate license, pricing) for a locked capability.
  function promptLicense(capability) {
    licensePrompted = capability;
    renderLicense();
    refreshLicense();
    const el = document.getElementById('afLicense');
    if (el && !el.hidden && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /***********************
   * UI CREATION
   ***********************/
  // Brand images ship with the extension (web_accessible_resources). The dev fixture has no
  // chrome.runtime, so it resolves them next to this script instead.
  const AF_BRAND_BASE = (() => {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) return chrome.runtime.getURL('icons/brand/');
    } catch (e) { /* fall through */ }
    const src = document.currentScript && document.currentScript.src;
    return src ? new URL('icons/brand/', src).href : 'icons/brand/';
  })();
  const afBrand = name => AF_BRAND_BASE + name;

  function injectStyles() {
    if (document.getElementById('afStyles')) return;
    const style = document.createElement('style');
    style.id = 'afStyles';
    style.textContent = `
#applyFastBox, #afLauncher {
  --af-navy: #0F2D4A; --af-blue: #4DA3FF; --af-blue-ink: #1D6FC4; --af-mint: #34D399; --af-mint-ink: #047857;
  --af-mint-light: #D1FAE5; --af-pale: #E8F4FF; --af-muted: #94A3B8; --af-text: #1E293B; --af-sub: #526077;
  --af-line: #DCE5EF; --af-warn-bg: #FEF3C7; --af-warn-ink: #92400E; --af-bad-bg: #FEE2E2; --af-bad-ink: #B42318;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
}
#applyFastBox {
  position: fixed; z-index: 9999; top: 12px; left: 12px; right: auto;
  width: min(920px, calc(100vw - 24px)); height: auto;
  min-height: min(720px, calc(100vh - 24px)); max-height: calc(100vh - 24px);
  display: flex; flex-direction: column; background: #fff; color: var(--af-text); border: 1px solid var(--af-line);
  border-radius: 12px; box-shadow: 0 12px 40px rgba(15,45,74,.18), 0 2px 8px rgba(15,45,74,.08);
  overflow: hidden; font-size: 13px; line-height: 1.45; box-sizing: border-box; text-align: left;
}
#applyFastBox *, #applyFastBox *::before, #applyFastBox *::after { box-sizing: border-box; }
#applyFastBox.af-anim { animation: afIn .16s ease-out; }
@keyframes afIn { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }
#applyFastBox #afHeader {
  flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 6px 10px 6px 10px; background: var(--af-navy); color: #fff; cursor: move; user-select: none;
}
#applyFastBox .af-brand { display: flex; align-items: center; gap: 8px; flex: none; min-height: 36px; }
#applyFastBox .af-brand-bolt {
  display: block; flex: none; width: 18px; height: 34px; max-width: none; margin: 0; padding: 0; border: 0;
  /* applyfast-mark.png centres the bolt with 10% / 29% transparent padding; show just the bolt. */
  object-fit: contain; object-view-box: inset(10% 29%);
  pointer-events: none; -webkit-user-drag: none;
}
/* -1px offsets the space the font reserves above the capitals, so the visible text centres on the bolt. */
#applyFastBox .af-brand-text { display: flex; flex-direction: column; gap: 2px; transform: translateY(-1px); }
#applyFastBox .af-brand-name { font-size: 20px; font-weight: 800; line-height: 20px; letter-spacing: -.2px; color: #fff; }
#applyFastBox .af-brand-name span { color: var(--af-mint); }
#applyFastBox .af-brand-sub { font-size: 10px; font-weight: 500; line-height: 12px; letter-spacing: .2px; color: #C9DDF2; white-space: nowrap; }
#applyFastBox .af-winbtns { display: flex; gap: 2px; }
#applyFastBox .af-winbtn {
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #C9DDF2;
  font-family: inherit; font-size: 17px; line-height: 1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}
#applyFastBox .af-winbtn:hover { background: rgba(255,255,255,.12); color: #fff; }
#applyFastBox #afBody { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 45% 55%; grid-template-rows: minmax(0, 1fr); }
#applyFastBox .af-left {
  min-height: 0; overflow: hidden; background: #F7FAFD; border-right: 1px solid var(--af-line);
  display: flex; flex-direction: column;
}
#applyFastBox .af-left-scroll {
  flex: 1 1 auto; min-height: 0; overflow: auto; padding: 14px 16px 12px; display: flex; flex-direction: column; gap: 10px;
}
/* The left column sets the workspace height; the preview scrolls inside whatever height that gives. */
#applyFastBox .af-right { min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 14px 16px 12px; contain: size; }
#applyFastBox .af-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .9px; color: var(--af-navy); text-transform: uppercase; }
#applyFastBox .af-label { display: block; margin: 0 0 5px; padding: 0; font-size: 11px; font-weight: 700; letter-spacing: .6px; color: var(--af-sub); text-transform: uppercase; }
#applyFastBox .af-help { margin: -3px 0 5px; font-size: 12px; color: var(--af-sub); }
#applyFastBox .af-steps { display: flex; gap: 6px; list-style: none; margin: 0; padding: 0; counter-reset: afstep; }
#applyFastBox .af-steps li { counter-increment: afstep; flex: 1; display: flex; gap: 5px; align-items: center; font-size: 11px; color: var(--af-sub); line-height: 1.25; }
#applyFastBox .af-steps li::before {
  content: counter(afstep); flex: none; width: 18px; height: 18px; border-radius: 50%; background: var(--af-pale);
  color: var(--af-navy); font-weight: 700; font-size: 10px; display: inline-flex; align-items: center; justify-content: center;
}
#applyFastBox .af-op { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; background: #fff; border: 1px solid var(--af-line); font-size: 12px; }
#applyFastBox .af-op-badge {
  flex: none; display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; background: #EEF2F6; color: var(--af-navy);
}
#applyFastBox .af-op-badge::before { content: ''; width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid currentColor; }
#applyFastBox .af-op-text { color: var(--af-sub); min-width: 0; }
#applyFastBox .af-op[data-op="scanning"] .af-op-badge, #applyFastBox .af-op[data-op="applying"] .af-op-badge { background: var(--af-pale); color: var(--af-blue-ink); }
#applyFastBox .af-op[data-op="scanning"] .af-op-badge::before, #applyFastBox .af-op[data-op="applying"] .af-op-badge::before { background: currentColor; animation: afPulse 1.2s ease-in-out infinite; }
#applyFastBox .af-op[data-op="ready"] .af-op-badge, #applyFastBox .af-op[data-op="previewed"] .af-op-badge { background: var(--af-pale); color: var(--af-navy); }
#applyFastBox .af-op[data-op="ready"] .af-op-badge::before, #applyFastBox .af-op[data-op="previewed"] .af-op-badge::before { background: currentColor; }
#applyFastBox .af-op[data-op="complete"] .af-op-badge { background: var(--af-mint-light); color: var(--af-mint-ink); }
#applyFastBox .af-op[data-op="complete"] .af-op-badge::before { content: '\\2713'; width: auto; height: auto; border: 0; }
#applyFastBox .af-op[data-op="stopped"] .af-op-badge { background: var(--af-warn-bg); color: var(--af-warn-ink); }
#applyFastBox .af-op[data-op="stopped"] .af-op-badge::before { border-radius: 1px; background: currentColor; }
#applyFastBox .af-op[data-op="halted"] .af-op-badge { background: var(--af-bad-bg); color: var(--af-bad-ink); }
#applyFastBox .af-op[data-op="halted"] .af-op-badge::before { content: '!'; width: auto; height: auto; border: 0; }
@keyframes afPulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
#applyFastBox .af-license {
  display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 9px 11px; border-radius: 8px;
  background: var(--af-warn-bg); border: 1px solid #FDE68A; color: var(--af-warn-ink); font-size: 12px; font-weight: 600;
}
#applyFastBox .af-license[hidden] { display: none; }
#applyFastBox .af-license-link { color: var(--af-warn-ink); font-weight: 600; text-decoration: underline; }
#applyFastBox #afMode { border: 0; margin: 0; padding: 0; min-width: 0; }
#applyFastBox .af-modes-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
#applyFastBox .af-mode {
  display: flex; gap: 8px; align-items: flex-start; margin: 0; padding: 9px 10px; border: 1px solid var(--af-line);
  border-radius: 8px; background: #fff; cursor: pointer; transition: border-color .15s, background-color .15s;
}
#applyFastBox .af-mode:hover { border-color: var(--af-blue); }
#applyFastBox .af-mode:has(input:checked) { border-color: var(--af-blue); background: var(--af-pale); box-shadow: inset 0 0 0 1px var(--af-blue); }
#applyFastBox .af-mode:has(input:disabled) { opacity: .6; cursor: not-allowed; }
#applyFastBox .af-mode:focus-within { outline: 2px solid var(--af-blue); outline-offset: 2px; }
#applyFastBox .af-mode input { margin: 2px 0 0; accent-color: var(--af-navy); }
#applyFastBox .af-mode b { display: block; font-size: 13px; color: var(--af-navy); }
#applyFastBox .af-mode small { display: block; font-size: 11px; color: var(--af-sub); line-height: 1.35; }
#applyFastBox .af-refs { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 150px; }
#applyFastBox #matchListArea {
  width: 100%; flex: 1 1 120px; min-height: 110px; resize: none; margin: 0; padding: 9px 10px;
  font: 12.5px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace; color: var(--af-text); background: #fff;
  border: 1px solid #C5D3E2; border-radius: 8px;
}
#applyFastBox #matchListArea::placeholder { color: #8A97A8; }
#applyFastBox #matchListArea:focus { outline: none; border-color: var(--af-blue); box-shadow: 0 0 0 3px rgba(77,163,255,.25); }
#applyFastBox #matchListArea[readonly] { background: #F1F5F9; }
#applyFastBox .af-cash[hidden] { display: none; }
#applyFastBox #afPaymentReceived {
  width: 100%; margin: 0; padding: 7px 10px; font-family: inherit; font-size: 13px; line-height: 1.4; font-variant-numeric: tabular-nums; color: var(--af-text);
  background: #fff; border: 1px solid #C5D3E2; border-radius: 8px;
}
#applyFastBox #afPaymentReceived:focus { outline: none; border-color: var(--af-blue); box-shadow: 0 0 0 3px rgba(77,163,255,.25); }
#applyFastBox #afPaymentReceived[aria-invalid="true"] { border-color: var(--af-bad-ink); }
#applyFastBox #afPaymentReceived[readonly] { background: #F1F5F9; }
#applyFastBox .af-cash-msg { margin: 4px 0 0; color: var(--af-bad-ink); font-weight: 600; }
#applyFastBox .af-req { color: var(--af-bad-ink); }
#applyFastBox .af-cash-msg[hidden] { display: none; }
#applyFastBox .af-details { font-size: 12px; color: var(--af-sub); border: 1px solid var(--af-line); border-radius: 8px; background: #fff; }
#applyFastBox .af-details summary { cursor: pointer; padding: 7px 10px; font-weight: 600; color: var(--af-navy); list-style: none; }
#applyFastBox .af-details summary::-webkit-details-marker { display: none; }
#applyFastBox .af-details summary::before { content: '\\25B8'; display: inline-block; width: 14px; transition: transform .15s; }
#applyFastBox .af-details[open] summary::before { transform: rotate(90deg); }
#applyFastBox .af-details-body { padding: 0 10px 9px; line-height: 1.55; }
#applyFastBox .af-details-body p { margin: 0 0 5px; }
#applyFastBox code { background: var(--af-pale); color: var(--af-navy); padding: 1px 5px; border-radius: 4px; font: 11.5px ui-monospace, Consolas, monospace; }
#applyFastBox .af-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; margin: 0; padding: 9px 12px;
  border-radius: 8px; border: 1px solid transparent; font-family: inherit; font-size: 13px; font-weight: 600; line-height: 1.2;
  cursor: pointer; transition: background-color .15s, border-color .15s;
}
#applyFastBox .af-btn:disabled { cursor: not-allowed; }
#applyFastBox .af-block { width: 100%; }
#applyFastBox .af-primary { background: var(--af-blue); color: var(--af-navy); }
#applyFastBox .af-primary:hover:not(:disabled) { background: #3A95F5; }
#applyFastBox .af-apply { background: var(--af-navy); color: #fff; }
#applyFastBox .af-apply:hover:not(:disabled) { background: #173E63; }
#applyFastBox .af-secondary { background: #fff; color: var(--af-navy); border-color: #C5D3E2; }
#applyFastBox .af-secondary:hover:not(:disabled) { border-color: var(--af-blue); background: var(--af-pale); }
#applyFastBox .af-stop { background: var(--af-bad-ink); color: #fff; }
#applyFastBox .af-stop:hover:not(:disabled) { background: #912018; }
#applyFastBox .af-btn:focus-visible, #applyFastBox .af-winbtn:focus-visible, #applyFastBox a:focus-visible,
#applyFastBox .af-details summary:focus-visible, #afLauncher:focus-visible, #applyFastBox input[type="checkbox"]:focus-visible {
  outline: 2px solid var(--af-blue); outline-offset: 2px;
}
#applyFastBox #matchCounter { font-size: 12px; text-align: center; color: var(--af-sub); font-weight: 500; margin-top: -4px; }
/* Stays in view when the left column has to scroll (short windows). */
#applyFastBox .af-review-row { display: flex; gap: 8px; position: sticky; bottom: 0; z-index: 2; margin: -4px -16px -6px; padding: 4px 16px 6px; background: #F7FAFD; }
#applyFastBox .af-review-row #matchBtn { flex: 1 1 auto; width: auto; }
#applyFastBox .af-reset { flex: none; color: var(--af-sub); }
#applyFastBox .af-help.af-help-note { color: var(--af-blue-ink); font-weight: 600; }
#applyFastBox .af-reset-confirm { padding: 10px 12px; border-radius: 8px; background: #fff; border: 1px solid #C5D3E2; font-size: 12px; line-height: 1.45; color: var(--af-text); }
#applyFastBox .af-reset-confirm[hidden] { display: none; }
#applyFastBox .af-reset-confirm b { display: block; font-size: 13px; color: var(--af-navy); }
#applyFastBox .af-reset-confirm .af-actions { position: static; justify-content: flex-end; margin-top: 8px; }
#applyFastBox .af-notice.af-reset-note { background: var(--af-pale); border-color: #CFE3F8; color: var(--af-navy); }
#applyFastBox .af-foot {
  flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 8px 16px 10px;
  border-top: 1px solid var(--af-line); background: #F7FAFD; font-size: 11px; color: var(--af-sub);
  box-shadow: 0 -4px 10px -8px rgba(15,45,74,.25);
}
#applyFastBox .af-foot-note { flex: 1 1 100%; }
#applyFastBox .af-foot a { color: var(--af-blue-ink); text-decoration: none; font-weight: 600; }
#applyFastBox .af-foot a:hover { text-decoration: underline; }
#applyFastBox .af-foot #buyCoffeeBtn { color: #3D2E00; background: #FFDD00; padding: 3px 9px; border-radius: 999px; }
#applyFastBox .af-right-head { flex: none; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
#applyFastBox .af-right-note { font-size: 11px; color: var(--af-sub); text-align: right; }
#applyFastBox #afPreview { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 8px; overflow: auto; font-size: 12px; color: var(--af-text); }
#applyFastBox #afPreview > * { flex: none; }
#applyFastBox #afPreview:empty { align-items: center; justify-content: center; border: 1px dashed #C5D3E2; border-radius: 10px; background: #FBFDFF; }
#applyFastBox #afPreview:empty::before {
  content: 'No cash application preview yet.\\A Paste payment references, then click Review Cash Application.\\A Nothing is written until you click Apply.';
  white-space: pre-line; text-align: center; color: var(--af-sub); font-size: 12px; line-height: 1.8; padding: 24px;
}
#applyFastBox .af-table-wrap { flex: 1 1 160px !important; min-height: 120px; overflow: auto; border: 1px solid var(--af-line); border-radius: 8px; background: #fff; }
#applyFastBox .af-table { width: 100%; border-collapse: collapse; font-size: 11.5px; table-layout: fixed; white-space: normal; margin: 0; }
#applyFastBox .af-table th {
  position: sticky; top: 0; z-index: 1; background: #F1F5F9; color: var(--af-sub); font-weight: 600; font-size: 11px;
  text-align: left; padding: 6px; border-bottom: 1px solid var(--af-line); vertical-align: bottom; white-space: normal;
}
#applyFastBox .af-table td { padding: 5px 6px; border-bottom: 1px solid #EEF2F6; vertical-align: top; overflow-wrap: anywhere; white-space: normal; color: var(--af-text); }
#applyFastBox .af-table .num { text-align: right; font-variant-numeric: tabular-nums; }
#applyFastBox .af-table tr.af-page td { background: var(--af-pale); color: var(--af-navy); font-weight: 600; }
#applyFastBox .af-table tr.af-skip td { color: #64748B; }
#applyFastBox .af-table tr.af-loaded td { background: #F2F8FF; }
#applyFastBox .af-sub-line { color: #64748B; font-size: 10.5px; font-weight: 400; }
#applyFastBox .af-st { display: inline-flex; align-items: baseline; gap: 4px; max-width: 100%; padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 700; line-height: 1.35; }
#applyFastBox .af-st::before { font-size: 10px; }
#applyFastBox .af-st.ok { background: var(--af-mint-light); color: var(--af-mint-ink); }
#applyFastBox .af-st.ok::before { content: '\\2713'; }
#applyFastBox .af-st.warn { background: var(--af-warn-bg); color: var(--af-warn-ink); }
#applyFastBox .af-st.warn::before { content: '\\26A0'; }
#applyFastBox .af-st.bad { background: var(--af-bad-bg); color: var(--af-bad-ink); }
#applyFastBox .af-st.bad::before { content: '\\2715'; }
#applyFastBox .af-st.muted { background: #EEF2F6; color: var(--af-sub); }
#applyFastBox .af-st.muted::before { content: '\\2022'; }
#applyFastBox .af-ow { display: flex; align-items: center; gap: 4px; margin: 3px 0 0; font-size: 11px; color: var(--af-sub); cursor: pointer; }
#applyFastBox .af-recon { margin-top: 2px; font-size: 10.5px; font-weight: 700; color: var(--af-navy); }
#applyFastBox .af-recon[data-recon="SHORT_PAYMENT"], #applyFastBox .af-recon[data-recon="OVERPAYMENT"],
#applyFastBox .af-recon[data-recon="NEEDS_REVIEW"], #applyFastBox .af-recon[data-recon="UNMATCHED"] { color: var(--af-warn-ink); }
#applyFastBox .af-filters { display: flex; flex-wrap: wrap; gap: 5px; margin: 0; }
#applyFastBox .af-filter {
  padding: 2px 8px; border-radius: 999px; border: 1px solid var(--af-line); background: #fff; color: var(--af-navy);
  font-family: inherit; font-size: 11.5px; font-weight: 600; line-height: 1.5; cursor: pointer;
}
#applyFastBox .af-filter[aria-pressed="true"] { background: var(--af-navy); border-color: var(--af-navy); color: #fff; }
#applyFastBox .af-filter:focus-visible { outline: 2px solid var(--af-blue); outline-offset: 1px; }
#applyFastBox .af-locked { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: 1px dashed #C5D3E2; border-radius: 8px; background: #FBFDFF; }
#applyFastBox .af-locked-text { flex: 1 1 auto; min-width: 0; font-size: 11.5px; line-height: 1.4; color: var(--af-sub); }
#applyFastBox .af-locked-text b { display: block; font-size: 12px; color: var(--af-navy); }
#applyFastBox .af-locked .af-btn { flex: none; padding: 5px 10px; font-size: 12px; }
#applyFastBox .af-ow-all { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 12px; color: var(--af-text); cursor: pointer; }
#applyFastBox .af-sum { padding: 10px 12px; border-radius: 10px; background: var(--af-pale); border: 1px solid #CFE3F8; line-height: 1.5; }
#applyFastBox .af-sum.done { background: #F0FDF7; border-color: #A7F3D0; }
#applyFastBox .af-sum.warn { background: #FFFBEB; border-color: #FDE68A; }
#applyFastBox .af-sum.bad { background: #FEF2F2; border-color: #FECACA; }
#applyFastBox .af-sum-title { display: block; font-size: 15px; font-weight: 700; color: var(--af-navy); }
#applyFastBox .af-sum.done .af-sum-title { color: var(--af-mint-ink); }
#applyFastBox .af-sum.warn .af-sum-title { color: var(--af-warn-ink); }
#applyFastBox .af-sum.bad .af-sum-title { color: var(--af-bad-ink); }
#applyFastBox .af-sum-sub { font-size: 12px; color: var(--af-sub); }
#applyFastBox .af-sum-warn { margin-top: 4px; color: var(--af-warn-ink); font-weight: 600; font-size: 12px; }
#applyFastBox .af-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
#applyFastBox .af-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 11.5px;
  font-weight: 600; background: #fff; border: 1px solid var(--af-line); color: var(--af-navy);
}
#applyFastBox .af-chip.ok { background: var(--af-mint-light); border-color: #A7F3D0; color: var(--af-mint-ink); }
#applyFastBox .af-chip.ok::before { content: '\\2713'; }
#applyFastBox .af-chip.warn { background: var(--af-warn-bg); border-color: #FDE68A; color: var(--af-warn-ink); }
#applyFastBox .af-chip.warn::before { content: '\\26A0'; }
#applyFastBox .af-chip.bad { background: var(--af-bad-bg); border-color: #FECACA; color: var(--af-bad-ink); }
#applyFastBox .af-chip.bad::before { content: '\\2715'; }
#applyFastBox .af-chip.muted { color: var(--af-sub); }
#applyFastBox .af-progress { height: 8px; margin-top: 6px; border-radius: 999px; background: #E2E8F0; overflow: hidden; }
#applyFastBox .af-progress > span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--af-blue), var(--af-mint)); transition: width .25s ease; }
#applyFastBox .af-notice { padding: 9px 11px; border-radius: 8px; background: var(--af-warn-bg); border: 1px solid #FDE68A; color: var(--af-warn-ink); white-space: pre-wrap; }
#applyFastBox .af-list-title { font-size: 12px; font-weight: 700; color: var(--af-warn-ink); }
#applyFastBox .af-list-title.muted { color: var(--af-sub); }
#applyFastBox .af-list-help { font-size: 11px; color: var(--af-sub); }
#applyFastBox .af-list-body {
  max-height: 110px; overflow: auto; margin-top: 3px; padding: 6px 8px; font-size: 11px; color: #475569;
  white-space: pre-wrap; background: #F8FAFC; border: 1px solid #EEF2F6; border-radius: 6px;
}
#applyFastBox .af-actions { display: flex; gap: 8px; position: sticky; bottom: 0; background: #fff; padding-top: 2px; }
#applyFastBox .af-note { font-size: 11px; color: var(--af-sub); }
#applyFastBox .af-status { padding: 10px 12px; border-radius: 10px; background: var(--af-pale); border: 1px solid #CFE3F8; line-height: 1.6; }
#applyFastBox .af-status b { color: var(--af-navy); }
#applyFastBox .af-wait { color: var(--af-warn-ink); }
#applyFastBox #afScan { font-size: 12px; color: var(--af-text); }
#applyFastBox .af-scan-intro { padding: 8px 10px; border-radius: 8px; background: var(--af-pale); border: 1px solid #CFE3F8; color: #1E3A5F; line-height: 1.45; font-size: 11.5px; }
#applyFastBox .af-scan-intro b { color: var(--af-navy); }
#applyFastBox .af-scan-btns { display: flex; gap: 8px; margin-top: 8px; }
#applyFastBox .af-scan-status { margin-top: 8px; padding: 8px 10px; background: #fff; border: 1px solid var(--af-line); border-radius: 8px; line-height: 1.5; }
#applyFastBox .af-scan-pages { max-height: 120px; overflow: auto; margin-top: 6px; border: 1px solid var(--af-line); border-radius: 8px; background: #fff; }
#applyFastBox .af-ok-text { color: var(--af-mint-ink); }
#applyFastBox .af-warn-text { color: var(--af-warn-ink); }
#applyFastBox .af-muted-text { color: var(--af-sub); }
#afLauncher {
  position: fixed; z-index: 9999; right: 16px; top: 132px; width: 44px; height: 44px; margin: 0; padding: 0;
  border-radius: 11px; border: 0; background: transparent; box-shadow: 0 4px 14px rgba(15,45,74,.28);
  cursor: pointer; display: flex; align-items: center; justify-content: center; touch-action: none; box-sizing: border-box;
  transition: box-shadow .15s, transform .15s;
}
#afLauncher > img {
  display: block; width: 100%; height: 100%; max-width: none; margin: 0; padding: 0; border: 0;
  pointer-events: none; -webkit-user-drag: none;
}
#afLauncher[hidden] { display: none; }
#afLauncher:hover { box-shadow: 0 6px 18px rgba(15,45,74,.26); transform: translateY(-1px); }
#afLauncher .af-tip {
  position: absolute; right: calc(100% + 10px); top: 50%; transform: translateY(-50%); padding: 6px 10px; border-radius: 8px;
  background: var(--af-navy); color: #fff; white-space: nowrap; font-size: 11px; line-height: 1.35; text-align: left;
  pointer-events: none; opacity: 0; transition: opacity .12s; box-shadow: 0 4px 12px rgba(15,45,74,.25);
}
#afLauncher[data-side="right"] .af-tip { right: auto; left: calc(100% + 10px); }
#afLauncher .af-tip b { display: block; font-size: 13px; }
#afLauncher .af-tip span { color: #C9DDF2; }
#afLauncher:hover .af-tip, #afLauncher:focus-visible .af-tip { opacity: 1; }
#afLauncher[data-dragging] .af-tip { opacity: 0; }
#afLauncher[data-busy]::after {
  content: ''; position: absolute; top: 0; right: 0; width: 10px; height: 10px; border-radius: 50%;
  background: var(--af-mint); border: 2px solid #fff; animation: afPulse 1.2s ease-in-out infinite;
}
@media (max-width: 760px) {
  #applyFastBox { width: calc(100vw - 16px); height: calc(100vh - 16px); }
  #applyFastBox #afBody { grid-template-columns: 1fr; grid-auto-rows: max-content; overflow: auto; }
  #applyFastBox .af-left { min-height: auto; overflow: visible; border-right: 0; border-bottom: 1px solid var(--af-line); }
  #applyFastBox .af-left-scroll { overflow: visible; }
  #applyFastBox .af-foot { position: sticky; bottom: 0; z-index: 1; }
  #applyFastBox .af-right { min-height: 440px; max-height: calc(100vh - 90px); }
}
@media (prefers-reduced-motion: reduce) {
  #applyFastBox, #applyFastBox *, #applyFastBox *::before, #afLauncher, #afLauncher *, #afLauncher::after { animation: none !important; transition: none !important; }
}`;
    (document.head || document.documentElement).appendChild(style);
  }

  function placeWorkspace(box, center) {
    const w = box.offsetWidth, h = box.offsetHeight;
    const maxLeft = Math.max(8, window.innerWidth - w - 8), maxTop = Math.max(8, window.innerHeight - h - 8);
    const left = center ? (window.innerWidth - w) / 2 : box.offsetLeft;
    const top = center ? (window.innerHeight - h) / 2 : box.offsetTop;
    box.style.left = Math.round(Math.min(Math.max(8, left), maxLeft)) + 'px';
    box.style.top = Math.round(Math.min(Math.max(8, top), maxTop)) + 'px';
    box.style.right = 'auto';
  }

  // A drag of 5px or more moves the launcher instead of opening the workspace.
  function makeLauncherDraggable(btn, onActivate) {
    let start = null, moved = false;
    btn.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const r = btn.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      moved = false;
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    });
    btn.addEventListener('pointermove', e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      moved = true;
      btn.dataset.dragging = '1';
      const size = btn.offsetWidth;
      const left = Math.min(Math.max(4, start.left + dx), window.innerWidth - size - 4);
      const top = Math.min(Math.max(4, start.top + dy), window.innerHeight - size - 4);
      Object.assign(btn.style, { left: left + 'px', top: top + 'px', right: 'auto' });
      btn.dataset.side = left < 240 ? 'right' : 'left';
    });
    const end = () => { start = null; delete btn.dataset.dragging; };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('click', e => {
      if (moved) { moved = false; e.preventDefault(); return; }
      onActivate();
    });
  }

  async function createUI() {
    try {
      if (document.getElementById('applyFastBox')) return;
      injectStyles();
      const afLinks = (globalThis.ApplyFastCore && globalThis.ApplyFastCore.LINKS) || {};

      const box = document.createElement('div');
      box.id = 'applyFastBox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'ApplyFast, Cash Application Assistant');
      box.style.display = 'none';

      box.innerHTML = `
        <div id="afHeader">
          <span class="af-brand" role="img" aria-label="ApplyFast, Cash Application Assistant">
            <img class="af-brand-bolt" src="${afBrand('applyfast-mark.png')}" alt="" draggable="false">
            <span class="af-brand-text" aria-hidden="true"><span class="af-brand-name">Apply<span>Fast</span></span><span class="af-brand-sub">Cash Application Assistant</span></span>
          </span>
          <div class="af-winbtns">
            <button id="afMinimizeBtn" class="af-winbtn" type="button" title="Minimize to the ApplyFast button" aria-label="Minimize">&#8211;</button>
          </div>
        </div>
        <div id="afBody" style="display:none;">
          <section class="af-left" aria-label="Cash application">
            <div class="af-left-scroll">
            <div class="af-eyebrow">Cash Application</div>
            <ol class="af-steps" aria-label="Steps">
              <li>Paste references</li>
              <li>Review cash application</li>
              <li>Apply, then Save in NetSuite</li>
            </ol>
            <div id="afLicense" class="af-license" role="status" aria-live="polite" hidden></div>
            <div id="afOpStatus" class="af-op" role="status" aria-live="polite"></div>
            <fieldset id="afMode">
              <legend class="af-label">Mode</legend>
              <div class="af-modes-row">
                <label class="af-mode"><input type="radio" name="afMode" value="single" checked><span><b>This page only</b><small>Apply to the current transaction list.</small></span></label>
                <label class="af-mode"><input type="radio" name="afMode" value="multi"><span><b>All pages</b><small>Scan and apply across all transaction pages.</small></span></label>
              </div>
            </fieldset>
            <div id="afScan" style="display:none;"></div>
            <div id="afCash" class="af-cash">
              <label class="af-label" for="afPaymentReceived">Payment Received <span class="af-req" aria-hidden="true">*</span></label>
              <div class="af-help" id="afCashHelp">Required. Actual cash received from the customer. Apply never applies more than this and enters it as the NetSuite Payment Amount.</div>
              <input id="afPaymentReceived" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="1,000.00" required aria-required="true" aria-describedby="afCashHelp afCashMsg">
              <div id="afCashMsg" class="af-help af-cash-msg" role="alert" hidden></div>
            </div>
            <div class="af-refs">
              <label class="af-label" for="matchListArea">Payment References</label>
              <div class="af-help" id="afRefsHelp">Paste invoice, PO, or sublist line references.</div>
              <textarea id="matchListArea" aria-describedby="afRefsHelp" spellcheck="false" placeholder="INV12345=1250.00&#10;PO67890=439.26&#10;INV999|10.00|100.00&#10;&#10;Or paste Excel columns:&#10;Ref | Amount  or  Ref | Discount | Amount"></textarea>
            </div>
            <details class="af-details">
              <summary>Formats and safety rules</summary>
              <div class="af-details-body">
                <p><code>REF=100.00</code> payment &middot; <code>REF|discount|payment</code>. US amounts only. A <code>REF</code> without an amount is shown in the Review but never applied: every application needs an amount.</p>
                <p>2-column (Ref | Amount) and 3-column (Ref | Discount | Amount) Excel paste is converted automatically. A Discount of <code>0</code> or an accounting <code>-</code> means no discount.</p>
                <p>Pasting a list or spreadsheet rows replaces the references in the box; Ctrl+Z undoes it. Select part of the text first to paste over just that part.</p>
                <p>Invalid amounts, duplicate lines and partial or ambiguous matches are skipped, never guessed. Existing Payments are kept unless you choose to overwrite.</p>
              </div>
            </details>
            <div class="af-review-row">
              <button id="matchBtn" class="af-btn af-primary af-block" type="button">Review Cash Application</button>
              <button id="afResetBtn" class="af-btn af-secondary af-reset" type="button" title="Clear the references, the review and the rows ApplyFast ticked on this page. Nothing saved in NetSuite is changed.">Reset</button>
            </div>
            <div id="afResetConfirm" class="af-reset-confirm" role="group" aria-labelledby="afResetTitle" hidden></div>
            <div id="matchCounter" aria-live="polite">0 cash application matches</div>
            </div>
            <div class="af-foot">
              <span class="af-foot-note">Nothing is written until you click Apply. ApplyFast never saves; you Save in NetSuite.</span>
              ${afLinks.website ? `<a id="guideLink" href="${esc(afLinks.website)}" target="_blank" rel="noopener noreferrer">Official Website</a>` : ''}
              ${afLinks.demo ? `<a id="afDemoLink" href="${esc(afLinks.demo)}" target="_blank" rel="noopener noreferrer" title="Try ApplyFast on fictional data, outside NetSuite">Interactive Demo</a>` : ''}
              <a id="buyCoffeeBtn" href="https://buymeacoffee.com/jerald23siv" target="_blank" rel="noopener">&#9749; Buy Me a Coffee</a>
            </div>
          </section>
          <section class="af-right" aria-label="Cash application preview">
            <div class="af-right-head">
              <div class="af-eyebrow">Cash Application Preview</div>
              <div id="afPreviewNote" class="af-right-note">Nothing has been written yet.</div>
            </div>
            <div id="afPreview"></div>
          </section>
        </div>
      `;

      document.body.appendChild(box);

      const launcher = document.createElement('button');
      launcher.id = 'afLauncher';
      launcher.type = 'button';
      launcher.setAttribute('aria-label', 'Open ApplyFast, Cash Application Assistant');
      launcher.setAttribute('aria-controls', 'applyFastBox');
      launcher.setAttribute('aria-expanded', 'false');
      launcher.innerHTML = `<img src="${afBrand('applyfast-launcher-128.png')}" alt="" draggable="false"><span class="af-tip" aria-hidden="true"><b>ApplyFast</b><span>Cash Application Assistant</span></span>`;
      document.body.appendChild(launcher);

      const header = document.getElementById('afHeader');
      const body = document.getElementById('afBody');
      const minimizeBtn = document.getElementById('afMinimizeBtn');

      // Opening and minimizing only change visibility; scans, Preview and Apply keep running.
      let placed = false;
      const openWorkspace = () => {
        box.style.display = '';
        body.style.display = '';
        placeWorkspace(box, !placed);
        placed = true;
        launcher.hidden = true;
        launcher.setAttribute('aria-expanded', 'true');
        box.classList.remove('af-anim');
        void box.offsetWidth;
        box.classList.add('af-anim');
      };
      const collapseWorkspace = () => {
        box.style.display = 'none';
        body.style.display = 'none';
        launcher.hidden = false;
        launcher.setAttribute('aria-expanded', 'false');
      };

      minimizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (body.style.display === 'none') openWorkspace();
        else {
          const hadFocus = box.contains(document.activeElement);
          collapseWorkspace();
          if (hadFocus) launcher.focus();
        }
      });
      makeLauncherDraggable(launcher, () => {
        openWorkspace();
        const area = document.getElementById('matchListArea');
        if (area) area.focus({ preventScroll: true });
      });
      window.addEventListener('resize', () => { if (box.style.display !== 'none') placeWorkspace(box, false); });
      // The height follows the left column (e.g. the All pages scan section); keep the box on screen.
      if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => { if (box.style.display !== 'none') placeWorkspace(box, false); }).observe(box);
      }

      makeDraggable(box, header);

      const matchBtn = document.getElementById('matchBtn');
      if (matchBtn) matchBtn.onclick = () => (panelMode === 'multi' ? previewAllPages() : previewInvoices());
      box.dataset.state = 'idle';
      updateOpStatus();
      const licenseBox = document.getElementById('afLicense');
      if (licenseBox) licenseBox.onclick = (e) => { if (e.target.id === 'afLicenseBtn') openActivation(); };
      watchLicense();
      refreshLicense();
      document.querySelectorAll('input[name="afMode"]').forEach(radio => {
        radio.addEventListener('change', () => { if (radio.checked) setMode(radio.value); });
      });
      const scanBox = document.getElementById('afScan');
      if (scanBox) scanBox.onclick = (e) => {
        if (multiApply) return;
        if (e.target.id === 'afScanStart') startScan();
        else if (e.target.id === 'afScanStop') {
          if (scanRun && scanRun.auto && !scanRun.auto.done) { scanRun.auto.stopRequested = true; renderScan(); }
          else stopScan();
        }
      };

      // Paste: spreadsheet rows become ApplyFast syntax, and a pasted remittance replaces the old one
      // (core.pasteEdit decides the range).
      const matchListArea = document.getElementById('matchListArea');
      if (matchListArea) {
        matchListArea.addEventListener('input', () => {
          if (preview && !applyRun) invalidatePreview('The pasted lines changed. Click Review Cash Application again.');
          if (multiPreview) invalidateMultiPreview('The pasted lines changed. Click Review Cash Application again.');
        });
        matchListArea.addEventListener('keydown', () => showRefsNote(''));
        matchListArea.addEventListener('paste', (e) => {
          const core = globalThis.ApplyFastCore;
          if (!core) return;
          e.preventDefault();
          if (matchListArea.readOnly) return;
          const pastedText = (e.clipboardData || window.clipboardData).getData('text');
          const edit = core.pasteEdit(matchListArea.value, matchListArea.selectionStart, matchListArea.selectionEnd, pastedText);
          replaceRefsText(matchListArea, edit);
          showRefsNote(edit.mode === 'replace' ? 'Replaced the previous references with the pasted remittance. Ctrl+Z undoes this.' : '');
        });
      }
      const cashInput = document.getElementById('afPaymentReceived');
      if (cashInput) {
        cashInput.addEventListener('input', () => {
          renderCashInput();
          if (!applyRun && !multiApply) renderReview();
        });
      }
      const resetBtn = document.getElementById('afResetBtn');
      if (resetBtn) resetBtn.onclick = () => requestReset();
      const resetConfirm = document.getElementById('afResetConfirm');
      if (resetConfirm) {
        resetConfirm.onclick = (e) => {
          if (e.target.id === 'afResetCancel') closeResetConfirm(true);
          else if (e.target.id === 'afResetConfirmBtn') { closeResetConfirm(false); resetWorkspace(); }
        };
        resetConfirm.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeResetConfirm(true); } });
      }

      console.log('createUI completed');
    } catch (e) { console.error('createUI error', e); }
  }

  /***********************
   * INPUT PARSING + MATCH (US-only)
   * Supports formats:
   * - INV123=100.00 (invoice with payment amount)
   * - INV123|10.00|100.00 (invoice with discount and payment amount)
   * - INV123 (no amount): matched and shown in the Review, never applied
   * Parsing and validation live in applyfast-core.js. Invalid and duplicate lines are
   * skipped and reported; an amount is never taken from Amt. Due, Payment Received or
   * any other balance. Flow: parse -> read the Invoices rows once -> match in memory ->
   * plan -> write. No sublist reads happen between writes.
   ***********************/
  function parseInput() {
    const core = globalThis.ApplyFastCore;
    if (!core) return { valid: [], skipped: [], coreMissing: true };
    const area = document.getElementById('matchListArea');
    const { entries, valid } = core.parseInput(area ? area.value : '');
    return { valid, skipped: entries.filter(e => e.status !== 'OK'), coreMissing: false };
  }

  function skipReason(result) {
    switch (result.status) {
      case 'NOT_FOUND': return 'Not found in the loaded Invoices rows';
      case 'PARTIAL_REF_MATCH': return 'Only partially matches an invoice; use the exact Ref No.';
      default: return result.reason;
    }
  }

  // Protected NetSuite write sequence (sandbox-proven in 1.5). Do not reorder or simplify.
  // The only change from 1.5: the Disc. Taken input is resolved during the read phase
  // and re-resolved here only if NetSuite replaced it.
  function writeRow({ row, checkbox, amountInput, finalAmt, discountAmt, discountInput: plannedDiscountInput, matchedKey }) {
        const formattedUS = (typeof finalAmt === 'number' && !isNaN(finalAmt))
          ? finalAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : '0.00';

        checkbox.checked = true;

        // If input is numeric type, try valueAsNumber; otherwise set text formatted string
        try {
          if (amountInput.type === 'number' && 'valueAsNumber' in amountInput) {
            amountInput.valueAsNumber = Number(finalAmt);
          } else {
            amountInput.value = formattedUS;
          }
        } catch (e) {
          amountInput.value = formattedUS;
        }

        amountInput.dispatchEvent(new Event('input', { bubbles: true }));
        amountInput.dispatchEvent(new Event('change', { bubbles: true }));

        // Handle discount if provided
        if (discountAmt !== null && !isNaN(discountAmt) && discountAmt > 0) {
          // Use the helper function to find editable discount field (Disc. Taken)
          const discountInput = (plannedDiscountInput && plannedDiscountInput.isConnected) ? plannedDiscountInput : findEditableDiscountField(row);

          if (discountInput) {
            const formattedDiscount = discountAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            
            // Set the value
            try {
              if (discountInput.type === 'number' && 'valueAsNumber' in discountInput) {
                discountInput.valueAsNumber = Number(discountAmt);
              } else {
                discountInput.value = formattedDiscount;
              }
            } catch (e) {
              discountInput.value = formattedDiscount;
            }
            
            // Trigger focus first (NetSuite fields often need this)
            discountInput.focus();
            
            // Trigger events in the order NetSuite expects
            discountInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            discountInput.dispatchEvent(new Event('keyup', { bubbles: true, cancelable: true }));
            discountInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            discountInput.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
            
            // Also try to trigger the onchange handler directly if it exists
            if (typeof discountInput.onchange === 'function') {
              try {
                discountInput.onchange();
              } catch (e) {
                console.log('Could not trigger onchange directly:', e);
              }
            }
            
            console.log('✅ Applied discount', discountAmt, 'formatted as', formattedDiscount, 'for', matchedKey);
          } else {
            console.warn('⚠️ Discount amount provided (', discountAmt, ') but discount input field not found for', matchedKey);
            console.log('Row HTML snippet:', row.innerHTML.substring(0, 500));
          }
        }

        console.log('matched row', matchedKey, 'finalAmt', finalAmt, 'formattedUS', formattedUS, discountAmt !== null ? 'discount: ' + discountAmt : '');
  }

  function describeSkipped(skipped, limit) {
    const lines = skipped.slice(0, limit).map(e => `${e.lineNo ? `Line ${e.lineNo}: ` : ''}${e.raw} - ${e.reason}`);
    if (skipped.length > limit) lines.push(`...and ${skipped.length - limit} more`);
    return lines.join('\n');
  }

  /***********************
   * PREVIEW -> APPLY
   * Preview only reads NetSuite fields (no writes, no events). Apply is an explicit click;
   * it re-checks the page and every row against the Preview state, then writes approved
   * rows through writeRow, yielding between chunks so progress and Stop stay responsive.
   ***********************/
  // Rows written between yields to the browser. 0 = single pass (no progress/Stop).
  const APPLY_CHUNK_SIZE = 50;

  const STATUS_LABELS = {
    READY: 'Ready', ALREADY_APPLIED: 'Already applied', HAS_PAYMENT: 'Has Payment', HAS_DISCOUNT: 'Has Discount',
    INCONSISTENT: 'Inconsistent', UNREADABLE: 'Unreadable', CHANGED: 'Changed since Preview'
  };

  let preview = null;
  let applyRun = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtUS(n) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function setPanelState(state) {
    const box = document.getElementById('applyFastBox');
    if (box) box.dataset.state = state;
    updateOpStatus();
  }

  const OP_STATUS = {
    idle: ['Idle', 'Enter Payment Received and paste payment references, then review the cash application.', 'Nothing has been written yet.'],
    idleMulti: ['Idle', 'Scan all pages first, then paste payment references.', 'Nothing has been written yet.'],
    scanning: ['Scanning', 'Reading every page. You can stop at any time.', 'Nothing has been written yet.'],
    ready: ['Ready to review', 'All pages scanned. Enter Payment Received and paste references, then review.', 'Nothing has been written yet.'],
    previewed: ['Previewed', 'Review each status. Apply when ready.', 'Nothing has been written yet.'],
    applying: ['Applying', 'Writing payments. Stop is available.', 'Applying now. ApplyFast never saves.'],
    resetting: ['Resetting', 'Unticking the rows ApplyFast applied on each page.', 'Resetting now. ApplyFast never saves.'],
    complete: ['Complete', 'Review the results, then Save in NetSuite when ready.', 'Review, then Save in NetSuite.'],
    stopped: ['Stopped', 'Apply was stopped. Review what was applied.', 'Review, then Save in NetSuite.'],
    halted: ['Halted', 'Apply halted for safety. Review the results.', 'Review, then Save in NetSuite.']
  };
  let opScan = { running: false, complete: false };

  // Presentation only: derived from the panel state, the scan view and the result kind.
  function updateOpStatus() {
    const box = document.getElementById('applyFastBox');
    const el = document.getElementById('afOpStatus');
    if (!box || !el) return;
    const state = box.dataset.state || 'idle';
    let op;
    if (state.startsWith('applying')) op = 'applying';
    else if (state.startsWith('resetting')) op = 'resetting';
    else if (state.startsWith('done')) op = box.dataset.outcome || 'complete';
    else if (state.startsWith('previewed')) op = 'previewed';
    else if (opScan.running) op = 'scanning';
    else if (opScan.complete) op = 'ready';
    else op = panelMode === 'multi' ? 'idleMulti' : 'idle';
    if (el.dataset.key !== op) {
      const [label, text, note] = OP_STATUS[op];
      el.dataset.key = op;
      el.dataset.op = op === 'idleMulti' ? 'idle' : op;
      el.innerHTML = `<span class="af-op-badge">${label}</span><span class="af-op-text">${text}</span>`;
      const noteEl = document.getElementById('afPreviewNote');
      if (noteEl) noteEl.textContent = note;
    }
    const launcher = document.getElementById('afLauncher');
    const busy = op === 'applying' || op === 'scanning' || op === 'resetting';
    if (launcher) launcher.toggleAttribute('data-busy', busy);
    const resetBtn = document.getElementById('afResetBtn');
    if (resetBtn) {
      resetBtn.disabled = busy;
      if (resetBtn.disabled) closeResetConfirm(false);
    }
  }

  function snapshotSignature(core, snapshot) {
    return core.pageSignature({ customerId: snapshot.customerId, rangeText: snapshot.rangeText, refs: snapshot.rows.map(r => r.ref) });
  }

  // The loaded Invoices rows as plain values. A row without a NetSuite row number is numbered by its
  // position on the page, as core.matchLoadedPage numbers it, so plan items find it again at Apply.
  function loadedRowValues(snapshot) {
    const range = globalThis.ApplyFastCore.parseRange(snapshot.rangeText);
    const start = range ? range.start : 1;
    return snapshot.rows.map((r, i) => {
      const values = liveRowValues(r);
      if (!Number.isInteger(values.lineIndex)) values.lineIndex = start - 1 + i;
      return values;
    });
  }

  // This page only: the loaded rows are the collected data. Matching, the plan, Payment Received and
  // the analysis are the same core pipeline All pages uses, with matchLoadedPage instead of a scan.
  function previewInvoices() {
    if (applyRun || multiApply) return;
    const core = globalThis.ApplyFastCore;
    const area = document.getElementById('matchListArea');
    const { valid, skipped: invalid, coreMissing } = parseInput();
    if (coreMissing) {
      console.error('ApplyFast: applyfast-core.js is not loaded');
      alert('ApplyFast could not load its parser. Please reload the page.');
      return;
    }
    if (!valid.length) {
      clearPreview();
      alert(invalid.length ? 'No valid lines to apply.\n\n' + describeSkipped(invalid, 10) : 'Paste invoice numbers first.');
      return;
    }
    if (!requirePaymentReceived()) { clearPreview(); return; }

    const t0 = performance.now();
    const snapshot = readApplyRows(getFrameWithInputs().doc);
    if (snapshot.error) {
      console.warn('ApplyFast: snapshot failed -', snapshot.error, snapshot.columns || '');
      clearPreview();
      alert(snapshot.error + '\n\nNothing was changed.');
      return;
    }
    const t1 = performance.now();
    const rows = loadedRowValues(snapshot);
    const { scan, match } = core.matchLoadedPage(valid, { customerId: snapshot.customerId, rangeText: snapshot.rangeText, rows });
    const plan = core.buildPagePlan(match);
    const items = core.buildMultiApplyPlan(plan, scan);
    // A row this page cannot write is held in the Review instead of being skipped at Apply.
    const byLine = new Map(rows.map(r => [r.lineIndex, r]));
    items.forEach(it => {
      const row = byLine.get(it.lineIndex);
      if (!row || it.state.status === 'UNPLANNABLE') return;
      const reason = !row.writable ? 'Row has no Apply checkbox or Payment field'
        : it.discount && !row.discountEditable ? 'Disc. Taken field not found or not editable; line not applied' : '';
      if (reason) it.state = { status: 'UNPLANNABLE', overwritable: false, reason };
    });
    core.decideMultiWrites(items);
    const t2 = performance.now();

    multiPreview = null;
    preview = { single: true, inputText: area ? area.value : '', signature: snapshotSignature(core, snapshot), scan, match, plan, items, invalid, filter: 'ALL' };
    renderReview();
    setPanelState('previewed');
    console.log('ApplyFast preview', {
      invoiceRows: snapshot.rows.length,
      unrecognizedRows: snapshot.unrecognizedRows,
      range: snapshot.rangeText,
      planned: plan.rowCount,
      ready: items.filter(it => it.willWrite).length,
      skipped: plan.skipped.length + invalid.length,
      readMs: Math.round(t1 - t0),
      matchMs: Math.round(t2 - t1)
    });
  }

  function clearPreview() {
    preview = null;
    const box = document.getElementById('afPreview');
    if (box) box.innerHTML = '';
    setPanelState('idle');
  }

  function invalidatePreview(message) {
    preview = null;
    const box = document.getElementById('afPreview');
    if (box) box.innerHTML = `<div class="af-notice">${esc(message)}</div>`;
    setPanelState('idle');
  }

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  function amountsText(payment, discount) {
    return payment + (discount ? ' / ' + discount : '');
  }

  function progressBarHtml(done, total, label) {
    const pct = total ? Math.round(done / total * 100) : 0;
    return `<div class="af-progress" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="width:${pct}%;"></span></div>`;
  }

  // Writes the final write plan of the This page only Review: the same per-line writes and read-back
  // as each page of All pages, on the loaded page and without switching pages.
  async function applyPreview() {
    if (!preview || applyRun || multiApply) return;
    const core = globalThis.ApplyFastCore;
    const area = document.getElementById('matchListArea');
    if (!area || area.value !== preview.inputText) {
      invalidatePreview('The pasted lines changed after Preview. Nothing was changed. Click Review Cash Application again.');
      return;
    }
    const doc = getFrameWithInputs().doc;
    const snapshot = readApplyRows(doc);
    if (snapshot.error || snapshotSignature(core, snapshot) !== preview.signature) {
      invalidatePreview('The NetSuite page changed after Preview (customer, page or rows). Nothing was changed. Click Review Cash Application again.');
      return;
    }
    // The same final write plan the Review showed; the plan items in preview stay as planned.
    const final = cashWritePlan(preview, preview.scan);
    if (final.applyBlocked) return;
    const pages = core.orderApplyPages(final.items);
    const toWrite = pages.length ? pages[0].items : [];
    if (!toWrite.length) return;
    const trs = new Map(loadedRowValues(snapshot).map((values, i) => [values.lineIndex, snapshot.rows[i].tr]));
    const rowFor = item => {
      const tr = trs.get(item.lineIndex);
      const row = tr && tr.isConnected ? rereadRow(tr, snapshot.layout) : null;
      if (row && !Number.isInteger(row.lineIndex)) row.lineIndex = item.lineIndex;
      return row;
    };

    preview = null;
    const ctx = applyRun = {
      core, single: true, doc, items: final.items, recon: final.results, planned: toWrite.length, applied: 0, writing: 0,
      auto: { done: false, interrupted: '' }, stopRequested: false, completed: false, halt: '', returnNote: '', phase: 'Writing rows…',
      appliedBefore: appliedTotal(doc), paymentDelta: 0, t0: performance.now()
    };
    renderApplying(ctx);
    setPanelState('applying');
    setApplyingUi(true);
    renderApplyProgress(ctx);
    try {
      if (enterPaymentAmount(ctx, final.cash)) {
        const written = await writeApplyUnits(ctx, toWrite, rowFor);
        ctx.completed = !ctx.halt && toWrite.every(it => it.result || written.includes(it));
        if (written.length) {
          ctx.phase = 'Checking results…';
          renderApplyProgress(ctx);
          applyReadBack(ctx, written, rowFor);
        }
      }
    } catch (e) {
      console.error('ApplyFast apply error', e);
      if (!ctx.halt) ctx.halt = 'An unexpected error occurred';
    }
    finishApply(ctx, '');
  }

  function updateCounter(matchedOnThisPage, skipped) {
    const counter = document.getElementById('matchCounter');
    if (!counter) return;
    const currentText = counter.textContent || '';
    const m = currentText.match(/^(\d+) cash application match/i) || currentText.match(/Matched:\s*(\d+)/i);
    const prev = m ? Number(m[1]) : 0;
    const total = prev + (matchedOnThisPage || 0);
    const skippedCount = skipped ? skipped.length : 0;
    counter.textContent = `${total} cash application match${total === 1 ? '' : 'es'}` + (skippedCount ? ` · Skipped ${skippedCount} line(s) - hover for details` : '');
    counter.style.color = skippedCount ? '#92400E' : '';
    counter.title = skippedCount ? describeSkipped(skipped, 25) : '';
  }

  /***********************
   * MULTI-PAGE SCAN (assisted pagination)
   * The user changes the NetSuite range by hand; ApplyFast never changes it. While a scan runs,
   * the loaded page is watched with cheap reads and indexed once its rows agree with the range
   * and nothing has changed for SETTLE_QUIET_MS. Scanning and Preview all pages only read.
   ***********************/
  const SCAN_POLL_MS = 250;
  let panelMode = 'single';
  let scanRun = null;
  let multiPreview = null;

  function setMode(next) {
    if (applyRun || multiApply || next === panelMode) return;
    panelMode = next;
    clearPreview();
    multiPreview = null;
    if (next !== 'multi') stopScan();
    const scanBox = document.getElementById('afScan');
    if (scanBox) scanBox.style.display = next === 'multi' ? 'block' : 'none';
    renderScan();
  }

  /***********************
   * PAYMENT RECEIVED
   * ApplyFast's own field for the cash actually received, in both modes (free), and the one source of
   * the cash amount. It is required: Review does not start and Apply is blocked (core.buildCashWritePlan)
   * until it is a valid amount. core.buildCashWritePlan limits the amounts Apply writes (a derived write
   * plan; the plan itself is unchanged), and Apply enters it as NetSuite's Payment Amount before any row
   * (enterPaymentAmount). Applied, Unapplied and To Apply are left to NetSuite.
   ***********************/
  let cashRequired = false;

  function readPaymentReceived() {
    const core = globalThis.ApplyFastCore;
    const input = document.getElementById('afPaymentReceived');
    return core.parsePaymentReceived(input ? input.value : '');
  }

  function renderCashInput() {
    const input = document.getElementById('afPaymentReceived');
    const msg = document.getElementById('afCashMsg');
    if (!input || !msg || !globalThis.ApplyFastCore) return;
    const cash = readPaymentReceived();
    if (cash.status === 'VALID') cashRequired = false;
    const text = cash.status === 'INVALID' ? `${cash.reason}. The cash cannot be reconciled until this is corrected.`
      : cash.status === 'EMPTY' && cashRequired ? 'Enter Payment Received, the cash received from the customer. It is required.' : '';
    input.dataset.cashStatus = cash.status;
    if (text) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    msg.hidden = !text;
    msg.textContent = text;
  }

  // Review in either mode starts only with a valid Payment Received; otherwise the field says why.
  function requirePaymentReceived() {
    if (readPaymentReceived().status === 'VALID') return true;
    cashRequired = true;
    renderCashInput();
    const input = document.getElementById('afPaymentReceived');
    if (input) { input.focus(); input.scrollIntoView({ block: 'nearest' }); }
    return false;
  }

  // The final write plan of a Review (either mode): the plan items limited by Payment Received
  // (core.buildCashWritePlan), and its normalized reconciliation results. The Review shows them and
  // Apply writes the same items; the plan itself is not changed.
  function cashWritePlan(mp, scan) {
    const core = globalThis.ApplyFastCore;
    const cash = readPaymentReceived();
    const final = core.buildCashWritePlan({
      match: mp.match, plan: mp.plan, items: mp.items, scan, invalid: mp.invalid, actualCashReceived: cash.actualCashReceived
    });
    return Object.assign({ cash }, final, { results: core.buildReconciliationResults(final) });
  }

  // Cash Application Report of the full results (never the filtered rows), plus the write results
  // after Apply. A download only: nothing on the NetSuite page is read or changed. Premium: the
  // Review and Results render the button only when licenseActive(), and an upgrade prompt otherwise.
  function exportReconciliation(results, applied) {
    const core = globalThis.ApplyFastCore;
    if (!core || !results || !results.rows.length || results.applyBlocked) return;
    if (!licenseActive(REVIEW_RECONCILIATION)) { promptLicense(REVIEW_RECONCILIATION); return; }
    const model = core.buildReconciliationExport(results, applied);
    const blob = new Blob([core.buildXlsx(model)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = model.fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Cash summary of a Review, from the reconciliation results summary. Free: Payment Received input
  // status, the cash totals, the shortfall warning and what Apply enters. Premium adds the
  // reconciliation verdict, the variance figures and the cash remarks.
  function cashSummaryHtml(results, premium) {
    const summary = results.summary;
    const money = n => (n === null || n === undefined ? '-' : fmtUS(n));
    const attrs = `id="afCashSummary" data-cash-input="${esc(summary.cashInputStatus)}" data-cash-status="${esc(summary.cashStatus)}"`;
    const reviewOnly = '<div class="af-note" style="margin-top:4px;">Applied below is limited by Payment Received, and Apply writes exactly those amounts. Apply enters Payment Received as the NetSuite Payment Amount.</div>';
    if (summary.cashInputStatus !== 'OK') {
      const why = summary.cashInputStatus === 'INVALID' ? 'Payment Received is not a valid amount. Correct it before applying.'
        : 'Enter Payment Received to reconcile the cash received. It is required before applying.';
      const title = premium ? 'Cash reconciliation: needs review' : 'Payment Received';
      return `<div class="af-sum warn" ${attrs}><b class="af-sum-title">${title}</b>` +
        `<div class="af-sum-sub">${esc(why)} The invoice statuses below are not affected.</div></div>`;
    }
    const shortNote = summary.shortPaymentAmount > 0
      ? `<div class="af-sum-warn">Payment Received does not cover the planned Payments: ${money(summary.shortPaymentAmount)} short.</div>` : '';
    const totals = `Payment Received ${money(summary.actualCashReceived)} · Applied ${money(summary.totalApplied)} · Unapplied ${money(summary.unappliedAmount)}`;
    if (!premium) {
      return `<div class="af-sum" ${attrs}><div class="af-sum-sub" data-cash-totals>Cash: ${totals}</div>${shortNote}${reviewOnly}</div>`;
    }
    const RS = globalThis.ApplyFastCore.RECON_STATUS;
    const titles = { [RS.EXACT]: 'Cash reconciled', [RS.SHORT_PAYMENT]: 'Partial/Short payment', [RS.OVERPAYMENT]: 'Overpayment', [RS.NEEDS_REVIEW]: 'Cash reconciliation: needs review' };
    const tone = summary.cashStatus === RS.EXACT ? 'done' : 'warn';
    const variances = [
      summary.shortPaymentAmount > 0 ? `<span data-cash-figure="short">Partial/Short Payment ${money(summary.shortPaymentAmount)}</span>` : '',
      summary.overpaymentAmount > 0 ? `<span data-cash-figure="over">Overpayment ${money(summary.overpaymentAmount)}</span>` : ''
    ].filter(Boolean).join(' · ');
    return `<div class="af-sum ${tone}" ${attrs}><b class="af-sum-title">${esc(titles[summary.cashStatus] || summary.cashStatus)}</b>` +
        `<div class="af-sum-sub">${totals}</div>` +
      (variances ? `<div class="af-sum-sub">${variances}</div>` : '') +
      `<div class="af-sum-sub">${esc(summary.cashRemarks)}</div>${shortNote}${reviewOnly}</div>`;
  }

  function startScan() {
    const core = globalThis.ApplyFastCore;
    if (!core) return;
    stopScan();
    const doc = getFrameWithInputs().doc;
    const customerInput = doc.querySelector('input[name="customer"]');
    scanRun = {
      scan: core.createScan(customerInput ? customerInput.value : ''),
      doc, settle: null, readFp: null, lastRead: null, firstRow: null, rowGen: 0, pageSize: null, notice: null, html: '',
      auto: createAuto(), detachInput: null,
      timer: setInterval(scanTick, SCAN_POLL_MS)
    };
    watchUserInput(scanRun);
    scanTick();
  }

  function stopScan() {
    if (scanRun) {
      clearInterval(scanRun.timer);
      if (scanRun.detachInput) scanRun.detachInput();
    }
    scanRun = null;
    if (multiPreview) clearPreview();
    multiPreview = null;
    renderScan();
  }

  // Cheap reading for the settle gate: range, customer, NetSuite row numbers and a change marker.
  // A new first-row element (NetSuite replaced the rows) or different first/last row text changes the marker.
  function observePage(run) {
    if (!run.doc.defaultView) run.doc = getFrameWithInputs().doc;
    const doc = run.doc;
    const table = findInvoicesTable(doc);
    const trs = table ? table.querySelectorAll('tr[id^="applyrow"]') : [];
    const lineIndexes = Array.from(trs, tr => {
      const m = /^applyrow(\d+)$/.exec(tr.id);
      return m ? Number(m[1]) : NaN;
    });
    const first = trs[0] || null;
    const last = trs[trs.length - 1] || null;
    if (first !== run.firstRow) { run.firstRow = first; run.rowGen++; }
    const rangeInput = doc.querySelector('input[name="inpt_applyrange"]');
    const customerInput = doc.querySelector('input[name="customer"]');
    return {
      customerId: customerInput ? customerInput.value : '',
      rangeText: rangeInput ? rangeInput.value : '',
      lineIndexes,
      signal: run.rowGen + '|' + (first ? first.textContent : '') + '|' + (last ? last.textContent : '')
    };
  }

  function scanTick() {
    const run = scanRun;
    const core = globalThis.ApplyFastCore;
    if (!run || !core) return;
    try {
      const obs = observePage(run);
      run.settle = core.settleStep(run.settle, obs, performance.now());
      const range = core.parseRange(obs.rangeText);
      if (range && (range.end < range.total || range.start === 1)) run.pageSize = range.end - range.start + 1;
      if (run.settle.settled && run.settle.fp !== run.readFp) readScanPage(run, obs);
      if (run.auto && !run.auto.done && !run.auto.busy) autoStep(run, obs);
    } catch (e) {
      console.warn('ApplyFast scan error', e);
    }
    renderScan();
  }

  function staleCount(scan) {
    let n = 0;
    scan.pages.forEach(p => { if (p.stale) n++; });
    return n;
  }

  // A row as plain values (no DOM references). internalId identifies the transaction; it is not used for matching.
  function scanRowValues(r) {
    const discInput = r.discountCell ? r.discountCell.querySelector('input[type="text"], input[type="number"]') : null;
    return {
      ref: r.ref, po: r.po, type: r.type, otherCells: r.otherCells, amtDue: r.amtDue, amtDueText: r.amtDueText,
      date: r.date, origAmt: r.origAmt, origAmtText: r.origAmtText, discAvail: r.discAvail, discAvailText: r.discAvailText,
      lineIndex: r.lineIndex, line: r.line, internalId: r.internalId || '',
      checked: !!(r.checkbox && r.checkbox.checked),
      payment: r.amountInput ? (r.amountInput.value || '') : '',
      discount: discInput ? (discInput.value || '') : ''
    };
  }

  // Full read of a settled page into the scan.
  function readScanPage(run, obs) {
    const core = globalThis.ApplyFastCore;
    const snapshot = readApplyRows(run.doc);
    if (snapshot.error) {
      run.readFp = run.settle.fp;
      run.notice = { warn: true, text: snapshot.error };
      run.lastRead = { fp: run.readFp, problem: { code: 'DETAILS', reason: snapshot.error } };
      return;
    }
    const rows = snapshot.rows.map(scanRowValues);
    // The page changed between the cheap reading and this one: try again on the next tick.
    if (rows.map(r => r.lineIndex).join(',') !== obs.lineIndexes.join(',')) return;

    const staleBefore = staleCount(run.scan);
    const result = core.addPage(run.scan, { customerId: snapshot.customerId, rangeText: snapshot.rangeText, rows });
    run.readFp = run.settle.fp;
    if (!result.ok) {
      run.notice = { warn: true, text: result.code === 'CUSTOMER_CHANGED' ? 'The customer changed. Click Rescan All Pages to scan this customer.' : result.reason };
      run.lastRead = { fp: run.readFp, problem: { code: result.code === 'CUSTOMER_CHANGED' ? 'CUSTOMER' : result.code, reason: run.notice.text } };
      if (multiPreview) invalidateMultiPreview(run.notice.text);
      return;
    }
    const newlyStale = staleCount(run.scan) > staleBefore;
    const moved = result.changes.find(c => c.code !== 'DETAILS');
    const details = result.changes.find(c => c.code === 'DETAILS');
    const firstChange = result.changes[0];
    run.lastRead = {
      fp: run.readFp,
      problem: firstChange ? { code: firstChange.code, reason: `${firstChange.reason} on ${snapshot.rangeText}` }
        : result.dropped.length ? { code: 'RANGE', reason: 'The page size changed' }
        : newlyStale ? { code: 'TOTAL', reason: 'The list changed, so other pages must be scanned again' } : null
    };
    let text = `Scanned ${snapshot.rangeText}` + (result.replaced ? ' again' : '') + '.';
    if (newlyStale) text += ' Rows moved or the list changed, so other pages must be scanned again.';
    else if (result.dropped.length) text += ` The page size changed; ${result.dropped.length} earlier page(s) must be scanned again.`;
    else if (details) text += ' Some values on this page changed since the last scan; the scan was updated.';
    run.notice = { warn: newlyStale || !!result.dropped.length || !!moved, text };

    const changed = !result.replaced || result.changes.length || result.dropped.length || newlyStale;
    if (multiPreview && changed) {
      invalidateMultiPreview(newlyStale || moved ? 'Rows moved on a scanned page, so the scan must be completed again.'
        : details ? `Values changed on ${snapshot.rangeText} since Preview.` : 'The scan changed since Preview.');
    }
  }

  /***********************
   * AUTOMATIC SCAN
   * Start scan visits every page by clicking the options of NetSuite's own range dropdown, the
   * same path as choosing a page by hand (sandbox-verified). DOM events only: the hidden range
   * value is never set, and rows, Apply boxes, Payment, Disc. Taken and Save are never touched.
   * Each switch is ready only when the settle gate passes after the click (the range text leads
   * the rows by seconds). Any surprise, user input, Stop or a 15 s timeout ends navigation.
   ***********************/
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function createAuto() {
    return { phase: 'init', busy: false, done: false, stopRequested: false, interrupted: '', plan: null, expected: null, queue: [], target: null, requestedAt: 0, message: null };
  }

  function rangeControl(doc) {
    const input = doc.querySelector('input[name="inpt_applyrange"]');
    return { input, field: doc.getElementById('apply_applyrange_fs') || (input && input.closest('span')) };
  }

  function fireMouse(el, types) {
    const view = el.ownerDocument.defaultView;
    types.forEach(type => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view, button: 0 })));
  }

  // Visible options of the open range dropdown, keyed by their text. One XPath query per call.
  function visibleRangeOptions(doc, total) {
    const core = globalThis.ApplyFastCore;
    const found = doc.evaluate("//*[self::div or self::span or self::li or self::a or self::td][not(*)][contains(., ' to ') and contains(., ' of ')]",
      doc.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const options = new Map();
    for (let i = 0; i < found.snapshotLength; i++) {
      const el = found.snapshotItem(i);
      if (el.closest('#apply_splits, #applyFastBox')) continue;
      if (!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)) continue;
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      const range = core.parseRange(text);
      if (!range || (total && range.total !== total)) continue;
      if (!options.has(text)) options.set(text, el);
    }
    return options;
  }

  async function openRangeDropdown(doc, total) {
    const { input } = rangeControl(doc);
    if (!input) return null;
    let options = visibleRangeOptions(doc, total);
    if (options.size) return { trigger: input, options };
    fireMouse(input, ['mousedown', 'mouseup', 'click']);
    for (let i = 0; i < 4; i++) {
      await sleep(i ? 150 : 50);
      options = visibleRangeOptions(doc, total);
      if (options.size) return { trigger: input, options };
    }
    return null;
  }

  async function closeRangeDropdown(doc, trigger, total) {
    if (!visibleRangeOptions(doc, total).size) return;
    fireMouse(trigger, ['mousedown', 'mouseup', 'click']);
    await sleep(100);
  }

  function blurRangeControl(doc) {
    const { input } = rangeControl(doc);
    if (input && doc.activeElement === input) input.blur();
  }

  function editingTransactionList(doc) {
    const el = doc.activeElement;
    return !!(el && el.closest && el.closest('[id$="_splits"]') && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'hidden');
  }

  const SCAN_INPUT_TEXTS = {
    range: 'Scan stopped because the range was changed by hand. Pages read so far are kept.',
    list: 'Scan stopped because the page was edited or is being interacted with.'
  };

  // Real (trusted) user input stops navigation; ApplyFast's own synthetic events are ignored.
  // texts.customer, when given, also watches the customer field.
  function watchUserInput(run, texts = SCAN_INPUT_TEXTS) {
    const doc = run.doc;
    const handler = e => {
      const auto = run.auto;
      if (!e.isTrusted || !auto || auto.done || auto.interrupted) return;
      const t = e.target;
      if (!t || !t.closest || t.closest('#applyFastBox')) return;
      const { input, field } = rangeControl(doc);
      if (t === input || (field && field.contains(t))) {
        if (e.type === 'mousedown' || e.type === 'keydown') auto.interrupted = texts.range;
        return;
      }
      if (t.closest('[id$="_splits"]')) auto.interrupted = texts.list;
      else if (texts.customer && (/^(inpt_)?customer/.test(t.name || '') || t.closest('#customer_fs, [id^="customer_"][id$="_fs"]'))) auto.interrupted = texts.customer;
    };
    const types = ['mousedown', 'keydown', 'input', 'change', 'paste'];
    types.forEach(type => doc.addEventListener(type, handler, true));
    run.detachInput = () => types.forEach(type => doc.removeEventListener(type, handler, true));
  }

  function autoPagesScanned(run) {
    const core = globalThis.ApplyFastCore;
    const coverage = core.scanCoverage(run.scan);
    const plan = run.auto.plan;
    const fresh = coverage.pages.filter(p => !p.stale).length;
    return { fresh, total: plan ? plan.pages.length : core.scanPageList(coverage, run.pageSize).length, complete: coverage.complete };
  }

  function pageLabel(run, page) {
    const plan = run.auto.plan;
    const index = plan ? plan.pages.findIndex(p => p.start === page.start) : -1;
    return index >= 0 ? `page ${index + 1} of ${plan.pages.length} (${page.text})` : page.text;
  }

  function endAuto(run, text, warn) {
    const auto = run.auto;
    auto.done = true;
    auto.phase = 'finished';
    auto.message = { warn, text };
    const { input } = rangeControl(run.doc);
    if (input && auto.expected && visibleRangeOptions(run.doc, auto.expected.total).size) fireMouse(input, ['mousedown', 'mouseup', 'click']);
    blurRangeControl(run.doc);
    if (run.detachInput) { run.detachInput(); run.detachInput = null; }
    console.log('ApplyFast automatic scan', { result: text, scan: globalThis.ApplyFastCore.scanCoverage(run.scan) });
  }

  function stoppedText(run) {
    const s = autoPagesScanned(run);
    return `Scan stopped — ${s.fresh} of ${s.total} pages scanned.`;
  }

  function finishAuto(run) {
    const s = autoPagesScanned(run);
    const plan = run.auto.plan;
    if (plan && plan.capped) endAuto(run, `Automatic scan stopped at the ${plan.cap}-page safety limit (${s.fresh} of ${s.total} pages scanned). Review the scanned pages before continuing.`, true);
    else if (s.complete) endAuto(run, `Scan complete — ${s.fresh} page${s.fresh === 1 ? '' : 's'} scanned.`, false);
    else endAuto(run, `Scan finished, but ${s.total - s.fresh} page(s) still need scanning.`, true);
  }

  function autoStep(run, obs) {
    const core = globalThis.ApplyFastCore;
    const auto = run.auto;
    const settle = run.settle;
    if (auto.interrupted) return endAuto(run, auto.interrupted, true);

    if (auto.phase === 'init') {
      if (auto.stopRequested) return endAuto(run, stoppedText(run), true);
      if (!settle.settled || settle.fp !== run.readFp) return;
      autoInit(run, obs);
      return;
    }

    if (auto.phase === 'wait') {
      const status = core.autoNavStatus(settle, auto.requestedAt, performance.now());
      if (status === 'TIMEOUT') {
        return endAuto(run, `Scan stopped — ${pageLabel(run, auto.target)} did not finish loading within ${Math.round(core.AUTO_NAV_TIMEOUT_MS / 1000)} seconds. Pages read so far are kept.`, true);
      }
      if (status !== 'READY' || settle.fp !== run.readFp) return;
      const check = core.verifyAutoPage(auto.expected, auto.target, { customerId: obs.customerId, range: settle.range, rows: obs.lineIndexes.length });
      if (!check.ok) return endAuto(run, `Scan stopped (${check.code}): ${check.reason}.`, true);
      const read = run.lastRead;
      if (read && read.fp === settle.fp && read.problem) return endAuto(run, `Scan stopped (${read.problem.code}): ${read.problem.reason}.`, true);
      if (auto.target.returning) return finishAuto(run);
      auto.phase = 'next';
    }

    if (auto.phase === 'next') {
      if (auto.stopRequested) return endAuto(run, stoppedText(run), true);
      if (editingTransactionList(run.doc)) return endAuto(run, 'Scan stopped because the page was edited or is being interacted with.', true);
      const plan = auto.plan;
      let target;
      if (auto.queue.length) {
        target = plan.pages[auto.queue.shift()];
      } else {
        const start = plan.pages[plan.startIndex];
        if (settle.range && settle.range.start === start.start && settle.range.end === start.end) return finishAuto(run);
        target = Object.assign({ returning: true }, start);
      }
      autoNavigate(run, target);
    }
  }

  async function autoInit(run, obs) {
    const core = globalThis.ApplyFastCore;
    const auto = run.auto;
    auto.busy = true;
    try {
      const range = run.settle.range;
      if (range && range.start === 1 && range.end === range.total) {
        auto.plan = core.planAutoScan([obs.rangeText.trim()], obs.rangeText);
        finishAuto(run);
        return;
      }
      const opened = range ? await openRangeDropdown(run.doc, range.total) : null;
      if (scanRun !== run || auto.done) return;
      const plan = core.planAutoScan(opened ? Array.from(opened.options.keys()) : [], obs.rangeText);
      if (!plan.ok) {
        if (opened) await closeRangeDropdown(run.doc, opened.trigger, range.total);
        endAuto(run, `Automatic page switching is not available here (${plan.reason}). Change the range by hand to scan the other pages.`, true);
        return;
      }
      auto.plan = plan;
      auto.expected = { customerId: obs.customerId, total: plan.total, pageSize: plan.pageSize };
      auto.queue = plan.order.slice(1);
      auto.phase = 'next';
      console.log('ApplyFast automatic scan plan', { pages: plan.pages.length, startIndex: plan.startIndex, capped: plan.capped });
    } finally {
      auto.busy = false;
    }
  }

  /**
   * Shared page switch (automatic scan and multi-page Apply): opens NetSuite's range dropdown and
   * finds the wanted option. check() runs once the dropdown is open: 'GONE' leaves it as it is,
   * 'ABORT' closes it. Returns { status: GONE | ABORTED | NO_DROPDOWN | NO_OPTION | READY, select }.
   */
  async function prepareRangeOption(doc, total, pick, check) {
    const opened = await openRangeDropdown(doc, total);
    const verdict = check();
    if (verdict === 'GONE') return { status: 'GONE' };
    if (verdict === 'ABORT') {
      if (opened) await closeRangeDropdown(doc, opened.trigger, total);
      return { status: 'ABORTED' };
    }
    if (!opened) return { status: 'NO_DROPDOWN' };
    const option = pick(opened.options);
    if (!option) {
      await closeRangeDropdown(doc, opened.trigger, total);
      return { status: 'NO_OPTION' };
    }
    return { status: 'READY', select: () => fireMouse(option, ['mouseover', 'mousedown', 'mouseup', 'click']) };
  }

  async function autoNavigate(run, target) {
    const auto = run.auto;
    auto.busy = true;
    try {
      const nav = await prepareRangeOption(run.doc, auto.expected.total, options => options.get(target.text), () =>
        (scanRun !== run || auto.done) ? 'GONE'
          : (auto.interrupted || auto.stopRequested || editingTransactionList(run.doc)) ? 'ABORT' : '');
      if (nav.status === 'GONE') return;
      if (nav.status === 'ABORTED') {
        if (!target.returning && auto.plan) auto.queue.unshift(auto.plan.pages.indexOf(target));
        return;
      }
      if (nav.status === 'NO_DROPDOWN') return endAuto(run, `Scan stopped — the NetSuite range dropdown could not be opened to load ${pageLabel(run, target)}.`, true);
      if (nav.status === 'NO_OPTION') return endAuto(run, `Scan stopped — the range option for ${pageLabel(run, target)} was not found in the NetSuite dropdown.`, true);
      auto.target = target;
      auto.requestedAt = performance.now();
      auto.phase = 'wait';
      nav.select();
    } finally {
      auto.busy = false;
    }
  }

  function scanView() {
    const core = globalThis.ApplyFastCore;
    const run = scanRun;
    if (!run) return { html: '', complete: false };
    const coverage = core.scanCoverage(run.scan);
    const list = core.scanPageList(coverage, run.pageSize);
    const settle = run.settle;
    const loadedStart = settle && settle.range ? settle.range.start : null;
    const loadedIndex = list.findIndex(p => p.start === loadedStart);
    const fresh = list.filter(p => p.status === 'SCANNED').length;
    const reading = settle && settle.settled && settle.fp === run.readFp;
    const n = x => x.toLocaleString('en-US');

    const auto = run.auto;
    const autoRunning = !!(auto && !auto.done);
    const autoPage = auto && auto.plan
      ? (auto.phase === 'wait' && auto.target ? auto.target : auto.plan.pages.find(p => p.start === loadedStart))
      : null;

    let headline;
    if (autoRunning) {
      const s = autoPagesScanned(run);
      const where = autoPage ? `<br>${esc(pageLabel(run, autoPage).replace(/^page/, 'Page'))}` : '';
      headline = `<b>Scanning all pages…</b>${where}<br>` + (auto.plan
        ? `${s.fresh} of ${s.total} page(s) scanned · ${n(coverage.scannedRows)} of ${n(coverage.total)} rows covered${progressBarHtml(s.fresh, s.total, 'Pages scanned')}`
        : 'Reading the current page and the list of pages');
    } else if (auto && auto.message) {
      headline = `<b class="${auto.message.warn ? 'af-warn-text' : 'af-ok-text'}">${esc(auto.message.text)}</b>` +
        (coverage.complete ? '' : `<br>${fresh} of ${list.length} page(s) scanned${coverage.total !== null ? ` · ${n(coverage.scannedRows)} of ${n(coverage.total)} rows covered` : ''}`);
    } else if (coverage.complete) headline = `<b class="af-ok-text">All ${list.length || coverage.pages.length} page(s) scanned</b> · ${n(coverage.scannedRows)} rows`;
    else if (loadedIndex >= 0) headline = `<b>Scanning page ${loadedIndex + 1} of ${list.length}</b> · ${fresh} of ${list.length} page(s) scanned · ${n(coverage.scannedRows)} of ${n(coverage.total)} rows covered`;
    else if (coverage.total !== null) headline = `<b>Scanning</b> · ${n(coverage.scannedRows)} of ${n(coverage.total)} rows covered`;
    else headline = '<b>Scanning</b> · waiting for the first page';

    let status;
    if (!settle) status = '';
    else if (autoRunning && auto.stopRequested) status = '<span class="af-wait">Stopping once this page has finished loading…</span>';
    else if (autoRunning && auto.phase === 'wait' && !settle.settled) status = `<span class="af-wait">⏳ Waiting for NetSuite to finish loading…</span><div class="af-sub-line">${esc(settle.reason)}</div>`;
    else if (autoRunning && (auto.phase === 'wait' || auto.busy)) status = '<span class="af-wait">⏳ Switching page…</span>';
    else if (!settle.settled) status = `<span class="af-wait">⏳ Waiting for NetSuite to finish loading this page…</span><div class="af-sub-line">${esc(settle.reason)}</div>`;
    else if (!reading) status = '<span class="af-wait">⏳ Reading this page…</span>';
    else if (run.notice && !(auto && auto.message && !run.notice.warn)) status = `<span class="${run.notice.warn ? 'af-warn-text' : 'af-ok-text'}">${esc(run.notice.text)}</span>`;
    else status = '';

    const next = list.find(p => p.status !== 'SCANNED' && p.start !== loadedStart) || list.find(p => p.status !== 'SCANNED');
    let hint;
    if (autoRunning) hint = 'ApplyFast is changing the NetSuite range to each page. Please do not edit the page until the scan finishes.';
    else if (coverage.complete) hint = 'Paste your payment references, then click <b>Review Cash Application</b>. Nothing is applied until you choose to.';
    else if (next && auto && auto.message) hint = `To finish, change the NetSuite range to <b>${n(next.start)} to ${n(next.end)}</b> by hand, or click <b>Rescan All Pages</b>.`;
    else if (next) hint = `Next: in NetSuite, change the range to <b>${n(next.start)} to ${n(next.end)}</b>. ApplyFast will read it when it has loaded.`;
    else if (coverage.total !== null) hint = 'Change the NetSuite range to each page that is not scanned yet.';
    else hint = '';

    const label = { SCANNED: ['Scanned', 'ok'], STALE: ['Scan again', 'warn'], NOT_SCANNED: ['Not scanned', 'muted'] };
    const rowsHtml = list.map(p => {
      const [text, tone] = label[p.status];
      const loaded = p.start === loadedStart;
      const note = loaded && settle && !settle.settled ? 'Waiting for NetSuite to settle' : p.reason;
      return `<tr${loaded ? ' class="af-loaded"' : ''}><td>${n(p.start)} to ${n(p.end)}${loaded ? ' <b>(loaded)</b>' : ''}</td>` +
        `<td><span class="af-st ${tone}">${text}</span>${note ? `<div class="af-sub-line">${esc(note)}</div>` : ''}</td></tr>`;
    }).join('');

    const html = `
      <div class="af-scan-status">
        <div>${headline}</div>
        ${status ? `<div style="margin-top:2px;">${status}</div>` : ''}
        ${hint ? `<div class="af-muted-text" style="margin-top:4px;">${hint}</div>` : ''}
      </div>
      ${rowsHtml ? `<div class="af-scan-pages">
        <table class="af-table">
          <colgroup><col style="width:45%;"><col></colgroup>
          <thead><tr><th>Page (rows)</th><th>Status</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>` : ''}`;
    return { html, complete: coverage.complete && !autoRunning, autoRunning };
  }

  function renderScan() {
    const box = document.getElementById('afScan');
    const matchBtn = document.getElementById('matchBtn');
    if (panelMode !== 'multi') {
      if (box) box.innerHTML = '';
      if (matchBtn) { matchBtn.textContent = 'Review Cash Application'; matchBtn.disabled = !!applyRun; matchBtn.style.opacity = '1'; matchBtn.title = ''; }
      opScan = { running: false, complete: false };
      updateOpStatus();
      return;
    }
    const view = scanView();
    const html = `
      <div class="af-scan-intro">
        <b>Scan all pages first.</b> ApplyFast switches the NetSuite range to each page, reads it once it has loaded, then returns to the page you started on. Scanning only reads: it never changes Payment, Disc. Taken or Apply and never saves. You can stop at any time.
      </div>
      <div class="af-scan-btns">
        ${view.autoRunning
          ? `<button id="afScanStop" class="af-btn af-stop" type="button" style="flex:1;">Stop</button>`
          : `<button id="afScanStart" class="af-btn af-apply" type="button" style="flex:1;">${scanRun ? 'Rescan All Pages' : 'Scan All Pages'}</button>
             ${scanRun ? `<button id="afScanStop" class="af-btn af-secondary" type="button">Stop scan</button>` : ''}`}
      </div>
      ${view.html}`;
    if (box && (!scanRun || scanRun.html !== html)) {
      box.innerHTML = html;
      if (scanRun) scanRun.html = html;
    }
    opScan = { running: !!view.autoRunning, complete: !!view.complete };
    updateOpStatus();
    if (matchBtn) {
      matchBtn.textContent = 'Review Cash Application';
      matchBtn.disabled = !view.complete;
      matchBtn.style.opacity = view.complete ? '1' : '0.5';
      matchBtn.title = view.complete ? '' : view.autoRunning ? 'Wait for the scan to finish' : 'Scan every page first';
    }
  }

  function showMultiMessage(message) {
    const box = document.getElementById('afPreview');
    if (box) box.innerHTML = `<div class="af-notice">${esc(message)}</div>`;
  }

  function invalidateMultiPreview(message) {
    multiPreview = null;
    showMultiMessage(`${message} Nothing was changed.`);
    setPanelState('idle');
  }

  function previewAllPages() {
    const core = globalThis.ApplyFastCore;
    if (!core || !scanRun || multiApply) return;
    const settle = scanRun.settle;
    if (!settle || !settle.settled || settle.fp !== scanRun.readFp) {
      showMultiMessage('Wait until NetSuite has finished loading the page, then click Review Cash Application again.');
      return;
    }
    const { valid, skipped: invalid } = parseInput();
    if (!valid.length) {
      multiPreview = null;
      showMultiMessage(invalid.length ? 'No valid lines to preview.\n' + describeSkipped(invalid, 10) : 'Paste invoice numbers first.');
      return;
    }
    if (!requirePaymentReceived()) { multiPreview = null; clearPreview(); return; }
    const match = core.matchAcrossPages(valid, scanRun.scan);
    if (!match.ok) {
      multiPreview = null;
      showMultiMessage(match.reason + '.');
      return;
    }
    const plan = core.buildPagePlan(match);
    const items = core.buildMultiApplyPlan(plan, scanRun.scan);
    const area = document.getElementById('matchListArea');
    const loaded = scanRun.scan.pages.get(settle.range.start);
    multiPreview = { inputText: area ? area.value : '', match, plan, items, invalid, loadedStart: settle.range.start, loadedText: loaded ? loaded.rangeText : '' };
    preview = null;
    renderReview();
    setPanelState('previewed-multi');
    console.log('ApplyFast multi-page preview', {
      pages: match.coverage.pages.length, rows: match.rows.length, planned: plan.rowCount,
      ready: items.filter(it => it.willWrite).length, held: plan.held.length, skipped: plan.skipped.length + invalid.length
    });
  }

  const RECON_LABELS = {
    EXACT: 'Exact', SHORT_PAYMENT: 'Partial/Short payment', OVERPAYMENT: 'Overpayment', PARTIAL_APPLICATION: 'Partial/Short payment',
    NOT_APPLIED: 'Not applied', NEEDS_REVIEW: 'Needs review', UNMATCHED: 'Unmatched'
  };
  const UNMATCHED_LABELS = {
    NOT_FOUND: 'Not found', MULTIPLE_MATCH: 'Multiple matches', CROSS_PAGE_GROUP: 'Held', PARTIAL_REF_MATCH: 'Partial match'
  };

  // The write decision of a reconciliation row (safety), kept apart from its reconStatus.
  function multiStatusHtml(row, i) {
    const w = row.write;
    let label, tone;
    if (row.rowType === 'UNMATCHED') { label = UNMATCHED_LABELS[row.safetyStatus] || 'Skipped'; tone = row.safetyStatus === 'NOT_FOUND' || row.safetyStatus === 'MULTIPLE_MATCH' || row.safetyStatus === 'CROSS_PAGE_GROUP' ? 'warn' : 'muted'; }
    else if (w.willWrite) { label = w.overwrite ? 'Overwrite' : 'Ready'; tone = 'ok'; }
    else if (w.safetyStatus === 'UNPLANNABLE' || w.cashHeld) { label = 'Not written'; tone = 'warn'; }
    else { label = STATUS_LABELS[w.safetyStatus] || w.safetyStatus; tone = w.safetyStatus === 'ALREADY_APPLIED' ? 'muted' : 'warn'; }
    const toggle = w.overwritable && i !== undefined
      ? ` <label class="af-ow"><input type="checkbox" data-ow="${i}"${w.overwrite ? ' checked' : ''}> overwrite</label>` : '';
    return `<span class="af-st ${tone}">${esc(label)}</span>${toggle}`;
  }

  function reconStatusHtml(row) {
    return `<div class="af-recon" data-recon="${esc(row.reconStatus)}">${esc(RECON_LABELS[row.reconStatus] || row.reconStatus)}</div>`;
  }

  const ANALYTICAL_RECON = ['EXACT', 'PARTIAL_APPLICATION', 'SHORT_PAYMENT', 'OVERPAYMENT'];

  // The reason text of a row. A matched row whose application was computed has variance remarks
  // (Premium); without Premium it keeps only its review warnings, such as a discount that cannot be
  // confirmed. Not applied, data-problem and unmatched remarks are operational and always shown.
  function rowReason(row, premium) {
    if (premium || row.rowType === 'UNMATCHED' || !ANALYTICAL_RECON.includes(row.reconStatus)) return row.remarks || '';
    return row.needsReview ? row.reasons.join('; ') : '';
  }

  // The Premium row markers: reconciliation status and exception flag.
  function reconAttrs(row, premium) {
    return premium ? ` data-recon="${esc(row.reconStatus)}"${row.exception ? ' data-exception="yes"' : ''}` : '';
  }

  // Premium presentation of a Review or its Results: the control itself, or one upgrade prompt that
  // opens the license banner. Neither changes the reconciliation results or what Apply writes.
  const LOCKED_TEXT = {
    review: {
      title: 'Review & Reconciliation',
      text: 'Cash application stays free. Review & Reconciliation needs ApplyFast Premium to see reconciliation statuses, variance analysis and cash reconciliation, filter exceptions, and export the Cash Application Report.',
      action: 'Unlock Review & Reconciliation'
    }
  };

  function lockedHtml(kind) {
    const t = LOCKED_TEXT[kind];
    return `<div class="af-locked" data-locked="${kind}"><div class="af-locked-text"><b><span aria-hidden="true">&#128274;</span> ${esc(t.title)}</b>${esc(t.text)}</div>` +
      `<button type="button" class="af-btn af-secondary" data-upgrade="${kind}">${esc(t.action)}</button></div>`;
  }

  function bindUpgradeButtons(box) {
    box.querySelectorAll('[data-upgrade]').forEach(btn => { btn.onclick = () => promptLicense(REVIEW_RECONCILIATION); });
  }

  // The open Review: This page only (preview) or All pages (multiPreview).
  function openReview() {
    if (preview) return { rv: preview, scan: preview.scan };
    if (multiPreview && scanRun) return { rv: multiPreview, scan: scanRun.scan };
    return null;
  }

  // One Review for both modes. Everything shown comes from the reconciliation results of the final
  // write plan Apply uses; only data collection differs (the loaded page or the scanned pages).
  // Premium adds the reconciliation presentation and filters, which only choose which rows are shown.
  function renderReview() {
    const core = globalThis.ApplyFastCore;
    const box = document.getElementById('afPreview');
    const open = openReview();
    if (!core || !box || !open) return;
    const { rv, scan } = open;
    const single = !!rv.single;
    const { match, plan } = rv;
    const byLine = new Map(match.results.map(r => [r.entry.lineNo, r]));
    const pageName = start => {
      const p = match.coverage.pages.find(x => x.start === start);
      return p ? p.rangeText : String(start);
    };
    const final = cashWritePlan(rv, scan);
    const results = final.results;
    const items = final.items;
    const itemIndex = new Map(rv.items.map((it, i) => [it.id, i]));
    const itemById = new Map(items.map(it => [it.id, it]));
    const writes = results.rows.filter(r => r.write.willWrite);
    const payment = writes.reduce((sum, r) => sum + r.write.payment, 0);
    const discount = writes.reduce((sum, r) => sum + (r.write.discount || 0), 0);
    const writePages = core.orderApplyPages(items).length;
    const overwritable = items.filter(it => it.state.overwritable).length;
    const canApply = writes.length > 0 && !final.applyBlocked;
    const canExport = results.rows.length > 0 && !final.applyBlocked;
    const premium = licenseActive(REVIEW_RECONCILIATION);
    const applyLabel = final.applyBlocked ? (final.cashInputStatus === 'INVALID' ? 'Correct Payment Received to apply' : 'Enter Payment Received to apply')
      : !writes.length ? 'Nothing to apply'
      : single ? `Apply ${plural(writes.length, 'Payment', 'Payments')}`
      : `Apply ${plural(writes.length, 'Payment', 'Payments')} on ${plural(writePages, 'Page', 'Pages')}`;

    const filters = core.RESULT_FILTERS.filter(f => f.key === 'ALL' || results.filterCounts[f.key] > 0);
    if (!premium || !filters.some(f => f.key === rv.filter)) rv.filter = 'ALL';
    const shown = core.filterReconciliationResults(results, rv.filter);
    const filtersHtml = !premium || filters.length <= 1 ? ''
      : `<div class="af-filters" role="group" aria-label="Show rows">` +
        filters.map(f => `<button type="button" class="af-filter" data-filter="${f.key}" aria-pressed="${f.key === rv.filter}">${esc(f.label)} ${results.filterCounts[f.key]}</button>`).join('') +
        '</div>';

    const money = n => (n === null || n === undefined ? '-' : fmtUS(n));
    const rowHtml = r => {
      const it = itemById.get(r.id);
      const unmatched = r.rowType === 'UNMATCHED';
      const identity = unmatched
        ? `${esc(r.reference || r.raw)}<div class="af-sub-line">Line ${r.lineNo} · no invoice matched</div>`
        : `${esc(r.invoice)}<div class="af-sub-line">Line ${r.lineNo} · ${esc(r.type)}${r.date ? ` · ${esc(r.date)}` : ''}` +
          `${it && it.multiRow ? ` · 1 of ${it.groupSize} rows` : ''}</div>`;
      const due = unmatched ? '-' : `${money(r.invoiceAmountRemaining)}${r.originalAmount !== null ? `<div class="af-sub-line">Orig. ${esc(money(r.originalAmount))}</div>` : ''}`;
      const applied = r.applicationAmount === null ? '-' : money(r.applicationAmount);
      const disc = r.discountTaken ? `<div class="af-sub-line">Disc. ${esc(money(r.discountTaken))}</div>` : '';
      const limited = r.write.willWrite && r.write.cashLimited ? `<div class="af-sub-line">Limited by Payment Received (planned ${esc(money(r.requestedAmount))})</div>` : '';
      const written = r.write.willWrite && Math.round(r.write.payment * 100) !== Math.round(r.applicationAmount * 100)
        ? `<div class="af-sub-line">Apply writes ${esc(money(r.write.payment))}</div>` : '';
      const diff = premium && r.invoiceDifference ? `<div class="af-sub-line">Diff. ${esc(money(r.invoiceDifference))}</div>` : '';
      const reason = rowReason(r, premium);
      const note = !r.write.willWrite && r.write.note && r.write.note !== reason ? `<div class="af-sub-line">${esc(r.write.note)}</div>` : '';
      const result = unmatched ? byLine.get(r.lineNo) : null;
      const extra = r.safetyStatus === 'PARTIAL_REF_MATCH' && unmatched
        ? `<div class="af-sub-line">${esc(skipReason({ status: r.safetyStatus }))}</div>`
        : !single && r.safetyStatus === 'MULTIPLE_MATCH' && result && result.pageStarts
          ? `<div class="af-sub-line">Found on ${esc(result.pageStarts.map(pageName).join('; '))}</div>` : '';
      const index = itemIndex.get(r.id);
      const attrs = unmatched ? ` class="af-skip" data-line="${r.lineNo}" data-raw="${esc(r.raw)}"` : ` data-i="${index}" data-ref="${esc(r.invoice)}"`;
      return `<tr${attrs} data-reference="${esc(r.reference)}" data-write="${r.write.willWrite ? 'yes' : 'no'}"${reconAttrs(r, premium)}>` +
        `<td>${identity}</td><td class="num">${due}</td><td class="num">${money(r.requestedAmount)}</td>` +
        `<td class="num af-applied">${applied}${disc}${limited}${written}</td><td class="num">${money(r.remainingInvoiceBalance)}${diff}</td>` +
        `<td>${multiStatusHtml(r, index)}${premium ? reconStatusHtml(r) : ''}` +
        `${reason ? `<div class="af-sub-line af-reason">${esc(reason)}</div>` : ''}${note}${extra}</td></tr>`;
    };
    const invoiceShown = shown.filter(r => r.rowType === 'INVOICE');
    const unmatchedShown = shown.filter(r => r.rowType === 'UNMATCHED');
    const pageStarts = Array.from(new Set(invoiceShown.map(r => r.page))).sort((a, b) => a - b);
    const tableHtml = (single ? invoiceShown.map(rowHtml).join('') : pageStarts.map(start => {
      const rows = invoiceShown.filter(r => r.page === start);
      return `<tr class="af-page"><td colspan="6">Page ${esc(pageName(start))} · ${rows.length} row(s)` +
        `${start === rv.loadedStart ? ' · loaded now' : ''}</td></tr>${rows.map(rowHtml).join('')}`;
    }).join('')) + (unmatchedShown.length
      ? `<tr class="af-page"><td colspan="6">Not matched · ${unmatchedShown.length} line(s) · never written</td></tr>${unmatchedShown.map(rowHtml).join('')}` : '');

    const tableId = single ? 'afReviewTable' : 'afMultiTable';
    const applyId = single ? 'afApplyBtn' : 'afMultiApplyBtn';
    const already = items.filter(it => !it.willWrite && it.state.status === 'ALREADY_APPLIED').length;
    const held = items.filter(it => !it.willWrite && it.state.status !== 'ALREADY_APPLIED').length;
    const skipped = results.rows.filter(r => r.rowType === 'UNMATCHED').length;
    const summaryHtml = single
      ? `<div id="afSummary" class="af-sum">
        <b class="af-sum-title">${plural(writes.length, 'application', 'applications')} ready</b>
        <div class="af-sum-sub">Payment ${fmtUS(payment)}${discount ? ` · Discount ${fmtUS(discount)}` : ''} planned · Nothing has been written yet.</div>
        <div class="af-chips"><span class="af-chip ok">Ready ${writes.length}</span>` +
        (already ? `<span class="af-chip muted">Already applied ${already}</span>` : '') +
        (held ? `<span class="af-chip warn">Not applied ${held}</span>` : '') +
        (skipped ? `<span class="af-chip warn">Skipped ${plural(skipped, 'line', 'lines')}</span>` : '') + `</div>
        <div class="af-note" style="margin-top:6px;">Every row is checked again right before it is written. ApplyFast never saves.</div>
      </div>`
      : `<div class="af-sum">
        <b class="af-sum-title">${plural(writes.length, 'application', 'applications')} ready</b>
        <div class="af-sum-sub">Planned: ${plan.rowCount} row(s) on ${plan.pages.length} page(s) · Payment ${fmtUS(payment)}${discount ? ` · Discount ${fmtUS(discount)}` : ''} · Nothing has been written yet.</div>
        <div class="af-note" style="margin-top:6px;">Statuses use the values from the scan. Every row is checked again on its page right before it is written. ApplyFast never saves.</div>
      </div>`;
    const exportHtml = !results.rows.length ? ''
      : premium ? `<button id="afExportBtn" class="af-btn af-secondary" type="button" title="Download the Cash Application Report (Excel) with the full reconciliation"${canExport ? '' : ' disabled style="opacity:0.5;"'}>Export Excel</button>`
      : '';

    const oldTable = box.querySelector(`#${tableId}`);
    const scrollTop = oldTable ? oldTable.scrollTop : 0;
    const boxScrollTop = box.scrollTop;
    box.innerHTML = `
      ${summaryHtml}
      ${cashSummaryHtml(results, premium)}
      ${overwritable ? `<label class="af-ow-all"><input type="checkbox" id="afOverwriteAll"${items.every(it => !it.state.overwritable || it.overwrite) ? ' checked' : ''}> Overwrite all ${overwritable} row(s) that already have a different Payment or Discount</label>` : ''}
      ${filtersHtml}
      ${results.rows.length ? `<div id="${tableId}" class="af-table-wrap" data-filter="${esc(rv.filter)}">
        <table class="af-table">
          <colgroup><col style="width:104px;"><col style="width:66px;"><col style="width:62px;"><col style="width:66px;"><col style="width:62px;"><col></colgroup>
          <thead><tr><th>Invoice</th><th class="num">Amt. Due</th><th class="num">Requested</th><th class="num">Applied</th><th class="num">Remaining</th><th>Status</th></tr></thead>
          <tbody>${tableHtml || '<tr><td colspan="6" class="af-sub-line">No rows match this filter.</td></tr>'}</tbody>
        </table>
      </div>` : ''}
      ${!single && writes.length ? `<div class="af-note">ApplyFast will switch NetSuite pages automatically, recheck each row, then return to page ${esc(rv.loadedText)}.</div>` : ''}
      ${!premium && results.rows.length ? lockedHtml('review') : ''}
      <div class="af-actions">
        <button id="${applyId}" class="af-btn af-apply" type="button" style="flex:1;${canApply ? '' : 'opacity:0.5;'}"${canApply ? '' : ' disabled'}>${applyLabel}</button>
        ${exportHtml}
        <button id="afClearBtn" class="af-btn af-secondary" type="button">Clear</button>
      </div>`;
    const table = box.querySelector(`#${tableId}`);
    if (table) table.scrollTop = scrollTop;
    box.scrollTop = boxScrollTop;
    box.onchange = (e) => {
      if (openReview() === null || applyRun || multiApply) return;
      const t = e.target;
      if (t.id === 'afOverwriteAll') rv.items.forEach(it => { if (it.state.overwritable) it.overwrite = t.checked; });
      else if (t.dataset && t.dataset.ow !== undefined) rv.items[Number(t.dataset.ow)].overwrite = t.checked;
      else return;
      core.decideMultiWrites(rv.items);
      renderReview();
    };
    box.querySelectorAll('.af-filter').forEach(btn => {
      btn.onclick = () => {
        if (applyRun || multiApply) return;
        rv.filter = btn.dataset.filter;
        renderReview();
      };
    });
    bindUpgradeButtons(box);
    document.getElementById(applyId).onclick = () => (single ? applyPreview() : applyAllPages());
    const exportBtn = document.getElementById('afExportBtn');
    if (exportBtn) exportBtn.onclick = () => exportReconciliation(results);
    document.getElementById('afClearBtn').onclick = () => { if (applyRun || multiApply) return; multiPreview = null; clearPreview(); };
  }

  /***********************
   * MULTI-PAGE APPLY
   * An explicit Apply on a Preview of a complete scan. Pages with rows to write are visited in list
   * order with the automatic scan's range-dropdown switch (prepareRangeOption). Each page is checked
   * against its scan once it has settled, every row again right before writeRow (unchanged), and
   * the written rows are read back once the page is quiet. A changed row is skipped; a changed list,
   * a failed switch, user input or a write error halts the run. Nothing is retried, Save is never
   * touched, and any Apply attempt uses up the scan and the Preview.
   ***********************/
  let multiApply = null;

  const RESULT_LABELS = {
    APPLIED: 'Applied', ADJUSTED: 'Adjusted', NOT_CONFIRMED: 'Not confirmed', CHANGED: 'Changed since Preview',
    MOVED: 'Row moved', NOT_WRITTEN: 'Not written', HELD: 'Held', BLOCKED: 'Blocked', ALREADY: 'Already applied',
    SKIPPED: 'Skipped', ERROR: 'Error while writing'
  };
  const APPLY_INPUT_TEXTS = {
    range: 'The NetSuite range was changed by hand',
    list: 'The NetSuite page was edited during Apply',
    customer: 'The customer field was used during Apply'
  };

  function appliedTotal(doc) {
    const el = doc.getElementById('applied');
    if (!el) return null;
    const parsed = globalThis.ApplyFastCore.parseAmountStrict(String(el.value || '').trim() || '0');
    return parsed.ok ? parsed.value : null;
  }

  // Payment Received entered as NetSuite's Payment Amount before any row is written, in both modes. It is the
  // only header field Apply writes; Applied, Unapplied and To Apply are calculated by NetSuite. With Payment
  // Amount populated NetSuite limits the line applications to it, and the write plan never exceeds it.
  // Returns false (with ctx.halt set) when the field is missing or NetSuite does not keep the amount.
  function enterPaymentAmount(ctx, cash) {
    const core = ctx.core;
    const visible = ctx.doc.getElementById('payment_formattedValue');
    const hidden = ctx.doc.getElementById('payment');
    const field = visible || hidden;
    if (cash.status !== 'VALID') { ctx.halt = 'Payment Received is required before applying'; return false; }
    if (!field) { ctx.halt = 'The NetSuite Payment Amount field was not found'; return false; }
    const read = () => {
      const parsed = core.parseAmountStrict(String((hidden || visible).value || '').trim() || '0');
      return parsed.ok ? Math.round(parsed.value * 100) : null;
    };
    const want = Math.round(cash.value * 100);
    if (read() === want) return true;
    field.value = fmtUS(cash.value);
    field.focus();
    ['input', 'change', 'blur'].forEach(type => field.dispatchEvent(new Event(type, { bubbles: true })));
    if (read() !== want) {
      ctx.halt = `NetSuite did not keep Payment Received ${fmtUS(cash.value)} as the Payment Amount`;
      return false;
    }
    return true;
  }

  function amountValue(text) {
    const s = String(text || '').trim();
    if (!s) return 0;
    const parsed = globalThis.ApplyFastCore.parseAmountStrict(s);
    return parsed.ok ? parsed.value : null;
  }

  // A live row in the shape revalidateApplyPage / rowChangeSincePreview / verifyWrite expect.
  function liveRowValues(r) {
    return Object.assign(scanRowValues(r), {
      connected: r.tr.isConnected,
      writable: !!(r.checkbox && r.amountInput),
      discountEditable: !!resolveDiscountInput(r)
    });
  }

  function setResult(item, status, reason) {
    item.result = { status, reason: reason || '' };
  }

  // Customer, range, NetSuite row numbers and row replacement; Payment values are not part of it.
  function pageIdentity(obs, ctx) {
    return [obs.customerId, obs.rangeText, obs.lineIndexes.join(','), ctx.rowGen].join('|');
  }

  function applyObserve(ctx) {
    const doc = ctx.doc;
    const obs = observePage(ctx);
    if (ctx.doc !== doc && !ctx.halt) ctx.halt = 'The NetSuite page was reloaded';
    ctx.settle = ctx.core.settleStep(ctx.settle, obs, performance.now());
    return obs;
  }

  function applyShouldStop(ctx) {
    if (ctx.halt) return true;
    if (ctx.auto.interrupted) { ctx.halt = ctx.auto.interrupted; return true; }
    return ctx.stopRequested;
  }

  // Waits until the page is settled and has been quiet since `after`; false after the navigation timeout.
  async function applyWaitSettled(ctx, after) {
    const t0 = performance.now();
    for (;;) {
      applyObserve(ctx);
      const now = performance.now();
      if (ctx.settle.settled && now - after >= ctx.core.SETTLE_QUIET_MS) return true;
      if (now - t0 > ctx.core.AUTO_NAV_TIMEOUT_MS) return false;
      await sleep(SCAN_POLL_MS);
    }
  }

  // Switches to target { start, end, text } and waits until it is ready; returns '' or why it failed.
  async function applySwitchPage(ctx, target) {
    const core = ctx.core;
    const total = ctx.expected.total;
    const pick = options => {
      for (const [text, el] of options) {
        const r = core.parseRange(text);
        if (r && r.start === target.start && r.end === target.end && r.total === total) return el;
      }
      return null;
    };
    const nav = await prepareRangeOption(ctx.doc, total, pick, () =>
      (ctx.halt || ctx.auto.interrupted || (ctx.stopRequested && !ctx.completed)) ? 'ABORT' : '');
    if (nav.status === 'ABORTED') return ctx.halt || ctx.auto.interrupted || '';
    if (nav.status === 'NO_DROPDOWN') return `The NetSuite range dropdown could not be opened to load ${target.text}`;
    if (nav.status === 'NO_OPTION') return `The range option ${target.text} was not found in the NetSuite dropdown`;
    const requestedAt = performance.now();
    nav.select();
    for (;;) {
      await sleep(SCAN_POLL_MS);
      if (ctx.auto.interrupted) return ctx.auto.interrupted;
      const obs = applyObserve(ctx);
      if (ctx.halt) return ctx.halt;
      const status = core.autoNavStatus(ctx.settle, requestedAt, performance.now());
      if (status === 'TIMEOUT') return `${target.text} did not finish loading within ${Math.round(core.AUTO_NAV_TIMEOUT_MS / 1000)} seconds`;
      if (status === 'READY') {
        blurRangeControl(ctx.doc);
        const check = core.verifyAutoPage(ctx.expected, target, { customerId: obs.customerId, range: ctx.settle.range, rows: obs.lineIndexes.length });
        return check.ok ? '' : `${check.reason} (${check.code})`;
      }
    }
  }

  // Rows of one input line on this page are written together, in NetSuite row order.
  function applyUnits(items) {
    const units = new Map();
    items.forEach(it => {
      if (!units.has(it.lineNo)) units.set(it.lineNo, []);
      units.get(it.lineNo).push(it);
    });
    return Array.from(units.values());
  }

  // rowFor(item) finds a written row again; by default the rows now loaded, by NetSuite row number.
  function applyReadBack(ctx, written, rowFor) {
    let find = rowFor;
    if (!find) {
      const snap = readApplyRows(ctx.doc);
      const byLine = new Map(snap.error ? [] : snap.rows.map(r => [r.lineIndex, r]));
      find = item => byLine.get(item.lineIndex) || null;
    }
    written.forEach(item => {
      const r = find(item);
      const v = ctx.core.verifyWrite(item, r ? liveRowValues(r) : null);
      item.actual = { payment: v.actualPayment, discount: v.actualDiscount };
      recordWrite({ lineIndex: item.lineIndex, ref: item.ref, page: pageOfRange(item.rangeText), before: item.before, after: item.actual });
      if (item.writeError) return;
      setResult(item, v.status, v.reason);
      if (v.status === 'APPLIED') ctx.applied++;
      if (v.status === 'APPLIED' || v.status === 'ADJUSTED') {
        const now = amountValue(v.actualPayment), was = amountValue(item.before.payment);
        if (now !== null && was !== null) ctx.paymentDelta += now - was;
      }
    });
  }

  // Writes the rows of each input line together, in NetSuite row order, after a last-instant check of
  // every row of the line (rowFor(item) reads it again); a line with a changed or unwritable row
  // writes none of its rows. afterChunk runs after each yield and may set ctx.halt. Returns the
  // items written. Used by both modes.
  async function writeApplyUnits(ctx, items, rowFor, afterChunk) {
    const core = ctx.core;
    const written = [];
    let sinceYield = 0;
    for (const unit of applyUnits(items)) {
      if (applyShouldStop(ctx)) break;
      const fresh = unit.map(item => ({ item, row: rowFor(item) }));
      let failure = null;
      for (const f of fresh) {
        const change = core.rowChangeSincePreview(f.item, f.row ? liveRowValues(f.row) : { connected: false });
        if (change) failure = { item: f.item, status: change.status, reason: change.reason };
        else if (!f.row.checkbox || !f.row.amountInput) failure = { item: f.item, status: 'NOT_WRITTEN', reason: 'Row has no Apply checkbox or Payment field' };
        else if (f.item.discount && !(f.discountInput = resolveDiscountInput(f.row))) failure = { item: f.item, status: 'NOT_WRITTEN', reason: 'Disc. Taken field not found or not editable; line not applied' };
        if (failure) break;
      }
      if (failure) {
        unit.forEach(item => {
          if (item === failure.item) setResult(item, failure.status, failure.reason);
          else setResult(item, 'CHANGED', `Another row of line ${item.lineNo} changed or cannot be written; none of this line's rows written`);
        });
        continue;
      }
      for (const f of fresh) {
        written.push(f.item);
        try {
          writeRow({ row: f.row.tr, checkbox: f.row.checkbox, amountInput: f.row.amountInput, finalAmt: f.item.payment,
            discountAmt: f.item.discount, discountInput: f.discountInput || null, matchedKey: f.row.ref });
        } catch (e) {
          console.error('ApplyFast write error', e);
          f.item.writeError = true;
          setResult(f.item, 'ERROR', 'The write failed part-way; check this row in NetSuite');
          ctx.halt = `Error while writing ${f.item.ref}`;
          break;
        }
      }
      if (ctx.halt) break;
      ctx.writing = written.length;
      sinceYield += unit.length;
      if (APPLY_CHUNK_SIZE > 0 && sinceYield >= APPLY_CHUNK_SIZE) {
        sinceYield = 0;
        renderApplyProgress(ctx);
        await sleep(0);
        if (applyShouldStop(ctx)) break;
        if (afterChunk) afterChunk();
        if (ctx.halt) break;
      }
    }
    ctx.writing = 0;
    return written;
  }

  async function applyOnePage(ctx, page) {
    const core = ctx.core;
    ctx.phase = 'Checking this page…';
    renderApplyProgress(ctx);
    if (!(await applyWaitSettled(ctx, 0))) { ctx.halt = `${page.target.text} did not settle within ${Math.round(core.AUTO_NAV_TIMEOUT_MS / 1000)} seconds`; return; }
    if (applyShouldStop(ctx)) return;
    const snap = readApplyRows(ctx.doc);
    if (snap.error) { ctx.halt = snap.error.replace(/\.$/, ''); return; }
    const current = { customerId: snap.customerId, rangeText: snap.rangeText, rows: snap.rows.map(liveRowValues) };
    const check = core.revalidateApplyPage(ctx.scan, current, page.items);
    if (!check.ok) { ctx.halt = `${check.halt.reason} on ${page.target.text} (${check.halt.code})`; return; }
    const trs = new Map();
    check.results.forEach(r => {
      if (r.status === 'OK') trs.set(r.item, snap.rows[r.rowIndex].tr);
      else setResult(r.item, r.status === 'NOT_WRITABLE' ? 'NOT_WRITTEN' : r.status, r.reason);
    });

    const baseline = pageIdentity(applyObserve(ctx), ctx);
    ctx.phase = 'Writing rows…';
    renderApplyProgress(ctx);
    const written = await writeApplyUnits(ctx, check.results.filter(r => r.status === 'OK').map(r => r.item), item => {
      const tr = trs.get(item);
      return tr.isConnected ? rereadRow(tr, snap.layout) : null;
    }, () => {
      if (pageIdentity(applyObserve(ctx), ctx) !== baseline && !ctx.halt) ctx.halt = `The NetSuite page changed while rows were being written on ${page.target.text}`;
    });

    if (written.length) {
      ctx.phase = 'Checking results…';
      renderApplyProgress(ctx);
      await applyWaitSettled(ctx, performance.now());
      applyReadBack(ctx, written);
      renderApplyProgress(ctx);
    }
  }

  async function applyReturnToStart(ctx) {
    const start = ctx.start;
    const range = ctx.settle.range;
    if (!(range && range.start === start.start && range.end === start.end)) {
      ctx.phase = 'Returning to starting page…';
      renderApplyProgress(ctx);
      const failed = await applySwitchPage(ctx, start);
      if (failed) { ctx.returnNote = `ApplyFast could not return to the starting page ${start.text} (${failed}) and stayed where it was.`; return; }
    }
    await applyWaitSettled(ctx, 0);
  }

  async function runMultiApply(ctx) {
    for (let k = 0; k < ctx.pages.length; k++) {
      const page = ctx.pages[k];
      ctx.pageNo = k + 1;
      if (applyShouldStop(ctx)) return;
      const range = ctx.settle.range;
      if (!(range && range.start === page.target.start && range.end === page.target.end)) {
        ctx.phase = 'Switching page…';
        renderApplyProgress(ctx);
        const failed = await applySwitchPage(ctx, page.target);
        if (failed && !ctx.halt) ctx.halt = failed;
        if (applyShouldStop(ctx)) return;
      }
      await applyOnePage(ctx, page);
    }
    if (applyShouldStop(ctx)) return;
    ctx.completed = true;
    await applyReturnToStart(ctx);
  }

  function setApplyingUi(active) {
    const matchBtn = document.getElementById('matchBtn');
    if (matchBtn) matchBtn.disabled = active;
    document.querySelectorAll('input[name="afMode"]').forEach(radio => { radio.disabled = active; });
    document.querySelectorAll('#afScan button').forEach(b => { b.disabled = active; });
    const area = document.getElementById('matchListArea');
    if (area) area.readOnly = active;
    const cashInput = document.getElementById('afPaymentReceived');
    if (cashInput) cashInput.readOnly = active;
  }

  function renderApplyProgress(ctx) {
    const el = document.getElementById('afApplyStatus');
    if (!el) return;
    const writing = ctx.writing ? ` · ${ctx.writing} written${ctx.single ? '' : ' on this page'}` : '';
    const where = ctx.single ? '' : ` Page ${ctx.pageNo} of ${ctx.pages.length}`;
    el.innerHTML = `<b>Applying payments…${where}</b><br>Rows applied ${ctx.applied} of ${ctx.planned}${writing}` +
      progressBarHtml(ctx.applied, ctx.planned, 'Payments applied') +
      `<div class="af-wait" style="margin-top:4px;">${esc(ctx.stopRequested && !ctx.completed ? 'Stopping at the next safe point…' : ctx.phase)}</div>`;
  }

  async function applyAllPages() {
    const core = globalThis.ApplyFastCore;
    const mp = multiPreview;
    if (!core || !mp || multiApply || applyRun) return;
    const run0 = scanRun;
    const refuse = (text, again) => {
      multiPreview = null;
      showMultiMessage(`${text} Nothing was changed. ${again || 'Scan all pages and click Review Cash Application again.'}`);
      setPanelState('idle');
    };
    const area = document.getElementById('matchListArea');
    if (!area || area.value !== mp.inputText) return refuse('The pasted lines changed after Preview.', 'Click Review Cash Application again.');
    if (!run0 || (run0.auto && !run0.auto.done)) return refuse('The scan is not finished.');
    const coverage = core.scanCoverage(run0.scan);
    if (!coverage.complete) return refuse('The scan is no longer complete (pages are missing or must be scanned again).');
    const obs = observePage(run0);
    run0.settle = core.settleStep(run0.settle, obs, performance.now());
    const range = run0.settle.range;
    if (!run0.settle.settled || run0.settle.fp !== run0.readFp || !range) return refuse('NetSuite has not finished loading the page, or it changed after it was scanned.', 'Wait for the page to settle, then click Review Cash Application again.');
    if (String(obs.customerId || '') !== run0.scan.customerId) return refuse('The customer changed.');
    if (range.total !== coverage.total) return refuse('The number of open transactions changed.');
    const startRecord = run0.scan.pages.get(range.start);
    if (!startRecord || startRecord.range.end !== range.end) return refuse('The loaded page is not one of the scanned pages.');
    // The same final write plan the Preview showed; the plan items in mp stay as planned.
    const final = cashWritePlan(mp, run0.scan);
    if (final.applyBlocked) return;
    const pages = core.orderApplyPages(final.items);
    const planned = pages.reduce((n, p) => n + p.items.length, 0);
    if (!planned) return;
    if (pages.length > core.AUTO_SCAN_PAGE_CAP) {
      return refuse(`Rows to write are on ${pages.length} pages; one Apply is limited to ${core.AUTO_SCAN_PAGE_CAP} pages.`, 'Split the lines into smaller batches.');
    }
    pages.forEach(p => {
      const rec = run0.scan.pages.get(p.pageStart);
      p.target = { start: rec.range.start, end: rec.range.end, text: rec.rangeText };
    });
    const first = coverage.pages[0];

    clearInterval(run0.timer);
    multiPreview = null;
    const ctx = multiApply = {
      core, mp, scan: run0.scan, doc: run0.doc, settle: run0.settle, firstRow: run0.firstRow, rowGen: run0.rowGen,
      auto: { done: false, interrupted: '' }, detachInput: null, stopRequested: false, completed: false,
      expected: { customerId: run0.scan.customerId, total: coverage.total, pageSize: first.end - first.start + 1 },
      start: { start: range.start, end: range.end, text: startRecord.rangeText },
      items: final.items, recon: final.results, pages, planned, applied: 0, pageNo: 0, phase: 'Starting…', writing: 0, halt: '', returnNote: '',
      appliedBefore: appliedTotal(run0.doc), paymentDelta: 0, t0: performance.now()
    };
    watchUserInput(ctx, APPLY_INPUT_TEXTS);

    renderApplying(ctx);
    setPanelState('applying-multi');
    setApplyingUi(true);
    renderApplyProgress(ctx);
    try {
      if (enterPaymentAmount(ctx, final.cash)) await runMultiApply(ctx);
    } catch (e) {
      console.error('ApplyFast multi-page apply error', e);
      if (!ctx.halt) ctx.halt = 'An unexpected error occurred';
    }
    finishApply(ctx, observePage(ctx).rangeText);
  }

  // Apply progress and Stop, for both modes.
  function renderApplying(ctx) {
    const box = document.getElementById('afPreview');
    if (!box) return;
    box.onchange = null;
    box.innerHTML = `
      <div id="afApplyStatus" class="af-status" aria-live="polite"></div>
      <div class="af-note">Please do not edit the NetSuite page until Apply finishes. ApplyFast never saves.</div>
      <button id="afApplyStopBtn" class="af-btn af-stop af-block" type="button">Stop</button>`;
    document.getElementById('afApplyStopBtn').onclick = (e) => {
      if ((multiApply !== ctx && applyRun !== ctx) || ctx.completed) return;
      ctx.stopRequested = true;
      e.target.disabled = true;
      e.target.textContent = 'Stopping…';
      renderApplyProgress(ctx);
    };
  }

  function finishApply(ctx, currentRange) {
    ctx.auto.done = true;
    if (ctx.detachInput) { ctx.detachInput(); ctx.detachInput = null; }
    if (!ctx.single) blurRangeControl(ctx.doc);
    const kind = ctx.halt ? 'HALTED' : (ctx.stopRequested && !ctx.completed) ? 'STOPPED' : 'COMPLETE';
    ctx.items.forEach(it => {
      if (it.result) return;
      if (it.willWrite) setResult(it, 'NOT_WRITTEN', kind === 'STOPPED' ? 'Apply was stopped before this row' : 'Apply halted before this row');
      else if (it.state.status === 'ALREADY_APPLIED') setResult(it, 'ALREADY', it.note);
      else setResult(it, 'BLOCKED', it.note);
    });
    const appliedAfter = appliedTotal(ctx.doc);
    const totalMismatch = ctx.appliedBefore !== null && appliedAfter !== null &&
      Math.round((appliedAfter - ctx.appliedBefore) * 100) !== Math.round(ctx.paymentDelta * 100);
    if (ctx.single) applyRun = null;
    else multiApply = null;
    setApplyingUi(false);
    if (!ctx.single) stopScan();
    renderApplyResults(ctx, kind, { totalMismatch, currentRange, ms: performance.now() - ctx.t0 });
    setPanelState(ctx.single ? 'done' : 'done-multi');
    const count = s => ctx.items.filter(it => it.result.status === s).length;
    console.log(ctx.single ? 'ApplyFast apply' : 'ApplyFast multi-page apply', {
      result: kind, pages: ctx.single ? 1 : ctx.pages.length, planned: ctx.planned, applied: ctx.applied, adjusted: count('ADJUSTED'),
      notConfirmed: count('NOT_CONFIRMED'), changed: count('CHANGED'), moved: count('MOVED'), notWritten: count('NOT_WRITTEN'),
      errors: count('ERROR'), appliedTotalMismatch: totalMismatch, returned: !ctx.single && ctx.completed && !ctx.returnNote, ms: Math.round(performance.now() - ctx.t0)
    });
    updateCounter(ctx.applied, []);
  }

  // Results of either mode: the reconciliation rows of the applied write plan with each row's write
  // and read-back result.
  function renderApplyResults(ctx, kind, info) {
    const core = ctx.core;
    const box = document.getElementById('afPreview');
    if (!box) return;
    const tones = { APPLIED: 'ok', ALREADY: 'muted', SKIPPED: 'muted', NOT_CONFIRMED: 'bad', ERROR: 'bad' };
    const tone = s => tones[s] || 'warn';
    const { rows, counts } = core.reconciliationApplyResults(ctx.recon, ctx.items);
    const itemById = new Map(ctx.items.map(it => [it.id, it]));
    const money = n => (n === null || n === undefined ? '-' : fmtUS(n));
    const premium = licenseActive(REVIEW_RECONCILIATION);
    const statusHtml = r => {
      const s = r.result.status;
      return `<td><span class="af-st ${tone(s)}">${esc(RESULT_LABELS[s])}</span>${premium ? reconStatusHtml(r) : ''}` +
        `${r.result.reason ? `<div class="af-sub-line">${esc(r.result.reason)}</div>` : ''}</td>`;
    };
    const recon = r => (premium ? ` data-recon="${esc(r.reconStatus)}"` : '');
    const pageStarts = Array.from(new Set(rows.filter(r => r.rowType === 'INVOICE').map(r => r.page))).sort((a, b) => a - b);
    const pagesHtml = pageStarts.map(start => {
      const pageRows = rows.filter(r => r.rowType === 'INVOICE' && r.page === start);
      const it0 = itemById.get(pageRows[0].id);
      const html = pageRows.map(r => {
        const written = r.write.payment === null ? '-' : amountsText(fmtUS(r.write.payment), r.write.discount ? fmtUS(r.write.discount) : '');
        const actual = r.actual ? amountsText(r.actual.payment || 'blank', r.actual.discount) : '-';
        const limited = r.write.willWrite && r.write.cashLimited ? `<div class="af-sub-line">Limited by Payment Received (planned ${esc(money(r.requestedAmount))})</div>` : '';
        return `<tr data-status="${r.result.status}" data-ref="${esc(r.invoice)}" data-page="${start}"${recon(r)}>` +
          `<td>${esc(r.invoice)}<div class="af-sub-line">Line ${r.lineNo} · ${esc(r.type)}</div></td>` +
          `<td class="num">${money(r.requestedAmount)}</td><td class="num">${esc(written)}${limited}</td><td class="num">${esc(actual)}</td>` +
          `${statusHtml(r)}</tr>`;
      }).join('');
      return (ctx.single ? '' : `<tr class="af-page"><td colspan="5">Page ${esc(it0 ? it0.rangeText : String(start))}</td></tr>`) + html;
    }).join('');
    const extraHtml = rows.filter(r => r.rowType === 'UNMATCHED').map(r => `<tr data-status="${r.result.status}"${recon(r)} class="af-skip">` +
      `<td>${esc(r.reference || r.raw)}<div class="af-sub-line">Line ${r.lineNo}</div></td><td class="num">${money(r.requestedAmount)}</td><td colspan="2"></td>${statusHtml(r)}</tr>`).join('');

    const chipsHtml = Object.keys(RESULT_LABELS).filter(s => counts[s]).map(s => `<span class="af-chip ${tone(s)}">${RESULT_LABELS[s]} ${counts[s]}</span>`).join('');
    const clean = kind === 'COMPLETE' && ctx.applied === ctx.planned && !info.totalMismatch && !ctx.returnNote;
    const trialOffer = clean && trialDeclinedCtx !== ctx && !premium && !license.trialConsumed &&
      (license.status === 'unlicensed' || license.status === 'transition_ended');
    const trialWarning = license.status === 'trial' && license.trialWarningDue === true;
    const where = kind !== 'COMPLETE' && !ctx.single ? `ApplyFast stayed on ${info.currentRange || 'the current page'}.` : '';
    const warn = t => `<div class="af-sum-warn">${esc(t)}</div>`;
    const heading = kind === 'HALTED' ? 'Cash Application Halted' : kind === 'STOPPED' ? 'Cash Application Stopped' : `${clean ? '✓ ' : ''}Cash Application Complete`;
    const mainBox = document.getElementById('applyFastBox');
    if (mainBox) mainBox.dataset.outcome = kind.toLowerCase();

    box.innerHTML = `
      <div id="${ctx.single ? 'afApplyResult' : 'afMultiResult'}" data-kind="${kind}" class="af-sum ${kind === 'HALTED' ? 'bad' : clean ? 'done' : 'warn'}">
        <b class="af-sum-title">${heading}</b>
        <div class="af-sum-sub">${esc(core.applyEndMessage(kind, ctx.applied, ctx.planned, ctx.halt))} · ${(info.ms / 1000).toFixed(1)} s</div>
        <div class="af-sum-sub">Confirmed Payment change: ${fmtUS(ctx.paymentDelta)}</div>
        <div class="af-chips">${chipsHtml}</div>
        ${info.totalMismatch ? warn("NetSuite's Applied total does not match the confirmed Payment changes. Review the results before saving.") : ''}
        ${ctx.returnNote ? warn(ctx.returnNote) : ''}
        ${trialWarning ? warn('Less than 24 hours left on your Review & Reconciliation trial. Cash application stays free.') : ''}
        ${where ? `<div class="af-sum-sub">${esc(where)}</div>` : ''}
        <div class="af-sum-sub" style="margin-top:6px;">Review the results, then Save in NetSuite when ready. ApplyFast never saves.</div>
      </div>
      <div class="af-table-wrap">
        <table class="af-table">
          <colgroup><col style="width:104px;"><col style="width:66px;"><col style="width:80px;"><col style="width:80px;"><col></colgroup>
          <thead><tr><th>Invoice</th><th class="num">Requested</th><th class="num">Written Pay/Disc</th><th class="num">Actual Pay/Disc</th><th>Status</th></tr></thead>
          <tbody>${pagesHtml}${extraHtml}</tbody>
        </table>
      </div>
      ${trialOffer ? '<div class="af-locked" data-trial-offer="1"><div class="af-locked-text"><b>Try Review & Reconciliation</b>Confirm to start a 14-day trial. Cash application stays free.</div><button type="button" class="af-btn af-primary" data-trial="confirm">Start trial</button><button type="button" class="af-btn af-secondary" data-trial="decline">Not now</button></div>' : ''}
      ${premium ? '' : lockedHtml('review')}
      <div class="af-actions">
        ${premium ? '<button id="afExportBtn" class="af-btn af-secondary" type="button" title="Download the Cash Application Report (Excel) with the write results">Export Excel</button>' : ''}
        <button id="afClearBtn" class="af-btn af-secondary" type="button">Close</button>
      </div>`;
    box.onchange = null;
    bindUpgradeButtons(box);
    if (trialWarning) askBackground({ type: 'license:markTrialWarning' });
    const trialConfirm = box.querySelector('[data-trial="confirm"]');
    if (trialConfirm) trialConfirm.onclick = async () => {
      trialConfirm.disabled = true;
      const reply = await askBackground({ type: 'license:startTrial' });
      if (reply && reply.ok) {
        await refreshLicense();
        renderApplyResults(ctx, kind, info);
      } else trialConfirm.disabled = false;
    };
    const trialDecline = box.querySelector('[data-trial="decline"]');
    if (trialDecline) trialDecline.onclick = () => {
      trialDeclinedCtx = ctx;
      renderApplyResults(ctx, kind, info);
    };
    const exportBtn = document.getElementById('afExportBtn');
    if (exportBtn) exportBtn.onclick = () => exportReconciliation(ctx.recon, { rows, counts });
    // Results and any trial offer stay on screen. Support waits until Close, and only if this
    // Apply was clean. premium is the Review & Reconciliation entitlement already resolved above.
    noteMonthlySupportAfterApply(clean);
    document.getElementById('afClearBtn').onclick = () => {
      const trialOfferStillOpen = !!box.querySelector('[data-trial-offer]');
      clearPreview();
      maybeShowMonthlySupportAfterResultsClose(trialOfferStillOpen, premium);
    };
  }

  /***********************
   * PASTE + RESET
   * Reset clears ApplyFast's working session: the references, the review, the results and the
   * rows ApplyFast ticked on the loaded page that still hold exactly what it wrote. It only touches
   * the unsaved form fields writeRow touched, never saves and makes no requests; a saved payment is
   * not undone (its fields are locked, or the page has already reloaded).
   ***********************/
  const REFS_HELP = 'Paste invoice, PO, or sublist line references.';
  // Rows written since the last Reset: { lineIndex, ref, page, before, after } (after = values read
  // back; page = { start, end, total, text } of the range the row was written on).
  let sessionWrites = [];

  function showRefsNote(text) {
    const el = document.getElementById('afRefsHelp');
    if (!el) return;
    el.textContent = text || REFS_HELP;
    el.classList.toggle('af-help-note', !!text);
  }

  // execCommand keeps the paste on the textarea's undo stack (Ctrl+Z); setting the value is the fallback.
  function replaceRefsText(area, edit) {
    const before = area.value;
    const expected = before.slice(0, edit.start) + edit.text + before.slice(edit.end);
    area.setSelectionRange(edit.start, edit.end);
    let done = false;
    try { done = area.ownerDocument.execCommand('insertText', false, edit.text); } catch (e) { done = false; }
    if (!done || area.value !== expected) {
      area.value = expected;
      area.dispatchEvent(new Event('input', { bubbles: true }));
    }
    area.setSelectionRange(edit.cursor, edit.cursor);
  }

  function recordWrite(record) {
    const key = globalThis.ApplyFastCore.normalizeRef(record.ref);
    const known = sessionWrites.find(r => r.lineIndex === record.lineIndex && globalThis.ApplyFastCore.normalizeRef(r.ref) === key);
    if (known) { known.after = record.after; known.page = record.page || known.page; }
    else sessionWrites.push(record);
  }

  // A Reset that is visiting other pages to untick rows.
  let resetRun = null;

  function workspaceBusy() {
    return !!(applyRun || multiApply || resetRun || (scanRun && scanRun.auto && !scanRun.auto.done));
  }

  function requestReset() {
    if (workspaceBusy()) return;
    const area = document.getElementById('matchListArea');
    const hasText = !!(area && area.value.trim());
    if (!hasText && !sessionWrites.length) { resetWorkspace(); return; }
    const el = document.getElementById('afResetConfirm');
    if (!el) return;
    const others = otherResetPages(sessionWrites, loadedRange()).length;
    const rowsText = !sessionWrites.length ? ''
      : others ? ` Rows ApplyFast ticked are unticked on this page and ${plural(others, 'other page', 'other pages')}; ApplyFast switches pages to do it, then returns here.`
      : ' Rows ApplyFast ticked on this page are unticked.';
    el.innerHTML = '<b id="afResetTitle">Reset ApplyFast?</b>' +
      '<div>This clears the current remittance and review results.' + rowsText +
      ' Nothing saved in NetSuite is changed.</div>' +
      '<div class="af-actions"><button id="afResetCancel" class="af-btn af-secondary" type="button">Cancel</button>' +
      '<button id="afResetConfirmBtn" class="af-btn af-apply" type="button">Reset</button></div>';
    el.hidden = false;
    document.getElementById('afResetConfirmBtn').focus();
  }

  function closeResetConfirm(refocus) {
    const el = document.getElementById('afResetConfirm');
    if (!el || el.hidden) return;
    el.hidden = true;
    el.innerHTML = '';
    const btn = document.getElementById('afResetBtn');
    if (refocus && btn) btn.focus();
  }

  // Undoes writeRow on the unsaved form: the same fields and events, with blank values.
  function untickRow(row, discountInput) {
    row.checkbox.checked = false;
    row.amountInput.value = '';
    row.amountInput.dispatchEvent(new Event('input', { bubbles: true }));
    row.amountInput.dispatchEvent(new Event('change', { bubbles: true }));
    if (discountInput && (discountInput.value || '').trim() && !discountInput.disabled && !discountInput.readOnly) {
      discountInput.value = '';
      ['input', 'keyup', 'change', 'blur'].forEach(type => discountInput.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })));
    }
  }

  // Unticks the records whose rows are on the loaded page; returns the records that are not.
  function untickRecords(core, doc, records, out, pageKey) {
    if (!records.length) return [];
    const snap = readApplyRows(doc);
    const rows = snap.error ? [] : snap.rows;
    const keyOf = (lineIndex, ref) => (lineIndex != null ? 'L' + lineIndex : 'R' + core.normalizeRef(ref));
    const byKey = new Map(rows.map(r => [keyOf(r.lineIndex, r.ref), r]));
    const pending = [];
    records.forEach(rec => {
      const r = byKey.get(keyOf(rec.lineIndex, rec.ref));
      const disc = r && r.discountCell ? r.discountCell.querySelector('input[type="text"], input[type="number"]') : null;
      const now = r ? {
        lineIndex: r.lineIndex, ref: r.ref,
        checked: !!(r.checkbox && r.checkbox.checked),
        payment: r.amountInput ? (r.amountInput.value || '') : '',
        discount: disc ? (disc.value || '') : '',
        disabled: !r.checkbox || !r.amountInput || r.checkbox.disabled || r.amountInput.disabled || r.amountInput.readOnly
      } : null;
      const action = core.resetRowAction(rec, now);
      if (action === 'NOT_ON_PAGE') { pending.push(rec); return; }
      if (action !== 'CLEAR') { out[action].push(rec.ref); return; }
      try { untickRow(r, disc); } catch (e) { console.error('ApplyFast reset error', e); }
      const pay = (r.amountInput.value || '').trim();
      const payValue = pay ? core.parseAmountStrict(pay) : { ok: true, value: 0 };
      if (!r.checkbox.checked && payValue.ok && !payValue.value) { out.cleared.push(rec.ref); out.pages.add(pageKey); }
      else out.failed.push(rec.ref);
    });
    return pending;
  }

  function pageOfRange(text) {
    const r = globalThis.ApplyFastCore.parseRange(text);
    return r ? { start: r.start, end: r.end, total: r.total, text } : null;
  }

  // Other pages holding rows written this session, in list order.
  function otherResetPages(records, here) {
    const pages = new Map();
    records.forEach(r => {
      if (r.page && !(here && r.page.start === here.start && r.page.end === here.end)) pages.set(r.page.start, r.page);
    });
    return Array.from(pages.values()).sort((a, b) => a.start - b.start);
  }

  function loadedRange() {
    const input = getFrameWithInputs().doc.querySelector('input[name="inpt_applyrange"]');
    return input ? pageOfRange(input.value || '') : null;
  }

  const RESET_INPUT_TEXTS = {
    range: 'The NetSuite range was changed by hand',
    list: 'The NetSuite page was edited during Reset'
  };

  function showResetProgress(k, n, text) {
    const box = document.getElementById('afPreview');
    if (!box) return;
    box.onchange = null;
    box.innerHTML = `<div id="afResetStatus" class="af-status" aria-live="polite"><b>Resetting… page ${k} of ${n}</b><br>Unticking the rows ApplyFast applied on ${esc(text)}.</div>` +
      '<div class="af-note">Please do not edit the NetSuite page until Reset finishes. ApplyFast never saves.</div>';
  }

  // Visits the other pages with the multi-page Apply page switch, unticks each page's rows the same
  // way as on the loaded page, then returns to the starting page. Returns the records not reached.
  async function untickOtherPages(core, records, out) {
    const ctx = resetRun = {
      core, doc: getFrameWithInputs().doc, settle: null, firstRow: null, rowGen: 0,
      auto: { done: false, interrupted: '' }, detachInput: null, halt: '', stopRequested: false, completed: false, expected: null
    };
    let pending = records.slice();
    let returnNote = '';
    setPanelState('resetting');
    setApplyingUi(true);
    watchUserInput(ctx, RESET_INPUT_TEXTS);
    try {
      if (!(await applyWaitSettled(ctx, 0)) || !ctx.settle.range) {
        ctx.halt = 'NetSuite did not finish loading the page';
      } else {
        const here = ctx.settle.range;
        const obs = applyObserve(ctx);
        const pages = otherResetPages(pending, here).filter(p => p.total === here.total);
        const full = pages.find(p => p.end < p.total);
        const pageSize = here.end < here.total ? here.end - here.start + 1 : full ? full.end - full.start + 1 : here.end - here.start + 1;
        ctx.expected = { customerId: obs.customerId, total: here.total, pageSize };
        const start = { start: here.start, end: here.end, text: obs.rangeText };
        for (let k = 0; k < pages.length; k++) {
          const page = pages[k];
          showResetProgress(k + 1, pages.length, page.text);
          const failed = await applySwitchPage(ctx, page);
          if (failed || ctx.halt || ctx.auto.interrupted) { ctx.halt = ctx.halt || ctx.auto.interrupted || failed; break; }
          const here2 = pending.filter(r => r.page && r.page.start === page.start);
          const left = untickRecords(core, ctx.doc, here2, out, page.start);
          pending = pending.filter(r => !here2.includes(r)).concat(left);
          await applyWaitSettled(ctx, performance.now());
        }
        ctx.completed = true;
        const range = ctx.settle.range;
        if (!ctx.halt && !ctx.auto.interrupted && !(range && range.start === start.start && range.end === start.end)) {
          showResetProgress(pages.length, pages.length, 'the starting page');
          const failed = await applySwitchPage(ctx, start);
          if (failed) returnNote = `ApplyFast could not return to the starting page ${start.text} (${failed}).`;
        }
      }
    } catch (e) {
      console.error('ApplyFast reset error', e);
      if (!ctx.halt) ctx.halt = 'An unexpected error occurred';
    } finally {
      ctx.auto.done = true;
      if (ctx.detachInput) { ctx.detachInput(); ctx.detachInput = null; }
      blurRangeControl(ctx.doc);
      resetRun = null;
      setApplyingUi(false);
    }
    return { pending, halt: ctx.halt || ctx.auto.interrupted || '', returnNote };
  }

  function resetNoteHtml(out, halt, returnNote) {
    const refs = list => (list.length > 6 ? list.slice(0, 6).join(', ') + ` and ${list.length - 6} more` : list.join(', '));
    const lines = [];
    const where = out.pages.size > 1 ? ` across ${out.pages.size} pages` : out.pages.has('here') ? ' on this page' : '';
    if (out.cleared.length) lines.push(`Unticked ${plural(out.cleared.length, 'row', 'rows')} ApplyFast applied${where}.`);
    if (halt) lines.push(`Reset stopped: ${halt}. Rows on pages it did not reach are still ticked; click Reset again to finish.`);
    if (returnNote) lines.push(returnNote);
    if (out.failed.length) lines.push(`Could not untick ${refs(out.failed)}; check ${out.failed.length === 1 ? 'it' : 'them'} in NetSuite.`);
    if (out.NOT_ON_PAGE.length) lines.push(`Could not reach ${plural(out.NOT_ON_PAGE.length, 'row', 'rows')} ApplyFast applied (${refs(out.NOT_ON_PAGE)}). Click Reset again, or untick ${out.NOT_ON_PAGE.length === 1 ? 'it' : 'them'} in NetSuite.`);
    if (out.HAD_VALUES.length) lines.push(`Left as ${out.HAD_VALUES.length === 1 ? 'it is' : 'they are'} because ${out.HAD_VALUES.length === 1 ? 'it' : 'they'} had a Payment before Apply: ${refs(out.HAD_VALUES)}.`);
    if (out.EDITED.length) lines.push(`Left as ${out.EDITED.length === 1 ? 'it is' : 'they are'} because ${out.EDITED.length === 1 ? 'it was' : 'they were'} changed after Apply: ${refs(out.EDITED)}.`);
    if (out.LOCKED.length) lines.push(`Left as ${out.LOCKED.length === 1 ? 'it is' : 'they are'} because the fields are locked: ${refs(out.LOCKED)}.`);
    if (!lines.length) return '';
    const warn = halt || returnNote || out.failed.length || out.NOT_ON_PAGE.length || out.HAD_VALUES.length || out.EDITED.length || out.LOCKED.length;
    return `<div id="afResetNote" class="af-notice${warn ? '' : ' af-reset-note'}"><b>ApplyFast was reset.</b> Nothing saved in NetSuite was changed.\n${esc(lines.join('\n'))}</div>`;
  }

  async function resetWorkspace() {
    if (workspaceBusy()) return;
    const core = globalThis.ApplyFastCore;
    closeResetConfirm(false);
    stopScan();
    preview = null;
    multiPreview = null;
    const out = { cleared: [], failed: [], NOT_ON_PAGE: [], HAD_VALUES: [], EDITED: [], LOCKED: [], pages: new Set() };
    let halt = '', returnNote = '';
    if (core && sessionWrites.length) {
      let pending = untickRecords(core, getFrameWithInputs().doc, sessionWrites, out, 'here');
      if (otherResetPages(pending, loadedRange()).length) {
        const r = await untickOtherPages(core, pending, out);
        pending = r.pending;
        halt = r.halt;
        returnNote = r.returnNote;
      }
      pending.forEach(rec => { if (!halt) out.NOT_ON_PAGE.push(rec.ref); });
      sessionWrites = pending;
    }
    const area = document.getElementById('matchListArea');
    if (area) { area.value = ''; area.readOnly = false; }
    const cashInput = document.getElementById('afPaymentReceived');
    if (cashInput) { cashInput.value = ''; cashInput.readOnly = false; }
    renderCashInput();
    showRefsNote('');
    const counter = document.getElementById('matchCounter');
    if (counter) { counter.textContent = '0 cash application matches'; counter.style.color = ''; counter.title = ''; }
    const mainBox = document.getElementById('applyFastBox');
    if (mainBox) delete mainBox.dataset.outcome;
    const box = document.getElementById('afPreview');
    if (box) { box.onchange = null; box.innerHTML = resetNoteHtml(out, halt, returnNote); }
    setPanelState('idle');
    if (area) area.focus({ preventScroll: true });
  }

  /***********************
   * INIT only on custpymt.nl Create Payment UI
   ***********************/
  (function initWhenOnCreatePayment() {
    const tryInit = async (docContext = document) => {
      try {
        if (isCreatePaymentPage(docContext)) {
          waitForApplyRows(createUI);
          return true;
        }
      } catch (e) {
        console.error('tryInit error', e);
      }
      return false;
    };

    (async () => {
      const frameInfo = getFrameWithInputs();
      const initialized = await tryInit(frameInfo.doc);
      if (initialized) return;

      let lastHref = location.href;
      const navObserver = new MutationObserver(async () => {
        try {
          if (location.href !== lastHref) {
            lastHref = location.href;
            const frameInfo2 = getFrameWithInputs();
            if (await tryInit(frameInfo2.doc)) {
              navObserver.disconnect();
              return;
            }
          } else {
            const frameInfo3 = getFrameWithInputs();
            if (await tryInit(frameInfo3.doc)) {
              navObserver.disconnect();
              return;
            }
          }
        } catch (e) { /* ignore and continue observing */ }
      });

      navObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });

      setTimeout(async () => {
        try {
          const frameInfo4 = getFrameWithInputs();
          if (await tryInit(frameInfo4.doc)) navObserver.disconnect();
        } catch (e) {}
      }, 3000);
    })();
  })();

  function waitForApplyRows(callback) {
    const existing = findAmountInputs();
    if (existing.length > 0) { try { callback(); } catch (e) { console.error('createUI callback error', e); } return; }
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      const inputs = findAmountInputs();
      if (inputs.length > 0) { clearInterval(poll); if (observer) observer.disconnect(); try { callback(); } catch (e) { console.error('createUI callback error', e); } } else if (attempts > 40) { clearInterval(poll); }
    }, 500);
    let observer = new MutationObserver((mutations, obs) => {
      const inputs = findAmountInputs();
      if (inputs.length > 0) { if (poll) clearInterval(poll); obs.disconnect(); try { callback(); } catch (e) { console.error('createUI callback error', e); } }
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
  }

})();
