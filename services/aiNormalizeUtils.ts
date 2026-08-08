import type {
    JDCapabilityAnalysis,
    JDAnalysisResult,
    JDInterpretation,
    RawJDAnalysisResult,
    ResumeEvaluation,
    ResumeEvaluationDimension,
    ResumeEvaluationDimensionName,
    ResumeEvaluationIssue,
    ResumeEvaluationRiskFlag,
} from '../types/ai';
import {
    RESUME_EVALUATION_DIMENSIONS,
    RESUME_EVALUATION_VERSION,
} from '../types/ai';

export type { RawJDAnalysisResult } from '../types/ai';

type JsonRecord = Record<string, unknown>;

const toRecord = (value: unknown): JsonRecord | null => (
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : null
);

const getAliased = (record: JsonRecord, camel: string, snake: string) => (
    record[camel] ?? record[snake]
);

const toText = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const toStringArray = (value: unknown) => Array.isArray(value)
    ? value.map(toText).filter(Boolean)
    : [];

const toBoundedNumber = (value: unknown, min: number, max: number) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) {
        return null;
    }
    return Math.min(max, Math.max(min, numeric));
};

const toStrictBoundedNumber = (value: unknown, min: number, max: number) => (
    typeof value === 'number'
    && Number.isFinite(value)
    && value >= min
    && value <= max
        ? value
        : null
);

const toScore = (value: unknown) => {
    const score = toBoundedNumber(value, 0, 100);
    return score === null ? null : Math.round(score);
};

const toStrictInteger = (value: unknown, min: number, max: number) => (
    typeof value === 'number'
    && Number.isInteger(value)
    && value >= min
    && value <= max
        ? value
        : null
);

const RESUME_EVALUATION_RUBRIC: Record<
    ResumeEvaluationDimensionName,
    ReadonlyArray<readonly [string, number]>
> = {
    逻辑清晰: [['信息顺序', 25], ['因果关系', 30], ['信息层级', 20], ['一致性与聚焦', 25]],
    STAR应用: [['Situation情境', 15], ['Task任务', 15], ['Action行动', 35], ['Result结果', 35]],
    内容可读: [['扫读结构', 25], ['句子清晰度', 25], ['信息密度', 20], ['语法与自然度', 15], ['重复与冗余', 15]],
    内容完整: [['基础信息', 10], ['教育经历', 15], ['核心经历模块', 25], ['经历必要字段', 20], ['技能与资格', 15], ['求职方向', 10], ['补充信息', 5]],
    专业表达: [['行动动词', 20], ['岗位术语', 20], ['表达精确度', 20], ['贡献与责任边界', 20], ['客观与可信', 20]],
    成果量化: [['结果指标', 30], ['基线与前后对比', 25], ['覆盖规模', 15], ['时间窗口', 10], ['过程数量', 10], ['数据可信度', 10]],
};

const resolveEvaluationLevel = (score: number) => {
    if (score >= 93) return '卓越';
    if (score >= 85) return '优秀';
    if (score >= 75) return '良好';
    if (score >= 60) return '合格';
    if (score >= 40) return '较弱';
    return '不足';
};

const isDimensionName = (value: string): value is ResumeEvaluationDimensionName => (
    (RESUME_EVALUATION_DIMENSIONS as readonly string[]).includes(value)
);

