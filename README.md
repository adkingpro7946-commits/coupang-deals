# 쿠팡 파트너스 상품 큐레이션 사이트

골드박스 · 카테고리 베스트 · 키워드 검색 결과를 한 화면에 모아 보여주는 정적 사이트.

## 구조: 왜 정적인데 API를 쓰나

쿠팡 파트너스 Open API는 **브라우저에서 직접 호출할 수 없다.** 두 가지 이유다.

1. 요청마다 시크릿 키로 HMAC-SHA256 서명을 만들어야 하는데, 정적 페이지에 키를 넣으면 누구나 개발자도구로 꺼내간다 (키 탈취 → 계정 정지)
2. `api-gateway.coupang.com`이 CORS를 허용하지 않아 브라우저 `fetch`가 차단된다

그래서 **빌드타임 페칭** 구조를 쓴다.

```
[내 PC] node scripts/fetch-products.mjs
           │  COUPANG_SECRET_KEY 로 HMAC 서명
           ▼
    쿠팡 Open API
           │
           ▼
    data/products.json  ←── 이것만 배포된다
           │
           ▼
[브라우저] index.html 이 JSON만 읽음 (키 없음)
```

시크릿 키는 `.env` 안에만 있고 배포물에는 들어가지 않는다. 결과물이 순수 정적 파일이라 GitHub Pages·Netlify·Vercel 어디든 그대로 올라간다.

## 시작하기

```bash
# 1. 샘플 데이터로 바로 확인 (API 키 불필요)
node scripts/make-sample.mjs
node scripts/serve.mjs
# → http://localhost:5173
```

`index.html`을 `file://`로 직접 열면 `fetch`가 CORS로 막히니 반드시 서버로 띄울 것.

### 실제 상품 넣기

```bash
cp .env.example .env      # 파트너스 > 내 정보 > 오픈 API 키 발급
node scripts/fetch-products.mjs
node scripts/build-pages.mjs --base https://내도메인.com   # 카테고리 SEO 페이지 + sitemap
```

`npm run build` 하나로 수집 + 페이지 생성을 함께 돌릴 수 있다 (도메인은 `SITE_URL` 환경변수로).

옵션:

```bash
# 키워드 검색 결과 추가
node scripts/fetch-products.mjs --keywords "무선이어폰,캠핑의자,보조배터리"

# 카테고리 베스트 추가 (파트너스 카테고리 코드)
node scripts/fetch-products.mjs --best 1001,1002,1010
```

골드박스는 항상 수집한다. 일부 소스가 실패해도 나머지는 저장하지만, **전부 실패하면 기존 `products.json`을 덮어쓰지 않고 종료**한다 (사이트가 빈 화면이 되는 걸 막기 위해).

가격은 수시로 바뀌므로 하루 1~2회 재실행을 권한다.

## 파일

| 경로 | 역할 |
|---|---|
| `index.html` | 마크업. 카드 템플릿 포함 |
| `assets/styles.css` | 전체 스타일. 다크모드는 `:root[data-theme]` |
| `assets/app.js` | 필터·정렬·무한스크롤·클릭추적 |
| `data/products.json` | 상품 데이터 (생성물) |
| `scripts/coupang.mjs` | HMAC 서명 + API 클라이언트 (**Node 전용**) |
| `scripts/fetch-products.mjs` | 수집 → JSON 생성 |
| `scripts/make-sample.mjs` | 키 없이 쓸 샘플 데이터 |
| `scripts/build-pages.mjs` | 카테고리별 SEO 정적 페이지 + sitemap 생성 |
| `scripts/serve.mjs` | 의존성 없는 로컬 정적 서버 |
| `c/*.html` | 카테고리 페이지 (생성물) |

## 기능

