
import {
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  reload
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getApps,
  initializeApp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

const firebaseConfig = {
  apiKey: "AIzaSyD9prfvOQGMeniL3U8WD2HeeZ6NNArY8J8",
  authDomain: "toolchat-bfac8.firebaseapp.com",
  projectId: "toolchat-bfac8",
  storageBucket: "toolchat-bfac8.firebasestorage.app",
  messagingSenderId: "52396840735",
  appId: "1:52396840735:web:a608b9c037c8481f2dc22a"
};

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);

let currentUser = null;
let sending = false;
let checking = false;
let lastUid = null;

const style = document.createElement("style");

style.textContent = `
.nx-email-box {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
  width: min(390px, calc(100vw - 40px));
  padding: 20px;
  border: 1px solid rgba(170,190,255,.22);
  border-radius: 20px;
  background: rgba(18,27,46,.96);
  color: #f1f5ff;
  box-shadow: 0 18px 60px rgba(0,0,0,.45);
  backdrop-filter: blur(24px);
  animation: nxEmailIn .35s ease both;
  font: 14px/1.5 system-ui,sans-serif;
}

.nx-email-box[hidden] {
  display: none !important;
}

.nx-email-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.nx-email-head strong {
  font-size: 16px;
}

.nx-email-close {
  border: 0;
  background: transparent;
  color: #aebcda;
  cursor: pointer;
  font-size: 22px;
}

.nx-email-box p {
  color: #aebcda;
  margin: 0 0 15px;
  overflow-wrap: anywhere;
}

.nx-email-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}

.nx-email-actions button {
  padding: 10px 13px;
  border-radius: 11px;
  border: 1px solid rgba(180,200,255,.25);
  background: #293954;
  color: white;
  font: inherit;
  cursor: pointer;
}

.nx-email-actions button:first-child {
  border-color: transparent;
  background: linear-gradient(120deg,#647fea,#937be5);
}

.nx-email-actions button:disabled {
  opacity: .5;
  cursor: not-allowed;
}

.nx-email-message {
  margin-top: 12px;
  font-size: 12px;
  color: #b8c7ff;
}

@keyframes nxEmailIn {
  from {
    opacity: 0;
    transform: translateY(15px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media(max-width:600px) {
  .nx-email-box {
    bottom: 12px;
    right: 12px;
    width: calc(100vw - 24px);
  }
}
`;

document.head.append(style);

const box = document.createElement("aside");

box.className = "nx-email-box";
box.hidden = true;
box.setAttribute("aria-label", "Подтверждение электронной почты");

box.innerHTML = `
  <div class="nx-email-head">
    <strong>✉ Подтверди почту</strong>
    <button class="nx-email-close"
      type="button"
      aria-label="Закрыть">×</button>
  </div>

  <p id="nxEmailDescription"></p>

  <div class="nx-email-actions">
    <button id="nxEmailSend" type="button">
      Отправить письмо
    </button>

    <button id="nxEmailCheck" type="button">
      Проверить
    </button>
  </div>

  <div id="nxEmailMessage"
    class="nx-email-message"
    role="status"
    aria-live="polite"></div>
`;

document.body.append(box);

const $ = id => document.getElementById(id);

function message(text) {
  $("nxEmailMessage").textContent = text;
}

function errorText(error) {
  const messages = {
    "auth/too-many-requests":
      "Слишком много запросов. Попробуй позже.",
    "auth/network-request-failed":
      "Ошибка соединения с интернетом.",
    "auth/requires-recent-login":
      "Для этой операции нужно заново войти в аккаунт."
  };

  return messages[error?.code] ||
    error?.message ||
    "Произошла ошибка.";
}

function updateButtons() {
  $("nxEmailSend").disabled = sending || checking;
  $("nxEmailCheck").disabled = sending || checking;
}

function render() {
  const user = currentUser;

  if (!user || user.emailVerified) {
    box.hidden = true;
    return;
  }

  $("nxEmailDescription").textContent =
    "Адрес " + (user.email || "") +
    " пока не подтверждён. Отправь письмо и перейди по ссылке из него.";

  box.hidden = false;
}

async function sendLetter() {
  if (!currentUser || sending || checking) return;

  sending = true;
  updateButtons();
  message("Отправка письма...");

  try {
    await sendEmailVerification(currentUser, {
      url: location.origin + "/"
    });

    message(
      "Письмо отправлено. Проверь входящие и папку «Спам»."
    );
  } catch (error) {
    message(errorText(error));
  } finally {
    sending = false;
    updateButtons();
  }
}

async function checkVerification() {
  if (!currentUser || checking || sending) return;

  checking = true;
  updateButtons();
  message("Проверяем подтверждение...");

  try {
    await reload(currentUser);

    if (currentUser.emailVerified) {
      message("Почта подтверждена!");
      box.hidden = true;

      window.dispatchEvent(
        new CustomEvent("nexora:email-verified", {
          detail: {
            uid: currentUser.uid
          }
        })
      );
    } else {
      message(
        "Подтверждение пока не найдено. Открой ссылку из письма и повтори проверку."
      );
    }
  } catch (error) {
    message(errorText(error));
  } finally {
    checking = false;
    updateButtons();
  }
}

$("nxEmailSend").addEventListener("click", sendLetter);
$("nxEmailCheck").addEventListener("click", checkVerification);

box.querySelector(".nx-email-close").addEventListener(
  "click",
  () => {
    box.hidden = true;
  }
);

onAuthStateChanged(auth, user => {
  currentUser = user;

  if (user?.uid !== lastUid) {
    lastUid = user?.uid || null;
    message("");
  }

  render();
});

document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    currentUser &&
    !currentUser.emailVerified
  ) {
    // Пользователь сам нажимает «Проверить».
    // Автоматически не отправляем сетевые запросы.
    render();
  }
});
