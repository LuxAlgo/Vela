# Localization

Vela renders in English by default. Set a locale and the chart formats its numbers and
dates for that locale, reads its interface text from the locale packs you register, and can
lay out its chrome right to left. Vela publishes packs for the
[languages listed below](#use-a-shipped-language), and you can add your own. With no
localization options set, a chart looks and behaves exactly as it always has.

Localization works the same on a bare chart (`new Vela(...)`), a
[workspace](./workspace.md) and the deprecated widget: every one of them takes the options
below, exposes `i18n` and `setLocale()`, and emits `locale:changed`.

## Set a locale

Pass a [BCP 47](https://www.rfc-editor.org/info/bcp47) tag as `locale`:

```ts
import { Vela } from '@luxalgo/vela';

const chart = new Vela('#chart', { data: bars, locale: 'de' });
```

Change it at runtime with `setLocale()`, which takes a tag or any of the localization
options. The chart re-renders its axes, chips and readouts in place, without re-running
indicators, and then emits `locale:changed`:

```ts
chart.on('locale:changed', ({ locale, direction }) => {
    document.documentElement.lang = locale; // keep your own chrome in step
});

chart.setLocale('fr');
chart.setLocale({ locale: 'ar', direction: 'auto' });
```

Fields you pass to `setLocale()` replace their current value; fields you leave out keep
theirs. Pass a field as `undefined` to return it to its default.

A workspace applies one localization to every cell and to its shared chrome:

```ts
import { VelaWorkspace } from '@luxalgo/vela/workspace';

const ws = new VelaWorkspace('#app', { layout: '4', locale: 'ja' });
ws.setLocale('ko'); // every cell, the shared panels, and cells a later layout creates
```

### The options

| Option | Default | What it does |
|---|---|---|
| `locale` | `'en'` | The language and region of interface text, numbers and dates. |
| `direction` | `'ltr'` | The direction of the chrome: `'ltr'`, `'rtl'`, or `'auto'` to follow the locale's script. The plot never mirrors. See [Right to left](#right-to-left). |
| `messages` | — | Your own text for any message, on top of the registered packs. See [Override any string](#override-any-string). |
| `numberingSystem` | `'latn'` | The digits of every chart number. See [Numbers and digits](#numbers-and-digits). |
| `hourCycle` | `'h23'` | The clock of chart times: `'h23'` (`14:30`), `'h12'` (`2:30 PM`), or `'locale'`. |
| `weekStart` | the locale's | The first day of the week in date pickers: `0` Sunday, `1` Monday, `6` Saturday. |
| `formatters` | — | Your own formatting for prices, percents, volumes, times and durations. See [Replace a formatter](#replace-a-formatter). |

### What follows the locale

- **Numbers and dates on the chart:** the price axis (price, percent, indexed and volume
  scales), the last-price label and its countdown, the time axis, the crosshair's price and
  time chips, the values in the legend, the data window and the status line, the numbers
  drawing tools show, and the bottom bar's clock. Alert times in the alerts list follow the
  chart's clock once you set a locale.
- **Calendars:** the date picker in an indicator's settings names months and weekdays in the
  locale, starts its weeks on the locale's first day, and orders month and year the way the
  locale writes them.
- **Interface text:** the words Vela's own chrome shows or announces are messages: the top
  and bottom bars, menus, dialogs and panels, the built-in indicators with their inputs and plots, the
  drawing tools with their settings and on-chart labels, the chart settings, time zone
  names, key names in the shortcuts panel, toasts, and the names screen readers announce.
  Each message reads in English until a pack translates it, and switching the locale
  relabels what is on screen at once.
- **What stays as it is:** symbols, venues and the descriptions your data provider gives
  them, script names, the names you type (a drawing's text, a group you named), and the
  values a chart saves. A saved layout keeps an
  indicator's option as `'Week'` whatever language its menu showed it in, so a layout opens
  the same in every language.
- **The page:** the chart's root element carries `lang` once you set a locale, and `dir` once
  you set a direction. Without them the attributes stay off and your page decides.

## Use a shipped language

Vela publishes a locale pack for each of these 19 languages, each imported as
`@luxalgo/vela/locales/<tag>`:

| Language | Native name | Tag |
|---|---|---|
| Arabic | العربية | `ar` |
| Chinese (Simplified) | 简体中文 | `zh-Hans` |
| Chinese (Traditional) | 繁體中文 | `zh-Hant` |
| French | Français | `fr` |
| German | Deutsch | `de` |
| Hebrew | עברית | `he` |
| Hindi | हिन्दी | `hi` |
| Indonesian | Bahasa Indonesia | `id` |
| Italian | Italiano | `it` |
| Japanese | 日本語 | `ja` |
| Korean | 한국어 | `ko` |
| Malay | Bahasa Melayu | `ms` |
| Polish | Polski | `pl` |
| Portuguese (Brazil) | Português (Brasil) | `pt-BR` |
| Russian | Русский | `ru` |
| Spanish | Español | `es` |
| Thai | ภาษาไทย | `th` |
| Turkish | Türkçe | `tr` |
| Vietnamese | Tiếng Việt | `vi` |

Each pack covers the whole interface: the chrome, the built-in indicators, the
drawing tools, the chart settings and the time zone names. Names stay as written in every
language: Vela, LuxAlgo, PineTS, Pine Script®, tickers, and the indicators the trading
literature knows by their English name. Numbers keep Western digits.

Import a pack, register it, and switch to its locale:

```ts
import { registerLocale } from '@luxalgo/vela/plugin';
import es from '@luxalgo/vela/locales/es';

registerLocale(es);
chart.setLocale('es');
```

Importing a pack never registers it. Each pack is its own entry point, so a page loads only
the languages it imports. To load a language when the user picks it:

```ts
const { default: pack } = await import('@luxalgo/vela/locales/ru');
registerLocale(pack);
ws.setLocale(pack.locale);
```

The Arabic and Hebrew packs carry `direction: 'rtl'`. Pass `direction: 'auto'` with their
locale and the chrome mirrors, while the plot keeps reading left to right; see
[Right to left](#right-to-left):

```ts
import ar from '@luxalgo/vela/locales/ar';

registerLocale(ar);
chart.setLocale({ locale: 'ar', direction: 'auto' });
```

You can pass the browser's own language tag (`navigator.language`) as it is: a regional tag
reads the closest pack you registered. `zh-CN` and `zh-SG` read Simplified Chinese, `zh-TW`,
`zh-HK` and `zh-MO` Traditional Chinese, `es-MX` and `es-419` Spanish, `pt` and `pt-PT`
Brazilian Portuguese, `ar-EG` Arabic, and the legacy tags `iw` and `in` read Hebrew and
Indonesian. Numbers and dates still follow the tag itself, so `pt-PT` keeps Portugal's
formats.

With a pack active, the indicator picker finds an indicator by its translated name, by its
English name and by its short name, so a search for "Relative Strength" or "RSI" works in
every language.

The translations are machine-drafted, then checked in an independent review pass. If a
word reads wrong in your language, corrections are welcome: open a pull request against the
language's file in `src/locales/` (for example `src/locales/es.json`). To reword a message
in your own app instead, use [`messages`](#override-any-string), or register your own pack
for the same locale after Vela's: for the same message, the pack registered last wins.

## Add your own language

A locale pack is one plain object: a locale tag and its messages, keyed by message id.
Register it before you switch to its locale:

```ts
import { registerLocale } from '@luxalgo/vela/plugin';

const off = registerLocale({
    locale: 'nl',
    messages: {
        'widget.shortcuts.title': 'Sneltoetsen',
        'widget.shortcuts.mouse': 'Muis',
        'ui.datePicker.nextMonth': 'Volgende maand',
    },
});

chart.setLocale('nl');
// Later, to remove the pack again:
off();
```

Registration is always a call: importing a pack never registers it. A pack only needs the
messages it translates. A message missing from a pack falls back through the locale's
parents to English: `pt-BR` reads `pt-BR`, then `pt`, then English; `zh-TW` reads `zh-TW`,
then `zh-Hant`, then `zh`. After the bare language comes the region it usually means, when
that region writes the same script: `pt-PT` reads `pt-PT`, `pt`, then `pt-BR`; `zh` reads
`zh-Hans`, then `zh-CN`. Legacy tags read as their current ones (`iw` as `he`, `in` as `id`).
Several packs can share a locale (Vela's, a plugin's, your own); for the same message, the
pack registered last wins.

Start a translation from the English reference pack, which lists every message id with its
English text:

```ts
import en from '@luxalgo/vela/locales/en';

console.log(en.messages); // { 'ui.datePicker.chooseMonth': 'Choose month', … }
```

### Message syntax

Messages use a subset of ICU message syntax:

| Form | Example |
|---|---|
| A value | `Delta {value}` |
| A number | `{count, number}`, `{count, number, integer}`, `{share, number, percent}` |
| Plurals | `{count, plural, one {# bar} other {# bars}}`, with `=0 {…}` exact matches and `offset:1` |
| Ordinals | `{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}` |
| A choice | `{side, select, buy {Bought} sell {Sold} other {Traded}}` |

Plurals follow each language's own categories: Arabic has six (`zero`, `one`, `two`,
`few`, `many`, `other`), Polish and Russian four. An apostrophe is plain text
(`l'indicateur`); to show a literal brace, quote it: `'{'`. A translation that fails to
parse falls back to the English text instead of breaking the chart.

## Override any string

The `messages` option replaces any message for the current locale, on top of the registered
packs. It works in English too, to reword Vela's own text:

```ts
const chart = new Vela('#chart', {
    messages: { 'widget.shortcuts.title': 'Shortcuts' },
});
```

Message ids are typed: a misspelled id is a compile error. A plugin or host that declares its
own messages adds their ids to the catalog so they type-check too:

```ts
declare module '@luxalgo/vela/plugin' {
    interface VelaMessageCatalog {
        'acme.panel.title': string;
    }
}
```

## Right to left

Set `direction: 'rtl'`, or `'auto'` to follow the locale: Arabic, Hebrew, Persian, Urdu and
the other right-to-left scripts resolve to `'rtl'`. The direction lands as `dir` on the
chart's root element and on the workspace root, and the chrome under them follows it.

The plot never mirrors, whatever the direction. Time runs left to right with the newest bar
on the right, the price axis stays on the right, and the chart's arrow keys still move
toward older bars on the left. Prices, percents and times read left to right.

Some chrome still positions itself for left-to-right pages and does not mirror yet. Check
your layout in the right-to-left locales you ship.

## Numbers and digits

Chart numbers use Western digits in every language, Arabic included, so prices read the
same for everyone. Set `numberingSystem` to show other digits:

```ts
import { createTranslator } from '@luxalgo/vela/plugin';

// The same options a chart takes; `chart.i18n.format` gives the same results.
const price = (options) => createTranslator(options).format.price(58732.5, { decimals: 2, grouping: true });

price({ locale: 'ar-SA' });                            // 58,732.50
price({ locale: 'ar-SA', numberingSystem: 'locale' }); // ٥٨٬٧٣٢٫٥٠
price({ locale: 'hi', numberingSystem: 'deva' });      // ५८,७३२.५०
```

`'locale'` uses the locale's own digits, and any numbering system id (`'arab'`, `'deva'`,
`'thai'`, …) picks one. A tag with a `-u-nu-` extension (`'ar-u-nu-arab'`) picks its digits
when you leave `numberingSystem` unset.

Other conventions hold in every locale:

- **Separators follow the locale.** German reads `58.732,50`, Indian English groups in
  lakhs (`1,23,45,678.90`). The price axis leaves out group separators so its labels fit
  the scale.
- **Rounding is the same everywhere.** A price shows the same digits in every language; only
  the separators change.
- **The calendar is Gregorian.** Thai dates count Gregorian years, not Buddhist ones.
- **The clock is 24-hour** unless you set `hourCycle`.
- **Volumes abbreviate the locale's way:** `1.2M` in English, `120万` in Japanese,
  `1,2 Mio.` in German.

## Replace a formatter

Supply any of `price`, `percent`, `compact`, `timeTick`, `timeStamp`, `duration` and
`clock` in `formatters`. Each receives the value and a context: the `locale`, the display
`timeZone`, the `surface` the value appears on (`'priceAxis'`, `'crosshair'`, `'lastPrice'`,
`'timeAxis'`, `'legend'`, `'dataWindow'`, …), the formatter's own fields, and `fallback()`,
which returns Vela's built-in formatting. On a daily or coarser chart, `timeStamp` receives
`timeZone: 'UTC'`: those bars are dates stamped at 00:00 UTC, and read the same in every zone.

```ts
new Vela('#chart', {
    locale: 'de',
    formatters: {
        price: (value, ctx) => (ctx.surface === 'dataWindow' ? `${ctx.fallback()} €` : ctx.fallback()),
    },
});
```

A formatter that throws, or returns something other than a string, falls back to the
built-in formatting.

## Use the translator

`chart.i18n` (and `ws.i18n`) is the chart's translator. It holds the resolved settings
(`locale`, `direction`, `numberingSystem`, `hourCycle`, `weekStart`), translates messages
with `t()`, and formats values with `format`:

```ts
import { msg } from '@luxalgo/vela/plugin';

const SAVED = msg('acme.layout.saved', '{count, plural, one {# layout saved} other {# layouts saved}}');

chart.i18n.t(SAVED, { count: 3 });                       // "3 layouts saved"
chart.i18n.t('Plain text');                              // plain strings come back unchanged
chart.i18n.format.price(58732.5, { decimals: 2, grouping: true });
chart.i18n.format.timeStamp(Date.now(), { timeZone: 'Asia/Tokyo' });
```

The translator is the same object for the chart's lifetime and reads the new settings after
`setLocale()`, so you can keep it. Contributed actions and panels get the shell's translator
as `ctx.i18n`, and renderer layers as `args.i18n`. For UI you build outside a chart,
`createTranslator(options)` makes a standalone one.

### Label what you contribute

The labels you hand Vela accept a message as well as a plain string, and Vela shows them in
the shell's language: a contributed action's `label`, a side panel's `title`, a legend
action's `tooltip`, a legend callout's text, a registered layout's `label`, a key binding's
`label` and `category`, an indicator input's `display` (its title, tooltip, group and the
names of its options), and a drawing type's name. Messages go in only: what you read back
is text, in the language of the translator you pass (English without one), such as
`buildToolbar(option, chart.i18n)`, `layouts(chart.i18n)`, `layoutDefinition(id, chart.i18n)`,
`drawingTypes(chart.i18n)`, `keymap.bindings(chart.i18n)` and
`chart.availableNativeIndicators()`. Text you keep goes stale when the language changes, so
read it again on `locale:changed`.

```ts
import { msg, registerWidgetAction } from '@luxalgo/vela/plugin';

registerWidgetAction({
    id: 'acme.export',
    target: 'topbar',
    label: msg('acme.export.label', 'Export trades'),
    run: (ctx) => exportTrades(ctx),
});
```

## Keyboards and scripts

Shortcuts name Latin keys, and they keep working on keyboard layouts of other scripts:
Ctrl+Z undoes on a Russian layout, where that key types `я`. A Latin layout keeps its own
letters wherever they sit. Typing a letter of any script on the chart opens symbol search,
and while an input method composes a character (Japanese, Chinese, Korean), its keystrokes
stay with it. Text drawn on the chart wraps between words in scripts written without spaces,
such as Thai, Chinese and Japanese.

## For contributors

Declare new interface text with `msg('area.component.key', 'English text')` and resolve it
through a translator. Never decide anything from display text: keep identities (ids, option
values, saved names) in English and show them through a message. Then run:

```sh
npm run i18n:extract
```

It collects every `msg()` call into `src/locales/en.json`, the English catalog translations
start from, and into `src/locales/catalog.d.ts`, the type that checks message ids. The tests
fail when either file is out of date, or when a pack under `src/locales/` names an unknown
message or changes a message's arguments.

The shipped packs live beside it, one `<tag>.json` of messages and one `<tag>.ts` entry point
per language; the build publishes each as `@luxalgo/vela/locales/<tag>`. You don't need to
translate the text you add: a message a pack lacks reads in English until a translation
lands, and `npm run i18n:check` lists how many messages each pack translates. The pack tests
fail when a pack names an unknown message, when one of its messages doesn't parse, takes
other values than the English, lacks a plural form its language needs, drops a product name
or writes other digits than 0 to 9, and when a workspace in a shipped language shows English
that comes from no message at all.
