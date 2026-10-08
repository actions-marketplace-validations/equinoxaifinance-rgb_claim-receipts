import { test } from 'node:test';
import assert from 'node:assert/strict';
import { npmAdditions, requirementsAdditions, pyprojectAdditions, findAddedDependencies } from '../src/deps.mjs';

test('package.json: picks added dependencies, skips scripts and metadata', () => {
  const patch = [
    '@@ -1,12 +1,14 @@',
    ' {',
    '-  "version": "1.0.0",',
    '+  "version": "1.1.0",',
    '   "scripts": {',
    '+    "lint": "eslint .",',
    '+    "build": "1.2"',
    '   },',
    '   "dependencies": {',
    '+    "react-codeshift": "^1.0.0",',
    '+    "@acme/ui": "~2.3.0",',
    '+    "local": "file:../local",',
    '+    "aliased": "npm:lodash@^4",',
    '     "express": "^4.0.0"',
    '   }',
    ' }',
  ].join('\n');
  assert.deepEqual(npmAdditions(patch).map((d) => d.name), ['react-codeshift', '@acme/ui', 'lodash']);
});

test('package.json: hunk without block header still finds name: version lines', () => {
  const patch = '@@ -20,3 +20,4 @@\n     "chalk": "^5.0.0",\n+    "leftpadx": "^0.0.1",\n     "zod": "^3.0.0"';
  assert.deepEqual(npmAdditions(patch).map((d) => d.name), ['leftpadx']);
});

test('requirements.txt: names with and without versions, skips comments and urls', () => {
  const patch = '@@ -1 +1,6 @@\n requests==2.31\n+Flask_Login>=0.6  # auth\n+numpyy\n+# comment\n+-r base.txt\n+git+https://github.com/x/y.git';
  assert.deepEqual(requirementsAdditions(patch).map((d) => d.name), ['flask-login', 'numpyy']);
});

test('pyproject.toml: PEP 621 lists and Poetry tables', () => {
  const patch = [
    '@@ -1,10 +1,12 @@',
    ' [project]',
    ' dependencies = [',
    '+  "httpx>=0.27",',
    '   "pydantic",',
    ' ]',
    ' [tool.poetry.dependencies]',
    ' python = "^3.11"',
    '+huggingface-cli = "^0.1"',
    '+python = "^3.12"',
  ].join('\n');
  assert.deepEqual(pyprojectAdditions(patch).map((d) => d.name), ['httpx', 'huggingface-cli']);
});

test('findAddedDependencies: routes files by name and de-duplicates', () => {
  const files = [
    { filename: 'web/package.json', patch: '@@ -1 +1 @@\n+    "zod": "^3.0.0",' },
    { filename: 'api/package.json', patch: '@@ -1 +1 @@\n+    "zod": "^3.1.0",' },
    { filename: 'requirements-dev.txt', patch: '@@ -1 +1 @@\n+pytest' },
    { filename: 'node_modules/x/package.json', patch: '@@ -1 +1 @@\n+    "evil": "1.0.0",' },
    { filename: 'src/index.js', patch: '@@ -1 +1 @@\n+    "notadep": "1.0.0",' },
  ];
  assert.deepEqual(findAddedDependencies(files).map((d) => `${d.ecosystem}:${d.name}@${d.file}`), ['npm:zod@web/package.json', 'pypi:pytest@requirements-dev.txt']);
});
