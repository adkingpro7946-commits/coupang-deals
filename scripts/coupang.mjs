// 쿠팡 파트너스 Open API 클라이언트.
// 이 파일은 Node에서만 실행된다. SECRET_KEY가 들어가므로 절대 브라우저로 번들하지 말 것.

import crypto from 'node:crypto';
import { canonicalCategory } from './categories.mjs';

const DOMAIN = 'https://api-gateway.coupang.com';
const BASE = '/v2/providers/affiliate_open_api/apis/openapi';

// 실측 결과 goldbox/search 는 "/v1"에서 정상 동작한다(200/rCode=0).
// "/v1"을 먼저 쓰고, 특정 엔드포인트가 404/405면 버전 없는 경로로 한 번 더 시도한다.
// 성공 시엔 첫 후보에서 바로 반환하므로 여분 요청이 생기지 않는다.
const VARIANTS = ['/v1', ''];

// 검색 limit 상한(실측: 10 초과 시 "limit is out of range").
const SEARCH_MAX_LIMIT = 10;

/** signed-date: UTC 기준 yyMMdd'T'HHmmss'Z' */
function signedDate(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2);
}

/** 서명 대상 메시지는 signed-date + METHOD + path + query (query는 '?' 제외) */
function authorize({ accessKey, secretKey, method, pathWithQuery, date = signedDate() }) {
  const [path, query = ''] = pathWithQuery.split('?');
  const message = `${date}${method.toUpperCase()}${path}${query}`;
  const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${date}, signature=${signature}`;
}

function toQuery(params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

export class CoupangPartners {
  constructor({ accessKey, secretKey, timeout = 20000 } = {}) {
    this.accessKey = accessKey || process.env.COUPANG_ACCESS_KEY;
    this.secretKey = secretKey || process.env.COUPANG_SECRET_KEY;
    this.timeout = timeout;
    if (!this.accessKey || !this.secretKey) {
      throw new Error('COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 가 필요합니다. .env 를 확인하세요.');
    }
  }

  async #send(method, pathWithQuery, body) {
    const authorization = authorize({
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      method,
      pathWithQuery,
    });

    const res = await fetch(DOMAIN + pathWithQuery, {
      method,
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeout),
    });

    const text = await res.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }

    if (!res.ok) {
      const err = new Error(`쿠팡 API ${res.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
      err.status = res.status;
      throw err;
    }
    // HTTP 200이어도 rCode가 0이 아니면 실패다.
    if (payload && typeof payload === 'object' && payload.rCode && payload.rCode !== '0') {
      const err = new Error(`쿠팡 API rCode=${payload.rCode}: ${payload.rMessage}`);
      err.rCode = payload.rCode;
      throw err;
    }
    return payload;
  }

  /** 경로 버전 세그먼트가 불확실하므로 404/405면 다음 후보로 넘어간다. */
  async #request(method, subPath, { query, body } = {}) {
    let lastErr;
    for (const variant of VARIANTS) {
      const pathWithQuery = `${BASE}${variant}${subPath}${toQuery(query)}`;
      try {
        return await this.#send(method, pathWithQuery, body);
      } catch (err) {
        lastErr = err;
        if (err.status === 404 || err.status === 405) continue; // 경로 문제 → 다음 후보
        throw err; // 401/429 등은 경로와 무관하므로 즉시 중단
      }
    }
    throw lastErr;
  }

  /** 골드박스(오늘의 특가) */
  goldbox({ subId, imageSize } = {}) {
    return this.#request('GET', '/products/goldbox', { query: { subId, imageSize } });
  }

  /** 카테고리 베스트. categoryId는 쿠팡 파트너스 카테고리 코드 */
  bestCategories(categoryId, { limit = 50, subId, imageSize } = {}) {
    return this.#request('GET', `/products/bestcategories/${categoryId}`, {
      query: { limit, subId, imageSize },
    });
  }

  /** 키워드 검색. limit 상한은 10이며 초과 시 자동으로 10으로 낮춘다. */
  search(keyword, { limit = SEARCH_MAX_LIMIT, subId, imageSize } = {}) {
    const capped = Math.min(limit, SEARCH_MAX_LIMIT);
    return this.#request('GET', '/products/search', { query: { keyword, limit: capped, subId, imageSize } });
  }

  /** 일반 쿠팡 URL → 파트너스 추적 링크 */
  deeplink(coupangUrls, { subId } = {}) {
    return this.#request('POST', '/deeplink', {
      query: { subId },
      body: { coupangUrls: [].concat(coupangUrls) },
    });
  }
}

/**
 * 엔드포인트마다 응답 껍데기가 다르다.
 * goldbox/bestcategories → { data: [...] }
 * search                 → { data: { productData: [...] } }
 */
export function normalize(payload, extra = {}) {
  const data = payload?.data;
  const rows = Array.isArray(data) ? data : Array.isArray(data?.productData) ? data.productData : [];

  return rows
    .filter((p) => p && p.productUrl && p.productName)
    .map((p) => ({
      id: String(p.productId ?? p.productUrl),
      name: p.productName,
      price: Number(p.productPrice) || 0,
      image: p.productImage || '',
      url: p.productUrl,
      category: canonicalCategory(p.categoryName || extra.category),
      rocket: Boolean(p.isRocket),
      freeShipping: Boolean(p.isFreeShipping),
      discountRate: Number(p.discountRate) || 0,
      basePrice: Number(p.basePrice) || 0,
      rank: Number(p.rank) || 0,
      source: extra.source || 'unknown',
    }));
}

/**
 * goldbox/search API가 주는 제휴 URL(/re/AFFSDP?...)에서 정식 상품 URL을 복원한다.
 * 이 정식 URL을 deeplink API에 넣으면 link.coupang.com/a/... 단축 링크가 나온다.
 * pageKey(=productId)가 없으면 null (샘플/기타 URL은 변환 대상이 아님).
 */
export function productUrlToCanonical(url) {
  try {
    const u = new URL(url);
    const pageKey = u.searchParams.get('pageKey');
    if (!pageKey) return null;
    const itemId = u.searchParams.get('itemId');
    const vendorItemId = u.searchParams.get('vendorItemId');
    const qs = [];
    if (itemId) qs.push('itemId=' + itemId);
    if (vendorItemId) qs.push('vendorItemId=' + vendorItemId);
    return `https://www.coupang.com/vp/products/${pageKey}` + (qs.length ? '?' + qs.join('&') : '');
  } catch {
    return null;
  }
}

export { signedDate, authorize };
