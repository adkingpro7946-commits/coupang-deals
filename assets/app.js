'use strict';

const PAGE = 24;            // 한 번에 그릴 카드 수
const RECENT_MAX = 12;
const CLICK_KEY = 'cp:clicks';
const RECENT_KEY = 'cp:recent';

const state = {
  all: [],
  view: [],
  shown: 0,
  q: '',
  category: '전체',
  rocketOnly: false,
  sort: 'recommended',
  clicks: readClicks(),
  recent: readJSON(RECENT_KEY, []),
};

const $ = (sel) => document.querySelector(sel);
const grid = $('#grid');
const tpl = $('#card-tpl');

/* ---------- 로컬 저장 (전부 브라우저 안에만 남고 서버로 보내지 않음) ---------- */
function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 시크릿 모드 등에서 저장이 막혀도 이동 자체는 절대 방해하지 않는다.
  }
}

function readClicks() {
  return readJSON(CLICK_KEY, {});
}

function recordClick(id) {
  state.clicks[id] = (state.clicks[id] || 0) + 1;
  writeJSON(CLICK_KEY, state.clicks);

  // 최근 본 상품: 중복 제거 후 맨 앞으로
  state.recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
  writeJSON(RECENT_KEY, state.recent);
  renderRecent();
}

/* ---------- 유틸 ---------- */
const won = new Intl.NumberFormat('ko-KR');
const fmt = (n) => won.format(n) + '원';

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/**
 * 쿠팡 썸네일 URL은 경로에 크기가 박혀 있다(.../remote/212x212ex/image/...).
 * 그 숫자만 갈아끼워 해상도별 후보를 만든다. 형식이 다르면 건드리지 않는다.
 */
function srcsetFor(url) {
  if (!/\/\d+x\d+ex\//.test(url)) return null;
  const at = (n) => url.replace(/\/\d+x\d+ex\//, `/${n}x${n}ex/`);
  return [`${at(212)} 212w`, `${at(320)} 320w`, `${at(492)} 492w`].join(', ');
}

/* ---------- 최근 본 상품 ---------- */
function renderRecent() {
  const wrap = $('#recent-wrap');
  const strip = $('#recent');

  const byId = new Map(state.all.map((p) => [p.id, p]));
  const items = state.recent.map((id) => byId.get(id)).filter(Boolean);

  if (!items.length) {
    wrap.hidden = true;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const p of items) {
    const a = document.createElement('a');
    a.className = 'rc';
    a.href = p.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer sponsored';
    a.dataset.id = p.id;

    const img = document.createElement('img');
    img.src = p.image;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';

    const name = document.createElement('p');
    name.className = 'rc-name';
    name.textContent = p.name;

    a.append(img, name);
    frag.appendChild(a);
  }

  strip.replaceChildren(frag);
  wrap.hidden = false;
}

/* ---------- URL 동기화 ----------
 * 필터를 걸면 주소창에 반영해 공유/뒤로가기가 되게 한다.
 */
function readURL() {
  const p = new URLSearchParams(location.search);
  state.q = p.get('q') || '';
  state.category = p.get('cat') || '전체';
  state.rocketOnly = p.get('rocket') === '1';
  state.sort = p.get('sort') || 'recommended';
}

function writeURL() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.category !== '전체') p.set('cat', state.category);
  if (state.rocketOnly) p.set('rocket', '1');
  if (state.sort !== 'recommended') p.set('sort', state.sort);

  const qs = p.toString();
  // 필터 조작마다 히스토리를 쌓으면 뒤로가기가 지옥이 된다 → replace
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  $('#share').hidden = !qs;
}

/** state → UI 위젯 반영 (뒤로가기/초기 로드용) */
function syncUI() {
  $('#q').value = state.q;
  $('#q-clear').hidden = !state.q;
  $('#rocket-only').checked = state.rocketOnly;
  $('#sort').value = state.sort;
  $('#chips').querySelectorAll('.chip').forEach((c) => {
    c.setAttribute('aria-selected', String(c.dataset.cat === state.category));
  });
}

/* ---------- 구조화 데이터 ----------
 * 가격/재고는 금방 낡아서 넣지 않는다. 잘못된 값이 노출되면 검색엔진에서 불이익이다.
 */
function injectJsonLd(products) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: document.title,
    numberOfItems: products.length,
    itemListElement: products.slice(0, 20).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: p.name,
      url: p.url,
      image: p.image?.startsWith('data:') ? undefined : p.image,
    })),
  };
  const s = document.createElement('script');
  s.type = 'application/ld+json';
  s.textContent = JSON.stringify(ld);
  document.head.appendChild(s);
}

/* ---------- 테마 ---------- */
function initTheme() {
  $('#theme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('cp:theme', next);
    } catch { /* 무시 */ }
  });
}