const normalizeDimension = (value: unknown): ResumeEvaluationDimension | null => {
    const record = toRecord(value);
    if (!record) {
        return null;
    }
    const dimension = toText(record.dimension);
    if (!isDimensionName(dimension)) {
        return null;
    }
    const expectedSubscores = RESUME_EVALUATION_RUBRIC[dimension];
    if (!Array.isArray(record.subscores) || record.subscores.length !== expectedSubscores.length) {
        return null;
    }
    const providedSubscores = new Map<string, JsonRecord>();
    for (const item of record.subscores) {
        const subscore = toRecord(item);
        const name = subscore ? toText(subscore.name) : '';
        if (!subscore || !name || providedSubscores.has(name)) {
            return null;
        }
        providedSubscores.set(name, subscore);
    }
    const subscores: ResumeEvaluationDimension['subscores'] = [];
    let calculatedScore = 0;
    for (const [name, expectedMaxScore] of expectedSubscores) {
        const subscore = providedSubscores.get(name);
        if (!subscore) {
            return null;
        }
        const maxScore = toStrictInteger(
            getAliased(subscore, 'maxScore', 'max_score'),
            0,
            100
        );
        const subscoreValue = toStrictInteger(subscore.score, 0, expectedMaxScore);
        if (maxScore !== expectedMaxScore || subscoreValue === null) {
            return null;
        }
        calculatedScore += subscoreValue;
        subscores.push({
            name,
            maxScore: expectedMaxScore,
            score: subscoreValue,
            evidenceIds: toStringArray(getAliased(subscore, 'evidenceIds', 'evidence_ids')),
        });
    }
    const providedScore = toStrictInteger(record.score, 0, 100);
    if (providedScore === null || providedScore !== calculatedScore) {
        return null;
    }
    return {
        dimension,
        score: calculatedScore,
        level: resolveEvaluationLevel(calculatedScore),
        subscores,
        strengths: toStringArray(record.strengths),
        issues: toStringArray(record.issues),
        improvementQuestions: toStringArray(
            getAliased(record, 'improvementQuestions', 'improvement_questions')
        ),
    };
};

const normalizeIssue = (value: unknown): ResumeEvaluationIssue | null => {
    const record = toRecord(value);
    if (!record) {
        return null;
    }
    const issueId = toText(getAliased(record, 'issueId', 'issue_id'));
    const primaryDimension = toText(
        getAliased(record, 'primaryDimension', 'primary_dimension')
    );
    const severity = toText(record.severity);
    const pointsNotEarned = toScore(
        getAliased(record, 'pointsNotEarned', 'points_not_earned')
    );
    if (
        !issueId
        || !isDimensionName(primaryDimension)
        || !['high', 'medium', 'low'].includes(severity)
        || pointsNotEarned === null
    ) {
        return null;
    }
    return {
        issueId,
        description: toText(record.description),
        primaryDimension,
        relatedDimensions: toStringArray(
            getAliased(record, 'relatedDimensions', 'related_dimensions')
        ).filter(isDimensionName),
        evidenceIds: toStringArray(getAliased(record, 'evidenceIds', 'evidence_ids')),
        severity: severity as ResumeEvaluationIssue['severity'],
        pointsNotEarned,
    };
};

const RISK_TYPES: ResumeEvaluationRiskFlag['type'][] = [
    'unverified_fact',
    'inferred_fact',
    'exaggerated_claim',
    'conflicting_date',
    'duplicated_content',
];

