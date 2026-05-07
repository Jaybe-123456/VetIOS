/**
 * Zod validation and deterministic structured text helpers for EncounterPayloadV2.
 */

import { z, type ZodIssue } from 'zod';
import {
    ALL_SPECIES,
    ALL_SYSTEM_TYPES,
    SPECIES_PANEL_MAP,
    type EncounterPayloadV2,
    type Species,
    type SystemType,
    type SystemPanel,
    type TestValue,
} from './types';

const SpeciesSchema = z.enum(ALL_SPECIES as unknown as [Species, ...Species[]]);

const SexSchema = z.enum([
    'male_intact',
    'male_neutered',
    'female_intact',
    'female_spayed',
    'unknown',
]);

const MMColourSchema = z.enum([
    'pink',
    'pale',
    'white',
    'yellow',
    'brick_red',
    'cyanotic',
    'muddy',
]);

const TestValueSchema: z.ZodType<TestValue> = z.union([
    z.enum(['positive', 'negative', 'equivocal', 'not_done']),
    z.number(),
    z.string(),
]);

const PatientV2Schema = z.object({
    species: SpeciesSchema,
    breed: z.string(),
    weight_kg: z.number().positive().nullable(),
    age_years: z.number().min(0).nullable(),
    sex: SexSchema,
});

const VitalsV2Schema = z.object({
    temp_c: z.number().min(30).max(50).nullable(),
    heart_rate_bpm: z.number().int().min(0).max(500).nullable(),
    respiratory_rate_bpm: z.number().int().min(0).max(200).nullable(),
    mm_colour: MMColourSchema.nullable(),
    crt_seconds: z.number().min(0).max(10).nullable(),
});

const HistoryV2Schema = z.object({
    duration_days: z.number().min(0).nullable(),
    free_text: z.string(),
    medications: z.array(z.string()),
});

const EncounterDataV2Schema = z.object({
    presenting_complaints: z.array(z.string()).min(1),
    vitals: VitalsV2Schema,
    history: HistoryV2Schema,
});

export const SystemPanelSchema = z.object({
    system: z.enum(ALL_SYSTEM_TYPES as unknown as [SystemType, ...SystemType[]]),
    panel: z.string().min(1),
    tests: z.record(z.string(), TestValueSchema),
});

const EncounterMetadataV2Schema = z.object({
    encounter_id: z.string().min(1),
    timestamp: z.string().min(1),
    clinician_id: z.string().nullable(),
    clinic_id: z.string().nullable(),
});

export const EncounterPayloadV2Schema = z.object({
    patient: PatientV2Schema,
    encounter: EncounterDataV2Schema,
    active_system_panels: z.array(SystemPanelSchema).min(1),
    imaging: z.record(z.string(), TestValueSchema).default({}),
    metadata: EncounterMetadataV2Schema,
});

export function validateEncounterPayloadV2(data: unknown):
    | { success: true; data: EncounterPayloadV2 }
    | { success: false; error: string } {
    const result = EncounterPayloadV2Schema.safeParse(data);
    if (!result.success) {
        return {
            success: false,
            error: result.error.issues
                .map((issue: ZodIssue) => {
                    const path = issue.path.join('.');
                    return path ? `${path}: ${issue.message}` : issue.message;
                })
                .join('; '),
        };
    }

    return { success: true, data: result.data as EncounterPayloadV2 };
}

export function validateSpeciesPanelGating(payload: EncounterPayloadV2): string[] {
    const allowedPanels = SPECIES_PANEL_MAP[payload.patient.species] ?? [];
    const violations: string[] = [];

    for (const panel of payload.active_system_panels) {
        const allowed = allowedPanels.some(
            (entry) => entry.system === panel.system && entry.panel === panel.panel,
        );
        if (!allowed) {
            violations.push(
                `Panel "${panel.system}/${panel.panel}" is not allowed for species "${payload.patient.species}"`,
            );
        }
    }

    return violations;
}

function isPopulatedValue(value: TestValue): boolean {
    if (value === 'not_done') return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    return true;
}

function comparePanels(left: SystemPanel, right: SystemPanel): number {
    const leftKey = `${left.system}:${left.panel}`;
    const rightKey = `${right.system}:${right.panel}`;
    return leftKey.localeCompare(rightKey);
}

export function flattenPanelsToStructuredText(panels: SystemPanel[]): string {
    const blocks: string[] = [];

    for (const panel of [...panels].sort(comparePanels)) {
        const testEntries = Object.entries(panel.tests)
            .filter(([, value]) => isPopulatedValue(value))
            .sort(([left], [right]) => left.localeCompare(right));

        if (testEntries.length === 0) continue;

        const header = `[SYSTEM: ${panel.system} | PANEL: ${panel.panel}]`;
        const testLine = testEntries
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join(' | ');

        blocks.push(`${header}\n${testLine}`);
    }

    return blocks.join('\n\n');
}

export function extractActiveSystems(panels: SystemPanel[]): string[] {
    const systems = new Set<string>();

    for (const panel of panels) {
        if (Object.values(panel.tests).some(isPopulatedValue)) {
            systems.add(panel.system);
        }
    }

    return Array.from(systems).sort((left, right) => left.localeCompare(right));
}

export function buildCrossPanelSystemPromptBlock(species: Species, panels: SystemPanel[]): string {
    const structuredText = flattenPanelsToStructuredText(panels);
    if (!structuredText) return '';

    const activeSystems = extractActiveSystems(panels);
    const systemList = activeSystems.join(', ');

    return [
        'STRUCTURED DIAGNOSTIC PANEL DATA',
        `Species: ${species}`,
        `Active systems: ${systemList}`,
        '',
        structuredText,
        '',
        'CROSS-PANEL REASONING INSTRUCTION',
        `Reason across all ${activeSystems.length} active diagnostic systems simultaneously.`,
        'Before rendering differentials, identify cross-system interactions, contradictions, and co-morbid disease patterns.',
        'Resolve haemolysis localisation conflicts when haematology and urinalysis data coexist.',
        'Consider concurrent multisystemic conditions such as IMHA, hypoadrenocorticism, and protein-losing nephropathy when the evidence supports more than one process.',
        'Flag panel results that are inconsistent with the selected species or expected reference range.',
        'END STRUCTURED DIAGNOSTIC PANEL DATA',
    ].join('\n');
}
