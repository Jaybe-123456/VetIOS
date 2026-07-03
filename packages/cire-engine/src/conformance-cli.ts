#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateCireConformanceReport, type CireConformanceReport } from './index.js';

function main() {
    const args = process.argv.slice(2);
    const path = args.find((arg) => !arg.startsWith('-'));
    const strict = args.includes('--strict');

    if (!path || args.includes('--help') || args.includes('-h')) {
        printHelp();
        process.exit(path ? 0 : 1);
    }

    const absolutePath = resolve(process.cwd(), path);
    const report = JSON.parse(readFileSync(absolutePath, 'utf8')) as CireConformanceReport;
    const result = validateCireConformanceReport(report);

    console.log(JSON.stringify(result, null, 2));

    if (!result.passed || (strict && result.summary.failed > 0)) {
        process.exit(1);
    }
}

function printHelp() {
    console.log([
        'Usage: cire-conformance <report.json> [--strict]',
        '',
        'Validates a CIRE-compatible implementation report against the v1 reference numerics.',
        '',
        'The JSON report can include:',
        '- differential_cases: phi_hat entropy checks',
        '- input_cases: input_m_hat impairment checks',
        '- cps_cases: CPS and safety-state checks',
        '- output_vector_cases: probability vector extraction checks',
    ].join('\n'));
}

main();
