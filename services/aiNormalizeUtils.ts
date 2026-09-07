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

const ALIAS_CONFLICT = Symbol('alias-conflict');

const toRecord = (value: unknown): JsonRecord | null => (
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : null
);

const areEquivalentJsonValues = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((item, index) => areEquivalentJsonValues(item, right[index]));
    }
    const leftRecord = toRecord(left);
    const rightRecord = toRecord(right);
    if (!leftRecord || !rightRecord) {
        return false;
    }
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => (
            key === rightKeys[index]
            && areEquivalentJsonValues(leftRecord[key], rightRecord[key])
        ));
};

const getAliased = (record: JsonRecord, camel: string, snake: string) => {
    const hasCamel = Object.prototype.hasOwnProperty.call(record, camel);
    const hasSnake = Object.prototype.hasOwnProperty.call(record, snake);
    if (
        hasCamel
        && hasSnake
        && !areEquivalentJsonValues(record[camel], record[snake])
    ) {
        return ALIAS_CONFLICT;
    }
    if (hasCamel) return record[camel];
    if (hasSnake) return record[snake];
    return undefined;
};

const toText = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const toRequiredText = (value: unknown) => {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim();
    return normalized ? normalized : null;
};

const toOptionalText = (value: unknown) => (
    typeof value === 'string' ? value.trim() : null
);

const normalizeUniqueStringArray = <T extends string = string>(
    value: unknown,
    normalizeItem: (item: string) => T | null = (item) => item as T
): T[] | null => {
    if (!Array.isArray(value)) {
        return null;
    }
    const normalized: T[] = [];
    const seen = new Set<T>();
    for (const item of value) {
        const text = toRequiredText(item);
        const normalizedItem = text === null ? null : normalizeItem(text);
        if (normalizedItem === null) {
            return null;
        }
        if (!seen.has(normalizedItem)) {
            seen.add(normalizedItem);
            normalized.push(normalizedItem);
        }
    }
    return normalized;
};

const normalizeRequiredArray = <T>(
    value: unknown,
    normalizeItem: (item: unknown) => T | null
): T[] | null => {
    if (!Array.isArray(value)) {
        return null;
    }
    const normalized: T[] = [];
    for (const item of value) {
        const normalizedItem = normalizeItem(item);
        if (normalizedItem === null) {
            return null;
        }
        normalized.push(normalizedItem);
    }
    return normalized;
};

const toStrictBoundedNumber = (value: unknown, min: number, max: number) => (
    typeof value === 'number'
    && Number.isFinite(value)
    && value >= min
    && value <= max
        ? value
        : null
);

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

const normalizeDimensionName = (value: string) => (
    isDimensionName(value) ? value : null
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
        const evidenceIds = normalizeUniqueStringArray(
            getAliased(subscore, 'evidenceIds', 'evidence_ids')
        );
        if (evidenceIds === null) {
            return null;
        }
        calculatedScore += subscoreValue;
        subscores.push({
            name,
            maxScore: expectedMaxScore,
            score: subscoreValue,
            evidenceIds,
        });
    }
    const providedScore = toStrictInteger(record.score, 0, 100);
    if (providedScore === null || providedScore !== calculatedScore) {
        return null;
    }
    const strengths = normalizeUniqueStringArray(record.strengths);
    const issues = normalizeUniqueStringArray(record.issues);
    const improvementQuestions = normalizeUniqueStringArray(
        getAliased(record, 'improvementQuestions', 'improvement_questions')
    );
    if (strengths === null || issues === null || improvementQuestions === null) {
        return null;
    }
    return {
        dimension,
        score: calculatedScore,
        level: resolveEvaluationLevel(calculatedScore),
        subscores,
        strengths,
        issues,
        improvementQuestions,
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
    const pointsNotEarned = toStrictInteger(
        getAliased(record, 'pointsNotEarned', 'points_not_earned'),
        0,
        100
    );
    const description = toRequiredText(record.description);
    const relatedDimensionsValue = getAliased(
        record,
        'relatedDimensions',
        'related_dimensions'
    );
    const relatedDimensions = relatedDimensionsValue === undefined
        || relatedDimensionsValue === null
        ? []
        : normalizeUniqueStringArray(relatedDimensionsValue, normalizeDimensionName);
    const evidenceIds = normalizeUniqueStringArray(
        getAliased(record, 'evidenceIds', 'evidence_ids')
    );
    if (
        !issueId
        || description === null
        || !isDimensionName(primaryDimension)
        || relatedDimensions === null
        || evidenceIds === null
        || !['high', 'medium', 'low'].includes(severity)
        || pointsNotEarned === null
    ) {
        return null;
    }
    return {
        issueId,
        description,
        primaryDimension,
        relatedDimensions: relatedDimensions.filter(
            (dimension) => dimension !== primaryDimension
        ),
        evidenceIds,
        severity: severity as ResumeEvaluationIssue['severity'],
        pointsNotEarned,
    };
};

