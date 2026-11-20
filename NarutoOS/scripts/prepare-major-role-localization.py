"""Patch the talent panel plugin's fixed labels with the CN wording.

Source: BR PT_NarutoAlpha8.27Build302/flash/majorRole/MajorRolePlugin.swf
Translations: CN UI wording (the card status label shared with the 可使用 field).
"""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / '.test-artifacts/localization-2026-11-18/original'
PACK = ROOT / 'assets/localization/pack'
TEMPLATE = ROOT / 'scripts/prepare-character-panels-localization.py'

loader = importlib.util.spec_from_file_location('panels', TEMPLATE)
panels = importlib.util.module_from_spec(loader)
loader.loader.exec_module(panels)
panels.BASE = BASE
panels.PACK = PACK
ET = panels.ET
ffdec = panels.ffdec

SPEC = json.loads((ROOT / 'localization/major-role-plugin.zh-CN.json').read_text())
SPEC.setdefault('textFields', {})
NAME = 'MajorRolePlugin'
source = BASE / 'br/MajorRolePlugin.swf'
decoded = BASE / 'br/MajorRolePlugin.decoded.swf'
source_xml = BASE / f'{NAME}-source.xml'
output_xml = BASE / f'{NAME}-zh.xml'
verified_xml = BASE / f'{NAME}-verified.xml'
output = PACK / SPEC['file']

if not source.exists() or not decoded.exists():
    raise SystemExit('Missing MajorRolePlugin originals')

ffdec('-swf2xml', decoded, source_xml)
tree = ET.parse(source_xml)
tags = tree.getroot().find('tags')

changed = {}
for tag in tags:
    if tag.get('type') != 'DoABC2Tag' or tag.get('name') not in SPEC['scriptStrings']:
        continue
    mapping = SPEC['scriptStrings'][tag.get('name')]
    found = {}
    for node in tag.iter('item'):
        if node.text in mapping:
            if node.text in found:
                raise ValueError(f'Duplicate plugin string: {node.text!r}')
            found[node.text] = node
    if set(found) != set(mapping):
        raise ValueError(f'Missing plugin strings: {sorted(set(mapping) - set(found))}')
    for original, translation in mapping.items():
        found[original].text = translation
    changed[tag.get('name')] = mapping
if set(changed) != set(SPEC['scriptStrings']):
    raise ValueError('Missing plugin script classes')

staged = output.with_name(output.name + '.tmp')
# The game's loader accepts the same ZLIB container the talent SWF ships in,
# while the decoded source is LZMA; keep both packs identical.
tree.getroot().set('compression', 'ZLIB')
tree.write(output_xml, encoding='utf-8', xml_declaration=True)
ffdec('-xml2swf', output_xml, staged)
ffdec('-swf2xml', staged, verified_xml)
verified = ET.parse(verified_xml).getroot().find('tags')
for tag in verified:
    if tag.get('type') != 'DoABC2Tag' or tag.get('name') not in SPEC['scriptStrings']:
        continue
    values = {node.text for node in tag.iter('item')}
    if not set(SPEC['scriptStrings'][tag.get('name')].values()) <= values:
        raise ValueError(f'Plugin writeback failed: {tag.get("name")}')

source_tags = ET.parse(source_xml).getroot().find('tags')
if len(verified) != len(source_tags):
    raise ValueError('Plugin tag count changed')
targets = set(SPEC['scriptStrings'])
for original, patched in zip(source_tags, verified):
    if original.get('type') == 'DoABC2Tag' and original.get('name') in targets:
        continue
    if panels.semantic(original) != panels.semantic(patched):
        raise ValueError(f'Unexpected plugin tag change: {original.attrib}')

count = sum(map(len, SPEC['scriptStrings'].values()))
staged.replace(output)
panels.add_override(SPEC, source, output, verified_xml, {}, count)
