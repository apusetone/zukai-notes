import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { load } from 'js-yaml';

/** YAML の並びを order に残す (getCollection は ID の順に返すため) */
const ordered = (path: string) =>
  file(path, { parser: (text) => (load(text) as object[]).map((x, order) => ({ ...x, order })) });

/** 項目の ID。`<分野1文字>-<2桁>`。`-00` は基礎の単元 */
const itemId = z.string().regex(/^[A-Z]-\d{2}$/, '項目の ID は A-01 の形にする');

/** 分野: 地図の上のタブ */
const fields = defineCollection({
  loader: ordered('src/content/map/fields.yaml'),
  schema: z.object({
    order: z.number(),
    id: z.string().regex(/^[A-Z]$/, '分野の ID は大文字 1 文字にする'),
    name: z.string(),
    asof: z.coerce.date(),
    basis: z.string().default(''),
    note: z.string().default(''),
  }),
});

/** 分類: 分野の中の区分。地図の左の列 */
const categories = defineCollection({
  loader: ordered('src/content/map/categories.yaml'),
  schema: z.object({
    order: z.number(),
    id: z.string().regex(/^[a-z]-[a-z0-9-]+$/, '分類の ID は o-disc の形にする'),
    field: reference('fields'),
    name: z.string(),
    sub: z.string().default(''),
  }),
});

/** 項目: 分類の中の 1 つの知識。地図のカード */
const items = defineCollection({
  loader: ordered('src/content/map/items.yaml'),
  schema: z.object({
    order: z.number(),
    id: itemId,
    cat: reference('categories'),
    name: z.string(),
    desc: z.string(),
    basic: z.boolean().default(false),
    /** 年を入れると「新 2024」の印が付き、絞り込みの対象になる */
    new: z.number().int().nullable().default(null),
    sources: z.array(z.string()).default([]),
    math: z.array(itemId).default([]),
  }),
});

/** 記事: 項目について自分用にまとめた文書。`# 見出し` 1 つがシート 1 枚 */
const articles = defineCollection({
  // id はファイル名のまま (既定では小文字にされる)
  loader: glob({ pattern: '[!_]*.md', base: 'src/content/articles', generateId: ({ entry }) => entry.replace(/\.md$/, '') }),
  schema: z.object({
    id: z.string().regex(/^[A-Z]-\d{2}[a-z]?$/),
    item: itemId,
    title: z.string(),
    prereq: z.array(itemId).default([]),
    math: z.array(itemId).default([]),
    checked: z
      .object({ script: z.string(), date: z.coerce.date() })
      .nullable()
      .default(null),
  }),
});

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  fields,
  categories,
  items,
  articles,
};
