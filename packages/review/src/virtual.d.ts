/** 빌드(esbuild define)와 vitest(define)가 넣는 package.json 버전 */
declare const __MDC_VERSION__: string;

declare module 'virtual:mdc-assets' {
  /** 이름 → 형식·브로틀리 압축 여부·base64 본문·원래 바이트 수. 빌드가 채우고 시험은 test/stub-assets.ts를 쓴다 */
  const assets: Record<string, { type: string; br: boolean; b64: string; bytes?: number }>;
  export default assets;
}
