#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const compiledCliPath = resolve(here, '../dist/conformance-cli.js');

if (!existsSync(compiledCliPath)) {
    console.error(
        [
            'cire-conformance is installed, but @vetios/cire-engine has not been built yet.',
            'Run `pnpm --filter @vetios/cire-engine build` before invoking this binary.',
        ].join('\n'),
    );
    process.exit(1);
}

await import(pathToFileURL(compiledCliPath).href);
