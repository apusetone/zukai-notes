/**
 * 記事の原稿 (Markdown) をシートに分けて HTML にする。
 *
 * - `# 見出し` 1 つがシート 1 枚。`# group / 題` と書くと group 付き
 * - `:::lead` などのブロックは部品の HTML になる (下の BLOCKS)
 * - `[[D-01]]` は項目への参照になる。無い ID はエラー
 * - `$…$` `$$…$$` は KaTeX でビルド時に HTML にする。KaTeX のエラーはビルドを止める
 * - `:::quiz[問1]` は確かめるの問い。本文から外して、データとして返す
 *
 * 原稿の HTML はそのまま通す。ただし動く物 (script・on* 属性・javascript: の URL など) はエラーにする。
 * 原稿は外の資料から作ることがあり、そこへ紛れた物をページで動かさないため。
 */
import type { Root, RootContent, Parent, PhrasingContent, Paragraph, List, Heading } from 'mdast';
import type { Root as HRoot, Element } from 'hast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import { visit, SKIP } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';
import { VFile } from 'vfile';
import { base, withBase } from './base';

export type QuizOption = { html: string; ok: boolean };
export type Quiz = { label: string; q: string; opts: QuizOption[]; why: string };
export type Sheet = { group: string; title: string; html: string; quiz: Quiz[] };

/** 参照先を引くための情報。項目名と、飛び先の URL */
export type RefResolver = (id: string) => { name: string; href: string } | undefined;

export class ArticleError extends Error {}

type Block = { tag: string; className: string[]; label?: string; titleTag?: 'h3' | 'p' };

/** `:::名前` → 部品の HTML */
const BLOCKS: Record<string, Block> = {
  frame: { tag: 'div', className: ['box', 'box-frame'], titleTag: 'h3' },
  prop: { tag: 'div', className: ['box', 'box-prop'], label: '命題' },
  proof: { tag: 'div', className: ['box', 'box-proof'], label: '証明' },
  note: { tag: 'div', className: ['box', 'box-note'], titleTag: 'p' },
  cols: { tag: 'div', className: ['cols'] },
  col: { tag: 'div', className: ['col'] },
};
// lead と sources は中身の要素にクラスを付けるだけなので別に扱う。quiz はデータにする。
const KNOWN = new Set([...Object.keys(BLOCKS), 'lead', 'sources', 'quiz']);

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkDirective).use(remarkMath);

const toHtml = unified()
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeNoActive)
  .use(rehypeKatex, { output: 'htmlAndMathml' })
  .use(rehypeSpecParts)
  .use(rehypeStringify);

function el(hName: string, className: string[], children: any[], type = 'zkElement'): any {
  return { type, data: { hName, hProperties: { className } }, children };
}

