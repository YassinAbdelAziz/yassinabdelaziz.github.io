// ============ CONFIGURATION ============
const API_BASE = 'https://screenify-worker.yassinmovies.workers.dev/api/tmdb';
const IMG='https://image.tmdb.org/t/p/w780';
const IMG_SM='https://image.tmdb.org/t/p/w500';
const IMG_BG='https://image.tmdb.org/t/p/w1280';
const IMG_ORIG='https://image.tmdb.org/t/p/original';
const ACCENT='ff2e2e';
// Embeds are loaded directly from the source hosts (vidking.net / player.videasy.net)
// inside the player iframe with no proxy and no sandboxing, so the iframe src is the
// raw embed URL.
const SERVERS={
  vidking:{name:'Vidking',movie:(id)=>`https://www.vidking.net/embed/movie/${id}`,tv:(id,s,e)=>`https://www.vidking.net/embed/tv/${id}/${s}/${e}`},
  videasy:{name:'Videasy',movie:(id)=>`https://player.videasy.net/movie/${id}`,tv:(id,s,e)=>`https://player.videasy.net/tv/${id}/${s}/${e}`}
};
function getActiveServer(){return localStorage.getItem('screenify_server')||'videasy';}
function setActiveServer(key){localStorage.setItem('screenify_server',key);}
if(localStorage.getItem('screenify_server')==='vidking'&&!localStorage.getItem('screenify_server_chosen')){localStorage.removeItem('screenify_server');}

const state={
  movie:{page:1,totalPages:500,loading:false,selected:null},
  tv:{page:1,totalPages:500,loading:false,selected:null}
};
const searchPage={query:'',page:1,totalPages:1,loading:false,results:[],featured:null};
let searchRequestSeq=0;
let currentPage='home';
let previousPage='home';
let savedScroll={};
let sidebarCollapsed=false;
let nowPlayingEp={season:null,episode:null};

// ============ SANITIZE ============
function sanitize(str){const div=document.createElement('div');div.textContent=str;return div.innerHTML;}

// ============ SECURITY HELPERS ============
// Only trust postMessage events from the exact embed hosts we embed directly.
const ALLOWED_PLAYER_ORIGINS=new Set(['https://www.vidking.net','https://player.videasy.net']);
function isFiniteNum(n){return typeof n==='number'&&Number.isFinite(n)&&!isNaN(n);}
function clampInt(v,min,max,fallback){
  if(v==null||v==='')return fallback;
  const n=Number(v);
  if(!Number.isInteger(n))return fallback;
  return Math.min(max,Math.max(min,n));
}

// Best-effort adult-content filter (TMDB's `adult` flag plus unmistakable title tokens).
const ADULT_TITLE_BLOCK=/porn|hardcore|hentai|\bxxx\b|onlyfans/i;
function notAdult(item){
  if(!item)return true;
  if(item.adult===true)return false;
  const t=(item.title||item.name||'')+' '+(item.original_title||item.original_name||'');
  return !(t&&ADULT_TITLE_BLOCK.test(t));
}

// ============ RECENT SEARCHES ============
// Store up to 100 queries in persistent storage, but only ever surface the 5
// most recent in the UI. Deleting or clearing must not close the list.
const MAX_HISTORY=100;
const MAX_HISTORY_SHOWN=5;
function getSearchHistory(){
  try{
    const raw=localStorage.getItem('screenify_search_history');
    const arr=raw?JSON.parse(raw):[];
    if(!Array.isArray(arr))return[];
    const seen=new Set();
    const out=[];
    for(const q of arr){
      if(typeof q!=='string')continue;
      const t=q.trim();
      if(!t)continue;
      const key=t.toLowerCase();
      if(seen.has(key))continue;
      seen.add(key);
      out.push(t);
    }
    return out.slice(0,MAX_HISTORY);
  }catch{return[];}
}
function saveSearchHistory(list){
  try{localStorage.setItem('screenify_search_history',JSON.stringify(list.slice(0,MAX_HISTORY)));}catch(e){}
}
function addToSearchHistory(query){
  const q=(query||'').trim();
  if(!q)return;
  const list=getSearchHistory().filter(x=>x.toLowerCase()!==q.toLowerCase());
  list.unshift(q);
  saveSearchHistory(list);
  renderRecentSearches();
}
function removeQueryFromHistory(query){
  const q=(query||'').trim();
  saveSearchHistory(getSearchHistory().filter(x=>x.toLowerCase()!==q.toLowerCase()));
  renderRecentSearches();
}
function clearAllSearchHistory(){
  saveSearchHistory([]);
  renderRecentSearches();
}
function showClearHistoryModal(){
  const existing=document.getElementById('clearHistoryModal');
  if(existing)existing.remove();
  const backdrop=document.createElement('div');
  backdrop.className='cw-modal-backdrop';
  backdrop.id='clearHistoryModal';
  backdrop.innerHTML=`
    <div class="cw-modal">
      <div class="cw-modal-icon">🗑️</div>
      <div class="cw-modal-title">Clear all recent searches?</div>
      <div class="cw-modal-body">This removes your entire saved search history. This can't be undone.</div>
      <div class="cw-modal-btns">
        <button type="button" class="cw-modal-cancel">Cancel</button>
        <button type="button" class="cw-modal-confirm">Clear all</button>
      </div>
    </div>`;
  backdrop.querySelector('.cw-modal-cancel').addEventListener('click',()=>backdrop.remove());
  backdrop.querySelector('.cw-modal-confirm').addEventListener('click',()=>{backdrop.remove();clearAllSearchHistory();});
  backdrop.addEventListener('click',(e)=>{if(e.target===backdrop)backdrop.remove();});
  document.body.appendChild(backdrop);
}
function renderRecentSearches(){
  const el=document.getElementById('searchPageRecent');
  if(!el)return;
  const input=document.getElementById('searchInput');
  const all=getSearchHistory();
  const t=(input?input.value:'').trim().toLowerCase();
  let list=all.slice();
  let matched=null;
  if(t){
    const idx=list.findIndex(q=>q.trim().toLowerCase()===t);
    if(idx>=0)matched=list[idx];
    // Only promote a history entry to the top when the typed input matches
    // exactly one entry across the whole 100-item history. A plain 1:1 match
    // with the input is not enough on its own — the entry still has to be the
    // single matching result.
    const exactMatches=list.filter(q=>q.trim().toLowerCase().includes(t));
    if(exactMatches.length===1){
      const single=exactMatches[0];
      const at=list.indexOf(single);
      if(at>0){
        list.splice(at,1);
        list.unshift(single);
      }
    }
  }
  const shown=list.slice(0,MAX_HISTORY_SHOWN);
  el.innerHTML='';
  if(!shown.length){
    const empty=document.createElement('div');
    empty.className='recent-search-empty';
    empty.textContent='Your recent searches will appear here.';
    el.appendChild(empty);
    return;
  }
  const head=document.createElement('div');
  head.className='recent-search-head';
  const label=document.createElement('span');
  label.textContent='Recent searches';
  head.appendChild(label);
  const clearBtn=document.createElement('button');
  clearBtn.type='button';
  clearBtn.className='recent-search-clear';
  clearBtn.title='Clear all recent searches';
  clearBtn.setAttribute('aria-label','Clear all recent searches');
  clearBtn.textContent='Clear all';
  clearBtn.addEventListener('click',(ev)=>{ev.stopPropagation();showClearHistoryModal();});
  head.appendChild(clearBtn);
  el.appendChild(head);
  shown.forEach(q=>{
    const row=document.createElement('div');
    row.className='recent-search-row';
    row.setAttribute('role','button');row.setAttribute('tabindex','0');
    row.innerHTML='<span class="recent-search-icon"><i class="fa-solid fa-clock-rotate-left"></i></span><span class="recent-search-text"></span>'+(q===matched?'<span class="recent-search-match">Recent matching search</span>':'')+'<button type="button" class="recent-search-del" title="Remove from history" aria-label="Remove from history">&#10005;</button>';
    row.querySelector('.recent-search-text').textContent=q;
    const pick=()=>{if(input)input.value=q;performSearch(q);};
    row.addEventListener('click',pick);
    row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick();}});
    row.querySelector('.recent-search-del').addEventListener('click',(ev)=>{
      ev.stopPropagation();
      ev.preventDefault();
      removeQueryFromHistory(q);
    });
    el.appendChild(row);
  });
}
function openRecentPanel(){const el=document.getElementById('searchPageRecent');if(!el)return;el.classList.add('open');const wrap=el.parentElement;if(wrap)wrap.classList.add('open');}
function closeRecentPanel(){const el=document.getElementById('searchPageRecent');if(!el)return;el.classList.remove('open');const wrap=el.parentElement;if(wrap)wrap.classList.remove('open');}
function setupSearchEvents(){
  const input=document.getElementById('searchInput');
  if(!input)return;
  const hero=document.querySelector('.search-hero');
  input.addEventListener('input',()=>{renderRecentSearches();openRecentPanel();});
  input.addEventListener('focus',()=>{renderRecentSearches();openRecentPanel();});
  input.addEventListener('blur',(e)=>{
    const rt=e.relatedTarget;
    if(rt&&hero&&!hero.contains(rt))closeRecentPanel();
  });
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();closeRecentPanel();performSearch();}});
  const bar=document.querySelector('.search-page-bar');
  if(bar)bar.addEventListener('click',(e)=>{if(e.target.closest('button'))return;input.focus();});
  const btn=document.getElementById('searchBtn');
  if(btn)btn.addEventListener('click',()=>{closeRecentPanel();performSearch();});
  document.addEventListener('click',(e)=>{
    if(!hero)return;
    if(hero.contains(e.target))return;
    closeRecentPanel();
  });
}

// ============ SHORTCUT MODAL ============
function showShortcutModal(){
  const existing=document.getElementById('shortcutModal');
  if(existing)existing.remove();
  const backdrop=document.createElement('div');
  backdrop.className='shortcut-modal-backdrop';
  backdrop.id='shortcutModal';
  backdrop.innerHTML=`
    <div class="shortcut-modal">
      <h3>Keyboard Shortcuts</h3>
      <div class="shortcut-row"><span>Toggle Sidebar</span><div class="shortcut-keys"><span class="shortcut-key">M</span></div></div>
      <div class="shortcut-row"><span>Fullscreen Player</span><div class="shortcut-keys"><span class="shortcut-key">F</span></div></div>
      <div class="shortcut-row"><span>Go Back</span><div class="shortcut-keys"><span class="shortcut-key">Esc</span></div></div>
      <div class="shortcut-row"><span>Carousel</span><div class="shortcut-keys"><span class="shortcut-key">←</span><span class="shortcut-key">→</span></div></div>
      <button class="shortcut-modal-close">Close</button>
    </div>`;
  backdrop.querySelector('.shortcut-modal-close').addEventListener('click',()=>backdrop.remove());
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)backdrop.remove();});
  document.body.appendChild(backdrop);
}

// ============ TOAST SYSTEM ============
function showToast(message, type='') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ============ BACK TO TOP ============
function handleBackToTop() {
  const btn = document.getElementById('backToTop');
  const scrollY = window.scrollY || document.documentElement.scrollTop;
  if (scrollY > 400) {btn.classList.add('visible');} else {btn.classList.remove('visible');}
}
window.addEventListener('scroll', handleBackToTop, {passive:true});

