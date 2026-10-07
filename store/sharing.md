# Sharing kit

Material for announcing Markdown Diff Cat for GitHub in a chat, post, or email, inside a team or in public. Facts checked on 2026-10-08.

## Before you post

- Check whether the warning below still appears: in a Chrome profile with Enhanced Safe Browsing on and without the extension, open the store page and click **Add to Chrome**, then **Close**. If no "Proceed with caution" dialog appears, drop the warning note from the message.
- Do not tell people to turn off Safe Browsing. Do not say Google "verified" or "certified" the extension. Do not promise a date for the warning to go away.

## Links

- Chrome Web Store: https://chromewebstore.google.com/detail/markdown-diff-cat-for-git/kabekbbeoajhpbcppidepmcbbjjochlj
- Source code (MIT): https://github.com/drum-grammer/GITHUB-MD-DIFF
- Privacy policy: https://github.com/drum-grammer/GITHUB-MD-DIFF/blob/main/PRIVACY.md
- Release notes: https://github.com/drum-grammer/GITHUB-MD-DIFF/releases

## The "Proceed with caution" warning

### What people see

People who turned on Enhanced Safe Browsing in Chrome see a dialog when they click **Add to Chrome**:

- English: "Proceed with caution", "This extension is not trusted by Enhanced Safe Browsing.", buttons **Close** and **Continue to install**
- Korean: "주의해서 진행하시기 바랍니다", "향상된 세이프 브라우징에서 신뢰하지 않는 확장 프로그램입니다.", buttons **닫기** and **설치 계속**

People on Chrome's default Standard protection do not see it.

### Why it appears

The publisher account is new. The warning is not caused by anything in the extension.

- Enhanced Safe Browsing trusts extensions whose developer follows the Chrome Web Store Developer Program Policies, and a new developer has to build that record first. Google: "For new developers, it will take at least a few months of respecting these conditions to become trusted." ([Google Online Security Blog, 2021-06-03](https://security.googleblog.com/2021/06/new-protections-for-enhanced-safe.html)). The Help Center says new developers "generally" take a few months ([Install and manage extensions](https://support.google.com/chrome_webstore/answer/2664769)).
- This is the publisher's first extension, published in October 2026. Every new publisher's extensions show this dialog for a while.
- The dialog means "not on the trusted list yet". It does not mean anything harmful was found.

### Why it is fine to continue

- The extension passed Chrome Web Store review and is listed publicly.
- Permissions are narrow: `storage` for its one on/off setting, and it runs only on `https://github.com/*`. It does not run on other sites.
- It collects no data, makes no network requests, and loads no remote code ([privacy policy](../PRIVACY.md)).
- The code is open source (MIT). Each release on GitHub is tagged at the commit it was built from and carries the exact package uploaded to the store.

### What to do

Click **Continue to install** (**설치 계속**). Nothing else changes: Safe Browsing stays on and keeps protecting everything else.

### When it goes away

On its own, after the publisher has followed the policies for a few months. Neither users nor the publisher need to do anything, and Google gives no exact date.

## Ready to paste

### English

> I made a Chrome extension that shows Markdown changes in GitHub pull requests as a rendered diff with only the changed parts. It makes long design docs much easier to review.
> https://chromewebstore.google.com/detail/markdown-diff-cat-for-git/kabekbbeoajhpbcppidepmcbbjjochlj
> If Chrome says "Proceed with caution", that is because I am a new publisher on the Chrome Web Store, not because of the extension. Click "Continue to install". It only runs on github.com and collects no data. Source: https://github.com/drum-grammer/GITHUB-MD-DIFF

### 한국어

> GitHub PR의 마크다운 변경을 렌더링된 모양으로, 바뀐 부분만 보여 주는 크롬 확장을 만들었어요. 긴 설계 문서를 리뷰할 때 편해요.
> https://chromewebstore.google.com/detail/markdown-diff-cat-for-git/kabekbbeoajhpbcppidepmcbbjjochlj
> 설치할 때 "주의해서 진행하시기 바랍니다" 창이 뜰 수 있어요. 확장 문제가 아니라 제가 크롬 웹 스토어에 처음 올린 새 게시자라서 뜨는 안내예요. "설치 계속"을 누르면 돼요. github.com에서만 동작하고 수집하는 데이터는 없어요. 소스: https://github.com/drum-grammer/GITHUB-MD-DIFF

## When someone asks "Is this warning OK?"

### English

> Yes. Chrome shows it for extensions from publishers who are new to the Chrome Web Store. Google says a new publisher takes a few months to become trusted. It does not mean anything harmful was found. The extension passed store review, only runs on github.com, makes no network requests, and its code is open source.

### 한국어

> 네, 괜찮아요. 크롬은 웹 스토어에 새로 온 게시자의 확장에 이 창을 띄워요. Google 안내로는 새 게시자가 신뢰 목록에 오르기까지 몇 달 걸려요. 해로운 게 발견됐다는 뜻은 아니에요. 스토어 심사를 통과했고, github.com에서만 동작하고, 네트워크 요청이 없고, 코드도 공개돼 있어요.

## 한국어 요약

- **무엇**: 향상된 세이프 브라우징을 켠 크롬에서 **Chrome에 추가**를 누르면 "주의해서 진행하시기 바랍니다 — 향상된 세이프 브라우징에서 신뢰하지 않는 확장 프로그램입니다" 창이 뜬다. 기본값(표준 보호)인 사람에게는 뜨지 않는다.
- **왜**: 게시자 계정이 새것이라서다. Google은 웹 스토어 정책을 지키는 개발자의 확장을 신뢰하고, 새 개발자는 최소 몇 달 정책을 지켜야 신뢰 목록에 오른다(위 출처). "아직 신뢰 목록에 없음"이지 "해로운 것을 찾음"이 아니다.
- **괜찮은 근거**: 스토어 심사 통과·공개 게시, 권한은 `storage`와 `https://github.com/*`뿐, 데이터 수집·네트워크 요청·원격 코드 없음, MIT 공개 소스, 릴리스마다 스토어에 올린 zip을 GitHub Release에 그대로 첨부.
- **할 일**: **설치 계속**. 세이프 브라우징을 끄라고 안내하지 않는다.
- **언제 사라지나**: 몇 달 뒤 저절로. 정확한 날짜는 Google이 알려 주지 않으니 날짜를 약속하지 않는다. 공유하기 전에 위 "Before you post" 방법으로 아직 뜨는지 확인하고, 사라졌으면 안내 문장을 뺀다.
