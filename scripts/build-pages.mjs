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

// 모든 정적 페이지가 공유하는 하단 링크 (절대 URL이라 깊이 상관없이 동작)
const FOOTER_NAV = `<nav class="footer-links" aria-label="사이트 정보">
    <a href="${BASE}/">홈</a>
    <a href="${BASE}/c/">카테고리</a>
    <a href="${BASE}/info/about.html">소개</a>
    <a href="${BASE}/info/criteria.html">특가 선정·가격 기준</a>
    <a href="${BASE}/info/partners.html">제휴 안내</a>
    <a href="${BASE}/info/contact.html">문의·신고</a>
    <a href="${BASE}/info/terms.html">이용약관</a>
    <a href="${BASE}/info/privacy.html">개인정보처리방침</a>
  </nav>`;

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
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${BASE}/assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${BASE}/assets/og.png">
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
    ${FOOTER_NAV}
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

// ── 신뢰 페이지 (소개·기준·제휴·문의·약관·개인정보) ──
// 실제 근거 있는 내용만. 문의 이메일은 CONTACT_EMAIL 환경변수로 넣으면 노출된다(없으면 안내 문구).
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || '';
const contactLine = CONTACT_EMAIL
  ? `<p>이메일: <a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a></p>`
  : `<p class="muted">문의 이메일은 운영자 설정 후 표시됩니다. (빌드 시 <code>CONTACT_EMAIL</code> 환경변수)</p>`;

const INFO_PAGES = [
  {
    slug: 'about',
    title: '꿀딜 소개',
    desc: '꿀딜은 쿠팡 골드박스와 최근 가격이 내려간 상품을 모아 보여주는 독립 큐레이션 사이트입니다.',
    body: `<h1>꿀딜 소개</h1>
<p><strong>꿀딜(kkuldeal.com)</strong>은 쿠팡의 골드박스 특가와 최근 가격이 내려간 상품을 카테고리별로 모아 보여주는 <strong>독립 상품 큐레이션 사이트</strong>입니다.</p>
<p>쿠팡에 바로 들어가기 전에, <strong>지금 가격이 얼마인지 · 언제 확인한 가격인지 · 이전보다 얼마나 내렸는지</strong>를 먼저 비교하고 판단하도록 돕는 것이 목적입니다.</p>
<h2>이렇게 사용하세요</h2>
<ul>
  <li>가격이 실제로 얼마나 내려갔는지 확인</li>
  <li>언제 확인한 가격인지 확인</li>
  <li>카테고리·필터·정렬로 원하는 상품 비교</li>
  <li>마지막으로 쿠팡에서 현재 가격을 최종 확인</li>
</ul>
<h2>운영</h2>
<p>꿀딜은 개인이 운영하는 독립 사이트이며, <strong>쿠팡이 직접 운영하는 공식 사이트가 아닙니다.</strong> 상품으로는 쿠팡 파트너스 제휴 링크를 통해 연결됩니다. 문의는 <a href="${BASE}/info/contact.html">문의·신고</a> 페이지를 이용해 주세요.</p>`,
  },
  {
    slug: 'criteria',
    title: '특가 선정 · 가격 기준',
    desc: '꿀딜이 특가를 선정하는 기준과 가격 인하를 계산·표시하는 방식을 안내합니다.',
    body: `<h1>특가 선정 · 가격 기준</h1>
<h2>특가 선정 기준</h2>
<p>꿀딜은 최근 확인 가격과 현재 가격을 비교하여 <strong>가격이 의미 있게 내려간 상품</strong>, <strong>쿠팡 골드박스 상품</strong>, <strong>카테고리 내 관심도가 높은 상품</strong>을 선별합니다.</p>
<h2>가격 인하 계산 기준</h2>
<p>이전 확인가와 현재 확인가를 비교해 인하액과 인하율을 계산합니다. 의미 없는 소액 변동은 강조하지 않습니다.</p>
<ul>
  <li><strong>가격 인하 배지</strong>: 인하율 3% 이상 <em>또는</em> 인하액 1,000원 이상</li>
  <li><strong>메인 특가 노출</strong>: 인하율 5% 이상 <em>또는</em> 인하액 3,000원 이상</li>
  <li>가격이 오른 상품은 특가 영역에서 자동 제외</li>
</ul>
<h2>가격 업데이트 정책</h2>
<p>상품 가격은 매일 자동으로 다시 확인합니다. 각 상품에는 <strong>마지막으로 확인한 시각</strong>을 표시하며, 오랫동안(약 14일) 다시 확인되지 않은 상품은 목록에서 제외합니다.</p>
<h2>구매 전 확인</h2>
<p>가격·재고·쿠폰·배송 조건은 수시로 변하며, <strong>쿠폰·옵션·회원 조건에 따라 최종 결제 금액이 달라질 수 있습니다.</strong> 구매 전 반드시 쿠팡 상품 페이지에서 최종 확인해 주세요.</p>`,
  },
  {
    slug: 'partners',
    title: '쿠팡 파트너스 제휴 안내',
    desc: '꿀딜의 쿠팡 파트너스 제휴 방식과 수수료 구조를 안내합니다.',
    body: `<h1>쿠팡 파트너스 제휴 안내</h1>
<p>이 사이트는 쿠팡 파트너스 활동의 일환으로, 방문자가 링크를 통해 구매할 경우 <strong>일정액의 수수료를 제공받습니다.</strong></p>
<ul>
  <li>이 수수료는 <strong>쿠팡이 지급</strong>하며, 방문자가 지불하는 <strong>상품 가격에는 영향을 주지 않습니다.</strong></li>
  <li>꿀딜은 쿠팡이 직접 운영하는 공식 사이트가 아닌 <strong>독립 큐레이션 사이트</strong>입니다.</li>
  <li>쿠팡으로 이동하는 링크에는 <code>rel="sponsored"</code>가 적용되어 있습니다.</li>
  <li>사용자가 직접 누르지 않는 한 <strong>자동으로 쿠팡으로 이동하지 않습니다.</strong></li>
</ul>`,
  },
  {
    slug: 'contact',
    title: '문의 · 신고',
    desc: '잘못된 가격, 품절, 링크 오류 신고 및 기타 문의 안내입니다.',
    body: `<h1>문의 · 신고</h1>
<p>상품 정보 오류나 기타 문의는 아래로 연락해 주세요. 확인 후 반영하겠습니다.</p>
${contactLine}
<h2>이런 것을 신고해 주세요</h2>
<ul>
  <li><strong>잘못된 가격</strong> — 표시 가격과 쿠팡 실제 가격이 다를 때</li>
  <li><strong>품절 상품</strong> — 이미 판매가 끝난 상품</li>
  <li><strong>링크 오류</strong> — 쿠팡으로 연결되지 않는 링크</li>
</ul>
<p>신고 시 <strong>상품명 또는 주소</strong>를 함께 알려주시면 빠르게 확인할 수 있습니다.</p>`,
  },
  {
    slug: 'terms',
    title: '이용약관',
    desc: '꿀딜 서비스 이용에 관한 약관입니다.',
    body: `<h1>이용약관</h1>
<ul>
  <li>꿀딜은 쿠팡 상품 정보를 큐레이션하여 제공하는 <strong>정보 서비스</strong>입니다.</li>
  <li>표시된 가격·재고·배송·쿠폰 정보는 참고용이며, 정확성·최신성을 보증하지 않습니다. <strong>최종 정보는 쿠팡 구매 페이지 기준</strong>입니다.</li>
  <li>모든 구매는 쿠팡에서 이루어지며, 상품의 배송·환불·교환·A/S 등은 <strong>쿠팡 및 판매자의 정책</strong>을 따릅니다.</li>
  <li>꿀딜은 제공 정보의 오류나 이를 근거로 한 구매 결정에 대해 법적 책임을 지지 않습니다.</li>
  <li>본 사이트가 직접 작성한 콘텐츠(정리된 상품명, 추천 이유 등)의 무단 복제를 금합니다.</li>
</ul>`,
  },
  {
    slug: 'privacy',
    title: '개인정보처리방침 · 쿠키 안내',
    desc: '꿀딜의 개인정보 처리와 쿠키·분석도구 사용에 관한 안내입니다.',
    body: `<h1>개인정보처리방침 · 쿠키 안내</h1>
<ul>
  <li>꿀딜은 <strong>회원가입이 없으며</strong>, 이름·연락처 등 개인정보를 직접 수집하지 않습니다.</li>
  <li>찜 · 최근 본 상품 · 테마 설정 등은 방문자의 <strong>브라우저(localStorage)에만 저장</strong>되며 서버로 전송되지 않습니다.</li>
  <li>방문 분석을 위해 Google Analytics 등 분석 도구를 사용할 수 있으며, 이 경우 <strong>쿠키를 통해 익명화된 이용 통계</strong>를 수집할 수 있습니다.</li>
  <li>브라우저 설정에서 쿠키·사이트 데이터를 삭제하면 저장된 정보가 지워집니다.</li>
</ul>`,
  },
];

