import {initializeApp,getApps,getApp} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {getAuth,onAuthStateChanged,getIdToken} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {getFirestore,collection,getDocs,doc,onSnapshot,setDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
const $=id=>document.getElementById(id),ownerUid="ElpAtxZIBCZVsLBcLzgdIsr8T1w2";
const cfg={apiKey:"AIzaSyD9prfvOQGMeniL3U8WD2HeeZ6NNArY8J8",authDomain:"toolchat-bfac8.firebaseapp.com",projectId:"toolchat-bfac8",storageBucket:"toolchat-bfac8.firebasestorage.app",messagingSenderId:"52396840735",appId:"1:52396840735:web:a608b9c037c8481f2dc22a"};
const app=getApps().length?getApp():initializeApp(cfg),auth=getAuth(app),db=getFirestore(app);
const caseRef=doc(db,"randomizerLive","current"),luckRef=doc(db,"randomizerLuck","current");
let owner=false,users=[],selected=new Set(),lastCase=null,lastLuck=null,caseBusy=false,luckBusy=false,caseSeq=0,luckSeq=0,wheelAngle=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),reduced=()=>matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const label=u=>u?.name||u?.username||"Пользователь";
function rand(n){const a=new Uint32Array(1);crypto.getRandomValues(a);return Math.floor(a[0]/4294967296*n)}
function shufflePick(a,n){const b=[...a];for(let i=0;i<n;i++){let j=i+rand(b.length-i);[b[i],b[j]]=[b[j],b[i]]}return b.slice(0,n)}
function note(t){$("rxNotice").textContent=t}
function showMode(luck){$("rxCase").hidden=luck;$("rxLuck").hidden=!luck;$("rxCaseTab").classList.toggle("rx-active",!luck);$("rxLuckTab").classList.toggle("rx-active",luck)}
$("rxCaseTab").onclick=()=>showMode(false);$("rxLuckTab").onclick=()=>showMode(true);
$("nxRandomizerNav").onclick=()=>{const section=$("nxRandomizer");for(const el of $("mainContent").children)if(el!==section)el.classList.add("hidden");section.hidden=false;document.querySelectorAll(".nav button").forEach(b=>b.classList.toggle("active",b.id==="nxRandomizerNav"));window.scrollTo({top:0,behavior:"smooth"})};
document.querySelectorAll('[data-page],[data-nx-panel]').forEach(b=>b.addEventListener("click",()=>{$("nxRandomizer").hidden=true},true));
function renderPeople(){$("rxPeopleCount").textContent=users.length;$("rxPeople").innerHTML=users.map(u=>'<button type="button" data-rx-id="'+esc(u.id)+'" aria-pressed="'+selected.has(u.id)+'">'+esc(label(u))+'</button>').join("");$("rxPeople").querySelectorAll("button").forEach(b=>b.onclick=()=>{selected.has(b.dataset.rxId)?selected.delete(b.dataset.rxId):selected.add(b.dataset.rxId);renderPeople()})}
function caseResult(data){const map=new Map(users.map(u=>[u.id,u]));$("rxWinners").innerHTML='<h3>Победители</h3>'+data.winners.map((id,i)=>'<p>✦ '+(i+1)+'. '+esc(label(map.get(id)))+'</p>').join("")}
// A case result is the card at the fixed pointer, not a separate visual override.
async function animateCase(data,replay=false){
 const seq=++caseSeq;caseBusy=true;$("rxRoll").disabled=true;$("rxCaseReplay").disabled=true;$("rxWinners").innerHTML="";
 const people=new Map(users.map(u=>[u.id,u]));
 const strips=(data.reels||[]).map(r=>Array.isArray(r)?r:r.ids||[]);
 const easing=t=>1-Math.pow(1-t,4.2);
 try{
  for(let i=0;i<strips.length;i++){
   if(seq!==caseSeq)return;
   const ids=strips[i],stop=72;
   if(ids.length<=stop||ids[stop]!==data.winners[i])throw Error("Некорректная лента розыгрыша");
   const reel=$("rxReel"),viewport=reel.parentElement;
   reel.style.transition="none";reel.style.transform="translate3d(0,0,0)";
   reel.innerHTML=ids.map(id=>'<div class="rx-tile">'+esc(label(people.get(id)))+'</div>').join("");
   const tiles=reel.children;
   const destination=viewport.clientWidth/2-(tiles[stop].offsetLeft+tiles[stop].offsetWidth/2);
   const initial=viewport.clientWidth/2-(tiles[0].offsetLeft+tiles[0].offsetWidth/2);
   const travel=destination-initial;
   const slow=reduced(),duration=slow?80:7800+rand(2200);
   const start=performance.now();
   $("rxCaseStatus").textContent=(replay?"↻ ПОВТОР":"🔴 LIVE")+" · "+(i+1)+"/"+strips.length;
   await new Promise(resolve=>{
    function frame(now){
     if(seq!==caseSeq){resolve();return}
     const t=Math.min(1,(now-start)/duration);
     // Single continuous monotonic motion: no fake backward jump across another card.
     const pos=initial+travel*easing(t);
     reel.style.transform="translate3d("+pos+"px,0,0)";
     if(t<1)requestAnimationFrame(frame);else resolve();
    }
    requestAnimationFrame(frame);
   });
   if(seq!==caseSeq)return;
   // The pointer is precisely centered on the winning card.
   reel.style.transform="translate3d("+destination+"px,0,0)";
   tiles[stop].classList.add("rx-winning-tile");
   $("rxCaseStatus").textContent="✦ Победитель "+(i+1)+": "+label(people.get(ids[stop]));
   if(!slow)await sleep(950);
  }
  if(seq===caseSeq){caseResult(data);$("rxCaseStatus").textContent="Розыгрыш завершён";$("rxCaseReplay").hidden=false}
 }finally{if(seq===caseSeq){caseBusy=false;$("rxRoll").disabled=false;$("rxCaseReplay").disabled=false}}
}
$("rxCaseReplay").onclick=()=>{if(lastCase&&!caseBusy)animateCase(lastCase,true).catch(e=>note("Ошибка повтора: "+e.message))};
$("rxRoll").onclick=async()=>{if(!owner){note("CASE ROLL доступен только подтверждённому аккаунту владельца");return}if(caseBusy)return;const pool=$("rxSelectedOnly").checked?users.filter(u=>selected.has(u.id)):users,n=Number($("rxCount").value);if(!Number.isInteger(n)||n<1||n>10){note("Выбери от 1 до 10 победителей");return}if(pool.length<n){note("Недостаточно участников: "+pool.length);return}if(pool.length>2000){note("Лимит: 2000 участников");return}caseBusy=true;$("rxRoll").disabled=true;$("rxCaseStatus").textContent="Публикация в Firebase…";const available=[...pool],wins=[],reels=[];
for(let i=0;i<n;i++){
 // Every visible tile is sampled independently; the tile under the pointer wins.
 // Exclude previous winners from subsequent rounds.
 const ids=Array.from({length:81},()=>available[rand(available.length)].id);
 const winningId=ids[72];
 wins.push(available.find(u=>u.id===winningId));
 reels.push({ids});
 available.splice(available.findIndex(u=>u.id===winningId),1);
}
const payload={status:"running",mode:$("rxSelectedOnly").checked?"selected":"all",participants:pool.map(u=>u.id),winners:wins.map(u=>u.id),reels,durationMs:Math.min(60000,n*9000),startedAt:serverTimestamp(),updatedAt:serverTimestamp()};try{await getIdToken(auth.currentUser,true);await setDoc(caseRef,payload);note("CASE ROLL опубликован");if(!lastCase||!caseBusy){lastCase={...payload,startedAt:{toMillis:()=>Date.now()}}}if(!document.hidden)animateCase({...payload,startedAt:{toMillis:()=>Date.now()}}).catch(e=>note("Анимация: "+e.message))}catch(e){caseBusy=false;$("rxRoll").disabled=false;$("rxCaseStatus").textContent="Ошибка записи: "+(e.code||e.message);note("Firestore отклонил CASE ROLL: "+(e.code||e.message)+" · UID: "+auth.currentUser?.uid+" · verified: "+auth.currentUser?.emailVerified)}};
function setChance(c){$("rxChance").value=c;$("rxChanceText").textContent=c+"%";$("rxWheel").style.setProperty("--rx-chance",c+"%")}
$("rxChance").oninput=()=>setChance(Number($("rxChance").value));
function finishLuck(data){const ok=data.angle<data.chance*3.6;$("rxLuckResult").textContent=ok?"✓ УСПЕХ":"✕ НЕУДАЧА";$("rxLuckResult").className="rx-result "+(ok?"rx-success":"rx-fail");$("rxLuckReplay").hidden=false}
async function animateLuck(data,replay=false){const seq=++luckSeq;luckBusy=true;$("rxSpin").disabled=true;$("rxLuckReplay").disabled=true;setChance(data.chance);$("rxLuckResult").textContent="";$("rxLuckStatus").textContent=replay?"↻ Повтор":"🔴 LIVE · вращение";const wheel=$("rxWheel");const target=(360-data.angle)%360;const delta=(target-(wheelAngle%360)+360)%360;wheelAngle+=1800+delta;wheel.style.transition=reduced()?"none":"transform 4s cubic-bezier(.12,.75,.1,1)";wheel.style.transform="rotate("+wheelAngle+"deg)";await sleep(reduced()?100:4200);if(seq!==luckSeq)return;finishLuck(data);$("rxLuckStatus").textContent="Вращение завершено";luckBusy=false;$("rxSpin").disabled=false;$("rxLuckReplay").disabled=false}
$("rxLuckReplay").onclick=()=>{if(lastLuck&&!luckBusy)animateLuck(lastLuck,true).catch(e=>note(e.message))};
$("rxSpin").onclick=async()=>{if(!owner){note("Запуск колеса доступен только владельцу");return}if(luckBusy)return;const chance=Number($("rxChance").value),angle=rand(360);luckBusy=true;$("rxSpin").disabled=true;$("rxLuckStatus").textContent="Публикация вращения…";try{await getIdToken(auth.currentUser,true);await setDoc(luckRef,{chance,angle,success:angle<chance*3.6,startedAt:serverTimestamp(),updatedAt:serverTimestamp()});note("Вращение опубликовано");animateLuck({chance,angle,success:angle<chance*3.6},false).catch(e=>note("Ошибка анимации: "+e.message))}catch(e){luckBusy=false;$("rxSpin").disabled=false;$("rxLuckResult").textContent="";$("rxLuckStatus").textContent="Ошибка записи: "+(e.code||e.message);note("Firestore отклонил вращение: "+(e.code||e.message)+" · UID: "+auth.currentUser?.uid+" · verified: "+auth.currentUser?.emailVerified)}};
onAuthStateChanged(auth,async u=>{owner=!!u&&u.uid===ownerUid&&u.emailVerified;$("rxOwnerCase").hidden=!owner;$("rxOwnerLuck").hidden=!owner;note(u?(owner?"Режим владельца · UID подтверждён":"Режим зрителя · UID: "+u.uid+" · verified: "+u.emailVerified+" · ожидается: "+ownerUid):"Для эфира войди в аккаунт");if(!u||!u.emailVerified){note(u?"Подтверди почту в Firebase Auth":"Войди в NEXORA");return}try{const snap=await getDocs(collection(db,"users"));users=snap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>u.status!=="banned"&&u.privacy?.discoverable!==false);renderPeople()}catch(e){note("Ошибка списка пользователей: "+(e.code||e.message))}onSnapshot(caseRef,s=>{if(!s.exists()||s.metadata.hasPendingWrites)return;const d=s.data();lastCase=d;$("rxCaseReplay").hidden=false;const start=d.startedAt?.toMillis?.()||0;if(start&&Date.now()-start>d.durationMs+1000){if(!caseBusy){caseResult(d);$("rxCaseStatus").textContent="Последний розыгрыш · доступен повтор"}return}if(!caseBusy)animateCase(d).catch(e=>note("Ошибка анимации: "+e.message))},e=>note("CASE ROLL: "+(e.code||e.message)));onSnapshot(luckRef,s=>{if(!s.exists()||s.metadata.hasPendingWrites)return;const d=s.data();lastLuck=d;const start=d.startedAt?.toMillis?.()||0;if(start&&Date.now()-start>5000){if(!luckBusy){setChance(d.chance);wheelAngle=(360-d.angle)%360;const wheel=$("rxWheel");wheel.style.transition="none";wheel.style.transform="rotate("+wheelAngle+"deg)";finishLuck(d);$("rxLuckStatus").textContent="Последний результат · доступен повтор"}return}if(!luckBusy)animateLuck(d).catch(e=>note("Ошибка колеса: "+e.message))},e=>note("LUCK UPGRADE: "+(e.code||e.message)))});

if(location.hash==="#randomizer"){const open=()=>{if(!$("app")?.classList.contains("hidden"))$("nxRandomizerNav")?.click()};onAuthStateChanged(auth,u=>{if(u)setTimeout(open,450)});}
