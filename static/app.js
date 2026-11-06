'use strict';
/* 임상실습 배치 관리 — 화면 */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const S={students:[],institutions:[],terms:[],placements:[],weights:{...DEFAULT_W},users:[]};
const ui={year:new Date().getFullYear(),grade:3,tab:'history',placeTerm:null,result:null,cfg:null,seed:1,view:'student',instCourse:'adult',pq:'',hq:'',hf:'all',sq:''};
const COURSE_NAMES={adult:'성인간호학실습(2)',women:'여성건강간호학실습',child:'아동간호학실습'};

function toast(m){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,3200);}
async function api(method,url,data){
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-Requested-With':'fetch'},body:data?JSON.stringify(data):undefined,credentials:'same-origin'});
  if(r.status===401){location.href='/login';throw new Error('로그인이 필요합니다.');}
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||('요청을 처리하지 못했습니다 ('+r.status+')'));
  return j;
}
async function act(fn,okMsg){try{const r=await fn();if(okMsg)toast(typeof okMsg==='function'?okMsg(r):okMsg);return r;}catch(e){toast(e.message);return null;}}

/* ---------- 공통 표기 ---------- */
let dupNames=new Set();
function refreshDup(){const c={};CS().forEach(s=>c[s.name]=(c[s.name]||0)+1);dupNames=new Set(Object.keys(c).filter(k=>c[k]>1));}
function disp(s,html=true){const no=String(s.student_no||s.id||'');const base=s.name+(dupNames.has(s.name)?'('+no.slice(-3)+')':'');if(!html)return base+(s.sex==='남'?'(남)':'');return esc(base)+(s.sex==='남'?'<span class="male">(남)</span>':'');}
function shortInst(name){const k=instKey(name);const i=S.institutions.find(x=>instKey(x.name)===k||instKey(x.short)===k);return i?(i.short||i.name):String(name).replace(/병원$/,'');}
function shortAddr(a){const t=String(a||'').trim().split(/\s+/);return t.slice(0,2).join(' ');}
function cShort(c){const m=String(c||'').match(/성인|노인|여성|모성|아동|정신|지역|관리/);return m?m[0]:(String(c||'').replace(/간호학실습|실습/g,'')||'실습');}
function cClass(c){return /성인/.test(c)?'c-adult':/여성|모성/.test(c)?'c-women':/아동/.test(c)?'c-child':'c-other';}
const courseOf=k=>COURSES.find(c=>c.key===k);
function tagHtml(tags){return tags.map(([c,t])=>`<span class="tag ${c}">${esc(t)}</span>`).join('');}
function saveXlsx(wb,name){if(typeof XLSX==='undefined'){toast('엑셀 도구를 불러오지 못했습니다. 인터넷 연결을 확인하세요.');return;}XLSX.writeFile(wb,name);}
const today=()=>new Date().toISOString().slice(0,10);
/* ---------- 학년도·학년(기수) ---------- */
// 기수 = year3년에 3학년인 학생들. 학년도 Y의 3학년은 year3=Y, 4학년은 year3=Y-1.
function C(){const y3=ui.grade===3?ui.year:ui.year-1;return (S.cohorts||[]).find(c=>c.year3===y3)||null;}
function CS(){const c=C();return c?S.students.filter(s=>s.cohort_id===c.id):[];}
const sortedTerms=()=>{const c=C();return c?S.terms.filter(t=>t.cohort_id===c.id).sort((a,b)=>a.sort-b.sort||a.id-b.id):[];};
const cohortTag=()=>`${ui.year}학년도_${ui.grade}학년`;
function saveUi(){try{localStorage.setItem('clinic-cohort',JSON.stringify({year:ui.year,grade:ui.grade}));}catch(e){}}
function loadUi(){try{const v=JSON.parse(localStorage.getItem('clinic-cohort')||'null');if(v&&v.year&&v.grade){ui.year=+v.year;ui.grade=+v.grade;}}catch(e){}}
function yearsRange(){const ys=(S.cohorts||[]).map(c=>c.year3),now=new Date().getFullYear();const lo=Math.min(now,...ys),hi=Math.max(now+1,...ys.map(y=>y+1));const out=[];for(let y=lo;y<=hi;y++)out.push(y);return out;}
function pickPlaceTerm(){const ts=sortedTerms();if(ts.some(t=>t.id===ui.placeTerm))return;const t=ts.find(t=>!t.count)||ts.slice(-1)[0];ui.placeTerm=t?t.id:null;}
function onCohortChange(){saveUi();ui.result=null;ui.placeTerm=null;pickPlaceTerm();refreshDup();renderAll();}
function renderCohortBar(){
  const c=C(),n=CS().length,y3=ui.grade===3?ui.year:ui.year-1;
  const desc=c?`${c.year3}년 3학년 1·2학기 → ${c.year3+1}년 4학년 1학기 · 학생 ${n}명`:'';
  $('#cohortBar').innerHTML=`<div class="cohortbar">
    <label for="yearSel"><b>학년도</b></label><select id="yearSel">${yearsRange().map(y=>`<option value="${y}" ${y===ui.year?'selected':''}>${y}학년도</option>`).join('')}</select>
    <div class="seg" role="group" aria-label="학년"><button type="button" data-grade="3" aria-pressed="${ui.grade===3}">3학년</button><button type="button" data-grade="4" aria-pressed="${ui.grade===4}">4학년</button></div>
    <span class="cohort-desc">${c?`<b>${ui.year}학년도 ${ui.grade}학년</b> · ${esc(desc)}`:`<b>${ui.year}학년도 ${ui.grade}학년</b> 기수(${y3}년 3학년)가 아직 없습니다.`}</span>
    ${c?'':`<button type="button" class="primary" id="btnMakeCohort">${y3}년 3학년 기수 만들기</button>`}</div>`;
  $('#yearSel').onchange=e=>{ui.year=+e.target.value;onCohortChange();};
  document.querySelectorAll('#cohortBar [data-grade]').forEach(b=>b.onclick=()=>{ui.grade=+b.dataset.grade;onCohortChange();});
  const mk=$('#btnMakeCohort');if(mk)mk.onclick=async()=>{const j=await act(()=>api('POST','/api/cohorts',{year3:y3}),`${y3}년 3학년 기수를 만들었습니다. 학생 명단을 올리세요.`);if(j){S.cohorts=j.cohorts;S.terms=j.terms;onCohortChange();}};
}
function noCohort(el){if(C())return false;el.innerHTML=`<div class="panel empty">위에서 <b>${ui.year}학년도 ${ui.grade}학년</b> 기수를 먼저 만드세요.</div>`;return true;}

/* ---------- 시작 ---------- */
async function boot(){
  try{Object.assign(S,await api('GET','/api/bootstrap'));}
  catch(e){$('#tab-history').innerHTML=`<div class="panel"><div class="errbox">${esc(e.message)}</div></div>`;return;}
  $('#storageWarn').hidden=!!S.persistent;$('#tabUsers').hidden=!S.canManage;
  if(S.me.must_change){forcePw();return;}
  if(!ui.loaded){ui.loaded=true;loadUi();}
  pickPlaceTerm();refreshDup();renderAll();
}
function forcePw(){
  document.querySelector('nav.tabs').hidden=true;['history','place','students','insts','terms','users'].forEach(t=>$('#tab-'+t).hidden=true);
  const box=document.createElement('section');box.className='panel stack';box.style.maxWidth='460px';
  box.innerHTML=`<h2>새 비밀번호를 정하세요</h2><p class="hint">${esc(S.me.name)}(${esc(S.me.role)}) 계정의 첫 로그인입니다. 받은 처음 비밀번호를 본인만 아는 비밀번호로 바꿔야 쓸 수 있습니다.</p>
    <form id="fpw" class="stack"><label for="fp-cur" class="hint">처음 비밀번호<input id="fp-cur" type="password" autocomplete="current-password" required></label>
    <label for="fp-new" class="hint">새 비밀번호 (8자 이상)<input id="fp-new" type="password" autocomplete="new-password" minlength="8" required></label>
    <label for="fp-new2" class="hint">새 비밀번호 확인<input id="fp-new2" type="password" autocomplete="new-password" minlength="8" required></label>
    <button class="primary" type="submit">비밀번호 바꾸고 시작하기</button></form>`;
  document.querySelector('.wrap').appendChild(box);
  $('#fpw').onsubmit=async e=>{e.preventDefault();if($('#fp-new').value!==$('#fp-new2').value){toast('새 비밀번호가 서로 다릅니다.');return;}
    const j=await act(()=>api('PUT','/api/me/password',{current:$('#fp-cur').value,new:$('#fp-new').value}),'비밀번호를 바꿨습니다.');
    if(j){box.remove();document.querySelector('nav.tabs').hidden=false;S.me.must_change=0;document.querySelector('[data-tab=history]').click();boot();}};
}
function renderAll(){renderCohortBar();renderHistory();renderPlace();renderStudents();renderInsts();renderTerms();renderUsers();}
document.querySelectorAll('[role=tab]').forEach(b=>b.onclick=()=>{
  ui.tab=b.dataset.tab;
  document.querySelectorAll('[role=tab]').forEach(x=>x.setAttribute('aria-selected',x===b));
  ['history','place','students','insts','terms','users'].forEach(t=>$('#tab-'+t).hidden=t!==ui.tab);
});
$('#btnMyPw').onclick=async()=>{
  const cur=prompt('지금 비밀번호');if(cur==null)return;
  const nw=prompt('새 비밀번호 (8자 이상)');if(nw==null)return;
  const nw2=prompt('새 비밀번호 확인');if(nw2==null)return;
  if(nw!==nw2){toast('새 비밀번호가 서로 다릅니다.');return;}
  act(()=>api('PUT','/api/me/password',{current:cur,new:nw}),'비밀번호를 바꿨습니다.');
};

