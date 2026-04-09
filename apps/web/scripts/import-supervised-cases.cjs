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
    if (args.dryRun) {
        printDryRunSummary(normalized, args);
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

    console.log(JSON.stringify({
        tenant_id: args.tenantId,
        source_file: args.inputPath,
        cases_processed: normalized.length,
        clinical_cases_inserted: insertedCases,
        clinical_cases_updated: updatedCases,
        inference_events_upserted: insertedInferences,
        outcome_events_upserted: insertedOutcomes,
    }, null, 2));
}

function parseArgs(argv) {
    const parsed = {
        tenantId: '',
        clinicId: null,
        inputPath: DEFAULT_INPUT,
        dryRun: false,
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
        '  node scripts/import-supervised-cases.cjs --tenant-id <uuid> [--clinic-id <uuid>] [--input <path>] [--dry-run]',
        '',
        'Examples:',
        '  node scripts/import-supervised-cases.cjs --tenant-id 11111111-1111-1111-1111-111111111111 --dry-run',
        '  pnpm --filter @vetios/web run import:supervised-cases -- --tenant-id 11111111-1111-1111-1111-111111111111',
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

function printDryRunSummary(rows, args) {
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
        species_breakdown: bySpecies,
        condition_class_breakdown: byClass,
        sample_case_ids: rows.slice(0, 5).map((row) => row.caseId),
    }, null, 2));
}
