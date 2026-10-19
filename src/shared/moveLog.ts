export interface MoveLogEntry {
  cardId: string;
  title: string;
  from: string;
  to: string;
  /** epoch ms */
  at: number;
}

export const MOVE_LOG_LIMIT = 200;
/** How long the move alert stays expanded before fading back to the iw icon. */
export const ALERT_VISIBLE_MS = 10_000;

const sameMove = (a: MoveLogEntry, b: MoveLogEntry): boolean =>
  a.cardId === b.cardId && a.from === b.from && a.to === b.to && a.at === b.at;

/** Newest first, capped. */
export function appendMoves(log: MoveLogEntry[], moves: MoveLogEntry[], limit = MOVE_LOG_LIMIT): MoveLogEntry[] {
  return [...moves, ...log].sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Union of two logs (e.g. stored history + moves seen while it loaded), de-duplicated. */
export function mergeLogs(stored: MoveLogEntry[], live: MoveLogEntry[], limit = MOVE_LOG_LIMIT): MoveLogEntry[] {
  const merged = [...live];
  stored.forEach((entry) => {
    if (!merged.some((m) => sameMove(m, entry))) merged.push(entry);
  });
  return merged.sort((a, b) => b.at - a.at).slice(0, limit);
}

export function formatAge(at: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Defensive parse of whatever storage returns. */
export function sanitizeLog(raw: unknown): MoveLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (e): e is MoveLogEntry =>
        !!e &&
        typeof e.cardId === 'string' &&
        typeof e.title === 'string' &&
        typeof e.from === 'string' &&
        typeof e.to === 'string' &&
        typeof e.at === 'number'
    )
    .slice(0, MOVE_LOG_LIMIT);
}
