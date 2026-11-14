
/* NEXORA 3.1 Stable — reposts, quotes, counters and status */
import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,collection,doc,getDoc,addDoc,serverTimestamp,getCountFromServer} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

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

let me=null;
let busy=false;
let noticeTimer=null;

onAuthStateChanged(auth,u=>{
  me=u;
});

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  '"':'&quot;',
  "'":'&#39;'
})[c]);

const validId=s=>
  typeof s==='string' &&
  /^[A-Za-z0-9]{10,40}$/.test(s);

function notice(msg){
  const el=document.getElementById('toast');
  if(!el)return;

  clearTimeout(noticeTimer);
  el.textContent=String(msg);
  el.classList.remove('hidden');

  noticeTimer=setTimeout(()=>{
    el.classList.add('hidden');
  },4500);
}

function extractTags(t){
  return [...new Set(
    (String(t||'').match(
      /#[\p{L}\p{N}_]{2,40}/gu
    )||[]).map(x=>x.toLowerCase())
  )].slice(0,20);
}

function sourceMeta(text){
  const t=String(text||'');

  const m=t.match(
    /\n\nИсточник: NEXORA · ([A-Za-z0-9]{1,8}) · ([A-Za-z0-9]{10,40})$/
  );

  if(!m)return null;

  if(t.startsWith('↻ Репост\n')){
    return {
      type:'repost',
      id:m[2],
      credit:m[1],
      body:t.slice(
        '↻ Репост\n'.length,
        m.index
      ).trim()
    };
  }

  if(t.startsWith('❝ Цитата\n')){
    const body=t.slice(
      '❝ Цитата\n'.length,
      m.index
    );

    const sep=body.indexOf('\n\n');
    if(sep<0)return null;

    return {
      type:'quote',
      id:m[2],
      credit:m[1],
      comment:body.slice(0,sep),
      body:body.slice(sep+2)
    };
  }

  return null;
}

function applyCard(article){
  if(article.dataset.nx31Card)return;

  const text=article.querySelector('.posttext');
  if(!text)return;

  const meta=sourceMeta(text.textContent);
  if(!meta)return;

  article.dataset.nx31Card='1';
  article.classList.add('nx31-'+meta.type);

  const wrapper=document.createElement('div');
  wrapper.className='nx31-original';

  const label=document.createElement('div');
  label.className='nx31-source';
  label.textContent=
    'Оригинальная публикация · '+meta.credit;

  const content=document.createElement('div');
  content.className='nx31-original-text';
  content.textContent=meta.body;

  wrapper.append(label,content);

  const title=document.createElement('div');
  title.className='nx31-kind';
  title.textContent=
    meta.type==='repost'
      ? '↻ Репост'
      : '❝ Цитата';

  text.replaceChildren(title);

  if(meta.type==='quote'){
    const comment=document.createElement('p');
    comment.className='nx31-quote-text';
    comment.textContent=meta.comment;
    text.append(comment);
  }

  text.append(wrapper);

  const image=article.querySelector('.postimage');

  if(image&&image.parentElement===article){
    wrapper.append(image);
  }
}

const counterCache=new Map();
const pending=new Set();
let counterObserver=null;

async function loadCounters(article){
  const id=article.dataset.post;

  if(!validId(id)||pending.has(id))return;

  const el=article.querySelector('.nx31-counters');
  if(!el)return;

  if(counterCache.has(id)){
    el.textContent=counterCache.get(id);
    return;
  }

  pending.add(id);
  el.textContent='Счётчики загружаются…';

  try{
    const c=await getCountFromServer(
      collection(db,'posts',id,'comments')
    );

    const result=
      `${c.data().count} комментариев · Лайки: нет общего счётчика`;

    counterCache.set(id,result);

    if(article.isConnected){
      el.textContent=result;
    }
  }catch(e){
    console.warn('[NEXORA] counters:',id,e);

    if(article.isConnected){
      el.replaceChildren();

      const label=document.createElement('span');
      label.textContent='Счётчики недоступны';

      const retry=document.createElement('button');
      retry.type='button';
      retry.className='nx31-count-retry';
      retry.textContent='Повторить';
      retry.dataset.nx31CountRetry=id;

      el.append(label,retry);
    }
  }finally{
    pending.delete(id);
  }
}

function observeCounters(article){
  if(!counterObserver){
    counterObserver=new IntersectionObserver(
      entries=>{
        for(const e of entries){
          if(e.isIntersecting){
            counterObserver.unobserve(e.target);
            loadCounters(e.target);
          }
        }
      },
      {rootMargin:'150px'}
    );
  }

  counterObserver.observe(article);
}

