
import {
  initializeApp,
  getApps
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import {
  SOCIAL,
  TRUSTED_HOSTS
} from "./config.js";

/* =========================================
   NEXORA 3.0
   CORE APPLICATION
========================================= */

const firebaseConfig = {
  apiKey: "AIzaSyD9prfvOQGMeniL3U8WD2HeeZ6NNArY8J8",
  authDomain: "toolchat-bfac8.firebaseapp.com",
  projectId: "toolchat-bfac8",
  storageBucket: "toolchat-bfac8.firebasestorage.app",
  messagingSenderId: "52396840735",
  appId: "1:52396840735:web:a608b9c037c8481f2dc22a",
  measurementId: "G-WSR0SZ40M7"
};

const OWNER_UID = "ElpAtxZIBCZVsLBcLzgdIsr8T1w2";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);

const BADGES = {
  1: "Подтверждённый пользователь NEXORA",
  2: "Официальный подтверждённый бренд",
  3: "Создатель платформы NEXORA",
  4: "Участник команды NEXORA",
  5: "Спонсор NEXORA"
};

const LIMITS = {
  post: 1000,
  comment: 300,
  bio: 160,
  name: 20,
  users: 100,
  posts: 60,
  comments: 30
};

let me = null;
let myProfile = null;
let viewUid = null;

let users = {};
let posts = [];
let likes = {};

let currentPage = "feed";
let authMode = "login";

let profileToken = 0;
let authToken = 0;

let unsubPosts = null;
let unsubLikes = null;
let unsubFollowers = null;
let unsubFollowing = null;

let toastTimer = null;
let pendingURL = null;

// Client-side friction only. Server-side abuse prevention is still required.
const COOLDOWN = {post:12000, comment:4000};
const lastSent = {post:0, comment:0};
function waitForAction(kind) {
  const remaining = COOLDOWN[kind] - (Date.now() - lastSent[kind]);
  if (remaining > 0) {
    toast("Подожди " + Math.ceil(remaining / 1000) + " сек. перед следующей отправкой.");
    return false;
  }
  return true;
}

let posting = false;
let authBusy = false;
let registrationProfile = null;
const commentThreads = new Map();

const pendingActions = new Set();

/* =========================================
   UTILITIES
========================================= */

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]
  );
}

function toast(message) {
  const element = $("toast");
  if (!element) return;

  clearTimeout(toastTimer);

  element.textContent = String(message || "");
  element.classList.remove("hidden");

  toastTimer = setTimeout(() => {
    element.classList.add("hidden");
  }, 4000);
}

function friendlyError(error) {
  const code = error?.code || "";

  const messages = {
    "auth/invalid-email":
      "Неверный адрес электронной почты.",
    "auth/email-already-in-use":
      "Этот email уже зарегистрирован.",
    "auth/weak-password":
      "Пароль слишком простой.",
    "auth/invalid-credential":
      "Неверная почта или пароль.",
    "auth/too-many-requests":
      "Слишком много попыток. Попробуй позже.",
    "auth/network-request-failed":
      "Ошибка сети. Проверь подключение.",
    "permission-denied":
      "Недостаточно прав. Проверь правила Firebase.",
    "unavailable":
      "Сервис временно недоступен."
  };

  return messages[code] ||
    error?.message ||
    "Произошла неизвестная ошибка.";
}

