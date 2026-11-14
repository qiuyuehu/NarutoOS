"""Patch the cached character profile and info panels without changing other SWF tags."""
import copy
import hashlib
import html
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / '.test-artifacts/localization-2026-11-03'
TOOLS = ROOT / '.test-artifacts/battle-memory-analysis/tools'
JAVA = TOOLS / 'jre/jdk-21.0.13+9-jre/Contents/Home/bin/java'
JAR = TOOLS / 'ffdec/ffdec.jar'
PACK = BASE / 'pack'


def ffdec(*args):
    subprocess.run([str(JAVA), '-Djava.awt.headless=true', '-jar', str(JAR), *map(str, args)], check=True)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalize(text):
    return ' '.join(text.replace('--- RECORDSEPARATOR ---', ' ').split())


def field_text(tag):
    match = re.search(r'<font\b[^>]*>(.*?)</font>', tag.get('initialText', ''), re.S)
    return html.unescape(match.group(1)) if match else ''


def plain_field_text(tag):
    return normalize(re.sub(r'<[^>]*>', '', field_text(tag)))


def replace_field_text(tag, translation, font):
    initial = tag.get('initialText', '')
    font_match = re.search(r'<font\b[^>]*>', initial)
    if not font_match or 'face="Arial"' not in font_match.group(0):
        raise ValueError(f'Unexpected font in character panel field {tag.get("characterID")}')
    font_tag = font_match.group(0).replace('face="Arial"', f'face="{font}"')
    updated = initial[:font_match.start()] + font_tag + initial[font_match.end():]
    def content(match):
        previous = match.group(2)
        translated = html.escape(translation)
        if '<b>' in previous:
            translated = '<b>' + translated + '</b>'
        return match.group(1) + translated + match.group(3)
    tag.set('initialText', re.sub(r'(<font\b[^>]*>)(.*?)(</font>)', content, updated, count=1, flags=re.S))


def semantic(tag):
    result = copy.deepcopy(tag)
    for element in result.iter():
        for name in ('nbits', 'fileOffset', 'moveBits', 'numFillBits', 'nScaleBits'):
            element.attrib.pop(name, None)
    return ET.tostring(result)


def add_override(spec, source, output, xml_path, fields, strings):
    manifest_path = PACK / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    override = {
        'id': spec['id'], 'resourceURL': spec['resourceURL'], 'file': output.name,
        'contentType': 'application/x-shockwave-flash',
        'originalSha256': digest(source.read_bytes()), 'patchedSha256': digest(output.read_bytes()),
        'originalBytes': source.stat().st_size, 'patchedBytes': output.stat().st_size,
        'textFields': [{'id': key, **value} for key, value in spec['textFields'].items()],
        'scriptStrings': [
            {'class': class_name, 'source': original, 'translation': translated}
            for class_name, mapping in spec.get('scriptStrings', {}).items()
            for original, translated in mapping.items()
        ]
    }
    overrides = [item for item in manifest.get('resourceOverrides', []) if item.get('id') != spec['id']]
    overrides.append(override)
    manifest['resourceOverrides'] = overrides
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps({key: override[key] for key in ('id', 'resourceURL', 'originalSha256', 'patchedSha256', 'originalBytes', 'patchedBytes')}, ensure_ascii=False))
    print(f"Verified {len(fields)} text fields and {strings} fixed script strings; non-target tags preserved.")


