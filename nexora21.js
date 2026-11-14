
import {getApps,initializeApp} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {getAuth,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore,doc,getDoc,getDocs,collection,
  query,limit,setDoc,updateDoc,addDoc,deleteDoc,
  serverTimestamp,onSnapshot
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const config={
  apiKey:"AIzaSyD9prfvOQGMeniL3U8WD2HeeZ6NNArY8J8",
  authDomain:"toolchat-bfac8.firebaseapp.com",
  projectId:"toolchat-bfac8",
  storageBucket:"toolchat-bfac8.firebasestorage.app",
  messagingSenderId:"52396840735",
  appId:"1:52396840735:web:a608b9c037c8481f2dc22a"
};

const app=getApps()[0]||initializeApp(config);
const auth=getAuth(app);
const db=getFirestore(app);
const $=id=>document.getElementById(id);

let me=null;
let panel="";
let panelVersion=0;
let presenceTimer=null;
let unsubscribeNotifications=null;
let unsubscribePresence=null;
let profileUid=null;
let profileVersion=0;
let noticeTimer=null;
let pending=new Set();

const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",
  '"':"&quot;","'":"&#39;"
})[c]);

const date=t=>t?.toDate?.().toLocaleString("ru-RU",{
  day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"
})||"";

function notice(message){
  const el=$("nx21notice");
  if(!el)return;
  clearTimeout(noticeTimer);
  el.textContent=String(message);
  el.hidden=false;
  noticeTimer=setTimeout(()=>el.hidden=true,4200);
}

function errorMessage(e){
  return e?.code==="permission-denied"
    ?"Доступ запрещён правилами Firestore."
    :e?.message||"Неизвестная ошибка";
}

async function once(key,fn){
  if(pending.has(key))return;
  pending.add(key);
  try{return await fn();}
  finally{pending.delete(key);}
}

function hideExtraPanel(){
  panel="";
  panelVersion++;
  $("nx21panel")?.classList.add("hidden");
}

function showPanel(name){
  if(!me)return notice("Сначала войди в аккаунт.");
  if(!["saved","notifications","verification"].includes(name))return;

  panel=name;
  panelVersion++;
  const version=panelVersion;

  for(const page of ["feed","search","profile","settings"]){
    $(page+"Page")?.classList.add("hidden");
  }

  $("nx21panel").classList.remove("hidden");
  $("nx21title").textContent={
    saved:"Сохранённые публикации",
    notifications:"Уведомления",
    verification:"Верификация"
  }[name];

  $("nx21body").textContent="Загрузка...";

  if(name==="saved")loadSaved(version);
  if(name==="notifications")loadNotifications(version);
  if(name==="verification")loadVerification(version);
}

document.querySelectorAll("[data-nx-panel]").forEach(button=>{
  button.addEventListener("click",()=>showPanel(button.dataset.nxPanel));
});

document.querySelectorAll("[data-page]").forEach(button=>{
  button.addEventListener("click",hideExtraPanel);
});

$("nx21back").onclick=()=>{
  hideExtraPanel();
  document.querySelector('[data-page="feed"]')?.click();
};

async function loadSaved(version=panelVersion){
  const body=$("nx21body");
  try{
    const snap=await getDocs(query(
      collection(db,"users",me.uid,"saved"),limit(100)
    ));

    const items=await Promise.all(snap.docs.map(async item=>{
      const post=await getDoc(doc(db,"posts",item.id));
      if(!post.exists())return "";
      const data=post.data();
      return `<article class="nx21item">
        <p style="white-space:pre-wrap">${esc(data.text||"")}</p>
        <small class="muted">${esc(date(data.createdAt))}</small>
        <div class="nx21actions">
          <button type="button" data-nx-unsave="${esc(item.id)}">
            ☆ Удалить из сохранённого
          </button>
        </div>
      </article>`;
    }));

    if(panel!=="saved"||version!==panelVersion)return;
    body.innerHTML=items.filter(Boolean).join("")||
      '<p class="muted">Сохранённых публикаций пока нет.</p>';
  }catch(e){
    if(panel==="saved"&&version===panelVersion)
      body.textContent=errorMessage(e);
  }
}

