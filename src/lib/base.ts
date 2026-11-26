/**
 * サイトの根の URL (astro.config.mjs の base。環境変数 SITE_BASE で変わる)。
 * サイト内のリンクは必ず withBase を通す。base が '/' の時は何も変えない。
 */
export const base = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** サイトの根からのパス ('/' で始まる) に base を付ける */
export const withBase = (path: string) => `${base}${path}`;

/** 今のページのパスから base を外す。base の外なら、そのまま返す */
export const stripBase = (pathname: string) =>
  base && (pathname === base || pathname.startsWith(`${base}/`)) ? pathname.slice(base.length) || '/' : pathname;
