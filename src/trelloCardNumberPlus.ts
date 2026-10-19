import {
  CARD_SHORT_ID_SELECTOR,
  CARD_TITLE_SELECTOR,
  LIST_HEADER_SELECTOR,
  HEADER_DOTS_BUTTON_SELECTOR,
  TCNP_LIST_COUNTER_CLASS,
  TCNP_NUMBER_CLASS,
  TCNP_NUMBER_CLASS_AFTER,
  TCNP_NUMBER_CLASS_BOLD,
  TCNP_NUMBER_CLASS_SELECTOR,
  TCNP_OVERLAY_CLASS,
} from './shared/const';
import { Configs, configStorage, moveLogStorage } from './shared/storage';
import { ALERT_VISIBLE_MS, MoveLogEntry, appendMoves, formatAge, mergeLogs, sanitizeLog } from './shared/moveLog';
import {
  formatCardBadge,
  getCardNumberFromParent,
  getCardNumberFromURL,
  isBoardExcluded,
  pickOverlayTextColor,
  findMovedCardIds,
  isCardListItemAdded,
  isCardLinkUpdated,
  isDialogClosed,
  isDialogOpened,
  isRemovedCard,
} from './shared/utils';
import './trelloCardNumberPlus.css';

let configs: Configs = new Configs();
let isCurrentBoardExcluded = false;
let settleIntervalId: number | undefined;
let settleStopTimeoutId: number | undefined;
const previousCardLocations = new Map<string, string>();
const previousListLabels = new Map<string, string>();
const listIdentityByElement = new WeakMap<Element, string>();
let nextListIdentity = 0;
let hasCardLocationBaseline = false;
const movedCards = new Map<string, { card: Element; from: string; to: string }>();
let moveLog: MoveLogEntry[] = [];
let moveLogBoardId = '';
let alertTimerId: number | undefined;
let activityRoot: HTMLElement | undefined;
let activityPanelOpen = false;

function rescanBoard(): void {
  setupCounters();
  setupNumbers();
}

function startSettleRescan(): void {
  rescanBoard();

  if (!settleIntervalId) {
    settleIntervalId = window.setInterval(rescanBoard, 100);
  }

  if (settleStopTimeoutId) {
    window.clearTimeout(settleStopTimeoutId);
  }

  settleStopTimeoutId = window.setTimeout(() => {
    if (settleIntervalId) {
      window.clearInterval(settleIntervalId);
      settleIntervalId = undefined;
    }
    settleStopTimeoutId = undefined;
  }, 2000);
}

installHostBridge();
configStorage.get(refresh);
configStorage.listen(refresh);
setupObserver();

function getCurrentBoardId() {
  return window.location.pathname.split('/')[2];
}

function refresh(updatedConfigs?: Configs): void {
  if (updatedConfigs) {
    configs = updatedConfigs;
  }
  isCurrentBoardExcluded = isBoardExcluded(configs.excludedBoards, getCurrentBoardId());

  setupCounters();
  setupNumbers();
  setupDialogNumber();
}

function setupObserver(): void {
  const observer = new MutationObserver((mutations: MutationRecord[]) => {
    mutations.forEach((mutation) => {
      const target = mutation.target;
      if (!(target instanceof Element)) return;

      const cardLinkUpdated = isCardLinkUpdated(mutation);
      const listItemAdded = isCardListItemAdded(mutation);

      if (isDialogClosed(target, mutation) || cardLinkUpdated || listItemAdded) {
        startSettleRescan();
      }

      if (isDialogOpened(target)) {
        setupDialogNumber();
      }

      if (isRemovedCard(mutation)) {
        // Recount AND renumber: removing a card shifts the position of every
        // card after it, so numbers must refresh alongside the counters.
        rescanBoard();
      }
    });
  });

  observer.observe(document.body, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeOldValue: true,
  });
}

function setupDialogNumber(): void {
  const title = document.querySelector(CARD_TITLE_SELECTOR);
  if (title && title.parentElement?.querySelector(TCNP_NUMBER_CLASS_SELECTOR) === null) {
    const cardId = getCardNumberFromURL(window.location.pathname);
    const { position, total } = findCardPosition(cardId);
    const text = formatCardBadge(cardId, position, total, configs.numberFormat);
    if (text === '') return;

    title.parentElement.style.display = 'flex';

    const numberSpan = document.createElement('h2');
    numberSpan.innerHTML = text;
    numberSpan.style.color = configs.numberColor;
    numberSpan.classList.add(TCNP_NUMBER_CLASS, 'quiet');

    if (configs.badgePosition === 'after') {
      title.parentElement?.append(numberSpan);
    } else {
      title.parentElement?.prepend(numberSpan);
    }
  }
}

