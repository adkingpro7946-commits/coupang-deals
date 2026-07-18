// data/products.json 을 생성한다.
//   node scripts/fetch-products.mjs
//   node scripts/fetch-products.mjs --keywords "무선이어폰,캠핑의자" --best 1001,1002
//
// 시크릿 키는 이 프로세스 안에서만 쓰이고, 결과물(products.json)에는 들어가지 않는다.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoupangPartners, normalize } from './coupang.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'products.json');

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** 직전 수집분을 읽어 id → {price, firstSeen} 으로 만든다. 없으면 빈 맵. */
async function loadPrevious() {
  try {
    const prev = JSON.parse(await fs.readFile(OUT, 'utf8'));
    if (prev.sample) return new Map(); // 샘플과 실제 가격을 비교하면 안 된다
    return new Map((prev.products || []).map((p) => [p.id, p]));
  } catch {
    return new Map();
  }
}

/**
 * 이전 수집분 대비 실제로 내려간 가격에만 배지를 붙인다.
 * 관측된 사실만 쓴다 — 추측하거나 지어내지 않는다.
 */
function markPriceDrops(products, prev, now) {
  let drops = 0;
  let fresh = 0;

  for (const p of products) {
    const old = prev.get(p.id);

    if (!old) {
      p.firstSeen = now;
      p.isNew = prev.size > 0; // 첫 수집이면 전부 신규라 의미가 없다
      if (p.isNew) fresh++;
      continue;
    }

    p.firstSeen = old.firstSeen || now;

    if (old.price > 0 && p.price > 0 && p.price < old.price) {
      p.priceDrop = {
        from: old.price,
        pct: Math.round(((old.price - p.price) / old.price) * 100),
        at: now,
      };
      drops++;
    } else if (old.priceDrop && p.price === old.price) {
      // 가격이 그대로면 직전에 붙은 배지를 24시간까지만 유지한다.
      const age = Date.parse(now) - Date.parse(old.priceDrop.at);
      if (age < 24 * 60 * 60 * 1000) p.priceDrop = old.priceDrop;
    }
  }

  return { drops, fresh };
}

// .env 를 의존성 없이 읽는다.
async function loadEnv() {
  try {
    const raw = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // .env 없이 환경변수만 쓰는 경우도 정상
  }
}

async function main() {
  await loadEnv();

  const subId = process.env.COUPANG_SUB_ID || undefined;

  // 키워드는 --keywords 인수로 받되, 없으면 scripts/keywords.txt(UTF-8)를 읽는다.
  // 윈도우에서 한글 인수는 인코딩이 깨지므로, 자동 실행 때는 파일 경로가 안전하다.
  let keywords = arg('keywords').split(',').map((s) => s.trim()).filter(Boolean);
  if (!keywords.length) {
    try {
      const raw = await fs.readFile(path.join(ROOT, 'scripts', 'keywords.txt'), 'utf8');
      keywords = raw.split(/[\n,]/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
    } catch {
      // 파일 없으면 골드박스만 수집
    }
  }

  const bestCategories = arg('best').split(',').map((s) => s.trim()).filter(Boolean);

  // 덮어쓰기 전에 읽어야 가격 비교가 가능하다.
  const prev = await loadPrevious();

  const api = new CoupangPartners();
  const all = [];
  const errors = [];

  // 골드박스는 항상 수집
  try {
    const gb = await api.goldbox({ subId });
    const rows = normalize(gb, { source: 'goldbox' });
    all.push(...rows);
    console.log(`골드박스: ${rows.length}개`);
  } catch (err) {
    errors.push(`골드박스 실패: ${err.message}`);
    console.error(`골드박스 실패: ${err.message}`);
  }

  for (const categoryId of bestCategories) {
    try {
      const res = await api.bestCategories(categoryId, { limit: 50, subId });
      const rows = normalize(res, { source: `best:${categoryId}` });
      all.push(...rows);
      console.log(`카테고리 ${categoryId}: ${rows.length}개`);
    } catch (err) {
      errors.push(`카테고리 ${categoryId} 실패: ${err.message}`);
      console.error(`카테고리 ${categoryId} 실패: ${err.message}`);
    }
  }

  for (const keyword of keywords) {
    try {
      // 검색은 키워드당 최대 10개(쿠팡 제한). 상품을 늘리려면 키워드를 늘린다.
      const res = await api.search(keyword, { subId });
      const rows = normalize(res, { source: `search:${keyword}`, category: keyword });
      all.push(...rows);
      console.log(`검색 "${keyword}": ${rows.length}개`);
    } catch (err) {
      errors.push(`검색 "${keyword}" 실패: ${err.message}`);
      console.error(`검색 "${keyword}" 실패: ${err.message}`);
    }
  }

  if (!all.length) {
    console.error('\n수집된 상품이 0개입니다. data/products.json 을 덮어쓰지 않고 종료합니다.');
    if (errors.length) console.error(errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }

  // productId 기준 중복 제거 (골드박스와 검색 결과가 겹칠 수 있음)
  const unique = [...new Map(all.map((p) => [p.id, p])).values()];

  const now = new Date().toISOString();
  const { drops, fresh } = markPriceDrops(unique, prev, now);

  const out = {
    generatedAt: now,
    sample: false,
    count: unique.length,
    products: unique,
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2), 'utf8');

  console.log(`\n${unique.length}개 상품 → data/products.json (중복 ${all.length - unique.length}개 제거)`);
  if (prev.size) console.log(`가격 내림 ${drops}개 · 신규 ${fresh}개 (직전 수집분 ${prev.size}개와 비교)`);
  else console.log('직전 수집분이 없어 가격 비교는 건너뜁니다. 다음 실행부터 "가격 내림"이 표시됩니다.');
  if (errors.length) console.log(`\n일부 실패:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
