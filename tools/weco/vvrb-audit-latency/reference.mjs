const GENERIC_EVIDENCE_PATTERNS = [
    /standard veterinary clinical reasoning patterns/i,
    /general veterinary knowledge/i,
    /synthetic benchmark/i,
];

export function computeReferenceVvrbAuditSignals(records) {
    const syntheticCases = records.filter((record) => record.synthetic === true).length;
    const leakageRows = records.filter((record) => {
        const confirmed = readText(record.confirmed_diagnosis);
        const topDiagnosis = readText(record.evaluation_targets?.top1_differential)
            ?? readText(record.differential_diagnoses?.[0]);
        return confirmed !== null
            && topDiagnosis !== null
            && normalizeText(confirmed) === normalizeText(topDiagnosis);
    }).length;

    const domainBuckets = new Map();
    for (const record of records) {
        const confirmed = readText(record.confirmed_diagnosis);
        if (confirmed === null) continue;
        const domain = readText(record.case_domain) ?? 'unknown';
        const diagnoses = domainBuckets.get(domain) ?? [];
        diagnoses.push(normalizeText(confirmed));
        domainBuckets.set(domain, diagnoses);
    }

    const reasoningOpeners = records
        .map((record) => reasoningOpener(record.reasoning_chain_public))
        .filter((value) => value !== null);
    const histories = records
        .map((record) => normalizeOptionalText(record.history))
        .filter((value) => value !== null);
    const labPatterns = records.map((record) => stableJson(record.labs ?? {}));
    const amrDecisions = records.map((record) => stableJson(record.antimicrobial_decision ?? {}));
    const correlationPairs = records
        .map((record) => [readScore(record.confidence_score), readScore(record.cire_phi_hat)])
        .filter(([left, right]) => left !== null && right !== null);
    const genericEvidenceRows = records.filter((record) =>
        hasOnlyGenericEvidenceSources(record.evidence_sources),
    ).length;

    const totalCases = records.length;
    return {
        total_cases: totalCases,
        synthetic_cases: syntheticCases,
        invalid_cases: totalCases - syntheticCases,
        leakage_rows: leakageRows,
        diagnosis_leakage_rate: roundMetric(ratio(leakageRows, totalCases)),
        domain_diagnosis_diversity: Array.from(domainBuckets.entries())
            .map(([domain, diagnoses]) => {
                const counts = countValues(diagnoses);
                const [topDiagnosis, topCount] = topEntry(counts);
                return {
                    domain,
                    total_cases: diagnoses.length,
                    unique_confirmed_diagnoses: counts.size,
                    top_confirmed_diagnosis: topDiagnosis,
                    top_confirmed_diagnosis_rate: roundMetric(ratio(topCount, diagnoses.length)),
                };
            })
            .sort((left, right) =>
                right.total_cases - left.total_cases || left.domain.localeCompare(right.domain),
            ),
        repeated_reasoning_top_rate: roundMetric(topRate(reasoningOpeners)),
        repeated_history_top_rate: roundMetric(topRate(histories)),
        unique_lab_pattern_count: new Set(labPatterns).size,
        lab_pattern_top_rate: roundMetric(topRate(labPatterns)),
        unique_amr_decision_count: new Set(amrDecisions).size,
        amr_decision_top_rate: roundMetric(topRate(amrDecisions)),
        confidence_cire_correlation: correlationPairs.length < 3
            ? null
            : roundMetric(pearson(correlationPairs)),
        generic_evidence_source_rate: roundMetric(ratio(genericEvidenceRows, totalCases)),
    };
}

function countValues(values) {
    const counts = new Map();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
}

function topRate(values) {
    if (values.length === 0) return 0;
    const [, topCount] = topEntry(countValues(values));
    return topCount / values.length;
}

function topEntry(counts) {
    let topKey = null;
    let topCount = 0;
    for (const [key, count] of counts.entries()) {
        if (count > topCount || (count === topCount && topKey !== null && key < topKey)) {
            topKey = key;
            topCount = count;
        }
    }
    return [topKey, topCount];
}

function reasoningOpener(value) {
    const text = readText(value);
    if (text === null) return null;
    const opener = text.split(/\bbecause\b/i)[0] ?? text;
    return normalizeText(opener);
}

function hasOnlyGenericEvidenceSources(value) {
    if (!Array.isArray(value)) return true;
    const sources = value.map(readText).filter((entry) => entry !== null);
    if (sources.length === 0) return true;
    return sources.every((source) =>
        GENERIC_EVIDENCE_PATTERNS.some((pattern) => pattern.test(source)),
    );
}

function pearson(pairs) {
    const leftMean = pairs.reduce((sum, [left]) => sum + left, 0) / pairs.length;
    const rightMean = pairs.reduce((sum, [, right]) => sum + right, 0) / pairs.length;
    let numerator = 0;
    let leftSquared = 0;
    let rightSquared = 0;
    for (const [left, right] of pairs) {
        const leftDelta = left - leftMean;
        const rightDelta = right - rightMean;
        numerator += leftDelta * rightDelta;
        leftSquared += leftDelta ** 2;
        rightSquared += rightDelta ** 2;
    }
    if (leftSquared === 0 || rightSquared === 0) return 0;
    return numerator / Math.sqrt(leftSquared * rightSquared);
}

function stableJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) =>
            `${JSON.stringify(key)}:${stableJson(value[key])}`,
        ).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

function readText(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readScore(value) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : null;
}

function normalizeOptionalText(value) {
    const text = readText(value);
    return text === null ? null : normalizeText(text);
}

function normalizeText(value) {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function ratio(value, denominator) {
    return denominator <= 0 ? 0 : value / denominator;
}

function roundMetric(value) {
    return Math.round(value * 10_000) / 10_000;
}
