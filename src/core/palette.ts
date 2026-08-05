// The semantic palette — every fixed color Vela ships that is NOT part of a swappable
// `VelaTheme`. These are brand/meaning constants (an accent stays the accent whichever
// theme is active), so they live here once instead of being retyped as literals in the
// chrome, the pickers, the defaults and the tokens.
//
// Theme-dependent colors (surfaces, text, borders, candles) belong to `VelaTheme` in
// `theme.ts` and must NOT be duplicated here.

/** Selection/menu accent — active entries, "native" badges, selected controls. */
export const ACCENT = '#2962ff';

/** The lighter brand blue: "on" affordances and the default drawing color, brighter than
 *  {@link ACCENT} so a switch reads clearly enabled. */
export const ACCENT_BRIGHT = '#38c0fd';

/** Bullish/bearish reference pair — the dark theme's candle colors, reused wherever a
 *  fixed directional color is needed outside a theme (volume profiles, baseline defaults). */
export const BULLISH = '#089981';
export const BEARISH = '#f23645';

/** Neutral gray for de-emphasized geometry (unstyled level lines, gann 1/1 diagonals). */
export const NEUTRAL = '#787b86';

/** Attention amber — favorited items. */
export const HIGHLIGHT = '#e0b400';

/** Warm accent used by the categorical palette and warning-ish marks. */
export const WARNING = '#ff9800';

/** Soft informational blue — statistical overlays (regression, VWAP) and the blue rung of the
 *  drawing level palette, which should read as derived data rather than user-drawn geometry. */
export const INFO = '#5b9cf6';

/** Highlighter ink — a saturated marker orange, always drawn translucent. */
export const MARKER = '#ff5d00';

/** Validity tints — a pattern that satisfies its rules vs one that does not. Brighter and
 *  cooler than {@link BULLISH}/{@link BEARISH} so a validity wash never reads as direction. */
export const VALID = '#0ecb81';
export const INVALID = '#f6465d';

/** Market-session states beside the theme's up-colored "open": pre-market dawn amber,
 *  post-market dusk sky, and the shared closed/holiday gray (statusline badge). */
export const SESSION_PRE = '#f97316';
export const SESSION_POST = '#0ea5e9';
export const SESSION_OFF = '#9ca3af';

/** Default color of a plain line/area series — a softer blue than {@link ACCENT}, which is
 *  reserved for interactive chrome. */
export const SERIES_LINE = '#3b82f6';

/** Crosshair ink: a cool gray that stays legible over both candles and empty surface. */
export const CROSSHAIR = '#9aa0ad';

/** Fixed slate plates for canvas chrome that floats over chart content of any color
 *  (crosshair value chips, info badges) — they cannot follow the theme surface and stay
 *  readable. `SLATE_DEEP` is the plate, `SLATE` its border. */
export const SLATE_DEEP = '#1e293b';
export const SLATE = '#475569';

/** Strategy trade markers — entry arrows per position side, and the exits' shared violet.
 *  The entry pair deliberately reuses the accent blue / bearish red (the reference palette
 *  of order-fill marks); the violet keeps exits apart from both directions. */
export const TRADE_LONG = ACCENT;
export const TRADE_SHORT = BEARISH;
export const TRADE_EXIT = '#d500f9';

/** Categorical hues for auto-assigned colors (symbol badges, multi-series defaults).
 *  Ordered for adjacent-hue contrast, not by hue family. */
export const CATEGORICAL: readonly string[] = [ACCENT, BULLISH, BEARISH, WARNING, '#7e57c2', '#26a69a', INFO, '#e573b5'];

/** Pick a stable categorical color for a string key (same key ⇒ same color). */
export function categoricalColor(key: string): string {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return CATEGORICAL[h % CATEGORICAL.length]!;
}
