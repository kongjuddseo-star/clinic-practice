/* KBC Nursing MediMath 배치 엔진
 * 학기마다 교과목 구성이 다르다. 교과목 = { key, label, short, units(2주 단위 수), consec(연속·같은 기관 여부) }.
 * 반드시 지키는 조건: 기관·기간별 정원, 여학생 전용 기관, 이전 학기와 같은 기관·같은 병동 금지.
 * 그 안에서 성적우선·지역 연고·만학도·주소지 점수 합이 커지도록, 이전 학기와 같은 기관은 감점으로 피하며 배정한다.
 * 단계: ① 일정 패턴(어느 기간에 어느 과목) 인원 배분 → ② 학생별 패턴 → ③ 과목별 기관(최소비용 유량) → ④ 병동.
 */
const DEFAULT_PERIODS=['1기간','2기간','3기간','4기간'];
const DEFAULT_W={grade:80,local:100,age:60,addr:30,ageCut:35,same:50};

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

/* 최소비용 유량 (SPFA) */
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

const NO_WARD='(병동 미정)';
const WKW=[['응급','응급실'],['ER','응급실'],['중환자','중환자실'],['ICU','중환자실'],['회복','회복실'],['RR','회복실'],['수술','수술실'],['OR','수술실'],['인공신장','인공신장실'],['분만','분만'],['천사','천사병동']];
const isNoWard=w=>!String(w||'').trim()||/미정|미지정/.test(String(w));
/* 병동 비교용 코드: 7B, 93, A6 같은 번호와 응급실·수술실 같은 부서명. 병동 미정은 비교하지 않음 */
function wardCodes(w){w=String(w||'').replace(/\t/g,'');if(isNoWard(w))return new Set();const s=new Set((w.match(/[A-Za-z]?\d{1,3}[A-Za-z]?/g)||[]).map(x=>x.toUpperCase()));const u=w.toUpperCase();WKW.forEach(([k,v])=>{if(u.includes(k))s.add(v);});if(!s.size)s.add(w.trim());return s;}
/* 기관명 비교용 키: 학기마다 다른 표기를 하나로 */
function instKey(x){return String(x||'').replace(/\(.*?\)|\s|확정/g,'').replace(/이화여자대학교|이화여대/g,'이대').replace(/한국보훈복지의료공단|보훈공단/g,'보훈').replace(/서울특별시|성균관대학교|대학교|대학|학교|병원|의료원/g,'').replace(/대/g,'');}
function kwList(inst){return String(inst.kw||'').split(/[,·\/]+/).map(s=>s.trim()).filter(Boolean);}
function deptList(inst){if(Array.isArray(inst.deptArr)&&inst.deptArr.length)return inst.deptArr;const d=String(inst.depts||'').split(',').map(s=>s.trim()).filter(Boolean);return d.length?d:[NO_WARD];}
function cap(inst,p){const v=Number(inst.caps[p]);return isFinite(v)&&v>0?Math.floor(v):0;}

