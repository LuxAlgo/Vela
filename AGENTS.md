# Agent Guide

Working guide for an AI agent contributing to Vela: how to analyze requests, implement,
test, verify, and prevent regressions. Throughout this file, **"the user"** means the
human directing the work.

Vela is an open-source charting library: a headless core, a native renderer, swappable
data providers and scripting engines, a vanilla UI kit, a batteries-included widget, and
a public plugin SDK. Much of its behavior is visual and runtime — it can only be _truly_
confirmed by running it, not by reading code. The method below is built around that
reality.

---

## Before you start

1. **Scratchpad.** Make sure a `.scratchpad/` folder exists at the repo root and is
   listed in `.gitignore`. It is yours — temporary data, notes, throwaway scripts,
   captured output, screenshots. It is **local and internal**: never reference it from
   repo code, tests, or docs.

2. **Browser capability.** Confirm you can drive and inspect a real browser (e.g. a
   Playwright tool) before starting. Most Vela features can only be verified for real in
   a browser. If you cannot, you can still work — but tell the user up front that your
   verification is weaker and some bugs may slip through.

3. **Scope.** Keep changes within this repo. Reading neighboring code is fine; do not
   modify anything outside it without the user's explicit permission.

---

## The working loop

For anything beyond a trivial edit:

1. **Understand before touching code.** Restate the goal, then read the _actual_ code it
   touches — the relevant ports, the composition root (`src/Vela.ts`), the lint/boundary
   config — instead of assuming. The output of this step is _where_ the change belongs
   and _what the real decisions are_.

2. **Settle the open decisions before implementing.** Research first, form a view,
   propose with a clear recommendation, and let the user confirm or redirect. Don't
   over-ask: pick sensible defaults for obvious choices and state them. Ask before
   implementing, not during.

3. **Sequence so the risky part is isolated and proven first.** If a change needs a
   refactor of working code _plus_ new code on top, land and gate the refactor on its
   own first.

4. **Make the smallest correct change at the right seam**, matching the surrounding
   code's style and conventions. Don't duplicate logic that exists nearby — extend it.

5. **Gate it** (see _The gate_).

6. **Prove it in the real runtime** (see _Testing and verification_).

7. **Diagnose root causes; distrust the happy path — including your own output.** Prove
   a bug's cause (capture, log, reproduce) before fixing it. Re-check what you produced
   adversarially, as if someone else wrote it.

8. **Present, don't commit.** Implement → gate → verify → present → wait for explicit
   approval before committing.

---

## The gate

A change is not done until **four checks pass together** — each catches a different
class of problem:

- `npm run typecheck` — the types line up.
- `npm run lint` — the architecture boundaries hold. Treat a boundary failure as a real
  design violation, not a style nit.
- `npm run test` — behavior did not regress, **plus a targeted test for any new
  behavior**.
- `npm run build` — it still packages (all entries, including type declarations).

None of the four is optional. Passing three and failing the fourth is not finished.

---

## Testing and verification

**Never assume code works. Always test.** Reach for the cheapest tool that can actually
prove the thing:

- **Unit tests** for pure logic and port contracts. The dependency-injection seams let
  you drive the system with fake renderers, fake providers, and fake engines — use them.
- **Throwaway scripts in `.scratchpad/`** for experiments and captured output.
- **The browser for anything visual or interactive.** `npm run playground` serves
  `playground/` on `http://localhost:5190` with Vela imported **straight from `src/`**
  (vite, HMR — no build step): edits are live on save, so you always exercise fresh
  code. What you verify there is the real renderer, the real widget chrome, the real
  event paths.

Two verification rules that earn their keep:

- **Positive proofs, not green gates.** A green suite proves nothing about a NEW
  capability. Every feature needs a check that would _fail if the feature were absent_ —
  a targeted test, or a browser probe that exercises it end to end.
- **Probe computed reality, not presence.** A browser probe must assert what the user
  would actually see: computed visibility (`display`, `backgroundColor` resolved inside
  the themed host, a non-empty bounding rect), real clicks through the UI, actual
  counts changing. An element that exists but portals outside the theme variables, or a
  `[data-state=open]` that renders transparent, passes lazy probes and fails users.

When browser-testing, try real/live data first (Binance public API needs no key). If the
network is unavailable, provider failures are environmental, not bugs.

---

## Verify for real — never assert it

If you tell the user something is **fixed**, **verified**, or **works**, you must have
**actually executed** the check that proves it:

- **Test the surface the user actually uses**, through the same entry point they use.
- **Calibrate the claim to what you ran** — say what you tested and what you did not.
  Never round "should work" up to "works."
- **Re-run the user's exact scenario and watch it pass** before reporting a bug fixed.
- If you genuinely cannot run the check, say so and mark the result **unverified**.

---

## Reproducing reported issues

1. **Reproduce it first.** Do not fix what you cannot reproduce.
2. **If it reproduces in a unit test, write the failing test _before_ fixing.** The fix
   is done when that test passes and the rest of the gate stays green.
