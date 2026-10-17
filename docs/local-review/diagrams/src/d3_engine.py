"""그림 3 — 엔진 안쪽(packages/engine). 쓰기: python3 d3_engine.py ../engine.html"""
import sys
from lib import *

OUT = sys.argv[1]
VW, VH = 960, 340
P = []

# --- arrows (선 먼저) ---
P.append(f'''
  <!-- 원문 → 파서 → 짝짓기 → 분류 → HTML -->
  <line x1="184" y1="72" x2="212" y2="72" stroke="{MUTED}" stroke-width="1.2" marker-end="url(#arrow)"/>
  <line x1="372" y1="72" x2="400" y2="72" stroke="{MUTED}" stroke-width="1.2" marker-end="url(#arrow)"/>
  <line x1="560" y1="72" x2="588" y2="72" stroke="{MUTED}" stroke-width="1.2" marker-end="url(#arrow)"/>
  <line x1="748" y1="72" x2="776" y2="72" stroke="{MUTED}" stroke-width="1.2" marker-end="url(#arrow)"/>
  <!-- 분류 → FileDiff 모델 -->
  <path d="M 640,104 V 136 Q 640,144 632,144 H 488 Q 480,144 480,152 V 184" fill="none" stroke="{MUTED}" stroke-width="1.2" marker-end="url(#arrow)"/>
  <!-- 단어 비교 → 분류 -->
  <line x1="696" y1="184" x2="696" y2="104" stroke="{MUTED}" stroke-width="1.2" marker-end="url(#arrow)"/>
  <!-- HTML → 확장 화면 모듈 (핵심 경로) -->
  <line x1="856" y1="104" x2="856" y2="184" stroke="{ACCENT}" stroke-width="1.2" marker-end="url(#arrow-accent)"/>''')

box, svg = label(896, 144, '같은 표기', ACCENT)
P.append(svg)

# --- nodes ---
P.append(node(24, 40, 160, 64, 'input', 'IN', '옛·새 원문', 'oldText · newText'))
P.append(node(212, 40, 160, 64, 'backend', 'REUSE + NEW', '파서 둘 · 정화', 'sourceBlocks · md-it 15'))
P.append(node(400, 40, 160, 64, 'backend', 'REUSE', '옛↔새 잎 짝짓기', 'alignBlocks · band DP'))
P.append(node(588, 40, 160, 64, 'backend', 'NEW', '렌더링으로 분류', 'sourceOnly · invisible'))
P.append(node(776, 40, 160, 64, 'focal', 'NEW', 'GitHub 표기 HTML', 'renderProseDiff(ctx)'))
P.append(node(400, 184, 160, 64, 'store', 'JSON', 'FileDiff 모델', 'diffMarkdown()'))
P.append(node(588, 184, 160, 64, 'backend', 'NEW', '단어 비교', 'Intl.Segmenter'))
P.append(node(776, 184, 160, 64, 'backend', 'REUSE', '확장 화면 모듈', 'applyBody · fold · nav'))

P.append(legend(280, [
    ('focal', '핵심 — GitHub와 같은 표기'), ('tag:NEW', '새로 만듦'), ('tag:REUSE', '확장 코드 재사용'),
    ('input', '입력'), ('store', 'IDE·M2가 쓸 모델'), ('arrow-accent', '리뷰 화면으로'),
]))

note = '''<p class="note">잎 블록은 확장과 같은 기본 파서(sourceBlocks)로, 렌더링은 플러그인을 켠 markdown-it 15로 따로 얻고 원문 줄 범위로 잇는다. 원문 HTML은 DOMPurify + jsdom으로 정화한다. 옛·새 잎은 확장이 GitHub 화면에서 쓰던 alignBlocks를 더 큰 한도로 짝짓고, 원문이 아니라 렌더링으로 바뀜을 판정한다. 렌더링에 안 보이는 변경에는 "원문만 바뀜" 막대를 단다. 결과 HTML은 GitHub rich diff와 같은 표기라 확장의 접기·표 합치기·이동이 그대로 돈다.</p>'''

open(OUT, 'w').write(page(
    'local-review-engine', 'Architecture · packages/engine', '렌더링 diff 엔진 — 원문에서 GitHub 표기 HTML까지',
    '옛·새 마크다운 원문을 파서 둘로 나누고 잎을 짝지어 렌더링으로 분류한 뒤, GitHub rich diff와 같은 표기의 HTML과 IDE용 FileDiff 모델을 내는 엔진의 흐름.',
    VW, VH, '\n'.join(P), note))
print('wrote', OUT)