/* 학생별로: 이전 학기에 간 기관(_prev)과 그 기관에서 갈 수 없는 병동(_fb) */
function prepHist(st,insts){
  const dc=new Map();insts.forEach(i=>dc.set(i,deptList(i).map(wardCodes)));
  st.forEach(s=>{s._fb=new Map();s._prev=new Set();const H=s.hist||[];if(!H.length)return;
    insts.forEach(i=>{const k1=instKey(i.name),k2=instKey(i.short);const hs=H.filter(h=>h.key===k1||h.key===k2);if(!hs.length)return;
      s._prev.add(i);const fb=new Set();dc.get(i).forEach((cs,d)=>{if(hs.some(h=>h.codes.some(c=>cs.has(c))))fb.add(d);});s._fb.set(i,fb);});});
}
function scoreFor(s,inst,w,need){
  if(inst.female&&s.sex==='남')return null;
  const fb=s._fb&&s._fb.get(inst);
  if(fb&&fb.size){const L=deptList(inst).length;if(L-fb.size<(need||1))return null;}
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

/* 부서(병동) 배정: 허용된 병동 중에서 고르게 */
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

/* ① 일정 패턴: 각 과목 단위를 어느 기간에 둘지. 연속 과목은 단위 수의 배수 기간에서 시작 */
function enumPatterns(courses,N){
  const out=[];
  const combos=(free,k,start,acc,res)=>{if(acc.length===k){res.push(acc.slice());return;}for(let i=start;i<free.length;i++){acc.push(free[i]);combos(free,k,i+1,acc,res);acc.pop();}};
  (function rec(ci,used,asg){
    if(ci===courses.length){out.push(asg.slice());return;}
    const c=courses[ci];
    rec(ci+1,used,[...asg,null]);
    if(c.consec){for(let s=0;s+c.units<=N;s+=c.units){const ps=[];for(let k=0;k<c.units;k++)ps.push(s+k);if(ps.some(p=>used&(1<<p)))continue;let m=used;ps.forEach(p=>m|=1<<p);rec(ci+1,m,[...asg,ps]);}}
    else{const free=[];for(let p=0;p<N;p++)if(!(used&(1<<p)))free.push(p);const res=[];combos(free,c.units,0,[],res);res.forEach(ps=>{let m=used;ps.forEach(p=>m|=1<<p);rec(ci+1,m,[...asg,ps]);});}
  })(0,0,[]);
  return out.map(a=>({asg:a,full:a.every(Boolean),units:a.reduce((t,x)=>t+(x?x.length:0),0)})).filter(p=>p.units>0);
}
function patRes(pat,courses){const r=[];pat.asg.forEach((ps,ci)=>{if(!ps)return;if(courses[ci].consec)r.push(ci+':b'+ps[0]);else ps.forEach(p=>r.push(ci+':p'+p));});return r;}
/* 학생마다 쓸 수 있는 일정 패턴을 정해 인원을 배분한다. 제외 기간(교직실습 등)이 있는 학생부터 고른다 */
function choosePatternCounts(pats,R,st,rng){
  const P=pats.length,n=st.length,res=pats.map(p=>p.res);
  const okFor=st.map(s=>{const b=s.blocked;return pats.map(p=>!b||!b.size||p.asg.every(ps=>!ps||ps.every(q=>!b.has(q))));});
  const fits=(rem,i)=>res[i].every(r=>rem[r]>0);
  const slack=(rem,i)=>Math.min(...res[i].map(r=>R[r]?rem[r]/R[r]:0));
  const F=[...Array(P).keys()].filter(i=>pats[i].full),Pp=[...Array(P).keys()].filter(i=>!pats[i].full).sort((a,b)=>pats[b].units-pats[a].units);
  const base=[...Array(n).keys()];
  let best=null;
  for(let t=0;t<60;t++){
    const order=base.slice().sort((a,b)=>((st[b].blocked&&st[b].blocked.size)||0)-((st[a].blocked&&st[a].blocked.size)||0)||(t?rng()-0.5:0));
    const rem={...R},asg=new Array(n).fill(-1);
    const take=(k,i)=>{res[i].forEach(r=>rem[r]--);asg[k]=i;},drop=k=>{res[asg[k]].forEach(r=>rem[r]++);asg[k]=-1;};
    for(const k of order){let bi=-1,bv=-1;for(const i of F){if(!okFor[k][i]||!fits(rem,i))continue;const v=slack(rem,i)+rng()*(t?0.05:0);if(v>bv){bv=v;bi=i;}}if(bi>=0)take(k,bi);}
    // 남은 학생: 다른 학생의 패턴을 바꿔 자리를 만들 수 있으면 교환
    for(const L of order){if(asg[L]>=0)continue;
      let done=false;
      for(const A of order){if(done)break;if(A===L||asg[A]<0||!pats[asg[A]].full)continue;const a=asg[A];drop(A);
        for(const b of F){if(b===a||!okFor[A][b]||!fits(rem,b))continue;take(A,b);const c=F.find(c=>okFor[L][c]&&fits(rem,c));
          if(c!==undefined){take(L,c);done=true;break;}drop(A);}
        if(!done)take(A,a);}
    }
    // 그래도 남으면 가능한 과목만이라도
    for(const k of order){if(asg[k]>=0)continue;let bi=-1;for(const i of Pp){if(!okFor[k][i]||!fits(rem,i))continue;if(bi<0||pats[i].units>pats[bi].units||(pats[i].units===pats[bi].units&&slack(rem,i)>slack(rem,bi)))bi=i;}if(bi>=0)take(k,bi);}
    let full=0,units=0;asg.forEach(i=>{if(i>=0){units+=pats[i].units;if(pats[i].full)full++;}});
    const key=full*1e6+units;
    if(!best||key>best.key)best={key,asg:asg.slice()};
    if(full===n)break;
  }
  const cnt=new Array(P).fill(0);best.asg.forEach(i=>{if(i>=0)cnt[i]++;});
  return {cnt,okFor};
}

function computePlacement(students,cfg,seed){
  const st=students,n=st.length,w={...DEFAULT_W,...cfg.w},P=cfg.periods,N=P.length,courses=cfg.courses;
  const rng=mulberry32(seed||1),jit=()=>rng()*0.5;
  const insts=cfg.insts.filter(i=>courses.some(c=>c.key===i.course));
  const instsOf=ci=>insts.filter(i=>i.course===courses[ci].key);
  // 성적 순위(동점은 같은 순위)
  const order=st.map((s,k)=>k).sort((a,b)=>st[b].gpa-st[a].gpa);
  order.forEach((k,i)=>{const prev=i>0?st[order[i-1]]:null;st[k].rank=(prev&&prev.gpa===st[k].gpa)?prev.rank:i+1;});
  st.forEach(s=>{s.pct=n>1?1-(s.rank-1)/(n-1):1;});
  prepHist(st,insts);
  const needOf=(ci,inst)=>{const c=courses[ci],L=deptList(inst).length;return c.consec&&L>1?Math.min(c.units,L):1;};

  /* ① 자원(과목×기간 또는 과목×연속블록) 정원과 패턴 인원 */
  const R={};
  courses.forEach((c,ci)=>{
    if(c.consec){for(let s=0;s+c.units<=N;s+=c.units)R[ci+':b'+s]=instsOf(ci).reduce((a,i)=>{let m=Infinity;for(let k=0;k<c.units;k++)m=Math.min(m,cap(i,s+k));return a+m;},0);}
    else for(let p=0;p<N;p++)R[ci+':p'+p]=instsOf(ci).reduce((a,i)=>a+cap(i,p),0);});
  const pats=enumPatterns(courses,N);pats.forEach(p=>p.res=patRes(p,courses));
  st.forEach(s=>{s.blocked=s.blocked instanceof Set?s.blocked:new Set(s.blocked||[]);});
  const {cnt,okFor}=pats.length?choosePatternCounts(pats,R,st,rng):{cnt:[],okFor:[]};

  /* ② 학생 → 패턴: 학생에게 유리한 기간 조합(예: 지역 기관에 자리가 있는 기간)을 고르도록 */
  const best={};// best[k][res] = 그 자원에서 학생이 받을 수 있는 최고 점수
  st.forEach((s,k)=>{best[k]={};courses.forEach((c,ci)=>{Object.keys(R).filter(r=>r.startsWith(ci+':')).forEach(r=>{
    const isB=r.includes(':b'),x=+r.split(/:[bp]/)[1];let b=-1000;
    instsOf(ci).forEach(i=>{const ok=isB?[...Array(c.units).keys()].every(q=>cap(i,x+q)>0):cap(i,x)>0;if(!ok)return;const sc=scoreFor(s,i,w,needOf(ci,i));if(sc&&sc.sc>b)b=sc.sc;});
    best[k][r]=b;});});});
  const used=pats.map((p,i)=>i).filter(i=>cnt[i]>0);
  const pOf=st.map(()=>null);
  if(used.length){
    const g=new MCF(2+n+used.length);const E=[];
    st.forEach((s,k)=>{g.add(0,2+k,1,0);used.forEach((pi,j)=>{if(!okFor[k][pi])return;const v=pats[pi].res.reduce((a,r)=>a+best[k][r],0)+pats[pi].units*2000;E.push({k,pi,e:g.add(2+k,2+n+j,1,-(v+jit()))});});});
    used.forEach((pi,j)=>g.add(2+n+j,1,cnt[pi],0));
    g.run(0,1);E.forEach(x=>{if(x.e.cap===0)pOf[x.k]=pats[x.pi];});
  }

  /* ③ 과목별 기관 배정 */
  const slots=st.map(()=>new Array(N).fill(null));
  const usedCap=new Map();const uc=(i,p)=>(usedCap.get(i)||[])[p]||0;const addUc=(i,p)=>{if(!usedCap.has(i))usedCap.set(i,new Array(N).fill(0));usedCap.get(i)[p]++;};
  courses.forEach((c,ci)=>{
    const I=instsOf(ci);
    if(c.consec){
      const nodes=[];let id=2+n;
      for(let s=0;s+c.units<=N;s+=c.units)I.forEach(i=>{let m=Infinity;for(let q=0;q<c.units;q++)m=Math.min(m,cap(i,s+q)-uc(i,s+q));if(m>0)nodes.push({i,s,m,node:id++});});
      const g=new MCF(id);const E=[];
      st.forEach((s,k)=>{const ps=pOf[k]&&pOf[k].asg[ci];if(!ps)return;g.add(0,2+k,1,0);
        nodes.forEach(x=>{if(x.s!==ps[0])return;const r=scoreFor(s,x.i,w,needOf(ci,x.i));if(!r)return;E.push({k,x,r,e:g.add(2+k,x.node,1,-(r.sc+jit()))});});});
      nodes.forEach(x=>g.add(x.node,1,x.m,0));g.run(0,1);
      E.forEach(({k,x,r,e})=>{if(e.cap!==0)return;for(let q=0;q<c.units;q++){slots[k][x.s+q]={course:c.key,ci,inst:x.i,dept:null,tags:r.tags,addrMatch:r.addrMatch,prev:!!(st[k]._prev&&st[k]._prev.has(x.i)),consec:true};addUc(x.i,x.s+q);}});
    }else{
      for(let u=0;u<c.units;u++){
        const nodes=[];let id=2+n;
        for(let p=0;p<N;p++)I.forEach(i=>{const m=cap(i,p)-uc(i,p);if(m>0)nodes.push({i,p,m,node:id++});});
        const g=new MCF(id);const E=[];
        st.forEach((s,k)=>{const ps=pOf[k]&&pOf[k].asg[ci];if(!ps||ps.length<=u)return;const p=ps[u];g.add(0,2+k,1,0);
          const before=ps.slice(0,u).map(q=>slots[k][q]).filter(Boolean).map(x=>x.inst);
          nodes.forEach(x=>{if(x.p!==p)return;
            if(before.includes(x.i)&&deptList(x.i).filter(d=>!isNoWard(d)).length<2&&!isNoWard(deptList(x.i)[0]))return;
            const r=scoreFor(s,x.i,w,1);if(!r)return;E.push({k,x,r,e:g.add(2+k,x.node,1,-(r.sc+jit()))});});});
        nodes.forEach(x=>g.add(x.node,1,x.m,0));g.run(0,1);
        E.forEach(({k,x,r,e})=>{if(e.cap!==0)return;slots[k][x.p]={course:c.key,ci,inst:x.i,dept:null,tags:r.tags,addrMatch:r.addrMatch,prev:!!(st[k]._prev&&st[k]._prev.has(x.i)),consec:false};addUc(x.i,x.p);});
      }
    }
  });

  /* ④ 병동: 기간 순서대로. 이전 학기 병동 금지, 이번 학기 같은 기관에서 이미 간 병동도 피함 */
  const deptFail=[];
  for(let p=0;p<N;p++){
    insts.forEach(inst=>{
      const ks=st.map((s,k)=>k).filter(k=>slots[k][p]&&slots[k][p].inst===inst)
        .sort((a,b)=>(st[a].sex===st[b].sex?0:(st[a].sex==='남'?-1:1))||(st[b].gpa-st[a].gpa));
      if(!ks.length)return;
      const D=deptList(inst),L=D.length,sh=L>1?Math.max(1,Math.floor(L/2)):0;
      const fbOf=k=>(st[k]._fb&&st[k]._fb.get(inst))||new Set();
      const earlier=k=>{const out=new Set();for(let q=0;q<p;q++){const x=slots[k][q];if(x&&x.inst===inst&&x.dept!=null){const d=D.indexOf(x.dept);if(d>=0&&!isNoWard(x.dept))out.add(d);}}return out;};
      const prevD=k=>{const x=p>0?slots[k][p-1]:null;return x&&x.inst===inst&&x.consec&&x.dept!=null?D.indexOf(x.dept):-1;};
      const dd=assignDepts(ks.length,L,(i,d)=>!fbOf(ks[i]).has(d)&&!earlier(ks[i]).has(d),(i,d)=>{const pd=prevD(ks[i]);return pd>=0?(d===(pd+sh)%L?0:1):(d===i%L?0:1);});
      ks.forEach((k,i)=>{if(dd[i]<0){deptFail.push(k);slots[k][p].dept='(병동 조정 필요)';}else slots[k][p].dept=D[dd[i]];});
    });
  }

  /* 점검 */
  const issues=[];const nm=k=>st[k].name+'('+st[k].id+')';
  const missing=courses.map((c,ci)=>st.map((s,k)=>k).filter(k=>slots[k].filter(x=>x&&x.ci===ci).length<c.units));
  courses.forEach((c,ci)=>{
    const need=n*c.units,have=Object.keys(R).filter(r=>r.startsWith(ci+':')).reduce((a,r)=>a+R[r]*(c.consec?c.units:1),0);
    if(have<need)issues.push({lv:'bad',msg:`${c.label} 자리가 ${have}석으로, 학생 ${n}명 × ${c.units}회 = ${need}석보다 ${need-have}석 부족합니다.`,detail:'기관·병동 탭에서 이 과목의 정원을 늘리거나 기관을 추가하세요.'});
    if(missing[ci].length)issues.push({lv:'bad',msg:`${c.label}을(를) 배치하지 못한 학생 ${missing[ci].length}명`,detail:missing[ci].slice(0,60).map(nm).join(', ')+(missing[ci].length>60?' 외':'')});
  });
  const blk=st.map((s,k)=>k).filter(k=>st[k].blocked.size);
  if(blk.length){const miss=blk.filter(k=>missing.some(m=>m.includes(k)));
    issues.push({lv:miss.length?'warn':'ok',msg:`배치 제외 기간이 있는 학생 ${blk.length}명은 그 기간에 배치하지 않았습니다.${miss.length?` 그중 ${miss.length}명은 남은 기간에 모든 과목을 넣지 못했습니다.`:' 모두 남은 기간에 모든 과목이 배치되었습니다.'}`,
      detail:blk.map(k=>`${nm(k)} ${[...st[k].blocked].sort().map(p=>(P[p]||(p+1)+'차')).join('·')}${st[k].blockReason?' ('+st[k].blockReason+')':''}`).join(', ')});}
  if(!courses.length)issues.push({lv:'bad',msg:'이 학기에 교과목이 없습니다. 기관·병동 탭에서 교과목과 기관을 등록하세요.'});
  let femViol=0;slots.forEach((ss,k)=>ss.forEach(s=>{if(s&&s.inst.female&&st[k].sex==='남')femViol++;}));
  if(femViol)issues.push({lv:'bad',msg:`여학생 전용 기관에 남학생 ${femViol}건이 배치되었습니다.`});
  const hasHist=st.some(s=>s.hist&&s.hist.length);const sameWard=[],sameInst=[],sameInstStu=new Set();
  if(hasHist){
    slots.forEach((ss,k)=>{const H=st[k].hist||[];const seen=new Set();ss.forEach(x=>{if(!x)return;const k1=instKey(x.inst.name),k2=instKey(x.inst.short);const hs=H.filter(h=>h.key===k1||h.key===k2);if(!hs.length)return;
      const cs=wardCodes(x.dept);if(hs.some(h=>h.codes.some(c=>cs.has(c))))sameWard.push(`${nm(k)} ${x.inst.short} ${x.dept}`);
      if(!seen.has(x.inst.name+x.dept)){seen.add(x.inst.name+x.dept);sameInstStu.add(k);sameInst.push(`${nm(k)} ${x.inst.short} ${x.dept} (이전 ${hs.map(h=>h.ward).join(', ')})`);}});});
    if(sameWard.length)issues.push({lv:'bad',msg:`이전 학기와 같은 기관·같은 병동에 배치된 경우 ${sameWard.length}건`,detail:sameWard.join(', ')});
    else issues.push({lv:'ok',msg:'이전 학기와 같은 기관·같은 병동에 다시 배치된 학생은 없습니다.'});
    if(sameInst.length)issues.push({lv:'warn',msg:`이전 학기와 같은 기관(다른 병동)에 배치된 학생 ${sameInstStu.size}명`,detail:sameInst.slice(0,80).join(' · ')+' · 정원이나 다른 조건 때문에 피하지 못한 경우입니다. 배치 기준 점수의 이전 기관 감점을 높이면 줄어듭니다.'});
    const noH=st.map((s,k)=>k).filter(k=>!(st[k].hist&&st[k].hist.length));
    if(noH.length)issues.push({lv:'info',msg:`이전 학기 이력을 찾지 못한 학생 ${noH.length}명`,detail:noH.slice(0,40).map(nm).join(', ')+(noH.length>40?' 외':'')});
  }
  if(deptFail.length)issues.push({lv:'bad',msg:`이전 병동을 피할 병동이 모자라 병동을 정하지 못한 학생 ${new Set(deptFail).size}명`,detail:[...new Set(deptFail)].map(nm).join(', ')});
  const noWardInsts=insts.filter(i=>isNoWard(deptList(i)[0])&&deptList(i).length===1);
  if(noWardInsts.length)issues.push({lv:'info',msg:`병동이 등록되지 않은 기관 ${noWardInsts.length}곳은 기관 단위로만 배치했습니다.`,detail:noWardInsts.map(i=>`${i.short}(${(courses.find(c=>c.key===i.course)||{}).short||''})`).join(', ')+' · 병동을 등록하면 이전 학기와 같은 병동을 피하는 조건까지 적용됩니다.'});
  const under=[];
  insts.forEach(i=>{for(let p=0;p<N;p++){const c=cap(i,p);if(!c)continue;const got=slots.filter(s=>s[p]&&s[p].inst===i).length;if(got<c)under.push(`${(courses.find(x=>x.key===i.course)||{}).short} ${i.short} ${p+1}기간 ${got}/${c}`);}});
  if(under.length)issues.push({lv:'info',msg:`정원보다 적게 배치된 기관·기간 ${under.length}곳`,detail:under.join(' · ')});
  // 지역 우선 점검
  const localInsts=insts.filter(i=>i.local),localKw=[...new Set(localInsts.flatMap(kwList))];
  const isLocalAddr=s=>localKw.some(k=>s.addr.includes(k));
  const inLocal=k=>slots[k].some(x=>x&&x.inst.local);
  const strong=localInsts.length?st.map((s,k)=>k).filter(k=>isLocalAddr(st[k])&&st[k].age>=w.ageCut):[];
  const missStrong=strong.filter(k=>!inLocal(k));
  if(missStrong.length)issues.push({lv:'warn',msg:`안동·영주 주소의 ${w.ageCut}세 이상 학생 ${missStrong.length}명이 지역 기관에 한 번도 배치되지 않았습니다.`,detail:missStrong.map(nm).join(', ')});
  // 성적 우선 점검
  const gk=st.map((s,k)=>k).filter(k=>slots[k].some(x=>x&&x.inst.grade));
  const worst=gk.length?Math.max(...gk.map(k=>st[k].rank)):0;
  const skipped=st.map((s,k)=>k).filter(k=>!gk.includes(k)&&st[k].rank<worst).sort((a,b)=>st[a].rank-st[b].rank);
  if(skipped.length)issues.push({lv:'info',msg:`성적우선 기관 배치 기준(${worst}위)보다 성적이 높지만 성적우선 기관에 가지 않은 학생 ${skipped.length}명`,detail:skipped.slice(0,60).map(k=>`${nm(k)} ${st[k].rank}위${inLocal(k)?' (지역 우선)':''}`).join(', ')});
  let addrTot=0,addrHit=0;
  slots.forEach(ss=>{const seen=new Set();ss.forEach(s=>{if(!s||seen.has(s.inst))return;seen.add(s.inst);if(kwList(s.inst).length){addrTot++;if(s.addrMatch)addrHit++;}});});
  const placed=st.filter((s,k)=>courses.every((c,ci)=>slots[k].filter(x=>x&&x.ci===ci).length>=c.units)).length;
  const stats={n,placed,gradeCount:gk.length,gradeWorst:worst,gradeAvg:gk.length?gk.reduce((a,k)=>a+st[k].rank,0)/gk.length:0,
    strong:strong.length,strongIn:strong.length-missStrong.length,localIn:st.filter((s,k)=>inLocal(k)).length,
    addrRate:addrTot?addrHit/addrTot:0,hasHist,sameWard:sameWard.length,sameInstN:sameInstStu.size};
  if(!issues.some(i=>i.lv==='bad'))issues.unshift({lv:'ok',msg:`모든 학생 ${placed}명이 이 학기 모든 교과목에 배치되었고 정원과 여학생 전용 조건을 지켰습니다.`});
  return {slots,issues,stats,seed};
}
