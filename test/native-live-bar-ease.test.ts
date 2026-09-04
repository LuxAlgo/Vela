// The forming-bar glide (`animations.liveBar` / renderer feature `animLiveBar`): on a live
// tick the displayed high/low/close ease toward the new values with a configurable
// time-constant. Off (0, the default) every tick snaps and the animator never starts; on,
// the first tick of a bar and every NEW bar still snap — only same-bar ticks glide.
import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { resolveAnimations, resolveLiveBarEaseMs, resolveMotionPolicy, LIVE_BAR_EASE_DEFAULT_MS, LIVE_BAR_EASE_MAX_MS } from '../src/core/options';
import type { OHLCV } from '../src/core/model/ohlcv';

const bar = (time: number, close: number): OHLCV => ({ time, open: 100, high: Math.max(100, close), low: Math.min(100, close), close, volume: 1 });

/* eslint-disable @typescript-eslint/no-explicit-any -- the eased state is private by design; the test reads it */
function makeRenderer(animLiveBar: number) {
    const r = new NativeRenderer({
        currentPriceLine: true, logScale: false, nativeBackend: 'canvas2d', animZoom: true, animPan: true,
        animLiveBar, glow: 0, upColor: '#0f0', downColor: '#f00', priceStyle: 'candles',
    });
    const anyR = r as any;
    anyR.coords.setSize(800, 200, 1); // unmounted, but sized — the bar/ease math is pure
    let starts = 0;
    anyR.scheduler = { invalidate: () => {}, flushNow: () => {} }; // mount-owned; stubbed for the unmounted path
    anyR.animator = { active: false, start: () => { starts += 1; }, stop: () => {} };
    anyR.introPlayed = true;
    return { r, anyR, starts: () => starts };
}

describe('resolveAnimations / resolveLiveBarEaseMs', () => {
    it('defaults: zoom + pan on, live-bar glide OFF', () => {
        expect(resolveAnimations(undefined)).toEqual({ animZoom: true, animPan: true, animLiveBar: 0 });
        expect(resolveAnimations({})).toEqual({ animZoom: true, animPan: true, animLiveBar: 0 });
    });
    it('a boolean toggles zoom + pan; `true` keeps the live-bar default (off), `false` turns everything off', () => {
        expect(resolveAnimations(true)).toEqual({ animZoom: true, animPan: true, animLiveBar: 0 });
        expect(resolveAnimations(false)).toEqual({ animZoom: false, animPan: false, animLiveBar: 0 });
    });
    it('liveBar: true = the default duration, a number = that duration (clamped), false/0/junk = off', () => {
        expect(resolveAnimations({ liveBar: true }).animLiveBar).toBe(LIVE_BAR_EASE_DEFAULT_MS);
        expect(resolveAnimations({ liveBar: 250 }).animLiveBar).toBe(250);
        expect(resolveAnimations({ liveBar: 5000 }).animLiveBar).toBe(LIVE_BAR_EASE_MAX_MS);
        expect(resolveAnimations({ liveBar: false }).animLiveBar).toBe(0);
        expect(resolveLiveBarEaseMs(0)).toBe(0);
        expect(resolveLiveBarEaseMs(-10)).toBe(0);
        expect(resolveLiveBarEaseMs(NaN)).toBe(0);
        expect(resolveLiveBarEaseMs('90')).toBe(0);
    });
});

