const assert = require('node:assert/strict');
const test = require('node:test');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  createProject,
  ensureInsideRoot,
  listProjectFiles,
  readPackageScripts,
  readProjectFile,
  readProjectMemory,
  runProjectScript,
  saveProjectMemory,
  writeProjectFile
} = require('../electron/project-service');

test('project service creates, edits, lists and tests a project', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-project-'));
  const root = await createProject(tempRoot, 'demo-app');

  const files = await listProjectFiles(root);
  assert.ok(files.some(file => file.path === 'package.json'));
  assert.ok(files.some(file => file.path === 'src/index.js'));
  assert.ok(files.some(file => file.path === 'tests/index.test.js'));

  const scripts = await readPackageScripts(root);
  assert.equal(scripts.test, 'node --test tests/*.test.js');

  const indexContent = await readProjectFile(root, 'src/index.js');
  assert.match(indexContent, /export function greet/);

  await writeProjectFile(root, 'src/feature.js', 'export const feature = true;\n');
  const featureContent = await readProjectFile(root, 'src/feature.js');
  assert.equal(featureContent, 'export const feature = true;\n');

  await saveProjectMemory(root, 'Use node:test and keep code simple.\n');
  const memory = await readProjectMemory(root);
  assert.match(memory, /node:test/);

  const testResult = await runProjectScript(root, 'test');
  assert.equal(testResult.success, true, testResult.output);
});

test('project service blocks paths outside root', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-project-safe-'));

  assert.throws(
    () => ensureInsideRoot(tempRoot, '../escape.txt'),
    /不在当前项目目录内/
  );
});
