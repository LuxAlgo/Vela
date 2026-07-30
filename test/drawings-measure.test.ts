import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, MeasureBox, PositionTool, formatDuration, type Projector } from '../src/core/drawings';

const HR = 3600000;

/** Linear projector: x = time/hour, y = 100 − price, with a 1-bar-per-hour bar count. */
function fakeProjector(): Projector {
    return {
        xOf: (t) => t / HR,
        yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
        pxToPoint: (x, y) => ({ time: x * HR, price: 100 - y }),
        paneIdAtY: () => 'price',
        barsBetween: (t1, t2) => Math.abs(t2 - t1) / HR,
        width: 200,
        height: 100,
    };
}

describe('drawings/measurement range', () => {
    const proj = fakeProjector();

    it('shows both the price and date deltas by default; red when down; box hit-test', () => {
        const d = createDrawing('datepricerange', { paneId: 'price', anchors: [{ time: 0, price: 60 }, { time: 3 * HR, price: 54 }] })! as MeasureBox;
        const lines = d.measureLabel(proj);
        expect(lines[0]).toBe('-6.00 (-10.00%)');
        expect(lines[1]).toBe('3 bars, 3h');
        expect(d.isUp()).toBe(false);
        expect(d.priceRange()).toEqual({ min: 54, max: 60 });
        expect(d.hitTest(1.5, 43, proj, 4)).toBe(true); // inside the box (x 0..3, y 40..46)
        expect(d.hitTest(1.5, 80, proj, 4)).toBe(false);
    });

    it('the showPrice / showDate toggles drop either line', () => {
        const d = createDrawing('datepricerange', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 60 }] })! as MeasureBox;
        expect(d.measureLabel(proj)).toEqual(['+10.00 (+20.00%)', '5 bars, 5h']); // both on
        d.showDate = false;
        expect(d.measureLabel(proj)).toEqual(['+10.00 (+20.00%)']); // price only
        d.showDate = true;
        d.showPrice = false;
        expect(d.measureLabel(proj)).toEqual(['5 bars, 5h']); // date only
        d.showDate = false;
        expect(d.measureLabel(proj)).toEqual([]); // both off
    });

    it('round-trips the toggles + label text styling through serialize', () => {
        const d = createDrawing('datepricerange', { paneId: 'price', anchors: [{ time: 0, price: 1 }, { time: 1, price: 2 }] })! as MeasureBox;
        d.showPrice = false;
        d.applySettings({ 'text.color': '#ff0000', 'text.size': 'large' });
        const a = d.serialize();
        const round = deserializeDrawing(a)!;
        expect(round.serialize()).toEqual(a);
        expect((round as MeasureBox).showPrice).toBe(false);
        expect(round.text?.color).toBe('#ff0000');
        expect(a.type).toBe('datepricerange');
    });
});

