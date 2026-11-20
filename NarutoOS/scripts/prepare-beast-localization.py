"""Patch the summon-beast configs with the CN wording.

Sources: BR config/throughTheBeast/*.cfgx from the running game cache.
Translations: CN rows with the same id, plus hand-written labels for the few
rows the CN build does not carry.
"""
import hashlib
import importlib.util
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
import sys
sys.path.insert(0, str(HERE))
import naruto_cache

_loader = importlib.util.spec_from_file_location('ninjaaid', HERE / 'prepare-ninja-aid-localization.py')
_amf = importlib.util.module_from_spec(_loader)
_loader.loader.exec_module(_amf)
read_rows = _amf.read_rows
patch_rows = _amf.patch_rows

ROOT = HERE.parent
PACK = ROOT / 'assets/localization/pack'

# CN build lacks these growth labels; wording follows the CN skill terminology.
LABELS = {
    'Absorver Chakra': '吸收查克拉',
    'Aumento da Marca': '印记强化',
    'Aumento da Resistência': '抗性提升',
    'Causa Cagueira extra': '额外造成腹泻',
    'Causa Confusão Grave': '造成重度混乱',
    'Causa Lentidão': '造成减速',
    'Causa Lentidão Extrema': '造成极减速',
    'Causa Toxicidade extra': '额外造成中毒',
    'Diminuição resfr. inicial': '初始冷却减少',
    'Eliminuje Inicjatywę': '消除先攻',
    'Perseguição da equipe sempre acerta': '小队追打必定命中',
    'Quebrar defesa': '破防',
    'Reduzir Dano de Habilidade Esotérica': '降低奥义伤害',
    'Redução de Dano Esotérico': '奥义伤害减免',
    'Remoção de status neg.': '移除负面状态',
    'Supressão de Armadura': '护甲压制',
}

TARGETS = [
    {
        'url_part': '/config/throughTheBeast/SummonMonsterCFG.cfgx',
        'catalog': 'localization/beast-monsters.zh-CN.json',
        'id': 'naruto-beast-monsters-zh-CN-v1',
        'file': 'SummonMonsterCFG.zh-CN.cfgx',
        'fields': ('name', 'skillName', 'desc'),
    },
    {
        'url_part': '/config/throughTheBeast/BeastDevelopSkillCFG.cfgx',
        'catalog': 'localization/beast-skills.zh-CN.json',
        'id': 'naruto-beast-skills-zh-CN-v1',
        'file': 'BeastDevelopSkillCFG.zh-CN.cfgx',
        'fields': ('promp',),
    },
]


def has_cjk(value):
    return isinstance(value, str) and re.search(r'[一-鿿]', value)


def build_catalog(target, br_rows, cn_rows):
    rows = {}
    for row_id, row in br_rows.items():
        cn_row = cn_rows.get(row_id)
        fields = {}
        for field in target['fields']:
            source = row.get(field)
            if not isinstance(source, str) or not source.strip():
                continue
            translation = (cn_row or {}).get(field)
            if not has_cjk(translation):
                translation = LABELS.get(source.replace('\xa0', ' '))
            if not has_cjk(translation):
                continue
            fields[field] = {'source': source, 'translation': translation}
        if fields:
            rows[row_id] = fields
    return rows


def main():
    manifest_path = PACK / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    summary = []
    for target in TARGETS:
        _, url, br_payload, br_prefix, br_raw = naruto_cache.find(target['url_part'], 'br')
        _, _, _, _, cn_raw = naruto_cache.find(target['url_part'], 'cn')
        br_rows, _ = read_rows(br_raw)
        cn_rows, _ = read_rows(cn_raw)
        catalog = {'id': target['id'], 'class': target['url_part'].rsplit('/', 1)[-1].split('.')[0],
                   'resourceURL': url,
                   'rows': build_catalog(target, br_rows, cn_rows)}
        (ROOT / target['catalog']).write_text(json.dumps(catalog, ensure_ascii=False, indent=1))

        patched, entries = patch_rows(br_raw, catalog)
        body = br_prefix + naruto_cache.deflate(patched)
        (PACK / target['file']).write_bytes(body)
        override = {
            'id': target['id'], 'resourceURL': url, 'file': target['file'],
            'contentType': 'application/octet-stream',
            'originalSha256': hashlib.sha256(br_payload).hexdigest(),
            'patchedSha256': hashlib.sha256(body).hexdigest(),
            'originalBytes': len(br_payload), 'patchedBytes': len(body),
            'entries': entries,
        }
        overrides = [item for item in manifest.get('resourceOverrides', []) if item.get('id') != override['id']]
        overrides.append(override)
        manifest['resourceOverrides'] = overrides
        summary.append({'rows': len(catalog['rows']), 'entries': len(entries),
                        'bytes': len(body), 'url': url})

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