function findCardPosition(cardId: number): { position: number; total: number } {
  if (isNaN(cardId)) return { position: NaN, total: NaN };

  const listHeaders = document.querySelectorAll(LIST_HEADER_SELECTOR);
  for (const listHeader of Array.from(listHeaders)) {
    const listContainer = listHeader.parentElement;
    if (!listContainer) continue;

    const cards = Array.from(listContainer.querySelectorAll(CARD_SHORT_ID_SELECTOR));
    const index = cards.findIndex((card) => getCardNumberFromParent(card) === cardId);
    if (index !== -1) return { position: index + 1, total: cards.length };
  }

  return { position: NaN, total: NaN };
}

function setupNumbers(): void {
  const updated = new Set<Element>();
  const currentCardLocations = new Map<string, { key: string; label: string; card: Element }>();
  const newMoves: MoveLogEntry[] = [];
  ensureMoveLog();

  document.querySelectorAll(LIST_HEADER_SELECTOR).forEach((listHeader) => {
    const listContainer = listHeader.parentElement;
    if (!listContainer) return;

    const headerCopy = listHeader.cloneNode(true) as HTMLElement;
    headerCopy.querySelector('.' + TCNP_LIST_COUNTER_CLASS)?.remove();
    const label = (headerCopy.innerText || headerCopy.textContent || '').trim();
    let key = listContainer.getAttribute('data-id') || listContainer.id || listHeader.getAttribute('data-id') || '';
    if (!key) {
      key = listIdentityByElement.get(listContainer) ?? `list-${++nextListIdentity}`;
      listIdentityByElement.set(listContainer, key);
    }

    const cards = listContainer.querySelectorAll(CARD_SHORT_ID_SELECTOR);
    const total = cards.length;
    cards.forEach((cardParent, index) => {
      updateCardBadge(cardParent, index + 1, total);
      updated.add(cardParent);
      const cardId = getCardNumberFromParent(cardParent);
      const card = cardParent.closest('li');
      if (!isNaN(cardId) && card) {
        currentCardLocations.set(cardId.toString(), { key, label, card });
      }
    });
  });

  // Fallback for cards that are not inside any list container: ID-only badge.
  document.querySelectorAll(CARD_SHORT_ID_SELECTOR).forEach((cardParent) => {
    if (updated.has(cardParent)) return;
    updateCardBadge(cardParent, NaN, NaN);
  });

  if (hasCardLocationBaseline) {
    const currentKeys = new Map(Array.from(currentCardLocations, ([id, location]) => [id, location.key]));
    findMovedCardIds(previousCardLocations, currentKeys).forEach((cardId) => {
      const previousKey = previousCardLocations.get(cardId);
      const current = currentCardLocations.get(cardId);
      if (!current || previousKey === undefined) return;
      const previousLabel = previousListLabels.get(previousKey) ?? previousKey;
      movedCards.set(cardId, { card: current.card, from: previousLabel, to: current.label });
      current.card.classList.add('tcnp-moved-card');
      newMoves.push({
        cardId,
        title: readCardTitle(current.card),
        from: previousLabel,
        to: current.label,
        at: Date.now(),
      });
    });
  }

  currentCardLocations.forEach((location, cardId) => {
    previousListLabels.set(location.key, location.label);
    previousCardLocations.set(cardId, location.key);
    const moved = movedCards.get(cardId);
    if (moved) {
      moved.card = location.card;
      location.card.classList.add('tcnp-moved-card');
    }
  });
  hasCardLocationBaseline = true;
  if (newMoves.length > 0) recordMoves(newMoves);
}

/**
 * Bridge to a host dock (ikmal webtools): content scripts of one extension share a window, so the dock
 * reads state from window.__tcnpMoves and hears events. While the dock is present and visible it owns the
 * move UI and this plugin draws nothing of its own.
 */
interface HostWindow {
  __ikmalDockPresent?: boolean;
  __tcnpMoves?: unknown;
}

function dockOwnsMoves(): boolean {
  return (window as unknown as HostWindow).__ikmalDockPresent === true;
}

