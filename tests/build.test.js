/**
 * ビルド時のデータ検証と HTML 出力のテスト
 * 対象: scripts/build.mjs（公開用サンプルで新しく書いたもの）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import * as sass from 'sass';
import { escapeHtml, renderPage, validateWorksData } from '../scripts/build.mjs';

const data = JSON.parse(readFileSync(new URL('../data/works.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(data);

describe('validateWorksData: データの不備を検出する', () => {
  it('同梱のダミーデータは不備なし', () => {
    expect(validateWorksData(data)).toEqual([]);
  });

  it('事例 ID の重複', () => {
    const d = clone();
    d.works[1].id = d.works[0].id;
    expect(validateWorksData(d)).toEqual([`works[1].id: "${d.works[0].id}" が重複しています`]);
  });

  it('必須項目（タイトル）の不足', () => {
    const d = clone();
    d.works[2].title = '';
    expect(validateWorksData(d)).toEqual(['works[2].title: 必須です']);
  });

  it('未定義の分類', () => {
    const d = clone();
    d.works[0].categories.area = ['tokyo'];
    expect(validateWorksData(d)).toEqual(['works[0].categories.area: "tokyo" は未定義の分類です']);
  });

  it('分類の指定漏れ', () => {
    const d = clone();
    delete d.works[0].categories.building;
    expect(validateWorksData(d)).toEqual(['works[0].categories.building: 1 つ以上指定してください']);
  });

  it('URL に使えない key（大文字・カンマ・空白）', () => {
    const d = clone();
    d.axes[0].categories[0].key = 'New Build,x';
    const errors = validateWorksData(d);
    expect(errors).toContain('axes[0].categories[0].key: 英小文字・数字・ハイフンで指定してください');
  });

  it('分類 key の重複', () => {
    const d = clone();
    d.axes[1].categories[1].key = d.axes[1].categories[0].key;
    expect(validateWorksData(d)).toContain(`axes[1].categories[1].key: "${d.axes[1].categories[0].key}" が重複しています`);
  });

  it('形の崩れたデータでも例外にならず、不備として返す', () => {
    for (const input of [null, {}, { axes: 'x', works: 1 }, { axes: [null], works: [null] }]) {
      expect(validateWorksData(input).length).toBeGreaterThan(0);
    }
  });
});

describe('renderPage: HTML 出力', () => {
  const html = renderPage(data);

  it('全件のカードを出力し、分類を data-* に埋め込む', () => {
    expect(html.match(/class="p-works__item js-works-item"/g)).toHaveLength(data.works.length);
    expect(html).toContain('data-type="renovation interior" data-area="osaka-city" data-building="apartment"');
  });

  it('チェックボックスは分類軸ごとに fieldset / legend でまとめ、初期状態は操作不可', () => {
    expect(html.match(/<legend /g)).toHaveLength(data.axes.length);
    expect(html).toContain('class="c-filter__fields js-works-filter-fields" disabled');
  });

  it('インラインの script / style を出さない（CSP の script-src / style-src を self のままにするため）', () => {
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    expect(html).not.toMatch(/<style|\sstyle=/);
    expect(html).toContain("script-src 'self'");
  });

  it('データ中の HTML はエスケープする', () => {
    expect(escapeHtml(`<img src=x onerror="a">'&`)).toBe('&lt;img src=x onerror=&quot;a&quot;&gt;&#39;&amp;');
    const d = clone();
    d.works[0].title = '<script>alert(1)</script>';
    expect(renderPage(d)).not.toContain('<script>alert(1)</script>');
  });
});

describe('スタイル（src/styles/）', () => {
  const { css } = sass.compile(fileURLToPath(new URL('../src/styles/main.scss', import.meta.url)));
  const jsGenerated = ['p-works__selected-item', 'p-works__chip', 'u-visually-hidden'];

  it('HTML と JS で使う見た目用のクラス（js- 以外）は、すべて SCSS に定義がある', () => {
    const used = new Set(
      [...renderPage(data).matchAll(/class="([^"]+)"/g)].flatMap(([, value]) => value.split(' ')).concat(jsGenerated)
    );
    const defined = name => new RegExp(`\\.${name}(?![\\w-])`).test(css);
    const missing = [...used].filter(name => !name.startsWith('js-') && !defined(name));
    //  次のクラスは構造を示すためのもので、見た目の指定を持たない（意図したものだけが残ることを確認）
    expect(missing.sort()).toEqual([
      'p-works',
      'p-works__empty-text',
      'p-works__filter',
      'p-works__item',
      'p-works__results',
      'p-works__selected-item',
    ]);
  });

  it('JS 用のクラス（js-）に見た目を指定していない', () => {
    expect(css).not.toMatch(/\.js-/);
  });
});
