// A dependency-free subset of ICU MessageFormat: `{name}`, `{n, number}` (with the
// `integer` and `percent` styles), `{n, plural, …}` and `{n, selectordinal, …}` with exact
// `=N` matches, `offset:` and `#`, and `{x, select, …}`. Apostrophes quote the way ICU's
// default mode does: `''` is one apostrophe, `'{…}'` is literal text, and any other
// apostrophe is plain text (so `l'indicateur` needs no escaping). Parsed messages are
// cached by their source text.

type Options = Readonly<Record<string, Node[]>>;
type Node =
    | string
    | { readonly kind: 'arg'; readonly name: string; readonly format?: 'number'; readonly style?: string }
    | { readonly kind: 'plural'; readonly name: string; readonly ordinal: boolean; readonly offset: number; readonly options: Options }
    | { readonly kind: 'select'; readonly name: string; readonly options: Options }
    | { readonly kind: 'pound' };

/** Values a message interpolates. */
export type MessageValues = Readonly<Record<string, string | number>>;

/** What formatting a parsed message needs from its translator. */
export interface MessageRuntime {
    readonly locale: string;
    formatNumber(value: number, style?: string): string;
}

class Parser {
    private i = 0;
    constructor(private readonly src: string) {}

    parse(): Node[] {
        const nodes = this.message(false, 0);
        if (this.i < this.src.length) throw this.error('unmatched }');
        return nodes;
    }

    private error(what: string): SyntaxError {
        return new SyntaxError(`[vela] message syntax: ${what} at ${this.i} in "${this.src}"`);
    }

    /** Text and arguments up to an unmatched `}` (left unread) or the end. */
    private message(inPlural: boolean, depth: number): Node[] {
        if (depth > 8) throw this.error('nesting too deep');
        const src = this.src;
        const out: Node[] = [];
        let text = '';
        const flush = (): void => {
            if (text) out.push(text);
            text = '';
        };
        while (this.i < src.length) {
            const ch = src[this.i]!;
            if (ch === "'") {
                const next = src[this.i + 1];
                if (next === "'") {
                    text += "'";
                    this.i += 2;
                } else if (next === '{' || next === '}' || (inPlural && next === '#')) {
                    // Quoted literal: runs to the next lone apostrophe ('' inside is one).
                    this.i += 1;
                    while (this.i < src.length) {
                        const c = src[this.i]!;
                        if (c === "'") {
                            if (src[this.i + 1] === "'") {
                                text += "'";
                                this.i += 2;
                                continue;
                            }
                            this.i += 1;
                            break;
                        }
                        text += c;
                        this.i += 1;
                    }
                } else {
                    text += "'";
                    this.i += 1;
                }
            } else if (ch === '{') {
                flush();
                this.i += 1;
                out.push(this.argument(depth));
            } else if (ch === '}') {
                break;
            } else if (ch === '#' && inPlural) {
                flush();
                out.push({ kind: 'pound' });
                this.i += 1;
            } else {
                text += ch;
                this.i += 1;
            }
        }
        flush();
        return out;
    }

    private skipSpace(): void {
        while (this.i < this.src.length && /\s/.test(this.src[this.i]!)) this.i += 1;
    }

    private word(): string {
        this.skipSpace();
        const start = this.i;
        while (this.i < this.src.length && !/[\s,{}]/.test(this.src[this.i]!)) this.i += 1;
        return this.src.slice(start, this.i);
    }

    private expect(ch: string): void {
        this.skipSpace();
        if (this.src[this.i] !== ch) throw this.error(`expected "${ch}"`);
        this.i += 1;
    }

