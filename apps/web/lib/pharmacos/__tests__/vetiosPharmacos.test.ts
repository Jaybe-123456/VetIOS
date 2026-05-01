import { describe, expect, it } from 'vitest';
import { buildPharmacOSProtocol } from '../vetiosPharmacos';

describe('VetIOS PharmacOS protocol builder', () => {
    it('resolves structured canine parvo doses from the current query', async () => {
        const protocol = await buildPharmacOSProtocol({
            queryText: 'canine parvo drug doses for 12 kg dog',
            messageContent: 'Previous visual descriptors were generated for feline panleukopenia.',
            patientWeightKg: 12,
        });

        expect(protocol.species).toBe('canine');
        expect(protocol.condition).toBe('Canine parvoviral enteritis');
        expect(protocol.total_drugs).toBeGreaterThan(0);
        expect(protocol.drugs.some((drug) => drug.name === 'Maropitant')).toBe(true);
        expect(protocol.drugs.every((drug) => drug.dose_mg_per_kg !== 'unavailable')).toBe(true);
    });
});
