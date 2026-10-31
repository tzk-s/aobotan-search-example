// @vitest-environment jsdom
/**
 * 絞り込み画面の動作テスト（jsdom 上で、ビルドと同じ HTML に対して実行）
 * 対象: src/works-filter.js（DOM・URL・履歴の同期）
 * 確認していないこと: 実ブラウザーでの表示・スクリーンリーダーの実際の読み上げ（README 参照）
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderBody } from '../scripts/build.mjs';
import { initWorksFilter } from '../src/works-filter.js';
import data from '../data/works.json';
const TOTAL = data.works.length;

let destroy = () => {};

/** URL を指定してページを開いた状態にする */
const open = (search = '') => {
  history.replaceState(null, '', `/${search}`);
  document.body.innerHTML = renderBody(data);
  destroy = initWorksFilter();
};

afterEach(() => {
  destroy();
  vi.restoreAllMocks();
});

const $ = selector => document.querySelector(selector);
const input = (axis, key) => $(`.js-works-filter-input[name="${axis}"][value="${key}"]`);
const visibleIds = () =>
  Array.from(document.querySelectorAll('.js-works-item'))
    .filter(item => !item.hidden)
    .map(item => item.querySelector('.c-card__title').textContent);
const visibleCount = () => visibleIds().length;
const countText = () => $('.js-works-count').textContent;
const chips = () => Array.from(document.querySelectorAll('.p-works__chip')).map(chip => chip.firstChild.textContent);
const toggle = (axis, key) => {
  const el = input(axis, key);
  el.checked = !el.checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
/** 戻る／進むの完了（popstate）を待つ */
const traverse = move =>
  new Promise(resolve => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    move();
  });

describe('初期化', () => {
  it('条件なしで開くと全件表示・操作可能になり、URL は変えない', () => {
    open();
    expect(visibleCount()).toBe(TOTAL);
    expect(countText()).toBe(`全${TOTAL}件の施工事例を表示しています。`);
    expect($('.js-works-filter').dataset.state).toBe('ready');
    expect($('.js-works-filter-fields').disabled).toBe(false);
    expect($('.js-works-selected').hidden).toBe(true);
    expect(location.search).toBe('');
  });

  it('URL の条件からチェック状態・一覧・件数・選択中の条件を復元する', () => {
    open('?type=renovation&area=hyogo');
    expect(input('type', 'renovation').checked).toBe(true);
    expect(input('area', 'hyogo').checked).toBe(true);
    expect(visibleCount()).toBe(2);
    expect(countText()).toBe(`2件の施工事例が該当しました（全${TOTAL}件）。`);
    expect(chips()).toEqual(['リフォーム・改修', '兵庫県']);
  });

  it('不正・重複・未定義の値は無視し、URL を正規化する（無関係なパラメーターは残す）', () => {
    open('?type=RENOVATION,bogus,renovation&area=%3Cscript%3E&utm_source=x&page=abc');
    expect(visibleCount()).toBe(5);
    expect(location.search).toBe('?utm_source=x&page=abc&type=renovation');
  });

  it('必要な要素がなければ全件表示のまま操作不可にする', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    history.replaceState(null, '', '/?type=new-build');
    document.body.innerHTML = renderBody(data);
    document.querySelectorAll('.js-works-filter-input').forEach(el => el.remove());
    destroy = initWorksFilter();
    expect(visibleCount()).toBe(TOTAL);
    expect($('.js-works-filter').dataset.state).toBe('error');
    expect($('.js-works-filter-fields').disabled).toBe(true);
  });
});

describe('条件の選択・解除と一覧の同期', () => {
  it('同じ分類内は OR、分類間は AND で絞り込み、URL に反映する', () => {
    open();
    toggle('type', 'new-build');
    expect(visibleCount()).toBe(3);
    toggle('type', 'exterior');
    expect(visibleCount()).toBe(6); // 新築 3 件 OR 外装・外構 3 件
    toggle('area', 'kyoto');
    expect(visibleIds()).toEqual(['庭とつながる平屋の新築']); // （新築 OR 外装）AND 京都府
    expect(location.search).toBe('?type=new-build,exterior&area=kyoto');
  });

  it('該当なしの案内を出し、リセットで全件に戻す', () => {
    open('?type=new-build&area=nara');
    expect(visibleCount()).toBe(0);
    expect($('.js-works-empty').hidden).toBe(false);
    expect(countText()).toBe(`条件に合う施工事例はありませんでした（全${TOTAL}件）。`);
    $('.js-works-empty .js-works-reset').click();
    expect(visibleCount()).toBe(TOTAL);
    expect($('.js-works-empty').hidden).toBe(true);
    expect(location.search).toBe('');
    expect(document.activeElement).toBe(document.querySelector('.js-works-filter-input'));
  });

  it('選択中の条件ボタンで 1 つずつ解除でき、フォーカスは隣のボタン→先頭のチェックボックスへ移る', () => {
    open('?type=renovation&area=hyogo');
    const [first] = document.querySelectorAll('.p-works__chip');
    first.click();
    expect(chips()).toEqual(['兵庫県']);
    expect(input('type', 'renovation').checked).toBe(false);
    expect(document.activeElement.textContent).toContain('兵庫県');
    document.activeElement.click();
    expect(chips()).toEqual([]);
    expect($('.js-works-selected').hidden).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('.js-works-filter-input'));
  });
});

describe('ブラウザーの戻る／進む', () => {
  it('条件変更ごとに履歴を積み、戻る／進むで条件と結果を復元する', async () => {
    open();
    toggle('type', 'renovation');
    toggle('area', 'hyogo');
    expect(visibleCount()).toBe(2);

    await traverse(() => history.back());
    expect(location.search).toBe('?type=renovation');
    expect(input('area', 'hyogo').checked).toBe(false);
    expect(visibleCount()).toBe(5);

    await traverse(() => history.back());
    expect(location.search).toBe('');
    expect(visibleCount()).toBe(TOTAL);

    await traverse(() => history.forward());
    expect(input('type', 'renovation').checked).toBe(true);
    expect(visibleCount()).toBe(5);
    expect(countText()).toBe(`5件の施工事例が該当しました（全${TOTAL}件）。`);
  });

  it('戻る／進むの復元では履歴を積まない', async () => {
    open();
    toggle('type', 'interior');
    const length = history.length;
    await traverse(() => history.back());
    expect(history.length).toBe(length);
  });
});
