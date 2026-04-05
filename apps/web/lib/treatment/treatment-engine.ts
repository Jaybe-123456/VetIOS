import { getTreatmentProtocolsForCondition } from './treatment-registry';
import type {
    InferenceRequest,
    SelectedTreatmentPlan,
    TreatmentPhase,
    TreatmentProtocol,
    VeterinaryCondition,
} from '@/lib/inference/types';

export interface TreatmentContext {
    geographic_region: string;
    resource_level: 'primary' | 'secondary' | 'referral' | 'specialist';
    owner_compliance_estimate?: 'high' | 'moderate' | 'low';
    concurrent_conditions: string[];
    patient_signalment: {
        age_category: 'puppy' | 'adult' | 'senior' | 'geriatric';
        reproductive_status: 'intact_male' | 'intact_female' | 'neutered';
        weight_kg: number;
    };
}

const PHASE_ORDER: TreatmentPhase[] = [
    'acute_stabilisation',
    'pre_treatment_preparation',
    'definitive_treatment',
    'adjunctive',
    'long_term_management',
    'secondary_prevention',
    'prophylactic',
    'palliative',
];

const PHASE_LABELS: Record<TreatmentPhase, string> = {
    acute_stabilisation: 'Acute Stabilisation',
    pre_treatment_preparation: 'Pre-treatment Preparation',
    definitive_treatment: 'Definitive Treatment',
    adjunctive: 'Adjunctive Care',
    long_term_management: 'Long-term Management',
    secondary_prevention: 'Secondary Prevention',
    prophylactic: 'Prophylaxis',
    palliative: 'Palliative Care',
};

export function selectTreatmentProtocol(
    condition: VeterinaryCondition,
    severityClass: string | null,
    request: InferenceRequest,
    context: TreatmentContext,
): SelectedTreatmentPlan {
    const allProtocols = getTreatmentProtocolsForCondition(condition.id);
    const contraindicated: Array<{ treatment: string; reason: string }> = [];

    const allowed = allProtocols.filter((protocol) => {
        if (severityClass && protocol.severity_scope.length > 0 && !protocol.severity_scope.includes('all') && !protocol.severity_scope.includes(severityClass)) {
            return false;
        }

        const contraindication = protocol.drug?.contraindications.find((entry) =>
            context.concurrent_conditions.some((conditionName) => entry.toLowerCase().includes(conditionName.toLowerCase())),
        );
        if (contraindication) {
            contraindicated.push({ treatment: protocol.protocol_name, reason: contraindication });
            return false;
        }

        if (protocol.drug?.availability && !isAvailableInRegion(protocol, context.geographic_region)) {
            return true;
        }

        return true;
    });

    const sorted = allowed.sort((left, right) => compareProtocols(left, right, context.geographic_region));
    const grouped = PHASE_ORDER.flatMap((phase) => {
        const protocols = sorted.filter((protocol) => protocol.treatment_phase === phase);
        if (protocols.length === 0) {
            return [];
        }

        return [{
            phase,
            phase_label: PHASE_LABELS[phase],
            timing: timingLabel(phase),
            protocols: protocols.map((protocol) => buildSelectedProtocol(protocol, request, context)),
            phase_notes: phaseNote(condition.id, phase),
        }];
    });

    if (condition.id === 'dirofilariosis_canine' && severityClass === 'IV') {
        contraindicated.push({
            treatment: 'Melarsomine split-dose adulticide protocol',
            reason: 'Melarsomine contraindicated in caval syndrome - surgical extraction first',
        });
    }

    return {
        condition_name: condition.canonical_name,
        severity_class: severityClass,
        treatment_phases: grouped,
        monitoring_schedule: buildMonitoringSchedule(condition.id, severityClass),
        owner_instructions: buildOwnerInstructions(condition.id),
        prognosis: buildPrognosis(condition.id, severityClass),
        contraindicated_treatments: contraindicated,
        regional_availability_notes: buildRegionalAvailabilityNotes(sorted, context.geographic_region),
        total_estimated_cost_range: estimateCost(sorted),
    };
}

