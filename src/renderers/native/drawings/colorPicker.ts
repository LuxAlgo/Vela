// Compat shim — the picker now lives in the UI kit. External imports of this
// module (the browser bundle, older drawing chrome) keep resolving.
export {
    buildColorPicker,
    splitColor,
    combineColor,
    blendOver,
    transparencyChecker,
} from '../../../ui/components/color-picker';
