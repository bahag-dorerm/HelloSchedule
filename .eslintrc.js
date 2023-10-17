module.exports = {
    root: true,
    env: {
        node: true
    },
    parser: '@typescript-eslint/parser',
    plugins: [
        '@typescript-eslint',
        'unused-imports'
    ],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended'
    ],
    rules: {
        'quotes': ['error', 'single', {'avoidEscape': true}],
        'semi': ['error'],
        'no-magic-numbers': ['error', { 'ignore': [0, 1, 10], 'ignoreClassFieldInitialValues': true }],
        '@typescript-eslint/ban-ts-comment': ['warn'],
        'brace-style': ['error', 'stroustrup', { 'allowSingleLine': true }],
        'no-multiple-empty-lines': ['error', {'max': 1, 'maxBOF': 0, 'maxEOF': 1}],
        'eol-last': ['error', 'always'],
        '@typescript-eslint/explicit-function-return-type': ['warn'],
        'complexity': ['error', { 'max': 6 }],
        'max-lines-per-function': ['error', { 'max': 35, 'skipComments': true }],
        'max-depth': ['error', {'max': 3}],
        'array-bracket-spacing': ['error', 'never'],
        'arrow-parens': ['error'],
        'camelcase': ['warn', { 'properties': 'always' }],
        'consistent-return': ['warn'],
        'eqeqeq': ['error', 'always'],
        'func-call-spacing': ['error', 'never'],
        'keyword-spacing': ['error'],
        'linebreak-style': ['error', 'unix'],
        'max-params': ['error', { 'max': 3 }],
        'no-trailing-spaces': ['error'],
        '@typescript-eslint/no-unused-vars': 'off',
        'object-curly-spacing': ['error', 'always'],
        'space-before-blocks': ['error', 'always'],
        'unused-imports/no-unused-imports': 'error',
        'unused-imports/no-unused-vars': [
            'warn',
            { 'vars': 'all', 'varsIgnorePattern': '^_', 'args': 'after-used', 'argsIgnorePattern': '^_' }
        ]
    }
};
