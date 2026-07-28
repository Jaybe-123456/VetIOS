import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { buildEdgeFixture, buildSyntheticFixture } from './fixtures.mjs';
import { computeReferenceVvrbAuditSignals } from './reference.mjs';
import { computeVvrbAuditSignals } from './target.mjs';

const targetPath = fileURLToPath(new URL('./target.mjs', import.meta.url));
const source = await readFile(targetPath, 'utf8');
const forbiddenPatterns = [
    [/\bimport\s*(?:\(|[\s{*])/u, 'imports'],
    [/\brequire\s*\(/u, 'require'],
    [/\bprocess\b/u, 'process access'],
    [/\b(?:eval|Function)\s*\(/u, 'dynamic evaluation'],
    [/\b(?:fetch|XMLHttpRequest|WebSocket)\b/u, 'network access'],
    [/\b(?:readFile|writeFile|readdir|child_process)\b/u, 'filesystem or subprocess access'],
];

for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(source)) {
        console.error(`firewall_blocked: target uses forbidden ${label}`);
        process.exit(2);
    }
}

const equivalenceFixtures = [
    buildEdgeFixture(),
    buildSyntheticFixture(1, 0x12345678),
    buildSyntheticFixture(257, 0x9e3779b9),
    buildSyntheticFixture(4096, 0xa5a5a5a5),
    buildSyntheticFixture(8191, 0x6d2b79f5),
];

const runtimeSeed = (Date.now() ^ process.pid ^ Math.floor(performance.now() * 1000)) >>> 0;
equivalenceFixtures.push(
    buildSyntheticFixture(733 + runtimeSeed % 521, runtimeSeed),
);

for (const fixture of equivalenceFixtures) {
    const expected = computeReferenceVvrbAuditSignals(fixture);
    const actual = computeVvrbAuditSignals(fixture);
    if (!isDeepStrictEqual(actual, expected)) {
        console.error('exact_output_equivalence: failed');
        console.error(JSON.stringify({ expected, actual }));
        process.exit(3);
    }
}

const benchmarkRecords = buildSyntheticFixture(18_000, 0xc0ffee);
const expectedBenchmark = computeReferenceVvrbAuditSignals(benchmarkRecords);

for (let index = 0; index < 3; index += 1) {
    const warmup = computeVvrbAuditSignals(benchmarkRecords);
    if (!isDeepStrictEqual(warmup, expectedBenchmark)) {
        console.error('runtime_holdout_equivalence: failed');
        process.exit(4);
    }
}

const samples = [];
for (let round = 0; round < 9; round += 1) {
    const startedAt = performance.now();
    const actual = computeVvrbAuditSignals(benchmarkRecords);
    const elapsed = performance.now() - startedAt;
    if (!isDeepStrictEqual(actual, expectedBenchmark)) {
        console.error('timed_holdout_equivalence: failed');
        process.exit(5);
    }
    samples.push(elapsed);
}

samples.sort((left, right) => left - right);
const trimmed = samples.slice(2, -2);
const latencyMs = trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;

console.log('exact_output_equivalence: passed');
console.log(`hidden_fixture_count: ${equivalenceFixtures.length}`);
console.log('sensitive_data_rows: 0');
console.log(`benchmark_rows: ${benchmarkRecords.length}`);
console.log(`latency_ms: ${latencyMs.toFixed(6)}`);
