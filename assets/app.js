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
  onlyDrops: false,
  onlyGold: false,
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

/* ---------- 토스트 ---------- */
let toastTimer;
function toast(msg) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- 공유 (커뮤니티/SNS 나르기) ----------
 * 상품명·가격·가격내림·로켓 + 제휴 링크 + 필수 고지문을 한 번에 복사한다.
 * 고지문을 자동으로 넣어 파트너스 정책 위반(고지 누락)을 막는다.
 */
function shareText(p) {
  const lines = [p.name];
  let priceLine = `💰 ${fmt(p.price)}`;
  if (isDrop(p)) priceLine += `  (↓ ${won.format(p.priceDrop.from - p.price)}원 내림!)`;
  lines.push(priceLine);
  if (p.rocket) lines.push('🚀 로켓배송');
  lines.push('👉 ' + p.url);
  lines.push('');
  lines.push('※ 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.');
  return lines.join('\n');
}

async function shareProduct(p) {
  const text = shareText(p);
  // 모바일은 네이티브 공유(카톡 등)를, 데스크톱은 클립보드 복사를 쓴다.
  if (navigator.share && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ text });
      return;
    } catch {
      // 사용자가 취소하면 조용히 클립보드로 폴백
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('복사됐어요! 커뮤니티·채팅에 붙여넣기 하세요 📋');
  } catch {
    toast('복사가 막혔어요. 길게 눌러 직접 복사해 주세요.');
  }
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
  state.onlyDrops = p.get('drops') === '1';
  state.onlyGold = p.get('gold') === '1';
  state.sort = p.get('sort') || 'recommended';
}

function writeURL() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.category !== '전체') p.set('cat', state.category);
  if (state.rocketOnly) p.set('rocket', '1');
  if (state.onlyDrops) p.set('drops', '1');
  if (state.onlyGold) p.set('gold', '1');
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

/* ---------- 히어로 (베스트 특가) ----------
 * "왜 쿠팡 대신 여기?" 에 대한 답. 큰 할인·가격 인하를 첫 화면에서 바로 보여준다.
 */
const isDrop = (p) => p.priceDrop?.from > p.price;
const isGold = (p) => p.source === 'goldbox';

function scrollToGrid() {
  const nav = $('.filters');
  const y = (nav ? nav.getBoundingClientRect().top + scrollY : 0) - 56;
  scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

function renderStats(items) {
  // 쿠팡 API는 할인율/정가를 주지 않는다. 실제로 가진 신호만 쓴다:
  // 골드박스(쿠팡이 고른 특가) · 가격 내림(직접 추적) · 로켓배송.
  const gold = items.filter(isGold).length;
  const drops = items.filter(isDrop).length;
  const rocket = items.filter((p) => p.rocket).length;

  const tiles = [
    gold > 0 && { label: '골드박스 특가', num: `${won.format(gold)}개`, cls: 'gold', action: 'gold' },
    drops > 0 && { label: '방금 가격 내림', num: `${won.format(drops)}개`, cls: 'drop', action: 'drops' },
    { label: '🚀 로켓배송', num: `${won.format(rocket)}개`, action: 'rocket' },
    { label: '전체 상품', num: `${won.format(items.length)}개` },
  ].filter(Boolean);

  const box = $('#hero-stats');
  box.replaceChildren();
  for (const t of tiles) {
    const el = document.createElement(t.action ? 'button' : 'div');
    el.className = 'stat' + (t.action ? ' clickable' : '');
    if (t.action) {
      el.type = 'button';
      el.dataset.action = t.action;
    }
    const num = document.createElement('span');
    num.className = 'stat-num' + (t.cls ? ' ' + t.cls : '');
    num.textContent = t.num;
    const label = document.createElement('span');
    label.className = 'stat-label';
    label.textContent = t.label;
    el.append(num, label);

    if (t.action === 'gold') {
      el.addEventListener('click', () => { state.onlyGold = !state.onlyGold; syncUI(); applyFilters(); scrollToGrid(); });
    } else if (t.action === 'drops') {
      el.addEventListener('click', () => {
        state.onlyDrops = !state.onlyDrops;
        if (state.onlyDrops) state.sort = 'drop';
        syncUI();
        applyFilters();
        scrollToGrid();
      });
    } else if (t.action === 'rocket') {
      el.addEventListener('click', () => { state.rocketOnly = !state.rocketOnly; syncUI(); applyFilters(); scrollToGrid(); });
    }
    box.appendChild(el);
  }
  updateHeroActive();
}

function updateHeroActive() {
  $('#hero-stats')?.querySelectorAll('.stat[data-action]').forEach((el) => {
    const a = el.dataset.action;
    const on =
      (a === 'gold' && state.onlyGold) ||
      (a === 'drops' && state.onlyDrops) ||
      (a === 'rocket' && state.rocketOnly);
    el.classList.toggle('active', on);
  });
}

function renderSpotlight(items) {
  const wrap = $('#spotlight-wrap');
  const box = $('#spotlight');

  // 가격 내림을 최우선, 그다음 골드박스(쿠팡이 고른 특가, rank 낮을수록 상위). 이미지 없는 건 제외.
  const score = (p) =>
    (isDrop(p) ? 2000 + (p.priceDrop.pct || 0) : 0) +
    (isGold(p) ? 1000 - Math.min(p.rank || 999, 999) : 0);
  const picks = items
    .filter((p) => p.image && (isDrop(p) || isGold(p)))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 12);

  if (!picks.length) {
    wrap.hidden = true;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const p of picks) {
    const a = document.createElement('a');
    a.className = 'spot';
    a.href = p.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer sponsored';
    a.dataset.id = p.id;

    const thumb = document.createElement('div');
    thumb.className = 'spot-thumb';
    const img = document.createElement('img');
    img.src = p.image;
    img.alt = '';
    // 스포트라이트는 첫 화면(above the fold)이라 즉시 로드해 LCP를 앞당긴다.
    img.loading = 'eager';
    img.decoding = 'async';
    const ss = srcsetFor(p.image);
    if (ss) img.srcset = ss;
    img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });

    const badges = document.createElement('div');
    badges.className = 'spot-badges';
    if (isDrop(p)) {
      const d = document.createElement('span');
      d.className = 'spot-drop';
      d.textContent = `↓ ${won.format(p.priceDrop.from - p.price)}원`;
      badges.appendChild(d);
    }
    if (isGold(p)) {
      const g = document.createElement('span');
      g.className = 'spot-gold';
      g.textContent = '골드박스';
      badges.appendChild(g);
    }
    thumb.append(img, badges);

    const body = document.createElement('div');
    body.className = 'spot-body';
    const name = document.createElement('p');
    name.className = 'spot-name';
    name.textContent = p.name;
    const price = document.createElement('div');
    price.className = 'spot-price';
    const now = document.createElement('span');
    now.className = 'spot-now';
    now.textContent = fmt(p.price);
    price.appendChild(now);
    if (p.basePrice > p.price) {
      const was = document.createElement('span');
      was.className = 'spot-was';
      was.textContent = fmt(p.basePrice);
      price.appendChild(was);
    }
    body.append(name, price);

    a.append(thumb, body);
    frag.appendChild(a);
  }
  box.replaceChildren(frag);
  wrap.hidden = false;
}

