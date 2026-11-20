"""Translate fixed labels in the exact investigated task panel SWF."""
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
SOURCE = SCAN / 'inputs/ui.task.swf'
XML = SCAN / 'ui.task-zh.xml'
VERIFIED_XML = SCAN / 'ui.task-verified.xml'
OUTPUT = BASE / 'pack/ui.task.zh-CN.swf'
URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha6.93Build300/flash/task/ui.task.swf'
TARGETS = {
    '4': ('Prêmios:', '奖励：'), '42': ('Prêmios:', '奖励：'),
    '40': ('Descrição', '说明'), '41': ('Progresso', '进度'),
    '11': ('Prática no Exterior', '外出修行'), '12': ('Prática no Exterior', '外出修行'),
    '62': ('Diariamente às 5 da manhã', '每日凌晨5点重置'),
    '63': ('Quando elevar o seu nível talvez receba novas missões diárias.', '升级后可能会开启新的日常任务。'),
    '70': ('Nome do Item', '道具名称')
}

def ffdec(*args):
    subprocess.run([str(JAVA), '-Djava.awt.headless=true', '-jar', str(JAR), *map(str, args)], check=True)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def patch_edit(tag, cid, expected, translated):
    replacement = copy.deepcopy(tag)
    initial = html.unescape(replacement.get('initialText', ''))
    match = re.search(r'(<font\b[^>]*>)(.*?)(</font>)', initial, re.S)
    text = html.unescape(re.sub(r'<[^>]+>', ' ', match.group(2))).replace('\xa0', ' ') if match else initial
    if ' '.join(text.split()) != expected:
        raise ValueError(f'Text {cid} source mismatch: {initial!r}')
    if match:
        initial = initial[:match.start(2)] + html.escape(translated) + initial[match.end(2):]
    else:
        initial = translated
    replacement.set('initialText', re.sub(r'face="[^"]*"', 'face="PingFang SC"', initial))
    return replacement

def patch_static(tag, cid, expected, translated):
    source_text = (SCAN / 'ui.task-text' / f'{cid}.txt').read_text().strip()
    if source_text != expected:
        raise ValueError(f'Text {cid} version mismatch: {source_text!r}')
    record = next((r for r in tag.findall('./textRecords/item') if r.find('textColor') is not None), None)
    color_node = record.find('textColor') if record is not None else None
    color = '#%02x%02x%02x' % tuple(int(color_node.get(k, '255')) for k in ('red', 'green', 'blue')) if color_node is not None else '#ffffff'
    size = max(8, round(int(record.get('textHeight', '240')) / 20)) if record is not None else 12
    template = next(t for t in SOURCE_TAGS if t.get('characterID') == '62')
    replacement = copy.deepcopy(template)
    replacement.set('characterID', cid)
    replacement.set('initialText', '<p align="left"><font face="PingFang SC" size="%d" color="%s"><b>%s</b></font></p>' % (size, color, html.escape(translated)))
    replacement.set('fontId', '61')
    bounds = copy.deepcopy(tag.find('textBounds'))
    if bounds is None:
        raise ValueError(f'Missing text bounds for {cid}')
    bounds.tag = 'bounds'
    old_bounds = replacement.find('bounds')
    replacement.remove(old_bounds)
    replacement.insert(0, bounds)
    return replacement

if not SOURCE.exists():
    raise SystemExit(f'Missing cached source SWF: {SOURCE}')
ffdec('-swf2xml', SOURCE, XML)
tree = ET.parse(XML)
tags = tree.getroot().find('tags')
SOURCE_TAGS = list(tags)
changed = []
for i, tag in enumerate(list(tags)):
    cid = tag.get('characterID')
    if cid not in TARGETS:
        continue
    expected, translated = TARGETS[cid]
    if tag.get('type') == 'DefineEditTextTag':
        replacement = patch_edit(tag, cid, expected, translated)
    elif tag.get('type') in ('DefineTextTag', 'DefineText2Tag'):
        replacement = patch_static(tag, cid, expected, translated)
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
if set(found) != set(TARGETS) or any(translation not in found[cid] for cid, (_, translation) in TARGETS.items()):
    raise ValueError(f'Patched text readback failed: {found}')
manifest_path = BASE / 'pack/manifest.json'
manifest = json.loads(manifest_path.read_text())
override = {
    'id': 'naruto-task-detail-ui-zh-CN-v1', 'resourceURL': URL, 'file': OUTPUT.name,
    'contentType': 'application/x-shockwave-flash', 'originalSha256': digest(SOURCE),
    'patchedSha256': digest(OUTPUT), 'originalBytes': SOURCE.stat().st_size, 'patchedBytes': OUTPUT.stat().st_size,
    'textFields': [{'id': cid, 'source': source, 'translation': translation} for cid, (source, translation) in TARGETS.items()]
}
manifest['resourceOverrides'] = [item for item in manifest.get('resourceOverrides', []) if item.get('id') != override['id']] + [override]
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(json.dumps(override, ensure_ascii=False, indent=2))