function installHostBridge(): void {
  (window as unknown as HostWindow).__tcnpMoves = {
    getState: () => ({ entries: moveLog, alertMs: alertVisibleMs() }),
    jump: jumpToCard,
    clearHighlights: clearMovedCards,
    clearHistory: clearMoveHistory,
  };
  // The dock appearing or being hidden changes who draws the move UI.
  window.addEventListener('ikmal:dock-visibility', () => renderMoveActivity());
}

function readCardTitle(card: Element): string {
  const titleEl = card.querySelector(CARD_SHORT_ID_SELECTOR);
  if (!titleEl) return '';
  const copy = titleEl.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.' + TCNP_NUMBER_CLASS + ', .' + TCNP_OVERLAY_CLASS).forEach((el) => el.remove());
  return (copy.textContent || '').replace(/\s+/g, ' ').trim();
}

function isBoardPage(): boolean {
  return window.location.pathname.startsWith('/b/') && !!getCurrentBoardId();
}

/** Load this board's stored move history once per board (and after SPA navigation to another board). */
function ensureMoveLog(): void {
  if (!isBoardPage()) return;
  const boardId = getCurrentBoardId();
  if (boardId === moveLogBoardId) return;
  moveLogBoardId = boardId;
  moveLog = [];
  moveLogStorage.get(boardId, (raw) => {
    if (boardId !== moveLogBoardId) return;
    moveLog = mergeLogs(sanitizeLog(raw), moveLog);
    renderMoveActivity();
  });
}

function recordMoves(moves: MoveLogEntry[]): void {
  moveLog = appendMoves(moveLog, moves);
  if (moveLogBoardId) moveLogStorage.set(moveLogBoardId, moveLog);
  const latest = moves[0];
  const text =
    moves.length === 1
      ? `Card ${latest.cardId} moved from ${latest.from} to ${latest.to}`
      : `${moves.length} cards moved`;
  renderMoveActivity();
  showMoveAlert(text);
}

function ensureActivityRoot(): HTMLElement {
  if (activityRoot) return activityRoot;

  const root = document.createElement('section');
  root.className = 'tcnp-moved-cards-navigator is-collapsed';
  root.setAttribute('aria-label', 'Moved cards');

  const alert = document.createElement('div');
  alert.className = 'tcnp-alert';
  alert.setAttribute('role', 'status');
  const status = document.createElement('span');
  status.className = 'tcnp-moved-cards-status';
  const viewAll = document.createElement('button');
  viewAll.type = 'button';
  viewAll.className = 'tcnp-view-all';
  viewAll.textContent = 'View all';
  viewAll.addEventListener('click', () => toggleActivityPanel(true));
  alert.append(status, viewAll);
  // Hovering keeps the alert readable; it fades shortly after the pointer leaves.
  alert.addEventListener('mouseenter', () => window.clearTimeout(alertTimerId));
  alert.addEventListener('mouseleave', () => scheduleAlertCollapse(3000));

  const icon = document.createElement('button');
  icon.type = 'button';
  icon.className = 'tcnp-activity-icon';
  icon.setAttribute('aria-label', 'Card moves: view all');
  icon.title = 'View all card moves';
  icon.innerHTML = 'iw<span class="tcnp-activity-count"></span>';
  icon.addEventListener('click', () => toggleActivityPanel());

  const panel = document.createElement('div');
  panel.className = 'tcnp-activity-panel';
  panel.hidden = true;

  root.append(alert, panel, icon);
  document.body.append(root);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activityPanelOpen) toggleActivityPanel(false);
  });
  document.addEventListener('mousedown', (event) => {
    if (activityPanelOpen && !root.contains(event.target as Node)) toggleActivityPanel(false);
  });

  activityRoot = root;
  return root;
}

function renderMoveActivity(): void {
  window.dispatchEvent(new CustomEvent('tcnp:moves-changed'));
  if (dockOwnsMoves()) {
    activityRoot?.remove();
    activityRoot = undefined;
    activityPanelOpen = false;
    return;
  }
  if (moveLog.length === 0 && movedCards.size === 0) {
    activityRoot?.remove();
    activityRoot = undefined;
    activityPanelOpen = false;
    return;
  }
  const root = ensureActivityRoot();
  if (!root.isConnected) document.body.append(root);
  const count = root.querySelector('.tcnp-activity-count');
  if (count) count.textContent = moveLog.length > 99 ? '99+' : String(moveLog.length);
  if (activityPanelOpen) renderActivityPanel();
}

