"""Patch only selected TranslatedKeyCFG AMF3 word strings; preserve every other byte."""
import hashlib
import json
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / '.test-artifacts/localization-2026-11-03'
SOURCE = BASE / 'original/TranslatedKeyCFG.cfg'
PACK = BASE / 'pack'
SPECS = [json.loads((ROOT / f'localization/{name}').read_text()) for name in (
    'season-activity.zh-CN.json', 'character-panel.zh-CN.json', 'task-ui.zh-CN.json',
    'friend-ui.zh-CN.json', 'daily-training.zh-CN.json')]
SPEC = {'resourceURL': SPECS[0]['resourceURL'], 'entries': {}}
for catalog in SPECS:
    if catalog['resourceURL'] != SPEC['resourceURL']:
        raise ValueError('TranslatedKeyCFG catalogs target different resources')
    duplicate = set(SPEC['entries']) & set(catalog['entries'])
    if duplicate:
        raise ValueError(f'Duplicate TranslatedKeyCFG IDs: {sorted(duplicate)}')
    SPEC['entries'].update(catalog['entries'])
OUTPUT = PACK / 'TranslatedKeyCFG.zh-CN.cfg'


def u29_bytes(value):
    if value < 0x80:
        return bytes([value])
    if value < 0x4000:
        return bytes([(value >> 7) | 0x80, value & 0x7f])
    if value < 0x200000:
        return bytes([(value >> 14) | 0x80, ((value >> 7) & 0x7f) | 0x80, value & 0x7f])
    if value < 0x20000000:
        return bytes([(value >> 22) | 0x80, ((value >> 15) & 0x7f) | 0x80,
                      ((value >> 8) & 0x7f) | 0x80, value & 0xff])
    raise ValueError('AMF3 string exceeds the inline U29 length limit')


class Reader:
    def __init__(self, data, targets):
        self.data = data
        self.pos = 0
        self.strings = []
        self.string_spans = {}
        self.objects = []
        self.traits = []
        self.targets = targets
        self.patches = {}
        self.target_words = {}
        self.word_rows = {}

    def byte(self):
        value = self.data[self.pos]
        self.pos += 1
        return value

    def u29(self):
        value = 0
        for index in range(4):
            part = self.byte()
            if index == 3:
                return (value << 8) | part
            value = (value << 7) | (part & 0x7f)
            if part < 0x80:
                return value
        raise ValueError('Invalid AMF3 U29')

    def string_value(self):
        start = self.pos
        header = self.u29()
        if not header & 1:
            index = header >> 1
            return self.strings[index], None, index
        length = header >> 1
        end = self.pos + length
        value = self.data[self.pos:end].decode('utf8')
        self.pos = end
        index = None
        if length:
            index = len(self.strings)
            self.strings.append(value)
            self.string_spans[index] = (start, self.pos)
        return value, (start, self.pos), index

    def string(self):
        return self.string_value()[0]

    def value(self, parent=None, property_name=None):
        kind = self.byte()
        if kind in (0, 1):
            return None
        if kind in (2, 3):
            return kind == 3
        if kind == 4:
            number = self.u29()
            return number - (1 << 29) if number & (1 << 28) else number
        if kind == 5:
            import struct
            result = struct.unpack('>d', self.data[self.pos:self.pos + 8])[0]
            self.pos += 8
            return result
        if kind == 6:
            value, span, string_index = self.string_value()
            if property_name == 'word' and parent and parent.get('_class') == 'TranslatedKeyCFG':
                key = parent.get('id')
                if key in self.word_rows:
                    raise ValueError(f'{key} word occurs more than once')
                self.word_rows[key] = (value, string_index)
                if key in self.targets:
                    expected = self.targets[key]['source']
                    if value != expected:
                        raise ValueError(f'{key} source mismatch: {value!r}')
                    if string_index is None:
                        raise ValueError(f'{key} word is an empty AMF3 string')
                    encoded = self.targets[key]['translation'].encode('utf8')
                    replacement = u29_bytes((len(encoded) << 1) | 1) + encoded
                    previous = self.patches.get(string_index)
                    if previous and previous[2] != replacement:
                        raise ValueError(f'AMF3 shared word has conflicting translations: {value!r}')
                    if span is not None:
                        self.patches[string_index] = (*span, replacement)
                    elif previous is None:
                        self.patches[string_index] = (None, None, replacement)
                    self.target_words[key] = string_index
            return value
        if kind != 10:
            raise ValueError(f'Unsupported AMF3 value type {kind} at {self.pos - 1}')
        header = self.u29()
        if not header & 1:
            return self.objects[header >> 1]
        if header & 2:
            if header & 4:
                raise ValueError('Externalizable AMF objects are not supported')
            trait = (self.string(), bool(header & 8), [self.string() for _ in range(header >> 4)])
            self.traits.append(trait)
        else:
            trait = self.traits[header >> 2]
        class_name, dynamic, names = trait
        result = {}
        self.objects.append(result)
        if class_name:
            result['_class'] = class_name
        for name in names:
            result[name] = self.value(result, name)
        if dynamic:
            while True:
                name = self.string()
                if not name:
                    break
                result[name] = self.value(result, name)
        return result