export const normalizeResumeEvaluation = (value: unknown): ResumeEvaluation | undefined => {
    const record = toRecord(value);
    if (!record) {
        return undefined;
    }
    const evaluationVersion = toText(
        getAliased(record, 'evaluationVersion', 'evaluation_version')
    );
    const evaluationScope = toText(
        getAliased(record, 'evaluationScope', 'evaluation_scope')
    );
    if (
        evaluationVersion !== RESUME_EVALUATION_VERSION
        || evaluationScope !== 'full_resume'
    ) {
        return undefined;
    }
    const normalizedDimensions = Array.isArray(record.dimensions)
        ? record.dimensions.map(normalizeDimension).filter((item): item is ResumeEvaluationDimension => Boolean(item))
        : [];
    const dimensionsByName = new Map(
        normalizedDimensions.map((dimension) => [dimension.dimension, dimension])
    );
    const dimensions = RESUME_EVALUATION_DIMENSIONS.map((name) => dimensionsByName.get(name));
    if (
        !Array.isArray(record.dimensions)
        || record.dimensions.length !== RESUME_EVALUATION_DIMENSIONS.length
        || normalizedDimensions.length !== RESUME_EVALUATION_DIMENSIONS.length
        || dimensionsByName.size !== RESUME_EVALUATION_DIMENSIONS.length
        || dimensions.some((dimension) => !dimension)
    ) {
        return undefined;
    }
    const overallScore = toStrictInteger(
        getAliased(record, 'overallScore', 'overall_score'),
        0,
        100
    );
    const evaluationConfidenceValue = getAliased(
        record,
        'evaluationConfidence',
        'evaluation_confidence'
    );
    const evaluationConfidence = typeof evaluationConfidenceValue === 'number'
        && Number.isFinite(evaluationConfidenceValue)
        && evaluationConfidenceValue >= 0
        && evaluationConfidenceValue <= 1
        ? evaluationConfidenceValue
        : null;
    const scoreCalculationRecord = toRecord(
        getAliased(record, 'scoreCalculation', 'score_calculation')
    );
    if (overallScore === null || evaluationConfidence === null || !scoreCalculationRecord) {
        return undefined;
    }
    const dimensionSum = toStrictInteger(
        getAliased(scoreCalculationRecord, 'dimensionSum', 'dimension_sum'),
        0,
        600
    );
    const rawAverage = toStrictBoundedNumber(
        getAliased(scoreCalculationRecord, 'rawAverage', 'raw_average'),
        0,
        100
    );
    const finalScore = toStrictInteger(
        getAliased(scoreCalculationRecord, 'finalScore', 'final_score')
        , 0, 100
    );
    const typedDimensions = dimensions as ResumeEvaluationDimension[];
    const calculatedDimensionSum = typedDimensions.reduce(
        (sum, dimension) => sum + dimension.score,
        0
    );
    const calculatedRawAverage = calculatedDimensionSum / 6;
    const calculatedFinalScore = Math.floor(calculatedRawAverage + 0.5);
    if (
        dimensionSum === null
        || rawAverage === null
        || finalScore === null
        || toText(getAliased(scoreCalculationRecord, 'roundingRule', 'rounding_rule')) !== 'round_half_up'
        || dimensionSum !== calculatedDimensionSum
        || Math.abs(rawAverage - calculatedRawAverage) > Number.EPSILON * 16
        || finalScore !== calculatedFinalScore
        || overallScore !== calculatedFinalScore
    ) {
        return undefined;
    }
    const jdMatchValue = getAliased(record, 'jdMatch', 'jd_match');
    const jdMatch = jdMatchValue === null || jdMatchValue === undefined
        ? null
        : toStrictInteger(jdMatchValue, 0, 100);
    if (jdMatchValue !== null && jdMatchValue !== undefined && jdMatch === null) {
        return undefined;
    }
    return {
        evaluationVersion: RESUME_EVALUATION_VERSION,
        evaluationScope: 'full_resume',
        targetRole: toText(getAliased(record, 'targetRole', 'target_role')),
        overallScore,
        overallLevel: resolveEvaluationLevel(calculatedFinalScore),
        evaluationConfidence,
        scoreCalculation: {
            dimensionSum: calculatedDimensionSum,
            rawAverage: calculatedRawAverage,
            roundingRule: 'round_half_up',
            finalScore: calculatedFinalScore,
        },
        dimensions: typedDimensions,
        evidence: Array.isArray(record.evidence)
            ? record.evidence.flatMap((item) => {
                const evidence = toRecord(item);
                if (!evidence) {
                    return [];
                }
                const evidenceId = toText(getAliased(evidence, 'evidenceId', 'evidence_id'));
                if (!evidenceId) {
                    return [];
                }
                return [{
                    evidenceId,
                    sourceText: toText(getAliased(evidence, 'sourceText', 'source_text')),
                    location: toText(evidence.location),
                    factId: toText(getAliased(evidence, 'factId', 'fact_id')),
                    verificationStatus: toText(
                        getAliased(evidence, 'verificationStatus', 'verification_status')
                    ),
                    supportedDimensions: toStringArray(
                        getAliased(evidence, 'supportedDimensions', 'supported_dimensions')
                    ).filter(isDimensionName),
                }];
            })
            : [],
        issues: Array.isArray(record.issues)
            ? record.issues.map(normalizeIssue).filter((issue): issue is ResumeEvaluationIssue => Boolean(issue))
            : [],
        jdMatch,
        missingInformation: Array.isArray(getAliased(record, 'missingInformation', 'missing_information'))
            ? (getAliased(record, 'missingInformation', 'missing_information') as unknown[]).flatMap((item) => {
                const missing = toRecord(item);
                if (!missing) {
                    return [];
                }
                const potentialDimension = toText(
                    getAliased(missing, 'potentialDimension', 'potential_dimension')
                );
                const potentialScoreGain = toScore(
                    getAliased(missing, 'potentialScoreGain', 'potential_score_gain')
                );
                return [{
                    field: toText(missing.field),
                    reason: toText(missing.reason),
                    question: toText(missing.question),
                    potentialDimension: isDimensionName(potentialDimension) ? potentialDimension : '',
                    potentialScoreGain: potentialScoreGain ?? 0,
                }];
            })
            : [],
        riskFlags: Array.isArray(getAliased(record, 'riskFlags', 'risk_flags'))
            ? (getAliased(record, 'riskFlags', 'risk_flags') as unknown[]).flatMap((item) => {
                const risk = toRecord(item);
                const type = risk ? toText(risk.type) : '';
                if (!risk || !RISK_TYPES.includes(type as ResumeEvaluationRiskFlag['type'])) {
                    return [];
                }
                return [{
                    type: type as ResumeEvaluationRiskFlag['type'],
                    description: toText(risk.description),
                    evidenceIds: toStringArray(getAliased(risk, 'evidenceIds', 'evidence_ids')),
                }];
            })
            : [],
        topPriorities: Array.isArray(getAliased(record, 'topPriorities', 'top_priorities'))
            ? (getAliased(record, 'topPriorities', 'top_priorities') as unknown[]).flatMap((item) => {
                const priority = toRecord(item);
                if (!priority) {
                    return [];
                }
                const priorityValue = toBoundedNumber(priority.priority, 1, 999);
                const expectedScoreGain = toScore(
                    getAliased(priority, 'expectedScoreGain', 'expected_score_gain')
                );
                if (priorityValue === null) {
                    return [];
                }
                return [{
                    priority: Math.round(priorityValue),
                    issueId: toText(getAliased(priority, 'issueId', 'issue_id')),
                    action: toText(priority.action),
                    expectedScoreGain: expectedScoreGain ?? 0,
                }];
            })
            : [],
    };
};