// ============ SCROLL LOCK ============
// While the page is being scrolled, keep cards from lifting on hover so the
// grid stays visually stable under the cursor.
let scrollLockTimer=null;
function handleScrollLock() {
  document.body.classList.add('is-scrolling');
  clearTimeout(scrollLockTimer);
  scrollLockTimer=setTimeout(()=>document.body.classList.remove('is-scrolling'),120);
}
window.addEventListener('scroll', handleScrollLock, {passive:true});

// ============ API FETCH ============
async function fetchJSON(url){
  const urlObj=new URL(url);
  const path=urlObj.pathname.replace('/3/','');
  const params={};
  urlObj.searchParams.forEach((v,k)=>{if(k!=='api_key')params[k]=v;});
  const qs=new URLSearchParams(params).toString();
  const apiUrl=`${API_BASE}/${path}${qs?'?'+qs:''}`;
  const r=await fetch(apiUrl);
  if(!r.ok)throw new Error('Request failed: '+r.status);
  return r.json();
}

// ============ CACHED TRENDING DATA ============
// Homepage rows and the hero carousel both need trending data. Fetching once
// and sharing the promise keeps a single request for each endpoint.
const trendingCache={movie:null,tv:null};
const trendingPromises={movie:null,tv:null};
function getTrending(tmdbType){
  if(trendingCache[tmdbType])return Promise.resolve(trendingCache[tmdbType]);
  if(!trendingPromises[tmdbType]){
    trendingPromises[tmdbType]=fetchJSON(`https://api.themoviedb.org/3/trending/${tmdbType}/week?api_key=x&page=1`)
      .then(data=>{trendingCache[tmdbType]=data;return data;})
      .catch(err=>{trendingPromises[tmdbType]=null;throw err;});
  }
  return trendingPromises[tmdbType];
}

// ============ HERO CAROUSEL TITLE EXCLUSION ============
// The homepage content rows must not repeat titles that are already featured
// in the hero carousel. The carousel picks its slides from the same cached
// trending data, so we publish the chosen ids once they are known and let the
// rows filter them out before rendering.
let heroChosenIds=new Set();
let heroChosenResolve=null;
const heroChosenReady=new Promise(r=>{heroChosenResolve=r;});
function publishHeroChosen(ids){
  heroChosenIds=new Set(ids||[]);
  if(heroChosenResolve){heroChosenResolve();heroChosenResolve=null;}
}

// ============ CACHED TV DETAILS FOR HOVER ============
const tvDetailsCache={};
async function getTVDetails(id){
  if(tvDetailsCache[id])return tvDetailsCache[id];
  try{
    const data=await fetchJSON(`https://api.themoviedb.org/3/tv/${id}?api_key=x`);
    const info={seasons:data.number_of_seasons||0,episodes:data.number_of_episodes||0};
    tvDetailsCache[id]=info;
    return info;
  }catch{return{seasons:0,episodes:0};}
}

// ============ AGE RATINGS ============
// Resolves a displayable age rating (certification) for movies and TV shows,
// plus an optional human-readable reason (descriptors/advisory) that powers the
// (i) info button. Country preference favours US, then other English-language
// markets, falling back to whichever country has data.
const ratingCache={};
// Ratings are always surfaced in numeric form (e.g. "3+", "7+", "13+", "17+",
// "18+"). Letter-based certifications are mapped to their closest numeric age;
// certifications that are already numeric keep their number.
const AGE_RATING_MAP={
  'g':'3+','u':'3+','uall':'3+','all':'3+','allages':'3+','universal':'3+','general':'3+','tvy':'3+','tvg':'3+','0':'0+','0+':'0+',
  'pg':'7+','tvy7':'7+','tvy7fv':'7+','7a':'7+','7ap':'7+','7a7ap':'7+','6':'6+','6+':'6+','7':'7+','7+':'7+',
  'pg13':'13+','tv14':'13+','12':'12+','12a':'12+','12+':'12+','13':'13+','13+':'13+','14':'14+','14+':'14+','vm14':'14+','dgf':'14+',
  'r':'17+','tvma':'17+','15':'15+','15a':'15+','15+':'15+','16':'16+','16+':'16+','17':'17+','17+':'17+','m':'15+','ma15':'17+','ma15+':'17+',
  'nc17':'18+','x':'18+','ao':'18+','18':'18+','18+':'18+','18a':'18+','18r':'18+','r18':'18+','r18+':'18+'
};
function toNumericAgeRating(label){
  if(!label)return label;
  const key=String(label).trim().toLowerCase().replace(/[^a-z0-9+]/g,'');
  return AGE_RATING_MAP[key]||label;
}
function resolveMovieCert(data){
  const results=data.results||[];
  const preferred=['US','GB','CA','AU','IE','NZ','FR','DE','ES','IT','NL','SE','NO','DK','MX','BR','IN'];
  const pick=rds=>{
    const valid=(rds||[]).filter(d=>d&&d.certification);
    if(!valid.length)return null;
    const rank=d=>{
      const t=d.type==null?6:d.type;
      if(t===3)return 0;if(t===2)return 1;if(t===4)return 2;if(t===5)return 3;return 4;
    };
    valid.sort((a,b)=>rank(a)-rank(b));
    return valid[0];
  };
  for(const iso of preferred){
    const r=results.find(x=>x.iso_3166_1===iso);
    if(!r)continue;
    const rd=pick(r.release_dates);
    if(!rd)continue;
    const reason=[...(rd.descriptors||[]).filter(Boolean)].join(', ')||(rd.advisory||'').trim()||'';
    return{label:rd.certification,reason};
  }
  for(const r of results){
    const rd=pick(r.release_dates);
    if(rd){
      const reason=[...(rd.descriptors||[]).filter(Boolean)].join(', ')||(rd.advisory||'').trim()||'';
      return{label:rd.certification,reason};
    }
  }
  return null;
}
function resolveTvCert(data){
  const results=data.results||[];
  const preferred=['US','GB','CA','AU','IE','NZ','FR','DE'];
  for(const iso of preferred){
    const r=results.find(x=>x.iso_3166_1===iso);
    if(!r||!r.rating)continue;
    const reason=[...(r.descriptors||[]).filter(Boolean)].join(', ')||'';
    return{label:r.rating,reason};
  }
  for(const r of results){
    if(r&&r.rating){
      const reason=[...(r.descriptors||[]).filter(Boolean)].join(', ')||'';
      return{label:r.rating,reason};
    }
  }
  return null;
}
function getAgeRating(item,type){
  const t=type||item._homeType||'movie';
  const id=item&&item.id;
  if(id==null)return Promise.resolve(null);
  const key=t+':'+id;
  if(ratingCache[key])return Promise.resolve(ratingCache[key]);
  const url=t==='movie'
    ?`https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=x`
    :`https://api.themoviedb.org/3/tv/${id}/content_ratings?api_key=x`;
  const p=(t==='movie'?fetchJSON(url).then(resolveMovieCert):fetchJSON(url).then(resolveTvCert))
    .then(cert=>{ratingCache[key]=cert||null;return cert||null;})
    .catch(()=>{ratingCache[key]=null;return null;});
  return p;
}
let ratingSeq=0;
const ratingReasons=new Map();
function ratingInfoHtml(cert,extra){
  if(!cert||!cert.label)return '';
  const cls=extra?' cert-'+extra:'';
  const label=toNumericAgeRating(cert.label);
  const reason=(cert.reason||'').trim();
  if(!reason)return`<span class="cert-badge${cls}">${sanitize(label)}</span>`;
  const rid=++ratingSeq;
  ratingReasons.set(rid,{label,reason});
  return`<span class="cert-badge${cls}">${sanitize(label)}<button type="button" class="rating-info-btn" data-rid="${rid}" aria-label="Why is this ${sanitize(label)}?" title="Why is this ${sanitize(label)}?"><i class="fa-solid fa-circle-info"></i></button></span>`;
}
let ratingPopEl=null;
function showRatingPopover(btn){
  closeRatingPopover();
  const rid=btn?Number(btn.dataset.rid):0;
  const info=ratingReasons.get(rid);
  if(!info||!info.reason)return;
  const pop=document.createElement('div');
  pop.className='rating-pop';
  const head=document.createElement('div');
  head.className='rating-pop-head';
  head.textContent=info.label;
  const body=document.createElement('div');
  body.className='rating-pop-body';
  body.textContent=info.reason;
  pop.appendChild(head);
  pop.appendChild(body);
  document.body.appendChild(pop);
  const r=btn.getBoundingClientRect();
  const pr=pop.getBoundingClientRect();
  const gap=10;
  let top=r.bottom+gap;
  let left=r.left-((pr.width-r.width)/2);
  const vw=window.innerWidth,vh=window.innerHeight;
  if(top+pr.height>vh-8)top=r.top-pr.height-gap;
  if(top<8)top=8;
  left=Math.min(Math.max(8,left),vw-pr.width-8);
  pop.style.top=top+'px';
  pop.style.left=left+'px';
  pop.classList.add('show');
  ratingPopEl=pop;
  const onDoc=(e)=>{
    if(e.type!=='click'){closeRatingPopover();return;}
    if(e.target&&e.target.closest&&e.target.closest('.rating-pop'))return;
    if(e.target&&e.target.closest&&e.target.closest('.rating-info-btn'))return;
    closeRatingPopover();
  };
  const onKey=(e)=>{if(e.key==='Escape')closeRatingPopover();};
  document.addEventListener('click',onDoc);
  document.addEventListener('scroll',onDoc,{passive:true});
  window.addEventListener('resize',onDoc);
  document.addEventListener('keydown',onKey);
  pop._cleanup=()=>{
    document.removeEventListener('click',onDoc);
    document.removeEventListener('scroll',onDoc);
    window.removeEventListener('resize',onDoc);
    document.removeEventListener('keydown',onKey);
  };
}
function closeRatingPopover(){
  if(ratingPopEl){
    if(ratingPopEl._cleanup)ratingPopEl._cleanup();
    ratingPopEl.remove();
    ratingPopEl=null;
  }
}
document.addEventListener('click',(e)=>{
  const btn=e.target&&e.target.closest?e.target.closest('.rating-info-btn'):null;
  if(btn){
    e.preventDefault();
    e.stopPropagation();
    showRatingPopover(btn);
    return;
  }
  if(ratingPopEl)closeRatingPopover();
},true);

function toggleSidebar(){
  sidebarCollapsed=!sidebarCollapsed;
  const sb=document.getElementById('sidebar');
  const btn=document.getElementById('sidebarToggleBtn');
  sb.classList.toggle('collapsed',sidebarCollapsed);
  document.body.classList.toggle('sidebar-collapsed',sidebarCollapsed);
  btn.innerHTML=sidebarCollapsed?'<i class="fa-solid fa-chevron-right"></i>':'<i class="fa-solid fa-chevron-left"></i>';
  btn.title=sidebarCollapsed?'Expand sidebar':'Collapse sidebar';
}

