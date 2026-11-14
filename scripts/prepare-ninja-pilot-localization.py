"""Patch the Madara (Final Valley) pilot by exact config row IDs."""
import hashlib
import json
import copy
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / '.test-artifacts/localization-2026-11-03'
SOURCE_DIR = BASE / 'ninja-research'
PACK = BASE / 'pack'
SPEC = json.loads((ROOT / 'localization/ninja-madara-final-valley.zh-CN.json').read_text())
# All requested ninja catalogs share the same two confirmed runtime resources.
# Merge before patching so each resource is rebuilt once for the whole batch.
for catalog in sorted((ROOT / 'localization').glob('ninja-target-*.zh-CN.json')):
    extra = json.loads(catalog.read_text())
    for section in ('ninjaInfo', 'skills', 'skillDetails'):
        for row_id, fields in extra[section]['rows'].items():
            target = SPEC[section]['rows'].setdefault(row_id, {})
            for field, entry in fields.items():
                if entry['source'] and not entry['translation']:
                    raise ValueError(f'Untranslated field: {catalog.name} {row_id} {field}')
                if field in target and target[field] != entry:
                    raise ValueError(f'Conflicting translation: {catalog.name} {row_id} {field}')
                target[field] = entry



def u29_bytes(value):
    if value < 0x80:
        return bytes([value])
    if value < 0x4000:
        return bytes([(value >> 7) | 0x80, value & 0x7f])
    if value < 0x200000:
        return bytes([(value >> 14) | 0x80, ((value >> 7) & 0x7f) | 0x80, value & 0x7f])
    return bytes([(value >> 22) | 0x80, ((value >> 15) & 0x7f) | 0x80,
                  ((value >> 8) & 0x7f) | 0x80, value & 0xff])


class Reader:
    def __init__(self, raw):
        # The three-byte AMF external-object envelope is followed by an ID/object stream.
        self.raw = raw
        self.pos = 3
        self.strings = []
        self.string_spans = []
        self.objects = [{}]
        self.traits = [('', True, [], False)]

    def byte(self):
        value = self.raw[self.pos]
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

    def string(self):
        start = self.pos
        header = self.u29()
        if not header & 1:
            value = self.strings[header >> 1]
        else:
            length = header >> 1
            value = self.raw[self.pos:self.pos + length].decode('utf8')
            self.pos += length
            if length:
                self.strings.append(value)
        self.string_spans.append((start, self.pos, value))
        return value

    def value(self, parent=None, property_name=None):
        start = self.pos
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
            value = struct.unpack('>d', self.raw[self.pos:self.pos + 8])[0]
            self.pos += 8
            return value
        if kind == 6:
            value = self.string()
            if parent is not None:
                parent.setdefault('_spans', {})[property_name] = (start, self.pos)
            return value
        if kind == 9:
            header = self.u29()
            if not header & 1:
                return self.objects[header >> 1]
            count = header >> 1
            value = {}
            self.objects.append(value)
            while True:
                key = self.string()
                if not key:
                    break
                value[key] = self.value(value, key)
            value['_dense'] = [self.value() for _ in range(count)]
            return value
        if kind == 17:
            header = self.u29()
            if not header & 1:
                return self.objects[header >> 1]
            self.byte()  # weak keys
            value = {}
            self.objects.append(value)
            for _ in range(header >> 1):
                key = self.value()
                value[str(key)] = self.value()
            return value
        if kind != 10:
            raise ValueError(f'Unsupported AMF3 value type {kind} at {start}')

        header = self.u29()
        if not header & 1:
            return self.objects[header >> 1]
        if header & 2:
            trait = (self.string(), bool(header & 8),
                     [self.string() for _ in range(header >> 4)], bool(header & 4))
            self.traits.append(trait)
        else:
            trait = self.traits[header >> 2]
        class_name, dynamic, names, externalizable = trait
        value = {'_class': class_name} if class_name else {}
        self.objects.append(value)
        if externalizable:
            raise ValueError(f'Unexpected externalizable config record {class_name!r}')
        for name in names:
            value[name] = self.value(value, name)
        if dynamic:
            while True:
                name = self.string()
                if not name:
                    break
                value[name] = self.value(value, name)
        return value


def encode_amf_string(value):
    encoded = value.encode('utf8')
    return b'\x06' + u29_bytes((len(encoded) << 1) | 1) + encoded


def read_rows(raw):
    reader = Reader(raw)
    rows = {}
    while reader.pos < len(raw):
        key = reader.string()
        if not key:
            break
        if key in rows:
            raise ValueError(f'Duplicate config key {key}')
        rows[key] = reader.value()
    if reader.pos != len(raw):
        raise ValueError('Trailing config data')
    return rows, reader


