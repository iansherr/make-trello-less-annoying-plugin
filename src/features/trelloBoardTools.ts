/**
 * Trello Board Power Tools (Feature)
 * Provides:
 * 1. Automatic checklist completion progress badges ([3/5], [5/5]) next to card numbers.
 * 2. Board scraping into clean structured models.
 * 3. One-click CSV and Markdown board export with download and clipboard actions.
 */

import { escapeHtml, sanitizeCsvCell } from '../shared/security';

export interface TrelloChecklistProgress {
  done: number;
  total: number;
}

export interface TrelloBoardCard {
  id: string;
  number: string;
  title: string;
  list: string;
  labels: string[];
  dueDate: string;
  checklist?: TrelloChecklistProgress;
}

export interface TrelloBoardList {
  name: string;
  cards: TrelloBoardCard[];
}

export interface TrelloBoardData {
  title: string;
  url: string;
  lists: TrelloBoardList[];
}

export function parseChecklistText(rawText: string): TrelloChecklistProgress | undefined {
  if (!rawText) return undefined;
  const match = rawText.match(/(\d+)\s*[/|\\]\s*(\d+)/);
  if (match) {
    const done = parseInt(match[1], 10);
    const total = parseInt(match[2], 10);
    if (!isNaN(done) && !isNaN(total) && total > 0) {
      return { done, total };
    }
  }
  return undefined;
}

export function scanTrelloBoard(doc: Document = document): TrelloBoardData {
  const boardTitleEl = doc.querySelector<HTMLElement>(
    '[data-testid="board-name-display"], .js-board-editing-target, h1'
  );
  const title = boardTitleEl?.textContent?.trim() || doc.title || 'Trello Board';
  const url = typeof window !== 'undefined' && window.location?.href ? window.location.href : '';

  const lists: TrelloBoardList[] = [];
  const listEls = doc.querySelectorAll<HTMLElement>('[data-testid="list"], .js-list, .list');

  listEls.forEach((listEl, lIdx) => {
    const nameEl = listEl.querySelector<HTMLElement>(
      '[data-testid="list-name"], .list-header-name-assist, .js-list-name-assist, h2'
    );
    const listName = nameEl?.textContent?.trim() || `List ${lIdx + 1}`;

    const cards: TrelloBoardCard[] = [];
    const cardEls = listEl.querySelectorAll<HTMLElement>(
      '[data-testid="trello-card"], [data-testid="list-card"], .list-card'
    );

    cardEls.forEach((cardEl, cIdx) => {
      const link = cardEl.querySelector<HTMLAnchorElement>('a[href*="/c/"]');
      const href = link?.getAttribute('href') || '';
      const match = href.match(/\/c\/([^/]+)(?:\/(\d+)-?([^/]*))?/);

      const cardId = match && match[1] ? match[1] : `c-${lIdx}-${cIdx}`;
      let cardNumber = match && match[2] ? match[2] : '';

      if (!cardNumber) {
        const numSpan = cardEl.querySelector('.tcnp-short-card-number');
        if (numSpan && numSpan.textContent) {
          const numMatch = numSpan.textContent.match(/\d+/);
          if (numMatch) cardNumber = numMatch[0];
        }
      }

      // Title
      const titleEl = cardEl.querySelector<HTMLElement>('[data-testid="card-name"], .list-card-title, a[href*="/c/"]');
      let cardTitle = titleEl?.textContent?.trim() || 'Untitled Card';
      if (cardNumber && cardTitle.startsWith(`#${cardNumber}`)) {
        cardTitle = cardTitle.replace(new RegExp(`^#${cardNumber}\\s*`), '').trim();
      }

      // Labels
      const labelEls = cardEl.querySelectorAll<HTMLElement>('[data-testid="card-label"], .card-label, .js-card-label');
      const labels: string[] = [];
      labelEls.forEach((lbl) => {
        const text = lbl.textContent?.trim();
        if (text && !labels.includes(text)) labels.push(text);
      });

      // Due date
      const dueEl = cardEl.querySelector<HTMLElement>(
        '[data-testid="badge-due-date"], [title*="due" i], .badge[title*="due" i]'
      );
      const dueDate = dueEl?.textContent?.trim() || '';

      // Checklist badge
      let checklist: TrelloChecklistProgress | undefined;
      const checklistEl = cardEl.querySelector<HTMLElement>(
        '[data-testid="checklist-badge"], [title*="Checklist" i], [aria-label*="Checklist" i], .badge[title*="checklist" i]'
      );
      if (checklistEl?.textContent) {
        checklist = parseChecklistText(checklistEl.textContent);
      }

      cards.push({
        id: cardId,
        number: cardNumber,
        title: cardTitle,
        list: listName,
        labels,
        dueDate,
        checklist,
      });
    });

    if (cards.length > 0 || listName) {
      lists.push({ name: listName, cards });
    }
  });

  return { title, url, lists };
}

