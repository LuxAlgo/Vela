// CSS written with the kit's `css` tag, through the kit's shared config
// (packages/vela-ui/stylelint). Run through `npm run lint`.
export default {
    extends: ['./packages/vela-ui/stylelint/index.mjs'],
    overrides: [
        {
            // Vela's own chrome: in its layer, styled through its `.vela-*` classes.
            files: ['src/**/*.ts'],
            rules: {
                'vela/layer': 'vela.chrome',
                'vela/slot-scope': null,
                'selector-max-class': null,
                'selector-class-pattern': '^vela-',
            },
        },
    ],
};
