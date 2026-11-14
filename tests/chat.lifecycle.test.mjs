import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Execute the actual browser module with an in-memory DOM and Firestore adapter.
// These tests exercise asynchronous chat lifecycle behavior; authorization is
// covered separately by the Firestore emulator suite.
const source=readFileSync(new URL("../chats.html",import.meta.url),"utf8")
  .match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/^import[\s\S]*?;\n/gm,"");

function deferred(){
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
}

function harness(){
  const elements=new Map();
  const events=new Map();
  const listeners=[];
  const batches=[];
  const writes=[];
  const store=new Map(["a","b","c"].map(uid=>[
    `users/${uid}`,{name:`User ${uid}`}
  ]));
  const snapshot=(data,id="")=>({id,exists:()=>data!==undefined,data:()=>data});
  const control={holdCommit:null,holdTransaction:null,now:Date.now()};
  function element(id){
    if(!elements.has(id))elements.set(id,{
      value:"",hidden:false,disabled:false,innerHTML:"",textContent:"",
      style:{},dataset:{},scrollHeight:300,scrollTop:0,clientHeight:300,
      classList:{add(){},remove(){}},focus(){},querySelectorAll(){return [];},
      addEventListener(name,callback){this[name]=callback;}
    });
    return elements.get(id);
  }
  const document={
    visibilityState:"visible",getElementById:element,
    addEventListener:(name,callback)=>events.set(name,callback)
  };
  const auth={currentUser:{uid:"a"}};
  let authCallback;
  const context=vm.createContext({
    console,URL,URLSearchParams,document,window:{addEventListener(){}},
    location:{search:""},innerWidth:1000,innerHeight:800,confirm:()=>true,
    Date:class extends Date{static now(){return control.now;}},
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
    initializeApp:()=>({}),getAuth:()=>auth,getFirestore:()=>({}),
    onAuthStateChanged:(_,callback)=>{authCallback=callback;},
    serverTimestamp:()=>({serverTimestamp:true}),
    doc:(parent,...parts)=>({path:parts.length?parts.join("/"):parent.path+"/auto"}),
    collection:(_, ...parts)=>({path:parts.join("/")}),
    query:ref=>ref,where(){},orderBy(){},limit(){},
    getDoc:async ref=>snapshot(store.get(ref.path)),
    getDocs:async()=>({forEach:fn=>{
      for(const uid of ["a","b","c"])fn(snapshot(store.get(`users/${uid}`),uid));
    }}),
    onSnapshot:(ref,callback,error)=>{
      const listener={path:ref.path,callback,error,stopped:false};
      listeners.push(listener);
      return ()=>{listener.stopped=true;};
    },
    setDoc:async(ref,data)=>{writes.push({path:ref.path,data});},
    updateDoc:async(ref,data)=>{writes.push({path:ref.path,data});},
    deleteDoc:async ref=>{writes.push({path:ref.path,deleted:true});},
    runTransaction:async(_,callback)=>{
      if(control.holdTransaction)await control.holdTransaction.promise;
      return callback({
        get:async ref=>snapshot(store.get(ref.path)),
        set:(ref,data)=>{store.set(ref.path,data);writes.push({path:ref.path,data});},
        delete:ref=>{store.delete(ref.path);writes.push({path:ref.path,deleted:true});}
      });
    },
    writeBatch:()=>{
      const batch={operations:[],
        update(ref,data){this.operations.push({path:ref.path,data});},
        set(ref,data){this.operations.push({path:ref.path,data});},
        commit(){return control.holdCommit?.promise||Promise.resolve();}
      };
      batches.push(batch);
      return batch;
    }
  });
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  return {
    run,element,events,listeners,batches,writes,store,control,document,
    login:()=>authCallback({uid:"a"}),
    logout:()=>authCallback(null),
    open:uid=>run(`openChat(${JSON.stringify(uid)})`),
    messages:(cid,items)=>{
      const listener=listeners.findLast(l=>l.path===`chats/${cid}/messages`&&!l.stopped);
      listener.callback({docs:items.map(item=>snapshot(item,item.id))});
    },
    snapshot:(path,data)=>listeners.findLast(l=>l.path===path&&!l.stopped)
      .callback(snapshot(data))
  };
}

test("read receipts in a new chat do not wait for a previous chat's write",async()=>{
  const h=harness();
  await h.login();
  await h.open("b");
  const held=deferred();
  h.control.holdCommit=held;
  h.messages("a_b",[{id:"one",senderId:"b",text:"first"}]);
  assert.equal(h.batches.length,1);
  await h.open("c");
  h.control.holdCommit=null;
  h.messages("a_c",[{id:"two",senderId:"c",text:"second"}]);
  assert.equal(h.batches.length,2);
  assert.equal(h.batches[1].operations[0].path,"chats/a_c/messages/two");
  held.resolve();
});