function validURL(raw) {
  try {
    const url = new URL(raw);

    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function imageURL(raw) {
  if (!raw) return "";

  if (!validURL(raw)) {
    throw Error(
      "Изображение должно иметь HTTPS-ссылку."
    );
  }

  const url = new URL(raw);

  if (!/\.(png|jpe?g|webp)$/i.test(url.pathname)) {
    throw Error(
      "Поддерживаются прямые ссылки PNG, JPG и WebP."
    );
  }

  return url.href;
}

function safeStoredImage(raw) {
  if (!raw || !validURL(raw)) return "";

  const url = new URL(raw);

  return /\.(png|jpe?g|webp)$/i.test(url.pathname)
    ? url.href
    : "";
}

function safeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function validUsername(value) {
  return /^[a-z0-9_]{3,20}$/.test(value);
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) {
    return "Только что";
  }

  return timestamp.toDate().toLocaleString(
    "ru-RU",
    {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }
  );
}

function isTrusted(raw) {
  try {
    const url = new URL(raw);

    return (
      url.protocol === "https:" &&
      TRUSTED_HOSTS.some(host =>
        url.hostname === host ||
        url.hostname.endsWith("." + host)
      )
    );
  } catch {
    return false;
  }
}

function externalLink(raw, label) {
  if (!validURL(raw)) return "";

  return `
    <a
      href="${esc(raw)}"
      target="_blank"
      rel="noopener noreferrer"
      data-external
    >${esc(label)}</a>
  `;
}

function linkify(value) {
  const text = String(value || "");
  const regex = /https?:\/\/[^\s<>"']+/g;

  let html = "";
  let start = 0;

  for (const match of text.matchAll(regex)) {
    html += esc(text.slice(start, match.index));

    const original = match[0];
    const clean = original.replace(/[.,!?;:)]+$/, "");

    html += validURL(clean)
      ? externalLink(clean, clean)
      : esc(clean);

    html += esc(original.slice(clean.length));

    start = match.index + original.length;
  }

  html += esc(text.slice(start));

  return html;
}

function runOnce(key, operation) {
  if (pendingActions.has(key)) {
    return Promise.resolve();
  }

  pendingActions.add(key);

  return Promise.resolve()
    .then(operation)
    .finally(() => pendingActions.delete(key));
}

/* =========================================
   USER DISPLAY
========================================= */

function displayName(uid) {
  return users[uid]?.name || "Пользователь";
}

function avatar(uid, big = false) {
  const user = users[uid] || {};
  const name = user.name || "N";
  const url = safeStoredImage(user.avatarUrl);

  return `
    <div class="avatar ${big ? "large" : ""}">
      ${
        url
          ? `<img
               src="${esc(url)}"
               alt=""
               loading="lazy"
               referrerpolicy="no-referrer"
               onerror="this.remove()"
             >`
          : esc(name.slice(0, 2).toUpperCase())
      }
    </div>
  `;
}

function badgeHTML(uid) {
  const verification = Number(
    users[uid]?.verification || 0
  );

  if (verification < 1 || verification > 5) {
    return "";
  }

  return `
    <button
      type="button"
      class="badgeicon"
      data-badge="${verification}"
      aria-label="${esc(BADGES[verification])}"
      title="${esc(BADGES[verification])}"
    >
      <img
        src="./image/Verified_${verification}.png"
        alt="Верификация"
        onerror="this.parentElement.remove()"
      >
    </button>
  `;
}

function nameHTML(uid) {
  return `
    <span class="namegroup">
      <span class="name">
        ${esc(displayName(uid))}
      </span>
      ${badgeHTML(uid)}
    </span>
  `;
}

function handleHTML(uid) {
  const username = users[uid]?.username;

  return username && validUsername(username)
    ? "@" + username
    : "Участник NEXORA";
}

/* =========================================
   ADMIN ACCESS
========================================= */

function updateOwnerButton(user, profile) {
  const button = $("ownerButton");
  if (!button) return;

  const allowed = Boolean(
    user &&
    profile &&
    user.uid === OWNER_UID &&
    profile.role === "owner"
  );

  button.classList.toggle("hidden", !allowed);
}

/* =========================================
   NAVIGATION
========================================= */

function stopProfile() {
  profileToken++;

  unsubFollowers?.();
  unsubFollowing?.();

  unsubFollowers = null;
  unsubFollowing = null;
}

function setPageVisibility(page) {
  for (const name of [
    "feed",
    "search",
    "profile",
    "settings"
  ]) {
    $(name + "Page")?.classList.toggle(
      "hidden",
      name !== page
    );
  }

  // Дополнительная панель управляется
  // существующим модулем nexora21.js.
  document.querySelectorAll("[data-page]").forEach(
    button => {
      button.classList.toggle(
        "active",
        button.dataset.page === page
      );
    }
  );
}

function showPage(page) {
  if (!me) return;

  currentPage = page;

  setPageVisibility(page);

  if (page === "search") {
    renderSearch();
  }

  if (page === "profile") {
    openProfile(me.uid);
  }

  if (page === "settings") {
    fillSettings();
  }
}

document.querySelectorAll("[data-page]").forEach(
  button => {
    button.addEventListener("click", () => {
      showPage(button.dataset.page);
    });
  }
);

/* =========================================
   AUTHENTICATION
========================================= */

function setAuthMode(mode) {
  authMode = mode;

  const register = mode === "register";

  $("username").classList.toggle(
    "hidden",
    !register
  );

  $("username").required = register;

  $("authTitle").textContent = register
    ? "Создать аккаунт"
    : "С возвращением";

  $("authSubmit").textContent = register
    ? "Зарегистрироваться"
    : "Войти";

  $("authSwitch").textContent = register
    ? "Уже есть аккаунт? Войти"
    : "Создать аккаунт";

  $("password").autocomplete = register
    ? "new-password"
    : "current-password";
}

$("authSwitch").addEventListener("click", () => {
  setAuthMode(
    authMode === "login" ? "register" : "login"
  );
});

$("authForm").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    if (authBusy) return;

    authBusy = true;

    const button = $("authSubmit");
    button.disabled = true;

    try {
      const email = $("email").value.trim();
      const password = $("password").value;

      if (authMode === "register") {
        const name = $("username").value.trim();

        if (
          name.length < 3 ||
          name.length > LIMITS.name
        ) {
          throw Error(
            "Имя должно содержать от 3 до 20 символов."
          );
        }

        // Firebase emits the auth event before createUser resolves. Both paths
        // use the same requested name and an atomic create-if-missing operation.
        registrationProfile = { name, email: email.toLowerCase() };
        const result =
          await createUserWithEmailAndPassword(
            auth,
            email,
            password
          );

        await getOrCreateProfile(result.user, name);
        try {
          await sendEmailVerification(result.user, {url: location.origin + "/"});
          toast("Аккаунт создан! Проверь почту для подтверждения.");
        } catch (mailError) {
          // Account exists: do not retry registration. The gate can resend.
          toast("Аккаунт создан. Отправь письмо на экране подтверждения: " + friendlyError(mailError));
        }
      } else {
        await signInWithEmailAndPassword(
          auth,
          email,
          password
        );
      }
    } catch (error) {
      toast(friendlyError(error));
    } finally {
      registrationProfile = null;
      authBusy = false;
      button.disabled = false;
    }
  }
);

