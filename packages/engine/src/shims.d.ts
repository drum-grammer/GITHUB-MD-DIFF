// markdown-it-emoji 3.1.0은 타입을 싣지 않는다. @types/markdown-it-emoji는 markdown-it 14 타입을 다시 깔아서 쓰지 않는다
declare module 'markdown-it-emoji' {
  import type { MarkdownIt } from 'markdown-it';
  export const full: (md: MarkdownIt) => void;
  export const light: (md: MarkdownIt) => void;
  export const bare: (md: MarkdownIt) => void;
}
