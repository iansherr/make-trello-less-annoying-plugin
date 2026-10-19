/**
 * When the extension reloads or updates, content scripts already running in open tabs are orphaned: every
 * chrome.* call then throws "Extension context invalidated". Detect that once, tell the plugin to shut
 * down cleanly, and make later storage calls no-ops instead of throwing from observers and timers.
 */
const invalidatedListeners: Array<() => void> = [];
let contextInvalidated = false;

export function onContextInvalidated(listener: () => void): void {
  if (contextInvalidated) listener();
  else invalidatedListeners.push(listener);
}

export function extensionAlive(): boolean {
  if (contextInvalidated) return false;
  let alive = false;
  try {
    alive = !!chrome.runtime?.id;
  } catch {
    alive = false;
  }
  if (!alive) markInvalidated();
  return alive;
}

const INVALIDATED = /context invalidated/i;

function markInvalidated(): void {
  if (contextInvalidated) return;
  contextInvalidated = true;
  console.info(
    '[tcnp] The extension was reloaded or updated: this tab still runs the old plugin, which has stopped. Reload the page.'
  );
  invalidatedListeners.splice(0).forEach((listener) => {
    try {
      listener();
    } catch {
      // shutting down: nothing useful to do with a failing cleanup step
    }
  });
}

// Safety net: if an invalidation error escapes from any other call, shut down instead of erroring forever.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (INVALIDATED.test(event.message || (event.error as Error | undefined)?.message || '')) {
      event.preventDefault();
      markInvalidated();
    }
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (INVALIDATED.test(String((event.reason as Error | undefined)?.message ?? event.reason))) {
      event.preventDefault();
      markInvalidated();
    }
  });
}

function guarded(call: () => void): void {
  if (!extensionAlive()) return;
  try {
    call();
  } catch (error) {
    if (INVALIDATED.test(String((error as Error)?.message))) markInvalidated();
    else throw error;
  }
}

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
  /** Experimental: ask Chrome not to render the board behind an open card dialog. */
  lightenBoardBehindCard = false;
}

export const configStorage = {
  get: (callback: (configs: Configs) => void) => {
    guarded(() =>
      chrome.storage.sync.get({ configs: new Configs() }, (storage) => {
        callback(storage.configs);
      })
    );
  },
  set: (configs: Configs, callback?: () => void) => {
    guarded(() =>
      chrome.storage.sync.set({ configs }, () => {
        callback?.();
      })
    );
  },
  listen: (callback: (configs: Configs) => void) => {
    guarded(() =>
      chrome.storage.onChanged.addListener((changes) => {
        if (changes.configs) {
          callback(changes.configs.newValue);
        }
      })
    );
  },
};

const moveLogKey = (boardId: string) => `tcnp_move_log_${boardId}`;

/** Per-board history of tracked card moves. Kept in local storage: it is data, not a setting. */
export const moveLogStorage = {
  get: (boardId: string, callback: (raw: unknown) => void) => {
    guarded(() => chrome.storage.local.get([moveLogKey(boardId)], (items) => callback(items?.[moveLogKey(boardId)])));
  },
  set: (boardId: string, log: unknown) => {
    guarded(() => chrome.storage.local.set({ [moveLogKey(boardId)]: log }));
  },
  remove: (boardId: string) => {
    guarded(() => chrome.storage.local.remove(moveLogKey(boardId)));
  },
};

const MOVE_RULES_KEY = 'tcnp_move_rules';

/** Card-move watch rules (see moveRules.ts). Shared with the host extension's hub through the same key. */
export const moveRulesStorage = {
  get: (callback: (raw: unknown) => void) => {
    guarded(() => chrome.storage.local.get([MOVE_RULES_KEY], (items) => callback(items?.[MOVE_RULES_KEY])));
  },
  set: (state: unknown) => {
    guarded(() => chrome.storage.local.set({ [MOVE_RULES_KEY]: state }));
  },
  listen: (callback: (raw: unknown) => void) => {
    guarded(() =>
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[MOVE_RULES_KEY]) callback(changes[MOVE_RULES_KEY].newValue);
      })
    );
  },
};
