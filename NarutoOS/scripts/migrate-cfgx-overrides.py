"""Re-wrap the three cfg overrides as real .cfg zlib bodies on the URLs the
game actually requests (the .cfgx forms came from a URL-parsing artifact that
glued the zlib header byte 0x78 onto '.cfg')."""
import json
import hashlib
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / 'assets/localization/pack'
CACHE = ROOT / '.test-artifacts/native-core-live/host/Partitions/naruto-br-2/Cache'

TARGETS = [
    {
        'key': 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.35Build301/config/ninjaAid/NinjaAidSkillCFG.cfg',
        'old_file': 'NinjaAidSkillCFG.zh-CN.cfgx', 'new_file': 'NinjaAidSkillCFG.zh-CN.cfg',
    },
    {
        'key': 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.31Build300/config/throughTheBeast/SummonMonsterCFG.cfg',
        'old_file': 'SummonMonsterCFG.zh-CN.cfgx', 'new_file': 'SummonMonsterCFG.zh-CN.cfg',
    },
    {
        'key': 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.31Build300/config/throughTheBeast/BeastDevelopSkillCFG.cfg',
        'old_file': 'BeastDevelopSkillCFG.zh-CN.cfgx', 'new_file': 'BeastDevelopSkillCFG.zh-CN.cfg',
    },
]


def cached_stream(key):
    name = hashlib.sha1(key.encode()).digest()[:8][::-1].hex() + '_0'
    raw = (CACHE / name).read_bytes()
    klen = int.from_bytes(raw[12:16], 'little')
    assert raw[24:24 + klen].decode() == key, f'key mismatch in {name}'
    stream_start = 24 + klen
    d = zlib.decompressobj()
    out = d.decompress(raw[stream_start:])
    consumed = len(raw) - stream_start - len(d.unused_data)
    return raw[stream_start:stream_start + consumed], out


for target in TARGETS:
    old = (PACK / target['old_file']).read_bytes()
    assert old[0] == 0xda, target['old_file']
    body = zlib.decompress(old[1:], -15)
    new = zlib.compress(body, 9)
    assert zlib.decompress(new) == body
    (PACK / target['new_file']).write_bytes(new)
    (PACK / target['old_file']).unlink()
    original, original_out = cached_stream(target['key'])
    assert zlib.decompress(original) == original_out
    target.update({
        'resourceURL': target['key'],
        'patchedSha256': hashlib.sha256(new).hexdigest(),
        'patchedBytes': len(new),
        'originalSha256': hashlib.sha256(original).hexdigest(),
        'originalBytes': len(original),
    })
    print(target['new_file'], 'patched', len(new), 'original stream', len(original),
          'original inflated', len(original_out))

manifest_path = PACK / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
for item in manifest['resourceOverrides']:
    for target in TARGETS:
        if item.get('file') == target['old_file']:
            item['resourceURL'] = target['resourceURL']
            item['file'] = target['new_file']
            item['originalSha256'] = target['originalSha256']
            item['originalBytes'] = target['originalBytes']
            item['patchedSha256'] = target['patchedSha256']
            item['patchedBytes'] = target['patchedBytes']
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print('manifest updated')
