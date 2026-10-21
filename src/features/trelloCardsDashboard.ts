/**
 * Trello Cards View Dashboard Enhancer
 * Enhances Trello's Personal Settings -> Cards view (https://trello.com/u/<user>/cards)
 * Provides:
 * 1. Multi-column sorting (List, Board, Labels, Due Date, Card Title)
 * 2. Multi-facet filtering (Toggle lists, toggle boards, toggle labels)
 * 3. Quick instant search and active card counts
 */

export interface CardRowItem {
  element: HTMLElement;
  title: string;
  list: string;
  labels: string[];
  dueDate: string;
  dueTimestamp: number;
  board: string;
}

export type SortColumn = 'card' | 'list' | 'labels' | 'due' | 'board' | 'priority';
export type SortDirection = 'asc' | 'desc';

export interface DashboardState {
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  selectedBoards: Set<string>;
  selectedLists: Set<string>;
  selectedLabels: Set<string>;
  searchQuery: string;
  /** Ordered by rank: index 0 is the highest-priority list. */
  starredLists?: string[];
}

const state: DashboardState = {
  sortColumn: 'priority',
  sortDirection: 'asc',
  selectedBoards: new Set(),
  selectedLists: new Set(),
  selectedLabels: new Set(),
  searchQuery: '',
  starredLists: [],
};

const PREFS_KEY = 'ikmal_trello_dashboard_prefs';
const STAR_COLOR = '#f5c542';

export interface DefaultView {
  boards: string[];
  lists: string[];
  labels: string[];
  search: string;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
}

interface DashboardPrefs {
  defaultView: DefaultView | null;
  /** Lists the user added by hand so they show even while empty. */
  pinnedLists: string[];
}

const prefs: DashboardPrefs = { defaultView: null, pinnedLists: [] };
let prefsLoaded = false;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const SORT_COLUMNS: SortColumn[] = ['card', 'list', 'labels', 'due', 'board', 'priority'];

function readStored(): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get([PREFS_KEY], (items) => resolve(items?.[PREFS_KEY]));
        return;
      }
    } catch {
      // fall through to localStorage
    }
    try {
      resolve(JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'));
    } catch {
      resolve(null);
    }
  });
}

function writeStored(): void {
  const payload = { ...prefs, starredLists: state.starredLists ?? [] };
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ [PREFS_KEY]: payload });
      return;
    }
  } catch {
    // fall through to localStorage
  }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(payload));
  } catch {
    // storage unavailable: preferences just won't persist
  }
}

function applyView(view: DefaultView | null): void {
  state.selectedBoards = new Set(view?.boards ?? []);
  state.selectedLists = new Set(view?.lists ?? []);
  state.selectedLabels = new Set(view?.labels ?? []);
  state.searchQuery = view?.search ?? '';
  state.sortColumn = view?.sortColumn ?? 'priority';
  state.sortDirection = view?.sortDirection ?? 'asc';
}

function readAutoLoadSetting(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        chrome.storage.sync.get({ configs: {} }, (res) => resolve(res?.configs?.autoLoadShowMore !== false));
        return;
      }
    } catch {
      // fall through to the default
    }
    resolve(true);
  });
}

async function loadPrefs(): Promise<void> {
  autoLoadShowMore = await readAutoLoadSetting();
  const raw = (await readStored()) as Record<string, unknown> | null;
  if (raw && typeof raw === 'object') {
    state.starredLists = strings(raw.starredLists);
    prefs.pinnedLists = strings(raw.pinnedLists);
    const dv = raw.defaultView as Record<string, unknown> | null;
    if (dv && typeof dv === 'object') {
      prefs.defaultView = {
        boards: strings(dv.boards),
        lists: strings(dv.lists),
        labels: strings(dv.labels),
        search: typeof dv.search === 'string' ? dv.search : '',
        sortColumn: SORT_COLUMNS.includes(dv.sortColumn as SortColumn) ? (dv.sortColumn as SortColumn) : 'priority',
        sortDirection: dv.sortDirection === 'desc' ? 'desc' : 'asc',
      };
      applyView(prefs.defaultView);
    }
  }
  prefsLoaded = true;
}

