import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

const importJDAnalysisPersistenceUtils = async () => {
  const result = await build({
    entryPoints: ['hooks/jdAnalysisPersistenceUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const importJDAnalysisStorage = async () => {
  const result = await build({
    entryPoints: ['services/jdAnalysisStorage.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const buildResult = () => ({
  matchPercentage: 80,
  jobKeywords: ['product'],
  missingKeywords: [],
  summary: 'Matched',
});

const buildItemSignatures = () => ({
  experiences: { 'exp-1': 'exp-sig' },
  certifications: { 'cert-1': 'cert-sig' },
  skills: { 'skill-1': 'skill-sig' },
});

const evaluationRubric = [
  ['逻辑清晰', [['信息顺序', 25], ['因果关系', 30], ['信息层级', 20], ['一致性与聚焦', 25]]],
  ['STAR应用', [['Situation情境', 15], ['Task任务', 15], ['Action行动', 35], ['Result结果', 35]]],
  ['内容可读', [['扫读结构', 25], ['句子清晰度', 25], ['信息密度', 20], ['语法与自然度', 15], ['重复与冗余', 15]]],
  ['内容完整', [['基础信息', 10], ['教育经历', 15], ['核心经历模块', 25], ['经历必要字段', 20], ['技能与资格', 15], ['求职方向', 10], ['补充信息', 5]]],
  ['专业表达', [['行动动词', 20], ['岗位术语', 20], ['表达精确度', 20], ['贡献与责任边界', 20], ['客观与可信', 20]]],
  ['成果量化', [['结果指标', 30], ['基线与前后对比', 25], ['覆盖规模', 15], ['时间窗口', 10], ['过程数量', 10], ['数据可信度', 10]]],
];

const buildPersistedEvaluation = () => ({
  evaluationVersion: 'resume_flow_v1',
  evaluationScope: 'full_resume',
  targetRole: '产品经理',
  overallScore: 100,
  overallLevel: '卓越',
  evaluationConfidence: 0.82,
  scoreCalculation: {
    dimensionSum: 600,
    rawAverage: 100,
    roundingRule: 'round_half_up',
    finalScore: 100,
  },
  dimensions: evaluationRubric.map(([dimension, subscores]) => ({
    dimension,
    score: 100,
    level: '卓越',
    subscores: subscores.map(([name, maxScore]) => ({
      name,
      maxScore,
      score: maxScore,
      evidenceIds: ['E001'],
    })),
    strengths: [],
    issues: [],
    improvementQuestions: [],
  })),
  evidence: [{
    evidenceId: 'E001',
    sourceText: '用户声明事实',
    location: 'resume.profile.name',
    factId: 'FACT_001',
    verificationStatus: 'user_claimed',
    supportedDimensions: evaluationRubric.map(([dimension]) => dimension),
  }],
  issues: [],
  missingInformation: [],
  riskFlags: [],
  topPriorities: [],
  jdMatch: 88,
});

const addZeroPointPersistedIssue = (evaluation, overrides = {}) => {
  const issue = {
    issueId: 'ISSUE_001',
    description: '需要进一步说明',
    primaryDimension: '逻辑清晰',
    relatedDimensions: [],
    evidenceIds: ['E001'],
    severity: 'low',
    pointsNotEarned: 0,
    ...overrides,
  };
  evaluation.issues = [issue];
  evaluation.dimensions[0].issues = [issue.issueId];
};

test('invalidates a persisted lossy report while preserving its JD analysis', async () => {
  const { normalizeJDAnalysisPersistence } = await importJDAnalysisStorage();
  const resumeEvaluation = buildPersistedEvaluation();
  resumeEvaluation.issues = [{
    issueId: 'SERVER_GAP_001',
    description: '历史降级指纹',
    primaryDimension: '逻辑清晰',
    relatedDimensions: [],
    evidenceIds: [],
    severity: 'high',
    pointsNotEarned: 0,
  }];
  resumeEvaluation.dimensions[0].issues = ['SERVER_GAP_001'];

  const normalized = normalizeJDAnalysisPersistence({
    jdText: 'JD text',
    experienceSignature: 'experience-signature',
    evaluationSignature: 'evaluation-signature',
    evaluationSignatureVersion: 'agent_final_snapshot_v1',
    evaluationIsOutdated: false,
    result: {
      ...buildResult(),
      resumeEvaluation,
    },
  });

  assert.ok(normalized);
  assert.equal(normalized.result.matchPercentage, 80);
  assert.equal(normalized.result.summary, 'Matched');
  assert.equal('resumeEvaluation' in normalized.result, false);
  assert.equal(normalized.evaluationSignature, undefined);
  assert.equal(normalized.evaluationSignatureVersion, undefined);
  assert.equal(normalized.evaluationIsOutdated, true);
});

test('normalizes only canonical or legacy-missing JD input modes', async () => {
  const { normalizeJDAnalysisPersistence } = await importJDAnalysisStorage();
  const base = {
    jdText: 'JD text',
    experienceSignature: 'experience-signature',
    result: buildResult(),
  };

  assert.equal(normalizeJDAnalysisPersistence(base)?.inputMode, 'text');
  assert.equal(normalizeJDAnalysisPersistence({ ...base, inputMode: 'text' })?.inputMode, 'text');
  assert.equal(normalizeJDAnalysisPersistence({ ...base, inputMode: 'attachment' })?.inputMode, 'attachment');
  assert.equal(normalizeJDAnalysisPersistence({ ...base, inputMode: 'supplement-only' }), null);
  assert.equal(normalizeJDAnalysisPersistence({ ...base, inputMode: null }), null);
});

test('preserves trusted canonical reports and normalizes a unique legacy fact alias', async () => {
  const { normalizeJDAnalysisPersistence } = await importJDAnalysisStorage();
  const resumeEvaluation = buildPersistedEvaluation();
  resumeEvaluation.dimensions[0].subscores[0].evidenceIds = ['FACT_001'];
  resumeEvaluation.evidence[0].supportedDimensions = [];

  const normalized = normalizeJDAnalysisPersistence({
    jdText: 'JD text',
    experienceSignature: 'experience-signature',
    evaluationSignature: 'trusted-signature',
    evaluationSignatureVersion: 'agent_final_snapshot_v1',
    evaluationIsOutdated: false,
    result: { ...buildResult(), resumeEvaluation },
  });

  assert.ok(normalized?.result.resumeEvaluation);
  assert.deepEqual(
    normalized.result.resumeEvaluation.dimensions[0].subscores[0].evidenceIds,
    ['E001']
  );
  assert.deepEqual(
    normalized.result.resumeEvaluation.evidence[0].supportedDimensions,
    evaluationRubric.map(([dimension]) => dimension)
  );
  assert.equal(normalized.evaluationSignature, 'trusted-signature');
  assert.equal(normalized.evaluationSignatureVersion, 'agent_final_snapshot_v1');
  assert.equal(normalized.evaluationIsOutdated, false);
});

test('discards persisted evaluations and trusted signatures when their reference graph is open', async () => {
  const { normalizeJDAnalysisPersistence } = await importJDAnalysisStorage();
  const cases = [
    (evaluation) => {
      evaluation.dimensions[0].subscores[0].evidenceIds = ['E404'];
    },
    (evaluation) => {
      evaluation.evidence[0].verificationStatus = 'unverified';
    },
    (evaluation) => {
      evaluation.dimensions[0].subscores[0].evidenceIds = [];
    },
    (evaluation) => {
      evaluation.evidence[0].verificationStatus = 'fabricated';
    },
    (evaluation) => {
      evaluation.dimensions[0].subscores[0].score -= 1;
      evaluation.dimensions[0].score -= 1;
      evaluation.scoreCalculation.dimensionSum -= 1;
      evaluation.scoreCalculation.rawAverage = evaluation.scoreCalculation.dimensionSum / 6;
      evaluation.scoreCalculation.finalScore = Math.floor(evaluation.scoreCalculation.rawAverage + 0.5);
      evaluation.overallScore = evaluation.scoreCalculation.finalScore;
    },
    (evaluation) => {
      evaluation.dimensions[0].issues = ['ISSUE_404'];
    },
    (evaluation) => {
      evaluation.issues = [{
        issueId: 'ISSUE_001',
        description: '缺少量化成果',
        primaryDimension: '逻辑清晰',
        relatedDimensions: [],
        evidenceIds: ['E001'],
        severity: 'medium',
        pointsNotEarned: 0,
      }];
    },
    (evaluation) => {
      evaluation.issues = [{
        issueId: 'ISSUE_001',
        description: '缺少量化成果',
        primaryDimension: '逻辑清晰',
        relatedDimensions: [],
        evidenceIds: ['E001'],
        severity: 'medium',
        pointsNotEarned: 0,
      }];
      evaluation.dimensions[0].issues = ['ISSUE_001'];
      evaluation.topPriorities = [{
        priority: 1,
        issueId: 'ISSUE_404',
        action: '补充成果指标',
        expectedScoreGain: 1,
      }];
    },
    (evaluation) => {
      evaluation.evidence.push(null);
    },
    (evaluation) => {
      evaluation.riskFlags = [{
        type: 'invented_risk',
        description: 'invalid risk',
        evidenceIds: ['E001'],
      }];
    },
    (evaluation) => {
      addZeroPointPersistedIssue(evaluation);
      evaluation.topPriorities = [{
        priority: '1',
        issueId: 'ISSUE_001',
        action: 'Clarify the result',
        expectedScoreGain: 0,
      }];
    },
    (evaluation) => {
      addZeroPointPersistedIssue(evaluation, {
        relatedDimensions: ['not-a-dimension'],
      });
    },
    (evaluation) => {
      delete evaluation.evidence[0].supportedDimensions;
    },
    (evaluation) => {
      evaluation.evaluationConfidence = '0.82';
    },
    (evaluation) => {
      evaluation.dimensions[0].subscores[0].evidenceIds = ['FACT_001'];
      evaluation.evidence.push({
        ...evaluation.evidence[0],
        evidenceId: 'E002',
      });
    },
    (evaluation) => {
      evaluation.issues = [
        {
          issueId: 'ISSUE_LOGIC',
          description: '缺少结果指标',
          primaryDimension: '逻辑清晰',
          relatedDimensions: [],
          evidenceIds: ['E001'],
          severity: 'medium',
          pointsNotEarned: 0,
        },
        {
            issueId: 'ISSUE_STAR',
            description: '缺少结果指标',
          primaryDimension: 'STAR应用',
          relatedDimensions: [],
          evidenceIds: ['E001'],
          severity: 'medium',
          pointsNotEarned: 0,
        },
      ];
      evaluation.dimensions[0].issues = ['ISSUE_LOGIC'];
      evaluation.dimensions[1].issues = ['ISSUE_STAR'];
    },
    (evaluation) => {
      evaluation.overall_score = 99;
    },
  ];

  for (const corrupt of cases) {
    const resumeEvaluation = buildPersistedEvaluation();
    corrupt(resumeEvaluation);
    const normalized = normalizeJDAnalysisPersistence({
      jdText: 'JD text',
      experienceSignature: 'experience-signature',
      evaluationSignature: 'trusted-signature',
      evaluationSignatureVersion: 'agent_final_snapshot_v1',
      evaluationIsOutdated: false,
      result: { ...buildResult(), resumeEvaluation },
    });

    assert.ok(normalized);
    assert.equal('resumeEvaluation' in normalized.result, false);
    assert.equal(normalized.evaluationSignature, undefined);
    assert.equal(normalized.evaluationSignatureVersion, undefined);
    assert.equal(normalized.evaluationIsOutdated, true);
  }
});

test('distinct issue wording preserves persisted evaluation and its trusted signature', async () => {
  const { normalizeJDAnalysisPersistence } = await importJDAnalysisStorage();
  const resumeEvaluation = buildPersistedEvaluation();
  resumeEvaluation.issues = [
    {
      issueId: 'ISSUE_LOGIC', description: '缺少结果指标', primaryDimension: '逻辑清晰',
      relatedDimensions: [], evidenceIds: ['E001'], severity: 'medium', pointsNotEarned: 0,
    },
    {
      issueId: 'ISSUE_STAR', description: '未提供成果数据', primaryDimension: 'STAR应用',
      relatedDimensions: [], evidenceIds: ['E001'], severity: 'medium', pointsNotEarned: 0,
    },
  ];
  resumeEvaluation.dimensions[0].issues = ['ISSUE_LOGIC'];
  resumeEvaluation.dimensions[1].issues = ['ISSUE_STAR'];
  const normalized = normalizeJDAnalysisPersistence({
    jdText: 'JD text', experienceSignature: 'experience-signature',
    evaluationSignature: 'trusted-signature', evaluationSignatureVersion: 'agent_final_snapshot_v1',
    evaluationIsOutdated: false, result: { ...buildResult(), resumeEvaluation },
  });
  assert.deepEqual(normalized.result.resumeEvaluation.issues.map((issue) => issue.issueId), [
    'ISSUE_LOGIC', 'ISSUE_STAR',
  ]);
  assert.equal(normalized.evaluationSignature, 'trusted-signature');
  assert.equal(normalized.evaluationSignatureVersion, 'agent_final_snapshot_v1');
  assert.equal(normalized.evaluationIsOutdated, false);
});

test('normalizes persisted analysis with fallback item signatures and input signature', async () => {
  const { normalizePersistedAnalysisForState } = await importJDAnalysisPersistenceUtils();
  const fallback = buildItemSignatures();

  const normalized = normalizePersistedAnalysisForState(
    {
      jdText: 'JD text',
      jdInputSignature: '',
      experienceSignature: 'experience-signature',
      result: buildResult(),
      itemSignatures: undefined,
      experienceText: 'experience-text',
      inputMode: 'attachment',
      attachmentName: 'jd.pdf',
      updatedAt: '2026-06-06T00:00:00.000Z',
    },
    fallback
  );

  assert.notEqual(normalized.jdInputSignature, '');
  assert.deepEqual(normalized.itemSignatures, fallback);
  assert.equal(normalized.inputMode, 'attachment');
  assert.equal(normalized.attachmentName, 'jd.pdf');
});

test('builds resume JD analysis payload with stable timestamp injection', async () => {
  const { buildResumeJDAnalysisPayload } = await importJDAnalysisPersistenceUtils();
  const itemSignatures = buildItemSignatures();

  const payload = buildResumeJDAnalysisPayload(
    {
      jdText: 'JD text',
      jdInputSignature: 'jd-signature',
      experienceSignature: 'experience-signature',
      result: buildResult(),
      itemSignatures,
      experienceText: 'experience-text',
      inputMode: 'text',
      attachmentExtractedText: 'previous extracted text',
    },
    '2026-06-06T00:00:00.000Z'
  );

  assert.deepEqual(payload, {
    jdText: 'JD text',
    jdInputSignature: 'jd-signature',
    experienceSignature: 'experience-signature',
    result: buildResult(),
    itemSignatures,
    experienceText: 'experience-text',
    inputMode: 'text',
    attachmentName: undefined,
    attachmentExtractedText: 'previous extracted text',
    isOutdated: false,
    updatedAt: '2026-06-06T00:00:00.000Z',
  });
});

test('hydrates a fresh Agent final-snapshot evaluation against the current client snapshot', async () => {
  const { resolveHydratedEvaluationSignature } = await importJDAnalysisPersistenceUtils();
  const base = {
    jdText: 'JD text',
    jdInputSignature: 'jd-signature',
    experienceSignature: 'experience-signature',
    evaluationSignature: 'python-canonical-signature',
    evaluationSignatureVersion: 'agent_final_snapshot_v1',
    isOutdated: false,
    evaluationIsOutdated: false,
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };

  assert.equal(
    resolveHydratedEvaluationSignature(base, 'client-current-signature'),
    'client-current-signature'
  );
  assert.equal(
    resolveHydratedEvaluationSignature(base, 'client-current-signature', true),
    'python-canonical-signature'
  );
  assert.equal(
    resolveHydratedEvaluationSignature(
      { ...base, evaluationIsOutdated: true },
      'client-current-signature'
    ),
    'python-canonical-signature'
  );
  assert.equal(
    resolveHydratedEvaluationSignature(
      { ...base, evaluationIsOutdated: undefined },
      'client-current-signature'
    ),
    'python-canonical-signature'
  );
});

test('hydrates a fresh Agent final-snapshot JD analysis against current candidate signatures', async () => {
  const { resolveHydratedAnalysisCandidate } = await importJDAnalysisPersistenceUtils();
  const { normalizeJDAnalysisPersistence } = await importJDAnalysisStorage();
  const currentItems = buildItemSignatures();
  const base = {
    jdText: 'JD text',
    jdInputSignature: 'jd-signature',
    experienceSignature: 'python-result-hash',
    analysisSignatureVersion: 'agent_final_snapshot_v1',
    isOutdated: false,
    result: buildResult(),
    itemSignatures: { experiences: {}, certifications: {}, skills: {} },
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  const normalizedBase = normalizeJDAnalysisPersistence(base);
  assert.ok(normalizedBase);

  assert.deepEqual(
    resolveHydratedAnalysisCandidate(normalizedBase, 'client-candidate-signature', currentItems),
    {
      experienceSignature: 'client-candidate-signature',
      itemSignatures: currentItems,
    }
  );
  assert.deepEqual(
    resolveHydratedAnalysisCandidate(
      { ...normalizedBase, isOutdated: true },
      'client-candidate-signature',
      currentItems
    ),
    {
      experienceSignature: 'python-result-hash',
      itemSignatures: base.itemSignatures,
    }
  );
});

test('keeps a pending local snapshot only while the backend is still its base', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const backend = {
    jdText: 'backend JD',
    jdInputSignature: 'backend-jd',
    experienceSignature: 'backend-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  const local = { ...backend, jdText: 'local JD', updatedAt: '2026-08-09T00:00:00.000Z' };
  const decision = selectPreferredPersistedJDAnalysis(backend, {
    payload: local,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(backend),
  });

  assert.equal(decision.kind, 'keep_pending_local');
  assert.equal(decision.payload, local);
  assert.equal(decision.shouldKeepLocalPendingSync, true);
});

test('migrates a legacy normalized base fingerprint before reconciling pending local work', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    normalizeJDAnalysisPersistence,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const lossyEvaluation = buildPersistedEvaluation();
  lossyEvaluation.issues = [{
    issueId: 'SERVER_GAP_001',
    description: 'legacy lossy issue',
    primaryDimension: '逻辑清晰',
    relatedDimensions: [],
    evidenceIds: [],
    severity: 'high',
    pointsNotEarned: 0,
  }];
  lossyEvaluation.dimensions[0].issues = ['SERVER_GAP_001'];
  const legacyBackendBase = {
    jdText: 'backend JD',
    jdInputSignature: 'backend-jd',
    experienceSignature: 'backend-experience',
    evaluationSignature: 'legacy-evaluation-signature',
    evaluationIsOutdated: false,
    result: { ...buildResult(), resumeEvaluation: lossyEvaluation },
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  const backend = normalizeJDAnalysisPersistence(legacyBackendBase);
  assert.ok(backend);
  assert.equal('resumeEvaluation' in backend.result, false);
  assert.equal(backend.evaluationIsOutdated, true);
  const local = {
    ...backend,
    jdText: 'pending local JD',
    updatedAt: '2026-08-09T00:00:00.000Z',
  };

  const decision = selectPreferredPersistedJDAnalysis(backend, {
    schemaVersion: 1,
    basePersistedFingerprintVersion: 1,
    payload: local,
    pendingSync: true,
    // v1 stored the entire pre-upgrade normalized payload with no prefix.
    basePersistedFingerprint: JSON.stringify(legacyBackendBase),
  });

  assert.equal(decision.kind, 'keep_pending_local');
  assert.equal(decision.payload, local);
  assert.equal(
    decision.basePersistedFingerprint,
    buildJDAnalysisPersistenceFingerprint(backend),
  );
  assert.match(decision.basePersistedFingerprint, /^jd-analysis-normalized-v2:/);
});

test('migrates a legacy null base and quarantines an unverifiable pending base', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    resolveLocalJDAnalysisWriteBase,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const local = {
    jdText: 'first pending JD',
    jdInputSignature: 'pending-jd',
    experienceSignature: 'pending-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-09T00:00:00.000Z',
  };
  const migrated = selectPreferredPersistedJDAnalysis(null, {
    schemaVersion: 1,
    basePersistedFingerprintVersion: 1,
    payload: local,
    pendingSync: true,
    basePersistedFingerprint: '__null__',
  });
  assert.equal(migrated.kind, 'keep_pending_local');
  assert.equal(
    migrated.basePersistedFingerprint,
    buildJDAnalysisPersistenceFingerprint(null),
  );

  const unverifiableCache = {
    schemaVersion: 1,
    basePersistedFingerprintVersion: 1,
    payload: local,
    pendingSync: true,
    basePersistedFingerprint: '{not-json',
  };
  const quarantined = selectPreferredPersistedJDAnalysis(null, unverifiableCache);
  assert.equal(quarantined.kind, 'pending_conflict');
  assert.equal(quarantined.payload, null);
  assert.equal(quarantined.pendingPayload, local);
  assert.equal(
    resolveLocalJDAnalysisWriteBase(null, unverifiableCache, local),
    undefined,
  );

  const backend = { ...local, jdText: 'authoritative backend JD' };
  const backendConflict = selectPreferredPersistedJDAnalysis(backend, unverifiableCache);
  assert.equal(backendConflict.kind, 'pending_conflict');
  assert.equal(backendConflict.payload, backend);
  assert.equal(backendConflict.pendingPayload, local);
});

test('quarantines divergent pending local work when the backend changed from its base', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const backendV1 = {
    jdText: 'backend v1',
    jdInputSignature: 'backend-v1',
    experienceSignature: 'experience-v1',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  const backendV2 = {
    ...backendV1,
    jdText: 'backend v2',
    jdInputSignature: 'backend-v2',
    updatedAt: '2026-08-10T00:00:00.000Z',
  };
  const local = {
    ...backendV1,
    jdText: 'stale local payload',
    updatedAt: '2026-08-09T00:00:00.000Z',
  };
  const decision = selectPreferredPersistedJDAnalysis(backendV2, {
    payload: local,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(backendV1),
  });

  assert.equal(decision.kind, 'pending_conflict');
  assert.equal(decision.payload, backendV2);
  assert.equal(decision.pendingPayload, local);
  assert.equal(decision.shouldKeepLocalPendingSync, false);
  assert.equal(
    decision.basePersistedFingerprint,
    buildJDAnalysisPersistenceFingerprint(backendV1),
  );
});

test('marks matching backend and cache payloads as synchronized', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const backend = {
    jdText: 'backend JD',
    jdInputSignature: 'backend-jd',
    experienceSignature: 'backend-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  const decision = selectPreferredPersistedJDAnalysis(backend, {
    payload: { ...backend },
    pendingSync: false,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(backend),
  });

  assert.equal(decision.kind, 'in_sync');
  assert.equal(decision.payload, backend);
});

test('adopts an analysis that arrives after an initially empty backend', async () => {
  const { selectPreferredPersistedJDAnalysis } = await importJDAnalysisStorage();
  const backend = {
    jdText: 'late backend JD',
    jdInputSignature: 'late-backend-jd',
    experienceSignature: 'late-backend-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-11T00:00:00.000Z',
  };

  const decision = selectPreferredPersistedJDAnalysis(backend, null);

  assert.equal(decision.kind, 'adopt_backend');
  assert.equal(decision.payload, backend);
});

test('adopts an authoritative empty backend over a non-pending cache', async () => {
  const { selectPreferredPersistedJDAnalysis } = await importJDAnalysisStorage();
  const cached = {
    jdText: 'removed backend JD',
    jdInputSignature: 'removed-backend-jd',
    experienceSignature: 'removed-backend-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-10T00:00:00.000Z',
  };

  const decision = selectPreferredPersistedJDAnalysis(null, {
    payload: cached,
    pendingSync: false,
    basePersistedFingerprint: null,
  });

  assert.equal(decision.kind, 'adopt_backend_null');
  assert.equal(decision.payload, null);
});

test('keeps a pending local analysis based on an empty backend', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const local = {
    jdText: 'first local JD',
    jdInputSignature: 'first-local-jd',
    experienceSignature: 'first-local-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-11T00:00:00.000Z',
  };

  const decision = selectPreferredPersistedJDAnalysis(null, {
    payload: local,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(null),
  });

  assert.equal(decision.kind, 'keep_pending_local');
  assert.equal(decision.payload, local);
  assert.equal(decision.shouldKeepLocalPendingSync, true);
});

test('local writes allow matching in-memory backend state when cache is missing', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    resolveLocalJDAnalysisWriteBase,
  } = await importJDAnalysisStorage();
  const backend = {
    jdText: 'backend JD',
    jdInputSignature: 'backend-jd',
    experienceSignature: 'backend-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-12T00:00:00.000Z',
  };

  assert.equal(
    resolveLocalJDAnalysisWriteBase(backend, null, { ...backend }),
    buildJDAnalysisPersistenceFingerprint(backend),
  );
});