export function exportBoardToMarkdown(board: TrelloBoardData): string {
  const lines: string[] = [];
  lines.push(`# ${board.title}`);
  if (board.url) {
    lines.push(`URL: ${board.url}`);
  }
  lines.push('');

  for (const list of board.lists) {
    lines.push(`## ${list.name}`);
    if (list.cards.length === 0) {
      lines.push('_No cards_');
    } else {
      for (const card of list.cards) {
        const numPart = card.number ? `[#${card.number}] ` : '';
        const labelsPart = card.labels.length ? ` *(Labels: ${card.labels.join(', ')})*` : '';
        const duePart = card.dueDate ? ` *(Due: ${card.dueDate})*` : '';
        const checkPart = card.checklist ? ` **[${card.checklist.done}/${card.checklist.total}]**` : '';
        lines.push(`- ${numPart}${card.title}${checkPart}${labelsPart}${duePart}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

export function exportBoardToCsv(board: TrelloBoardData): string {
  const rows: string[] = [];

  rows.push(['Card Number', 'Title', 'List', 'Labels', 'Due Date', 'Checklist'].map(sanitizeCsvCell).join(','));

  for (const list of board.lists) {
    for (const card of list.cards) {
      const checkStr = card.checklist ? `${card.checklist.done}/${card.checklist.total}` : '';
      rows.push(
        [card.number ? `#${card.number}` : '', card.title, list.name, card.labels.join(', '), card.dueDate, checkStr]
          .map(sanitizeCsvCell)
          .join(',')
      );
    }
  }

  return rows.join('\r\n');
}

export function enhanceCardChecklistBadges(doc: Document = document): void {
  const cardEls = doc.querySelectorAll<HTMLElement>(
    '[data-testid="trello-card"], [data-testid="list-card"], .list-card'
  );

  cardEls.forEach((cardEl) => {
    const checklistBadge = cardEl.querySelector<HTMLElement>(
      '[data-testid="checklist-badge"], [title*="Checklist" i], [aria-label*="Checklist" i], .badge[title*="checklist" i]'
    );
    if (!checklistBadge || !checklistBadge.textContent) return;

    const progress = parseChecklistText(checklistBadge.textContent);
    if (!progress) return;

    let pill = cardEl.querySelector<HTMLElement>('.ikmal-checklist-pill');
    if (!pill) {
      pill = doc.createElement('span');
      pill.className = 'ikmal-checklist-pill';
      const anchor = cardEl.querySelector('.tcnp-short-card-number') || cardEl.querySelector('a[href*="/c/"]');
      if (anchor && anchor.parentElement) {
        anchor.insertAdjacentElement('afterend', pill);
      } else {
        cardEl.prepend(pill);
      }
    }

    const isComplete = progress.done === progress.total;
    pill.textContent = `[${progress.done}/${progress.total}]`;
    pill.style.cssText = `
      display: inline-flex;
      align-items: center;
      margin-left: 4px;
      margin-right: 4px;
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.2;
      vertical-align: baseline;
      background: ${isComplete ? 'rgba(16, 185, 129, 0.16)' : 'rgba(59, 130, 246, 0.16)'};
      border: 1px solid ${isComplete ? 'rgba(16, 185, 129, 0.4)' : 'rgba(59, 130, 246, 0.4)'};
      color: ${isComplete ? '#10b981' : '#3b82f6'};
    `;
    pill.title = `Checklist Progress: ${progress.done} of ${progress.total} completed`;
  });
}

let activeExportHost: HTMLElement | null = null;

export function closeBoardExportModal(): void {
  if (activeExportHost) {
    activeExportHost.remove();
    activeExportHost = null;
  }
}

export function openBoardExportModal(boardData: TrelloBoardData = scanTrelloBoard()): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  closeBoardExportModal();

  const mdContent = exportBoardToMarkdown(boardData);
  const csvContent = exportBoardToCsv(boardData);

  const host = document.createElement('div');
  host.id = 'ikmal-board-export-host';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :host {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(14, 14, 18, 0.65);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    .modal {
      position: relative;
      z-index: 1;
      width: 90%;
      max-width: 680px;
      max-height: 85vh;
      background: #18181c;
      border: 1px solid rgba(232, 232, 236, 0.16);
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.65);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: #e8e8ec;
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      border-bottom: 1px solid rgba(232, 232, 236, 0.08);
      background: #1e1e24;
    }
    .modal-title {
      font-size: 14px;
      font-weight: 600;
    }
    .close-btn {
      background: transparent;
      border: none;
      color: #9c9ca4;
      cursor: pointer;
      font-size: 16px;
      padding: 4px;
      border-radius: 4px;
    }
    .close-btn:hover {
      color: #fff;
    }
    .tabs {
      display: flex;
      gap: 8px;
      padding: 12px 20px 0;
      background: #18181c;
      border-bottom: 1px solid rgba(232, 232, 236, 0.08);
    }
    .tab-btn {
      padding: 6px 14px;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      color: #9c9ca4;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .tab-btn.is-active {
      color: #7b6cd9;
      border-bottom-color: #7b6cd9;
    }
    .preview-box {
      flex: 1;
      padding: 16px 20px;
      min-height: 240px;
      max-height: 380px;
      overflow-y: auto;
    }
    textarea {
      width: 100%;
      height: 100%;
      min-height: 240px;
      background: #141418;
      border: 1px solid rgba(232, 232, 236, 0.1);
      border-radius: 6px;
      color: #d1d1d6;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      line-height: 1.5;
      padding: 12px;
      resize: vertical;
      outline: none;
    }
    .modal-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      border-top: 1px solid rgba(232, 232, 236, 0.08);
      background: #1e1e24;
      gap: 8px;
    }
    .action-group {
      display: flex;
      gap: 8px;
    }
    .btn {
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid rgba(232, 232, 236, 0.16);
      background: #25252b;
      color: #e8e8ec;
      transition: all 120ms ease;
    }
    .btn:hover {
      background: #2e2e36;
      border-color: #7b6cd9;
    }
    .btn-primary {
      background: #7b6cd9;
      border-color: #7b6cd9;
      color: #ffffff;
    }
    .btn-primary:hover {
      background: #6c5cc8;
    }
  `;

  const container = document.createElement('div');
  container.className = 'modal';
  container.innerHTML = `
    <div class="backdrop" id="backdrop"></div>
    <div style="position: relative; z-index: 1; display: flex; flex-direction: column; width: 100%;">
      <div class="modal-header">
        <div class="modal-title">Export Trello Board: ${escapeHtml(boardData.title)}</div>
        <button class="close-btn" id="btn-close">✕</button>
      </div>
      <div class="tabs">
        <button class="tab-btn is-active" id="tab-md">Markdown (.md)</button>
        <button class="tab-btn" id="tab-csv">CSV (.csv)</button>
      </div>
      <div class="preview-box">
        <textarea id="export-text" readonly>${escapeHtml(mdContent)}</textarea>
      </div>
      <div class="modal-actions">
        <span style="font-size: 11px; color: #9c9ca4;" id="status-hint">${boardData.lists.reduce(
          (acc, l) => acc + l.cards.length,
          0
        )} cards loaded</span>
        <div class="action-group">
          <button class="btn" id="btn-copy">Copy to Clipboard</button>
          <button class="btn btn-primary" id="btn-download">Download File</button>
        </div>
      </div>
    </div>
  `;

  shadow.appendChild(style);
  shadow.appendChild(container);
  document.body.appendChild(host);
  activeExportHost = host;

  const backdrop = shadow.getElementById('backdrop');
  const btnClose = shadow.getElementById('btn-close');
  const tabMd = shadow.getElementById('tab-md');
  const tabCsv = shadow.getElementById('tab-csv');
  const textarea = shadow.getElementById('export-text') as HTMLTextAreaElement | null;
  const btnCopy = shadow.getElementById('btn-copy');
  const btnDownload = shadow.getElementById('btn-download');
  const statusHint = shadow.getElementById('status-hint');

  let currentMode: 'md' | 'csv' = 'md';

  backdrop?.addEventListener('click', closeBoardExportModal);
  btnClose?.addEventListener('click', closeBoardExportModal);

  tabMd?.addEventListener('click', () => {
    currentMode = 'md';
    tabMd.classList.add('is-active');
    tabCsv?.classList.remove('is-active');
    if (textarea) textarea.value = mdContent;
  });

  tabCsv?.addEventListener('click', () => {
    currentMode = 'csv';
    tabCsv.classList.add('is-active');
    tabMd?.classList.remove('is-active');
    if (textarea) textarea.value = csvContent;
  });

  btnCopy?.addEventListener('click', () => {
    const text = currentMode === 'md' ? mdContent : csvContent;
    navigator.clipboard?.writeText(text);
    if (statusHint) statusHint.textContent = 'Copied to clipboard! ✓';
    setTimeout(() => {
      if (statusHint)
        statusHint.textContent = `${boardData.lists.reduce((acc, l) => acc + l.cards.length, 0)} cards loaded`;
    }, 1800);
  });

  btnDownload?.addEventListener('click', () => {
    const isMd = currentMode === 'md';
    const content = isMd ? mdContent : csvContent;
    const blob = new Blob([content], { type: isMd ? 'text/markdown;charset=utf-8;' : 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeTitle =
      boardData.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'trello-board';
    a.href = url;
    a.download = `${safeTitle}.${isMd ? 'md' : 'csv'}`;
    a.click();
    URL.revokeObjectURL(url);
  });

  return host;
}

export function initTrelloBoardTools(): () => void {
  if (typeof document === 'undefined') return () => undefined;

  enhanceCardChecklistBadges();

  let rafId: number | null = null;
  const observer = new MutationObserver(() => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      enhanceCardChecklistBadges();
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    closeBoardExportModal();
  };
}