describe('NativeRenderer forming-bar glide', () => {
    it('OFF (default): a same-bar tick snaps the displayed close and never starts the animator', () => {
        const { r, anyR, starts } = makeRenderer(0);
        r.setBars([bar(1000, 100), bar(2000, 101)]);
        r.updateBar(bar(2000, 105)); // first tick of the bar — snaps in either mode
        r.updateBar(bar(2000, 110)); // a second tick — the one that would glide
        expect(anyR.liveEaseClose).toBe(110);
        expect(anyR.liveEaseHigh).toBe(110);
        expect(anyR.easeLiveBar(16)).toBe(false); // nothing in flight
        expect(starts()).toBe(0);
        expect(r.readFeature('animLiveBar')).toBe(0);
    });

    it('ON: the first tick of a bar snaps; later ticks glide toward the target and settle there', () => {
        const { r, anyR, starts } = makeRenderer(90);
        r.setBars([bar(1000, 100), bar(2000, 101)]);
        r.updateBar(bar(2000, 105));
        expect(anyR.liveEaseClose).toBe(105); // first tick of this bar: no glide from stale state
        expect(starts()).toBe(0);
        r.updateBar(bar(2000, 110));
        expect(starts()).toBe(1);
        expect(anyR.liveEaseClose).toBe(105); // still displayed at the previous value…
        expect(anyR.easeLiveBar(16)).toBe(true); // …and moving toward the new one
        expect(anyR.liveEaseClose).toBeGreaterThan(105);
        expect(anyR.liveEaseClose).toBeLessThan(110);
        let frames = 1;
        while (anyR.easeLiveBar(16) && frames < 200) frames += 1;
        expect(frames).toBeLessThan(200); // settles
        expect(anyR.liveEaseClose).toBe(110);
        expect(anyR.liveEaseHigh).toBe(110);
    });

    it('ON: a NEW bar always snaps — the ease never runs across bars', () => {
        const { r, anyR, starts } = makeRenderer(90);
        r.setBars([bar(1000, 100), bar(2000, 101)]);
        r.updateBar(bar(2000, 105));
        r.updateBar(bar(3000, 130));
        expect(anyR.liveEaseTime).toBe(3000);
        expect(anyR.liveEaseClose).toBe(130);
        expect(starts()).toBe(0);
    });

    it('a longer time-constant glides slower; switching to 0 mid-glide snaps on the next frame', () => {
        const fast = makeRenderer(50);
        const slow = makeRenderer(400);
        for (const { r } of [fast, slow]) {
            r.setBars([bar(1000, 100), bar(2000, 101)]);
            r.updateBar(bar(2000, 105));
            r.updateBar(bar(2000, 110));
            (r as any).easeLiveBar(16);
        }
        expect(fast.anyR.liveEaseClose).toBeGreaterThan(slow.anyR.liveEaseClose);

        slow.r.applyFeature('animLiveBar', false); // live toggle, mid-glide
        expect(slow.r.readFeature('animLiveBar')).toBe(0);
        expect(slow.anyR.easeLiveBar(16)).toBe(false);
        expect(slow.anyR.liveEaseClose).toBe(110);
    });

    it('the rich config carries an on/off switch only; toggling it on restores the configured duration', () => {
        const { r } = makeRenderer(250);
        expect(r.getConfig().priceScale.animateLastPrice).toBe(true);
        r.applyConfig({ priceScale: { animateLastPrice: false } }); // the settings-dialog toggle
        expect(r.readFeature('animLiveBar')).toBe(0);
        expect(r.getConfig().priceScale.animateLastPrice).toBe(false);
        r.applyConfig({ priceScale: { animateLastPrice: true } });
        expect(r.readFeature('animLiveBar')).toBe(250); // the host's duration, not the built-in default

        const off = makeRenderer(0);
        expect(off.r.getConfig().priceScale.animateLastPrice).toBe(false);
        off.r.applyConfig({ priceScale: { animateLastPrice: true } });
        expect(off.r.readFeature('animLiveBar')).toBe(LIVE_BAR_EASE_DEFAULT_MS); // nothing configured → the default
        off.r.applyConfig({ priceScale: { animateLastPrice: 'yes' as unknown as boolean } }); // junk is dropped, not applied
        expect(off.r.readFeature('animLiveBar')).toBe(LIVE_BAR_EASE_DEFAULT_MS);
    });

    it('the renderer feature accepts `true` (default duration) and clamps numbers', () => {
        const { r } = makeRenderer(0);
        r.applyFeature('animLiveBar', true);
        expect(r.readFeature('animLiveBar')).toBe(LIVE_BAR_EASE_DEFAULT_MS);
        r.applyFeature('animLiveBar', 99_999);
        expect(r.readFeature('animLiveBar')).toBe(LIVE_BAR_EASE_MAX_MS);
    });

    it('reduced motion snaps live bars without destroying the configured duration', () => {
        const { r, anyR, starts } = makeRenderer(90);
        r.setBars([bar(1000, 100), bar(2000, 101)]);
        r.updateBar(bar(2000, 105));
        r.applyMotionPolicy(resolveMotionPolicy(undefined, true));
        r.updateBar(bar(2000, 110));
        expect(anyR.liveEaseClose).toBe(110);
        expect(starts()).toBe(0);
        expect(r.readFeature('animLiveBar')).toBe(90); // configured state survives the runtime gate

        r.applyMotionPolicy(resolveMotionPolicy(undefined, false));
        r.updateBar(bar(2000, 115));
        expect(starts()).toBe(1); // future ticks use the restored configured behavior
    });
});
