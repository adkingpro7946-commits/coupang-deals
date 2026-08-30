// data/products.json 을 생성한다.
//   node scripts/fetch-products.mjs                    전체 키워드 한 번에 수집(교체) — API 한도 주의
//   node scripts/fetch-products.mjs --rotate 14        풀에서 14개만 순환 수집 후 기존과 병합(권장, 자동 실행용)
//   node scripts/fetch-products.mjs --keywords "무선이어폰,캠핑의자"
//
// --rotate N: 매 실행 N개 키워드씩 순환 사용 + 병합. 시간당 API 한도를 넘지 않으면서
//   며칠에 걸쳐 카탈로그를 넓게 쌓는다. 회전 위치는 data/rotation.json 에 저장된다.
//
// 시크릿 키는 이 프로세스 안에서만 쓰이고, 결과물(products.json)에는 들어가지 않는다.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CoupangPartners, normalize, productUrlToCanonical } from './coupang.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'products.json');
const ROTATE_FILE = path.join(ROOT, 'data', 'rotation.json');
const MAX_AGE_DAYS = 14;   // 이 기간 넘게 안 보인 상품은 정리(오래된/품절 방지)
const MAX_PRODUCTS = 800;  // 파일·페이지가 너무 커지지 않게 상한

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * 키워드 풀에서 cursor 위치부터 count개를 순환 선택한다.
 * 매 실행 다른 구간을 써서 하루 API 호출을 줄이고, 며칠에 걸쳐 풀 전체를 훑는다.
 * count가 풀 크기 이상이면 전체를 그대로 쓴다(회전 안 함).
 */
export function rotateKeywords(pool, cursor, count) {
  if (count <= 0 || pool.length <= count) return { keywords: pool.slice(), nextCursor: cursor };
  const keywords = [];
  for (let i = 0; i < count; i++) keywords.push(pool[(cursor + i) % pool.length]);
  return { keywords, nextCursor: (cursor + count) % pool.length };
}

/**
 * 이전 목록에 이번 수집분을 병합한다(회전 수집의 핵심).
 * - 이번에 받은 상품은 최신값으로 갱신/추가 (lastSeen=now)
 * - 이번에 안 받은 이전 상품은 그대로 유지 (며칠 전 가격이지만 카탈로그는 넓게)
 * - maxAgeDays 넘게 안 보인 건 정리, 총 maxProducts개로 제한(최근 본 순).
 */
export function mergeProducts(prevList, fetched, now, opts = {}) {
  const { maxAgeDays = MAX_AGE_DAYS, maxProducts = MAX_PRODUCTS, prevGeneratedAt = null } = opts;
  const cutoff = Date.parse(now) - maxAgeDays * 86400000;
  const merged = new Map();
  for (const p of prevList) {
    if (!p.lastSeen) p.lastSeen = prevGeneratedAt || now; // 승계: 오래됨 판정 기준
    merged.set(p.id, p);
  }
  for (const p of fetched) merged.set(p.id, p); // 이번 수집이 우선(최신 가격·링크)
  let list = [...merged.values()].filter((p) => Date.parse(p.lastSeen || 0) >= cutoff);
  list.sort((a, b) => Date.parse(b.lastSeen || 0) - Date.parse(a.lastSeen || 0));
  return list.length > maxProducts ? list.slice(0, maxProducts) : list;
}

