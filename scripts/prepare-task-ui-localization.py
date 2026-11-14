"""Translate the fixed task tracker title in the exact investigated SWF."""
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
SCAN = BASE / 'resource-scan'
TOOLS = ROOT / '.test-artifacts/battle-memory-analysis/tools'
JAVA = TOOLS / 'jre/jdk-21.0.13+9-jre/Contents/Home/bin/java'
JAR = TOOLS / 'ffdec/ffdec.jar'
SOURCE = SCAN / 'inputs/ui.task.TrackPanel.swf'
PACK = BASE / 'pack'
XML = SCAN / 'ui.task.TrackPanel-zh.xml'
VERIFIED_XML = SCAN / 'ui.task.TrackPanel-verified.xml'
OUTPUT = PACK / 'TrackPanel.zh-CN.swf'
URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha6.93Build300/flash/task/ui.task.TrackPanel.swf'
TARGETS = {'57': ('Lista de missões', '任务列表'), '60': ('Lista de missões', '任务列表'), '63': ('Lista de missões', '任务列表')}

def ffdec(*args):
    subprocess.run([str(JAVA), '-Djava.awt.headless=true', '-jar', str(JAR), *map(str, args)], check=True)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

if not SOURCE.exists():
    raise SystemExit(f'Missing cached source SWF: {SOURCE}')
ffdec('-swf2xml', SOURCE, XML)
tree = ET.parse(XML)
tags = tree.getroot().find('tags')
changed = []
for i, tag in enumerate(list(tags)):
    cid = tag.get('characterID')
    if cid not in TARGETS:
        continue
    expected, translated = TARGETS[cid]
    if tag.get('type') == 'DefineEditTextTag':
        replacement = copy.deepcopy(tag)
        initial = html.unescape(replacement.get('initialText', ''))
        if expected not in initial:
            raise ValueError(f'Text {cid} source mismatch: {initial!r}')
        replacement.set('initialText', initial.replace(expected, translated))
        replacement.set('fontId', '56')
        replacement.set('initialText', re.sub(r'face="[^"]*"', 'face="PingFang SC"', replacement.get('initialText', '')))
    elif tag.get('type') in ('DefineTextTag', 'DefineText2Tag'):
        source_text = (SCAN / 'ui.task.TrackPanel-text' / f'{cid}.txt').read_text().strip()
        if source_text != expected:
            raise ValueError(f'Text {cid} version mismatch: {source_text!r}')
        # Convert device-font text while retaining the original bounds and visible color/size.
        replacement = copy.deepcopy(tag)
        for child in list(replacement):
            if child.tag == 'textRecords':
                replacement.remove(child)
        record = next((r for r in tag.findall('./textRecords/item') if r.find('textColor') is not None), None)
        color_node = record.find('textColor') if record is not None else None
        color = '#%02x%02x%02x' % tuple(int(color_node.get(k, '255')) for k in ('red', 'green', 'blue')) if color_node is not None else '#ffffff'
        size = max(8, round(int(record.get('textHeight', '240')) / 20)) if record is not None else 12
        replacement.tag = 'DefineEditTextTag'
        replacement.attrib.update({
            'hasFont': 'true', 'fontId': '56', 'fontHeight': str(size * 20), 'hasFontClass': 'false',
            'hasText': 'true', 'hasLayout': 'true', 'align': '0', 'leftMargin': '0', 'rightMargin': '0',
            'indent': '0', 'leading': '0', 'multiline': 'false', 'wordWrap': 'false', 'autoSize': 'false',
            'noSelect': 'true', 'readOnly': 'true', 'useOutlines': 'false', 'html': 'true', 'variableName': '',
            'initialText': '<p align="left"><font face="PingFang SC" size="%d" color="%s"><b>%s</b></font></p>' % (size, color, html.escape(translated))
        })
        text_bounds = replacement.find('textBounds')
        if text_bounds is not None:
            text_bounds.tag = 'bounds'
    else:
        raise ValueError(f'Unexpected tag type for {cid}: {tag.get("type")}')
    tags.remove(tag)
    tags.insert(i, replacement)
    changed.append(cid)
if set(changed) != set(TARGETS):
    raise ValueError(f'Missing text IDs: {sorted(set(TARGETS) - set(changed))}')
tree.getroot().set('compression', 'ZLIB')
tree.write(XML, encoding='utf-8', xml_declaration=True)
ffdec('-xml2swf', XML, OUTPUT)
ffdec('-swf2xml', OUTPUT, VERIFIED_XML)
verified = ET.parse(VERIFIED_XML).getroot().find('tags')
found = {}
for tag in verified:
    cid = tag.get('characterID')
    if cid in TARGETS and tag.get('type') == 'DefineEditTextTag':
        found[cid] = html.unescape(tag.get('initialText', ''))
if set(found) != set(TARGETS) or any(translated not in found[cid] for cid, (_, translated) in TARGETS.items()):
    raise ValueError(f'Patched text readback failed: {found}')
manifest_path = PACK / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
override = {
    'id': 'naruto-task-track-ui-zh-CN-v1', 'resourceURL': URL, 'file': OUTPUT.name,
    'contentType': 'application/x-shockwave-flash', 'originalSha256': digest(SOURCE),
    'patchedSha256': digest(OUTPUT), 'originalBytes': SOURCE.stat().st_size, 'patchedBytes': OUTPUT.stat().st_size,
    'textFields': [{'id': cid, 'source': source, 'translation': translation} for cid, (source, translation) in TARGETS.items()]
}
manifest['resourceOverrides'] = [item for item in manifest.get('resourceOverrides', []) if item.get('id') != override['id']] + [override]
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(json.dumps(override, ensure_ascii=False, indent=2))