- 검색(`/` 키로 포커스), 카테고리 칩, 로켓배송 필터
- 정렬: 추천순 / **가격 내림순** / 할인율 / 가격 / 많이 본 순
- **가격 내림 배지**: 직전 수집분보다 실제로 값이 내려간 상품에만 붙는다 (조작 아님, 관측값)
- **최근 본 상품**: 클릭한 상품을 상단 가로 스트립에 최대 12개 (localStorage)
- **필터 URL 동기화**: 검색·카테고리·정렬 상태가 주소창에 반영돼 공유·뒤로가기가 된다
- 24개씩 무한 스크롤 + 스크롤 폴백, 첫 8장은 즉시 로드(LCP), 나머지는 lazy
- 쿠팡 썸네일은 해상도별 `srcset` 자동 생성 (레티나 대응, 데이터 절약)
- 다크모드 (첫 페인트 전 인라인 스크립트로 확정 → 깜빡임 없음)
- **카테고리별 SEO 랜딩 페이지** (`c/*.html`): 검색엔진이 읽을 수 있게 미리 렌더된 정적 페이지. 허브(`c/`) → 카테고리 → 메인으로 내부 링크가 이어지고, breadcrumb·ItemList JSON-LD와 canonical 포함
- 맨 위로 버튼, PWA 매니페스트(홈 화면 추가), `sitemap.xml`, `robots.txt`, OG 이미지, JSON-LD
- 키보드 접근성: `/` 검색 포커스, 카드 Enter 이동+추적
- 클릭·최근본·클릭수 기록은 전부 `localStorage`에만 저장하고 외부로 보내지 않는다

`window.dataLayer`가 있으면 카드 클릭 시 GA4 `select_item` 이벤트를 넘긴다. 없으면 아무 일도 없다.

### 가격 내림 배지가 동작하려면

`fetch-products.mjs`는 실행할 때마다 직전 `products.json`과 가격을 비교한다. 즉 **두 번 이상 수집해야** 배지가 생긴다. `.github/workflows/refresh.yml`이 하루 2회(KST 06:00/18:00) 자동 수집·커밋하도록 넣어뒀다 — 리포지토리 Secrets에 `COUPANG_ACCESS_KEY` / `COUPANG_SECRET_KEY`만 넣으면 된다.

## 알아둘 것

**고지 문구는 지우지 말 것.** 푸터의 "쿠팡 파트너스 활동의 일환으로…" 문구는 파트너스 이용약관과 공정위 추천·보증 심사지침상 필수다. 빠지면 활동 정지 사유가 된다.

**의도적으로 넣지 않은 것들** — 가짜 카운트다운, "n명이 보는 중", 조작된 후기 같은 건 넣지 않았다. 클릭률은 잠깐 오르지만 표시광고법 위반이고 파트너스 정책 위반이다. 대신 실제 할인율·로켓배송 여부처럼 진짜 정보를 크고 빠르게 보여주는 쪽으로 만들었다.

**API 경로 / 검색 상한 (실측 확인됨)** — 실제 키로 확인한 결과:
- `/openapi/v1/products/...` 와 버전 없는 `/openapi/products/...` **둘 다 동일하게 동작**한다(200/rCode=0). `VARIANTS`는 `/v1`을 먼저 쓰고, 성공하면 바로 반환하므로 여분 요청이 없다(둘째 후보는 404일 때만 시도).
- **검색(`search`)은 키워드당 최대 10개**다. `limit`이 10을 넘으면 `rCode=400 "limit is out of range"`. 그래서 상품을 늘리려면 `limit`이 아니라 **키워드 수**를 늘려야 한다. `coupang.mjs`가 10 초과 값을 자동으로 10으로 낮춘다.
- 골드박스는 `limit` 파라미터가 없고 한 번에 수십 개를 준다(실측 28개).
- 이미지 URL은 크기 세그먼트 없는 원본(`img*.coupangcdn.com/image/...`)이라 자동 `srcset`이 안 붙고 원본 크기로 로드된다(깨지진 않음).

## 배포

`data/products.json`을 만든 뒤 폴더 전체를 올리면 된다. 빌드 단계가 없다.

GitHub Pages라면 `.env`가 `.gitignore`에 있는지 반드시 확인할 것. 주기적 갱신은 Actions에서 `COUPANG_ACCESS_KEY` / `COUPANG_SECRET_KEY`를 Secrets에 넣고 `fetch-products.mjs`를 돌린 뒤 커밋하면 된다.
