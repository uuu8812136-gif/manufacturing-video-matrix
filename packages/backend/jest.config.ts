import type { Config } from 'jest';
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  moduleNameMapper: { '^@mvms/shared$': '<rootDir>/../shared/src' },
};
export default config;