async function loadNotifications(version=panelVersion){
  const body=$("nx21body");
  try{
    const snap=await getDocs(query(
      collection(db,"users",me.uid,"notifications"),limit(100)
    ));
    const items=snap.docs.sort((a,b)=>
      (b.data().createdAt?.seconds||0)-
      (a.data().createdAt?.seconds||0)
    );

    if(panel!=="notifications"||version!==panelVersion)return;

    body.innerHTML=items.map(item=>{
      const n=item.data();
      return `<article class="nx21item">
        <p>${esc(n.text||"Уведомление")}</p>
        <small class="muted">${esc(date(n.createdAt))}</small>
        ${n.read===true?"":`
          <div class="nx21actions">
            <button type="button" data-nx-read="${esc(item.id)}">
              Отметить прочитанным
            </button>
          </div>`}
      </article>`;
    }).join("")||'<p class="muted">Уведомлений пока нет.</p>';
  }catch(e){
    if(panel==="notifications"&&version===panelVersion)
      body.textContent=errorMessage(e);
  }
}

async function loadVerification(version=panelVersion){
  const body=$("nx21body");
  try{
    const snap=await getDoc(doc(db,"verificationRequests",me.uid));
    if(panel!=="verification"||version!==panelVersion)return;

    if(snap.exists()){
      const r=snap.data();
      const status={
        pending:"На рассмотрении",
        approved:"Одобрена",
        rejected:"Отклонена"
      }[r.status]||"Неизвестен";

      body.innerHTML=`<article class="nx21item">
        <h3>Заявка на верификацию</h3>
        <p>Статус: <strong>${esc(status)}</strong></p>
        <p style="white-space:pre-wrap">${esc(r.reason||"")}</p>
        <small class="muted">${esc(date(r.createdAt))}</small>
      </article>`;
      return;
    }

    body.innerHTML=`
      <p class="muted">
        Значок верификации выдаётся после проверки администрацией.
        Отправка заявки не гарантирует одобрение.
      </p>
      <form id="nx21verifyForm" class="stack">
        <label for="nx21verifyType">Категория</label>
        <select id="nx21verifyType" required>
          <option value="1">Подтверждённый пользователь</option>
          <option value="2">Официальный бренд</option>
          <option value="3">Создатель</option>
          <option value="4">Участник команды</option>
          <option value="5">Спонсор</option>
        </select>
        <label for="nx21verifyReason">Обоснование</label>
        <textarea id="nx21verifyReason"
          minlength="15" maxlength="500" required
          placeholder="Опиши, почему тебе подходит эта категория"></textarea>
        <button class="primary" type="submit">Подать заявку</button>
      </form>`;

    $("nx21verifyForm").onsubmit=async event=>{
      event.preventDefault();
      const reason=$("nx21verifyReason").value.trim();
      const type=Number($("nx21verifyType").value);
      if(reason.length<15||reason.length>500||type<1||type>5){
        return notice("Проверь категорию и обоснование.");
      }
      const button=event.submitter;
      button.disabled=true;
      try{
        // Создаём только новую заявку. Старую одобренную
        // или отклонённую нельзя перезаписать этой формой.
        const ref=doc(db,"verificationRequests",me.uid);
        const existing=await getDoc(ref);
        if(existing.exists())throw Error("Заявка уже существует.");

        await setDoc(ref,{
          uid:me.uid,
          type,
          reason,
          status:"pending",
          createdAt:serverTimestamp()
        });
        notice("Заявка отправлена.");
        await loadVerification(version);
      }catch(e){
        notice(errorMessage(e));
      }finally{
        button.disabled=false;
      }
    };
  }catch(e){
    if(panel==="verification"&&version===panelVersion)
      body.textContent=errorMessage(e);
  }
}