/* ---------- 필터 + 정렬 ---------- */
function applyFilters() {
  const q = state.q.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];

  let rows = state.all.filter((p) => {
    if (state.rocketOnly && !p.rocket) return false;
    if (state.category !== '전체' && p.category !== state.category) return false;
    if (terms.length) {
      const hay = (p.name + ' ' + p.category).toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  const dropAmt = (p) => (p.priceDrop?.from > p.price ? p.priceDrop.from - p.price : 0);

  const by = {
    // 실제로 값이 내려간 상품을 먼저, 그다음 할인율, 같으면 API가 준 rank 순서를 존중한다.
    recommended: (a, b) =>
      Math.sign(dropAmt(b)) - Math.sign(dropAmt(a)) ||
      b.discountRate - a.discountRate ||
      (a.rank || 999) - (b.rank || 999),
    drop: (a, b) => dropAmt(b) - dropAmt(a) || b.discountRate - a.discountRate,
    discount: (a, b) => b.discountRate - a.discountRate,
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
    popular: (a, b) => (state.clicks[b.id] || 0) - (state.clicks[a.id] || 0) || b.discountRate - a.discountRate,
  };
  rows.sort(by[state.sort] || by.recommended);

  state.view = rows;
  state.shown = 0;
  grid.replaceChildren();
  $('#end').hidden = true;
  $('#empty').hidden = rows.length > 0;

  const drops = rows.filter((p) => p.priceDrop?.from > p.price).length;
  $('#count').innerHTML = rows.length
    ? `<b>${won.format(rows.length)}</b>개 상품` +
      (drops ? ` · <b style="color:#0aa06e">${drops}</b>개 가격 내림` : '')
    : '';

  writeURL();
  renderMore();
  state.pump?.(); // 첫 페이지로 화면이 안 차면 이어서 채운다
}

/* ---------- 렌더 ---------- */
function renderMore() {
  const slice = state.view.slice(state.shown, state.shown + PAGE);
  if (!slice.length) {
    $('#end').hidden = state.view.length === 0;
    return;
  }

  const frag = document.createDocumentFragment();

  for (const p of slice) {
    const node = tpl.content.cloneNode(true);
    const card = node.querySelector('.card');

    card.href = p.url;
    card.dataset.id = p.id;
    if (state.clicks[p.id]) card.classList.add('seen');

    const img = node.querySelector('img');
    // 첫 화면 카드까지 lazy로 미루면 LCP가 그만큼 늦어진다.
    if (state.shown === 0 && frag.childElementCount < 8) {
      img.loading = 'eager';
      img.fetchPriority = 'high';
    }
    img.src = p.image;
    img.alt = p.name;
    const ss = srcsetFor(p.image);
    if (ss) img.srcset = ss;
    // 깨진 썸네일이 회색 아이콘으로 남지 않도록 placeholder로 교체
    img.addEventListener('error', () => {
      img.style.display = 'none';
    }, { once: true });

    node.querySelector('.name').textContent = p.name;
    node.querySelector('.price').textContent = fmt(p.price);

    if (p.discountRate > 0) {
      const b = node.querySelector('.badge-discount');
      b.textContent = p.discountRate + '%';
      b.hidden = false;
    }
    if (p.basePrice > p.price) {
      const base = node.querySelector('.base');
      base.textContent = fmt(p.basePrice);
      base.hidden = false;
    }
    // 직전 수집분보다 실제로 내려간 경우에만
    if (p.priceDrop?.from > p.price) {
      const d = node.querySelector('.badge-drop');
      d.textContent = `↓ ${won.format(p.priceDrop.from - p.price)}원 내림`;
      d.hidden = false;
    }
    if (p.rocket) node.querySelector('.tag-rocket').hidden = false;
    if (p.freeShipping) node.querySelector('.tag-free').hidden = false;
    if (p.isNew) node.querySelector('.tag-new').hidden = false;

    frag.appendChild(node);
  }

  grid.appendChild(frag);
  state.shown += slice.length;

  if (state.shown >= state.view.length) $('#end').hidden = false;
}

function skeletons(n = 12) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'sk';
    d.innerHTML = '<div class="sk-thumb"></div><div class="sk-line"></div><div class="sk-line" style="width:60%"></div>';
    frag.appendChild(d);
  }
  grid.replaceChildren(frag);
}

/* ---------- 카테고리 칩 ---------- */
function buildChips() {
  const counts = new Map();
  for (const p of state.all) counts.set(p.category, (counts.get(p.category) || 0) + 1);

  const cats = ['전체', ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)];

  const box = $('#chips');
  box.replaceChildren();

  for (const c of cats) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.role = 'tab';
    b.dataset.cat = c;
    b.textContent = c === '전체' ? `전체 ${state.all.length}` : c;
    b.setAttribute('aria-selected', String(c === state.category));
    b.addEventListener('click', () => {
      state.category = c;
      box.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      applyFilters();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    box.appendChild(b);
  }

  // URL로 들어온 카테고리가 데이터에 없으면 조용히 전체로 되돌린다.
  if (!cats.includes(state.category)) state.category = '전체';
}

