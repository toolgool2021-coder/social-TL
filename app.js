
import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth,onAuthStateChanged,createUserWithEmailAndPassword,
  signInWithEmailAndPassword,signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getFirestore,collection,doc,setDoc,getDoc,getDocs,
  addDoc,deleteDoc,query,orderBy,limit,onSnapshot,
  serverTimestamp,runTransaction
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {SOCIAL,TRUSTED_HOSTS} from './config.js';

const firebaseConfig = {
  apiKey:'AIzaSyD9prfvOQGMeniL3U8WD2HeeZ6NNArY8J8',
  authDomain:'toolchat-bfac8.firebaseapp.com',
  projectId:'toolchat-bfac8',
  storageBucket:'toolchat-bfac8.firebasestorage.app',
  messagingSenderId:'52396840735',
  appId:'1:52396840735:web:a608b9c037c8481f2dc22a',
  measurementId:'G-WSR0SZ40M7'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);

let me=null, myProfile=null, viewUid=null;
let users={}, posts=[], likes={};
let currentPage='feed', authMode='login', profileToken=0;
let unsubPosts=null, unsubLikes=null;
let unsubFollowers=null, unsubFollowing=null;
let toastTimer=null, pendingURL=null;

const badges = {
  1:'Этот пользователь прошёл стандартную верификацию Nexora.',
  2:'Это официальный подтверждённый бренд в Nexora.',
  3:'Это создатель и главный разработчик Nexora.',
  4:'Этот пользователь входит в команду Nexora.',
  5:'Этот пользователь поддержал развитие Nexora. Спасибо за вклад в проект!'
};

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent=message;
  $('toast').classList.remove('hidden');
  toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),3800);
}

function esc(s) {
  return String(s??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));
}

function validURL(s) {
  try {
    const u=new URL(s);
    return u.protocol==='https:' &&
      !!u.hostname && u.username==='' && u.password==='';
  } catch {
    return false;
  }
}

function imageURL(s) {
  if(!s)return '';
  if(!validURL(s))throw Error('Изображение должно иметь прямую HTTPS-ссылку');
  const u=new URL(s);
  if(!/\.(png|jpe?g|webp)$/i.test(u.pathname))
    throw Error('Разрешены только прямые ссылки на PNG, JPG и WebP');
  return u.href;
}

function avatar(uid,big=false) {
  const u=users[uid]||{};
  const name=u.name||'N';
  const url=u.avatarUrl;
  return `<div class="avatar ${big?'large':''}">${
    url
      ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
      : esc(name.slice(0,2).toUpperCase())
  }</div>`;
}

function displayName(uid) {
  return users[uid]?.name||'Пользователь';
}

// Значки предназначены только для отображения.
// Они не дают административных прав.
function badgeHTML(uid) {
  const v=Number(users[uid]?.verification||0);
  return v>=1&&v<=5
    ? `<button type="button" class="badgeicon" data-badge="${v}" aria-label="Информация о верификации"><img src="image/Verified_${v}.png" alt="Верификация" onerror="this.parentElement.remove()"></button>`
    : '';
}

function nameHTML(uid) {
  return `<span class="namegroup"><span class="name">${esc(displayName(uid))}</span>${badgeHTML(uid)}</span>`;
}

function formatDate(t) {
  return t?.toDate
    ? t.toDate().toLocaleString('ru-RU',{
        day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'
      })
    : 'Только что';
}

function isTrusted(raw) {
  try {
    const u=new URL(raw);
    return u.protocol==='https:' &&
      TRUSTED_HOSTS.some(host=>
        u.hostname===host || u.hostname.endsWith('.'+host)
      );
  } catch {
    return false;
  }
}

function externalLink(raw,label) {
  if(!validURL(raw))return '';
  return `<a href="${esc(raw)}" target="_blank" rel="noopener noreferrer" data-external>${esc(label)}</a>`;
}

