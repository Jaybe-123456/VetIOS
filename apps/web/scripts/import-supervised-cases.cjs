#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_INPUT = path.join(__dirname, 'data', 'supervised-clinical-cases.txt');
const SUPPORTED_FIELDS = [
    'CASE_ID',
    'SPECIES',
    'BREED',
    'AGE_GROUP',
    'SEX',
    'HISTORY',
    'PRESENTING_COMPLAINT',
    'SYMPTOM_VECTOR',
    'PHYSICAL_EXAM',
    'LAB_FINDINGS',
    'RISK_FACTORS',
    'DIFFERENTIALS',
    'PRIMARY_CONDITION_CLASS',
    'FINAL_DIAGNOSIS',
    'SEVERITY',
    'EMERGENCY_FLAGS',
    'SUPPORTING_EVIDENCE',
    'RECOMMENDED_TESTS',
    'INITIAL_MANAGEMENT',
    'PROGNOSIS',
    'SOURCE_TOPIC',
];
const ADVERSARIAL_VARIANTS = [
    {
        caseId: 'ADV-ALF-001',
        baseCaseId: 'ALF-001',
        contradictorySignals: ['normal bilirubin despite marked icterus', 'missing ammonia value'],
        noiseLevel: 0.70,
        expectedBehavior: 'confidence_drop_or_abstain',
    },
    {
        caseId: 'ADV-AFLA-001',
        baseCaseId: 'AFLA-001',
        contradictorySignals: ['vomiting and diarrhea only', 'bleeding signs removed', 'no feed history provided'],
        noiseLevel: 0.60,
        expectedBehavior: 'reduce_confidence_and_expand_differentials',
    },
    {
        caseId: 'ADV-BABE-001',
        baseCaseId: 'BABE-001',
        contradictorySignals: ['tick exposure omitted', 'hemoglobinuria omitted', 'fever retained'],
        noiseLevel: 0.55,
        expectedBehavior: 'consider_tick_borne_overlap_not_overconfident',
    },
    {
        caseId: 'ADV-HYPOCA-001',
        baseCaseId: 'HYPOCA-001',
        contradictorySignals: ['postpartum history omitted', 'panting only', 'calcium value missing'],
        noiseLevel: 0.65,
        expectedBehavior: 'avoid_false_positive_eclampsia',
    },
    {
        caseId: 'ADV-PAROX-002',
        baseCaseId: 'PAROX-002',
        contradictorySignals: ['post-ictal phase omitted', 'owner reports brief collapse only'],
        noiseLevel: 0.50,
        expectedBehavior: 'differentiate_seizure_vs_syncope',
    },
];

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.tenantId) {
        throw new Error('Missing required --tenant-id <uuid>.');
    }

    const raw = fs.readFileSync(args.inputPath, 'utf8');
    const parsedCases = parseStructuredCases(raw);
    if (parsedCases.length === 0) {
        throw new Error(`No structured cases found in ${args.inputPath}.`);
    }

    const normalized = parsedCases.map((entry) => normalizeCase(entry, args));
    const adversarialRows = buildAdversarialRows(normalized, args);
    if (args.emitSql) {
        emitSql(normalized, adversarialRows, args);
        return;
    }

    if (args.dryRun) {
        printDryRunSummary(normalized, adversarialRows, args);
        return;
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(resolveSupabaseUrl(), resolveSupabaseKey(), {
        auth: { persistSession: false },
    });

    let insertedCases = 0;
    let updatedCases = 0;
    let insertedInferences = 0;
    let insertedOutcomes = 0;
    let insertedAdversarialEvents = 0;
    let skippedAdversarialEvents = 0;

    for (const item of normalized) {
        const existing = await supabase
            .from('clinical_cases')
            .select('id')
            .eq('tenant_id', args.tenantId)
            .eq('case_key', item.caseKey)
            .maybeSingle();

        if (existing.error) {
            throw new Error(`Failed to lookup clinical case ${item.caseId}: ${existing.error.message}`);
        }

        const caseId = existing.data?.id ?? item.caseRow.id;
        const caseRow = {
            ...item.caseRow,
            id: caseId,
            latest_inference_event_id: item.inferenceRow.id,
            latest_outcome_event_id: item.outcomeRow.id,
        };

        if (existing.data?.id) {
            const { error } = await supabase
                .from('clinical_cases')
                .update(caseRow)
                .eq('id', caseId);

            if (error) {
                throw new Error(`Failed to update clinical case ${item.caseId}: ${error.message}`);
            }
            updatedCases += 1;
        } else {
            const { error } = await supabase
                .from('clinical_cases')
                .insert(caseRow);

            if (error) {
                throw new Error(`Failed to insert clinical case ${item.caseId}: ${error.message}`);
            }
            insertedCases += 1;
        }

        const inferenceUpsert = await supabase
            .from('ai_inference_events')
            .upsert({
                ...item.inferenceRow,
                case_id: caseId,
            }, { onConflict: 'id' });

        if (inferenceUpsert.error) {
            throw new Error(`Failed to upsert inference event for ${item.caseId}: ${inferenceUpsert.error.message}`);
        }
        insertedInferences += 1;

        const outcomeUpsert = await supabase
            .from('clinical_outcome_events')
            .upsert({
                ...item.outcomeRow,
                case_id: caseId,
                inference_event_id: item.inferenceRow.id,
            }, { onConflict: 'id' });

        if (outcomeUpsert.error) {
            throw new Error(`Failed to upsert outcome event for ${item.caseId}: ${outcomeUpsert.error.message}`);
        }
        insertedOutcomes += 1;

        const linkUpdate = await supabase
            .from('clinical_cases')
            .update({
                latest_inference_event_id: item.inferenceRow.id,
                latest_outcome_event_id: item.outcomeRow.id,
                last_inference_at: item.importedAt,
                updated_at: item.importedAt,
            })
            .eq('id', caseId);

        if (linkUpdate.error) {
            throw new Error(`Failed to link latest events for ${item.caseId}: ${linkUpdate.error.message}`);
        }
    }

    const edgeSimulationAvailable = await canAccessEdgeSimulationEvents(supabase);
    if (edgeSimulationAvailable) {
        for (const item of adversarialRows) {
            const simulationUpsert = await supabase
                .from('edge_simulation_events')
                .upsert(item.simulationRow, { onConflict: 'id' });

            if (simulationUpsert.error) {
                throw new Error(`Failed to upsert adversarial event ${item.caseId}: ${simulationUpsert.error.message}`);
            }
            insertedAdversarialEvents += 1;

            const simulationLink = await supabase
                .from('clinical_cases')
                .update({
                    latest_simulation_event_id: item.simulationRow.id,
                    updated_at: item.importedAt,
                })
                .eq('id', item.baseCaseUuid);

            if (simulationLink.error && !/column .*latest_simulation_event_id/i.test(simulationLink.error.message)) {
                throw new Error(`Failed to link adversarial event ${item.caseId}: ${simulationLink.error.message}`);
            }
        }
    } else {
        skippedAdversarialEvents = adversarialRows.length;
    }

    console.log(JSON.stringify({
        tenant_id: args.tenantId,
        source_file: args.inputPath,
        cases_processed: normalized.length,
        clinical_cases_inserted: insertedCases,
        clinical_cases_updated: updatedCases,
        inference_events_upserted: insertedInferences,
        outcome_events_upserted: insertedOutcomes,
        adversarial_events_upserted: insertedAdversarialEvents,
        adversarial_events_skipped: skippedAdversarialEvents,
    }, null, 2));
}