function switchPage(page){
  if(page!==currentPage)savedScroll[currentPage]=window.pageYOffset||document.documentElement.scrollTop||0;
  document.querySelectorAll('.page').forEach(p=>{p.classList.remove('active');p.style.display='none';});
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pageEl=document.getElementById('page-'+page);
  pageEl.classList.add('active');
  pageEl.style.display='flex';
  pageEl.offsetHeight;
  pageEl.style.opacity='1';pageEl.style.transform='translateY(0)';
  const navEl=document.getElementById('nav-'+page);
  if(navEl)navEl.classList.add('active');
  if(currentPage!=='player')previousPage=currentPage;
  currentPage=page;
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mobOverlay').classList.remove('open');
  const pageTitles={home:'',search:'Search',movies:'Movies',tv:'TV Shows',continue:'Continue',watchlist:'Watchlist',player:''};
  document.getElementById('mobPageTitle').textContent=pageTitles[page]||'';
  if(page!=='player'){const pf=document.getElementById('playerFrame');if(pf){pf.removeAttribute('src');pf.onload=null;pf.style.opacity='';}const mlt=document.getElementById('moreLikeThisSection');if(mlt)mlt.style.display='none';}
  if(page==='search'){
    renderRecentSearches();
    const inp=document.getElementById('searchInput');
    if(searchPage.query)setSearchHash(searchPage.query);
    if(inp&&!searchPage.query&&window.innerWidth>768)setTimeout(()=>inp.focus(),60);
  }
  if(page!=='search'&&(location.hash||'').indexOf('#search')===0)clearSearchHash();
  if(page==='movies'&&!document.getElementById('movieGrid').children.length)loadPage('movie',1);
  if(page==='tv'&&!document.getElementById('tvGrid').children.length)loadPage('tv',1);
  if(page==='watchlist')renderWatchlistPage();
  if(page==='continue')renderContinuePage();
  if(page==='home'){renderHomeContinue();}
  if(page==='player'){window.scrollTo(0,0);}
  else{const pos=savedScroll[page];window.scrollTo(0,pos!=null?pos:0);}
  handleBackToTop();
  if(page==='home')heroCarousel.startTimer();else heroCarousel.stopTimer();
}

function goBack(){switchPage(previousPage);}

function toggleMobMenu(){
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('mobOverlay').classList.toggle('open');
}

function renderSkeletons(containerId,count){
  const el=document.getElementById(containerId);
  el.innerHTML='';
  for(let i=0;i<count;i++){
    const sk=document.createElement('div');
    sk.className='skeleton-card';
    sk.innerHTML='<div class="skeleton-img"></div><div class="skeleton-info"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>';
    el.appendChild(sk);
  }
}

function renderSkeletonGrid(el,count){
  const n=count||((window.innerWidth<=768?3:7)*2);
  el.innerHTML='';
  for(let i=0;i<n;i++){
    const sk=document.createElement('div');
    sk.className='skeleton-card';
    sk.innerHTML='<div class="skeleton-img"></div><div class="skeleton-info"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>';
    el.appendChild(sk);
  }
}

async function loadHomeTrendingRow(tmdbType,containerId){
  renderSkeletons(containerId,14);
  const appType=tmdbType==='movie'?'movie':'tv';
  try{
    await heroChosenReady;
    const data=await getTrending(tmdbType);
    const items=(data.results||[]).filter(notAdult).filter(x=>!heroChosenIds.has(x.id)).slice(0,14);
    const el=document.getElementById(containerId);
    el.innerHTML='';
    items.forEach(item=>{
      const card=makeCard(item,appType,{showWl:true});
      card.style.flex='0 0 calc((100% - 6*14px)/7)';
      card.style.minWidth='110px';
      card.style.scrollSnapAlign='start';
      el.appendChild(card);
    });
    refreshRowNavFor(el);
  }catch(e){
    const el=document.getElementById(containerId);
    if(el)el.innerHTML='<div style="color:var(--muted);font-size:0.8rem;padding:1rem;">Failed to load.</div>';
  }
}

// ============ SCROLLABLE ROW NAVIGATION ============
// Left/right arrow controls for the horizontally scrollable card rows on the
// homepage, mirroring the hero carousel's navigation behaviour.
function initRowNav(){
  document.querySelectorAll('.scroll-row-wrap').forEach(wrap=>{
    const row=wrap.querySelector('.scroll-row');
    const prev=wrap.querySelector('.row-nav-prev');
    const next=wrap.querySelector('.row-nav-next');
    if(!row||!prev||!next)return;
    prev.addEventListener('click',e=>{e.preventDefault();scrollRowBy(row,-1);});
    next.addEventListener('click',e=>{e.preventDefault();scrollRowBy(row,1);});
    row.addEventListener('scroll',()=>updateRowNav(row,prev,next),{passive:true});
    updateRowNav(row,prev,next);
  });
}
function scrollRowBy(row,dir){
  if(!row)return;
  row.scrollBy({left:dir*Math.max(1,row.clientWidth),behavior:'smooth'});
}
function updateRowNav(row,prev,next){
  if(!row)return;
  const pos=row.scrollLeft;
  const max=row.scrollWidth-row.clientWidth;
  if(prev)prev.classList.toggle('disabled',pos<=1);
  if(next)next.classList.toggle('disabled',max-pos<=1);
}
function refreshRowNavFor(row){
  if(!row)return;
  const wrap=row.closest('.scroll-row-wrap');
  if(!wrap)return;
  updateRowNav(row,wrap.querySelector('.row-nav-prev'),wrap.querySelector('.row-nav-next'));
}