$("logout").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    toast(friendlyError(error));
  }
});

/* =========================================
   AUTH STATE
========================================= */

// Never overwrite an existing (including legacy) profile or assign privileges.
async function getOrCreateProfile(user, preferredName = "Пользователь") {
  const profileRef = doc(db, "users", user.uid);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(profileRef);
    if (snapshot.exists()) return snapshot.data();
    const profile = {
      name: preferredName,
      bio: "Привет! Я в NEXORA.",
      createdAt: serverTimestamp()
    };
    transaction.set(profileRef, profile);
    return profile;
  });
}

async function applyAuthState(user) {
  const token = ++authToken;
  closeAllComments();

  unsubPosts?.();
  unsubLikes?.();
  stopProfile();

  unsubPosts = null;
  unsubLikes = null;

  const verified = Boolean(user?.emailVerified);
  me = verified ? user : null;
  myProfile = null;

  users = {};
  posts = [];
  likes = {};

  updateOwnerButton(null, null);

  $("authPage").classList.toggle(
    "hidden",
    Boolean(user)
  );

  $("app").classList.toggle(
    "hidden",
    !verified
  );

  $("topUser").classList.toggle(
    "hidden",
    !verified
  );

  // Unverified accounts may only complete registration and verify email.
  // Never start feed, notifications, or user queries for them.
  if (!user || !verified) return;

  try {
    const requestedName = registrationProfile &&
      registrationProfile.email === String(user.email || "").toLowerCase()
        ? registrationProfile.name : "Пользователь";
    const profile = await getOrCreateProfile(user, requestedName);

    if (token !== authToken) return;
    myProfile = profile;

    $("topName").textContent =
      myProfile.name || "Пользователь";

    updateOwnerButton(user, myProfile);

    try {
      await loadUsers();
    } catch (error) {
      if (token !== authToken) return;
      console.error("[NEXORA] Users:", error);
      users = { [user.uid]: myProfile };
      toast("Пользователи временно недоступны: " + friendlyError(error));
    }

    if (token !== authToken) return;

    listenFeed();
    showPage("feed");
  } catch (error) {
    if (token === authToken) {
      toast(
        "Ошибка загрузки: " + friendlyError(error)
      );
    }
  }
}

