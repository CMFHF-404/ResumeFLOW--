import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transform } from 'esbuild';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const importPreflightHelpers = async () => {
  const source = read('views/ResumeEditor/hooks/resumeExperienceLinkPersistence.ts');
  const startMarker = '// RESUME_EVALUATION_LINK_PREFLIGHT_TEST_START';
  const endMarker = '// RESUME_EVALUATION_LINK_PREFLIGHT_TEST_END';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, 'link persistence must expose the testable preflight bridge');
  const snippet = source.slice(start + startMarker.length, end);
  const result = await transform(snippet, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}#${Math.random()}`);
};

const importResumeSaveBridge = async () => {
  const source = read('hooks/useResumeData.ts');
  const startMarker = '// RESUME_OPTIMIZATION_SAVE_BRIDGE_START';
  const endMarker = '// RESUME_OPTIMIZATION_SAVE_BRIDGE_END';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, 'resume data must expose the testable save bridge');
  const snippet = source.slice(start + startMarker.length, end);
  const result = await transform(snippet, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}#${Math.random()}`);
};

const linkedItem = (masterId, linkId, versionId = `version-${masterId}`) => ({
  id: linkId,
  experience_version_id: versionId,
  experience: { master_experience_id: masterId },
});

const detailWithLinks = (items, updatedAt = '2026-09-02T00:00:01.000Z') => ({
  resume: { id: 'resume-a', updated_at: updatedAt },
  experiences: items,
});

test('selected experience preflight batches missing links and never re-adds existing links', async () => {
  const {
    buildSelectedExperienceLinkCandidates,
    ensureResumeExperienceLinks,
  } = await importPreflightHelpers();
  const existing = linkedItem('master-existing', 'link-existing');
  const currentMap = new Map([['master-existing', existing]]);
  const sources = new Map([
    ['master-missing-a', { latest_version: { id: 'version-a' } }],
    ['master-missing-b', { latest_version: { id: 'version-b' } }],
  ]);
  const candidates = buildSelectedExperienceLinkCandidates(
    ['master-existing', 'master-missing-a', 'master-missing-b', 'master-missing-a'],
    currentMap,
    sources,
  );
  const events = [];
  let persistPayload;
  const result = await ensureResumeExperienceLinks({
    resumeId: 'resume-a',
    candidates,
    resumeExperienceMap: currentMap,
    expectedAuthCacheKey: 'owner-a',
    assertOwnerCurrent: async () => events.push('owner'),
    persistAssembly: async (resumeId, payload, options) => {
      events.push('persist');
      persistPayload = { resumeId, payload, options };
      return detailWithLinks([
        existing,
        linkedItem('master-missing-a', 'link-a', 'version-a'),
        linkedItem('master-missing-b', 'link-b', 'version-b'),
      ]);
    },
    applyResumeDetail: () => events.push('apply-detail'),
    setResumeExperienceMap: () => events.push('set-map'),
  });

  assert.deepEqual(persistPayload, {
    resumeId: 'resume-a',
    payload: {
      operations: [
        { op: 'add', experience_version_id: 'version-a' },
        { op: 'add', experience_version_id: 'version-b' },
      ],
    },
    options: { expectedAuthCacheKey: 'owner-a' },
  });
  assert.deepEqual(events, ['owner', 'persist', 'owner', 'owner', 'apply-detail', 'set-map']);
  assert.deepEqual(result.addedLinkIds, ['link-a', 'link-b']);
  assert.equal(result.detail.resume.updated_at, '2026-09-02T00:00:01.000Z');
});

test('preflight is a no-op when every selected master already has a resume link', async () => {
  const {
    buildSelectedExperienceLinkCandidates,
    ensureResumeExperienceLinks,
  } = await importPreflightHelpers();
  const existing = linkedItem('master-existing', 'link-existing');
  let persistCalls = 0;
  const result = await ensureResumeExperienceLinks({
    resumeId: 'resume-a',
    candidates: buildSelectedExperienceLinkCandidates(
      ['master-existing', 'master-existing'],
      new Map([['master-existing', existing]]),
      new Map(),
    ),
    resumeExperienceMap: new Map([['master-existing', existing]]),
    expectedAuthCacheKey: 'owner-a',
    assertOwnerCurrent: async () => undefined,
    persistAssembly: async () => {
      persistCalls += 1;
      throw new Error('must not persist');
    },
    applyResumeDetail: () => undefined,
    setResumeExperienceMap: () => undefined,
  });

  assert.equal(persistCalls, 0);
  assert.deepEqual(result.addedLinkIds, []);
  assert.equal(result.detail, null);
});

