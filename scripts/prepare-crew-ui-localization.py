"""Patch confirmed fixed labels in the cached CrewUI SWF and preserve other tags."""
import copy
import hashlib
import html
import json
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / '.test-artifacts/localization-2026-11-03'
TOOLS = ROOT / '.test-artifacts/battle-memory-analysis/tools'
JAVA = TOOLS / 'jre/jdk-21.0.13+9-jre/Contents/Home/bin/java'
JAR = TOOLS / 'ffdec/ffdec.jar'
PACK = BASE / 'pack'
SPEC = json.loads((ROOT / 'localization/crew-ui.zh-CN.json').read_text())
SOURCE = BASE / 'original/CrewUI.swf'
SOURCE_XML = BASE / 'CrewUI-source.xml'
OUTPUT = PACK / 'CrewUI.zh-CN.swf'
OUTPUT_XML = BASE / 'CrewUI-zh.xml'
VERIFIED_XML = BASE / 'CrewUI-verified.xml'
MANIFEST = PACK / 'manifest.json'


def ffdec(*args):
    subprocess.run([str(JAVA), '-Djava.awt.headless=true', '-jar', str(JAR), *map(str, args)], check=True)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def field_text(tag):
    match = re.search(r'<font\b[^>]*>(.*?)</font>', tag.get('initialText', ''), re.S)
    return html.unescape(match.group(1)) if match else ''


if not SOURCE.exists():
    raise SystemExit('Missing cached original/CrewUI.swf for PT_NarutoAlpha9.18Build300')
PACK.mkdir(parents=True, exist_ok=True)
ffdec('-swf2xml', SOURCE, SOURCE_XML)
tree = ET.parse(SOURCE_XML)
root = tree.getroot()
tags = root.find('tags')
changed_fields = set()
for tag in tags:
    cid = tag.get('characterID')
    if tag.get('type') != 'DefineEditTextTag' or cid not in SPEC['textFields']:
        continue
    entry = SPEC['textFields'][cid]
    if field_text(tag) != entry['source']:
        raise ValueError(f'CrewUI text field {cid} source mismatch: {field_text(tag)!r}')
    initial = tag.get('initialText', '')
    font_match = re.search(r'<font\b[^>]*>', initial)
    if not font_match:
        raise ValueError(f'CrewUI text field {cid} has no font tag')
    font_tag = font_match.group(0)
    if 'face="Arial"' not in font_tag:
        raise ValueError(f'CrewUI text field {cid} font changed: {font_tag!r}')
    updated_font = font_tag.replace('face="Arial"', f'face="{SPEC["font"]}"')
    updated = initial[:font_match.start()] + updated_font + initial[font_match.end():]
    updated = re.sub(r'(<font\b[^>]*>)(.*?)(</font>)',
                     lambda m: m.group(1) + html.escape(entry['translation']) + m.group(3),
                     updated, count=1, flags=re.S)
    tag.set('initialText', updated)
    changed_fields.add(cid)
if changed_fields != set(SPEC['textFields']):
    raise ValueError(f'Missing CrewUI text fields: {sorted(set(SPEC["textFields"]) - changed_fields)}')

class_strings = {}
for tag in tags:
    if tag.get('type') != 'DoABC2Tag':
        continue
    class_name = tag.get('name', '')
    mapping = SPEC['scriptStrings'].get(class_name)
    if not mapping:
        continue
    items = [node for node in tag.iter('item') if node.text in mapping]
    found = {}
    for node in items:
        source = node.text
        if source in found:
            raise ValueError(f'Duplicate CrewUI script string in {class_name}: {source!r}')
        found[source] = node
    if set(found) != set(mapping):
        raise ValueError(f'Missing CrewUI script strings in {class_name}: {sorted(set(mapping) - set(found))}')
    for source, translation in mapping.items():
        found[source].text = translation
    class_strings[class_name] = mapping
if set(class_strings) != set(SPEC['scriptStrings']):
    raise ValueError(f'Missing CrewUI script classes: {sorted(set(SPEC["scriptStrings"]) - set(class_strings))}')

tree.write(OUTPUT_XML, encoding='utf-8', xml_declaration=True)
ffdec('-xml2swf', OUTPUT_XML, OUTPUT)
ffdec('-swf2xml', OUTPUT, VERIFIED_XML)
verified_root = ET.parse(VERIFIED_XML).getroot()
verified_tags = verified_root.find('tags')
verified_fields = {tag.get('characterID'): tag for tag in verified_tags if tag.get('type') == 'DefineEditTextTag'}
for cid, entry in SPEC['textFields'].items():
    tag = verified_fields.get(cid)
    if tag is None or field_text(tag) != entry['translation'] or f'face="{SPEC["font"]}"' not in tag.get('initialText', ''):
        raise ValueError(f'CrewUI field writeback failed: {cid}')
for tag in verified_tags:
    if tag.get('type') != 'DoABC2Tag' or tag.get('name') not in SPEC['scriptStrings']:
        continue
    values = {node.text for node in tag.iter('item')}
    for translation in SPEC['scriptStrings'][tag.get('name')].values():
        if translation not in values:
            raise ValueError(f'CrewUI script writeback failed: {tag.get("name")} {translation!r}')

def semantic(tag):
    result = copy.deepcopy(tag)
    for element in result.iter():
        for name in ('nbits', 'fileOffset', 'moveBits', 'numFillBits', 'nScaleBits'):
            element.attrib.pop(name, None)
    return ET.tostring(result)

source_tags = ET.parse(SOURCE_XML).getroot().find('tags')
assert len(verified_tags) == len(source_tags)
target_classes = set(SPEC['scriptStrings'])
for original, patched in zip(source_tags, verified_tags):
    if original.get('type') == 'DefineEditTextTag' and original.get('characterID') in SPEC['textFields']:
        continue
    if original.get('type') == 'DoABC2Tag' and original.get('name') in target_classes:
        continue
    assert semantic(original) == semantic(patched), f'Unexpected non-target tag change: {original.attrib}'

manifest = json.loads(MANIFEST.read_text())
override = {
    'id': SPEC['id'], 'resourceURL': SPEC['resourceURL'], 'file': OUTPUT.name,
    'contentType': 'application/x-shockwave-flash',
    'originalSha256': digest(SOURCE.read_bytes()), 'patchedSha256': digest(OUTPUT.read_bytes()),
    'originalBytes': SOURCE.stat().st_size, 'patchedBytes': OUTPUT.stat().st_size,
    'textFields': [{'id': key, **value} for key, value in SPEC['textFields'].items()],
    'scriptStrings': [
        {'class': class_name, 'source': source, 'translation': translation}
        for class_name, entries in SPEC['scriptStrings'].items()
        for source, translation in entries.items()
    ]
}
overrides = [item for item in manifest.get('resourceOverrides', []) if item.get('id') != SPEC['id']]
overrides.append(override)
manifest['resourceOverrides'] = overrides
MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(json.dumps({key: override[key] for key in ('id', 'resourceURL', 'originalSha256', 'patchedSha256', 'originalBytes', 'patchedBytes')}, ensure_ascii=False, indent=2))
print(f'Verified {len(changed_fields)} fixed text fields and {sum(map(len, SPEC["scriptStrings"].values()))} fixed script labels; all non-target tags preserved.')