/* ---------- 학생별 실습 이력 (스케치: 학번·이름 | 인적사항 | 3-1 | 3-2 | 4-1) ---------- */
function termColumns(terms,pls){
  return terms.map(t=>{const seqs=pls.filter(p=>p.term_id===t.id).map(p=>p.seq);return {t,n:Math.max(1,t.periods.filter(Boolean).length,...seqs)};});
}
function conflictsOf(list){
  const ward=new Set(),inst=new Set();
  for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
    const a=list[i],b=list[j];if(a.term_id===b.term_id)continue;
    if(instKey(a.institution)!==instKey(b.institution))continue;
    const ca=wardCodes(a.ward),cb=wardCodes(b.ward);const same=[...ca].some(c=>cb.has(c));
    const ka=a.term_id+'-'+a.seq,kb=b.term_id+'-'+b.seq;
    if(same){ward.add(ka);ward.add(kb);}else{inst.add(ka);inst.add(kb);}
  }
  return {ward,inst};
}
function renderHistory(){
  const el=$('#tab-history');
  if(noCohort(el))return;
  if(!CS().length){el.innerHTML=`<div class="panel empty">${ui.year}학년도 ${ui.grade}학년 학생 명단이 비어 있습니다. ‘학생 명단’ 탭에서 엑셀로 올리거나 학생을 추가하세요.</div>`;return;}
  const terms=sortedTerms();const TC=termColumns(terms,S.placements);
  const pm=new Map();S.placements.forEach(p=>{if(!pm.has(p.student_id))pm.set(p.student_id,[]);pm.get(p.student_id).push(p);});
  const rows=CS().map(s=>{const list=pm.get(s.id)||[];return {s,list,cf:conflictsOf(list)};});
  const nWard=rows.filter(r=>r.cf.ward.size).length,nInst=rows.filter(r=>r.cf.inst.size&&!r.cf.ward.size).length;
  const q=ui.hq.trim();
  const shown=rows.filter(({s,list,cf})=>{
    if(q&&!(s.name+s.student_no+(s.addr||'')+(s.note||'')+list.map(p=>p.institution+p.ward).join('')).includes(q))return false;
    if(ui.hf==='ward')return cf.ward.size>0;
    if(ui.hf==='inst')return cf.inst.size>0;
    if(ui.hf==='note')return !!(s.note||'').trim();
    if(ui.hf==='empty')return !list.length;
    return true;});
  const body=shown.map(({s,list,cf})=>{
    const cells=TC.map(({t,n})=>Array.from({length:n},(_,i)=>{
      const p=list.find(x=>x.term_id===t.id&&x.seq===i+1);const key=t.id+'-'+(i+1);
      const cls=cf.ward.has(key)?' dup-ward':cf.inst.has(key)?' prev':'';
      return `<td class="${i===0?'gstart':''}">${p?`<span class="chip ${cClass(p.course)}${cls}" title="${esc(p.period?p.period+' · ':'')}${esc(p.institution)} · ${esc(p.course)}"><b>${esc(cShort(p.course))}</b>${esc(shortInst(p.institution))}<small>${esc(p.ward)}</small></span>`:'<span class="t-empty">–</span>'}</td>`;}).join('')).join('');
    const chk=cf.ward.size?'<span class="badge bad">같은 병동 재배치</span>':cf.inst.size?'<span class="badge warn">같은 기관·다른 병동</span>':(list.length?'<span class="badge ok">겹침 없음</span>':'');
    return `<tr><td class="who"><div style="font-weight:600;white-space:nowrap">${disp(s)}</div><div class="mono" style="color:var(--muted);font-size:11.5px">${esc(s.student_no)}</div></td>
      <td class="info">${esc(s.sex)}${s.age?' · '+s.age+'세':''}${s.gpa!=null?`<br>성적 <span class="mono">${s.gpa}</span>`:''}${s.addr?`<br><span title="${esc(s.addr)}">${esc(shortAddr(s.addr))}</span>`:''}${s.note?`<br><span style="color:var(--ink)">참고: ${esc(s.note)}</span>`:''}</td>${cells}<td>${chk}</td></tr>`;}).join('');
  const h1=`<tr><th rowspan="2" class="who">학번·이름</th><th rowspan="2">인적사항</th>${TC.map(({t,n})=>`<th colspan="${n}" class="grp gstart">${esc(t.label)}</th>`).join('')}<th rowspan="2">점검</th></tr>`;
  const h2=`<tr>${TC.map(({t,n})=>Array.from({length:n},(_,i)=>`<th class="${i===0?'gstart':''}">${i+1}차${t.periods[i]?`<span class="pd">${esc(t.periods[i])}</span>`:''}</th>`).join('')).join('')}</tr>`;
  const nCols=3+TC.reduce((a,c)=>a+c.n,0);
  el.innerHTML=`<div class="metrics">
    <div class="metric"><span class="k">학생</span><span class="v">${CS().length}명</span><span class="d">${terms.map(t=>`${esc(t.label)} ${new Set(S.placements.filter(p=>p.term_id===t.id).map(p=>p.student_id)).size}명`).join(' · ')}</span></div>
    <div class="metric"><span class="k">같은 기관·같은 병동 재배치</span><span class="v" style="color:${nWard?'var(--bad)':'inherit'}">${nWard}명</span><span class="d">절대 불가 조건 · 빨간 테두리</span></div>
    <div class="metric"><span class="k">같은 기관·다른 병동</span><span class="v">${nInst}명</span><span class="d">허용되지만 되도록 피함 · 주황 테두리</span></div>
  </div>
  <div class="toolbar"><input id="hq" type="text" placeholder="이름, 학번, 기관, 병동, 참고로 찾기" value="${esc(ui.hq)}" style="max-width:280px">
    <select id="hf" aria-label="보기 조건"><option value="all">전체 학생</option><option value="ward">같은 병동 재배치</option><option value="inst">같은 기관 재배치</option><option value="note">참고 있는 학생</option><option value="empty">배치 이력 없는 학생</option></select>
    <span class="hint">${shown.length}명 표시</span><span class="spacer"></span><button type="button" id="btnHistX">엑셀로 저장</button></div>
  <div class="tblwrap"><table class="tl"><thead>${h1}${h2}</thead><tbody>${body||`<tr><td colspan="${nCols}" class="empty">조건에 맞는 학생이 없습니다.</td></tr>`}</tbody></table></div>`;
  $('#hf').value=ui.hf;
  $('#hq').oninput=e=>{ui.hq=e.target.value;const pos=e.target.selectionStart;renderHistory();const n=$('#hq');n.focus();n.setSelectionRange(pos,pos);};
  $('#hf').onchange=e=>{ui.hf=e.target.value;renderHistory();};
  $('#btnHistX').onclick=exportHistory;
}
function exportHistory(){
  if(typeof XLSX==='undefined'){toast('엑셀 도구를 불러오지 못했습니다.');return;}
  const terms=sortedTerms();const TC=termColumns(terms,S.placements);
  const head=['학번','이름','성별','성적','연령','주소','참고'];
  TC.forEach(({t,n})=>{for(let i=0;i<n;i++)head.push(`${t.label} ${i+1}차 기관`,'교과목','병동');});
  head.push('점검');
  const pm=new Map();S.placements.forEach(p=>{if(!pm.has(p.student_id))pm.set(p.student_id,[]);pm.get(p.student_id).push(p);});
  const rows=CS().map(s=>{const list=pm.get(s.id)||[];const cf=conflictsOf(list);const r=[s.student_no,disp(s,false),s.sex,s.gpa,s.age,s.addr,s.note];
    TC.forEach(({t,n})=>{for(let i=0;i<n;i++){const p=list.find(x=>x.term_id===t.id&&x.seq===i+1);r.push(p?p.institution:'',p?p.course:'',p?p.ward:'');}});
    r.push(cf.ward.size?'같은 병동 재배치':cf.inst.size?'같은 기관·다른 병동':'');return r;});
  const ws=XLSX.utils.aoa_to_sheet([head,...rows]);ws['!cols']=head.map(h=>({wch:/기관$/.test(h)?22:h==='병동'?18:h==='교과목'?16:h==='주소'||h==='참고'?26:10}));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'학생별 실습 이력');
  saveXlsx(wb,`임상실습_학생별이력_${cohortTag()}_${today()}.xlsx`);
}

