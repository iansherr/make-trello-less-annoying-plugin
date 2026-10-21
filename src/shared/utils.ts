import {
  CARD_SHORT_ID_SELECTOR,
  TCNP_ID_PLACEHOLDER,
  TCNP_NUMBER_FORMAT_PLACEHOLDER,
  TCNP_POSITION_PLACEHOLDER,
  TCNP_TOTAL_PLACEHOLDERS,
} from './const';

export function isDialogClosed(element: Element, mutation: MutationRecord): boolean {
  return mutation.removedNodes.length > 0 && element.classList.contains('js-fill-card-detail-desc');
}

export function isDialogOpened(element: Element): boolean {
  return element.classList.contains('card-detail-window');
}

export function isCardLinkUpdated(mutation: MutationRecord): boolean {
  if (mutation.type !== 'attributes') return false;
  if (mutation.attributeName !== 'href') return false;
  if (!(mutation.target instanceof HTMLAnchorElement)) return false;

  return !!mutation.target.querySelector('[data-testid=card-name]');
}

export function isRemovedCard(mutation: MutationRecord): boolean {
  return mutation.target.nodeName === 'OL' && mutation.removedNodes[0]?.nodeName === 'LI';
}

export function isCardListItemAdded(mutation: MutationRecord): boolean {
  if (mutation.type !== 'childList') return false;
  if (mutation.target.nodeName === 'OL') {
    return Array.from(mutation.addedNodes).some((node) => node.nodeName === 'LI');
  }

  // Trello also renders cards progressively (long lists, scrolling, whole-list
  // inserts), where the direct mutation target is not the OL. Catch any added
  // node that is or contains a card. Our own badge divs never match: they are
  // DIVs containing no card-name element, so this cannot retrigger itself.
  return Array.from(mutation.addedNodes).some(
    (node) => node instanceof Element && (node.nodeName === 'LI' || node.querySelector(CARD_SHORT_ID_SELECTOR) !== null)
  );
}

export function formatCardBadge(cardId: number, position: number, total: number, numberFormat: string): string {
  const idText = isNaN(cardId) ? '' : cardId.toString();
  const positionText = isNaN(position) ? '' : position.toString();
  const totalText = isNaN(total) ? '' : total.toString();

  let formatted = numberFormat.split(TCNP_NUMBER_FORMAT_PLACEHOLDER).join(idText);
  formatted = formatted.split(TCNP_ID_PLACEHOLDER).join(idText);
  formatted = formatted.split(TCNP_POSITION_PLACEHOLDER).join(positionText);
  for (const placeholder of TCNP_TOTAL_PLACEHOLDERS) {
    formatted = formatted.split(placeholder).join(totalText);
  }

  // Preserve legacy behavior: an ID-only format with an unknown ID renders nothing.
  if (idText === '' && positionText === '' && totalText === '') return '';

  return formatted;
}

export function pickOverlayTextColor(background: string, autoContrast: boolean): string {
  if (!autoContrast) return '#fff';

  return isLightColor(background) ? '#000' : '#fff';
}

export function findMovedCardIds(previous: Map<string, string>, current: Map<string, string>): string[] {
  return Array.from(current.keys()).filter((cardId) => {
    const previousLocation = previous.get(cardId);
    return previousLocation !== undefined && previousLocation !== current.get(cardId);
  });
}

function isLightColor(color: string): boolean {
  const hex = color.trim().replace(/^#/, '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return false;

  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);

  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

export function getCardNumberFromURL(url: string): number {
  const cardTitle = url.split('/').pop();
  return parseInt(cardTitle?.substring(0, cardTitle.indexOf('-')) ?? '');
}

export function getCardNumberFromParent(element: Element): number {
  const url = element.closest('a')?.href ?? '';
  return getCardNumberFromURL(url);
}

export function isBoardExcluded(excludedBoards: string, boardId: string) {
  const excludedBoardsedBoards = excludedBoards.split(';').map((ids) => ids.trim());
  return excludedBoardsedBoards.includes(boardId);
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout;

  return function (this: unknown, ...args: Parameters<T>): void {
    clearTimeout(timeoutId);

    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}
