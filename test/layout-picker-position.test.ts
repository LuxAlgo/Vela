// @vitest-environment jsdom
// The layout picker opens centered under its toolbar button, and stays inside the host
// when the button sits near either edge.
import { describe, it, expect, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { LayoutPicker } from '../src/widget/layout-picker';

const HOST_WIDTH = 800;
const PICKER_WIDTH = 300;
const BUTTON_WIDTH = 34;

afterEach(() => {
    document.body.replaceChildren();
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
    return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

/** Open the picker from a button whose left edge is at `buttonLeft`; return the layer's CSS left. */
function openFrom(buttonLeft: number): number {
    const host = document.createElement('div');
    host.className = 'vela-ui';
    document.body.append(host);
    const trigger = document.createElement('button');
    host.append(trigger);
    host.getBoundingClientRect = () => rect(0, 0, HOST_WIDTH, 600);
    trigger.getBoundingClientRect = () => rect(buttonLeft, 4, BUTTON_WIDTH, 30);
    const picker = new LayoutPicker({
        trigger,
        host,
        shape: () => ({ rows: 1, cols: 1 }),
        presets: () => [],
        onSelectGrid: () => {},
        onSelectPreset: () => {},
        syncs: () => [],
        onToggleSync: () => {},
    });
    const layer = host.querySelector<HTMLElement>('.vela-lp-layer')!;
    Object.defineProperty(layer, 'offsetWidth', { get: () => PICKER_WIDTH });
    picker.open();
    const left = parseFloat(layer.style.left);
    picker.destroy();
    return left;
}

describe('layout picker position', () => {
    it('opens centered under its button', () => {
        const left = openFrom(300);
        expect(left + PICKER_WIDTH / 2).toBe(300 + BUTTON_WIDTH / 2);
    });

    it('stays inside the left edge when its button sits there', () => {
        expect(openFrom(2)).toBe(8);
    });

    it('stays inside the right edge when its button sits there', () => {
        expect(openFrom(HOST_WIDTH - BUTTON_WIDTH - 2)).toBe(HOST_WIDTH - 8 - PICKER_WIDTH);
    });
});