/* ---------- 자동 배치 ---------- */
function placeTerm(){return sortedTerms().find(t=>t.id==ui.placeTerm);}
function histTermsFor(T){return sortedTerms().filter(t=>t.id!==T.id&&(t.sort<T.sort||(t.sort===T.sort&&t.id<T.id)));}
function buildCfg(T){
  return {periods:[0,1,2,3].map(i=>T.periods[i]||`${i+1}기간`),w:{...DEFAULT_W,...S.weights},
    insts:S.institutions.map(i=>({id:'i'+i.id,dbid:i.id,course:i.course,name:i.name,short:i.short||i.name,kw:i.kw,caps:i.caps,depts:'',deptArr:i.wards.map(w=>w.name),grade:i.grade,female:i.female,local:i.local}))};
}
function runPlace(newSeed){
  const T=placeTerm();if(!T){toast('배치할 학기를 고르세요.');return;}
  if(!CS().length){toast('이 학년의 학생 명단이 비어 있습니다.');return;}
  if(newSeed)ui.seed=Math.floor(Math.random()*1e9)+1;
  const HT=histTermsFor(T),ht=new Set(HT.map(t=>t.id)),lab=new Map(S.terms.map(t=>[t.id,t.label]));
  const idx=new Map(CS().map((s,k)=>[s.id,k]));
  const st=CS().map(s=>({id:s.student_no,student_no:s.student_no,dbid:s.id,name:s.name,sex:s.sex,gpa:+s.gpa||0,age:+s.age||0,addr:s.addr||'',note:s.note||'',hist:[]}));
  S.placements.forEach(p=>{if(!ht.has(p.term_id))return;const k=idx.get(p.student_id);if(k==null)return;
    st[k].hist.push({term:lab.get(p.term_id),termId:p.term_id,seq:p.seq,inst:p.institution,course:p.course,ward:p.ward,period:p.period,key:instKey(p.institution),codes:[...wardCodes(p.ward)]});});
  ui.cfg=buildCfg(T);
  const r=computePlacement(st,ui.cfg,ui.seed);r.st=st;r.termId=T.id;r.histTerms=HT;ui.result=r;
  refreshDup();renderPlace();
}
async function savePlace(){
  const r=ui.result;if(!r)return;const T=S.terms.find(t=>t.id===r.termId);if(!T)return;
  if(r.stats.placed<r.stats.n&&!confirm(`배치하지 못한 학생이 ${r.stats.n-r.stats.placed}명 있습니다. 그래도 저장할까요?`))return;
  if(T.count&&!confirm(`${T.label}에 이미 저장된 배치 ${T.count}건을 이번 결과로 바꿉니다. 계속할까요?`))return;
  const pl=[];r.st.forEach((s,k)=>r.slots[k].forEach((x,p)=>{if(x)pl.push({student_id:s.dbid,seq:p+1,period:ui.cfg.periods[p],institution:x.inst.name,course:courseOf(x.course).label,ward:x.dept});}));
  const j=await act(()=>api('PUT',`/api/terms/${T.id}/placements`,{placements:pl,replace_all:true}),j=>`${T.label} 배치 ${j.saved}건을 저장했습니다.`);
  if(j){S.terms=j.terms;S.placements=j.placements;renderAll();}
}
function periodHead(){return ui.cfg.periods.map((p,i)=>`<th class="${i===0?'gstart':''}">${i+1}기간<span class="pd">${esc(p)}</span></th>`).join('');}
function renderPlace(){
  const el=$('#tab-place');if(noCohort(el))return;const T=placeTerm();const terms=sortedTerms();
  const HT=T?histTermsFor(T):[];
  const W={...DEFAULT_W,...S.weights};
  const wIn=(k,l,h)=>`<label for="w-${k}"><b>${l}</b><input id="w-${k}" type="number" data-w="${k}" value="${W[k]}" min="0">${h}</label>`;
  const r=ui.result&&T&&ui.result.termId===T.id?ui.result:null;
  el.innerHTML=`<div class="panel stack">
    <div class="toolbar"><label for="placeTerm" style="font-weight:600">배치할 학기</label>
      <select id="placeTerm">${terms.map(t=>`<option value="${t.id}" ${T&&t.id===T.id?'selected':''}>${esc(t.label)}</option>`).join('')}</select>
      <span class="spacer"></span>
      <button type="button" class="primary" id="btnRun">배치 실행</button>
      <button type="button" class="ghost" id="btnRerun" ${r?'':'disabled'} title="같은 조건에서 동점인 학생들의 조합만 바꿉니다">다른 조합 보기</button>
      <button type="button" id="btnSave" ${r?'':'disabled'}>이 학기 배치로 저장</button>
      <button type="button" id="btnPlaceX" ${r?'':'disabled'}>엑셀로 저장</button></div>
    <p class="hint">반영하는 이전 학기: ${HT.length?HT.map(t=>`<b>${esc(t.label)}</b> (${t.count}건)`).join(', '):'없음'}. 이전 학기와 같은 기관·같은 병동은 절대 배치하지 않고, 같은 기관은 되도록 피합니다.
    ${T&&T.count?`<br><span style="color:var(--warn)">${esc(T.label)}에는 저장된 배치 ${T.count}건이 있습니다. 저장하면 새 결과로 바뀝니다.</span>`:''}
    <br>자동 배치는 성인 4주(연속) + 여성 2주 + 아동 2주 구조를 따릅니다. 구조가 다른 학기는 ‘학기·이력 가져오기’에서 엑셀로 올려 관리하세요.</p>
    <details><summary style="cursor:pointer;font-weight:600">배치 기준 점수</summary>
      <div class="weights" style="margin-top:10px">
        ${wIn('grade','성적 우선 점수','<span>성적우선 기관에서 1등이 받는 점수(꼴찌 0)</span>')}
        ${wIn('local','지역 연고 점수','<span>지역우선 기관의 지역이 주소에 있을 때</span>')}
        ${wIn('age','만학도 점수','<span>지역우선 기관에서 기준 나이 이상일 때</span>')}
        ${wIn('ageCut','만학도 기준 나이','<span>이 나이 이상을 만학도로 봅니다</span>')}
        ${wIn('addr','주소지 인근 점수','<span>그 밖의 기관에서 주소에 지역이 있을 때</span>')}
        ${wIn('same','이전 기관 감점','<span>이전 학기와 같은 기관(다른 병동)일 때 빼는 점수</span>')}
      </div></details>
  </div><div id="placeBody" class="stack"></div>`;
  $('#placeTerm').onchange=e=>{ui.placeTerm=+e.target.value;renderPlace();};
  $('#btnRun').onclick=()=>{runPlace();toast('배치를 마쳤습니다. 확인 후 저장하세요.');};
  $('#btnRerun').onclick=()=>{runPlace(true);toast('같은 조건으로 다른 조합을 만들었습니다.');};
  $('#btnSave').onclick=savePlace;$('#btnPlaceX').onclick=exportPlace;
  el.querySelectorAll('[data-w]').forEach(x=>x.onchange=async()=>{const j=await act(()=>api('PUT','/api/settings',{weights:{[x.dataset.w]:x.value}}),'기준 점수를 저장했습니다. 배치를 다시 실행하세요.');if(j)S.weights=j.weights;});
  const pb=$('#placeBody');
  if(!r){pb.innerHTML=`<div class="panel empty">${CS().length?'‘배치 실행’을 누르면 결과가 여기에 나옵니다. 저장하기 전까지는 미리보기입니다.':'학생 명단이 비어 있습니다. ‘학생 명단’ 탭에서 먼저 올리세요.'}</div>`;return;}
  const s=r.stats,pct=x=>Math.round(x*100)+'%',nIss=r.issues.filter(i=>i.lv==='bad'||i.lv==='warn').length;
  pb.innerHTML=`<div class="metrics">
    <div class="metric"><span class="k">배치 완료</span><span class="v">${s.placed} / ${s.n}명</span><span class="d">성인 4주 · 여성 2주 · 아동 2주</span></div>
    <div class="metric"><span class="k">성적우선 기관 (성인)</span><span class="v">${s.gradeCount}명</span><span class="d">평균 ${Math.round(s.gradeAvg)}위 · 최하 ${s.gradeWorst}위</span></div>
    <div class="metric"><span class="k">안동·영주 연고 만학도</span><span class="v">${s.strongIn} / ${s.strong}명</span><span class="d">지역 기관 성인 ${s.localIn}명 / ${s.localSeats}석</span></div>
    <div class="metric"><span class="k">이전 학기와 같은 병동</span><span class="v">${s.hasHist?s.sameWard+'건':'–'}</span><span class="d">${s.hasHist?`같은 기관·다른 병동 ${s.sameInstN}명`:'반영할 이전 학기 이력 없음'}</span></div>
    <div class="metric"><span class="k">주소지 인근 배치</span><span class="v">${pct(s.addrRate)}</span><span class="d">지역 키워드가 있는 기관 기준</span></div>
  </div>
  <div class="row"><div class="seg" role="group" aria-label="보기">
    <button type="button" data-view="student" aria-pressed="${ui.view==='student'}">학생별</button>
    <button type="button" data-view="inst" aria-pressed="${ui.view==='inst'}">기관별</button>
    <button type="button" data-view="check" aria-pressed="${ui.view==='check'}">점검${nIss?` <span class="lv warn">${nIss}</span>`:''}</button></div>
    <span class="spacer"></span><div class="legend"><span><i class="dot" style="background:var(--adult)"></i>성인</span><span><i class="dot" style="background:var(--women)"></i>여성</span><span><i class="dot" style="background:var(--child)"></i>아동</span></div></div>
  <div id="viewBody"></div>`;
  pb.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{ui.view=b.dataset.view;renderPlace();});
  const vb=$('#viewBody');
  vb.innerHTML=ui.view==='inst'?instView(r):ui.view==='check'?checkView(r):studentView(r);
  const q=$('#pq');if(q)q.oninput=()=>{ui.pq=q.value;const pos=q.selectionStart;renderPlace();const n=$('#pq');n.focus();n.setSelectionRange(pos,pos);};
  vb.querySelectorAll('[data-ic]').forEach(b=>b.onclick=()=>{ui.instCourse=b.dataset.ic;renderPlace();});
}
function studentView(r){
  const {st,slots}=r;const q=ui.pq.trim();
  const TC=r.histTerms.map(t=>({label:t.label,n:Math.max(1,...st.map(s=>s.hist.filter(h=>h.termId===t.id).length))}));
  const rows=st.map((s,k)=>({s,k})).filter(({s})=>!q||(s.name+s.id+s.addr+s.note).includes(q)).sort((a,b)=>a.s.id.localeCompare(b.s.id,'ko',{numeric:true}));
  const body=rows.map(({s,k})=>{
    const hc=r.histTerms.map((t,ti)=>{const hs=s.hist.filter(h=>h.termId===t.id).sort((a,b)=>a.seq-b.seq);return Array.from({length:TC[ti].n},(_,i)=>{const h=hs[i];
      return `<td class="${i===0?'gstart':''}">${h?`<span class="chip ${cClass(h.course)}"><b>${esc(cShort(h.course))}</b>${esc(shortInst(h.inst))}<small>${esc(h.ward)}</small></span>`:'<span class="t-empty">–</span>'}</td>`;}).join('');}).join('');
    const cells=slots[k].map((x,i)=>`<td class="${i===0?'gstart':''}">`+(x?`<span class="chip c-${x.course}${x.prev?' prev':''}"${x.prev?' title="이전 학기와 같은 기관(다른 병동)"':''}><b>${courseOf(x.course).short}</b>${esc(x.inst.short)}<small>${esc(x.dept)}</small></span>`:'<span class="chip c-none">미배치</span>')+'</td>').join('');
    const tags=[];const seen=new Set();slots[k].forEach(x=>{if(!x)return;x.tags.forEach(t=>{const key=courseOf(x.course).short+t[1];if(t[0]==='fem'||seen.has(key))return;seen.add(key);tags.push([t[0],courseOf(x.course).short+' · '+t[1]]);});});
    return `<tr><td class="who"><div style="font-weight:600;white-space:nowrap">${disp(s)}</div><div class="mono" style="color:var(--muted);font-size:11.5px">${esc(s.id)}</div></td>
      <td class="info">${s.sex} · ${s.age}세<br>성적 <span class="mono">${s.gpa}</span> (${s.rank}위)<br><span title="${esc(s.addr)}">${esc(shortAddr(s.addr))}</span>${s.note?`<br><span style="color:var(--ink)">참고: ${esc(s.note)}</span>`:''}</td>${hc}${cells}<td style="min-width:180px">${tagHtml(tags)}</td></tr>`;}).join('');
  const T=S.terms.find(t=>t.id===r.termId);
  const h1=`<tr><th rowspan="2" class="who">학번·이름</th><th rowspan="2">인적사항</th>${TC.map(t=>`<th colspan="${t.n}" class="grp gstart">${esc(t.label)}</th>`).join('')}<th colspan="4" class="grp gstart now">${esc(T?T.label:'')} · 이번 배치</th><th rowspan="2">반영된 조건</th></tr>`;
  const h2=`<tr>${TC.map(t=>Array.from({length:t.n},(_,i)=>`<th class="${i===0?'gstart':''}">${i+1}차</th>`).join('')).join('')}${periodHead()}</tr>`;
  return `<div class="toolbar" style="margin-bottom:10px"><input id="pq" type="text" placeholder="이름, 학번, 주소, 참고로 찾기" value="${esc(ui.pq)}" style="max-width:280px"><span class="hint">${rows.length}명 표시</span></div>
  <div class="tblwrap"><table class="tl"><thead>${h1}${h2}</thead><tbody>${body||'<tr><td colspan="20" class="empty">찾는 학생이 없습니다.</td></tr>'}</tbody></table></div>`;
}
function instView(r){
  const {st,slots}=r;
  const seg=`<div class="seg" role="group" aria-label="과목" style="margin-bottom:12px">${COURSES.map(c=>`<button type="button" data-ic="${c.key}" aria-pressed="${ui.instCourse===c.key}">${c.label}</button>`).join('')}</div>`;
  const cards=ui.cfg.insts.filter(i=>i.course===ui.instCourse).map(inst=>{
    const D=deptList(inst);
    const cell=(d,p)=>{const ks=slots.map((ss,k)=>k).filter(k=>slots[k][p]&&slots[k][p].inst===inst&&slots[k][p].dept===d);return ks.length?ks.map(k=>disp(st[k])).join('<br>'):'<span style="color:var(--muted)">–</span>';};
    const rows=D.map(d=>`<tr><td style="font-weight:600;min-width:140px">${esc(d)}</td>${[0,1,2,3].map(p=>`<td class="names">${cell(d,p)}</td>`).join('')}</tr>`).join('');
    const cnt=[0,1,2,3].map(p=>{const got=slots.filter(ss=>ss[p]&&ss[p].inst===inst).length,c=cap(inst,p);return `<td class="mono ${got<c?'fill-under':''}">${got} / ${c}명</td>`;}).join('');
    const chips=[inst.grade?'<span class="tag grade">성적 우선</span>':'',inst.female?'<span class="tag fem">여학생만</span>':'',inst.local?'<span class="tag local">지역·만학도 우선</span>':'',kwList(inst).length?`<span class="tag">지역: ${esc(kwList(inst).join(', '))}</span>`:''].join('');
    return `<div class="inst"><div class="inst-h"><h3>${esc(inst.name)}</h3><span class="meta">${D.length}개 병동</span>${chips}</div>
    <div style="overflow-x:auto"><table><thead><tr><th>병동</th>${ui.cfg.periods.map((p,i)=>`<th>${i+1}기간<span class="pd">${esc(p)}</span></th>`).join('')}</tr></thead><tbody>${rows}</tbody><tfoot><tr><td>배정 / 정원</td>${cnt}</tr></tfoot></table></div></div>`;}).join('');
  return seg+`<div class="stack">${cards||'<div class="panel empty">이 과목의 기관이 없습니다.</div>'}</div>`;
}
function checkView(r){
  return `<ul class="issues">${r.issues.map(i=>`<li><span class="lv ${i.lv}">${{bad:'해결 필요',warn:'확인',info:'참고',ok:'충족'}[i.lv]}</span><div>${esc(i.msg)}${i.detail?`<div class="detail">${esc(i.detail)}</div>`:''}</div></li>`).join('')}</ul>
  <p class="hint" style="margin-top:12px">기관별 정원, 여학생 전용, 이전 학기와 같은 기관·같은 병동 금지는 반드시 지킵니다. 그 안에서 이전 학기와 같은 기관은 감점으로 되도록 피하고, 성적우선·지역 연고·만학도·주소지 점수의 합이 가장 커지도록 배치합니다. 성인 실습은 같은 소그룹이 2주 뒤 같은 병원의 다른 병동으로 교대합니다.</p>`;
}
function exportPlace(){
  const r=ui.result;if(!r||typeof XLSX==='undefined')return;
  const {st,slots}=r;const P=ui.cfg.periods;const T=S.terms.find(t=>t.id===r.termId);
  const wb=XLSX.utils.book_new();
  const TC=r.histTerms.map(t=>({t,n:Math.max(1,...st.map(s=>s.hist.filter(h=>h.termId===t.id).length))}));
  const head=['학번','이름','성별','성적','성적순위','연령','주소','참고',...TC.flatMap(({t,n})=>Array.from({length:n},(_,i)=>`${t.label} ${i+1}차`)),...P.map((p,i)=>`${T?T.label:''} ${i+1}기간 (${p})`),'반영된 조건'];
  const rows=st.map((s,k)=>({s,k})).sort((a,b)=>a.s.id.localeCompare(b.s.id,'ko',{numeric:true})).map(({s,k})=>{
    const tags=[...new Set(slots[k].filter(Boolean).flatMap(x=>x.tags.filter(t=>t[0]!=='fem').map(t=>courseOf(x.course).short+' '+t[1])))];
    return [s.id,disp(s,false),s.sex,s.gpa,s.rank,s.age,s.addr,s.note,...TC.flatMap(({t,n})=>{const hs=s.hist.filter(h=>h.termId===t.id).sort((a,b)=>a.seq-b.seq);return Array.from({length:n},(_,i)=>hs[i]?`${cShort(hs[i].course)} / ${hs[i].inst} / ${hs[i].ward}`:'');}),
      ...slots[k].map(x=>x?`${courseOf(x.course).short} / ${x.inst.name} / ${x.dept}`:'미배치'),tags.join(', ')];});
  const ws=XLSX.utils.aoa_to_sheet([head,...rows]);ws['!cols']=head.map(h=>({wch:/기간|차$/.test(h)?32:h==='반영된 조건'?40:h==='주소'||h==='참고'?22:10}));
  XLSX.utils.book_append_sheet(wb,ws,'학생별 배치');
  COURSES.forEach(c=>{
    const aoa=[['기관','병동',...P.map((p,i)=>`${i+1}기간 (${p})`)]];
    ui.cfg.insts.filter(i=>i.course===c.key).forEach(inst=>{
      deptList(inst).forEach(d=>aoa.push([inst.name,d,...[0,1,2,3].map(p=>slots.map((ss,k)=>k).filter(k=>slots[k][p]&&slots[k][p].inst===inst&&slots[k][p].dept===d).map(k=>disp(st[k],false)).join('\n'))]));
      aoa.push([inst.name,'배정 / 정원',...[0,1,2,3].map(p=>`${slots.filter(ss=>ss[p]&&ss[p].inst===inst).length} / ${cap(inst,p)}`)]);});
    const w2=XLSX.utils.aoa_to_sheet(aoa);w2['!cols']=[{wch:18},{wch:20},{wch:24},{wch:24},{wch:24},{wch:24}];
    XLSX.utils.book_append_sheet(wb,w2,c.label.replace(/[\\/?*[\]:]/g,''));});
  const lv={bad:'해결 필요',warn:'확인',info:'참고',ok:'충족'};
  const w3=XLSX.utils.aoa_to_sheet([['구분','내용','상세'],...r.issues.map(i=>[lv[i.lv],i.msg,i.detail||''])]);w3['!cols']=[{wch:10},{wch:70},{wch:90}];
  XLSX.utils.book_append_sheet(wb,w3,'점검');
  saveXlsx(wb,`임상실습_배치표_${cohortTag()}_${(T?T.label:'').replace(/[\s()]/g,'')}_${today()}.xlsx`);
}