3. If it only reproduces in the browser, reproduce it there, fix it, and re-verify
   there.

---

## Code ground rules

These are the load-bearing conventions of this codebase. The eslint config enforces some
mechanically; the rest are reviewed by hand.

**Architecture boundaries.**

- The **core is headless and environment-agnostic**: no `window`/`history`/`location`
  assumptions outside the renderer and widget layers. Browser glue (URL state,
  persistence, keyboard) belongs to the widget.
- **`pinets` is quarantined** in `src/engines/pinets/` (the lint ACL enforces it) and
  stays an **optional peer dependency** in the library builds.
- The **UI kit (`src/ui`) never imports engine internals; the core never imports the
  kit.** The widget composes both from above.
- One chart = one market + one time axis. Panes inside a chart share the X axis — that
  invariant is the renderer's foundation; don't bend it.

**Extend through the public seams, never by forking internals.** Chart types
(`registerChartType`), renderer layers (`registerRendererLayer`), native indicators,
widget actions (`registerWidgetAction`), and host settings sections exist precisely so
features can live outside the core. If a change seems to need a new hole in a layer,
that's a design decision to raise with the user, not a shortcut to take.

**Contributions are data descriptors, never DOM.** And inside a contribution's
`run`/`when`, **everything comes from the `WidgetContext` argument** — never close over
an outer widget/chart reference; the context is rebuilt per invocation and is what keeps
descriptors working when multiple charts exist.

**UI kit rules (hard-won).**

- Kit components built before their trigger is in the DOM need an **explicit `host`** —
  the `closest()` fallback silently portals to `<body>`, outside the theme variables.
- Any authored `display` on a component's root defeats the `[hidden]` UA rule — pair it
  with `[hidden] { display: none !important; }`.
- New components follow the uniform skeleton (`controller.ts` + `view.ts` + `styles.css`
  + `index.ts`) documented in `docs/contributing/adding-a-ui-component.md`.

**Style and prose.**

- **Everything in the repo is English** — code, comments, commits, docs — regardless of
  the conversation language.
- **Never name other charting products in code, comments, or commit messages.** Describe
  features by their own behavior, not by whose product they resemble.
- Comments state constraints the code can't show. No "what the next line does," no
  review narration.
- Match the surrounding code's naming, comment density, and idiom.

**Licensing and attribution.**

- The repo is Apache-2.0 with a **NOTICE-based attribution requirement**: the in-chart
  attribution mark defaults to on, and any example or doc that disables it must mention
  the equivalent-notice obligation. Don't weaken either side casually.

---

## Keep the documentation in sync

Role-based documentation lives in `docs/` (user guides, architecture, contributing).
When a change touches a developer-facing interface or adds a feature, check whether
`docs/` still matches reality. If it has drifted, **tell the user what is stale and ask
whether to update it** — a natural moment is when a change is ready to commit. Verify
prose consistency yourself (terminology, cross-links); there is no compiler for docs.

---

## The changelog

`CHANGELOG.md` is written for the person **using** the product, not the developer
reading the diff. When user-visible work lands, add its entry under the upcoming
version's heading in the same change (the changelog is part of the feature, not an
afterthought). Follow the house format exactly:

- **Structure.** Newest first; `## [vX.Y.Z]` sections; `### Added` / `### Changed` /
  `### Fixed` subsections in that order, each present only when non-empty.
- **Entry shape.** `- **Bold, feature-first lead.** ` followed by short prose that
  explains what the reader can now do and how it behaves — full sentences, concrete,
  calm. One entry per feature: merge related sub-features into one narrative entry
  instead of scattering micro-bullets.
- **High level only.** No internal identifiers, module paths, event names, or
  architecture vocabulary. Public names the user actually types (`VelaWorkspace`, an
  option name) are fine; how it works inside is not. If a sentence only makes sense to
  someone who read the source, rewrite it.
- **What goes where.** `Added` = new capabilities. `Changed` = behavior a v-1 user will
  notice, with breaking changes flagged inline as `_(Breaking: what changed and what to
  do instead.)_`. `Fixed` = bugs that existed in a **released** version only — a bug
  introduced and fixed within the same unreleased cycle gets no entry.
- **What stays out.** Internal refactors, tests/probes, CI, playground-only tweaks with
  no user-visible effect, and anything that lives in a private extension package.
- **Prose rules apply.** English, never name other charting products, and keep the
  restrained tone of the existing entries — read a few before writing yours.

---

## Commit discipline

- Present the change and **wait for the user's review and approval before committing**.
- Use **targeted `git add`**; never commit build artifacts, `.scratchpad/`, or unrelated
  changes.
- Keep commit messages user-readable, in English, and free of other products' names.

---

**In short:** read first, surface the real decisions up front, change the smallest
correct thing at the right seam, gate it four ways, prove it in the playground with
probes that assert what users actually see, distrust the happy path (and your own
output), and hand it to the user to review. The two habits that do the most work are the
**four-way gate** and **positive proofs in a real browser**.
