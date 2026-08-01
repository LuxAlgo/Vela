// KeymapManager — the central, descriptor-based shortcut system. Bindings are DATA
// (consistent with the plugin contribution model): declarative descriptors with ids,
// human labels (queryable for a shortcuts help panel), scopes, and rebindable keys.
// Plugins register through the same API (e.g. a Pro overlay binding a modifier chord).
//
// Key strings: `'mod+shift+k'`, `'alt'`, `'arrowleft'`, `'ctrl+='`, `'f2'`, `'space'`.
//   • `mod` = ⌘ on macOS, Ctrl elsewhere (normalized per platform at match time).
//   • Order-insensitive modifiers; the final token is the key (`KeyboardEvent.key`,
//     lowercased; aliases: esc/space/plus/minus).
// Scopes: a stack (`pushScope`/`popScope`). A binding fires when its scope is the TOP of
// the stack, or always when its scope is `'global'`. Opening a dialog pushes `'dialog'`
// and thereby mutes `'chart'` bindings without unregistering anything.

export interface KeyBindingDescriptor {
    /** Stable id, e.g. `'chart.toggle-log-scale'`. Re-registering an id replaces it. */
    id: string;
    /** Default chord(s). Users can `rebind()` without touching the descriptor. */
    keys: string | string[];
    /** Human label for the shortcuts help panel. */
    label: string;
    /** Help-panel grouping, e.g. `'Chart'`, `'Drawings'`. */
    category?: string;
    /** `'global'` fires in ANY scope; anything else only while it is the top scope. Default `'chart'`. */
    scope?: string;
    /** Extra runtime gate evaluated at match time. */
    when?: () => boolean;
    /** Fire even while an input/textarea/contenteditable has focus (default false). */
    allowInInput?: boolean;
    /** preventDefault + stopPropagation on match (default true). */
    preventDefault?: boolean;
    run: (ev: KeyboardEvent) => void;
}

export interface ResolvedBinding {
    readonly id: string;
    readonly label: string;
    readonly category: string;
    readonly scope: string;
    /** Active chords (custom rebinds if present, else descriptor defaults). */
    readonly keys: readonly string[];
    /** Display form per platform, e.g. `'⌘⇧K'` (mac) / `'Ctrl+Shift+K'`. */
    readonly display: readonly string[];
}

interface Chord {
    ctrl: boolean;
    meta: boolean;
    alt: boolean;
    shift: boolean;
    key: string;
}

const KEY_ALIASES: Record<string, string> = {
    esc: 'escape',
    space: ' ',
    plus: '+',
    minus: '-',
    del: 'delete',
    return: 'enter',
    left: 'arrowleft',
    right: 'arrowright',
    up: 'arrowup',
    down: 'arrowdown',
};

