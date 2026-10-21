/**
 * Which card moves are worth recording and alerting on.
 *
 * Default (no rules): every move is recorded and alerted, exactly as before.
 * Rules are per board and refer to lists. Modes:
 *   watch  - moves into or out of this list
 *   into   - only arrivals in this list
 *   out    - only departures from this list
 *   ignore - never record anything that touches this list
 * Any watch/into/out rule on a board turns it into an allow-list: only moves one of those rules admits are
 * recorded. A rule can be `silent` (kept in the history, no alert).
 */
export type ListMode = 'watch' | 'into' | 'out' | 'ignore';

export interface ListRule {
  /** Display name; also the match key when the list has no stable id. */
  name: string;
  mode: ListMode;
  silent?: boolean;
}

export interface BoardRules {
  boardName?: string;
  /** Keyed by listKey(): the list id when known, otherwise `name:<lowercased name>`. */
  lists: Record<string, ListRule>;
  /** Only moves of cards assigned to one of these people (case-insensitive substring of name/initials). */
  members: string[];
}

export interface RuleState {
  /** Don't record moves the user just made themselves (drag, menu, keyboard). */
  ignoreOwnMoves: boolean;
  boards: Record<string, BoardRules>;
}

export interface ListRef {
  /** Stable id when Trello exposes one. */
  id?: string;
  name: string;
}

export interface MoveCandidate {
  from: ListRef;
  to: ListRef;
  /** Names/initials of members shown on the card. */
  members: string[];
  /** True when the user was interacting with the page when the move appeared. */
  own: boolean;
}

export interface Verdict {
  record: boolean;
  alert: boolean;
}

export const MODES: ListMode[] = ['watch', 'into', 'out', 'ignore'];

export const emptyBoardRules = (): BoardRules => ({ lists: {}, members: [] });
export const emptyRuleState = (): RuleState => ({ ignoreOwnMoves: false, boards: {} });

export const nameKey = (name: string): string => `name:${name.trim().toLowerCase()}`;
export const listKey = (ref: ListRef): string => (ref.id ? ref.id : nameKey(ref.name));

/** A rule can be stored under the id or the name key (the id is only learned once the list is seen). */
export function findRule(rules: BoardRules, ref: ListRef): ListRule | undefined {
  return (ref.id ? rules.lists[ref.id] : undefined) ?? rules.lists[nameKey(ref.name)];
}

export function hasAllowList(rules: BoardRules): boolean {
  return Object.values(rules.lists).some((r) => r.mode !== 'ignore');
}

export function judgeMove(rules: BoardRules | undefined, ignoreOwnMoves: boolean, move: MoveCandidate): Verdict {
  if (ignoreOwnMoves && move.own) return { record: false, alert: false };
  if (!rules) return { record: true, alert: true };

  const fromRule = findRule(rules, move.from);
  const toRule = findRule(rules, move.to);
  if (fromRule?.mode === 'ignore' || toRule?.mode === 'ignore') return { record: false, alert: false };

  if (rules.members.length > 0) {
    const wanted = rules.members.map((m) => m.trim().toLowerCase()).filter(Boolean);
    const onCard = move.members.map((m) => m.trim().toLowerCase());
    if (!wanted.some((w) => onCard.some((c) => c.includes(w)))) return { record: false, alert: false };
  }

  if (!hasAllowList(rules)) return { record: true, alert: true };

  // Allow-list: collect the rules that admit this move.
  const admitting: ListRule[] = [];
  if (toRule && (toRule.mode === 'watch' || toRule.mode === 'into')) admitting.push(toRule);
  if (fromRule && (fromRule.mode === 'watch' || fromRule.mode === 'out')) admitting.push(fromRule);
  if (admitting.length === 0) return { record: false, alert: false };
  return { record: true, alert: admitting.some((r) => !r.silent) };
}

/** Defensive parse of whatever storage returns. */
export function sanitizeRuleState(raw: unknown): RuleState {
  const state = emptyRuleState();
  if (!raw || typeof raw !== 'object') return state;
  const src = raw as Record<string, unknown>;
  state.ignoreOwnMoves = src.ignoreOwnMoves === true;
  const boards = src.boards && typeof src.boards === 'object' ? (src.boards as Record<string, unknown>) : {};
  for (const [boardId, value] of Object.entries(boards)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const rules = emptyBoardRules();
    if (typeof v.boardName === 'string') rules.boardName = v.boardName;
    if (Array.isArray(v.members))
      rules.members = v.members.filter((m): m is string => typeof m === 'string' && m.trim() !== '');
    const lists = v.lists && typeof v.lists === 'object' ? (v.lists as Record<string, unknown>) : {};
    for (const [key, rule] of Object.entries(lists)) {
      const r = rule as Record<string, unknown> | null;
      if (!r || typeof r.name !== 'string' || !MODES.includes(r.mode as ListMode)) continue;
      rules.lists[key] = { name: r.name, mode: r.mode as ListMode, silent: r.silent === true };
    }
    state.boards[boardId] = rules;
  }
  return state;
}
