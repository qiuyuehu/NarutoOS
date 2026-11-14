"""Decode and patch the confirmed AI-management and equipment UI assets."""
import copy
import hashlib
import html
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from naruto_swf import decode_file

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / '.test-artifacts/localization-2026-11-03'
TOOLS = ROOT / '.test-artifacts/battle-memory-analysis/tools'
JAVA = TOOLS / 'jre/jdk-21.0.13+9-jre/Contents/Home/bin/java'
JAR = TOOLS / 'ffdec/ffdec.jar'
PACK = BASE / 'pack'
SPECS = [
    json.loads((ROOT / 'localization/ai-manage-ui.zh-CN.json').read_text()),
    json.loads((ROOT / 'localization/equipment-ui.zh-CN.json').read_text()),
]


def ffdec(*args):
    subprocess.run([str(JAVA), '-Djava.awt.headless=true', '-jar', str(JAR), *map(str, args)], check=True)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalize(value):
    return ' '.join(value.replace('--- RECORDSEPARATOR ---', ' ').replace('\xa0', ' ').split())


def field_text(tag):
    value = html.unescape(tag.get('initialText', ''))
    return normalize(re.sub(r'<[^>]*>', ' ', value))


def patch_field(tag, cid, entry, font):
    if field_text(tag) != normalize(entry['source']):
        raise ValueError(f'Field {cid} source mismatch: {field_text(tag)!r}')
    initial = tag.get('initialText', '')
    matches = list(re.finditer(r'(<font\b[^>]*>)(.*?)(</font>)', initial, re.S))
    if not matches:
        raise ValueError(f'Field {cid} has no font run')
    if len(matches) > 1 and '\n' in entry['translation']:
        parts = entry['translation'].splitlines()
    elif len(matches) > 1:
        parts = re.split(r'(?=\d+[）)])', entry['translation'])
        if parts and not parts[0]:
            parts = parts[1:]
    else:
        parts = [entry['translation']]
    if len(parts) != len(matches):
        raise ValueError(f'Field {cid} translation has {len(parts)} sections for {len(matches)} font runs')
    result = []
    cursor = 0
    for match, part in zip(matches, parts):
        result.append(initial[cursor:match.start(1)])
        opening = re.sub(r'face="[^"]*"', f'face="{font}"', match.group(1))
        translated = html.escape(part)
        if '<b>' in match.group(2):
            translated = '<b>' + translated + '</b>'
        result.extend((opening, translated, match.group(3)))
        cursor = match.end(3)
    result.append(initial[cursor:])
    tag.set('initialText', ''.join(result))


def patch_scripts(spec, source_swf, stage_swf, output_swf, work):
    source_dir = work / 'scripts'
    ffdec('-export', 'script', source_dir, source_swf)
    changes = 0
    for relative, replacements in spec.get('scriptStrings', {}).items():
        source = source_dir / relative
        if not source.exists():
            raise ValueError(f'Missing script in SWF: {relative}')
        value = source.read_text()
        for original, translation in sorted(replacements.items(), key=lambda item: len(item[0]), reverse=True):
            count = value.count(original)
            if not count:
                raise ValueError(f'Script text not found in {relative}: {original!r}')
            value = value.replace(original, translation)
            changes += count
        source.write_text(value)
    if changes == 0:
        raise ValueError('No ActionScript strings were patched')
    ffdec('-importScript', stage_swf, output_swf, source_dir)
    return [
        {'class': relative.removeprefix('scripts/').removesuffix('.as'), 'source': original, 'translation': translation}
        for relative, replacements in spec.get('scriptStrings', {}).items()
        for original, translation in sorted(replacements.items(), key=lambda item: len(item[0]), reverse=True)
    ]


def build(spec):
    raw_source = BASE / 'original-encrypted' / spec['file'].replace('.zh-CN.swf', '.swf')
    if spec['file'] == 'AIManageUI.zh-CN.swf':
        raw_source = BASE / 'original-encrypted/AIManageUI.swf'
    elif spec['file'] == 'EquipmentUI.zh-CN.swf':
        raw_source = BASE / 'original-encrypted/EquipmentUI.swf'
    if not raw_source.exists():
        raise SystemExit(f'Missing captured source asset: {raw_source.name}')

    decoded_source = BASE / 'original' / raw_source.name
    raw_bytes = decode_file(raw_source, decoded_source)
    source_xml = BASE / f"{raw_source.stem}-source.xml"
    staged_xml = BASE / f"{raw_source.stem}-zh.xml"
    staged_swf = BASE / f"{raw_source.stem}-stage.swf"
    verified_xml = BASE / f"{raw_source.stem}-verified.xml"
    output = PACK / spec['file']
    work = BASE / f"{raw_source.stem}-script-work"

    ffdec('-swf2xml', decoded_source, source_xml)
    tree = ET.parse(source_xml)
    tags = tree.getroot()
    found = set()
    for tag in tags.iter('item'):
        cid = tag.get('characterID')
        if tag.get('type') != 'DefineEditTextTag' or cid not in spec['textFields']:
            continue
        patch_field(tag, cid, spec['textFields'][cid], spec.get('font', 'PingFang SC'))
        found.add(cid)
    if found != set(spec['textFields']):
        raise ValueError(f"Missing text fields: {sorted(set(spec['textFields']) - found)}")

    tags.set('compression', 'ZLIB')
    tree.write(staged_xml, encoding='utf-8', xml_declaration=True)
    ffdec('-xml2swf', staged_xml, staged_swf)
    output.parent.mkdir(parents=True, exist_ok=True)
    script_changes = patch_scripts(spec, decoded_source, staged_swf, output, work)

    ffdec('-swf2xml', output, verified_xml)
    verified = ET.parse(verified_xml).getroot()
    checked = set()
    for tag in verified.iter('item'):
        cid = tag.get('characterID')
        if tag.get('type') == 'DefineEditTextTag' and cid in spec['textFields']:
            expected = spec['textFields'][cid]['translation']
            if '\n' not in expected:
                expected = ' '.join(part for part in re.split(r'(?=\d+[）)])', expected) if part)
            if field_text(tag) != normalize(expected):
                raise ValueError(f'Writeback verification failed for field {cid}')
            checked.add(cid)
    if checked != set(spec['textFields']):
        raise ValueError('Not all translated text fields survived SWF writeback')

    script_verified = work / 'verified-scripts'
    ffdec('-export', 'script', script_verified, output)
    for relative, replacements in spec.get('scriptStrings', {}).items():
        script_text = (script_verified / relative).read_text()
        for translation in replacements.values():
            if translation not in script_text:
                raise ValueError(f'ActionScript writeback verification failed in {relative}')

    override = {
        'id': spec['id'], 'resourceURL': spec['resourceURL'], 'file': spec['file'],
        'contentType': 'application/x-shockwave-flash',
        'originalSha256': digest(raw_bytes), 'patchedSha256': digest(output.read_bytes()),
        'originalBytes': len(raw_bytes), 'patchedBytes': output.stat().st_size,
        'textFields': [{'id': key, **value} for key, value in spec['textFields'].items()],
        'scriptStrings': script_changes,
    }
    return override


manifest_path = PACK / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
for spec in SPECS:
    override = build(spec)
    overrides = [item for item in manifest.get('resourceOverrides', []) if item.get('id') != spec['id']]
    overrides.append(override)
    manifest['resourceOverrides'] = overrides
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print('已解码并生成自动模式、装备界面汉化资源。')