function parseArgs(argv) {
    const parsed = {
        tenantId: '',
        clinicId: null,
        inputPath: DEFAULT_INPUT,
        dryRun: false,
        emitSql: false,
        outputPath: null,
        sourceModule: 'supervised_import',
        modelName: 'supervised_seed',
        modelVersion: 'expert_curated_v1',
    };

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--tenant-id') {
            parsed.tenantId = argv[index + 1] ?? '';
            index += 1;
        } else if (token === '--clinic-id') {
            parsed.clinicId = argv[index + 1] ?? null;
            index += 1;
        } else if (token === '--input') {
            parsed.inputPath = path.resolve(process.cwd(), argv[index + 1] ?? DEFAULT_INPUT);
            index += 1;
        } else if (token === '--dry-run') {
            parsed.dryRun = true;
        } else if (token === '--emit-sql') {
            parsed.emitSql = true;
        } else if (token === '--output') {
            parsed.outputPath = path.resolve(process.cwd(), argv[index + 1] ?? '');
            index += 1;
        } else if (token === '--source-module') {
            parsed.sourceModule = argv[index + 1] ?? parsed.sourceModule;
            index += 1;
        } else if (token === '--model-name') {
            parsed.modelName = argv[index + 1] ?? parsed.modelName;
            index += 1;
        } else if (token === '--model-version') {
            parsed.modelVersion = argv[index + 1] ?? parsed.modelVersion;
            index += 1;
        } else if (token === '--help' || token === '-h') {
            printHelp();
            process.exit(0);
        }
    }

    return parsed;
}

function printHelp() {
    console.log([
        'Usage:',
        '  node scripts/import-supervised-cases.cjs --tenant-id <uuid> [--clinic-id <uuid>] [--input <path>] [--dry-run] [--emit-sql] [--output <path>]',
        '',
        'Examples:',
        '  node scripts/import-supervised-cases.cjs --tenant-id 11111111-1111-1111-1111-111111111111 --dry-run',
        '  pnpm --filter @vetios/web run import:supervised-cases -- --tenant-id 11111111-1111-1111-1111-111111111111',
        '  pnpm --filter @vetios/web run import:supervised-cases -- --tenant-id 11111111-1111-1111-1111-111111111111 --emit-sql --output ../../infra/supabase/seeds/002_supervised_training_pack.sql',
    ].join('\n'));
}

function parseStructuredCases(rawText) {
    const lines = rawText
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const rows = [];
    let current = null;

    for (const line of lines) {
        if (line === 'Plain text' || /^\d+\)\s/.test(line)) {
            continue;
        }

        const separator = line.indexOf(':');
        if (separator <= 0) {
            continue;
        }

        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();

        if (!SUPPORTED_FIELDS.includes(key)) {
            continue;
        }

        if (key === 'CASE_ID') {
            if (current && current.CASE_ID) {
                rows.push(current);
            }
            current = {};
        }

        if (!current) {
            current = {};
        }

        current[key] = value;
    }

    if (current && current.CASE_ID) {
        rows.push(current);
    }

    return rows;
}