test('local writes protect a newer pending cache from older in-memory backend state', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    resolveLocalJDAnalysisWriteBase,
  } = await importJDAnalysisStorage();
  const backend = {
    jdText: 'backend JD',
    jdInputSignature: 'backend-jd',
    experienceSignature: 'backend-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-12T00:00:00.000Z',
  };
  const pendingLocal = {
    ...backend,
    jdText: 'newer tab analysis',
    jdInputSignature: 'newer-tab-jd',
    updatedAt: '2026-08-13T00:00:00.000Z',
  };
  const cache = {
    payload: pendingLocal,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(backend),
  };

  assert.equal(resolveLocalJDAnalysisWriteBase(backend, cache, backend), undefined);
  assert.equal(
    resolveLocalJDAnalysisWriteBase(backend, cache, pendingLocal),
    buildJDAnalysisPersistenceFingerprint(backend),
  );
});

test('local writes reject stale in-memory state when the backend changed', async () => {
  const { resolveLocalJDAnalysisWriteBase } = await importJDAnalysisStorage();
  const backendV1 = {
    jdText: 'backend v1',
    jdInputSignature: 'backend-v1',
    experienceSignature: 'experience-v1',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-11T00:00:00.000Z',
  };
  const backendV2 = {
    ...backendV1,
    jdText: 'backend v2',
    jdInputSignature: 'backend-v2',
    updatedAt: '2026-08-12T00:00:00.000Z',
  };

  assert.equal(resolveLocalJDAnalysisWriteBase(backendV2, null, backendV1), undefined);
});

