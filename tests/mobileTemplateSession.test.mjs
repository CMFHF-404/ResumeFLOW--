import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const bundle = async (entryPoints, plugins = []) => {
    const result = await build({ entryPoints, plugins, bundle: true, format: 'esm', platform: 'node', write: false });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
};
const { selectTemplateAppearance, applyTemplateDraft } = await bundle(['views/ResumeEditor/mobileTemplateSession.ts']);
const original = {
    templateId: 'modern-slate', themeColorPresetId: 'slate', sectionOrder: ['summary', 'work', 'education'],
    experienceListMarkerStyle: 'ordered', skillTagSeparator: '/',
    layout: { topPaddingPx: 55, sectionSpacingKey: 4, itemSpacingEm: 0.7, lineHeight: 1.5, fontSize: 14 },
    isSmartPageApplied: true,
};
const preset = {
    templateId: 'deephire-blue', themeColorPresetId: 'slate',
    sectionOrder: ['education', 'work', 'summary'], experienceListMarkerStyle: 'none', skillTagSeparator: '·',
    layoutDefaults: { ...original.layout, topPaddingPx: 72 }, updatedAt: '2026-09-09T00:00:00Z',
};

test('repeated selection preserves current customization and smart layout', () => {
    assert.equal(selectTemplateAppearance(original, original.templateId, {}), original);
});
test('template preview applies defaults without mutating the cancel baseline', () => {
    const snapshot = structuredClone(original);
    const selected = selectTemplateAppearance(original, preset.templateId, { [preset.templateId]: preset });
    assert.equal(selected.layout.topPaddingPx, 72);
    assert.equal(selected.isSmartPageApplied, false);
    assert.deepEqual(selected.sectionOrder, preset.sectionOrder);
    selected.sectionOrder.reverse();
    assert.deepEqual(original, snapshot);
    assert.deepEqual(preset.sectionOrder, ['education', 'work', 'summary']);
});
test('customization stays in the appearance draft and normalizes fixed template colors', () => {
    const selected = selectTemplateAppearance(original, preset.templateId, { [preset.templateId]: preset });
    const custom = applyTemplateDraft(selected, { ...preset, experienceListMarkerStyle: 'ordered', skillTagSeparator: ' / ' });
    assert.equal(custom.experienceListMarkerStyle, 'ordered');
    assert.equal(original.skillTagSeparator, '/');
    assert.deepEqual(custom.layout, selected.layout);
    assert.notEqual(custom.sectionOrder, preset.sectionOrder);
});