// Match only textual identity here; semantic equivalence is a model judgment.
const issueTextIdentity = (description: string) => description
    .normalize('NFKC').replace(/\s+/gu, ' ').trim();

const normalizeIdenticalIssues = (issues: ResumeEvaluationIssue[]) => {
    const rawIssueIds = new Set<string>();
    const primaryBySignature = new Map<string, ResumeEvaluationDimensionName>();
    const issueIdBySemanticKey = new Map<string, string>();
    const remappedIssueIds = new Map<string, string>();
    const normalized: ResumeEvaluationIssue[] = [];
    for (const issue of issues) {
        if (rawIssueIds.has(issue.issueId)) {
            return null;
        }
        rawIssueIds.add(issue.issueId);
        const signature = JSON.stringify([
            issueTextIdentity(issue.description), [...issue.evidenceIds].sort(),
        ]);
        const existingPrimary = primaryBySignature.get(signature);
        if (existingPrimary && existingPrimary !== issue.primaryDimension) {
            return null;
        }
        primaryBySignature.set(signature, issue.primaryDimension);
        const semanticKey = JSON.stringify([
            issue.primaryDimension, signature, issue.severity,
            [...issue.relatedDimensions].sort(), issue.pointsNotEarned,
        ]);
        const canonicalIssueId = issueIdBySemanticKey.get(semanticKey);
        if (canonicalIssueId) {
            remappedIssueIds.set(issue.issueId, canonicalIssueId);
            continue;
        }
        issueIdBySemanticKey.set(semanticKey, issue.issueId);
        normalized.push(issue);
    }
    return { issues: normalized, remappedIssueIds };
};

const RISK_TYPES: ResumeEvaluationRiskFlag['type'][] = [
    'unverified_fact',
    'inferred_fact',
    'exaggerated_claim',
    'conflicting_date',
    'duplicated_content',
];

const EVIDENCE_VERIFICATION_STATUSES = new Set([
    'verified',
    'user_claimed',
    'unverified',
    'inferred',
]);

const POSITIVE_EVIDENCE_VERIFICATION_STATUSES = new Set([
    'verified',
    'user_claimed',
]);

const normalizeEvidence = (value: unknown): ResumeEvaluation['evidence'][number] | null => {
    const record = toRecord(value);
    if (!record) {
        return null;
    }
    const evidenceId = toRequiredText(getAliased(record, 'evidenceId', 'evidence_id'));
    const sourceText = toRequiredText(getAliased(record, 'sourceText', 'source_text'));
    const location = record.location === undefined ? '' : toOptionalText(record.location);
    const factId = toRequiredText(getAliased(record, 'factId', 'fact_id'));
    const verificationStatus = toRequiredText(
        getAliased(record, 'verificationStatus', 'verification_status')
    );
    const supportedDimensions = normalizeUniqueStringArray(
        getAliased(record, 'supportedDimensions', 'supported_dimensions'),
        normalizeDimensionName
    );
    if (
        evidenceId === null
        || sourceText === null
        || location === null
        || factId === null
        || verificationStatus === null
        || !EVIDENCE_VERIFICATION_STATUSES.has(verificationStatus)
        || supportedDimensions === null
    ) {
        return null;
    }
    return {
        evidenceId,
        sourceText,
        location,
        factId,
        verificationStatus,
        supportedDimensions,
    };
};