onAuthStateChanged(auth, applyAuthState);
window.addEventListener("nexora:email-verified", event => {
  const user = auth.currentUser;
  if (user && user.emailVerified && event.detail?.uid === user.uid) {
    return applyAuthState(user);
  }
});

/* =========================================
   USERS
========================================= */

async function loadUsers(token = authToken) {
  const snapshot = await getDocs(
    query(
      collection(db, "users"),
      limit(LIMITS.users)
    )
  );

  if (token !== authToken) return;
  const result = {};

  snapshot.forEach(documentSnapshot => {
    result[documentSnapshot.id] =
      documentSnapshot.data();
  });

  if (me && myProfile) {
    result[me.uid] = myProfile;
  }

  users = result;
}

async function ensureUser(uid) {
  if (users[uid]) {
    return users[uid];
  }

  const snapshot = await getDoc(
    doc(db, "users", uid)
  );

  if (!snapshot.exists()) {
    throw Error("Пользователь не найден.");
  }

  users[uid] = snapshot.data();

  return users[uid];
}

/* =========================================
   POST CREATION
========================================= */

$("postInput").addEventListener("input", () => {
  $("postCount").textContent =
    $("postInput").value.length;
});

$("postForm").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    if (!me || posting) return;
    if (!waitForAction("post")) return;

    const text = $("postInput").value.trim();

    if (!text) {
      toast("Напиши текст публикации.");
      return;
    }

    if (text.length > LIMITS.post) {
      toast("Максимум 1000 символов.");
      return;
    }

    posting = true;

    const button = event.currentTarget.querySelector(
      'button[type="submit"]'
    );

    button.disabled = true;

    try {
      const imageUrl = imageURL(
        $("postImage").value.trim()
      );

      const data = {
        uid: me.uid,
        text,
        createdAt: serverTimestamp()
      };

      if (imageUrl) {
        data.imageUrl = imageUrl;
      }

      await addDoc(
        collection(db, "posts"),
        data
      );

      lastSent.post = Date.now();
      $("postInput").value = "";
      $("postImage").value = "";
      $("postCount").textContent = "0";

      toast("Публикация создана.");
    } catch (error) {
      toast(friendlyError(error));
    } finally {
      posting = false;
      button.disabled = false;
    }
  }
);

/* =========================================
   FEED LISTENERS
========================================= */


let feedStatus = "idle";
let feedError = "";
let likesError = "";
let feedGeneration = 0;

function listenFeed() {
  unsubPosts?.();
  unsubLikes?.();
  unsubPosts = null;
  unsubLikes = null;
  if (!me) return;

  const uid = me.uid;
  const generation = ++feedGeneration;
  feedStatus = "loading";
  feedError = "";
  likesError = "";
  renderFeed();

  const active = () =>
    generation === feedGeneration &&
    auth.currentUser?.uid === uid;

  try {
    unsubPosts = onSnapshot(
      query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(LIMITS.posts)),
      snapshot => {
        if (!active()) return;
        posts = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
        feedStatus = "ready";
        feedError = "";
        renderFeed();
        if (currentPage === "profile") renderProfilePosts();
      },
      error => {
        if (!active()) return;
        console.error("[NEXORA] Feed:", error);
        feedStatus = "error";
        feedError = friendlyError(error);
        renderFeed();
      }
    );

    unsubLikes = onSnapshot(
      collection(db, "users", uid, "likes"),
      snapshot => {
        if (!active()) return;
        likes = {};
        likesError = "";
        snapshot.forEach(item => { likes[item.id] = true; });
        if (feedStatus === "ready") renderFeed();
        if (currentPage === "profile") renderProfilePosts();
      },
      error => {
        if (!active()) return;
        console.error("[NEXORA] Likes:", error);
        likesError = friendlyError(error);
        if (feedStatus === "ready") renderFeed();
      }
    );
  } catch (error) {
    if (!active()) return;
    feedStatus = "error";
    feedError = friendlyError(error);
    renderFeed();
  }
}

/* =========================================
   POST RENDERING
========================================= */

