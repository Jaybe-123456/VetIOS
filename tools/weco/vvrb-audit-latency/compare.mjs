import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { buildSyntheticFixture } from './fixtures.mjs';
import { computeReferenceVvrbAuditSignals } from './reference.mjs';
import { computeVvrbAuditSignals as candidate } from './target.mjs';

const baselinePath = process.argv[2];
if (!baselinePath) {
    throw new Error('Usage: node compare.mjs <baseline-module-path>');
}

const baselineModule = await import(pathToFileURL(resolve(baselinePath)).href);
const baseline = baselineModule.computeVvrbAuditSignals;
if (typeof baseline !== 'function') {
    throw new Error('Baseline module does not export computeVvrbAuditSignals');
}

const records = buildSyntheticFixture(18_000, 0xc0ffee);
const expected = computeReferenceVvrbAuditSignals(records);
for (const implementation of [baseline, candidate]) {
    if (!isDeepStrictEqual(implementation(records), expected)) {
        throw new Error('Exact-output equivalence failed before comparison');
    }
}

for (let index = 0; index < 4; index += 1) {
    baseline(records);
    candidate(records);
}

const baselineSamples = [];
const candidateSamples = [];
for (let round = 0; round < 12; round += 1) {
    const first = round % 2 === 0 ? baseline : candidate;
    const second = round % 2 === 0 ? candidate : baseline;
    const firstSamples = round % 2 === 0 ? baselineSamples : candidateSamples;
    const secondSamples = round % 2 === 0 ? candidateSamples : baselineSamples;

    let startedAt = performance.now();
    first(records);
    firstSamples.push(performance.now() - startedAt);

    startedAt = performance.now();
    second(records);
    secondSamples.push(performance.now() - startedAt);
}

const baselineMs = trimmedMean(baselineSamples);
const candidateMs = trimmedMean(candidateSamples);
const improvementPct = ((baselineMs - candidateMs) / baselineMs) * 100;

console.log('exact_output_equivalence: passed');
console.log(`baseline_latency_ms: ${baselineMs.toFixed(6)}`);
console.log(`candidate_latency_ms: ${candidateMs.toFixed(6)}`);
console.log(`improvement_pct: ${improvementPct.toFixed(3)}`);

function trimmedMean(values) {
    const ordered = [...values].sort((left, right) => left - right);
    const trimmed = ordered.slice(2, -2);
    return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
}
