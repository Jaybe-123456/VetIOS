import { describe, expect, it } from 'vitest';
import { classifyOutbreakStatus, matchesOutbreakSubscriber, outbreakClusterKey } from '../outbreakEarlyWarning';

describe('outbreak early warning helpers', () => {
    it('classifies elevated and alert clusters using velocity and minimum case counts', () => {
        expect(classifyOutbreakStatus({ velocity: 1.2, count: 12, minCount: 5, elevatedThreshold: 0.4, alertThreshold: 1 })).toBe('alert');
        expect(classifyOutbreakStatus({ velocity: 0.6, count: 5, minCount: 5, elevatedThreshold: 0.4, alertThreshold: 1 })).toBe('elevated');
        expect(classifyOutbreakStatus({ velocity: 2.5, count: 3, minCount: 5, elevatedThreshold: 0.4, alertThreshold: 1 })).toBe('monitoring');
    });

    it('routes alerts only to matching regional subscribers', () => {
        expect(matchesOutbreakSubscriber({
            regionFilter: ['US-CA'],
            speciesFilter: ['canine'],
        }, {
            regionCode: 'us-ca',
            species: 'Canine',
        })).toBe(true);

        expect(matchesOutbreakSubscriber({
            regionFilter: ['US-NY'],
            speciesFilter: [],
        }, {
            regionCode: 'US-CA',
            species: 'canine',
        })).toBe(false);
    });

    it('builds stable cluster keys independent of symptom order', () => {
        const first = outbreakClusterKey({ regionCode: 'US-CA', species: 'canine', symptomSignature: ['fever', 'vomiting'], suggestedDifferential: 'Parvovirus' });
        const second = outbreakClusterKey({ regionCode: 'us-ca', species: 'Canine', symptomSignature: ['vomiting', 'fever'], suggestedDifferential: 'parvovirus' });

        expect(first).toBe(second);
    });
});
