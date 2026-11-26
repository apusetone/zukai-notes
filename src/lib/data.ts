/**
 * 地図 (分野・分類・項目) と記事を読み、参照を検査し、記事をシートにして返す。
 * 検査に通らなければ例外を投げ、ビルドを止める。
 * どのページも loadSite() を通して読むので、検査は 1 回のビルドで 1 回だけ走る。
 */
import { getCollection } from 'astro:content';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderArticle, type Sheet } from './render';
import { site } from '../site.config';
import { withBase } from './base';

export type Field = { id: string; name: string; asof: Date; basis: string; note: string };
export type Category = { id: string; field: string; name: string; sub: string };
export type Item = {
  id: string;
  field: string;
  cat: string;
  name: string;
  desc: string;
  basic: boolean;
  new: number | null;
  sources: string[];
  math: string[];
  /** この項目に付く記事の ID */
  pages: string[];
};
export type Article = {
  id: string;
  item: string;
  field: string;
  title: string;
  prereq: string[];
  math: string[];
  checked: { script: string; date: Date } | null;
  /** 原稿のリポ内の場所 */
  source: string;
  sheets: Sheet[];
};
export type SiteData = {
  fields: Field[];
  categories: Category[];
  items: Item[];
  articles: Article[];
  item: (id: string) => Item | undefined;
  category: (id: string) => Category | undefined;
  field: (id: string) => Field | undefined;
  article: (id: string) => Article | undefined;
  /** 項目への飛び先。同じ ID の記事があれば記事の 1 枚目、無ければ地図のカード */
  href: (id: string) => string;
};

let cache: Promise<SiteData> | undefined;
export const loadSite = () => (cache ??= build());

async function build(): Promise<SiteData> {
  const errors: string[] = [];
  const byOrder = <T extends { data: { order: number } }>(a: T, b: T) => a.data.order - b.data.order;
  const fields: Field[] = (await getCollection('fields')).sort(byOrder).map((e) => e.data);
  const categories: Category[] = (await getCollection('categories')).sort(byOrder).map((e) => ({ ...e.data, field: e.data.field.id }));
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  for (const c of categories) {
    if (!fieldById.has(c.field)) errors.push(`分類 ${c.id}: 分野 ${c.field} が無い`);
    else if (!c.id.startsWith(c.field.toLowerCase() + '-')) errors.push(`分類 ${c.id}: ID は分野の小文字 (${c.field.toLowerCase()}-) で始める`);
  }

  const items: Item[] = (await getCollection('items')).sort(byOrder).map((e) => {
    const cat = catById.get(e.data.cat.id);
    if (!cat) errors.push(`項目 ${e.data.id}: 分類 ${e.data.cat.id} が無い`);
    const field = cat?.field ?? '';
    if (cat && !e.data.id.startsWith(field + '-')) errors.push(`項目 ${e.data.id}: 分類 ${cat.id} の分野 ${field} と ID が合わない`);
    return { ...e.data, cat: e.data.cat.id, field, pages: [] };
  });
  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const it of items) {
    for (const m of it.math) if (!itemById.has(m)) errors.push(`項目 ${it.id}: 使う数学 ${m} が地図に無い`);
  }

  const entries = await getCollection('articles');
  const articleIds = new Set(entries.map((e) => e.data.id));
  for (const e of entries) {
    if (e.id !== e.data.id) errors.push(`記事 ${e.filePath}: ファイル名と id (${e.data.id}) を揃える`);
    const it = itemById.get(e.data.item);
    if (!it) errors.push(`記事 ${e.data.id}: 項目 ${e.data.item} が地図に無い`);
    else it.pages.push(e.data.id);
    for (const p of [...e.data.prereq, ...e.data.math]) {
      if (!itemById.has(p)) errors.push(`記事 ${e.data.id}: 前提・使う数学の ${p} が地図に無い`);
    }
    checkVerification(e.data.id, e.data.checked, errors);
  }
  if (errors.length) throw new Error('地図と記事の検査に通らない:\n- ' + errors.join('\n- '));

  const href = (id: string) => itemHref(id, itemById, articleIds);
  const resolve = (id: string) => {
    const it = itemById.get(id);
    return it ? { name: it.name, href: href(id) } : undefined;
  };

  const articles: Article[] = entries
    .map((e) => ({
      ...e.data,
      field: itemById.get(e.data.item)!.field,
      source: e.filePath ?? `src/content/articles/${e.id}.md`,
      sheets: renderArticle(e.data.id, e.body ?? '', resolve),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const articleById = new Map(articles.map((a) => [a.id, a]));

  return {
    fields,
    categories,
    items,
    articles,
    item: (id) => itemById.get(id),
    category: (id) => catById.get(id),
    field: (id) => fieldById.get(id),
    article: (id) => articleById.get(id),
    href,
  };
}

/** 基礎の単元 (ID の末尾が -00) でない記事は掘り下げ。掘り下げは検算が必須 */
export const isDeepDive = (id: string) => !id.endsWith('-00');

/**
 * 掘り下げの記事の検算を検査する。
 * checked があり、script が checks/<ID>.py で、そのファイルがサイトの根からの場所 checks/<ID>.py にあること。
 */
function checkVerification(id: string, checked: Article['checked'], errors: string[]) {
  if (!isDeepDive(id)) return;
  const want = `checks/${id}.py`;
  if (!checked) {
    errors.push(`記事 ${id}: 掘り下げの記事には検算が要る。front matter に checked: { script: ${want}, date: <検算が通った日> } を書く`);
    return;
  }
  if (checked.script !== want) {
    errors.push(`記事 ${id}: checked.script は ${want} にする (今は ${checked.script})`);
    return;
  }
  if (!existsSync(join(process.cwd(), want))) errors.push(`記事 ${id}: 検算のスクリプト ${want} が無い。サイトの根からの ${want} に置く`);
}

function itemHref(id: string, itemById: Map<string, Item>, articleIds: Set<string>) {
  if (articleIds.has(id)) return sheetHref(id, 1);
  const it = itemById.get(id)!;
  return `${mapHref(it.field, it.cat)}#item-${id}`;
}

/** シートのパス。base を付けない。Starlight のサイドバーは自分で base を付けるので、こちらを渡す */
export const sheetPath = (articleId: string, n: number) => `/p/${articleId}/${n}/`;
/** 以下の *Href は base を付けた、そのまま href に書ける URL */
export const sheetHref = (articleId: string, n: number) => withBase(sheetPath(articleId, n));
export const mapHref = (field: string, cat?: string) => withBase(cat ? `/map/${field}/${cat}/` : `/map/${field}/`);
export const homeHref = () => withBase('/');
export const sourceUrl = (path: string) => (site.sourceBaseUrl ? `${site.sourceBaseUrl}/${path}` : null);
export const isNew = (it: Item) => it.new !== null && it.new >= site.newSince;