function snapshotView(): DefaultView {
  return {
    boards: [...state.selectedBoards],
    lists: [...state.selectedLists],
    labels: [...state.selectedLabels],
    search: state.searchQuery,
    sortColumn: state.sortColumn,
    sortDirection: state.sortDirection,
  };
}

const escapeHtml = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Levenshtein distance, capped: returns max+1 once it can't be within `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Rank existing list names against what the user typed: exact, prefix, substring, all words
 * present, in-order letters (e.g. "rte" -> "Ready to edit"), then small typos. Best first.
 */
export function fuzzyMatchLists(query: string, candidates: string[]): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const scored: Array<[number, string]> = [];
  for (const name of new Set(candidates)) {
    const n = name.toLowerCase();
    let score = 0;
    if (n === q) score = 100;
    else if (n.startsWith(q)) score = 80;
    else if (n.includes(q)) score = 60;
    else if (words.length > 1 && words.every((w) => n.includes(w))) score = 50;
    else if (q.length >= 2 && isSubsequence(q.replace(/\s+/g, ''), n))
      score = n[0] === q[0] ? 43 : 40; // prefer names that start with the first letter typed
    else {
      const max = Math.max(1, Math.floor(q.length / 4));
      const d = editDistance(q, n, max);
      if (d <= max) score = 30 - d;
      else {
        // typo inside one word of a longer name ("redy" vs "ready to edit")
        const wd = Math.min(...n.split(/\s+/).map((w) => editDistance(q, w, max)));
        if (wd <= max) score = 20 - wd;
      }
    }
    if (score) scored.push([score, name]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1])).map(([, name]) => name);
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

/** Starred lists first (in star order), then the rest alphabetically. */
function listRank(list: string, starred: string[]): number {
  const i = starred.indexOf(list);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

const DASHBOARD_BAR_ID = 'iw-trello-dashboard-bar';
let lastRowsSignature = '';
const MAX_SHOW_MORE_CLICKS = 100;
let showMoreClicks = 0;
let lastShowMoreRowCount = -1;
/** Hub setting "Auto-load all cards"; read from the shared Trello configs. */
let autoLoadShowMore = true;
let observer: MutationObserver | null = null;
let isInitialized = false;

/**
 * Parse human date string (e.g. "Oct 19", "Tomorrow", "Yesterday", "Due now") into timestamp.
 */
export function parseTrelloDueDate(text: string): number {
  if (!text || text.trim() === '' || text.trim() === '.') return Infinity;
  const cleaned = text
    .replace(/^[^\w]+/, '')
    .trim()
    .toLowerCase();
  if (!cleaned) return Infinity;

  const now = new Date();
  if (cleaned.includes('tomorrow')) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  }
  if (cleaned.includes('today')) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  if (cleaned.includes('yesterday') || cleaned.includes('overdue')) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  }

  const parsed = Date.parse(`${cleaned} ${now.getFullYear()}`);
  return isNaN(parsed) ? Infinity : parsed;
}

/** First non-empty text node: board cells hold "<board><workspace>" as sibling elements. */
function firstText(el: HTMLElement): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent?.trim();
    if (t) return t;
  }
  return '';
}

/** Map Card/List/Labels/Due date/Board headers to cell indexes, falling back to Trello's default order. */
function columnIndexes(container: HTMLElement): Record<'card' | 'list' | 'labels' | 'due' | 'board', number> {
  const cols = { card: 0, list: 1, labels: 2, due: 3, board: 4 };
  const heads = Array.from(container.querySelectorAll<HTMLElement>('thead th, [role="columnheader"]'));
  heads.forEach((h, i) => {
    const t = h.textContent?.trim().toLowerCase() || '';
    if (t === 'card') cols.card = i;
    else if (t === 'list') cols.list = i;
    else if (t === 'labels') cols.labels = i;
    else if (t.startsWith('due')) cols.due = i;
    else if (t === 'board') cols.board = i;
  });
  return cols;
}

/** Trello pages the table 20 cards at a time behind a "Show more" row. */
export function findShowMore(container: HTMLElement): HTMLElement | null {
  const candidates = container.querySelectorAll<HTMLElement>(
    'tbody tr button, tbody tr a, tbody tr[role="button"], tbody tr'
  );
  for (const el of Array.from(candidates)) {
    if (el.textContent?.trim().toLowerCase() === 'show more') {
      return el.querySelector<HTMLElement>('button, a') || el;
    }
  }
  return null;
}

