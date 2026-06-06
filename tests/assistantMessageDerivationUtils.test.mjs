import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importMessageDerivationUtils = async () => {
  const result = await build({
    entryPoints: ['views/AIAssistant/messageDerivationUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const buildMessage = (overrides = {}) => ({
  id: 'message-1',
  role: 'assistant',
  message_type: 'assistant_text',
  content_json: {},
  created_at: '2026-06-06T00:00:00.000Z',
  ...overrides,
});

const buildSession = (overrides = {}) => ({
  id: 'session-1',
  user_id: 'user-1',
  title: 'Session',
  mode: 'experience',
  entry_source: 'resume_editor',
  context_json: {},
  latest_preview: {},
  created_at: '2026-06-06T00:00:00.000Z',
  updated_at: '2026-06-06T00:00:00.000Z',
  ...overrides,
});

const buildExperienceDraftCard = (overrides = {}) => ({
  type: 'experience',
  status: 'draft_ready',
  data: {
    category: 'project',
    org: 'Org',
    title: 'Title',
    startDate: '2026-01',
    endDate: '',
    isCurrent: true,
    star: {
      s: 'Situation',
      t: 'Task',
      a: 'Action',
      r: 'Result',
    },
    ...overrides,
  },
});

test('derives explicit suggested followups from the latest assistant text first', async () => {
  const { deriveLatestSuggestedFollowups } = await importMessageDerivationUtils();

  const followups = deriveLatestSuggestedFollowups([
    buildMessage({
      id: 'older',
      content_json: {
        suggestedFollowups: [{
          label: 'Old',
          prompt: 'Old prompt',
          skillId: 'star_guidance',
        }],
      },
    }),
    buildMessage({
      id: 'latest',
      content_json: {
        suggestedFollowups: [{
          label: 'Next',
          prompt: 'Next prompt',
          skillId: 'experience_completion',
        }],
      },
    }),
  ]);

  assert.deepEqual(followups, [{
    label: 'Next',
    prompt: 'Next prompt',
    skillId: 'experience_completion',
  }]);
});

test('derives fallback followup from the latest assistant question', async () => {
  const { deriveLatestSuggestedFollowups } = await importMessageDerivationUtils();

  const followups = deriveLatestSuggestedFollowups([
    buildMessage({
      content_json: {
        text: '请补充你在项目里负责的指标是什么？',
        skill_id: 'star_guidance',
      },
    }),
  ]);

  assert.deepEqual(followups, [{
    label: '回答这个问题',
    prompt: '我来补充这个问题：请补充你在项目里负责的指标是什么？',
    skillId: 'star_guidance',
  }]);
});

test('derives displayable draft cards and filters empty skill drafts', async () => {
  const { deriveDraftMessageItems } = await importMessageDerivationUtils();

  const draftMessage = buildMessage({
    id: 'draft-1',
    message_type: 'draft_card',
    content_json: buildExperienceDraftCard({ targetMasterId: 'master-1' }),
  });
  const emptySkillMessage = buildMessage({
    id: 'empty-skill',
    message_type: 'draft_card',
    content_json: {
      type: 'skill_group',
      status: 'draft_ready',
      data: { category: 'Frontend', skills: [] },
    },
  });

  const items = deriveDraftMessageItems(
    [draftMessage, emptySkillMessage],
    buildSession(),
    new Set(),
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].message.id, 'draft-1');
  assert.equal(items[0].card.type, 'experience');
});

test('marks resume editor callback-only experience drafts as manual save mode', async () => {
  const { deriveDraftMessageItems } = await importMessageDerivationUtils();

  const items = deriveDraftMessageItems(
    [buildMessage({
      id: 'draft-1',
      message_type: 'draft_card',
      content_json: buildExperienceDraftCard(),
    })],
    buildSession({ id: 'session-1', entry_source: 'resume_editor' }),
    new Set(['session-1']),
  );

  assert.equal(items[0].isManualSaveMode, true);
});
