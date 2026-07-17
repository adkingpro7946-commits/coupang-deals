// data/products.json 을 읽어 카테고리별 정적 SEO 페이지를 만든다.
//   node scripts/build-pages.mjs
//   node scripts/build-pages.mjs --base https://내도메인.com
//
// 생성물:
//   c/index.html          카테고리 허브
//   c/<카테고리>.html      카테고리별 상품 페이지 (미리 렌더됨)
//   sitemap.xml           위 페이지 전부 포함해 재생성
//
// 필터 URL(?cat=)은 JS로만 그려지고 robots에서 제외돼 색인이 안 된다.
// 이 페이지들은 검색엔진이 실제로 읽을 수 있는 진입점이다.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data', 'products.json');
const OUT_DIR = path.join(ROOT, 'c');
const PER_PAGE = 60; // 페이지당 최대 상품 수 (너무 크면 무거워진다)

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = (process.env.SITE_URL || arg('base', 'https://example.com')).replace(/\/$/, '');

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const won = new Intl.NumberFormat('ko-KR');
const fmt = (n) => won.format(n) + '원';

// 파일 시스템에 못 쓰는 문자만 치환. 나머지는 한글 그대로 둔다(SEO에 유리).
const fileFor = (cat) => cat.replace(/[\/\\:*?"<>|]/g, '-').trim();

// 쿠팡 썸네일 URL의 크기 세그먼트를 갈아끼워 해상도별 후보를 만든다.
function srcsetFor(url) {
  if (!/\/\d+x\d+ex\//.test(url)) return '';
  const at = (n) => url.replace(/\/\d+x\d+ex\//, `/${n}x${n}ex/`);
  return ` srcset="${esc(at(212))} 212w, ${esc(at(320))} 320w, ${esc(at(492))} 492w" sizes="(max-width: 640px) 45vw, 200px"`;
}

const THEME_BOOT = `<script>
  (function () {
    try {
      var saved = localStorage.getItem('cp:theme');
      var dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    } catch (e) { document.documentElement.dataset.theme = 'light'; }
  })();
</script>`;

const DISCLOSURE =
  '이 사이트는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

function cardHtml(p) {
  const discount = p.discountRate > 0 ? `<span class="badge-discount">${p.discountRate}%</span>` : '';
  const drop =
    p.priceDrop?.from > p.price
      ? `<span class="badge-drop">↓ ${won.format(p.priceDrop.from - p.price)}원 내림</span>`
      : '';
  const base = p.basePrice > p.price ? `<span class="base">${fmt(p.basePrice)}</span>` : '';
  const tags = [
    p.rocket ? '<span class="tag tag-rocket">🚀 로켓배송</span>' : '',
    p.freeShipping ? '<span class="tag tag-free">무료배송</span>' : '',
  ].join('');

  return `<a class="card" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer sponsored">
  <div class="thumb">
    <img src="${esc(p.image)}"${srcsetFor(p.image)} alt="${esc(p.name)}" loading="lazy" decoding="async" width="300" height="300">
    ${discount}${drop}
  </div>
  <div class="body">
    <p class="name">${esc(p.name)}</p>
    <div class="tags">${tags}</div>
    <div class="price-row"><span class="price">${fmt(p.price)}</span>${base}</div>
    <span class="cta">쿠팡에서 보기 <span aria-hidden="true">→</span></span>
  </div>
</a>`;
}

function pageShell({ title, description, canonical, jsonLd, body, assetPrefix }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0b0d12">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${assetPrefix}assets/og.svg">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${esc(canonical)}">
<link rel="stylesheet" href="${assetPrefix}assets/styles.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>🛒</text></svg>">
${THEME_BOOT}
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<header class="header">
  <div class="wrap header-in">
    <a class="brand" href="${assetPrefix}"><span class="brand-mark" aria-hidden="true">🛒</span><span class="brand-text">오늘의 <b>특가</b></span></a>
  </div>
</header>
${body}
<footer class="footer">
  <div class="wrap">
    <p class="disclosure">${DISCLOSURE}</p>
    <p class="footer-sub">가격·재고·배송 정보는 쿠팡에서 수시로 변경되며, 실제 정보는 구매 페이지 기준입니다.</p>
  </div>
</footer>
</body>
</html>
`;
}

function categoryPage(category, products) {
  const items = [...products].sort((a, b) => b.discountRate - a.discountRate).slice(0, PER_PAGE);
  const encoded = encodeURIComponent(fileFor(category));
  const canonical = `${BASE}/c/${encoded}.html`;
  const title = `${category} 특가 모음 | 오늘의 특가`;
  const description = `쿠팡 ${category} 인기 특가 ${items.length}선. 로켓배송·할인율 높은 순으로 모았습니다.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '홈', item: `${BASE}/` },
          { '@type': 'ListItem', position: 2, name: '카테고리', item: `${BASE}/c/` },
          { '@type': 'ListItem', position: 3, name: category, item: canonical },
        ],
      },
      {
        '@type': 'ItemList',
        name: title,
        numberOfItems: items.length,
        itemListElement: items.slice(0, 20).map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: p.name,
          url: p.url,
          image: p.image?.startsWith('data:') ? undefined : p.image,
        })),
      },
    ],
  };

  const body = `<nav class="crumb wrap" aria-label="위치">
  <a href="../">홈</a> <span aria-hidden="true">›</span>
  <a href="./">카테고리</a> <span aria-hidden="true">›</span>
  <span>${esc(category)}</span>
</nav>
<main class="wrap">
  <h1 class="cat-h1">${esc(category)} 인기 특가</h1>
  <p class="cat-lead">할인율 높은 순 ${items.length}개 · <a href="../?cat=${encoded}">필터·정렬로 전체 보기 →</a></p>
  <section class="grid">
    ${items.map(cardHtml).join('\n    ')}
  </section>
</main>`;

  return pageShell({ title, description, canonical, jsonLd, body, assetPrefix: '../' });
}