function infoPage(page) {
  const canonical = `${BASE}/info/${page.slug}.html`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '홈', item: `${BASE}/` },
          { '@type': 'ListItem', position: 2, name: page.title, item: canonical },
        ],
      },
      { '@type': 'WebPage', name: `${page.title} | 꿀딜`, url: canonical, description: page.desc },
    ],
  };
  const body = `<nav class="crumb wrap" aria-label="위치">
  <a href="${BASE}/">홈</a> <span aria-hidden="true">›</span> <span>${esc(page.title)}</span>
</nav>
<main class="wrap info">
  ${page.body}
</main>`;
  return pageShell({
    title: `${page.title} | 꿀딜`,
    description: page.desc,
    canonical,
    jsonLd,
    body,
    assetPrefix: '../',
  });
}

function buildSitemap(byCat) {
  const now = new Date().toISOString().slice(0, 10);
  const urls = [
    `${BASE}/`,
    `${BASE}/c/`,
    ...[...byCat.keys()].map((c) => `${BASE}/c/${encodeURIComponent(fileFor(c))}.html`),
    ...INFO_PAGES.map((p) => `${BASE}/info/${p.slug}.html`),
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

  // 신뢰 페이지 (소개·기준·제휴·문의·약관·개인정보)
  const INFO_DIR = path.join(ROOT, 'info');
  await fs.mkdir(INFO_DIR, { recursive: true });
  for (const page of INFO_PAGES) {
    await fs.writeFile(path.join(INFO_DIR, `${page.slug}.html`), infoPage(page), 'utf8');
  }

  await fs.writeFile(path.join(ROOT, 'sitemap.xml'), buildSitemap(byCat), 'utf8');

  console.log(`카테고리 ${byCat.size}개 → c/*.html + 허브 · 신뢰 페이지 ${INFO_PAGES.length}개 → info/ · sitemap.xml`);
  console.log(`도메인: ${BASE}${BASE.includes('example.com') ? '  (⚠ --base 로 실제 도메인을 지정하세요)' : ''}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
