process.env.TZ = 'UTC';
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    verbose: true,
    testPathIgnorePatterns: ['/dist/', 'node_modules/'],
    testMatch:  ['**/*.spec.ts'],
    collectCoverage: true,
    coverageReporters: ['lcov'],
    coveragePathIgnorePatterns: [
        '/node_modules/',
    ],
    coverageThreshold: {
      global: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90
      }
    }
};
