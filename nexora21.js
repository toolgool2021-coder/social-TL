
import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getFirestore,doc,getDoc,getDocs,collection,query,
  limit,setDoc,updateDoc,addDoc,deleteDoc,serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

const cfg={
  apiKey:'AIzaSyD9prfvOQGMeniL3U8WD2HeeZ6NNArY8J8',
  authDomain:'toolchat-bfac8.firebaseapp.com',
  projectId:'toolchat-bfac8',
  storageBucket:'toolchat-bfac8.firebasestorage.app',
  messagingSenderId:'52396840735',
  appId:'1:52396840735:web:a608b9c037c8481f2dc22a'
};

const app=getApps()[0]||initializeApp(cfg);
const auth=getAuth(app);
const db=getFirestore(app);
const $=id=>document.getElementById(id);

const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;',
  '"':'&quot;',"'":'&#39;'
}[c]));

let me=null;
let presenceTimer=null;
let noticeTimer=null;

function notice(message){
  const el=$('nx21notice');
  if(!el)return;
  clearTimeout(noticeTimer);
  el.textContent=message;
  el.hidden=false;
  noticeTimer=setTimeout(()=>el.hidden=true,5000);
}

function mount(){
  const css=document.createElement('link');
  css.rel='stylesheet';
  css.href='nexora21.css';
  document.head.append(css);

  const nav=document.querySelector('.nav');

  if(nav){
    for(const [kind,label] of [
      ['saved','☆ Сохранённое'],
      ['notifications','♢ Уведомления'],
      ['verification','✓ Верификация']
    ]){
      const button=document.createElement('button');
      button.type='button';
      button.textContent=label;
      button.dataset.nxPanel=kind;
      button.onclick=()=>panel(kind);
      nav.append(button);
    }
  }

  const main=document.querySelector('.layout main');
  if(main){
    const section=document.createElement('section');
    section.id='nx21panel';
    section.className='hidden';
    main.append(section);
  }

  const notification=document.createElement('div');
  notification.id='nx21notice';
  notification.hidden=true;
  document.body.append(notification);

  document.addEventListener('click',handleClick);

  document.querySelectorAll('[data-page]').forEach(button=>{
    button.addEventListener('click',()=>{
      $('nx21panel')?.classList.add('hidden');
    });
  });
}

function panel(kind){
  if(!me){
    notice('Сначала войди в аккаунт');
    return;
  }

  const p=$('nx21panel');
  if(!p)return;

  for(const page of ['feed','search','profile','settings']){
    $(page+'Page')?.classList.add('hidden');
  }

  p.classList.remove('hidden');
  p.dataset.kind=kind;

  p.innerHTML=`
    <div class="glass panel">
      <button class="quiet" id="nx21back">← Назад</button>
      <h2 id="nx21title"></h2>
      <div id="nx21body">Загрузка...</div>
    </div>
  `;

  $('nx21back').onclick=()=>{
    p.classList.add('hidden');
    $('feedPage').classList.remove('hidden');
  };

  $('nx21title').textContent={
    saved:'Сохранённые публикации',
    notifications:'Уведомления',
    verification:'Заявка на верификацию'
  }[kind];

  if(kind==='saved')loadSaved();
  if(kind==='notifications')loadNotifications();
  if(kind==='verification')loadVerification();
}

async function loadSaved(){
  try{
    const snapshot=await getDocs(query(
      collection(db,'users',me.uid,'saved'),
      limit(100)
    ));

    const body=$('nx21body');
    if(!body)return;
    body.innerHTML='';

    for(const saved of snapshot.docs){
      const post=await getDoc(doc(db,'posts',saved.id));
      if(!post.exists())continue;

      const element=document.createElement('div');
      element.className='nx21item';

      element.innerHTML=`
        <p>${escape(post.data().text||'')}</p>
        <button class="quiet"
          data-nx-unsave="${escape(saved.id)}">
          Убрать из сохранённого
        </button>
      `;

      body.append(element);
    }

    if(!body.children.length){
      body.textContent='Пока нет сохранённых публикаций';
    }
  }catch(error){
    notice(error.message);
  }
}

async function loadNotifications(){
  try{
    const snapshot=await getDocs(query(
      collection(db,'users',me.uid,'notifications'),
      limit(50)
    ));

    const body=$('nx21body');
    if(!body)return;

    body.innerHTML=snapshot.docs
      .sort((a,b)=>
        (b.data().createdAt?.seconds||0)-
        (a.data().createdAt?.seconds||0)
      )
      .map(item=>`
        <div class="nx21item">
          ${escape(item.data().text||'Уведомление')}
        </div>
      `).join('')||'Пока нет уведомлений';
  }catch(error){
    notice(error.message);
  }
}