function normalizeCase(entry, args) {
    const importedAt = new Date().toISOString();
    const caseKey = `supervised:${entry.CASE_ID}`;
    const symptomVector = splitList(entry.SYMPTOM_VECTOR);
    const differentials = dedupeList([entry.FINAL_DIAGNOSIS, ...splitList(entry.DIFFERENTIALS)]);
    const emergencyFlags = splitList(entry.EMERGENCY_FLAGS);
    const supportingEvidence = splitList(entry.SUPPORTING_EVIDENCE);
    const recommendedTests = splitList(entry.RECOMMENDED_TESTS);
    const riskFactors = splitList(entry.RISK_FACTORS);
    const physicalExam = splitList(entry.PHYSICAL_EXAM);
    const labFindings = splitList(entry.LAB_FINDINGS);
    const severity = normalizeSeverity(entry.SEVERITY);
    const emergencyLevel = mapEmergencyLevel(severity);
    const severityScore = mapSeverityScore(severity);
    const triagePriority = mapTriagePriority(emergencyLevel);
    const species = normalizeSpecies(entry.SPECIES);
    const displaySpecies = species.display;
    const canonicalSpecies = species.canonical;
    const caseId = deterministicUuid(`${args.tenantId}:clinical-case:${entry.CASE_ID}`);
    const inferenceId = deterministicUuid(`${args.tenantId}:inference:${entry.CASE_ID}`);
    const outcomeId = deterministicUuid(`${args.tenantId}:outcome:${entry.CASE_ID}`);
    const inputSignature = {
        species: displaySpecies,
        breed: entry.BREED || null,
        symptoms: symptomVector,
        metadata: {
            case_id: entry.CASE_ID,
            age_group: entry.AGE_GROUP || null,
            sex: entry.SEX || null,
            history: entry.HISTORY || null,
            presenting_complaint: entry.PRESENTING_COMPLAINT || null,
            physical_exam: physicalExam,
            lab_findings: labFindings,
            risk_factors: riskFactors,
            emergency_flags: emergencyFlags,
            source_topic: entry.SOURCE_TOPIC || null,
            training_origin: 'pdf_supervised_seed',
        },
    };

    const caseRow = {
        id: caseId,
        tenant_id: args.tenantId,
        user_id: args.tenantId,
        clinic_id: args.clinicId,
        source_module: args.sourceModule,
        case_key: caseKey,
        source_case_reference: entry.CASE_ID,
        species: canonicalSpecies,
        species_raw: entry.SPECIES || null,
        species_canonical: canonicalSpecies,
        species_display: displaySpecies,
        breed: entry.BREED || null,
        symptom_vector: symptomVector,
        symptom_summary: entry.PRESENTING_COMPLAINT || joinList(symptomVector),
        symptom_text_raw: joinList(symptomVector),
        symptoms_raw: joinList(symptomVector),
        symptoms_normalized: symptomVector,
        symptom_vector_normalized: buildBooleanMap(symptomVector),
        metadata: {
            case_id: entry.CASE_ID,
            age_group: entry.AGE_GROUP || null,
            sex: entry.SEX || null,
            history: entry.HISTORY || null,
            risk_factors: riskFactors,
            physical_exam: physicalExam,
            lab_findings: labFindings,
            source_topic: entry.SOURCE_TOPIC || null,
            prognosis: entry.PROGNOSIS || null,
            initial_management: entry.INITIAL_MANAGEMENT || null,
            recommended_tests: recommendedTests,
            supporting_evidence: supportingEvidence,
            emergency_flags: emergencyFlags,
            differentials,
        },
        patient_metadata: {
            age_group: entry.AGE_GROUP || null,
            sex: entry.SEX || null,
            breed: entry.BREED || null,
        },
        latest_input_signature: inputSignature,
        primary_condition_class: entry.PRIMARY_CONDITION_CLASS || null,
        top_diagnosis: entry.FINAL_DIAGNOSIS || null,
        predicted_diagnosis: entry.FINAL_DIAGNOSIS || null,
        confirmed_diagnosis: entry.FINAL_DIAGNOSIS || null,
        label_type: 'expert',
        diagnosis_confidence: 0.99,
        severity_score: severityScore,
        emergency_level: emergencyLevel,
        triage_priority: triagePriority,
        contradiction_score: 0,
        contradiction_flags: [],
        adversarial_case: false,
        adversarial_case_type: null,
        uncertainty_notes: [],
        case_cluster: entry.SOURCE_TOPIC || entry.PRIMARY_CONDITION_CLASS || 'Supervised Seed',
        model_version: args.modelVersion,
        telemetry_status: 'learning_ready',
        ingestion_status: 'accepted',
        invalid_case: false,
        validation_error_code: null,
        inference_event_count: 1,
        first_inference_at: importedAt,
        last_inference_at: importedAt,
        created_at: importedAt,
        updated_at: importedAt,
    };

    const inferenceRow = {
        id: inferenceId,
        tenant_id: args.tenantId,
        user_id: args.tenantId,
        clinic_id: args.clinicId,
        case_id: caseId,
        source_module: args.sourceModule,
        model_name: args.modelName,
        model_version: args.modelVersion,
        input_signature: inputSignature,
        output_payload: buildSyntheticOutput({
            caseId: entry.CASE_ID,
            primaryConditionClass: entry.PRIMARY_CONDITION_CLASS,
            finalDiagnosis: entry.FINAL_DIAGNOSIS,
            differentials,
            severityScore,
            emergencyLevel,
            supportingEvidence,
            recommendedTests,
            initialManagement: entry.INITIAL_MANAGEMENT,
            prognosis: entry.PROGNOSIS,
            sourceTopic: entry.SOURCE_TOPIC,
        }),
        confidence_score: 0.99,
        uncertainty_metrics: {
            imported_supervised_case: true,
            source_topic: entry.SOURCE_TOPIC || null,
        },
        inference_latency_ms: 1,
        created_at: importedAt,
    };

    const outcomeRow = {
        id: outcomeId,
        tenant_id: args.tenantId,
        user_id: args.tenantId,
        clinic_id: args.clinicId,
        case_id: caseId,
        source_module: args.sourceModule,
        inference_event_id: inferenceId,
        outcome_type: 'supervised_label',
        outcome_payload: {
            case_id: entry.CASE_ID,
            confirmed_diagnosis: entry.FINAL_DIAGNOSIS || null,
            final_diagnosis: entry.FINAL_DIAGNOSIS || null,
            primary_condition_class: entry.PRIMARY_CONDITION_CLASS || null,
            severity: severity,
            severity_score: severityScore,
            emergency_level: emergencyLevel,
            emergency_flags: emergencyFlags,
            differentials,
            supporting_evidence: supportingEvidence,
            recommended_tests: recommendedTests,
            initial_management: entry.INITIAL_MANAGEMENT || null,
            prognosis: entry.PROGNOSIS || null,
            source_topic: entry.SOURCE_TOPIC || null,
            label_type: 'expert',
        },
        outcome_timestamp: importedAt,
        label_type: 'expert',
        created_at: importedAt,
    };

    return {
        caseId: entry.CASE_ID,
        caseKey,
        importedAt,
        caseRow,
        inferenceRow,
        outcomeRow,
    };
}

