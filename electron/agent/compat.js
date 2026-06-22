/**
 * 兼容垫片:把 project-service 暴露的能力再导出成 agent 模块需要的形状。
 */

const {
  ensureInsideRoot,
  isTextFile,
  listProjectFiles,
  readPackageScripts
} = require('../project-service');

async function readProjectScriptsSafe(root) {
  try {
    return await readPackageScripts(root);
  } catch {
    return {};
  }
}

module.exports = {
  ensureInsideRoot,
  isTextFile,
  listProjectFiles,
  readProjectScriptsSafe
};
