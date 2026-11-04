/**
 * 施工事例の絞り込み条件・URL クエリ処理のテスト
 * 対象: src/works-query.js（ブラウザーで動く純粋関数）
 * 元サイトのテストを移植し、末尾に公開用サンプルで追加したケースがある
 */
import { describe, it, expect } from 'vitest';
import {
  countMatches,
  createEmptyState,
  isEmptyState,
  matchesWorks,
  parseWorksQuery,
  serializeWorksQuery,
} from '../src/works-query.js';

const definitions = {
  type: ['new-build', 'renovation', 'interior', 'exterior'],
  area: ['osaka-city', 'osaka-pref', 'hyogo', 'kyoto', 'nara'],
  building: ['house', 'apartment', 'office', 'factory', 'public'],
};

//  実データと同じ形のサンプル（1 事例が複数の工事種別を持つケースを含む）
const items = {
  houseOsaka: { type: ['new-build'], area: ['osaka-pref'], building: ['house'] },
  mansionReno: { type: ['renovation', 'interior'], area: ['osaka-city'], building: ['apartment'] },
  shopHyogo: { type: ['renovation', 'exterior'], area: ['hyogo'], building: ['office'] },
  factoryHyogo: { type: ['renovation', 'exterior'], area: ['hyogo'], building: ['factory'] },
  schoolOsaka: { type: ['interior'], area: ['osaka-pref'], building: ['public'] },
};
const all = Object.values(items);
const state = partial => ({ ...createEmptyState(definitions), ...partial });

describe('matchesWorks: OR / AND の判定', () => {
  it('条件なしは全件一致', () => {
    expect(countMatches(all, createEmptyState(definitions))).toBe(all.length);
  });

  it('単一条件', () => {
    expect(matchesWorks(items.houseOsaka, state({ type: ['new-build'] }))).toBe(true);
    expect(matchesWorks(items.mansionReno, state({ type: ['new-build'] }))).toBe(false);
  });

  it('同じ分類内は OR（どれか 1 つで一致）', () => {
    const s = state({ building: ['house', 'apartment'] });
    expect(matchesWorks(items.houseOsaka, s)).toBe(true);
    expect(matchesWorks(items.mansionReno, s)).toBe(true);
    expect(matchesWorks(items.shopHyogo, s)).toBe(false);
  });

  it('異なる分類間は AND（すべての分類で一致が必要）', () => {
    const s = state({ type: ['renovation'], area: ['hyogo'] });
    expect(countMatches(all, s)).toBe(2);
    expect(matchesWorks(items.mansionReno, s)).toBe(false); // 改修だが大阪市
  });

  it('OR と AND の組み合わせ', () => {
    // (内装 OR 外装) AND (大阪府 OR 兵庫県) AND (公共 OR 工場)
    const s = state({ type: ['interior', 'exterior'], area: ['osaka-pref', 'hyogo'], building: ['public', 'factory'] });
    const matched = all.filter(item => matchesWorks(item, s));
    expect(matched).toEqual([items.factoryHyogo, items.schoolOsaka]);
  });

  it('複数の工事種別を持つ事例は、そのどれかが選ばれていれば一致', () => {
    expect(matchesWorks(items.mansionReno, state({ type: ['interior'] }))).toBe(true);
  });

  it('該当なしは 0 件', () => {
    expect(countMatches(all, state({ type: ['new-build'], area: ['nara'] }))).toBe(0);
  });

  it('事例側に分類が欠けていても例外にならず不一致になる', () => {
    expect(matchesWorks({}, state({ area: ['hyogo'] }))).toBe(false);
  });
});