async function loadVerification(){
  try{
    const snapshot=await getDoc(
      doc(db,'verificationRequests',me.uid)
    );

    const body=$('nx21body');
    if(!body)return;

    const existing=snapshot.exists();

    body.innerHTML=`
      ${existing
        ? `<p>Статус заявки:
             <b>${escape(snapshot.data().status)}</b>
           </p>`
        : ''}
      <form id="nx21verify" class="stack">
        <label>
          Категория
          <select id="nx21type">
            <option value="1">Пользователь</option>
            <option value="2">Официальный бренд</option>
          </select>
        </label>

        <label>
          Обоснование
          <textarea id="nx21reason"
            required minlength="15" maxlength="500"
            placeholder="Расскажи, почему аккаунт должен получить верификацию"></textarea>
        </label>

        <button class="primary"
          ${existing?'disabled':''}>
          ${existing?'Заявка уже подана':'Подать заявку'}
        </button>
      </form>
    `;

    $('nx21verify').onsubmit=async event=>{
      event.preventDefault();
      if(existing)return;

      const reason=$('nx21reason').value.trim();
      if(reason.length<15){
        notice('Обоснование слишком короткое');
        return;
      }

      try{
        await setDoc(
          doc(db,'verificationRequests',me.uid),
          {
            uid:me.uid,
            type:Number($('nx21type').value),
            reason,
            status:'pending',
            createdAt:serverTimestamp()
          }
        );

        notice('Заявка отправлена');
        await loadVerification();
      }catch(error){
        notice(error.message);
      }
    };
  }catch(error){
    notice(error.message);
  }
}

async function handleClick(event){
  const save=event.target.closest('[data-nx-save]');
  const unsave=event.target.closest('[data-nx-unsave]');
  const report=event.target.closest('[data-nx-report]');
  const pin=event.target.closest('[data-nx-pin]');

  if(!me)return;

  try{
    if(save){
      await setDoc(
        doc(db,'users',me.uid,'saved',save.dataset.nxSave),
        {createdAt:serverTimestamp()}
      );
      notice('Публикация сохранена');
    }

    if(unsave){
      await deleteDoc(
        doc(db,'users',me.uid,'saved',unsave.dataset.nxUnsave)
      );
      await loadSaved();
    }

    if(report){
      const reason=prompt('Причина жалобы (10–500 символов)');
      if(!reason)return;

      if(reason.trim().length<10||reason.length>500){
        throw Error('Причина должна содержать от 10 до 500 символов');
      }

      await addDoc(collection(db,'reports'),{
        reporterId:me.uid,
        kind:'post',
        targetId:report.dataset.nxReport,
        reason:reason.trim(),
        status:'pending',
        createdAt:serverTimestamp()
      });

      notice('Жалоба отправлена');
    }

    if(pin){
      await updateDoc(doc(db,'users',me.uid),{
        pinnedPostId:pin.dataset.nxPin
      });
      notice('Публикация закреплена');
    }
  }catch(error){
    notice(error.message);
  }
}

function decoratePosts(){
  document.querySelectorAll('[data-post]').forEach(element=>{
    if(element.querySelector('.nx21actions'))return;

    const id=element.dataset.post;
    const bar=document.createElement('div');
    bar.className='nx21actions';

    bar.innerHTML=`
      <button data-nx-save="${escape(id)}">☆ Сохранить</button>
      <button data-nx-report="${escape(id)}">⚑ Жалоба</button>
    `;

    const mine=!!element.querySelector(
      '[data-action="delete-post"]'
    );

    if(mine){
      bar.innerHTML+=`
        <button data-nx-pin="${escape(id)}">
          📌 Закрепить
        </button>
      `;
    }

    element.append(bar);
  });
}

function decorateProfiles(){
  const controls=$('profileControls');

  if(!controls||!me||controls.querySelector('.nx21status')){
    return;
  }

  const span=document.createElement('span');
  span.className='nx21status';
  span.textContent='● Статус уточняется';
  controls.append(span);
}

async function heartbeat(){
  if(!me)return;

  try{
    await setDoc(doc(db,'presence',me.uid),{
      uid:me.uid,
      lastSeen:serverTimestamp()
    },{merge:true});
  }catch(error){
    console.warn('Presence:',error.message);
  }
}

onAuthStateChanged(auth,async user=>{
  me=user;
  clearInterval(presenceTimer);

  if(!user){
    $('nx21panel')?.classList.add('hidden');
    return;
  }

  await heartbeat();
  presenceTimer=setInterval(heartbeat,60000);
});

mount();

new MutationObserver(()=>{
  decoratePosts();
  decorateProfiles();
}).observe(document.body,{
  childList:true,
  subtree:true
});
