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
    if(idx>=0){
      matched=list[idx];
      if(idx>0){
        list.splice(idx,1);
        list.unshift(matched);
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
function openRecentPanel(){const el=document.getElementById('searchPageRecent');if(el)el.classList.add('open');}
function closeRecentPanel(){const el=document.getElementById('searchPageRecent');if(el)el.classList.remove('open');}
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
  const pageTitles={home:'',search:'Search',movies:'Movies',tv:'TV Shows',continue:'Continue',watchlist:'Watchlist',player:''};
  document.getElementById('mobPageTitle').textContent=pageTitles[page]||'';
  if(page!=='player'){const pf=document.getElementById('playerFrame');if(pf){pf.removeAttribute('src');pf.onload=null;pf.style.opacity='';}const mlt=document.getElementById('moreLikeThisSection');if(mlt)mlt.style.display='none';}
  if(page==='search'){
    renderRecentSearches();
    const inp=document.getElementById('searchInput');
    if(inp&&!searchPage.query&&window.innerWidth>768)setTimeout(()=>inp.focus(),60);
  }
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
async function loadFeaturedDetails(item){
  const type=item._homeType;
  const key=type+':'+item.id;
  if(featuredDetailsCache[key])return featuredDetailsCache[key];
  try{
    const data=await fetchJSON(`https://api.themoviedb.org/3/${type}/${item.id}?api_key=x`);
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
  const details=await loadFeaturedDetails(item);
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
  wlBtn.addEventListener('click',(e)=>{
    e.stopPropagation();
    toggleWatchlistItem({...full,type});
    const nowInList=wlBtn.classList.contains('in-list');
    wlBtn.classList.toggle('in-list');
    wlBtn.innerHTML=`<span class="wl-icon"></span> ${wlBtn.classList.contains('in-list')?'In Watchlist':'Watchlist'}`;
    showToast(nowInList?'Removed from Watchlist':'Added to Watchlist',nowInList?'wl-removed':'wl-added');
  });
}
async function performSearch(explicitQuery){
  const input=document.getElementById('searchInput');
  const q=(explicitQuery!==undefined?explicitQuery:(input?input.value:'')).trim();
  if(input)input.value=q;
  if(!q){resetSearchResults();return;}
  closeRecentPanel();
  searchPage.query=q;searchPage.page=1;
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
    console.error('[screenify] search failed',err);
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
  if(page===1)resultsEl.scrollIntoView({behavior:'smooth',block:'start'});
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
  renderRecentSearches();
  setupSearchEvents();
  switchPage('home');
  setupKeyboardShortcuts();
  handleBackToTop();
  document.querySelectorAll('.nav-item').forEach(n=>{
    n.setAttribute('tabindex','0');n.setAttribute('role','button');
    n.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();n.click();}});
  });
})();
