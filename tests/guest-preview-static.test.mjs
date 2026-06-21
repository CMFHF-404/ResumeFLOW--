import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('App renders the authenticated editor only for signed-in users and uses guest preview otherwise', () => {
  const app = read('App.tsx');
  const guestPreview = read('views/GuestResumeEditorPreview.tsx');

  assert.match(app, /import \{ useLogto \} from '@logto\/react'/);
  assert.match(app, /const logto = useLogto\(\)/);
  assert.match(app, /const \{ isAuthenticated, signIn \} = logto/);
  assert.match(app, /<GuestResumeEditorPreview\s+onRequireAuth=\{handleRequireAuth\}/);
  assert.match(app, /isAuthenticated\s+\?\s*\(\s*<ResumeEditor/);
  assert.doesNotMatch(guestPreview, /resumeService|profileService|experienceService|useResumeData/);
  assert.match(guestPreview, /只读预览/);
});

test('Dashboard guest mode skips protected list loading and routes write actions to login', () => {
  const hook = read('views/Dashboard/useDashboardResumeList.ts');
  const dashboard = read('views/Dashboard.tsx');

  assert.match(hook, /isAuthenticated:\s*boolean/);
  assert.match(hook, /onRequireAuth:\s*\(\) => void \| Promise<void>/);
  assert.match(hook, /if \(!isAuthenticated\) \{[\s\S]*setResumes\(\[\]\)[\s\S]*setIsLoading\(false\)[\s\S]*return;/);
  assert.match(hook, /if \(!isAuthenticated\) \{[\s\S]*void onRequireAuth\(\);[\s\S]*return;/);
  assert.match(dashboard, /isAuthenticated,\s*\n\s*onRequireAuth:\s*handleSignIn/);
  assert.match(dashboard, /<UnAuthPrompt \/>/);
});

test('ExperienceBank guest mode skips protected data loads and gates editing actions', () => {
  const bank = read('views/ExperienceBank.tsx');
  const profileHook = read('views/ExperienceBank/useExperienceBankProfile.ts');
  const experienceModel = read('views/ExperienceSection/model.ts');
  const experienceList = read('views/ExperienceSection/experienceListHooks.ts');
  const education = read('hooks/useEducationManager.ts');
  const certs = read('views/CertificationSection.tsx');
  const skills = read('views/SkillsSection.tsx');

  assert.match(profileHook, /isAuthenticated:\s*boolean/);
  assert.match(profileHook, /onRequireAuth:\s*\(\) => void \| Promise<void>/);
  assert.match(profileHook, /if \(!isAuthenticated\) \{[\s\S]*setIsLoadingProfile\(false\)[\s\S]*return;/);
  assert.match(profileHook, /if \(!isAuthenticated\) \{[\s\S]*void onRequireAuth\(\);[\s\S]*return;/);
  assert.match(experienceList, /isAuthenticated:\s*boolean/);
  assert.match(experienceList, /if \(!isAuthenticated\) \{[\s\S]*setIsLoading\(false\)[\s\S]*return;/);
  assert.match(experienceModel, /if \(!isAuthenticated\) \{[\s\S]*void onRequireAuth\(\);[\s\S]*return;/);
  assert.match(education, /isAuthenticated:\s*boolean/);
  assert.match(certs, /isAuthenticated\s*=\s*true/);
  assert.match(skills, /isAuthenticated\s*=\s*true/);
  assert.match(bank, /isAuthenticated=\{isAuthenticated\}/);
  assert.match(bank, /onRequireAuth=\{handleSignIn\}/);
});

test('AI assistant keeps its unauthenticated shell and short-circuits session loading', () => {
  const assistant = read('views/AIAssistant.tsx');
  const loadingHook = read('views/AIAssistant/useAssistantSessionLoading.ts');

  assert.match(assistant, /!\s*isAuthenticated\s*\?\s*\(/);
  assert.match(assistant, /<UnAuthPrompt \/>/);
  assert.match(loadingHook, /if \(!isAuthenticated\) \{[\s\S]*setSessionsState\(\[\]\)[\s\S]*return;/);
});
