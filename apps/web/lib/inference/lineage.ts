import { createHash } from 'crypto';

export const INFERENCE_SCHEMA_VERSION = 'v1';
export const DIAGNOSTIC_PROMPT_TEMPLATE_VERSION = 'vetios_clinical_diagnostic_v1';
export const DIAGNOSTIC_PROMPT_TEMPLATE = [
    'You are a veterinary diagnostic AI. Given the clinical input below, return ONLY a JSON object with this exact shape:',
    '{ "differentials": [{ "label": string, "p": number }], "primary_confidence": number }',
    'Rules: labels are snake_case, probabilities sum to <=1, return at most 5 differentials, ordered by descending p.',
    '',
    'Species: {{species}}',
    'Breed: {{breed}}',
    'Symptoms: {{symptoms}}',
    'Labs: {{labs}}',
    'Age: {{age_years}} years',
].join('\n');

export function computePromptTemplateHash(template = DIAGNOSTIC_PROMPT_TEMPLATE): string {
    return createHash('sha256').update(template).digest('hex');
}
