export class Configs {
  cardCountersActive = true;
  cardNumbersActive = true;
  cardNumbersBold = true;
  badgePosition: 'before' | 'after' = 'before';
  badgeStyle: 'inline' | 'overlay' = 'inline';
  overlayCorner: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' = 'top-right';
  overlayAutoContrast = true;
  numberFormat = '#%0';
  numberColor = '#000';
  excludedBoards = '';
  /** Seconds the card-move alert stays up before fading to the iw icon. */
  moveAlertSeconds = 10;
}

export const configStorage = {
  get: (callback: (configs: Configs) => void) => {
    chrome.storage.sync.get({ configs: new Configs() }, (storage) => {
      callback(storage.configs);
    });
  },
  set: (configs: Configs, callback?: () => void) => {
    chrome.storage.sync.set({ configs }, () => {
      callback?.();
    });
  },
  listen: (callback: (configs: Configs) => void) => {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.configs) {
        callback(changes.configs.newValue);
      }
    });
  },
};

const moveLogKey = (boardId: string) => `tcnp_move_log_${boardId}`;

/** Per-board history of tracked card moves. Kept in local storage: it is data, not a setting. */
export const moveLogStorage = {
  get: (boardId: string, callback: (raw: unknown) => void) => {
    chrome.storage.local.get([moveLogKey(boardId)], (items) => callback(items?.[moveLogKey(boardId)]));
  },
  set: (boardId: string, log: unknown) => {
    chrome.storage.local.set({ [moveLogKey(boardId)]: log });
  },
  remove: (boardId: string) => {
    chrome.storage.local.remove(moveLogKey(boardId));
  },
};

const MOVE_RULES_KEY = 'tcnp_move_rules';

/** Card-move watch rules (see moveRules.ts). Shared with the host extension's hub through the same key. */
export const moveRulesStorage = {
  get: (callback: (raw: unknown) => void) => {
    chrome.storage.local.get([MOVE_RULES_KEY], (items) => callback(items?.[MOVE_RULES_KEY]));
  },
  set: (state: unknown) => {
    chrome.storage.local.set({ [MOVE_RULES_KEY]: state });
  },
  listen: (callback: (raw: unknown) => void) => {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[MOVE_RULES_KEY]) callback(changes[MOVE_RULES_KEY].newValue);
    });
  },
};
