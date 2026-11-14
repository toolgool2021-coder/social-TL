
import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getFirestore,doc,getDoc,getDocs,collection,
  query,limit,setDoc,updateDoc,addDoc,
  deleteDoc,serverTimestamp,onSnapshot
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

const config={
  apiKey:'AIzaSyD9prfvOQGMeniL3U8WD2HeeZ6NNArY8J8',
  authDomain:'toolchat-bfac8.firebaseapp.com',
  projectId:'toolchat-bfac8',
  storageBucket:'toolchat-bfac8.firebasestorage.app',
  messagingSenderId:'52396840735',
  appId:'1:52396840735:web:a608b9c037c8481f2dc22a'
};

const app=getApps()[0]||initializeApp(config);
const auth=getAuth(app);
const db=getFirestore(app);
const $=id=>document.getElementById(id);

let me=null;
let panelName='';
let presenceTimer=null;
let profileUnsubscribe=null;
let notificationsUnsubscribe=null;
let currentProfileUid=null;
let currentProfileName='';
let profileRequest=0;
let noticeTimeout=null;

const escapeHTML=value=>String(value??'').replace(
  /[&<>"']/g,
  char=>({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  })[char]
);

function toast(message){
  const box=$('nx21notice');
  if(!box)return;

  clearTimeout(noticeTimeout);
  box.textContent=message;
  box.hidden=false;

  noticeTimeout=setTimeout(()=>{
    box.hidden=true;
  },4500);
}

function errorText(error){
  if(error?.code==='permission-denied'){
    return 'Нет доступа. Проверь Firestore Rules.';
  }
  return error?.message||'Неизвестная ошибка';
}

function formatTime(timestamp){
  return timestamp?.toDate?.().toLocaleString('ru-RU',{
    day:'numeric',
    month:'short',
    hour:'2-digit',
    minute:'2-digit'
  })||'';
}

function showPanel(name){
  if(!me){
    toast('Сначала войди в аккаунт');
    return;
  }

  panelName=name;

  for(const page of ['feed','search','profile','settings']){
    $(page+'Page')?.classList.add('hidden');
  }

  $('nx21panel').classList.remove('hidden');

  $('nx21title').textContent={
    saved:'Сохранённые публикации',
    notifications:'Уведомления',
    verification:'Верификация'
  }[name]||'NEXORA';

  $('nx21body').textContent='Загрузка...';

  if(name==='saved')loadSaved();
  if(name==='notifications')loadNotifications();
  if(name==='verification')loadVerification();
}

function closePanel(){
  panelName='';
  $('nx21panel')?.classList.add('hidden');
  $('feedPage')?.classList.remove('hidden');
}

document.querySelectorAll('[data-nx-panel]').forEach(button=>{
  button.addEventListener('click',()=>{
    showPanel(button.dataset.nxPanel);
  });
});

if($('nx21back')){
  $('nx21back').onclick=closePanel;
}

document.querySelectorAll('[data-page]').forEach(button=>{
  button.addEventListener('click',()=>{
    panelName='';
    $('nx21panel')?.classList.add('hidden');
  });
});

async function loadSaved(){
  const body=$('nx21body');

  try{
    const snapshot=await getDocs(query(
      collection(db,'users',me.uid,'saved'),
      limit(100)
    ));

    const html=await Promise.all(snapshot.docs.map(async saved=>{
      const post=await getDoc(doc(db,'posts',saved.id));

      if(!post.exists())return '';

      const data=post.data();

      return `
        <article class="nx21item">
          <p>${escapeHTML(data.text||'')}</p>
          <small class="muted">
            ${escapeHTML(formatTime(data.createdAt))}
          </small>
          <div class="nx21actions">
            <button type="button"
              data-nx-unsave="${escapeHTML(saved.id)}">
              Удалить из сохранённого
            </button>
          </div>
        </article>
      `;
    }));

    if(panelName!=='saved')return;

    body.innerHTML=html.filter(Boolean).join('')||
      '<p class="muted">Сохранённых публикаций пока нет.</p>';
  }catch(error){
    if(panelName==='saved'){
      body.textContent=errorText(error);
    }
  }
}

async function loadNotifications(){
  const body=$('nx21body');

  try{
    const snapshot=await getDocs(query(
      collection(db,'users',me.uid,'notifications'),
      limit(100)
    ));

    const records=snapshot.docs.sort((a,b)=>
      (b.data().createdAt?.seconds||0)-
      (a.data().createdAt?.seconds||0)
    );

    if(panelName!=='notifications')return;

    body.innerHTML=records.map(item=>{
      const data=item.data();

      return `
        <div class="nx21item">
          <p>${escapeHTML(data.text||'Уведомление')}</p>
          <small class="muted">
            ${escapeHTML(formatTime(data.createdAt))}
          </small>
          ${data.read!==true?`
            <div class="nx21actions">
              <button data-nx-read="${escapeHTML(item.id)}">
                Отметить прочитанным
              </button>
            </div>
          `:''}
        </div>
      `;
    }).join('')||
      '<p class="muted">Уведомлений пока нет.</p>';
  }catch(error){
    if(panelName==='notifications'){
      body.textContent=errorText(error);
    }
  }
}

async function loadVerification(){
  const body=$('nx21body');

  try{
    const snapshot=await getDoc(
      doc(db,'verificationRequests',me.uid)
    );

    if(panelName!=='verification')return;

    if(snapshot.exists()){
      const data=snapshot.data();
      const status={
        pending:'На рассмотрении',
        approved:'Одобрена',
        rejected:'Отклонена'
      }[data.status]||data.status;

      body.innerHTML=`
        <div class="nx21item">
          <h3>Твоя заявка</h3>
          <p>Статус: <b>${escapeHTML(status)}</b></p>
          <p>${escapeHTML(data.reason||'')}</p>
          <small class="muted">
            ${escapeHTML(formatTime(data.createdAt))}
          </small>
        </div>
      `;
      return;
    }

    body.innerHTML=`
      <p class="muted">
        Верификация подтверждает статус аккаунта.
        Заявка рассматривается администрацией.
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
          Обоснование
          <textarea id="nx21verifyReason"
            required minlength="15" maxlength="500"
            placeholder="Почему аккаунт должен получить верификацию?"></textarea>
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
        toast('Обоснование слишком короткое');
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

        toast('Заявка отправлена');
        await loadVerification();
      }catch(error){
        toast(errorText(error));
      }finally{
        button.disabled=false;
      }
    };
  }catch(error){
    if(panelName==='verification'){
      body.textContent=errorText(error);
    }
  }
}

async function savePost(id){
  await setDoc(
    doc(db,'users',me.uid,'saved',id),
    {
      postId:id,
      createdAt:serverTimestamp()
    }
  );
  toast('Публикация сохранена');
}

async function unsavePost(id){
  await deleteDoc(
    doc(db,'users',me.uid,'saved',id)
  );
  toast('Удалено из сохранённого');
  await loadSaved();
}

async function reportPost(id){
  const reason=prompt('Укажи причину жалобы');

  if(reason===null)return;

  const text=reason.trim();

  if(text.length<10||text.length>500){
    toast('Причина должна содержать 10–500 символов');
    return;
  }

  await addDoc(collection(db,'reports'),{
    reporterId:me.uid,
    kind:'post',
    targetId:id,
    reason:text,
    status:'pending',
    createdAt:serverTimestamp()
  });

  toast('Жалоба отправлена');
}

async function pinPost(id){
  const post=await getDoc(doc(db,'posts',id));

  if(!post.exists()){
    throw Error('Публикация не найдена');
  }

  if(post.data().uid!==me.uid){
    throw Error('Можно закреплять только свои публикации');
  }

  await updateDoc(doc(db,'users',me.uid),{
    pinnedPostId:id
  });

  toast('Публикация закреплена');
  refreshPinnedPost();
}

async function unpinPost(){
  await updateDoc(doc(db,'users',me.uid),{
    pinnedPostId:null
  });

  toast('Закрепление снято');
  refreshPinnedPost();
}

async function markNotification(id){
  await updateDoc(
    doc(db,'users',me.uid,'notifications',id),
    {read:true}
  );

  await loadNotifications();
}

document.addEventListener('click',async event=>{
  if(!me)return;

  const button=event.target.closest(
    '[data-nx-save],'+
    '[data-nx-unsave],'+
    '[data-nx-report],'+
    '[data-nx-pin],'+
    '[data-nx-unpin],'+
    '[data-nx-read]'
  );

  if(!button||button.disabled)return;

  button.disabled=true;

  try{
    if(button.dataset.nxSave){
      await savePost(button.dataset.nxSave);
    }else if(button.dataset.nxUnsave){
      await unsavePost(button.dataset.nxUnsave);
    }else if(button.dataset.nxReport){
      await reportPost(button.dataset.nxReport);
    }else if(button.dataset.nxPin){
      await pinPost(button.dataset.nxPin);
    }else if(button.hasAttribute('data-nx-unpin')){
      await unpinPost();
    }else if(button.dataset.nxRead){
      await markNotification(button.dataset.nxRead);
    }
  }catch(error){
    toast(errorText(error));
  }finally{
    button.disabled=false;
  }
});

function decoratePosts(){
  document.querySelectorAll('[data-post]').forEach(post=>{
    if(post.querySelector('.nx21actions'))return;

    const id=post.dataset.post;
    if(!id)return;

    const actions=document.createElement('div');
    actions.className='nx21actions';

    const save=document.createElement('button');
    save.type='button';
    save.textContent='☆ Сохранить';
    save.dataset.nxSave=id;

    const report=document.createElement('button');
    report.type='button';
    report.textContent='⚑ Жалоба';
    report.dataset.nxReport=id;

    actions.append(save,report);

    // В действующем app.js эта кнопка есть
    // только у автора публикации.
    if(post.querySelector('[data-action="delete-post"]')){
      const pin=document.createElement('button');
      pin.type='button';
      pin.textContent='📌 Закрепить';
      pin.dataset.nxPin=id;
      actions.append(pin);
    }

    post.append(actions);
  });
}

async function refreshPinnedPost(){
  const profile=$('profilePage');
  const posts=$('profilePosts');

  if(!profile||!posts||profile.classList.contains('hidden')){
    return;
  }

  const uid=currentProfileUid;
  if(!uid)return;

  const token=++profileRequest;

  try{
    const profileSnapshot=await getDoc(
      doc(db,'users',uid)
    );

    if(token!==profileRequest||currentProfileUid!==uid){
      return;
    }

    const pinnedId=profileSnapshot.data()?.pinnedPostId;

    posts.querySelectorAll('.nx21pinned').forEach(el=>{
      el.classList.remove('nx21pinned');
      el.querySelector('.nx21pinlabel')?.remove();
    });

    const oldUnpin=$('nx21unpin');
    oldUnpin?.remove();

    if(!pinnedId)return;

    let article=[...posts.querySelectorAll('[data-post]')]
      .find(el=>el.dataset.post===pinnedId);

    // Публикация могла не попасть в первые 50
    // загруженных постов.
    if(!article){
      const snapshot=await getDoc(
        doc(db,'posts',pinnedId)
      );

      if(!snapshot.exists()||snapshot.data().uid!==uid){
        return;
      }

      article=document.createElement('article');
      article.className='glass panel';
      article.dataset.post=pinnedId;

      const text=document.createElement('div');
      text.className='posttext';
      text.textContent=snapshot.data().text||'';

      article.append(text);
    }

    if(token!==profileRequest||currentProfileUid!==uid){
      return;
    }

    posts.prepend(article);
    article.classList.add('nx21pinned');

    const label=document.createElement('div');
    label.className='nx21pinlabel muted';
    label.textContent='📌 Закреплённая публикация';
    article.prepend(label);

    if(uid===me?.uid){
      const button=document.createElement('button');
      button.id='nx21unpin';
      button.className='quiet';
      button.textContent='Снять закрепление';
      button.dataset.nxUnpin='';
      $('profileControls')?.append(button);
    }

    decoratePosts();
  }catch(error){
    console.warn('Pinned post:',error.message);
  }
}

function stopProfilePresence(){
  profileUnsubscribe?.();
  profileUnsubscribe=null;
}

function watchProfilePresence(uid){
  stopProfilePresence();

  const controls=$('profileControls');
  if(!controls)return;

  controls.querySelector('.nx21status')?.remove();

  const status=document.createElement('span');
  status.className='nx21status';
  status.textContent='Статус неизвестен';
  controls.append(status);

  profileUnsubscribe=onSnapshot(
    doc(db,'presence',uid),
    snapshot=>{
      if(currentProfileUid!==uid||!status.isConnected){
        return;
      }

      const seen=snapshot.data()?.lastSeen?.toMillis?.();

      if(!seen){
        status.textContent='Статус неизвестен';
        return;
      }

      const online=Date.now()-seen<120000;

      status.textContent=online
        ?'● Недавно был активен'
        :'○ Не в сети';

      status.classList.toggle('nx21online',online);
    },
    ()=>{
      status.textContent='Статус недоступен';
    }
  );
}

function observeProfile(){
  const name=$('profileName');
  const controls=$('profileControls');

  if(!name||!controls||!me)return;
  if($('profilePage')?.classList.contains('hidden'))return;
  if(!name.textContent.trim()||
     name.textContent.trim()==='Загрузка...')return;

  const label=name.textContent.trim();

  // У app.js нет публичного API для viewUid.
  // Поэтому используем UID из ссылки на ЛС,
  // которую он создаёт при просмотре чужого профиля.
  const messageLink=controls.querySelector(
    'a[href*="chats.html?user="]'
  );

  let uid=me.uid;

  if(messageLink){
    try{
      uid=new URL(messageLink.href,location.href)
        .searchParams.get('user')||me.uid;
    }catch{}
  }

  const changed=uid!==currentProfileUid||
    label!==currentProfileName;

  if(!changed)return;

  currentProfileUid=uid;
  currentProfileName=label;

  watchProfilePresence(uid);
  refreshPinnedPost();
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
  notificationsUnsubscribe?.();
  notificationsUnsubscribe=null;
  stopProfilePresence();

  currentProfileUid=null;
  currentProfileName='';

  if(!user){
    panelName='';
    $('nx21panel')?.classList.add('hidden');
    return;
  }

  await heartbeat();

  if(auth.currentUser?.uid!==user.uid)return;

  presenceTimer=setInterval(heartbeat,60000);

  notificationsUnsubscribe=onSnapshot(
    collection(db,'users',user.uid,'notifications'),
    snapshot=>{
      const count=snapshot.docs.filter(
        item=>item.data().read!==true
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
    error=>console.warn('Notifications:',error.message)
  );
});

// Наблюдаем только за обновлением ленты и профиля,
// а не за всеми изменениями страницы.
let scheduled=false;

const observer=new MutationObserver(()=>{
  if(scheduled)return;

  scheduled=true;

  requestAnimationFrame(()=>{
    scheduled=false;
    decoratePosts();
    observeProfile();
  });
});

for(const id of [
  'feedList',
  'profilePosts',
  'profileControls',
  'profileName'
]){
  const element=$(id);

  if(element){
    observer.observe(element,{
      childList:true,
      subtree:true
    });
  }
}

decoratePosts();
