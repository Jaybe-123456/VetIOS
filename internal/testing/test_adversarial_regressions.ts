import assert from 'node:assert/strict';
import { extractClinicalSignals } from '../../apps/web/lib/ai/clinicalSignals.ts';
import { detectContradictions } from '../../apps/web/lib/ai/contradictionEngine.ts';
import { runInferencePipeline } from '../../apps/web/lib/ai/inferenceOrchestrator.ts';

type PipelineResult = Awaited<ReturnType<typeof runInferencePipeline>>;

function getDifferentialNames(result: PipelineResult): string[] {
    const diagnosis = result.output_payload.diagnosis as Record<string, unknown>;
    const differentials = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials as Array<{ name?: string }>
        : [];
    return differentials.map((entry) => entry.name ?? '').filter(Boolean);
}

function getConfidence(result: PipelineResult): number {
    const diagnosis = result.output_payload.diagnosis as Record<string, unknown>;
    return typeof diagnosis.confidence_score === 'number' ? diagnosis.confidence_score : 0;
}

function getEmergencyLevel(result: PipelineResult): string {
    const risk = result.output_payload.risk_assessment as Record<string, unknown>;
    return typeof risk.emergency_level === 'string' ? risk.emergency_level : 'UNKNOWN';
}

function getPrimaryConditionClass(result: PipelineResult): string {
    const diagnosis = result.output_payload.diagnosis as Record<string, unknown>;
    return typeof diagnosis.primary_condition_class === 'string' ? diagnosis.primary_condition_class : 'UNKNOWN';
}

function getSpread(result: PipelineResult): number {
    const spread = result.output_payload.differential_spread as Record<string, unknown> | undefined;
    return typeof spread?.spread === 'number' ? spread.spread : 0;
}

function includesAny(values: string[], candidates: string[]): boolean {
    const normalizedValues = values.map((value) => value.toLowerCase());
    return candidates.some((candidate) => normalizedValues.some((value) => value.includes(candidate.toLowerCase())));
}

