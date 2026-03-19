/**
 * Emergency Rule Engine
 *
 * Safety layer that evaluates rigid clinical invariants (e.g. GDV pattern, shock signs).
 * Operates independently of the probabilistic AI model to ensure
 * critical situations are escalated even if the AI is uncertain.
 */

export type EmergencyLevel = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';

export interface EmergencyRuleResult {
    emergency_level: EmergencyLevel;
    severity_boost: number;
    emergency_rule_triggered: boolean;
    emergency_rule_reasons: string[];
    promoted_differentials: string[];
}

// ── Escalation keywords ───────────────────────────────────────────────────────
const ESCALATION_SIGNS = [
    'collapse',
    'pale mucous membranes',
    'pale gums',
    'tachycardia',
    'dyspnea',
    'difficulty breathing',
    'weakness',
    'shock',
    'cyanosis',
    'seizures',
    'status epilepticus',
    'unresponsive',
    'obtunded',
    'hemorrhage'
];

export function evaluateEmergencyRules(inputSignature: Record<string, unknown>): EmergencyRuleResult {
    const reasons: string[] = [];
    const promoted_differentials: string[] = [];
    let maxLevel: EmergencyLevel = 'LOW';
    let severityBoost = 0;

    const symptoms = extractAllText(inputSignature).toLowerCase();
    const isDog = (typeof inputSignature.species === 'string' && inputSignature.species.toLowerCase().includes('canine')) || 
                  (typeof inputSignature.species === 'string' && inputSignature.species.toLowerCase().includes('dog')) ||
                  (inputSignature.species == null); // Assume dog if unknown for safety if GDV signs present

    // ── Rule 1: GDV (Gastric Dilatation-Volvulus) ─────────────────────────────
    // IF: acute onset OR duration_hours <= 6
    // AND: abdominal distension OR symptom contains "abdominal distension"
    // AND: unproductive vomiting OR symptom contains "unproductive retching"
    const hasAbdominalDistension = symptoms.includes('abdominal distension') || symptoms.includes('bloated') || symptoms.includes('swollen abdomen');
    const hasUnproductiveVomiting = symptoms.includes('unproductive retching') || symptoms.includes('trying to vomit') || symptoms.includes('dry heaving');
    const hasAcuteOnset = symptoms.includes('acute') || symptoms.includes('sudden');
    let isAcuteDuration = false;
    
    // Check duration in metadata if present
    if (inputSignature.metadata && typeof inputSignature.metadata === 'object') {
        const meta = inputSignature.metadata as Record<string, unknown>;
        if (typeof meta.duration === 'string') {
            const dur = meta.duration.toLowerCase();
            if (dur.includes('hour') && parseInt(dur) <= 6) {
                isAcuteDuration = true;
            }
        }
    }

    if (isDog && hasAbdominalDistension && hasUnproductiveVomiting && (hasAcuteOnset || isAcuteDuration || symptoms.includes('hours'))) {
        reasons.push('GDV emergency rule activated: Abdominal distension + unproductive retching + acute onset.');
        promoted_differentials.push('Gastric Dilatation-Volvulus');
        maxLevel = 'CRITICAL';
        severityBoost = Math.max(severityBoost, 0.5);
    }

    // ── Rule 2: Escalation Features ───────────────────────────────────────────
    for (const sign of ESCALATION_SIGNS) {
        if (symptoms.includes(sign)) {
            reasons.push(`High-risk sign detected: ${sign}`);
            if (maxLevel !== 'CRITICAL') maxLevel = 'HIGH';
            severityBoost = Math.max(severityBoost, 0.3);
        }
    }

    // ── Rule 3: Toxins ────────────────────────────────────────────────────────
    const toxinKeywords = ['chocolate', 'grapes', 'raisins', 'xylitol', 'rat poison', 'antifreeze', 'lily', 'toxic ingestion', 'poisoning'];
    for (const toxin of toxinKeywords) {
        if (symptoms.includes(toxin)) {
            reasons.push(`Potential toxin ingestion detected: ${toxin}`);
            if (maxLevel !== 'CRITICAL') maxLevel = 'HIGH';
            severityBoost = Math.max(severityBoost, 0.25);
            promoted_differentials.push('Toxic Ingestion');
        }
    }

    return {
        emergency_level: maxLevel,
        severity_boost: severityBoost,
        emergency_rule_triggered: reasons.length > 0,
        emergency_rule_reasons: reasons,
        promoted_differentials,
    };
}

function extractAllText(input: Record<string, unknown>): string {
    let combined = '';
    
    if (typeof input.species === 'string') combined += input.species + ' ';
    if (typeof input.breed === 'string') combined += input.breed + ' ';
    
    if (Array.isArray(input.symptoms)) {
        combined += input.symptoms.join(' ') + ' ';
    } else if (typeof input.symptoms === 'string') {
        combined += input.symptoms + ' ';
    }
    
    if (input.metadata && typeof input.metadata === 'object') {
        const meta = input.metadata as Record<string, unknown>;
        if (typeof meta.raw_note === 'string') {
            combined += meta.raw_note + ' ';
        }
    }
    
    return combined;
}
