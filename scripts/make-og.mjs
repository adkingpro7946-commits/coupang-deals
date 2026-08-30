// 밴드/카카오/트위터 링크 미리보기용 OG 이미지(assets/og.png) 생성.
//   node scripts/make-og.mjs
//
// 카카오·밴드는 og:image로 SVG를 안 읽으므로 PNG로 굽는다. 한글은 맑은고딕으로 렌더.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'og.png');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff4f4"/>
      <stop offset="0.5" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7b733"/><stop offset="1" stop-color="#e8890c"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1140" cy="70" r="240" fill="#ff3a44" opacity="0.06"/>
  <circle cx="1080" cy="560" r="150" fill="#f7b733" opacity="0.07"/>

  <!-- 브랜드 라벨 -->
  <text x="80" y="120" font-family="Malgun Gothic" font-weight="bold" font-size="30" fill="#ff3a44">KKULDEAL · 오늘의 특가</text>

  <!-- 제목 -->
  <text x="76" y="238" font-family="Malgun Gothic" font-weight="bold" font-size="78" fill="#12151b">매일 바뀌는 <tspan fill="#ff3a44">쿠팡 특가</tspan></text>
  <text x="76" y="330" font-family="Malgun Gothic" font-weight="bold" font-size="78" fill="#12151b">골라 담았어요</text>

  <!-- 부제 -->
  <text x="80" y="400" font-family="Malgun Gothic" font-size="32" fill="#646d7c">골드박스 · 방금 가격 내린 상품 · 로켓배송을 한 화면에</text>

  <!-- 배지 -->
  <rect x="80" y="472" rx="16" width="238" height="68" fill="url(#gold)"/>
  <text x="199" y="516" text-anchor="middle" font-family="Malgun Gothic" font-weight="bold" font-size="30" fill="#ffffff">골드박스 특가</text>

  <rect x="338" y="472" rx="16" width="196" height="68" fill="#0aa06e"/>
  <text x="436" y="516" text-anchor="middle" font-family="Malgun Gothic" font-weight="bold" font-size="30" fill="#ffffff">가격 내림</text>

  <rect x="554" y="472" rx="16" width="196" height="68" fill="#1d6fe0"/>
  <text x="652" y="516" text-anchor="middle" font-family="Malgun Gothic" font-weight="bold" font-size="30" fill="#ffffff">로켓배송</text>

  <!-- 도메인 -->
  <text x="1122" y="590" text-anchor="end" font-family="Malgun Gothic" font-weight="bold" font-size="44" fill="#ff3a44">kkuldeal.com</text>
</svg>`;

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 },
  font: {
    fontFiles: ['C:/Windows/Fonts/malgun.ttf', 'C:/Windows/Fonts/malgunbd.ttf'],
    loadSystemFonts: false,
    defaultFontFamily: 'Malgun Gothic',
  },
});

const png = resvg.render().asPng();
await fs.writeFile(OUT, png);
console.log(`OG 이미지 생성: assets/og.png (${(png.length / 1024).toFixed(0)} KB, 1200x630)`);
