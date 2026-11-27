"""Build and update the bundled assist pack from explicit patch inventories."""
import argparse
from contextlib import ExitStack
import fcntl
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlsplit

from naruto_swf import decode_game_swf

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / '.test-artifacts/battle-memory-analysis/tools'
SPECS = [ROOT / 'flash-patches/huntlife-assist.json',
         ROOT / 'flash-patches/huntlife-assist-br.json']
MANIFEST_ID = 'naruto-assists-v1'


def make_target(region, build, url, file, base_sha256, data):
    resource_url = urlsplit(url)
    if region not in ('cn', 'br') or not re.fullmatch(r'[A-Za-z0-9._-]{1,64}', build):
        raise SystemExit(f'辅助资源区服或构建标识无效（{file}）')
    if resource_url.scheme not in ('http', 'https') or not resource_url.hostname or resource_url.username is not None:
        raise SystemExit(f'辅助资源 URL 无效（{file}）')
    if not re.fullmatch(r'[a-f0-9]{64}', base_sha256):
        raise SystemExit(f'基准 SWF 摘要无效（{file}）')
    if len(data) < 8 or data[:3] not in (b'FWS', b'CWS', b'ZWS') or data[3] == 0:
        raise SystemExit(f'输出不是标准 SWF（{file}）')
    return {
        'region': region,
        'build': build,
        'url': url,
        'file': file,
        'sha256': hashlib.sha256(data).hexdigest(),
        'baseSha256': base_sha256,
        'contentType': 'application/x-shockwave-flash',
    }