// ============ HERO FEATURED CAROUSEL ============
// A cinematic, auto-rotating featured carousel that showcases the most
// relevant trending movies and TV shows. Reuses the trending cache and the
// shared detail cache so it never issues duplicate requests. Rotation pauses
// on hover, touch, page-hide and reduced-motion; all timers are cleaned up so
// nothing leaks when the user leaves the homepage.
const heroCarousel={
  INTERVAL:6500,
  slides:[],
  index:0,
  timer:null,
  hovered:false,
  reducedMotion:false,
  touch:null,
  els:{},
  init(){
    this.els.carousel=document.getElementById('heroCarousel');
    if(!this.els.carousel)return;
    this.els.slides=document.getElementById('heroSlides');
    this.els.dots=document.getElementById('heroDots');
    this.els.prev=document.getElementById('heroPrevBtn');
    this.els.next=document.getElementById('heroNextBtn');
    this.reducedMotion=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.els.prev.addEventListener('click',()=>this.goto(this.index-1,'prev'));
    this.els.next.addEventListener('click',()=>this.goto(this.index+1,'next'));
    this.els.carousel.addEventListener('mouseenter',()=>{this.hovered=true;this.stopTimer();});
    this.els.carousel.addEventListener('mouseleave',()=>{this.hovered=false;this.startTimer();});
    this.els.carousel.addEventListener('touchstart',e=>this.onTouchStart(e),{passive:true});
    this.els.carousel.addEventListener('touchmove',e=>this.onTouchMove(e),{passive:false});
    this.els.carousel.addEventListener('touchend',e=>this.onTouchEnd(e),{passive:true});
    this.els.carousel.addEventListener('touchcancel',()=>this.onTouchCancel(),{passive:true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stopTimer();else this.startTimer();});
    document.addEventListener('keydown',e=>this.onKey(e));
    this.els.slides.addEventListener('click',e=>this.onSlideClick(e));
  },
  onTouchStart(e){
    const t=e.touches[0];
    if(!t)return;
    this.touch={startX:t.clientX,startY:t.clientY,dx:0,dy:0,axis:null,lastX:t.clientX,lastT:performance.now(),vx:0};
    this.stopTimer();
  },
  onTouchMove(e){
    if(!this.touch)return;
    const t=e.touches[0];
    if(!t)return;
    const dx=t.clientX-this.touch.startX;
    const dy=t.clientY-this.touch.startY;
    if(this.touch.axis===null){
      if(Math.abs(dx)<8&&Math.abs(dy)<8)return;
      this.touch.axis=Math.abs(dx)>Math.abs(dy)?'x':'y';
    }
    if(this.touch.axis!=='x')return;
    if(e.cancelable)e.preventDefault();
    const now=performance.now();
    const dt=now-this.touch.lastT;
    if(dt>0)this.touch.vx=(t.clientX-this.touch.lastX)/dt;
    this.touch.lastX=t.clientX;
    this.touch.lastT=now;
    this.touch.dx=dx;
    this.dragTo(dx);
  },
  onTouchEnd(e){
    if(!this.touch)return;
    const t=e.changedTouches[0];
    const dx=t?t.clientX-this.touch.startX:this.touch.dx;
    const vx=this.touch.vx||0;
    const width=this.els.carousel.clientWidth||1;
    const threshold=Math.max(40,width*0.18);
    const enough=Math.abs(dx)>=threshold;
    const flicked=Math.abs(vx)>0.5;
    if(this.touch.axis==='x'&&(enough||flicked)){
      const forward=dx<0?true:dx>0?false:vx<0;
      this.commitTouch(this.index+(forward?1:-1),forward?'next':'prev');
    }else{
      this.snapBack();
    }
    this.touch=null;
  },
  onTouchCancel(){
    if(!this.touch)return;
    this.snapBack();
    this.touch=null;
  },
  dragTo(dx){
    const wrap=this.els.slides;
    wrap.classList.add('dragging');
    const total=this.slides.length;
    if(!total)return;
    const i=this.index;
    const prev=(i-1+total)%total;
    const next=(i+1)%total;
    const w=this.els.carousel.clientWidth||1;
    const incoming=dx<0?next:prev;
    const far=dx<0?prev:next;
    this.slides.forEach((s,idx)=>{
      const el=s.el;
      el.classList.remove('from-right','from-left','to-right','to-left');
      if(idx===i){
        el.classList.add('active');
        el.style.transition='none';
        el.style.visibility='visible';
        el.style.opacity='1';
        el.style.transform=`translateX(${dx}px)`;
      }else if(idx===incoming){
        el.classList.remove('active');
        el.style.transition='none';
        el.style.visibility='visible';
        el.style.opacity='1';
        el.style.transform=`translateX(${dx+(idx===next?1:-1)*w}px)`;
      }else if(idx===far){
        el.classList.remove('active');
        el.style.visibility='hidden';
        el.style.transform='';
        el.style.opacity='';
        el.style.transition='';
      }else{
        el.classList.remove('active');
        el.style.visibility='hidden';
        el.style.transform='';
        el.style.opacity='';
        el.style.transition='';
      }
    });
  },
  commitTouch(targetIndex,dir){
    const total=this.slides.length;
    if(!total)return;
    targetIndex=((targetIndex%total)+total)%total;
    if(this.reducedMotion){
      this.index=targetIndex;
      this.goto(targetIndex);
      return;
    }
    const wrap=this.els.slides;
    wrap.classList.remove('dragging');
    const w=this.els.carousel.clientWidth||1;
    const oldEl=this.slides[this.index].el;
    const newEl=this.slides[targetIndex].el;
    const sign=dir==='next'?-1:1;
    const ease='transform 0.42s cubic-bezier(0.32,0.72,0.33,1),opacity 0.42s ease';
    oldEl.style.transition=ease;
    oldEl.style.transform=`translateX(${sign*w}px)`;
    oldEl.style.opacity='0';
    newEl.style.transition=ease;
    newEl.style.transform='translateX(0)';
    newEl.style.opacity='1';
    newEl.style.visibility='visible';
    oldEl.classList.remove('active');
    newEl.classList.add('active');
    this.slides.forEach((s,idx)=>{
      if(idx!==this.index&&idx!==targetIndex){s.el.style.visibility='hidden';s.el.style.transform='';s.el.style.opacity='';s.el.style.transition='';}
    });
    this.index=targetIndex;
    this.updateDots();
    this.preload(targetIndex);
    this.fillDetails(this.slides[targetIndex]);
    if(this._releaseCleanup)clearTimeout(this._releaseCleanup);
    this._releaseCleanup=setTimeout(()=>{
      this._releaseCleanup=null;
      this.goto(targetIndex);
    },440);
  },
  snapBack(){
    const total=this.slides.length;
    if(!total)return;
    const wrap=this.els.slides;
    wrap.classList.remove('dragging');
    if(this.reducedMotion){this.goto(this.index);return;}
    const current=this.slides[this.index];
    const ease='transform 0.35s cubic-bezier(0.32,0.72,0.33,1),opacity 0.35s ease';
    current.el.style.transition=ease;
    current.el.style.transform='translateX(0)';
    current.el.style.opacity='1';
    current.el.style.visibility='visible';
    if(this._releaseCleanup)clearTimeout(this._releaseCleanup);
    this._releaseCleanup=setTimeout(()=>{
      this._releaseCleanup=null;
      this.goto(this.index);
    },360);
  },
  clearDragState(){
    const wrap=this.els.slides;
    if(wrap)wrap.classList.remove('dragging');
    if(this._releaseCleanup){clearTimeout(this._releaseCleanup);this._releaseCleanup=null;}
    this.slides.forEach(s=>{
      const el=s.el;
      if(!el)return;
      el.style.transition='';
      el.style.transform='';
      el.style.opacity='';
      el.style.visibility='';
    });
  },
  onKey(e){
    if(currentPage!=='home')return;
    if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
    const t=e.target;
    if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'))return;
    if(t&&t.classList&&(t.classList.contains('card')||t.classList.contains('recent-search-row')))return;
    e.preventDefault();
    this.goto(this.index+(e.key==='ArrowRight'?1:-1),e.key==='ArrowRight'?'next':'prev');
  },
  onSlideClick(e){
    const wlBtn=e.target.closest('.hero-wl');
    if(wlBtn){
      const s=this.slideFromEl(wlBtn);
      if(!s)return;
      const wasIn=isInWatchlist(s.item.id);
      toggleWatchlistItem({...s.item,type:s.type});
      showToast(wasIn?'Removed from Watchlist':'Added to Watchlist',wasIn?'wl-removed':'wl-added');
      return;
    }
    const playBtn=e.target.closest('.hero-play');
    if(playBtn){
      const s=this.slideFromEl(playBtn);
      if(s)selectItem({...s.item,_homeType:s.type},s.type,null);
    }
  },
  slideFromEl(btn){
    const slide=btn.closest('.hero-slide');
    const idx=[].indexOf.call(this.els.slides.children,slide);
    return idx>=0?this.slides[idx]:null;
  },
  async load(){
    if(!this.els.carousel){publishHeroChosen([]);return;}
    let data;
    try{
      data=await Promise.all([getTrending('movie'),getTrending('tv')]);
    }catch(e){
      this.els.carousel.style.display='none';
      publishHeroChosen([]);
      return;
    }
    const movieData=data[0],showData=data[1];
    const movies=(movieData.results||[]).filter(x=>notAdult(x)&&(x.backdrop_path||x.poster_path)&&(x.overview||'').trim()).slice(0,6);
    const shows=(showData.results||[]).filter(x=>notAdult(x)&&(x.backdrop_path||x.poster_path)&&(x.overview||'').trim()).slice(0,6);
    const inter=[];
    const len=Math.max(movies.length,shows.length);
    for(let i=0;i<len;i++){if(i<movies.length)inter.push({item:movies[i],type:'movie'});if(i<shows.length)inter.push({item:shows[i],type:'tv'});}
    const chosen=inter.slice(0,8);
    if(!chosen.length){this.els.carousel.style.display='none';publishHeroChosen([]);return;}
    publishHeroChosen(chosen.map(x=>x.item.id));
    this.slides=chosen.map(({item,type})=>({
      item,type,
      title:item.title||item.name||'',
      year:(item.release_date||item.first_air_date||item.year||'').slice(0,4),
      rating:Number(item.vote_average)||0,
      overview:item.overview||'',
      genres:[],runtime:null,seasons:null,
      backdrop:item.backdrop_path?IMG_BG+item.backdrop_path:null,
      poster:item.poster_path?IMG+item.poster_path:null,
      el:null
    }));
    this.render();
    this.goto(0);
    this.startTimer();
  },
  render(){
    const wrap=this.els.slides;
    wrap.innerHTML='';
    this.slides.forEach((s,i)=>{
      const slide=document.createElement('div');
      slide.className='hero-slide';
      slide.setAttribute('role','group');
      slide.setAttribute('aria-roledescription','slide');
      slide.setAttribute('aria-label','Slide '+(i+1)+' of '+this.slides.length);
      slide.setAttribute('aria-hidden','true');
      slide.innerHTML=this.slideHtml(s);
      s.el=slide;
      wrap.appendChild(slide);
    });
    this.renderDots();
    this.preload(0);
  },
  slideHtml(s){
    const typeLabel=s.type==='movie'?'Movie':'TV Show';
    const bits=[];
    if(s.year)bits.push(`<span>${sanitize(s.year)}</span>`);
    if(s.rating>0)bits.push(`<span class="hero-rating"><i class="fa-solid fa-star"></i> ${s.rating.toFixed(1)}</span>`);
    if(s.type==='movie'&&s.runtime)bits.push(`<span>${s.runtime} min</span>`);
    if(s.type==='tv'&&s.seasons)bits.push(`<span>${s.seasons} Season${s.seasons>1?'s':''}</span>`);
    const metaHtml=bits.length?`<div class="hero-meta">${bits.join('<span class="hero-meta-sep">&bull;</span>')}</div>`:'';
    const img=s.backdrop||s.poster;
    const inList=isInWatchlist(s.item.id);
    return `
      <div class="hero-slide-bg" style="background-image:url('${img}')"></div>
      <div class="hero-shade"></div>
      <div class="hero-slide-content">
        <div class="hero-info">
          <span class="featured-type">${typeLabel}</span>
          <h2 class="hero-title">${sanitize(s.title)}</h2>
          ${metaHtml}
          <div class="hero-genres"></div>
          <p class="hero-overview">${sanitize(s.overview)}</p>
        </div>
        <div class="hero-actions">
          <button type="button" class="featured-play hero-play"><i class="fa-solid fa-play"></i> Watch Now</button>
          <button type="button" class="wl-btn hero-wl ${inList?'in-list':''}" data-wl-id="${s.item.id}"><span class="wl-icon"></span> ${inList?'In Watchlist':'Add to Watchlist'}</button>
        </div>
      </div>`;
  },
  renderDots(){
    const dots=this.els.dots;
    dots.innerHTML='';
    this.slides.forEach((s,i)=>{
      const dot=document.createElement('button');
      dot.type='button';
      dot.className='hero-dot'+(i===this.index?' active':'');
      dot.setAttribute('role','tab');
      dot.setAttribute('aria-selected',String(i===this.index));
      dot.setAttribute('aria-label','Go to slide '+(i+1));
      dot.addEventListener('click',()=>this.goto(i));
      dots.appendChild(dot);
    });
  },
  updateDots(){
    const dots=this.els.dots.querySelectorAll('.hero-dot');
    dots.forEach((d,i)=>{const on=i===this.index;d.classList.toggle('active',on);d.setAttribute('aria-selected',String(on));});
  },
  pickDirection(from,to){
    const total=this.slides.length;
    const forward=(to-from+total)%total;
    const backward=(from-to+total)%total;
    return forward<=backward?'next':'prev';
  },
  goto(i,dir){
    const total=this.slides.length;
    if(!total)return;
    this.clearDragState();
    const prevIndex=this.index;
    i=((i%total)+total)%total;
    const changed=i!==prevIndex;
    this.els.slides.querySelectorAll('.from-right,.from-left,.to-left,.to-right').forEach(s=>s.classList.remove('from-right','from-left','to-left','to-right'));
    if(this._transitionCleanup){clearTimeout(this._transitionCleanup);this._transitionCleanup=null;}
    const direction=changed?(dir||this.pickDirection(prevIndex,i)):null;
    this.index=i;
    if(changed&&direction&&!this.reducedMotion){
      const enterCls=direction==='next'?'from-right':'from-left';
      const leaveCls=direction==='next'?'to-left':'to-right';
      const prevEl=this.slides[prevIndex].el;
      const newEl=this.slides[i].el;
      this.slides.forEach((s,idx)=>{
        if(idx!==i&&idx!==prevIndex){s.el.classList.remove('active');s.el.setAttribute('aria-hidden','true');}
      });
      prevEl.classList.remove('active');
      prevEl.classList.add(leaveCls);
      prevEl.setAttribute('aria-hidden','true');
      newEl.classList.add(enterCls);
      newEl.setAttribute('aria-hidden','false');
      void newEl.offsetHeight;
      newEl.classList.add('active');
      this._transitionCleanup=setTimeout(()=>{
        this.els.slides.querySelectorAll('.from-right,.from-left,.to-left,.to-right').forEach(s=>s.classList.remove('from-right','from-left','to-left','to-right'));
        this._transitionCleanup=null;
      },780);
    }else{
      this.slides.forEach((s,idx)=>{
        const on=idx===i;
        s.el.classList.toggle('active',on);
        s.el.setAttribute('aria-hidden',String(!on));
      });
    }
    this.updateDots();
    this.preload(i);
    this.fillDetails(this.slides[i]);
    this.restartTimer();
  },
  preload(i){
    const total=this.slides.length;
    for(let k=1;k<=2;k++){
      const s=this.slides[(i+k)%total];
      if(!s||s._preloaded)continue;
      const url=s.backdrop||s.poster;
      if(!url)continue;
      s._preloaded=true;
      const im=new Image();
      im.src=url;
    }
  },
  async fillDetails(s){
    if(!s||s._detailsLoaded||s._detailsLoading)return;
    s._detailsLoading=true;
    let details=null;
    try{details=await loadFeaturedDetails(s.item,s.type);}catch(e){details=null;}
    s._detailsLoading=false;
    if(details){
      s._detailsLoaded=true;
      if(!s.genres.length&&Array.isArray(details.genres))s.genres=details.genres.map(g=>g&&g.name?g.name:'').filter(Boolean);
      if(s.type==='movie'&&details.runtime)s.runtime=details.runtime;
      if(s.type==='tv'&&details.number_of_seasons)s.seasons=details.number_of_seasons;
      if(!s.backdrop&&details.backdrop_path)s.backdrop=IMG_BG+details.backdrop_path;
      if(!s.overview&&details.overview)s.overview=details.overview;
      this.renderInfo(s);
    }
    getAgeRating(s.item,s.type).then(cert=>{
      if(!cert||!cert.label)return;
      s.cert=cert;
      this.renderInfo(s);
    });
  },
  renderInfo(s){
    const el=s.el;
    if(!el)return;
    const bits=[];
    if(s.year)bits.push(`<span>${sanitize(s.year)}</span>`);
    if(s.cert&&s.cert.label)bits.push(`<span class="hero-cert">${ratingInfoHtml(s.cert)}</span>`);
    if(s.rating>0)bits.push(`<span class="hero-rating"><i class="fa-solid fa-star"></i> ${s.rating.toFixed(1)}</span>`);
    if(s.type==='movie'&&s.runtime)bits.push(`<span>${s.runtime} min</span>`);
    if(s.type==='tv'&&s.seasons)bits.push(`<span>${s.seasons} Season${s.seasons>1?'s':''}</span>`);
    const metaEl=el.querySelector('.hero-meta');
    if(metaEl)metaEl.innerHTML=bits.length?bits.join('<span class="hero-meta-sep">&bull;</span>'):'';
    const genresEl=el.querySelector('.hero-genres');
    if(genresEl)genresEl.innerHTML=s.genres.length?s.genres.map(g=>`<span class="featured-tag hero-genre">${sanitize(g)}</span>`).join(''):'';
    const ovEl=el.querySelector('.hero-overview');
    if(ovEl&&s.overview)ovEl.textContent=s.overview;
    const bg=el.querySelector('.hero-slide-bg');
    if(bg&&s.backdrop&&!bg.getAttribute('data-final')){bg.style.backgroundImage=`url('${s.backdrop}')`;bg.setAttribute('data-final','1');}
  },
  startTimer(){this.hovered=false;this.restartTimer();},
  stopTimer(){clearTimeout(this.timer);this.timer=null;},
  restartTimer(){
    this.stopTimer();
    if(this.hovered||this.reducedMotion)return;
    if(currentPage!=='home'||document.hidden)return;
    if(!this.slides.length)return;
    this.timer=setTimeout(()=>this.goto(this.index+1),this.INTERVAL);
  }
};

