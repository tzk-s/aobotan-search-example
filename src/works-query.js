/**
 * 施工事例の絞り込み条件 ⇔ URL クエリの変換と判定（DOM に依存しない純粋関数）
 *
 * 元サイトの実装から切り出したもの。処理内容は元サイトと同じで、
 * コメント内のファイル名・パスだけをこのサンプルに合わせている。
 *
 * 【URL の形】 /?type=new-build,renovation&area=osaka-city
 *   - パラメーター名は分類軸（type / area / building）
 *   - 同じ分類内の複数選択はカンマ区切り（OR）
 *   - 異なる分類は & でつなぐ（AND）
 *
 * 【壊れた URL への方針】
 *   手入力・古いリンク・途中で切れた共有 URL でも画面を壊さないため、
 *   「未定義の値・未定義のパラメーターは黙って無視する」。
 *   エラー表示にしないのは、閲覧者には直しようがないため。
 *   無視した結果は replaceState で正規化された URL に置き換える（works-filter.js）。
 *
 * テスト: tests/works-query.test.js
 */

/** 1 値あたりの最大長。異常に長い値は比較前に捨てる（定義済み key はすべてこれより短い。scripts/build.mjs で検証） */
const MAX_VALUE_LENGTH = 64;

/**
 * 空の選択状態を作る
 * @param {Record<string, string[]>} definitions 分類軸ごとの有効な key（表示順）
 * @returns {Record<string, string[]>}
 */
export const createEmptyState = definitions => Object.fromEntries(Object.keys(definitions).map(axis => [axis, []]));

/**
 * 何も選択されていないか
 * @param {Record<string, string[]>} state
 */
export const isEmptyState = state => Object.values(state).every(values => values.length === 0);

/**
 * URL の search 部分から選択状態を作る。
 * - `?type=a,b` と `?type=a&type=b` のどちらの書き方も受け付ける
 * - 大文字・前後の空白は正規化、未定義の値・重複は除外
 * - 並び順は定義順にそろえる（同じ条件なら同じ URL になる）
 * @param {string} search location.search（先頭の ? はあってもなくてもよい）
 * @param {Record<string, string[]>} definitions
 * @returns {Record<string, string[]>}
 */
export const parseWorksQuery = (search, definitions) => {
  let params;
  try {
    params = new URLSearchParams(search);
  } catch {
    return createEmptyState(definitions);
  }
  const state = createEmptyState(definitions);
  Object.entries(definitions).forEach(([axis, validKeys]) => {
    const requested = new Set(
      params
        .getAll(axis)
        .flatMap(value => value.split(','))
        .map(value => value.trim().toLowerCase())
        .filter(value => value !== '' && value.length <= MAX_VALUE_LENGTH)
    );
    state[axis] = validKeys.filter(key => requested.has(key));
  });
  return state;
};

/**
 * 選択状態を URL の search 文字列にする。
 * 絞り込みと無関係なパラメーター（utm_* など計測用）は順序を保って残す。
 * @param {Record<string, string[]>} state
 * @param {Record<string, string[]>} definitions
 * @param {string} [baseSearch] 現在の location.search
 * @returns {string} '' または '?...'
 */
export const serializeWorksQuery = (state, definitions, baseSearch = '') => {
  let base;
  try {
    base = new URLSearchParams(baseSearch);
  } catch {
    base = new URLSearchParams();
  }
  Object.keys(definitions).forEach(axis => base.delete(axis));
  const parts = [];
  const rest = base.toString();
  if (rest) parts.push(rest);
  Object.entries(definitions).forEach(([axis, validKeys]) => {
    const values = validKeys.filter(key => (state[axis] ?? []).includes(key));
    //  key は英小文字・数字・ハイフンのみ（scripts/build.mjs で検証済み）なのでエンコード不要。
    //  URLSearchParams に任せるとカンマが %2C になり、共有 URL が読みにくくなる。
    if (values.length > 0) parts.push(`${axis}=${values.join(',')}`);
  });
  return parts.length > 0 ? `?${parts.join('&')}` : '';
};

/**
 * 事例が条件に合うか。
 * - 分類内: どれか 1 つでも一致すれば OK（OR）
 * - 分類間: 選択のあるすべての分類で一致が必要（AND）
 * - 選択のない分類は条件にしない
 * @param {Record<string, string[]>} itemCategories 事例が持つ分類（1 事例が複数の工事種別を持つこともある）
 * @param {Record<string, string[]>} state
 */
export const matchesWorks = (itemCategories, state) =>
  Object.entries(state).every(
    ([axis, selected]) => selected.length === 0 || selected.some(key => (itemCategories[axis] ?? []).includes(key))
  );

/**
 * 条件に合う事例の数
 * @param {Record<string, string[]>[]} items
 * @param {Record<string, string[]>} state
 */
export const countMatches = (items, state) => items.filter(item => matchesWorks(item, state)).length;
