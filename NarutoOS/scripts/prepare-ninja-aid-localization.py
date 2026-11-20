"""Patch the ninja-aid skill config with the CN wording.

Source: BR config/ninjaAid/NinjaAidSkillCFG.cfgx from the running game cache.
Translations: CN NinjaAidSkillCFG rows with the same id.
"""
import hashlib
import json
import re
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import naruto_cache

ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / 'assets/localization/pack'
CATALOG = ROOT / 'localization/ninja-aid-skills.zh-CN.json'
URL_PART = '/config/ninjaAid/NinjaAidSkillCFG.cfgx'
FIELDS = ('ninjaName', 'tips', 'description')
OUTPUT_NAME = 'NinjaAidSkillCFG.zh-CN.cfgx'


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
            self.byte()
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
            raise ValueError(f'Unexpected externalizable record {class_name!r}')
        for name in names:
            value[name] = self.value(value, name)
        if dynamic:
            while True:
                name = self.string()
                if not name:
                    break
                value[name] = self.value(value, name)
        return value


def read_rows(raw):
    reader = Reader(raw)
    rows = {}
    while reader.pos < len(raw):
        key = reader.string()
        if not key:
            break
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
    expected = __import__('copy').deepcopy(without_spans(rows))
    replacements = {}
    entries = []
    for row_id, fields in config['rows'].items():
        row = rows[row_id]
        for field, entry in fields.items():
            if row.get(field) != entry['source']:
                raise ValueError(f'Source mismatch: {row_id} {field}')
            start, _ = row['_spans'][field]
            replacements[start + 1] = entry['translation']
            expected[row_id][field] = entry['translation']
            entries.append({'rowId': row_id, 'field': field, **entry})

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
        raise ValueError('Full config verification failed')
    return patched, entries


def main():
    _, br_url, br_payload, br_prefix, br_raw = naruto_cache.find(URL_PART, 'br')
    _, _, _, _, cn_raw = naruto_cache.find(URL_PART, 'cn')
    br_rows, _ = read_rows(br_raw)
    cn_rows, _ = read_rows(cn_raw)

    def has_cjk(value):
        return isinstance(value, str) and re.search(r'[一-鿿]', value)

    catalog = {'id': 'naruto-ninja-aid-skills-zh-CN-v1', 'class': 'NinjaAidSkillCFG',
               'resourceURL': br_url, 'rows': {}}
    for row_id, row in br_rows.items():
        target = cn_rows.get(row_id)
        if not target:
            continue
        fields = {}
        for field in FIELDS:
            source = row.get(field)
            translation = target.get(field)
            if isinstance(source, str) and source.strip() and has_cjk(translation):
                fields[field] = {'source': source, 'translation': translation}
        if fields:
            catalog['rows'][row_id] = fields

    if not catalog['rows']:
        raise SystemExit('No CN rows matched')
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=1))

    patched, entries = patch_rows(br_raw, catalog)
    body = br_prefix + naruto_cache.deflate(patched)
    (PACK / OUTPUT_NAME).write_bytes(body)

    manifest_path = PACK / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    override = {
        'id': catalog['id'], 'resourceURL': br_url, 'file': OUTPUT_NAME,
        'contentType': 'application/octet-stream',
        'originalSha256': hashlib.sha256(br_payload).hexdigest(),
        'patchedSha256': hashlib.sha256(body).hexdigest(),
        'originalBytes': len(br_payload), 'patchedBytes': len(body),
        'entries': entries,
    }
    overrides = [item for item in manifest.get('resourceOverrides', []) if item.get('id') != override['id']]
    overrides.append(override)
    manifest['resourceOverrides'] = overrides
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps({'rows': len(catalog['rows']), 'entries': len(entries),
                      'bytes': len(body), 'resourceURL': br_url}, ensure_ascii=False))


if __name__ == '__main__':
    main()