// ============ SEARCH PAGE ============
function pickFeatured(items){
  if(!items.length)return null;
  let best=items[0],bestScore=-Infinity;
  items.forEach((it,i)=>{
    const score=(Math.max(0,100-i*4))
      +(Number(it.popularity)||0)
      +(Number(it.vote_average)||0)*6
      +(it.backdrop_path?35:0)
      +(it.poster_path?25:0)
      +(it.overview?15:0);
    if(score>bestScore){bestScore=score;best=it;}
  });
  return best;
}
const featuredDetailsCache={};
async function loadFeaturedDetails(item,type){
  const t=type||item._homeType;
  const key=t+':'+item.id;
  if(featuredDetailsCache[key])return featuredDetailsCache[key];
  try{
    const data=await fetchJSON(`https://api.themoviedb.org/3/${t}/${item.id}?api_key=x`);
    featuredDetailsCache[key]=data;
    return data;
  }catch{return null;}
}
async function renderFeatured(item){
  const seq=searchRequestSeq;
  const el=document.getElementById('searchFeatured');
  if(!el)return;
  if(!item){el.innerHTML='';return;}
  el.innerHTML='<div class="featured-skeleton"><div class="featured-sk-l"></div><div class="featured-sk-r"><div class="featured-sk-line tall"></div><div class="featured-sk-line short"></div><div class="featured-sk-line"></div></div></div>';
  const [details, cert] = await Promise.all([loadFeaturedDetails(item), getAgeRating(item)]);
  if(seq!==searchRequestSeq)return;
  const type=item._homeType;
  const full={...item,...(details||{})};
  const title=full.title||full.name||'';
  const year=(full.release_date||full.first_air_date||full.year||'').slice(0,4);
  const rating=Number(full.vote_average)||0;
  const overview=full.overview||'';
  const genres=details&&Array.isArray(details.genres)?details.genres.map(g=>(g&&g.name)?g.name:'').filter(Boolean):[];
  const runtime=type==='movie'&&details?details.runtime:null;
  const seasons=type==='tv'&&details?details.number_of_seasons:null;
  const backdrop=full.backdrop_path||null;
  const poster=full.poster_path||null;
  const inList=isInWatchlist(item.id);
  el.innerHTML=`
    <div class="featured">
      ${backdrop?`<div class="featured-bg" style="background-image:url('${IMG_BG}${backdrop}')"></div>`:''}
      <div class="featured-shade"></div>
      <div class="featured-body">
        <div class="featured-poster">
          ${poster?`<img src="${IMG}${poster}" alt="${sanitize(title)}" loading="lazy">`:`<div class="featured-no-poster">&#127916;</div>`}
        </div>
        <div class="featured-info">
          <span class="featured-type">${type==='movie'?'Movie':'TV Show'}</span>
          <h2 class="featured-title">${sanitize(title)}</h2>
          <div class="featured-meta">
            ${year?`<span>${year}</span>`:''}
            ${rating?`<span><i class="fa-solid fa-star" style="color:var(--accent);"></i> ${rating.toFixed(1)}</span>`:''}
            ${cert&&cert.label?`<span class="featured-cert">${ratingInfoHtml(cert)}</span>`:''}
            ${runtime?`<span>${runtime} min</span>`:''}
            ${seasons?`<span>${seasons} Season${seasons>1?'s':''}</span>`:''}
          </div>
          ${genres.length?`<div class="featured-tags">${genres.map(g=>`<span class="featured-tag">${sanitize(g)}</span>`).join('')}</div>`:''}
          ${overview?`<p class="featured-overview">${sanitize(overview)}</p>`:''}
          <div class="featured-actions">
            <button type="button" class="featured-play"><i class="fa-solid fa-play"></i> Watch now</button>
            <button type="button" class="wl-btn ${inList?'in-list':''} featured-wl"><span class="wl-icon"></span> ${inList?'In Watchlist':'Watchlist'}</button>
          </div>
        </div>
      </div>
    </div>`;
  el.querySelector('.featured-play').addEventListener('click',()=>selectItem(full,type,null));
  const wlBtn=el.querySelector('.featured-wl');
  wlBtn.dataset.wlId=String(item.id);
  wlBtn.addEventListener('click',(e)=>{
    e.stopPropagation();
    const wasIn=isInWatchlist(item.id);
    toggleWatchlistItem({...full,type});
    showToast(wasIn?'Removed from Watchlist':'Added to Watchlist',wasIn?'wl-removed':'wl-added');
  });
}
function setSearchHash(q){try{history.replaceState(null,'','#search'+(q?'?q='+encodeURIComponent(q):''));}catch(e){}}
function clearSearchHash(){try{history.replaceState(null,'',location.pathname);}catch(e){}}
function readSearchHash(){
  const h=location.hash||'';
  if(!h||!h.startsWith('#search'))return null;
  const qi=h.indexOf('?');
  if(qi<0)return '';
  return new URLSearchParams(h.slice(qi+1)).get('q')||'';
}
async function performSearch(explicitQuery){
  const input=document.getElementById('searchInput');
  const q=(explicitQuery!==undefined?explicitQuery:(input?input.value:'')).trim();
  if(input)input.value=q;
  if(!q){resetSearchResults();return;}
  closeRecentPanel();
  searchPage.query=q;searchPage.page=1;
  setSearchHash(q);
  addToSearchHistory(q);
  await loadSearchResults(1);
}
async function loadSearchResults(page){
  const seq=++searchRequestSeq;
  searchPage.loading=true;
  const resultsEl=document.getElementById('searchPageResults');
  const gridEl=document.getElementById('searchGrid');
  const msgEl=document.getElementById('searchMsg');
  const pagEl=document.getElementById('searchPagination');
  const labelEl=document.getElementById('searchResultsLabel');
  const featuredEl=document.getElementById('searchFeatured');
  resultsEl.classList.add('visible');
  document.getElementById('page-search').classList.add('has-results');
  gridEl.innerHTML='';pagEl.style.display='none';msgEl.style.display='none';
  featuredEl.innerHTML='';
  renderSkeletonGrid(gridEl);
  const q=encodeURIComponent(searchPage.query);
  let dm,dt;
  try{
    const mkMovie=(p)=>`https://api.themoviedb.org/3/search/movie?api_key=x&page=${p}&query=${q}`;
    const mkTv=(p)=>`https://api.themoviedb.org/3/search/tv?api_key=x&page=${p}&query=${q}`;
    [dm,dt]=await Promise.all([fetchJSON(mkMovie(page)),fetchJSON(mkTv(page))]);
  }catch(err){
    searchPage.loading=false;
    if(seq!==searchRequestSeq)return;
    console.error('[ystream] search failed',err);
    gridEl.innerHTML='';featuredEl.innerHTML='';
    msgEl.style.display='block';msgEl.textContent='Something went wrong. Please try again.';
    labelEl.textContent='"'+sanitize(searchPage.query)+'"';
    return;
  }
  searchPage.loading=false;
  if(seq!==searchRequestSeq)return;
  searchPage.totalPages=Math.max(Math.min((dm&&dm.total_pages)||1,500),Math.min((dt&&dt.total_pages)||1,500));
  const movies=((dm&&dm.results)||[]).filter(notAdult).map(r=>({...r,_homeType:'movie'}));
  const shows=((dt&&dt.results)||[]).filter(notAdult).map(r=>({...r,_homeType:'tv'}));
  const interleaved=[];
  const len=Math.max(movies.length,shows.length);
  for(let i=0;i<len;i++){if(i<movies.length)interleaved.push(movies[i]);if(i<shows.length)interleaved.push(shows[i]);}
  const isMobile=window.innerWidth<=768;
  const cols=isMobile?3:7;
  const items=interleaved.slice(0,Math.floor(interleaved.length/cols)*cols||interleaved.length);
  const featured=pickFeatured(items);
  searchPage.results=items;
  searchPage.featured=featured;
  searchPage.page=page;
  gridEl.innerHTML='';
  labelEl.textContent='"'+sanitize(searchPage.query)+'"';
  if(!items.length){
    msgEl.style.display='block';
    msgEl.innerHTML='No results found for "<strong>'+sanitize(searchPage.query)+'</strong>". Try a different title or spelling.';
  }else{
    items.forEach(item=>{if(item!==featured)gridEl.appendChild(makeHomeCard(item));});
    renderFeatured(featured);
  }
  renderSearchPagination();
  if(page===1){
    const heroEl=document.querySelector('.search-hero');
    (heroEl||resultsEl).scrollIntoView({behavior:'smooth',block:'start'});
  }
}
function renderSearchPagination(){
  buildPagination(document.getElementById('searchPagination'),searchPage.page,searchPage.totalPages,(pg)=>loadSearchResults(pg));
}
function resetSearchResults(){
  searchPage.query='';searchPage.page=1;searchPage.totalPages=1;searchPage.results=[];searchPage.featured=null;
  searchRequestSeq++;
  const resultsEl=document.getElementById('searchPageResults');
  const featuredEl=document.getElementById('searchFeatured');
  const gridEl=document.getElementById('searchGrid');
  const msgEl=document.getElementById('searchMsg');
  const pagEl=document.getElementById('searchPagination');
  if(resultsEl)resultsEl.classList.remove('visible');
  const pageEl=document.getElementById('page-search');
  if(pageEl)pageEl.classList.remove('has-results');
  clearSearchHash();
  if(featuredEl)featuredEl.innerHTML='';
  if(gridEl)gridEl.innerHTML='';
  if(msgEl)msgEl.style.display='none';
  if(pagEl)pagEl.style.display='none';
}
function makeHomeCard(item){
  const type=item._homeType;
  const card=makeCard(item,type,{showWl:true});
  const info=card.querySelector('.card-info');
  if(info){
    const badge=document.createElement('div');
    badge.className='card-type';
    badge.textContent=type==='movie'?'Movie':'TV Show';
    const title=info.querySelector('.card-title');
    if(title&&title.nextSibling)info.insertBefore(badge,title.nextSibling);
    else info.appendChild(badge);
  }
  return card;
}
function buildPagination(el,p,t,go){
  el.innerHTML='';el.style.display='flex';
  if(t<=1){el.style.display='none';return;}
  const mkBtn=(label,pg,nav=false,disabled=false)=>{
    const b=document.createElement('button');
    b.className='page-btn'+(nav?' nav':'')+(pg===p&&!nav?' active':'');
    b.textContent=label;b.disabled=disabled;b.onclick=()=>go(pg);return b;
  };
  const ellipsis=()=>{const s=document.createElement('span');s.className='page-ellipsis';s.textContent='...';return s;};
  el.appendChild(mkBtn('\u00AB',p-10,true,p<=10));
  el.appendChild(mkBtn('\u2190',p-1,true,p<=1));
  const pages=new Set([1,t,p-2,p-1,p,p+1,p+2].filter(n=>n>=1&&n<=t));
  let prev=null;
  [...pages].sort((a,b)=>a-b).forEach(n=>{
    if(prev!==null&&n-prev>1)el.appendChild(ellipsis());
    el.appendChild(mkBtn(n,n));prev=n;
  });
  el.appendChild(mkBtn('\u2192',p+1,true,p>=t));
  el.appendChild(mkBtn('\u00BB',p+10,true,p+10>t));
}

