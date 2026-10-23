// Overlay decisions, kept free of DOM and Tauri so they can be unit-tested.
import type { HostState } from '../host';
import type { Position } from '../protocol';

export type Chip = 'waiting' | 'paused' | 'interrupted' | null;

export type View = {
  /** The caption box itself. */
  box: boolean;
  /** A small status chip in place of the box. */
  chip: Chip;
  /** The room-code card in a corner. */
  card: boolean;
};

/**
 * What the overlay shows. Nothing at all when no lesson is live, so an always-running
 * app never clutters the projector; the room code shows only when asked for (or at launch).
 */
export function decide(st: HostState, opts: { hidden: boolean; showCode: boolean }): View {
  if (opts.hidden) return { box: false, chip: null, card: false };
  const card = opts.showCode && st.ready;
  if (!st.live) return { box: false, chip: null, card };
  const chip: Chip = !st.teacher ? 'waiting' : st.paused ? 'paused' : !st.micOk ? 'interrupted' : null;
  return { box: !chip, chip, card };
}

export function opposite(p: Position): Position {
  return p === 'top' ? 'bottom' : 'top';
}

type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * "Move out of the way": when the pointer rests over the caption box for `holdMs`,
 * the box should jump to the other edge. Returns true once per rest.
 */
export class Dodger {
  private since: number | null = null;
  constructor(private holdMs = 1000) {}

  update(cursor: { x: number; y: number } | null, box: Rect | null, now: number): boolean {
    const inside =
      !!cursor && !!box && cursor.x >= box.left && cursor.x <= box.right && cursor.y >= box.top && cursor.y <= box.bottom;
    if (!inside) {
      this.since = null;
      return false;
    }
    if (this.since === null) this.since = now;
    if (now - this.since >= this.holdMs) {
      this.since = null;
      return true;
    }
    return false;
  }
}
