"""Compile the shared daily assistant and attach it to the verified HUD activity bar."""
import argparse
import hashlib
import json
import lzma
from pathlib import Path
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

from naruto_swf import decode_game_swf

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / 'flash-patches/cn-daily-wanted.json'
SOURCE = ROOT / 'flash-patches/cn-daily-wanted'
ARTIFACTS = ROOT / '.test-artifacts'
TOOLS = ARTIFACTS / 'battle-memory-analysis/tools'
FLEX_TOOLS = ARTIFACTS / 'pure-timer-speed-probe/toolchain'
HUD_CLASS = 'com.tencent.morefun.naruto.plugin.hud.view.functionBar.FunctionBarView'


def ffdec(*args):
    java = TOOLS / 'jre/jdk-21.0.13+9-jre/Contents/Home/bin/java'
    subprocess.run([java, '-Djava.awt.headless=true', '-jar', TOOLS / 'ffdec/ffdec.jar', *args], check=True)


def ffdec_swf(data):
    # FFDec does not accept the BR ZWS wrapper's modified LZMA header. Keep the
    # original decoded bytes for version hashing, but hand FFDec a plain FWS body.
    if data[:3] != b'ZWS':
        return data
    expected = int.from_bytes(data[4:8], 'little') - 8
    if expected < 0 or len(data) < 17:
        raise ValueError('Invalid ZWS HUD')
    stream = data[12:17] + expected.to_bytes(8, 'little') + data[17:]
    body = lzma.decompress(stream, format=lzma.FORMAT_ALONE)
    if len(body) != expected:
        raise ValueError('ZWS HUD decompressed length mismatch')
    return b'FWS' + data[3:8] + body


def compile_assistant(work):
    # Only link the assistant's own ActionScript. Flash supplies playerglobal at runtime.
    library = work / 'assistant.swc'
    subprocess.run([
        FLEX_TOOLS / 'java/jdk8u504-b01/Contents/Home/bin/java', '-jar', FLEX_TOOLS / 'flex/lib/compc.jar',
        '-load-config=', '-target-player=11.2', '-swf-version=13', '-debug=false',
        '-external-library-path=' + str(FLEX_TOOLS / 'playerglobal/32.0/playerglobal.swc'),
        '-source-path=' + str(SOURCE), '-include-classes=narutoos.daily.DailyAssistant',
        '-output=' + str(library),
    ], check=True, cwd=FLEX_TOOLS / 'flex/frameworks')
    with zipfile.ZipFile(library) as swc:
        (work / 'assistant.swf').write_bytes(swc.read('library.swf'))
    ffdec('-swf2xml', work / 'assistant.swf', work / 'assistant.xml')
    tags = [tag for tag in ET.parse(work / 'assistant.xml').findall('./tags/item[@type="DoABC2Tag"]')
            if tag.get('name', '').startswith('narutoos/daily/')]
    required = {
        'DailyAssistant', 'DailyEntryPortrait', 'DailyQueue', 'IDailyTask', 'DailyActivity', 'NativeFightResult',
        'NativeAutoBattle', 'NativePlayerVisibility', 'NativeAutoMode', 'GrocerySettings', 'GroceryTask', 'GroceryCatalog', 'NativeGrocery',
        'QuizBox', 'QuizWait', 'WantedRun', 'ExpeditionRun', 'ExpeditionMap', 'ExpeditionResetLabel', 'ExpeditionBattle', 'QuizRun', 'StrongRun',
        'TeamDungeonPanel', 'TeamDungeonProgress', 'TeamDungeonRun',
        'EscortTask', 'EscortEntry', 'EscortDeliveryNpc', 'EscortNativePanel', 'EscortTransit', 'EscortRewardPopup',
        'DailyRegion', 'InfiniteIllusionSweep', 'NativeInfiniteIllusion',
    }
    compiled = {tag.get('name').rsplit('/', 1)[-1] for tag in tags}
    if missing := required - compiled:
        raise ValueError('Missing daily assistant classes: ' + ', '.join(sorted(missing)))
    return tags


def u30(number):
    result = bytearray()
    while number >= 128:
        result.append((number & 127) | 128)
        number >>= 7
    result.append(number)
    return result


def qname(constants, package, local_name):
    strings = constants.find('constant_string')
    namespaces = constants.find('constant_namespace')
    names = constants.find('constant_multiname')

    def string_id(value):
        for index, item in enumerate(strings):
            if index and (item.text or '') == value:
                return index
        ET.SubElement(strings, 'item').text = value
        return len(strings) - 1

    def intern(pool, attributes):
        for index, item in enumerate(pool):
            if item.attrib == attributes:
                return index
        ET.SubElement(pool, 'item', attributes)
        return len(pool) - 1

    ns = intern(namespaces, dict(type='Namespace', kind='22', name_index=str(string_id(package))))
    return intern(names, dict(type='Multiname', kind='7', name_index=str(string_id(local_name)),
                              namespace_index=str(ns), namespace_set_index='0', qname_index='0'))


