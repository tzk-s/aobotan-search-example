/**
 * 施工事例の絞り込み（DOM と URL・履歴の橋渡し）
 *
 * 元サイトの worksFilter.js を、公開用に簡略化したもの。
 * 元サイトにあるページ送り（ページネーション）と、ページ切替時のスクロール・フォーカス移動は除いている。
 * 後片付け用の戻り値（イベントの解除）は、テストのためにこのサンプルで追加した。
 *
 * 【設計方針】
 *  - カードはビルド時に全件 HTML 出力済み。JS は hidden の付け外しだけを行う
 *    （JS 無効時・読み込み失敗時も全件が見える = Progressive Enhancement）。
 *  - 絞り込みフォームは初期 HTML から表示して場所を確保し、操作不可（fieldset disabled）にしておく。
 *    初期化は「URL 解析 → 一覧・件数の更新 → 操作の有効化」の順。
 *    途中で失敗したら全件一覧に戻し、操作不可のままにする。JS 無効時は noscript で案内する。
 *  - 判定と URL 変換は works-query.js の純粋関数（単体テスト対象）。
 *    このファイルは DOM と history の橋渡しに徹する。
 *  - 条件変更ごとに pushState → ブラウザーの戻る／進むで条件を一つずつ戻せる。
 *    popstate では URL から状態を読み直して画面に反映する（push はしない）。
 *  - 初回表示で URL を正規化（未定義の値を除いた URL に replaceState）。
 *
 * 【A11y 要件】
 *  - チェックボックスは fieldset / legend でグループ化（HTML 側）。
 *  - 件数は role="status"（aria-live="polite"）で通知。条件なしで開いたときは読み上げさせない。
 *  - 選択中の条件はボタン（押すと解除）。解除でボタンが消えるときは、
 *    フォーカスが body に落ちないよう隣のボタン／先頭のチェックボックスへ移す。
 *  - 絞り込み自体にアニメーションは付けない（結果の即時性を優先）。
 *  - innerHTML は使わず、要素は createElement + textContent で生成する。
 *
 * 【HTML フック】
 *   .js-works-filter          … ルート。data-state = loading（初期）/ ready（操作可）/ error（初期化失敗）
 *   .js-works-filter-fields   … 分類グループをまとめる fieldset（初期化完了まで disabled）
 *   .js-works-filter-input    … チェックボックス（name = 分類軸、value = key）
 *   .js-works-item            … 事例カード（data-type / data-area / data-building に key をスペース区切り）
 *   .js-works-count           … 件数表示（role="status"）
 *   .js-works-selected        … 選択中の条件エリア
 *   .js-works-selected-list   … 選択中の条件ボタンを入れる ul
 *   .js-works-reset           … 条件をすべてクリア（複数可）
 *   .js-works-empty           … 該当なしの案内
 */

import { createEmptyState, isEmptyState, matchesWorks, parseWorksQuery, serializeWorksQuery } from './works-query.js';

/** カードの data-* から分類を読む */
const readItemCategories = (item, axes) =>
  Object.fromEntries(axes.map(axis => [axis, (item.dataset[axis] ?? '').split(' ').filter(Boolean)]));

/** チェックボックスから「分類軸 → 有効な key（表示順）」の定義を作る */
const readDefinitions = inputs => {
  const definitions = {};
  inputs.forEach(input => {
    if (!definitions[input.name]) definitions[input.name] = [];
    definitions[input.name].push(input.value);
  });
  return definitions;
};

/** チェックボックスのラベル文字（選択中の条件ボタンに使う） */
const readLabel = input => input.closest('label')?.textContent.trim() ?? input.value;

/**
 * 初期化の本体。失敗したら例外を投げる（setupWorksFilter が全件一覧に戻す）
 * @param {HTMLElement} root
 * @param {AbortSignal} signal イベント解除用
 */