    /** After a `{`: the argument through its closing `}`. */
    private argument(depth: number): Node {
        const name = this.word();
        if (!name) throw this.error('empty argument name');
        this.skipSpace();
        if (this.src[this.i] === '}') {
            this.i += 1;
            return { kind: 'arg', name };
        }
        this.expect(',');
        const type = this.word();
        this.skipSpace();
        if (type === 'number') {
            let style: string | undefined;
            if (this.src[this.i] === ',') {
                this.i += 1;
                style = this.word() || undefined;
            }
            this.expect('}');
            return { kind: 'arg', name, format: 'number', style };
        }
        if (type === 'plural' || type === 'selectordinal' || type === 'select') {
            this.expect(',');
            let offset = 0;
            this.skipSpace();
            if (type !== 'select' && this.src.startsWith('offset:', this.i)) {
                this.i += 'offset:'.length;
                offset = Number(this.word());
                if (!Number.isFinite(offset)) throw this.error('bad offset');
            }
            const options: Record<string, Node[]> = {};
            for (;;) {
                this.skipSpace();
                if (this.src[this.i] === '}') {
                    this.i += 1;
                    break;
                }
                const key = this.word();
                if (!key) throw this.error('expected a selector');
                this.expect('{');
                options[key] = this.message(type !== 'select', depth + 1);
                this.expect('}');
            }
            if (!options.other) throw this.error(`"${name}" has no "other" option`);
            return type === 'select' ? { kind: 'select', name, options } : { kind: 'plural', name, ordinal: type === 'selectordinal', offset, options };
        }
        throw this.error(`unknown argument type "${type}"`);
    }
}

const parsed = new Map<string, Node[]>();
const PARSE_CACHE_CAP = 2000;

/** Parse a message (cached). Throws a SyntaxError on malformed input. */
export function parseMessage(source: string): Node[] {
    let nodes = parsed.get(source);
    if (!nodes) {
        nodes = new Parser(source).parse();
        if (parsed.size >= PARSE_CACHE_CAP) parsed.clear();
        parsed.set(source, nodes);
    }
    return nodes;
}

const pluralRules = new Map<string, Intl.PluralRules>();

function rulesFor(locale: string, ordinal: boolean): Intl.PluralRules {
    const key = `${locale}|${ordinal ? 'o' : 'c'}`;
    let pr = pluralRules.get(key);
    if (!pr) {
        try {
            pr = new Intl.PluralRules(locale, { type: ordinal ? 'ordinal' : 'cardinal' });
        } catch {
            pr = new Intl.PluralRules('en', { type: ordinal ? 'ordinal' : 'cardinal' });
        }
        pluralRules.set(key, pr);
    }
    return pr;
}

function render(nodes: readonly Node[], values: MessageValues | undefined, rt: MessageRuntime, pound: number | null): string {
    let out = '';
    for (const node of nodes) {
        if (typeof node === 'string') {
            out += node;
            continue;
        }
        if (node.kind === 'pound') {
            out += pound == null ? '#' : rt.formatNumber(pound);
            continue;
        }
        const raw = values?.[node.name];
        if (node.kind === 'arg') {
            if (raw === undefined) out += `{${node.name}}`;
            else if (typeof raw === 'number') out += rt.formatNumber(raw, node.format === 'number' ? node.style : undefined);
            else if (node.format === 'number' && raw.trim() !== '' && Number.isFinite(Number(raw))) out += rt.formatNumber(Number(raw), node.style);
            else out += raw;
            continue;
        }
        if (node.kind === 'select') {
            const branch = node.options[String(raw)] ?? node.options.other!;
            out += render(branch, values, rt, pound);
            continue;
        }
        const n = typeof raw === 'number' ? raw : Number(raw);
        let branch: readonly Node[] | undefined;
        if (Number.isFinite(n)) {
            branch = node.options[`=${n}`] ?? node.options[rulesFor(rt.locale, node.ordinal).select(n - node.offset)];
        }
        out += render(branch ?? node.options.other!, values, rt, Number.isFinite(n) ? n - node.offset : null);
    }
    return out;
}

/** Format a message with its values. Throws a SyntaxError on malformed input. */
export function formatMessage(source: string, values: MessageValues | undefined, rt: MessageRuntime): string {
    // Fast path: nothing to parse.
    if (source.indexOf('{') < 0 && source.indexOf("'") < 0) return source;
    return render(parseMessage(source), values, rt, null);
}
