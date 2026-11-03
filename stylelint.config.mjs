// Kit component CSS: the `css` templates of src/ui/components/*.ts (see
// scripts/stylelint-plugin-vela.mjs for the vela/* rules). Run through `npm run lint`.
export default {
    extends: ['stylelint-config-recommended'],
    plugins: ['./scripts/stylelint-plugin-vela.mjs'],
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
        'declaration-property-value-disallowed-list': { 'text-align': ['left', 'right'], outline: ['none', '0'] },

        // Durations come from tokens (and follow reduced motion); container queries, not
        // viewport ones (a chart is rarely the size of the viewport).
        'unit-disallowed-list': ['ms', 's'],
        'media-feature-name-disallowed-list': ['width', 'min-width', 'max-width'],

        // A component's private custom properties start with an underscore.
        'custom-property-pattern': '^_[a-z][a-z0-9-]*$',
    },
};
