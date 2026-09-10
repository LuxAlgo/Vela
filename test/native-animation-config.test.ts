// The expanded `animations` option: every eased motion (zoom, pan inertia, scroll glide,
// autoscale glide, live bar, first-paint reveal) is `boolean | number` — off, the built-in
// duration, or an explicit ease time-constant — instead of a hardcoded constant. The
// renderer exposes each as a feature that reads back its time-constant (0 = off), and the
// rich config carries on/off switches that restore the host's duration when toggled on.
import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { EaseSetting } from '../src/renderers/native/core/Animator';
import { mergeConfig } from '../src/renderers/native/core/chartConfig';
import {
    resolveAnimations,
    resolveEaseMs,
    resolveIntro,
    ZOOM_EASE_DEFAULT_MS,
    PAN_INERTIA_DEFAULT_MS,
    SCROLL_EASE_DEFAULT_MS,
    AUTOSCALE_EASE_DEFAULT_MS,
    INTRO_DURATION_DEFAULT_MS,
    INTRO_DURATION_MAX_MS,
    ANIMATION_EASE_MAX_MS,
    type AnimationConfig,
} from '../src/core/options';

/* eslint-disable @typescript-eslint/no-explicit-any -- the animation state is private by design; the tests read it */
function makeRenderer(animations?: boolean | AnimationConfig) {
    const r = new NativeRenderer({
        currentPriceLine: true, logScale: false, nativeBackend: 'canvas2d', ...resolveAnimations(animations),
        glow: 0, upColor: '#0f0', downColor: '#f00', priceStyle: 'candles',
    });
    const anyR = r as any;
    anyR.coords.setSize(800, 200, 1);
    anyR.coords.setBars(Array.from({ length: 100 }, (_, i) => (i + 1) * 1000));
    anyR.coords.setViewport({ barSpacing: 10, rightOffset: 20 });
    let starts = 0;
    let invalidates = 0;
    anyR.scheduler = { invalidate: () => { invalidates += 1; } };
    anyR.animator = { active: false, start: () => { starts += 1; }, stop: () => {} };
    anyR.emitViewportChange = () => {};
    anyR.introPlayed = true;
    return { r, anyR, starts: () => starts, invalidates: () => invalidates };
}

const ALL_DEFAULTS = {
    animZoom: ZOOM_EASE_DEFAULT_MS,
    animPan: PAN_INERTIA_DEFAULT_MS,
    animScroll: SCROLL_EASE_DEFAULT_MS,
    animAutoscale: AUTOSCALE_EASE_DEFAULT_MS,
    animLiveBar: 0,
    animIntro: { style: 'settle', duration: INTRO_DURATION_DEFAULT_MS },
};

describe('resolveEaseMs / resolveIntro', () => {
    it('true = the default, a positive number = itself (clamped), anything else = off', () => {
        expect(resolveEaseMs(true, 70)).toBe(70);
        expect(resolveEaseMs(150, 70)).toBe(150);
        expect(resolveEaseMs(99_999, 70)).toBe(ANIMATION_EASE_MAX_MS);
        expect(resolveEaseMs(50, 70, 40)).toBe(40);
        for (const junk of [false, 0, -1, NaN, Infinity, '70', null, undefined, {}]) expect(resolveEaseMs(junk, 70)).toBe(0);
    });

    it('intro: true = the default settle reveal, a style name, an object with style/duration, or off', () => {
        expect(resolveIntro(true)).toEqual({ style: 'settle', duration: INTRO_DURATION_DEFAULT_MS });
        expect(resolveIntro('grow')).toEqual({ style: 'grow', duration: INTRO_DURATION_DEFAULT_MS });
        expect(resolveIntro({ duration: 1200 })).toEqual({ style: 'settle', duration: 1200 });
        expect(resolveIntro({ style: 'grow', duration: 99_999 })).toEqual({ style: 'grow', duration: INTRO_DURATION_MAX_MS });
        expect(resolveIntro({ style: 'bounce' as any, duration: -5 })).toEqual({ style: 'settle', duration: INTRO_DURATION_DEFAULT_MS });
        // `undefined` is off here, like resolveEaseMs — resolveAnimations owns the "absent = default" rule.
        for (const off of [false, 'none', 'off', null, undefined, 0, 'junk']) expect(resolveIntro(off).style).toBe(false);
    });
});