/** 原稿全体を受け取り、シートの配列を返す */
export function renderArticle(articleId: string, body: string, resolve: RefResolver): Sheet[] {
  const fail = (msg: string): never => {
    throw new ArticleError(`記事 ${articleId}: ${msg}`);
  };
  const tree = parser.parse(body) as Root;
  parser.runSync(tree);

  // 文中の `:abc` (例: 「注意:foo」) が text directive になるので文字に戻す
  visit(tree, (node: any, index, parent: any) => {
    if (node.type === 'textDirective' && parent && index !== undefined) {
      const back: PhrasingContent[] = [{ type: 'text', value: ':' + node.name }];
      if (node.children?.length) back.push({ type: 'text', value: '[' }, ...node.children, { type: 'text', value: ']' });
      parent.children.splice(index, 1, ...back);
      return [SKIP, index + back.length];
    }
    if (node.type === 'leafDirective') fail(`「::${node.name}」は使えない。ブロックは「:::名前」で書く`);
    if (node.type === 'containerDirective' && !KNOWN.has(node.name)) fail(`「:::${node.name}」という部品は無い`);
  });

  // # 見出しでシートに分ける
  const chunks: { heading: Heading; nodes: RootContent[] }[] = [];
  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth === 1) chunks.push({ heading: node, nodes: [] });
    else if (chunks.length) chunks[chunks.length - 1].nodes.push(node);
    else if (!(node.type === 'html' && node.value.startsWith('<!--'))) fail('最初の「# 見出し」より前に本文がある');
  }
  if (!chunks.length) fail('シートが無い。「# 見出し」1 つがシート 1 枚になる');

  let sourceCount = 0;
  const sheets = chunks.map(({ heading, nodes }, i): Sheet => {
    const text = toString(heading).trim();
    const slash = text.indexOf(' / ');
    const group = slash >= 0 ? text.slice(0, slash).trim() : '';
    const title = slash >= 0 ? text.slice(slash + 3).trim() : text;
    const where = `${i + 1} 枚目「${title}」`;
    const root: Root = { type: 'root', children: nodes };

    // 確かめるの問いを取り出す
    const quiz: Quiz[] = [];
    root.children = root.children.filter((node: any) => {
      if (node.type !== 'containerDirective' || node.name !== 'quiz') return true;
      quiz.push(readQuiz(node, `${where} の問い`, fail, resolve));
      return false;
    });

    transformBlocks(root, where, fail, resolve);
    visit(root, (node: any) => {
      if (node.data?.zkSources) sourceCount += node.children.length;
    });
    return { group, title, html: mdToHtml(root, where, fail), quiz };
  });

  if (sourceCount === 0) fail('出典が無い。「:::sources」の箇条書きに 1 つ以上書く');
  const isFoundation = articleId.endsWith('-00');
  const quizSheets = sheets.filter((s) => s.quiz.length);
  if (isFoundation && quizSheets.length) fail('基礎の単元 (-00) には確かめるを置かない');
  if (!isFoundation && !sheets[sheets.length - 1].quiz.length) fail('最後のシート (確かめる) に「:::quiz」が無い');
  return sheets;
}

function readQuiz(node: any, where: string, fail: (m: string) => never, resolve: RefResolver): Quiz {
  const children: RootContent[] = [...node.children];
  let label = '';
  if (children[0]?.type === 'paragraph' && (children[0] as any).data?.directiveLabel) {
    label = toString(children.shift()!);
  }
  const listIndex = children.findIndex((c) => c.type === 'list');
  if (listIndex < 0) fail(`${where}: 選択肢の箇条書き (- [ ] / - [x]) が無い`);
  const list = children[listIndex] as List;
  const opts = list.children.map((li) => {
    if (li.checked === null || li.checked === undefined) fail(`${where}: 選択肢は「- [ ]」か「- [x]」で書く`);
    const children = li.children.flatMap((c): RootContent[] => (c.type === 'paragraph' ? c.children : [c]));
    const root: Root = { type: 'root', children };
    transformBlocks(root, where, fail, resolve);
    return { html: mdToHtml(root, where, fail), ok: li.checked === true };
  });
  const okCount = opts.filter((o) => o.ok).length;
  if (okCount !== 1) fail(`${where}: 正答 (- [x]) がちょうど 1 つでない (${okCount} 個)`);
  if (opts.length < 2) fail(`${where}: 選択肢が 2 つ未満`);
  const part = (nodes: RootContent[]) => {
    const root: Root = { type: 'root', children: nodes };
    transformBlocks(root, where, fail, resolve);
    return mdToHtml(root, where, fail);
  };
  const q = part(children.slice(0, listIndex));
  const why = part(children.slice(listIndex + 1));
  if (!q) fail(`${where}: 問いの文が無い`);
  if (!why) fail(`${where}: 解説が無い`);
  return { label, q, opts, why };
}

