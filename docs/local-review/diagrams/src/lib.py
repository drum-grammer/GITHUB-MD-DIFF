"""diagram-design 기본 스킨으로 SVG 조각을 만드는 작은 도우미 — docs/local-review/diagrams의 그림 셋이 쓴다.

다시 만들기: cd docs/local-review/diagrams/src && python3 d1_overview.py ../overview.html (d2_delta.py·d3_engine.py도 같다).
한글 글자 폭은 1em, 그 밖은 0.60em(sans)·0.62em(mono)으로 잰다(diagram-design 한글 규칙).
"""
import unicodedata, math

KO = "'Geist', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
MONO = "'Geist Mono', monospace"
SERIF_KO = "'Instrument Serif', 'Noto Serif', 'Noto Serif KR', serif"
PAPER = "#f5f5f5"; INK = "#2d3142"; MUTED = "#4f5d75"; SOFT = "#7a8399"; ACCENT = "#eb6c36"; LINK = "#2e5aa8"

KINDS = {
    'focal':    ("rgba(235,108,54,0.08)", ACCENT, "rgba(235,108,54,0.50)", ACCENT, ""),
    'backend':  ("#ffffff", INK, "rgba(45,49,66,0.40)", INK, ""),
    'store':    ("rgba(45,49,66,0.05)", MUTED, "rgba(79,93,117,0.50)", MUTED, ""),
    'external': ("rgba(45,49,66,0.03)", "rgba(45,49,66,0.30)", "rgba(45,49,66,0.22)", SOFT, ""),
    'input':    ("rgba(79,93,117,0.10)", SOFT, "rgba(122,131,153,0.40)", SOFT, ""),
    # 아직 없는 것(다음 마일스톤) — 점선
    'optional': ("rgba(45,49,66,0.02)", "rgba(45,49,66,0.35)", "rgba(45,49,66,0.30)", SOFT, ""),
}

def wide(ch):
    return unicodedata.east_asian_width(ch) in ('W', 'F')

def width(text, size, mono=False, track=0.0):
    em = sum(1.0 if wide(c) else (0.62 if mono else 0.60) for c in text)
    return em * size + len(text) * track * size

def up4(v):
    return int(math.ceil(v / 4.0) * 4)

def has_ko(text):
    return any(wide(c) for c in text)

def node(x, y, w, h, kind, tag, name, sub):
    fill, stroke, tag_stroke, tag_fill, _ = KINDS[kind]
    tw = up4(width(tag, 7, mono=True, track=0.08) + 8)
    cx = x + w / 2
    name_w = width(name, 12)
    sub_w = width(sub, 9, mono=True)
    assert name_w + 16 <= w, (name, name_w, w)
    assert sub_w + 16 <= w, (sub, sub_w, w)
    dash = ' stroke-dasharray="4,3"' if kind == 'optional' else ''
    return f'''
  <!-- node: {name} -->
  <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{PAPER}"/>
  <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1"{dash}/>
  <rect x="{x+8}" y="{y+8}" width="{tw}" height="12" rx="2" fill="transparent" stroke="{tag_stroke}" stroke-width="0.8"/>
  <text x="{x+8+tw/2:g}" y="{y+17}" fill="{tag_fill}" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.08em">{tag}</text>
  <text x="{cx:g}" y="{y+h/2+6:g}" fill="{INK}" font-size="12" font-weight="600" font-family="{KO}" text-anchor="middle">{name}</text>
  <text x="{cx:g}" y="{y+h/2+22:g}" fill="{MUTED}" font-size="9" font-family="{MONO}" text-anchor="middle">{sub}</text>'''

def label(cx, cy, text, color=MUTED):
    """가운데 (cx, cy)에 마스크와 함께 놓는 화살표 라벨. 한글이면 12px sans 500, 아니면 8px mono."""
    if has_ko(text):
        w = up4(width(text, 12) + 8); h = 16
        t = f'<text x="{cx:g}" y="{cy+4:g}" fill="{color}" font-size="12" font-weight="500" font-family="{KO}" text-anchor="middle">{text}</text>'
    else:
        w = up4(width(text, 8, mono=True, track=0.06) + 8); h = 12
        t = f'<text x="{cx:g}" y="{cy+3:g}" fill="{color}" font-size="8" font-family="{MONO}" text-anchor="middle" letter-spacing="0.06em">{text}</text>'
    x0 = cx - w / 2; y0 = cy - h / 2
    return (x0, y0, x0 + w, y0 + h), f'''
  <rect x="{x0:g}" y="{y0:g}" width="{w}" height="{h}" rx="2" fill="{PAPER}"/>
  {t}'''