test("background messages remain unread until the page becomes visible",async()=>{
  const h=harness();
  await h.login();
  await h.open("b");
  h.document.visibilityState="hidden";
  h.messages("a_b",[{id:"one",senderId:"b",text:"hello"}]);
  assert.equal(h.batches.length,0);
  h.document.visibilityState="visible";
  h.events.get("visibilitychange")();
  assert.equal(h.batches[0].operations[0].path,"chats/a_b/messages/one");
});

test("Back detaches the conversation and preserves its draft",async()=>{
  const h=harness();
  await h.login();
  await h.open("b");
  h.element("message").value="draft for b";
  const oldListener=h.listeners.findLast(l=>l.path==="chats/a_b/messages");
  h.element("back").onclick();
  assert.ok(oldListener.stopped);
  oldListener.callback({docs:[{id:"late",data:()=>({senderId:"b",text:"late"})}]});
  assert.equal(h.batches.length,0);
  assert.ok(h.element("message").disabled);
  await h.open("c");
  assert.equal(h.element("message").value,"");
  await h.open("b");
  assert.equal(h.element("message").value,"draft for b");
});

test("a send awaiting chat initialization is cancelled after A to B to A",async()=>{
  const h=harness();
  await h.login();
  await h.open("b");
  const held=deferred();
  h.control.holdTransaction=held;
  const sending=h.run('sendMessage({type:"text",text:"old chat"})');
  const rejected=assert.rejects(sending,error=>error.message==="Диалог изменился");
  h.control.holdTransaction=null;
  await h.open("c");
  await h.open("b");
  held.resolve();
  await rejected;
  assert.equal(h.batches.length,0);
});

test("completion of an in-flight send does not erase a newer draft",{timeout:1000},async()=>{
  const h=harness();
  await h.login();
  await h.open("b");
  const held=deferred();
  h.control.holdCommit=held;
  h.element("message").value="original";
  const submission=h.element("form").onsubmit({preventDefault(){}});
  // Allow ensureChat's transaction reads to finish and the batch to start.
  while(!h.batches.length)await new Promise(resolve=>setImmediate(resolve));
  h.element("message").value="next draft";
  held.resolve();
  await submission;
  assert.equal(h.element("message").value,"next draft");
});

test("typing expires without another snapshot and is cleared on chat change",async()=>{
  const h=harness();
  await h.login();
  await h.open("b");
  const last=h.control.now;
  h.snapshot("chats/a_b/typing/b",{typing:true,updatedAt:{toMillis:()=>last}});
  assert.equal(h.element("status").textContent,"Печатает...");
  h.control.now+=11000;
  h.run("updateStatus()");
  assert.equal(h.element("status").textContent,"Не в сети");
  await h.run("setTyping(true)");
  const writesBefore=h.writes.length;
  h.control.now+=4000;
  await h.run("setTyping(true)");
  assert.equal(h.writes.length,writesBefore+1,"continuous typing refreshes its timestamp");
  await h.open("c");
  assert.ok(h.writes.some(write=>write.path==="chats/a_b/typing/a"&&write.data.typing===false));
});

test("sign-out clears private message content and ignores queued snapshots",async()=>{
  const h=harness();
  await h.login();
  await h.open("b");
  h.messages("a_b",[{id:"private",senderId:"a",text:"private text"}]);
  const oldListener=h.listeners.findLast(l=>l.path==="chats/a_b/messages");
  await h.logout();
  oldListener.callback({docs:[{id:"private",data:()=>({senderId:"a",text:"private text"})}]});
  assert.ok(!h.element("messages").innerHTML.includes("private text"));
  assert.ok(h.element("message").disabled);
  assert.ok(h.element("send").disabled);
});

test("text and sticker sends share a single in-flight guard",async()=>{
  const h=harness();
  await h.login();
  await h.open("b");
  const held=deferred();
  h.control.holdTransaction=held;
  const sending=h.run('sendMessage({type:"text",text:"hello"})');
  await assert.rejects(h.run('sendMessage({type:"sticker",sticker:"pack/one"})'),
    error=>error.message==="Сообщение ещё отправляется");
  held.resolve();
  await sending;
  assert.equal(h.batches.length,1);
});

test("reaction toggles atomically replace and remove the caller's document",async()=>{
  const h=harness();
  await h.login();
  await h.open("b");
  h.store.set("chats/a_b/messages/one",{senderId:"b",text:"hello"});
  await h.run('toggleReaction("one","👍")');
  assert.equal(h.store.get("chats/a_b/reactions/one_a").emoji,"👍");
  await h.run('toggleReaction("one","❤️")');
  assert.equal(h.store.get("chats/a_b/reactions/one_a").emoji,"❤️");
  await h.run('toggleReaction("one","❤️")');
  assert.ok(!h.store.has("chats/a_b/reactions/one_a"));
});
