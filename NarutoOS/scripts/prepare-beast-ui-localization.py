"""Patch the summon-beast panel UI with CN wording.

Source: BR PT_NarutoAlpha6.93Build300/flash/throughTheBeast/throughTheBeastUI.swf
Translations: CN official labels and terms.
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

SPEC = json.loads((ROOT / 'localization/beast-ui.zh-CN.json').read_text())
NAME = 'throughTheBeastUI'
source = BASE / f'br/{NAME}.swf'
decoded = BASE / f'br/{NAME}.decoded.swf'
source_xml = BASE / f'{NAME}-source.xml'
output_xml = BASE / f'{NAME}-zh.xml'
verified_xml = BASE / f'{NAME}-verified.xml'
output = PACK / SPEC['file']

if not source.exists() or not decoded.exists():
    raise SystemExit('Missing throughTheBeastUI originals')

ffdec('-swf2xml', decoded, source_xml)
tree = ET.parse(source_xml)
tags = tree.getroot().find('tags')

changed_fields = set()
for tag in tags:
    cid = tag.get('characterID')
    if tag.get('type') != 'DefineEditTextTag' or cid not in SPEC['textFields']:
        continue
    entry = SPEC['textFields'][cid]
    if panels.plain_field_text(tag) != panels.normalize(entry['source']):
        raise ValueError(f'beast UI field {cid} source mismatch: {panels.field_text(tag)!r}')
    panels.replace_field_text(tag, entry['translation'], SPEC['font'])
    changed_fields.add(cid)
if changed_fields != set(SPEC['textFields']):
    raise ValueError(f'beast UI fields missing: {sorted(set(SPEC["textFields"]) - changed_fields)}')

mapping = SPEC['scriptStrings']
changed_strings = {}
for tag in tags:
    if tag.get('type') != 'DoABC2Tag':
        continue
    for node in tag.iter('item'):
        if node.text in mapping:
            changed_strings[node.text] = changed_strings.get(node.text, 0) + 1
            node.text = mapping[node.text]
missing = set(mapping) - set(changed_strings)
if missing:
    raise ValueError(f'beast UI script strings missing: {sorted(missing)}')

staged = output.with_name(output.name + '.tmp')
tree.getroot().set('compression', 'ZLIB')
tree.write(output_xml, encoding='utf-8', xml_declaration=True)
ffdec('-xml2swf', output_xml, staged)
ffdec('-swf2xml', staged, verified_xml)
verified = ET.parse(verified_xml).getroot().find('tags')

verified_fields = {tag.get('characterID'): tag for tag in verified if tag.get('type') == 'DefineEditTextTag'}
for cid, entry in SPEC['textFields'].items():
    tag = verified_fields.get(cid)
    if tag is None or panels.plain_field_text(tag) != panels.normalize(entry['translation']):
        raise ValueError(f'beast UI field writeback failed: {cid}')
values = {node.text for tag in verified if tag.get('type') == 'DoABC2Tag' for node in tag.iter('item')}
if not set(mapping.values()) <= values:
    raise ValueError('beast UI string writeback failed')

source_tags = ET.parse(source_xml).getroot().find('tags')
if len(verified) != len(source_tags):
    raise ValueError('beast UI tag count changed')
for original, patched in zip(source_tags, verified):
    if original.get('type') == 'DefineEditTextTag' and original.get('characterID') in SPEC['textFields']:
        continue
    if original.get('type') == 'DoABC2Tag':
        continue
    if panels.semantic(original) != panels.semantic(patched):
        raise ValueError(f'Unexpected beast UI tag change: {original.attrib}')

staged.replace(output)
record = dict(SPEC)
record['scriptStrings'] = {'*': mapping}
panels.add_override(record, source, output, verified_xml, changed_fields, len(mapping))