describe('resolveAnimations', () => {
    it('absent / {} / true = every motion at its built-in duration (live bar off)', () => {
        expect(resolveAnimations(undefined)).toEqual(ALL_DEFAULTS);
        expect(resolveAnimations({})).toEqual(ALL_DEFAULTS);
        expect(resolveAnimations(true)).toEqual(ALL_DEFAULTS);
    });

    it('false = everything off, the reveal included', () => {
        expect(resolveAnimations(false)).toEqual({ animZoom: 0, animPan: 0, animScroll: 0, animAutoscale: 0, animLiveBar: 0, animIntro: { style: false, duration: 0 } });
    });

    it('each motion is configured on its own: off, on at the default, or an explicit duration', () => {
        const out = resolveAnimations({ zoom: 150, pan: false, autoscale: true, intro: 'grow' });
        expect(out.animZoom).toBe(150);
        expect(out.animPan).toBe(0);
        expect(out.animAutoscale).toBe(AUTOSCALE_EASE_DEFAULT_MS);
        expect(out.animIntro).toEqual({ style: 'grow', duration: INTRO_DURATION_DEFAULT_MS });
    });

    it('scroll follows pan on/off unless set on its own', () => {
        expect(resolveAnimations({ pan: false }).animScroll).toBe(0); // `{ pan: false }` = an instant pan, panBy included
        expect(resolveAnimations({ pan: 300 }).animScroll).toBe(SCROLL_EASE_DEFAULT_MS); // on/off follows; the duration is scroll's own
        expect(resolveAnimations({ pan: false, scroll: 200 }).animScroll).toBe(200);
        expect(resolveAnimations({ scroll: false }).animScroll).toBe(0);
        expect(resolveAnimations({ scroll: false }).animPan).toBe(PAN_INERTIA_DEFAULT_MS);
    });
});

describe('EaseSetting', () => {
    it('remembers the last non-zero duration across an on/off toggle', () => {
        const e = new EaseSetting(70);
        expect(e.tau).toBe(70);
        e.set(200);
        e.toggle(false);
        expect(e.on).toBe(false);
        expect(e.tau).toBe(0);
        e.toggle(true);
        expect(e.tau).toBe(200); // the configured duration, not the default
        e.set(0);
        e.toggle(true);
        expect(e.tau).toBe(200); // set(0) is off, not a new remembered value
    });

    it('a motion that ships off still turns on at its default', () => {
        const e = new EaseSetting(90, 0);
        expect(e.on).toBe(false);
        e.toggle(true);
        expect(e.tau).toBe(90);
    });
});