const normalizeMissingInformation = (
    value: unknown
): ResumeEvaluation['missingInformation'][number] | null => {
    const record = toRecord(value);
    if (!record) {
        return null;
    }
    const field = toRequiredText(record.field);
    const reason = toRequiredText(record.reason);
    const question = toRequiredText(record.question);
    const rawPotentialDimension = getAliased(
        record,
        'potentialDimension',
        'potential_dimension'
    );
    const potentialDimensionValue = rawPotentialDimension === undefined
        ? ''
        : toOptionalText(rawPotentialDimension);
    const potentialScoreGain = toStrictInteger(
        getAliased(record, 'potentialScoreGain', 'potential_score_gain'),
        0,
        100
    );
    if (
        field === null
        || reason === null
        || question === null
        || potentialDimensionValue === null
        || (potentialDimensionValue !== '' && !isDimensionName(potentialDimensionValue))
        || potentialScoreGain === null
    ) {
        return null;
    }
    return {
        field,
        reason,
        question,
        potentialDimension: potentialDimensionValue,
        potentialScoreGain,
    };
};

const normalizeRiskFlag = (value: unknown): ResumeEvaluationRiskFlag | null => {
    const record = toRecord(value);
    if (!record) {
        return null;
    }
    const type = toRequiredText(record.type);
    const description = toRequiredText(record.description);
    const evidenceIds = normalizeUniqueStringArray(
        getAliased(record, 'evidenceIds', 'evidence_ids')
    );
    if (
        type === null
        || !RISK_TYPES.includes(type as ResumeEvaluationRiskFlag['type'])
        || description === null
        || evidenceIds === null
    ) {
        return null;
    }
    return {
        type: type as ResumeEvaluationRiskFlag['type'],
        description,
        evidenceIds,
    };
};

const normalizeTopPriority = (
    value: unknown
): ResumeEvaluation['topPriorities'][number] | null => {
    const record = toRecord(value);
    if (!record) {
        return null;
    }
    const priority = toStrictInteger(record.priority, 1, 100);
    const issueId = toRequiredText(getAliased(record, 'issueId', 'issue_id'));
    const action = toRequiredText(record.action);
    const expectedScoreGain = toStrictInteger(
        getAliased(record, 'expectedScoreGain', 'expected_score_gain'),
        0,
        100
    );
    if (
        priority === null
        || issueId === null
        || action === null
        || expectedScoreGain === null
    ) {
        return null;
    }
    return { priority, issueId, action, expectedScoreGain };
};

export const isResumeEvaluationIntegrityDegraded = (
    evaluation: Pick<ResumeEvaluation, 'dimensions' | 'issues' | 'topPriorities'>
) => (
    evaluation.issues.some((issue) => /^SERVER_GAP_/i.test(issue.issueId))
    || evaluation.topPriorities.some((priority) => /^SERVER_GAP_/i.test(priority.issueId))
    || evaluation.dimensions.some((dimension) => (
        dimension.issues.some((issueId) => /^SERVER_GAP_/i.test(issueId))
    ))
    || evaluation.dimensions.some((dimension) => (
        dimension.score === 0
        && dimension.strengths.some((strength) => Boolean(strength.trim()))
    ))
);

