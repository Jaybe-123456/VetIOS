export const SPECIES_WEIGHT_BOUNDS: Record<string, { min: number; max: number; unit: string; note: string }> = {
    canine: { min: 0.5, max: 120, unit: 'kg', note: 'Chihuahua to Giant breeds' },
    feline: { min: 0.3, max: 12, unit: 'kg', note: 'Neonatal to Maine Coon' },
    equine: { min: 40, max: 900, unit: 'kg', note: 'Miniature horse foal to draft horse' },
    bovine: { min: 20, max: 1400, unit: 'kg', note: 'Calf to large bull' },
    avian: { min: 0.02, max: 15, unit: 'kg', note: 'Finch to large parrot/raptor' },
    porcine: { min: 0.5, max: 350, unit: 'kg', note: 'Piglet to mature sow' },
    ovine: { min: 2, max: 130, unit: 'kg', note: 'Lamb to Merino ram' },
    reptile: { min: 0.001, max: 80, unit: 'kg', note: 'Small gecko to large tortoise' },
    rabbit: { min: 0.3, max: 8, unit: 'kg', note: 'Dwarf to Flemish Giant' },
    ferret: { min: 0.3, max: 2.5, unit: 'kg', note: 'Adult ferret range' },
};

export type WeightValidationResult =
    | { valid: true }
    | {
        valid: false;
        severity: 'impossible' | 'extreme_outlier';
        message: string;
        bounds: { min: number; max: number };
    };

export function validateSpeciesWeight(species: string, weight_kg: number): WeightValidationResult {
    const normalizedSpecies = species.trim().toLowerCase();
    const bounds = SPECIES_WEIGHT_BOUNDS[normalizedSpecies];
    if (!bounds) return { valid: true };
    if (!Number.isFinite(weight_kg) || weight_kg <= 0) {
        return {
            valid: false,
            severity: 'impossible',
            message: `Weight ${weight_kg}kg is not a valid positive patient weight. Verify patient weight before proceeding. Drug calculations at this weight may cause fatal dosing errors.`,
            bounds: { min: bounds.min, max: bounds.max },
        };
    }
    if (weight_kg < bounds.min || weight_kg > bounds.max) {
        const severity = weight_kg < bounds.min * 0.5 || weight_kg > bounds.max * 2
            ? 'impossible'
            : 'extreme_outlier';
        return {
            valid: false,
            severity,
            message: `Weight ${weight_kg}kg is outside the physiological range for ${normalizedSpecies} (${bounds.min}-${bounds.max}kg: ${bounds.note}). Verify patient weight before proceeding. Drug calculations at this weight may cause fatal dosing errors.`,
            bounds: { min: bounds.min, max: bounds.max },
        };
    }
    return { valid: true };
}
