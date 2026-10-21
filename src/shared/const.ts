//#region Trello Card Numbers Plus Constants
export const TCNP_NUMBER_CLASS = 'tcnp-short-card-number';
export const TCNP_NUMBER_CLASS_BOLD = 'tcnp-bold';
export const TCNP_NUMBER_CLASS_AFTER = 'tcnp-short-card-number-after';
export const TCNP_OVERLAY_CLASS = 'tcnp-overlay-badge';
export const TCNP_NUMBER_CLASS_SELECTOR = '.' + TCNP_NUMBER_CLASS;
export const TCNP_NUMBER_FORMAT_PLACEHOLDER = '%0';
export const TCNP_ID_PLACEHOLDER = '%id';
export const TCNP_POSITION_PLACEHOLDER = '%pos';
export const TCNP_TOTAL_PLACEHOLDERS = ['%total', '%count'];
export const TCNP_LIST_COUNTER_CLASS = 'tcnp-list-counter';
//#endregion

//#region Trello Constants
export const CARD_TITLE_SELECTOR = '#js-dialog-title';
export const CARD_SHORT_ID_SELECTOR = '[data-testid=card-name]';
export const LIST_HEADER_SELECTOR = '[data-testid="list-header"], .list-header, .js-list-header';
export const HEADER_DOTS_BUTTON_SELECTOR =
  '[data-testid="list-edit-menu-button"], button[data-testid="overflow-menu-button"], [aria-label*="List actions" i], button[aria-label*="Actions" i], .list-header-extras, div[role="presentation"]';
// Card containers across modern Trello ([data-testid]) and the classic markup (.list-card, li).
export const CARD_CONTAINER_SELECTOR = '[data-testid="trello-card"], [data-testid="list-card"], .list-card, li';
// Cards to count in a list (no classic .list-card entry: its <li> wrapper is already matched).
export const LIST_CARD_SELECTOR = '[data-testid="trello-card"], [data-testid="list-card"], li';
// Fallbacks used when the primary selector (CARD_TITLE_SELECTOR / CARD_SHORT_ID_SELECTOR) finds nothing.
export const CARD_TITLE_FALLBACK_SELECTOR =
  '[data-testid="card-back-title"], textarea[data-testid="card-back-title-input"], .window-title h2';
export const CARD_SHORT_ID_ANY_SELECTOR =
  '[data-testid="card-name"], a[data-testid="trello-card"], .list-card-title, a.list-card';
//#endregion