const initialize = (root, signal) => {
  const inputs = Array.from(root.querySelectorAll('.js-works-filter-input'));
  const items = Array.from(document.querySelectorAll('.js-works-item'));
  const countEl = document.querySelector('.js-works-count');
  const selectedEl = document.querySelector('.js-works-selected');
  const selectedList = document.querySelector('.js-works-selected-list');
  const emptyEl = document.querySelector('.js-works-empty');
  const resetButtons = Array.from(document.querySelectorAll('.js-works-reset'));
  const fieldsEl = root.querySelector('.js-works-filter-fields');
  if (inputs.length === 0 || items.length === 0) throw new Error('絞り込みの選択肢または事例が見つかりません');

  const definitions = readDefinitions(inputs);
  const axes = Object.keys(definitions);
  const itemCategories = items.map(item => readItemCategories(item, axes));
  const total = items.length;
  const labels = new Map(inputs.map(input => [`${input.name}:${input.value}`, readLabel(input)]));

  /** 現在のチェック状態を読む */
  const readState = () => {
    const state = createEmptyState(definitions);
    inputs.forEach(input => {
      if (input.checked) state[input.name].push(input.value);
    });
    return state;
  };

  /** 件数の文言。選択なしは全件表示であることを明示する */
  const countText = (matched, state) => {
    if (isEmptyState(state)) return `全${total}件の施工事例を表示しています。`;
    if (matched === 0) return `条件に合う施工事例はありませんでした（全${total}件）。`;
    return `${matched}件の施工事例が該当しました（全${total}件）。`;
  };

  /** 選択中の条件ボタンを作り直す */
  const renderSelected = state => {
    if (!selectedEl || !selectedList) return;
    selectedList.replaceChildren();
    axes.forEach(axis => {
      state[axis].forEach(value => {
        const label = labels.get(`${axis}:${value}`) ?? value;
        const li = document.createElement('li');
        li.className = 'p-works__selected-item';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'p-works__chip';
        button.dataset.axis = axis;
        button.dataset.value = value;
        const text = document.createElement('span');
        text.textContent = label;
        //  見た目は「× 新築」、読み上げは「新築 の条件を解除」
        const hint = document.createElement('span');
        hint.className = 'u-visually-hidden';
        hint.textContent = ' の条件を解除';
        button.append(text, hint);
        li.append(button);
        selectedList.append(li);
      });
    });
    selectedEl.hidden = isEmptyState(state);
  };

  /**
   * 状態を画面に反映する
   * @param {Record<string, string[]>} state
   */
  const render = state => {
    inputs.forEach(input => {
      input.checked = state[input.name].includes(input.value);
    });
    let matched = 0;
    items.forEach((item, index) => {
      const visible = matchesWorks(itemCategories[index], state);
      item.hidden = !visible;
      if (visible) matched += 1;
    });
    if (emptyEl) emptyEl.hidden = matched > 0;
    renderSelected(state);
    if (countEl) countEl.textContent = countText(matched, state);
  };

  /** URL を更新する（push = 履歴を積む / replace = 置き換える） */
  const writeUrl = (state, mode) => {
    const search = serializeWorksQuery(state, definitions, window.location.search);
    if (search === window.location.search) return;
    const url = `${window.location.pathname}${search}${window.location.hash}`;
    if (mode === 'push') {
      history.pushState({ worksFilter: true }, '', url);
    } else {
      history.replaceState(history.state, '', url);
    }
  };

  const applyChange = state => {
    render(state);
    writeUrl(state, 'push');
  };

  /** フォーカスの退避先（先頭のチェックボックス） */
  const focusFirstInput = () => inputs[0]?.focus();

  // ── 初回表示（1. URL 解析 → 2. 一覧・件数の更新）────────────
  const initialState = parseWorksQuery(window.location.search, definitions);
  //  条件なしで開いたときは読み上げを抑える（ページを開いただけで読まれないように）。
  //  aria-live の読み上げは「中身の変更」で起きるため、書き換えの前に live を外し、描画後に戻す
  const shouldAnnounce = !isEmptyState(initialState);
  if (!shouldAnnounce) countEl?.setAttribute('aria-live', 'off');
  render(initialState);
  if (!shouldAnnounce) requestAnimationFrame(() => countEl?.setAttribute('aria-live', 'polite'));
  writeUrl(initialState, 'replace');

  // ── イベント ────────────────────────────────
  inputs.forEach(input => {
    input.addEventListener('change', () => applyChange(readState()), { signal });
  });

  selectedList?.addEventListener(
    'click',
    event => {
      const button = event.target instanceof Element ? event.target.closest('.p-works__chip') : null;
      if (!button) return;
      const { axis, value } = button.dataset;
      //  解除後に残る隣のボタン（なければ先頭のチェックボックス）へフォーカスを移す
      const buttons = Array.from(selectedList.querySelectorAll('.p-works__chip'));
      const index = buttons.indexOf(button);
      const state = readState();
      state[axis] = state[axis].filter(v => v !== value);
      applyChange(state);
      const rest = Array.from(selectedList.querySelectorAll('.p-works__chip'));
      if (rest.length > 0) {
        rest[Math.min(index, rest.length - 1)].focus();
      } else {
        focusFirstInput();
      }
    },
    { signal }
  );

  resetButtons.forEach(button => {
    button.addEventListener(
      'click',
      () => {
        applyChange(createEmptyState(definitions));
        //  押したボタン自体が非表示になるため、条件選択の先頭へ戻す
        focusFirstInput();
      },
      { signal }
    );
  });

  //  Enter キー等でフォームが送信されてページ遷移しないように
  root.querySelector('form')?.addEventListener('submit', event => event.preventDefault(), { signal });

  //  戻る／進む: URL から状態を復元（履歴は積まない）
  window.addEventListener('popstate', () => render(parseWorksQuery(window.location.search, definitions)), { signal });

  // ── 3. 操作の有効化（初回の描画とイベント登録が終わってから）────────────
  if (fieldsEl) fieldsEl.disabled = false;
  root.querySelector('form')?.setAttribute('aria-busy', 'false');
  root.dataset.state = 'ready';
};

