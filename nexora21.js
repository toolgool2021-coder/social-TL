
import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getFirestore,doc,getDoc,getDocs,collection,
  query,limit,setDoc,updateDoc,addDoc,
  deleteDoc,serverTimestamp,onSnapshot
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

const firebaseConfig={
  apiKey:'AIzaSyD9prfvOQGMeniL3U8WD2HeeZ6NNArY8J8',
  authDomain:'toolchat-bfac8.firebaseapp.com',
  projectId:'toolchat-bfac8',
  storageBucket:'toolchat-bfac8.firebasestorage.app',
  messagingSenderId:'52396840735',
  appId:'1:52396840735:web:a608b9c037c8481f2dc22a'
};

const app=getApps()[0]||initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);
const $=id=>document.getElementById(id);

let me=null;
let activePanel=null;
let noticeTimer=null;
let presenceTimer=null;
let stopNotifications=null;
let stopPresence=null;
let decoratedProfile=null;

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  '"':'&quot;',
  "'":'&#39;'
}[c]));

function notify(message){
  const element=$('nx21notice');
  if(!element)return;
  clearTimeout(noticeTimer);
  element.textContent=message;
  element.hidden=false;
  noticeTimer=setTimeout(()=>{
    element.hidden=true;
  },4000);
}

function errorMessage(error){
  if(error?.code==='permission-denied'){
    return 'Firebase отклонил запрос. Проверь правила Firestore.';
  }
  return error?.message||'Неизвестная ошибка';
}

function dateLabel(timestamp){
  if(!timestamp?.toDate)return '';
  return timestamp.toDate().toLocaleString('ru-RU',{
    day:'numeric',
    month:'short',
    hour:'2-digit',
    minute:'2-digit'
  });
}

function openPanel(kind){
  if(!me){
    notify('Сначала войди в аккаунт');
    return;
  }

  activePanel=kind;

  for(const page of ['feed','search','profile','settings']){
    $(page+'Page')?.classList.add('hidden');
  }

  const panel=$('nx21panel');
  panel.classList.remove('hidden');

  $('nx21title').textContent={
    saved:'Сохранённые публикации',
    notifications:'Уведомления',
    verification:'Верификация'
  }[kind]||'NEXORA';

  $('nx21body').textContent='Загрузка...';

  if(kind==='saved')loadSaved();
  if(kind==='notifications')loadNotifications();
  if(kind==='verification')loadVerification();
}

function closePanel(){
  activePanel=null;
  $('nx21panel')?.classList.add('hidden');
  $('feedPage')?.classList.remove('hidden');
}

document.querySelectorAll('[data-nx-panel]').forEach(button=>{
  button.addEventListener('click',()=>{
    openPanel(button.dataset.nxPanel);
  });
});

$('nx21back').onclick=closePanel;

document.querySelectorAll('[data-page]').forEach(button=>{
  button.addEventListener('click',()=>{
    activePanel=null;
    $('nx21panel')?.classList.add('hidden');
  });
});

async function loadSaved(){
  const body=$('nx21body');
  if(!body)return;

  try{
    const snapshot=await getDocs(query(
      collection(db,'users',me.uid,'saved'),
      limit(100)
    ));

    const elements=await Promise.all(
      snapshot.docs.map(async item=>{
        try{
          const post=await getDoc(doc(db,'posts',item.id));
          if(!post.exists())return null;

          const data=post.data();

          return `
            <article class="nx21item">
              <p>${esc(data.text||'')}</p>
              <small class="muted">
                ${esc(dateLabel(data.createdAt))}
              </small>
              <div class="nx21actions">
                <button type="button"
                  data-nx-unsave="${esc(item.id)}">
                  Убрать из сохранённого
                </button>
              </div>
            </article>
          `;
        }catch{
          return null;
        }
      })
    );

    if(activePanel!=='saved')return;

    body.innerHTML=elements.filter(Boolean).join('')||
      '<p class="muted">Сохранённых публикаций пока нет.</p>';
  }catch(error){
    body.textContent=errorMessage(error);
  }
}

