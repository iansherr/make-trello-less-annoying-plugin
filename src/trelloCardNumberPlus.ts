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
import { Configs, configStorage } from './shared/storage';
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
let selectedMovedCard = 0;
let movedCardsNavigator: HTMLElement | undefined;

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
  renderMovedCardsNavigator();
}

function renderMovedCardsNavigator(): void {
  if (movedCards.size === 0) {
    movedCardsNavigator?.remove();
    movedCardsNavigator = undefined;
    return;
  }

  if (!movedCardsNavigator) {
    const navigator = document.createElement('section');
    navigator.className = 'tcnp-moved-cards-navigator';
    navigator.setAttribute('aria-label', 'Moved cards');

    const status = document.createElement('span');
    status.className = 'tcnp-moved-cards-status';
    navigator.append(status);

    const previousButton = document.createElement('button');
    previousButton.type = 'button';
    previousButton.textContent = 'Previous';
    previousButton.addEventListener('click', () => selectMovedCard(-1));
    navigator.append(previousButton);

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.textContent = 'Next';
    nextButton.addEventListener('click', () => selectMovedCard(1));
    navigator.append(nextButton);

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = 'Clear';
    clearButton.addEventListener('click', clearMovedCards);
    navigator.append(clearButton);

    movedCardsNavigator = navigator;
    document.body.append(navigator);
  }

  const entries = Array.from(movedCards.entries());
  selectedMovedCard = Math.min(selectedMovedCard, entries.length - 1);
  const [cardId, moved] = entries[selectedMovedCard];
  const status = movedCardsNavigator.querySelector('.tcnp-moved-cards-status');
  if (status) {
    status.textContent = `${selectedMovedCard + 1} of ${entries.length}: Card ${cardId} moved from ${moved.from} to ${
      moved.to
    }`;
  }
}

function selectMovedCard(direction: number): void {
  const entries = Array.from(movedCards.values());
  if (entries.length === 0) return;

  selectedMovedCard = (selectedMovedCard + direction + entries.length) % entries.length;
  const moved = entries[selectedMovedCard];
  moved.card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  renderMovedCardsNavigator();
}

function clearMovedCards(): void {
  movedCards.forEach(({ card }) => card.classList.remove('tcnp-moved-card'));
  movedCards.clear();
  selectedMovedCard = 0;
  renderMovedCardsNavigator();
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
