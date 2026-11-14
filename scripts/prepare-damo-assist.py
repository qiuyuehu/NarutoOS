from pathlib import Path
import argparse
import hashlib
import subprocess

ROOT = Path(__file__).resolve().parent.parent
PATCHES = ROOT / 'flash-patches/damo-yuandanji-9.39Build301'
TOOLS = ROOT / '.test-artifacts/battle-memory-analysis/tools'
BASE_SHA256 = '43ddf0dafa8bfb8be1bcf6e83b144bba0847ba4b149c067a60db996b6b86656e'
EXPECTED = {
    'com/tencent/morefun/naruto/plugin/operatingActivity/activitys/yuanDanJi/pageView/DaMoPage.as',
    'com/tencent/morefun/naruto/plugin/operatingActivity/activitys/yuanDanJi/pageView/daMo/DaMoGame.as',
}

parser = argparse.ArgumentParser(description='将达摩 AS3 辅助补丁导入固定版本的活动插件 SWF')
parser.add_argument('--base-swf', type=Path, required=True, help='9.39Build301 原始 OperatingActivityPlugin.swf')
parser.add_argument('--package-asset', action='store_true', help='同时更新安装包使用的校验版 SWF 资源')
args = parser.parse_args()

base = args.base_swf.expanduser().resolve()
if not base.is_file():
    raise SystemExit(f'找不到基准 SWF: {base}')
if hashlib.sha256(base.read_bytes()).hexdigest() != BASE_SHA256:
    raise SystemExit('基准 SWF 摘要不匹配；请使用已验证的 9.39Build301 原版插件')
actual = {str(file.relative_to(PATCHES)) for file in PATCHES.rglob('*.as')}
if actual != EXPECTED:
    raise SystemExit(f'补丁源码清单不匹配: {sorted(actual)}')

output_dir = ROOT / '.test-artifacts/damo-assist-9.39Build301'
output_dir.mkdir(parents=True, exist_ok=True)
output = output_dir / 'OperatingActivityPlugin.damo-assist.swf'
java = TOOLS / 'jre/jdk-21.0.13+9-jre/Contents/Home/bin/java'
ffdec = TOOLS / 'ffdec/ffdec.jar'
if not java.is_file() or not ffdec.is_file():
    raise SystemExit(f'FFDec 工具未准备好: {TOOLS}')

result = subprocess.run([
    str(java), '-Djava.awt.headless=true', '-jar', str(ffdec),
    '-importScript', str(base), str(output), str(PATCHES),
], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
print(result.stdout[-4000:])
if result.returncode != 0 or not output.is_file():
    raise SystemExit(result.returncode or 'FFDec 未生成输出 SWF')
digest = hashlib.sha256(output.read_bytes()).hexdigest()
print(f'达摩辅助 SWF: {output}')
print(f'SHA256: {digest}')
if args.package_asset:
    package_asset = ROOT / 'assets/damo-assist-9.39Build301/OperatingActivityPlugin.damo-assist.swf'
    package_asset.parent.mkdir(parents=True, exist_ok=True)
    package_asset.write_bytes(output.read_bytes())
    print(f'安装包资源已更新: {package_asset}')
