"""Translate fixed labels in the cached Daily Training dashboard SWF."""
import copy
import hashlib
import html
import json
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / '.test-artifacts/localization-2026-11-03'
TOOLS = ROOT / '.test-artifacts/battle-memory-analysis/tools'
JAVA = TOOLS / 'jre/jdk-21.0.13+9-jre/Contents/Home/bin/java'
JAR = TOOLS / 'ffdec/ffdec.jar'
SOURCE = BASE / 'original/activityDashboard.swf'
SOURCE_XML = BASE / 'activityDashboard-source.xml'
OUTPUT_XML = BASE / 'activityDashboard-zh.xml'
VERIFIED_XML = BASE / 'activityDashboard-verified.xml'
OUTPUT = BASE / 'pack/activityDashboard.zh-CN.swf'
MANIFEST = BASE / 'pack/manifest.json'
SPEC = json.loads((ROOT / 'localization/daily-training.zh-CN.json').read_text())
FIELDS = {'214': ('Eventos ', '活动')}
SCRIPT_STRINGS = {
    'activityDashboard_fla/Timeline_17': {'<b>Participar</b> ': '<b>参加</b> '},
    'com/tencent/morefun/naruto/plugin/hud/view/activitydashboard/RuleUI': {'Regras ': '规则'}
}


def ffdec(*args):
    subprocess.run([str(JAVA), '-Djava.awt.headless=true', '-jar', str(JAR), *map(str, args)], check=True)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalized(text):
    return ' '.join(text.split())


if not SOURCE.exists():
    raise SystemExit('Missing cached original/activityDashboard.swf')
ffdec('-swf2xml', SOURCE, SOURCE_XML)
ffdec('-export', 'text', BASE / 'activityDashboard-text', SOURCE)
tree = ET.parse(SOURCE_XML)
tags = tree.getroot().find('tags')
changed_fields = set()
for tag in tags:
    cid = tag.get('characterID')
    if tag.get('type') != 'DefineEditTextTag' or cid not in FIELDS:
        continue
    source, translation = FIELDS[cid]
    actual = normalized((BASE / 'activityDashboard-text' / f'{cid}.txt').read_text())
    if actual != normalized(source):
        raise ValueError(f'Activity dashboard text {cid} source mismatch: {actual!r}')
    initial = tag.get('initialText', '')
    if source not in html.unescape(initial):
        raise ValueError(f'Activity dashboard field {cid} did not contain its expected text')
    tag.set('initialText', initial.replace(source, translation))
    changed_fields.add(cid)
if changed_fields != set(FIELDS):
    raise ValueError(f'Missing activity dashboard fields: {sorted(set(FIELDS) - changed_fields)}')

changed_scripts = {}
for tag in tags:
    if tag.get('type') != 'DoABC2Tag':
        continue
    mapping = SCRIPT_STRINGS.get(tag.get('name', ''))
    if not mapping:
        continue
    found = {}
    for node in tag.iter('item'):
        if node.text in mapping:
            if node.text in found:
                raise ValueError(f'Duplicate dashboard script string in {tag.get("name")}: {node.text!r}')
            found[node.text] = node
    if set(found) != set(mapping):
        raise ValueError(f'Missing dashboard strings in {tag.get("name")}: {sorted(set(mapping) - set(found))}')
    for source, translation in mapping.items():
        found[source].text = translation
    changed_scripts[tag.get('name')] = mapping
if set(changed_scripts) != set(SCRIPT_STRINGS):
    raise ValueError(f'Missing dashboard script classes: {sorted(set(SCRIPT_STRINGS) - set(changed_scripts))}')

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
tree.write(OUTPUT_XML, encoding='utf-8', xml_declaration=True)
ffdec('-xml2swf', OUTPUT_XML, OUTPUT)
ffdec('-swf2xml', OUTPUT, VERIFIED_XML)
verified = ET.parse(VERIFIED_XML).getroot().find('tags')
source_tags = ET.parse(SOURCE_XML).getroot().find('tags')
assert len(verified) == len(source_tags)
verified_fields = {tag.get('characterID'): tag for tag in verified if tag.get('type') == 'DefineEditTextTag'}
for cid, (_, translation) in FIELDS.items():
    if translation not in html.unescape(verified_fields[cid].get('initialText', '')):
        raise ValueError(f'Dashboard field writeback failed: {cid}')
for tag in verified:
    if tag.get('type') != 'DoABC2Tag' or tag.get('name') not in SCRIPT_STRINGS:
        continue
    values = {node.text for node in tag.iter('item')}
    for translation in SCRIPT_STRINGS[tag.get('name')].values():
        if translation not in values:
            raise ValueError(f'Dashboard script writeback failed: {tag.get("name")} {translation!r}')


def semantic(tag):
    result = copy.deepcopy(tag)
    for element in result.iter():
        for name in ('nbits', 'fileOffset', 'moveBits', 'numFillBits', 'nScaleBits'):
            element.attrib.pop(name, None)
    return ET.tostring(result)


target_classes = set(SCRIPT_STRINGS)
for original, patched in zip(source_tags, verified):
    if original.get('type') == 'DefineEditTextTag' and original.get('characterID') in FIELDS:
        continue
    if original.get('type') == 'DoABC2Tag' and original.get('name') in target_classes:
        continue
    assert semantic(original) == semantic(patched), f'Unexpected dashboard SWF change: {original.attrib}'

manifest = json.loads(MANIFEST.read_text())
override = {
    'id': SPEC['id'],
    'resourceURL': 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha6.93Build300/flash/hud/activityDashboard.swf',
    'file': OUTPUT.name,
    'contentType': 'application/x-shockwave-flash',
    'originalSha256': digest(SOURCE.read_bytes()),
    'patchedSha256': digest(OUTPUT.read_bytes()),
    'originalBytes': SOURCE.stat().st_size,
    'patchedBytes': OUTPUT.stat().st_size,
    'textFields': [{'id': cid, 'source': source, 'translation': translation}
                   for cid, (source, translation) in FIELDS.items()],
    'scriptStrings': [
        {'class': class_name, 'source': source, 'translation': translation}
        for class_name, entries in SCRIPT_STRINGS.items()
        for source, translation in entries.items()
    ]
}
overrides = [item for item in manifest.get('resourceOverrides', []) if item.get('id') != SPEC['id']]
overrides.append(override)
manifest['resourceOverrides'] = overrides
MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(json.dumps({key: override[key] for key in ('id', 'resourceURL', 'originalSha256', 'patchedSha256')},
                 ensure_ascii=False, indent=2))