describe('NativeRenderer animation features', () => {
    it('reads each motion back as its time-constant (0 = off) and accepts true / numbers / false', () => {
        const { r } = makeRenderer({ zoom: 120, pan: false, scroll: 90, autoscale: false, intro: false });
        expect(r.readFeature('animZoom')).toBe(120);
        expect(r.readFeature('animPan')).toBe(0);
        expect(r.readFeature('animScroll')).toBe(90);
        expect(r.readFeature('animAutoscale')).toBe(0);
        expect(r.readFeature('intro')).toBe(false);
        for (const key of ['animZoom', 'animPan', 'animScroll', 'animAutoscale']) expect(r.features).toContain(key);

        r.applyFeature('animZoom', true);
        expect(r.readFeature('animZoom')).toBe(ZOOM_EASE_DEFAULT_MS);
        r.applyFeature('animAutoscale', 55);
        expect(r.readFeature('animAutoscale')).toBe(55);
        r.applyFeature('animAutoscale', 99_999);
        expect(r.readFeature('animAutoscale')).toBe(ANIMATION_EASE_MAX_MS);
        r.applyFeature('animZoom', false);
        expect(r.readFeature('animZoom')).toBe(0);
    });

    it('`animPan` is the umbrella for pan motion: it also switches the scroll glide; `animScroll` tunes it alone', () => {
        const { r } = makeRenderer({ scroll: 200 });
        r.applyFeature('animPan', false);
        expect(r.readFeature('animPan')).toBe(0);
        expect(r.readFeature('animScroll')).toBe(0);
        r.applyFeature('animPan', true);
        expect(r.readFeature('animPan')).toBe(PAN_INERTIA_DEFAULT_MS);
        expect(r.readFeature('animScroll')).toBe(200); // its own remembered duration
        r.applyFeature('animScroll', 50);
        expect(r.readFeature('animPan')).toBe(PAN_INERTIA_DEFAULT_MS); // untouched
        expect(r.readFeature('animScroll')).toBe(50);
    });

    it('zoom off: zoomTo applies the target instantly and never starts the animator', () => {
        const { anyR, starts, invalidates } = makeRenderer({ zoom: false });
        anyR.zoomTo(20, 90, 700);
        expect(anyR.coords.getViewport().barSpacing).toBe(20);
        expect(starts()).toBe(0);
        expect(invalidates()).toBeGreaterThan(0);
    });

    it('zoom on: zoomTo sets a target and starts the animator; the glide eases at the configured tau', () => {
        const { anyR, starts } = makeRenderer({ zoom: 100 });
        anyR.zoomTo(20, 90, 700);
        expect(starts()).toBe(1);
        expect(anyR.targetBarSpacing).toBe(20);
        expect(anyR.coords.getViewport().barSpacing).toBe(10); // not yet moved — the animator's tick does that
        anyR.computeScales = () => {};
        anyR.easeScales = () => false;
        anyR.paintData = () => {};
        anyR.crosshairLayer = { render: () => {} };
        anyR.externalCrossPx = () => null;
        anyR.updateLegendValues = () => {};
        expect(anyR.animTick(100)).toBe(true); // one time-constant: ~63% of the way
        const bs = anyR.coords.getViewport().barSpacing;
        expect(bs).toBeGreaterThan(16);
        expect(bs).toBeLessThan(17);
    });

    it('pan inertia off: a drag-release fling is dropped', () => {
        const { anyR, starts } = makeRenderer({ pan: false });
        anyR.fling(0.5);
        expect(anyR.panVelocity).toBe(0);
        expect(starts()).toBe(0);
        const on = makeRenderer({ pan: true });
        on.anyR.fling(0.5);
        expect(on.anyR.panVelocity).toBe(0.5);
        expect(on.starts()).toBe(1);
    });

    it('scroll glide off: panBy / scroll-to-latest apply instantly even with pan inertia on', () => {
        const { anyR, starts } = makeRenderer({ pan: true, scroll: false });
        const before = anyR.coords.getViewport().rightOffset;
        anyR.panBy(-0.5);
        expect(anyR.coords.getViewport().rightOffset).not.toBe(before);
        expect(anyR.scrollTargetRO).toBeNull();
        expect(starts()).toBe(0);

        const glide = makeRenderer({ pan: true });
        glide.anyR.panBy(-0.5);
        expect(glide.anyR.coords.getViewport().rightOffset).toBe(before); // eased by the animator, not applied yet
        expect(glide.anyR.scrollTargetRO).not.toBeNull();
        expect(glide.starts()).toBe(1);
    });

    it('autoscale glide off: easeScales snaps every pane window to its target in one frame', () => {
        const { anyR } = makeRenderer({ autoscale: false });
        const pane = { scale: { min: 0, max: 1, log: false }, scaleTarget: { min: 100, max: 200, log: false } };
        anyR.scene.panes = new Map([['price', pane]]);
        anyR.scene.indicatorScales = new Map();
        expect(anyR.easeScales(16)).toBe(false);
        expect(pane.scale).toEqual({ min: 100, max: 200, log: false });

        const eased = makeRenderer({ autoscale: 80 });
        const p2 = { scale: { min: 0, max: 1, log: false }, scaleTarget: { min: 100, max: 200, log: false } };
        eased.anyR.scene.panes = new Map([['price', p2]]);
        eased.anyR.scene.indicatorScales = new Map();
        expect(eased.anyR.easeScales(16)).toBe(true);
        expect(p2.scale.min).toBeGreaterThan(0);
        expect(p2.scale.min).toBeLessThan(100);
    });

    it('the `intro` feature accepts style names, the object form, and off; readback is the style', () => {
        const { r, anyR } = makeRenderer();
        anyR.bars = []; // nothing to reveal — applyFeature's replay is a no-op
        expect(r.readFeature('intro')).toBe('settle');
        r.applyFeature('intro', 'grow');
        expect(r.readFeature('intro')).toBe('grow');
        r.applyFeature('intro', { duration: 300 });
        expect(anyR.intro).toEqual({ style: 'settle', duration: 300 });
        r.applyFeature('intro', false);
        expect(r.readFeature('intro')).toBe(false);
    });
});