async function loadNotifications(){
  const body=$('nx21body');
  if(!body)return;

  try{
    const snapshot=await getDocs(query(
      collection(db,'users',me.uid,'notifications'),
      limit(50)
    ));

    if(activePanel!=='notifications')return;

    const records=snapshot.docs.sort((a,b)=>
      (b.data().createdAt?.seconds||0)-
      (a.data().createdAt?.seconds||0)
    );

    body.innerHTML=records.map(item=>{
      const data=item.data();

      return `
        <div class="nx21item">
          <p>${esc(data.text||'Уведомление')}</p>
          <small class="muted">
            ${esc(dateLabel(data.createdAt))}
          </small>
        </div>
      `;
    }).join('')||
      '<p class="muted">Уведомлений пока нет.</p>';
  }catch(error){
    body.textContent=errorMessage(error);
  }
}

async function loadVerification(){
  const body=$('nx21body');
  if(!body)return;

  try{
    const snapshot=await getDoc(
      doc(db,'verificationRequests',me.uid)
    );

    if(activePanel!=='verification')return;

    if(snapshot.exists()){
      const request=snapshot.data();
      const status={
        pending:'На рассмотрении',
        approved:'Одобрена',
        rejected:'Отклонена'
      }[request.status]||request.status;

      body.innerHTML=`
        <div class="nx21item">
          <h3>Твоя заявка</h3>
          <p>Статус: <b>${esc(status)}</b></p>
          <p class="muted">
            ${esc(request.reason||'')}
          </p>
          <small class="muted">
            ${esc(dateLabel(request.createdAt))}
          </small>
        </div>
      `;
      return;
    }

    body.innerHTML=`
      <p class="muted">
        Верификация подтверждает статус аккаунта.
        Подача заявки не гарантирует получение значка.
      </p>
      <form id="nx21verifyForm" class="stack">
        <label>
          Тип верификации
          <select id="nx21verifyType">
            <option value="1">
              Подтверждённый пользователь
            </option>
            <option value="2">
              Официальный бренд
            </option>
          </select>
        </label>

        <label>
          Обоснование заявки
          <textarea id="nx21verifyReason"
            required minlength="15" maxlength="500"
            placeholder="Почему твой аккаунт должен получить верификацию?"></textarea>
        </label>

        <button class="primary" type="submit">
          Отправить заявку
        </button>
      </form>
    `;

    $('nx21verifyForm').onsubmit=async event=>{
      event.preventDefault();

      const button=event.submitter;
      const reason=$('nx21verifyReason').value.trim();
      const type=Number($('nx21verifyType').value);

      if(reason.length<15){
        notify('Напиши более подробное обоснование');
        return;
      }

      button.disabled=true;

      try{
        await setDoc(
          doc(db,'verificationRequests',me.uid),
          {
            uid:me.uid,
            type,
            reason,
            status:'pending',
            createdAt:serverTimestamp()
          }
        );

        notify('Заявка отправлена');
        await loadVerification();
      }catch(error){
        notify(errorMessage(error));
      }finally{
        button.disabled=false;
      }
    };
  }catch(error){
    body.textContent=errorMessage(error);
  }
}

async function savePost(postId){
  await setDoc(
    doc(db,'users',me.uid,'saved',postId),
    {
      postId,
      createdAt:serverTimestamp()
    }
  );

  notify('Публикация сохранена');
}

async function removeSaved(postId){
  await deleteDoc(
    doc(db,'users',me.uid,'saved',postId)
  );

  notify('Удалено из сохранённого');
  await loadSaved();
}

async function reportPost(postId){
  const reason=prompt(
    'Почему ты жалуешься на эту публикацию?'
  );

  if(reason===null)return;

  const clean=reason.trim();

  if(clean.length<10||clean.length>500){
    notify('Причина должна содержать 10–500 символов');
    return;
  }

  await addDoc(collection(db,'reports'),{
    reporterId:me.uid,
    targetId:postId,
    kind:'post',
    reason:clean,
    status:'pending',
    createdAt:serverTimestamp()
  });

  notify('Жалоба отправлена');
}

async function pinPost(postId){
  await updateDoc(doc(db,'users',me.uid),{
    pinnedPostId:postId
  });

  notify('Публикация закреплена в профиле');
}

