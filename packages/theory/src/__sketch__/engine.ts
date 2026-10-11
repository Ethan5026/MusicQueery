/* eslint-disable */
// @ts-nocheck
// Verbatim port of the engine in design/sketchbook.html <script> (lines 773–992), DOM removed and the
// instrument passed in. Used only by sketch.test.ts to check @mq/theory against the approved design.
let inst = 'concert'
export const setInst = (i) => { inst = i }
const LET='CDEFGAB', NAT=[0,2,4,5,7,9,11];
const INST={concert:{l:0,s:0,label:'Concert pitch'},alto:{l:5,s:9,label:'Written · E♭ alto'},tenor:{l:1,s:2,label:'Written · B♭ tenor'}};
const mod=(n,m)=>((n%m)+m)%m;
function pn(n){const L=LET.indexOf(n[0]);let a=0;for(const c of n.slice(1)){if(c==='♭')a--;else if(c==='♯')a++;}return{L,a,pc:mod(NAT[L]+a,12)};}
function sp(L,pc){L=mod(L,7);let a=mod(pc-NAT[L],12);if(a>6)a-=12;return LET[L]+(a>0?'♯'.repeat(a):'♭'.repeat(-a));}
export function tn(n){if(inst==='concert')return n;const p=pn(n),i=INST[inst];return sp(p.L+i.l,p.pc+i.s);}
const pcOf=n=>pn(n).pc;
export function parseChord(sym){const m=sym.match(/^([A-G][♭♯]?)(.*)$/),q=m[2];
  const type=q.startsWith('maj7')?'maj7':q.startsWith('m7♭5')?'m7b5':q.startsWith('m7')?'m7':q.startsWith('°7')?'dim7':q.startsWith('7♯5')?'aug7':q.startsWith('7')?'7':'maj';
  return{root:m[1],q,type};}
export const tsym=sym=>{const c=parseChord(sym);return tn(c.root)+c.q;};
const TONES={maj7:[[0,0],[2,4],[4,7],[6,11]],m7:[[0,0],[2,3],[4,7],[6,10]],'7':[[0,0],[2,4],[4,7],[6,10]],m7b5:[[0,0],[2,3],[4,6],[6,10]],dim7:[[0,0],[2,3],[4,6],[6,9]],aug7:[[0,0],[2,4],[4,8],[6,10]],maj:[[0,0],[2,4],[4,7]]};
export function chordTones(sym){const c=parseChord(sym),r=pn(c.root);return TONES[c.type].map(([l,s])=>sp(r.L+l,r.pc+s));}
export const SCALES: any={major:['major',[0,2,4,5,7,9,11]],lydian:['Lydian',[0,2,4,6,7,9,11]],mixolydian:['Mixolydian',[0,2,4,5,7,9,10]],dorian:['Dorian',[0,2,3,5,7,9,10]],aeolian:['Aeolian',[0,2,3,5,7,8,10]],phrygian:['Phrygian',[0,1,3,5,7,8,10]],locrian:['Locrian',[0,1,3,5,6,8,10]],locrian2:['Locrian ♮2',[0,2,3,5,6,8,10]],phrygdom:['Phrygian dominant',[0,1,4,5,7,8,10]],whole:['whole tone',[0,2,4,6,8,10]],dim:['diminished',[0,2,3,5,6,8,9,11]],bebopMaj:['major bebop',[0,2,4,5,7,8,9,11]],bebopDom:['dominant bebop',[0,2,4,5,7,9,10,11]],bebopDor:['Dorian bebop',[0,2,3,4,5,7,9,10]],melmin:['melodic minor',[0,2,3,5,7,9,11]],lyddom:['Lydian dominant',[0,2,4,6,7,9,10]],altered:['altered',[0,1,3,4,6,8,10]]};
const STEPS={whole:[0,1,2,3,4,6],dim:[0,1,2,3,4,5,5,6],bebopMaj:[0,1,2,3,4,5,5,6],bebopDom:[0,1,2,3,4,5,6,6],bebopDor:[0,1,2,2,3,4,5,6]};
export function scaleNotes(root,key){const iv=SCALES[key][1],r=pn(root),st=STEPS[key]||[0,1,2,3,4,5,6];return iv.map((x,i)=>sp(r.L+st[i],r.pc+x));}
const RN=['I','♭II','II','♭III','III','IV','♯IV','V','♭VI','VI','♭VII','VII'];
export function roman(sym,reg){const c=parseChord(sym),d=mod(pcOf(c.root)-pcOf(reg),12);let r=RN[d];if(['m7','m7b5','dim7'].includes(c.type))r=r.toLowerCase();return r+{maj7:'maj7',m7:'7','7':'7',m7b5:'ø7',dim7:'°7',aug7:'+7',maj:''}[c.type];}
export function pickScale(sym,reg,next,ln): any{const c=parseChord(sym),d=mod(pcOf(c.root)-pcOf(reg),12),nm=next&&['m7','m7b5'].includes(parseChord(next).type);
  if(ln==='inside')return{maj7:d===5?'lydian':'major',m7:d===9?'aeolian':d===4?'phrygian':'dorian','7':nm?'phrygdom':'mixolydian',m7b5:'locrian',dim7:'dim',aug7:'whole',maj:'major'}[c.type];
  if(ln==='bebop')return{maj7:'bebopMaj',m7:'bebopDor','7':'bebopDom',m7b5:'locrian2',dim7:'dim',aug7:'whole',maj:'bebopMaj'}[c.type];
  return{maj7:'lydian',m7:'melmin','7':nm?'altered':'lyddom',m7b5:'locrian2',dim7:'dim',aug7:'altered',maj:'lydian'}[c.type];}