function buildAdversarialRows(rows, args) {
    const byCaseId = new Map(rows.map((row) => [row.caseId, row]));

    return ADVERSARIAL_VARIANTS
        .map((variant) => {
            const base = byCaseId.get(variant.baseCaseId);
            if (!base) {
                return null;
            }

            return {
                caseId: variant.caseId,
                baseCaseId: variant.baseCaseId,
                baseCaseUuid: base.caseRow.id,
                importedAt: base.importedAt,
                simulationRow: {
                    id: deterministicUuid(`${args.tenantId}:simulation:${variant.caseId}`),
                    tenant_id: args.tenantId,
                    user_id: args.tenantId,
                    clinic_id: args.clinicId,
                    case_id: base.caseRow.id,
                    source_module: args.sourceModule,
                    simulation_type: 'seeded_adversarial_case',
                    simulation_parameters: {
                        seed_case_id: variant.caseId,
                        base_case_id: variant.baseCaseId,
                        noise_level: variant.noiseLevel,
                        expected_behavior: variant.expectedBehavior,
                        imported_supervised_case: true,
                    },
                    scenario: {
                        contradictory_signals: variant.contradictorySignals,
                        target_diagnosis: base.caseRow.confirmed_diagnosis,
                        base_case_key: base.caseKey,
                        source_topic: base.caseRow.metadata?.source_topic || null,
                    },
                    triggered_inference_id: base.inferenceRow.id,
                    inference_output: {
                        expected_behavior: variant.expectedBehavior,
                        reference_output: base.inferenceRow.output_payload,
                        simulation_seed: true,
                    },
                    failure_mode: null,
                    created_at: base.importedAt,
                },
            };
        })
        .filter(Boolean);
}

function buildSyntheticOutput(input) {
    const weightedDiffs = assignProbabilities(input.differentials).map((entry) => ({
        name: entry.name,
        probability: entry.probability,
    }));

    return {
        diagnosis: {
            primary_condition_class: input.primaryConditionClass || null,
            top_differentials: weightedDiffs,
        },
        risk_assessment: {
            severity_score: input.severityScore,
            emergency_level: input.emergencyLevel,
        },
        contradiction_score: 0,
        contradiction_reasons: [],
        uncertainty_notes: [],
        supporting_evidence: input.supportingEvidence,
        recommended_tests: input.recommendedTests,
        initial_management: input.initialManagement || null,
        prognosis: input.prognosis || null,
        source_topic: input.sourceTopic || null,
        pipeline_trace: ['supervised_import'],
        import_metadata: {
            case_id: input.caseId,
            imported_supervised_case: true,
        },
    };
}

function assignProbabilities(items) {
    const unique = dedupeList(items);
    const weights = unique.map((name, index) => ({ name, weight: Math.max(unique.length - index, 1) }));
    const total = weights.reduce((sum, entry) => sum + entry.weight, 0);

    return weights.map((entry) => ({
        name: entry.name,
        probability: round(entry.weight / total, 4),
    }));
}

function splitList(value) {
    if (!value || typeof value !== 'string') {
        return [];
    }
    return value
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function joinList(values) {
    return values.join('; ');
}

function dedupeList(values) {
    const seen = new Set();
    const output = [];
    for (const value of values) {
        if (!value || typeof value !== 'string') continue;
        const normalized = value.trim();
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(normalized);
    }
    return output;
}

function buildBooleanMap(values) {
    const map = {};
    for (const value of values) {
        map[value] = true;
    }
    return map;
}

function normalizeSpecies(value) {
    const raw = (value || '').trim().toLowerCase();
    if (raw === 'dog') {
        return { canonical: 'Canis lupus familiaris', display: 'Dog' };
    }
    if (raw === 'cat') {
        return { canonical: 'Felis catus', display: 'Cat' };
    }
    if (raw === 'horse') {
        return { canonical: 'Equus ferus caballus', display: 'Horse' };
    }
    if (raw === 'cow') {
        return { canonical: 'Bos taurus', display: 'Cow' };
    }
    return {
        canonical: value || 'Unknown',
        display: value || 'Unknown',
    };
}

function normalizeSeverity(value) {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized === 'critical') return 'Critical';
    if (normalized === 'high') return 'High';
    if (normalized === 'moderate') return 'Moderate';
    if (normalized === 'low') return 'Low';
    return value || 'Moderate';
}

function mapSeverityScore(severity) {
    switch ((severity || '').toLowerCase()) {
        case 'critical':
            return 0.95;
        case 'high':
            return 0.8;
        case 'moderate':
            return 0.5;
        case 'low':
            return 0.2;
        default:
            return 0.5;
    }
}

