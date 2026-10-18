// 브라우저 진입점 — 문구 합치기(확장 영어 + 페이지 전용), 세션 비밀, 주소에서 1회용 코드 지우기, 화면·단축키·폴링
import extEn from '../../../../static/_locales/en/messages.json';
import { t, useMessages } from '../../../../src/i18n';
import { installNavKeys } from '../../../../src/nav';
import reviewEn from '../../locales/en.json';
import { createApi, sessionSecret } from './api';
import { renderMermaid } from './mermaid';
import { ReviewPage } from './view';

useMessages({ ...extEn, ...reviewEn });

const doc = document;
const root = doc.getElementById('mdc-app')!;
let storage: Storage | null = null;
try {
  storage = sessionStorage;
} catch {
  storage = null;
}
const secret = sessionSecret(doc, storage);
const remote = doc.querySelector('meta[name="mdc-remote"]') !== null;
// 대화 기록·터미널·브라우저 기록에 남은 주소는 다시 쓸 수 없어야 한다 — 바꾼 직후 주소에서 코드를 지운다
history.replaceState(null, '', remote ? '/?remote=1' : '/');

if (!secret) {
  const p = doc.createElement('p');
  p.className = 'mdc-expired';
  p.textContent = t('reviewCodeExpired');
  root.replaceChildren(p);
} else {
  const page = new ReviewPage(root, { api: createApi(secret), doc, remote, mermaid: renderMermaid, navigate: (url) => location.assign(url) });
  installNavKeys(doc, () => true);
  void page.load().then(() => page.startPolling());
}
