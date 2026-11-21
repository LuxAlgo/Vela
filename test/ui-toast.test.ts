// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToaster, toast, type ToasterHandle } from '@luxalgo/vela-ui/toast';

const items = (toaster: ToasterHandle): HTMLElement[] => [...toaster.el.querySelectorAll<HTMLElement>("[data-slot='toast-item']:not([data-removed])")];
const titles = (toaster: ToasterHandle): string[] => items(toaster).map((li) => li.querySelector("[data-slot='toast-title']")?.textContent ?? '');

describe('toast', () => {
    let toaster: ToasterHandle;

    beforeEach(() => {
        vi.useFakeTimers();
        toaster = createToaster();
    });

    afterEach(() => {
        toast.dismiss();
        toaster.destroy();
        vi.useRealTimers();
    });

    it('shows each kind with its title, description and icon, newest first', () => {
        toast('Plain');
        toast.success('Saved', { description: 'Layout saved' });
        const [front, back] = items(toaster);
        expect(titles(toaster)).toEqual(['Saved', 'Plain']);
        expect(front!.dataset.type).toBe('success');
        expect(front!.querySelector("[data-slot='toast-description']")?.textContent).toBe('Layout saved');
        expect(front!.querySelector("[data-slot='toast-icon']")).not.toBeNull();
        expect(back!.querySelector("[data-slot='toast-icon']")).toBeNull();
        expect(front!.dataset.front).toBe('true');
        expect(back!.dataset.front).toBe('false');
    });

    it('updates a toast in place when raised again with its id', () => {
        const id = toast.loading('Saving…');
        expect(items(toaster)[0]!.dataset.type).toBe('loading');
        toast.success('Saved', { id });
        expect(items(toaster)).toHaveLength(1);
        expect(items(toaster)[0]!.dataset.type).toBe('success');
        expect(titles(toaster)).toEqual(['Saved']);
    });

    it('closes after its duration, and a loading toast stays', () => {
        const onAutoClose = vi.fn();
        toast('Brief', { duration: 1000, onAutoClose });
        toast.loading('Working');
        vi.advanceTimersByTime(999);
        expect(titles(toaster)).toEqual(['Working', 'Brief']);
        vi.advanceTimersByTime(1);
        expect(titles(toaster)).toEqual(['Working']);
        expect(onAutoClose).toHaveBeenCalledOnce();
    });

    it('closes on an action unless the handler prevents it, and always on cancel', () => {
        const onDismiss = vi.fn();
        toast('Keep', { action: { label: 'Stay', onClick: (e) => e.preventDefault() } });
        toast('Go', { onDismiss, cancel: { label: 'Cancel', onClick: () => undefined } });
        (items(toaster)[0]!.querySelector("[data-slot='toast-cancel']") as HTMLButtonElement).click();
        expect(onDismiss).toHaveBeenCalledOnce();
        (items(toaster)[0]!.querySelector("[data-slot='toast-action']") as HTMLButtonElement).click();
        expect(titles(toaster)).toEqual(['Keep']);
    });

    it('turns a promise into its loading, then its result', async () => {
        let settle!: (v: string) => void;
        const p = new Promise<string>((ok) => (settle = ok));
        toast.promise(p, { loading: 'Loading', success: (name) => `${name} loaded`, error: 'Failed' });
        expect(items(toaster)[0]!.dataset.type).toBe('loading');
        settle('BTCUSDT');
        await p;
        await Promise.resolve();
        expect(items(toaster)[0]!.dataset.type).toBe('success');
        expect(titles(toaster)).toEqual(['BTCUSDT loaded']);
    });

    it('shows a named toaster only the toasts raised for it', () => {
        const named = createToaster({ id: 'side' });
        toast('Everywhere');
        toast('Side only', { toasterId: 'side' });
        expect(titles(toaster)).toEqual(['Everywhere']);
        expect(titles(named)).toEqual(['Side only']);
        named.destroy();
    });

    it('dismisses one toast or all of them', () => {
        const a = toast('A');
        toast('B');
        toast.dismiss(a);
        expect(titles(toaster)).toEqual(['B']);
        toast.dismiss();
        expect(items(toaster)).toHaveLength(0);
        expect(toast.getToasts()).toHaveLength(0);
    });

    it('stacks in its corner, a close button and rich colors on request', () => {
        toaster.destroy();
        toaster = createToaster({ position: 'top-center', closeButton: true, richColors: true });
        toast.error('Failed');
        const list = toaster.el.querySelector<HTMLElement>("[data-slot='toast-list']")!;
        expect(list.dataset.y).toBe('top');
        expect(list.dataset.x).toBe('center');
        const li = items(toaster)[0]!;
        expect(li.hasAttribute('data-rich-colors')).toBe(true);
        expect(li.querySelector("[data-slot='toast-close']")?.getAttribute('aria-label')).toBe('Close toast');
        expect(toaster.el.getAttribute('aria-label')).toBe('Notifications');
        expect(toaster.el.getAttribute('aria-keyshortcuts')).toBe('Alt+T');
    });
});