function mapEmergencyLevel(severity) {
    switch ((severity || '').toLowerCase()) {
        case 'critical':
            return 'CRITICAL';
        case 'high':
            return 'HIGH';
        case 'moderate':
            return 'MODERATE';
        case 'low':
            return 'LOW';
        default:
            return 'MODERATE';
    }
}

function mapTriagePriority(emergencyLevel) {
    switch (emergencyLevel) {
        case 'CRITICAL':
            return 'immediate';
        case 'HIGH':
            return 'urgent';
        case 'MODERATE':
            return 'standard';
        case 'LOW':
            return 'low';
        default:
            return 'standard';
    }
}

function deterministicUuid(input) {
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        `5${hash.slice(13, 16)}`,
        `${(parseInt(hash.slice(16, 17), 16) & 0x3 | 0x8).toString(16)}${hash.slice(17, 20)}`,
        hash.slice(20, 32),
    ].join('-');
}

function resolveSupabaseUrl() {
    const value = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!value) {
        throw new Error('Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.');
    }
    return value;
}

function resolveSupabaseKey() {
    const value = process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.SUPABASE_ANON_KEY
        || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!value) {
        throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, or NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }
    return value;
}

function round(value, precision) {
    return Number(value.toFixed(precision));
}

async function canAccessEdgeSimulationEvents(supabase) {
    const probe = await supabase
        .from('edge_simulation_events')
        .select('id')
        .limit(1);

    if (!probe.error) {
        return true;
    }

    if (/Could not find the table|relation .* does not exist|schema cache/i.test(probe.error.message)) {
        console.warn('Skipping adversarial event import: edge_simulation_events is missing in the target database.');
        return false;
    }

    throw new Error(`Failed to probe edge_simulation_events: ${probe.error.message}`);
}

function printDryRunSummary(rows, adversarialRows, args) {
    const bySpecies = {};
    const byClass = {};
    for (const row of rows) {
        const species = row.caseRow.species_display;
        const conditionClass = row.caseRow.primary_condition_class || 'Unknown';
        bySpecies[species] = (bySpecies[species] || 0) + 1;
        byClass[conditionClass] = (byClass[conditionClass] || 0) + 1;
    }

    console.log(JSON.stringify({
        tenant_id: args.tenantId,
        source_file: args.inputPath,
        dry_run: true,
        cases_parsed: rows.length,
        adversarial_variants: adversarialRows.length,
        species_breakdown: bySpecies,
        condition_class_breakdown: byClass,
        sample_case_ids: rows.slice(0, 5).map((row) => row.caseId),
    }, null, 2));
}

function emitSql(rows, adversarialRows, args) {
    const sql = buildSeedSql(rows, adversarialRows, args);
    if (args.outputPath) {
        fs.writeFileSync(args.outputPath, sql, 'utf8');
        console.log(JSON.stringify({
            tenant_id: args.tenantId,
            source_file: args.inputPath,
            emitted_sql: true,
            output_path: args.outputPath,
            cases_serialized: rows.length,
            adversarial_events_serialized: adversarialRows.length,
        }, null, 2));
        return;
    }

    process.stdout.write(sql);
}

function buildSeedSql(rows, adversarialRows, args) {
    const sections = [
        '-- =========================================================',
        '-- VETIOS SUPERVISED TRAINING PACK (SCHEMA-SAFE)',
        '-- Generated by apps/web/scripts/import-supervised-cases.cjs',
        '-- Maps structured rows into:',
        '--   1) public.clinical_cases',
        '--   2) public.ai_inference_events',
        '--   3) public.clinical_outcome_events',
        '--   4) public.edge_simulation_events (adversarial variants)',
        '-- =========================================================',
        '',
        `-- Tenant ID: ${args.tenantId}`,
        `-- Source file: ${args.inputPath}`,
        `-- Cases: ${rows.length}`,
        `-- Adversarial variants: ${adversarialRows.length}`,
        '',
        'begin;',
        '',
    ];

    if (adversarialRows.length > 0) {
        sections.push(renderEdgeSimulationSchemaPreamble());
        sections.push('');
    }

    for (const row of rows) {
        sections.push(renderCaseSql(row));
    }

    for (const row of adversarialRows) {
        sections.push(renderAdversarialSql(row));
    }

    sections.push('commit;');
    sections.push('');

    return sections.join('\n');
}

