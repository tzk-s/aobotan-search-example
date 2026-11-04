/**
 * ビルド: data/works.json → dist/index.html、src/styles/main.scss → dist/assets/style.css、src/*.js → dist/assets/
 *
 * 【役割の境界】
 *   ビルド時（このファイル）… データの検証と、全件のカード HTML の出力
 *   ブラウザー（src/）       … 出力済みのカードを hidden で出し分けるだけ（データは読まない）
 *   絞り込みの定義（分類軸と key）はチェックボックスの name / value、
 *   事例の分類はカードの data-* 属性として HTML に埋め込み、ブラウザー側はそれを読む。
 *
 * 公開用サンプルのために新しく書いたもの。元サイトでは Astro のページと
 * CSV を読み込むビルド処理が同じ役割を担っている（このサンプルには含めていない）。
 *
 * 使い方: node scripts/build.mjs
 * テスト: tests/build.test.js
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as sass from "sass";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 分類軸・分類・事例 ID に使える文字（URL にそのまま書けるもの） */
const KEY_PATTERN = /^[a-z0-9-]{1,64}$/;

/** dist/assets/ にそのままコピーする JS（ブラウザーの ES Modules で読み込む。バンドルはしない） */
const SCRIPTS = ["main.js", "works-filter.js", "works-query.js"];

/**
 * データの不備を一覧で返す（空配列なら問題なし）
 * - 分類軸・分類の key の書式と重複
 * - 事例 ID の書式と重複、必須項目（タイトル）の不足
 * - 未定義の分類、分類の指定漏れ（各軸 1 つ以上）
 * @param {unknown} data
 * @returns {string[]}
 */
export const validateWorksData = (data) => {
  const errors = [];
  const axes = Array.isArray(data?.axes) ? data.axes : [];
  const works = Array.isArray(data?.works) ? data.works : [];
  if (axes.length === 0) errors.push("axes: 分類軸が 1 つもありません");
  if (works.length === 0) errors.push("works: 事例が 1 件もありません");

  /** @type {Map<string, Set<string>>} */
  const defined = new Map();
  axes.forEach((axis, i) => {
    const where = `axes[${i}]`;
    if (!KEY_PATTERN.test(axis?.key ?? ""))
      errors.push(`${where}.key: 英小文字・数字・ハイフンで指定してください`);
    if (defined.has(axis?.key))
      errors.push(`${where}.key: "${axis.key}" が重複しています`);
    if (!axis?.label) errors.push(`${where}.label: 必須です`);
    const keys = new Set();
    (Array.isArray(axis?.categories) ? axis.categories : []).forEach(
      (category, j) => {
        const at = `${where}.categories[${j}]`;
        if (!KEY_PATTERN.test(category?.key ?? ""))
          errors.push(`${at}.key: 英小文字・数字・ハイフンで指定してください`);
        else if (keys.has(category.key))
          errors.push(`${at}.key: "${category.key}" が重複しています`);
        if (!category?.label) errors.push(`${at}.label: 必須です`);
        keys.add(category?.key);
      },
    );
    if (keys.size === 0)
      errors.push(`${where}.categories: 分類が 1 つもありません`);
    defined.set(axis?.key, keys);
  });

  const ids = new Set();
  works.forEach((work, i) => {
    const where = `works[${i}]`;
    if (!KEY_PATTERN.test(work?.id ?? ""))
      errors.push(`${where}.id: 英小文字・数字・ハイフンで指定してください`);
    else if (ids.has(work.id))
      errors.push(`${where}.id: "${work.id}" が重複しています`);
    ids.add(work?.id);
    if (!work?.title) errors.push(`${where}.title: 必須です`);
    defined.forEach((keys, axis) => {
      const values = work?.categories?.[axis];
      if (!Array.isArray(values) || values.length === 0) {
        errors.push(`${where}.categories.${axis}: 1 つ以上指定してください`);
        return;
      }
      values
        .filter((value) => !keys.has(value))
        .forEach((value) =>
          errors.push(
            `${where}.categories.${axis}: "${value}" は未定義の分類です`,
          ),
        );
    });
  });
  return errors;
};

/** HTML のテキスト・属性値として安全な文字列にする */
export const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** 絞り込みフォーム（初期状態は操作不可。works-filter.js が初期化後に有効化する） */
const renderFilter = (axes) => `
      <div class="p-works__filter js-works-filter" data-state="loading">
        <form class="c-filter" aria-labelledby="works-filter-heading" aria-busy="true" autocomplete="off">
          <h2 class="c-filter__heading" id="works-filter-heading">条件で絞り込む</h2>
          <p class="c-filter__help">同じ分類の中では「いずれか」、異なる分類どうしは「すべて」に当てはまる事例を表示します。</p>
          <fieldset class="c-filter__fields js-works-filter-fields" disabled>
${axes
  .map(
    (axis) => `            <fieldset class="c-filter__group">
              <legend class="c-filter__label">${escapeHtml(axis.label)}</legend>
              <div class="c-filter__options">