function postHTML(post) {
  const mine = post.uid === me?.uid;
  const liked = Boolean(likes[post.id]);

  const image = safeStoredImage(
    post.imageUrl
  );

  return `
    <article
      class="glass panel"
      data-post="${esc(post.id)}"
    >

      <div class="userrow">

        ${avatar(post.uid)}

        <div style="flex:1;min-width:0">

          ${nameHTML(post.uid)}

          <div class="muted">
            ${esc(formatDate(post.createdAt))}
          </div>

        </div>

        ${
          mine
            ? `
              <button
                class="quiet"
                type="button"
                data-action="delete-post"
                data-id="${esc(post.id)}"
              >
                Удалить
              </button>
            `
            : ""
        }

      </div>

      <div class="posttext">
        ${linkify(post.text || "")}
      </div>

      ${
        image
          ? `
            <img
              class="postimage"
              src="${esc(image)}"
              alt="Изображение публикации"
              loading="lazy"
              referrerpolicy="no-referrer"
              onerror="this.hidden=true"
            >
          `
          : ""
      }

      <div class="actions">

        <button
          type="button"
          class="${liked ? "liked" : ""}"
          data-action="like"
          data-id="${esc(post.id)}"
        >
          ${liked ? "♥" : "♡"} Нравится
        </button>

        <button
          type="button"
          data-action="comments"
          data-id="${esc(post.id)}"
        >
          ☏ Комментарии
        </button>

        <button
          type="button"
          data-action="author"
          data-id="${esc(post.uid)}"
        >
          Профиль
        </button>

      </div>

      <div
        data-comments-for="${esc(post.id)}"
        class="hidden"
        style="margin-top:15px"
      ></div>

    </article>
  `;
}

function renderFeed() {
  const container = $("feedList");
  if (!container) return;

  if (feedStatus !== "ready") {
    for (const box of container.querySelectorAll("[data-comments-for]")) {
      if (commentThreads.has(box)) closeComments(box);
    }
  }

  if (feedStatus === "loading") {
    container.innerHTML = '<div class="glass panel empty" role="status"><strong>Загружаем публикации...</strong><p class="muted">Подключаемся к NEXORA.</p></div>';
    return;
  }

  if (feedStatus === "error") {
    container.replaceChildren();
    const card = document.createElement("div");
    card.className = "glass panel empty";
    const title = document.createElement("h3");
    title.textContent = "Не удалось загрузить ленту";
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = feedError || "Ошибка соединения с сервером.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "primary";
    retry.textContent = "↻ Повторить";
    retry.addEventListener("click", () => { if (me) listenFeed(); });
    card.append(title, message, retry);
    container.append(card);
    return;
  }

  if (feedStatus !== "ready") {
    container.replaceChildren();
    return;
  }

  renderPostList(container, posts.length
    ? posts.map(postHTML).join("")
    : '<div class="glass panel empty"><strong>Публикаций пока нет</strong><p class="muted">Стань первым, кто поделится чем-нибудь в NEXORA.</p></div>');

  if (likesError) {
    const warning = document.createElement("div");
    warning.className = "glass panel";
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = "Не удалось загрузить реакции: " + likesError;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "quiet";
    retry.textContent = "Повторить загрузку";
    retry.addEventListener("click", () => { if (me) listenFeed(); });
    warning.append(message, retry);
    container.prepend(warning);
  }
}

/* =========================================
   POST ACTIONS
========================================= */

document.addEventListener(
  "click",
  async event => {
    const badge = event.target.closest(
      "[data-badge]"
    );

    if (badge) {
      event.preventDefault();
      event.stopPropagation();

      const type = Number(
        badge.dataset.badge
      );

      toast(
        BADGES[type] ||
        "Подтверждённый аккаунт"
      );

      return;
    }

    const link = event.target.closest(
      "a[data-external]"
    );

    if (link && !isTrusted(link.href)) {
      event.preventDefault();

      pendingURL = link.href;

      $("linkTarget").textContent =
        new URL(link.href).hostname;

      $("linkDialog").classList.remove(
        "hidden"
      );

      return;
    }

    const button = event.target.closest(
      "[data-action]"
    );

    if (!button || !me) return;

    const action = button.dataset.action;
    const id = button.dataset.id;

    try {
      if (action === "like") {
        await runOnce(
          "like:" + id,
          async () => {
            const ref = doc(
              db,
              "users",
              me.uid,
              "likes",
              id
            );

            const snapshot = await getDoc(ref);

            if (snapshot.exists()) {
              await deleteDoc(ref);
            } else {
              await setDoc(ref, {
                createdAt: serverTimestamp()
              });
            }
          }
        );
      }

      if (action === "delete-post") {
        await runOnce(
          "delete:" + id,
          async () => {
            const post = posts.find(
              item => item.id === id
            );

            if (!post || post.uid !== me.uid) {
              throw Error(
                "Можно удалить только свою публикацию."
              );
            }

            if (!confirm("Удалить публикацию?")) {
              return;
            }

            await deleteDoc(
              doc(db, "posts", id)
            );

            toast("Публикация удалена.");
          }
        );
      }

      if (action === "comments") {
        await openComments(id, button.closest("article[data-post]")
          ?.querySelector("[data-comments-for]"));
      }

      if (action === "author") {
        await openProfile(id);
      }

      if (action === "follow") {
        await toggleFollow(id);
      }
    } catch (error) {
      toast(friendlyError(error));
    }
  }
);