function renderCaseSql(row) {
    const caseRow = row.caseRow;
    const inferenceRow = row.inferenceRow;
    const outcomeRow = row.outcomeRow;

    return [
        `-- ${row.caseId}`,
        'WITH upsert_case AS (',
        '    INSERT INTO public.clinical_cases (',
        '        tenant_id,',
        '        user_id,',
        '        clinic_id,',
        '        source_module,',
        '        case_key,',
        '        source_case_reference,',
        '        species,',
        '        species_raw,',
        '        species_canonical,',
        '        species_display,',
        '        breed,',
        '        symptom_vector,',
        '        symptom_summary,',
        '        symptom_text_raw,',
        '        symptoms_raw,',
        '        symptoms_normalized,',
        '        symptom_vector_normalized,',
        '        metadata,',
        '        patient_metadata,',
        '        latest_input_signature,',
        '        primary_condition_class,',
        '        top_diagnosis,',
        '        predicted_diagnosis,',
        '        confirmed_diagnosis,',
        '        label_type,',
        '        diagnosis_confidence,',
        '        severity_score,',
        '        emergency_level,',
        '        triage_priority,',
        '        contradiction_score,',
        '        contradiction_flags,',
        '        adversarial_case,',
        '        adversarial_case_type,',
        '        uncertainty_notes,',
        '        case_cluster,',
        '        model_version,',
        '        telemetry_status,',
        '        ingestion_status,',
        '        invalid_case,',
        '        validation_error_code,',
        '        inference_event_count,',
        '        first_inference_at,',
        '        last_inference_at,',
        '        created_at,',
        '        updated_at',
        '    ) VALUES (',
        `        ${sqlUuid(caseRow.tenant_id)},`,
        `        ${sqlUuid(caseRow.user_id)},`,
        `        ${sqlUuid(caseRow.clinic_id)},`,
        `        ${sqlText(caseRow.source_module)},`,
        `        ${sqlText(caseRow.case_key)},`,
        `        ${sqlText(caseRow.source_case_reference)},`,
        `        ${sqlText(caseRow.species)},`,
        `        ${sqlText(caseRow.species_raw)},`,
        `        ${sqlText(caseRow.species_canonical)},`,
        `        ${sqlText(caseRow.species_display)},`,
        `        ${sqlText(caseRow.breed)},`,
        `        ${sqlTextArray(caseRow.symptom_vector)},`,
        `        ${sqlText(caseRow.symptom_summary)},`,
        `        ${sqlText(caseRow.symptom_text_raw)},`,
        `        ${sqlText(caseRow.symptoms_raw)},`,
        `        ${sqlTextArray(caseRow.symptoms_normalized)},`,
        `        ${sqlJson(caseRow.symptom_vector_normalized)},`,
        `        ${sqlJson(caseRow.metadata)},`,
        `        ${sqlJson(caseRow.patient_metadata)},`,
        `        ${sqlJson(caseRow.latest_input_signature)},`,
        `        ${sqlText(caseRow.primary_condition_class)},`,
        `        ${sqlText(caseRow.top_diagnosis)},`,
        `        ${sqlText(caseRow.predicted_diagnosis)},`,
        `        ${sqlText(caseRow.confirmed_diagnosis)},`,
        `        ${sqlText(caseRow.label_type)},`,
        `        ${sqlNumber(caseRow.diagnosis_confidence)},`,
        `        ${sqlNumber(caseRow.severity_score)},`,
        `        ${sqlText(caseRow.emergency_level)},`,
        `        ${sqlText(caseRow.triage_priority)},`,
        `        ${sqlNumber(caseRow.contradiction_score)},`,
        `        ${sqlTextArray(caseRow.contradiction_flags)},`,
        `        ${sqlBoolean(caseRow.adversarial_case)},`,
        `        ${sqlText(caseRow.adversarial_case_type)},`,
        `        ${sqlTextArray(caseRow.uncertainty_notes)},`,
        `        ${sqlText(caseRow.case_cluster)},`,
        `        ${sqlText(caseRow.model_version)},`,
        `        ${sqlText(caseRow.telemetry_status)},`,
        `        ${sqlText(caseRow.ingestion_status)},`,
        `        ${sqlBoolean(caseRow.invalid_case)},`,
        `        ${sqlText(caseRow.validation_error_code)},`,
        `        ${sqlInteger(caseRow.inference_event_count)},`,
        `        ${sqlTimestamp(caseRow.first_inference_at)},`,
        `        ${sqlTimestamp(caseRow.last_inference_at)},`,
        `        ${sqlTimestamp(caseRow.created_at)},`,
        `        ${sqlTimestamp(caseRow.updated_at)}`,
        '    )',
        '    ON CONFLICT (tenant_id, case_key) DO UPDATE SET',
        '        user_id = EXCLUDED.user_id,',
        '        clinic_id = EXCLUDED.clinic_id,',
        '        source_module = EXCLUDED.source_module,',
        '        source_case_reference = EXCLUDED.source_case_reference,',
        '        species = EXCLUDED.species,',
        '        species_raw = EXCLUDED.species_raw,',
        '        species_canonical = EXCLUDED.species_canonical,',
        '        species_display = EXCLUDED.species_display,',
        '        breed = EXCLUDED.breed,',
        '        symptom_vector = EXCLUDED.symptom_vector,',
        '        symptom_summary = EXCLUDED.symptom_summary,',
        '        symptom_text_raw = EXCLUDED.symptom_text_raw,',
        '        symptoms_raw = EXCLUDED.symptoms_raw,',
        '        symptoms_normalized = EXCLUDED.symptoms_normalized,',
        '        symptom_vector_normalized = EXCLUDED.symptom_vector_normalized,',
        '        metadata = EXCLUDED.metadata,',
        '        patient_metadata = EXCLUDED.patient_metadata,',
        '        latest_input_signature = EXCLUDED.latest_input_signature,',
        '        primary_condition_class = EXCLUDED.primary_condition_class,',
        '        top_diagnosis = EXCLUDED.top_diagnosis,',
        '        predicted_diagnosis = EXCLUDED.predicted_diagnosis,',
        '        confirmed_diagnosis = EXCLUDED.confirmed_diagnosis,',
        '        label_type = EXCLUDED.label_type,',
        '        diagnosis_confidence = EXCLUDED.diagnosis_confidence,',
        '        severity_score = EXCLUDED.severity_score,',
        '        emergency_level = EXCLUDED.emergency_level,',
        '        triage_priority = EXCLUDED.triage_priority,',
        '        contradiction_score = EXCLUDED.contradiction_score,',
        '        contradiction_flags = EXCLUDED.contradiction_flags,',
        '        adversarial_case = EXCLUDED.adversarial_case,',
        '        adversarial_case_type = EXCLUDED.adversarial_case_type,',
        '        uncertainty_notes = EXCLUDED.uncertainty_notes,',
        '        case_cluster = EXCLUDED.case_cluster,',
        '        model_version = EXCLUDED.model_version,',
        '        telemetry_status = EXCLUDED.telemetry_status,',
        '        ingestion_status = EXCLUDED.ingestion_status,',
        '        invalid_case = EXCLUDED.invalid_case,',
        '        validation_error_code = EXCLUDED.validation_error_code,',
        '        inference_event_count = EXCLUDED.inference_event_count,',
        '        first_inference_at = EXCLUDED.first_inference_at,',
        '        last_inference_at = EXCLUDED.last_inference_at,',
        '        updated_at = EXCLUDED.updated_at',
        '    RETURNING id',
        '),',
        'upsert_inference AS (',
        '    INSERT INTO public.ai_inference_events (',
        '        id,',
        '        tenant_id,',
        '        user_id,',
        '        clinic_id,',
        '        case_id,',
        '        source_module,',
        '        model_name,',
        '        model_version,',
        '        input_signature,',
        '        output_payload,',
        '        confidence_score,',
        '        uncertainty_metrics,',
        '        inference_latency_ms,',
        '        created_at',
        '    )',
        '    SELECT',
        `        ${sqlUuid(inferenceRow.id)},`,
        `        ${sqlUuid(inferenceRow.tenant_id)},`,
        `        ${sqlUuid(inferenceRow.user_id)},`,
        `        ${sqlUuid(inferenceRow.clinic_id)},`,
        '        upsert_case.id,',
        `        ${sqlText(inferenceRow.source_module)},`,
        `        ${sqlText(inferenceRow.model_name)},`,
        `        ${sqlText(inferenceRow.model_version)},`,
        `        ${sqlJson(inferenceRow.input_signature)},`,
        `        ${sqlJson(inferenceRow.output_payload)},`,
        `        ${sqlNumber(inferenceRow.confidence_score)},`,
        `        ${sqlJson(inferenceRow.uncertainty_metrics)},`,
        `        ${sqlInteger(inferenceRow.inference_latency_ms)},`,
        `        ${sqlTimestamp(inferenceRow.created_at)}`,
        '    FROM upsert_case',
        '    ON CONFLICT (id) DO UPDATE SET',
        '        tenant_id = EXCLUDED.tenant_id,',
        '        user_id = EXCLUDED.user_id,',
        '        clinic_id = EXCLUDED.clinic_id,',
        '        case_id = EXCLUDED.case_id,',
        '        source_module = EXCLUDED.source_module,',
        '        model_name = EXCLUDED.model_name,',
        '        model_version = EXCLUDED.model_version,',
        '        input_signature = EXCLUDED.input_signature,',
        '        output_payload = EXCLUDED.output_payload,',
        '        confidence_score = EXCLUDED.confidence_score,',
        '        uncertainty_metrics = EXCLUDED.uncertainty_metrics,',
        '        inference_latency_ms = EXCLUDED.inference_latency_ms,',
        '        created_at = EXCLUDED.created_at',
        '    RETURNING id',
        '),',
        'upsert_outcome AS (',
        '    INSERT INTO public.clinical_outcome_events (',
        '        id,',
        '        tenant_id,',
        '        user_id,',
        '        clinic_id,',
        '        case_id,',
        '        source_module,',
        '        inference_event_id,',
        '        outcome_type,',
        '        outcome_payload,',
        '        outcome_timestamp,',
        '        label_type,',
        '        created_at',
        '    )',
        '    SELECT',
        `        ${sqlUuid(outcomeRow.id)},`,
        `        ${sqlUuid(outcomeRow.tenant_id)},`,
        `        ${sqlUuid(outcomeRow.user_id)},`,
        `        ${sqlUuid(outcomeRow.clinic_id)},`,
        '        upsert_case.id,',
        `        ${sqlText(outcomeRow.source_module)},`,
        '        upsert_inference.id,',
        `        ${sqlText(outcomeRow.outcome_type)},`,
        `        ${sqlJson(outcomeRow.outcome_payload)},`,
        `        ${sqlTimestamp(outcomeRow.outcome_timestamp)},`,
        `        ${sqlText(outcomeRow.label_type)},`,
        `        ${sqlTimestamp(outcomeRow.created_at)}`,
        '    FROM upsert_case',
        '    CROSS JOIN upsert_inference',
        '    ON CONFLICT (id) DO UPDATE SET',
        '        tenant_id = EXCLUDED.tenant_id,',
        '        user_id = EXCLUDED.user_id,',
        '        clinic_id = EXCLUDED.clinic_id,',
        '        case_id = EXCLUDED.case_id,',
        '        source_module = EXCLUDED.source_module,',
        '        inference_event_id = EXCLUDED.inference_event_id,',
        '        outcome_type = EXCLUDED.outcome_type,',
        '        outcome_payload = EXCLUDED.outcome_payload,',
        '        outcome_timestamp = EXCLUDED.outcome_timestamp,',
        '        label_type = EXCLUDED.label_type,',
        '        created_at = EXCLUDED.created_at',
        '    RETURNING id',
        ')',
        'UPDATE public.clinical_cases',
        'SET',
        '    latest_inference_event_id = (SELECT id FROM upsert_inference),',
        '    latest_outcome_event_id = (SELECT id FROM upsert_outcome),',
        `    last_inference_at = ${sqlTimestamp(row.importedAt)},`,
        `    updated_at = ${sqlTimestamp(row.importedAt)}`,
        'WHERE id = (SELECT id FROM upsert_case);',
        '',
    ].join('\n');
}

