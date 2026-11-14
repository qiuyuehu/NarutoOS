"""Prebuild the narrowly scoped HUD sample; never touch original cache files."""
import copy
import hashlib
import html
import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / '.test-artifacts/localization-2026-11-03'
TOOLS = ROOT / '.test-artifacts/battle-memory-analysis/tools'
JAVA = TOOLS / 'jre/jdk-21.0.13+9-jre/Contents/Home/bin/java'
JAR = TOOLS / 'ffdec/ffdec.jar'
ORIGINAL = BASE / 'original/mainUI.swf'
PACK = BASE / 'pack'
SPEC = json.loads((ROOT / 'localization/hud-activities.zh-CN.json').read_text())
HUD_LABEL_TOP = -40  # Match the existing device-text fields; keep each symbol's placement matrix.
PANEL_LABELS = SPEC.get('activityPanelLabels', {})

def ffdec(*args):
    subprocess.run([str(JAVA), '-Djava.awt.headless=true', '-jar', str(JAR), *map(str, args)], check=True)

def normalized(text):
    return ' '.join(text.replace('--- RECORDSEPARATOR ---', ' ').split())

def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

started = time.monotonic()
if not ORIGINAL.exists():
    raise SystemExit('Missing investigated original/mainUI.swf; extract the exact version before preparing')
