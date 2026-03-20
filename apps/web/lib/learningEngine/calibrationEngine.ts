import { type CalibrationBin, type CalibrationEvalRow, type CalibrationReport, type LearningTaskType } from '@/lib/learningEngine/types';

export function buildCalibrationReport(
    rows: CalibrationEvalRow[],
    taskType: LearningTaskType = 'diagnosis',
): CalibrationReport {
    if (rows.length === 0) {
        return {
            task_type: taskType,
            support: 0,
            brier_score: null,
            expected_calibration_error: null,
            reliability_bins: [],
            confidence_histogram: [],
            recommendation: {
                status: 'insufficient_data',
                reasons: ['No calibration-eligible rows were available.'],
                recommended_method: 'none',
                recommended_temperature: null,
            },
        };
    }

    const bins = buildBins(rows, 5);
    const brierScore = average(rows.map((row) => Math.pow(row.predicted_confidence - (row.prediction_correct ? 1 : 0), 2)));
    const ece = bins.reduce((sum, bin) => {
        if (bin.count === 0) return sum;
        return sum + (Math.abs(bin.avg_confidence - bin.accuracy) * (bin.count / rows.length));
    }, 0);
    const meanConfidence = average(rows.map((row) => row.predicted_confidence));
    const empiricalAccuracy = average(rows.map((row) => row.prediction_correct ? 1 : 0));
    const overconfidenceGap = meanConfidence - empiricalAccuracy;

    return {
        task_type: taskType,
        support: rows.length,
        brier_score: round(brierScore),
        expected_calibration_error: round(ece),
        reliability_bins: bins,
        confidence_histogram: bins.map((bin) => ({
            bucket: `${Math.round(bin.lower_bound * 100)}-${Math.round(bin.upper_bound * 100)}`,
            count: bin.count,
        })),
        recommendation: buildRecommendation(ece, overconfidenceGap),
    };
}

function buildBins(rows: CalibrationEvalRow[], bucketCount: number): CalibrationBin[] {
    const bins: CalibrationBin[] = [];

    for (let index = 0; index < bucketCount; index += 1) {
        const lowerBound = index / bucketCount;
        const upperBound = (index + 1) / bucketCount;
        const bucketRows = rows.filter((row) => {
            if (index === bucketCount - 1) {
                return row.predicted_confidence >= lowerBound && row.predicted_confidence <= upperBound;
            }
            return row.predicted_confidence >= lowerBound && row.predicted_confidence < upperBound;
        });

        bins.push({
            lower_bound: lowerBound,
            upper_bound: upperBound,
            count: bucketRows.length,
            avg_confidence: round(average(bucketRows.map((row) => row.predicted_confidence))),
            accuracy: round(average(bucketRows.map((row) => row.prediction_correct ? 1 : 0))),
            brier_score: round(average(bucketRows.map((row) => Math.pow(row.predicted_confidence - (row.prediction_correct ? 1 : 0), 2)))),
        });
    }

    return bins;
}

function buildRecommendation(
    ece: number,
    overconfidenceGap: number,
): CalibrationReport['recommendation'] {
    if (!Number.isFinite(ece)) {
        return {
            status: 'insufficient_data',
            reasons: ['Expected calibration error could not be computed.'],
            recommended_method: 'none',
            recommended_temperature: null,
        };
    }

    if (ece <= 0.08) {
        return {
            status: 'pass',
            reasons: ['Calibration is within the promotion threshold.'],
            recommended_method: 'none',
            recommended_temperature: null,
        };
    }

    if (Math.abs(overconfidenceGap) <= 0.03) {
        return {
            status: 'needs_recalibration',
            reasons: ['Calibration drift is moderate but not strongly directional; isotonic regression is recommended.'],
            recommended_method: 'isotonic_regression',
            recommended_temperature: null,
        };
    }

    const temperature = round(
        overconfidenceGap > 0
            ? 1 + Math.min(overconfidenceGap * 2, 1)
            : Math.max(0.5, 1 + overconfidenceGap),
    );

    return {
        status: 'needs_recalibration',
        reasons: [
            overconfidenceGap > 0
                ? 'Model appears overconfident relative to empirical accuracy.'
                : 'Model appears underconfident relative to empirical accuracy.',
        ],
        recommended_method: 'temperature_scaling',
        recommended_temperature: temperature,
    };
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(4));
}
