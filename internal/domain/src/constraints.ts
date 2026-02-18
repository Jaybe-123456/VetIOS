/**
 * @vetios/domain — Constraint Engine
 *
 * Deterministic validation rules for clinical safety.
 * These are pure functions — no LLM calls, no database queries.
 * They enforce hard constraints that AI suggestions MUST satisfy.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DrugConstraint {
    drug_name: string;
    contraindicated_species: string[];
    max_dose_mg_per_kg: number;
    min_weight_kg?: number;
    pregnancy_safe: boolean;
    notes?: string;
}

export interface DosageInput {
    drug_name: string;
    species: string;
    weight_kg: number;
    proposed_dose_mg: number;
    is_pregnant?: boolean;
}

export interface ConstraintViolation {
    code: string;
    severity: 'error' | 'warning';
    message: string;
    field: string;
}

export interface ValidationResult {
    valid: boolean;
    violations: ConstraintViolation[];
}

// ─── Known Drug Constraints (Veterinary) ─────────────────────────────────────
// In production, this would be loaded from a database or reference service.
// This static registry serves as the deterministic constraint baseline.

const DRUG_CONSTRAINTS: DrugConstraint[] = [
    {
        drug_name: 'meloxicam',
        contraindicated_species: ['cat'], // Chronic use contraindicated in cats in many jurisdictions
        max_dose_mg_per_kg: 0.2,
        pregnancy_safe: false,
        notes: 'Single-dose use may be acceptable in cats; consult formulary.',
    },
    {
        drug_name: 'acetaminophen',
        contraindicated_species: ['cat', 'snake', 'ferret'],
        max_dose_mg_per_kg: 15,
        pregnancy_safe: false,
        notes: 'Toxic to cats at any dose.',
    },
    {
        drug_name: 'ivermectin',
        contraindicated_species: [],
        max_dose_mg_per_kg: 0.4,
        min_weight_kg: 0.5,
        pregnancy_safe: false,
        notes: 'Collie breeds and MDR1-positive dogs may be sensitive at standard doses.',
    },
    {
        drug_name: 'metronidazole',
        contraindicated_species: [],
        max_dose_mg_per_kg: 25,
        pregnancy_safe: false,
    },
    {
        drug_name: 'amoxicillin',
        contraindicated_species: [],
        max_dose_mg_per_kg: 25,
        pregnancy_safe: true,
    },
];

// ─── Constraint Functions ────────────────────────────────────────────────────

function findDrugConstraint(drugName: string): DrugConstraint | undefined {
    return DRUG_CONSTRAINTS.find(
        (c) => c.drug_name.toLowerCase() === drugName.toLowerCase(),
    );
}

/**
 * Validates a proposed drug dosage against deterministic safety constraints.
 *
 * Checks:
 * 1. Species contraindication
 * 2. Maximum dose per kg
 * 3. Minimum weight requirement
 * 4. Pregnancy safety
 */
export function validateDosage(input: DosageInput): ValidationResult {
    const violations: ConstraintViolation[] = [];
    const constraint = findDrugConstraint(input.drug_name);

    if (!constraint) {
        // Unknown drug — flag as warning, do not block
        violations.push({
            code: 'DRUG_UNKNOWN',
            severity: 'warning',
            message: `Drug "${input.drug_name}" not found in constraint database. Manual review required.`,
            field: 'drug_name',
        });

        return { valid: true, violations };
    }

    // Check species contraindication
    const speciesLower = input.species.toLowerCase();
    if (constraint.contraindicated_species.includes(speciesLower)) {
        violations.push({
            code: 'SPECIES_CONTRAINDICATED',
            severity: 'error',
            message: `${constraint.drug_name} is contraindicated for ${input.species}.${constraint.notes ? ` Note: ${constraint.notes}` : ''}`,
            field: 'species',
        });
    }

    // Check dosage
    const dosePerKg = input.proposed_dose_mg / input.weight_kg;
    if (dosePerKg > constraint.max_dose_mg_per_kg) {
        violations.push({
            code: 'DOSE_EXCEEDS_MAX',
            severity: 'error',
            message: `Proposed dose of ${input.proposed_dose_mg}mg (${dosePerKg.toFixed(2)} mg/kg) exceeds maximum of ${constraint.max_dose_mg_per_kg} mg/kg for ${constraint.drug_name}.`,
            field: 'proposed_dose_mg',
        });
    }

    // Check minimum weight
    if (constraint.min_weight_kg && input.weight_kg < constraint.min_weight_kg) {
        violations.push({
            code: 'WEIGHT_BELOW_MIN',
            severity: 'error',
            message: `Patient weight ${input.weight_kg}kg is below the minimum ${constraint.min_weight_kg}kg for ${constraint.drug_name}.`,
            field: 'weight_kg',
        });
    }

    // Check pregnancy
    if (input.is_pregnant && !constraint.pregnancy_safe) {
        violations.push({
            code: 'PREGNANCY_UNSAFE',
            severity: 'error',
            message: `${constraint.drug_name} is not safe for use during pregnancy.`,
            field: 'is_pregnant',
        });
    }

    const hasErrors = violations.some((v) => v.severity === 'error');
    return { valid: !hasErrors, violations };
}

/**
 * Validates a batch of proposed prescriptions.
 * Returns a combined result — the batch is invalid if any single item fails.
 */
export function validatePrescriptionBatch(
    prescriptions: DosageInput[],
): ValidationResult {
    const allViolations: ConstraintViolation[] = [];

    for (const rx of prescriptions) {
        const result = validateDosage(rx);
        allViolations.push(...result.violations);
    }

    const hasErrors = allViolations.some((v) => v.severity === 'error');
    return { valid: !hasErrors, violations: allViolations };
}