/* ---------- 학생 명단 ---------- */
function renderStudents(){
  const el=$('#tab-students');if(noCohort(el))return;
  el.innerHTML=`<div class="panel stack">
    <h2>${ui.year}학년도 ${ui.grade}학년 명단 엑셀로 올리기</h2>
    <p class="hint">첫 시트에서 <b>학번, 이름, 성별, 성적, 연령, 주소, 참고</b> 열을 읽습니다. 연령 대신 생년월일이나 주민등록번호 앞자리가 있어도 됩니다. 같은 학번이 이미 있으면 내용을 새로 고치고, 엑셀의 참고 칸이 비어 있으면 저장된 참고는 그대로 둡니다.</p>
    <label class="drop" id="drop" for="file">파일을 여기로 끌어오거나 눌러서 고르세요<input id="file" type="file" accept=".xlsx,.xls,.csv" hidden></label>
    <div class="row"><button type="button" id="btnTpl">명단 양식 받기</button></div>
  </div>
  <div class="panel stack">
    <h2>한 명씩 추가</h2>
    <form id="addStu" class="grid-form">
      <label for="a-no">학번<input id="a-no" name="student_no" required></label>
      <label for="a-name">이름<input id="a-name" name="name" required></label>
      <label for="a-sex">성별<select id="a-sex" name="sex"><option>여</option><option>남</option></select></label>
      <label for="a-gpa">성적<input id="a-gpa" name="gpa" type="number" step="0.01" min="0"></label>
      <label for="a-age">연령<input id="a-age" name="age" type="number" min="0"></label>
      <label for="a-addr" style="grid-column:span 2">주소<input id="a-addr" name="addr"></label>
      <label for="a-note" style="grid-column:span 2">참고<input id="a-note" name="note" placeholder="예: 예방접종 미완료, 복학생"></label>
      <button class="primary" type="submit">추가</button>
    </form>
  </div>
  <div class="toolbar"><input id="sq" type="text" placeholder="이름, 학번, 주소, 참고로 찾기" value="${esc(ui.sq)}" style="max-width:280px"><span class="hint" id="stuCount"></span><span class="spacer"></span><span class="hint">칸을 고치면 바로 저장됩니다</span></div>
  <div class="tblwrap" id="stuTable"></div>`;
  const f=$('#file'),dr=$('#drop');
  f.onchange=()=>{if(f.files[0])readStudentFile(f.files[0]);f.value='';};
  dr.ondragover=e=>{e.preventDefault();dr.classList.add('over');};dr.ondragleave=()=>dr.classList.remove('over');
  dr.ondrop=e=>{e.preventDefault();dr.classList.remove('over');if(e.dataTransfer.files[0])readStudentFile(e.dataTransfer.files[0]);};
  $('#btnTpl').onclick=()=>{if(typeof XLSX==='undefined')return;const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet([['학번','이름','성별','성적','연령','주소','참고'],['20241001','홍길동','남',3.85,23,'경상북도 안동시','예시 행입니다. 지우고 쓰세요']]);ws['!cols']=[{wch:12},{wch:10},{wch:6},{wch:8},{wch:6},{wch:28},{wch:30}];XLSX.utils.book_append_sheet(wb,ws,'학생명단');saveXlsx(wb,'임상실습_학생명단_양식.xlsx');};
  $('#addStu').onsubmit=async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(e.target).entries());fd.cohort_id=C().id;
    const j=await act(()=>api('POST','/api/students',fd),`${fd.name} 학생을 추가했습니다.`);if(j){S.students=j.students;refreshDup();e.target.reset();renderStuTable();renderHistory();}};
  $('#sq').oninput=e=>{ui.sq=e.target.value;renderStuTable();};
  renderStuTable();
}
function renderStuTable(){
  const box=$('#stuTable');if(!box)return;const q=ui.sq.trim();
  const all=CS();const list=all.filter(s=>!q||(s.name+s.student_no+(s.addr||'')+(s.note||'')).includes(q));
  $('#stuCount').textContent=`${list.length}명 표시 / 전체 ${all.length}명`;
  if(!all.length){box.innerHTML='<div class="empty">아직 학생이 없습니다. 엑셀로 올리거나 한 명씩 추가하세요.</div>';return;}
  const inp=(s,f,type='text',extra='')=>`<input id="s-${s.id}-${f}" data-sid="${s.id}" data-f="${f}" type="${type}" value="${esc(s[f]??'')}" ${extra} aria-label="${f}">`;
  box.innerHTML=`<table class="stbl"><thead><tr><th>학번</th><th>이름</th><th>성별</th><th>성적</th><th>연령</th><th>주소</th><th>참고</th><th></th></tr></thead><tbody>
  ${list.map(s=>`<tr><td style="min-width:100px">${inp(s,'student_no')}</td><td style="min-width:84px">${inp(s,'name')}</td>
    <td><select id="s-${s.id}-sex" data-sid="${s.id}" data-f="sex" aria-label="성별"><option ${s.sex==='여'?'selected':''}>여</option><option ${s.sex==='남'?'selected':''}>남</option></select></td>
    <td style="width:80px">${inp(s,'gpa','number','step="0.01"')}</td><td style="width:64px">${inp(s,'age','number')}</td><td style="min-width:200px">${inp(s,'addr')}</td>
    <td class="note">${inp(s,'note','text','placeholder="필요한 내용 입력"')}</td>
    <td><button type="button" class="ghost danger" data-del="${s.id}">삭제</button></td></tr>`).join('')}</tbody></table>`;
  box.querySelectorAll('[data-f]').forEach(x=>x.onchange=async()=>{
    const sid=+x.dataset.sid,f=x.dataset.f;
    const j=await act(()=>api('PUT',`/api/students/${sid}`,{[f]:x.value}));
    if(j){const i=S.students.findIndex(s=>s.id===sid);S.students[i]=j.student;x.classList.remove('saved');void x.offsetWidth;x.classList.add('saved');refreshDup();renderHistory();}
    else{const s=S.students.find(s=>s.id===sid);x.value=s[f]??'';}
  });
  box.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
    const sid=+b.dataset.del;const s=S.students.find(x=>x.id===sid);const n=S.placements.filter(p=>p.student_id===sid).length;
    if(!confirm(`${s.name}(${s.student_no}) 학생을 지웁니다.${n?` 저장된 배치 이력 ${n}건도 함께 지워집니다.`:''} 계속할까요?`))return;
    const j=await act(()=>api('DELETE',`/api/students/${sid}`),`${s.name} 학생을 지웠습니다.`);
    if(j){S.students=S.students.filter(x=>x.id!==sid);S.placements=S.placements.filter(p=>p.student_id!==sid);refreshDup();renderStuTable();renderHistory();}
  });
}
function readStudentFile(file){
  if(typeof XLSX==='undefined'){toast('엑셀 도구를 불러오지 못했습니다.');return;}
  const fr=new FileReader();
  fr.onload=async()=>{let rows;
    try{const wb=XLSX.read(new Uint8Array(fr.result),{type:'array'});rows=parseStudentRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:false,defval:''}));}
    catch(e){toast('파일을 읽지 못했습니다: '+e.message);return;}
    if(typeof rows==='string'){toast(rows);return;}
    const j=await act(()=>api('POST','/api/students/import',{students:rows,cohort_id:C().id}),j=>`새 학생 ${j.added}명, 고친 학생 ${j.updated}명${j.errors.length?` · 건너뛴 행 ${j.errors.length}개`:''}${j.other.length?` · 다른 학년 명단에 있는 학번 ${j.other.length}명은 건너뜀`:''}`);
    if(j){S.students=j.students;refreshDup();renderStuTable();renderHistory();}
  };
  fr.readAsArrayBuffer(file);
}
function parseStudentRows(rows){
  const hi=rows.findIndex(r=>r.some(c=>/이름|성명/.test(String(c)))&&r.some(c=>/학번/.test(String(c))));
  if(hi<0)return '‘학번’과 ‘이름’ 열을 찾지 못했습니다. 머리글 행을 확인하세요.';
  const h=rows[hi].map(c=>String(c).replace(/\s+/g,'').trim());const col=re=>h.findIndex(c=>re.test(c));
  const C={id:col(/^학번/),name:col(/이름|성명/),sex:col(/성별/),gpa:col(/^성적|평점|평균평점|학점평균|GPA/i),age:col(/연령|나이/),birth:col(/생년|생일|주민/),addr:col(/주소|거주/),note:col(/참고|비고|메모/)};
  const yr=new Date().getFullYear();const out=[];
  rows.slice(hi+1).forEach(r=>{
    const name=String(r[C.name]||'').trim(),no=String(r[C.id]||'').trim();if(!name||!no)return;
    let age=C.age>=0?parseInt(String(r[C.age]).replace(/[^0-9]/g,'')):NaN;
    if(isNaN(age)&&C.birth>=0){const raw=String(r[C.birth]);const d=raw.replace(/[^0-9]/g,'');let y=NaN;
      if(/^\d{4}[-./]/.test(raw.trim())||d.length===8)y=+d.slice(0,4);
      else if(d.length>=6){y=+d.slice(0,2);const g=raw.match(/^\d{6}-?(\d)/);if(g)y+=['1','2','5','6'].includes(g[1])?1900:2000;else y+=y>(yr%100)?1900:2000;}
      if(!isNaN(y))age=yr-y;}
    const o={student_no:no,name};
    if(C.sex>=0)o.sex=String(r[C.sex]).trim();
    if(C.gpa>=0)o.gpa=String(r[C.gpa]).trim();
    if(!isNaN(age))o.age=age;
    if(C.addr>=0)o.addr=String(r[C.addr]||'').trim();
    if(C.note>=0)o.note=String(r[C.note]||'').trim();
    out.push(o);});
  return out.length?out:'학생 행이 없습니다.';
}

