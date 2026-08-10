// vela/ui — the headless-first component kit. Controllers are Zag machines (framework-
// agnostic); views are thin vanilla projections over the design tokens. Adding a component
// = the uniform skeleton `components/<name>/{controller,view,styles,index}.ts`.
export { injectStyles, withAlpha } from './styles';
export { applyThemeTokens, applyPlotOverlayTokens, ensureUIHost } from './tokens';
export { registerIcon, iconMarkup, iconEl, svg16, svg24 } from './icons';
export { runMachine, nextUid, normalizeProps, spreadProps, type MachineHandle } from './zag';
export { KeymapManager, type KeyBindingDescriptor, type ResolvedBinding, type KeymapOptions } from './keymap';
export * from './components/tooltip';
export * from './components/menu';
export * from './components/dialog';
export * from './components/drawer';
