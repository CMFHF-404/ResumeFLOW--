import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { build } from 'esbuild';

const importProfileDraftUtils = async () => {
  const result = await build({
    entryPoints: ['views/ExperienceBank/profileDraftUtils.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
};

const buildProfile = (overrides = {}) => ({
  user_id: 'user-1',
  full_name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '123456',
  location: 'London',
  summary: 'Original summary',
  social_links: {
    linkedin: { url: 'https://linkedin.com/in/ada', position: 2 },
    github: 'https://github.com/ada',
  },
  extra_json: {
    avatar_data_url: 'data:image/png;base64,avatar',
    theme: 'classic',
  },
  updated_at: '2026-06-06T00:00:00.000Z',
  ...overrides,
});

const buildDraft = (overrides = {}) => ({
  name: 'Draft Name',
  email: 'draft@example.com',
  phone: '999999',
  location: 'Draft City',
  link: 'https://linkedin.com/in/draft',
  summary: 'Draft summary',
  profileSocialLinks: {
    linkedin: { url: 'https://linkedin.com/in/old-draft', position: 7 },
    website: 'https://example.com',
  },
  ...overrides,
});

test('builds profile form snapshots from persisted profile fields', async () => {
  const { buildProfileFormSnapshot } = await importProfileDraftUtils();

  const snapshot = buildProfileFormSnapshot(buildProfile());

  assert.equal(snapshot.name, 'Ada Lovelace');
  assert.equal(snapshot.link, 'https://linkedin.com/in/ada');
  assert.equal(snapshot.avatarDataUrl, 'data:image/png;base64,avatar');
  assert.deepEqual(snapshot.originalProfile, {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '123456',
    location: 'London',
    link: 'https://linkedin.com/in/ada',
    summary: 'Original summary',
    avatarDataUrl: 'data:image/png;base64,avatar',
    extraJson: {
      avatar_data_url: 'data:image/png;base64,avatar',
      theme: 'classic',
    },
  });
});

test('returns the original profile before hydration when there are no draft overrides', async () => {
  const {
    buildDraftProfileSnapshot,
    createProfileDraftOverrides,
  } = await importProfileDraftUtils();
  const profile = buildProfile();

  const snapshot = buildDraftProfileSnapshot(profile, {
    hasHydratedProfile: false,
    overrides: createProfileDraftOverrides(),
    currentDraft: buildDraft(),
  });

  assert.equal(snapshot, profile);
});

test('applies only touched draft fields to profile snapshots', async () => {
  const {
    buildDraftProfileSnapshot,
    createProfileDraftOverrides,
  } = await importProfileDraftUtils();
  const overrides = createProfileDraftOverrides();
  overrides.name = true;
  overrides.link = true;

  const snapshot = buildDraftProfileSnapshot(buildProfile(), {
    hasHydratedProfile: true,
    overrides,
    currentDraft: buildDraft(),
  });

  assert.equal(snapshot.full_name, 'Draft Name');
  assert.equal(snapshot.email, 'ada@example.com');
  assert.deepEqual(snapshot.social_links.linkedin, {
    url: 'https://linkedin.com/in/draft',
    position: 2,
  });
});

test('recovers server profile while preserving locally edited draft fields', async () => {
  const {
    buildRecoveredProfileFormSnapshot,
    createProfileDraftOverrides,
  } = await importProfileDraftUtils();
  const overrides = createProfileDraftOverrides();
  overrides.email = true;
  overrides.summary = true;

  const snapshot = buildRecoveredProfileFormSnapshot(buildProfile({
    email: 'server@example.com',
    summary: 'Server summary',
  }), {
    overrides,
    currentDraft: buildDraft({
      email: 'local@example.com',
      summary: 'Local summary',
    }),
  });

  assert.equal(snapshot.name, 'Ada Lovelace');
  assert.equal(snapshot.email, 'local@example.com');
  assert.equal(snapshot.summary, 'Local summary');
  assert.equal(snapshot.avatarDataUrl, 'data:image/png;base64,avatar');
  assert.deepEqual(snapshot.extraJson, {
    avatar_data_url: 'data:image/png;base64,avatar',
    theme: 'classic',
  });
  assert.equal(snapshot.profileSocialLinks.github, 'https://github.com/ada');
  assert.equal(snapshot.originalProfile.email, 'server@example.com');
  assert.equal(snapshot.originalProfile.summary, 'Server summary');
});

test('preserves non-LinkedIn social links when overriding recovered LinkedIn link', async () => {
  const {
    buildRecoveredProfileFormSnapshot,
    createProfileDraftOverrides,
  } = await importProfileDraftUtils();
  const overrides = createProfileDraftOverrides();
  overrides.link = true;

  const snapshot = buildRecoveredProfileFormSnapshot(buildProfile(), {
    overrides,
    currentDraft: buildDraft({
      link: 'https://linkedin.com/in/local-draft',
    }),
  });

  assert.equal(snapshot.link, 'https://linkedin.com/in/local-draft');
  assert.deepEqual(snapshot.profileSocialLinks.linkedin, {
    url: 'https://linkedin.com/in/local-draft',
    position: 2,
  });
  assert.equal(snapshot.profileSocialLinks.github, 'https://github.com/ada');
});