describe('parseWorksQuery: URL → 条件', () => {
  it('カンマ区切りと同名パラメーターの繰り返しを両方受け付ける', () => {
    expect(parseWorksQuery('?type=new-build,renovation', definitions).type).toEqual(['new-build', 'renovation']);
    expect(parseWorksQuery('?type=new-build&type=renovation', definitions).type).toEqual(['new-build', 'renovation']);
  });

  it('並び順は定義順に正規化し、重複を除く', () => {
    expect(parseWorksQuery('?type=interior,new-build,interior', definitions).type).toEqual(['new-build', 'interior']);
  });

  it('大文字・前後の空白・URL エンコードを正規化する', () => {
    expect(parseWorksQuery('?area=%20HYOGO%20,Kyoto', definitions).area).toEqual(['hyogo', 'kyoto']);
  });

  it('未定義の値・未定義のパラメーターは無視する', () => {
    const result = parseWorksQuery('?type=bogus,new-build&color=red&building=<script>', definitions);
    expect(result).toEqual(state({ type: ['new-build'] }));
  });

  it('壊れた・空の入力でも空の条件を返す', () => {
    for (const input of ['', '?', '?type=', '?type=,,,', '?=&&=', '%%%', '?type=%E3%81']) {
      expect(isEmptyState(parseWorksQuery(input, definitions))).toBe(true);
    }
  });

  it('異常に長い値は捨てる', () => {
    expect(parseWorksQuery(`?type=${'a'.repeat(1000)},renovation`, definitions).type).toEqual(['renovation']);
  });

  it('先頭の ? はなくてもよい', () => {
    expect(parseWorksQuery('area=nara', definitions).area).toEqual(['nara']);
  });
});

describe('serializeWorksQuery: 条件 → URL', () => {
  it('条件なしは空文字', () => {
    expect(serializeWorksQuery(createEmptyState(definitions), definitions)).toBe('');
  });

  it('分類の順（type → area → building）・定義順で出力し、カンマはエンコードしない', () => {
    const s = state({ building: ['public'], type: ['interior', 'new-build'] });
    expect(serializeWorksQuery(s, definitions)).toBe('?type=new-build,interior&building=public');
  });

  it('絞り込み以外のパラメーター（計測用など）は残し、古い絞り込みは置き換える', () => {
    const s = state({ area: ['kyoto'] });
    expect(serializeWorksQuery(s, definitions, '?utm_source=x&type=new-build&area=hyogo')).toBe(
      '?utm_source=x&area=kyoto'
    );
  });

  it('未定義の値は出力しない', () => {
    expect(serializeWorksQuery(state({ type: ['bogus'] }), definitions)).toBe('');
  });

  it('parse → serialize → parse で同じ条件に戻る（共有 URL の往復）', () => {
    const original = state({ type: ['renovation', 'exterior'], area: ['hyogo'], building: ['office', 'factory'] });
    const url = serializeWorksQuery(original, definitions);
    expect(parseWorksQuery(url, definitions)).toEqual(original);
  });

  it('不正な URL は正規化された URL になる（初回表示の replaceState 用）', () => {
    const parsed = parseWorksQuery('?type=NEW-BUILD,bogus&area=nara&x=1', definitions);
    expect(serializeWorksQuery(parsed, definitions, '?type=NEW-BUILD,bogus&area=nara&x=1')).toBe(
      '?x=1&type=new-build&area=nara'
    );
  });
});

//  ── ここから公開用サンプルで追加したケース ──────────────────────
describe('公開用サンプルで追加した確認', () => {
  it('同じ値の繰り返し（カンマ区切り・同名パラメーターの混在）は 1 つにまとめる', () => {
    expect(parseWorksQuery('?area=hyogo&area=hyogo,HYOGO', definitions).area).toEqual(['hyogo']);
  });

  it('パラメーター名は大文字小文字を区別する（TYPE は未定義のパラメーターとして無視）', () => {
    expect(isEmptyState(parseWorksQuery('?TYPE=new-build', definitions))).toBe(true);
  });

  it('空の分類があっても、ほかの分類の条件は生きる', () => {
    expect(parseWorksQuery('?type=&area=kyoto', definitions)).toEqual(state({ area: ['kyoto'] }));
  });

  it('Object のプロパティ名に当たる値・パラメーター名でも壊れない', () => {
    const result = parseWorksQuery('?__proto__=x&constructor=y&type=toString,new-build', definitions);
    expect(result).toEqual(state({ type: ['new-build'] }));
  });

  it('serialize の結果をもう一度 parse → serialize しても変わらない（URL が安定する）', () => {
    const first = serializeWorksQuery(parseWorksQuery('?building=public,house&type=exterior', definitions), definitions);
    expect(serializeWorksQuery(parseWorksQuery(first, definitions), definitions)).toBe(first);
  });

  it('全条件を解除すると、絞り込み以外のパラメーターだけが残る', () => {
    expect(serializeWorksQuery(createEmptyState(definitions), definitions, '?type=new-build&ref=mail')).toBe('?ref=mail');
  });
});
