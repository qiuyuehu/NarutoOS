import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import electron from 'electron';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.NARUTO_DATA_DIR ??= path.join(root, '.dev-data');
if (env.NARUTO_TEST_MODE === '1' && !path.resolve(env.NARUTO_DATA_DIR).startsWith(path.join(root, '.test-artifacts') + path.sep)) {
  throw new Error('集成测试只能使用本项目 .test-artifacts/ 下的隔离数据目录');
}
const child = spawn(electron, [root, ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' });
child.on('error', () => { console.error('无法启动 Electron，请检查 x64 运行时和 Rosetta。'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
