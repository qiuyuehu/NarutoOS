"""Read game config rows out of a zlib-wrapped item1.pkg archive."""
import struct
import zlib
from pathlib import Path


class Reader:
    """Minimal AMF3 reader for the config row tables."""

    def __init__(self, raw):
        # The first three bytes are the external-object envelope.
        self.raw = raw
        self.pos = 3
        self.strings = []
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
        header = self.u29()
        if not header & 1:
            return self.strings[header >> 1]
        length = header >> 1
        value = self.raw[self.pos:self.pos + length].decode('utf8')
        self.pos += length
        if length:
            self.strings.append(value)
        return value

    def value(self):
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
            return self.string()
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
                value[key] = self.value()
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
            raise ValueError(f'Unsupported AMF3 value type {kind} at {self.pos - 1}')

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
            value[name] = self.value()
        if dynamic:
            while True:
                name = self.string()
                if not name:
                    break
                value[name] = self.value()
        return value


def members(pkg_path):
    raw = zlib.decompress(Path(pkg_path).read_bytes())
    cursor = 0
    while cursor < len(raw):
        length = struct.unpack_from('>H', raw, cursor)[0]
        cursor += 2
        name = raw[cursor:cursor + length].decode('utf8')
        cursor += length
        size = struct.unpack_from('>I', raw, cursor)[0]
        cursor += 4
        data = raw[cursor:cursor + size]
        if len(data) != size:
            raise ValueError('Truncated archive member')
        yield name, data
        cursor += size


def rows(pkg_path, member):
    for name, data in members(pkg_path):
        if name != member:
            continue
        reader = Reader(data)
        table = {}
        while reader.pos < len(data):
            key = reader.string()
            if not key:
                break
            table[key] = reader.value()
        return table
    raise KeyError(f'{member} not in {pkg_path}')
