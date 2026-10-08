// 스토어 등록정보 글 — store/*.md·_locales가 정본. 업로드 도우미(store:upload)와 스토어 업데이트 하네스(release)가 같이 쓴다
import { execFileSync } from 'node:child_process';

export const after = (text, marker) => text.split(marker)[1].trim();
export const plain = (s) => s.replaceAll('`', '');
/** read(경로) → 대시보드 칸별 글. 같은 함수로 지난 태그의 글도 만들어 바뀐 칸을 찾는다 */
export function textsFrom(read) {
  const md = (name) => read(`store/${name}`);
  const privacy = md('privacy-practices.md');
  const reason = (perm) => plain(privacy.split('\n').find((l) => l.startsWith(`| ${perm}`)).split('|')[2].trim());
  const summary = (lang) => JSON.parse(read(`static/_locales/${lang}/messages.json`)).extDescription.message;
  return {
    sumEn: summary('en'),
    sumKo: summary('ko'),
    descEn: after(md('listing.en.md'), '## Description'),
    descKo: after(md('listing.ko.md'), '## 상세 설명'),
    single: after(privacy, '## Single purpose').split('\n## ')[0].trim(),
    storage: reason('`storage`'),
    host: reason('Host permission'),
    // 원격 코드 사유 — privacy-practices.md "## Remote code" 문단에서 굵은 답("No, …")을 뺀 나머지
    remote: plain(after(privacy, '## Remote code').split('\n## ')[0].replace(/^\*\*[^*]+\*\*\s*/, '').trim()),
    // 테스트 안내 — test-instructions.md 첫 줄의 안내 문구 뒤 전부(버전마다 바뀌는 문장을 코드에 박지 않는다)
    tests: plain(after(md('test-instructions.md'), 'Paste into the dashboard → Test instructions.')),
  };
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** 지난 태그·커밋(prevRef)의 글과 cur을 비교해 바뀐 칸(cur의 키)과 그림 변경 여부 */
export function compareListing(prevRef, cur) {
  const changed = new Set(Object.keys(cur));
  try {
    const prev = textsFrom((path) => git('show', `${prevRef}:${path}`));
    for (const k of Object.keys(prev)) if (prev[k] === cur[k]) changed.delete(k);
  } catch {
    // 지난 글 모양이 달라 못 읽으면 전부 바뀐 것으로 본다
  }
  let imagesChanged = true;
  try {
    execFileSync('git', ['diff', '--quiet', prevRef, '--', 'store/images', 'static/icons/icon128.png'], { stdio: 'ignore' });
    imagesChanged = false;
  } catch {
    imagesChanged = true;
  }
  return { changed, imagesChanged };
}