/* =========================================
   EXTERNAL LINKS
========================================= */

$("cancelLink").addEventListener(
  "click",
  () => {
    $("linkDialog").classList.add(
      "hidden"
    );

    pendingURL = null;
  }
);

$("confirmLink").addEventListener(
  "click",
  () => {
    if (
      pendingURL &&
      validURL(pendingURL)
    ) {
      window.open(
        pendingURL,
        "_blank",
        "noopener,noreferrer"
      );
    }

    $("linkDialog").classList.add(
      "hidden"
    );

    pendingURL = null;
  }
);

$("linkDialog").addEventListener(
  "click",
  event => {
    if (event.target === $("linkDialog")) {
      $("cancelLink").click();
    }
  }
);

/* =========================================
   COMMENTS
========================================= */

function closeComments(box) {
  const state = commentThreads.get(box);
  commentThreads.delete(box);
  state?.unsubscribe?.();
  box.classList.add("hidden");
}

function closeAllComments() {
  for (const box of commentThreads.keys()) closeComments(box);
}

// Retain each open thread's actual form and listener during a feed/like update.
// Keeping the nodes also preserves an in-progress submission and its draft.
function renderPostList(container, html) {
  const open = [...container.querySelectorAll("[data-comments-for]")]
    .filter(box => commentThreads.has(box));
  const focused = document.activeElement;
  const selection = focused && typeof focused.selectionStart === "number"
    ? [focused.selectionStart, focused.selectionEnd] : null;
  container.innerHTML = html;
  for (const box of open) {
    const placeholder = [...container.querySelectorAll("[data-comments-for]")]
      .find(item => item.dataset.commentsFor === box.dataset.commentsFor);
    if (placeholder) placeholder.replaceWith(box);
    else closeComments(box);
  }
  if (focused?.isConnected && open.some(box => box.contains(focused))) {
    focused.focus({preventScroll:true});
    if (selection) focused.setSelectionRange(...selection);
  }
}

async function openComments(postId, box) {
  if (!box || !me) return;
  if (commentThreads.has(box)) {
    closeComments(box);
    return;
  }

  const uid = me.uid;
  const token = authToken;
  const state = {unsubscribe:null, sending:false};
  const active = () => commentThreads.get(box) === state &&
    authToken === token && me?.uid === uid;
  commentThreads.set(box, state);
  box.classList.remove("hidden");
  box.replaceChildren();

  const list = document.createElement("div");
  list.setAttribute("aria-live", "polite");
  list.textContent = "Загрузка комментариев...";
  const form = document.createElement("form");
  form.className = "stack";
  form.innerHTML = `
    <input maxlength="${LIMITS.comment}" required
      placeholder="Написать комментарий..." aria-label="Текст комментария">
    <button type="submit" class="primary">Отправить</button>`;
  box.append(list, form);
  const input = form.querySelector("input");
  const button = form.querySelector("button");

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!active() || state.sending) return;
    const draft = input.value;
    const text = draft.trim();
    if (!text || text.length > LIMITS.comment || !waitForAction("comment")) return;
    state.sending = true;
    button.disabled = true;
    try {
      await addDoc(collection(db, "posts", postId, "comments"), {
        uid, text, createdAt:serverTimestamp()
      });
      if (!active()) return;
      lastSent.comment = Date.now();
      if (input.value === draft) input.value = "";
    } catch (error) {
      if (active()) toast(friendlyError(error));
    } finally {
      state.sending = false;
      button.disabled = false;
    }
  });

  try {
    state.unsubscribe = onSnapshot(
      query(collection(db, "posts", postId, "comments"),
        orderBy("createdAt", "desc"), limit(LIMITS.comments)),
      snapshot => {
        if (!active()) return;
        list.innerHTML = snapshot.docs.map(item => {
          const comment = item.data();
          return `<div class="comment">${nameHTML(comment.uid)}
            <p>${linkify(comment.text || "")}</p></div>`;
        }).join("") || '<p class="muted">Комментариев пока нет.</p>';
      },
      error => {
        if (active()) list.textContent = "Ошибка: " + friendlyError(error);
      }
    );
  } catch (error) {
    list.textContent = "Ошибка: " + friendlyError(error);
  }
}