function linkify(text) {
  const rx=/https?:\/\/[^\s<>"']+/g;
  let out='',start=0;
  for(const m of text.matchAll(rx)) {
    out+=esc(text.slice(start,m.index));
    const raw=m[0].replace(/[.,!?;:)]+$/,'');
    out+=validURL(raw)?externalLink(raw,raw):esc(raw);
    out+=esc(m[0].slice(raw.length));
    start=m.index+m[0].length;
  }
  return out+esc(text.slice(start));
}

function showPage(page) {
  if(!me)return;
  currentPage=page;
  ['feed','search','profile','settings'].forEach(p=>
    $(p+'Page').classList.toggle('hidden',p!==page)
  );
  document.querySelectorAll('[data-page]').forEach(b=>
    b.classList.toggle('active',b.dataset.page===page)
  );
  if(page==='search')renderSearch();
  if(page==='profile')openProfile(me.uid);
  if(page==='settings')fillSettings();
}

document.querySelectorAll('[data-page]').forEach(b=>
  b.onclick=()=>showPage(b.dataset.page)
);

$('authSwitch').onclick=()=>{
  authMode=authMode==='login'?'register':'login';
  const reg=authMode==='register';
  $('username').classList.toggle('hidden',!reg);
  $('username').required=reg;
  $('authTitle').textContent=reg?'Создать аккаунт':'С возвращением';
  $('authSubmit').textContent=reg?'Зарегистрироваться':'Войти';
  $('authSwitch').textContent=reg
    ?'Уже есть аккаунт? Войти':'Создать аккаунт';
};

$('authForm').onsubmit=async e=>{
  e.preventDefault();
  const btn=$('authSubmit');
  btn.disabled=true;
  try {
    const email=$('email').value.trim();
    const password=$('password').value;
    if(authMode==='register') {
      const name=$('username').value.trim();
      if(name.length<3||name.length>20)
        throw Error('Имя должно содержать 3–20 символов');
      const result=await createUserWithEmailAndPassword(auth,email,password);
      await setDoc(doc(db,'users',result.user.uid),{
        name,
        bio:'Привет! Я в Nexora.',
        createdAt:serverTimestamp()
      });
    } else {
      await signInWithEmailAndPassword(auth,email,password);
    }
  } catch(err) {
    toast(err.message||'Ошибка входа');
  } finally {
    btn.disabled=false;
  }
};

$('logout').onclick=()=>signOut(auth);

function stopProfile() {
  profileToken++;
  unsubFollowers?.();
  unsubFollowing?.();
  unsubFollowers=unsubFollowing=null;
}

onAuthStateChanged(auth,async user=>{
  unsubPosts?.();
  unsubLikes?.();
  stopProfile();
  me=user;
  myProfile=null;
  $('authPage').classList.toggle('hidden',!!user);
  $('app').classList.toggle('hidden',!user);
  $('topUser').classList.toggle('hidden',!user);
  if(!user)return;

  try {
    const snap=await getDoc(doc(db,'users',user.uid));
    if(!snap.exists()) {
      toast('Профиль не найден. Проверьте регистрацию.');
      return;
    }
    myProfile=snap.data();
    $('topName').textContent=myProfile.name;
    await loadUsers();
    listenFeed();
    showPage('feed');
  } catch(err) {
    toast('Ошибка загрузки: '+err.message);
  }
});

async function loadUsers() {
  const snap=await getDocs(query(collection(db,'users'),limit(100)));
  users={};
  snap.forEach(d=>users[d.id]=d.data());
  if(me&&myProfile)users[me.uid]=myProfile;
}

$('postInput').oninput=()=>
  $('postCount').textContent=$('postInput').value.length;