test('batch confirmation writes all presets with one profile update and preserves unrelated data', async () => {
    const updates = [];
    const profile = { user_id: 'qa-user', extra_json: { unrelated: { value: 17 } } };
    globalThis.__templateProfile = { getProfile: async () => profile, updateProfile: async (payload, options) => {
        updates.push({ payload, options }); return { ...profile, ...payload };
    } };
    const storage = await bundle(['services/resumeTemplateStorage.ts'], [{ name: 'profile-fixture', setup(b) {
        b.onResolve({ filter: /^\.\/profileService$/ }, () => ({ path: 'profile', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const profileService = globalThis.__templateProfile;', loader: 'js' }));
    } }]);
    const saved = await storage.saveResumeTemplatePresets([
        { ...preset }, { ...preset, templateId: 'modern-slate' },
    ], 'qa-user');
    assert.equal(updates.length, 1);
    assert.equal(Object.keys(saved).length, 2);
    assert.deepEqual(updates[0].payload.extra_json.unrelated, { value: 17 });
    assert.equal(updates[0].options.expectedAuthCacheKey, 'qa-user');
    await assert.rejects(storage.saveResumeTemplatePresets([preset], 'qa-user', () => false));
    assert.equal(updates.length, 1, 'owner/session changes must stop the write');
    profile.user_id = 'different-user';
    await assert.rejects(storage.saveResumeTemplatePresets([preset], 'qa-user'));
    assert.equal(updates.length, 1);
    delete globalThis.__templateProfile;
});

test('preview drafts are isolated from autosave and all appearance fields reach the real preview', () => {
    const editor = readFileSync('views/ResumeEditor/index.tsx', 'utf8');
    const snapshot = editor.slice(editor.indexOf('const resumeConfigSnapshot'), editor.indexOf('const applyLayoutConfig'));
    assert.doesNotMatch(snapshot, /mobileTemplates/);
    assert.match(editor, /configSnapshot: resumeConfigSnapshot/);
    for (const field of ['templateId', 'themeColorPresetId', 'sectionOrder', 'experienceListMarkerStyle', 'skillTagSeparator']) {
        assert.ok(editor.includes(`${field}: mobileTemplates.current.${field}`));
    }
    assert.match(editor, /previewProps=\{editorPreviewPropsWithOptimization\}/);
    assert.match(editor, /mobileTemplates\.active \? 'hidden' : 'md:hidden'/);
});

test('selection session cancels, commits, retries and discards stale owner/breakpoint work', async () => {
    const slots = []; let cursor = 0; let effects = []; let dirty = false;
    const react = {
        useState(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
            return [slots[index], value => {
                const next = typeof value === 'function' ? value(slots[index]) : value;
                if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
            }];
        },
        useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
        useEffect(effect, deps) {
            const index = cursor++; const old = slots[index];
            if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
                effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
            }
        },
    };
    globalThis.__mobileHookReact = react;
    globalThis.document = { activeElement: null };
    globalThis.HTMLElement = class {};
    let writes = 0; let fail = false; let release; let delay = false;
    globalThis.__mobileHookStorage = {
        savePreferredResumeTemplateId: () => {},
        saveResumeTemplatePresets: async (drafts, owner, isCurrent) => {
            if (delay) await new Promise(resolve => { release = resolve; });
            if (!isCurrent()) throw Error('stale');
            if (fail) throw Error('failed');
            writes++;
            return Object.fromEntries(drafts.map(draft => [draft.templateId, draft]));
        },
    };
    const { useMobileTemplateSession } = await bundle(['views/ResumeEditor/hooks/useMobileTemplateSession.ts'], [{ name: 'hook-runtime', setup(b) {
        b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'hook-fixture' }));
        b.onResolve({ filter: /services\/resumeTemplateStorage$/ }, () => ({ path: 'storage', namespace: 'hook-fixture' }));
        b.onResolve({ filter: /mobileTemplateTransition$/ }, () => ({ path: 'transition', namespace: 'hook-fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'hook-fixture' }, args => ({ loader: 'js', contents: args.path === 'react'
            ? 'export const {useState,useRef,useEffect}=globalThis.__mobileHookReact;'
            : args.path === 'transition' ? 'export const transitionMobileTemplateMode = update => update(); export const prepareMobileTemplateTransition = async () => {};'
            : 'export const {savePreferredResumeTemplateId,saveResumeTemplatePresets}=globalThis.__mobileHookStorage;' }));
    } }]);
    const commits = [];
    const options = { owner: 'a:1', authUserKey: 'a', enabled: true, appearance: original, presets: { [preset.templateId]: preset }, ready: true, canCommit: true, onCommit: value => commits.push(value), onPresetsSaved: () => {} };
    let hook;
    const render = () => {
        let attempts = 0;
        do { dirty = false; cursor = 0; hook = useMobileTemplateSession(options); const pending = effects; effects = []; pending.forEach(effect => effect()); }
        while (dirty && ++attempts < 10);
        return hook;
    };
    try {
        render().open(); render().select(preset.templateId); render();
        const refreshedPreset = { ...preset, layoutDefaults: { ...preset.layoutDefaults, topPaddingPx: 90 } };
        options.presets = { [preset.templateId]: refreshedPreset };
        render().select(original.templateId);
        render().select(preset.templateId);
        assert.equal(render().current.layout.topPaddingPx, 90, 'reselection uses cloud presets received after local fallback');
        await hook.confirm();
        assert.equal(commits.pop().layout.topPaddingPx, 90, 'confirmation commits the refreshed preview');
        assert.equal(writes, 0);
        options.presets = { [preset.templateId]: preset };
        render().open(); render().select(preset.templateId);
        assert.equal(render().current.layout.topPaddingPx, 72);
        hook.select(original.templateId);
        assert.deepEqual(render().current, original, 'returning to the original template restores the resume appearance');
        hook.select(preset.templateId);
        render().select('open-source-classic');
        assert.deepEqual(render().current.layout, original.layout, 'a template without presets uses the session baseline');
        assert.deepEqual(hook.current.sectionOrder, original.sectionOrder);
        assert.equal(hook.current.isSmartPageApplied, true);
        hook.select(preset.templateId);
        render();
        await hook.stagePreset({ ...preset, skillTagSeparator: '|' });
        assert.equal(render().current.skillTagSeparator, '|');
        const customized = structuredClone(hook.current);
        options.presets = { [preset.templateId]: refreshedPreset, [original.templateId]: { ...refreshedPreset, templateId: original.templateId } };
        hook.select(original.templateId);
        assert.deepEqual(render().current, original);
        hook.select(preset.templateId);
        assert.deepEqual(render().current, customized, 'revisiting a customized template retains its session draft');
        options.presets = { [preset.templateId]: preset };
        hook.select(original.templateId);
        await render().stagePreset({ ...original, skillTagSeparator: '|' });
        const customizedOriginal = structuredClone(render().current);
        hook.select(preset.templateId);
        render().select(original.templateId);
        assert.deepEqual(render().current, customizedOriginal, 'editing the original template replaces its session appearance');
        hook.cancel(); assert.deepEqual(render().current, original); assert.equal(writes, 0); assert.equal(commits.length, 0);
        hook.open(); render().select(preset.templateId); render().select(original.templateId);
        await render().confirm();
        assert.deepEqual(commits.pop(), original, 'confirmation after a round trip preserves all original fields');
        assert.equal(writes, 0);
        render();
        hook.open();render().select(preset.templateId);await render().stagePreset(preset);render();
        fail = true; await hook.confirm();assert.equal(render().active,true);assert.match(hook.error,/确认失败/);assert.equal(commits.length,0);
        fail = false;await hook.confirm();assert.equal(render().active,false);assert.equal(commits.length,1);assert.equal(writes,1);
        hook.open();render().select(preset.templateId);options.canCommit=false;render();await hook.confirm();assert.equal(render().active,true);assert.equal(writes,1);hook.cancel();render();options.canCommit=true;
        hook.open();render().select(preset.templateId);options.enabled=false;assert.deepEqual(render().current,original);assert.equal(hook.active,false);
        options.enabled=true;render().open();render().select(preset.templateId);options.owner='a:2';assert.equal(render().active,false);assert.deepEqual(hook.current,original);
        hook.open();render().select(preset.templateId);await render().stagePreset(preset);render();delay=true;
        const pending=hook.confirm();render();assert.equal(hook.saving,true);options.owner='b:3';options.authUserKey='b';render();release();await pending;
        assert.equal(render().active,false);assert.equal(writes,1);assert.equal(commits.length,1);
    } finally {
        delete globalThis.__mobileHookReact;delete globalThis.__mobileHookStorage;delete globalThis.document;delete globalThis.HTMLElement;
    }
});