def patch_activity_bar(tags, assistant_tags, region):
    # The verified CN 11.17 and BR 9.39 HUD layouts both use locals 10 and 11
    # for the first free activity-bar slot in updateIcons.
    # Append before the final return so the original branches, listeners and layout stay intact.
    for tag in tags.findall('item[@type="DoABC2Tag"]'):
        abc = tag.find('abc')
        constants = abc.find('constants')
        names = constants.find('constant_multiname')
        strings = constants.find('constant_string')
        namespaces = constants.find('constant_namespace')

        def qualified_name(index):
            name = names[int(index)]
            namespace = namespaces[int(name.get('namespace_index'))]
            package = strings[int(namespace.get('name_index'))].text
            local = strings[int(name.get('name_index'))].text
            return (package + '.' if package else '') + local

        for owner in abc.find('instance_info'):
            if qualified_name(owner.get('name_index')) != HUD_CLASS:
                continue
            assistant = qname(constants, 'narutoos.daily', 'DailyAssistant')
            methods = {strings[int(names[int(trait.get('name_index'))].get('name_index'))].text:
                       trait.get('method_info') for trait in owner.findall('./instance_traits/traits/item[@method_info]')}
            install = 'installBR' if region == 'br' else 'install'
            for native, call, args, count in [('updateIcons', install, bytes.fromhex('d0 62 0a 62 0b'), 3),
                                               ('hideMenu', 'hide', bytes.fromhex('d0'), 1)]:
                body = abc.find('bodies/item[@method_info="' + methods[native] + '"]')
                code = bytes.fromhex(body.get('codeBytes'))
                if code[-1:] != b'\x47' or len(body.find('exceptions')):
                    raise ValueError('Unexpected activity bar method: ' + native)
                # getlex DailyAssistant, getlocal arguments, callpropvoid, returnvoid.
                suffix = b'\x60' + u30(assistant) + args + b'\x4f' + u30(qname(constants, '', call)) + u30(count)
                body.set('codeBytes', (code[:-1] + suffix + code[-1:]).hex())
                body.set('max_stack', str(max(int(body.get('max_stack')), count + 1)))
            insert_at = list(tags).index(tag)
            for index, helper in enumerate(assistant_tags):
                tags.insert(insert_at + index, helper)
            return
    raise ValueError('Activity bar class missing from HUD')


def attach_portrait(tags):
    # DefineBitsJPEG2 also accepts PNG. Allocate a fresh SWF dictionary entry.
    last_id = max((int(value) for tag in tags.iter('item') if tag.get('type', '').startswith('Define')
                   for key, value in tag.attrib.items() if key.lower().endswith('id')), default=0)
    portrait_id = str(last_id + 1)
    data = (SOURCE / 'narutoos/daily/daily-entry-portrait.png').read_bytes()
    symbol = tags.find('item[@type="SymbolClassTag"]')
    image = ET.Element('item', type='DefineBitsJPEG2Tag', characterID=portrait_id, imageData=data.hex())
    tags.insert(list(tags).index(symbol), image)
    ET.SubElement(symbol.find('tags'), 'item').text = portrait_id
    ET.SubElement(symbol.find('names'), 'item').text = 'narutoos.daily.DailyEntryPortrait'


def build_hud(work, base, output, helpers, region):
    (work / 'original.swf').write_bytes(ffdec_swf(base))
    xml = work / 'hud.xml'
    ffdec('-swf2xml', work / 'original.swf', xml)
    tree = ET.parse(xml)
    patch_activity_bar(tree.find('tags'), helpers, region)
    attach_portrait(tree.find('tags'))
    tree.write(xml, encoding='utf-8', xml_declaration=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    ffdec('-xml2swf', xml, output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--hud', type=Path, help='Original CN HudPlugin.swf')
    parser.add_argument('--br-hud', type=Path, action='append', help='Original Brazil HudPlugin.swf (repeat for multiple builds)')
    parser.add_argument('--update-asset', action='store_true')
    args = parser.parse_args()
    builds = []
    if args.hud:
        builds.append(('cn', [args.hud], SPEC))
    if args.br_hud:
        builds.append(('br', args.br_hud, ROOT / 'flash-patches/br-daily-wanted.json'))
    if not builds:
        parser.error('需至少提供 --hud 或 --br-hud')
    with tempfile.TemporaryDirectory(prefix='daily-wanted-', dir=ARTIFACTS) as tmp:
        work = Path(tmp)
        helpers = compile_assistant(work)
        register_args = []
        for region, hud_files, spec_path in builds:
            targets = json.loads(spec_path.read_text())['targets']
            originals = {}
            for hud in hud_files:
                base = decode_game_swf(hud.read_bytes())
                digest = hashlib.sha256(base).hexdigest()
                if not any(target['baseSha256'] == digest for target in targets):
                    raise ValueError(f'{region.upper()} HUD version mismatch: {hud.name}')
                originals[digest] = base
            region_work = work / region
            region_work.mkdir()
            for target in targets:
                output = region_work / target['file']
                base = originals.get(target['baseSha256'])
                if base is None:
                    # An incremental build retains the verified bundled sibling target.
                    assets = ROOT / 'assets/assists'
                    manifest = json.loads((assets / 'manifest.json').read_text())
                    registered = next((entry for module in manifest['modules']
                                       for entry in module['targets']
                                       if all(entry.get(k) == v for k, v in target.items())), None)
                    if registered is None:
                        raise ValueError(f"Missing original HUD for {target['build']}")
                    data = (assets / target['file']).read_bytes()
                    if hashlib.sha256(data).hexdigest() != registered['sha256']:
                        raise ValueError(f"Bundled HUD digest mismatch for {target['build']}")
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_bytes(data)
                else:
                    target_work = region_work / target['build']
                    target_work.mkdir()
                    build_hud(target_work, base, output, helpers, region)
            register_args.extend(['--prebuilt-module', spec_path, region_work])
        subprocess.run([sys.executable, ROOT / 'scripts/prepare-assist.py', *register_args,
                        *(['--update-asset'] if args.update_asset else [])], check=True)


if __name__ == '__main__':
    main()