${axis.categories
  .map(
    (category) => `                <label class="c-filter__option">
                  <input class="c-filter__checkbox js-works-filter-input" type="checkbox" name="${escapeHtml(axis.key)}" value="${escapeHtml(category.key)}" />
                  <span class="c-filter__tag">${escapeHtml(category.label)}</span>
                </label>`,
  )
  .join("\n")}
              </div>
            </fieldset>`,
  )
  .join("\n")}
          </fieldset>
          <noscript>
            <p class="c-filter__notice">絞り込みにはJavaScriptが必要です。施工事例は全件ご覧いただけます。</p>
          </noscript>
        </form>
      </div>`;

/** 事例カード。分類は data-*（スペース区切り）に埋め込み、ブラウザー側の判定に使う */
const renderItem = (work, axes) => {
  const dataAttrs = axes
    .map(
      (axis) =>
        `data-${axis.key}="${escapeHtml(work.categories[axis.key].join(" "))}"`,
    )
    .join(" ");
  const tags = axes
    .flatMap((axis) =>
      work.categories[axis.key].map(
        (key) =>
          axis.categories.find((category) => category.key === key)?.label ??
          key,
      ),
    )
    .map((label) => `<li class="c-card__tag">${escapeHtml(label)}</li>`)
    .join("");
  return `          <li class="p-works__item js-works-item" ${dataAttrs}>
            <article class="c-card">
              <p class="c-card__badge">架空のサンプル</p>
              <h3 class="c-card__title">${escapeHtml(work.title)}</h3>
              <ul class="c-card__tags" aria-label="分類">${tags}</ul>
              <p class="c-card__text">${escapeHtml(work.summary ?? "")}</p>
            </article>
          </li>`;
};

/**
 * <body> の中身（テストでも同じ HTML を使う）
 * @param {{ axes: any[], works: any[] }} data 検証済みのデータ
 */
export const renderBody = ({ axes, works }) => `
  <main class="p-works">
    <div class="l-container">
      <h1 class="p-works__heading">施工事例（検索サンプル）</h1>
      <p class="p-works__notice">※掲載している事例はすべて、機能を説明するための架空のデータです。実在の施工実績ではありません。</p>
${renderFilter(axes)}
      <section class="p-works__results" aria-labelledby="works-results-heading">
        <h2 class="u-visually-hidden" id="works-results-heading">施工事例の一覧</h2>
        <div class="p-works__status">
          <p class="p-works__count js-works-count" role="status" aria-live="polite" aria-atomic="true">全${works.length}件の施工事例を表示しています。</p>
          <div class="p-works__selected js-works-selected" hidden>
            <p class="p-works__selected-label" id="works-selected-label">選択中の条件</p>
            <ul class="p-works__selected-list js-works-selected-list" aria-labelledby="works-selected-label"></ul>
            <button type="button" class="c-button js-works-reset">条件をすべてクリア</button>
          </div>
        </div>
        <ul class="p-works__list">
${works.map((work) => renderItem(work, axes)).join("\n")}
        </ul>
        <div class="p-works__empty js-works-empty" hidden>
          <p class="p-works__empty-title">条件に合う施工事例が見つかりませんでした。</p>
          <p class="p-works__empty-text">選択している条件を減らすか、すべての条件をクリアしてお探しください。</p>
          <button type="button" class="c-button js-works-reset">条件をすべてクリア</button>
        </div>
      </section>
    </div>
  </main>`;

/**
 * ページ全体。CSP は meta で指定し、インラインの script / style を使わない構成にしている
 * @param {{ axes: any[], works: any[] }} data 検証済みのデータ
 */
export const renderPage = (data) => `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'" />
  <title>施工事例の複数条件検索（公開用サンプル）</title>
  <meta name="description" content="架空の施工事例データで、複数条件の絞り込みと URL への条件保存を確認できるサンプルです。" />
  <link rel="stylesheet" href="./assets/style.css" />
  <script type="module" src="./assets/main.js"></script>
</head>
<body>${renderBody(data)}
</body>
</html>
`;

const main = async () => {
  const data = JSON.parse(
    await readFile(path.join(ROOT, "data/works.json"), "utf8"),
  );
  const errors = validateWorksData(data);
  if (errors.length > 0) {
    console.error(
      `data/works.json に ${errors.length} 件の不備があります:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  const dist = path.join(ROOT, "dist");
  await mkdir(path.join(dist, "assets"), { recursive: true });
  await writeFile(path.join(dist, "index.html"), renderPage(data));
  await Promise.all(
    SCRIPTS.map((file) =>
      copyFile(path.join(ROOT, "src", file), path.join(dist, "assets", file)),
    ),
  );
  const { css } = sass.compile(path.join(ROOT, "src/styles/main.scss"), {
    style: "expanded",
  });
  await writeFile(path.join(dist, "assets", "style.css"), css);
  console.log(`dist/index.html を出力しました（事例 ${data.works.length} 件）`);
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
