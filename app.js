// ============ CONFIGURATION ============
const API_BASE = 'https://screenify-worker.yassinmovies.workers.dev/api/tmdb';
const IMG='https://image.tmdb.org/t/p/w780';
const IMG_SM='https://image.tmdb.org/t/p/w500';
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
  movie:{mode:'trending',query:'',page:1,totalPages:500,loading:false,selected:null},
  tv:{mode:'trending',query:'',page:1,totalPages:500,loading:false,selected:null}
};
const homeSearch={type:'movie',query:'',page:1,totalPages:1,loading:false};
let currentPage='home';
let previousPage='home';
let savedScroll={};
let sidebarCollapsed=false;
let mobSearchType=null;
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

// ============ SEARCH HISTORY ============
// Keep up to 100 queries in storage, but only ever surface the 5 most recent
// in the dropdown so deleting a shown entry pulls the next hidden one up.
const MAX_HISTORY=100;
const MAX_HISTORY_SHOWN=5;
const HISTORY_VIEWS=[
  {input:'homeSearchInput',wrap:'searchHistory',pick:(q)=>{const i=document.getElementById('homeSearchInput');if(i)i.value=q;hideSearchHistory();doHomeSearch();}},
  {input:'movieSearch',wrap:'movieSearchHistory',pick:(q)=>{const i=document.getElementById('movieSearch');if(i)i.value=q;if(i)i.blur();doSearch('movie');}},
  {input:'tvSearch',wrap:'tvSearchHistory',pick:(q)=>{const i=document.getElementById('tvSearch');if(i)i.value=q;if(i)i.blur();doSearch('tv');}},
  {input:'mobSearchInput',wrap:'mobSearchHistory',pick:(q)=>{const i=document.getElementById('mobSearchInput');if(i)i.value=q;if(i)i.blur();mobDoSearch();}}
];
function getSearchHistory(){try{const arr=JSON.parse(localStorage.getItem('screenify_search_history')||'[]');return Array.isArray(arr)?arr.filter(q=>typeof q==='string'&&q.trim()).slice(0,MAX_HISTORY):[];}catch{return[];}}
function saveSearchHistory(list){localStorage.setItem('screenify_search_history',JSON.stringify(list.slice(0,MAX_HISTORY)));}
function addToSearchHistory(query){
  if(!query||!query.trim())return;
  const list=getSearchHistory().filter(q=>q!==query);
  list.unshift(query);
  saveSearchHistory(list);
  renderSearchHistory();
}
function removeQueryFromHistory(query){
  saveSearchHistory(getSearchHistory().filter(q=>q!==query));
  renderSearchHistory();
}
function clearAllSearchHistory(){
  saveSearchHistory([]);
  renderSearchHistory();
}
function hideSearchHistory(){
  HISTORY_VIEWS.forEach(v=>{const el=document.getElementById(v.wrap);if(el)el.classList.remove('visible');});
}
function historyMatches(list,current){const t=(current||'').trim().toLowerCase();return t?list.filter(x=>x.toLowerCase().startsWith(t)):list;}
function renderSearchHistory(){
  const all=getSearchHistory();
  HISTORY_VIEWS.forEach(v=>{
    const el=document.getElementById(v.wrap);
    if(!el)return;
    const inp=document.getElementById(v.input);
    const list=historyMatches(all,inp?inp.value:'');
    el.innerHTML='';
    if(!list.length){el.classList.remove('visible');return;}
    const head=document.createElement('div');
    head.className='search-history-head';
    const headLabel=document.createElement('span');
    headLabel.textContent='Recent searches';
    head.appendChild(headLabel);
    const clearBtn=document.createElement('button');
    clearBtn.type='button';clearBtn.className='search-history-clear';clearBtn.title='Clear all recent searches';clearBtn.setAttribute('aria-label','Clear all recent searches');
    clearBtn.innerHTML='<span class="cb-x">&#10005;</span> Clear';
    clearBtn.addEventListener('click',(ev)=>{ev.stopPropagation();clearAllSearchHistory();});
    head.appendChild(clearBtn);
    el.appendChild(head);
    list.slice(0,MAX_HISTORY_SHOWN).forEach(q=>{
      const row=document.createElement('div');
      row.className='search-history-row';
      row.setAttribute('role','button');row.setAttribute('tabindex','0');
      row.innerHTML='<span class="hist-search"><i class="fa-solid fa-magnifying-glass"></i></span><span class="hist-label"></span><button type="button" class="hist-del" title="Remove from history" aria-label="Remove from history">&#10005;</button>';
      row.querySelector('.hist-label').textContent=q;
      row.addEventListener('click',()=>v.pick(q));
      row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();v.pick(q);}});
      row.querySelector('.hist-del').addEventListener('click',(ev)=>{ev.stopPropagation();removeQueryFromHistory(q);});
      el.appendChild(row);
    });
    el.classList.toggle('visible',all.length>0&&document.activeElement===inp&&list.length>0);
  });
}
function refreshHistoryVisibility(){
  HISTORY_VIEWS.forEach(v=>{
    const el=document.getElementById(v.wrap);const inp=document.getElementById(v.input);
    if(!el||!inp)return;
    const list=historyMatches(getSearchHistory(),inp.value);
    el.classList.toggle('visible',list.length>0&&document.activeElement===inp);
  });
}
function setupSearchHistoryEvents(){
  HISTORY_VIEWS.forEach(v=>{
    const inp=document.getElementById(v.input);
    if(!inp)return;
    inp.addEventListener('focus',refreshHistoryVisibility);
    inp.addEventListener('input',renderSearchHistory);
    inp.addEventListener('blur',()=>{setTimeout(refreshHistoryVisibility,140);});
    inp.addEventListener('keydown',e=>{if(e.key==='Enter')hideSearchHistory();});
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

// ============ TOPBAR SCROLL SHRINK ============
function handleTopbarShrink() {
  const scrollY = window.scrollY || document.documentElement.scrollTop;
  document.querySelectorAll('.topbar').forEach(tb => {
    if (scrollY > 20) tb.classList.add('scrolled'); else tb.classList.remove('scrolled');
  });
}
window.addEventListener('scroll', handleTopbarShrink, {passive:true});

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
  hideSearchHistory();
  const searchPages={movies:{type:'movie',placeholder:'Search movies…'},tv:{type:'tv',placeholder:'Search TV shows…'}};
  const searchRow=document.getElementById('mobSearchRow');
  const mobInput=document.getElementById('mobSearchInput');
  const mainEl=document.querySelector('.main');
  const pageTitles={home:'',movies:'Movies',tv:'TV Shows',continue:'Continue',watchlist:'Watchlist',player:''};
  document.getElementById('mobPageTitle').textContent=pageTitles[page]||'';
  if(searchPages[page]){
    mobSearchType=searchPages[page].type;
    mobInput.placeholder=searchPages[page].placeholder;
    searchRow.classList.add('visible');
    mainEl.classList.add('has-mob-search');
  }else{
    mobSearchType=null;
    searchRow.classList.remove('visible');
    mainEl.classList.remove('has-mob-search');
    mobInput.value='';
  }
  if(page!=='player'){const pf=document.getElementById('playerFrame');if(pf){pf.removeAttribute('src');pf.onload=null;pf.style.opacity='';}const mlt=document.getElementById('moreLikeThisSection');if(mlt)mlt.style.display='none';}
  if(page==='home'){const hsr=document.getElementById('homeSearchResults');if(hsr&&!homeSearch.query)hsr.style.display='none';renderSearchHistory();}
  if(page==='movies'&&!document.getElementById('movieGrid').children.length)loadPage('movie',1);
  if(page==='tv'&&!document.getElementById('tvGrid').children.length)loadPage('tv',1);
  if(page==='watchlist')renderWatchlistPage();
  if(page==='continue')renderContinuePage();
  if(page==='home'){renderHomeContinue();renderHomeWatchlist();}
  if(page==='player'){window.scrollTo(0,0);}
  else{const pos=savedScroll[page];window.scrollTo(0,pos!=null?pos:0);}
  handleBackToTop();
}

function goBack(){switchPage(previousPage);}

function mobDoSearch(){
  if(!mobSearchType)return;
  const q=document.getElementById('mobSearchInput').value.trim();
  const desktopInput=document.getElementById(mobSearchType==='movie'?'movieSearch':'tvSearch');
  if(desktopInput)desktopInput.value=q;
  doSearch(mobSearchType);
}

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
    const data=await fetchJSON(`https://api.themoviedb.org/3/trending/${tmdbType}/week?api_key=x&page=1`);
    const items=(data.results||[]).filter(notAdult).slice(0,14);
    const el=document.getElementById(containerId);
    el.innerHTML='';
    items.forEach(item=>{
      const card=makeCard(item,appType,{showWl:true});
      card.style.flex='0 0 calc((100% - 6*14px)/7)';
      card.style.minWidth='110px';
      card.style.scrollSnapAlign='start';
      el.appendChild(card);
    });
  }catch(e){
    const el=document.getElementById(containerId);
    if(el)el.innerHTML='<div style="color:var(--muted);font-size:0.8rem;padding:1rem;">Failed to load.</div>';
  }
}