function compareProtocols(left: TreatmentProtocol, right: TreatmentProtocol, region: string) {
    const priorityOrder = ['essential', 'recommended', 'optional', 'consider_if'];
    const evidenceOrder = ['ia', 'ib', 'iia', 'iib', 'iii', 'iv'];

    const priorityDelta = priorityOrder.indexOf(left.priority) - priorityOrder.indexOf(right.priority);
    if (priorityDelta !== 0) {
        return priorityDelta;
    }

    const evidenceDelta = evidenceOrder.indexOf(left.evidence_level) - evidenceOrder.indexOf(right.evidence_level);
    if (evidenceDelta !== 0) {
        return evidenceDelta;
    }

    const leftAvailable = isAvailableInRegion(left, region) ? 0 : 1;
    const rightAvailable = isAvailableInRegion(right, region) ? 0 : 1;
    return leftAvailable - rightAvailable;
}

function isAvailableInRegion(protocol: TreatmentProtocol, region: string) {
    const availability = protocol.drug?.availability;
    if (!availability) {
        return true;
    }
    const normalized = region.toLowerCase();
    if (normalized.includes('nairobi') || normalized.includes('east_africa') || normalized.includes('kenya')) {
        return availability.africa_east ?? availability.global ?? true;
    }
    if (normalized.includes('south_africa')) {
        return availability.africa_south ?? availability.global ?? true;
    }
    if (normalized.includes('europe') || normalized.includes('mediterranean')) {
        return availability.europe ?? availability.global ?? true;
    }
    if (normalized.includes('usa') || normalized.includes('america')) {
        return availability.usa ?? availability.global ?? true;
    }
    return availability.global ?? true;
}

function buildSelectedProtocol(protocol: TreatmentProtocol, request: InferenceRequest, context: TreatmentContext) {
    const regimen = protocol.drug?.dosing.find((entry) =>
        !entry.severity_scope || entry.severity_scope.length === 0 || !context.concurrent_conditions || entry.severity_scope.includes('all'),
    ) ?? protocol.drug?.dosing[0];

    return {
        protocol_id: protocol.protocol_id,
        protocol_name: protocol.protocol_name,
        category: protocol.category,
        priority: protocol.priority,
        patient_specific_dose: regimen ? buildDoseString(regimen, request.weight_kg ?? context.patient_signalment.weight_kg) : undefined,
        duration: regimen?.duration ?? protocol.treatment_duration ?? 'Per protocol',
        route: regimen?.route ?? protocol.drug?.route.join(', ') ?? 'Supportive / non-drug',
        frequency: regimen?.frequency ?? 'Per protocol',
        evidence_summary: `${protocol.recommendation_grade}-grade recommendation backed by ${protocol.evidence_level.toUpperCase()} evidence.`,
        guideline_source: protocol.guideline_source,
        cautions_for_this_patient: [
            ...(protocol.drug?.precautions ?? []),
            ...(context.owner_compliance_estimate === 'low' && protocol.category === 'environmental_management'
                ? ['Owner compliance may limit effectiveness of strict rest instructions.']
                : []),
        ],
        drug_interactions_in_plan: protocol.drug?.drug_interactions ?? [],
        monitoring_required: protocol.drug?.monitoring_required ?? protocol.follow_up_protocol ?? [],
        expected_response: protocol.expected_outcomes,
    };
}

function buildDoseString(regimen: NonNullable<TreatmentProtocol['drug']>['dosing'][number], weightKg: number | undefined) {
    if (regimen.fixed_text) {
        return regimen.fixed_text;
    }
    if (weightKg == null || regimen.amount_per_kg == null || regimen.unit == null) {
        return regimen.notes ?? 'Weight-based per protocol';
    }

    if (regimen.amount_per_kg_high != null) {
        const low = weightKg * regimen.amount_per_kg;
        const high = weightKg * regimen.amount_per_kg_high;
        return `${weightKg.toFixed(1)} kg × ${regimen.amount_per_kg}-${regimen.amount_per_kg_high} ${regimen.unit}/kg = ${low.toFixed(1)}-${high.toFixed(1)} ${regimen.unit} per dose`;
    }

    const total = weightKg * regimen.amount_per_kg;
    return `${weightKg.toFixed(1)} kg × ${regimen.amount_per_kg} ${regimen.unit}/kg = ${total.toFixed(1)} ${regimen.unit} per dose`;
}

function timingLabel(phase: TreatmentPhase) {
    switch (phase) {
        case 'acute_stabilisation':
            return 'Immediately';
        case 'pre_treatment_preparation':
            return 'Day 1 to pre-definitive therapy';
        case 'definitive_treatment':
            return 'After stabilisation';
        case 'adjunctive':
            return 'Concurrent with primary therapy';
        case 'long_term_management':
            return 'After acute control';
        case 'secondary_prevention':
            return 'After definitive therapy';
        case 'prophylactic':
            return 'Ongoing prevention';
        default:
            return 'As clinically indicated';
    }
}

