import { detectSpeciesFromTexts, type DetectedVetiosSpecies } from '@/lib/askVetios/context';

export const ASK_VETIOS_CASE_DRAFT_STORAGE_KEY = 'vetios.askVetios.caseDraft.v1';
export const ASK_VETIOS_CLINICAL_CASE_DRAFT_STORAGE_KEY = 'vetios.askVetios.clinicalCaseFormDraft.v1';

export type AskVetiosIntakeStatus = 'non_clinical' | 'needs_minimum' | 'case_ready' | 'strong';

export interface AskVetiosCaseDraft {
    species: DetectedVetiosSpecies;
    breed: string | null;
    age_years: number | null;
    sex: string | null;
    duration: string | null;
    clinical_signs: string[];
    labs_or_tests: string[];
    imaging: string[];
    treatments: string[];
    outcome_signals: string[];
    red_flags: string[];
    raw_note: string;
}

export interface AskVetiosCaseHandoffPayload {
    model: {
        name: string;
        version: string;
    };
    input: {
        input_signature: {
            species: string | null;
            breed: string | null;
            symptoms: string[];
            presenting_signs: string[];
            age_years: number | null;
            history: Record<string, unknown>;
            diagnostic_tests: Record<string, unknown>;
            metadata: Record<string, unknown>;
        };
    };
}

export interface AskVetiosClinicalCaseFormDraft {
    patient?: Partial<{
        species: string;
        breed: string;
        age: string;
        ageUnit: string;
        sex: string;
    }>;
    signs?: Partial<{
        symptoms: string;
        duration: string;
        durationUnit: string;
        severity: string;
    }>;
    labs?: Record<string, string>;
}

export interface AskVetiosCaseHandoff {
    ready: boolean;
    storage_key: typeof ASK_VETIOS_CASE_DRAFT_STORAGE_KEY;
    inference_href: string;
    payload: AskVetiosCaseHandoffPayload;
    clinical_case_storage_key: typeof ASK_VETIOS_CLINICAL_CASE_DRAFT_STORAGE_KEY;
    clinical_case_href: string;
    clinical_case_draft: AskVetiosClinicalCaseFormDraft;
}

export interface AskVetiosIntakeSummary {
    is_clinical_intake: boolean;
    status: AskVetiosIntakeStatus;
    readiness_score: number;
    missing_fields: string[];
    follow_up_questions: string[];
    safety_notice: string | null;
    case_draft: AskVetiosCaseDraft;
    case_handoff: AskVetiosCaseHandoff;
}