/** :::部品 と [[ID]] を、hName 付きの節に置き換える */
function transformBlocks(root: Root, where: string, fail: (m: string) => never, resolve: RefResolver) {
  visit(root, 'text', (node, index, parent: Parent | undefined) => {
    if (!parent || index === undefined || !node.value.includes('[[')) return;
    const out: any[] = [];
    let last = 0;
    for (const m of node.value.matchAll(/\[\[([A-Z]-\d{2}[a-z]?)\]\]/g)) {
      const ref = resolve(m[1]);
      if (!ref) fail(`${where}: [[${m[1]}]] の項目が地図に無い`);
      if (m.index! > last) out.push({ type: 'text', value: node.value.slice(last, m.index) });
      out.push({
        type: 'link',
        url: ref!.href,
        data: { hProperties: { className: ['ref'] } },
        children: [el('span', ['ref-id'], [{ type: 'text', value: m[1] }]), { type: 'text', value: ref!.name }],
      });
      last = m.index! + m[0].length;
    }
    if (!out.length) return;
    if (last < node.value.length) out.push({ type: 'text', value: node.value.slice(last) });
    parent.children.splice(index, 1, ...out);
    return [SKIP, index + out.length];
  });

  visit(root, 'containerDirective', (node: any, index, parent: any) => {
    const kids: RootContent[] = node.children;
    const labelNode = kids[0]?.type === 'paragraph' && (kids[0] as any).data?.directiveLabel ? (kids.shift() as Paragraph) : undefined;

    if (node.name === 'lead') {
      // 中の段落に lead のクラスを付けて、枠は外す
      for (const k of kids) if (k.type === 'paragraph') k.data = { hProperties: { className: ['lead'] } };
      parent.children.splice(index, 1, ...kids);
      return [SKIP, index];
    }
    if (node.name === 'sources') {
      const list = kids.find((k): k is List => k.type === 'list');
      if (!list || kids.length !== 1) fail(`${where}: 「:::sources」の中は箇条書きだけにする`);
      list!.data = { hProperties: { className: ['sources'] }, zkSources: true } as any;
      parent.children.splice(index, 1, list);
      return [SKIP, index];
    }
    if (node.name === 'quiz') fail(`${where}: 「:::quiz」は他の部品の中に置けない`);

    const block = BLOCKS[node.name];
    const children: any[] = [];
    if (block.label) children.push(el('span', ['box-label'], [{ type: 'text', value: block.label }]));
    if (block.titleTag) {
      if (!labelNode) fail(`${where}: 「:::${node.name}[題]」の題が無い`);
      children.push(el(block.titleTag, block.titleTag === 'p' ? ['box-title'] : undefined as any, labelNode!.children));
    }
    if (block.label || block.titleTag) children.push(el('div', ['box-body'], kids));
    else children.push(...kids);
    node.data = { hName: block.tag, hProperties: { className: block.className } };
    node.children = children;
  });
}

function mdToHtml(root: Root, where: string, fail: (m: string) => never): string {
  const file = new VFile();
  const hast = toHtml.runSync(root as any, file);
  const html = toHtml.stringify(hast as any, file) as string;
  const katexError = file.messages.find((m) => m.source === 'rehype-katex');
  if (katexError) fail(`${where}: 数式のエラー: ${katexError.cause ?? katexError.reason}`);
  const active = file.messages.find((m) => m.source === ACTIVE_SOURCE);
  if (active) fail(`${where}: ${active.reason}`);
  return html.trim();
}

/** 原稿に書けない要素。読み込みや実行の口になる */
const ACTIVE_TAGS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'meta', 'link', 'portal']);
/** URL を取る属性 (SVG のアニメーションで href を書き換える to / values なども)。javascript: を断る */
const URL_PROPS = new Set(['href', 'xLinkHref', 'src', 'srcSet', 'poster', 'action', 'formAction', 'data', 'cite', 'background', 'ping', 'to', 'from', 'by', 'values']);
/** そのうち data: も断るもの */
const LINK_PROPS = new Set(['href', 'xLinkHref', 'action', 'formAction']);

const ACTIVE_SOURCE = 'zk-no-active';

