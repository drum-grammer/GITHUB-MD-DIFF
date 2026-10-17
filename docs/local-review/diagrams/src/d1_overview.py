"""그림 1 — 로컬 리뷰 전체 설계와 진행(마일스톤별 상태). 쓰기: python3 d1_overview.py ../overview.html"""
import sys
from lib import *

OUT = sys.argv[1]
VW, VH = 960, 488
P = []

# --- arrows (선 먼저) ---
P.append(f'''
  <!-- GitHub rich diff → 확장 화면 모듈 (지금 제품) -->
  <line x1="184" y1="72" x2="400" y2="72" stroke="{MUTED}" stroke-width="1.2" marker-end="url(#arrow)"/>
  <!-- 확장 화면 모듈 → 로컬 리뷰 페이지 (재사용) -->
  <line x1="480" y1="104" x2="480" y2="168" stroke="{MUTED}" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#arrow)"/>
  <!-- 작업 트리 → 엔진 -->
  <line x1="184" y1="200" x2="212" y2="200" stroke="{MUTED}" stroke-width="1.2" marker-end="url(#arrow)"/>
  <!-- 엔진 → 페이지 (M2) -->
  <line x1="372" y1="200" x2="400" y2="200" stroke="{MUTED}" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#arrow)"/>
  <!-- 페이지 → 코멘트 저장 (M2) -->
  <line x1="560" y1="200" x2="588" y2="200" stroke="{MUTED}" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#arrow)"/>
  <!-- 코멘트 저장 → 에이전트 (M2) -->
  <line x1="748" y1="200" x2="776" y2="200" stroke="{MUTED}" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#arrow)"/>
  <!-- GitHub PR → 엔진 (M4, gh) -->
  <line x1="292" y1="296" x2="292" y2="232" stroke="{LINK}" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#arrow-link)"/>
  <!-- 페이지 → GitHub PR (M4, 보류 중 리뷰) -->
  <line x1="480" y1="232" x2="480" y2="296" stroke="{LINK}" stroke-width="1.2" stroke-dasharray="4,3" marker-end="url(#arrow-link)"/>
  <!-- 에이전트 → 작업 트리 (고친 뒤 다음 라운드) -->
  <path d="M 856,232 V 376 Q 856,384 848,384 H 112 Q 104,384 104,376 V 232" fill="none" stroke="{MUTED}" stroke-width="1" stroke-dasharray="4,3" marker-end="url(#arrow)"/>''')

# --- labels ---
for (cx, cy, t, c) in [
    (292, 56, '지금 제품', MUTED),
    (510, 136, '재사용', MUTED),
    (256, 264, 'PR 내용', LINK),
    (520, 264, '보류 리뷰', LINK),
    (480, 400, '고친 뒤 다음 라운드', MUTED),
]:
    box, svg = label(cx, cy, t, c)
    P.append(svg)

# --- nodes ---
P.append(node(24, 40, 160, 64, 'external', '1.5.1 · TODAY', 'GitHub rich diff', 'Files changed'))
P.append(node(400, 40, 160, 64, 'backend', 'M0 · MERGED', '확장 화면 모듈', 'fold · nav · comment-ui'))
P.append(node(24, 168, 160, 64, 'input', 'GIT', '작업 트리', 'git diff · merge-base'))
P.append(node(212, 168, 160, 64, 'focal', 'M1 · THIS PR', '렌더링 diff 엔진', 'packages/engine'))
P.append(node(400, 168, 160, 64, 'optional', 'M2 · NEXT', '로컬 리뷰 페이지', 'localhost · CLI'))
P.append(node(588, 168, 160, 64, 'optional', 'M2', '코멘트 저장', 'rounds · drafts'))
P.append(node(776, 168, 160, 64, 'optional', 'M2 · M3', '에이전트', 'Claude Code · Codex'))
P.append(node(212, 296, 348, 64, 'optional', 'M4', 'GitHub PR 모드', 'gh api · pending review'))

P.append(legend(428, [
    ('focal', 'M1 — 이 PR'), ('backend', '있음 — M0·1.5.1'), ('input', '로컬 git'), ('external', 'GitHub'),
    ('optional', '남은 일 — M2~M4'), ('arrow-link', 'gh 요청'), ('arrow-dash', 'M2 이후 흐름'),
]))

note = '''<p class="note">실선 상자는 이미 있는 것이다. 크롬 확장 1.5.1은 GitHub가 그린 rich diff를 다듬고, M0에서 그 화면 모듈을 확장 밖에서도 쓰게 떼어 냈다. 이 PR(M1)은 로컬 git의 옛·새 원문으로 GitHub와 같은 표기의 HTML을 직접 그리는 엔진이다. 점선 상자는 남은 일이다. M2는 리뷰 페이지·로컬 서버·CLI·에이전트에게 넘기기, M3는 Codex 주석, M4는 GitHub PR 모드다.</p>'''

open(OUT, 'w').write(page(
    'local-review-overview', 'Architecture · 2026-10-18', 'Markdown Diff Cat 로컬 리뷰 — 전체 설계와 진행',
    '크롬 확장의 화면 모듈과 새 렌더링 diff 엔진으로 로컬 git 변경을 리뷰하고 코멘트를 에이전트에게 넘기는 설계에서, 이미 있는 것(1.5.1·M0·M1)과 남은 것(M2~M4)을 나눠 보인다.',
    VW, VH, '\n'.join(P), note))
print('wrote', OUT)