document.addEventListener('click',async event=>{
  if(!me)return;

  const button=event.target.closest(
    '[data-nx-save],[data-nx-unsave],'+
    '[data-nx-report],[data-nx-pin]'
  );

  if(!button)return;

  button.disabled=true;

  try{
    if(button.dataset.nxSave){
      await savePost(button.dataset.nxSave);
    }else if(button.dataset.nxUnsave){
      await removeSaved(button.dataset.nxUnsave);
    }else if(button.dataset.nxReport){
      await reportPost(button.dataset.nxReport);
    }else if(button.dataset.nxPin){
      await pinPost(button.dataset.nxPin);
    }
  }catch(error){
    notify(errorMessage(error));
  }finally{
    button.disabled=false;
  }
});

function decoratePosts(){
  document.querySelectorAll('[data-post]').forEach(post=>{
    if(post.querySelector('.nx21actions'))return;

    const postId=post.dataset.post;
    if(!postId)return;

    const actions=document.createElement('div');
    actions.className='nx21actions';

    const save=document.createElement('button');
    save.type='button';
    save.textContent='☆ Сохранить';
    save.dataset.nxSave=postId;

    const report=document.createElement('button');
    report.type='button';
    report.textContent='⚑ Жалоба';
    report.dataset.nxReport=postId;

    actions.append(save,report);

    const own=post.querySelector(
      '[data-action="delete-post"]'
    );

    if(own){
      const pin=document.createElement('button');
      pin.type='button';
      pin.textContent='📌 Закрепить';
      pin.dataset.nxPin=postId;
      actions.append(pin);
    }

    post.append(actions);
  });
}

async function showPresence(uid,element){
  stopPresence?.();
  stopPresence=null;

  if(!uid||!element)return;

  stopPresence=onSnapshot(
    doc(db,'presence',uid),
    snapshot=>{
      if(!element.isConnected)return;

      if(!snapshot.exists()){
        element.textContent='Статус неизвестен';
        return;
      }

      const seen=snapshot.data().lastSeen?.toMillis?.();

      if(!seen){
        element.textContent='Статус неизвестен';
        return;
      }

      const age=Date.now()-seen;
      const online=age>=0&&age<120000;

      element.textContent=online
        ?'● Недавно был активен'
        :'○ Не в сети';
      element.classList.toggle('nx21online',online);
    },
    ()=>{
      element.textContent='Статус скрыт';
    }
  );
}

function decorateProfile(){
  const name=$('profileName');
  const controls=$('profileControls');

  if(!name||!controls||!me)return;
  if(name.textContent==='Загрузка...')return;

  const uid=window.__nxProfileUid||null;

  if(controls.querySelector('.nx21status'))return;

  const status=document.createElement('span');
  status.className='nx21status';
  status.textContent='Статус неизвестен';

  controls.append(status);

  if(uid){
    showPresence(uid,status);
  }
}

async function heartbeat(){
  if(!me)return;

  try{
    await setDoc(doc(db,'presence',me.uid),{
      uid:me.uid,
      lastSeen:serverTimestamp()
    },{merge:true});
  }catch(error){
    console.warn('Nexora presence:',error.message);
  }
}

onAuthStateChanged(auth,async user=>{
  me=user;

  clearInterval(presenceTimer);
  stopNotifications?.();
  stopNotifications=null;

  if(!user){
    activePanel=null;
    $('nx21panel')?.classList.add('hidden');
    return;
  }

  await heartbeat();

  if(auth.currentUser?.uid!==user.uid)return;

  presenceTimer=setInterval(heartbeat,60000);

  stopNotifications=onSnapshot(
    collection(db,'users',user.uid,'notifications'),
    snapshot=>{
      const count=snapshot.docs.filter(
        d=>d.data().read!==true
      ).length;

      const button=document.querySelector(
        '[data-nx-panel="notifications"]'
      );

      if(button){
        button.title=count
          ?`${count} непрочитанных уведомлений`
          :'Уведомления';
      }
    },
    error=>{
      console.warn('Notifications:',error.message);
    }
  );
});

const observer=new MutationObserver(records=>{
  const relevant=records.some(record=>
    [...record.addedNodes].some(node=>
      node.nodeType===1 &&
      !node.classList?.contains('nx21actions')
    )
  );

  if(!relevant)return;

  decoratePosts();
});

observer.observe(document.body,{
  childList:true,
  subtree:true
});

decoratePosts();
