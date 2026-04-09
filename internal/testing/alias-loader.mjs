import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const loaderDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(loaderDirectory, '..', '..');
const appRoot = path.join(repoRoot, 'apps', 'web');

export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
        const candidate = resolveWithExtensions(path.join(appRoot, specifier.slice(2)));
        return nextResolve(pathToFileURL(candidate).href, context);
    }

    if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const parentPath = context.parentURL?.startsWith('file:')
            ? fileURLToPath(context.parentURL)
            : null;
        if (parentPath) {
            const base = path.resolve(path.dirname(parentPath), specifier);
            const candidate = resolveWithExtensions(base, false);
            if (candidate) {
                return nextResolve(pathToFileURL(candidate).href, context);
            }
        }
    }

    return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
    if (url.endsWith('.json')) {
        const filePath = fileURLToPath(url);
        const source = fs.readFileSync(filePath, 'utf8');
        return {
            format: 'module',
            shortCircuit: true,
            source: `export default ${source};`,
        };
    }

    return nextLoad(url, context);
}

function resolveWithExtensions(basePath, throwIfMissing = true) {
    const candidates = [
        basePath,
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.mjs`,
        path.join(basePath, 'index.ts'),
        path.join(basePath, 'index.tsx'),
        path.join(basePath, 'index.js'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    if (throwIfMissing) {
        throw new Error(`Unable to resolve specifier: ${basePath}`);
    }

    return null;
}
