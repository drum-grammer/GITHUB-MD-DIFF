"""그림 2 — 기존(확장 1.5.1)과 지금(M0 + M1)의 구조 차이(architecture delta). 쓰기: python3 d2_delta.py ../delta.html

diagram-design architecture-delta 계약: 두 스냅숏(before·after)이 같은 격자·같은 좌표를 쓰고, 요소·관계마다 id·상태·서명을 단다.
가운데 기록은 상태가 뜻하는 (대상, 변경) 쌍과 하나씩 맞는다.
"""
import sys
from lib import *

OUT = sys.argv[1]
VW, VH = 960, 512
GRID = '304 320 4'

# 요소: id → (x, y, 이름, 보조, 종류, 상태, before 서명, after 서명). before 서명이 None이면 After에만 있다
COMP = {
    'gh':      (168, 0,   'GitHub rich diff', 'Files changed',   'external', 'unchanged', 'github:rich-diff', 'github:rich-diff'),
    'ext':     (168, 128, '확장 화면 모듈',     'markdown-it 15',  'backend',  'changed',   'modules:fold,table,nav,comments;comments=file-comments;markdown-it=14',
                                                                                         'modules:fold,table,nav,comments;comments=controller+backend;markdown-it=15'),
    'threads': (168, 256, 'GitHub 코멘트',      'review threads',  'external', 'unchanged', 'github:review-threads', 'github:review-threads'),
    'parity':  (0,   0,   '패리티 하네스',       'pnpm parity',     'backend',  'added',     None, 'parity:compare-blocks'),
    'engine':  (0,   128, '렌더링 diff 엔진',    'packages/engine', 'focal',    'added',     None, 'engine:render-github-markup'),
    'src':     (0,   256, '옛·새 md 원문',       'git · fixtures',  'input',    'added',     None, 'source:old-new-markdown'),
}
EXT_BEFORE_SUB = 'markdown-it 14'
W, H = 136, 64

# 관계: id → (from, to, d, 상태, 서명, 강조)
REL = {
    'r1': ('gh', 'ext', 'M 236 64 V 128', 'unchanged', 'rich-diff-html', False),
    'r2': ('ext', 'threads', 'M 236 192 V 256', 'unchanged', 'post-comments', False),
    'r3': ('src', 'engine', 'M 68 256 V 192', 'added', 'old-new-text', False),
    'r4': ('engine', 'ext', 'M 136 160 H 168', 'added', 'github-markup-html', True),
    'r5': ('gh', 'parity', 'M 168 32 H 136', 'added', 'captured-rich-diff', False),
    'r6': ('engine', 'parity', 'M 68 128 V 64', 'added', 'engine-html', False),
}

MARK = {'unchanged': '=', 'added': '+', 'changed': '~'}
WORD = {'unchanged': 'UNCHANGED', 'added': 'ADDED', 'changed': 'CHANGED'}


def component(cid, after):
    x, y, name, sub, kind, status, sig_b, sig_a = COMP[cid]
    if not after and sig_b is None:
        return ''
    fill, stroke = KINDS[kind][0], KINDS[kind][1]
    sig = sig_a if after else sig_b
    if cid == 'ext' and not after:
        sub = EXT_BEFORE_SUB
    assert width(name, 12) + 18 <= W, name
    assert width(sub, 9, mono=True) + 18 <= W, sub
    inset = f'\n  <path d="M {x+1} {y+12} V {y+52}" fill="none" stroke="{MUTED}" stroke-width="3"/>' if status == 'changed' else ''
    return f'''
<g data-kind="component" data-object-id="{cid}" data-status="{status}" data-signature="{sig}">
  <rect data-role="bounds" x="{x}" y="{y}" width="{W}" height="{H}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1.2"/>{inset}
  <text x="{x+12}" y="{y+15}" fill="{MUTED}" font-size="7.5" font-family="{MONO}">{MARK[status]} {cid} · {WORD[status]}</text>
  <text x="{x+12}" y="{y+36}" fill="{INK}" font-size="12" font-weight="600" font-family="{KO}">{name}</text>
  <text x="{x+12}" y="{y+53}" fill="{MUTED}" font-size="9" font-family="{MONO}">{sub}</text>
</g>'''


def relationship(rid, after):
    a, b, d, status, sig, hot = REL[rid]
    if not after and status == 'added':
        return ''
    stroke, marker = (ACCENT, 'delta-arrow-accent') if (hot and after) else (MUTED, 'delta-arrow')
    return f'<path data-kind="relationship" data-object-id="{rid}" data-status="{status}" data-signature="{sig}" data-from="{a}" data-to="{b}" d="{d}" fill="none" stroke="{stroke}" stroke-width="1.2" marker-end="url(#{marker})"/>'


def snapshot(name, tx, after):
    rels = '\n'.join(r for r in (relationship(k, after) for k in REL) if r)
    comps = ''.join(component(k, after) for k in COMP)
    return f'''
<g data-snapshot="{name}" transform="translate({tx} 96)" data-grid="{GRID}">
<!-- 관계를 먼저, 요소를 뒤에 -->
{rels}
{comps}
</g>'''


