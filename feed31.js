
/*
 * NEXORA 3.1
 * Feed Loading & Error Handling
 * Author: @Toolgool
 */

import {
  getApps
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const STYLE = `
.nx31-status {
  padding: 32px 24px;
  margin-bottom: 16px;
  text-align: center;
  border-radius: 20px;
  background: rgba(20, 27, 43, .88);
  border: 1px solid rgba(145, 156, 220, .15);
  animation: nx31Appear .3s ease both;
}

.nx31-status[hidden] {
  display: none !important;
}

.nx31-status h3 {
  margin: 12px 0 8px;
  color: #eef0ff;
  font-size: 19px;
}

.nx31-status p {
  margin: 0;
  color: #a6aec8;
  font-size: 14px;
  line-height: 1.6;
}

.nx31-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  margin: 0 auto;
  border-radius: 16px;
  background: rgba(133, 119, 235, .14);
  color: #b9afff;
  font-size: 24px;
  font-weight: 700;
}

.nx31-spinner {
  width: 36px;
  height: 36px;
  margin: 0 auto;
  border: 3px solid rgba(137, 125, 230, .18);
  border-top-color: #9789ff;
  border-radius: 50%;
  animation: nx31Spin .8s linear infinite;
}

.nx31-retry {
  margin-top: 18px;
  padding: 12px 24px;
  border: 0;
  border-radius: 12px;
  background: linear-gradient(120deg,#647fe1,#8973d4);
  color: white;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: transform .2s, filter .2s;
}

.nx31-retry:hover {
  transform: translateY(-2px);
  filter: brightness(1.1);
}

.nx31-warning {
  padding: 15px 18px;
  margin-bottom: 14px;
  border-radius: 15px;
  background: rgba(214, 147, 58, .07);
  border: 1px solid rgba(238, 180, 89, .25);
  color: #f0c68d;
  font-size: 14px;
}

.nx31-warning[hidden] {
  display: none !important;
}

.nx31-warning button {
  display: block;
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px solid rgba(238, 180, 89, .3);
  border-radius: 9px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

@keyframes nx31Spin {
  to { transform: rotate(360deg); }
}

@keyframes nx31Appear {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .nx31-spinner,
  .nx31-status {
    animation: none;
  }
}
`;

const style = document.createElement("style");
style.textContent = STYLE;
document.head.appendChild(style);

const feedList = document.getElementById("feedList");

if (!feedList) {
  console.error(
    "[NEXORA 3.1] feedList not found"
  );
} else {
  const apps = getApps();

  if (!apps.length) {
    console.error(
      "[NEXORA 3.1] Firebase app not initialized"
    );
  } else {
    const auth = getAuth(apps[0]);
    const db = getFirestore(apps[0]);

    let stopPosts = null;
    let stopLikes = null;
    let generation = 0;
    let currentUid = null;
    let postsState = "idle";
    let likesState = "idle";

    const status = document.createElement("div");
    status.className = "nx31-status";
    status.hidden = true;

    const warning = document.createElement("div");
    warning.className = "nx31-warning";
    warning.hidden = true;

    feedList.before(status, warning);

    function escapeHTML(value) {
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

    function errorMessage(error) {
      if (
        error?.code === "permission-denied"
      ) {
        return "Firebase запретил доступ к данным. Проверьте правила Firestore.";
      }

      if (
        error?.code === "unavailable"
      ) {
        return "Сервис временно недоступен. Попробуйте позже.";
      }

      if (
        error?.code === "failed-precondition"
      ) {
        return "Для запроса требуется индекс Firestore.";
      }

      return error?.message ||
        "Неизвестная ошибка загрузки.";
    }

    function showStatus(
      type,
      title,
      description
    ) {
      status.hidden = false;

      const icon = type === "loading"
        ? '<div class="nx31-spinner"></div>'
        : '<div class="nx31-icon">!</div>';

      status.innerHTML = `
        ${icon}
        <h3>${escapeHTML(title)}</h3>
        <p>${escapeHTML(description)}</p>
        ${
          type === "error"
            ? `
              <button
                type="button"
                class="nx31-retry"
                data-nx31-retry="all"
              >
                ↻ Повторить
              </button>
            `
            : ""
        }
      `;
    }

    function hideStatus() {
      status.hidden = true;
      status.innerHTML = "";
    }

    function showWarning(message) {
      warning.hidden = false;
      warning.innerHTML = `
        <strong>Не удалось загрузить реакции</strong>
        <div style="margin-top:6px">
          ${escapeHTML(message)}
        </div>
        <button
          type="button"
          data-nx31-retry="all"
        >
          ↻ Повторить
        </button>
      `;
    }

    function hideWarning() {
      warning.hidden = true;
      warning.innerHTML = "";
    }

    function setFeedVisible(visible) {
      feedList.hidden = !visible;
    }

    function stopListeners() {
      generation++;

      stopPosts?.();
      stopLikes?.();

      stopPosts = null;
      stopLikes = null;
    }

    function loadFeed() {
      if (!currentUid) return;

      stopListeners();

      const uid = currentUid;
      const token = generation;

      postsState = "loading";
      likesState = "loading";

      hideWarning();

      showStatus(
        "loading",
        "Загружаем публикации",
        "Подключаемся к NEXORA..."
      );

      setFeedVisible(false);

      const isCurrent = () =>
        token === generation &&
        auth.currentUser?.uid === uid;

      try {
        stopPosts = onSnapshot(
          query(
            collection(db, "posts"),
            orderBy("createdAt", "desc"),
            limit(60)
          ),
          snapshot => {
            if (!isCurrent()) return;

            postsState = "success";

            hideStatus();
            setFeedVisible(true);

            if (snapshot.empty) {
              console.info(
                "[NEXORA] Feed is empty"
              );
            }
          },
          error => {
            if (!isCurrent()) return;

            postsState = "error";

            console.error(
              "[NEXORA] Feed error:",
              error
            );

            showStatus(
              "error",
              "Не удалось загрузить ленту",
              errorMessage(error)
            );

            setFeedVisible(false);
          }
        );

        stopLikes = onSnapshot(
          collection(
            db,
            "users",
            uid,
            "likes"
          ),
          () => {
            if (!isCurrent()) return;

            likesState = "success";
            hideWarning();
          },
          error => {
            if (!isCurrent()) return;

            likesState = "error";

            console.error(
              "[NEXORA] Likes error:",
              error
            );

            showWarning(
              errorMessage(error)
            );
          }
        );
      } catch (error) {
        if (!isCurrent()) return;

        postsState = "error";

        showStatus(
          "error",
          "Ошибка подключения",
          errorMessage(error)
        );

        setFeedVisible(false);
      }
    }

    document.addEventListener(
      "click",
      event => {
        const button = event.target.closest(
          "[data-nx31-retry]"
        );

        if (!button) return;

        event.preventDefault();
        event.stopPropagation();

        loadFeed();
      }
    );

    onAuthStateChanged(
      auth,
      user => {
        stopListeners();

        currentUid = user?.uid || null;

        if (!user) {
          postsState = "idle";
          likesState = "idle";

          hideStatus();
          hideWarning();
          setFeedVisible(true);
          return;
        }

        loadFeed();
      },
      error => {
        console.error(
          "[NEXORA] Auth state error:",
          error
        );

        showStatus(
          "error",
          "Ошибка авторизации",
          errorMessage(error)
        );

        setFeedVisible(false);
      }
    );

    console.info(
      "[NEXORA] Feed 3.1 initialized"
    );
  }
}
