#!/usr/bin/env python3
"""Prepare private development resources. Never installs a package or edits 360."""
import argparse
import hashlib
import json
import lzma
import pathlib
import plistlib
import shutil
import struct
import subprocess
import tempfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RUNTIME = ROOT / 'runtime'
SOURCE = 'https://www.flash.cn/flashplayer/latest/install_flash_player_osx_ppapi.dmg'
FALLBACK = pathlib.Path('/Applications/360Chrome.app/Contents/Frameworks/360Chrome Framework.framework/Versions/12.2.1636.0/Internet Plug-Ins/PepperFlash/PepperFlashPlayer.plugin')

def extract_adobe(data, destination):
    # Adobe's archive uses 2 flag bytes, an 8-bit UTF-8 name length and a
    # big-endian 32-bit payload length; directories contain nested entries.
    def entries(start, end, base):
        cursor = start
        while cursor < end:
            if cursor + 7 > end:
                raise ValueError('Flash archive truncated')
            flag, kind, length = data[cursor:cursor + 3]
            if flag != 2 or cursor + 7 + length > end:
                raise ValueError('Unsupported Flash archive format')
            name = data[cursor + 3:cursor + 3 + length].decode('utf-8')
            if '/' in name or '\\' in name or name in ('.', '..'):
                raise ValueError('Invalid archive path')
            size = struct.unpack_from('>I', data, cursor + 3 + length)[0]
            offset = cursor + 7 + length
            if offset + size > end:
                raise ValueError('Flash archive size mismatch')
            target = base / name
            if kind & 0x80:
                target.mkdir(parents=True, exist_ok=True)
                entries(offset, offset + size, target)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data[offset:offset + size])
                target.chmod(0o755 if name == 'PepperFlashPlayer' else 0o644)
            cursor = offset + size
        if cursor != end:
            raise ValueError('Flash archive boundary mismatch')
    entries(0, len(data), destination)

def prepare34():
    destination = RUNTIME / 'flash-34' / 'PepperFlashPlayer.plugin'
    if destination.exists():
        subprocess.run(['codesign', '--verify', '--strict', str(destination)], check=True)
        print('Flash 34 已存在，保留现有组件。')
        return
    image = RUNTIME / 'flash-official.dmg'
    if not image.exists():
        print('从 Flash 官方下载开发组件…')
        temporary = image.with_suffix('.download')
        with urllib.request.urlopen(SOURCE, timeout=90) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output)
        temporary.rename(image)
    # Mount read-only and expand into a dedicated project-local scratch directory.
    with tempfile.TemporaryDirectory(prefix='flash-source-', dir=RUNTIME) as scratch:
        scratch = pathlib.Path(scratch)
        mount = scratch / 'volume'
        subprocess.run(['hdiutil', 'attach', '-readonly', '-nobrowse', '-mountpoint', str(mount), str(image)], check=True)
        try:
            packages = list(mount.glob('*.app/Contents/Resources/Adobe Flash Player.pkg'))
            if len(packages) != 1:
                raise ValueError('官方包结构已变化，停止提取')
            expanded = scratch / 'expanded'
            subprocess.run(['pkgutil', '--expand-full', str(packages[0]), str(expanded)], check=True)
            archives = list(expanded.rglob('PepperFlashPlayer.plugin.lzma'))
            if len(archives) != 1:
                raise ValueError('PPAPI 插件结构已变化，停止提取')
            compressed = archives[0].read_bytes()
            if compressed[:2] != b'\x02\x81' or len(compressed) < 16:
                raise ValueError('插件压缩格式不受支持')
            properties = compressed[11]
            dictionary = int.from_bytes(compressed[12:16], 'little')
            lc = properties % 9
            lp = (properties // 9) % 5
            pb = properties // 45
            decoder = lzma.LZMADecompressor(format=lzma.FORMAT_RAW, filters=[{
                'id': lzma.FILTER_LZMA1, 'dict_size': dictionary, 'lc': lc, 'lp': lp, 'pb': pb}])
            data = decoder.decompress(compressed[16:], max_length=100 * 1024 * 1024)
            staging = scratch / 'PepperFlashPlayer.plugin'
            extract_adobe(data, staging)
            metadata = plistlib.loads((staging / 'Contents/Info.plist').read_bytes())
            version = metadata['CFBundleShortVersionString']
            if not version.startswith('34.'):
                raise ValueError('官方版本已变化，需要重新确认兼容性')
            subprocess.run(['codesign', '--verify', '--strict', str(staging)], check=True)
            subprocess.run(['lipo', '-verify_arch', 'x86_64', str(staging / 'Contents/MacOS/PepperFlashPlayer')], check=True)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(staging, destination)
            (destination.parent / 'source.json').write_text(json.dumps({
                'source': SOURCE, 'version': version,
                'installerSHA256': hashlib.sha256(image.read_bytes()).hexdigest()
            }, indent=2), encoding='utf-8')
            print('已准备独立 Flash', version)
        finally:
            subprocess.run(['hdiutil', 'detach', str(mount)], check=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fallback31', action='store_true', help='仅复制已有 360 插件到本项目，不修改浏览器')
    args = parser.parse_args()
    RUNTIME.mkdir(exist_ok=True)
    prepare34()
    if args.fallback31:
        target = RUNTIME / 'flash-31' / 'PepperFlashPlayer.plugin'
        if target.exists():
            print('Flash 31 已存在，保留现有组件。')
        elif FALLBACK.exists():
            shutil.copytree(FALLBACK, target, symlinks=True)
            print('已复制独立 Flash 31 备用组件，原浏览器未改动。')
        else:
            raise FileNotFoundError('指定的 Flash 31 来源不存在')

if __name__ == '__main__':
    main()