/**
 * Extract CardRowItem objects from table rows or flex grid rows.
 */
export function extractCardRows(container: HTMLElement): CardRowItem[] {
  // Support both <table><tr> and div[role="row"] or div grid
  const rowElements = Array.from(
    container.querySelectorAll<HTMLElement>('tbody tr, [role="row"], .card-list-item, div[data-testid*="card-row"]')
  );

  const items: CardRowItem[] = [];

  for (const row of rowElements) {
    // Skip header row if caught
    if (row.querySelector('th') || row.closest('thead')) continue;

    // Direct cells only: nested divs inside a cell would shift every column index.
    const cells = Array.from(
      row.querySelectorAll<HTMLElement>(':scope > td, :scope > [role="cell"], :scope > [role="gridcell"]')
    );
    if (cells.length < 3) continue;

    const col = columnIndexes(container);
    const cellText = (i: number): string => (i >= 0 && cells[i] ? firstText(cells[i]) : '');

    let title = cells[col.card >= 0 ? col.card : 0]?.textContent?.trim() || '';
    const listName = cellText(col.list);
    const dueDate = cells[col.due]?.textContent?.trim() || '';
    const board = cellText(col.board);
    const labelCell = cells[col.labels];
    const labels = labelCell
      ? Array.from(labelCell.querySelectorAll<HTMLElement>('[data-color], span'))
          .filter((el) => el.children.length === 0)
          .map((el) => el.getAttribute('data-color') || el.textContent?.trim() || '')
          .filter(Boolean)
      : [];

    if (!title && !listName) continue;

    // Enhance card link with card number badge if not already present
    const cardLink = cells[col.card >= 0 ? col.card : 0].querySelector<HTMLAnchorElement>('a[href*="/c/"]');
    if (cardLink && !cardLink.querySelector('.tcnp-short-card-number')) {
      const match = cardLink.href.match(/\/c\/[^/]+\/(\d+)-/);
      if (match) {
        const cardId = match[1];
        const numSpan = document.createElement('span');
        numSpan.className = 'tcnp-short-card-number';
        numSpan.textContent = `#${cardId} `;
        numSpan.style.cssText = 'color: #7b6cd9; font-weight: 700; margin-right: 4px;';
        cardLink.prepend(numSpan);
        if (!title.startsWith(`#${cardId}`)) {
          title = `#${cardId} ${title}`;
        }
      }
    }

    items.push({
      element: row,
      title,
      list: listName,
      labels,
      dueDate,
      dueTimestamp: parseTrelloDueDate(dueDate),
      board,
    });
  }

  return items;
}

/**
 * Filter and sort rows based on active dashboard state.
 */
export function applyDashboardFilterAndSort(
  rows: CardRowItem[],
  currentState = state
): {
  visibleCount: number;
  totalCount: number;
} {
  const query = currentState.searchQuery.toLowerCase().trim();

  // 1. Filter
  let visibleCount = 0;
  for (const item of rows) {
    let match = true;

    // Board filter
    if (currentState.selectedBoards.size > 0 && !currentState.selectedBoards.has(item.board)) {
      match = false;
    }

    // List filter
    if (match && currentState.selectedLists.size > 0 && !currentState.selectedLists.has(item.list)) {
      match = false;
    }

    // Text search query
    if (match && query) {
      const fullText = `${item.title} ${item.list} ${item.board} ${item.dueDate}`.toLowerCase();
      if (!fullText.includes(query)) {
        match = false;
      }
    }

    item.element.style.display = match ? '' : 'none';
    if (match) visibleCount++;

    // Highlight rows that belong to a starred list.
    const starred = (currentState.starredLists ?? []).includes(item.list);
    item.element.style.boxShadow = starred ? `inset 3px 0 0 ${STAR_COLOR}` : '';
    item.element.style.backgroundColor = starred ? 'rgba(245, 197, 66, 0.08)' : '';
  }

  // 2. Sort
  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    switch (currentState.sortColumn) {
      case 'card':
        cmp = a.title.localeCompare(b.title, undefined, { numeric: true });
        break;
      case 'list':
        cmp = a.list.localeCompare(b.list);
        break;
      case 'priority': {
        const stars = currentState.starredLists ?? [];
        cmp =
          listRank(a.list, stars) - listRank(b.list, stars) ||
          a.list.localeCompare(b.list) ||
          a.dueTimestamp - b.dueTimestamp;
        break;
      }
      case 'board':
        cmp = a.board.localeCompare(b.board);
        break;
      case 'due':
        cmp = a.dueTimestamp - b.dueTimestamp;
        break;
      case 'labels':
        cmp = b.labels.length - a.labels.length;
        break;
      default:
        cmp = 0;
    }
    return currentState.sortDirection === 'asc' ? cmp : -cmp;
  });

  // Re-order DOM elements inside their common parent
  const parent = rows[0]?.element.parentElement;
  if (parent) {
    for (const item of sorted) {
      parent.appendChild(item.element);
    }
  }

  return { visibleCount, totalCount: rows.length };
}