function decorate(){
  document.querySelectorAll(
    'article[data-post]'
  ).forEach(article=>{
    const id=article.dataset.post;
    const actions=article.querySelector('.actions');

    if(!validId(id)||!actions)return;

    if(!article.querySelector('.nx22-actions')){
      const wrap=document.createElement('span');
      wrap.className='nx22-actions';

      wrap.innerHTML=`
        <button
          type="button"
          data-nx22="repost"
          data-id="${esc(id)}"
        >↻ Репост</button>

        <button
          type="button"
          data-nx22="quote"
          data-id="${esc(id)}"
        >❝ Цитировать</button>
      `;

      actions.append(wrap);
    }

    const text=article.querySelector('.posttext');

    if(text&&!text.dataset.nx22Tags){
      text.dataset.nx22Tags='1';

      const tags=extractTags(text.textContent);

      if(tags.length){
        const bar=document.createElement('div');
        bar.className='nx22-tags';

        for(const tag of tags){
          const link=document.createElement('a');
          link.href=
            './explore.html?tag='+
            encodeURIComponent(tag);

          link.textContent=tag;
          bar.append(link);
        }

        text.after(bar);
      }
    }

    applyCard(article);

    if(!article.querySelector('.nx31-counters')){
      const counter=document.createElement('div');
      counter.className='nx31-counters';
      counter.setAttribute('aria-live','polite');
      counter.textContent='Счётчики загружаются…';

      actions.before(counter);
      observeCounters(article);
    }
  });
}

async function createRepost(id,comment=''){
  if(!me){
    throw Error('Сначала войди в аккаунт.');
  }

  if(!validId(id)){
    throw Error('Некорректный ID публикации.');
  }

  const snap=await getDoc(doc(db,'posts',id));

  if(!snap.exists()){
    throw Error('Исходная публикация удалена.');
  }

  const original=snap.data();

  if(!validId(original.uid)){
    throw Error('Некорректный автор.');
  }

  const clean=String(comment||'').trim();

  if(clean.length>350){
    throw Error('Комментарий слишком длинный.');
  }

  const prefix=clean
    ? '❝ Цитата\n'+clean+'\n\n'
    : '↻ Репост\n';

  const credit=
    '\n\nИсточник: NEXORA · '+
    original.uid.slice(0,8)+' · '+id;

  const remaining=
    1000-prefix.length-credit.length;

  if(remaining<20){
    throw Error('Цитата слишком длинная.');
  }

  const data={
    uid:me.uid,
    text:prefix+
      String(original.text||'').slice(0,remaining)+
      credit,
    createdAt:serverTimestamp()
  };

  if(typeof original.imageUrl==='string'){
    try{
      const u=new URL(original.imageUrl);

      if(
        u.protocol==='https:' &&
        !u.username &&
        !u.password &&
        /\.(png|jpe?g|webp)$/i.test(u.pathname)
      ){
        data.imageUrl=u.href;
      }
    }catch{}
  }

  await addDoc(collection(db,'posts'),data);
}

function quoteDialog(id){
  if(!me){
    return notice('Сначала войди в аккаунт.');
  }

  document.querySelector('.nx22-overlay')?.remove();

  const overlay=document.createElement('div');
  overlay.className='nx22-overlay';

  overlay.innerHTML=`
    <form class="nx22-dialog">
      <h2>Цитировать публикацию</h2>
      <p>Добавь свой комментарий к оригиналу</p>

      <textarea
        maxlength="350"
        required
        placeholder="Твой комментарий"
      ></textarea>

      <div class="nx22-dialog-actions">
        <button type="button" data-close>
          Отмена
        </button>
        <button type="submit">
          Опубликовать
        </button>
      </div>
    </form>
  `;

  document.body.append(overlay);

  const close=()=>overlay.remove();

  overlay.querySelector('[data-close]').onclick=close;

  overlay.addEventListener('click',e=>{
    if(e.target===overlay)close();
  });

  const form=overlay.querySelector('form');

  form.onsubmit=async e=>{
    e.preventDefault();

    if(busy)return;

    const comment=
      form.querySelector('textarea').value.trim();

    if(!comment)return;

    busy=true;

    const button=form.querySelector(
      '[type="submit"]'
    );

    button.disabled=true;

    try{
      await createRepost(id,comment);
      close();
      notice('Цитата опубликована.');
    }catch(error){
      notice(
        error.message||'Ошибка публикации.'
      );
    }finally{
      busy=false;
      button.disabled=false;
    }
  };

  overlay.querySelector('textarea').focus();
}

document.addEventListener('click',async event=>{
  const retry=event.target.closest(
    '[data-nx31-count-retry]'
  );

  if(retry){
    event.preventDefault();
    event.stopPropagation();

    const article=retry.closest(
      'article[data-post]'
    );

    if(article)loadCounters(article);
    return;
  }

  const button=event.target.closest('[data-nx22]');
  if(!button)return;

  event.preventDefault();
  event.stopPropagation();

  const id=button.dataset.id;

  if(!validId(id)){
    return notice('Некорректный ID.');
  }

  if(button.dataset.nx22==='quote'){
    if(!busy)quoteDialog(id);
    return;
  }

  if(busy)return;

  if(!confirm(
    'Опубликовать репост у себя в профиле?'
  ))return;

  busy=true;
  button.disabled=true;

  try{
    await createRepost(id);
    notice('Репост опубликован.');
  }catch(error){
    notice(error.message||'Ошибка репоста.');
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

for(const id of ['feedList','profilePosts']){
  const el=document.getElementById(id);

  if(el){
    observer.observe(el,{
      childList:true,
      subtree:true
    });
  }
}

decorate();
