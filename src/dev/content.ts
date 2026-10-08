// 개발 빌드 content — 스토어 content를 그대로 돌리고, 자기 빌드 번호를 background에 알린다(자기 갱신)
import '../content';

document.documentElement.dataset.gmdDevBuild = __DEV_BUILD__; // E2E가 지금 도는 빌드를 읽는다
chrome.runtime.sendMessage({ type: 'dev-build', build: __DEV_BUILD__ }).catch(() => undefined);
