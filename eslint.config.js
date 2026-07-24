import tseslint from 'typescript-eslint';

/**
 * Architectural boundary guard (the maintainability contract):
 *  - `pinets` may be imported ONLY inside src/engines/pinets* (the engine ACL).
 *    The data layer is provider-agnostic and never imports it; data providers are
 *    written from scratch against the neutral port.
 *  - `lightweight-charts` is a TEMPORARY type-only devDependency (legacy shared types);
 *    no new import of it is allowed anywhere — it is being replaced by Vela's own types.
 */
export default tseslint.config(
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tseslint.parser,
        },
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        { name: 'pinets', message: 'Import pinets only inside src/engines/pinets* (the engine ACL). The data layer is provider-agnostic and must not import it.' },
                    ],
                },
            ],
        },
    },
    // The PineTS engine is the only place allowed to import pinets (for execution).
    {
        files: ['src/engines/pinets/**/*.ts', 'src/engines/pinets-worker/**/*.ts'],
        rules: { 'no-restricted-imports': 'off' },
    },
);