function phaseNote(conditionId: string, phase: TreatmentPhase) {
    if (conditionId === 'dirofilariosis_canine' && phase === 'acute_stabilisation') {
        return 'For caval syndrome, surgical extraction is the immediate priority. Melarsomine contraindicated in caval syndrome - surgical extraction first.';
    }
    if (conditionId === 'dirofilariosis_canine' && phase === 'definitive_treatment') {
        return 'Adulticide therapy must follow exercise restriction and pre-treatment preparation; do not skip the staged sequence.';
    }
    if (phase === 'acute_stabilisation') {
        return 'Stabilise the patient before escalation to definitive therapy.';
    }
    return 'Follow protocols in sequence and reassess before advancing phases.';
}

function buildMonitoringSchedule(conditionId: string, severityClass: string | null) {
    if (conditionId === 'dirofilariosis_canine') {
        return [
            { timepoint: 'Day 1', tests_required: ['Baseline CBC', 'Baseline chemistry', 'Thoracic radiographs'], clinical_parameters: ['Respiratory effort', 'Exercise tolerance'], expected_findings: 'Staging complete before adulticide.', action_if_abnormal: 'Escalate stabilisation and delay adulticide if unstable.' },
            { timepoint: 'Week 4', tests_required: ['Clinical recheck'], clinical_parameters: ['Resting respiratory rate', 'Inflammatory tolerance'], expected_findings: 'Ready for split-dose adulticide if stable.', action_if_abnormal: 'Continue rest and anti-inflammatory support.' },
            { timepoint: '6 months', tests_required: ['Heartworm antigen test', 'Knott or microfilaria test', 'Thoracic radiographs'], clinical_parameters: ['Cough resolution', 'Exercise tolerance'], expected_findings: 'Antigen negative with improving pulmonary lesions.', action_if_abnormal: 'Repeat adulticide protocol and reassess complications.' },
        ];
    }
    return [
        { timepoint: '2-4 weeks', tests_required: ['Condition-specific recheck'], clinical_parameters: ['Clinical response', 'Adverse effects'], expected_findings: 'Objective improvement from first-line therapy.', action_if_abnormal: 'Escalate diagnostics or switch protocol.' },
    ];
}

function buildOwnerInstructions(conditionId: string) {
    if (conditionId === 'dirofilariosis_canine') {
        return [
            'Maintain strict exercise restriction until the adulticide recovery window has passed.',
            'Watch for acute dyspnea, collapse, hemoptysis, or marked lethargy and seek emergency care immediately.',
            'Do not miss monthly heartworm prevention once initiated.',
            'Return for the 6-month antigen recheck even if the dog appears clinically improved.',
        ];
    }
    return ['Administer medications exactly as prescribed and return for scheduled monitoring.'];
}

function buildPrognosis(conditionId: string, severityClass: string | null) {
    if (conditionId === 'dirofilariosis_canine') {
        if (severityClass === 'IV') {
            return 'Guarded to poor without rapid referral for worm extraction; fair if stabilised and transitioned to staged adulticide.';
        }
        if (severityClass === 'III') {
            return 'Guarded but often fair with strict rest, pre-treatment optimisation, and staged adulticide.';
        }
        return 'Fair to good with adherence to exercise restriction, Wolbachia reduction, macrocyclic lactone prevention, and split-dose adulticide.';
    }
    return 'Variable; depends on response to definitive therapy and concurrent disease burden.';
}

function buildRegionalAvailabilityNotes(protocols: TreatmentProtocol[], region: string) {
    const constrained = protocols
        .filter((protocol) => !isAvailableInRegion(protocol, region))
        .map((protocol) => protocol.protocol_name);

    if (constrained.length === 0) {
        return 'All selected protocols are generally obtainable in the specified region.';
    }

    return `Some protocols may require referral sourcing or import in ${region}: ${constrained.join(', ')}.`;
}

function estimateCost(protocols: TreatmentProtocol[]) {
    const tiers = protocols.map((protocol) => protocol.drug?.cost_tier ?? 'low');
    if (tiers.includes('very_high')) {
        return 'very_high';
    }
    if (tiers.includes('high')) {
        return 'high';
    }
    if (tiers.includes('moderate')) {
        return 'moderate';
    }
    return 'low';
}
