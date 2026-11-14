import {
  getAuth, onAuthStateChanged, sendEmailVerification, reload, signOut, getIdToken
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {getApps, initializeApp} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

const firebaseConfig = {
  apiKey:"AIzaSyD9prfvOQGMeniL3U8WD2HeeZ6NNArY8J8",
  authDomain:"toolchat-bfac8.firebaseapp.com",
  projectId:"toolchat-bfac8",
  storageBucket:"toolchat-bfac8.firebasestorage.app",
  messagingSenderId:"52396840735",
  appId:"1:52396840735:web:a608b9c037c8481f2dc22a"
};
const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);

let currentUser = null;
let busy = false;
let lastUid = null;
let lastCheck = 0;
let lastSend = 0;
let generation = 0;

const style = document.createElement("style");
style.textContent = `
.nx-email-gate[hidden]{display:none!important}
.nx-email-gate{position:fixed;inset:0;z-index:2147483640;display:grid;place-items:center;
  padding:20px;overflow:auto;background:radial-gradient(circle at 25% 10%,#30498055,transparent 52%),
  radial-gradient(circle at 90% 95%,#62449d44,transparent 50%),#080d19;color:#edf3ff;
  font:14px/1.55 system-ui,sans-serif}
.nx-email-card{width:min(460px,100%);padding:clamp(24px,5vw,36px);border-radius:26px;
  border:1px solid #a9bfff38;background:#141e30ed;box-shadow:0 24px 90px #0008;
  backdrop-filter:blur(24px);text-align:center;animation:nxEmailAppear .35s ease both}
.nx-email-symbol{display:grid;place-items:center;margin:0 auto 17px;width:66px;height:66px;
  border-radius:20px;background:linear-gradient(140deg,#6988f9,#a17bee);font-size:29px;
  box-shadow:0 10px 36px #7187f544}
.nx-email-card h1{font-size:clamp(23px,5vw,29px);margin:0 0 10px}
.nx-email-card p{color:#aebcda;margin:0 0 19px;overflow-wrap:anywhere}
.nx-email-address{display:block;color:#fff;font-weight:700;margin:8px 0}
.nx-email-actions{display:grid;gap:10px}
.nx-email-actions button{min-height:45px;padding:11px 15px;border-radius:13px;
  border:1px solid #ffffff2d;background:#27344f;color:#f4f6ff;cursor:pointer;font:inherit;font-weight:650}
.nx-email-actions button:first-child{border:0;background:linear-gradient(115deg,#6585ed,#9274e8)}
.nx-email-actions button:disabled{opacity:.55;cursor:wait}
.nx-email-actions button:last-child{background:transparent;color:#b7c5de;border-color:transparent}
.nx-email-message{min-height:24px;margin-top:15px;color:#b8c7ff;font-size:13px;overflow-wrap:anywhere}
@keyframes nxEmailAppear{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.nx-email-card{animation:none}}
`;
document.head.append(style);

const gate = document.createElement("section");
gate.className = "nx-email-gate";
gate.hidden = true;
gate.setAttribute("role","dialog");
gate.setAttribute("aria-modal","true");
gate.setAttribute("aria-labelledby","nxEmailTitle");
gate.innerHTML = `
  <div class="nx-email-card">
    <div class="nx-email-symbol" aria-hidden="true">✉</div>
    <h1 id="nxEmailTitle">Подтверди электронную почту</h1>
    <p>Чтобы пользоваться NEXORA, перейди по ссылке из письма, отправленного на
      <span class="nx-email-address" id="nxEmailAddress"></span>
    </p>
    <div class="nx-email-actions">
      <button id="nxEmailCheck" type="button">✓ Я подтвердил почту</button>
      <button id="nxEmailSend" type="button">Отправить письмо повторно</button>
      <button id="nxEmailLogout" type="button">Выйти из аккаунта</button>
    </div>
    <div class="nx-email-message" id="nxEmailMessage" role="status" aria-live="polite"></div>
  </div>`;