/**
 * 初期化に失敗したときの後始末: 全件一覧を閲覧できる状態に戻す（絞り込みは操作不可のまま）
 * @param {HTMLElement} root
 * @param {string} initialCountText 初期 HTML の件数文言
 */
const restoreFallback = (root, initialCountText) => {
  document.querySelectorAll('.js-works-item').forEach(item => {
    item.hidden = false;
  });
  const hide = selector => {
    const el = document.querySelector(selector);
    if (el) el.hidden = true;
  };
  hide('.js-works-empty');
  hide('.js-works-selected');
  const countEl = document.querySelector('.js-works-count');
  if (countEl) countEl.textContent = initialCountText;
  const fieldsEl = root.querySelector('.js-works-filter-fields');
  if (fieldsEl) fieldsEl.disabled = true;
  root.querySelector('form')?.setAttribute('aria-busy', 'false');
  root.dataset.state = 'error';
};

const setupWorksFilter = (root, signal) => {
  //  失敗時に戻すため、書き換え前の件数文言を控えておく
  const initialCountText = document.querySelector('.js-works-count')?.textContent ?? '';
  try {
    initialize(root, signal);
  } catch (error) {
    console.error('[works-filter] 初期化に失敗したため、全件一覧を表示します:', error);
    try {
      restoreFallback(root, initialCountText);
    } catch (_) {}
  }
};

/**
 * ページ内の .js-works-filter をすべて初期化する
 * @returns {() => void} 登録したイベントを解除する関数
 */
export const initWorksFilter = () => {
  const controller = new AbortController();
  document.querySelectorAll('.js-works-filter').forEach(root => setupWorksFilter(root, controller.signal));
  return () => controller.abort();
};
