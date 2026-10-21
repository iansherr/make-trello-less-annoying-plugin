/**
 * What this plugin contributes to a host dock (ikmal webtools), through the host's versioned plugin contract:
 * content scripts of one extension share a window, so the plugin registers a plain object on
 * window.__ikmalPlugins and announces it with an event. The host renders the chip and menu rows and owns the
 * popover shell; the plugin only supplies data, callbacks and the DOM it builds inside that shell.
 * Registering is harmless without a host: it only fills a Map on window.
 *
 * Contract version 1, documented in the host repo (timeworthy/ikmal-webtools, docs/PLUGIN_CONTRACT.md).
 */

export const PLUGIN_ID = 'trello';
const API_VERSION = 1;
const REGISTRY_KEY = '__ikmalPlugins';
const REGISTERED_EVENT = 'ikmal:plugin-registered';
const UPDATED_EVENT = 'ikmal:plugin-updated';
const TOAST_EVENT = 'ikmal:toast';
const MOVES_POPOVER_ID = 'moves';

export interface MoveEntry {
  cardId: string;
  title: string;
  from: string;
  to: string;
  at: number;
}

export interface MovesApi {
  getState(): { entries: MoveEntry[]; alertMs: number };
  jump(cardId: string): void;
  clearHighlights(): void;
  clearHistory(): void;
}

export interface RulesApi {
  getState(): {
    boardId: string;
    boardName: string;
    ignoreOwnMoves: boolean;
    members: string[];
    lists: Array<{ key: string; id?: string; name: string; rule: { mode: string; silent?: boolean } | null }>;
  };
  setListRule(ref: { id?: string; name: string }, rule: { mode: string; silent?: boolean } | null): void;
  setMembers(members: string[]): void;
  setIgnoreOwnMoves(value: boolean): void;
  clearBoardRules(): void;
}

interface Popover {
  render(container: HTMLElement): void | (() => void);
}

interface Registration {
  apiVersion: number;
  id: string;
  dock: {
    chips: Array<{ id: string; icon: string; label: string; badge(): string; popover: Popover }>;
    menuItems: Array<{
      id: string;
      icon: string;
      title: string;
      subtitle?: string | (() => string);
      onClick?(): void;
      popover?: Popover;
    }>;
  };
}

type RegistryHost = Window & { [REGISTRY_KEY]?: Map<string, Registration> };

const CSS = `
.moves-link { flex: 0 0 auto; padding: 2px 6px; border-radius: 5px; border: 1px solid rgba(232,232,236,0.25); background: #2c2c34; color: #e8e8ec; font-size: 10px; cursor: pointer; }
.tcnp-dock-moves { display: flex; flex-direction: column; min-height: 0; flex: 1; gap: 6px; }
.tcnp-dock-moves .moves-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 4px 6px; }
.tcnp-dock-moves .moves-head strong { font-size: 11px; color: #e8e8ec; white-space: nowrap; }
#tcnp-moves-view { display: flex; flex-direction: column; min-height: 0; flex: 1; gap: 6px; }
.moves-list { list-style: none; flex: 1; min-height: 0; overflow-y: auto; border-top: 1px solid rgba(232,232,236,0.1); }
.moves-empty { padding: 10px 4px; color: #9c9ca4; font-size: 11px; line-height: 1.4; }
.moves-foot { display: flex; justify-content: flex-end; gap: 4px; }
.moves-entry { display: grid; grid-template-columns: 1fr auto; gap: 1px 8px; width: 100%; padding: 6px 4px; background: none; border: 0; border-bottom: 1px solid rgba(232,232,236,0.08); color: #e8e8ec; text-align: left; cursor: pointer; }
.moves-entry:hover { background: rgba(242,182,0,0.1); }
.moves-entry .t { font-weight: 600; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.moves-entry .r, .moves-entry .a { color: #9c9ca4; font-size: 10px; }
.moves-entry .a { grid-column: 2; grid-row: 1; }
#tcnp-rules-panel { display: none; flex-direction: column; gap: 6px; flex: 1; min-height: 0; overflow-y: auto; }
.rules-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 11px; }
.rules-row .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.rules-row select, .rules-input { background: #25252b; color: #e8e8ec; border: 1px solid rgba(232,232,236,0.2); border-radius: 4px; font-size: 10px; padding: 2px 4px; }
.rules-input { width: 100%; padding: 4px 6px; }
.rules-note { font-size: 10px; color: #9c9ca4; line-height: 1.3; }
.rules-lists { display: flex; flex-direction: column; gap: 4px; }
`;