async function loadPage(type,page){
  const s=state[type];
  if(s.loading)return;
  s.loading=true;
  const gridEl=document.getElementById(type==='movie'?'movieGrid':'tvGrid');
  const msgEl=document.getElementById(type==='movie'?'movieStateMsg':'tvStateMsg');
  const pagEl=document.getElementById(type==='movie'?'moviePagination':'tvPagination');
  gridEl.innerHTML='';pagEl.style.display='none';msgEl.style.display='none';
  renderSkeletonGrid(gridEl);
  const endpoint=type==='movie'?'trending/movie/week':'trending/tv/week';
  const mkUrl=(p)=>`https://api.themoviedb.org/3/${endpoint}?api_key=x&page=${p}`;
  const cols=window.innerWidth<=768?3:7;
  let items=[];
  try{
    const d1=await fetchJSON(mkUrl(page));
    const page1=(d1.results||[]).filter(notAdult);
    items=page1.slice();
    // Only fetch a second page when the first leaves a partial final row to fill (e.g. mobile).
    const remainder=page1.length%cols;
    if(remainder>0){
      const needed=cols-remainder;
      try{
        const d2=await fetchJSON(mkUrl(page+1));
        items=items.concat((d2.results||[]).filter(notAdult).slice(0,needed));
      }catch(err){console.warn('[ystream] second page fetch failed (optional), using page 1 alone',err);}
    }
    s.page=page;
  }catch(err){
    console.error('[ystream] load failed',err);
    gridEl.innerHTML='';msgEl.style.display='block';msgEl.textContent='Something went wrong. Please try again.';
    s.loading=false;return;
  }
  const shown=items.slice(0,Math.floor(items.length/cols)*cols||items.length);
  renderGrid(type,shown);renderPagination(type);
  window.scrollTo({top:0,behavior:'smooth'});s.loading=false;
}

function renderGrid(type,items){
  const gridEl=document.getElementById(type==='movie'?'movieGrid':'tvGrid');
  const msgEl=document.getElementById(type==='movie'?'movieStateMsg':'tvStateMsg');
  gridEl.innerHTML='';
  if(!items.length){msgEl.style.display='block';msgEl.innerHTML='No results found.';return;}
  items.forEach(item=>gridEl.appendChild(makeCard(item,type,{showWl:true})));
}

function makeCard(item,type,opts={}){
  const title=item.title||item.name;
  const year=(item.release_date||item.first_air_date||item.year||'').slice(0,4);
  const poster=item.poster_path?IMG+item.poster_path:(item.poster?IMG+item.poster:null);
  const rating=item.vote_average!=null?Number(item.vote_average).toFixed(1):item.rating!=null?Number(item.rating).toFixed(1):null;
  const resume=getResume(item.id,type);
  const inWl=isInWatchlist(item.id);
  const pct=(resume&&resume.duration&&resume.currentTime)?Math.min(100,Math.round((resume.currentTime/resume.duration)*100)):null;
  const overview=item.overview||'';
  const tvMeta=type==='tv'?`<span class="hover-meta" id="tvmeta-${item.id}">Loading…</span>`:'';
  const div=document.createElement('div');
  div.className='card';
  div.innerHTML=`
    ${poster?`<img src="${poster}" alt="${sanitize(title)}" loading="lazy"/>`:`<div class="card-no-poster">&#127916;</div>`}
    ${rating?`<div class="card-rating">&#9733; ${rating}</div>`:''}
    ${opts.showWl?`<button class="card-wl-btn ${inWl?'in-list':''}" title="${inWl?'Remove from watchlist':'Add to watchlist'}" aria-label="${inWl?'Remove from watchlist':'Add to watchlist'}">${inWl?'&#9829;':'&#9825;'}</button>`:''}
    ${opts.showDelete?`<button class="card-delete-btn" title="Remove" aria-label="Remove">&#10005;</button>`:''}
    ${pct!==null?`<div class="card-progress"><div class="card-progress-fill" style="width:${pct}%"></div></div>`:''}
    ${resume?`<div class="card-resume">${sanitize(resume.label)}</div>`:''}
    <div class="card-hover-overlay">
      <div class="hover-meta-line">
        <span class="hover-rating">${rating?'&#9733; '+rating:''}</span>
        <span class="hover-cert"></span>
      </div>
      ${tvMeta}
      ${overview?`<div class="hover-synopsis">${sanitize(overview)}</div>`:''}
    </div>
    <div class="card-info"><div class="card-title">${sanitize(title)}</div><div class="card-year">${year}</div></div>`;
  if(opts.showWl){
    const wlBtn=div.querySelector('.card-wl-btn');
    wlBtn.dataset.wlId=String(item.id);
    wlBtn.addEventListener('click',(e)=>{
      e.stopPropagation();
      const wasIn=isInWatchlist(item.id);
      toggleWatchlistItem({...item,type});
      showToast(wasIn?'Removed from Watchlist':'Added to Watchlist', wasIn?'wl-removed':'wl-added');
    });
  }
  if(opts.showDelete){
    div.querySelector('.card-delete-btn').addEventListener('click',(e)=>{
      e.stopPropagation();
      showRemoveConfirmModal({...item,type});
    });
  }
  if(type==='tv'){
    getTVDetails(item.id).then(info=>{
      const metaEl=document.getElementById('tvmeta-'+item.id);
      if(metaEl&&info.seasons)metaEl.textContent=`${info.seasons} Season${info.seasons!==1?'s':''} · ${info.episodes} Episode${info.episodes!==1?'s':''}`;
    });
  }
  div.onclick=()=>selectItem(item,type,div);
  div.setAttribute('role','button');div.setAttribute('tabindex','0');
  div.addEventListener('keydown',e=>{
    if(e.target&&e.target.closest&&e.target.closest('.rating-info-btn'))return;
    if(e.key==='Enter'||e.key===' '){e.preventDefault();selectItem(item,type,div);}
  });
  attachCardCert(div,item,type);
  return div;
}

function attachCardCert(card,item,type){
  getAgeRating(item,type).then(cert=>{
    if(!cert||!cert.label||!card.isConnected)return;
    const slot=card.querySelector('.hover-cert');
    if(slot)slot.innerHTML=ratingInfoHtml(cert);
  });
}

function renderPagination(type){
  const el=document.getElementById(type==='movie'?'moviePagination':'tvPagination');
  const s=state[type];
  buildPagination(el,s.page,s.totalPages,(pg)=>loadPage(type,pg));
}

const PAGE_LABELS={home:'Home',search:'Search',movies:'Movies',tv:'TV Shows',continue:'Continue Watching',watchlist:'Watchlist'};

async function selectItem(item,type,cardEl){
  document.querySelectorAll('.card').forEach(c=>c.classList.remove('selected'));
  if(cardEl)cardEl.classList.add('selected');
  state[type].selected=item;
  const title=item.title||item.name;
  const year=(item.release_date||item.first_air_date||item.year||'').slice(0,4);
  const poster=item.poster_path?IMG_ORIG+item.poster_path:(item.poster?IMG_ORIG+item.poster:null);
  const rating=item.vote_average!=null?Number(item.vote_average).toFixed(1):null;
  const srv=getActiveServer();
  const overview=item.overview||'';
  document.getElementById('playerBackCtx').textContent=PAGE_LABELS[currentPage]||'';
  document.getElementById('playerMeta').innerHTML=`
    ${poster?`<img class="player-poster" src="${poster}" alt="${sanitize(title)}"/>`:''}
    <div class="player-info">
      <h2>${sanitize(title)}</h2>
      <div class="player-details">
        <p class="player-overview" id="playerOverview">${sanitize(overview)||'<span style="opacity:0.35">Loading…</span>'}</p>
        <div class="player-meta-col">
          ${year?`<span class="player-meta-item">${sanitize(year)}</span>`:''}
          ${rating?`<span class="player-meta-item"><i class="fa-solid fa-star"></i> ${rating}</span>`:''}
          <span class="player-meta-item" id="playerMetaCert"></span>
        </div>
      </div>
      <button class="wl-btn ${isInWatchlist(item.id)?'in-list':''}" data-wl-id="${item.id}" onclick="toggleWatchlistFromPlayer('${type}')">
        <span class="wl-icon"></span> ${isInWatchlist(item.id)?'In Watchlist':'Add to Watchlist'}
      </button>
      <div class="player-actions">
        <div class="server-pills">
          <button class="server-pill${srv==='videasy'?' active':''}" onclick="switchServer('videasy','${type}')" data-srv="videasy">
            <i class="fa-solid fa-circle-play"></i> Server 1 <span class="srv-badge">★ Recommended</span>
          </button>
          <button class="server-pill${srv==='vidking'?' active':''}" onclick="switchServer('vidking','${type}')" data-srv="vidking">
            <i class="fa-solid fa-server"></i> Server 2
          </button>
        </div>
      </div>
    </div>`;
  switchPage('player');
  getAgeRating(item,type).then(cert=>{
    const el=document.getElementById('playerMetaCert');
    if(!el)return;
    if(cert&&cert.label){el.innerHTML=ratingInfoHtml(cert,'player');return;}
    if(!el.innerHTML.trim()&&!el.previousElementSibling&&!el.nextElementSibling)el.parentElement.remove();
  });
  const frame=document.getElementById('playerFrame');
  frame.style.opacity='0.5';frame.style.transition='opacity 0.3s ease';
  frame.onload=()=>{frame.style.opacity='1';frame.onload=null;};
  frame.src=buildEmbedUrl(item,type,srv);
  window.scrollTo({top:0,behavior:'smooth'});
  loadMoreLikeThis(item,type);
  if(type==='tv'){
    const resume=getResume(item.id,'tv');
    const season=resume&&resume.season?resume.season:1;
    const episode=resume&&resume.episode?resume.episode:1;
    nowPlayingEp={season,episode};
    fetchAndSetEpisodeOverview(item.id,season,episode);
  }else{
    nowPlayingEp={season:null,episode:null};
    if(!overview){
      try{
        const detail=await fetchJSON(`https://api.themoviedb.org/3/movie/${item.id}?api_key=x`);
        const el=document.getElementById('playerOverview');
        if(el)el.textContent=detail.overview||'';
      }catch{
        const el=document.getElementById('playerOverview');
        if(el)el.textContent='';
      }
    }
  }
}