function renderAdversarialSql(row) {
    const simulationRow = row.simulationRow;

    return [
        `-- ${row.caseId}`,
        'INSERT INTO public.edge_simulation_events (',
        '    id,',
        '    tenant_id,',
        '    user_id,',
        '    clinic_id,',
        '    case_id,',
        '    source_module,',
        '    simulation_type,',
        '    simulation_parameters,',
        '    scenario,',
        '    triggered_inference_id,',
        '    inference_output,',
        '    failure_mode,',
        '    created_at',
        ') VALUES (',
        `    ${sqlUuid(simulationRow.id)},`,
        `    ${sqlUuid(simulationRow.tenant_id)},`,
        `    ${sqlUuid(simulationRow.user_id)},`,
        `    ${sqlUuid(simulationRow.clinic_id)},`,
        `    ${sqlUuid(simulationRow.case_id)},`,
        `    ${sqlText(simulationRow.source_module)},`,
        `    ${sqlText(simulationRow.simulation_type)},`,
        `    ${sqlJson(simulationRow.simulation_parameters)},`,
        `    ${sqlJson(simulationRow.scenario)},`,
        `    ${sqlUuid(simulationRow.triggered_inference_id)},`,
        `    ${sqlJson(simulationRow.inference_output)},`,
        `    ${sqlText(simulationRow.failure_mode)},`,
        `    ${sqlTimestamp(simulationRow.created_at)}`,
        ')',
        'ON CONFLICT (id) DO UPDATE SET',
        '    tenant_id = EXCLUDED.tenant_id,',
        '    user_id = EXCLUDED.user_id,',
        '    clinic_id = EXCLUDED.clinic_id,',
        '    case_id = EXCLUDED.case_id,',
        '    source_module = EXCLUDED.source_module,',
        '    simulation_type = EXCLUDED.simulation_type,',
        '    simulation_parameters = EXCLUDED.simulation_parameters,',
        '    scenario = EXCLUDED.scenario,',
        '    triggered_inference_id = EXCLUDED.triggered_inference_id,',
        '    inference_output = EXCLUDED.inference_output,',
        '    failure_mode = EXCLUDED.failure_mode,',
        '    created_at = EXCLUDED.created_at;',
        '',
        'UPDATE public.clinical_cases',
        'SET',
        `    latest_simulation_event_id = ${sqlUuid(simulationRow.id)},`,
        `    updated_at = ${sqlTimestamp(row.importedAt)}`,
        `WHERE id = ${sqlUuid(row.baseCaseUuid)};`,
        '',
    ].join('\n');
}