/* ---------- 기관·병동 ---------- */
function renderInsts(){
  const el=$('#tab-insts');
  el.innerHTML=`<p class="hint">기관과 병동을 고치면 바로 저장됩니다. 정원은 자동 배치하는 학기의 1~4기간 인원입니다. 지역 키워드는 학생 주소에 그 글자가 들어 있으면 같은 지역으로 봅니다.</p>
  ${COURSES.map(c=>`<div class="panel stack">
    <div class="course-h"><i class="dot" style="background:var(--${c.key})"></i><h2>${c.label}</h2><span class="spacer"></span>
      <form class="addward" data-addinst="${c.key}"><input id="ni-${c.key}" placeholder="새 기관 이름" aria-label="새 기관 이름"><button type="submit">기관 추가</button></form></div>
    ${S.institutions.filter(i=>i.course===c.key).map(instCard).join('')||'<p class="hint">기관이 없습니다.</p>'}
  </div>`).join('')}`;
  el.querySelectorAll('[data-addinst]').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const inp=f.querySelector('input');const name=inp.value.trim();if(!name)return;
    const j=await act(()=>api('POST','/api/institutions',{course:f.dataset.addinst,name}),`${name}을(를) 추가했습니다. 정원과 병동을 입력하세요.`);if(j){S.institutions=j.institutions;renderInsts();}});
  el.querySelectorAll('[data-if]').forEach(x=>x.onchange=async()=>{
    const id=+x.dataset.iid,f=x.dataset.if;const inst=S.institutions.find(i=>i.id===id);let v;
    if(f==='cap'){v=inst.caps.slice();v[+x.dataset.p]=+x.value||0;}else if(x.type==='checkbox')v=x.checked;else v=x.value;
    const j=await act(()=>api('PUT',`/api/institutions/${id}`,{[f==='cap'?'caps':f]:v}));
    if(j){S.institutions=j.institutions;x.classList.remove('saved');void x.offsetWidth;x.classList.add('saved');}
  });
  el.querySelectorAll('[data-delinst]').forEach(b=>b.onclick=async()=>{const id=+b.dataset.delinst;const i=S.institutions.find(x=>x.id===id);
    if(!confirm(`${i.name}(${courseOf(i.course).short})과 병동 ${i.wards.length}개를 지웁니다. 저장된 학생 배치 이력은 그대로 남습니다. 계속할까요?`))return;
    const j=await act(()=>api('DELETE',`/api/institutions/${id}`),`${i.name}을(를) 지웠습니다.`);if(j){S.institutions=j.institutions;renderInsts();}});
  el.querySelectorAll('[data-addw]').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const inp=f.querySelector('input');const name=inp.value.trim();if(!name)return;
    const j=await act(()=>api('POST',`/api/institutions/${f.dataset.addw}/wards`,{name}),`${name} 병동을 추가했습니다.`);if(j){S.institutions=j.institutions;renderInsts();const n=document.getElementById(inp.id);if(n)n.focus();}});
  el.querySelectorAll('[data-delw]').forEach(b=>b.onclick=async()=>{
    const j=await act(()=>api('DELETE',`/api/wards/${b.dataset.delw}`),`${b.dataset.name} 병동을 지웠습니다.`);if(j){S.institutions=j.institutions;renderInsts();}});
}
function instCard(i){
  return `<div class="inst-card">
    <div class="inst-grid">
      <label for="in-${i.id}">기관명<input id="in-${i.id}" data-iid="${i.id}" data-if="name" value="${esc(i.name)}"></label>
      <label for="is-${i.id}">약칭<input id="is-${i.id}" data-iid="${i.id}" data-if="short" value="${esc(i.short)}"></label>
      <label for="ik-${i.id}">지역 키워드<input id="ik-${i.id}" data-iid="${i.id}" data-if="kw" value="${esc(i.kw)}" placeholder="예: 안동, 영주"></label>
      ${[0,1,2,3].map(p=>`<label for="ic-${i.id}-${p}">${p+1}기간<input id="ic-${i.id}-${p}" type="number" min="0" data-iid="${i.id}" data-if="cap" data-p="${p}" value="${i.caps[p]}"></label>`).join('')}
    </div>
    <div class="flags">
      <label><input type="checkbox" id="ig-${i.id}" data-iid="${i.id}" data-if="grade" ${i.grade?'checked':''}>성적 우선</label>
      <label><input type="checkbox" id="if-${i.id}" data-iid="${i.id}" data-if="female" ${i.female?'checked':''}>여학생만</label>
      <label><input type="checkbox" id="il-${i.id}" data-iid="${i.id}" data-if="local" ${i.local?'checked':''}>지역·만학도 우선</label>
      <span class="spacer"></span><button type="button" class="ghost danger" data-delinst="${i.id}">기관 삭제</button>
    </div>
    <div class="wards"><span class="hint" style="margin-right:4px">병동</span>
      ${i.wards.map(w=>`<span class="ward">${esc(w.name)}<button type="button" data-delw="${w.id}" data-name="${esc(w.name)}" aria-label="${esc(w.name)} 삭제" title="삭제">×</button></span>`).join('')||'<span class="hint">병동이 없습니다</span>'}
      <form class="addward" data-addw="${i.id}"><input id="aw-${i.id}" placeholder="병동 추가" aria-label="${esc(i.name)} 병동 추가"><button type="submit">추가</button></form>
    </div>
  </div>`;
}

