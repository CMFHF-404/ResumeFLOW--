import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useExperienceBankProfile} from './views/ExperienceBank/useExperienceBankProfile';
import {ImageCropModal} from './components/ImageCropModal';
const canvas = document.createElement('canvas'); canvas.width = 6; canvas.height = 8;
const context = canvas.getContext('2d');
window.sources = {};
for (const [key, color] of [['original', 'green'], ['A', 'red'], ['B', 'blue']]) {
  context.fillStyle = color; context.fillRect(0, 0, 6, 8); window.sources[key] = canvas.toDataURL();
}
window.profiles = Object.fromEntries(['user-a', 'user-b'].map(owner => [owner, {
  user_id: owner, extra_json: {avatar_data_url: window.sources[owner === 'user-a' ? 'original' : 'B']},
  updated_at: '2026-10-10T00:00:00Z',
}]));
window.pendingReaders = [];
window.pendingAuth = [];
window.FileReader = class {
  readAsDataURL(file) {window.pendingReaders.push({reader:this, name:file.name});}
};
const noop = () => '';
function Fixture() {
  const [owner, setOwner] = useState('user-a');
  window.activeOwner = owner; window.switchOwner = setOwner;
  const model = useExperienceBankProfile({authUserKey:owner, isAuthenticated:true,
    cachedProfile:window.profiles[owner], onRequireAuth:noop, refreshEducation:async()=>{},
    loadExportSnapshot:async()=>({}), loadValidationSnapshot:async()=>null, buildSummaryPayload:noop,
    success:noop, toastError:noop, loading:noop, updateToast:noop, closeToast:noop});
  window.model = model;
  return <><button onClick={model.handleAvatarUploadClick}>编辑头像</button>
    <button onClick={model.handleCancelProfile}>取消个人资料</button>
    <input type="file" ref={model.avatarFileInputRef} onChange={model.handleFileSelected}/>
    <ImageCropModal imageSrc={model.isCropModalOpen ? model.pendingImageSrc : null}
      hasExistingAvatar={!!model.avatarDataUrl} onConfirm={model.handleCropConfirm}
      onCancel={model.handleCropCancel} onDelete={model.handleAvatarDelete}
      onReplace={()=>model.avatarFileInputRef.current?.click()}/>
  </>;
}
window.fixtureRoot = createRoot(document.getElementById('root'));
window.fixtureRoot.render(<Fixture/>);
`;

const modules = {
  api: `
    export class AuthContextChangedError extends Error {
      constructor() {super('changed');this.name='AuthContextChangedError';}
    }
    export const isAuthContextChangedError = error => error?.name === 'AuthContextChangedError';
    export const assertAuthCacheKey = async owner => {
      if (owner !== window.activeOwner) throw new AuthContextChangedError();
    };
    export const captureAuthCacheKey = async expected => {
      await assertAuthCacheKey(expected);
      if (window.pauseAuth) await new Promise(resolve => window.pendingAuth.push(resolve));
      await assertAuthCacheKey(expected);
      return expected;
    };`,
  profile: `export const profileService = {
    getProfile:async()=>window.profiles[window.activeOwner],
    updateProfile:async()=>window.profiles[window.activeOwner],
  };`,
  resume: `export const assertResumeAuthContext = async()=>{};
    export const isResumeVersionConflict = ()=>false;
    export const waitForResumeMutations = async()=>{};
    export const resumeService = {list:async()=>[], get:async()=>({}), update:async()=>({})};`,
  storage: `export const getActiveResumeId = ()=>null; export const setActiveResumeId = ()=>{};`,
  summary: `export const useExperienceBankSummaryGeneration = ()=>({isGeneratingSummary:false,
    cancelSummaryGeneration:()=>{}, handleGenerateSummary:async()=>{}, handleSummaryChange:()=>{}});`,
  target: `export const updateResumeTargetRoleWithConflictRetry = async()=>({});`,
};
let browser;
let bundle;
before(async () => {
  const {outputFiles} = await build({
    stdin:{contents:fixture, resolveDir:process.cwd(), loader:'tsx'},
    bundle:true, write:false, platform:'browser', format:'iife',
    define:{'process.env.NODE_ENV':'"development"', 'import.meta.env':'{}'},
    plugins:[{name:'avatar-read-fixture', setup(builder) {
      for (const [suffix, key] of [['apiClient','api'], ['profileService','profile'],
        ['resumeService','resume'], ['resumeStorage','storage'],
        ['useExperienceBankSummaryGeneration','summary'], ['targetRoleUpdate','target']]) {
        builder.onResolve({filter:new RegExp('(?:^|/)' + suffix + '$')}, () => ({path:key, namespace:'fixture'}));
      }
      builder.onLoad({filter:/.*/, namespace:'fixture'}, ({path}) => ({contents:modules[path], loader:'js'}));
    }}],
  });
  bundle = outputFiles[0].text;
  browser = await chromium.launch({headless:true});
});
after(async () => {await browser?.close();});

const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const mount = async t => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {await page.close(); assert.deepEqual(errors, []);});
  await page.setContent('<!doctype html><div id="root"></div>');
  await page.addScriptTag({content:bundle});
  await page.waitForFunction(() => window.model?.isAvatarInteractionEnabled);
  await page.getByRole('button', {name:'编辑头像', exact:true}).click();
  await page.getByRole('dialog', {name:'裁剪头像'}).waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent.includes('确认裁剪'))?.disabled);
  return page;
};
const select = async (page, key) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', {name:'更换照片', exact:true}).click();
  const source = await page.evaluate(key => window.sources[key], key);
  await (await chooser).setFiles({name:key + '.png', mimeType:'image/png', buffer:Buffer.from(source.split(',')[1], 'base64')});
};
const finishRead = async (page, index, key) => {
  await page.evaluate(({index, key}) => window.pendingReaders[index].reader.onload({target:{result:window.sources[key]}}), {index, key});
  await settle(page);
};

test('the latest replacement wins when earlier file reads finish later', async t => {
  const page = await mount(t);
  await select(page, 'A'); await page.waitForFunction(() => window.pendingReaders.length === 1);
  await select(page, 'B'); await page.waitForFunction(() => window.pendingReaders.length === 2);
  await finishRead(page, 1, 'B');
  assert.equal(await page.evaluate(() => window.model.pendingImageSrc === window.sources.B), true);
  await finishRead(page, 0, 'A');
  assert.equal(await page.evaluate(() => window.model.pendingImageSrc === window.sources.B), true);
});

for (const [action, button] of [['cancel', '取消'], ['profile-cancel', '取消个人资料'], ['delete', '删除照片'], ['confirm', '确认裁剪']]) {
  test(`${action} discards a replacement that is still being read`, async t => {
    const page = await mount(t);
    await select(page, 'A'); await page.waitForFunction(() => window.pendingReaders.length === 1);
    await page.getByRole('button', {name:button, exact:true}).click();
    await page.waitForFunction(() => !window.model.isCropModalOpen);
    const avatar = await page.evaluate(() => window.model.avatarDataUrl);
    await finishRead(page, 0, 'A');
    assert.deepEqual(await page.evaluate(() => ({open:window.model.isCropModalOpen, pending:window.model.pendingImageSrc})), {open:false, pending:null});
    assert.equal(await page.evaluate(() => window.model.avatarDataUrl), avatar);
    if (action === 'delete') assert.equal(avatar, null);
    if (action === 'confirm') assert.ok(avatar.startsWith('data:image/jpeg;base64,'));
  });
}

test('an account switch discards the previous account replacement', async t => {
  const page = await mount(t);
  await select(page, 'A'); await page.waitForFunction(() => window.pendingReaders.length === 1);
  await page.evaluate(() => window.switchOwner('user-b'));
  await page.waitForFunction(() => window.activeOwner === 'user-b' && window.model.avatarDataUrl === window.sources.B);
  await finishRead(page, 0, 'A');
  assert.deepEqual(await page.evaluate(() => ({open:window.model.isCropModalOpen, pending:window.model.pendingImageSrc, ownerAvatar:window.model.avatarDataUrl === window.sources.B})), {open:false, pending:null, ownerAvatar:true});
});

test('cancellation during authorization prevents even starting the stale file read', async t => {
  const page = await mount(t);
  await page.evaluate(() => {window.pauseAuth = true;});
  await select(page, 'A'); await page.waitForFunction(() => window.pendingAuth.length === 1);
  await page.getByRole('button', {name:'取消', exact:true}).click();
  await page.evaluate(() => window.pendingAuth[0]()); await settle(page);
  assert.equal(await page.evaluate(() => window.pendingReaders.length), 0);
});

test('out of order authorization cannot start an older replacement read', async t => {
  const page = await mount(t);
  await page.evaluate(() => {window.pauseAuth = true;});
  await select(page, 'A'); await page.waitForFunction(() => window.pendingAuth.length === 1);
  await select(page, 'B'); await page.waitForFunction(() => window.pendingAuth.length === 2);
  await page.evaluate(() => window.pendingAuth[1]());
  await page.waitForFunction(() => window.pendingReaders.length === 1);
  await page.evaluate(() => window.pendingAuth[0]()); await settle(page);
  assert.deepEqual(await page.evaluate(() => window.pendingReaders.map(item => item.name)), ['B.png']);
  await finishRead(page, 0, 'B');
  assert.equal(await page.evaluate(() => window.model.pendingImageSrc === window.sources.B), true);
});
