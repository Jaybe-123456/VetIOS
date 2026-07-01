import { describe, expect, it } from 'vitest';
import { normalizeClinicalLabEvidence } from '../labEvidenceNormalizer';

describe('clinical lab evidence normalizer', () => {
    it('maps vendor-style Ehrlichia tick panels and CBC findings into canonical evidence', () => {
        const normalized = normalizeClinicalLabEvidence({
            labs: {
                tick_borne_disease_panel: {
                    Ehrlichia_canis_PCR_EDTA_blood: 'positive',
                    Ehrlichia_canis_PCR_Ct: '27.8',
                    Ehrlichia_canis_IFA_IgG: '1:640 POSITIVE HIGH',
                    Ehrlichia_canis_ewingii_antibody_SNAP: 'positive',
                    Anaplasma_spp_PCR: 'negative',
                    Anaplasma_antibody_SNAP: 'negative',
                    Babesia_PCR: 'negative',
                    Babesia_blood_smear: 'no piroplasms seen',
                    Borrelia_burgdorferi_antibody: 'negative',
                    Heartworm_antigen: 'negative',
                    blood_smear_review: 'severe thrombocytopenia; rare suspected intramonocytic morulae',
                },
                CBC: {
                    platelets: '28 x10^9/L CRITICAL LOW',
                    reticulocytes: '38 x10^9/L INADEQUATE',
                    lymphocytes: '0.7 x10^9/L LOW',
                    total_plasma_protein: '8.6 g/dL HIGH',
                },
                hepatic_panel: {
                    albumin: '2.4 g/dL LOW',
                    globulin: '5.7 g/dL HIGH',
                    A_G_ratio: '0.42 LOW',
                },
            },
        });

        expect(normalized.diagnostic_tests.pcr).toMatchObject({
            ehrlichia_pcr: 'positive',
            anaplasma_pcr: 'negative',
            babesia_pcr: 'negative',
        });
        expect(normalized.diagnostic_tests.serology).toMatchObject({
            ehrlichia_antibody: 'positive',
            anaplasma_antibody: 'negative',
            borrelia_antibody: 'negative',
            dirofilaria_immitis_antigen: 'negative',
        });
        expect(normalized.diagnostic_tests.cbc).toMatchObject({
            thrombocytopenia: 'severe',
            platelet_count: 'severe_thrombocytopenia',
            anemia_type: 'non_regenerative',
            lymphopenia: 'present',
            hyperproteinaemia: 'present',
            intramonocytic_morulae: 'present',
        });
        expect(normalized.diagnostic_tests.biochemistry).toMatchObject({
            albumin: 'hypoalbuminemia',
            globulins: 'hyperglobulinemia',
            total_protein: 'elevated',
        });
        expect(normalized.normalized_findings.some((finding) => finding.canonical_path === 'pcr.ehrlichia_pcr')).toBe(true);
    });
});
