// vela/ui — the headless-first component kit. Overlay chrome (menu, dialog, drawer,
// tooltip) is driven by Zag machines; form primitives (switch, select, number, text,
// color, popover) use vanilla controllers so they match the existing settings chrome
// pixel-for-pixel. Every component is `components/<name>/{controller,view,styles,index}.ts`.
export { injectStyles, withAlpha, overlayScrollbarCss, FIELD_FOCUS_CSS, FIELD_FOCUS_RING } from './styles';
export { applyThemeTokens, applyPlotOverlayTokens, ensureUIHost } from './tokens';
export { registerIcon, iconMarkup, iconEl, svg16, svg24 } from './icons';
export { runMachine, nextUid, normalizeProps, spreadProps, type MachineHandle } from './zag';
export { KeymapManager, type KeyBindingDescriptor, type ResolvedBinding, type KeymapOptions } from './keymap';
export * from './components/tooltip';
export * from './components/menu';
export * from './components/dialog';
export * from './components/drawer';
export * from './components/popover';
export * from './components/switch';
export * from './components/select';
export * from './components/number-input';
export * from './components/text-field';
export * from './components/color-picker';
export * from './components/field';
export * from './components/text-area';
export * from './components/glyph-select';
export * from './components/callout-bubble';
