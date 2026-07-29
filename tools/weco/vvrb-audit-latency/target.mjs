const GENERIC_EVIDENCE_PATTERN =
    /standard veterinary clinical reasoning patterns|general veterinary knowledge|synthetic benchmark/i;
const BECAUSE_PATTERN = /\bbecause\b/i;

export function computeVvrbAuditSignals(records) {
    const domainBuckets = new Map();
    const reasoningCounts = new Map();
    const historyCounts = new Map();
    const labPatternCounts = new Map();
    const amrDecisionCounts = new Map();
    const correlationPairs = [];

    let syntheticCases = 0;
    let leakageRows = 0;
    let genericEvidenceRows = 0;

    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (record.synthetic === true) syntheticCases += 1;

        const confirmed = readText(record.confirmed_diagnosis);
        const normalizedConfirmed = confirmed === null ? null : normalizeText(confirmed);
        const topDiagnosis = readText(record.evaluation_targets?.top1_differential)
            ?? readText(record.differential_diagnoses?.[0]);
        if (
            normalizedConfirmed !== null
            && topDiagnosis !== null
            && normalizedConfirmed === normalizeText(topDiagnosis)
        ) {
            leakageRows += 1;
        }

        if (normalizedConfirmed !== null) {
            const domain = readText(record.case_domain) ?? 'unknown';
            let bucket = domainBuckets.get(domain);
            if (bucket === undefined) {
                bucket = { total: 0, diagnoses: new Map() };
                domainBuckets.set(domain, bucket);
            }
            bucket.total += 1;
            increment(bucket.diagnoses, normalizedConfirmed);
        }

        incrementOptional(reasoningCounts, reasoningOpener(record.reasoning_chain_public));
        incrementOptional(historyCounts, normalizeOptionalText(record.history));
        increment(labPatternCounts, stableJson(record.labs ?? {}));
        increment(amrDecisionCounts, stableJson(record.antimicrobial_decision ?? {}));

        const confidence = readScore(record.confidence_score);
        const cire = readScore(record.cire_phi_hat);
        if (confidence !== null && cire !== null) {
            correlationPairs.push([confidence, cire]);
        }

        if (hasOnlyGenericEvidenceSources(record.evidence_sources)) {
            genericEvidenceRows += 1;
        }
    }

    const totalCases = records.length;
    return {
        total_cases: totalCases,
        synthetic_cases: syntheticCases,
        invalid_cases: totalCases - syntheticCases,
        leakage_rows: leakageRows,
        diagnosis_leakage_rate: roundMetric(ratio(leakageRows, totalCases)),
        domain_diagnosis_diversity: Array.from(domainBuckets.entries())
            .map(([domain, bucket]) => {
                const [topDiagnosis, topCount] = topEntry(bucket.diagnoses);
                return {
                    domain,
                    total_cases: bucket.total,
                    unique_confirmed_diagnoses: bucket.diagnoses.size,
                    top_confirmed_diagnosis: topDiagnosis,
                    top_confirmed_diagnosis_rate: roundMetric(ratio(topCount, bucket.total)),
                };
            })
            .sort((left, right) =>
                right.total_cases - left.total_cases || left.domain.localeCompare(right.domain),
            ),
        repeated_reasoning_top_rate: roundMetric(topRate(reasoningCounts)),
        repeated_history_top_rate: roundMetric(topRate(historyCounts)),
        unique_lab_pattern_count: labPatternCounts.size,
        lab_pattern_top_rate: roundMetric(topRate(labPatternCounts)),
        unique_amr_decision_count: amrDecisionCounts.size,
        amr_decision_top_rate: roundMetric(topRate(amrDecisionCounts)),
        confidence_cire_correlation: correlationPairs.length < 3
            ? null
            : roundMetric(pearson(correlationPairs)),
        generic_evidence_source_rate: roundMetric(ratio(genericEvidenceRows, totalCases)),
    };
}

function increment(counts, value) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
}

function incrementOptional(counts, value) {
    if (value !== null) increment(counts, value);
}

function topRate(counts) {
    let total = 0;
    let topCount = 0;
    for (const count of counts.values()) {
        total += count;
        if (count > topCount) topCount = count;
    }
    return ratio(topCount, total);
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
    const match = BECAUSE_PATTERN.exec(text);
    const opener = match === null ? text : text.slice(0, match.index);
    return normalizeText(opener);
}

function hasOnlyGenericEvidenceSources(value) {
    if (!Array.isArray(value)) return true;
    for (let index = 0; index < value.length; index += 1) {
        const source = readText(value[index]);
        if (source !== null && !GENERIC_EVIDENCE_PATTERN.test(source)) return false;
    }
    return true;
}

function pearson(pairs) {
    let leftTotal = 0;
    let rightTotal = 0;
    for (const [left, right] of pairs) {
        leftTotal += left;
        rightTotal += right;
    }
    const leftMean = leftTotal / pairs.length;
    const rightMean = rightTotal / pairs.length;

    let numerator = 0;
    let leftSquared = 0;
    let rightSquared = 0;
    for (const [left, right] of pairs) {
        const leftDelta = left - leftMean;
        const rightDelta = right - rightMean;
        numerator += leftDelta * rightDelta;
        leftSquared += leftDelta * leftDelta;
        rightSquared += rightDelta * rightDelta;
    }
    if (leftSquared === 0 || rightSquared === 0) return 0;
    return numerator / Math.sqrt(leftSquared * rightSquared);
}

function stableJson(value) {
    if (Array.isArray(value)) {
        let result = '[';
        for (let index = 0; index < value.length; index += 1) {
            if (index > 0) result += ',';
            result += stableJson(value[index]);
        }
        return `${result}]`;
    }
    if (value !== null && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        let result = '{';
        for (let index = 0; index < keys.length; index += 1) {
            if (index > 0) result += ',';
            const key = keys[index];
            result += `${JSON.stringify(key)}:${stableJson(value[key])}`;
        }
        return `${result}}`;
    }
    return JSON.stringify(value ?? null);
}

function readText(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
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