document.body.append(gate);
const $ = id => document.getElementById(id);
const message = value => { $("nxEmailMessage").textContent = value; };
function errorText(error) {
  const messages = {
    "auth/too-many-requests":"Слишком много запросов. Попробуй позже.",
    "auth/network-request-failed":"Нет соединения с интернетом.",
    "auth/requires-recent-login":"Выйди и войди в аккаунт заново.",
    "auth/unauthorized-continue-uri":"Добавь домен NEXORA в Authorized domains Firebase Authentication.",
    "auth/invalid-continue-uri":"Неверный адрес возврата из письма."
  };
  return messages[error?.code] || error?.message || "Не удалось выполнить действие.";
}
function updateButtons() {
  $("nxEmailCheck").disabled = busy;
  $("nxEmailSend").disabled = busy;
  $("nxEmailLogout").disabled = busy;
}
function render() {
  const user = currentUser;
  gate.hidden = !user || user.emailVerified === true;
  if (!gate.hidden) {
    $("nxEmailAddress").textContent = user.email || "твою почту";
    // Underlying app and links must not be interactive while gated.
    document.querySelectorAll("body > *:not(.nx-email-gate):not(script)").forEach(el => {
      if (el !== gate) el.inert = true;
    });
    $("nxEmailCheck").focus({preventScroll:true});
  } else {
    document.querySelectorAll("body > *:not(.nx-email-gate):not(script)").forEach(el => {
      el.inert = false;
    });
  }
}
async function sendLetter() {
  if (!currentUser || busy) return;
  if (Date.now() - lastSend < 60000) {
    message("Подожди минуту перед повторной отправкой.");
    return;
  }
  busy = true;
  updateButtons();
  message("Отправляем письмо...");
  try {
    await sendEmailVerification(currentUser, {url:location.origin + "/"});
    lastSend = Date.now();
    message("Письмо отправлено. Проверь входящие и папку «Спам».");
  } catch(error) {
    message(errorText(error));
  } finally {
    busy = false;
    updateButtons();
  }
}
async function checkVerification(silent=false) {
  if (!currentUser || busy || currentUser.emailVerified) return;
  const now = Date.now();
  if (silent && now-lastCheck < 15000) return;
  lastCheck = now;
  const user = currentUser;
  const session = generation;
  busy = true;
  updateButtons();
  if (!silent) message("Проверяем подтверждение...");
  try {
    await reload(user);
    if (auth.currentUser?.uid !== user.uid || generation !== session) return;
    if (user.emailVerified) {
      // Firestore Rules use the verified claim in the ID token.
      await getIdToken(user,true);
      message("Почта подтверждена. Добро пожаловать!");
      render();
      window.dispatchEvent(new CustomEvent("nexora:email-verified",{detail:{uid:user.uid}}));
    } else if (!silent) {
      message("Почта ещё не подтверждена. Открой ссылку из письма и повтори проверку.");
    }
  } catch(error) {
    if (!silent) message(errorText(error));
  } finally {
    busy = false;
    updateButtons();
  }
}
$("nxEmailSend").addEventListener("click",sendLetter);
$("nxEmailCheck").addEventListener("click",()=>checkVerification());
$("nxEmailLogout").addEventListener("click",async()=>{
  if (busy) return;
  busy = true;
  updateButtons();
  try { await signOut(auth); } catch(error) { message(errorText(error)); }
  finally { busy = false; updateButtons(); }
});
onAuthStateChanged(auth,user=>{
  currentUser = user;
  generation++;
  if (user?.uid !== lastUid) {
    lastUid = user?.uid || null;
    lastCheck = 0;
    lastSend = 0;
    message("");
  }
  render();
});
document.addEventListener("visibilitychange",()=>{
  if (document.visibilityState === "visible") void checkVerification(true);
});
window.addEventListener("focus",()=>void checkVerification(true));
