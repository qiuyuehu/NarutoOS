"""Read config bodies out of the Electron game cache while the game is running."""
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARTITIONS = ROOT / '.test-artifacts/native-core-live/host/Partitions'


def find(url_part, server):
    """Return (entry path, full URL, payload, prefix, inflated body).

    Every .cfgx payload in the cache is a one-byte marker (0xDA) followed by a
    raw deflate stream, so the marker is kept and put back when rebuilding.
    """
    best = None
    for path in PARTITIONS.glob(f'naruto-{server}-*/Cache/*_0'):
        raw = path.read_bytes()
        index = raw.find(url_part.encode())
        if index < 0:
            continue
        start = raw.rfind(b'http', 0, index)
        if start < 0:
            continue
        end = index + len(url_part)
        url = raw[start:end].decode('utf8')
        payload = raw[end:]
        for offset in range(0, 5):
            try:
                data = zlib.decompress(payload[offset:], -15)
            except Exception:
                continue
            if len(data) > 100:
                stamp = path.stat().st_mtime
                if best is None or stamp > best[0]:
                    best = (stamp, str(path), url, payload, payload[:offset], data)
                break
    if best is None:
        raise FileNotFoundError(f'{url_part} not in the {server} cache')
    return best[1:]


def deflate(data):
    compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
    return compressor.compress(data) + compressor.flush()
