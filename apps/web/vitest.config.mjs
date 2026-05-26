import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '@': rootDir,
            '@vetios/graph': path.resolve(rootDir, '../../packages/graph/src/index.ts'),
        },
    },
    test: {
        environment: 'node',
    },
});