async function doSearch(type){
  const q=document.getElementById(type==='movie'?'movieSearch':'tvSearch').value.trim();
  const s=state[type];
  const labelEl=document.getElementById(type==='movie'?'movieResultsLabel':'tvResultsLabel');
  if(!q){s.mode='trending';s.query='';s.page=1;labelEl.textContent='Trending this week';return loadPage(type,1);}
  s.mode='search';s.query=q;s.page=1;labelEl.textContent='"'+sanitize(q)+'"';
  addToSearchHistory(q);
  await loadPage(type,1);
}

async function doHomeSearch(){
  const q=document.getElementById('homeSearchInput').value.trim();
  if(!q){clearHomeSearch();return;}
  homeSearch.query=q;homeSearch.page=1;
  addToSearchHistory(q);
  await loadHomeSearch(1);
}
async function loadHomeSearch(page){
  if(homeSearch.loading)return;
  homeSearch.loading=true;
  const resultsEl=document.getElementById('homeSearchResults');
  const gridEl=document.getElementById('homeSearchGrid');
  const msgEl=document.getElementById('homeSearchMsg');
  const pagEl=document.getElementById('homeSearchPagination');
  const labelEl=document.getElementById('homeSearchLabel');
  resultsEl.style.display='block';
  gridEl.innerHTML='';pagEl.style.display='none';msgEl.style.display='none';
  renderSkeletonGrid(gridEl);
  labelEl.textContent=`"${homeSearch.query}"`;
  const q=encodeURIComponent(homeSearch.query);
  let dm,dt;
  try{
    const mkMovie=(p)=>`https://api.themoviedb.org/3/search/movie?api_key=x&page=${p}&query=${q}`;
    const mkTv=(p)=>`https://api.themoviedb.org/3/search/tv?api_key=x&page=${p}&query=${q}`;
    [dm,dt]=await Promise.all([fetchJSON(mkMovie(page)),fetchJSON(mkTv(page))]);
  }catch(err){
    console.error('[screenify] home search failed',err);
    gridEl.innerHTML='';msgEl.style.display='block';msgEl.textContent='Something went wrong. Please try again.';
    homeSearch.loading=false;return;
  }
  homeSearch.totalPages=Math.max(Math.min((dm&&dm.total_pages)||1,500),Math.min((dt&&dt.total_pages)||1,500));
  const movies=((dm&&dm.results)||[]).filter(notAdult).map(r=>({...r,_homeType:'movie'}));
  const shows=((dt&&dt.results)||[]).filter(notAdult).map(r=>({...r,_homeType:'tv'}));
  const interleaved=[];
  const len=Math.max(movies.length,shows.length);
  for(let i=0;i<len;i++){if(i<movies.length)interleaved.push(movies[i]);if(i<shows.length)interleaved.push(shows[i]);}
  const isMobile=window.innerWidth<=768;
  const cols=isMobile?3:7;
  const items=interleaved.slice(0,Math.floor(interleaved.length/cols)*cols||interleaved.length);
  msgEl.style.display='none';homeSearch.page=page;
  gridEl.innerHTML='';
  if(!items.length){msgEl.style.display='block';msgEl.innerHTML='No results found.';}
  else{items.forEach(item=>gridEl.appendChild(makeHomeCard(item)));}
  renderHomeSearchPagination();
  resultsEl.scrollIntoView({behavior:'smooth',block:'start'});
  homeSearch.loading=false;
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
function renderHomeSearchPagination(){
  buildPagination(document.getElementById('homeSearchPagination'),homeSearch.page,homeSearch.totalPages,(pg)=>loadHomeSearch(pg));
}
function clearHomeSearch(){
  homeSearch.query='';homeSearch.page=1;
  document.getElementById('homeSearchInput').value='';
  document.getElementById('homeSearchResults').style.display='none';
  document.getElementById('homeSearchGrid').innerHTML='';
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
  const endpoint=s.mode==='trending'?(type==='movie'?'trending/movie/week':'trending/tv/week'):(type==='movie'?'search/movie':'search/tv');
  const mkUrl=(p)=>{let u=`https://api.themoviedb.org/3/${endpoint}?api_key=x&page=${p}`;if(s.mode==='search')u+='&query='+encodeURIComponent(s.query);return u;};
  const cols=window.innerWidth<=768?3:7;
  let items=[];
  try{
    const d1=await fetchJSON(mkUrl(page));
    if(s.mode==='search')s.totalPages=Math.min(d1.total_pages||1,500);
    const page1=(d1.results||[]).filter(notAdult);
    items=page1.slice();
    // Only fetch a second page when the first leaves a partial final row to fill (e.g. mobile).
    const remainder=page1.length%cols;
    if(remainder>0){
      const needed=cols-remainder;
      try{
        const d2=await fetchJSON(mkUrl(page+1));
        items=items.concat((d2.results||[]).filter(notAdult).slice(0,needed));
      }catch(err){console.warn('[screenify] second page fetch failed (optional), using page 1 alone',err);}
    }
    s.page=page;
  }catch(err){
    console.error('[screenify] load failed',err);
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
      <div class="hover-rating">${rating?'&#9733; '+rating:''}</div>
      ${tvMeta}
      ${overview?`<div class="hover-synopsis">${sanitize(overview)}</div>`:''}
    </div>
    <div class="card-info"><div class="card-title">${sanitize(title)}</div><div class="card-year">${year}</div></div>`;
  if(opts.showWl){
    const wlBtn=div.querySelector('.card-wl-btn');
    wlBtn.addEventListener('click',(e)=>{
      e.stopPropagation();
      toggleWatchlistItem({...item,type});
      const nowInList=wlBtn.classList.contains('in-list');
      wlBtn.classList.toggle('in-list');
      wlBtn.innerHTML=wlBtn.classList.contains('in-list')?'&#9829;':'&#9825;';
      wlBtn.title=wlBtn.classList.contains('in-list')?'Remove from watchlist':'Add to watchlist';
      showToast(nowInList?'Removed from Watchlist':'Added to Watchlist', nowInList?'wl-removed':'wl-added');
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
  div.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectItem(item,type,div);}});
  return div;
}

function renderPagination(type){
  const el=document.getElementById(type==='movie'?'moviePagination':'tvPagination');
  const s=state[type];
  buildPagination(el,s.page,s.totalPages,(pg)=>loadPage(type,pg));
}

const PAGE_LABELS={home:'Home',movies:'Movies',tv:'TV Shows',continue:'Continue Watching',watchlist:'Watchlist'};

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
      <span class="meta-sub">${year}${rating?` &middot; &#9733; ${rating}`:''}</span>
      <p class="player-overview" id="playerOverview">${sanitize(overview)||'<span style="opacity:0.35">Loading…</span>'}</p>
      <button class="wl-btn ${isInWatchlist(item.id)?'in-list':''}" onclick="toggleWatchlistFromPlayer('${type}')">
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
  toggleWatchlistItem({...item,type});
  const btn=document.querySelector('#page-player .wl-btn');
  if(btn){const inList=isInWatchlist(item.id);btn.classList.toggle('in-list',inList);btn.innerHTML=`<span class="wl-icon"></span> ${inList?'In Watchlist':'Add to Watchlist'}`;}
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

async function renderContinuePage(){
  const list=getContinueList();
  const listEl=document.getElementById('cwPageList');
  const empty=document.getElementById('cwPageEmpty');
  listEl.innerHTML='';
  if(!list.length){empty.style.display='block';return;}
  empty.style.display='none';
  for(const item of list){
    const resume=getResume(item.id,item.type);
    const pct=(resume&&resume.duration&&resume.currentTime)?Math.min(100,Math.round((resume.currentTime/resume.duration)*100)):null;
    const row=document.createElement('div');
    row.className='cw-item';
    const thumbId='cw-thumb-'+item.id;
    let thumbHtml;
    if(item.type==='tv'){thumbHtml=`<div class="cw-thumb-ep-fallback" id="${thumbId}">&#128250;</div>`;}
    else{const posterUrl=item.poster?IMG_SM+item.poster:null;thumbHtml=posterUrl?`<img class="cw-thumb-poster" src="${posterUrl}" alt="${sanitize(item.title)}" loading="lazy">`:`<div class="cw-thumb-poster-fallback">&#127916;</div>`;}
    const subLabel=`${item.type==='movie'?'Movie':'TV Show'}${item.year?' &middot; '+item.year:''}`;
    const progressHtml=pct!==null?(()=>{
      const epPart=item.type==='tv'?`${sanitize(resume.label)} &middot; `:'';
      return`<div class="cw-progress-bar"><div class="cw-progress-fill" style="width:${pct}%"></div></div><div class="cw-progress-label">${epPart}${pct}% &middot; <span class="cw-timestamp">stopped at ${sanitize(resume.timeLabel)}</span></div>`;
    })():`<div class="cw-progress-label" style="color:var(--muted);">Not started</div>`;
    const overviewId='cw-overview-'+item.id;
    row.innerHTML=`${thumbHtml}<div class="cw-info"><div class="cw-title">${sanitize(item.title)}</div><div class="cw-sub">${subLabel}</div><p class="cw-overview" id="${overviewId}"></p>${progressHtml}</div><div class="cw-actions"><button class="cw-resume-btn">&#9654; Resume</button><button class="cw-remove-btn" title="Remove">&#10005;</button></div>`;
    row.querySelector('.cw-resume-btn').addEventListener('click',(e)=>{e.stopPropagation();selectItem(item,item.type,null);});
    row.querySelector('.cw-remove-btn').addEventListener('click',(e)=>{e.stopPropagation();showRemoveConfirmModal(item);});
    row.addEventListener('click',()=>{selectItem(item,item.type,null);});
    listEl.appendChild(row);
    if(item.type==='tv'&&resume&&resume.season&&resume.episode){
      fetchEpisodeThumb(item.id,resume.season,resume.episode).then(({still,overview})=>{
        const placeholder=document.getElementById(thumbId);if(!placeholder)return;
        if(still){const img=document.createElement('img');img.className='cw-thumb-ep';img.src=IMG_SM+still;img.alt=item.title;img.loading='lazy';placeholder.replaceWith(img);}
        else if(item.poster){const img=document.createElement('img');img.className='cw-thumb-poster';img.src=IMG_SM+item.poster;img.alt=item.title;img.loading='lazy';placeholder.replaceWith(img);}
        const ovEl=document.getElementById(overviewId);if(ovEl&&overview)ovEl.textContent=overview;
      });
    }else if(item.type==='movie'){
      fetchMovieOverview(item.id).then(overview=>{const ovEl=document.getElementById(overviewId);if(ovEl&&overview)ovEl.textContent=overview;});
    }
  }
}

async function fetchEpisodeThumb(showId,season,episode){
  try{const data=await fetchJSON(`https://api.themoviedb.org/3/tv/${showId}/season/${season}/episode/${episode}?api_key=x`);return{still:data.still_path||null,overview:data.overview||''};}catch{return{still:null,overview:''};}}

async function fetchMovieOverview(movieId){
  try{const data=await fetchJSON(`https://api.themoviedb.org/3/movie/${movieId}?api_key=x`);return data.overview||'';}catch{return'';}
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
  if(currentPage==='watchlist')renderWatchlistPage();
  if(currentPage==='home')renderHomeWatchlist();
}
function renderHomeWatchlist(){
  const list=getWatchlist();
  const wrap=document.getElementById('home-watchlist-wrap');
  const grid=document.getElementById('home-watchlistGrid');
  if(!list.length){wrap.style.display='none';return;}
  wrap.style.display='block';grid.innerHTML='';
  list.forEach(item=>{
    const card=makeCard(item,item.type,{showWl:true});
    card.style.flex='0 0 calc((100% - 6*14px)/7)';
    card.style.minWidth='110px';card.style.scrollSnapAlign='start';
    grid.appendChild(card);
  });
}
function renderWatchlistPage(){
  const list=getWatchlist();
  const grid=document.getElementById('watchlistPageGrid');
  const empty=document.getElementById('watchlistPageEmpty');
  grid.innerHTML='';
  if(!list.length){empty.style.display='block';return;}
  empty.style.display='none';
  list.forEach(item=>grid.appendChild(makeCard(item,item.type,{showWl:true})));
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
    if(currentPage==='home')renderHomeWatchlist();
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
  renderHomeContinue();renderHomeWatchlist();
  loadHomeTrendingRow('movie','home-moviesRow');
  loadHomeTrendingRow('tv','home-tvRow');
  renderSearchHistory();
  setupSearchHistoryEvents();
  switchPage('home');
  setupKeyboardShortcuts();
  handleBackToTop();
  document.querySelectorAll('.nav-item').forEach(n=>{
    n.setAttribute('tabindex','0');n.setAttribute('role','button');
    n.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();n.click();}});
  });
})();
