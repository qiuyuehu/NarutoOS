"""Build one activity plugin from the explicit, per-activity patch inventory."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile

from naruto_swf import decode_game_swf

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / '.test-artifacts/battle-memory-analysis/tools'


def main():
    parser = argparse.ArgumentParser(description='合并达摩与忍术训练等活动辅助补丁')
    parser.add_argument('--base-swf', type=Path, required=True, help='固定版本原版 SWF，允许游戏包装格式')
    parser.add_argument('--package-asset', '--update-asset', dest='update_asset', action='store_true', help='更新项目内置资源；不会打包应用')
    args = parser.parse_args()
    spec = json.loads((ROOT / 'flash-patches/activity-assist.json').read_text())
    base = decode_game_swf(args.base_swf.expanduser().resolve().read_bytes())
    if hashlib.sha256(base).hexdigest() != spec['baseSha256']:
        raise SystemExit('基准 SWF 摘要不匹配；拒绝对未知版本应用补丁')
    java = TOOLS / 'jre/jdk-21.0.13+9-jre/Contents/Home/bin/java'
    jar = TOOLS / 'ffdec/ffdec.jar'
    if not java.is_file() or not jar.is_file():
        raise SystemExit(f'FFDec 工具未准备好: {TOOLS}')
    output_dir = ROOT / f".test-artifacts/activity-assist-{spec['version']}"
    output_dir.mkdir(parents=True, exist_ok=True)
    # A fresh staging directory prevents old or unrelated .as files entering a build.
    with tempfile.TemporaryDirectory(prefix='build-', dir=output_dir) as temporary:
        work = Path(temporary)
        merged = work / 'scripts'
        seen = set()
        for patch in spec['patches']:
            directory = ROOT / 'flash-patches' / patch['directory']
            expected = set(patch['files'])
            actual = {p.relative_to(directory).as_posix() for p in directory.rglob('*.as')}
            if expected != actual or len(expected) != len(patch['files']) or seen & expected:
                raise SystemExit(f"补丁源码清单不匹配或重复: {patch['id']}")
            seen.update(expected)
            for relative in sorted(expected):
                target = merged / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(directory / relative, target)
        original = work / 'original.swf'
        original.write_bytes(base)
        output = work / spec['outputFile']
        result = subprocess.run([str(java), '-Djava.awt.headless=true', '-jar', str(jar),
                                 '-importScript', str(original), str(output), str(merged)],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        (output_dir / 'compile.log').write_text(result.stdout)
        print(result.stdout[-4000:])
        if result.returncode or not output.is_file():
            raise SystemExit(result.returncode or 'FFDec 未生成输出 SWF')
        data = output.read_bytes()
        if data[:3] not in (b'FWS', b'CWS', b'ZWS') or data[3] == 0:
            raise SystemExit('输出不是标准 SWF')
        receipt = {'id': 'naruto-activity-assist-v1', 'version': spec['version'],
                   'resourceURL': spec['resourceURL'], 'baseSha256': spec['baseSha256'],
                   'file': spec['outputFile'], 'patchedSha256': hashlib.sha256(data).hexdigest(),
                   'patches': spec['patches']}
        localized_data = None
        localization_only_data = None
        if spec.get('localizationPatches'):
            localized_sources = work / 'localized-scripts'
            for patch in spec['localizationPatches']:
                directory = ROOT / 'flash-patches' / patch['directory']
                expected = set(patch['files'])
                actual = {p.relative_to(directory).as_posix() for p in directory.rglob('*.as')}
                if actual != expected or len(expected) != len(patch['files']) or seen & expected:
                    raise SystemExit(f"汉化补丁源码清单不匹配或重复: {patch['id']}")
                seen.update(expected)
                for relative in sorted(expected):
                    target = localized_sources / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(directory / relative, target)
            localized_file = spec['outputFile'].replace('.swf', '.zh-CN.swf')
            localized_output = work / localized_file
            result = subprocess.run([str(java), '-Djava.awt.headless=true', '-jar', str(jar),
                                     '-importScript', str(output), str(localized_output), str(localized_sources)],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            (output_dir / 'compile-localized.log').write_text(result.stdout)
            print(result.stdout[-4000:])
            if result.returncode or not localized_output.is_file():
                raise SystemExit(result.returncode or 'FFDec 未生成汉化活动插件')
            localized_data = localized_output.read_bytes()
            receipt.update(localizedFile=localized_file,
                           localizedSha256=hashlib.sha256(localized_data).hexdigest(),
                           localizationPatches=spec['localizationPatches'])
            # Translation without any assist code: the assist switch must never cancel
            # the activity translation, and a combined file cannot stand in for it.
            localization_only_file = spec['outputFile'].replace('.swf', '.zh-CN-only.swf')
            localization_only_output = work / localization_only_file
            result = subprocess.run([str(java), '-Djava.awt.headless=true', '-jar', str(jar),
                                     '-importScript', str(original), str(localization_only_output), str(localized_sources)],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            (output_dir / 'compile-localization-only.log').write_text(result.stdout)
            print(result.stdout[-4000:])
            if result.returncode or not localization_only_output.is_file():
                raise SystemExit(result.returncode or 'FFDec 未生成仅汉化活动插件')
            localization_only_data = localization_only_output.read_bytes()
            receipt.update(localizationOnlyFile=localization_only_file,
                           localizationOnlySha256=hashlib.sha256(localization_only_data).hexdigest())
        # Publish only after successful import; existing resources survive failed builds.
        destinations = [output_dir]
        if args.update_asset:
            destinations.append(ROOT / f"assets/activity-assist-{spec['version']}")
        for destination in destinations:
            destination.mkdir(parents=True, exist_ok=True)
            temporary_swf = destination / (spec['outputFile'] + '.tmp')
            temporary_swf.write_bytes(data)
            temporary_swf.replace(destination / spec['outputFile'])
            if localized_data is not None:
                localized_temp = destination / (localized_file + '.tmp')
                localized_temp.write_bytes(localized_data)
                localized_temp.replace(destination / localized_file)
            if localization_only_data is not None:
                only_temp = destination / (localization_only_file + '.tmp')
                only_temp.write_bytes(localization_only_data)
                only_temp.replace(destination / localization_only_file)
            manifest = destination / 'manifest.json.tmp'
            manifest.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
            manifest.replace(destination / 'manifest.json')
        print(f"统一活动辅助: {output_dir / spec['outputFile']}")
        print(f"SHA256: {receipt['patchedSha256']}")


if __name__ == '__main__':
    main()