async function savePost(id){
  const post=await getDoc(doc(db,"posts",id));
  if(!post.exists())throw Error("Публикация удалена.");
  await setDoc(doc(db,"users",me.uid,"saved",id),{
    postId:id,createdAt:serverTimestamp()
  });
  notice("Публикация сохранена.");
}

async function unsavePost(id){
  await deleteDoc(doc(db,"users",me.uid,"saved",id));
  notice("Удалено из сохранённого.");
  if(panel==="saved")await loadSaved();
}

async function reportPost(id){
  const reason=prompt("Укажи причину жалобы:");
  if(reason===null)return;
  const text=reason.trim();
  if(text.length<10||text.length>500)
    throw Error("Причина должна содержать 10–500 символов.");

  await addDoc(collection(db,"reports"),{
    reporterId:me.uid,
    kind:"post",
    targetId:id,
    reason:text,
    status:"pending",
    createdAt:serverTimestamp()
  });
  notice("Жалоба отправлена.");
}

async function pinPost(id){
  const snap=await getDoc(doc(db,"posts",id));
  if(!snap.exists()||snap.data().uid!==me.uid)
    throw Error("Можно закреплять только свои публикации.");

  await updateDoc(doc(db,"users",me.uid),{pinnedPostId:id});
  notice("Публикация закреплена.");
  refreshPinned();
}

async function unpinPost(){
  await updateDoc(doc(db,"users",me.uid),{pinnedPostId:null});
  notice("Закрепление снято.");
  refreshPinned();
}

async function markRead(id){
  await updateDoc(doc(db,"users",me.uid,"notifications",id),{
    read:true
  });
  if(panel==="notifications")await loadNotifications();
}

document.addEventListener("click",async event=>{
  if(!me)return;
  const button=event.target.closest(
    "[data-nx-save],[data-nx-unsave],[data-nx-report],"+
    "[data-nx-pin],[data-nx-unpin],[data-nx-read]"
  );
  if(!button||button.disabled)return;

  const key=button.outerHTML;
  button.disabled=true;
  try{
    await once(key,async()=>{
      if(button.hasAttribute("data-nx-save"))
        await savePost(button.dataset.nxSave);
      else if(button.hasAttribute("data-nx-unsave"))
        await unsavePost(button.dataset.nxUnsave);
      else if(button.hasAttribute("data-nx-report"))
        await reportPost(button.dataset.nxReport);
      else if(button.hasAttribute("data-nx-pin"))
        await pinPost(button.dataset.nxPin);
      else if(button.hasAttribute("data-nx-unpin"))
        await unpinPost();
      else if(button.hasAttribute("data-nx-read"))
        await markRead(button.dataset.nxRead);
    });
  }catch(e){
    notice(errorMessage(e));
  }finally{
    button.disabled=false;
  }
});

function decoratePosts(){
  document.querySelectorAll("article[data-post]").forEach(article=>{
    if(article.querySelector(".nx21actions"))return;
    const id=article.dataset.post;
    if(!id)return;

    const row=document.createElement("div");
    row.className="nx21actions";

    const add=(text,attribute)=>{
      const button=document.createElement("button");
      button.type="button";
      button.textContent=text;
      button.setAttribute(attribute,id);
      row.append(button);
    };

    add("☆ Сохранить","data-nx-save");
    add("⚑ Жалоба","data-nx-report");

    if(article.querySelector('[data-action="delete-post"]'))
      add("📌 Закрепить","data-nx-pin");

    article.append(row);
  });
}