$('postForm').onsubmit=async e=>{
  e.preventDefault();
  if(!me)return;
  const text=$('postInput').value.trim();
  if(!text||text.length>1000)return;
  const btn=e.target.querySelector('button');
  btn.disabled=true;

  try {
    const imageUrl=imageURL($('postImage').value.trim());
    const data={
      uid:me.uid,
      text,
      createdAt:serverTimestamp()
    };
    if(imageUrl)data.imageUrl=imageUrl;
    await addDoc(collection(db,'posts'),data);
    $('postInput').value='';
    $('postImage').value='';
    $('postCount').textContent='0';
    toast('Публикация создана');
  } catch(err) {
    toast(err.message);
  } finally {
    btn.disabled=false;
  }
};

function listenFeed() {
  unsubPosts?.();
  unsubLikes?.();

  unsubPosts=onSnapshot(
    query(collection(db,'posts'),orderBy('createdAt','desc'),limit(50)),
    s=>{
      posts=s.docs.map(d=>({id:d.id,...d.data()}));
      renderFeed();
      if(currentPage==='profile')renderProfilePosts();
    },
    e=>toast('Ошибка ленты: '+e.message)
  );

  unsubLikes=onSnapshot(
    collection(db,'users',me.uid,'likes'),
    s=>{
      likes={};
      s.forEach(d=>likes[d.id]=true);
      renderFeed();
      if(currentPage==='profile')renderProfilePosts();
    },
    e=>toast('Ошибка лайков: '+e.message)
  );
}