describe('drawings/position tools', () => {
    const proj = fakeProjector();

    it('long position: risk:reward + reward/risk %, box hit-test', () => {
        // entry 50, stop 40 (risk 10), target 70 (reward 20) → R:R 2.0
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })!;
        expect(d.anchorSchema().min).toBe(2); // click entry + click target; onPlaced derives the stop
        expect(d.anchorSchema().max).toBe(2);
        const p = d as PositionTool;
        expect(p.directionLabel()).toBe('LONG'); // target (70) above entry (50)
        expect(p.rr()).toBeCloseTo(2, 6);
        expect(p.rewardPct()).toBeCloseTo(40, 6);
        expect(p.riskPct()).toBeCloseTo(20, 6);
        expect(d.priceRange()).toEqual({ min: 40, max: 70 });
        expect(d.hitTest(5, 45, proj, 4)).toBe(true); // inside the position box
    });

    it('short scenario labels SHORT and computes R:R', () => {
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 60 }, { time: 10 * HR, price: 30 }] })!;
        expect((d as PositionTool).directionLabel()).toBe('SHORT');
        expect((d as PositionTool).rr()).toBeCloseTo(2, 6); // |30−50| / |50−60| = 20/10
    });

    it('direction is purely geometric — the same tool reads SHORT when the target is below the entry', () => {
        // target (30) below entry (50) → SHORT (one tool covers both directions, by where the stop/target land)
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 60 }, { time: 10 * HR, price: 30 }] })!;
        expect((d as PositionTool).directionLabel()).toBe('SHORT');
    });

    it('dragging the stop across the entry flips the target to the opposite side (never same direction)', () => {
        // long: entry 50, stop 40 (below), target 70 (above)
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        d.anchors[1]!.price = 60; // drag the stop UP, past the entry → would be same side as target
        d.constrainHandleDrag(1);
        expect(d.anchors[2]!.price).toBe(30); // target reflected across entry (50): 2·50 − 70 → below
        expect(d.directionLabel()).toBe('SHORT'); // now a short, sides still opposed
    });

    it('dragging the target across the entry flips the stop to the opposite side', () => {
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        d.anchors[2]!.price = 45; // drag the target DOWN, below the entry
        d.constrainHandleDrag(2);
        expect(d.anchors[1]!.price).toBe(60); // stop reflected across entry (50): 2·50 − 40 → above
    });

    it('no flip while the stop and target already straddle the entry', () => {
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        d.anchors[1]!.price = 45; // still below the entry
        d.constrainHandleDrag(1);
        expect(d.anchors[2]!.price).toBe(70); // target untouched
    });

    it('account risk % + balance drive dollar loss and position size', () => {
        // entry 50, stop 40 → risk 10; 1% of $10_000 = $100 → size 10
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        expect(d.riskPercent).toBe(1);
        expect(d.accountBalance).toBe(10_000);
        expect(d.dollarLoss()).toBe(100);
        expect(d.positionSize()).toBeCloseTo(10, 6);
        d.applySettings({ riskPercent: 2, accountBalance: 5_000 });
        expect(d.dollarLoss()).toBe(100); // 2% of 5000
        expect(d.positionSize()).toBeCloseTo(10, 6);
        expect(d.lossSizeLabel()).toMatch(/^Loss \$100/);
    });

    it('live preview treats the second anchor as the profit target (going higher → long)', () => {
        // only entry + target above — stop is derived opposite; direction reads LONG
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 70 }] })! as PositionTool;
        expect(d.directionLabel()).toBe('LONG');
        expect(d.rr()).toBeCloseTo(2, 6); // reward 20 / derived risk 10
        expect(d.layout(proj)?.ty).toBeLessThan(d.layout(proj)!.ey); // target above entry on screen (y down)
    });

    it('price-level settings paths edit the anchors and keep the stop/target opposed', () => {
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        d.applySettings({ entryPrice: 52 });
        expect(d.anchors[0]!.price).toBe(52);
        d.applySettings({ targetPrice: 82 });
        expect(d.anchors[2]!.price).toBe(82);
        expect(d.rr()).toBeCloseTo(30 / 12, 6);
        // typing a stop past the entry flips the target to the other side (same rule as a drag)
        d.applySettings({ stopPrice: 60 });
        expect(d.anchors[1]!.price).toBe(60);
        expect(d.anchors[2]!.price).toBeLessThan(52);
        expect(d.directionLabel()).toBe('SHORT');
    });

    it('label toggles: showPrices appends levels; header/loss/size lines are separate strings', () => {
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        expect(d.showText).toBe(true);
        expect(d.showLossSize).toBe(true);
        expect(d.showPrices).toBe(false);
        expect(d.headerLabel()).toBe('LONG  ·  R:R 2.00');
        expect(d.targetLabel()).toBe('Target +40.00%');
        expect(d.stopLabel()).toBe('Stop −20.00%');
        d.applySettings({ showPrices: true });
        expect(d.targetLabel()).toBe('Target +40.00%  @ 70.00');
        expect(d.stopLabel()).toBe('Stop −20.00%  @ 40.00');
        d.applySettings({ showText: false, showLossSize: false });
        expect(d.showText).toBe(false);
        expect(d.showLossSize).toBe(false);
    });

    it('the direction setting mirrors the stop and target across the entry (R:R preserved)', () => {
        // long: entry 50, stop 40 (risk 10), target 70 (reward 20)
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        expect(d.direction).toBe('long');
        d.applySettings({ direction: 'short' });
        expect(d.direction).toBe('short');
        expect(d.anchors[1]!.price).toBe(60); // stop mirrored above
        expect(d.anchors[2]!.price).toBe(30); // target mirrored below
        expect(d.rr()).toBeCloseTo(2, 6); // distances preserved
        d.applySettings({ direction: 'short' }); // same value → no-op
        expect(d.anchors[1]!.price).toBe(60);
        d.applySettings({ direction: 'long' });
        expect(d.anchors[1]!.price).toBe(40);
        expect(d.anchors[2]!.price).toBe(70);
    });

    it('typing a position size back-solves the risk % (size × stop distance = balance × risk%)', () => {
        // entry 50, stop 40 → distance 10; balance 10_000
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        expect(d.quantity).toBeCloseTo(10, 6); // 1% of 10k = $100 / 10
        d.applySettings({ quantity: 20 });
        expect(d.riskPercent).toBeCloseTo(2, 6); // 20 units × $10 = $200 = 2% of $10k
        expect(d.dollarLoss()).toBeCloseTo(200, 6);
        expect(d.positionSize()).toBeCloseTo(20, 6); // round-trips
        d.applySettings({ quantity: -5 }); // invalid → ignored
        expect(d.riskPercent).toBeCloseTo(2, 6);
    });

    it('stop/target convert between price and points around the entry', () => {
        // entry 50, stop 40, target 70
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        expect(d.levelDisplayValue('stop', 'price')).toBe(40);
        expect(d.levelDisplayValue('stop', 'points')).toBe(10);
        expect(d.levelDisplayValue('target', 'points')).toBe(20);
        // typed values resolve back to prices on the level's own side of the entry
        expect(d.levelPriceFromDisplay('stop', 'price', 45)).toBe(45);
        expect(d.levelPriceFromDisplay('stop', 'points', 5)).toBe(45); // stop below → entry − 5
        expect(d.levelPriceFromDisplay('target', 'points', 5)).toBe(55); // target above → entry + 5
    });

    it('per-label toggles default on and round-trip through serialize', () => {
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        expect(d.showHeader).toBe(true);
        expect(d.showTargetLabel).toBe(true);
        expect(d.showStopLabel).toBe(true);
        d.applySettings({ showHeader: false, showTargetLabel: false, showStopLabel: false });
        const round = deserializeDrawing(d.serialize())! as PositionTool;
        expect(round.showHeader).toBe(false);
        expect(round.showTargetLabel).toBe(false);
        expect(round.showStopLabel).toBe(false);
    });

    it('round-trips risk settings, display toggles, zone colors + text styling through serialize', () => {
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        expect(d.profitColor).toBe('#0ecb81');
        expect(d.lossColor).toBe('#f6465d');
        d.applySettings({
            riskPercent: 1.5,
            accountBalance: 25_000,
            showText: false,
            showPrices: true,
            showLossSize: false,
            profitColor: '#00ff00',
            lossColor: '#ff0000',
            'text.color': '#ffcc00',
            'text.size': 'large',
        });
        const a = d.serialize();
        const round = deserializeDrawing(a)! as PositionTool;
        expect(round.serialize()).toEqual(a);
        expect(round.riskPercent).toBe(1.5);
        expect(round.accountBalance).toBe(25_000);
        expect(round.showText).toBe(false);
        expect(round.showPrices).toBe(true);
        expect(round.showLossSize).toBe(false);
        expect(round.profitColor).toBe('#00ff00');
        expect(round.lossColor).toBe('#ff0000');
        expect(round.text?.color).toBe('#ffcc00');
        expect(round.text?.size).toBe('large');
        expect(a.type).toBe('position');
    });

    it('the settings schema drops bold/italic and exposes the new controls', () => {
        const d = createDrawing('position', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 5 * HR, price: 40 }, { time: 10 * HR, price: 70 }] })! as PositionTool;
        const paths = d.schema().fields.map((f) => f.path);
        expect(paths).not.toContain('text.bold');
        expect(paths).not.toContain('text.italic');
        expect(paths).toEqual(expect.arrayContaining([
            'riskPercent', 'accountBalance', 'quantity', 'direction',
            'entryPrice', 'stopPrice', 'targetPrice',
            'showText', 'showHeader', 'showPrices', 'showLossSize', 'showTargetLabel', 'showStopLabel',
            'profitColor', 'lossColor',
            'text.color', 'text.size',
        ]));
        expect(paths).not.toContain('tickSize');
    });
});

describe('formatDuration', () => {
    it('formats spans compactly', () => {
        expect(formatDuration(2 * 86400000 + 4 * HR)).toBe('2d 4h');
        expect(formatDuration(3 * HR + 15 * 60000)).toBe('3h 15m');
        expect(formatDuration(45 * 60000)).toBe('45m');
    });
});
