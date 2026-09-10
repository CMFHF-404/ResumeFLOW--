import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('App scopes the stable viewport to the editor and keeps safe space below the preview', () => {
  assert.match(read('App.tsx'), /<AppViewport key=\{viewScopeKey\} isEditor=\{currentView === ViewState\.EDITOR\}>/);
  assert.match(read('views/ResumeEditor/components/ResumeEditorPreviewStage.tsx'), /pb-\[calc\(5rem\+env\(safe-area-inset-bottom,0px\)\)\]/);
});

test('ResumeEditor delegates mobile drawer shell to ResumeEditorMobileDrawer', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const drawer = read('views/ResumeEditor/components/ResumeEditorMobileDrawer.tsx');
  const drawerHook = read('views/ResumeEditor/hooks/useMobileEditorDrawer.ts');
  const viewport = read('views/ResumeEditor/components/ResumeEditorViewport.tsx');

  assert.match(editor, /ResumeEditorMobileDrawer/);
  assert.match(editor, /isOpen=\{mobileEditorDrawer\.isOpen\}/);
  assert.match(editor, /isVisible=\{mobileEditorDrawer\.isVisible\}/);
  assert.match(editor, /mobileEditorDrawer\.open\(target\)/);
  assert.match(editor, /onClose=\{mobileEditorDrawer\.close\}/);
  assert.match(editor, /sidebarProps=\{commonEditorSidebarProps\}/);
  assert.match(editor, /<ResumeEditorMobileDrawer\b[^>]*busy=\{isEditorBusy\}/);
  assert.match(editor, /scrollContainerRef=\{mobileEditorScrollContainerRef\}/);
  assert.match(viewport, /data-rf-mobile-editor-scroll-root/);
  assert.match(viewport, /\[scrollbar-gutter:stable\]/);
  assert.doesNotMatch(editor, /关闭经历库抽屉遮罩/);
  assert.doesNotMatch(editor, /layoutMode="drawer"/);

  assert.match(drawer, /type ResumeEditorMobileDrawerProps/);
  assert.match(drawer, /sidebarProps: Omit<EditorSidebarProps, 'layoutMode' \| 'showJDPanel'>/);
  assert.match(drawer, /onClick=\{\(\) => onOpen\(\)\}/);
  assert.match(drawer, /onClick=\{onClose\}/);
  assert.match(drawer, /aria-label="收起工作台"/);
  assert.match(drawer, /工作台/);
  assert.match(drawer, /duration-200/);
  assert.match(drawer, /visibility: active \? 'visible' : 'hidden'/);
  assert.doesNotMatch(drawer, /hidden=\{!active\}/);
  assert.doesNotMatch(drawer, /backdrop-blur-\[1px\]/);
  assert.match(drawer, /isVisible \? 'translate-y-0' : 'translate-y-full'/);
  assert.match(drawer, /layoutMode="drawer"/);
  assert.match(drawer, /showJDPanel=\{false\}/);

  assert.match(drawerHook, /scrollContainer\.style\.overflow = 'hidden'/);
  assert.doesNotMatch(drawerHook, /document\.body\.style\.overflow/);
  assert.match(drawerHook, /const cancelOpenFrameRef = useRef<\(\(\) => void\) \| null>\(null\)/);
  const clearOpenFrame = drawerHook.match(
    /const clearOpenFrame = useCallback\(\(\) => \{[\s\S]*?\}, \[\]\);/,
  )?.[0] ?? '';
  assert.match(clearOpenFrame, /cancelOpenFrameRef\.current\?\.\(\)/);
  assert.match(clearOpenFrame, /cancelOpenFrameRef\.current = null/);
  assert.match(drawerHook, /cancelOpenFrameRef\.current = waitForNextFrame/);
  assert.match(drawerHook, /const dismissImmediately = useCallback\(\(\) => \{[\s\S]*?clearOpenFrame\(\);[\s\S]*?setIsOpen\(false\)/);
  assert.match(drawerHook, /const close = useCallback\(\(\) => \{[\s\S]*?clearOpenFrame\(\);[\s\S]*?window\.setTimeout/);
  assert.match(drawerHook, /return \(\) => \{[\s\S]*?clearDrawerTimer\(\);[\s\S]*?clearOpenFrame\(\);[\s\S]*?\};/);
});