function showMoveAlert(text: string): void {
  if (dockOwnsMoves()) {
    window.dispatchEvent(new CustomEvent('tcnp:move-alert', { detail: { text, ms: alertVisibleMs() } }));
    return;
  }
  const root = ensureActivityRoot();
  const status = root.querySelector('.tcnp-moved-cards-status');
  if (status) status.textContent = text;
  if (activityPanelOpen) return; // the open list already shows it
  root.classList.remove('is-collapsed');
  scheduleAlertCollapse(alertVisibleMs());
}

function alertVisibleMs(): number {
  const seconds = Number(configs.moveAlertSeconds);
  return Number.isFinite(seconds) && seconds >= 3 ? Math.min(seconds, 60) * 1000 : ALERT_VISIBLE_MS;
}

function scheduleAlertCollapse(ms: number): void {
  window.clearTimeout(alertTimerId);
  alertTimerId = window.setTimeout(() => activityRoot?.classList.add('is-collapsed'), ms);
}

function toggleActivityPanel(open = !activityPanelOpen): void {
  const root = ensureActivityRoot();
  activityPanelOpen = open;
  const panel = root.querySelector<HTMLElement>('.tcnp-activity-panel');
  if (panel) panel.hidden = !open;
  if (open) {
    window.clearTimeout(alertTimerId);
    root.classList.add('is-collapsed');
    renderActivityPanel();
  }
}

function renderActivityPanel(): void {
  const panel = activityRoot?.querySelector<HTMLElement>('.tcnp-activity-panel');
  if (!panel) return;
  panel.replaceChildren();

  const header = document.createElement('div');
  header.className = 'tcnp-activity-header';
  const heading = document.createElement('strong');
  heading.textContent = `Card moves (${moveLog.length})`;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => toggleActivityPanel(false));
  header.append(heading, close);

  const list = document.createElement('ol');
  list.className = 'tcnp-activity-list';
  if (moveLog.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'tcnp-activity-empty';
    empty.textContent = 'No moves recorded yet.';
    list.append(empty);
  }
  const now = Date.now();
  moveLog.forEach((entry) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tcnp-activity-entry';
    button.title = 'Scroll to this card';
    const title = document.createElement('span');
    title.className = 'tcnp-activity-title';
    title.textContent = `#${entry.cardId} ${entry.title}`.trim();
    const route = document.createElement('span');
    route.className = 'tcnp-activity-route';
    route.textContent = `${entry.from} → ${entry.to}`;
    const age = document.createElement('span');
    age.className = 'tcnp-activity-age';
    age.textContent = formatAge(entry.at, now);
    button.append(title, route, age);
    button.addEventListener('click', () => jumpToCard(entry.cardId));
    item.append(button);
    list.append(item);
  });

  const footer = document.createElement('div');
  footer.className = 'tcnp-activity-footer';
  const clearHighlights = document.createElement('button');
  clearHighlights.type = 'button';
  clearHighlights.textContent = 'Clear highlights';
  clearHighlights.addEventListener('click', clearMovedCards);
  const clearHistory = document.createElement('button');
  clearHistory.type = 'button';
  clearHistory.textContent = 'Clear history';
  clearHistory.addEventListener('click', clearMoveHistory);
  footer.append(clearHighlights, clearHistory);

  panel.append(header, list, footer);
}

function jumpToCard(cardId: string): void {
  const tracked = movedCards.get(cardId)?.card;
  const link = Array.from(document.querySelectorAll('a[href*="/c/"]')).find(
    (a) => getCardNumberFromParent(a).toString() === cardId
  );
  const card = tracked ?? link?.closest('[data-testid="trello-card"], [data-testid="list-card"], li');
  if (!card) return; // card is archived, moved to another board, or not rendered
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!card.classList.contains('tcnp-moved-card')) {
    card.classList.add('tcnp-moved-card');
    window.setTimeout(() => card.classList.remove('tcnp-moved-card'), 2500);
  }
}

function clearMovedCards(): void {
  movedCards.forEach(({ card }) => card.classList.remove('tcnp-moved-card'));
  movedCards.clear();
  renderMoveActivity();
}

function clearMoveHistory(): void {
  clearMovedCards();
  moveLog = [];
  if (moveLogBoardId) moveLogStorage.remove(moveLogBoardId);
  renderMoveActivity();
}