const MAC_GLYPHS = { meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' } as const;

function parseChord(spec: string, mac: boolean): Chord {
    const parts = spec
        .toLowerCase()
        .split('+')
        .map((p) => p.trim())
        .filter((p, i, a) => p !== '' || a[i - 1] === ''); // keep one '' from 'ctrl++' → key '+'
    const chord: Chord = { ctrl: false, meta: false, alt: false, shift: false, key: '' };
    for (const raw of parts) {
        const p = raw === '' ? '+' : raw;
        if (p === 'mod') (mac ? (chord.meta = true) : (chord.ctrl = true));
        else if (p === 'ctrl' || p === 'control') chord.ctrl = true;
        else if (p === 'meta' || p === 'cmd' || p === 'command') chord.meta = true;
        else if (p === 'alt' || p === 'option') chord.alt = true;
        else if (p === 'shift') chord.shift = true;
        else chord.key = KEY_ALIASES[p] ?? p;
    }
    return chord;
}

function eventMatches(ev: KeyboardEvent, c: Chord): boolean {
    return (
        ev.ctrlKey === c.ctrl &&
        ev.metaKey === c.meta &&
        ev.altKey === c.alt &&
        // Shift is part of producing many printable keys ('?', '+') — only enforce it
        // when the chord names a non-printable/letter key where shift is a real modifier.
        (c.key.length > 1 || /^[a-z0-9 ]$/.test(c.key) ? ev.shiftKey === c.shift : true) &&
        ev.key.toLowerCase() === c.key
    );
}

/**
 * Whether a keystroke is being TYPED somewhere, in which case the chart's single-letter
 * shortcuts must not fire. Three signals, because "a thing that accepts text" has three
 * spellings on the platform: a form control, a contenteditable, and — since the
 * EditContext API — a plain element that merely declares `role="textbox"`. Modern code
 * editors (Monaco among them) use exactly that third form: no `<textarea>`, no
 * `contenteditable`, so recognising only the first two silently turns every letter the
 * user types into a chart shortcut.
 */
export function isEditableTarget(ev: KeyboardEvent): boolean {
    const t = ev.target as Partial<HTMLElement> | null;
    if (!t || typeof t !== 'object') return false;
    const tag = (t.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (t.isContentEditable === true) return true;
    return (typeof t.getAttribute === 'function' ? t.getAttribute('role') : null) === 'textbox';
}

function displayChord(spec: string, mac: boolean): string {
    const c = parseChord(spec, mac);
    const keyLabel =
        c.key === ' ' ? 'Space' : c.key.length === 1 ? c.key.toUpperCase() : c.key.charAt(0).toUpperCase() + c.key.slice(1);
    if (mac) {
        return (
            (c.ctrl ? MAC_GLYPHS.ctrl : '') +
            (c.alt ? MAC_GLYPHS.alt : '') +
            (c.shift ? MAC_GLYPHS.shift : '') +
            (c.meta ? MAC_GLYPHS.meta : '') +
            keyLabel
        );
    }
    const mods = [c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', c.meta && 'Win'].filter(Boolean);
    return [...mods, keyLabel].join('+');
}

export interface KeymapOptions {
    /** Force the platform (default: sniffed from `navigator.platform`). */
    platform?: 'mac' | 'other';
    /** The scope active when the stack is empty. Default `'chart'`. */
    baseScope?: string;
}

export class KeymapManager {
    private readonly mac: boolean;
    private readonly baseScope: string;
    private readonly descriptors = new Map<string, KeyBindingDescriptor>();
    private readonly rebinds = new Map<string, string[]>();
    private readonly scopeStack: string[] = [];
    private target: EventTarget | null = null;
    private readonly onKeydown = (ev: Event): void => {
        this.handleKeydown(ev as KeyboardEvent);
    };

    constructor(opts: KeymapOptions = {}) {
        this.mac =
            opts.platform !== undefined
                ? opts.platform === 'mac'
                : typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform ?? '');
        this.baseScope = opts.baseScope ?? 'chart';
    }

    /** Register (or replace, by id) a binding. Returns a disposer. */
    register(desc: KeyBindingDescriptor): () => void {
        this.descriptors.set(desc.id, desc);
        return () => {
            if (this.descriptors.get(desc.id) === desc) this.descriptors.delete(desc.id);
        };
    }

    unregister(id: string): void {
        this.descriptors.delete(id);
        this.rebinds.delete(id);
    }

    /** User-level rebinding: overrides the descriptor's default chords (null resets). */
    rebind(id: string, keys: string | string[] | null): void {
        if (keys === null) this.rebinds.delete(id);
        else this.rebinds.set(id, Array.isArray(keys) ? [...keys] : [keys]);
    }

    /** Snapshot for a shortcuts help panel / rebinding UI. */
    bindings(): ResolvedBinding[] {
        return [...this.descriptors.values()].map((d) => {
            const keys = this.activeKeys(d);
            return {
                id: d.id,
                label: d.label,
                category: d.category ?? 'General',
                scope: d.scope ?? this.baseScope,
                keys,
                display: keys.map((k) => displayChord(k, this.mac)),
            };
        });
    }

    pushScope(scope: string): () => void {
        this.scopeStack.push(scope);
        return () => this.popScope(scope);
    }

    /** Pops the TOPMOST occurrence of `scope` (tolerates out-of-order teardown). */
    popScope(scope: string): void {
        const i = this.scopeStack.lastIndexOf(scope);
        if (i >= 0) this.scopeStack.splice(i, 1);
    }

    get activeScope(): string {
        return this.scopeStack[this.scopeStack.length - 1] ?? this.baseScope;
    }

    attach(target: EventTarget): void {
        this.detach();
        this.target = target;
        target.addEventListener('keydown', this.onKeydown);
    }

    detach(): void {
        this.target?.removeEventListener('keydown', this.onKeydown);
        this.target = null;
    }

    /** The matcher — public so hosts/tests can feed events from their own listeners. */
    handleKeydown(ev: KeyboardEvent): boolean {
        const editable = isEditableTarget(ev);
        for (const d of this.descriptors.values()) {
            const scope = d.scope ?? this.baseScope;
            if (scope !== 'global' && scope !== this.activeScope) continue;
            if (editable && !d.allowInInput) continue;
            if (d.when && !d.when()) continue;
            for (const spec of this.activeKeys(d)) {
                if (eventMatches(ev, parseChord(spec, this.mac))) {
                    if (d.preventDefault !== false) {
                        ev.preventDefault?.();
                        ev.stopPropagation?.();
                    }
                    d.run(ev);
                    return true;
                }
            }
        }
        return false;
    }

    destroy(): void {
        this.detach();
        this.descriptors.clear();
        this.rebinds.clear();
        this.scopeStack.length = 0;
    }

    private activeKeys(d: KeyBindingDescriptor): string[] {
        return this.rebinds.get(d.id) ?? (Array.isArray(d.keys) ? d.keys : [d.keys]);
    }
}
