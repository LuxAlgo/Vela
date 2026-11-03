// The shared stylelint config for CSS written with the kit's `css` tag: the kit's components,
// Vela's chrome, Pro, plugins and a host's own components. Extend it and set the layer the
// CSS belongs to:
//
//     export default {
//         extends: ['@luxalgo/vela-ui/stylelint'],
//         rules: { 'vela/layer': 'vela.custom' },
//     };
//
// It needs stylelint, postcss-lit and stylelint-config-recommended installed.
import plugin from './plugin.mjs';

export default {
    extends: ['stylelint-config-recommended'],
    plugins: plugin,
    customSyntax: 'postcss-lit',
    rules: {
        'vela/layer': 'vela.ui',
        'vela/slot-scope': true,
        'vela/token-values': true,
        'vela/no-raw-token-var': true,
        'layer-name-pattern': '^vela\\.(theme|ui|chrome|pro|custom)$',
        // Interpolated values reach it as placeholders it cannot know; vela/token-values and
        // the typed tokens check them instead.
        'declaration-property-value-no-unknown': null,
        // `${t.font}` already ends in a generic family.
        'font-family-no-missing-generic-family-keyword': [true, { ignoreFontFamilies: ['/^POSTCSS_LIT_\\d+( POSTCSS_LIT_\\d+)*$/'] }],

        // Colors come from tokens.
        'color-no-hex': true,
        'color-named': 'never',
        'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch'],

        // Selectors: parts and state attributes, shallow, and no specificity contests.
        'declaration-no-important': true,
        'selector-max-id': 0,
        'selector-max-class': 0,
        'selector-max-type': [0, { ignore: ['child', 'descendant'] }],
        'selector-max-specificity': '0,4,0',
        'selector-max-compound-selectors': 3,
        'selector-nested-pattern': '^&',
        'selector-attribute-quotes': 'always',
        'max-nesting-depth': [2, { ignoreAtRules: ['layer'] }],

        // Logical directions, so right-to-left layouts mirror.
        'property-disallowed-list': ['/^(margin|padding|border)-(left|right)/', 'left', 'right', 'float', 'clear'],
        // The kit's border-box reset is unlayered (the chrome relies on it), so a layered
        // `box-sizing: content-box` would never apply: size the full box instead.
        'declaration-property-value-disallowed-list': { 'text-align': ['left', 'right'], outline: ['none', '0'], 'box-sizing': ['content-box'] },

        // Durations come from tokens (and follow reduced motion); container queries, not
        // viewport ones (a chart is rarely the size of the viewport).
        'unit-disallowed-list': ['ms', 's'],
        'media-feature-name-disallowed-list': ['width', 'min-width', 'max-width'],

        // A component's private custom properties start with an underscore.
        'custom-property-pattern': '^_[a-z][a-z0-9-]*$',
    },
};
