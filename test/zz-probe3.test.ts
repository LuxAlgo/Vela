// @vitest-environment jsdom
import { describe, it, beforeAll } from 'vitest';
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe(){} unobserve(){} disconnect(){} };
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { appendFileSync } from 'node:fs';
const LOG='/private/tmp/claude-502/-Users-aaron-Documents-projects-app/76585a2c-dd68-4aa3-b79f-e848af9ec3be/scratchpad/probe3.log';
const log=(...a:unknown[])=>appendFileSync(LOG, a.join(' ')+'\n');
beforeAll(() => { Element.prototype.animate ??= (() => ({ cancel(){}, finish(){}, addEventListener(){} })) as unknown as Element['animate']; });
async function mount() {
  const host = document.createElement('div'); document.body.append(host);
  const ws = new VelaWorkspace(host, { layout: '1' } as never);
  await new Promise((r) => setTimeout(r, 800));
  return ws;
}
type Priv = { stateTimer: unknown; destroyed: boolean; cellsById: Map<string, { dehydrate(): unknown }>; pool: Map<string, unknown>; root: HTMLElement; attachmentDisposers: Map<string, unknown>; events: { emit(e: string, p: unknown): void } };

describe('PROBE3', () => {
  it('recursion depth and why', async () => {
    const ws = await mount(); const p = ws as unknown as Priv;
    let depth = 0, max = 0;
    ws.on('state:changed', () => { depth++; max = Math.max(max, depth); if (depth < 5000) ws.destroy(); depth--; });
    ws.setTimezone('Europe/Paris');
    let err: unknown = null;
    try { ws.destroy(); } catch (e) { err = e; }
    log('MAX RECURSION DEPTH =', max, 'outer threw:', String(err));
  });

  it('dehydrate throws — instance own-prop override', async () => {
    const ws = await mount(); const p = ws as unknown as Priv;
    for (const c of p.cellsById.values()) { Object.defineProperty(c, 'dehydrate', { value: () => { throw new Error('boom'); }, configurable: true }); }
    log('cells before:', p.cellsById.size);
    let err: unknown = null;
    try { ws.destroy(); } catch (e) { err = e; }
    log('destroy threw:', String(err));
    log('destroyed=', p.destroyed, 'cellsLeft=', p.cellsById.size, 'rootInDom=', document.body.contains(p.root), 'disposers=', p.attachmentDisposers.size);
    let err2: unknown = null;
    try { ws.destroy(); } catch (e) { err2 = e; }
    log('second destroy:', String(err2), 'cellsLeft=', p.cellsById.size, 'rootInDom=', document.body.contains(p.root));
  });

  it('orphaned timer fires after destroy — does it touch dead state?', async () => {
    const ws = await mount(); const p = ws as unknown as Priv;
    let emits = 0; const errs: string[] = [];
    const oe = console.error; console.error = (...a: unknown[]) => errs.push(String(a[0]) + ' ' + String(a[1]));
    ws.on('state:changed', () => { emits++; if (emits === 1) ws.setTimezone('UTC'); });
    ws.setTimezone('Europe/Paris');
    ws.destroy();
    log('right after destroy: stateTimer=', String(p.stateTimer), 'emits=', emits);
    await new Promise((r) => setTimeout(r, 900));
    console.error = oe;
    log('after 900ms: emits=', emits, 'errors=', JSON.stringify(errs).slice(0, 600));
    log('NOTE events.clear() ran in destroy, so the emit hits nobody; but persistNow guard?');
  });

  it('persist mode: how many writes on destroy', async () => {
    const writes: string[] = [];
    const storage = { get: async () => null, set: (k: string, v: string) => { writes.push(k + ':' + v.length); }, remove: async () => {} };
    const host = document.createElement('div'); document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1', persist: 'probe-key', storage } as never);
    await new Promise((r) => setTimeout(r, 900));
    const p = ws as unknown as Priv;
    writes.length = 0;
    ws.on('state:changed', () => { log('  handler sees writes so far:', writes.length); });
    ws.setTimezone('Europe/Paris');
    log('writes before destroy:', writes.length);
    ws.destroy();
    log('writes after destroy:', writes.length, JSON.stringify(writes));
  });
});
