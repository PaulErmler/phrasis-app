import { describe, it, expect } from 'vitest';
import {
  getTodayInTimezone,
  resolveClientToday,
} from '@/convex/lib/dateUtils';
import { addDays } from '@/lib/dateStrings';

/**
 * `resolveClientToday` lets the client tell day-keyed queries what "today" is
 * (so the goal ring / streak roll over at local midnight, a Convex query
 * never re-runs because time passed), while clamping to ±1 day of the
 * server's view so a hostile or skewed client can only shift its own display.
 */
describe('resolveClientToday', () => {
  const serverToday = getTodayInTimezone('UTC');

  it('falls back to the server date when the client sends nothing', () => {
    expect(resolveClientToday('UTC')).toBe(serverToday);
  });

  it('accepts the server date and its ±1-day neighbours', () => {
    expect(resolveClientToday('UTC', serverToday)).toBe(serverToday);
    const yesterday = addDays(serverToday, -1);
    const tomorrow = addDays(serverToday, 1);
    expect(resolveClientToday('UTC', yesterday)).toBe(yesterday);
    expect(resolveClientToday('UTC', tomorrow)).toBe(tomorrow);
  });

  it('rejects dates outside the ±1-day window', () => {
    expect(resolveClientToday('UTC', addDays(serverToday, -2))).toBe(serverToday);
    expect(resolveClientToday('UTC', '2020-01-01')).toBe(serverToday);
  });

  it('rejects malformed input', () => {
    expect(resolveClientToday('UTC', 'not-a-date')).toBe(serverToday);
    expect(resolveClientToday('UTC', '2026-8-4')).toBe(serverToday);
    expect(resolveClientToday('UTC', '')).toBe(serverToday);
  });

  // These pass DATE_RE but canonicalize to an ISO expanded-year string
  // ("+010007-06"), which makes daysBetween return NaN. A bare `> 1` clamp
  // let them through, and the first addDays downstream threw
  // `RangeError: Invalid time value`, failing the whole projections query.
  it('rejects regex-valid dates that are outside the Date range', () => {
    for (const bad of ['9999-99-99', '0000-00-00', '9999-12-99']) {
      const resolved = resolveClientToday('UTC', bad);
      expect(resolved, `${bad} must clamp to the server date`).toBe(serverToday);
      // The result must always be a usable day key.
      expect(resolved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(() => addDays(resolved, -89)).not.toThrow();
    }
  });

  it('canonicalizes a well-formed but non-canonical date before use', () => {
    // "…-00" would otherwise leak through as a raw map key that matches no
    // stored row. Only meaningful when the canonical form is in-window.
    const monthStart = serverToday.slice(0, 8) + '01';
    if (Math.abs(Date.parse(serverToday) - Date.parse(monthStart)) <= 86_400_000) {
      const zeroDay = serverToday.slice(0, 8) + '00';
      const resolved = resolveClientToday('UTC', zeroDay);
      // Canonicalized (last day of previous month) or clamped to server,
      // never the raw "…-00" string.
      expect(resolved).not.toBe(zeroDay);
      expect(/^\d{4}-\d{2}-(0[1-9]|[12]\d|3[01])$/.test(resolved)).toBe(true);
    }
  });
});
