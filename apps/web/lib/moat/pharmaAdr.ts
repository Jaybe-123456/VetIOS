export interface AdverseSignalSummary {
    total: number;
    by_species: Record<string, number>;
    by_drug_class: Record<string, number>;
    by_severity: Record<string, number>;
}

export function matchesOptionalFilter(value: string, filter: string[]) {
    if (filter.length === 0) return true;
    const normalized = value.trim().toLowerCase();
    return filter.some((entry) => entry.trim().toLowerCase() === normalized);
}

export function summarizeAdverseSignals(signals: Array<Record<string, unknown>>): AdverseSignalSummary {
    return signals.reduce<AdverseSignalSummary>((summary, signal) => {
        const species = readString(signal.species) ?? 'unknown';
        const drugClass = readString(signal.drug_class) ?? 'unknown';
        const severity = readString(signal.outcome_severity) ?? 'unknown';
        summary.total += 1;
        summary.by_species[species] = (summary.by_species[species] ?? 0) + 1;
        summary.by_drug_class[drugClass] = (summary.by_drug_class[drugClass] ?? 0) + 1;
        summary.by_severity[severity] = (summary.by_severity[severity] ?? 0) + 1;
        return summary;
    }, {
        total: 0,
        by_species: {} as Record<string, number>,
        by_drug_class: {} as Record<string, number>,
        by_severity: {} as Record<string, number>,
    });
}

function readString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