test('local writes allow an authoritative empty backend over a stale cache', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    resolveLocalJDAnalysisWriteBase,
  } = await importJDAnalysisStorage();
  const staleCache = {
    jdText: 'stale cached JD',
    jdInputSignature: 'stale-cache-jd',
    experienceSignature: 'stale-cache-experience',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-11T00:00:00.000Z',
  };

  assert.equal(
    resolveLocalJDAnalysisWriteBase(null, {
      payload: staleCache,
      pendingSync: false,
      basePersistedFingerprint: null,
    }, null),
    buildJDAnalysisPersistenceFingerprint(null),
  );
});

test('live backend reconciliation invalidates active work before adopting the shared decision', () => {
  const source = readFileSync('hooks/useJDAnalysis.ts', 'utf8');
  const start = source.indexOf('const reconciliation = selectPreferredPersistedJDAnalysis');
  const end = source.indexOf('saveJDAnalysisCache(authUserKey, resumeId, reconciledPayload', start);
  const reconciliationBlock = source.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(reconciliationBlock, /reconciliation\.kind === "keep_pending_local"/);
  assert.match(
    reconciliationBlock,
    /normalizePersistedAnalysisForState\([\s\S]*reconciliation\.payload/,
  );
  assert.match(reconciliationBlock, /invalidateAnalysisRun\(\);/);
  assert.match(
    reconciliationBlock,
    /applyPersistedAnalysisState\(reconciliation\.payload\)/,
  );
  assert.ok(
    reconciliationBlock.indexOf('invalidateAnalysisRun();')
      < reconciliationBlock.indexOf('applyPersistedAnalysisState(reconciliation.payload)'),
  );
  assert.doesNotMatch(source, /mergeAuthoritativeStaleFlags|shouldKeepPendingLocalSnapshot/);
  assert.match(
    source,
    /normalizeJDAnalysisPersistence\(\s*persistedJDAnalysisConfigRef\.current\s*\)/,
  );
  assert.match(source, /rebindEvaluationSignature\(/);
  assert.match(source, /evaluationSignatureRef\.current = nextBoundEvaluationSignature/);
  assert.match(
    source,
    /currentHydratedEvaluationSignature = buildEvaluationSignature\(\{[\s\S]*?normalizedPayload\.result[\s\S]*?resolveHydratedEvaluationSignature\([\s\S]*?currentHydratedEvaluationSignature/,
  );
  const initialHydration = source.slice(
    source.indexOf('const preferredPersistedState = selectPreferredPersistedJDAnalysis'),
    source.indexOf('hasLoadedJdCacheRef.current = true;', source.indexOf('if (preferredPersistedState.payload)')),
  );
  assert.ok(
    initialHydration.indexOf('preferredPersistedState.kind === "pending_conflict"')
      < initialHydration.indexOf('applyPersistedAnalysisState'),
  );
  assert.match(
    source,
    /reconciliation\.kind === "keep_pending_local"[\s\S]*?reconciliation\.kind === "pending_conflict"[\s\S]*?return;/,
  );
  const staleFlagEffect = source.slice(
    source.indexOf('const basePersistedFingerprint = resolveLocalAnalysisWriteBase'),
    source.indexOf('const applyPersistedAnalysisState'),
  );
  assert.match(
    staleFlagEffect,
    /if \(basePersistedFingerprint === undefined\) \{\s*return;\s*\}/,
  );
  assert.ok(
    staleFlagEffect.indexOf('basePersistedFingerprint === undefined')
      < staleFlagEffect.indexOf('setPersistedJDAnalysis(nextPersistedJDAnalysis)'),
  );
  const executionCallStart = source.indexOf(
    'const outcome = await runJDAnalysisExecution({',
  );
  const executionCall = source.slice(
    executionCallStart,
    source.indexOf('return outcome;', executionCallStart),
  );
  assert.match(executionCall, /canApplyAnalysisResult,/);
});

test('resolves attachment analysis with extracted text as text-mode persisted JD', async () => {
  const { resolvePersistedAttachmentFields } = await importJDAnalysisPersistenceUtils();

  const fields = resolvePersistedAttachmentFields({
    snapshot: {
      jdText: 'Original JD text',
      jdInputSignature: 'attachment-signature',
      inputMode: 'attachment',
      attachmentName: 'jd.pdf',
      attachmentExtractedText: undefined,
    },
    hasCurrentFile: true,
    attachmentSupplementalJdText: ' Supplement ',
    extractedAttachmentText: 'Extracted JD',
    shouldPersistAttachmentAsText: true,
  });

  assert.equal(fields.jdText, 'Extracted JD\n\n补充 JD 说明：\nSupplement');
  assert.equal(fields.inputMode, 'text');
  assert.equal(fields.attachmentName, undefined);
  assert.equal(fields.attachmentExtractedText, 'Extracted JD');
  assert.notEqual(fields.jdInputSignature, 'attachment-signature');
});

test('keeps attachment metadata when extracted text is not promoted to JD text', async () => {
  const { resolvePersistedAttachmentFields } = await importJDAnalysisPersistenceUtils();

  const fields = resolvePersistedAttachmentFields({
    snapshot: {
      jdText: 'Supplement only',
      jdInputSignature: 'attachment-signature',
      inputMode: 'attachment',
      attachmentName: 'jd.pdf',
      attachmentExtractedText: 'Old extracted text',
    },
    hasCurrentFile: true,
    attachmentSupplementalJdText: 'Supplement only',
    extractedAttachmentText: '',
    shouldPersistAttachmentAsText: false,
  });

  assert.deepEqual(fields, {
    jdText: 'Supplement only',
    jdInputSignature: 'attachment-signature',
    inputMode: 'attachment',
    attachmentName: 'jd.pdf',
    attachmentExtractedText: undefined,
  });
});

test('owner and resume changes invalidate stale JD analysis state before cache writes', () => {
  const source = readFileSync('hooks/useJDAnalysis.ts', 'utf8');

  assert.match(
    source,
    /const analysisIdentity = useMemo\(\(\) => canonicalStringify\(\{\s*owner: authUserKey \?\? null,\s*resumeId: resumeId \?\? null,/,
  );
  assert.match(
    source,
    /!isAnalysisStateCurrent\s*\|\| activeAnalysisIdentityRef\.current !== analysisIdentity\s*\) \{\s*return undefined;/,
  );
  assert.match(
    source,
    /hasLoadedJdCacheRef\.current = false;\s*invalidatePendingJdFileSelection\(\);\s*invalidateAnalysisRun\(\);[\s\S]*?setAnalysisStateIdentity\(analysisIdentity\);/,
  );
  assert.match(
    source,
    /shouldContinue: \(\) => \([\s\S]*?activeAnalysisIdentityRef\.current === analysisIdentity\s*&& ownerGuard\.isOperationCurrent\(ownerOperation\)\s*&& !pendingJDAnalysisConflictRef\.current\s*\)/,
  );
  assert.match(source, /expectedAuthCacheKey: ownerOperation\.expectedAuthCacheKey/);
  assert.match(
    source,
    /const resolveLocalAnalysisWriteBase = useCallback[\s\S]*?\}, \[analysisIdentity, authUserKey, isAnalysisStateCurrent, resumeId\]\);/,
  );

  for (const cacheEffectDependencies of [
    /\[\s*authUserKey,\s*isEvaluationOutdated,\s*isAnalysisStateCurrent,/,
    /\[\s*authUserKey,\s*isLoadingExperiences,\s*isLoadingResume,\s*isAnalysisStateCurrent,/,
    /\[\s*applyPersistedAnalysisState,\s*analysisIdentity,\s*authUserKey,\s*invalidateAnalysisRun,\s*isAnalysisStateCurrent,/,
  ]) {
    assert.match(source, cacheEffectDependencies);
  }
});

test('divergent pending local work stays recoverable against an emptied backend', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const backendBase = {
    jdText: 'old backend',
    jdInputSignature: 'old-backend',
    experienceSignature: 'experience-v1',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  const local = { ...backendBase, jdText: 'pending local edit' };
  const decision = selectPreferredPersistedJDAnalysis(null, {
    payload: local,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(backendBase),
  });

  assert.equal(decision.kind, 'pending_conflict');
  assert.equal(decision.payload, null);
  assert.equal(decision.pendingPayload, local);
});

test('a pending cache already equal to the backend is synchronized even when its old base diverged', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    selectPreferredPersistedJDAnalysis,
  } = await importJDAnalysisStorage();
  const backend = {
    jdText: 'synced payload',
    jdInputSignature: 'synced',
    experienceSignature: 'experience-v2',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-10T00:00:00.000Z',
  };
  const decision = selectPreferredPersistedJDAnalysis(backend, {
    payload: { ...backend },
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(null),
  });

  assert.equal(decision.kind, 'in_sync');
  assert.equal(decision.payload, backend);
  assert.equal(decision.shouldKeepLocalPendingSync, false);
});

test('config snapshots use the backend side of a conflict until local recovery is explicit', async () => {
  const {
    buildJDAnalysisPersistenceFingerprint,
    graftJDAnalysisAuthority,
    resolveJDAnalysisForConfigSnapshot,
  } = await importJDAnalysisStorage();
  const backendV1 = {
    jdText: 'backend v1',
    jdInputSignature: 'backend-v1',
    experienceSignature: 'experience-v1',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'text',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
  const backendV2 = {
    ...backendV1,
    jdText: 'backend v2',
    jdInputSignature: 'backend-v2',
    updatedAt: '2026-08-10T00:00:00.000Z',
  };
  const local = {
    ...backendV1,
    jdText: 'pending local',
    updatedAt: '2026-08-09T00:00:00.000Z',
  };
  const divergentCache = {
    payload: local,
    pendingSync: true,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(backendV1),
  };

  assert.equal(
    resolveJDAnalysisForConfigSnapshot(backendV2, divergentCache, local),
    backendV2,
  );
  assert.equal(
    resolveJDAnalysisForConfigSnapshot(null, divergentCache, local),
    null,
  );
  const sameBaseCache = {
    ...divergentCache,
    basePersistedFingerprint: buildJDAnalysisPersistenceFingerprint(backendV2),
  };
  assert.equal(
    resolveJDAnalysisForConfigSnapshot(backendV2, sameBaseCache, local),
    local,
  );

  const staleDraft = {
    layout: { density: 'compact' },
    personalSummary: 'keep this ordinary edit',
    jdAnalysis: local,
  };
  const backendDraft = graftJDAnalysisAuthority(staleDraft, backendV2);
  assert.equal(backendDraft.jdAnalysis, backendV2);
  assert.equal(backendDraft.personalSummary, 'keep this ordinary edit');
  assert.deepEqual(backendDraft.layout, { density: 'compact' });
  assert.equal(staleDraft.jdAnalysis, local);

  const emptyBackendDraft = graftJDAnalysisAuthority(staleDraft, null);
  assert.equal(Object.hasOwn(emptyBackendDraft, 'jdAnalysis'), false);
  assert.equal(emptyBackendDraft.personalSummary, 'keep this ordinary edit');

  const resumeData = readFileSync('hooks/useResumeData.ts', 'utf8');
  const committedSnapshot = readFileSync(
    'views/ResumeEditor/hooks/useCommittedResumeConfigSnapshot.ts',
    'utf8',
  );
  assert.match(resumeData, /resolveJDAnalysisForConfigSnapshot/);
  assert.match(committedSnapshot, /resolveJDAnalysisForConfigSnapshot/);
  assert.match(committedSnapshot, /graftJDAnalysisAuthority\(draft, authoritativeJDAnalysis\)/);
  const saveBoundary = resumeData.slice(
    resumeData.indexOf('const saveResumeConfig = useCallback'),
    resumeData.indexOf('useResumeAutoSave(', resumeData.indexOf('const saveResumeConfig = useCallback')),
  );
  assert.ok(
    saveBoundary.indexOf('graftJDAnalysisAuthority(')
      < saveBoundary.indexOf('saveCoordinator.save(authoritativeConfig'),
  );
  assert.match(saveBoundary, /requestedConfigSignature: receipt\.configSignature/);
});

test('pending persistence conflicts block JD providers and expose explicit recovery choices', () => {
  const source = readFileSync('hooks/useJDAnalysis.ts', 'utf8');
  const evaluation = readFileSync('hooks/useResumeEvaluation.ts', 'utf8');
  const editor = readFileSync('views/ResumeEditor/index.tsx', 'utf8');
  const analyze = source.slice(
    source.indexOf('const handleAnalyze = useCallback'),
    source.indexOf('    jdText,', source.indexOf('const handleAnalyze = useCallback')),
  );
  const runAnalyze = source.slice(
    source.indexOf('const runAnalyze = useCallback'),
    source.indexOf('const handleAnalyze = useCallback'),
  );
  const restore = source.slice(
    source.indexOf('const restorePendingJDAnalysisRecovery'),
    source.indexOf('const discardPendingJDAnalysisRecovery'),
  );
  const discard = source.slice(
    source.indexOf('const discardPendingJDAnalysisRecovery'),
    source.indexOf('useEffect(() => {', source.indexOf('const discardPendingJDAnalysisRecovery')),
  );
  const editorAnalyze = editor.slice(
    editor.indexOf('const handleAnalyzePersistedSnapshot'),
    editor.indexOf('useJdAnalyzeWithToast', editor.indexOf('const handleAnalyzePersistedSnapshot')),
  );

  assert.match(source, /pendingJDAnalysisConflictRef/);
  assert.match(source, /restorePendingJDAnalysisRecovery/);
  assert.match(source, /discardPendingJDAnalysisRecovery/);
  assert.match(analyze, /canPersistCurrentJDAnalysis\(\)/);
  assert.ok(
    analyze.indexOf('canPersistCurrentJDAnalysis()')
      < analyze.indexOf('waitForPendingJdFileSelection'),
  );
  assert.ok(
    runAnalyze.indexOf('canPersistCurrentJDAnalysis()')
      < runAnalyze.indexOf('ownerGuard.beginOperation'),
  );
  assert.match(restore, /currentCache\?\.pendingSync/);
  assert.match(
    restore,
    /saveJDAnalysisCache\([\s\S]*?currentCache\.payload[\s\S]*?buildJDAnalysisPersistenceFingerprint\(currentBackend\)[\s\S]*?publishPendingJDAnalysisConflict\(null\)[\s\S]*?applyPersistedAnalysisState\(currentCache\.payload\)/,
  );
  assert.match(
    discard,
    /clearJDAnalysisCache\(authUserKey, resumeId\)[\s\S]*?publishPendingJDAnalysisConflict\(null\)[\s\S]*?applyPersistedAnalysisState\(currentBackend\)/,
  );
  assert.ok(
    editorAnalyze.indexOf('canPersistCurrentJDAnalysis()')
      < editorAnalyze.indexOf('flushResumeConfig'),
  );
  assert.match(evaluation, /hasJdAnalysisPersistenceConflict/);
  assert.match(editor, /检测到未同步的本地 JD 分析/);
  assert.match(editor, /恢复本地分析/);
  assert.match(editor, /舍弃本地副本/);
  assert.match(editor, /window\.confirm\('恢复本地分析会以本地副本替换当前云端 JD 分析/);
  assert.match(editor, /window\.confirm\('舍弃后，本地未同步的 JD 分析副本将无法恢复/);
});

test('missing restored attachment provenance survives edits until an explicit text conversion', () => {
  const source = readFileSync('hooks/useJDAnalysis.ts', 'utf8');
  const editor = readFileSync('views/ResumeEditor/index.tsx', 'utf8');
  const panel = readFileSync('views/ResumeEditor/components/JDAnalysisPanel.tsx', 'utf8');
  const mismatchEffect = source.slice(
    source.indexOf('if (analysisContext.jdInputSignature !== jdInputSignature)'),
    source.indexOf('}, [', source.indexOf('if (analysisContext.jdInputSignature !== jdInputSignature)')),
  );
  const snapshotBuilder = source.slice(
    source.indexOf('const buildAnalyzeSnapshot'),
    source.indexOf('const recordPostAnalyzeDiff'),
  );
  const analyze = source.slice(
    source.indexOf('const handleAnalyze = useCallback'),
    source.indexOf('    jdText,', source.indexOf('const handleAnalyze = useCallback')),
  );

  assert.doesNotMatch(mismatchEffect, /setRestoredAttachmentContext\(null\)/);
  assert.match(source, /convertRestoredAttachmentToText/);
  const conversion = source.slice(
    source.indexOf('const convertRestoredAttachmentToText = useCallback'),
    source.indexOf('  useEffect(() => {', source.indexOf('const convertRestoredAttachmentToText = useCallback')),
  );
  assert.match(
    conversion,
    /buildRestoredAttachmentTextConversionPayload\([\s\S]*?setPersistedJDAnalysis\(convertedPersisted\)[\s\S]*?saveJDAnalysisCache\([\s\S]*?pendingSync: true/,
  );
  assert.match(
    source,
    /!jdFile && restoredAttachmentContext[\s\S]*?buildPersistedJDInputSignature\([\s\S]*?"attachment"/,
  );
  assert.match(snapshotBuilder, /restoredAttachmentContext/);
  assert.match(
    analyze,
    /restoredAttachmentContextRef\.current[\s\S]*?!snapshot\.jdFile[\s\S]*?!snapshot\.attachmentExtractedText\?\.trim\(\)/,
  );
  assert.match(
    source,
    /const hasMissingAttachmentContext = Boolean\([\s\S]*?restoredAttachmentContext[\s\S]*?!jdFile[\s\S]*?resumeEvaluationJDContext\.hasMissingAttachmentText/,
  );
  assert.match(editor, /改用完整文本 JD/);
  assert.match(editor, /value=\{restoredAttachmentFullTextDraft\}/);
  assert.match(editor, /convertRestoredAttachmentToText\(restoredAttachmentFullTextDraft\)/);
  assert.match(editor, /disabled=\{!restoredAttachmentFullTextDraft\.trim\(\)\}/);
  assert.match(
    editor,
    /const handleConfirmRestoredAttachmentConversion = useCallback\(async \(\) => \{[\s\S]*?convertRestoredAttachmentToText\(restoredAttachmentFullTextDraft\)[\s\S]*?await handleAnalyzeWithAutoName\(\)/,
  );
  assert.match(editor, /jdContextText: jdPolishContext/);
  assert.match(editor, /const jdAnalysisDetailsSidebarProps[\s\S]*?jdText: jdPolishContext/);
  assert.match(panel, /jdContextText: string/);
  assert.match(panel, /<JDAnalysisDetailsModal[\s\S]*?jdText=\{jdContextText\}/);
});

test('explicit restored-attachment conversion creates a durable pending text-mode payload', async () => {
  const { buildRestoredAttachmentTextConversionPayload } =
    await importJDAnalysisPersistenceUtils();
  const current = {
    jdText: '仅补充说明',
    jdInputSignature: 'old-attachment-signature',
    experienceSignature: 'experience-signature',
    evaluationSignature: 'old-evaluation-signature',
    analysisSignatureVersion: 'agent_final_snapshot_v1',
    evaluationSignatureVersion: 'agent_final_snapshot_v1',
    result: buildResult(),
    itemSignatures: buildItemSignatures(),
    inputMode: 'attachment',
    attachmentName: 'missing.pdf',
    isOutdated: false,
    evaluationIsOutdated: false,
    updatedAt: '2026-08-08T00:00:00.000Z',
  };

  const converted = buildRestoredAttachmentTextConversionPayload(
    current,
    '  完整粘贴的 JD 正文  ',
    '2026-09-04T00:00:00.000Z',
  );
  assert.equal(converted.jdText, '完整粘贴的 JD 正文');
  assert.equal(converted.inputMode, 'text');
  assert.equal(converted.attachmentName, undefined);
  assert.equal(converted.attachmentExtractedText, undefined);
  assert.equal(converted.isOutdated, true);
  assert.equal(converted.evaluationIsOutdated, true);
  assert.equal(converted.analysisSignatureVersion, undefined);
  assert.equal(converted.evaluationSignatureVersion, undefined);
  assert.equal(converted.updatedAt, '2026-09-04T00:00:00.000Z');
  assert.notEqual(converted.jdInputSignature, current.jdInputSignature);
});
