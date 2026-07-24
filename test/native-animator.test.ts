import { describe, it, expect } from 'vitest';
import { Animator, easeToward } from '../src/renderers/native/core/Animator';

/** Controllable rAF + clock so we can step animation frames deterministically. */
function harness(tick: (dt: number) => boolean) {
    let pending: (() => void) | null = null;
    let handles = 0;
    let t = 1000;
    const raf = (cb: () => void): number => {
        pending = cb;
        return ++handles;
    };
    const cancel = (): void => {
        pending = null;
    };
    const animator = new Animator(tick, raf, cancel, () => t);
    const advance = (dt: number): void => {
        t += dt;
        const cb = pending;
        pending = null;
        cb?.();
    };
    return { animator, advance, armed: () => pending !== null };
}

describe('native Animator', () => {
    it('runs frames with dt until tick returns false, then stops', () => {
        const dts: number[] = [];
        let frames = 0;
        const h = harness((dt) => {
            dts.push(dt);
            frames += 1;
            return frames < 3; // animate for 3 frames
        });
        h.animator.start();
        expect(h.animator.active).toBe(true);
        h.advance(16);
        h.advance(16);
        expect(h.animator.active).toBe(true);
        h.advance(16);
        expect(dts).toEqual([16, 16, 16]);
        expect(h.animator.active).toBe(false); // settled → loop stopped
        expect(h.armed()).toBe(false);
    });

    it('clamps a huge frame gap (backgrounded tab) to 64ms', () => {
        let seen = -1;
        const h = harness((dt) => {
            seen = dt;
            return false;
        });
        h.animator.start();
        h.advance(5000); // tab was backgrounded for 5s
        expect(seen).toBe(64);
    });

    it('start() is idempotent (one armed frame)', () => {
        const h = harness(() => false);
        h.animator.start();
        h.animator.start();
        h.animator.start();
        expect(h.armed()).toBe(true); // still just one pending frame
    });

    it('stop() cancels a pending frame', () => {
        let ran = false;
        const h = harness(() => {
            ran = true;
            return true;
        });
        h.animator.start();
        h.animator.stop();
        h.advance(16);
        expect(ran).toBe(false);
        expect(h.animator.active).toBe(false);
    });
});

describe('native Animator · easeToward', () => {
    it('approaches the target monotonically and converges', () => {
        let v = 0;
        const seq: number[] = [];
        for (let i = 0; i < 40; i += 1) {
            v = easeToward(v, 100, 16, 70);
            seq.push(v);
        }
        // monotonic increasing, never overshoots, ends within 1% of target
        for (let i = 1; i < seq.length; i += 1) expect(seq[i]!).toBeGreaterThanOrEqual(seq[i - 1]!);
        expect(seq[seq.length - 1]!).toBeLessThanOrEqual(100);
        expect(seq[seq.length - 1]!).toBeGreaterThan(99);
    });

    it('is frame-rate independent (same elapsed time → ~same result)', () => {
        // one 32ms step vs two 16ms steps should land at nearly the same place
        const one = easeToward(0, 100, 32, 70);
        let two = easeToward(0, 100, 16, 70);
        two = easeToward(two, 100, 16, 70);
        expect(Math.abs(one - two)).toBeLessThan(0.5);
    });

    it('jumps straight to target when tau is 0', () => {
        expect(easeToward(5, 42, 16, 0)).toBe(42);
    });
});