function updateCardBadge(cardParent: Element, position: number, total: number): void {
  if (!cardParent) return;

  const cardNumber = getCardNumberFromParent(cardParent);
  const text = formatCardBadge(cardNumber, position, total, configs.numberFormat);

  if (configs.badgeStyle === 'overlay') {
    cardParent.querySelector('.' + TCNP_NUMBER_CLASS)?.remove();
    updateOverlayBadge(cardParent, text);
    return;
  }

  removeOverlayBadge(cardParent);

  const wantAfter = configs.badgePosition === 'after';

  let htmlElement = cardParent.querySelector('.' + TCNP_NUMBER_CLASS) as HTMLElement | null;

  if (htmlElement && htmlElement.classList.contains(TCNP_NUMBER_CLASS_AFTER) !== wantAfter) {
    // Placement setting changed since this badge was created: drop it so it
    // gets re-inserted on the configured side below.
    htmlElement.remove();
    htmlElement = null;
  }

  if (text === '') {
    htmlElement?.remove();
    return;
  }

  if (!htmlElement) {
    htmlElement = document.createElement('div');
    htmlElement.classList.add(TCNP_NUMBER_CLASS);
    htmlElement.classList.toggle(TCNP_NUMBER_CLASS_AFTER, wantAfter);
    if (wantAfter) {
      cardParent.append(htmlElement);
    } else {
      cardParent.prepend(htmlElement);
    }
  }

  htmlElement.innerHTML = text;
  htmlElement.style.color = configs.numberColor;
  htmlElement.classList.add(TCNP_NUMBER_CLASS);
  htmlElement.classList.toggle('tcnp-hidden', !configs.cardNumbersActive || isCurrentBoardExcluded);
  htmlElement.classList.toggle(TCNP_NUMBER_CLASS_BOLD, configs.cardNumbersBold);
}

function removeOverlayBadge(cardParent: Element): void {
  cardParent
    .closest('li')
    ?.querySelector('.' + TCNP_OVERLAY_CLASS)
    ?.remove();
}

function updateOverlayBadge(cardParent: Element, text: string): void {
  // Anchor the pill to the whole Trello card, not the title link: anchoring to
  // the link makes the corner badge appear inline beside the title.
  const card = cardParent.closest('li');
  if (!card) return;

  if (window.getComputedStyle(card).position === 'static') {
    card.style.position = 'relative';
  }

  const corner = configs.overlayCorner ?? 'top-right';

  let pill = card.querySelector('.' + TCNP_OVERLAY_CLASS) as HTMLElement | null;
  if (pill && pill.dataset.tcnpCorner !== corner) {
    pill.remove();
    pill = null;
  }

  if (text === '') {
    pill?.remove();
    return;
  }

  if (!pill) {
    pill = document.createElement('div');
    pill.classList.add(TCNP_OVERLAY_CLASS);
    pill.dataset.tcnpCorner = corner;
  }

  // Relocate an existing pill from the title link if an older content script
  // version was active before this correction.
  if (pill.parentElement !== card) card.append(pill);

  pill.innerHTML = text;
  pill.style.backgroundColor = configs.numberColor;
  pill.style.color = pickOverlayTextColor(configs.numberColor, configs.overlayAutoContrast);
  pill.classList.toggle('tcnp-hidden', !configs.cardNumbersActive || isCurrentBoardExcluded);
  pill.classList.toggle(TCNP_NUMBER_CLASS_BOLD, configs.cardNumbersBold);
}

function setupCounters(): void {
  document.querySelectorAll(LIST_HEADER_SELECTOR).forEach((listHeader) => {
    if (!listHeader) return;

    const existingElement = listHeader.querySelector('.' + TCNP_LIST_COUNTER_CLASS) as HTMLElement;
    const cardsCounter = listHeader.parentElement?.querySelectorAll('li')?.length ?? NaN;

    const htmlElement = existingElement ?? document.createElement('span');
    htmlElement.innerHTML = isNaN(cardsCounter) ? '' : `${cardsCounter} cards`;
    htmlElement.classList.add(TCNP_LIST_COUNTER_CLASS);
    htmlElement.classList.toggle('tcnp-hidden', !configs.cardCountersActive || isCurrentBoardExcluded);

    if (existingElement) return;

    const dotsButton = listHeader.querySelector(HEADER_DOTS_BUTTON_SELECTOR);
    if (dotsButton) {
      // If the "..." button is present, insert the counter right before it
      dotsButton.before(htmlElement);
    } else {
      // Otherwise, just append it to the end of the header
      listHeader.append(htmlElement);
    }
  });
}