/* ---- the tune ---- */
const R=(k,n)=>Array(n).fill(k);
const FORM=[['Fm7'],['B♭m7'],['E♭7'],['A♭maj7'],['D♭maj7'],['G7'],['Cmaj7'],['Cmaj7'],
 ['Cm7'],['Fm7'],['B♭7'],['E♭maj7'],['A♭maj7'],['Am7','D7'],['Gmaj7'],['Gmaj7'],
 ['Am7'],['D7'],['Gmaj7'],['Gmaj7'],['F♯m7'],['B7'],['Emaj7'],['C7♯5'],
 ['Fm7'],['B♭m7'],['E♭7'],['A♭maj7'],['D♭maj7'],['D♭m7'],['Cm7'],['B°7'],['B♭m7'],['E♭7'],['A♭maj7'],['Gm7♭5','C7']];
const FREG=[...R('A♭',5),...R('C',3),...R('E♭',5),...R('G',7),...R('E',3),...R('A♭',13)];
const FFN={24:['V7/vi'],30:['iv7 borrowed'],32:['passing °7'],36:['iiø7/vi','V7/vi']};
const INTRO=[['B♭m7'],['E♭7'],['A♭maj7'],['Gm7♭5','C7']], END=[['B♭m7'],['E♭7'],['A♭maj7'],['A♭maj7']];
const SECTIONS=[{name:'Intro',bars:INTRO,reg:R('A♭',4),fn:{4:['iiø7/vi','V7/vi']}}];
['Head','Sax solo · ch 1','Sax solo · ch 2','Piano solo','Head out'].forEach(n=>SECTIONS.push({name:n,bars:FORM,reg:FREG,fn:FFN,form:true}));
SECTIONS.push({name:'Ending',bars:END,reg:R('A♭',4),fn:{}});
export const BARS: any[]=[], EV: any[]=[];
SECTIONS.forEach((sec,si)=>{sec.start=BARS.length;sec.bars.forEach((ch,bi)=>BARS.push({si,b:bi+1,ch,reg:sec.reg[bi],fn:sec.fn[bi+1]}));});
let beat=0;
BARS.forEach((bar,ab)=>{const len=4/bar.ch.length;bar.ch.forEach((sym,ci)=>{const ov=bar.fn?bar.fn[ci]:null,last=EV[EV.length-1];
  if(last&&last.sym===sym&&last.reg===bar.reg&&!ov&&!last.ov)last.len+=len;else EV.push({sym,reg:bar.reg,start:beat,len,ab,ov,fn:ov});beat+=len;});});
export const TOTAL=beat;
EV.forEach((e,i)=>{e.fn=e.fn||roman(e.sym,e.reg);e.next=EV[i+1]?EV[i+1].sym:null;});

export function at(b): any{b=Math.min(TOTAL-1e-6,Math.max(0,b));const i=EV.findIndex(e=>b<e.start+e.len);const ab=Math.floor(b/4);return{b,i,ev:EV[i],ab,bar:BARS[ab],beatIn:Math.floor(b%4),frac:(b%4)/4};}
export function nextChange(s): any{for(let j=s.i+1;j<EV.length;j++)if(EV[j].reg!==s.ev.reg)return EV[j];return null;}
/** guideHTML() without the HTML: [[from, deg, to, deg], …] */
export function guide(ev): any{if(!ev.next)return null;const a=chordTones(tsym(ev.sym)),b=chordTones(tsym(ev.next));if(a.length<4)return null;
  const cand=[[b[1],'3'],[b[3]||b[1],b[3]?'7':'3']];
  const pair=(n,deg)=>{let best=cand[0],bd=99;cand.forEach(c=>{const d=Math.min(mod(pcOf(c[0])-pcOf(n),12),mod(pcOf(n)-pcOf(c[0]),12));if(d<bd){bd=d;best=c;}});return [n,deg,best[0],best[1]];};
  return [pair(a[1],'3'),pair(a[3],'7')];}
/** renderCoach()'s ii–V–I search: [startIndex, guide-tone line, target, mode] */
export function coachTwoFive(i): any{for(let j=i;j<Math.min(EV.length-2,i+8);j++){const a=parseChord(EV[j].sym),b=parseChord(EV[j+1].sym),c=parseChord(EV[j+2].sym);
    if(['m7','m7b5'].includes(a.type)&&b.type==='7'&&['maj7','m7'].includes(c.type)&&mod(pcOf(b.root)-pcOf(a.root),12)===5&&mod(pcOf(c.root)-pcOf(b.root),12)===5){
      const at_=chordTones(tsym(EV[j].sym)),bt=chordTones(tsym(EV[j+1].sym)),ct=chordTones(tsym(EV[j+2].sym));
      return [j,[at_[3],bt[1],ct[3]],tn(c.root),c.type==='m7'?'minor':'major'];}}
  return null;}
