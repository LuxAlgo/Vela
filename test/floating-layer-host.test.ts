// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { floatingLayerHost } from '../src/ui/tokens';

describe('floatingLayerHost', () => {
    it('mounts on the nearest .vela-ui so menus inherit the app theme, not a plot-overlay cell', () => {
        const ui = document.createElement('div');
        ui.className = 'vela-ui';
        const cell = document.createElement('div');
        cell.className = 'vela-cell';
        ui.appendChild(cell);
        document.body.appendChild(ui);
        expect(floatingLayerHost(cell, document.body)).toBe(ui);
        ui.remove();
    });

    it('returns the kit host itself when that is the starting node', () => {
        const ui = document.createElement('div');
        ui.className = 'vela-ui';
        document.body.appendChild(ui);
        expect(floatingLayerHost(ui, document.body)).toBe(ui);
        ui.remove();
    });

    it('falls back when no kit host is an ancestor', () => {
        const orphan = document.createElement('div');
        document.body.appendChild(orphan);
        expect(floatingLayerHost(orphan, document.body)).toBe(document.body);
        orphan.remove();
    });
});
