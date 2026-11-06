/* 임상실습 배치 엔진: 정원·여학생 전용·이전 병동 금지는 반드시 지키고, 성적·지역·만학도·주소지 점수 합이 최대가 되도록 최소비용 유량으로 배정 */
/* ===== 배치 엔진 (화면과 무관한 순수 함수) ===== */
const COURSES=[{key:'adult',label:'성인간호학실습(2)',short:'성인'},{key:'women',label:'여성건강간호학실습',short:'여성'},{key:'child',label:'아동간호학실습',short:'아동'}];
const DEFAULT_PERIODS=['10/12~10/23','10/26~11/06','11/09~11/20','11/23~12/04'];
const DEFAULT_W={grade:80,local:100,age:60,addr:30,ageCut:35,same:50};
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

/* 최소비용 유량: 학생 → 기관·기간 자리 → 정원 */
class MCF{
  constructor(n){this.n=n;this.g=Array.from({length:n},()=>[]);}
  add(u,v,cap,cost){const a={v,cap,cost,rev:this.g[v].length};const b={v:u,cap:0,cost:-cost,rev:this.g[u].length};this.g[u].push(a);this.g[v].push(b);return a;}
  run(s,t){
    const n=this.n;
    for(;;){
      const dist=new Float64Array(n).fill(Infinity),inq=new Uint8Array(n),pv=new Int32Array(n).fill(-1),pe=new Int32Array(n);
      dist[s]=0;const q=[s];inq[s]=1;let h=0;
      while(h<q.length){const u=q[h++];inq[u]=0;const gu=this.g[u];
        for(let i=0;i<gu.length;i++){const e=gu[i];if(e.cap>0&&dist[u]+e.cost<dist[e.v]-1e-9){dist[e.v]=dist[u]+e.cost;pv[e.v]=u;pe[e.v]=i;if(!inq[e.v]){inq[e.v]=1;q.push(e.v);}}}}
      if(dist[t]===Infinity)break;
      let f=Infinity;for(let v=t;v!==s;v=pv[v])f=Math.min(f,this.g[pv[v]][pe[v]].cap);
      for(let v=t;v!==s;v=pv[v]){const e=this.g[pv[v]][pe[v]];e.cap-=f;this.g[v][e.rev].cap+=f;}
    }
  }
}

function kwList(inst){return String(inst.kw||'').split(/[,·\/]+/).map(s=>s.trim()).filter(Boolean);}
function deptList(inst){if(Array.isArray(inst.deptArr)&&inst.deptArr.length)return inst.deptArr;const d=String(inst.depts||'').split(',').map(s=>s.trim()).filter(Boolean);return d.length?d:['(부서 미지정)'];}
const WKW=[['응급','응급실'],['ER','응급실'],['중환자','중환자실'],['ICU','중환자실'],['회복','회복실'],['RR','회복실'],['수술','수술실'],['OR','수술실'],['인공신장','인공신장실'],['분만','분만'],['천사','천사병동']];
/* 병동 비교용 코드: 7B, 93, A6 같은 번호와 응급실·수술실 같은 부서명 */
function wardCodes(w){w=String(w||'').replace(/\t/g,'');const s=new Set((w.match(/[A-Za-z]?\d{1,3}[A-Za-z]?/g)||[]).map(x=>x.toUpperCase()));const u=w.toUpperCase();WKW.forEach(([k,v])=>{if(u.includes(k))s.add(v);});if(!s.size&&w.trim())s.add(w.trim());return s;}
/* 기관명 비교용 키: 학기마다 다른 표기를 하나로 */
function instKey(x){return String(x||'').replace(/\(.*?\)|\s/g,'').replace(/이화여자대학교|이화여대/g,'이대').replace(/서울특별시|성균관대학교|대학교|대학|학교|병원|의료원/g,'').replace(/대/g,'');}
function prepHist(st,cfg){
  const dc=new Map();cfg.insts.forEach(i=>dc.set(i,deptList(i).map(wardCodes)));
  st.forEach(s=>{s._fb=new Map();s._prev=new Set();const H=s.hist||[];if(!H.length)return;
    cfg.insts.forEach(i=>{const k1=instKey(i.name),k2=instKey(i.short);const hs=H.filter(h=>h.key===k1||h.key===k2);if(!hs.length)return;
      s._prev.add(i);const fb=new Set();dc.get(i).forEach((cs,d)=>{if(hs.some(h=>h.codes.some(c=>cs.has(c))))fb.add(d);});s._fb.set(i,fb);});});
}
/* 부서 배정: 금지 병동을 빼고, 부서별 인원을 고르게 */
function assignDepts(n,L,allowed,pref){
  if(!n)return [];let capx=Math.ceil(n/L);
  for(let t=0;t<6;t++){
    const g=new MCF(2+n+L);const E=[];
    for(let i=0;i<n;i++){g.add(0,2+i,1,0);for(let d=0;d<L;d++)if(allowed(i,d))E.push({i,d,e:g.add(2+i,2+n+d,1,pref(i,d))});}
    for(let d=0;d<L;d++)g.add(2+n+d,1,capx,0);
    g.run(0,1);const res=new Array(n).fill(-1);E.forEach(x=>{if(x.e.cap===0)res[x.i]=x.d;});
    if(res.every(x=>x>=0)||t===5)return res;capx++;
  }
}
function cap(inst,p){const v=Number(inst.caps[p]);return isFinite(v)&&v>0?Math.floor(v):0;}