def patch_info_ui():
    spec = json.loads((ROOT / 'localization/info-ui.zh-CN.json').read_text())
    source = BASE / 'original/infoUI.swf'
    source_xml = BASE / 'infoUI-source.xml'
    output_xml = BASE / 'infoUI-zh.xml'
    verified_xml = BASE / 'infoUI-verified.xml'
    output = PACK / 'infoUI.zh-CN.swf'
    if not source.exists():
        raise SystemExit('Missing cached original/infoUI.swf for PT_NarutoAlpha8.13Build300')
    ffdec('-swf2xml', source, source_xml)
    tree = ET.parse(source_xml)
    tags = tree.getroot().find('tags')
    changed_fields = set()
    for tag in tags:
        cid = tag.get('characterID')
        if tag.get('type') != 'DefineEditTextTag' or cid not in spec['textFields']:
            continue
        entry = spec['textFields'][cid]
        if plain_field_text(tag) != normalize(entry['source']):
            raise ValueError(f'infoUI field {cid} source mismatch: {field_text(tag)!r}')
        replace_field_text(tag, entry['translation'], spec['font'])
        changed_fields.add(cid)
    if changed_fields != set(spec['textFields']):
        raise ValueError(f'infoUI fields missing: {sorted(set(spec["textFields"]) - changed_fields)}')

    changed_classes = {}
    for tag in tags:
        if tag.get('type') != 'DoABC2Tag' or tag.get('name') not in spec['scriptStrings']:
            continue
        class_name = tag.get('name')
        mapping = spec['scriptStrings'][class_name]
        found = {}
        for node in tag.iter('item'):
            if node.text in mapping:
                if node.text in found:
                    raise ValueError(f'Duplicate infoUI script string {class_name}: {node.text!r}')
                found[node.text] = node
        if set(found) != set(mapping):
            raise ValueError(f'Missing infoUI script strings in {class_name}: {sorted(set(mapping) - set(found))}')
        for original, translated in mapping.items():
            found[original].text = translated
        changed_classes[class_name] = mapping
    if set(changed_classes) != set(spec['scriptStrings']):
        raise ValueError('Missing infoUI script classes')

    tree.write(output_xml, encoding='utf-8', xml_declaration=True)
    ffdec('-xml2swf', output_xml, output)
    ffdec('-swf2xml', output, verified_xml)
    verified_tags = ET.parse(verified_xml).getroot().find('tags')
    verified_fields = {tag.get('characterID'): tag for tag in verified_tags if tag.get('type') == 'DefineEditTextTag'}
    for cid, entry in spec['textFields'].items():
        tag = verified_fields.get(cid)
        if tag is None or plain_field_text(tag) != normalize(entry['translation']):
            raise ValueError(f'infoUI field writeback failed: {cid}')
    for tag in verified_tags:
        if tag.get('type') != 'DoABC2Tag' or tag.get('name') not in spec['scriptStrings']:
            continue
        values = {node.text for node in tag.iter('item')}
        if not set(spec['scriptStrings'][tag.get('name')].values()) <= values:
            raise ValueError(f'infoUI string writeback failed: {tag.get("name")}')
    source_tags = ET.parse(source_xml).getroot().find('tags')
    assert len(verified_tags) == len(source_tags)
    targets = set(spec['scriptStrings'])
    for original, patched in zip(source_tags, verified_tags):
        if original.get('type') == 'DefineEditTextTag' and original.get('characterID') in spec['textFields']:
            continue
        if original.get('type') == 'DoABC2Tag' and original.get('name') in targets:
            continue
        assert semantic(original) == semantic(patched), f'Unexpected infoUI tag change: {original.attrib}'
    count = sum(map(len, spec['scriptStrings'].values()))
    add_override(spec, source, output, verified_xml, changed_fields, count)