async function refreshPinned(){
  const uid=profileUid;
  if(!uid||$("profilePage")?.classList.contains("hidden"))return;
  const token=++profileVersion;
  const box=$("profilePosts");

  try{
    const user=await getDoc(doc(db,"users",uid));
    if(token!==profileVersion||profileUid!==uid)return;

    box.querySelectorAll(".nx21pinlabel").forEach(el=>el.remove());
    box.querySelectorAll(".nx21pinned").forEach(el=>
      el.classList.remove("nx21pinned")
    );
    $("nx21unpin")?.remove();

    const id=user.data()?.pinnedPostId;
    if(!id)return;

    let article=[...box.querySelectorAll("article[data-post]")]
      .find(el=>el.dataset.post===id);

    if(!article){
      const post=await getDoc(doc(db,"posts",id));
      if(!post.exists()||post.data().uid!==uid)return;

      article=document.createElement("article");
      article.className="glass panel";
      article.dataset.post=id;
      const content=document.createElement("div");
      content.className="posttext";
      content.textContent=post.data().text||"";
      article.append(content);
    }

    if(token!==profileVersion||profileUid!==uid)return;
    box.prepend(article);
    article.classList.add("nx21pinned");

    const label=document.createElement("div");
    label.className="nx21pinlabel muted";
    label.textContent="📌 Закреплённая публикация";
    article.prepend(label);

    if(uid===me?.uid){
      const button=document.createElement("button");
      button.id="nx21unpin";
      button.className="quiet";
      button.dataset.nxUnpin="";
      button.textContent="Снять закрепление";
      $("profileControls")?.append(button);
    }
    decoratePosts();
  }catch(e){
    console.warn("Pinned post:",e);
  }
}

function watchPresence(uid){
  unsubscribePresence?.();
  unsubscribePresence=null;

  const controls=$("profileControls");
  if(!controls)return;

  controls.querySelector(".nx21status")?.remove();
  const status=document.createElement("span");
  status.className="nx21status";
  status.textContent="Статус неизвестен";
  controls.append(status);

  unsubscribePresence=onSnapshot(
    doc(db,"presence",uid),
    snap=>{
      if(profileUid!==uid||!status.isConnected)return;
      const seen=snap.data()?.lastSeen?.toMillis?.()||0;
      const active=seen>0&&Date.now()-seen<120000;
      status.textContent=active
        ?"● Недавно был активен"
        :"○ Не в сети";
      status.classList.toggle("nx21online",active);
    },
    ()=>status.textContent="Статус недоступен"
  );
}

function detectProfile(){
  if(!me||$("profilePage")?.classList.contains("hidden"))return;
  const name=$("profileName")?.textContent?.trim();
  if(!name||name==="Загрузка...")return;

  const link=$("profileControls")?.querySelector(
    'a[href*="chats.html?user="]'
  );

  let uid=me.uid;
  if(link){
    try{
      uid=new URL(link.href,location.href).searchParams.get("user")||uid;
    }catch{}
  }

  if(uid===profileUid)return;
  profileUid=uid;
  watchPresence(uid);
  refreshPinned();
}

async function heartbeat(){
  if(!me||document.visibilityState!=="visible")return;
  try{
    await setDoc(doc(db,"presence",me.uid),{
      uid:me.uid,lastSeen:serverTimestamp()
    },{merge:true});
  }catch(e){
    console.warn("Presence:",e);
  }
}

onAuthStateChanged(auth,user=>{
  me=user;
  clearInterval(presenceTimer);
  unsubscribeNotifications?.();
  unsubscribePresence?.();
  unsubscribeNotifications=null;
  unsubscribePresence=null;
  profileUid=null;
  profileVersion++;

  if(!user){
    hideExtraPanel();
    return;
  }

  heartbeat();
  presenceTimer=setInterval(heartbeat,60000);

  unsubscribeNotifications=onSnapshot(
    collection(db,"users",user.uid,"notifications"),
    snap=>{
      const count=snap.docs.filter(d=>d.data().read!==true).length;
      const button=document.querySelector(
        '[data-nx-panel="notifications"]'
      );
      if(button)button.title=count
        ?`${count} непрочитанных уведомлений`
        :"Уведомления";
    },
    e=>console.warn("Notifications:",e)
  );
});

document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible")heartbeat();
});

let scheduled=false;
const observer=new MutationObserver(()=>{
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(()=>{
    scheduled=false;
    decoratePosts();
    detectProfile();
  });
});

for(const id of ["feedList","profilePosts","profileControls","profileName"]){
  const el=$(id);
  if(el)observer.observe(el,{childList:true,subtree:true});
}
decoratePosts();