function scoreFor(s,inst,w){
  if(inst.female&&s.sex==='남')return null;
  const fb=s._fb&&s._fb.get(inst);
  if(fb&&fb.size){const L=deptList(inst).length;const need=(inst.course==='adult'&&L>1)?2:1;if(L-fb.size<need)return null;}
  const m=kwList(inst).some(k=>s.addr.includes(k));
  let sc=0;const tags=[];
  if(inst.local){
    if(m){sc+=w.local;tags.push(['local','지역 연고']);}
    if(s.age>=w.ageCut){sc+=w.age;tags.push(['age','만학도']);}
  }else if(inst.grade){sc+=w.grade*s.pct;tags.push(['grade','성적 '+s.rank+'위']);}
  else if(m){sc+=w.addr;tags.push(['local','주소지 인근']);}
  if(s._prev&&s._prev.has(inst)){sc-=(w.same==null?50:w.same);tags.push(['prev','이전 기관·다른 병동']);}
  if(inst.female)tags.push(['fem','여학생 기관']);
  return {sc,tags,addrMatch:m};
}

function computePlacement(students,cfg,seed){
  const st=students,n=st.length,w=cfg.w,P=cfg.periods;
  const rng=mulberry32(seed||1);
  const jit=()=>rng()*0.5;
  prepHist(st,cfg);
  // 성적 순위(동점은 같은 순위)
  const order=st.map((s,k)=>k).sort((a,b)=>st[b].gpa-st[a].gpa);
  order.forEach((k,i)=>{const prev=i>0?st[order[i-1]]:null;st[k].rank=(prev&&prev.gpa===st[k].gpa)?prev.rank:i+1;});
  st.forEach(s=>{s.pct=n>1?1-(s.rank-1)/(n-1):1;});
  const by=c=>cfg.insts.filter(i=>i.course===c);
  const adult=by('adult');

  /* 1단계: 성인 4주(전반 1·2기간 / 후반 3·4기간) 병원 배정 */
  let id=2+n;const ih=[];
  adult.forEach(inst=>[0,1].forEach(h=>{const c=Math.min(cap(inst,2*h),cap(inst,2*h+1));if(c>0)ih.push({inst,h,node:id++,c});}));
  // 성인 전반/후반 인원은 남은 두 기간의 여성·아동 자리로 받을 수 있는 만큼만
  const tot=c=>[0,1,2,3].map(p=>by(c).reduce((a,i)=>a+cap(i,p),0));
  const Wt=tot('women'),Ct=tot('child');const noSec=Wt.concat(Ct).every(x=>x===0);
  const lim=[noSec?1e9:Math.min(Wt[2],Ct[3])+Math.min(Wt[3],Ct[2]),noSec?1e9:Math.min(Wt[0],Ct[1])+Math.min(Wt[1],Ct[0])];
  const hg=[id++,id++];
  const g=new MCF(id);
  st.forEach((s,k)=>g.add(0,2+k,1,0));ih.forEach(x=>g.add(x.node,hg[x.h],x.c,0));hg.forEach((n,h)=>g.add(n,1,lim[h],0));
  const E=[];
  st.forEach((s,k)=>ih.forEach(x=>{const r=scoreFor(s,x.inst,w);if(!r)return;E.push({k,x,r,e:g.add(2+k,x.node,1,-(r.sc+jit()))});}));
  g.run(0,1);
  const ad=st.map(()=>null);
  E.forEach(({k,x,r,e})=>{if(e.cap===0)ad[k]={inst:x.inst,h:x.h,r};});

  /* 2단계: 남은 두 기간에 여성·아동 각 2주 */
  const other=p=>[1,0,3,2][p];
  const free=k=>ad[k]?(ad[k].h===0?[2,3]:[0,1]):null;
  function solve(fk,sk){
    const A=by(fk),B=by(sk);
    const bTot=[0,1,2,3].map(p=>B.reduce((a,i)=>a+cap(i,p),0));
    let id=2+n;const gate=[0,1,2,3].map(()=>id++);const nodes=[];
    A.forEach(inst=>[0,1,2,3].forEach(p=>{if(cap(inst,p)>0)nodes.push({inst,p,node:id++});}));
    const g1=new MCF(id);
    st.forEach((s,k)=>{if(free(k))g1.add(0,2+k,1,0);});
    gate.forEach((gn,p)=>g1.add(gn,1,bTot[other(p)],0));
    nodes.forEach(x=>g1.add(x.node,gate[x.p],cap(x.inst,x.p),0));
    const E1=[];
    st.forEach((s,k)=>{const f=free(k);if(!f)return;nodes.forEach(x=>{if(!f.includes(x.p))return;const r=scoreFor(s,x.inst,w);if(!r)return;E1.push({k,x,r,e:g1.add(2+k,x.node,1,-(r.sc+jit()))});});});
    g1.run(0,1);
    const out=st.map(()=>({}));let total=0;
    E1.forEach(({k,x,r,e})=>{if(e.cap===0){out[k][fk]={inst:x.inst,p:x.p,r};total+=r.sc;}});
    id=2+n;const nodes2=[];
    B.forEach(inst=>[0,1,2,3].forEach(p=>{if(cap(inst,p)>0)nodes2.push({inst,p,node:id++});}));
    const g2=new MCF(id);
    st.forEach((s,k)=>{if(out[k][fk])g2.add(0,2+k,1,0);});
    nodes2.forEach(x=>g2.add(x.node,1,cap(x.inst,x.p),0));
    const E2=[];
    st.forEach((s,k)=>{const a=out[k][fk];if(!a)return;const p=other(a.p);nodes2.forEach(x=>{if(x.p!==p)return;const r=scoreFor(s,x.inst,w);if(!r)return;E2.push({k,x,r,e:g2.add(2+k,x.node,1,-(r.sc+jit()))});});});
    g2.run(0,1);
    E2.forEach(({k,x,r,e})=>{if(e.cap===0){out[k][sk]={inst:x.inst,p:x.p,r};total+=r.sc;}});
    const placed=out.filter(o=>o[fk]&&o[sk]).length;
    return {out,total,placed};
  }
  const s1=solve('women','child'),s2=solve('child','women');
  const best=(s2.placed>s1.placed||(s2.placed===s1.placed&&s2.total>s1.total))?s2:s1;

  /* 3단계: 부서 배정 (성인은 같은 소그룹이 2주 뒤 다른 부서로 교대) */
  const slots=st.map(()=>[null,null,null,null]);
  const sortKey=(a,b)=>(st[a].sex===st[b].sex?0:(st[a].sex==='남'?-1:1))||(st[b].gpa-st[a].gpa);
  const fbOf=(k,inst)=>(st[k]._fb&&st[k]._fb.get(inst))||new Set();
  const prevOf=(k,inst)=>!!(st[k]._prev&&st[k]._prev.has(inst));
  const deptFail=[];const DN=(D,d)=>d>=0?D[d]:'(부서 조정 필요)';
  adult.forEach(inst=>[0,1].forEach(h=>{
    const ks=st.map((s,k)=>k).filter(k=>ad[k]&&ad[k].inst===inst&&ad[k].h===h).sort(sortKey);
    const D=deptList(inst),L=D.length,sh=L>1?Math.max(1,Math.floor(L/2)):0;
    const da=assignDepts(ks.length,L,(i,d)=>!fbOf(ks[i],inst).has(d),(i,d)=>d===i%L?0:1);
    const db=assignDepts(ks.length,L,(i,d)=>!fbOf(ks[i],inst).has(d)&&(L===1||d!==da[i]),(i,d)=>d===((da[i]<0?i%L:da[i])+sh)%L?0:1);
    ks.forEach((k,i)=>{const r=ad[k].r,pv=prevOf(k,inst);if(da[i]<0||db[i]<0)deptFail.push(k);
      slots[k][2*h]={course:'adult',inst,dept:DN(D,da[i]),tags:r.tags,addrMatch:r.addrMatch,prev:pv};
      slots[k][2*h+1]={course:'adult',inst,dept:DN(D,db[i]),tags:r.tags,addrMatch:r.addrMatch,prev:pv};});
  }));
  ['women','child'].forEach(c=>by(c).forEach(inst=>[0,1,2,3].forEach(p=>{
    const ks=st.map((s,k)=>k).filter(k=>best.out[k][c]&&best.out[k][c].inst===inst&&best.out[k][c].p===p).sort(sortKey);
    const D=deptList(inst);
    const dd=assignDepts(ks.length,D.length,(i,d)=>!fbOf(ks[i],inst).has(d),(i,d)=>d===i%D.length?0:1);
    ks.forEach((k,i)=>{const r=best.out[k][c].r;if(dd[i]<0)deptFail.push(k);slots[k][p]={course:c,inst,dept:DN(D,dd[i]),tags:r.tags,addrMatch:r.addrMatch,prev:prevOf(k,inst)};});
  })));

  /* 점검 */
  const issues=[];const nm=k=>st[k].name+'('+st[k].id+')';
  const adultUn=st.map((s,k)=>k).filter(k=>!ad[k]);
  const secUn=st.map((s,k)=>k).filter(k=>ad[k]&&!(best.out[k].women&&best.out[k].child));
  const seats=[0,1].reduce((a,h)=>a+adult.reduce((b,i)=>b+Math.min(cap(i,2*h),cap(i,2*h+1)),0),0);
  if(seats<n)issues.push({lv:'bad',msg:`성인 실습 자리가 ${seats}석으로 학생 ${n}명보다 ${n-seats}석 부족합니다.`,detail:'기관·조건 설정에서 성인 기관 정원을 늘리거나 기관을 추가하세요.'});
  if(adultUn.length)issues.push({lv:'bad',msg:`성인 실습에 배치하지 못한 학생 ${adultUn.length}명`,detail:adultUn.map(nm).join(', ')});
  if(secUn.length)issues.push({lv:'bad',msg:`여성 또는 아동 실습을 배치하지 못한 학생 ${secUn.length}명`,detail:secUn.map(nm).join(', ')+' · 해당 기간 정원 또는 여학생 전용 기관 조건을 확인하세요.'});
  ['women','child'].forEach(c=>{const tot=[0,1,2,3].map(p=>by(c).reduce((a,i)=>a+cap(i,p),0));const need=[0,1,2,3].map(p=>slots.filter(s=>s[p]&&s[p].course!=='adult').length);
    const sum=tot.reduce((a,b)=>a+b,0);if(sum<n)issues.push({lv:'bad',msg:`${COURSES.find(x=>x.key===c).short} 실습 전체 정원이 ${sum}명으로 학생 수(${n}명)보다 적습니다.`});});
  let femViol=0;slots.forEach((ss,k)=>ss.forEach(s=>{if(s&&s.inst.female&&st[k].sex==='남')femViol++;}));
  if(femViol)issues.push({lv:'bad',msg:`여학생 전용 기관에 남학생 ${femViol}건이 배치되었습니다.`});
  // 이전 학기 이력 점검
  const hasHist=st.some(s=>s.hist&&s.hist.length);const sameWard=[],sameInst=[],sameInstStu=new Set();
  if(hasHist){
    slots.forEach((ss,k)=>{const H=st[k].hist||[];const seen=new Set();ss.forEach(x=>{if(!x)return;const k1=instKey(x.inst.name),k2=instKey(x.inst.short);const hs=H.filter(h=>h.key===k1||h.key===k2);if(!hs.length)return;
      const cs=wardCodes(x.dept);if(hs.some(h=>h.codes.some(c=>cs.has(c))))sameWard.push(`${nm(k)} ${x.inst.short} ${x.dept}`);
      if(!seen.has(x.inst.name+x.dept)){seen.add(x.inst.name+x.dept);sameInstStu.add(k);sameInst.push(`${nm(k)} ${x.inst.short} ${x.dept} (이전 ${hs.map(h=>h.ward).join(', ')})`);}});});
    if(sameWard.length)issues.push({lv:'bad',msg:`이전 학기와 같은 기관·같은 병동에 배치된 경우 ${sameWard.length}건`,detail:sameWard.join(', ')});
    else issues.push({lv:'ok',msg:'이전 학기와 같은 기관·같은 병동에 다시 배치된 학생은 없습니다.'});
    if(sameInst.length)issues.push({lv:'warn',msg:`이전 학기와 같은 기관(다른 병동)에 배치된 학생 ${sameInstStu.size}명`,detail:sameInst.join(' · ')+' · 정원이나 다른 조건 때문에 피하지 못한 경우입니다. 설정의 이전 기관 감점을 높이면 줄어듭니다.'});
    const noH=st.map((s,k)=>k).filter(k=>!(st[k].hist&&st[k].hist.length));
    if(noH.length)issues.push({lv:'info',msg:`이전 학기 이력을 찾지 못한 학생 ${noH.length}명`,detail:noH.slice(0,40).map(nm).join(', ')+(noH.length>40?' 외':'')+' · 이력 파일의 학번과 같은지 확인하세요.'});
  }
  if(deptFail.length)issues.push({lv:'bad',msg:`이전 병동을 피할 부서가 모자라 부서를 정하지 못한 학생 ${new Set(deptFail).size}명`,detail:[...new Set(deptFail)].map(nm).join(', ')});
  adult.forEach(i=>[0,1].forEach(h=>{const a=cap(i,2*h),b=cap(i,2*h+1);if(a!==b)issues.push({lv:'info',msg:`${i.name}: ${P[2*h]} ${a}명, ${P[2*h+1]} ${b}명으로 정원이 달라 성인 4주 연속을 맞추려고 ${Math.min(a,b)}명만 배치했습니다.`});}));
  const under=[];
  cfg.insts.forEach(i=>[0,1,2,3].forEach(p=>{const c=cap(i,p);if(!c)return;const got=slots.filter(s=>s[p]&&s[p].inst===i).length;if(got<c)under.push(`${COURSES.find(x=>x.key===i.course).short} ${i.short} ${p+1}기간 ${got}/${c}`);}));
  if(under.length)issues.push({lv:'info',msg:`정원보다 적게 배치된 기관·기간 ${under.length}곳`,detail:under.join(' · ')});

  // 지역 우선(만학도·연고) 점검
  const localInsts=adult.filter(i=>i.local);
  const localKw=[...new Set(localInsts.flatMap(kwList))];
  const isLocalAddr=s=>localKw.some(k=>s.addr.includes(k));
  const cand=st.map((s,k)=>k).filter(k=>isLocalAddr(st[k])||st[k].age>=w.ageCut);
  const strong=cand.filter(k=>isLocalAddr(st[k])&&st[k].age>=w.ageCut);
  const inLocal=k=>ad[k]&&ad[k].inst.local;
  const missStrong=strong.filter(k=>!inLocal(k)),missCand=cand.filter(k=>!inLocal(k)&&!missStrong.includes(k));
  const localSeats=localInsts.reduce((a,i)=>a+Math.min(cap(i,0),cap(i,1))+Math.min(cap(i,2),cap(i,3)),0);
  if(localInsts.length){
    if(missStrong.length)issues.push({lv:'warn',msg:`안동·영주 주소의 35세 이상 학생 ${missStrong.length}명이 지역 기관 성인 실습에 들어가지 못했습니다.`,detail:missStrong.map(k=>nm(k)+' → '+(ad[k]?ad[k].inst.short:'미배치')).join(', ')});
    if(missCand.length)issues.push({lv:'info',msg:`지역 우선 대상(주소지 또는 만학도 중 하나) ${cand.length}명 중 ${missCand.length+missStrong.length}명은 다른 지역에서 성인 실습을 합니다.`,detail:`지역 기관 성인 자리 ${localSeats}석. `+missCand.map(k=>nm(k)+' → '+(ad[k]?ad[k].inst.short:'미배치')).join(', ')});
  }
  // 성적 우선 점검
  const gk=st.map((s,k)=>k).filter(k=>ad[k]&&ad[k].inst.grade);
  const worst=gk.length?Math.max(...gk.map(k=>st[k].rank)):0;
  const skipped=st.map((s,k)=>k).filter(k=>ad[k]&&!ad[k].inst.grade&&st[k].rank<worst).sort((a,b)=>st[a].rank-st[b].rank);
  if(skipped.length)issues.push({lv:'info',msg:`성적우선 기관 배치 기준(${worst}위)보다 성적이 높지만 다른 기관에 배치된 학생 ${skipped.length}명`,detail:skipped.map(k=>`${nm(k)} ${st[k].rank}위 → ${ad[k].inst.short}${ad[k].inst.local?' (지역 우선)':''}`).join(', ')});

  // 요약 수치
  let addrTot=0,addrHit=0;
  slots.forEach(ss=>{const seen=new Set();ss.forEach(s=>{if(!s)return;const key=s.course;if(seen.has(key))return;seen.add(key);if(kwList(s.inst).length){addrTot++;if(s.addrMatch)addrHit++;}});});
  const placed=slots.filter(ss=>ss.every(Boolean)).length;
  const stats={n,placed,gradeCount:gk.length,gradeWorst:worst,gradeAvg:gk.length?gk.reduce((a,k)=>a+st[k].rank,0)/gk.length:0,
    cand:cand.length,strong:strong.length,strongIn:strong.length-missStrong.length,localSeats,localIn:st.filter((s,k)=>inLocal(k)).length,
    addrRate:addrTot?addrHit/addrTot:0,hasHist,sameWard:sameWard.length,sameInstN:sameInstStu.size,firstOrder:best===s1?'여성→아동':'아동→여성'};
  if(!issues.some(i=>i.lv==='bad'))issues.unshift({lv:'ok',msg:`모든 학생 ${placed}명이 성인 4주, 여성 2주, 아동 2주로 배치되었고 정원과 여학생 전용 조건을 지켰습니다.`});
  return {slots,issues,stats,seed};
}