test('candidate resolution fails closed before persistence when source or version is missing', async () => {
  const { buildSelectedExperienceLinkCandidates } = await importPreflightHelpers();
  assert.throws(
    () => buildSelectedExperienceLinkCandidates(['missing-source'], new Map(), new Map()),
    /source/i,
  );
  assert.throws(
    () => buildSelectedExperienceLinkCandidates(
      ['missing-version'],
      new Map(),
      new Map([['missing-version', { latest_version: null }]]),
    ),
    /version/i,
  );
});

test('assembly, owner, conflict, verification, and flush failures never generate a report', async () => {
  const {
    ensureResumeExperienceLinks,
    runResumeEvaluationAfterLinkPreflight,
  } = await importPreflightHelpers();
  const candidate = { masterId: 'master-a', versionId: 'version-a' };
  const cases = [
    {
      name: 'assembly',
      ensureLinks: async () => ensureResumeExperienceLinks({
        resumeId: 'resume-a',
        candidates: [candidate],
        resumeExperienceMap: new Map(),
        expectedAuthCacheKey: 'owner-a',
        assertOwnerCurrent: async () => undefined,
        persistAssembly: async () => { throw new Error('assembly failed'); },
        applyResumeDetail: () => assert.fail('must not apply failed assembly'),
        setResumeExperienceMap: () => assert.fail('must not apply failed assembly'),
      }),
    },
    {
      name: 'owner',
      ensureLinks: async () => ensureResumeExperienceLinks({
        resumeId: 'resume-a',
        candidates: [candidate],
        resumeExperienceMap: new Map(),
        expectedAuthCacheKey: 'owner-a',
        assertOwnerCurrent: async () => { throw new Error('owner changed'); },
        persistAssembly: async () => assert.fail('must not persist after owner change'),
        applyResumeDetail: () => assert.fail('must not apply after owner change'),
        setResumeExperienceMap: () => assert.fail('must not apply after owner change'),
      }),
    },
    {
      name: 'owner changed after assembly',
      ensureLinks: async () => {
        let ownerChecks = 0;
        return ensureResumeExperienceLinks({
          resumeId: 'resume-a',
          candidates: [candidate],
          resumeExperienceMap: new Map(),
          expectedAuthCacheKey: 'owner-a',
          assertOwnerCurrent: async () => {
            ownerChecks += 1;
            if (ownerChecks === 2) throw new Error('owner changed after assembly');
          },
          persistAssembly: async () => detailWithLinks([
            linkedItem('master-a', 'link-a', 'version-a'),
          ]),
          applyResumeDetail: () => assert.fail('must not apply after post-assembly owner change'),
          setResumeExperienceMap: () => assert.fail('must not apply after post-assembly owner change'),
        });
      },
    },
    {
      name: 'conflict',
      ensureLinks: async () => { throw Object.assign(new Error('conflict'), { response: { status: 409 } }); },
    },
    {
      name: 'server omitted link',
      ensureLinks: async () => ensureResumeExperienceLinks({
        resumeId: 'resume-a',
        candidates: [candidate],
        resumeExperienceMap: new Map(),
        expectedAuthCacheKey: 'owner-a',
        assertOwnerCurrent: async () => undefined,
        persistAssembly: async () => detailWithLinks([]),
        applyResumeDetail: () => assert.fail('must verify links before applying detail'),
        setResumeExperienceMap: () => assert.fail('must verify links before applying map'),
      }),
    },
    {
      name: 'flush',
      ensureLinks: async () => undefined,
      flushConfig: async () => { throw new Error('flush failed'); },
    },
  ];

  for (const scenario of cases) {
    const events = [];
    await assert.rejects(
      runResumeEvaluationAfterLinkPreflight({
        ensureLinks: async () => {
          events.push('preflight');
          return scenario.ensureLinks();
        },
        flushConfig: scenario.flushConfig ?? (async () => events.push('flush')),
        generateEvaluation: async () => {
          events.push('generate');
          return { status: 'success' };
        },
      }),
      undefined,
      scenario.name,
    );
    assert.equal(events.includes('generate'), false, scenario.name);
  }
});

test('evaluation orchestration flushes only after link preflight and then generates', async () => {
  const { runResumeEvaluationAfterLinkPreflight } = await importPreflightHelpers();
  const events = [];
  const result = await runResumeEvaluationAfterLinkPreflight({
    ensureLinks: async () => events.push('preflight'),
    flushConfig: async () => events.push('flush'),
    generateEvaluation: async () => {
      events.push('generate');
      return { status: 'success' };
    },
  });

  assert.deepEqual(events, ['preflight', 'flush', 'generate']);
  assert.deepEqual(result, { status: 'success' });
});

