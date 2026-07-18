import type { Candidate } from './types.js';

export const legacyCandidate: Candidate = () => ({
    primary_diagnosis: 'dietary_indiscretion',
    differentials: ['gastroenteritis', 'pancreatitis'],
    confidence: 0.92,
    escalation: 'routine',
});

export const correctedCandidate: Candidate = () => ({
    primary_diagnosis: 'canine_parvovirus',
    differentials: ['gastroenteritis', 'intestinal_parasitism'],
    confidence: 0.81,
    escalation: 'urgent',
});
