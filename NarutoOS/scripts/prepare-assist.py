"""Build the bundled assist pack from the explicit per-module patch inventory."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import tempfile

from naruto_swf import decode_game_swf

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / '.test-artifacts/battle-memory-analysis/tools'
SPECS = [ROOT / 'flash-patches/huntlife-assist.json',
         ROOT / 'flash-patches/huntlife-assist-br.json']
MANIFEST_ID = 'naruto-assists-v1'


def main():
    parser = argparse.ArgumentParser(description='生成随应用提供的辅助脚本资源包')
    parser.add_argument('--base-swf', type=Path, help='国服原版 HuntLifePlugin.swf，允许游戏包装格式')
    parser.add_argument('--br-base-swf', type=Path, help='巴西服原版 HuntLifePlugin.swf，允许游戏包装格式')
    parser.add_argument('--update-asset', action='store_true', help='更新项目内置资源；不会打包应用')
    args = parser.parse_args()
    base_swfs = {}
    if args.base_swf:
        base_swfs['cn'] = decode_game_swf(args.base_swf.expanduser().resolve().read_bytes())
    if args.br_base_swf:
        base_swfs['br'] = decode_game_swf(args.br_base_swf.expanduser().resolve().read_bytes())
    receipts = []
    for spec_path in SPECS:
        spec = json.loads(spec_path.read_text(encoding='utf-8'))
        region = spec['region']
        base = base_swfs.get(region)
        if base is None:
            continue
        if hashlib.sha256(base).hexdigest() != spec['baseSha256']:
            raise SystemExit(f'基准 SWF 摘要不匹配（{region}）；拒绝对未知版本应用补丁')
        patch_directory = ROOT / 'flash-patches' / spec['patchDirectory']
        expected = set(spec['files'])
        actual = {p.relative_to(patch_directory).as_posix() for p in patch_directory.rglob('*.as')}
        if expected != actual:
            raise SystemExit(f'补丁源码清单不匹配（{region}）')
    java = TOOLS / 'jre/jdk-21.0.13+9-jre/Contents/Home/bin/java'
    jar = TOOLS / 'ffdec/ffdec.jar'
    if not java.is_file() or not jar.is_file():
        raise SystemExit(f'FFDec 工具未准备好: {TOOLS}')
    modules = []
    for spec_path in SPECS:
        spec = json.loads(spec_path.read_text(encoding='utf-8'))
        region = spec['region']
        base = base_swfs.get(region)
        if base is None:
            continue
        patch_directory = ROOT / 'flash-patches' / spec['patchDirectory']
        output_dir = ROOT / f".test-artifacts/assists-build-{spec['version']}"
        output_dir.mkdir(parents=True, exist_ok=True)
        # A fresh staging directory prevents old or unrelated sources entering a build.
        with tempfile.TemporaryDirectory(prefix='build-', dir=output_dir) as temporary:
            work = Path(temporary)
            original = work / 'original.swf'
            original.write_bytes(base)
            output = work / Path(spec['outputFile']).name
            result = subprocess.run([str(java), '-Djava.awt.headless=true', '-Duser.home=' + str(output_dir), '-jar', str(jar),
                                     '-importScript', str(original), str(output), str(patch_directory)],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            (output_dir / 'compile.log').write_text(result.stdout, encoding='utf-8')
            print(result.stdout[-2000:])
            if result.returncode or not output.is_file():
                raise SystemExit(result.returncode or 'FFDec 未生成输出 SWF')
            data = output.read_bytes()
            if data[:3] not in (b'FWS', b'CWS', b'ZWS') or data[3] == 0:
                raise SystemExit('输出不是标准 SWF')
            modules.append({
                'id': spec['id'],
                'nameKey': spec['nameKey'],
                'targets': [{
                    'region': spec['region'],
                    'build': spec['version'],
                    'url': spec['resourceURL'],
                    'file': spec['outputFile'],
                    'sha256': hashlib.sha256(data).hexdigest(),
                    'baseSha256': spec['baseSha256'],
                    'contentType': 'application/x-shockwave-flash',
                }],
            })
            # Publish only after a successful import; an earlier resource survives failure.
            destinations = [ROOT / '.test-artifacts/assists']
            if args.update_asset:
                destinations.append(ROOT / 'assets/assists')
            for destination in destinations:
                folder = destination / Path(spec['outputFile']).parent
                folder.mkdir(parents=True, exist_ok=True)
                temporary_swf = folder / (Path(spec['outputFile']).name + '.tmp')
                temporary_swf.write_bytes(data)
                temporary_swf.replace(folder / Path(spec['outputFile']).name)
            print(f"辅助资源: {ROOT / '.test-artifacts' / 'assists' / spec['outputFile']}")
            print(f"SHA256: {modules[-1]['targets'][0]['sha256']}")
    if not modules:
        raise SystemExit('未提供任何基准 SWF')
    for destination in ([ROOT / '.test-artifacts/assists'] + ([ROOT / 'assets/assists'] if args.update_asset else [])):
        manifest = destination / 'manifest.json.tmp'
        manifest.write_text(json.dumps({'id': MANIFEST_ID, 'version': 1, 'modules': modules},
                                       ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        manifest.replace(destination / 'manifest.json')

if __name__ == '__main__':
    main()
