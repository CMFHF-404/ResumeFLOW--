import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('ResumeEditor delegates mobile drawer shell to ResumeEditorMobileDrawer', () => {
  const editor = read('views/ResumeEditor/index.tsx');
  const drawer = read('views/ResumeEditor/components/ResumeEditorMobileDrawer.tsx');

  assert.match(editor, /ResumeEditorMobileDrawer/);
  assert.match(editor, /isOpen=\{mobileEditorDrawer\.isOpen\}/);
  assert.match(editor, /isVisible=\{mobileEditorDrawer\.isVisible\}/);
  assert.match(editor, /onOpen=\{mobileEditorDrawer\.open\}/);
  assert.match(editor, /onClose=\{mobileEditorDrawer\.close\}/);
  assert.match(editor, /sidebarProps=\{commonEditorSidebarProps\}/);
  assert.doesNotMatch(editor, /关闭经历库抽屉遮罩/);
  assert.doesNotMatch(editor, /layoutMode="drawer"/);

  assert.match(drawer, /type ResumeEditorMobileDrawerProps/);
  assert.match(drawer, /sidebarProps: Omit<EditorSidebarProps, 'layoutMode' \| 'showJDPanel'>/);
  assert.match(drawer, /onClick=\{onOpen\}/);
  assert.match(drawer, /onClick=\{onClose\}/);
  assert.match(drawer, /aria-label="关闭经历库抽屉遮罩"/);
  assert.match(drawer, /经历库/);
  assert.match(drawer, /duration-\[320ms\]/);
  assert.match(drawer, /isVisible \? 'bg-black\/35 opacity-100 backdrop-blur-\[1px\]' : 'bg-black\/0 opacity-0'/);
  assert.match(drawer, /isVisible \? 'translate-y-0' : 'translate-y-full'/);
  assert.match(drawer, /layoutMode="drawer"/);
  assert.match(drawer, /showJDPanel=\{false\}/);
});