async function main() {
    process.env.VETIOS_DEV_BYPASS = 'true';
    process.env.VETIOS_LOCAL_REASONER = 'true';

    const gdvBaseline = await runInferencePipeline({
        model: 'gpt-4o-mini',
        rawInput: {
            species: 'dog',
            breed: 'Great Dane',
            weight_kg: 60,
            age: '5 years',
            duration_days: 0.1,
            abdominal_distension: true,
            productive_vomiting: false,
            appetite_status: 'anorexic',
            symptoms: ['unproductive retching', 'abdominal distension', 'collapse', 'tachycardia', 'pale mucous membranes'],
        },
        inputMode: 'json',
    });
    assert.ok(getDifferentialNames(gdvBaseline)[0]?.includes('Gastric Dilatation-Volvulus'), 'GDV baseline should keep GDV at the top');
    assert.ok(['CRITICAL', 'HIGH'].includes(getEmergencyLevel(gdvBaseline)), 'GDV baseline should remain high severity');
    assert.ok((gdvBaseline.output_payload.contradiction_score as number) < 0.15, 'GDV baseline should have low contradiction score');
    assert.equal(gdvBaseline.output_payload.abstain_recommendation, false, 'GDV baseline should not abstain');

    const gdvWithDistractors = await runInferencePipeline({
        model: 'gpt-4o-mini',
        rawInput: {
            species: 'dog',
            breed: 'Standard Poodle',
            weight_kg: 25,
            duration_days: 0.2,
            abdominal_distension: true,
            symptoms: ['unproductive retching', 'abdominal distension', 'diarrhea', 'fever', 'lethargy'],
        },
        inputMode: 'json',
    });
    const mildNames = getDifferentialNames(gdvWithDistractors);
    assert.ok(mildNames.slice(0, 3).some((name) => name.includes('Gastric Dilatation-Volvulus')), 'GDV with distractors should keep GDV in the top 3');
    assert.ok(!mildNames[0]?.includes('Gastroenteritis'), 'Generic gastroenteritis should not dominate over GDV signature features');
    assert.ok(getConfidence(gdvWithDistractors) <= getConfidence(gdvBaseline), 'Distractors should reduce confidence slightly');

    const gdvHardContradictions = await runInferencePipeline({
        model: 'gpt-4o-mini',
        rawInput: {
            species: 'dog',
            breed: 'Dachshund',
            weight_kg: 8,
            duration_days: 5,
            abdominal_distension: false,
            productive_vomiting: true,
            appetite_status: 'normal',
            symptoms: [
                'unproductive retching',
                'abdominal distension',
                'hypersalivation',
                'tachycardia',
                'dyspnea',
                'weakness',
                'pale mucous membranes',
                'collapse',
                'diarrhea',
                'fever',
            ],
        },
        inputMode: 'json',
    });
    const hardNames = getDifferentialNames(gdvHardContradictions);
    assert.ok((gdvHardContradictions.output_payload.contradiction_score as number) >= 0.7, 'Hard contradictions should elevate contradiction score');
    assert.ok((gdvHardContradictions.output_payload.confidence_cap as number) <= 0.45, 'Hard contradictions should trigger the aggressive confidence cap');
    assert.equal(gdvHardContradictions.output_payload.abstain_recommendation, true, 'Hard contradictions should allow abstention');
    assert.equal(getEmergencyLevel(gdvHardContradictions), 'CRITICAL', 'Hard contradictions must not suppress emergency severity');
    assert.ok(
        includesAny(hardNames, [
            'Gastric Dilatation-Volvulus',
            'Acute Mechanical Emergency',
            'Simple Gastric Dilatation',
            'Mesenteric Volvulus',
            'Foreign Body Obstruction',
        ]),
        'Hard contradictions should still preserve a mechanical emergency in the top differential set',
    );

    const distemperContradiction = await runInferencePipeline({
        model: 'gpt-4o-mini',
        rawInput: {
            species: 'dog',
            breed: 'Mixed Rescue',
            weight_kg: 18,
            age: '2 weeks',
            duration_days: 7,
            symptoms: ['myoclonus', 'seizures', 'nasal discharge', 'fever', 'pneumonia', 'weakness'],
        },
        inputMode: 'json',
    });
    const distemperNames = getDifferentialNames(distemperContradiction);
    assert.ok(distemperNames.slice(0, 3).some((name) => name.includes('Canine Distemper')), 'Distemper contradiction case should preserve the distemper pattern');
    assert.ok((distemperContradiction.output_payload.contradiction_score as number) >= 0.15, 'Distemper contradiction case should raise contradiction score');
    assert.ok(getConfidence(distemperContradiction) < 0.7, 'Distemper contradiction case should reduce confidence');

    const kennelCoughBaseline = await runInferencePipeline({
        model: 'gpt-4o-mini',
        rawInput: {
            species: 'dog',
            breed: 'Yorkshire Terrier',
            weight_kg: 4.5,
            age: '6 years',
            duration_days: 4,
            kennel_exposure: true,
            symptoms: [
                'honking cough',
                'dry hacking cough',
                'nasal discharge',
                'ocular discharge',
                'mild fever',
            ],
        },
        inputMode: 'json',
    });
    const kennelBaselineNames = getDifferentialNames(kennelCoughBaseline);
    assert.ok(
        kennelBaselineNames.slice(0, 3).some((name) => name.includes('Canine Infectious Tracheobronchitis')),
        'Kennel cough baseline should keep infectious tracheobronchitis in the top 3',
    );
    assert.ok(
        includesAny(kennelBaselineNames, ['Tracheal Collapse', 'Bronchitis']),
        'Kennel cough baseline should preserve the airway differential set',
    );
    assert.equal(getPrimaryConditionClass(kennelCoughBaseline), 'Infectious', 'Kennel cough baseline should bias the class toward infectious upper-airway disease');

    const kennelCoughContradiction = await runInferencePipeline({
        model: 'gpt-4o-mini',
        rawInput: {
            species: 'dog',
            breed: 'Yorkshire Terrier',
            weight_kg: 4.5,
            age: '6 years',
            duration_days: 28,
            isolated_environment: true,
            fever: false,
            symptoms: [
                'honking cough',
                'dry hacking cough',
                'nasal discharge',
                'ocular discharge',
                'mild fever',
                'lethargy',
            ],
        },
        inputMode: 'json',
    });
    const kennelContradictionNames = getDifferentialNames(kennelCoughContradiction);
    assert.ok(
        kennelContradictionNames.slice(0, 3).some((name) => name.includes('Canine Infectious Tracheobronchitis')),
        'Contradictory kennel cough case should still preserve infectious tracheobronchitis in the top 3',
    );
    assert.ok(
        includesAny(kennelContradictionNames, ['Tracheal Collapse', 'Bronchitis']),
        'Contradictory kennel cough case should keep at least one airway fallback differential visible',
    );
    assert.ok(
        (kennelCoughContradiction.output_payload.contradiction_score as number) >= 0.25,
        'Contradictory kennel cough case should produce a non-zero contradiction burden',
    );
    assert.ok(
        getConfidence(kennelCoughContradiction) < getConfidence(kennelCoughBaseline),
        'Contradictions should lower confidence for the kennel cough case',
    );
    assert.notEqual(
        getPrimaryConditionClass(kennelCoughContradiction),
        'Neoplastic',
        'Upper-airway contradiction noise should not drift into neoplastic classing',
    );

    const negatedFeverSignals = extractClinicalSignals({
        species: 'dog',
        symptoms: ['honking cough', 'no fever', 'nasal discharge'],
        isolated_environment: true,
    });
    assert.equal(negatedFeverSignals.evidence.fever.present, false, 'Explicit fever negation should block positive fever attribution');
    assert.ok(negatedFeverSignals.evidence.fever.negated_terms.length > 0, 'Explicit fever negation should be retained for contradiction reasoning');

    const activityConflict = detectContradictions({
        species: 'dog',
        activity_status: 'normal',
        symptoms: ['collapse', 'cyanosis', 'tachycardia'],
    });
    assert.ok(activityConflict.contradiction_score >= 0.2, 'Normal activity should conflict with collapse/cyanosis severity');
    assert.ok(
        activityConflict.contradiction_reasons.some((reason) => reason.includes('normal activity status')),
        'Activity contradiction should be explained in the contradiction reasons',
    );

    const unknownMixed = await runInferencePipeline({
        model: 'gpt-4o-mini',
        rawInput: {
            species: 'dog',
            breed: 'Mutt',
            weight_kg: 15,
            symptoms: ['vague lethargy', 'mild diarrhea once', 'drank slightly more water'],
            duration_days: 2,
        },
        inputMode: 'json',
    });
    assert.ok(getSpread(unknownMixed) < 0.12, 'Unknown mixed case should keep a wide differential');
    assert.equal(unknownMixed.output_payload.abstain_recommendation, true, 'Unknown mixed case should allow abstention under broad uncertainty');
    assert.ok(getEmergencyLevel(unknownMixed) === 'LOW' || getEmergencyLevel(unknownMixed) === 'MODERATE', 'Unknown mixed case should preserve severity independence');

    console.log('Adversarial regression suite passed.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