/* =========================================
   SEARCH
========================================= */

$("searchInput").addEventListener(
  "input",
  renderSearch
);

function renderSearch() {
  const search = $("searchInput")
    .value
    .toLowerCase()
    .trim()
    .replace(/^@/, "");

  const results = Object.entries(users)
    .filter(([uid, user]) => {
      if (!search) return true;

      const name = String(
        user.name || ""
      ).toLowerCase();

      const username = String(
        user.username || ""
      ).toLowerCase();

      return (
        name.includes(search) ||
        username.includes(search)
      );
    })
    .slice(0, 30);

  $("searchResults").innerHTML =
    results.map(([uid, user]) => `
      <div class="glass panel userrow">

        ${avatar(uid)}

        <div style="flex:1;min-width:0">

          ${nameHTML(uid)}

          <div class="muted">
            ${esc(handleHTML(uid))}
          </div>

          <div class="muted">
            ${esc(user.bio || "")}
          </div>

        </div>

        <button
          type="button"
          class="quiet"
          data-action="author"
          data-id="${esc(uid)}"
        >
          Открыть
        </button>

      </div>
    `).join("") || `
      <div class="glass panel empty">
        Пользователи не найдены.
      </div>
    `;
}

/* =========================================
   PROFILE
========================================= */

async function openProfile(uid) {
  if (!me || !uid) return;

  stopProfile();

  const token = profileToken;

  viewUid = uid;
  currentPage = "profile";

  setPageVisibility("profile");

  $("profileName").textContent = "Загрузка...";
  $("profileControls").innerHTML = "";
  renderPostList($("profilePosts"), "");

  try {
    const user = await ensureUser(uid);

    if (token !== profileToken) return;

    $("profileName").innerHTML = nameHTML(uid);

    $("profileHandle").textContent =
      handleHTML(uid);

    // В index.html #profileAvatar уже
    // является контейнером .avatar.
    const avatarElement = $("profileAvatar");

    const image = safeStoredImage(
      user.avatarUrl
    );

    avatarElement.innerHTML = image
      ? `
        <img
          src="${esc(image)}"
          alt=""
          referrerpolicy="no-referrer"
          onerror="this.remove()"
        >
      `
      : esc(
          (user.name || "N")
            .slice(0, 2)
            .toUpperCase()
        );

    const banner = safeStoredImage(
      user.bannerUrl
    );

    $("profileBanner").style.backgroundImage =
      banner
        ? `url("${banner.replace(/"/g, "%22")}")`
        : "";

    $("profileBio").textContent =
      user.bio || "Без описания";

    $("profileLinks").innerHTML =
      user.websiteUrl
        ? externalLink(
            user.websiteUrl,
            "🌐 Сайт пользователя"
          )
        : "";

    if (uid === me.uid) {
      $("profileControls").innerHTML = `
        <button
          type="button"
          class="quiet"
          id="editProfile"
        >
          Редактировать профиль
        </button>
      `;

      $("editProfile").onclick = () => {
        showPage("settings");
      };
    } else {
      $("profileControls").innerHTML = `
        <button
          type="button"
          class="primary"
          id="followButton"
        >
          Подписаться
        </button>

        <a
          class="quiet"
          href="./chats.html?user=${encodeURIComponent(uid)}"
        >
          ✉ Написать
        </a>
      `;

      $("followButton").onclick = () => {
        toggleFollow(uid).catch(error => {
          toast(friendlyError(error));
        });
      };
    }

    unsubFollowers = onSnapshot(
      collection(
        db,
        "users",
        uid,
        "followers"
      ),
      snapshot => {
        if (token !== profileToken) return;

        $("followersCount").textContent =
          snapshot.size;

        const button = $("followButton");

        if (button) {
          const following = snapshot.docs.some(
            item => item.id === me.uid
          );

          button.textContent = following
            ? "Отписаться"
            : "Подписаться";
        }
      },
      error => {
        console.warn(
          "Followers:",
          friendlyError(error)
        );
      }
    );

    unsubFollowing = onSnapshot(
      collection(
        db,
        "users",
        uid,
        "following"
      ),
      snapshot => {
        if (token !== profileToken) return;

        $("followingCount").textContent =
          snapshot.size;
      },
      error => {
        console.warn(
          "Following:",
          friendlyError(error)
        );
      }
    );

    renderProfilePosts();
  } catch (error) {
    if (token === profileToken) {
      toast(friendlyError(error));
    }
  }
}