/**
 * Render the interactive sorting and filtering dashboard controls.
 */
export function renderDashboardBar(targetContainer: HTMLElement, rows: CardRowItem[]): HTMLElement {
  let bar = document.getElementById('iw-trello-dashboard-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'iw-trello-dashboard-bar';
    bar.style.cssText = `
      margin: 14px 0 12px 0;
      padding: 12px 14px;
      background: #1e1e24;
      color: #f5f5f7;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      max-width: 100%;
      box-sizing: border-box;
      overflow-x: auto;
    `;
    targetContainer.prepend(bar);
  }

  // Extract unique Lists and Boards
  const starred = state.starredLists ?? [];
  const counts = new Map<string, number>();
  rows.forEach((r) => r.list && counts.set(r.list, (counts.get(r.list) || 0) + 1));
  const allLists = Array.from(new Set([...counts.keys(), ...prefs.pinnedLists, ...starred])).sort(
    (a, b) => listRank(a, starred) - listRank(b, starred) || a.localeCompare(b)
  );
  const allBoards = Array.from(new Set(rows.map((r) => r.board).filter(Boolean))).sort();

  // A re-render must not eat what the user is typing (Trello also mutates rows on its own).
  const prevAdd = bar.querySelector<HTMLInputElement>('#iw-add-list-input');
  const prevAddValue = prevAdd?.value ?? '';
  const refocus = bar.contains(document.activeElement) ? (document.activeElement as HTMLElement).id : '';
  const prevCaret = (document.activeElement as HTMLInputElement | null)?.selectionStart ?? null;

  bar.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-weight: 700; color: #7b6cd9; font-size: 13px;">▤ webtools Card Dashboard</span>
        <span id="iw-card-count-badge" style="background: rgba(255,255,255,0.12); padding: 2px 8px; border-radius: 9999px; font-size: 11px;">
          Showing ${rows.length} of ${rows.length} cards
        </span>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <input type="text" id="iw-cards-search-input" placeholder="Search cards, lists, boards..." style="
          padding: 5px 10px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.18);
          background: #282830;
          color: #fff;
          font-size: 11px;
          outline: none;
          width: 200px;
        " value="${escapeHtml(state.searchQuery)}">
        <button type="button" id="iw-reset-filters-btn" style="
          padding: 5px 10px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.18);
          background: #2c2c36;
          color: #e0e0e6;
          font-size: 11px;
          cursor: pointer;
        ">Reset Filters</button>
        <button type="button" id="iw-save-default-btn" title="Remember the current filters, search and sort as the view this page opens with" style="
          padding: 5px 10px;
          border-radius: 6px;
          border: 1px solid #7b6cd9;
          background: #7b6cd922;
          color: #cfc8ff;
          font-size: 11px;
          cursor: pointer;
        ">${prefs.defaultView ? 'Update default view' : 'Save as default view'}</button>
        ${
          prefs.defaultView
            ? `<button type="button" id="iw-clear-default-btn" title="Forget the saved default view" style="
          padding: 5px 8px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.18);
          background: transparent;
          color: #a0a0ab;
          font-size: 11px;
          cursor: pointer;
        ">Clear default</button>`
            : ''
        }
      </div>
    </div>

    <!-- Quick Sort Row -->
    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap;">
      <span style="font-size: 11px; color: #a0a0ab; font-weight: 600;">Sort By:</span>
      <button type="button" class="iw-sort-btn" data-sort="priority" title="Starred lists first, in the order you starred them" style="padding: 3px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; border: 1px solid rgba(255,255,255,0.15); background: ${
        state.sortColumn === 'priority' ? '#7b6cd9' : '#282830'
      }; color: #fff;">
        ★ Priority ${state.sortColumn === 'priority' ? (state.sortDirection === 'asc' ? '▲' : '▼') : ''}
      </button>
      <button type="button" class="iw-sort-btn" data-sort="list" style="padding: 3px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; border: 1px solid rgba(255,255,255,0.15); background: ${
        state.sortColumn === 'list' ? '#7b6cd9' : '#282830'
      }; color: #fff;">
        List ${state.sortColumn === 'list' ? (state.sortDirection === 'asc' ? '▲' : '▼') : ''}
      </button>
      <button type="button" class="iw-sort-btn" data-sort="board" style="padding: 3px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; border: 1px solid rgba(255,255,255,0.15); background: ${
        state.sortColumn === 'board' ? '#7b6cd9' : '#282830'
      }; color: #fff;">
        Board ${state.sortColumn === 'board' ? (state.sortDirection === 'asc' ? '▲' : '▼') : ''}
      </button>
      <button type="button" class="iw-sort-btn" data-sort="due" style="padding: 3px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; border: 1px solid rgba(255,255,255,0.15); background: ${
        state.sortColumn === 'due' ? '#7b6cd9' : '#282830'
      }; color: #fff;">
        Due Date ${state.sortColumn === 'due' ? (state.sortDirection === 'asc' ? '▲' : '▼') : ''}
      </button>
      <button type="button" class="iw-sort-btn" data-sort="card" style="padding: 3px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; border: 1px solid rgba(255,255,255,0.15); background: ${
        state.sortColumn === 'card' ? '#7b6cd9' : '#282830'
      }; color: #fff;">
        Card Title ${state.sortColumn === 'card' ? (state.sortDirection === 'asc' ? '▲' : '▼') : ''}
      </button>
      <button type="button" class="iw-sort-btn" data-sort="labels" style="padding: 3px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; border: 1px solid rgba(255,255,255,0.15); background: ${
        state.sortColumn === 'labels' ? '#7b6cd9' : '#282830'
      }; color: #fff;">
        Labels ${state.sortColumn === 'labels' ? (state.sortDirection === 'asc' ? '▲' : '▼') : ''}
      </button>
    </div>

    <!-- Filter by List Chips -->
    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: wrap;">
      <span style="font-size: 11px; color: #a0a0ab; font-weight: 600;">Lists:</span>
      ${allLists
        .map((l) => {
          const isStar = starred.includes(l);
          const isPinned = prefs.pinnedLists.includes(l);
          const n = counts.get(l) || 0;
          const sel = state.selectedLists.has(l);
          const border = sel ? '#7b6cd9' : isStar ? STAR_COLOR : 'rgba(255,255,255,0.15)';
          return `<span class="iw-list-chip-group" style="display: inline-flex; align-items: center; gap: 2px;">
          <button type="button" class="iw-star-list-btn" data-list="${escapeHtml(l)}" title="${
            isStar ? 'Remove from priority' : 'Star: highlight and rank this list first'
          }" aria-pressed="${isStar}" style="
            background: none; border: none; cursor: pointer; padding: 0 1px; font-size: 13px; line-height: 1;
            color: ${isStar ? STAR_COLOR : '#6c6c78'};">${isStar ? '★' : '☆'}</button>
          <button type="button" class="iw-filter-list-chip" data-list="${escapeHtml(l)}" style="
            padding: 2px 8px;
            border-radius: 9999px;
            font-size: 10px;
            cursor: pointer;
            max-width: 160px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            border: 1px solid ${border};
            background: ${sel ? '#7b6cd9' : isStar ? 'rgba(245,197,66,0.14)' : '#282830'};
            color: ${n === 0 && !sel ? '#a0a0ab' : '#fff'};
          ">${escapeHtml(l)} <span class="iw-chip-count" style="opacity: 0.7;">${n}</span></button>${
            isPinned
              ? `<button type="button" class="iw-unpin-list-btn" data-list="${escapeHtml(
                  l
                )}" title="Remove this added list" style="background: none; border: none; cursor: pointer; color: #8a8a96; font-size: 12px; padding: 0 2px;">×</button>`
              : ''
          }
        </span>`;
        })
        .join('')}
      <input type="text" id="iw-add-list-input" placeholder="+ add list (Enter)" title="Add a list by name so it shows even when empty; new arrivals sort to the top" style="
        padding: 2px 8px; border-radius: 9999px; border: 1px dashed rgba(255,255,255,0.25);
        background: transparent; color: #fff; font-size: 10px; outline: none; width: 130px;">
    </div>
    <div id="iw-add-list-panel" style="display: none; align-items: center; gap: 6px; margin: 0 0 6px 38px; flex-wrap: wrap; font-size: 10px;"></div>

    <!-- Filter by Board Chips -->
    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
      <span style="font-size: 11px; color: #a0a0ab; font-weight: 600;">Boards:</span>
      ${allBoards
        .map(
          (b) => `
        <button type="button" class="iw-filter-board-chip" data-board="${escapeHtml(b)}" style="
          padding: 2px 8px;
          border-radius: 9999px;
          font-size: 10px;
          cursor: pointer;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          border: 1px solid ${state.selectedBoards.has(b) ? '#0079bf' : 'rgba(255,255,255,0.15)'};
          background: ${state.selectedBoards.has(b) ? '#0079bf' : '#282830'};
          color: #fff;
        ">${escapeHtml(b)}</button>
      `
        )
        .join('')}
    </div>
  `;

  // Attach event handlers
  const updateUi = () => {
    const res = applyDashboardFilterAndSort(rows, state);
    const countBadge = document.getElementById('iw-card-count-badge');
    if (countBadge) {
      countBadge.textContent = `Showing ${res.visibleCount} of ${res.totalCount} cards`;
    }
  };

  // Sort buttons
  bar.querySelectorAll<HTMLButtonElement>('.iw-sort-btn').forEach((btn) => {
    btn.onclick = () => {
      const col = btn.getAttribute('data-sort') as SortColumn;
      if (state.sortColumn === col) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortColumn = col;
        state.sortDirection = 'asc';
      }
      renderDashboardBar(targetContainer, rows);
      updateUi();
    };
  });

  // List filter chips
  bar.querySelectorAll<HTMLButtonElement>('.iw-filter-list-chip').forEach((chip) => {
    chip.onclick = () => {
      const listName = chip.getAttribute('data-list');
      if (!listName) return;
      if (state.selectedLists.has(listName)) {
        state.selectedLists.delete(listName);
      } else {
        state.selectedLists.add(listName);
      }
      renderDashboardBar(targetContainer, rows);
      updateUi();
    };
  });

  // Board filter chips
  bar.querySelectorAll<HTMLButtonElement>('.iw-filter-board-chip').forEach((chip) => {
    chip.onclick = () => {
      const boardName = chip.getAttribute('data-board');
      if (!boardName) return;
      if (state.selectedBoards.has(boardName)) {
        state.selectedBoards.delete(boardName);
      } else {
        state.selectedBoards.add(boardName);
      }
      renderDashboardBar(targetContainer, rows);
      updateUi();
    };
  });

  // Search input
  const searchInput = bar.querySelector<HTMLInputElement>('#iw-cards-search-input');
  searchInput?.addEventListener('input', () => {
    state.searchQuery = searchInput.value;
    updateUi();
  });

  // Star / unstar a list (rank = order starred)
  bar.querySelectorAll<HTMLButtonElement>('.iw-star-list-btn').forEach((btn) => {
    btn.onclick = () => {
      const name = btn.getAttribute('data-list');
      if (!name) return;
      const stars = state.starredLists ?? (state.starredLists = []);
      const i = stars.indexOf(name);
      if (i === -1) stars.push(name);
      else stars.splice(i, 1);
      writeStored();
      renderDashboardBar(targetContainer, rows);
    };
  });

  // Add an empty list by name, checked against the lists that exist on the cards
  const addInput = bar.querySelector<HTMLInputElement>('#iw-add-list-input');
  const panel = bar.querySelector<HTMLElement>('#iw-add-list-panel');
  const onCards = Array.from(new Set(rows.map((r) => r.list).filter(Boolean)));
  let warnedFor = '';

  const addList = (name: string) => {
    if (addInput) addInput.value = ''; // committed: don't carry the text into the re-render
    const stars = state.starredLists ?? (state.starredLists = []);
    if (!onCards.includes(name) && !prefs.pinnedLists.includes(name)) prefs.pinnedLists.push(name);
    if (!stars.includes(name)) stars.push(name);
    writeStored();
    renderDashboardBar(targetContainer, rows);
  };

  const showPanel = (html: string) => {
    if (!panel) return;
    panel.innerHTML = html;
    panel.style.display = html ? 'flex' : 'none';
    panel.querySelectorAll<HTMLButtonElement>('.iw-add-suggestion').forEach((b) => {
      b.onclick = () => addList(b.getAttribute('data-list') ?? '');
    });
  };
  const sugBtn = (name: string, primary: boolean) =>
    `<button type="button" class="iw-add-suggestion" data-list="${escapeHtml(
      name
    )}" style="padding: 1px 8px; border-radius: 9999px; cursor: pointer; font-size: 10px; border: 1px solid ${
      primary ? '#7b6cd9' : 'rgba(255,255,255,0.2)'
    }; background: ${primary ? '#7b6cd933' : '#282830'}; color: #fff;">${escapeHtml(name)}</button>`;

  const refreshPanel = () => {
    const q = addInput?.value.trim() ?? '';
    warnedFor = '';
    if (!q) return showPanel('');
    const matches = fuzzyMatchLists(q, [...onCards, ...prefs.pinnedLists]).slice(0, 5);
    if (matches.length === 0) {
      return showPanel(
        `<span class="iw-add-warning" style="color: #f0a44a;">⚠ “${escapeHtml(
          q
        )}” isn’t a list on any of your cards. Enter adds it anyway; it stays empty until a card lands there.</span>` +
          `<button type="button" class="iw-add-suggestion iw-add-literal" data-list="${escapeHtml(
            q
          )}" style="padding: 1px 8px; border-radius: 9999px; cursor: pointer; font-size: 10px; border: 1px dashed rgba(255,255,255,0.25); background: transparent; color: #a0a0ab;">+ add “${escapeHtml(
            q
          )}” as a new list</button>`
      );
    }
    const exact = matches[0].toLowerCase() === q.toLowerCase();
    showPanel(
      `<span style="color: #a0a0ab;">${exact ? 'Existing list:' : 'Did you mean:'}</span>${matches
        .map((m, i) => sugBtn(m, i === 0))
        .join('')}` +
        (exact
          ? ''
          : `<button type="button" class="iw-add-suggestion iw-add-literal" data-list="${escapeHtml(
              q
            )}" style="padding: 1px 8px; border-radius: 9999px; cursor: pointer; font-size: 10px; border: 1px dashed rgba(255,255,255,0.25); background: transparent; color: #a0a0ab;">+ add “${escapeHtml(
              q
            )}” as a new list</button>`)
    );
  };
  addInput?.addEventListener('input', refreshPanel);
  if (addInput && prevAddValue) {
    addInput.value = prevAddValue;
    refreshPanel();
  }
  if (refocus) {
    const el = bar.querySelector<HTMLInputElement>(`#${refocus}`);
    el?.focus();
    if (el && prevCaret !== null) el.setSelectionRange?.(prevCaret, prevCaret);
  }
  addInput?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = addInput.value.trim();
    if (!q) return;
    const matches = fuzzyMatchLists(q, [...onCards, ...prefs.pinnedLists]);
    const exact = matches.find((m) => m.toLowerCase() === q.toLowerCase());
    if (exact) return addList(exact);
    if (matches.length) {
      // Fill in the closest existing list; a second Enter (now an exact match) confirms it.
      addInput.value = matches[0];
      return refreshPanel();
    }
    if (warnedFor === q) return addList(q); // warned once: the user means a not-yet-seen list
    refreshPanel();
    warnedFor = q;
  });

  bar.querySelectorAll<HTMLButtonElement>('.iw-unpin-list-btn').forEach((btn) => {
    btn.onclick = () => {
      const name = btn.getAttribute('data-list');
      prefs.pinnedLists = prefs.pinnedLists.filter((l) => l !== name);
      state.starredLists = (state.starredLists ?? []).filter((l) => l !== name);
      state.selectedLists.delete(name ?? '');
      writeStored();
      renderDashboardBar(targetContainer, rows);
    };
  });

  // Save / clear the default view
  bar.querySelector<HTMLButtonElement>('#iw-save-default-btn')?.addEventListener('click', () => {
    prefs.defaultView = snapshotView();
    writeStored();
    renderDashboardBar(targetContainer, rows);
    const btn = document.getElementById('iw-save-default-btn');
    if (btn) btn.textContent = 'Default saved ✓';
  });
  bar.querySelector<HTMLButtonElement>('#iw-clear-default-btn')?.addEventListener('click', () => {
    prefs.defaultView = null;
    writeStored();
    renderDashboardBar(targetContainer, rows);
  });

  // Reset returns to the saved default view (or an unfiltered view if none)
  const resetBtn = bar.querySelector<HTMLButtonElement>('#iw-reset-filters-btn');
  resetBtn?.addEventListener('click', () => {
    applyView(prefs.defaultView);
    renderDashboardBar(targetContainer, rows);
    updateUi();
  });

  updateUi();
  return bar;
}