/** 原稿の HTML に動く物があれば印を付ける。mdToHtml がエラーにする。消して通すと書き手が気付かないので止める */
function rehypeNoActive() {
  return (tree: HRoot, file: VFile) => {
    visit(tree, 'element', (node: Element) => {
      if (ACTIVE_TAGS.has(node.tagName)) {
        file.message(`<${node.tagName}> は使えない`, { source: ACTIVE_SOURCE });
      }
      for (const [prop, value] of Object.entries(node.properties ?? {})) {
        if (/^on/i.test(prop)) file.message(`<${node.tagName}> の ${prop} は使えない (イベントの属性)`, { source: ACTIVE_SOURCE });
        if (!URL_PROPS.has(prop)) continue;
        for (const v of Array.isArray(value) ? value : [value]) {
          if (typeof v !== 'string') continue;
          // 空白や制御文字を挟んで書く形もあるので、取り除いてから見る
          const flat = v.replace(/[\u0000-\u0020]/g, '').toLowerCase();
          if (/(?:^|[^a-z])(?:javascript|vbscript):/.test(flat) || (LINK_PROPS.has(prop) && flat.startsWith('data:'))) {
            file.message(`<${node.tagName}> の ${prop} に使えない URL がある`, { source: ACTIVE_SOURCE });
          }
        }
      }
    });
  };
}

/** KaTeX と表の後処理: 別行の数式の枠、句読点と離さない文中の数式、表の横スクロール、出典のリンク */
function rehypeSpecParts() {
  return (tree: HRoot) => {
    visit(tree, 'element', (node: Element, index, parent: any) => {
      if (!parent || index === undefined) return;
      const cls = (node.properties.className as string[] | undefined) ?? [];
      if (cls.includes('katex-display')) {
        if (parent.type === 'element' && parent.tagName === 'p') return SKIP;
        parent.children[index] = { type: 'element', tagName: 'p', properties: { className: ['katex-block'] }, children: [node] };
        return SKIP;
      }
      if (cls.includes('katex')) {
        const next = parent.children[index + 1];
        if (next?.type === 'text' && /^[、。，．,.）)」』]/.test(next.value)) {
          const m = next.value.match(/^[、。，．,.）)」』]+/)![0];
          next.value = next.value.slice(m.length);
          parent.children[index] = {
            type: 'element',
            tagName: 'span',
            properties: { className: ['nobr'] },
            children: [node, { type: 'text', value: m }],
          };
        }
        return SKIP;
      }
      if (node.tagName === 'table') {
        parent.children[index] = { type: 'element', tagName: 'div', properties: { className: ['table-wrap'] }, children: [node] };
        return SKIP;
      }
      if (node.tagName === 'a' && /^https?:/.test(String(node.properties.href))) {
        node.properties.rel = ['noopener'];
      }
    });
    // サイトの根からのリンクと画像 (/articles/<ID>/x.png など) に base を付ける。
    // [[ID]] の参照は付いた URL で来るので、もう付いている物はそのまま
    visit(tree, 'element', (node: Element) => {
      const fix = (v: string) => (!v.startsWith('/') || v.startsWith('//') || (base && (v === base || v.startsWith(`${base}/`))) ? v : withBase(v));
      for (const prop of ['href', 'src', 'poster'] as const) {
        const v = node.properties[prop];
        if (typeof v === 'string') node.properties[prop] = fix(v);
      }
      // srcset は「URL 幅, URL 幅」の並び
      const set = node.properties.srcSet;
      if (Array.isArray(set) || typeof set === 'string') {
        const items = Array.isArray(set) ? set.map(String) : set.split(',');
        node.properties.srcSet = items.map((item) => item.trim().replace(/^\S+/, (u) => fix(u))).join(', ');
      }
    });
    // 空の段落 (部品の外しで残るもの) は出さない
    visit(tree, 'element', (node: Element, index, parent: any) => {
      if (node.tagName === 'p' && !node.children.length && parent && index !== undefined) {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
    });
  };
}