def without_spans(value):
    if isinstance(value, dict):
        return {key: without_spans(item) for key, item in value.items() if key != '_spans'}
    if isinstance(value, list):
        return [without_spans(item) for item in value]
    return value


def patch_rows(raw, config):
    rows, reader = read_rows(raw)
    expected = copy.deepcopy(without_spans(rows))
    replacements = {}
    entries = []
    for row_id, fields in config['rows'].items():
        row = rows[row_id]
        if row.get('_class') != config['class'] or str(row.get('id')) != row_id:
            raise ValueError(f'Config class/id mismatch: {row_id}')
        for field, entry in fields.items():
            if row.get(field) != entry['source']:
                raise ValueError(f'Config source mismatch: {row_id} {field}')
            start, _ = row['_spans'][field]
            replacements[start + 1] = entry['translation']
            expected[row_id][field] = entry['translation']
            entries.append({'rowId': row_id, 'field': field, **entry})

    # Rewrite every string occurrence using a new string table. Copying only a
    # target's inline bytes also changes later references to the original string;
    # expanding a reference alone shifts every subsequent string-table index.
    strings = {}
    pieces = []
    cursor = 0
    for start, end, original in reader.string_spans:
        value = replacements.get(start, original)
        if not value:
            encoded = b'\x01'
        elif value in strings:
            encoded = u29_bytes(strings[value] << 1)
        else:
            strings[value] = len(strings)
            data = value.encode('utf8')
            encoded = u29_bytes((len(data) << 1) | 1) + data
        pieces.extend((raw[cursor:start], encoded))
        cursor = end
    pieces.append(raw[cursor:])
    patched = b''.join(pieces)
    actual, _ = read_rows(patched)
    if without_spans(actual) != expected:
        raise ValueError('Full config verification failed, including untargeted rows')
    return patched, entries


def override(config, original, patched, entries):
    (PACK / config['file']).write_bytes(patched)
    return {
        'id': config['id'], 'resourceURL': config['resourceURL'], 'file': config['file'],
        'contentType': 'application/octet-stream',
        'originalSha256': hashlib.sha256(original).hexdigest(),
        'patchedSha256': hashlib.sha256(patched).hexdigest(),
        'originalBytes': len(original), 'patchedBytes': len(patched), 'entries': entries,
    }


def main():
    original = (SOURCE_DIR / 'item1.pkg').read_bytes()
    raw = zlib.decompress(original)
    cursor = 0
    pieces = []
    entries = []
    configs = {'config/skill/SkillCFG.cfg': SPEC['skills'],
               'config/user/NinjaInfoCFG.cfg': SPEC['ninjaInfo']}
    seen = set()
    while cursor < len(raw):
        start = cursor
        length = struct.unpack_from('>H', raw, cursor)[0]
        cursor += 2
        name = raw[cursor:cursor + length].decode('utf8')
        cursor += length
        size = struct.unpack_from('>I', raw, cursor)[0]
        cursor += 4
        data = raw[cursor:cursor + size]
        if len(data) != size:
            raise ValueError('Truncated archive member')
        if name in configs:
            data, changes = patch_rows(data, configs[name])
            entries.extend({'member': name, **entry} for entry in changes)
            seen.add(name)
        pieces.extend((raw[start:cursor - 4], struct.pack('>I', len(data)), data))
        cursor += size
    if seen != set(configs):
        raise ValueError('Missing archive member')
    archive = {
        'id': SPEC['id'] + '-archive', 'file': 'item1.madara-zh-CN.pkg',
        'resourceURL': 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.37Build301/config/archives/item1.pkg',
    }
    overrides = [override(archive, original, zlib.compress(b''.join(pieces), 9), entries)]
    config = {**SPEC['skillDetails'], 'id': SPEC['id'] + '-skill-details'}
    original = (SOURCE_DIR / 'SkillKeyDescCFG.cfg').read_bytes()
    patched, entries = patch_rows(zlib.decompress(original), config)
    overrides.append(override(config, original, zlib.compress(patched, 9), entries))
    manifest_path = PACK / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    manifest['resourceOverrides'] = [item for item in manifest.get('resourceOverrides', [])
        if not item.get('id', '').startswith(SPEC['id'])] + overrides
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps({'pilot': SPEC['id'], 'resources': [
        {'file': item['file'], 'fields': len(item['entries']), 'bytes': item['patchedBytes']}
        for item in overrides]}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