function hubPage(byCat) {
  const cats = [...byCat.entries()].sort((a, b) => b[1].length - a[1].length);
  const canonical = `${BASE}/c/`;
  const title = '카테고리별 특가 모음 | 오늘의 특가';
  const description = '쿠팡 특가를 카테고리별로 모았습니다. 원하는 분야를 골라 바로 확인하세요.';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    url: canonical,
    hasPart: cats.map(([c]) => ({
      '@type': 'WebPage',
      name: c,
      url: `${BASE}/c/${encodeURIComponent(fileFor(c))}.html`,
    })),
  };

  const links = cats
    .map(([c, list]) => {
      const enc = encodeURIComponent(fileFor(c));
      const top = list.find((p) => p.image && !p.image.startsWith('data:'));
      const thumb = top ? `<img src="${esc(top.image)}" alt="" loading="lazy" width="64" height="64">` : '<span class="hub-emoji">🛍️</span>';
      return `<a class="hub-card" href="./${enc}.html">
      ${thumb}
      <span class="hub-name">${esc(c)}</span>
      <span class="hub-count">${list.length}개</span>
    </a>`;
    })
    .join('\n    ');

  const body = `<nav class="crumb wrap" aria-label="위치">
  <a href="../">홈</a> <span aria-hidden="true">›</span> <span>카테고리</span>
</nav>
<main class="wrap">
  <h1 class="cat-h1">카테고리별 특가</h1>
  <p class="cat-lead">관심 있는 분야를 골라보세요.</p>
  <section class="hub-grid">
    ${links}
  </section>
</main>`;

  return pageShell({ title, description, canonical, jsonLd, body, assetPrefix: '../' });
}

function buildSitemap(byCat) {
  const now = new Date().toISOString().slice(0, 10);
  const urls = [
    `${BASE}/`,
    `${BASE}/c/`,
    ...[...byCat.keys()].map((c) => `${BASE}/c/${encodeURIComponent(fileFor(c))}.html`),
  ];
  const body = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${esc(u)}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>daily</changefreq>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

async function main() {
  let data;
  try {
    data = JSON.parse(await fs.readFile(DATA, 'utf8'));
  } catch {
    console.error('data/products.json 이 없습니다. 먼저 fetch-products.mjs 또는 make-sample.mjs 를 실행하세요.');
    process.exit(1);
  }

  const byCat = new Map();
  for (const p of data.products || []) {
    if (!p.category) continue;
    if (!byCat.has(p.category)) byCat.set(p.category, []);
    byCat.get(p.category).push(p);
  }

  if (!byCat.size) {
    console.error('카테고리가 없어 페이지를 만들 수 없습니다.');
    process.exit(1);
  }

  // c/ 를 비우고 새로 쓴다. 삭제된 카테고리의 낡은 페이지가 남지 않게.
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  for (const [category, products] of byCat) {
    const file = path.join(OUT_DIR, `${fileFor(category)}.html`);
    await fs.writeFile(file, categoryPage(category, products), 'utf8');
  }
  await fs.writeFile(path.join(OUT_DIR, 'index.html'), hubPage(byCat), 'utf8');
  await fs.writeFile(path.join(ROOT, 'sitemap.xml'), buildSitemap(byCat), 'utf8');

  console.log(`카테고리 ${byCat.size}개 → c/*.html + 허브 + sitemap.xml`);
  console.log(`도메인: ${BASE}${BASE.includes('example.com') ? '  (⚠ --base 로 실제 도메인을 지정하세요)' : ''}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