interface AskVetiosIntakeInput {
    message: string;
    conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

const CLINICAL_SIGNS: Array<{ label: string; patterns: RegExp[] }> = [
    { label: 'vomiting', patterns: [/\bvomit(?:ing|ed|s)?\b/i, /\bemesis\b/i] },
    { label: 'diarrhea', patterns: [/\bdiarrh(?:ea|oea)\b/i, /\bloose stool/i] },
    { label: 'lethargy', patterns: [/\bletharg(?:y|ic)\b/i, /\bweak(?:ness)?\b/i, /\bdepressed\b/i] },
    { label: 'anorexia', patterns: [/\banorexia\b/i, /\bnot eating\b/i, /\binappet(?:ence|ant)\b/i, /\bpoor appetite\b/i] },
    { label: 'coughing', patterns: [/\bcough(?:ing|s)?\b/i] },
    { label: 'sneezing', patterns: [/\bsneez(?:ing|es)?\b/i] },
    { label: 'nasal discharge', patterns: [/\bnasal discharge\b/i, /\brunny nose\b/i] },
    { label: 'ocular discharge', patterns: [/\bocular discharge\b/i, /\beye discharge\b/i] },
    { label: 'fever', patterns: [/\bfever\b/i, /\bfebrile\b/i, /\btemperature\b/i] },
    { label: 'seizure', patterns: [/\bseizure(?:s)?\b/i, /\bconvuls(?:ion|ions|ing)\b/i] },
    { label: 'lameness', patterns: [/\blame(?:ness)?\b/i, /\blimp(?:ing)?\b/i] },
    { label: 'weight loss', patterns: [/\bweight loss\b/i, /\blosing weight\b/i] },
    { label: 'polyuria/polydipsia', patterns: [/\bpu\/pd\b/i, /\bpolyuria\b/i, /\bpolydipsia\b/i, /\bdrinking more\b/i, /\burinating more\b/i] },
    { label: 'straining to urinate', patterns: [/\bstraining to urinate\b/i, /\bcannot urinate\b/i, /\bcan't urinate\b/i, /\bblocked\b/i] },
    { label: 'abdominal pain', patterns: [/\babdominal pain\b/i, /\bpainful abdomen\b/i, /\bbelly pain\b/i] },
    { label: 'distended abdomen', patterns: [/\bdistended abdomen\b/i, /\bbloat(?:ed)?\b/i, /\babdominal disten/i] },
    { label: 'mass/lump', patterns: [/\bmass\b/i, /\blump\b/i, /\btumou?r\b/i] },
    { label: 'pruritus', patterns: [/\bitch(?:ing|y)?\b/i, /\bpruritus\b/i, /\bscratch(?:ing)?\b/i] },
];

const TEST_PATTERNS: Array<{ label: string; patterns: RegExp[] }> = [
    { label: 'CBC', patterns: [/\bcbc\b/i, /\bcomplete blood count\b/i] },
    { label: 'chemistry panel', patterns: [/\bchem(?:istry)? panel\b/i, /\bchem\b/i] },
    { label: 'urinalysis', patterns: [/\burinalysis\b/i, /\bua\b/i] },
    { label: 'radiographs', patterns: [/\bradiographs?\b/i, /\bx-?rays?\b/i] },
    { label: 'ultrasound', patterns: [/\bultrasound\b/i, /\bus\b/i] },
    { label: 'BUN/creatinine', patterns: [/\bbun\b/i, /\bcreatinine\b/i] },
    { label: 'ALT/ALP', patterns: [/\balt\b/i, /\balp\b/i] },
    { label: 'glucose', patterns: [/\bglucose\b/i, /\bblood sugar\b/i] },
    { label: 'PCV/TS', patterns: [/\bpcv\b/i, /\bpacked cell volume\b/i, /\btotal solids\b/i, /\bts\b/i] },
];

const IMAGING_PATTERNS: Array<{ label: string; patterns: RegExp[] }> = [
    { label: 'radiographs', patterns: [/\bradiographs?\b/i, /\bx-?rays?\b/i] },
    { label: 'ultrasound', patterns: [/\bultrasound\b/i, /\bultrasonography\b/i] },
    { label: 'CT', patterns: [/\bct\b/i, /\bcomputed tomography\b/i] },
    { label: 'MRI', patterns: [/\bmri\b/i, /\bmagnetic resonance\b/i] },
    { label: 'endoscopy', patterns: [/\bendoscopy\b/i, /\brhinoscopy\b/i, /\bbronchoscopy\b/i] },
];

const TREATMENT_PATTERNS: Array<{ label: string; patterns: RegExp[] }> = [
    { label: 'IV fluids', patterns: [/\biv fluids?\b/i, /\bfluid therapy\b/i, /\bcrystalloid/i] },
    { label: 'antiemetic', patterns: [/\bantiemetic\b/i, /\bmaropitant\b/i, /\bondansetron\b/i] },
    { label: 'antibiotics', patterns: [/\bantibiotics?\b/i, /\bamoxicillin\b/i, /\bcefazolin\b/i, /\bdoxycycline\b/i] },
    { label: 'analgesia', patterns: [/\banalgesia\b/i, /\bpain medication\b/i, /\bopioid\b/i, /\bnsaid\b/i] },
    { label: 'oxygen support', patterns: [/\boxygen\b/i, /\bo2\b/i] },
    { label: 'surgery', patterns: [/\bsurgery\b/i, /\bsurgical\b/i, /\bexploratory laparotomy\b/i] },
];

const OUTCOME_PATTERNS: Array<{ label: string; patterns: RegExp[] }> = [
    { label: 'improved', patterns: [/\bimproved\b/i, /\bimproving\b/i, /\bresolved\b/i, /\brecovered\b/i] },
    { label: 'worsened', patterns: [/\bworsened\b/i, /\bdeclined\b/i, /\bdeteriorated\b/i] },
    { label: 'deceased', patterns: [/\bdied\b/i, /\bdeceased\b/i, /\beuthanized\b/i, /\beuthanised\b/i] },
    { label: 'no response', patterns: [/\bno response\b/i, /\bnot responding\b/i] },
];

const RED_FLAGS: Array<{ label: string; patterns: RegExp[] }> = [
    { label: 'difficulty breathing or respiratory distress', patterns: [/\bdifficulty breathing\b/i, /\brespiratory distress\b/i, /\bdyspnea\b/i, /\bgasping\b/i] },
    { label: 'collapse or inability to stand', patterns: [/\bcollapse(?:d)?\b/i, /\bunable to stand\b/i, /\bnon-ambulatory\b/i] },
    { label: 'active seizure activity', patterns: [/\bseizure(?:s)?\b/i, /\bconvuls(?:ion|ions|ing)\b/i] },
    { label: 'possible GDV/bloat pattern', patterns: [/\bunproductive retch(?:ing)?\b/i, /\bdistended abdomen\b/i, /\bgdv\b/i, /\bbloat\b/i] },
    { label: 'blocked or unable to urinate', patterns: [/\bunable to urinate\b/i, /\bcannot urinate\b/i, /\bcan't urinate\b/i, /\burinary blockage\b/i] },
    { label: 'known or suspected toxin exposure', patterns: [/\btoxin\b/i, /\bpoison(?:ing|ed)?\b/i, /\bingested\b/i, /\bate chocolate\b/i, /\brodenticide\b/i] },
    { label: 'major trauma or uncontrolled bleeding', patterns: [/\bhit by car\b/i, /\btrauma\b/i, /\buncontrolled bleeding\b/i, /\bsevere bleeding\b/i] },
    { label: 'pale gums or shock concern', patterns: [/\bpale gums\b/i, /\bwhite gums\b/i, /\bshock\b/i] },
];

export function buildAskVetiosIntake(input: AskVetiosIntakeInput): AskVetiosIntakeSummary {
    const userTexts = [
        ...(input.conversation ?? [])
            .filter((item) => item.role === 'user')
            .map((item) => item.content),
        input.message,
    ].filter((value) => value.trim().length > 0);

    const rawNote = compactWhitespace(userTexts.slice(-6).join('\n'));
    const species = detectSpeciesFromTexts(userTexts.slice().reverse(), 'unknown');
    const clinicalSigns = extractMatches(rawNote, CLINICAL_SIGNS);
    const labsOrTests = extractMatches(rawNote, TEST_PATTERNS);
    const imaging = extractMatches(rawNote, IMAGING_PATTERNS);
    const treatments = extractMatches(rawNote, TREATMENT_PATTERNS);
    const outcomeSignals = extractMatches(rawNote, OUTCOME_PATTERNS);
    const redFlags = extractMatches(rawNote, RED_FLAGS);
    const ageYears = extractAgeYears(rawNote);
    const sex = extractSex(rawNote);
    const duration = extractDuration(rawNote);
    const breed = extractBreed(rawNote);

    const isClinicalIntake = species !== 'unknown' || clinicalSigns.length > 0 || redFlags.length > 0;
    const missingFields = buildMissingFields({
        species,
        clinicalSigns,
        ageYears,
        sex,
        duration,
        labsOrTests,
    });
    const readinessScore = calculateReadinessScore({
        species,
        clinicalSigns,
        ageYears,
        sex,
        duration,
        labsOrTests,
    });

    const status: AskVetiosIntakeStatus = !isClinicalIntake
        ? 'non_clinical'
        : readinessScore >= 85
            ? 'strong'
            : readinessScore >= 55
                ? 'case_ready'
                : 'needs_minimum';

    const caseDraft: AskVetiosCaseDraft = {
        species,
        breed,
        age_years: ageYears,
        sex,
        duration,
        clinical_signs: clinicalSigns,
        labs_or_tests: labsOrTests,
        imaging,
        treatments,
        outcome_signals: outcomeSignals,
        red_flags: redFlags,
        raw_note: rawNote,
    };

    return {
        is_clinical_intake: isClinicalIntake,
        status,
        readiness_score: readinessScore,
        missing_fields: missingFields,
        follow_up_questions: buildFollowUpQuestions(missingFields, redFlags),
        safety_notice: redFlags.length > 0
            ? 'Emergency red flags are present. VetIOS can organize the case, but this patient should be assessed by a veterinarian urgently.'
            : null,
        case_draft: caseDraft,
        case_handoff: buildCaseHandoff(caseDraft, readinessScore >= 55),
    };
}

function buildCaseHandoff(draft: AskVetiosCaseDraft, ready: boolean): AskVetiosCaseHandoff {
    return {
        ready,
        storage_key: ASK_VETIOS_CASE_DRAFT_STORAGE_KEY,
        inference_href: '/inference?source=ask-vetios',
        clinical_case_storage_key: ASK_VETIOS_CLINICAL_CASE_DRAFT_STORAGE_KEY,
        clinical_case_href: '/cases/new?source=ask-vetios',
        clinical_case_draft: buildClinicalCaseFormDraft(draft),
        payload: {
            model: {
                name: 'gpt-4o-mini',
                version: '1.0.0',
            },
            input: {
                input_signature: {
                    species: draft.species === 'unknown' ? null : draft.species,
                    breed: draft.breed,
                    symptoms: draft.clinical_signs,
                    presenting_signs: draft.clinical_signs,
                    age_years: draft.age_years,
                    history: {
                        duration: draft.duration,
                        sex: draft.sex,
                        source: 'ask_vetios',
                    },
                    diagnostic_tests: {
                        mentioned: draft.labs_or_tests,
                        imaging: draft.imaging,
                    },
                    metadata: {
                        ask_vetios_case_draft: true,
                        raw_note: draft.raw_note,
                        red_flags: draft.red_flags,
                        treatments: draft.treatments,
                        outcome_signals: draft.outcome_signals,
                        clinician_confirmation_status: 'not_captured',
                    },
                },
            },
        },
    };
}

function buildClinicalCaseFormDraft(draft: AskVetiosCaseDraft): AskVetiosClinicalCaseFormDraft {
    const duration = splitDuration(draft.duration);
    return {
        patient: {
            species: speciesToFormValue(draft.species),
            breed: draft.breed ?? undefined,
            age: draft.age_years != null ? String(draft.age_years) : undefined,
            ageUnit: draft.age_years != null ? 'years' : undefined,
            sex: sexToFormValue(draft.sex),
        },
        signs: {
            symptoms: draft.clinical_signs.join(', ') || undefined,
            duration: duration?.value,
            durationUnit: duration?.unit,
            severity: draft.red_flags.length > 0 ? 'severe' : 'moderate',
        },
        labs: {},
    };
}

function splitDuration(value: string | null): { value: string; unit: string } | null {
    if (!value) return null;
    const match = value.match(/^(\d+(?:\.\d+)?)\s*(hours?|hrs?|days?|weeks?|months?)$/i);
    if (!match?.[1] || !match[2]) return null;
    const unit = match[2].toLowerCase();
    if (unit.startsWith('hour') || unit.startsWith('hr')) return { value: match[1], unit: 'hours' };
    if (unit.startsWith('week')) return { value: match[1], unit: 'weeks' };
    return { value: match[1], unit: 'days' };
}

function speciesToFormValue(value: AskVetiosCaseDraft['species']): string | undefined {
    if (value === 'unknown') return undefined;
    return titleCase(value);
}

function sexToFormValue(value: string | null): string | undefined {
    if (!value) return undefined;
    if (value === 'neutered male') return 'Male neutered';
    if (value === 'intact male') return 'Male intact';
    if (value === 'spayed female') return 'Female spayed';
    if (value === 'intact female') return 'Female intact';
    if (value === 'male') return 'Male intact';
    if (value === 'female') return 'Female intact';
    return undefined;
}

function extractMatches(text: string, dictionary: Array<{ label: string; patterns: RegExp[] }>): string[] {
    const values: string[] = [];
    for (const entry of dictionary) {
        if (entry.patterns.some((pattern) => pattern.test(text))) {
            values.push(entry.label);
        }
    }
    return values;
}

function extractAgeYears(text: string): number | null {
    const ageMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(?:-| )?(years?|yrs?|yo|y\/o|months?|mos?|weeks?|days?)\s*(?:old)?\b/i);
    if (!ageMatch) return null;

    const value = Number(ageMatch[1]);
    if (!Number.isFinite(value) || value <= 0) return null;

    const unit = ageMatch[2].toLowerCase();
    if (unit.startsWith('month') || unit.startsWith('mo')) return round(value / 12);
    if (unit.startsWith('week')) return round(value / 52);
    if (unit.startsWith('day')) return round(value / 365);
    return round(value);
}

function extractSex(text: string): string | null {
    const lower = text.toLowerCase();
    if (/\bspayed female\b|\bfemale spayed\b|\bfs\b/.test(lower)) return 'spayed female';
    if (/\bintact female\b|\bfemale intact\b|\bfi\b/.test(lower)) return 'intact female';
    if (/\bneutered male\b|\bcastrated male\b|\bmn\b/.test(lower)) return 'neutered male';
    if (/\bintact male\b|\bmale intact\b|\bmi\b/.test(lower)) return 'intact male';
    if (/\bfemale\b/.test(lower)) return 'female';
    if (/\bmale\b/.test(lower)) return 'male';
    return null;
}

function extractDuration(text: string): string | null {
    const match = text.match(/\b(?:for|x|over|past|since)\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|days?|weeks?|months?)\b/i);
    if (!match) return null;
    return `${match[1]} ${match[2].toLowerCase()}`;
}

function extractBreed(text: string): string | null {
    const explicit = text.match(/\bbreed\s*:\s*([A-Za-z][A-Za-z -]{1,40})(?:[,.|;]|\n|$)/i);
    if (explicit?.[1]) return titleCase(explicit[1].trim());

    const shorthand = text.match(/\b(?:dog|canine|cat|feline)\s*[-,]\s*([A-Za-z][A-Za-z -]{2,34})(?:[,.|;]|\n|$)/i);
    if (shorthand?.[1]) return titleCase(shorthand[1].trim());

    return null;
}

function buildMissingFields(input: {
    species: DetectedVetiosSpecies;
    clinicalSigns: string[];
    ageYears: number | null;
    sex: string | null;
    duration: string | null;
    labsOrTests: string[];
}): string[] {
    const missing: string[] = [];
    if (input.species === 'unknown') missing.push('species');
    if (input.clinicalSigns.length === 0) missing.push('clinical signs');
    if (input.ageYears == null || input.sex == null) missing.push('age/sex');
    if (!input.duration) missing.push('duration');
    if (input.labsOrTests.length === 0) missing.push('labs/tests if available');
    return missing;
}

function calculateReadinessScore(input: {
    species: DetectedVetiosSpecies;
    clinicalSigns: string[];
    ageYears: number | null;
    sex: string | null;
    duration: string | null;
    labsOrTests: string[];
}): number {
    let score = 0;
    if (input.species !== 'unknown') score += 25;
    if (input.clinicalSigns.length > 0) score += Math.min(30, 14 + input.clinicalSigns.length * 8);
    if (input.duration) score += 15;
    if (input.ageYears != null) score += 8;
    if (input.sex) score += 7;
    if (input.labsOrTests.length > 0) score += 15;
    return Math.min(100, score);
}

function buildFollowUpQuestions(missingFields: string[], redFlags: string[]): string[] {
    const questions: string[] = [];
    if (redFlags.length > 0) {
        questions.push('Is the patient currently stable enough to transport, and is emergency veterinary care available now?');
    }
    if (missingFields.includes('species')) {
        questions.push('What species is the patient?');
    }
    if (missingFields.includes('clinical signs')) {
        questions.push('What clinical signs are present, and which sign started first?');
    }
    if (missingFields.includes('age/sex')) {
        questions.push('What are the age, sex, and neuter/spay status?');
    }
    if (missingFields.includes('duration')) {
        questions.push('How long have the signs been present, and are they improving, worsening, or unchanged?');
    }
    if (missingFields.includes('labs/tests if available')) {
        questions.push('Are any exam findings, lab values, imaging results, medications, or exposures known?');
    }
    return questions.slice(0, 4);
}

function compactWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function titleCase(value: string): string {
    return value
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
}

function round(value: number): number {
    return Math.round(value * 10) / 10;
}
