export type VoiceSurface = 'case_intake' | 'inference' | 'ask_vetios';

export type VoiceSpecies = 'canine' | 'feline' | 'equine' | 'bovine' | 'avian' | 'exotic' | 'unknown';
export type VoiceSex = 'male_intact' | 'male_neutered' | 'female_intact' | 'female_spayed' | 'unknown';
export type VoiceAgeUnit = 'years' | 'months' | 'days';
export type VoiceDurationUnit = 'hours' | 'days' | 'weeks';
export type VoiceSeverity = 'low' | 'moderate' | 'severe';

export interface ExtractedClinicalFields {
    raw_transcript: string;
    species?: VoiceSpecies;
    breed?: string;
    age_value?: number;
    age_unit?: VoiceAgeUnit;
    sex?: VoiceSex;
    symptoms: string[];
    presenting_complaint?: string;
    duration_value?: number;
    duration_unit?: VoiceDurationUnit;
    severity?: VoiceSeverity;
    labs?: Record<string, number>;
    query?: string;
    confidence?: number;
    fallback_used?: boolean;
    extraction_notes?: string[];
}

export interface VoiceExtractRequest {
    transcript: string;
    surface: VoiceSurface;
}

export interface VoiceExtractResponse {
    fields: ExtractedClinicalFields;
    source: 'anthropic' | 'local_fallback';
}