test('assembly updated_at becomes the synchronous config-patch authority before flush', async () => {
  const {
    ensureResumeExperienceLinks,
    runResumeEvaluationAfterLinkPreflight,
  } = await importPreflightHelpers();
  const { adoptResumeDetailUpdatedAt } = await importResumeSaveBridge();
  const updatedAtRef = { current: 'v1' };
  const events = [];

  const result = await runResumeEvaluationAfterLinkPreflight({
    ensureLinks: async () => ensureResumeExperienceLinks({
      resumeId: 'resume-a',
      candidates: [{ masterId: 'master-a', versionId: 'version-a' }],
      resumeExperienceMap: new Map(),
      expectedAuthCacheKey: 'owner-a',
      assertOwnerCurrent: async () => undefined,
      persistAssembly: async () => detailWithLinks([
        linkedItem('master-a', 'link-a', 'version-a'),
      ], 'v2'),
      applyResumeDetail: (detail) => {
        events.push('apply-v2');
        adoptResumeDetailUpdatedAt(updatedAtRef, detail);
      },
      setResumeExperienceMap: () => undefined,
    }),
    flushConfig: async () => {
      events.push(`patch-${updatedAtRef.current}`);
      assert.equal(updatedAtRef.current, 'v2');
    },
    generateEvaluation: async () => {
      events.push('generate');
      return { status: 'success' };
    },
  });

  assert.deepEqual(events, ['apply-v2', 'patch-v2', 'generate']);
  assert.deepEqual(result, { status: 'success' });
  const resumeData = read('hooks/useResumeData.ts');
  const applyDetail = resumeData.slice(
    resumeData.indexOf('const applyResumeDetail = useCallback'),
    resumeData.indexOf('const applyResumeConfig', resumeData.indexOf('const applyResumeDetail = useCallback')),
  );
  assert.match(applyDetail, /adoptResumeDetailUpdatedAt\(state\.resumeUpdatedAtRef, detail\)/);
  assert.ok(
    applyDetail.indexOf('adoptResumeDetailUpdatedAt') < applyDetail.indexOf('state.setResumeDetail'),
  );
});