const hasClosedEvaluationReferenceGraph = (evaluation: ResumeEvaluation) => {
    const evidenceById = new Map(
        evaluation.evidence.map((evidence) => [evidence.evidenceId, evidence])
    );
    if (
        evidenceById.size !== evaluation.evidence.length
        || evaluation.evidence.some((evidence) => (
            !EVIDENCE_VERIFICATION_STATUSES.has(evidence.verificationStatus)
        ))
    ) {
        return false;
    }

    const evidenceIdsByFactId = new Map<string, string[]>();
    for (const evidence of evaluation.evidence) {
        if (!evidence.factId) continue;
        evidenceIdsByFactId.set(evidence.factId, [
            ...(evidenceIdsByFactId.get(evidence.factId) ?? []),
            evidence.evidenceId,
        ]);
    }
    const uniqueFactAliases = new Map(
        [...evidenceIdsByFactId.entries()]
            .filter(([, evidenceIds]) => evidenceIds.length === 1)
            .map(([factId, evidenceIds]) => [factId, evidenceIds[0]])
    );
    const resolveEvidenceIds = (references: string[]) => {
        const resolved: string[] = [];
        const seen = new Set<string>();
        for (const reference of references) {
            const evidenceId = evidenceById.has(reference)
                ? reference
                : uniqueFactAliases.get(reference);
            if (!evidenceId) return null;
            if (!seen.has(evidenceId)) {
                seen.add(evidenceId);
                resolved.push(evidenceId);
            }
        }
        return resolved;
    };

    for (const dimension of evaluation.dimensions) {
        for (const subscore of dimension.subscores) {
            const evidenceIds = resolveEvidenceIds(subscore.evidenceIds);
            if (
                !evidenceIds
                || (subscore.score > 0 && evidenceIds.length === 0)
                || (
                    subscore.score > 0
                    && evidenceIds.some((evidenceId) => (
                        !POSITIVE_EVIDENCE_VERIFICATION_STATUSES.has(
                            evidenceById.get(evidenceId)?.verificationStatus ?? ''
                        )
                    ))
                )
            ) {
                return false;
            }
            if (subscore.score > 0) {
                for (const evidenceId of evidenceIds) {
                    const evidence = evidenceById.get(evidenceId);
                    if (evidence && !evidence.supportedDimensions.includes(dimension.dimension)) {
                        evidence.supportedDimensions.push(dimension.dimension);
                    }
                }
            }
            subscore.evidenceIds = evidenceIds;
        }
    }
    for (const issue of evaluation.issues) {
        const evidenceIds = resolveEvidenceIds(issue.evidenceIds);
        if (!evidenceIds) return false;
        issue.evidenceIds = evidenceIds;
    }
    for (const risk of evaluation.riskFlags) {
        const evidenceIds = resolveEvidenceIds(risk.evidenceIds);
        if (!evidenceIds) return false;
        risk.evidenceIds = evidenceIds;
    }

    const issuesById = new Map(evaluation.issues.map((issue) => [issue.issueId, issue]));
    if (issuesById.size !== evaluation.issues.length) {
        return false;
    }
    const issueReferenceCounts = new Map(evaluation.issues.map((issue) => [issue.issueId, 0]));
    const issueIdsByDimension = new Map<ResumeEvaluationDimensionName, string[]>();
    for (const dimension of evaluation.dimensions) {
        for (const issueId of dimension.issues) {
            const issue = issuesById.get(issueId);
            if (!issue || issue.primaryDimension !== dimension.dimension) {
                return false;
            }
            issueReferenceCounts.set(issueId, (issueReferenceCounts.get(issueId) ?? 0) + 1);
        }
        issueIdsByDimension.set(dimension.dimension, dimension.issues);
    }
    if ([...issueReferenceCounts.values()].some((count) => count !== 1)) {
        return false;
    }
    for (const dimension of evaluation.dimensions) {
        const issueIds = issueIdsByDimension.get(dimension.dimension) ?? [];
        const pointsNotEarned = 100 - dimension.score;
        if (issueIds.length === 0) {
            if (pointsNotEarned > 0) {
                return false;
            }
            continue;
        }
        if (pointsNotEarned === 0) {
            for (const issueId of issueIds) {
                const issue = issuesById.get(issueId);
                if (issue) issue.pointsNotEarned = 0;
            }
            continue;
        }
        let weights = issueIds.map((issueId) => issuesById.get(issueId)?.pointsNotEarned ?? 0);
        let weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
        if (weightTotal === 0) {
            weights = issueIds.map(() => 1);
            weightTotal = issueIds.length;
        }
        const allocations = weights.map((weight) => (
            Math.floor((pointsNotEarned * weight) / weightTotal)
        ));
        const remainders = weights.map((weight) => (
            (pointsNotEarned * weight) % weightTotal
        ));
        let remaining = pointsNotEarned - allocations.reduce((sum, value) => sum + value, 0);
        const remainderOrder = issueIds.map((_issueId, index) => index).sort((left, right) => (
            remainders[right] - remainders[left] || left - right
        ));
        for (const index of remainderOrder) {
            if (remaining === 0) break;
            allocations[index] += 1;
            remaining -= 1;
        }
        issueIds.forEach((issueId, index) => {
            const issue = issuesById.get(issueId);
            if (issue) issue.pointsNotEarned = allocations[index];
        });
    }
    for (const evidence of evaluation.evidence) {
        const supported = new Set(evidence.supportedDimensions);
        evidence.supportedDimensions = RESUME_EVALUATION_DIMENSIONS.filter(
            (dimension) => supported.has(dimension)
        );
    }
    const priorityIssueIds = evaluation.topPriorities.map((priority) => priority.issueId);
    const priorityRanks = evaluation.topPriorities.map((priority) => priority.priority);
    if (
        new Set(priorityIssueIds).size !== priorityIssueIds.length
        || new Set(priorityRanks).size !== priorityRanks.length
        || !evaluation.topPriorities.every((priority) => issuesById.has(priority.issueId))
    ) {
        return false;
    }
    const positiveEvidenceIds = new Set(
        evaluation.dimensions.flatMap((dimension) => (
            dimension.subscores.flatMap((subscore) => (
                subscore.score > 0 ? subscore.evidenceIds : []
            ))
        ))
    );
    return evaluation.evaluationConfidence <= 0.89
        || ![...positiveEvidenceIds].some((evidenceId) => (
            evidenceById.get(evidenceId)?.verificationStatus === 'user_claimed'
        ));
};

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
    const scoringVersion = getAliased(record, 'scoringVersion', 'scoring_version');
    if ((Object.prototype.hasOwnProperty.call(record, 'scoringVersion') || Object.prototype.hasOwnProperty.call(record, 'scoring_version'))
        && (typeof scoringVersion !== 'string' || !scoringVersion.trim())) return undefined;
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
    const evidence = normalizeRequiredArray(record.evidence, normalizeEvidence);
    const rawIssues = normalizeRequiredArray(record.issues, normalizeIssue);
    const missingInformation = normalizeRequiredArray(
        getAliased(record, 'missingInformation', 'missing_information'),
        normalizeMissingInformation
    );
    const riskFlags = normalizeRequiredArray(
        getAliased(record, 'riskFlags', 'risk_flags'),
        normalizeRiskFlag
    );
    const rawTopPriorities = normalizeRequiredArray(
        getAliased(record, 'topPriorities', 'top_priorities'),
        normalizeTopPriority
    );
    const targetRoleValue = getAliased(record, 'targetRole', 'target_role');
    const targetRole = targetRoleValue === undefined
        ? ''
        : toOptionalText(targetRoleValue);
    if (
        evidence === null
        || rawIssues === null
        || missingInformation === null
        || riskFlags === null
        || rawTopPriorities === null
        || targetRole === null
    ) {
        return undefined;
    }
    const semanticIssues = normalizeIdenticalIssues(rawIssues);
    if (!semanticIssues) {
        return undefined;
    }
    const { issues, remappedIssueIds } = semanticIssues;
    for (const dimension of typedDimensions) {
        dimension.issues = [...new Set(
            dimension.issues.map((issueId) => remappedIssueIds.get(issueId) ?? issueId)
        )];
    }
    const seenPriorityIssueIds = new Set<string>();
    const topPriorities = rawTopPriorities.flatMap((priority) => {
        const issueId = remappedIssueIds.get(priority.issueId) ?? priority.issueId;
        if (seenPriorityIssueIds.has(issueId)) {
            return [];
        }
        seenPriorityIssueIds.add(issueId);
        return [{ ...priority, issueId }];
    });
    topPriorities.sort((left, right) => left.priority - right.priority);
    topPriorities.forEach((priority, index) => {
        priority.priority = index + 1;
    });
    const normalized: ResumeEvaluation = {
        evaluationVersion: RESUME_EVALUATION_VERSION,
        ...(typeof scoringVersion === 'string' ? { scoringVersion: scoringVersion.trim() } : {}),
        evaluationScope: 'full_resume',
        targetRole,
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
        evidence,
        issues,
        jdMatch,
        missingInformation,
        riskFlags,
        topPriorities,
    };
    return isResumeEvaluationIntegrityDegraded(normalized)
        || !hasClosedEvaluationReferenceGraph(normalized)
        ? undefined
        : normalized;
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
    const resultRecord = result as unknown as JsonRecord;
    const resumeEvaluation = normalizeResumeEvaluation(
        getAliased(resultRecord, 'resumeEvaluation', 'resume_evaluation')
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