function postHTML(p) {
  const mine=p.uid===me?.uid;
  const liked=!!likes[p.id];

  return `<article class="glass panel" data-post="${esc(p.id)}">
    <div class="userrow">
      ${avatar(p.uid)}
      <div style="flex:1;min-width:0">
        ${nameHTML(p.uid)}
        <div class="muted">${esc(formatDate(p.createdAt))}</div>
      </div>
      ${mine
        ? `<button class="quiet" data-action="delete-post" data-id="${esc(p.id)}">Удалить</button>`
        : ''}
    </div>
    <div class="posttext">${linkify(p.text||'')}</div>
    ${p.imageUrl
      ? `<img class="postimage" src="${esc(p.imageUrl)}" alt="Изображение публикации" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true">`
      : ''}
    <div class="actions">
      <button class="${liked?'liked':''}" data-action="like" data-id="${esc(p.id)}">${liked?'♥':'♡'} Нравится</button>
      <button data-action="comments" data-id="${esc(p.id)}">☏ Комментарии</button>
      <button data-action="author" data-id="${esc(p.uid)}">Профиль</button>
    </div>
    <div id="comments-${esc(p.id)}" class="hidden" style="margin-top:15px"></div>
  </article>`;
}

function renderFeed() {
  $('feedList').innerHTML=posts.length
    ?posts.map(postHTML).join('')
    :'<div class="glass panel empty">Пока нет публикаций</div>';
}

document.addEventListener('click',async e=>{
  // Нажатие именно на значок верификации
  const badge=e.target.closest('[data-badge]');
  if(badge) {
    e.preventDefault();
    e.stopPropagation();
    toast(badges[Number(badge.dataset.badge)]||'Верифицированный аккаунт');
    return;
  }

  // Предупреждение о сторонних ссылках
  const link=e.target.closest('a[data-external]');
  if(link&&!isTrusted(link.href)) {
    e.preventDefault();
    pendingURL=link.href;
    $('linkTarget').textContent=new URL(link.href).hostname;
    $('linkDialog').classList.remove('hidden');
    return;
  }

  const b=e.target.closest('[data-action]');
  if(!b||!me)return;
  const id=b.dataset.id;

  try {
    if(b.dataset.action==='like') {
      const ref=doc(db,'users',me.uid,'likes',id);
      if(likes[id])await deleteDoc(ref);
      else await setDoc(ref,{createdAt:serverTimestamp()});
    }
    if(b.dataset.action==='delete-post') {
      if(confirm('Удалить публикацию?'))
        await deleteDoc(doc(db,'posts',id));
    }
    if(b.dataset.action==='comments')await openComments(id);
    if(b.dataset.action==='author')await openProfile(id);
    if(b.dataset.action==='follow')await toggleFollow(id);
  } catch(err) {
    toast(err.message);
  }
});

$('cancelLink').onclick=()=>{
  $('linkDialog').classList.add('hidden');
  pendingURL=null;
};

$('confirmLink').onclick=()=>{
  if(pendingURL&&validURL(pendingURL))
    window.open(pendingURL,'_blank','noopener,noreferrer');
  $('linkDialog').classList.add('hidden');
  pendingURL=null;
};

$('linkDialog').onclick=e=>{
  if(e.target===$('linkDialog'))$('cancelLink').click();
};

async function openComments(postId) {
  const box=$('comments-'+postId);
  if(!box)return;

  if(!box.classList.contains('hidden')) {
    box.classList.add('hidden');
    return;
  }

  box.classList.remove('hidden');
  box.textContent='Загрузка...';

  try {
    const snap=await getDocs(query(
      collection(db,'posts',postId,'comments'),
      orderBy('createdAt','desc'),
      limit(30)
    ));

    box.innerHTML=snap.docs.map(d=>{
      const c=d.data();
      return `<div class="comment">
        ${nameHTML(c.uid)}
        <p>${linkify(c.text||'')}</p>
      </div>`;
    }).join('')||'<p class="muted">Комментариев пока нет</p>';

    const form=document.createElement('form');
    form.className='stack';
    form.innerHTML='<input maxlength="300" required placeholder="Написать комментарий"><button class="primary">Отправить</button>';

    form.onsubmit=async e=>{
      e.preventDefault();
      const text=form.querySelector('input').value.trim();
      if(!text)return;
      const btn=form.querySelector('button');
      btn.disabled=true;
      try {
        await addDoc(collection(db,'posts',postId,'comments'),{
          uid:me.uid,
          text,
          createdAt:serverTimestamp()
        });
        box.classList.add('hidden');
        await openComments(postId);
      } catch(err) {
        toast(err.message);
      } finally {
        btn.disabled=false;
      }
    };

    box.append(form);
  } catch(err) {
    box.textContent='Ошибка: '+err.message;
  }
}

$('searchInput').oninput=renderSearch;

function renderSearch() {
  const q=$('searchInput').value.toLowerCase().trim();
  const results=Object.entries(users)
    .filter(([,u])=>!q||u.name?.toLowerCase().includes(q))
    .slice(0,30);

  $('searchResults').innerHTML=results.map(([uid,u])=>
    `<div class="glass panel userrow">
      ${avatar(uid)}
      <div style="flex:1">
        ${nameHTML(uid)}
        <div class="muted">${esc(u.bio||'')}</div>
      </div>
      <button class="quiet" data-action="author" data-id="${esc(uid)}">Открыть</button>
    </div>`
  ).join('')||'<div class="empty">Никого не найдено</div>';
}

async function openProfile(uid) {
  stopProfile();
  const token=profileToken;
  viewUid=uid;
  currentPage='profile';

  ['feed','search','profile','settings'].forEach(p=>
    $(p+'Page').classList.toggle('hidden',p!=='profile')
  );
  document.querySelectorAll('[data-page]').forEach(b=>
    b.classList.toggle('active',b.dataset.page==='profile')
  );

  $('profileName').textContent='Загрузка...';
  $('profileControls').innerHTML='';
  $('profilePosts').innerHTML='';

  try {
    const snap=await getDoc(doc(db,'users',uid));
    if(token!==profileToken)return;
    if(!snap.exists())throw Error('Пользователь не найден');

    const u=snap.data();
    users[uid]=u;

    $('profileName').innerHTML=nameHTML(uid);
    $('profileHandle').textContent='Участник Nexora';
    $('profileAvatar').innerHTML=avatar(uid,true)
      .replace(/^<div[^>]*>|<\/div>$/g,'');
    $('profileBanner').style.backgroundImage=u.bannerUrl
      ? `url("${encodeURI(u.bannerUrl).replace(/"/g,'%22')}")`
      : '';
    $('profileBio').textContent=u.bio||'Без описания';
    $('profileLinks').innerHTML=u.websiteUrl
      ? externalLink(u.websiteUrl,'🌐 Сайт пользователя')
      : '';

    $('profileControls').innerHTML=uid===me.uid
      ? '<button class="quiet" id="editProfile">Редактировать профиль</button>'
      : `<button class="primary" id="followButton">Подписаться</button>
         <a class="quiet" href="chats.html?user=${encodeURIComponent(uid)}">✉ Написать</a>`;

    if(uid===me.uid)
      $('editProfile').onclick=()=>showPage('settings');
    else
      $('followButton').onclick=()=>toggleFollow(uid);

    unsubFollowers=onSnapshot(
      collection(db,'users',uid,'followers'),
      s=>{
        if(token!==profileToken)return;
        $('followersCount').textContent=s.size;
        const b=$('followButton');
        if(b)b.textContent=s.docs.some(d=>d.id===me.uid)
          ?'Отписаться':'Подписаться';
      }
    );

    unsubFollowing=onSnapshot(
      collection(db,'users',uid,'following'),
      s=>{
        if(token===profileToken)
          $('followingCount').textContent=s.size;
      }
    );

    renderProfilePosts();
  } catch(err) {
    toast(err.message);
  }
}