/* ---------- 학기·이력 가져오기 ---------- */
function renderTerms(){
  const el=$('#tab-terms');if(noCohort(el))return;const terms=sortedTerms();
  el.innerHTML=`<div class="panel stack">
    <h2>${ui.year}학년도 ${ui.grade}학년 기수의 학기</h2>
    <p class="hint">한 기수는 3학년 1학기, 3학년 2학기, 4학년 1학기를 차례로 거칩니다. 학생별 실습 이력은 이 순서대로 왼쪽부터 보이고, 자동 배치는 앞선 학기를 이전 학기로 반영합니다. 학기마다 지난 배치표(엑셀)를 올려 이력을 쌓을 수 있습니다. 배치이력 검토표처럼 학기 열이 있는 파일은 학기 이름이 맞는 곳으로 나눠 들어갑니다. 필요하면 학기를 더 추가할 수 있습니다.</p>
    <form id="addTerm" class="grid-form"><label for="t-label" style="grid-column:span 2">새 학기 이름<input id="t-label" required placeholder="예: 4학년 2학기 (2027-2)"></label><label for="t-sort">순서<input id="t-sort" type="number" value="${(terms.slice(-1)[0]?.sort||0)+1}"></label><button type="submit" class="primary">학기 추가</button></form>
  </div>
  ${terms.map(t=>{const n=new Set(S.placements.filter(p=>p.term_id===t.id).map(p=>p.student_id)).size;return `<div class="term-card">
    <div class="term-grid">
      <label for="tl-${t.id}">학기<input id="tl-${t.id}" data-tid="${t.id}" data-tf="label" value="${esc(t.label)}" ${t.kind&&t.kind!=='etc'?'readonly title="기수에 따라 정해지는 이름입니다"':''}></label>
      ${[0,1,2,3].map(i=>`<label for="tp-${t.id}-${i}">${i+1}차 기간<input id="tp-${t.id}-${i}" data-tid="${t.id}" data-tf="period" data-i="${i}" value="${esc(t.periods[i]||'')}" placeholder="예: 10/12-10/23"></label>`).join('')}
      <label for="ts-${t.id}">순서<input id="ts-${t.id}" type="number" data-tid="${t.id}" data-tf="sort" value="${t.sort}"></label>
    </div>
    <div class="toolbar"><span class="hint">저장된 배치 <b>${t.count}건</b> · 학생 ${n}명</span><span class="spacer"></span>
      <label class="btn" for="tf-${t.id}">엑셀에서 이력 가져오기</label><input id="tf-${t.id}" type="file" accept=".xlsx,.xls,.csv" data-timport="${t.id}" hidden>
      <button type="button" class="ghost" data-tclear="${t.id}" ${t.count?'':'disabled'}>배치 비우기</button>
      ${t.kind&&t.kind!=='etc'?'':`<button type="button" class="ghost danger" data-tdel="${t.id}">학기 삭제</button>`}</div>
    <div id="tmsg-${t.id}" class="hint"></div>
  </div>`;}).join('')}
  <div class="panel stack"><h2>백업</h2><p class="hint">기관, 병동, 학생, 학기, 배치 이력을 한 파일(JSON)로 받습니다. 학기가 끝날 때마다 받아 두기를 권합니다.</p><div><a class="btn" href="/api/backup">전체 데이터 백업 받기</a></div></div>`;
  $('#addTerm').onsubmit=async e=>{e.preventDefault();const label=$('#t-label').value.trim();
    const j=await act(()=>api('POST','/api/terms',{label,sort:$('#t-sort').value,periods:[],cohort_id:C().id}),`${label} 학기를 추가했습니다.`);if(j){S.terms=j.terms;renderTerms();renderHistory();renderPlace();}};
  el.querySelectorAll('[data-tf]').forEach(x=>x.onchange=async()=>{const id=+x.dataset.tid;const t=S.terms.find(t=>t.id===id);let d;
    if(x.dataset.tf==='period'){const p=t.periods.slice();while(p.length<4)p.push('');p[+x.dataset.i]=x.value;d={periods:p};}else d={[x.dataset.tf]:x.value};
    const j=await act(()=>api('PUT',`/api/terms/${id}`,d));if(j){S.terms=j.terms;x.classList.remove('saved');void x.offsetWidth;x.classList.add('saved');renderHistory();renderPlace();if(x.dataset.tf==='sort')renderTerms();}});
  el.querySelectorAll('[data-tclear]').forEach(b=>b.onclick=async()=>{const t=S.terms.find(t=>t.id===+b.dataset.tclear);
    if(!confirm(`${t.label}에 저장된 배치 ${t.count}건을 모두 지웁니다. 계속할까요?`))return;
    const j=await act(()=>api('DELETE',`/api/terms/${t.id}/placements`),`${t.label} 배치를 비웠습니다.`);if(j){S.terms=j.terms;S.placements=S.placements.filter(p=>p.term_id!==t.id);renderAll();}});
  el.querySelectorAll('[data-tdel]').forEach(b=>b.onclick=async()=>{const t=S.terms.find(t=>t.id===+b.dataset.tdel);
    if(!confirm(`${t.label} 학기와 저장된 배치 ${t.count}건을 지웁니다. 계속할까요?`))return;
    const j=await act(()=>api('DELETE',`/api/terms/${t.id}`),`${t.label} 학기를 지웠습니다.`);if(j){S.terms=j.terms;S.placements=S.placements.filter(p=>p.term_id!==t.id);if(ui.placeTerm===t.id)ui.placeTerm=null;renderAll();}});
  el.querySelectorAll('[data-timport]').forEach(x=>x.onchange=()=>{if(x.files[0])importHistory(x.files[0],+x.dataset.timport);x.value='';});
}
function matchRec(r,idIdx){
  const id=String(r.id||'').trim();
  if(id&&!id.includes('*'))return idIdx.has(id)?idIdx.get(id):null;
  const c=[];
  if(id){const parts=id.split(/\*+/),pre=parts[0],suf=parts[parts.length-1];
    CS().forEach((s,k)=>{if(s.student_no.startsWith(pre)&&s.student_no.endsWith(suf)&&(!r.name||(s.name[0]===r.name[0]&&s.name.length===r.name.length)))c.push(k);});}
  else if(r.name)CS().forEach((s,k)=>{if(s.name===r.name)c.push(k);});
  return c.length===1?c[0]:null;
}
function splitInstCell(v){
  v=String(v||'').replace(/\t/g,'').trim();if(!v)return null;let inst,course='';
  if(/[\n_]/.test(v)){const p=v.split(/\n|_/).map(x=>x.trim()).filter(Boolean);inst=p[0];course=p.slice(1).join(' ');}
  else{const m=v.match(/^([^(]*)\(([^)]*)\)/);if(m){inst=m[1];course=m[2];}else inst=v;}
  return {inst:inst.replace(/\d+$/,'').trim(),course};
}
function parseHistoryBook(wb,label){
  const longR=[],wideR=[];
  wb.SheetNames.forEach(n=>{
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:false,defval:''});
    const hi=rows.slice(0,12).findIndex(r=>r.some(c=>/학번/.test(String(c))));if(hi<0)return;
    const h=rows[hi].map(c=>String(c).replace(/\s+/g,' ').trim());const f=re=>h.findIndex(c=>re.test(c));
    const wardCols=h.map((c,i)=>/병동|부서/.test(c)?i:-1).filter(i=>i>=0);
    const instCols=h.map((c,i)=>/기관/.test(c)&&!/병동|부서/.test(c)?i:-1).filter(i=>i>=0);
    const idC=f(/학번/),nmC=f(/성명|이름/);const cell=(r,i)=>i>=0?String(r[i]??'').replace(/\t/g,'').trim():'';
    if(wardCols.length===1&&instCols.length===1){
      const tC=f(/학년|학기/),cC=f(/교과목/),pC=f(/기간/),qC=f(/^순서$|^차수$/);
      rows.slice(hi+1).forEach(r=>{const inst=cell(r,instCols[0]);if(!inst)return;
        longR.push({term:cell(r,tC)||label,id:cell(r,idC),name:cell(r,nmC),inst,course:cell(r,cC),ward:cell(r,wardCols[0]),period:cell(r,pC),seq:parseInt(cell(r,qC))||0});});
    }else{
      const pairs=wardCols.filter(i=>i>0&&!/병동|부서/.test(h[i-1])).map(i=>i-1);if(pairs.length<2)return;
      rows.slice(hi+1).forEach(r=>{const id=cell(r,idC),name=cell(r,nmC);if(!id&&!name)return;
        pairs.forEach((j,pi)=>{const sp=splitInstCell(r[j]);if(!sp)return;wideR.push({term:label,id,name,inst:sp.inst,course:sp.course,ward:cell(r,j+1),period:h[j].replace(/\(.*$/,'').trim(),seq:pi+1});});});
    }
  });
  return longR.length?longR:wideR;
}
function findTermByLabel(lab){
  const n=s=>String(s).replace(/\s|\(.*?\)/g,'');
  const ts=sortedTerms();
  return ts.find(t=>t.label===lab)||ts.find(t=>n(t.label)===n(lab))||ts.find(t=>n(t.label).startsWith(n(lab))||n(lab).startsWith(n(t.label)));
}
function importHistory(file,tid){
  if(typeof XLSX==='undefined'){toast('엑셀 도구를 불러오지 못했습니다.');return;}
  const T=S.terms.find(t=>t.id===tid);const msg=$('#tmsg-'+tid);
  const fr=new FileReader();
  fr.onload=async()=>{
    let recs;try{recs=parseHistoryBook(XLSX.read(new Uint8Array(fr.result),{type:'array'}),T.label);}catch(e){toast('파일을 읽지 못했습니다: '+e.message);return;}
    if(!recs.length){toast('배치 기록을 찾지 못했습니다. 학번, 기관, 병동(부서) 열을 확인하세요.');return;}
    const groups={};recs.forEach(r=>{(groups[r.term]=groups[r.term]||[]).push(r);});
    const cs=CS();const idIdx=new Map(cs.map((s,k)=>[s.student_no,k]));
    const lines=[];
    for(const [lab,rs] of Object.entries(groups)){
      let target=lab===T.label?T:findTermByLabel(lab);
      if(!target){if(!confirm(`파일에 있는 ‘${lab}’ 학기가 목록에 없습니다. 새 학기로 만들까요?`)){lines.push(`${lab}: 건너뜀`);continue;}
        const j=await act(()=>api('POST','/api/terms',{label:lab,periods:[],cohort_id:C().id}));if(!j)continue;S.terms=j.terms;target=S.terms.find(t=>t.id===j.id);}
      const per=new Map();let miss=0;const missNames=[];
      rs.forEach(r=>{const k=matchRec(r,idIdx);if(k==null){miss++;if(missNames.length<15)missNames.push(r.name||r.id);return;}const sid=cs[k].id;if(!per.has(sid))per.set(sid,[]);per.get(sid).push(r);});
      const pl=[];per.forEach((list,sid)=>{list.sort((a,b)=>(a.seq||0)-(b.seq||0)||String(a.period).localeCompare(String(b.period)));list.forEach((r,i)=>pl.push({student_id:sid,seq:i+1,period:r.period,institution:r.inst,course:r.course,ward:r.ward}));});
      if(target.count&&!confirm(`${target.label}에 저장된 배치가 있습니다. 파일에 있는 학생 ${per.size}명의 배치를 파일 내용으로 바꿉니다. 계속할까요?`)){lines.push(`${target.label}: 취소`);continue;}
      const j=await act(()=>api('PUT',`/api/terms/${target.id}/placements`,{placements:pl,replace_all:false}));
      if(j){S.terms=j.terms;S.placements=j.placements;lines.push(`${target.label}: 학생 ${per.size}명, ${j.saved}건 저장${miss?` · 명단에서 찾지 못한 기록 ${miss}건(${missNames.join(', ')}${miss>missNames.length?' 외':''})`:''}`);}
    }
    renderAll();const m=$('#tmsg-'+tid);if(m)m.textContent=lines.join(' / ');toast('이력을 가져왔습니다.');
  };
  fr.readAsArrayBuffer(file);
}

