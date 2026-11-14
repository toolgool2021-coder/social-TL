
import {
  initializeApp,getApps
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getFirestore,collection,doc,getDoc,
  addDoc,serverTimestamp
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

let me=null;
let busy=false;
let noticeTimer=null;

onAuthStateChanged(auth,user=>{
  me=user;
});

const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",
  '"':"&quot;","'":"&#39;"
})[c]);

function notice(message){
  const box=document.getElementById("toast");
  if(!box)return;
  clearTimeout(noticeTimer);
  box.textContent=String(message);
  box.classList.remove("hidden");
  noticeTimer=setTimeout(()=>box.classList.add("hidden"),3500);
}

function extractTags(text){
  return [...new Set(
    (String(text||"").match(/#[\p{L}\p{N}_]{2,40}/gu)||[])
      .map(tag=>tag.toLowerCase())
  )].slice(0,20);
}

function validId(value){
  return typeof value==="string" &&
    /^[A-Za-z0-9]{10,40}$/.test(value);
}

function decorate(){
  document.querySelectorAll("article[data-post]").forEach(article=>{
    if(article.querySelector(".nx22-actions"))return;
    const id=article.dataset.post;
    const actions=article.querySelector(".actions");
    if(!actions||!validId(id))return;

    const wrap=document.createElement("span");
    wrap.className="nx22-actions";
    wrap.innerHTML=`
      <button type="button"
        data-nx22="repost"
        data-id="${esc(id)}">↻ Репост</button>
      <button type="button"
        data-nx22="quote"
        data-id="${esc(id)}">❝ Цитировать</button>`;
    actions.append(wrap);

    const text=article.querySelector(".posttext");
    if(!text||text.dataset.nx22Tags)return;
    text.dataset.nx22Tags="1";

    const tags=extractTags(text.textContent);
    if(!tags.length)return;

    const bar=document.createElement("div");
    bar.className="nx22-tags";

    for(const tag of tags){
      const link=document.createElement("a");
      link.href="./explore.html?tag="+encodeURIComponent(tag);
      link.textContent=tag;
      bar.append(link);
    }
    text.after(bar);
  });
}

async function createRepost(id,comment=""){
  if(!me)throw Error("Сначала войди в аккаунт.");
  if(!validId(id))throw Error("Некорректный ID публикации.");

  const snap=await getDoc(doc(db,"posts",id));
  if(!snap.exists())throw Error("Исходная публикация удалена.");

  const original=snap.data();
  if(!validId(original.uid))throw Error("Некорректный автор.");

  const clean=String(comment||"").trim();
  if(clean.length>350)throw Error("Комментарий слишком длинный.");

  const prefix=clean
    ?"❝ Цитата\n"+clean+"\n\n"
    :"↻ Репост\n";

  const credit="\n\nИсточник: NEXORA · "+
    original.uid.slice(0,8)+" · "+id;

  const remaining=1000-prefix.length-credit.length;
  if(remaining<20)throw Error("Цитата слишком длинная.");

  const text=prefix+
    String(original.text||"").slice(0,remaining)+credit;

  const data={
    uid:me.uid,
    text,
    createdAt:serverTimestamp()
  };

  // Копируем только HTTPS-изображения с допустимым расширением.
  if(typeof original.imageUrl==="string"){
    try{
      const url=new URL(original.imageUrl);
      if(url.protocol==="https:" &&
         !url.username&&!url.password &&
         /\.(png|jpe?g|webp)$/i.test(url.pathname)){
        data.imageUrl=url.href;
      }
    }catch{}
  }

  await addDoc(collection(db,"posts"),data);
}

function quoteDialog(id){
  if(!me)return notice("Сначала войди в аккаунт.");

  document.querySelector(".nx22-overlay")?.remove();

  const overlay=document.createElement("div");
  overlay.className="nx22-overlay";
  overlay.innerHTML=`
    <form class="nx22-dialog">
      <h2>Цитировать публикацию</h2>
      <p>Добавь комментарий к исходной публикации.</p>
      <textarea maxlength="350" required
        placeholder="Твой комментарий"></textarea>
      <div class="nx22-dialog-actions">
        <button type="button" data-close>Отмена</button>
        <button type="submit">Опубликовать</button>
      </div>
    </form>`;

  document.body.append(overlay);

  const close=()=>overlay.remove();
  overlay.querySelector("[data-close]").onclick=close;
  overlay.addEventListener("click",e=>{
    if(e.target===overlay)close();
  });

  const form=overlay.querySelector("form");
  form.onsubmit=async e=>{
    e.preventDefault();
    if(busy)return;

    const comment=form.querySelector("textarea").value.trim();
    if(!comment)return;

    busy=true;
    const button=form.querySelector('[type="submit"]');
    button.disabled=true;

    try{
      await createRepost(id,comment);
      close();
      notice("Цитата опубликована.");
    }catch(error){
      notice(error.message||"Ошибка публикации.");
    }finally{
      busy=false;
      button.disabled=false;
    }
  };

  overlay.querySelector("textarea").focus();
}

document.addEventListener("click",async event=>{
  const button=event.target.closest("[data-nx22]");
  if(!button)return;

  event.preventDefault();
  event.stopPropagation();

  const id=button.dataset.id;
  if(!validId(id))return notice("Некорректный ID.");

  if(button.dataset.nx22==="quote"){
    if(!busy)quoteDialog(id);
    return;
  }

  if(busy)return;
  if(!confirm("Опубликовать репост у себя в профиле?"))return;

  busy=true;
  button.disabled=true;

  try{
    await createRepost(id);
    notice("Репост опубликован.");
  }catch(error){
    notice(error.message||"Ошибка репоста.");
  }finally{
    busy=false;
    button.disabled=false;
  }
});

let scheduled=false;
const observer=new MutationObserver(()=>{
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(()=>{
    scheduled=false;
    decorate();
  });
});

for(const id of ["feedList","profilePosts"]){
  const element=document.getElementById(id);
  if(element)observer.observe(element,{
    childList:true,subtree:true
  });
}

decorate();