function renderProfilePosts() {
  $('profilePosts').innerHTML=posts
    .filter(p=>p.uid===viewUid)
    .map(postHTML)
    .join('')
    ||'<div class="glass panel empty">Публикаций в загруженной ленте нет</div>';
}

async function toggleFollow(uid) {
  if(uid===me.uid)return;

  const a=doc(db,'users',me.uid,'following',uid);
  const b=doc(db,'users',uid,'followers',me.uid);

  await runTransaction(db,async tx=>{
    const snap=await tx.get(a);
    if(snap.exists()) {
      tx.delete(a);
      tx.delete(b);
    } else {
      tx.set(a,{createdAt:serverTimestamp()});
      tx.set(b,{createdAt:serverTimestamp()});
    }
  });
  toast('Подписки обновлены');
}

function fillSettings() {
  if(!myProfile)return;
  $('settingsBio').value=myProfile.bio||'';
  $('settingsAvatar').value=myProfile.avatarUrl||'';
  $('settingsBanner').value=myProfile.bannerUrl||'';
  $('settingsWebsite').value=myProfile.websiteUrl||'';
}

$('settingsForm').onsubmit=async e=>{
  e.preventDefault();
  if(!me)return;
  const btn=e.target.querySelector('button');
  btn.disabled=true;

  try {
    const bio=$('settingsBio').value.trim();
    const avatarUrl=imageURL($('settingsAvatar').value.trim());
    const bannerUrl=imageURL($('settingsBanner').value.trim());
    const websiteUrl=$('settingsWebsite').value.trim();

    if(bio.length>160)
      throw Error('Описание не длиннее 160 символов');
    if(websiteUrl&&!validURL(websiteUrl))
      throw Error('Ссылка на сайт должна начинаться с https://');

    const changes={bio,avatarUrl,bannerUrl,websiteUrl};
    await setDoc(doc(db,'users',me.uid),changes,{merge:true});
    myProfile={...myProfile,...changes};
    users[me.uid]=myProfile;
    toast('Профиль сохранён');
  } catch(err) {
    toast(err.message);
  } finally {
    btn.disabled=false;
  }
};

for(const [id,url] of [
  ['tgChannel',SOCIAL.telegramChannel],
  ['tgBot',SOCIAL.telegramBot]
]) {
  const a=$(id);
  if(validURL(url)) {
    a.href=url;
    a.dataset.external='';
  } else {
    a.classList.add('hidden');
  }
}

if(!validURL(SOCIAL.telegramChannel)&&!validURL(SOCIAL.telegramBot)) {
  $('socialHint').textContent=
    'Адреса Telegram-канала и бота можно указать в config.js.';
}