function renderHero() {
  renderStats(state.all);
  renderSpotlight(state.all);
}

/* ---------- 필터 + 정렬 ---------- */
function applyFilters() {
  const q = state.q.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];

  let rows = state.all.filter((p) => {
    if (state.rocketOnly && !p.rocket) return false;
    if (state.onlyDrops && !isDrop(p)) return false;
    if (state.onlyGold && !isGold(p)) return false;
    if (state.category !== '전체' && p.category !== state.category) return false;
    if (terms.length) {
      const hay = (p.name + ' ' + p.category).toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  const dropAmt = (p) => (p.priceDrop?.from > p.price ? p.priceDrop.from - p.price : 0);

  const by = {
    // 가격 내림 > 골드박스 특가 > (샘플용 할인율) > API rank 순.
    // 쿠팡 API엔 할인율이 없으므로 실데이터에선 사실상 내림→골드박스→rank 다.
    recommended: (a, b) =>
      Math.sign(dropAmt(b)) - Math.sign(dropAmt(a)) ||
      (isGold(b) ? 1 : 0) - (isGold(a) ? 1 : 0) ||
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
  updateHeroActive();
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
    if (isGold(p)) node.querySelector('.badge-gold').hidden = false;
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
    state.onlyDrops = false;
    state.onlyGold = false;
    state.sort = 'recommended';
    syncUI();
    applyFilters();
  });

  // 스포트라이트 카드 클릭도 그리드 카드와 동일하게 기록
  $('#spotlight').addEventListener('click', (e) => {
    const a = e.target.closest('.spot');
    if (a) recordClick(a.dataset.id);
  });

  // 공유 버튼 (카드 이동보다 먼저 가로챈다)
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.share-btn');
    if (!btn) return;
    e.preventDefault();
    const card = btn.closest('.card-wrap')?.querySelector('.card');
    const p = card && state.byId?.get(card.dataset.id);
    if (p) shareProduct(p);
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
  state.byId = new Map(state.all.map((p) => [p.id, p]));

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
  renderHero();   // 히어로(통계·스포트라이트)를 채우고
  applyFilters(); // 그리드를 렌더한다
  renderRecent();
  injectJsonLd(state.all);
}

main();