def build_huntlife(base_swfs):
    selected = []
    for spec_path in SPECS:
        spec = json.loads(spec_path.read_text(encoding='utf-8'))
        region = spec['region']
        base_path = base_swfs.get(region)
        if base_path is None:
            continue
        base = decode_game_swf(base_path.expanduser().read_bytes())
        if hashlib.sha256(base).hexdigest() != spec['baseSha256']:
            raise SystemExit(f'基准 SWF 摘要不匹配（{region}）；拒绝对未知版本应用补丁')
        patch_directory = ROOT / 'flash-patches' / spec['patchDirectory']
        expected = set(spec['files'])
        actual = {p.relative_to(patch_directory).as_posix() for p in patch_directory.rglob('*.as')}
        if expected != actual:
            raise SystemExit(f'补丁源码清单不匹配（{region}）')
        selected.append((spec, base, patch_directory))

    java = TOOLS / 'jre/jdk-21.0.13+9-jre/Contents/Home/bin/java'
    jar = TOOLS / 'ffdec/ffdec.jar'
    if not java.is_file() or not jar.is_file():
        raise SystemExit(f'FFDec 工具未准备好：{TOOLS}')
    modules = []
    for spec, base, patch_directory in selected:
        output_dir = ROOT / f".test-artifacts/assists-build-{spec['version']}"
        output_dir.mkdir(parents=True, exist_ok=True)
        # A fresh staging directory prevents old or unrelated sources entering a build.
        with tempfile.TemporaryDirectory(prefix='build-', dir=output_dir) as temporary:
            work = Path(temporary)
            original = work / 'original.swf'
            original.write_bytes(base)
            file = spec['outputFile']
            output = work / Path(file).name
            result = subprocess.run([str(java), '-Djava.awt.headless=true', '-Duser.home=' + str(output_dir), '-jar', str(jar),
                                     '-importScript', str(original), str(output), str(patch_directory)],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            (output_dir / 'compile.log').write_text(result.stdout, encoding='utf-8')
            print(result.stdout[-2000:])
            if result.returncode or not output.is_file():
                raise SystemExit(result.returncode or 'FFDec 未生成输出 SWF')
            data = output.read_bytes()
        target = make_target(spec['region'], spec['version'], spec['resourceURL'], file, spec['baseSha256'], data)
        module = {'id': spec['id'], 'nameKey': spec['nameKey'], 'targets': [target]}
        modules.append((module, {file: data}))
    return modules


def load_prebuilt_module(spec_path, source):
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    module_id = spec['id']
    name_key = spec['nameKey']
    if not module_id or not re.fullmatch(r'ui\.[A-Za-z0-9_.]+', name_key):
        raise SystemExit(f'辅助模块标识或名称键无效（{spec_path}）')
    if not isinstance(spec['targets'], list) or not spec['targets']:
        raise SystemExit(f'辅助模块没有已登记目标（{module_id}）')

    targets = []
    resources = {}
    for entry in spec['targets']:
        file = entry['file']
        relative = Path(file)
        if relative.is_absolute() or '..' in relative.parts or relative.suffix != '.swf' or relative.as_posix() != file:
            raise SystemExit(f'辅助资源路径无效（{file}）')
        if file in resources:
            raise SystemExit(f'辅助资源路径重复（{file}）')
        data = (source / relative).read_bytes()
        targets.append(make_target(entry['region'], entry['build'], entry['url'], file, entry['baseSha256'], data))
        resources[file] = data
    return {'id': module_id, 'nameKey': name_key, 'targets': targets}, resources


def staged_manifest(destination, updates, resources):
    path = destination / 'manifest.json'
    if path.exists():
        manifest = json.loads(path.read_text(encoding='utf-8'))
        if manifest.get('id') != MANIFEST_ID or manifest.get('version') != 1 or not isinstance(manifest.get('modules'), list):
            raise SystemExit(f'辅助清单版本不匹配（{path}）')
    else:
        manifest = {'id': MANIFEST_ID, 'version': 1, 'modules': []}
    existing = {module['id']: module for module in manifest['modules']}
    if len(existing) != len(manifest['modules']):
        raise SystemExit(f'辅助清单存在重复模块（{path}）')
    existing.update(updates)
    for module in existing.values():
        for target in module['targets']:
            file = target['file']
            if file in resources and resources[file] != target['sha256']:
                raise SystemExit(f'辅助资源与现有模块冲突（{file}）')
    manifest['modules'] = list(existing.values())
    return json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'


def publish_modules(prepared, destinations):
    modules = {}
    resources = {}
    hashes = {}
    for module, files in prepared:
        module_id = module['id']
        if module_id in modules:
            raise SystemExit(f'本次构建重复登记辅助模块（{module_id}）')
        modules[module_id] = module
        for target in module['targets']:
            file = target['file']
            if file in resources:
                raise SystemExit(f'本次构建重复登记辅助资源（{file}）')
            resources[file] = files[file]
            hashes[file] = target['sha256']

    lock_path = ROOT / '.test-artifacts/assists-build.lock'
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open('a') as lock, ExitStack() as stack:
        fcntl.flock(lock, fcntl.LOCK_EX)
        staged = []
        for destination in destinations:
            manifest = staged_manifest(destination, modules, hashes)
            destination.mkdir(parents=True, exist_ok=True)
            work = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix='publish-', dir=destination)))
            for file, data in resources.items():
                (destination / file).parent.mkdir(parents=True, exist_ok=True)
                if (destination / file).is_dir():
                    raise SystemExit(f'辅助资源输出路径指向目录（{destination / file}）')
                (work / file).parent.mkdir(parents=True, exist_ok=True)
                (work / file).write_bytes(data)
            (work / 'manifest.json').write_text(manifest, encoding='utf-8')
            staged.append((work, destination))

        for work, destination in staged:
            for file in resources:
                (work / file).replace(destination / file)
            (work / 'manifest.json').replace(destination / 'manifest.json')

    for file, sha256 in hashes.items():
        print(f'辅助资源: {destinations[0] / file}')
        print(f'SHA256: {sha256}')


def main():
    parser = argparse.ArgumentParser(description='生成随应用提供的辅助脚本资源包')
    parser.add_argument('--base-swf', type=Path, help='国服原版 HuntLifePlugin.swf，允许游戏包装格式')
    parser.add_argument('--br-base-swf', type=Path, help='巴西服原版 HuntLifePlugin.swf，允许游戏包装格式')
    parser.add_argument('--prebuilt-module', nargs=2, action='append', type=Path, metavar=('SPEC', 'SWF_DIR'),
                        default=[], help='登记完整模块规格 JSON 与预构建 SWF 所在目录，可重复提供')
    parser.add_argument('--update-asset', action='store_true', help='更新项目内置资源；不会打包应用')
    args = parser.parse_args()
    if not (args.base_swf or args.br_base_swf or args.prebuilt_module):
        parser.error('需提供 HuntLife 基准 SWF 或预构建模块')
    prepared = [load_prebuilt_module(spec.expanduser(), source.expanduser()) for spec, source in args.prebuilt_module]
    if args.base_swf or args.br_base_swf:
        prepared.extend(build_huntlife({'cn': args.base_swf, 'br': args.br_base_swf}))
    destinations = [ROOT / '.test-artifacts/assists']
    if args.update_asset:
        destinations.append(ROOT / 'assets/assists')
    publish_modules(prepared, destinations)


if __name__ == '__main__':
    main()
