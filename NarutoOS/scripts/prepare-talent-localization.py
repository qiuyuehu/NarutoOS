"""Patch the talent UI SWF with the CN label set.

Source: BR PT_NarutoAlpha9.05Build306/flash/majorRole/ui.talent.swf
Translations: CN NarutoBeta8.07Build301 official labels + CN help text.
"""
import importlib.util
import html
import json
import re
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

SPEC = json.loads((ROOT / 'localization/talent-ui.zh-CN.json').read_text())
name = 'ui.talent'
source = BASE / 'br/ui.talent.swf'
decoded = BASE / 'br/ui.talent.decoded.swf'
source_xml = BASE / f'{name}-source.xml'
output_xml = BASE / f'{name}-zh.xml'
verified_xml = BASE / f'{name}-verified.xml'
verified_text = BASE / f'{name}-verified-text'
output = PACK / SPEC['file']

if not source.exists() or not decoded.exists():
    raise SystemExit('Missing talent SWF originals')

ffdec('-swf2xml', decoded, source_xml)
tree = ET.parse(source_xml)
root = tree.getroot()
tags = root.find('tags')

def paragraph_field(entry):
    parts = []
    for line in entry['paragraphs']:
        parts.append(
            '<p align="left"><font face="%s" size="12" color="#ffffff"><b>%s</b></font></p>'
            % (SPEC['font'], html.escape(line))
        )
    return ''.join(parts)

def replace_font_text(tag, translation, font):
    initial = tag.get('initialText', '')
    match = re.search(r'<font[^>]*>', initial)
    if not match:
        raise ValueError(f'no font tag in talent field {tag.get("characterID")}')
    end = initial.find('</font>', match.end())
    if end < 0:
        raise ValueError(f'no closing font tag in talent field {tag.get("characterID")}')
    font_tag = re.sub(r'face="[^"]*"', 'face="%s"' % font, match.group(0))
    tag.set('initialText', initial[:match.start()] + font_tag + html.escape(translation) + initial[end:])

changed_fields = set()
for tag in list(tags):
    cid = tag.get('characterID')
    if cid not in SPEC['textFields']:
        continue
    entry = SPEC['textFields'][cid]
    if tag.get('type') != 'DefineEditTextTag':
        raise ValueError(f'talent field {cid} is not an editable text field')
    if 'paragraphs' in entry:
        tag.set('initialText', paragraph_field(entry))
    else:
        if panels.plain_field_text(tag) != panels.normalize(entry['source']):
            raise ValueError(f'talent field {cid} source mismatch: {panels.field_text(tag)!r}')
        replace_font_text(tag, entry['translation'], SPEC['font'])
    changed_fields.add(cid)
if changed_fields != set(SPEC['textFields']):
    raise ValueError('Missing talent text fields: %s' % sorted(set(SPEC['textFields']) - changed_fields))

changed_classes = {}
for tag in tags:
    if tag.get('type') != 'DoABC2Tag' or tag.get('name') not in SPEC['scriptStrings']:
        continue
    class_name = tag.get('name')
    mapping = SPEC['scriptStrings'][class_name]
    found = {}
    for node in tag.iter('item'):
        if node.text in mapping:
            if node.text in found:
                raise ValueError(f'duplicate talent script string {class_name}: {node.text!r}')
            found[node.text] = node
    if set(found) != set(mapping):
        raise ValueError(f'missing talent script strings in {class_name}: {sorted(set(mapping) - set(found))}')
    for original, translated in mapping.items():
        found[original].text = translated
    changed_classes[class_name] = mapping
if set(changed_classes) != set(SPEC['scriptStrings']):
    raise ValueError('Missing talent script classes')

root.set('compression', 'ZLIB')
tree.write(output_xml, encoding='utf-8', xml_declaration=True)
ffdec('-xml2swf', output_xml, output)
ffdec('-swf2xml', output, verified_xml)
ffdec('-export', 'text', verified_text, output)

verified_tags = ET.parse(verified_xml).getroot().find('tags')
if len(verified_tags) != len(tags):
    raise ValueError('talent SWF tag count changed')
for cid, entry in SPEC['textFields'].items():
    if 'paragraphs' in entry:
        text = (verified_text / f'{cid}.txt').read_text(errors='replace')
        for line in entry['paragraphs']:
            if line not in text:
                raise ValueError(f'talent help paragraph missing: {line!r}')
    else:
        actual = panels.normalize((verified_text / f'{cid}.txt').read_text())
        if actual != panels.normalize(entry['translation']):
            raise ValueError(f'talent field writeback failed: {cid}: {actual!r}')
for tag in verified_tags:
    if tag.get('type') != 'DoABC2Tag' or tag.get('name') not in SPEC['scriptStrings']:
        continue
    values = {node.text for node in tag.iter('item')}
    if not set(SPEC['scriptStrings'][tag.get('name')].values()) <= values:
        raise ValueError(f'talent script writeback failed: {tag.get("name")}')
source_tags = ET.parse(source_xml).getroot().find('tags')
targets = set(SPEC['scriptStrings'])
for original, patched in zip(source_tags, verified_tags):
    if original.get('type') == 'DefineEditTextTag' and original.get('characterID') in SPEC['textFields']:
        continue
    if original.get('type') == 'DoABC2Tag' and original.get('name') in targets:
        continue
    if panels.semantic(original) != panels.semantic(patched):
        raise ValueError(f'unexpected talent tag change: {original.attrib}')
count = sum(map(len, SPEC['scriptStrings'].values()))
panels.add_override(SPEC, source, output, verified_xml, changed_fields, count)
print(json.dumps({'resource': SPEC['file'], 'textFields': len(changed_fields), 'scriptStrings': count}, ensure_ascii=False))