async function loadCursor() {
  try {
    return JSON.parse(await fs.readFile(ROTATE_FILE, 'utf8')).offset || 0;
  } catch {
    return 0;
  }
}
async function saveCursor(offset) {
  await fs.mkdir(path.dirname(ROTATE_FILE), { recursive: true });
  await fs.writeFile(ROTATE_FILE, JSON.stringify({ offset, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
}

/** 직전 수집분 전체를 읽는다(병합·가격비교용). 없거나 샘플이면 빈 목록. */
async function loadPrevFull() {
  try {
    const prev = JSON.parse(await fs.readFile(OUT, 'utf8'));
    if (prev.sample) return { products: [], generatedAt: null };
    return { products: prev.products || [], generatedAt: prev.generatedAt || null };
  } catch {
    return { products: [], generatedAt: null };
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

/**
 * 각 상품의 제휴 URL을 deeplink API로 정식 단축 링크(link.coupang.com/a/...)로 바꾼다.
 * goldbox/search가 주는 원시 /re/AFFSDP 링크는 브라우저 클릭 시 "사용권한 없음"이 뜨는 경우가
 * 있어서, 파트너스 링크 생성기와 동일한 단축 링크로 교체한다.
 * 변환 실패(청크 오류 등) 시 원래 URL을 그대로 둔다.
 */
async function resolveDeeplinks(api, products, subId) {
  const CHUNK = 20; // deeplink API 한도: 한 번에 20개 URL
  const jobs = [];
  for (const p of products) {
    const canonical = productUrlToCanonical(p.url);
    if (canonical) jobs.push({ product: p, canonical });
  }
  if (!jobs.length) return 0;

  let converted = 0;
  for (let i = 0; i < jobs.length; i += CHUNK) {
    const slice = jobs.slice(i, i + CHUNK);
    try {
      const res = await api.deeplink(slice.map((j) => j.canonical), { subId });
      const shortByUrl = new Map((res.data || []).map((d) => [d.originalUrl, d.shortenUrl]));
      for (const j of slice) {
        const short = shortByUrl.get(j.canonical);
        if (short) {
          j.product.url = short;
          converted++;
        }
      }
    } catch (err) {
      console.error(`  딥링크 변환 실패(${i}~${i + slice.length}): ${err.message} → 원본 링크 유지`);
    }
  }
  return converted;
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

  // 회전 수집: 풀에서 이번 실행에 쓸 키워드만 잘라낸다(API 시간당 한도 회피).
  const rotate = parseInt(arg('rotate', '0'), 10) || 0;
  const pool = keywords;
  let nextCursor = 0;
  if (rotate > 0 && pool.length > rotate) {
    const cursor = await loadCursor();
    const r = rotateKeywords(pool, cursor, rotate);
    keywords = r.keywords;
    nextCursor = r.nextCursor;
    console.log(`회전 수집: 풀 ${pool.length}개 중 ${rotate}개 사용 (offset ${cursor} → ${nextCursor})`);
  }

  // 덮어쓰기/병합 전에 읽어야 가격 비교가 가능하다.
  const prevData = await loadPrevFull();
  const prevList = prevData.products;
  const prevMap = new Map(prevList.map((p) => [p.id, p]));

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

  // 제휴 URL → 정식 단축 링크로 변환 (클릭 시 "사용권한 없음" 방지)
  const converted = await resolveDeeplinks(api, unique, subId);
  console.log(`딥링크 변환: ${converted}/${unique.length}개`);

  const now = new Date().toISOString();
  const { drops, fresh } = markPriceDrops(unique, prevMap, now);
  for (const p of unique) p.lastSeen = now;

  // 회전 수집이면 이전 상품과 병합해 쌓고, 아니면 이번 수집으로 통째 교체한다.
  const products = rotate > 0
    ? mergeProducts(prevList, unique, now, { prevGeneratedAt: prevData.generatedAt })
    : unique;

  const out = {
    generatedAt: now,
    sample: false,
    count: products.length,
    products,
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2), 'utf8');
  if (rotate > 0 && pool.length > rotate) await saveCursor(nextCursor);

  console.log(`\n총 ${products.length}개 상품 → data/products.json (이번 수집 ${unique.length}개)`);
  if (prevMap.size) console.log(`가격 내림 ${drops}개 · 신규 ${fresh}개`);
  else console.log('직전 수집분이 없어 가격 비교는 건너뜁니다. 다음 실행부터 "가격 내림"이 표시됩니다.');
  if (errors.length) console.log(`\n일부 실패:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
}

// 직접 실행할 때만 돌린다(테스트용 import 시엔 main을 실행하지 않음).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
