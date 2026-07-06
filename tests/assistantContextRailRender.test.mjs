import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const sourcePath = join(rootDir, 'views/AIAssistant/AssistantContextRail.tsx');
const messageItemSourcePath = join(rootDir, 'views/AIAssistant/MessageItem.tsx');

const loadRailComponent = async () => {
  const tempDir = mkdtempSync(join(rootDir, 'tests/.tmp-assistant-context-rail-'));
  const outputPath = join(tempDir, 'AssistantContextRail.mjs');
  try {
    const source = readFileSync(sourcePath, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: sourcePath,
    });
    writeFileSync(outputPath, outputText);
    const module = await import(pathToFileURL(outputPath).href);
    return {
      AssistantContextRail: module.AssistantContextRail,
      cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
};

const loadMessageItemComponent = async () => {
  const tempDir = mkdtempSync(join(rootDir, 'tests/.tmp-assistant-message-item-'));
  const outputPath = join(tempDir, 'MessageItem.mjs');
  try {
    const source = readFileSync(messageItemSourcePath, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: messageItemSourcePath,
    });
    writeFileSync(outputPath, outputText);
    const module = await import(pathToFileURL(outputPath).href);
    return {
      MessageItem: module.MessageItem,
      cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
};

const selectedResumeWithExperience = {
  resumeId: 'resume-1',
  resumeName: 'AI产品实习生 - 嘉为科技',
  jdContext: 'B端产品助理',
  selection: { mode: 'all', experienceIds: ['resume-exp-1'] },
  snapshot: {
    experiences: [
      {
        id: 'resume-exp-1',
        org: '小挣攻城狮',
        title: '产品助理',
        star: {
          s: '负责业务逻辑建模',
          t: '梳理跨团队需求',
          a: '设计多级码关联架构',
          r: '支撑项目上线',
        },
      },
    ],
  },
};

const implicitSidebarResume = {
  ...selectedResumeWithExperience,
  contextSource: 'implicit_current_resume',
};

test('sidebar rail hides the resume card without rendering current-resume experience cards', async () => {
  const { AssistantContextRail, cleanup } = await loadRailComponent();
  try {
    const html = renderToStaticMarkup(
      React.createElement(AssistantContextRail, {
        attachments: [],
        selectedResume: selectedResumeWithExperience,
        hideSelectedResumeCard: true,
      }),
    );

    assert.equal(html, '');
    assert.doesNotMatch(html, /AI产品实习生 - 嘉为科技/);
    assert.doesNotMatch(html, /简历经历/);
    assert.doesNotMatch(html, /小挣攻城狮/);
  } finally {
    cleanup();
  }
});

test('full-page rail still renders the selected resume card', async () => {
  const { AssistantContextRail, cleanup } = await loadRailComponent();
  try {
    const html = renderToStaticMarkup(
      React.createElement(AssistantContextRail, {
        attachments: [],
        selectedResume: selectedResumeWithExperience,
        hideSelectedResumeCard: false,
      }),
    );

    assert.match(html, /简历/);
    assert.match(html, /AI产品实习生 - 嘉为科技/);
    assert.match(html, /已关联 JD/);
    assert.match(html, /全部 1 段经历/);
    assert.doesNotMatch(html, /简历经历/);
  } finally {
    cleanup();
  }
});

test('sidebar user messages hide implicit current-resume cards but keep explicit resume cards', async () => {
  const { MessageItem, cleanup } = await loadMessageItemComponent();
  try {
    const implicitHtml = renderToStaticMarkup(
      React.createElement(MessageItem, {
        isUser: true,
        content: '帮我优化这段经历',
        selectedResume: implicitSidebarResume,
        hideSelectedResumeCard: true,
      }),
    );
    const explicitHtml = renderToStaticMarkup(
      React.createElement(MessageItem, {
        isUser: true,
        content: '帮我优化这段经历',
        selectedResume: selectedResumeWithExperience,
        hideSelectedResumeCard: true,
      }),
    );

    assert.doesNotMatch(implicitHtml, /AI产品实习生 - 嘉为科技/);
    assert.doesNotMatch(implicitHtml, /简历/);
    assert.match(explicitHtml, /AI产品实习生 - 嘉为科技/);
    assert.match(explicitHtml, /简历/);
  } finally {
    cleanup();
  }
});

test('sidebar conversation viewport passes the implicit-resume hiding flag to message items', () => {
  const source = readFileSync(join(rootDir, 'views/AIAssistant/AssistantConversationViewport.tsx'), 'utf8');

  assert.match(
    source,
    /hideSelectedResumeCard=\{isSidebarSurface\}/,
    'sidebar conversation messages should hide implicit default resume cards',
  );
});
