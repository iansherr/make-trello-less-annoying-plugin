/**
 * Page adjustments for Trello that the ikmal webtools hub used to apply from its own content script: hide this
 * plugin's moved-card outline when the user turned that setting off, normalise badge layout on modern Trello, and
 * record which Trello account is in use so the hub can show its Trello tab only to people who use Trello.
 * They moved here so the host carries no Trello-specific code. Behaviour and storage keys are unchanged.
 */

export function initTrelloHighlightMovedSuppression(): void {
  const SUPPRESS_STYLE_ID = 'ikmal-trello-suppress-moved';

  function applySuppression(highlightMoved: boolean): void {
    let styleEl = document.getElementById(SUPPRESS_STYLE_ID);
    if (!highlightMoved) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = SUPPRESS_STYLE_ID;
        styleEl.textContent = `
          .tcnp-moved-card {
            outline: none !important;
            animation: none !important;
            box-shadow: none !important;
          }
          .tcnp-moved-cards-navigator {
            display: none !important;
          }
        `;
        (document.head || document.documentElement).appendChild(styleEl);
      }
    } else {
      if (styleEl) {
        styleEl.remove();
      }
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    chrome.storage.sync.get(['configs'], (res) => {
      const highlight = res?.configs?.highlightMovedCards !== false;
      applySuppression(highlight);
    });

    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === 'sync' && changes.configs) {
        const highlight = changes.configs.newValue?.highlightMovedCards !== false;
        applySuppression(highlight);
      }
    });
  }
}

export function initTrelloBadgeNormalizer(): void {
  const STYLE_ID = 'ikmal-trello-badge-fixes';
  if (!document.getElementById(STYLE_ID)) {
    const styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = `
      /* Modern Trello Positioning & Layout Overrides */
      [data-testid="trello-card"],
      [data-testid="list-card"],
      .list-card {
        position: relative !important;
      }

      /* Inline card numbers */
      .tcnp-short-card-number {
        display: inline-block !important;
        vertical-align: baseline !important;
        margin-right: 0.35em !important;
        line-height: inherit !important;
      }

      .tcnp-short-card-number.tcnp-short-card-number-after {
        margin-right: 0 !important;
        margin-left: 0.35em !important;
      }

      .tcnp-short-card-number.tcnp-bold {
        font-weight: 700 !important;
      }

      /* Overlay badges: exact anchor coordinates relative to card box */
      .tcnp-overlay-badge {
        position: absolute !important;
        z-index: 25 !important;
        pointer-events: none !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        min-width: 20px !important;
        height: 20px !important;
        line-height: 20px !important;
        padding: 0 6px !important;
        border-radius: 999px !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        text-align: center !important;
        box-sizing: border-box !important;
        white-space: nowrap !important;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28) !important;
      }

      .tcnp-overlay-badge[data-tcnp-corner='top-right'] {
        top: 6px !important;
        right: 6px !important;
        left: auto !important;
        bottom: auto !important;
      }

      .tcnp-overlay-badge[data-tcnp-corner='top-left'] {
        top: 6px !important;
        left: 6px !important;
        right: auto !important;
        bottom: auto !important;
      }

      .tcnp-overlay-badge[data-tcnp-corner='bottom-right'] {
        bottom: 6px !important;
        right: 6px !important;
        top: auto !important;
        left: auto !important;
      }

      .tcnp-overlay-badge[data-tcnp-corner='bottom-left'] {
        bottom: 6px !important;
        left: 6px !important;
        top: auto !important;
        right: auto !important;
      }

      .tcnp-hidden {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  // Observe and normalize badge anchoring to the direct card surface
  function normalizeBadges() {
    document.querySelectorAll<HTMLElement>('.tcnp-overlay-badge').forEach((pill) => {
      const parent = pill.parentElement;
      if (parent && parent.tagName === 'LI') {
        const cardBox = parent.querySelector<HTMLElement>('[data-testid="trello-card"], [data-testid="list-card"]');
        if (cardBox && pill.parentElement !== cardBox) {
          cardBox.appendChild(pill);
        }
      }
    });
  }

  normalizeBadges();
  let rafId: number | null = null;
  const observer = new MutationObserver(() => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      normalizeBadges();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function detectTrelloAccount(): void {
  function scanAccount() {
    const pathMatch = window.location.pathname.match(/\/u\/([a-zA-Z0-9_-]+)/);
    let username = pathMatch ? pathMatch[1] : '';

    if (!username || username === 'my') {
      const memberBtn = document.querySelector<HTMLAnchorElement>(
        'a[data-testid="header-member-menu-button"], a[href^="/u/"]'
      );
      if (memberBtn) {
        const href = memberBtn.getAttribute('href') || '';
        const match = href.match(/\/u\/([a-zA-Z0-9_-]+)/);
        if (match && match[1] && match[1] !== 'my') {
          username = match[1];
        }
      }
    }

    if (username && username !== 'my' && typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        chrome.storage.local.set({ trello_detected_username: username });
      } catch {
        // extension was reloaded while this tab stayed open: nothing to record
      }
    }
  }

  scanAccount();
  setTimeout(scanAccount, 1500);

  // Lets the hub reveal its Trello tab only for people who actually use Trello.
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      chrome.storage.local.set({ ikmal_trello_seen: true });
    } catch {
      // extension was reloaded while this tab stayed open: nothing to record
    }
  }
}