/* ---------- 이벤트 ---------- */
function initEvents() {
  const q = $('#q');
  const clear = $('#q-clear');

  q.addEventListener('input', debounce(() => {
    state.q = q.value;
    clear.hidden = !q.value;
    applyFilters();
  }, 180));

  clear.addEventListener('click', () => {
    q.value = '';
    state.q = '';
    clear.hidden = true;
    applyFilters();
    q.focus();
  });

  $('#rocket-only').addEventListener('change', (e) => {
    state.rocketOnly = e.target.checked;
    applyFilters();
  });

  $('#sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    applyFilters();
  });

  $('#reset').addEventListener('click', () => {
    state.q = '';
    state.category = '전체';
    state.rocketOnly = false;
    state.sort = 'recommended';
    syncUI();
    applyFilters();
  });

  // 카드 클릭 위임. preventDefault를 하지 않으므로 이동은 브라우저에 맡긴다.
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    recordClick(card.dataset.id);
    card.classList.add('seen');
    // GA4 등이 붙어 있으면 이벤트를 넘긴다. 없으면 아무 일도 일어나지 않는다.
    window.dataLayer?.push({
      event: 'select_item',
      item_id: card.dataset.id,
      item_name: card.querySelector('.name')?.textContent,
    });
  });

  // 키보드로 카드를 열 때(Enter)도 클릭과 동일하게 기록한다.
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const card = e.target.closest('.card');
    if (!card) return;
    recordClick(card.dataset.id);
    card.classList.add('seen');
  });

  $('#recent').addEventListener('click', (e) => {
    const a = e.target.closest('.rc');
    if (a) recordClick(a.dataset.id);
  });

  $('#recent-clear').addEventListener('click', () => {
    state.recent = [];
    writeJSON(RECENT_KEY, state.recent);
    renderRecent();
  });

  $('#share').addEventListener('click', async () => {
    const btn = $('#share');
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = '✓ 링크 복사됨';
    } catch {
      btn.textContent = '복사 실패 — 주소창을 복사하세요';
    }
    setTimeout(() => { btn.textContent = '🔗 이 목록 공유'; }, 2000);
  });

  // 뒤로/앞으로 가기
  addEventListener('popstate', () => {
    readURL();
    syncUI();
    applyFilters();
  });

  // 맨 위로
  const toTop = $('#totop');
  toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      toTop.hidden = scrollY < 600;
      ticking = false;
    });
  }, { passive: true });

  // "/" 로 검색창 포커스
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      q.focus();
      q.select();
    }
    if (e.key === 'Escape' && document.activeElement === q) q.blur();
  });

  initInfiniteScroll();
}

/* ---------- 무한 스크롤 ----------
 * IntersectionObserver를 주 경로로 쓰되 스크롤 이벤트를 폴백으로 둔다.
 * IO가 죽은 환경에서 24개 뒤 상품이 통째로 묻히는 것보다, 리스너 하나가 싸다.
 */
function initInfiniteScroll() {
  const sentinel = $('#sentinel');

  const needsMore = () => {
    if (state.shown >= state.view.length) return false;
    const r = sentinel.getBoundingClientRect();
    return r.top - window.innerHeight < 600;
  };

  let queued = false;
  const pump = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!needsMore()) return;
      const before = state.shown;
      renderMore();
      // 화면이 큰데 한 페이지로 안 채워지면 채워질 때까지 이어서 그린다.
      if (state.shown > before) pump();
    });
  };

  try {
    new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) pump();
    }, { rootMargin: '600px' }).observe(sentinel);
  } catch {
    // IO 미지원 → 아래 폴백만으로 동작
  }

  addEventListener('scroll', pump, { passive: true });
  addEventListener('resize', pump, { passive: true });

  state.pump = pump;
}

/* ---------- 시작 ---------- */
async function main() {
  initTheme();
  skeletons();

  let data;
  try {
    const res = await fetch('data/products.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`products.json ${res.status}`);
    data = await res.json();
  } catch (err) {
    grid.replaceChildren();
    $('#count').textContent = '';
    $('#empty').hidden = false;
    $('#empty').querySelector('.empty-title').textContent =
      '상품 데이터를 불러오지 못했습니다. node scripts/fetch-products.mjs 를 먼저 실행하세요.';
    console.error(err);
    return;
  }

  state.all = data.products || [];

  if (data.sample) {
    const n = $('#notice');
    n.textContent = '샘플 데이터로 표시 중입니다. 실제 상품/링크를 넣으려면 node scripts/fetch-products.mjs 를 실행하세요.';
    n.hidden = false;
  }

  if (data.generatedAt) {
    const d = new Date(data.generatedAt);
    if (!Number.isNaN(d.getTime())) {
      $('#stamp').textContent = ` · ${d.toLocaleString('ko-KR')} 기준`;
    }
  }

  readURL();      // 주소창의 필터를 먼저 반영해야
  buildChips();   // 칩이 선택 상태로 그려지고
  initEvents();
  syncUI();       // 위젯도 같은 상태로 맞춘 뒤
  applyFilters(); // 렌더한다
  renderRecent();
  injectJsonLd(state.all);
}

main();
