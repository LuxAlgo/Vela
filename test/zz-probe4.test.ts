// @vitest-environment jsdom
import { describe, it, beforeAll } from 'vitest';
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe(){} unobserve(){} disconnect(){} };
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { appendFileSync } from 'node:fs';
const LOG='/private/tmp/claude-502/-Users-aaron-Documents-projects-app/76585a2c-dd68-4aa3-b79f-e848af9ec3be/scratchpad/probe4.log';
const log=(...a:unknown[])=>appendFileSync(LOG, a.join(' ')+'\n');
beforeAll(() => { Element.prototype.animate ??= (() => ({ cancel(){}, finish(){}, addEventListener(){} })) as unknown as Element['animate']; });
async function mount(layout='2h') {
  const host = document.createElement('div'); document.body.append(host);
  const ws = new VelaWorkspace(host, { layout } as never);
  await new Promise((r) => setTimeout(r, 800));
  return ws;
}
type Priv = { stateTimer: unknown; destroyed: boolean; cellsById: Map<string, { dehydrate(): unknown }>; pool: Map<string, unknown>; root: HTMLElement; attachmentDisposers: Map<string, unknown> };

describe('PROBE4', () => {
  it('dehydrate throw mid loop with 2 cells', async () => {
    let ws; try { ws = await mount('2h'); } catch { ws = await mount('1'); }
    const p = ws as unknown as Priv;
    log('cells:', p.cellsById.size, [...p.cellsById.keys()].join(','));
    const first = [...p.cellsById.values()][0]!;
    (first as unknown as Record<string, unknown>).dehydrate = () => { throw new Error('boom'); };
    log('override applied? ', typeof (first as unknown as Record<string, unknown>).dehydrate);
    let err: unknown = null;
    try { ws.destroy(); } catch (e) { err = e; }
    log('destroy threw:', err instanceof Error ? err.message : String(err));
    log('destroyed=', p.destroyed, 'cellsLeft=', p.cellsById.size, 'rootInDom=', document.body.contains(p.root), 'disposers=', p.attachmentDisposers.size, 'pool=', p.pool.size);
  });

  it('ORPHANED TIMER: handler dirties, check timer at end of destroy', async () => {
    const ws = await mount('1'); const p = ws as unknown as Priv;
    let n = 0;
    ws.on('state:changed', () => { n++; if (n === 1) { ws.setTimezone('UTC'); log('  in-handler stateTimer=', String(p.stateTimer)); } });
    ws.setTimezone('Europe/Paris');
    ws.destroy();
    log('END-OF-DESTROY stateTimer=', String(p.stateTimer), 'destroyed=', p.destroyed);
    await new Promise((r) => setTimeout(r, 900));
    log('post-fire emits=', n);
  });

  it('handler calls removeCell/addCell mid-flush', async () => {
    const ws = await mount('1'); const p = ws as unknown as Priv;
    let e: string | null = null;
    ws.on('state:changed', () => { try { (ws as unknown as { removeCell?: (id:string)=>void }).removeCell?.([...p.cellsById.keys()][0]!); } catch (err) { e = String(err); } });
    ws.setTimezone('Europe/Paris');
    let outer: unknown = null;
    try { ws.destroy(); } catch (err) { outer = err; }
    log('removeCell-in-handler err=', String(e), 'outer=', String(outer), 'cells=', p.cellsById.size, 'rootInDom=', document.body.contains(p.root));
  });
});