/* ---------- 계정 관리 ---------- */
function renderUsers(){
  const el=$('#tab-users');if(!S.canManage){el.innerHTML='';return;}
  const roleSel=(id,val,attr='')=>`<select id="${id}" ${attr}>${S.roles.map(r=>`<option ${r===val?'selected':''}>${r}</option>`).join('')}</select>`;
  el.innerHTML=`<div class="panel stack"><h2>계정 추가</h2>
    <p class="hint">이 사이트는 학부장, 임상산학학과장, 임상실습주임교수, 임상실습행정직원만 쓸 수 있습니다. 계정은 직위별로 두고, <b>발령으로 사람이 바뀌면 아래 표에서 이름을 고치고 비밀번호를 초기화</b>하세요. 초기화한 비밀번호로 처음 로그인하면 새 비밀번호를 정하게 됩니다. 계정 추가·삭제는 학부장, 임상산학학과장, 임상실습주임교수가 합니다.</p>
    <form id="addUser" class="grid-form">
      <label for="u-login">아이디<input id="u-login" required autocomplete="off"></label>
      <label for="u-name">이름<input id="u-name" required></label>
      <label for="u-role">직위${roleSel('u-role','임상실습행정직원')}</label>
      <label for="u-pw">처음 비밀번호 (8자 이상)<input id="u-pw" type="text" required minlength="8" autocomplete="off"></label>
      <button type="submit" class="primary">계정 추가</button></form></div>
  <div class="tblwrap"><table><thead><tr><th>아이디</th><th>이름</th><th>직위</th><th>만든 날</th><th></th></tr></thead><tbody>
  ${S.users.map(u=>`<tr><td class="mono">${esc(u.login_id)}${u.id===S.me.id?' <span class="tag">나</span>':''}</td>
    <td><input id="un-${u.id}" data-uid="${u.id}" data-uf="name" value="${esc(u.name)}" aria-label="이름"></td>
    <td>${roleSel('ur-'+u.id,u.role,`data-uid="${u.id}" data-uf="role" aria-label="직위"`)}</td>
    <td class="mono" style="color:var(--muted)">${esc(String(u.created_at||'').slice(0,10))}</td>
    <td style="white-space:nowrap"><button type="button" class="ghost" data-upw="${u.id}">비밀번호 초기화</button>${u.id===S.me.id?'':`<button type="button" class="ghost danger" data-udel="${u.id}">삭제</button>`}</td></tr>`).join('')}
  </tbody></table></div>`;
  $('#addUser').onsubmit=async e=>{e.preventDefault();
    const d={login_id:$('#u-login').value.trim(),name:$('#u-name').value.trim(),role:$('#u-role').value,password:$('#u-pw').value};
    const j=await act(()=>api('POST','/api/users',d),`${d.name}(${d.role}) 계정을 만들었습니다.`);if(j){S.users=j.users;renderUsers();}};
  el.querySelectorAll('[data-uf]').forEach(x=>x.onchange=async()=>{const j=await act(()=>api('PUT',`/api/users/${x.dataset.uid}`,{[x.dataset.uf]:x.value}),'저장했습니다.');if(j)S.users=j.users;else renderUsers();});
  el.querySelectorAll('[data-upw]').forEach(b=>b.onclick=async()=>{const u=S.users.find(u=>u.id===+b.dataset.upw);const pw=prompt(`${u.name}의 새 비밀번호 (8자 이상)`);if(!pw)return;
    await act(()=>api('PUT',`/api/users/${u.id}`,{password:pw}),`${u.name}의 비밀번호를 바꿨습니다.`);});
  el.querySelectorAll('[data-udel]').forEach(b=>b.onclick=async()=>{const u=S.users.find(u=>u.id===+b.dataset.udel);
    if(!confirm(`${u.name}(${u.role}) 계정을 지웁니다. 계속할까요?`))return;
    const j=await act(()=>api('DELETE',`/api/users/${u.id}`),`${u.name} 계정을 지웠습니다.`);if(j){S.users=j.users;renderUsers();}});
}

boot();