function moveAge(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isFiltered(rules: RulesApi): boolean {
  const rs = rules.getState();
  return rs.ignoreOwnMoves || rs.members.length > 0 || rs.lists.some((l) => l.rule);
}

function button(id: string, text: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'moves-link';
  b.id = id;
  b.textContent = text;
  return b;
}

/** Fill the host's popover shell with the move list and the rules editor. Returns the cleanup the host runs on close. */
function renderMovesPopover(container: HTMLElement, moves: MovesApi, rules: RulesApi): () => void {
  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.className = 'tcnp-dock-moves';

  const head = document.createElement('div');
  head.className = 'moves-head';
  const summary = document.createElement('strong');
  summary.id = 'tcnp-moves-summary';
  const rulesToggle = button('tcnp-rules-toggle', '⚙ Rules');
  rulesToggle.setAttribute('aria-expanded', 'false');
  head.append(summary, rulesToggle);

  const view = document.createElement('div');
  view.id = 'tcnp-moves-view';
  const list = document.createElement('ol');
  list.className = 'moves-list';
  list.id = 'tcnp-moves-list';
  const foot = document.createElement('div');
  foot.className = 'moves-foot';
  const clearHighlights = button('tcnp-clear-highlights', 'Clear highlights');
  const clearHistory = button('tcnp-clear-history', 'Clear history');
  foot.append(clearHighlights, clearHistory);
  view.append(list, foot);

  const panel = document.createElement('div');
  panel.id = 'tcnp-rules-panel';

  root.append(head, view, panel);
  container.append(style, root);

  let rulesOpen = false;

  function renderRules(): void {
    panel.style.display = rulesOpen ? 'flex' : 'none';
    view.style.display = rulesOpen ? 'none' : 'flex';
    rulesToggle.setAttribute('aria-expanded', String(rulesOpen));
    rulesToggle.textContent = rulesOpen ? '← Moves' : '⚙ Rules';
    if (!rulesOpen) return;
    const st = rules.getState();
    panel.replaceChildren();

    const own = document.createElement('label');
    own.className = 'rules-row';
    const ownBox = document.createElement('input');
    ownBox.type = 'checkbox';
    ownBox.id = 'rules-ignore-own';
    ownBox.checked = st.ignoreOwnMoves;
    ownBox.addEventListener('change', () => rules.setIgnoreOwnMoves(ownBox.checked));
    const ownText = document.createElement('span');
    ownText.className = 'nm';
    ownText.textContent = 'Ignore my own moves';
    own.append(ownText, ownBox);

    const people = document.createElement('div');
    const peopleLabel = document.createElement('div');
    peopleLabel.className = 'rules-note';
    peopleLabel.textContent = 'Only cards assigned to (names or initials, comma separated):';
    const peopleInput = document.createElement('input');
    peopleInput.type = 'text';
    peopleInput.id = 'rules-members';
    peopleInput.className = 'rules-input';
    peopleInput.placeholder = 'Everyone';
    peopleInput.value = st.members.join(', ');
    peopleInput.addEventListener('change', () => rules.setMembers(peopleInput.value.split(',')));
    people.append(peopleLabel, peopleInput);

    const note = document.createElement('div');
    note.className = 'rules-note';
    note.textContent =
      'No rules: every list is tracked. Pick Watch / Into / Out for the lists you care about and the rest switch off; Ignore always skips a list.';

    // With any Watch / Into / Out rule the board is an allow-list: lists without a rule are not tracked.
    const allowList = st.lists.some((l) => l.rule && l.rule.mode !== 'ignore');
    const listsBox = document.createElement('div');
    listsBox.className = 'rules-lists';
    st.lists.forEach((l) => {
      const row = document.createElement('div');
      row.className = 'rules-row';
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = l.name;
      name.title = l.name;
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Rule for ${l.name}`);
      select.dataset.list = l.name;
      [
        ['', allowList ? '— off' : '— tracked'],
        ['watch', 'Watch'],
        ['into', 'Into'],
        ['out', 'Out of'],
        ['ignore', 'Ignore'],
      ].forEach(([value, label]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        select.append(opt);
      });
      select.value = l.rule?.mode ?? '';
      if (allowList && !l.rule) row.style.opacity = '0.55'; // not tracked: visibly dimmed
      const silent = document.createElement('input');
      silent.type = 'checkbox';
      silent.title = 'Silent: record in the history without an alert';
      silent.setAttribute('aria-label', `Silent for ${l.name}`);
      silent.checked = Boolean(l.rule?.silent);
      silent.disabled = !l.rule || l.rule.mode === 'ignore';
      const apply = () =>
        rules.setListRule(
          { id: l.id, name: l.name },
          select.value ? { mode: select.value, silent: silent.checked } : null
        );
      select.addEventListener('change', apply);
      silent.addEventListener('change', apply);
      row.append(name, select, silent);
      listsBox.append(row);
    });

    const reset = button('rules-reset', 'Reset rules for this board');
    reset.addEventListener('click', () => rules.clearBoardRules());

    panel.append(own, people, note, listsBox, reset);
  }

  function renderMoves(): void {
    const entries = moves.getState().entries;
    summary.textContent = `${entries.length ? `${entries.length} moved` : 'No moves yet'}${
      isFiltered(rules) ? ' · filtered' : ''
    }`;
    list.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'moves-empty';
      empty.textContent = 'No moves recorded yet. Use Rules to choose which lists and people to track.';
      list.append(empty);
    }
    entries.forEach((entry) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'moves-entry';
      btn.title = 'Scroll to this card';
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = `#${entry.cardId} ${entry.title}`.trim();
      const r = document.createElement('span');
      r.className = 'r';
      r.textContent = `${entry.from} → ${entry.to}`;
      const a = document.createElement('span');
      a.className = 'a';
      a.textContent = moveAge(entry.at);
      btn.append(t, r, a);
      btn.addEventListener('click', () => moves.jump(entry.cardId));
      li.append(btn);
      list.append(li);
    });
  }

  const refresh = () => {
    renderRules();
    renderMoves();
  };
  rulesToggle.addEventListener('click', () => {
    rulesOpen = !rulesOpen;
    refresh();
  });
  clearHighlights.addEventListener('click', () => {
    moves.clearHighlights();
    renderMoves();
  });
  clearHistory.addEventListener('click', () => {
    moves.clearHistory();
    renderMoves();
  });
  window.addEventListener('tcnp:moves-changed', refresh);
  window.addEventListener('tcnp:rules-changed', refresh);
  refresh();

  return () => {
    window.removeEventListener('tcnp:moves-changed', refresh);
    window.removeEventListener('tcnp:rules-changed', refresh);
  };
}

export function buildDockRegistration(moves: MovesApi, rules: RulesApi, exportBoard: () => void): Registration {
  const count = () => moves.getState().entries.length;
  const popover: Popover = { render: (container) => renderMovesPopover(container, moves, rules) };
  return {
    apiVersion: API_VERSION,
    id: PLUGIN_ID,
    dock: {
      chips: [
        {
          id: MOVES_POPOVER_ID,
          icon: '⇄',
          label: 'Card moves',
          // An empty badge hides the chip: it only shows once a move was recorded.
          badge: () => (count() ? (count() > 99 ? '99+' : String(count())) : ''),
          popover,
        },
      ],
      menuItems: [
        {
          id: 'info',
          icon: '▤',
          title: 'Trello Numbers Active',
          subtitle: 'Plugin active on this board',
          onClick() {
            // Informational row: nothing to do when it is clicked (the dock just closes its menu).
          },
        },
        {
          id: MOVES_POPOVER_ID,
          icon: '⇄',
          title: 'Card moves',
          subtitle: () => `${count() ? `${count()} moved` : 'No moves yet'}${isFiltered(rules) ? ' · filtered' : ''}`,
          popover,
        },
        {
          id: 'export',
          icon: '▤',
          title: 'Export Trello Board',
          subtitle: 'Export cards to Markdown or CSV',
          onClick: exportBoard,
        },
      ],
    },
  };
}

/** Register with the host dock (if any) and keep it informed when the badge or subtitle may have changed. */
export function publishDockRegistration(registration: Registration, host: RegistryHost = window): void {
  (host[REGISTRY_KEY] ??= new Map()).set(registration.id, registration);
  host.dispatchEvent(new CustomEvent(REGISTERED_EVENT, { detail: { id: registration.id } }));
  const changed = () => host.dispatchEvent(new CustomEvent(UPDATED_EVENT, { detail: { id: registration.id } }));
  host.addEventListener('tcnp:moves-changed', changed);
  host.addEventListener('tcnp:rules-changed', changed);
}

/** The extension was reloaded under this tab: take our entry out so the dock stops showing it. */
export function withdrawDockRegistration(host: RegistryHost = window): void {
  host[REGISTRY_KEY]?.delete(PLUGIN_ID);
  host.dispatchEvent(new CustomEvent(UPDATED_EVENT, { detail: { id: PLUGIN_ID } }));
}

/** Ask the dock to show a toast with a "View all" action that opens the moves popover. */
export function dispatchDockToast(text: string, ms: number, host: Window = window): void {
  host.dispatchEvent(
    new CustomEvent(TOAST_EVENT, {
      detail: { pluginId: PLUGIN_ID, text, ms, action: { label: 'View all', openPopover: MOVES_POPOVER_ID } },
    })
  );
}