def page(slug, eyebrow, title, desc, vw, vh, body, note=''):
    return f'''<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&family=Noto+Serif:ital@0;1&family=Noto+Sans+KR:wght@400;500;600&family=Noto+Serif+KR:wght@400&family=Noto+Sans+TC:wght@400;500;600&family=Noto+Serif+TC:wght@400&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    :root {{
      --color-paper:   #f5f5f5;
      --color-ink:     #2d3142;
      --color-muted:   #4f5d75;
      --color-accent:  #eb6c36;
      --font-sans:     'Geist', 'Noto Sans KR', system-ui, sans-serif;
      --font-serif:    'Instrument Serif', 'Noto Serif', 'Noto Serif KR', serif;
      --font-mono:     'Geist Mono', ui-monospace, monospace;
    }}
    body {{ font-family: var(--font-sans); background: var(--color-paper); color: var(--color-ink);
      min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 3rem 2rem; }}
    .frame {{ max-width: {vw + 40}px; width: 100%; }}
    .diagram-container {{ width: 100%; overflow-x: auto; }}
    .eyebrow {{ font-family: var(--font-mono); font-size: 0.66rem; font-weight: 500; letter-spacing: 0.18em;
      text-transform: uppercase; color: var(--color-muted); margin-bottom: 0.5rem; }}
    h1 {{ font-family: var(--font-serif); font-size: clamp(1.5rem, 2.4vw + 0.75rem, 2rem); font-weight: 400;
      letter-spacing: -0.02em; line-height: 1.15; color: var(--color-ink); margin-bottom: 1.5rem; }}
    .note {{ font-size: 0.9rem; line-height: 1.6; color: var(--color-muted); margin-top: 1rem; max-width: 72ch; }}
    svg {{ width: 100%; min-width: {vw}px; display: block; }}
    @media print {{
      .diagram-container {{ overflow-x: visible; }}
      svg {{ min-width: 0; }}
    }}
  </style>
</head>
<body>
  <div class="frame">
    <p class="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    <div class="diagram-container">
      <svg viewBox="0 0 {vw} {vh}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{slug}-title {slug}-desc">
        <title id="{slug}-title">{title}</title>
        <desc id="{slug}-desc">{desc}</desc>
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#4f5d75"/></marker>
          <marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#eb6c36"/></marker>
          <marker id="arrow-link" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#2e5aa8"/></marker>
          <marker id="arrow-open" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polyline points="0 0, 8 3, 0 6" fill="none" stroke="#4f5d75" stroke-width="1.2"/></marker>
        </defs>
        <rect width="100%" height="100%" fill="#f5f5f5"/>
{body}
      </svg>
    </div>
    {note}
  </div>
</body>
</html>
'''

def legend(y, items, x0=24, vw=960):
    """items: (kind, text) — kind는 노드 종류 또는 'arrow-link'·'arrow-dash'·'arrow-accent'·'arrow'"""
    out = [f'''
  <!-- legend -->
  <line x1="{x0}" y1="{y}" x2="{vw - x0}" y2="{y}" stroke="rgba(45,49,66,0.10)" stroke-width="0.8"/>
  <text x="{x0}" y="{y+20}" fill="{MUTED}" font-size="8" font-family="{MONO}" letter-spacing="0.18em">LEGEND</text>''']
    x = x0; ry = y + 36
    for kind, text in items:
        if kind.startswith('tag:'):
            tag = kind[4:]
            tw = up4(width(tag, 7, mono=True, track=0.08) + 8)
            out.append(f'  <rect x="{x}" y="{ry-1}" width="{tw}" height="12" rx="2" fill="transparent" stroke="rgba(45,49,66,0.40)" stroke-width="0.8"/>')
            out.append(f'  <text x="{x + tw/2:g}" y="{ry+8}" fill="{INK}" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.08em">{tag}</text>')
            tx = x + tw + 6
        elif kind.startswith('arrow'):
            stroke, marker, extra = {
                'arrow': (MUTED, 'arrow', ''), 'arrow-link': (LINK, 'arrow-link', ''),
                'arrow-accent': (ACCENT, 'arrow-accent', ''), 'arrow-dash': (MUTED, 'arrow', ' stroke-dasharray="4,3"'),
                'arrow-open': (MUTED, 'arrow-open', ' stroke-dasharray="4,3"')}[kind]
            out.append(f'  <line x1="{x}" y1="{ry+5}" x2="{x+28}" y2="{ry+5}" stroke="{stroke}" stroke-width="1.2"{extra} marker-end="url(#{marker})"/>')
            tx = x + 36
        else:
            fill, stroke = KINDS[kind][0], KINDS[kind][1]
            out.append(f'  <rect x="{x}" y="{ry}" width="14" height="10" rx="2" fill="{fill}" stroke="{stroke}" stroke-width="1"' + (' stroke-dasharray="4,3"' if kind == 'optional' else '') + '/>')
            tx = x + 20
        out.append(f'  <text x="{tx}" y="{ry+10}" fill="{MUTED}" font-size="12" font-weight="500" font-family="{KO}">{text}</text>')
        x = up4(tx + width(text, 12) + 24)
    assert x <= vw, x
    return '\n'.join(out)
