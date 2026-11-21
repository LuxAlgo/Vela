import { describe, it, expect } from 'vitest';
import { timeframeToMs } from '../src/data/timeframe';

const MIN = 60_000;
const DAY = 86_400_000;
const MONTH = 30 * DAY;

describe('timeframeToMs', () => {
    it('reads bare numbers as minutes and the named periods as themselves', () => {
        expect(timeframeToMs('1')).toBe(MIN);
        expect(timeframeToMs('240')).toBe(240 * MIN);
        expect(timeframeToMs('D')).toBe(DAY);
        expect(timeframeToMs('W')).toBe(7 * DAY);
        expect(timeframeToMs('M')).toBe(MONTH);
    });

    it('reads a counted month (1M, 3M, 12M) as months, not minutes', () => {
        expect(timeframeToMs('1M')).toBe(MONTH);
        expect(timeframeToMs('3M')).toBe(3 * MONTH);
        expect(timeframeToMs('12M')).toBe(12 * MONTH);
    });

    it('keeps the lowercase m alias as minutes', () => {
        expect(timeframeToMs('1m')).toBe(MIN);
        expect(timeframeToMs('15m')).toBe(15 * MIN);
    });

    it('reads counted days and weeks, and the h/d/w aliases in either case', () => {
        expect(timeframeToMs('1D')).toBe(DAY);
        expect(timeframeToMs('2W')).toBe(14 * DAY);
        expect(timeframeToMs('4h')).toBe(4 * 60 * MIN);
        expect(timeframeToMs('4H')).toBe(4 * 60 * MIN);
        expect(timeframeToMs('1d')).toBe(DAY);
        expect(timeframeToMs('1w')).toBe(7 * DAY);
    });

    it('reads seconds timeframes (the widget passes them through as NS)', () => {
        expect(timeframeToMs('30S')).toBe(30_000);
        expect(timeframeToMs('1s')).toBe(1_000);
    });

    it('falls back to one hour for anything it cannot read', () => {
        expect(timeframeToMs('')).toBe(60 * MIN);
        expect(timeframeToMs('5Y')).toBe(60 * MIN);
        expect(timeframeToMs('abc')).toBe(60 * MIN);
    });
});
