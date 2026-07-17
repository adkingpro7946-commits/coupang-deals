// API 키 없이도 사이트가 도는지 확인하기 위한 샘플 데이터 생성기.
// 실제 상품/링크가 아니다. 링크는 전부 쿠팡 메인으로 향한다.
//   node scripts/make-sample.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CATALOG = {
  '가전디지털': ['무선 블루투스 이어폰', '4K 모니터 27인치', '기계식 키보드', '무선 마우스', '보조배터리 20000mAh', 'USB-C 허브', '공기청정기', '로봇청소기'],
  '생활용품': ['3겹 화장지 30롤', '주방세제 리필', '섬유유연제 대용량', '스텐 물병 1L', '실리콘 주방장갑', '압축 수납팩'],
  '식품': ['컵라면 24개입', '프로틴 쉐이크', '아메리카노 원두 1kg', '견과류 하루한봉 30입', '냉동 만두 1.4kg'],
  '홈인테리어': ['LED 스탠드', '접이식 수납장', '암막 커튼', '러그 150x200', '벽걸이 시계'],
  '스포츠레저': ['캠핑 의자', '요가매트 10mm', '등산 스틱', '덤벨 세트 20kg', '자전거 헬멧'],
  '패션잡화': ['캔버스 백팩', '러닝화', '무지 반팔티 3팩', '가죽 카드지갑'],
};

const BRANDS = ['루미', '노바', '데일리', '코어', '프리미엄', '베이직', '오브', '테라'];

// 결정적 의사난수 — 매번 같은 샘플이 나와야 재실행해도 결과가 흔들리지 않는다.
let seed = 20260717;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => Math.floor(rnd() * (b - a + 1)) + a;

const PALETTE = ['#ff3a44', '#1d6fe0', '#0aa06e', '#f59f0a', '#7c4dff', '#e6447a', '#00a8b5'];

function placeholder(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">
<rect width="300" height="300" fill="${color}" opacity="0.12"/>
<circle cx="150" cy="128" r="52" fill="${color}" opacity="0.22"/>
<text x="150" y="142" font-size="44" text-anchor="middle">${label}</text>
<text x="150" y="228" font-size="15" font-family="sans-serif" fill="${color}"
 text-anchor="middle" font-weight="700">SAMPLE</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const EMOJI = {
  '가전디지털': '🎧', '생활용품': '🧻', '식품': '🍜',
  '홈인테리어': '🛋️', '스포츠레저': '⛺', '패션잡화': '🎒',
};

const STAMP = new Date('2026-07-17T00:00:00Z').toISOString();

const products = [];
let n = 0;

for (const [category, items] of Object.entries(CATALOG)) {
  for (const item of items) {
    // 한 품목당 2개 변형을 만들어 그리드가 충분히 채워지게 한다.
    for (let v = 0; v < 2; v++) {
      const discountRate = rnd() < 0.65 ? between(5, 55) : 0;
      const price = between(6, 240) * 500;
      const basePrice = discountRate ? Math.round(price / (1 - discountRate / 100) / 100) * 100 : 0;

      // 실제 수집 시에는 직전 products.json과 비교해 붙는 값이다.
      // 샘플에서는 UI 확인용으로 일부에만 넣는다.
      const dropped = rnd() < 0.2;
      const priceDrop = dropped
        ? { from: price + between(2, 24) * 500, pct: between(3, 25), at: STAMP }
        : undefined;

      products.push({
        id: `sample-${++n}`,
        name: `${pick(BRANDS)} ${item} ${v ? '2팩' : ''}`.trim(),
        price,
        image: placeholder(EMOJI[category], pick(PALETTE)),
        url: 'https://www.coupang.com/',
        category,
        rocket: rnd() < 0.7,
        freeShipping: rnd() < 0.5,
        discountRate,
        basePrice,
        rank: n,
        source: 'sample',
        firstSeen: STAMP,
        isNew: rnd() < 0.15,
        ...(priceDrop ? { priceDrop } : {}),
      });
    }
  }
}

const out = {
  generatedAt: STAMP,
  sample: true,
  count: products.length,
  products,
};

await fs.mkdir(path.join(ROOT, 'data'), { recursive: true });
await fs.writeFile(path.join(ROOT, 'data', 'products.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(`샘플 ${products.length}개 → data/products.json`);
