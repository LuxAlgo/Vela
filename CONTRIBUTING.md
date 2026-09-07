# Contributing to Vela™

Thank you for considering a contribution to Vela™. Whether you fix a bug, add a drawing
tool, improve a provider, or clarify the docs, your help is appreciated.

This page tells you how to contribute so your work lands quickly. The most important
rule is also the shortest one: **one pull request does one thing.**

## Table of contents

- [Code of conduct](#code-of-conduct)
- [How can I contribute?](#how-can-i-contribute)
- [Pull request guidelines](#pull-request-guidelines)
- [Development workflow](#development-workflow)
- [Testing requirements](#testing-requirements)
- [Code style](#code-style)
- [Changelog](#changelog)
- [License and CLA](#license-and-cla)
- [Getting help](#getting-help)

---

## Code of conduct

Be respectful and constructive. Assume good faith, critique the code rather than the
person, and keep the discussion focused on making the library better. Maintainers may
close or lock threads that do not follow this rule.

---

## How can I contribute?

### Report a bug

Open an issue with the **Report a bug** template. Before you do,
search the existing issues to avoid duplicates. A useful report includes:

- what you expected and what happened instead
- reproduction steps: a list of steps to reproduce issues. StackBlitz / CodeSandbox link, images or videos are welcome to illustrate the issue
- your environment: `@luxalgo/vela` version, the scripting-engine addon and its version
  if one is involved, browser and OS, and whether the chart runs on WebGL2 or the
  canvas2d fallback.

Consider opening an issue first for bugs instead of making a PR.

### Request a feature

Open an issue with the **Feature request** template. For
anything beyond a small addition, open the issue **before** you write code, see
[Design-first changes](#design-first-changes) below. Agreeing on the shape up front keeps
you from building something that cannot be merged.

### Share feedback

Use the **Community feedback** issue template for feedback about the project itself:
the contribution process, the templates, the documentation experience, or the community.

---

## Pull request guidelines

### One PR, one feature

A pull request should contain exactly one logical change: one bug fix, one feature, 
one refactor, or one documentation update.

Focused PRs are reviewed faster, bisect cleanly when something regresses, produce an
honest changelog entry, and can be reverted on their own. Large or mixed PRs stall:
reviewers cannot hold them in their head, one contested part blocks the rest, and a
revert takes unrelated work down with it.

A simple test: **if the PR title needs the word "and", split it.**

#### Good PRs

- **One bug fix.** "Fix crosshair price label clipping at the right edge of the pane."
- **One feature.** "Add a Fibonacci wedge drawing tool." / "Add `listSymbols` filtering
  to the Coinbase provider."
- **One refactor, on its own.** "Extract shared axis-label formatting into a helper", 
  with no behavior change, so the diff can be checked mechanically.
- **One documentation update.** "Document the `persist` option in the workspace guide."

#### PRs that will be sent back to split

- A bug fix plus a new feature plus a drive-by refactor in one diff.
- A new drawing tool bundled with a redesign of the drawing toolbar.
- A change that touches a data provider, the renderer, and the widget for unrelated
  reasons.
- A "various fixes" PR with several independent fixes. Open one PR per fix, even if each
  is only a few lines.
- A "feature dump" of many new indicators or tools in one PR. Land them one at a time.

#### When a feature needs groundwork first

If the feature you want needs a refactor of existing code before it fits, **land the
refactor as its own PR first**, gate it, and then open the feature PR on top. The
refactor is reviewed for "same behavior, better shape"; the feature is reviewed for
"new behavior, correct". Mixing the two makes both reviews harder.

Stacked PRs are welcome, mention the dependency in the description ("Builds on #123").

#### Size

There is no hard line limit, but a PR a reviewer can read in one sitting merges in one
round. If your change is large because the feature is large, say so in the description
and explain how the diff is organized. If it is large because it does several things,
split it.

### Design-first changes

Some changes need agreement on the design before code. **Open an issue first** when your
change:

- adds or changes a **public option, method, or type**, every Vela consumer sees it,
  and it has semver consequences;
- adds or reshapes a **port** (`DataProvider` / `MarketDataFeed`, `ScriptingEngine`,
  `IChartRenderer`) or a **plugin SDK** registry;
- **crosses an architecture boundary**, the lint import rules are the architecture,
  and a boundary failure is a design question, not a style nit;
- adds a **runtime dependency**;
- adds a new **renderer backend** or a new **scripting engine** to this repo (engines
  live in separate packages; see [License and CLA](#license-and-cla)).

Describe the use case, the seam you intend to use, and what stays out of the core.
Prefer extending Vela through its **public seams**, chart types, renderer layers,
native indicators, widget actions, settings sections, over adding a new hole in a
layer. If you believe a new seam is needed, propose it as a neutral, general-purpose
surface, not one shaped for a single feature.

### PR checklist

Before you mark the PR ready for review, make sure that:

- [ ] the PR does **one thing**, and the title says what it is;
- [ ] the **four gate checks** pass together: `npm run typecheck`, `npm run lint`,
      `npm test`, `npm run build`;
- [ ] **tests** cover the new behavior, and a bug fix includes a test that failed
      before the fix;
- [ ] anything visual or interactive was **verified in the playground** in a real
      browser, and the description says how;
- [ ] **documentation** in `docs/` is updated when a public interface or a feature
      changes;
- [ ] **`CHANGELOG.md`** has an entry under `[Unreleased]` for user-visible work
      (see [Changelog](#changelog));
- [ ] the **CLA** is signed (the bot asks in the PR; see [License and CLA](#license-and-cla));
- [ ] you have **reviewed your own diff** for leftovers: debug output, unrelated
      formatting changes, files that do not belong.

### PR process

1. **Fork** the repository and create a branch from `dev`. Use a prefix that says what
   the branch is:

   ```bash
   git checkout -b fix/crosshair-label-clipping
   # or
   git checkout -b feat/fib-wedge-drawing
   # or
   git checkout -b docs/workspace-persist-option
   ```

2. **Make your change** following the guidelines on this page.

3. **Run the gate** and verify in the browser:

   ```bash
   npm run typecheck && npm run lint && npm test && npm run build
   npm run playground   # http://localhost:5190
   ```

4. **Commit** with clear, English, user-readable messages that describe the change.

5. **Push** and open a pull request **against `dev`** (releases are cut from `dev` to
   `main`). Fill in the PR template.

6. **Respond to review.** Push follow-up commits rather than force-pushing while the
   review is in progress, so reviewers can see what changed.

---

## Testing requirements

Every behavior change comes with a test. Vela is tested in two tiers; see
[docs/contributing/testing.md](docs/contributing/testing.md).

- **Unit tests (vitest, Node).** Pure logic and the port contracts. The
  dependency-injection seams let you drive the core with fake renderers, fake feeds and
  fake engines, use them instead of mocking internals.
- **Browser verification (playground).** Anything you need to *see*: a renderer change,
  a new drawing tool, an interaction. Exercise it in the playground and describe what
  you checked in the PR.

Three rules:

- **A bug fix starts with a failing test.** Reproduce first; the fix is done when that
  test passes and the rest of the suite stays green.
- **A green suite proves nothing about a new feature.** Add a test that would fail if
  the feature were absent.
- **Regenerate fixtures deliberately; never hand-edit them.** Captured JSON fixtures are
  trusted runs. When behavior legitimately changes, regenerate and review the diff.

---

## Code style

- **TypeScript**, typed signatures, no `any` where a real type exists.
- **Formatting** follows `.prettierrc.json` (4-space indent, single quotes, trailing
  commas, 160-column width). Run `npx prettier --write <files>` on what you touched.
- **Lint is architecture.** `npm run lint` enforces the import boundaries: the core
  imports no concrete backend, the UI kit never imports engine internals, the core never
  imports the kit, and only the composition root wires defaults. Do not work around a
  boundary failure, it means the change is in the wrong place.
- **The core is headless.** No `window`, `document`, `history`, or `location`
  assumptions outside the renderer and widget layers.
- **Comments state constraints the code cannot show.** Explain *why*, not *what*; no
  narration of the next line.
- **Everything is written in English**, code, comments, commit messages, docs.
- **Never name other charting products** in code, comments, commit messages, or docs.
  Describe a feature by its own behavior.
- **Match the surrounding code**: naming, comment density, file layout. New UI-kit
  components follow the `controller.ts` + `view.ts` + `styles.css` + `index.ts`
  skeleton in [docs/contributing/adding-a-ui-component.md](docs/contributing/adding-a-ui-component.md).

---

## Changelog

`CHANGELOG.md` is written for the person **using** Vela, not for the developer reading
the diff. When your PR changes something a user can notice, add the entry in the same
PR:

- Put it under a `## [Unreleased]` heading at the top (create it if missing). Never edit
  a section for a version that has already shipped.
- Use `### Added` / `### Changed` / `### Fixed`, in that order, only when non-empty.
  Flag breaking changes inline: `_(Breaking: what changed and what to do instead.)_`
- Write one entry per feature: `- **Bold, feature-first lead.** ` followed by a short,
  concrete sentence or two about what the user can now do.
- Keep it high level. Public names the user types are fine; module paths, internal
  identifiers and architecture vocabulary are not.
- Skip internal refactors, tests, CI, and playground-only tweaks.

Read a few existing entries before writing yours and match their tone.

---

## License and CLA

Vela™ is licensed under the **Apache License 2.0** (see [LICENSE](LICENSE)) with a
**NOTICE-based attribution requirement** (see [NOTICE](NOTICE)): every chart renders a
small attribution mark by default, and any example or documentation that disables it
must mention the equivalent-notice obligation. Do not weaken either side.

**Contributor License Agreement.** Contributions to LuxAlgo repositories require a
signed [CLA](https://github.com/LuxAlgo/cla-signatures/blob/main/CLA.md). You sign it
once, for all LuxAlgo repositories, from inside your first pull request: a bot comments
with instructions and the PR status stays pending until the signature is recorded.

**Keep the license boundary intact.** Vela ships no scripting engine and must not
import one. Pine Script support lives in the separate, AGPL-3.0
[`@luxalgo/vela-pinets`](https://github.com/LuxAlgo/Vela-pinets) addon; importing it
(or the PineTS runtime) into this package would pull that license onto Vela, and the
lint rules reject it. Contributions to the engine belong in that repository.

---

## Getting help

- **Bug reports and feature requests:** [GitHub Issues](https://github.com/LuxAlgo/Vela/issues)
- **Documentation:** [docs/index.md](docs/index.md), user guides, architecture,
  and contributor guides
- **API reference:** [docs/user/api-reference.md](docs/user/api-reference.md)
- **Plugin SDK:** [docs/contributing/plugin-sdk.md](docs/contributing/plugin-sdk.md)

---

Thank you for contributing to Vela™.
