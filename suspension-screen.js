import {getApps,initializeApp} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {getAuth,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {getFirestore,doc,onSnapshot} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const config={apiKey:"AIzaSyD9prfvOQGMeniL3U8WD2HeeZ6NNArY8J8",authDomain:"toolchat-bfac8.firebaseapp.com",projectId:"toolchat-bfac8",appId:"1:52396840735:web:a608b9c037c8481f2dc22a"};
const app=getApps()[0]||initializeApp(config),auth=getAuth(app),db=getFirestore(app);
const style=document.createElement("style");
style.textContent=`
#nxSuspension{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:22px;overflow:auto;background:radial-gradient(ellipse at 15% 15%,#293b62 0%,transparent 55%),linear-gradient(135deg,#090e1a,#111a30);color:#f1f5ff;font:15px/1.6 system-ui,sans-serif}
#nxSuspension[hidden]{display:none!important}
#nxSuspension *{box-sizing:border-box}
#nxSuspension .nx-susp-card{width:min(100%,510px);padding:clamp(24px,5vw,42px);border:1px solid #a9c0ff30;border-radius:28px;background:#172138f2;box-shadow:0 30px 90px #0009;text-align:center;backdrop-filter:blur(22px)}
#nxSuspension .nx-susp-icon{width:76px;height:76px;display:grid;place-items:center;margin:0 auto 20px;border:1px solid #ff9c9c44;border-radius:24px;background:#ff67721a;color:#ffb2b8;font-size:38px}
#nxSuspension h1{margin:0 0 8px;font-size:clamp(23px,5vw,30px)}
#nxSuspension p{color:#aebedb}
#nxSuspension .nx-susp-detail{margin:18px 0;padding:14px 17px;border:1px solid #b5c5ff22;border-radius:15px;background:#ffffff08;text-align:left;overflow-wrap:anywhere}
#nxSuspension .nx-susp-label{display:block;margin-bottom:3px;color:#93a9d3;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
#nxSuspension .nx-susp-time{font-size:27px;font-weight:800;letter-spacing:.03em;font-variant-numeric:tabular-nums}
#nxSuspension button{padding:12px 22px;border:1px solid #9aafff55;border-radius:13px;background:#273657;color:white;cursor:pointer}
body.nx-suspended{overflow:hidden!important}
`;
document.head.append(style);
const screen=document.createElement("div");
screen.id="nxSuspension";screen.hidden=true;
screen.setAttribute("role","alertdialog");screen.setAttribute("aria-modal","true");screen.setAttribute("aria-labelledby","nxSuspTitle");
screen.innerHTML=`<div class="nx-susp-card">
<div class="nx-susp-icon" aria-hidden="true">⛔</div>
<h1 id="nxSuspTitle">Аккаунт заблокирован</h1>
<p>Доступ к функциям NEXORA временно ограничен администрацией.</p>
<div class="nx-susp-detail"><span class="nx-susp-label">Причина блокировки</span><strong id="nxSuspReason"></strong></div>
<div class="nx-susp-detail"><span class="nx-susp-label">Окончание блокировки</span><strong id="nxSuspUntil"></strong></div>
<div class="nx-susp-detail"><span class="nx-susp-label">Осталось времени</span><div class="nx-susp-time" id="nxSuspCountdown"></div></div>
<p>До окончания блокировки пользоваться платформой нельзя.</p>
<button type="button" id="nxSuspLogout">Выйти из аккаунта</button>
</div>`;
document.body.append(screen);
const $=id=>document.getElementById(id);
$("nxSuspLogout").onclick=()=>signOut(auth);
let unsubscribe=null,ticker=null,until=0,reason="",currentUid=null;
const formatTime=ms=>{
 const seconds=Math.max(0,Math.ceil(ms/1000));
 const days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60),secs=seconds%60;
 return (days?days+" д. ":"")+[hours,minutes,secs].map(x=>String(x).padStart(2,"0")).join(":");
};
function update(){
 const remaining=until-Date.now();
 if(remaining<=0){hide();return}
 $("nxSuspCountdown").textContent=formatTime(remaining);
}
function hide(){
 screen.hidden=true;
 document.body.classList.remove("nx-suspended");
 clearInterval(ticker);ticker=null;
}
function show(data){
 const expiry=data.bannedUntil?.toMillis?.()||0;
 if(expiry<=Date.now()){hide();return}
 until=expiry;reason=String(data.bannedReason||"Нарушение правил платформы");
 $("nxSuspReason").textContent=reason;
 $("nxSuspUntil").textContent=new Date(until).toLocaleString("ru-RU",{dateStyle:"long",timeStyle:"short"});
 screen.hidden=false;
 document.body.classList.add("nx-suspended");
 clearInterval(ticker);update();ticker=setInterval(update,1000);
 $("nxSuspLogout").focus();
}
onAuthStateChanged(auth,user=>{
 unsubscribe?.();unsubscribe=null;hide();currentUid=user?.uid||null;
 if(!user?.emailVerified)return;
 const uid=user.uid;
 unsubscribe=onSnapshot(doc(db,"users",uid),snap=>{
  if(currentUid!==uid)return;
  if(snap.exists())show(snap.data());else hide();
 },err=>console.warn("Account suspension:",err.message));
});
