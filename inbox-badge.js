import {getApps,initializeApp} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {getAuth,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {getFirestore,collection,query,where,limit,orderBy,onSnapshot} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const config={apiKey:"AIzaSyD9prfvOQGMeniL3U8WD2HeeZ6NNArY8J8",authDomain:"toolchat-bfac8.firebaseapp.com",projectId:"toolchat-bfac8",appId:"1:52396840735:web:a608b9c037c8481f2dc22a"};
const app=getApps()[0]||initializeApp(config);
const auth=getAuth(app),db=getFirestore(app);
const link=document.querySelector('[data-nx-inbox-link]');
const badge=document.getElementById("nxInboxBadge");
const hint=document.getElementById("nxInboxHint");
let stopChats=null,stops=new Map(),counts=new Map(),session=0;

function render(){
 const total=[...counts.values()].filter(Boolean).length;
 if(!badge)return;
 if(badge.textContent===(total>99?"99+":String(total))&&badge.hidden===!total)return;
 badge.hidden=!total;
 badge.textContent=total>99?"99+":String(total);
 badge.setAttribute("aria-label",total+" диалогов с непрочитанными сообщениями");
 if(hint)hint.textContent=total?total+" непрочитанных диалогов":"Все сообщения прочитаны";
 if(link)link.title=total?total+" диалогов с непрочитанными сообщениями":"Перейти к сообщениям";
}
function cleanup(){
 stopChats?.();stopChats=null;
 for(const stop of stops.values())stop();
 stops.clear();counts.clear();render();
}
onAuthStateChanged(auth,user=>{
 const token=++session;cleanup();
 if(!user?.emailVerified)return;
 stopChats=onSnapshot(query(collection(db,"chats"),where("participants","array-contains",user.uid),limit(60)),snapshot=>{
  if(token!==session)return;
  const current=new Set(snapshot.docs.map(d=>d.id));
  for(const [id,stop] of stops){
   if(!current.has(id)){stop();stops.delete(id);counts.delete(id)}
  }
  for(const chat of snapshot.docs){
   if(stops.has(chat.id))continue;
   const peer=chat.data().participants?.find(id=>id!==user.uid);
   if(!peer)continue;
   const id=chat.id;
   const stop=onSnapshot(query(collection(db,"chats",id,"messages"),orderBy("createdAt","desc"),limit(100)),messages=>{
    if(token!==session||!stops.has(id))return;
    counts.set(id,messages.docs.some(d=>d.data().senderId===peer&&!d.data().readAt));
    render();
   },error=>console.warn("Inbox badge:",error.message));
   stops.set(id,stop);
  }
  render();
 },error=>console.warn("Inbox list:",error.message));
});