export const normalizeJDAnalysisResult = (result: RawJDAnalysisResult): JDAnalysisResult => {
    const extractedJdText = typeof result.extractedJdText === 'string'
        ? result.extractedJdText
        : typeof result.extracted_jd_text === 'string'
            ? result.extracted_jd_text
            : undefined;
    const jdInterpretation = result.jdInterpretation && typeof result.jdInterpretation === 'object'
        ? result.jdInterpretation
        : result.jd_interpretation && typeof result.jd_interpretation === 'object'
            ? (result.jd_interpretation as JDInterpretation)
            : undefined;
    const capabilityAnalysis = result.capabilityAnalysis && typeof result.capabilityAnalysis === 'object'
        ? result.capabilityAnalysis
        : result.capability_analysis && typeof result.capability_analysis === 'object'
            ? (result.capability_analysis as JDCapabilityAnalysis)
            : undefined;
    const resumeEvaluation = normalizeResumeEvaluation(
        result.resumeEvaluation ?? result.resume_evaluation
    );
    const normalizedResult = { ...result };
    delete normalizedResult.resumeEvaluation;
    delete normalizedResult.resume_evaluation;
    return {
        ...normalizedResult,
        ...(extractedJdText ? { extractedJdText } : {}),
        ...(jdInterpretation ? { jdInterpretation } : {}),
        ...(capabilityAnalysis ? { capabilityAnalysis } : {}),
        ...(resumeEvaluation ? { resumeEvaluation } : {}),
    };
};

/**
 * JD matching and six-dimension evaluation now use independent endpoints.
 * A fresh JD response is valid without resumeEvaluation and its
 * matchPercentage must remain the JD-fit score returned by that endpoint.
 */
export const normalizeCurrentJDAnalysisResult = (
    result: RawJDAnalysisResult
): JDAnalysisResult => {
    const normalized = normalizeJDAnalysisResult(result);
    return normalized;
};