function renderProfilePosts() {
  renderPostList($("profilePosts"),
    posts
      .filter(post => post.uid === viewUid)
      .map(postHTML)
      .join("") || `
        <div class="glass panel empty">
          Публикаций в загруженной ленте нет.
        </div>
      `);
}

/* =========================================
   FOLLOW SYSTEM
========================================= */

async function toggleFollow(uid) {
  if (!me || uid === me.uid) return;

  return runOnce(
    "follow:" + uid,
    async () => {
      const followingRef = doc(
        db,
        "users",
        me.uid,
        "following",
        uid
      );

      const followerRef = doc(
        db,
        "users",
        uid,
        "followers",
        me.uid
      );

      await runTransaction(
        db,
        async transaction => {
          const snapshot = await transaction.get(
            followingRef
          );

          if (snapshot.exists()) {
            transaction.delete(followingRef);
            transaction.delete(followerRef);
          } else {
            transaction.set(followingRef, {
              createdAt: serverTimestamp()
            });

            transaction.set(followerRef, {
              createdAt: serverTimestamp()
            });
          }
        }
      );

      toast("Подписки обновлены.");
    }
  );
}

/* =========================================
   SETTINGS
========================================= */

function fillSettings() {
  if (!myProfile) return;

  $("settingsBio").value =
    myProfile.bio || "";

  $("settingsAvatar").value =
    myProfile.avatarUrl || "";

  $("settingsBanner").value =
    myProfile.bannerUrl || "";

  $("settingsWebsite").value =
    myProfile.websiteUrl || "";
}

$("settingsForm").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    if (!me) return;

    const button = event.currentTarget.querySelector(
      'button[type="submit"]'
    );

    button.disabled = true;

    try {
      const bio = $("settingsBio").value.trim();

      if (bio.length > LIMITS.bio) {
        throw Error(
          "Биография не длиннее 160 символов."
        );
      }

      const avatarUrl = imageURL(
        $("settingsAvatar").value.trim()
      );

      const bannerUrl = imageURL(
        $("settingsBanner").value.trim()
      );

      const websiteUrl = $("settingsWebsite")
        .value
        .trim();

      if (
        websiteUrl &&
        !validURL(websiteUrl)
      ) {
        throw Error(
          "Сайт должен иметь HTTPS-ссылку."
        );
      }

      const changes = {
        bio,
        avatarUrl,
        bannerUrl,
        websiteUrl
      };

      await setDoc(
        doc(db, "users", me.uid),
        changes,
        { merge: true }
      );

      myProfile = {
        ...myProfile,
        ...changes
      };

      users[me.uid] = myProfile;

      toast("Профиль сохранён.");
    } catch (error) {
      toast(friendlyError(error));
    } finally {
      button.disabled = false;
    }
  }
);

/* =========================================
   OFFICIAL LINKS
========================================= */

for (const [id, url] of [
  ["tgChannel", SOCIAL.telegramChannel],
  ["tgBot", SOCIAL.telegramBot]
]) {
  const element = $(id);

  if (!element) continue;

  if (validURL(url)) {
    element.href = url;
    element.dataset.external = "";
  } else {
    element.classList.add("hidden");
  }
}

if (
  !validURL(SOCIAL.telegramChannel) &&
  !validURL(SOCIAL.telegramBot)
) {
  $("socialHint").textContent =
    "Адреса официальных ресурсов " +
    "можно указать в config.js.";
}

/* =========================================
   GLOBAL ERROR HANDLING
========================================= */

window.addEventListener(
  "unhandledrejection",
  event => {
    console.error(
      "[NEXORA] Unhandled rejection:",
      event.reason
    );
  }
);

console.info(
  "[NEXORA] Core 3.1 initialized"
);