let scanRaf: number | null = null;
/** Coalesce scan requests into one per frame. */
function scheduleScan(): void {
  if (scanRaf !== null) return;
  scanRaf = requestAnimationFrame(() => {
    scanRaf = null;
    scanAndEnhanceTrelloCards();
  });
}

/**
 * Scan DOM for Trello Cards table and inject the dashboard controls.
 */
export function scanAndEnhanceTrelloCards(): boolean {
  // Only activate on Trello Cards page
  const isCardsPage =
    window.location.hostname.includes('trello.com') &&
    (window.location.pathname.includes('/cards') || document.querySelector('h1')?.textContent?.includes('Cards'));

  if (!isCardsPage || !prefsLoaded) return false;

  // Find table or card list container
  const table = document.querySelector<HTMLElement>('table, [role="table"], div[data-testid*="cards-table"]');
  if (!table) return false;

  const rows = extractCardRows(table);
  if (rows.length === 0) return false;

  // Load the remaining pages so every list/board is represented. Click again only once the
  // previous click has grown the table, and cap the total so a stuck button can't spin.
  const showMore = findShowMore(table);
  if (autoLoadShowMore && showMore && rows.length !== lastShowMoreRowCount && showMoreClicks < MAX_SHOW_MORE_CLICKS) {
    lastShowMoreRowCount = rows.length;
    showMoreClicks++;
    showMore.click();
    scheduleScan();
  }

  // Re-rendering rewrites the bar's innerHTML, which would drop focus/clicks
  // mid-interaction. Skip it when the cards are unchanged and the bar is mounted.
  // Sorted so our own re-ordering of the table doesn't look like new data.
  const signature = rows
    .map((r) => `${r.title}\u0001${r.list}\u0001${r.board}\u0001${r.dueDate}\u0001${r.labels.join(',')}`)
    .sort()
    .join('\u0002');
  const existingBar = document.getElementById(DASHBOARD_BAR_ID);
  if (existingBar?.isConnected && signature === lastRowsSignature) return true;
  lastRowsSignature = signature;

  const parent = table.parentElement || table;
  renderDashboardBar(parent, rows);

  return true;
}

/** True when every mutation in the batch was caused by the dashboard bar itself. */
export function isOwnMutationBatch(records: MutationRecord[]): boolean {
  const insideBar = (node: Node | null): boolean => {
    const el = node instanceof Element ? node : node?.parentElement;
    return !!el && (el.id === DASHBOARD_BAR_ID || !!el.closest(`#${DASHBOARD_BAR_ID}`));
  };
  return records.every((rec) => {
    if (insideBar(rec.target)) return true;
    const changed = [...Array.from(rec.addedNodes), ...Array.from(rec.removedNodes)];
    return changed.length > 0 && changed.every(insideBar);
  });
}

/**
 * Initialize the observer and page listeners.
 */
export function initTrelloCardsDashboard(): void {
  if (typeof window === 'undefined' || isInitialized) return;
  isInitialized = true;

  // Load saved stars / added lists / default view first, then render.
  void loadPrefs().then(() => scheduleScan());

  // Watch for page navigation and card table mutations
  observer = new MutationObserver((records) => {
    if (isOwnMutationBatch(records)) return;
    scheduleScan();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}
