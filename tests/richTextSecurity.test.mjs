import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const resolveChromiumExecutable = () => {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : undefined,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined,
    process.platform === 'linux' ? '/usr/bin/google-chrome' : undefined,
    process.platform === 'linux' ? '/usr/bin/chromium' : undefined,
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
};

test('rich text sanitizer parses attacker markup in an inert template', () => {
  const source = readFileSync('utils/richText.ts', 'utf8');
  const sanitizer = source.match(
    /export const sanitizeRichTextHtml = \(input: string\) => \{[\s\S]*?\n\};/
  )?.[0] ?? '';

  assert.match(sanitizer, /document\.createElement\('template'\)/);
  assert.match(sanitizer, /template\.innerHTML = normalized/);
  assert.match(sanitizer, /template\.content\.childNodes/);
  assert.doesNotMatch(sanitizer, /document\.createElement\('div'\);\s*\n\s*container\.innerHTML = normalized/);
});

const chromiumExecutable = resolveChromiumExecutable();

const buildRichTextEditorHarness = async () => {
  const result = await build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import RichTextEditor from './components/RichTextEditor.tsx';

        window.__richTextChanges = [];
        const root = createRoot(document.getElementById('root'));
        root.render(React.createElement(RichTextEditor, {
          value: 'X',
          onChange: (value) => window.__richTextChanges.push(value),
          ariaLabel: 'security editor',
          enableList: false,
        }));
      `,
      resolveDir: process.cwd(),
      sourcefile: 'rich-text-security-harness.tsx',
      loader: 'tsx',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
  });
  return result.outputFiles[0].text;
};

test('new-link interaction never exposes URL text to a live HTML parser', {
  skip: chromiumExecutable ? false : 'No Chromium executable is available for the DOM security probe',
}, async () => {
  const harness = await buildRichTextEditorHarness();
  const browser = await chromium.launch({
    executablePath: chromiumExecutable,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: harness });
    const editor = page.getByRole('textbox', { name: 'security editor' });
    await editor.waitFor();

    await page.evaluate(() => {
      window.__unsafeNodeReachedLiveDom = false;
      const nativeExecCommand = document.execCommand.bind(document);
      document.execCommand = (command, showUi, value) => {
        if (command === 'insertHTML') {
          const applied = nativeExecCommand(command, showUi, value);
          window.__unsafeNodeReachedLiveDom = Boolean(
            document.querySelector('[contenteditable="true"] img[onerror]')
          );
          return applied;
        }
        return nativeExecCommand(command, showUi, value);
      };

      const editable = document.querySelector('[contenteditable="true"]');
      const text = editable?.firstChild;
      if (!editable || !text) {
        throw new Error('Rich-text editor did not render its initial text');
      }
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });

    await page.getByRole('button', { name: '超链接' }).evaluate((button) => button.click());
    await page.evaluate(() => {
      const editable = document.querySelector('[contenteditable="true"]');
      editable.firstChild.data = '';
    });
    await page.getByPlaceholder('请输入链接地址').evaluate((input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, 'safe.example/\"><img src=x onerror=window.__richTextLinkXss=1>');
    await page.getByRole('button', { name: '应用' }).evaluate((button) => button.click());

    const result = await page.evaluate(() => {
      const editable = document.querySelector('[contenteditable="true"]');
      const selection = window.getSelection();
      return {
        anchorHref: editable.querySelector('a')?.getAttribute('href') ?? '',
        anchorText: editable.querySelector('a')?.textContent ?? '',
        changeCount: window.__richTextChanges.length,
        dangerousElementCount: editable.querySelectorAll('img, script, svg, [onerror], [onload]').length,
        html: editable.innerHTML,
        selectionCollapsed: selection?.isCollapsed ?? false,
        unsafeNodeReachedLiveDom: window.__unsafeNodeReachedLiveDom,
      };
    });

    assert.equal(result.unsafeNodeReachedLiveDom, false);
    assert.equal(result.anchorText, 'X');
    assert.equal(result.changeCount, 1);
    assert.equal(result.dangerousElementCount, 0);
    assert.equal(result.selectionCollapsed, true);
    assert.doesNotMatch(result.html, /<img(?:\s|>)/i);
    assert.match(result.anchorHref, /^https:\/\/safe\.example\//);

    await editor.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    const htmlAfterUndo = await editor.evaluate((element) => element.innerHTML);
    assert.equal(htmlAfterUndo, '', 'the native editor undo must remove a newly inserted collapsed link');
    assert.equal(
      await page.evaluate(() => window.__richTextChanges.at(-1) ?? null),
      '',
      'undo should publish the restored content through onChange'
    );
  } finally {
    await browser.close();
  }
});

test('selected-text link keeps its content, selection, callback, and native undo behavior', {
  skip: chromiumExecutable ? false : 'No Chromium executable is available for the DOM security probe',
}, async () => {
  const harness = await buildRichTextEditorHarness();
  const browser = await chromium.launch({
    executablePath: chromiumExecutable,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: harness });
    const editor = page.getByRole('textbox', { name: 'security editor' });
    await editor.waitFor();
    await page.evaluate(() => {
      const editable = document.querySelector('[contenteditable="true"]');
      const range = document.createRange();
      range.selectNodeContents(editable.firstChild);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });

    await page.getByRole('button', { name: '超链接' }).evaluate((button) => button.click());
    const setInputValue = async (placeholder, value) => {
      await page.getByPlaceholder(placeholder).evaluate((input, nextValue) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter.call(input, nextValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
    };
    await setInputValue('请输入链接地址', 'https://safe.example/path');
    await setInputValue('请输入链接文字（可选）', 'replacement text');
    await page.getByRole('button', { name: '应用' }).evaluate((button) => button.click());

    const result = await page.evaluate(() => {
      const editable = document.querySelector('[contenteditable="true"]');
      return {
        anchorText: editable.querySelector('a')?.textContent ?? '',
        changeCount: window.__richTextChanges.length,
        latestChange: window.__richTextChanges.at(-1) ?? '',
        selectedText: window.getSelection()?.toString() ?? '',
      };
    });
    assert.equal(result.anchorText, 'X');
    assert.ok(result.changeCount >= 1);
    assert.match(result.latestChange, /<a href="https:\/\/safe\.example\/path"/);
    assert.equal(result.selectedText, 'X');

    await editor.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    assert.equal(await editor.evaluate((element) => element.innerHTML), 'X');
    assert.equal(
      await page.evaluate(() => window.__richTextChanges.at(-1) ?? null),
      'X',
      'selected-link undo should publish the unlinked text through onChange'
    );
  } finally {
    await browser.close();
  }
});

test('rich text sanitizer blocks browser XSS bypass payloads before and after output parsing', {
  skip: chromiumExecutable ? false : 'No Chromium executable is available for the DOM security probe',
}, async () => {
  const bundle = await build({
    entryPoints: ['utils/richText.ts'],
    bundle: true,
    format: 'iife',
    globalName: 'RichTextBundle',
    platform: 'browser',
    write: false,
  });
  const browser = await chromium.launch({
    executablePath: chromiumExecutable,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    const requestedUrls = [];
    await page.route('**/*', async (route) => {
      requestedUrls.push(route.request().url());
      await route.abort();
    });
    await page.setContent('<div id="sink"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });

    const payloads = [
      ['script', '<script>window.__richTextXss=1</script><b>ok</b>'],
      ['event-handler', '<img src=x onerror="window.__richTextXss=2"><strong onclick="window.__richTextXss=22">ok</strong>'],
      ['javascript-url', '<a href="javascript:window.__richTextXss=3">x</a>'],
      ['entity-obfuscated-url', '<a href="jav&#x0D;ascript:window.__richTextXss=4">x</a>'],
      ['data-url', '<a href="data:text/html,<script>window.__richTextXss=5</script>">x</a>'],
      ['svg', '<svg onload="window.__richTextXss=6"><a xlink:href="javascript:window.__richTextXss=61">x</a></svg>'],
      ['svg-foreign-object', '<svg><foreignObject><img src=x onerror="window.__richTextXss=7"></foreignObject></svg>'],
      ['style-url', '<p style="background:url(javascript:window.__richTextXss=8);font-weight:700" onclick="window.__richTextXss=81">styled</p>'],
      ['encoded-tag', '&lt;img src=x onerror=window.__richTextXss=9&gt;'],
      ['double-encoded-tag', '&amp;lt;img src=x onerror=window.__richTextXss=10&amp;gt;'],
      ['malformed-tag', '<scr<script>ipt>window.__richTextXss=11</scr</script>ipt><i>ok</i>'],
      ['mutation-xss', '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=window.__richTextXss=12>">'],
      ['unclosed-tag', '<a href="javascript:window.__richTextXss=13"><b>bad'],
      ['allowed-link-extra-attrs', '<a href="https://safe.example/path" onclick="window.__richTextXss=14" style="font-weight:700;background:url(javascript:foo)">ok</a>'],
      ['markdown-attribute-breakout', '[x](https://safe.example/" onmouseover="window.__richTextXss=15)'],
      ['numeric-entity-tag', '&#60;script&#62;window.__richTextXss=16&#60;/script&#62;'],
    ];

    const results = await page.evaluate(async (matrix) => {
      const allowedTags = new Set(['A', 'B', 'BR', 'I', 'LI', 'OL', 'U', 'UL']);
      const allowedProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:']);
      const output = [];

      for (const [name, input] of matrix) {
        window.__richTextXss = 0;
        const sanitized = window.RichTextBundle.sanitizeRichTextHtml(input);
        const sink = document.getElementById('sink');
        sink.replaceChildren();
        sink.innerHTML = sanitized;
        await new Promise((resolve) => setTimeout(resolve, 25));

        const elements = [...sink.querySelectorAll('*')];
        const forbiddenTags = elements
          .map((element) => element.tagName)
          .filter((tagName) => !allowedTags.has(tagName));
        const forbiddenAttributes = elements.flatMap((element) => (
          [...element.attributes]
            .filter((attribute) => (
              element.tagName !== 'A'
              || !['href', 'rel', 'target'].includes(attribute.name.toLowerCase())
            ))
            .map((attribute) => `${element.tagName}:${attribute.name}`)
        ));
        const unsafeHrefs = elements
          .filter((element) => element.tagName === 'A')
          .map((element) => element.getAttribute('href') ?? '')
          .filter((href) => !allowedProtocols.has(new URL(href, 'https://fallback.local').protocol));

        output.push({
          name,
          forbiddenAttributes,
          forbiddenTags,
          html: sink.innerHTML,
          unsafeHrefs,
          xssMarker: window.__richTextXss,
        });
      }

      return output;
    }, payloads);

    assert.deepEqual(
      results.filter((result) => (
        result.xssMarker !== 0
        || result.forbiddenAttributes.length > 0
        || result.forbiddenTags.length > 0
        || result.unsafeHrefs.length > 0
      )),
      []
    );
    assert.deepEqual(requestedUrls, []);
    assert.match(
      results.find((result) => result.name === 'allowed-link-extra-attrs')?.html ?? '',
      /^<b><a href="https:\/\/safe\.example\/path" target="_blank" rel="noreferrer">ok<\/a><\/b>$/
    );
  } finally {
    await browser.close();
  }
});
