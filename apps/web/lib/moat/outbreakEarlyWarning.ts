export type OutbreakStatus = 'monitoring' | 'elevated' | 'alert';

export interface OutbreakThresholdInput {
    velocity: number;
    count: number;
    minCount: number;
    elevatedThreshold: number;
    alertThreshold: number;
}

export interface OutbreakSubscriberFilter {
    regionFilter: string[];
    speciesFilter: string[];
}

export interface OutbreakAlertTarget {
    regionCode: string;
    species: string;
}

export function classifyOutbreakStatus(input: OutbreakThresholdInput): OutbreakStatus {
    if (input.velocity > input.alertThreshold && input.count >= Math.max(10, input.minCount)) {
        return 'alert';
    }
    if (input.velocity > input.elevatedThreshold && input.count >= input.minCount) {
        return 'elevated';
    }
    return 'monitoring';
}

export function matchesOutbreakSubscriber(filter: OutbreakSubscriberFilter, target: OutbreakAlertTarget) {
    return matchesOptionalList(target.regionCode, filter.regionFilter)
        && matchesOptionalList(target.species, filter.speciesFilter);
}

export function outbreakClusterKey(target: {
    regionCode: string;
    species: string;
    symptomSignature: string[];
    suggestedDifferential?: string | null;
}) {
    return [
        target.regionCode.toLowerCase(),
        target.species.toLowerCase(),
        target.suggestedDifferential?.toLowerCase() ?? 'unknown',
        [...target.symptomSignature].sort().join('|'),
    ].join('::');
}

function matchesOptionalList(value: string, filters: string[]) {
    if (filters.length === 0) return true;
    const normalized = value.toLowerCase();
    return filters.some((filter) => filter.toLowerCase() === normalized);
}
