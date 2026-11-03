// The semantic palette lives in the kit's package; Vela's code keeps importing it from here.
// Named, not `export *`: a star re-export of a dependency is lost through Vela's bundled entries.
export { ACCENT, ACCENT_BRIGHT, BULLISH, BEARISH, NEUTRAL, HIGHLIGHT, WARNING, INFO, MARKER, VALID, INVALID, SESSION_PRE, SESSION_POST, SESSION_OFF, SERIES_LINE, CROSSHAIR, SLATE_DEEP, SLATE, CHIP_PLATE, TRADE_LONG, TRADE_SHORT, TRADE_EXIT, CATEGORICAL, categoricalColor } from '@luxalgo/vela-ui/palette';