def digest(data):
    return hashlib.sha256(data).hexdigest()


compressed = SOURCE.read_bytes()
raw = zlib.decompress(compressed)
if zlib.compress(raw, 9)[:2] != compressed[:2]:
    raise ValueError('Unexpected TranslatedKeyCFG compression header')
reader = Reader(raw, SPEC['entries'])
reader.value()
if reader.pos != len(raw):
    raise ValueError(f'AMF3 trailing bytes: {len(raw) - reader.pos}')
if set(reader.target_words) != set(SPEC['entries']):
    raise ValueError(f'Missing patch targets: {sorted(set(SPEC["entries"]) - set(reader.target_words))}')
shared_conflicts = {}
for key, (_, string_index) in reader.word_rows.items():
    if string_index in reader.patches and key not in SPEC['entries']:
        shared_conflicts.setdefault(string_index, []).append(key)
if shared_conflicts:
    raise ValueError(f'AMF3 shared words have untargeted TranslatedKeyCFG IDs: {shared_conflicts}')
for string_index, (start, end, replacement) in list(reader.patches.items()):
    if start is None:
        span = reader.string_spans.get(string_index)
        if span is None:
            raise ValueError('AMF3 shared word has no inline source string')
        reader.patches[string_index] = (*span, replacement)

pieces = []
cursor = 0
for _, (start, end, replacement) in sorted(reader.patches.items(), key=lambda item: item[1][0]):
    pieces.extend((raw[cursor:start], replacement))
    cursor = end
pieces.append(raw[cursor:])
patched_raw = b''.join(pieces)
patched = zlib.compress(patched_raw, 9)

verify = Reader(zlib.decompress(patched), {
    key: {'source': value['translation'], 'translation': value['translation']}
    for key, value in SPEC['entries'].items()
})
verify.value()
if verify.pos != len(patched_raw) or set(verify.target_words) != set(SPEC['entries']):
    raise ValueError('AMF3 writeback verification failed')
PACK.mkdir(parents=True, exist_ok=True)
OUTPUT.write_bytes(patched)

manifest_path = PACK / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
table_override = {
    'id': 'naruto-translated-key-cfg-zh-CN-v1',
    'resourceURL': SPEC['resourceURL'],
    'file': OUTPUT.name,
    'contentType': 'application/octet-stream',
    'originalSha256': digest(compressed),
    'patchedSha256': digest(patched),
    'originalBytes': len(compressed),
    'patchedBytes': len(patched),
    'entries': [
        {'id': key, 'source': value['source'], 'translation': value['translation']}
        for key, value in SPEC['entries'].items()
    ]
}
overrides = [item for item in manifest.get('resourceOverrides', []) if item.get('id') != table_override['id']]
overrides.append(table_override)
manifest['resourceOverrides'] = overrides
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(json.dumps(table_override, ensure_ascii=False, indent=2))
