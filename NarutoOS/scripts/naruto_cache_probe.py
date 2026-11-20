"""Probe the simple-cache entry layout around the .cfgx stream, read-only."""
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARTITIONS = ROOT / '.test-artifacts/native-core-live/host/Partitions'


def u32(data, off):
    return int.from_bytes(data[off:off + 4], 'little')


def u64(data, off):
    return int.from_bytes(data[off:off + 8], 'little')


def parse(path):
    raw = path.read_bytes()
    print(f'===== {path.name} size={len(raw)}')
    print('header[0:24]:', raw[:24].hex(' '))
    u = raw.find(b'https://')
    e = u
    while raw[e] in range(0x20, 0x7f) or raw[e] in (0x0d, 0x0a, 0x09):
        e += 1
    url = raw[u:e].decode()
    print(f'key: [{u}:{e}] len={e-u} {url}')
    print('header fields: time?', u64(raw, 0), 'u32@8', u32(raw, 8),
          'u32@12', u32(raw, 12), 'u32@16', u32(raw, 16), 'u32@20', u32(raw, 20))
    payload = raw[e:]
    kind = 'gzip' if payload[:2] == b'\x1f\x8b' else ('marker' if payload[0] == 0xda else '?')
    print('payload starts:', payload[:8].hex(' '), 'kind:', kind)
    if kind == 'marker':
        d = zlib.decompressobj(-15)
        out = d.decompress(payload[1:])
        consumed = len(payload) - 1 - len(d.unused_data)
        body_end = e + 1 + consumed
        print(f'deflate: consumed={consumed} inflated={len(out)} stream ends at {body_end}')
    elif kind == 'gzip':
        d = zlib.decompressobj(31)
        out = d.decompress(payload)
        consumed = len(payload) - len(d.unused_data)
        body_end = e + consumed
        print(f'gzip: consumed={consumed} inflated={len(out)} stream ends at {body_end}')
    h = raw.find(b'HTTP/1.1 200', body_end)
    print('HTTP block at', h)
    between = raw[body_end:h]
    print(f'between stream and HTTP block: {len(between)} bytes')
    print('  as u32s:', [u32(between, i) for i in range(0, min(len(between), 32), 4)])
    print('  hex:', between[:48].hex(' '))
    # find end of HTTP block: null-terminated headers then padding then EOF
    # dump everything after HTTP block start until end, in u32 words
    rest = raw[h:]
    print(f'from HTTP block to EOF: {len(rest)} bytes')
    print('  tail 40:', raw[-40:].hex(' '))
    return raw, url, body_end, h


if __name__ == '__main__':
    cache = PARTITIONS / 'naruto-br-2/Cache'
    for name in sys.argv[1:]:
        parse(cache / name)
