
import {
  initializeApp, getApps, getApp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';

import {
  getAuth, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

import {
  getFirestore, collection, doc, getDoc,
  addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

// NEXORA 2.2 Posts Upgrade
// Работает вместе с существующим app.js.

const config = {
  apiKey: 'AIzaSyD9prfvOQGMeniL3U8WD2HeeZ6NNArY8J8',
  authDomain: 'toolchat-bfac8.firebaseapp.com',
  projectId: 'toolchat-bfac8',
  storageBucket: 'toolchat-bfac8.firebasestorage.app',
  messagingSenderId: '52396840735',
  appId: '1:52396840735:web:a608b9c037c8481f2dc22a'
};

const app = getApps().length ? getApp() : initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);

let user = null;
let busy = false;

onAuthStateChanged(auth, u => {
  user = u;
});

const escapeHTML = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

function notice(message) {
  const el = document.getElementById('toast');

  if (el) {
    el.textContent = message;
    el.classList.remove('hidden');

    setTimeout(() => {
      el.classList.add('hidden');
    }, 3500);
  } else {
    alert(message);
  }
}

function extractTags(text) {
  return [...new Set(
    (String(text || '').match(
      /#[\p{L}\p{N}_]{2,40}/gu
    ) || []).map(tag => tag.toLowerCase())
  )];
}

function validUID(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9]{10,40}$/.test(value);
}

function addPostButtons() {
  for (const article of document.querySelectorAll(
    'article[data-post]'
  )) {
    const id = article.dataset.post;

    if (!id || article.querySelector('.nx22-actions')) {
      continue;
    }

    const actions = article.querySelector('.actions');

    if (!actions) continue;

    const wrapper = document.createElement('span');
    wrapper.className = 'nx22-actions';

    wrapper.innerHTML = `
      <button type="button"
        data-nx22="repost"
        data-id="${escapeHTML(id)}">
        ↻ Репост
      </button>
      <button type="button"
        data-nx22="quote"
        data-id="${escapeHTML(id)}">
        ❝ Цитировать
      </button>
    `;

    actions.append(wrapper);

    const postText = article.querySelector('.posttext');

    if (postText && !postText.dataset.nx22Tags) {
      postText.dataset.nx22Tags = '1';

      const tags = extractTags(postText.textContent);

      if (tags.length) {
        const bar = document.createElement('div');
        bar.className = 'nx22-tags';

        for (const tag of tags) {
          const link = document.createElement('a');

          link.href =
            './explore.html?tag=' + encodeURIComponent(tag);

          link.textContent = tag;
          bar.append(link);
        }

        postText.after(bar);
      }
    }
  }
}

async function createRepost(id, comment) {
  if (!user) {
    throw Error('Войди в аккаунт');
  }

  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) {
    throw Error('Неверный ID публикации');
  }

  const snapshot = await getDoc(doc(db, 'posts', id));

  if (!snapshot.exists()) {
    throw Error('Публикация удалена');
  }

  const original = snapshot.data();

  if (!validUID(original.uid)) {
    throw Error('Некорректный автор');
  }

  const prefix = comment
    ? '❝ Цитата\n' + comment.trim() + '\n\n'
    : '↻ Репост\n';

  const originalText = String(original.text || '').trim();

  const credit =
    '\n\nИсточник: NEXORA · ' +
    original.uid.slice(0, 8) +
    ' · ' + id;

  const remaining = 1000 - prefix.length - credit.length;

  if (remaining < 20) {
    throw Error('Слишком длинная цитата');
  }

  const text =
    prefix +
    originalText.slice(0, remaining) +
    credit;

  const data = {
    uid: user.uid,
    text,
    createdAt: serverTimestamp()
  };

  if (
    typeof original.imageUrl === 'string' &&
    /^https:\/\//.test(original.imageUrl)
  ) {
    data.imageUrl = original.imageUrl;
  }

  await addDoc(collection(db, 'posts'), data);
}

function quoteDialog(id) {
  const overlay = document.createElement('div');
  overlay.className = 'nx22-overlay';

  overlay.innerHTML = `
    <form class="nx22-dialog">
      <h2>Цитировать публикацию</h2>
      <p>
        Добавь свой комментарий.
        Автор и ID исходной публикации
        сохранятся в тексте.
      </p>

      <textarea
        maxlength="350"
        required
        placeholder="Твой комментарий"></textarea>

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

  const close = () => overlay.remove();

  overlay.querySelector('[data-close]').onclick = close;

  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });

  overlay.querySelector('form').onsubmit = async event => {
    event.preventDefault();

    if (busy) return;

    const comment = overlay.querySelector('textarea')
      .value.trim();

    if (!comment) return;

    busy = true;

    const button = overlay.querySelector(
      '[type="submit"]'
    );

    button.disabled = true;

    try {
      await createRepost(id, comment);
      close();
      notice('Цитата опубликована');
    } catch (error) {
      notice(error.message || 'Ошибка публикации');
    } finally {
      busy = false;
      button.disabled = false;
    }
  };

  overlay.querySelector('textarea').focus();
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-nx22]');

  if (!button) return;

  event.preventDefault();
  event.stopPropagation();

  const id = button.dataset.id;

  if (button.dataset.nx22 === 'quote') {
    quoteDialog(id);
    return;
  }

  if (busy) return;

  if (!confirm('Опубликовать репост у себя в профиле?')) {
    return;
  }

  busy = true;
  button.disabled = true;

  try {
    await createRepost(id, '');
    notice('Репост опубликован');
  } catch (error) {
    notice(error.message || 'Ошибка репоста');
  } finally {
    busy = false;
    button.disabled = false;
  }
});

const observer = new MutationObserver(() => {
  if (
    document.getElementById('feedList') ||
    document.getElementById('profilePosts')
  ) {
    addPostButtons();
  }
});

observer.observe(document.body, {
  subtree: true,
  childList: true
});

addPostButtons();
