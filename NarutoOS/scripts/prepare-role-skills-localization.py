"""Build the role-skill name catalog from the CN official config.

Source: BR item1.pkg (PT_NarutoAlpha9.40Build300) SkillCFG rows whose ids start
with 21/29 (the player character's talent skills).
Translations: CN item1.pkg SkillCFG rows with the same id.

Rows already translated by another catalog are skipped so earlier batches keep
their accepted wording. Duplicate source names collapse to the most frequent CN
wording because AMF stores one copy per distinct string.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import naruto_pkg

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / '.test-artifacts'
BR_PKG = BASE / 'localization-2026-11-03/ninja-research/item1-9.40Build300.pkg'
CN_PKG = BASE / 'localization-2026-11-18/original/cn/item1.pkg'
OUT = ROOT / 'localization/role-skills.zh-CN.json'
MEMBER = 'config/skill/SkillCFG.cfg'
PREFIXES = ('20', '21', '29', '30', '39')
# CN has no row for this one; wording follows the CN 木遁 skill naming.
MANUAL = {'Estilo Madeira: Shinra Bansho': '木遁·神罗万象'}


def has_cjk(value):
    return isinstance(value, str) and re.search(r'[一-鿿]', value)


def load_rows(pkg):
    data = naruto_pkg.rows(pkg, MEMBER)
    return {rid: row.get('name') for rid, row in data.items()}


def existing_rows():
    covered = set()
    for path in sorted((ROOT / 'localization').glob('*.zh-CN.json')):
        catalog = json.loads(path.read_text())
        covered.update((catalog.get('skills') or {}).get('rows', {}))
    return covered


def resolve(rid, source, cn):
    translation = cn.get(rid)
    if has_cjk(translation):
        return translation.strip()
    return MANUAL.get(source)


def main():
    br = load_rows(BR_PKG)
    cn = load_rows(CN_PKG)
    covered = existing_rows()

    rows = {}
    missing = []
    for rid, source in br.items():
        if rid[:2] not in PREFIXES or rid in covered or not str(source).strip():
            continue
        if str(source).strip() == '0':
            continue
        translation = resolve(rid, source, cn)
        if not translation:
            missing.append(rid)
            continue
        rows[rid] = {'name': {'source': source, 'translation': translation}}

    conflicts = {}
    catalog = {
        'id': 'naruto-role-skills-zh-CN-v1',
        'class': 'SkillCFG',
        'source': {
            'br': 'PT_NarutoAlpha9.40Build300/config/archives/item1.pkg',
            'cn': 'NarutoBeta11.37Build301/config/archives/item1.pkg',
        },
        'rows': rows,
    }
    OUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=1))
    print(json.dumps({
        'rows': len(rows),
        'missingInCn': len(missing),
        'duplicateSourceNames': len(conflicts),
        'skippedByEarlierCatalogs': sum(1 for rid in br if rid[:2] in PREFIXES and rid in covered),
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