test('pending link persistence cannot apply or continue after a same-owner resume switch', async () => {
  const {
    assertResumeEvaluationLinkTargetCurrent,
    ensureResumeExperienceLinks,
    runResumeEvaluationAfterLinkPreflight,
  } = await importPreflightHelpers();
  let currentResumeId = 'resume-a';
  const events = [];

  await assert.rejects(runResumeEvaluationAfterLinkPreflight({
    ensureLinks: async () => ensureResumeExperienceLinks({
      resumeId: 'resume-a',
      candidates: [{ masterId: 'master-a', versionId: 'version-a' }],
      resumeExperienceMap: new Map(),
      expectedAuthCacheKey: 'owner-a',
      assertOwnerCurrent: async () => assertResumeEvaluationLinkTargetCurrent(
        'resume-a',
        currentResumeId,
      ),
      persistAssembly: async () => {
        events.push('persist-old-resume-link');
        currentResumeId = 'resume-b';
        return detailWithLinks([linkedItem('master-a', 'link-a', 'version-a')]);
      },
      applyResumeDetail: () => events.push('apply-old-detail'),
      setResumeExperienceMap: () => events.push('apply-old-map'),
    }),
    flushConfig: async () => events.push('flush-new-resume'),
    generateEvaluation: async () => events.push('generate-new-resume'),
  }), /resume/i);

  assert.deepEqual(events, ['persist-old-resume-link']);
  const hook = read('views/ResumeEditor/hooks/useResumeEvaluationLinkPreflight.ts');
  assert.match(hook, /const activeResumeIdRef = useRef\(resumeId\)/);
  assert.match(hook, /activeResumeIdRef\.current = resumeId/);
  assert.match(hook, /const requestedResumeId = resumeId/);
  assert.match(hook, /assertResumeEvaluationLinkTargetCurrent\(\s*requestedResumeId,\s*activeResumeIdRef\.current/);
});

test('pending link persistence cannot spend an evaluation after its source signature changes', async () => {
  const {
    assertResumeEvaluationLinkSignatureCurrent,
    assertResumeEvaluationLinkTargetCurrent,
    ensureResumeExperienceLinks,
    runResumeEvaluationAfterLinkPreflight,
  } = await importPreflightHelpers();
  let currentResumeId = 'resume-a';
  let currentEvaluationSignature = 'signature-a';
  const events = [];

  const assertInputCurrent = async () => {
    assertResumeEvaluationLinkTargetCurrent('resume-a', currentResumeId);
    assertResumeEvaluationLinkSignatureCurrent('signature-a', currentEvaluationSignature);
  };
  await assert.rejects(runResumeEvaluationAfterLinkPreflight({
    ensureLinks: async () => ensureResumeExperienceLinks({
      resumeId: 'resume-a',
      candidates: [{ masterId: 'master-a', versionId: 'version-a' }],
      resumeExperienceMap: new Map(),
      expectedAuthCacheKey: 'owner-a',
      assertOwnerCurrent: assertInputCurrent,
      persistAssembly: async () => {
        events.push('persist-old-resume-link');
        currentEvaluationSignature = 'signature-b';
        return detailWithLinks([linkedItem('master-a', 'link-a', 'version-a')]);
      },
      applyResumeDetail: () => events.push('apply-old-detail'),
      setResumeExperienceMap: () => events.push('apply-old-map'),
    }),
    flushConfig: async () => events.push('flush-new-source'),
    generateEvaluation: async () => events.push('generate-old-source'),
  }), /signature/i);

  assert.equal(currentResumeId, 'resume-a');
  assert.deepEqual(events, ['persist-old-resume-link']);
  const hook = read('views/ResumeEditor/hooks/useResumeEvaluationLinkPreflight.ts');
  assert.match(hook, /const activeEvaluationSignatureRef = useRef\(evaluationSignature\)/);
  assert.match(hook, /activeEvaluationSignatureRef\.current = evaluationSignature/);
  assert.match(hook, /const requestedEvaluationSignature = evaluationSignature/);
  assert.match(hook, /assertResumeEvaluationLinkSignatureCurrent\(\s*requestedEvaluationSignature,\s*activeEvaluationSignatureRef\.current/);
  assert.match(hook, /assertCurrent: assertOperationCurrent/);
});

test('a source change while config is flushing cannot start a billable evaluation', async () => {
  const {
    assertResumeEvaluationLinkSignatureCurrent,
    runResumeEvaluationAfterLinkPreflight,
  } = await importPreflightHelpers();
  let currentEvaluationSignature = 'signature-a';
  const events = [];
  const assertCurrent = async () => assertResumeEvaluationLinkSignatureCurrent(
    'signature-a',
    currentEvaluationSignature,
  );

  await assert.rejects(runResumeEvaluationAfterLinkPreflight({
    ensureLinks: async () => {
      events.push('preflight');
      return { assertCurrent };
    },
    flushConfig: async () => {
      events.push('flush');
      currentEvaluationSignature = 'signature-b';
    },
    generateEvaluation: async () => events.push('generate-old-source'),
  }), /signature/i);

  assert.deepEqual(events, ['preflight', 'flush']);
});

test('JD persistence authority is rechecked after link and config awaits before generation', async () => {
  const { runResumeEvaluationAfterLinkPreflight } = await importPreflightHelpers();

  for (const conflictStage of ['preflight', 'flush']) {
    let authorityCurrent = true;
    const events = [];
    await assert.rejects(runResumeEvaluationAfterLinkPreflight({
      assertJDAnalysisCurrent: () => authorityCurrent,
      ensureLinks: async () => {
        events.push('preflight');
        if (conflictStage === 'preflight') authorityCurrent = false;
      },
      flushConfig: async () => {
        events.push('flush');
        if (conflictStage === 'flush') authorityCurrent = false;
      },
      generateEvaluation: async () => {
        events.push('generate');
      },
    }), /persistence authority/i);

    assert.equal(events.includes('generate'), false, conflictStage);
    assert.deepEqual(
      events,
      conflictStage === 'preflight' ? ['preflight'] : ['preflight', 'flush'],
    );
  }
});

test('editor wires the owner-guarded preflight before config flush and report generation', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const hook = read('views/ResumeEditor/hooks/useResumeEvaluationLinkPreflight.ts');
  const handler = editor.slice(
    editor.indexOf('const handleGenerateEvaluationOnly = useCallback'),
    editor.indexOf('const {', editor.indexOf('const handleGenerateEvaluationOnly = useCallback') + 10),
  );

  assert.match(editor, /useResumeEvaluationLinkPreflight\(/);
  assert.match(hook, /useAuthOwnerOperationGuard/);
  assert.match(hook, /ownerGuard\.beginOperation\(\)/);
  assert.match(hook, /ownerGuard\.assertOperationCurrent\(operation\)/);
  assert.match(handler, /runResumeEvaluationAfterLinkPreflight\(\{/);
  assert.match(handler, /ensureLinks: ensureSelectedExperienceLinks/);
  assert.match(handler, /flushConfig: flushResumeConfig/);
  assert.match(handler, /generateEvaluation/);
  assert.match(handler, /assertJDAnalysisCurrent: \(\) => isCurrent\(\) && canPersistCurrentJDAnalysis\(\)/);
  assert.match(handler, /showToastError\('简历内容已在其他请求中更新，请刷新后再生成六维报告'\)/);
});