describe('rich config: the Animation switches (on/off only, durations remembered)', () => {
    it('getConfig reflects each motion; applyConfig toggles it and restores the host duration', () => {
        const { r } = makeRenderer({ zoom: 150, pan: 300, autoscale: false, intro: 'grow' });
        expect(r.getConfig().animations).toEqual({ zoom: true, pan: true, autoscale: false, intro: true });

        r.applyConfig({ animations: { zoom: false, pan: false, autoscale: true, intro: false } });
        expect(r.getConfig().animations).toEqual({ zoom: false, pan: false, autoscale: true, intro: false });
        expect(r.readFeature('animZoom')).toBe(0);
        expect(r.readFeature('animPan')).toBe(0);
        expect(r.readFeature('animScroll')).toBe(0); // the pan switch covers the scroll glide
        expect(r.readFeature('animAutoscale')).toBe(AUTOSCALE_EASE_DEFAULT_MS); // never configured → the default
        expect(r.readFeature('intro')).toBe(false);

        r.applyConfig({ animations: { zoom: true, pan: true, intro: true } });
        expect(r.readFeature('animZoom')).toBe(150); // the host's duration, not the built-in default
        expect(r.readFeature('animPan')).toBe(300);
        expect(r.readFeature('animScroll')).toBe(SCROLL_EASE_DEFAULT_MS);
        expect(r.readFeature('intro')).toBe('grow'); // the host's style
    });

    it('the live-bar switch stays under priceScale.animateLastPrice; the new block does not carry it', () => {
        const { r } = makeRenderer({ liveBar: 250 });
        expect(r.getConfig().priceScale.animateLastPrice).toBe(true);
        expect(r.getConfig().animations).not.toHaveProperty('lastPrice');
        r.applyConfig({ animations: { zoom: false } });
        expect(r.readFeature('animLiveBar')).toBe(250); // an unrelated switch leaves it alone
    });

    it('mergeConfig validates the block: booleans apply, junk keeps the base, an absent block changes nothing', () => {
        const base = new NativeRenderer().getConfig();
        expect(base.animations).toEqual({ zoom: true, pan: true, autoscale: true, intro: true });
        const out = mergeConfig(base, { animations: { zoom: false, pan: 'no', autoscale: 0, extra: true } });
        expect(out.animations).toEqual({ zoom: false, pan: true, autoscale: true, intro: true });
        expect(mergeConfig(base, {}).animations).toEqual(base.animations);
        expect(mergeConfig(base, { animations: 'off' }).animations).toEqual(base.animations);
    });
});