async function fetchAndSetEpisodeOverview(showId,season,episode){
  try{
    const data=await fetchJSON(`https://api.themoviedb.org/3/tv/${showId}/season/${season}/episode/${episode}?api_key=x`);
    const el=document.getElementById('playerOverview');
    if(el)el.textContent=data.overview||'';
    nowPlayingEp={season,episode};
  }catch{
    const el=document.getElementById('playerOverview');
    if(el)el.textContent='';
  }
}

async function loadMoreLikeThis(item,type){
  const section=document.getElementById('moreLikeThisSection');
  const row=document.getElementById('moreLikeThisRow');
  const label=document.getElementById('moreLikeThisLabel');
  section.style.display='block';
  row.innerHTML='';
  for(let i=0;i<14;i++){
    const sk=document.createElement('div');sk.className='skeleton-card';
    sk.innerHTML='<div class="skeleton-img"></div><div class="skeleton-info"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>';
    row.appendChild(sk);
  }
  label.textContent='More Like This';
  try{
    const [recData, simData] = await Promise.all([
      fetchJSON(`https://api.themoviedb.org/3/${type}/${item.id}/recommendations?api_key=x&page=1`),
      fetchJSON(`https://api.themoviedb.org/3/${type}/${item.id}/similar?api_key=x&page=1`)
    ]);
    const scoreMap=new Map();
    (recData.results||[]).filter(notAdult).forEach(r=>{
      if(!r.poster_path)return;
      scoreMap.set(r.id,{item:r,score:2});
    });
    (simData.results||[]).filter(notAdult).forEach(r=>{
      if(!r.poster_path)return;
      if(scoreMap.has(r.id)){scoreMap.get(r.id).score+=1;}else{scoreMap.set(r.id,{item:r,score:1});}
    });
    const merged=[...scoreMap.values()]
      .sort((a,b)=>b.score-a.score||(b.item.vote_average||0)-(a.item.vote_average||0))
      .slice(0,14)
      .map(e=>e.item);
    row.innerHTML='';
    if(!merged.length){section.style.display='none';return;}
    merged.forEach(similar=>{
      const card=makeCard(similar,type,{showWl:true});
      card.style.scrollSnapAlign='start';
      row.appendChild(card);
    });
    refreshRowNavFor(row);
    label.textContent=`More Like "${item.title||item.name}"`;
  }catch(e){section.style.display='none';}
}

function switchServer(key,type){
  setActiveServer(key);
  localStorage.setItem('screenify_server_chosen','1');
  document.querySelectorAll('.server-pill').forEach(p=>{
    p.classList.toggle('active',p.dataset.srv===key);
  });
  const item=state[type].selected;
  if(!item)return;
  const resume=getResume(item.id,type);
  const ts=resume&&resume.currentTime>10?Math.floor(resume.currentTime):0;
  const frame=document.getElementById('playerFrame');
  frame.style.opacity='0.5';frame.onload=()=>{frame.style.opacity='1';frame.onload=null;};
  frame.src=buildEmbedUrl(item,type,key,ts);
}

function buildEmbedUrl(item,type,serverKey,forceTs){
  const srv=serverKey||getActiveServer();
  const s=SERVERS[srv];
  const id=item.id;
  const resume=getResume(id,type)||{};
  const season=clampInt(resume.season,1,1000,1);
  const episode=clampInt(resume.episode,1,2000,1);
  const ts=forceTs!=null?Math.max(0,Math.floor(forceTs)):(resume.currentTime>10?Math.floor(resume.currentTime):0);
  let url;
  if(srv==='vidking'){
    url=type==='movie'?s.movie(id):s.tv(id,season,episode);
    const params=[`color=${ACCENT}`,'autoPlay=true'];
    if(type==='movie'&&ts>0)params.push('progress='+ts);
    if(type==='tv'){params.push('nextEpisode=true');params.push('episodeSelector=true');}
    url+='?'+params.join('&');
  }else{
    url=type==='movie'?s.movie(id):s.tv(id,season,episode);
    const params=[`color=${ACCENT}`,'autoplayNextEpisode=true','overlay=true'];
    if(ts>0)params.push('progress='+ts);
    if(type==='tv'){params.push('nextEpisode=true');params.push('episodeSelector=true');}
    url+='?'+params.join('&');
  }
  // Load the embed directly — no proxy, no sandboxing.
  return url;
}

function toggleWatchlistFromPlayer(type){
  const item=state[type].selected;if(!item)return;
  const wasIn=isInWatchlist(item.id);
  toggleWatchlistItem({...item,type});
  showToast(wasIn?'Removed from Watchlist':'Added to Watchlist',wasIn?'wl-removed':'wl-added');
}

function getContinueList(){try{return JSON.parse(localStorage.getItem('screenify_continue')||'[]');}catch{return[];}}
function saveContinueItem(item,type){
  let list=getContinueList().filter(i=>i.id!==item.id);
  list.unshift({id:item.id,type,title:item.title||item.name,year:(item.release_date||item.first_air_date||item.year||'').slice(0,4),poster:item.poster_path||item.poster||null,rating:item.vote_average||item.rating||null});
  localStorage.setItem('screenify_continue',JSON.stringify(list.slice(0,20)));
}
function removeFromContinue(id){
  const list=getContinueList().filter(i=>i.id!==id);
  localStorage.setItem('screenify_continue',JSON.stringify(list));
  localStorage.removeItem('screenify_resume_'+id);
  renderHomeContinue();
  if(currentPage==='continue')renderContinuePage();
  const moviesRow=document.getElementById('home-moviesRow');
  const tvRow=document.getElementById('home-tvRow');
  if(moviesRow&&moviesRow.children.length)loadHomeTrendingRow('movie','home-moviesRow');
  if(tvRow&&tvRow.children.length)loadHomeTrendingRow('tv','home-tvRow');
  if(currentPage==='movies')loadPage('movie',state.movie.page);
  if(currentPage==='tv')loadPage('tv',state.tv.page);
  showToast('Removed from Continue Watching', 'wl-removed');
}
function renderHomeContinue(){
  const list=getContinueList();
  const wrap=document.getElementById('home-continue-wrap');
  const grid=document.getElementById('home-continueGrid');
  if(!list.length){wrap.style.display='none';return;}
  wrap.style.display='block';grid.innerHTML='';
  list.forEach(item=>{
    const card=makeCard(item,item.type,{showDelete:true});
    card.style.flex='0 0 calc((100% - 6*14px)/7)';
    card.style.minWidth='110px';card.style.scrollSnapAlign='start';
    grid.appendChild(card);
  });
  refreshRowNavFor(grid);
}

function showRemoveConfirmModal(item){
  const existing=document.getElementById('cwConfirmModal');
  if(existing)existing.remove();
  const backdrop=document.createElement('div');
  backdrop.className='cw-modal-backdrop';
  backdrop.id='cwConfirmModal';
  const resumeData=getResume(item.id,item.type);
  let progressNote='';
  if(resumeData&&resumeData.label){
    if(item.type==='tv'){progressNote=`You were at <strong>${sanitize(resumeData.label)}</strong>.`;}
    else{progressNote=`You were <strong>${sanitize(resumeData.label)}</strong> in.`;}
  }
  backdrop.innerHTML=`
    <div class="cw-modal">
      <div class="cw-modal-icon">🗑️</div>
      <div class="cw-modal-title">Remove from Continue Watching?</div>
      <div class="cw-modal-body"><strong>${sanitize(item.title)}</strong> will be removed from your list.</div>
      <div class="cw-modal-warning">⚠️ Your watch progress will also be cleared.${progressNote?' '+progressNote:''} Next time you open it, it'll start from the beginning.</div>
      <div class="cw-modal-btns">
        <button class="cw-modal-cancel">Keep it</button>
        <button class="cw-modal-confirm">Yes, remove</button>
      </div>
    </div>`;
  backdrop.querySelector('.cw-modal-cancel').addEventListener('click',()=>backdrop.remove());
  backdrop.querySelector('.cw-modal-confirm').addEventListener('click',()=>{backdrop.remove();removeFromContinue(item.id);});
  backdrop.addEventListener('click',(e)=>{if(e.target===backdrop)backdrop.remove();});
  document.body.appendChild(backdrop);
}

function renderContinuePage(){
  const list=getContinueList();
  const listEl=document.getElementById('cwPageList');
  const empty=document.getElementById('cwPageEmpty');
  listEl.innerHTML='';
  if(!list.length){empty.style.display='block';return;}
  empty.style.display='none';
  list.forEach(stored=>listEl.appendChild(makeFeaturedCard(stored,'cw')));
}

// ============ WATCHLIST UI SYNC ============
// Every watchlist toggle goes through toggleWatchlistItem (the single source
// of truth). After the underlying list changes we refresh every visible button
// that references the changed title, so the hero carousel, homepage/search
// cards, search featured card and the player button all stay in sync.
function setWlButtonState(btn,id){
  if(!btn)return;
  const inList=isInWatchlist(id);
  if(btn.classList.contains('hero-wl')){
    btn.classList.toggle('in-list',inList);
    btn.innerHTML=`<span class="wl-icon"></span> ${inList?'In Watchlist':'Add to Watchlist'}`;
  }else if(btn.classList.contains('featured-wl')){
    btn.classList.toggle('in-list',inList);
    btn.innerHTML=`<span class="wl-icon"></span> ${inList?'In Watchlist':'Watchlist'}`;
  }else if(btn.classList.contains('card-wl-btn')){
    btn.classList.toggle('in-list',inList);
    btn.innerHTML=inList?'&#9829;':'&#9825;';
    btn.title=inList?'Remove from watchlist':'Add to watchlist';
    btn.setAttribute('aria-label',inList?'Remove from watchlist':'Add to watchlist');
  }else if(btn.classList.contains('wl-btn')){
    btn.classList.toggle('in-list',inList);
    btn.innerHTML=`<span class="wl-icon"></span> ${inList?'In Watchlist':'Add to Watchlist'}`;
  }
}
function syncWatchlistUI(id){
  const key=id!=null?String(id):null;
  document.querySelectorAll('[data-wl-id]').forEach(btn=>{
    if(key!=null&&btn.dataset.wlId!==key)return;
    setWlButtonState(btn,btn.dataset.wlId);
  });
}