function renderEdgeSimulationSchemaPreamble() {
    return [
        'create extension if not exists pgcrypto;',
        '',
        'create table if not exists public.edge_simulation_events (',
        '    id uuid primary key default gen_random_uuid(),',
        '    tenant_id uuid references public.tenants(id) on delete cascade,',
        '    user_id uuid,',
        '    clinic_id uuid,',
        '    case_id uuid references public.clinical_cases(id) on delete set null,',
        '    source_module text,',
        '    simulation_type text not null,',
        "    simulation_parameters jsonb not null default '{}'::jsonb,",
        "    scenario jsonb not null default '{}'::jsonb,",
        '    triggered_inference_id uuid references public.ai_inference_events(id) on delete set null,',
        '    inference_output jsonb,',
        '    failure_mode text,',
        '    created_at timestamptz not null default now()',
        ');',
        '',
        'alter table public.edge_simulation_events',
        '    add column if not exists tenant_id uuid,',
        '    add column if not exists user_id uuid,',
        '    add column if not exists clinic_id uuid,',
        '    add column if not exists case_id uuid,',
        '    add column if not exists source_module text,',
        '    add column if not exists simulation_type text,',
        "    add column if not exists simulation_parameters jsonb default '{}'::jsonb,",
        "    add column if not exists scenario jsonb default '{}'::jsonb,",
        '    add column if not exists triggered_inference_id uuid,',
        '    add column if not exists inference_output jsonb,',
        '    add column if not exists failure_mode text,',
        '    add column if not exists created_at timestamptz default now();',
        '',
        'alter table public.clinical_cases',
        '    add column if not exists latest_simulation_event_id uuid;',
        '',
        'create index if not exists idx_edge_simulation_events_tenant_case_seed',
        '    on public.edge_simulation_events (tenant_id, case_id, created_at desc);',
        '',
        "notify pgrst, 'reload schema';",
    ].join('\n');
}

function sqlUuid(value) {
    if (!value) {
        return 'null';
    }
    return `${sqlQuote(value)}::uuid`;
}

function sqlTimestamp(value) {
    if (!value) {
        return 'null';
    }
    return `${sqlQuote(value)}::timestamptz`;
}

function sqlText(value) {
    if (value === null || value === undefined) {
        return 'null';
    }
    return sqlQuote(value);
}

function sqlNumber(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return 'null';
    }
    return String(Number(value));
}

function sqlInteger(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return 'null';
    }
    return String(Math.trunc(Number(value)));
}

function sqlBoolean(value) {
    if (value === null || value === undefined) {
        return 'null';
    }
    return value ? 'true' : 'false';
}

function sqlTextArray(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return 'ARRAY[]::text[]';
    }
    return `ARRAY[${values.map((value) => sqlQuote(String(value))).join(', ')}]::text[]`;
}

function sqlJson(value) {
    if (value === null || value === undefined) {
        return 'null';
    }
    return `${sqlQuote(JSON.stringify(value))}::jsonb`;
}

function sqlQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}
