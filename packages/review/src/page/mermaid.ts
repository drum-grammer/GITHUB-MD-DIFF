// 엔진은 mermaid 자리(section.js-render-needs-enrichment > pre[lang=mermaid])만 낸다 — 번들에 넣은 mermaid로 그린다(CDN 없음, 스펙 §5-7)
interface Mermaid {
  initialize(config: Record<string, unknown>): void;
  run(opts: { nodes: HTMLElement[] }): Promise<void>;
}

let loading: Promise<void> | null = null;

function load(doc: Document): Promise<void> {
  loading ??= new Promise<void>((ok, fail) => {
    const script = doc.createElement('script');
    script.src = '/assets/mermaid.js';
    script.onload = () => ok();
    script.onerror = () => fail(new Error('mermaid did not load'));
    doc.head.append(script);
  });
  return loading;
}

export async function renderMermaid(root: HTMLElement): Promise<void> {
  const pres = [...root.querySelectorAll<HTMLElement>('section.js-render-needs-enrichment pre[lang="mermaid"]')].filter((p) => !p.dataset.mdcMermaid);
  if (!pres.length) return;
  const doc = root.ownerDocument;
  try {
    await load(doc);
  } catch {
    return; // 그림 대신 원문(pre)이 그대로 보인다
  }
  const mermaid = (doc.defaultView as (Window & { mermaid?: Mermaid }) | null)?.mermaid;
  if (!mermaid) return;
  const dark = doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });
  const nodes = pres.map((pre) => {
    pre.dataset.mdcMermaid = '1';
    const box = doc.createElement('div');
    box.className = 'mdc-mermaid';
    // 바뀐 도표는 pre 안이 줄 diff(넣은 줄·지운 줄)라 엔진이 새 원문을 data-mdc-source에 둔다
    box.textContent = pre.dataset.mdcSource ?? pre.textContent ?? '';
    pre.after(box);
    pre.hidden = true;
    return box;
  });
  try {
    await mermaid.run({ nodes });
  } catch (e) {
    for (const n of nodes) {
      if (n.querySelector('svg')) continue;
      n.textContent = e instanceof Error ? e.message : String(e);
      n.classList.add('mdc-error');
    }
  }
}