PACK.mkdir(parents=True, exist_ok=True)
ffdec('-swf2xml', ORIGINAL, BASE / 'mainui-source.xml')
ffdec('-export', 'text', BASE / 'source-texts', ORIGINAL)
tree = ET.parse(BASE / 'mainui-source.xml')
swf = tree.getroot()
tags = swf.find('tags')
template = next(t for t in tags if t.get('type') == 'DefineEditTextTag' and t.get('characterID') == '1835')
changed = []
for i, tag in enumerate(list(tags)):
    cid = tag.get('characterID')
    is_panel_label = cid in PANEL_LABELS
    if cid not in SPEC['labels'] and not is_panel_label:
        continue
    expected, translated = PANEL_LABELS[cid] if is_panel_label else SPEC['labels'][cid]
    actual = normalized((BASE / 'source-texts' / (cid + '.txt')).read_text())
    if actual != normalized(expected):
        raise ValueError(f'Text {cid} version mismatch: {actual!r}')
    if is_panel_label and tag.get('type') == 'DefineEditTextTag':
        replacement = copy.deepcopy(tag)
        initial = html.unescape(replacement.get('initialText', ''))
        if expected not in initial:
            raise ValueError(f'Panel text {cid} does not contain expected source')
        initial = initial.replace(expected, translated)
        initial = re.sub(r'<p\b([^>]*)align="(?:left|right|center)"', r'<p\1align="center"', initial)
        initial = re.sub(r'face="[^"]*"', 'face="' + SPEC['font'] + '"', initial)
        replacement.set('initialText', initial)
        replacement.set('align', '2')
        replacement.set('fontId', '16')
    elif tag.get('type') == 'DefineEditTextTag':
        replacement = copy.deepcopy(tag)
        bounds = replacement.find('bounds')
        initial = replacement.get('initialText', '')
        initial = re.sub(r'<p\b([^>]*)align="(?:left|right|center)"', r'<p\1align="center"', initial)
        replacement.set('initialText', initial)
        replacement.set('align', '2')
    elif tag.get('type') in ('DefineTextTag', 'DefineText2Tag'):
        replacement = copy.deepcopy(template)
        replacement.set('characterID', cid)
        replacement.remove(replacement.find('bounds'))
        bounds = copy.deepcopy(tag.find('textBounds'))
        bounds.tag = 'bounds'
        replacement.insert(0, bounds)
        if is_panel_label:
            record = next((r for r in tag.findall('./textRecords/item') if r.find('textColor') is not None), None)
            color = record.find('textColor') if record is not None else None
            rgb = '#%02x%02x%02x' % (int(color.get('red', '255')), int(color.get('green', '255')), int(color.get('blue', '255')))
            size = max(8, round(int(record.get('textHeight', '240')) / 20)) if record is not None else 12
            replacement.set('align', '2')
            replacement.set('fontHeight', str(size * 20))
            replacement.set('initialText', '<p align="center"><font face="' + SPEC['font'] + '" size="' + str(size) + '" color="' + rgb + '"><b>' + html.escape(translated) + '</b></font></p>')
    else:
        raise ValueError(f'Unexpected tag type for {cid}')
    if not (is_panel_label and tag.get('type') == 'DefineEditTextTag'):
        # Device text uses the installed Chinese font. Keep activity-panel labels
        # within their original text bounds; HUD icons need the existing offset.
        if not is_panel_label:
            left, right = int(bounds.get('Xmin')), int(bounds.get('Xmax'))
            width = max(right - left, 1280)
            middle = (left + right) // 2
            bounds.set('Xmin', str(middle - width // 2))
            bounds.set('Xmax', str(middle + width // 2))
            bounds.set('Ymin', str(HUD_LABEL_TOP))
            bounds.set('Ymax', str(max(int(bounds.get('Ymax')), HUD_LABEL_TOP + 400)))
        if not is_panel_label:
            replacement.attrib.update({
                'hasFont': 'true', 'fontId': '16', 'fontHeight': '240', 'hasFontClass': 'false',
                'hasText': 'true', 'hasLayout': 'true', 'align': '2', 'leftMargin': '0',
                'rightMargin': '0', 'indent': '0', 'leading': '0', 'multiline': 'false',
                'wordWrap': 'false', 'autoSize': 'false', 'noSelect': 'true', 'readOnly': 'true',
                'useOutlines': 'false', 'html': 'true', 'variableName': '',
                'initialText': '<p align="center"><font face="' + SPEC['font'] + '" size="12" color="#ffffff"><b>'
                               + html.escape(translated) + '</b></font></p>'
            })
    tags.remove(tag)
    tags.insert(i, replacement)
    changed.append(cid)
if set(changed) != set(SPEC['labels']) | set(PANEL_LABELS):
    raise ValueError('Missing translation targets')
swf.set('compression', 'ZLIB')
tree.write(BASE / 'mainui-zh.xml', encoding='utf-8', xml_declaration=True)
ffdec('-xml2swf', BASE / 'mainui-zh.xml', PACK / 'mainUI.zh-CN.swf')
ffdec('-swf2xml', PACK / 'mainUI.zh-CN.swf', BASE / 'mainui-verified.xml')
verified = ET.parse(BASE / 'mainui-verified.xml').getroot().find('tags')
source = ET.parse(BASE / 'mainui-source.xml').getroot().find('tags')
assert len(verified) == len(source)
def semantic(tag):
    result = copy.deepcopy(tag)
    # FFDec recalculates encoding widths/file positions when serializing XML.
    for element in result.iter():
        for name in ('nbits', 'fileOffset', 'moveBits', 'numFillBits', 'nScaleBits'):
            element.attrib.pop(name, None)
    return ET.tostring(result)
for a, b in zip(source, verified):
    if a.get('characterID') not in set(SPEC['labels']) | set(PANEL_LABELS):
        assert semantic(a) == semantic(b), f'Unexpected change: {a.attrib}'
symbols = {}
for tag in source:
    if tag.get('type') == 'SymbolClassTag':
        symbols.update({int(c.text): n.text for c, n in zip(tag.find('tags'), tag.find('names'))})
items = []
for cid, pair in SPEC['labels'].items():
    parent = next(t for t in source if t.get('type') == 'DefineSpriteTag' and any(
        p.get('characterId') == cid and p.get('type', '').startswith('PlaceObject') for p in t.iter()))
    sprite_id = int(parent.get('spriteId'))
    items.append({'id': cid, 'symbol': symbols.get(sprite_id, f'sprite-{sprite_id}'), 'source': pair[0], 'translation': pair[1]})
(PACK / 'preview-items.json').write_text(json.dumps(items, ensure_ascii=False))
manifest = {
    'id': SPEC['id'], 'resourceURL': SPEC['resourceURL'], 'labelCount': len(changed),
    'originalSha256': digest(ORIGINAL), 'patchedSha256': digest(PACK / 'mainUI.zh-CN.swf'),
    'originalBytes': ORIGINAL.stat().st_size, 'patchedBytes': (PACK / 'mainUI.zh-CN.swf').stat().st_size,
    'font': SPEC['font'], 'buildSeconds': round(time.monotonic() - started, 3), 'changedCharacterIds': changed
}
(PACK / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-crew-ui-localization.py')], check=True)
subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-character-panels-localization.py')], check=True)
subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-season-localization.py')], check=True)
subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-task-ui-localization.py')], check=True)
subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-task-detail-ui-localization.py')], check=True)
subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-daily-training-localization.py')], check=True)
print(json.dumps(manifest, ensure_ascii=False, indent=2))
