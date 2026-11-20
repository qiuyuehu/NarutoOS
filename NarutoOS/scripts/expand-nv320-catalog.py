"""Expand the 320 assist-skill rows into full catalog entries.

Every desc is one of 75 hand-translated templates with the row's numbers
re-inserted in order; names come from the 40-entry ninja/title glossary.
Style follows the shipped ninja-aid-skills tips wording.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

NINJA = {
    'Mei': '照美冥', 'Ao': '青', 'Danzou': '志村团藏', 'Fuu': '山中风', 'Gaara': '我爱罗',
    'Temari': '手鞠', 'A': '艾', 'Mabui': '麻布依', 'Ohnoki': '大野木', 'Akatsuchi': '赤土',
    'Tenten': '天天', 'Hanzo da Salamandra': '山椒鱼半藏', 'Hidan': '飞段', 'Deidara': '迪达拉',
    'Minato Namikaze': '波风水门', 'Rasa': '罗砂', 'Torune Aburame': '油女取根',
    'Kotetsu Hagane': '钢子铁', 'Shisui Uchiha': '宇智波止水', 'Ameyuri Ringo': '林檎雨由利',
    'Suigetsu': '水月', 'Jugo': '重吾', 'Karin': '香燐', 'Sasuke': '佐助',
    'Kisame Hoshigaki': '干柿鬼鲛', 'Tsunade': '纲手',
    'Orochimaru [Ninja Patife da Folha]': '大蛇丸[木叶的叛忍]',
    'Shizune': '静音', 'Killer B': '奇拉比', 'Mu': '无', 'Gengetsu Hozuki': '鬼灯幻月',
    'Shikamaru': '鹿丸', 'Baki': '马基', 'Inoichi': '山中亥一', 'Rin': '野原琳',
    'Pedra Fundamental de Izuna Uchiha': '宇智波泉奈之基石', 'Jinin': '通草野饵人',
    'Chiriku': '地陆', 'Jinpachi Munashi': '无梨甚八',
}

TITLE = {
    'Aumento de Ninjutsu Água': '水属性忍术提升', 'Aumento de Ataque Água': '水属性攻击提升',
    'Aumento de Ninjutsu Fogo': '火属性忍术提升', 'Aumento de Ataque Fogo': '火属性攻击提升',
    'Aumento de Ninjutsu Vento': '风属性忍术提升', 'Aumento de Ataque Vento': '风属性攻击提升',
    'Aumento de Ninjutsu Relâmpago': '雷属性忍术提升', 'Aumento de Ataque Relâmpago': '雷属性攻击提升',
    'Aumento de Ninjutsu Terra': '土属性忍术提升', 'Aumento de Ataque Terra': '土属性攻击提升',
    'Fortalecimento de Crítico': '暴击强化', 'Especialista em Veneno': '用毒专家',
    'Marca exclusiva': '专属印记', 'Maestria das Chamas': '烈焰精通',
    'Fortalecimento de Velocidade': '速度强化', 'inquebrável': '坚不可摧',
    'Perseguição implacável': '穷追不舍', 'Contra-ataque teleporte': '瞬身反击',
    'Alta pressão': '高压', 'Técnica Secreta de Flutuação': '秘术·浮空',
    'Técnica Secreta de Voo': '秘术·大浮空', 'Habilidade Secreta de Queda': '秘术·倒地',
    'Jutsu secreto de Repelimento': '秘术·击退', 'Concentração de Chakra': '查克拉集中',
    'Especialista em Cura': '医疗专家', 'Proteção de Chakra Estilo Relâmpago': '雷遁查克拉护体',
    'Resistência Anormal': '异常抗性', 'Mestre da Transformação Bijuu': '尾兽化大师',
    'Kekkei Touta': '血继淘汰', 'Miragem': '蜃楼幻影', 'Formação de Tática': '战术编成',
    'Jounin da Areia': '砂之上忍', 'Jutsu secreto de Yamanaka': '山中秘术',
    'Mobilização de Verão': '夏日总动员', 'Destruição da Kabutowar': '兜割之破坏',
    'Doze Guardiões Ninja': '守护忍十二士', 'Brutal': '狂暴残虐',
}


def translate_name(src):
    m = re.match(r'^(.*?)\s*\([Nn]v\.?\s*(\d+)\)\s*$', src)
    if not m:
        return None
    base, lv = m.group(1), int(m.group(2))
    if base in NINJA:
        return f'{NINJA[base]}（{lv}级）'
    for sep in (': ', ' - ', '-'):
        if sep in base:
            nn, tt = base.split(sep, 1)
            return f'{NINJA.get(nn, nn)}·{TITLE.get(tt, tt)}（{lv}级）'
    return f'{TITLE.get(base, base)}（{lv}级）'


# PT template -> ZH template. «N» placeholders are filled with the row's numbers
# in order; the #«N»dc«N»-style color codes are restored from the source itself.
DESC = [
    # 0-9: 元素小队双属性提升
    ('Aumenta o <font color="#«N»dc«N»">Ninjutsu</font> dos companheiros de Água em <font color="#«N»dc«N»">«N»%</font> e a <font color="#«N»dc«N»">Resistência</font> em «N»%.',
     '水属性小队忍者的<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">抗性</font>提升«N»%。'),
    ('Aumenta o <font color="#«N»dc«N»">Ataque</font> dos companheiros de Água em <font color="#«N»dc«N»">«N»%</font> e a <font color="#«N»dc«N»">Defesa</font> em «N»%.',
     '水属性小队忍者的<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">防御</font>提升«N»%。'),
    ('Aumenta o <font color="#«N»dc«N»">Ninjutsu</font> dos companheiros de Fogo em <font color="#«N»dc«N»">«N»%</font> e a <font color="#«N»dc«N»">Resistência</font> em «N»%.',
     '火属性小队忍者的<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">抗性</font>提升«N»%。'),
    ('Aumenta o <font color="#«N»dc«N»">Ataque</font> dos companheiros de Fogo em <font color="#«N»dc«N»">«N»%</font> e a <font color="#«N»dc«N»">Defesa</font> em «N»%.',
     '火属性小队忍者的<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">防御</font>提升«N»%。'),
    ('Aumenta o <font color="#«N»dc«N»">Ninjutsu</font> dos companheiros de Vento em <font color="#«N»dc«N»">«N»%</font> e a <font color="#«N»dc«N»">Resistência</font> em «N»%.',
     '风属性小队忍者的<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">抗性</font>提升«N»%。'),
    ('Aumenta o <font color="#«N»dc«N»">Ataque</font> dos companheiros de Vento em <font color="#«N»dc«N»">«N»%</font> e a <font color="#«N»dc«N»">Defesa</font> em «N»%.',
     '风属性小队忍者的<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">防御</font>提升«N»%。'),
    ('Aumenta o <font color="#«N»dc«N»">Ninjutsu</font> dos companheiros de Relâmpago em <font color="#«N»dc«N»">«N»%</font> e a <font color="#«N»dc«N»">Resistência</font> em «N»%.',
     '雷属性小队忍者的<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">抗性</font>提升«N»%。'),
    ('Aumenta o <font color="#«N»dc«N»">Ataque</font> dos companheiros de Relâmpago em <font color="#«N»dc«N»">«N»%</font> e a <font color="#«N»dc«N»">Defesa</font> em «N»%.',
     '雷属性小队忍者的<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">防御</font>提升«N»%。'),
    ('Aumenta o <font color="#«N»dc«N»">Ninjutsu</font> dos companheiros de Terra em <font color="#«N»dc«N»">«N»%</font> e a <font color="#«N»dc«N»">Resistência</font> em «N»%.',
     '土属性小队忍者的<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">抗性</font>提升«N»%。'),
    ('Aumenta o <font color="#«N»dc«N»">Ataque</font> dos companheiros de Terra em <font color="#«N»dc«N»">«N»%</font> e a <font color="#«N»dc«N»">Defesa</font> em «N»%.',
     '土属性小队忍者的<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">防御</font>提升«N»%。'),
    # 10: 暴击提升
    ('O Crítico de seus companheiros aumenta em «N»%',
     '小队忍者的暴击提升«N»%'),
    # 11-12: 对异常状态敌人增伤
    ('O dano causado pelos companheiros a inimigos com <font color="#«N»dc«N»">Veneno</font> e <font color="#«N»dc«N»">Toxicidade</font> aumenta em «N»%.',
     '小队忍者对处于<font color="#«N»dc«N»">中毒</font>和<font color="#«N»dc«N»">剧毒</font>的敌人造成的伤害提升«N»%。'),
    ('O dano causado pelos companheiros a inimigos com <font color="#«N»dc«N»">Marca</font> aumenta em «N»%.',
     '小队忍者对处于<font color="#«N»dc«N»">印记</font>的敌人造成的伤害提升«N»%。'),
    ('Aumenta o Dano aos alvos com <font color="#«N»dc«N»">Chamas</font> causado pelos companheiros em <font color="#«N»dc«N»">«N»%</font>.',
     '小队忍者对处于<font color="#«N»dc«N»">点燃</font>的目标造成的伤害提升<font color="#«N»dc«N»">«N»%</font>。'),
    # 14: 速度点数
    ('Aumenta a <font color="#«N»dc«N»">Velocidade</font> dos companheiros em <font color="#«N»dc«N»">«N» pontos</font>.',
     '小队忍者的<font color="#«N»dc«N»">速度</font>提升<font color="#«N»dc«N»">«N»点</font>。'),
    # 15: 护盾双防
    ('Seus companheiros que tiverem um Escudo ganham também <font color="#«N»dc«N»">«N»%</font> de <font color="#«N»dc«N»">Defesa</font> e <font color="#«N»dc«N»">Resistência</font>',
     '持有护盾的小队忍者额外获得<font color="#«N»dc«N»">«N»%</font>的<font color="#«N»dc«N»">防御</font>和<font color="#«N»dc«N»">抗性</font>'),
    ('O dano causado pelos companheiros a inimigos com <font color="#«N»dc«N»">Imunidade a Status negativos</font> aumenta em «N»%.',
     '小队忍者对处于<font color="#«N»dc«N»">异常状态免疫</font>的敌人造成的伤害提升«N»%。'),
    ('O dano de <font color="#«N»dc«N»">Perseguição</font> de sua equipe aumenta <font color="#«N»dc«N»">«N»%</font>',
     '己方小队的<font color="#«N»dc«N»">追打</font>伤害提升<font color="#«N»dc«N»">«N»%</font>'),
    ('O dano causado pelos companheiros a inimigos com <font color="#«N»dc«N»">Paralisia</font> aumenta em <font color="#«N»dc«N»">«N»%</font>.',
     '小队忍者对处于<font color="#«N»dc«N»">麻痹</font>的敌人造成的伤害提升<font color="#«N»dc«N»">«N»%</font>。'),
    # 19: 查克拉保底
    ('Quando sua equipe tem seu Chakra absorvido, retém pelo menos <font color="#«N»dc«N»">«N»</font> pontos de Chakra.',
     '己方小队查克拉被吸取时，至少保留<font color="#«N»dc«N»">«N»</font>点查克拉。'),
    ('A cura recebida por sua equipe aumenta <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队受到的治疗效果提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('O dano causado pela equipe a ninjas da <font color="#«N»dc«N»">Folha</font> aumenta <font color="#«N»dc«N»">«N»%</font>.',
     '小队对<font color="#«N»dc«N»">木叶</font>忍者造成的伤害提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Reduz o dano da primeira Perseguição recebida pela equipe na rodada em <font color="#«N»dc«N»">«N»%</font>.',
     '每回合己方首次受到的追打伤害降低<font color="#«N»dc«N»">«N»%</font>。'),
    ('Quando sua equipe tem um <font color="#«N»dc«N»">Escudo</font>, a <font color="#«N»dc«N»">Defesa</font> e <font color="#«N»dc«N»">Ninjutsu</font> aumentam <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队持有<font color="#«N»dc«N»">护盾</font>时，<font color="#«N»dc«N»">防御</font>和<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Para cada nível de <font color="#«N»dc«N»">Status negativo</font> possuído por sua equipe, sua <font color="#«N»dc«N»">Defesa</font> e <font color="#«N»dc«N»">Resistência</font> aumentam <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队每持有1层<font color="#«N»dc«N»">不良状态</font>，<font color="#«N»dc«N»">防御</font>和<font color="#«N»dc«N»">抗性</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('O dano causado pela equipe a ninjas <font color="#«N»dc«N»">Jinchuuriki</font> aumenta <font color="#«N»dc«N»">«N»%</font>.',
     '小队对<font color="#«N»dc«N»">人柱力</font>忍者造成的伤害提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('A <font color="#«N»dc«N»">Esotérica</font> de seus <font color="#«N»dc«N»">ninjas</font> tem o dano aumentado em <font color="#«N»dc«N»">«N»%</font> e, sempre que é lançada, recupera <font color="#«N»dc«N»">«N»</font> de Chakra.',
     '小队忍者的<font color="#«N»dc«N»">奥义</font>伤害提升<font color="#«N»dc«N»">«N»%</font>，且每次发动时恢复<font color="#«N»dc«N»">«N»</font>点查克拉。'),
    ('Sempre que alguém de sua equipe se Esquiva, também recupera <font color="#«N»dc«N»">«N»</font> pontos de Chakra.',
     '己方小队忍者每次闪避成功时，恢复<font color="#«N»dc«N»">«N»</font>点查克拉。'),
    ('Quando Ninja da <font color="#«N»dc«N»">Aldeia da Areia</font> do seu equipe usa Habilidade <font color="#«N»dc«N»">Esotérica</font>, recupera <font color="#«N»dc«N»">«N»%</font> de Vida.',
     '己方<font color="#«N»dc«N»">砂隐村</font>忍者使用<font color="#«N»dc«N»">奥义</font>时，恢复<font color="#«N»dc«N»">«N»%</font>的生命。'),
    ('Quando ninjas com <font color="#«N»dc«N»">Habilidade Secreta</font> do seu equipe usa habilidade de <font color="#«N»dc«N»">tipo gatilho</font>, recupera <font color="#«N»dc«N»">«N»%</font> de Vida.',
     '己方持有<font color="#«N»dc«N»">秘术</font>的忍者使用<font color="#«N»dc«N»">触发类技能</font>时，恢复<font color="#«N»dc«N»">«N»%</font>的生命。'),
    ('O dano causado pela equipe a ninjas da <font color="#«N»dc«N»">espadachins</font> aumenta <font color="#«N»dc«N»">«N»%</font>.',
     '小队对<font color="#«N»dc«N»">剑士</font>忍者造成的伤害提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Para cada nível de <font color="#«N»dc«N»">Status negativo</font> possuído por sua equipe, sua <font color="#«N»dc«N»">Ataque</font> e <font color="#«N»dc«N»">Ninjutsu</font> aumentam <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队每持有1层<font color="#«N»dc«N»">不良状态</font>，<font color="#«N»dc«N»">攻击</font>和<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    # 32: 影·查克拉速度
    ('A cada <font color="#«N»dc«N»">«N»</font> pontos de Chakra consumidos, o ninja <font color="#«N»dc«N»">Kage</font> na equipe aliada ganha <font color="#«N»dc«N»">«N».«N»%</font> de <font color="#«N»dc«N»">Velocidade</font> (até um máximo de <font color="#«N»dc«N»">«N»%</font>). Habilidades de tipo <font color="#«N»dc«N»">gatilho</font> ganham <font color="#«N»dc«N»">«N»%</font> de dano.',
     '己方小队每消耗<font color="#«N»dc«N»">«N»</font>点查克拉，<font color="#«N»dc«N»">影</font>忍者获得<font color="#«N»dc«N»">«N».«N»%</font>的<font color="#«N»dc«N»">速度</font>（至多<font color="#«N»dc«N»">«N»%</font>），且<font color="#«N»dc«N»">触发类技能</font>伤害提升<font color="#«N»dc«N»">«N»%</font>。'),
    # 33: 人柱力狂暴
    ('Após usar a habilidade, o ninja <font color="#«N»dc«N»">Jinchuuriki</font> na equipe aliada recebe o status de <font color="#«N»dc«N»">Fúria</font> (ao causar um <font color="#«N»dc«N»">Crítico</font> durante uma rodada, regenera <font color="#«N»dc«N»">«N»%</font> da própria Vida e ganha <font color="#«N»dc«N»">«N»%</font> de <font color="#«N»dc«N»">Crítico</font>; máximo de «N» ativação por rodada).',
     '使用技能后，己方小队的<font color="#«N»dc«N»">人柱力</font>忍者获得<font color="#«N»dc«N»">狂暴</font>状态（每回合造成<font color="#«N»dc«N»">暴击</font>时，恢复自身<font color="#«N»dc«N»">«N»%</font>的生命并获得<font color="#«N»dc«N»">«N»%</font><font color="#«N»dc«N»">暴击</font>；每回合至多触发«N»次）。'),
    ('Na primeira vez que a equipe aliada sofrer dano de habilidade <font color="#«N»dc«N»">Esotérica</font> em cada rodada, reduz o dano recebido em <font color="#«N»dc«N»">«N»%</font>.',
     '每回合己方小队首次受到<font color="#«N»dc«N»">奥义</font>技能伤害时，受到的伤害降低<font color="#«N»dc«N»">«N»%</font>。'),
    ('Quando um ninja <font color="#«N»dc«N»">Espadachim</font> de <font color="#«N»dc«N»">Uchiha</font> da equipe aliada usar habilidade de tipo <font color="#«N»dc«N»">gatilho</font>, ele recuperará a vida no valor equivalente a <font color="#«N»dc«N»">«N»%</font> da própria vida máxima e ganhará <font color="#«N»dc«N»">«N»%</font> de <font color="#«N»dc«N»">Crítico</font>.',
     '己方小队的<font color="#«N»dc«N»">宇智波</font><font color="#«N»dc«N»">剑士</font>忍者使用<font color="#«N»dc«N»">触发类技能</font>时，恢复相当于自身最大生命<font color="#«N»dc«N»">«N»%</font>的生命，并获得<font color="#«N»dc«N»">«N»%</font>的<font color="#«N»dc«N»">暴击</font>。'),
    # 36-37: 武士/泳装夏装
    ('Ninjas da série <font color="#«N»dc«N»">Samurai</font> na equipe aliada, ao usarem qualquer habilidade, ganham <font color="#«N»dc«N»">«N»%</font> de probabilidade de esquiva (pode se esquivar até <font color="#«N»dc«N»">«N»</font> vezes, mas não acumula).',
     '己方小队的<font color="#«N»dc«N»">武士</font>系列忍者使用任意技能时，获得<font color="#«N»dc«N»">«N»%</font>闪避几率（至多闪避<font color="#«N»dc«N»">«N»</font>次，不叠加）。'),
    ('Toda vez que um ninja aliado de <font color="#«N»dc«N»">Traje de Banho</font> ou <font color="#«N»dc«N»">Roupa de Verão</font> sofrer dano, ganha <font color="#«N»dc«N»">«N»%</font> de <font color="#«N»dc«N»">Crítico</font> e <font color="#«N»dc«N»">Resistência</font> (até o final da rodada).',
     '己方<font color="#«N»dc«N»">泳装</font>或<font color="#«N»dc«N»">夏装</font>忍者每次受到伤害时，获得<font color="#«N»dc«N»">«N»%</font>的<font color="#«N»dc«N»">暴击</font>和<font color="#«N»dc«N»">抗性</font>（直至回合结束）。'),
    ('Quando um companheiro recebe um ataque <font color="#«N»dc«N»">Esotérico</font> sua <font color="#«N»dc«N»">Velocidade</font> aumenta em «N».«N»% até o fim da próxima rodada (não acumula).',
     '小队忍者受到<font color="#«N»dc«N»">奥义</font>攻击时，<font color="#«N»dc«N»">速度</font>提升«N».«N»%，直至下回合结束（不叠加）。'),
    ('Aumenta o <font color="#«N»dc«N»">Crítico</font> dos Ninjas da <font color="#«N»dc«N»">Aldeia da Névoa</font> em <font color="#«N»dc«N»">«N»%</font>.',
     '<font color="#«N»dc«N»">雾隐村</font>忍者的<font color="#«N»dc«N»">暴击</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Sempre que alguém de sua equipe lança <font color="#«N»dc«N»">Perseguição</font>, recupera <font color="#«N»dc«N»">«N»</font> pontos de Chakra e tem seu <font color="#«N»dc«N»">Crítico</font> aumentado em <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队忍者每次发动<font color="#«N»dc«N»">追打</font>时，恢复<font color="#«N»dc«N»">«N»</font>点查克拉，<font color="#«N»dc«N»">暴击</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('A cura recebida por companheiros com <font color="#«N»dc«N»">Roupa de Verão</font> e <font color="#«N»dc«N»">Traje de Banho</font> aumenta <font color="#«N»dc«N»">«N»%</font>.',
     '<font color="#«N»dc«N»">夏装</font>和<font color="#«N»dc«N»">泳装</font>小队忍者受到的治疗效果提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Sempre que um companheiro <font color="#«N»dc«N»">Uchiha</font> recebe dano, seu <font color="#«N»dc«N»">Ninjutsu</font> e <font color="#«N»dc«N»">Resistência</font> aumentam <font color="#«N»dc«N»">«N»%</font> até o fim da rodada.',
     '己方<font color="#«N»dc«N»">宇智波</font>忍者每次受到伤害时，<font color="#«N»dc«N»">忍术</font>和<font color="#«N»dc«N»">抗性</font>提升<font color="#«N»dc«N»">«N»%</font>，直至回合结束。'),
    ('Sempre que uma unidade <font color="#«N»dc«N»">ninja</font> ou <font color="#«N»dc«N»">não-ninja</font> da sua equipe lança habilidades de <font color="#«N»dc«N»">Ataque Comum</font>, recupera <font color="#«N»dc«N»">«N»</font> pontos de Chakra e ganha <font color="#«N»dc«N»">«N»%</font> de <font color="#«N»dc«N»">Crítico</font>.',
     '己方小队的<font color="#«N»dc«N»">忍者</font>或<font color="#«N»dc«N»">非忍者</font>单位每次发动<font color="#«N»dc«N»">普通攻击</font>技能时，恢复<font color="#«N»dc«N»">«N»</font>点查克拉，并获得<font color="#«N»dc«N»">«N»%</font>的<font color="#«N»dc«N»">暴击</font>。'),
    ('A cura recebida por companheiros com <font color="#«N»dc«N»">Marca da Maldição</font> aumenta em <font color="#«N»dc«N»">«N»%</font>.',
     '处于<font color="#«N»dc«N»">咒印</font>的小队忍者受到的治疗效果提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Sempre que a equipe aliada usar a habilidade, o dano de <font color="#«N»dc«N»">Perseguição</font> de todos os membros aumenta em <font color="#«N»dc«N»">«N»%</font> durante a rodada (acumula até <font color="#«N»dc«N»">«N»</font> vezes).',
     '己方小队每次使用技能时，全体成员的<font color="#«N»dc«N»">追打</font>伤害在本回合内提升<font color="#«N»dc«N»">«N»%</font>（可叠加<font color="#«N»dc«N»">«N»</font>次）。'),
    # 46-49: 每当造成浮空/大浮空/倒地/击退 双属性
    ('Cada vez que sua equipe causa <font color="#«N»dc«N»">Flutuação</font> seu <font color="#«N»dc«N»">Ataque</font> e <font color="#«N»dc«N»">Ninjutsu</font> aumentam <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队每次造成<font color="#«N»dc«N»">小浮空</font>时，自身<font color="#«N»dc«N»">攻击</font>和<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Cada vez que sua equipe causa <font color="#«N»dc«N»">Voo</font> seu <font color="#«N»dc«N»">Ataque</font> e <font color="#«N»dc«N»">Ninjutsu</font> aumentam <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队每次造成<font color="#«N»dc«N»">大浮空</font>时，自身<font color="#«N»dc«N»">攻击</font>和<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Cada vez que sua equipe causa <font color="#«N»dc«N»">Queda</font>, seu <font color="#«N»dc«N»">Ataque</font> e <font color="#«N»dc«N»">Ninjutsu</font> aumentam <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队每次造成<font color="#«N»dc«N»">倒地</font>时，自身<font color="#«N»dc«N»">攻击</font>和<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Cada vez que sua equipe causa <font color="#«N»dc«N»">Repelimento</font> seu <font color="#«N»dc«N»">Ataque</font> e <font color="#«N»dc«N»">Ninjutsu</font> aumentam <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队每次造成<font color="#«N»dc«N»">击退</font>时，自身<font color="#«N»dc«N»">攻击</font>和<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Cada vez que habilidade de um <font color="#«N»dc«N»">Jinchuuriki</font> de sua equipe é lançada, seus próprios <font color="#«N»dc«N»">Ataque</font> e <font color="#«N»dc«N»">Ninjutsu</font> aumentam <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队的<font color="#«N»dc«N»">人柱力</font>忍者每次发动技能后，自身<font color="#«N»dc«N»">攻击</font>和<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Sempre que alguém de sua equipe se Esquiva, seu <font color="#«N»dc«N»">Ataque</font> e <font color="#«N»dc«N»">Ninjutsu</font> aumentam em <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队忍者每次闪避成功时，自身<font color="#«N»dc«N»">攻击</font>和<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    # 52-55: 单攻击+忍术组合
    ('Cada vez que sua equipe causa <font color="#«N»dc«N»">Flutuação</font> seu <font color="#«N»dc«N»">Ataque</font> aumenta <font color="#«N»dc«N»">«N»%</font> e o <font color="#«N»dc«N»">Ninjutsu</font> <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队每次造成<font color="#«N»dc«N»">小浮空</font>时，自身<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Cada vez que sua equipe causa <font color="#«N»dc«N»">Voo</font> seu <font color="#«N»dc«N»">Ataque</font> aumenta <font color="#«N»dc«N»">«N»%</font> e o <font color="#«N»dc«N»">Ninjutsu</font> <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队每次造成<font color="#«N»dc«N»">大浮空</font>时，自身<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Cada vez que sua equipe causa <font color="#«N»dc«N»">Queda</font>, seu <font color="#«N»dc«N»">Ataque</font> aumenta <font color="#«N»dc«N»">«N»%</font> e o <font color="#«N»dc«N»">Ninjutsu</font> <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队每次造成<font color="#«N»dc«N»">倒地</font>时，自身<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Cada vez que sua equipe causa <font color="#«N»dc«N»">Repelimento</font> seu <font color="#«N»dc«N»">Ataque</font> aumenta <font color="#«N»dc«N»">«N»%</font> e o <font color="#«N»dc«N»">Ninjutsu</font> <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队每次造成<font color="#«N»dc«N»">击退</font>时，自身<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Cada vez que habilidade de um <font color="#«N»dc«N»">Jinchuuriki</font> de sua equipe é lançada, seu próprio <font color="#«N»dc«N»">Ataque</font> aumenta <font color="#«N»dc«N»">«N»%</font> e o <font color="#«N»dc«N»">Ninjutsu</font> <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队的<font color="#«N»dc«N»">人柱力</font>忍者每次发动技能后，自身<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Sempre que alguém de sua equipe se Esquiva, seu <font color="#«N»dc«N»">Ataque</font> aumenta em <font color="#«N»dc«N»">«N»%</font> e seu <font color="#«N»dc«N»">Ninjutsu</font> em <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队忍者每次闪避成功时，自身<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>，<font color="#«N»dc«N»">忍术</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    # 58: 奥义攻击速度（整数百分比版）
    ('Quando um companheiro recebe um ataque <font color="#«N»dc«N»">Esotérico</font> sua <font color="#«N»dc«N»">Velocidade</font> aumenta em «N»% até o fim da próxima rodada (não acumula).',
     '小队忍者受到<font color="#«N»dc«N»">奥义</font>攻击时，<font color="#«N»dc«N»">速度</font>提升«N»%，直至下回合结束（不叠加）。'),
    ('Sempre que alguém de sua equipe lança <font color="#«N»dc«N»">Perseguição</font>, recupera <font color="#«N»dc«N»">«N»</font> ponto de Chakra e tem seu <font color="#«N»dc«N»">Crítico</font> aumentado em <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队忍者每次发动<font color="#«N»dc«N»">追打</font>时，恢复<font color="#«N»dc«N»">«N»</font>点查克拉，<font color="#«N»dc«N»">暴击</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    # 60-65: 夏装泳装/宇智波带免疫的进阶版
    ('A cura recebida por companheiros com <font color="#«N»dc«N»">Roupa de Verão</font> e <font color="#«N»dc«N»">Traje de Banho</font> aumenta <font color="#«N»dc«N»">«N»%</font> e ganham <font color="#«N»dc«N»">Imunidade a Status negativos</font>.',
     '<font color="#«N»dc«N»">夏装</font>和<font color="#«N»dc«N»">泳装</font>小队忍者受到的治疗效果提升<font color="#«N»dc«N»">«N»%</font>，并获得<font color="#«N»dc«N»">异常状态免疫</font>。'),
    ('Sempre que um companheiro <font color="#«N»dc«N»">Uchiha</font> recebe dano, seu <font color="#«N»dc«N»">Ninjutsu</font> e <font color="#«N»dc«N»">Resistência</font> aumentam <font color="#«N»dc«N»">«N»%</font> até o fim da rodada e ganha <font color="#«N»dc«N»">Imunidade a Status negativos</font>.',
     '己方<font color="#«N»dc«N»">宇智波</font>忍者每次受到伤害时，<font color="#«N»dc«N»">忍术</font>和<font color="#«N»dc«N»">抗性</font>提升<font color="#«N»dc«N»">«N»%</font>直至回合结束，并获得<font color="#«N»dc«N»">异常状态免疫</font>。'),
    ('Sempre que uma unidade <font color="#«N»dc«N»">ninja</font> ou <font color="#«N»dc«N»">não-ninja</font> da sua equipe lança habilidades de <font color="#«N»dc«N»">Ataque Comum</font>, recupera <font color="#«N»dc«N»">«N»</font> ponto de Chakra e ganha <font color="#«N»dc«N»">«N»%</font> de <font color="#«N»dc«N»">Crítico</font>.',
     '己方小队的<font color="#«N»dc«N»">忍者</font>或<font color="#«N»dc«N»">非忍者</font>单位每次发动<font color="#«N»dc«N»">普通攻击</font>技能时，恢复<font color="#«N»dc«N»">«N»</font>点查克拉，并获得<font color="#«N»dc«N»">«N»%</font>的<font color="#«N»dc«N»">暴击</font>。'),
    ('A cura recebida por companheiros com <font color="#«N»dc«N»">Marca da Maldição</font> aumenta em <font color="#«N»dc«N»">«N»%</font> e os companheiros ganham <font color="#«N»dc«N»">Imunidade a Status negativos</font>.',
     '处于<font color="#«N»dc«N»">咒印</font>的小队忍者受到的治疗效果提升<font color="#«N»dc«N»">«N»%</font>，并获得<font color="#«N»dc«N»">异常状态免疫</font>。'),
    ('Sempre que a equipe aliada usar a habilidade, o dano de <font color="#«N»dc«N»">Perseguição</font> de todos os membros aumenta em <font color="#«N»dc«N»">«N»%</font> durante a rodada (acumula até <font color="#«N»dc«N»">«N»</font> vezes) com <font color="#«N»dc«N»">Imunidade a Status negativos</font>.',
     '己方小队每次使用技能时，全体成员的<font color="#«N»dc«N»">追打</font>伤害在本回合内提升<font color="#«N»dc«N»">«N»%</font>（可叠加<font color="#«N»dc«N»">«N»</font>次），并获得<font color="#«N»dc«N»">异常状态免疫</font>。'),
    ('Toda vez que um ninja aliado de <font color="#«N»dc«N»">Traje de Banho</font> ou <font color="#«N»dc«N»">Roupa de Verão</font> sofrer dano, ganha <font color="#«N»dc«N»">«N»%</font> de <font color="#«N»dc«N»">Crítico</font> e <font color="#«N»dc«N»">Resistência</font> (até o final da rodada). Ademais, ao usar habilidade <font color="#«N»dc«N»">Esotérica</font>, causa adicionalmente <font color="#«N»dc«N»">Dissolução</font> ao alvo selecionado (válido apenas para habilidades que permitem a escolha do alvo).',
     '己方<font color="#«N»dc«N»">泳装</font>或<font color="#«N»dc«N»">夏装</font>忍者每次受到伤害时，获得<font color="#«N»dc«N»">«N»%</font>的<font color="#«N»dc«N»">暴击</font>和<font color="#«N»dc«N»">抗性</font>（直至回合结束）。此外，使用<font color="#«N»dc«N»">奥义</font>技能时，对被选中的目标额外造成<font color="#«N»dc«N»">溶解</font>（仅对可选目标的技能生效）。'),
    ('Ninjas da série <font color="#«N»dc«N»">Samurai</font> na equipe aliada, ao usarem qualquer habilidade, ganham <font color="#«N»dc«N»">«N»%</font> de probabilidade de esquiva (pode se esquivar até <font color="#«N»dc«N»">«N»</font> vezes, mas não acumula). Ademais, o uso de habilidade <font color="#«N»dc«N»">Esotérica</font> causa <font color="#«N»dc«N»">Selamento</font> ao alvo escolhido (válido apenas para habilidades que permitem a escolha do alvo).',
     '己方小队的<font color="#«N»dc«N»">武士</font>系列忍者使用任意技能时，获得<font color="#«N»dc«N»">«N»%</font>闪避几率（至多闪避<font color="#«N»dc«N»">«N»</font>次，不叠加）。此外，使用<font color="#«N»dc«N»">奥义</font>技能时，对被选中的目标造成<font color="#«N»dc«N»">封印</font>（仅对可选目标的技能生效）。'),
    # 67-70: 单攻击版
    ('Cada vez que sua equipe causa <font color="#«N»dc«N»">Flutuação</font> seu <font color="#«N»dc«N»">Ataque</font> aumenta <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队每次造成<font color="#«N»dc«N»">小浮空</font>时，自身<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Cada vez que sua equipe causa <font color="#«N»dc«N»">Voo</font> seu <font color="#«N»dc«N»">Ataque</font> aumenta <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队每次造成<font color="#«N»dc«N»">大浮空</font>时，自身<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Cada vez que sua equipe causa <font color="#«N»dc«N»">Queda</font>, seu <font color="#«N»dc«N»">Ataque</font> aumenta <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队每次造成<font color="#«N»dc«N»">倒地</font>时，自身<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Cada vez que sua equipe causa <font color="#«N»dc«N»">Repelimento</font> seu <font color="#«N»dc«N»">Ataque</font> aumenta <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队每次造成<font color="#«N»dc«N»">击退</font>时，自身<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Aumenta o <font color="#«N»dc«N»">Crítico</font> dos Ninjas da <font color="#«N»dc«N»">Aldeia da Névoa</font> em <font color="#«N»dc«N»">«N»%</font>, e aumenta «N»/«N» <font color="#«N»dc«N»">Ponto de Habilidade</font> cada vez que for atacado.',
     '<font color="#«N»dc«N»">雾隐村</font>忍者的<font color="#«N»dc«N»">暴击</font>提升<font color="#«N»dc«N»">«N»%</font>，且每次受到攻击时获得«N»/«N»点<font color="#«N»dc«N»">技能点</font>。'),
    ('Aumenta o <font color="#«N»dc«N»">Crítico</font> dos Ninjas da <font color="#«N»dc«N»">Aldeia da Névoa</font> em <font color="#«N»dc«N»">«N»%</font>, e aumenta «N» <font color="#«N»dc«N»">Ponto de Habilidade</font> cada vez que for atacado.',
     '<font color="#«N»dc«N»">雾隐村</font>忍者的<font color="#«N»dc«N»">暴击</font>提升<font color="#«N»dc«N»">«N»%</font>，且每次受到攻击时获得«N»点<font color="#«N»dc«N»">技能点</font>。'),
    ('Cada vez que habilidade de um <font color="#«N»dc«N»">Jinchuuriki</font> de sua equipe é lançada, seu próprio <font color="#«N»dc«N»">Ataque</font> aumenta <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队的<font color="#«N»dc«N»">人柱力</font>忍者每次发动技能后，自身<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
    ('Sempre que alguém de sua equipe se Esquiva, seu <font color="#«N»dc«N»">Ataque</font> aumenta em <font color="#«N»dc«N»">«N»%</font>.',
     '己方小队忍者每次闪避成功时，自身<font color="#«N»dc«N»">攻击</font>提升<font color="#«N»dc«N»">«N»%</font>。'),
]


def fill(template_pt, template_zh, source):
    """Re-insert each source number (and color code) into the zh template."""
    # Extract values in order from the source, matching the PT template's slots.
    pt_slots = re.findall(r'«[^»]*»', template_pt)
    # Build a regex from the PT template where each slot matches its content type.
    pattern = re.escape(template_pt)
    # A slot «N» matches digits; «N»dc«N»-style color slots match hex-ish digits.
    slot_patterns = []
    for slot in pt_slots:
        if slot == '«N»':
            slot_patterns.append(r'\d+')
        elif slot == '«NV»':
            slot_patterns.append(r'[Nn]v\.?\s*\d+')
        else:
            slot_patterns.append(r'\d+')
    # Replace each escaped slot with its capture group, longest-first to be safe.
    values = []
    rest = source
    idx = 0
    # Walk the template slot positions and slice values out of the source by
    # matching the literal text between slots.
    lit = re.split(r'«[^»]*»', template_pt)
    slots_in_order = re.findall(r'«[^»]*»', template_pt)
    pos = 0
    for i, literal in enumerate(lit):
        p = rest.find(literal, pos) if literal else pos
        if literal and p < 0:
            return None
        if i > 0:
            # the segment between previous slot end and this literal is the value
            start = pos if not literal else p
            val = rest[pos:start]
            values.append(val)
        if literal:
            pos = p + len(literal)
    values.append(rest[pos:])
    # Assemble zh: walk zh template, replace «...» slots in order with values.
    # The zh template contains only «N» slots (color codes written as «N»dc«N»).
    out = []
    zh_slots = 0
    for part in re.split(r'(«[^»]*»)', template_zh):
        if part.startswith('«') and part.endswith('»'):
            out.append(values[zh_slots] if zh_slots < len(values) else part)
            zh_slots += 1
        else:
            out.append(part)
    return ''.join(out)


def main():
    todo = json.loads((Path('/tmp') / 'nv-todo-rows.json').read_text())
    catalog_path = ROOT / 'localization/ninja-aid-skill-titles.zh-CN.json'
    catalog = json.loads(catalog_path.read_text())
    added = 0
    failures = []
    for rid, t in sorted(todo.items()):
        entry = {}
        if t['need_name']:
            tr = translate_name(t['name'])
            if not tr:
                failures.append(('name', rid, t['name']))
            else:
                entry['name'] = {'source': t['name'], 'translation': tr}
        if t['need_desc']:
            masked = re.sub(r'\d+', '«N»', t['desc'])
            tr = None
            for pt, zh in DESC:
                if re.sub(r'\d+', '«N»', pt) == masked or pt == masked:
                    tr = fill(pt, zh, t['desc'])
                    break
            if not tr:
                failures.append(('desc', rid, masked[:80]))
            else:
                entry['desc'] = {'source': t['desc'], 'translation': tr}
        if entry:
            existing = catalog['rows'].get(rid, {})
            if 'name' in existing and 'name' in entry and existing['name'] != entry['name'] \
                    and existing['name'].get('source') == entry['name']['source']:
                entry['name'] = existing['name']  # keep the hand-reviewed wording
            catalog['rows'][rid] = {**existing, **entry}
            added += 1
    print(f'rows updated: {added}, failures: {len(failures)}')
    for f in failures[:10]:
        print('  FAIL', f[0], f[1], f[2][:70])
    if not failures:
        catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2))
        print('catalog written:', catalog_path)


if __name__ == '__main__':
    main()