def patch_role_profile_ui():
    spec = json.loads((ROOT / 'localization/role-profile-ui.zh-CN.json').read_text())
    source = BASE / 'original/roleProfileUI.swf'
    source_xml = BASE / 'roleProfileUI-source.xml'
    text_dir = BASE / 'roleProfileUI-text'
    output_xml = BASE / 'roleProfileUI-zh.xml'
    verified_xml = BASE / 'roleProfileUI-verified.xml'
    verified_text = BASE / 'roleProfileUI-verified-text'
    output = PACK / 'roleProfileUI.zh-CN.swf'
    if not source.exists():
        raise SystemExit('Missing cached original/roleProfileUI.swf for PT_NarutoAlpha8.43Build300')
    ffdec('-swf2xml', source, source_xml)
    ffdec('-export', 'text', text_dir, source)
    tree = ET.parse(source_xml)
    root = tree.getroot()
    tags = root.find('tags')
    template = next(tag for tag in tags if tag.get('type') == 'DefineEditTextTag' and tag.get('characterID') == '22')
    changed_fields = set()
    for index, tag in enumerate(list(tags)):
        cid = tag.get('characterID')
        if cid not in spec['textFields']:
            continue
        entry = spec['textFields'][cid]
        actual = normalize((text_dir / f'{cid}.txt').read_text())
        if actual != normalize(entry['source']):
            raise ValueError(f'roleProfileUI text {cid} source mismatch: {actual!r}')
        if tag.get('type') == 'DefineEditTextTag':
            if plain_field_text(tag) != normalize(entry['source']):
                raise ValueError(f'roleProfileUI editable field {cid} source mismatch')
            replace_field_text(tag, entry['translation'], spec['font'])
        elif tag.get('type') in ('DefineTextTag', 'DefineText2Tag'):
            replacement = copy.deepcopy(template)
            replacement.set('characterID', cid)
            bounds = copy.deepcopy(tag.find('textBounds'))
            if bounds is None:
                raise ValueError(f'roleProfileUI text {cid} has no bounds')
            bounds.tag = 'bounds'
            replacement.remove(replacement.find('bounds'))
            replacement.insert(0, bounds)
            color = '#ffffff'
            record = next(tag.iter('TEXTRECORD'), None)
            if record is not None:
                rgb = record.find('textColor')
                if rgb is not None:
                    color = '#%02x%02x%02x' % (int(rgb.get('red')), int(rgb.get('green')), int(rgb.get('blue')))
            size = entry.get('fontSize', spec['fontSize'])
            replacement.attrib.update({
                'hasFont': 'true', 'hasFontClass': 'false', 'hasText': 'true', 'hasLayout': 'true',
                'fontHeight': str(size * 20),
                'align': '2', 'leftMargin': '0', 'rightMargin': '0', 'indent': '0', 'leading': '0',
                'multiline': 'false', 'wordWrap': 'false', 'autoSize': 'false', 'noSelect': 'true',
                'readOnly': 'true', 'useOutlines': 'false', 'html': 'true', 'variableName': '',
                'initialText': f'<p align="center"><font face="{spec["font"]}" size="{size}" color="{color}">{html.escape(entry["translation"])}</font></p>'
            })
            tags.remove(tag)
            tags.insert(index, replacement)
        else:
            raise ValueError(f'Unexpected roleProfileUI text tag {cid}: {tag.get("type")}')
        changed_fields.add(cid)
    if changed_fields != set(spec['textFields']):
        raise ValueError(f'roleProfileUI fields missing: {sorted(set(spec["textFields"]) - changed_fields)}')

    root.set('compression', 'ZLIB')
    tree.write(output_xml, encoding='utf-8', xml_declaration=True)
    ffdec('-xml2swf', output_xml, output)
    ffdec('-swf2xml', output, verified_xml)
    ffdec('-export', 'text', verified_text, output)
    verified_tags = ET.parse(verified_xml).getroot().find('tags')
    if len(verified_tags) != len(tags):
        raise ValueError('roleProfileUI tag count changed')
    for cid, entry in spec['textFields'].items():
        actual = normalize((verified_text / f'{cid}.txt').read_text())
        if actual != normalize(entry['translation']):
            raise ValueError(f'roleProfileUI field writeback failed: {cid}: {actual!r}')
    targets = set(spec['textFields'])
    source_tags = ET.parse(source_xml).getroot().find('tags')
    for original, patched in zip(source_tags, verified_tags):
        if original.get('characterID') in targets:
            continue
        assert semantic(original) == semantic(patched), f'Unexpected roleProfileUI tag change: {original.attrib}'
    add_override(spec, source, output, verified_xml, changed_fields, 0)


if __name__ == '__main__':
    PACK.mkdir(parents=True, exist_ok=True)
    patch_info_ui()
    patch_role_profile_ui()
