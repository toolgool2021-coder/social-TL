import {filterGroups} from "./groups-search.mjs";
import {initializeApp,getApps,getApp} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {getAuth,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {getFirestore,collection,doc,getDoc,getDocs,query,where,orderBy,limit,onSnapshot,serverTimestamp,setDoc,writeBatch,runTransaction,updateDoc} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
const cfg={apiKey:"AIzaSyD9prfvOQGMeniL3U8WD2HeeZ6NNArY8J8",authDomain:"toolchat-bfac8.firebaseapp.com",projectId:"toolchat-bfac8",storageBucket:"toolchat-bfac8.firebasestorage.app",messagingSenderId:"52396840735",appId:"1:52396840735:web:a608b9c037c8481f2dc22a"};
const app=getApps().length?getApp():initializeApp(cfg),auth=getAuth(app),db=getFirestore(app);
const OWNER="ElpAtxZIBCZVsLBcLzgdIsr8T1w2";
const $=id=>document.getElementById(id);
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let me=null,kind="clan",groups=[],active=null,unsubMessages=null,unsubMembers=null,unsubJoinStatus=null,unsubGroups=null,member=false,memberRole="",ownerMode=false;
function notice(t){$("notice").textContent=t; if(t)setTimeout(()=>{if($("notice").textContent===t)$("notice").textContent=""},6500)}
function err(e){console.error("[NEXORA GROUPS]",e);const message=e?.code==="permission-denied"?"Firestore отклонил действие. Проверь, что опубликованы последние firestore.rules, вход выполнен с UID владельца и почта подтверждена.":(e?.message||e?.code||String(e));notice("Ошибка: "+message)}
function ensure(){if(!me||!me.emailVerified)throw Error("Войди в аккаунт и подтверди электронную почту")}
function selectKind(k){kind=k;document.querySelectorAll("[data-kind]").forEach(b=>b.classList.toggle("active",b.dataset.kind===k));$("catalog").hidden=false;$("createPanel").hidden=true;$("ownerPanel").hidden=true;$("groupPanel").hidden=true;active=null;unsubMessages?.();unsubMessages=null;unsubMembers?.();unsubMembers=null;unsubJoinStatus?.();unsubJoinStatus=null;$("tagField").hidden=k!=="clan";$("createForm").elements.tag.required=k==="clan";$("createForm").elements.tag.value=k==="clan"?$("createForm").elements.tag.value:"";renderCards()}
document.querySelectorAll("[data-kind]").forEach(b=>b.onclick=()=>selectKind(b.dataset.kind));
$("newBtn").onclick=async()=>{try{ensure();$("catalog").hidden=true;$("groupPanel").hidden=true;$("ownerPanel").hidden=true;$("createPanel").hidden=false;const snap=await getDoc(doc(db,"groupRequests",me.uid+"_"+kind));$("myRequest").textContent=snap.exists()?"Ваша заявка: "+({pending:"ожидает решения",approved:"одобрена",rejected:"отклонена"}[snap.data().status]||snap.data().status)+". ":"";$("createForm").querySelector('button[type="submit"]').disabled=snap.exists()&&snap.data().status!=="rejected";}catch(e){err(e)}};
$("cancelBtn").onclick=()=>selectKind(kind);
$("createForm").onsubmit=async e=>{e.preventDefault();try{ensure();const f=new FormData(e.target),name=String(f.get("name")).trim(),tag=kind==="clan"?String(f.get("tag")).trim().toUpperCase():"",category=String(f.get("category")).trim(),description=String(f.get("description")).trim(),reason=String(f.get("reason")).trim();if(name.length<3||name.length>40||(kind==="clan"?!/^[A-Za-z0-9_]{3}$/.test(tag):tag!=="")||category.length<2||category.length>40||description.length>500||reason.length<10||reason.length>500)throw Error("Проверь поля заявки");const btn=e.target.querySelector('button[type="submit"]');btn.disabled=true;try{await setDoc(doc(db,"groupRequests",me.uid+"_"+kind),{ownerId:me.uid,kind,name,tag,category,description,reason,status:"pending",createdAt:serverTimestamp()});notice("Заявка отправлена владельцу NEXORA");selectKind(kind)}finally{btn.disabled=false}}catch(e){err(e)}};
function renderCards(){const a=filterGroups(groups,kind,$("groupSearch")?.value,$("verifiedGroupsOnly")?.checked);if($("groupSearchCount"))$("groupSearchCount").textContent="Найдено: "+a.length;$("cards").innerHTML=a.length?a.map(g=>'<article class="glass card"><div class="actions">'+(g.kind==="clan"?'<span class="tag">['+esc(g.tag)+']</span>':'')+(g.verified?'<span class="tag">✓ Подтверждено</span>':'')+'<span class="small">'+esc(g.category)+'</span></div><h3>'+esc(g.name)+'</h3><p>'+esc(g.description)+'</p><div class="actions"><button data-open="'+esc(g.id)+'" class="primary">Открыть →</button></div></article>').join(""):'<div class="empty">Пока нет одобренных '+(kind==="clan"?"кланов":"сообществ")+'</div>';document.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openGroup(b.dataset.open))}
$("groupSearch")?.addEventListener("input",renderCards);
$("verifiedGroupsOnly")?.addEventListener("change",renderCards);
async function openGroup(id){
 try{
  ensure();
  const g=groups.find(x=>x.id===id);
  if(!g)return;
  active=g;
  unsubMessages?.();unsubMessages=null;
  unsubMembers?.();unsubMembers=null;
  unsubJoinStatus?.();unsubJoinStatus=null;
  $("catalog").hidden=true;$("createPanel").hidden=true;$("ownerPanel").hidden=true;$("groupPanel").hidden=false;
  $("groupTitle").textContent=(g.kind==="clan"?"["+g.tag+"] ":"")+(g.verified?"✓ ":"")+g.name;
  $("groupAbout").textContent=g.description+" · "+g.category;
  $("chatHeading").textContent=g.kind==="clan"?"Публикации канала":"Групповой чат";
  const m=await getDoc(doc(db,"groups",id,"members",me.uid));
  if(active?.id!==id)return;
  member=m.exists();memberRole=m.exists()?m.data().role:"";
  refreshMembership();
  if(member){watchMessages();watchMembers()}
  else if(g.kind==="community"){
   const uid=me.uid;
   unsubJoinStatus=onSnapshot(doc(db,"groups",id,"joinRequests",uid),async snap=>{
    if(active?.id!==id||me?.uid!==uid||member)return;
    const status=snap.exists()?snap.data().status:"";
    if(status==="approved"){
     const membership=await getDoc(doc(db,"groups",id,"members",uid));
     if(active?.id!==id||me?.uid!==uid)return;
     if(membership.exists()){
      member=true;memberRole=membership.data().role;
      const current=await getDoc(doc(db,"groups",id));
      if(current.exists())active.memberCount=current.data().memberCount;
      refreshMembership();watchMessages();watchMembers();
      unsubJoinStatus?.();unsubJoinStatus=null;
      notice("Заявка одобрена — вы вступили в сообщество");
      return;
     }
    }
    $("joinBtn").disabled=status==="pending"||status==="approved"||status==="rejected"||active.memberCount>=30;
    $("joinBtn").textContent= status==="pending"?"Ожидает одобрения":status==="approved"?"Заявка одобрена":status==="rejected"?"Заявка отклонена":"Подать заявку";
    $("memberStatus").textContent=status==="pending"?"Заявка отправлена владельцу":status==="approved"?"Одобрено, обновляем участие…":status==="rejected"?"Повторная подача пока недоступна":"Участников: "+active.memberCount+"/30";
   },err);
  }
 }catch(e){err(e)}
}
function refreshMembership(){$("reviewJoinBtn").hidden=!active||active.kind!=="community"||active.ownerId!==me?.uid;$("joinRequestsPanel").hidden=true;if(!member&&active?.kind==="community"){$("joinBtn").textContent="Подать заявку";}$("membersPanel").hidden=!member;if(!member){unsubMembers?.();unsubMembers=null;$("membersList").innerHTML="";}$("joinBtn").hidden=member;$("leaveBtn").hidden=!member||active?.ownerId===me?.uid;$("memberStatus").textContent=member?(active.kind==="community"?"Вы участник · "+active.memberCount+"/30":"Вы подписаны"):(active.kind==="community"?"Участников: "+active.memberCount+"/30":"Подписаться на канал");$("joinBtn").disabled=!member&&active.kind==="community"&&active.memberCount>=30;$("chatForm").hidden=!member||(active.kind==="clan"&&memberRole!=="leader");if(!member)$("chatMessages").innerHTML='<div class="empty">Вступи, чтобы читать сообщения</div>'}
$("joinBtn").onclick=async()=>{
  try{
    ensure();
    if(!active) return;
    if(active.kind==="community"){
      const requestRef=doc(db,"groups",active.id,"joinRequests",me.uid);
      const existing=await getDoc(requestRef);
      if(existing.exists() && existing.data().status!=="rejected"){
        notice(existing.data().status==="pending"?"Заявка уже ожидает рассмотрения":"Заявка уже одобрена");
        return;
      }
      if(existing.exists()) throw Error("Повторная заявка после отказа пока недоступна");
      await setDoc(requestRef,{uid:me.uid,status:"pending",createdAt:serverTimestamp()});
      notice("Заявка отправлена владельцу сообщества");
      $("joinBtn").disabled=true;
      $("joinBtn").textContent="Заявка отправлена";
      return;
    }
    await runTransaction(db,async tx=>{
      const gref=doc(db,"groups",active.id),mref=doc(db,"groups",active.id,"members",me.uid);
      const g=await tx.get(gref),m=await tx.get(mref);
      if(!g.exists()||g.data().status!=="active")throw Error("Объединение недоступно");
      if(m.exists())throw Error("Вы уже участник");
      tx.update(gref,{memberCount:g.data().memberCount+1});
      tx.set(mref,{uid:me.uid,role:"member",joinedAt:serverTimestamp()});
    });
    member=true;memberRole="member";active.memberCount++;
    refreshMembership();watchMessages();watchMembers();
  }catch(e){err(e)}
};
$("reviewJoinBtn").onclick=async()=>{
  if(!active||active.ownerId!==me?.uid)return;
  const panel=$("joinRequestsPanel");
  panel.hidden=!panel.hidden;
  if(panel.hidden)return;
  try{
    const snap=await getDocs(query(collection(db,"groups",active.id,"joinRequests"),where("status","==","pending"),limit(30)));
    $("joinRequestsList").innerHTML=snap.empty?'<p class="small">Нет новых заявок</p>':snap.docs.map(d=>
      '<div class="nx-member-row"><span>'+esc(d.id.slice(0,16))+'</span><div class="actions"><button data-join-approve="'+esc(d.id)+'" class="primary">Принять</button><button data-join-reject="'+esc(d.id)+'">Отклонить</button></div></div>').join("");
  }catch(e){err(e)}
};
$("joinRequestsList").onclick=async event=>{
  const approve=event.target.closest("[data-join-approve]");
  const reject=event.target.closest("[data-join-reject]");
  const uid=approve?.dataset.joinApprove||reject?.dataset.joinReject;
  if(!uid||!active||active.ownerId!==me?.uid)return;
  const button=approve||reject;
  button.disabled=true;
  try{
    const id=active.id;
    await runTransaction(db,async tx=>{
      const gref=doc(db,"groups",id),mref=doc(db,"groups",id,"members",uid),rref=doc(db,"groups",id,"joinRequests",uid);
      const group=await tx.get(gref),request=await tx.get(rref),existing=await tx.get(mref);
      if(!group.exists()||group.data().ownerId!==me.uid||!request.exists()||request.data().status!=="pending")throw Error("Заявка уже обработана");
      if(approve){
        if(existing.exists())throw Error("Пользователь уже участник");
        if(group.data().memberCount>=30)throw Error("Сообщество заполнено");
        tx.update(gref,{memberCount:group.data().memberCount+1,lastApprovedUid:uid});
        tx.set(mref,{uid,role:"member",joinedAt:serverTimestamp()});
      }
      tx.update(rref,{status:approve?"approved":"rejected",reviewedBy:me.uid,reviewedAt:serverTimestamp()});
    });
    button.closest(".nx-member-row")?.remove();
    if(approve&&active?.id===id){
      active.memberCount++;
      refreshMembership();
      $("joinRequestsPanel").hidden=false;
    }
    if(!$("joinRequestsList").querySelector(".nx-member-row")){
      $("joinRequestsList").innerHTML='<p class="small">Нет новых заявок</p>';
    }
    notice(approve?"Участник принят":"Заявка отклонена");
  }catch(e){err(e);button.disabled=false}
};
$("leaveBtn").onclick=async()=>{try{ensure();await runTransaction(db,async tx=>{const gref=doc(db,"groups",active.id),mref=doc(db,"groups",active.id,"members",me.uid);const g=await tx.get(gref),m=await tx.get(mref);if(!g.exists()||!m.exists()||m.data().role!=="member")throw Error("Нельзя выйти");tx.update(gref,{memberCount:g.data().memberCount-1});tx.delete(mref)});member=false;memberRole="";active.memberCount--;unsubMessages?.();unsubMessages=null;refreshMembership()}catch(e){err(e)}};
$("backBtn").onclick=()=>selectKind(kind);
function watchMembers(){
  if(!active||!member)return;
  unsubMembers?.();
  const groupId=active.id;
  const target=$("membersList");
  target.innerHTML='<p class="small">Загрузка участников…</p>';
  unsubMembers=onSnapshot(collection(db,"groups",groupId,"members"),snapshot=>{
    if(!active||active.id!==groupId||!member)return;
    const items=snapshot.docs.map(d=>({uid:d.id,...d.data()})).sort((a,b)=>
      Number(b.role==="leader")-Number(a.role==="leader") ||
      String(a.uid).localeCompare(String(b.uid)));
    target.innerHTML=items.map(m=>'<div class="nx-member-row"><span class="nx-member-name">'+esc(m.uid===me?.uid?"Вы":m.uid.slice(0,12))+'</span><span class="small">'+(m.role==="leader"?"Создатель":"Участник")+'</span></div>').join("") ||
      '<p class="small">Участников пока нет.</p>';
  },err);
}
function groupMessageTime(value){
  const date=value?.toDate?.();
  return date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}) : "";
}
function watchMessages(){
  if(!active||!member)return;
  unsubMessages?.();
  const id=active.id;
  unsubMessages=onSnapshot(query(collection(db,"groups",id,"messages"),orderBy("createdAt","asc"),limit(100)),snap=>{
    if(active?.id!==id||!member)return;
    const box=$("chatMessages");
    const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<90;
    box.innerHTML=snap.empty?'<div class="empty">Сообщений пока нет</div>':snap.docs.map(d=>{
      const m=d.data();
      const own=m.senderId===me?.uid;
      const sender=own?"Вы":String(m.senderId||"").slice(0,8);
      return '<div class="bubble '+(own?"mine":"")+'"><div class="small" style="display:flex;justify-content:space-between;gap:10px"><span>'+esc(sender)+'</span><time>'+esc(groupMessageTime(m.createdAt))+'</time></div><div>'+esc(m.text)+'</div></div>';
    }).join("");
    if(nearBottom||snap.docChanges().some(c=>c.type==="added"&&c.doc.data().senderId===me?.uid)){
      box.scrollTop=box.scrollHeight;
    }
  },err);
}
let groupMessageSending=false;
$("chatText").addEventListener("input",()=>{
  $("chatCounter").textContent=$("chatText").value.length+" / 2000";
});
$("chatForm").onsubmit=async e=>{
  e.preventDefault();
  if(groupMessageSending)return;
  const button=$("sendGroupMessage");
  try{
    ensure();
    if(!active||!member||(active.kind==="clan"&&memberRole!=="leader"))return;
    const text=$("chatText").value.trim();
    if(!text||text.length>2000)return;
    groupMessageSending=true;
    button.disabled=true;
    button.textContent="Отправляем…";
    const ref=doc(collection(db,"groups",active.id,"messages"));
    await setDoc(ref,{senderId:me.uid,type:"text",text,createdAt:serverTimestamp()});
    if($("chatText").value.trim()===text)$("chatText").value="";
    $("chatCounter").textContent=$("chatText").value.length+" / 2000";
  }catch(e){err(e)}
  finally{groupMessageSending=false;button.disabled=false;button.textContent="Отправить"}
};
$("ownerTab").onclick=async()=>{try{ensure();if(me.uid!==OWNER)throw Error("Доступ запрещён");$("catalog").hidden=true;$("groupPanel").hidden=true;$("createPanel").hidden=true;$("ownerPanel").hidden=false;renderVerifyGroups();const snap=await getDocs(query(collection(db,"groupRequests"),where("status","==","pending"),limit(100)));$("requests").innerHTML=snap.empty?'<p>Новых заявок нет.</p>':snap.docs.map(d=>{const v=d.data();return '<article class="glass" style="margin:12px 0"><b>'+esc(v.name)+'</b> <span class="tag">['+esc(v.tag)+']</span><p>'+esc(v.description)+'</p><p class="small">'+esc(v.kind)+' · '+esc(v.category)+' · '+esc(v.ownerId)+'</p><p><b>Причина:</b> '+esc(v.reason||'Не указана')+'</p><div class="actions"><button data-approve="'+esc(d.id)+'" class="primary">Одобрить</button><button data-reject="'+esc(d.id)+'">Отклонить</button></div></article>'}).join("");document.querySelectorAll("[data-approve]").forEach(b=>b.onclick=()=>review(b.dataset.approve,true));document.querySelectorAll("[data-reject]").forEach(b=>b.onclick=()=>review(b.dataset.reject,false))}catch(e){err(e)}};
async function review(id,approved){try{ensure();if(me.uid!==OWNER)throw Error("Доступ запрещён");const ref=doc(db,"groupRequests",id),snap=await getDoc(ref);if(!snap.exists()||snap.data().status!=="pending")throw Error("Заявка уже обработана");const v=snap.data();
if(approved){
  if(v.kind==="clan"&&!/^[A-Za-z0-9_]{3}$/.test(v.tag||""))throw Error("Старая заявка: тег клана должен содержать ровно 3 символа. Отклони заявку с пояснением, чтобы пользователь подал новую.");
  if(v.kind==="community"&&v.tag!=="")throw Error("Старая заявка: у сообщества не должно быть тега. Отклони заявку с пояснением, чтобы пользователь подал новую.");
}
const batch=writeBatch(db);const reviewNote=prompt(approved?"Комментарий к одобрению (необязательно)":"Укажи причину отказа:","");if(reviewNote===null)return;if(!approved&&!reviewNote.trim())throw Error("Укажи причину отказа");if(reviewNote.length>500)throw Error("Комментарий слишком длинный");batch.update(ref,{status:approved?"approved":"rejected",reviewedBy:me.uid,reviewNote:reviewNote.trim(),reviewedAt:serverTimestamp()});if(approved){if(v.kind==="clan"){const tagDoc=await getDoc(doc(db,"groupTags",v.tag));if(tagDoc.exists())throw Error("Этот тег уже занят")}const group=doc(db,"groups",id);batch.set(group,{ownerId:v.ownerId,kind:v.kind,name:v.name,tag:v.tag,description:v.description,category:v.category,status:"active",verified:false,memberCount:1,createdAt:serverTimestamp()});if(v.kind==="clan")batch.set(doc(db,"groupTags",v.tag),{groupId:id,createdAt:serverTimestamp()});batch.set(doc(db,"groups",id,"members",v.ownerId),{uid:v.ownerId,role:"leader",joinedAt:serverTimestamp()})}await batch.commit();notice(approved?"Заявка одобрена":"Заявка отклонена");$("ownerTab").click()}catch(e){err(e)}}
onAuthStateChanged(auth,async user=>{me=user;$("identity").textContent=user?(user.emailVerified?"Аккаунт: "+(user.email||user.uid):"Подтверди почту"):"Вход не выполнен";$("ownerTab").hidden=!user||user.uid!==OWNER;if(!user||!user.emailVerified){unsubGroups?.();unsubMessages?.();$("cards").innerHTML='<div class="empty">Войди в аккаунт NEXORA и подтверди почту.</div>';return}unsubGroups?.();unsubGroups=onSnapshot(query(collection(db,"groups"),where("status","==","active"),limit(100)),snap=>{groups=snap.docs.map(d=>({id:d.id,...d.data()}));renderCards()},err)});

function renderVerifyGroups(){if(!me||me.uid!==OWNER)return;$("verifyGroups").innerHTML=groups.length?groups.map(g=>'<div class="actions" style="justify-content:space-between;padding:10px;border-bottom:1px solid #ffffff20"><span>'+(g.verified?'✓ ':'')+esc(g.name)+' <span class="small">('+esc(g.kind)+')</span></span><button data-verify="'+esc(g.id)+'">'+(g.verified?'Отозвать галочку':'Верифицировать')+'</button></div>').join(""):'<p class="small">Пока нет созданных объединений</p>';document.querySelectorAll("[data-verify]").forEach(b=>b.onclick=async()=>{try{ensure();if(me.uid!==OWNER)throw Error("Доступ запрещён");const g=groups.find(x=>x.id===b.dataset.verify);if(!g)return;await updateDoc(doc(db,"groups",g.id),{verified:!g.verified,verifiedAt:serverTimestamp()});notice(g.verified?"Верификация отозвана":"Объединение верифицировано");g.verified=!g.verified;renderVerifyGroups()}catch(e){err(e)}})}
selectKind("clan");
