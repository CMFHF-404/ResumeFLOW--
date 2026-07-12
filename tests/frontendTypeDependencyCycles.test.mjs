import assert from 'node:assert/strict';
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const sourceRoots = ['views', 'components', 'hooks', 'services', 'utils', 'types', 'constants'];
const rootEntries = ['App.tsx', 'index.tsx', 'types.ts'];

const collectTypeScriptFiles = () => {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
        files.push(path.resolve(absolutePath));
      }
    }
  };

  for (const sourceRoot of sourceRoots) {
    const absoluteRoot = path.join(rootDir, sourceRoot);
    if (existsSync(absoluteRoot)) {
      walk(absoluteRoot);
    }
  }
  for (const entry of rootEntries) {
    const absolutePath = path.join(rootDir, entry);
    if (existsSync(absolutePath)) {
      files.push(path.resolve(absolutePath));
    }
  }
  return [...new Set(files)];
};

const resolveRelativeImport = (fromFile, specifier, knownFiles) => {
  if (!specifier.startsWith('.')) {
    return null;
  }
  const unresolved = path.resolve(path.dirname(fromFile), specifier);
  const withoutJavaScriptExtension = unresolved.replace(/\.(?:mjs|cjs|js|jsx)$/, '');
  const candidates = [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    `${withoutJavaScriptExtension}.ts`,
    `${withoutJavaScriptExtension}.tsx`,
    path.join(unresolved, 'index.ts'),
    path.join(unresolved, 'index.tsx'),
  ];
  return candidates.find((candidate) => knownFiles.has(path.normalize(candidate))) ?? null;
};

const collectModuleSpecifiers = (sourceFile) => {
  const specifiers = [];
  const addStringLiteral = (node) => {
    if (node && ts.isStringLiteralLike(node)) {
      specifiers.push(node.text);
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
    ) {
      addStringLiteral(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      addStringLiteral(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      addStringLiteral(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
};

const buildDependencyGraph = () => {
  const files = collectTypeScriptFiles();
  const knownFiles = new Set(files.map((file) => path.normalize(file)));
  const graph = new Map();

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const dependencies = collectModuleSpecifiers(sourceFile)
      .map((specifier) => resolveRelativeImport(file, specifier, knownFiles))
      .filter(Boolean);
    graph.set(path.normalize(file), [...new Set(dependencies)]);
  }
  return graph;
};

const findCycles = (graph) => {
  let nextIndex = 0;
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];

  const visit = (node) => {
    indexes.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
      if (!indexes.has(dependency)) {
        visit(dependency);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(dependency)));
      } else if (onStack.has(dependency)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indexes.get(dependency)));
      }
    }

    if (lowLinks.get(node) !== indexes.get(node)) {
      return;
    }
    const component = [];
    while (stack.length > 0) {
      const member = stack.pop();
      onStack.delete(member);
      component.push(member);
      if (member === node) {
        break;
      }
    }
    if (component.length > 1 || (graph.get(node) ?? []).includes(node)) {
      cycles.push(component);
    }
  };

  for (const node of graph.keys()) {
    if (!indexes.has(node)) {
      visit(node);
    }
  }
  return cycles;
};

const relative = (file) => path.relative(rootDir, file).replaceAll('\\', '/');

test('frontend relative TypeScript dependencies remain acyclic', () => {
  const graph = buildDependencyGraph();
  const cycles = findCycles(graph).map((component) => component.map(relative).sort());

  assert.deepEqual(cycles, []);
});

test('shared AI contracts remain a leaf within the types layer', () => {
  const graph = buildDependencyGraph();
  const aiContractsPath = path.normalize(path.join(rootDir, 'types', 'ai.ts'));
  const outsideTypesLayer = (graph.get(aiContractsPath) ?? [])
    .filter((dependency) => !dependency.startsWith(path.join(rootDir, 'types') + path.sep))
    .map(relative);

  assert.deepEqual(outsideTypesLayer, []);
});

test('shared frontend layers do not depend on the experience view compatibility facade', () => {
  const graph = buildDependencyGraph();
  const sharedLayerRoots = ['components', 'hooks', 'services', 'utils']
    .map((directory) => path.join(rootDir, directory) + path.sep);
  const experienceFacadePath = path.normalize(path.join(rootDir, 'views', 'experienceUtils.ts'));
  const offenders = [...graph.entries()]
    .filter(([file, dependencies]) => (
      sharedLayerRoots.some((directory) => file.startsWith(directory))
      && dependencies.includes(experienceFacadePath)
    ))
    .map(([file]) => relative(file))
    .sort();

  assert.deepEqual(offenders, []);
});