# 가운데 기록 — (상태, 대상, 설명)
LEDGER = [
    ('CHANGED', 'ext', '코멘트 동작을 백엔드 뒤로 (M0)'),
    ('ADDED', 'src', '로컬 git의 옛·새 원문'),
    ('ADDED', 'engine', 'GitHub와 같은 표기를 직접 그림'),
    ('ADDED', 'parity', 'GitHub 포착본과 블록 단위 비교'),
    ('ADDED', 'r3', '원문 → 엔진'),
    ('ADDED', 'r4', '엔진 HTML → 같은 확장 모듈'),
    ('ADDED', 'r5', 'GitHub rich diff → 패리티 (읽기만)'),
    ('ADDED', 'r6', '엔진 HTML → 패리티'),
]


def ledger():
    out = []
    for k, (word, target, text) in enumerate(LEDGER):
        y = 112 + k * 38
        assert width(text, 12) <= 616 - 372, text
        out.append(f'<text x="344" y="{y+2}" fill="{MUTED}" font-size="9" font-family="{MONO}">{k+1:02d}</text>')
        out.append(f'<text x="372" y="{y}" data-change="{word}" data-target="{target}" fill="{MUTED}" font-size="8" font-family="{MONO}" letter-spacing="0.06em">{word} · {target}'
                   f'<tspan x="372" y="{y+20}" fill="{INK}" font-size="12" font-family="{KO}" letter-spacing="0">{text}</tspan></text>')
    return '\n'.join(out)


def heads():
    out = []
    for x, h, s in [(24, '기존 — 확장 1.5.1', 'GitHub가 그린 diff를 확장이 다듬는다'),
                    (344, '바뀐 것', '요소 4 · 관계 4'),
                    (632, 'M1 뒤 — M0 + M1 병합', '로컬 원문을 엔진이 같은 표기로 그린다')]:
        out.append(f'<text x="{x}" y="28" fill="{INK}" font-size="14" font-weight="600" font-family="{KO}">{h}</text>')
        out.append(f'<text x="{x}" y="52" fill="{MUTED}" font-size="12" font-family="{KO}">{s}</text>')
    return '\n'.join(out)


def bottom():
    y = 448
    items = [('=', '그대로', ''), ('+', '더함', ''), ('~', '바뀜', 'inset')]
    out = [f'<path d="M 24 {y} H 936" stroke="rgba(45,49,66,0.12)" stroke-width="1"/>']
    x = 24
    for mark, text, extra in items:
        out.append(f'<rect x="{x}" y="{y+16}" width="20" height="16" rx="3" fill="none" stroke="{MUTED}" stroke-width="1"/>')
        if extra:
            out.append(f'<path d="M {x+1} {y+20} V {y+28}" stroke="{MUTED}" stroke-width="3"/>')
        out.append(f'<text x="{x+32}" y="{y+28}" fill="{MUTED}" font-size="12" font-family="{KO}">{mark} {text}</text>')
        x += 120
    out.append(f'<rect x="{x}" y="{y+16}" width="20" height="16" rx="3" fill="{KINDS["focal"][0]}" stroke="{ACCENT}" stroke-width="1"/>')
    out.append(f'<text x="{x+32}" y="{y+28}" fill="{MUTED}" font-size="12" font-family="{KO}">M1의 핵심</text>')
    out.append(f'<text x="24" y="{y+56}" fill="{MUTED}" font-size="12" font-family="{KO}">같은 id는 두 그림에서 같은 것이다. 로컬 리뷰 페이지·CLI는 M2에서 이 엔진 위에 얹는다.</text>')
    out.append(f'<text x="936" y="{y+56}" fill="{MUTED}" font-size="9" font-family="{MONO}" text-anchor="end">6 components · 6 relationships · 8 changes</text>')
    return '\n'.join(out)


body = f'''
  <rect width="{VW}" height="{VH}" fill="{PAPER}"/>
{heads()}
{snapshot('before', 24, False)}
{snapshot('after', 632, True)}
{ledger()}
{bottom()}'''

html = page(
    'local-review-delta', 'Architecture delta · 1.5.1 → M1', '기존과 지금 — GitHub 화면 다듬기에서 로컬 렌더링까지',
    '확장 1.5.1은 GitHub가 그린 rich diff를 확장 화면 모듈로 다듬었고, M0과 M1 뒤에는 로컬 원문을 새 엔진이 같은 표기로 그려 같은 모듈에 넘기며 패리티 하네스가 GitHub 포착본과 비교한다.',
    VW, VH, body,
    '<p class="note">왼쪽은 스토어에 있는 확장(1.5.1), 오른쪽은 M0과 M1이 병합된 뒤다. 확장 화면 모듈은 M0에서 코멘트 동작을 백엔드 인터페이스 뒤로 떼어 내고 markdown-it 15로 올렸을 뿐, 확장 동작은 그대로다. 새 엔진의 HTML이 GitHub와 같은 표기라 같은 모듈이 받는다.</p>')
# 계약: 하나의 svg에 data-diagram="architecture-delta", 화살표 표식 이름
html = html.replace('role="img" aria-labelledby="local-review-delta-title', 'data-diagram="architecture-delta" role="img" aria-labelledby="local-review-delta-title', 1)
html = html.replace('<marker id="arrow" ', f'<marker id="delta-arrow" markerUnits="userSpaceOnUse" ', 1)
html = html.replace('<marker id="arrow-accent" ', f'<marker id="delta-arrow-accent" markerUnits="userSpaceOnUse" ', 1)
html = html.replace(f'<rect width="100%" height="100%" fill="#f5f5f5"/>\n\n  <rect width="{VW}"', f'<rect width="{VW}"', 1)
open(OUT, 'w').write(html)
print('wrote', OUT)