function getWatchlist(){try{return JSON.parse(localStorage.getItem('screenify_watchlist')||'[]');}catch{return[];}}
function saveWatchlist(list){localStorage.setItem('screenify_watchlist',JSON.stringify(list));}
function isInWatchlist(id){return getWatchlist().some(i=>i.id===id);}
function toggleWatchlistItem(item){
  let list=getWatchlist();
  if(isInWatchlist(item.id)){list=list.filter(i=>i.id!==item.id);}
  else{
    if(!notAdult(item)){showToast('This title is not available','wl-removed');return;}
    list.unshift({id:item.id,type:item.type,title:item.title||item.name,year:(item.release_date||item.first_air_date||item.year||'').slice(0,4),poster:item.poster_path||item.poster||null,rating:item.vote_average||item.rating||null});
  }
  saveWatchlist(list);
  syncWatchlistUI(item.id);
  if(currentPage==='watchlist')renderWatchlistPage();
}
function makeFeaturedCard(stored,mode){
  const type=stored.type||stored._homeType||'movie';
  const title=stored.title||'';
  const year=stored.year||(stored.release_date||stored.first_air_date||'').slice(0,4);
  const rating=stored.rating!=null?Number(stored.rating).toFixed(1):stored.vote_average!=null?Number(stored.vote_average).toFixed(1):null;
  const posterUrl=stored.poster_path?IMG+stored.poster_path:(stored.poster?IMG+stored.poster:null);
  const el=document.createElement('div');
  el.className='featured';
  let progressHtml='';
  let playLabel=mode==='cw'?'Resume':'Watch now';
  if(mode==='cw'){
    const resume=getResume(stored.id,type);
    const pct=(resume&&resume.duration&&resume.currentTime)?Math.min(100,Math.round((resume.currentTime/resume.duration)*100)):null;
    if(pct!==null){
      const epPart=type==='tv'&&resume.label?sanitize(resume.label)+' &middot; ':'';
      progressHtml=`<div class="cw-progress-bar"><div class="cw-progress-fill" style="width:${pct}%"></div></div><div class="cw-progress-label">${epPart}${pct}% &middot; <span class="cw-timestamp">${resume.timeLabel}</span></div>`;
    }else{
      progressHtml='<div class="cw-progress-label" style="color:var(--muted);">Not started</div>';
      playLabel='Watch now';
    }
  }
  el.innerHTML=`
    <div class="featured-body">
      <div class="featured-poster">
        ${posterUrl?`<img src="${posterUrl}" alt="${sanitize(title)}" loading="lazy">`:`<div class="featured-no-poster">&#127916;</div>`}
      </div>
      <div class="featured-info">
        <span class="featured-type">${type==='movie'?'Movie':'TV Show'}</span>
        <h2 class="featured-title">${sanitize(title)}</h2>
        <div class="featured-meta">
          ${year?`<span>${sanitize(year)}</span>`:''}
          ${rating?`<span><i class="fa-solid fa-star" style="color:var(--accent);"></i> ${rating}</span>`:''}
        </div>
        <p class="featured-overview"></p>
        ${progressHtml}
        <div class="featured-actions">
          <button type="button" class="featured-play"><i class="fa-solid fa-play"></i> ${playLabel}</button>
          <button type="button" class="featured-remove-btn">${mode==='cw'?'Remove from Continue Watching':'Remove from Watchlist'}</button>
        </div>
      </div>
    </div>`;
  el.querySelector('.featured-play').addEventListener('click',(e)=>{
    e.stopPropagation();
    selectItem({...stored,type},type,null);
  });
  el.querySelector('.featured-remove-btn').addEventListener('click',(e)=>{
    e.stopPropagation();
    if(mode==='cw'){showRemoveConfirmModal({...stored,type});}
    else{removeFromWatchlist(stored.id);showToast('Removed from Watchlist','wl-removed');}
  });
  loadFeaturedDetails({...stored,type,_homeType:type},type).then(details=>{
    if(!details||!el.isConnected)return;
    if(details.backdrop_path){
      el.insertAdjacentHTML('afterbegin',`<div class="featured-bg" style="background-image:url('${IMG_BG}${details.backdrop_path}')"></div><div class="featured-shade"></div>`);
    }
    const ovEl=el.querySelector('.featured-overview');
    if(ovEl){
      if(details.overview)ovEl.textContent=details.overview;
      else ovEl.style.display='none';
    }
    const metaEl=el.querySelector('.featured-meta');
    if(metaEl&&type==='tv'&&details.number_of_seasons){
      metaEl.insertAdjacentHTML('beforeend',`<span>${details.number_of_seasons} Season${details.number_of_seasons>1?'s':''}</span>`);
    }
    if(details.genres&&details.genres.length){
      const tagsEl=document.createElement('div');
      tagsEl.className='featured-tags';
      tagsEl.innerHTML=details.genres.filter(g=>g&&g.name).map(g=>`<span class="featured-tag">${sanitize(g.name)}</span>`).join('');
      metaEl.insertAdjacentElement('afterend',tagsEl);
    }
  });
  getAgeRating({...stored,type},type).then(cert=>{
    if(!cert||!cert.label||!el.isConnected)return;
    const m=el.querySelector('.featured-meta');
    if(m)m.insertAdjacentHTML('beforeend',`<span class="featured-cert">${ratingInfoHtml(cert)}</span>`);
  });
  return el;
}
function removeFromWatchlist(id){
  saveWatchlist(getWatchlist().filter(i=>i.id!==id));
  syncWatchlistUI(id);
  if(currentPage==='watchlist')renderWatchlistPage();
}
function renderWatchlistPage(){
  const list=getWatchlist();
  const grid=document.getElementById('watchlistPageGrid');
  const empty=document.getElementById('watchlistPageEmpty');
  grid.innerHTML='';
  if(!list.length){empty.style.display='block';return;}
  empty.style.display='none';
  list.forEach(stored=>grid.appendChild(makeFeaturedCard(stored,'wl')));
}

function fmtTime(secs){
  secs=Math.floor(secs||0);
  const h=Math.floor(secs/3600),m=Math.floor((secs%3600)/60),s=secs%60;
  return h>0?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
}
function getResume(id,type){
  try{
    const data=JSON.parse(localStorage.getItem('screenify_resume_'+id)||'null');
    if(!data||typeof data!=='object')return null;
    const currentTime=isFiniteNum(data.currentTime)?Math.min(Math.max(data.currentTime,0),864000):0;
    const duration=isFiniteNum(data.duration)?Math.max(data.duration,0):604800;
    const season=clampInt(data.season,1,1000,1);
    const episode=clampInt(data.episode,1,2000,1);
    const timeLabel=fmtTime(currentTime);
    if(type==='tv')return{...data,season,episode,currentTime,duration,label:`S${season} E${episode}`,timeLabel};
    const secs=Math.floor(currentTime);
    const h=Math.floor(secs/3600),m=Math.floor((secs%3600)/60),s=secs%60;
    return{...data,season,episode,currentTime,duration,label:h>0?`${h}h ${m}m`:`${m}:${String(s).padStart(2,'0')}`,timeLabel};
  }catch{return null;}
}
function saveResume(id,type,data){localStorage.setItem('screenify_resume_'+id,JSON.stringify({type,...data}));}

window.addEventListener('message',(e)=>{
  if(!ALLOWED_PLAYER_ORIGINS.has(e.origin))return;
  if(typeof e.data!=='string')return;
  let msg;
  try{msg=JSON.parse(e.data);}catch{return;}
  if(!msg||msg.type!=='PLAYER_EVENT')return;
  const d=msg.data;
  if(!d||typeof d!=='object')return;
  const type=d.mediaType==='tv'?'tv':'movie';
  const item=state[type].selected;if(!item||item.id==null)return;
  const event=typeof d.event==='string'?d.event:'';
  const currentTime=isFiniteNum(d.currentTime)?Math.min(Math.max(d.currentTime,0),864000):0;
  const duration=isFiniteNum(d.duration)?Math.max(d.duration,0):604800;
  let season=1,episode=1;
  if(type==='tv'){
    season=clampInt(d.season,1,1000,1);
    episode=clampInt(d.episode,1,2000,1);
    if(episode!==nowPlayingEp.episode||season!==nowPlayingEp.season){
      nowPlayingEp={season,episode};
      fetchAndSetEpisodeOverview(item.id,season,episode);
    }
  }
  if(['pause','ended','seeked'].includes(event)||(event==='timeupdate'&&Math.floor(currentTime)%10===0)){
    if(type==='tv'){
      saveResume(item.id,'tv',{season,episode,currentTime:currentTime>=180?currentTime:0,duration});
      if(currentTime>=180){saveContinueItem(item,'tv');renderHomeContinue();}
    }else{
      saveResume(item.id,'movie',{currentTime,duration});
      if(currentTime>=300){saveContinueItem(item,'movie');renderHomeContinue();}
    }
    if(currentPage==='continue')renderContinuePage();
  }
});

function setupKeyboardShortcuts(){
  document.addEventListener('keydown',(e)=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
    switch(e.key.toLowerCase()){
      case 'f':if(currentPage==='player'){
        const iframe=document.getElementById('playerFrame');
        if(!iframe)return;
        if(document.fullscreenElement){
          if(document.exitFullscreen){document.exitFullscreen();}
          else if(document.webkitExitFullscreen){document.webkitExitFullscreen();}
        }else{
          if(iframe.requestFullscreen){iframe.requestFullscreen();}
          else if(iframe.webkitRequestFullscreen){iframe.webkitRequestFullscreen();}
        }
      }break;
      case 'm':toggleSidebar();break;
      case 'escape':if(currentPage==='player')goBack();break;
    }
  });
}

(function init(){
  renderHomeContinue();
  loadHomeTrendingRow('movie','home-moviesRow');
  loadHomeTrendingRow('tv','home-tvRow');
  initRowNav();
  renderRecentSearches();
  setupSearchEvents();
  heroCarousel.init();
  heroCarousel.load();
  const hq=readSearchHash();
  if(hq!==null){
    searchPage.query=hq;
    switchPage('search');
    if(hq)performSearch(hq);
  }else{
    switchPage('home');
  }
  setupKeyboardShortcuts();
  handleBackToTop();
  // ============ PWA: SERVICE WORKER ============
  if('serviceWorker' in navigator){
    window.addEventListener('load',()=>{
      navigator.serviceWorker.register('sw.js').catch(err=>console.warn('[ystream] service worker registration failed',err));
    });
  }
  document.querySelectorAll('.nav-item').forEach(n=>{
    n.setAttribute('tabindex','0');n.setAttribute('role','button');
    n.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();n.click();}});
  });
})();
