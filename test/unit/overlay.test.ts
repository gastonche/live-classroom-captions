import { describe, expect, it } from 'vitest';
import { decide, Dodger, opposite } from '../../src/overlay/logic';
import type { HostState } from '../../src/host';

const st = (p: Partial<HostState> = {}): HostState => ({
  code: 'K7PX', ready: true, net: 'online', teacher: true, live: true, paused: false, micOk: true, ...p,
});

describe('overlay decide()', () => {
  it('shows only the caption box while live', () => {
    expect(decide(st(), { hidden: false, showCode: false })).toEqual({ box: true, chip: null, card: false });
  });
  it('shows nothing at all when no lesson is live', () => {
    expect(decide(st({ live: false }), { hidden: false, showCode: false })).toEqual({ box: false, chip: null, card: false });
  });
  it('turns states into small chips instead of the box', () => {
    expect(decide(st({ teacher: false }), { hidden: false, showCode: false }).chip).toBe('waiting');
    expect(decide(st({ paused: true }), { hidden: false, showCode: false }).chip).toBe('paused');
    expect(decide(st({ micOk: false }), { hidden: false, showCode: false }).chip).toBe('interrupted');
    expect(decide(st({ paused: true }), { hidden: false, showCode: false }).box).toBe(false);
  });
  it('shows the student QR card only when asked for, once the room is ready', () => {
    expect(decide(st({ live: false }), { hidden: false, showCode: true }).card).toBe(true);
    expect(decide(st({ live: true }), { hidden: false, showCode: true }).card).toBe(true);
    expect(decide(st({ live: true }), { hidden: false, showCode: false }).card).toBe(false);
    expect(decide(st({ ready: false }), { hidden: false, showCode: true }).card).toBe(false);
  });
  it('hide wins over everything', () => {
    expect(decide(st({ micOk: false }), { hidden: true, showCode: true })).toEqual({ box: false, chip: null, card: false });
  });
});

describe('Dodger', () => {
  const box = { left: 100, top: 500, right: 900, bottom: 600 };
  it('fires once after the pointer rests over the box for the hold time', () => {
    const d = new Dodger(1000);
    expect(d.update({ x: 200, y: 550 }, box, 0)).toBe(false);
    expect(d.update({ x: 210, y: 550 }, box, 900)).toBe(false);
    expect(d.update({ x: 220, y: 550 }, box, 1000)).toBe(true);
    expect(d.update({ x: 220, y: 550 }, box, 1100)).toBe(false); // starts a new rest
  });
  it('resets when the pointer leaves, or is unknown', () => {
    const d = new Dodger(1000);
    d.update({ x: 200, y: 550 }, box, 0);
    d.update({ x: 50, y: 50 }, box, 800);
    expect(d.update({ x: 200, y: 550 }, box, 1200)).toBe(false);
    expect(d.update(null, box, 5000)).toBe(false);
  });
  it('flips edges', () => {
    expect(opposite('top')).toBe('bottom');
    expect(opposite('bottom')).toBe('top');
  });
});
