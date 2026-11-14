import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../functions/index.js",import.meta.url),"utf8");
const require=createRequire(import.meta.url);
const OWNER="FXtmMsn8JYfx04zpxiSaXZ0iHWg2";

// Execute the actual exported trigger handlers. Only Firebase transport and
// registration are mocked; routing, IDs and retry/error behavior are real code.
function backend(records={}) {
  const documents=new Map(Object.entries(records));
  const attempts=[];
  let failure;
  const db={doc(path) {
    assert.equal(path.split("/").length%2,0,`Invalid document path: ${path}`);
    return {
      async get() {
        return {exists:documents.has(path),data:()=>documents.get(path)};
      },
      async create(data) {
        attempts.push(path);
        if(failure)throw failure;
        if(documents.has(path))throw Object.assign(Error("Already exists"),{code:6});
        documents.set(path,data);
      }
    };
  }};
  const handlers={};
  const definitions=[];
  const modules={
    "firebase-functions/v2/firestore":{onDocumentCreated(options,handler) {
      definitions.push(options);
      return handler;
    }},
    "firebase-admin/app":{initializeApp(){}},
    "firebase-admin/firestore":{getFirestore:()=>db,FieldValue:{serverTimestamp:()=>"server-time"}},
    "node:crypto":require("node:crypto")
  };
  runInNewContext(source,{
    require(name){assert.ok(name in modules,`Unexpected module ${name}`);return modules[name];},
    exports:handlers,Buffer
  },{filename:"functions/index.js"});
  return {
    handlers,definitions,documents,attempts,
    fail(error){failure=error;},
    notifications(){return [...documents].filter(([path])=>path.includes("/notifications/"));}
  };
}

function event(params,data={},id="event-1") {
  return {id,source:"//firestore.googleapis.com/projects/staging/databases/(default)",params,data:{data:()=>data}};
}

test("all six handlers retry failed delivery",()=>{
  const app=backend();
  assert.equal(Object.keys(app.handlers).length,6);
  assert.ok(app.definitions.every(options=>options.retry===true));
});

test("comment routes to the stored post author and bounds the untrusted snippet",async()=>{
  const app=backend({"users/bob":{},"posts/post-1":{uid:"bob"}});
  await app.handlers.onNewComment(event({postId:"post-1",commentId:"comment-1"},{
    uid:"alice",text:"\n\tHello\n"+"x".repeat(300),recipient:"mallory"
  }));
  const [[path,n]]=app.notifications();
  assert.ok(path.startsWith("users/bob/notifications/comment_"));
  assert.equal(n.actorId,"alice");
  assert.equal(n.targetId,"post-1");
  assert.equal(n.kind,"comment");
  assert.equal(n.createdAt,"server-time");
  assert.equal(n.read,false);
  assert.equal(n.text.length,"Новый комментарий: ".length+120);
  assert.ok(!/[\n\t]/.test(n.text));
});

test("retry keeps a single notification and preserves its read state",async()=>{
  const app=backend({"users/bob":{},"posts/p":{uid:"bob"}});
  const change=event({postId:"p",commentId:"c"},{uid:"alice",text:"Hello"});
  await app.handlers.onNewComment(change);
  const [[path,n]]=app.notifications();
  n.read=true;
  await app.handlers.onNewComment(change);
  assert.equal(app.notifications().length,1);
  assert.equal(app.documents.get(path).read,true);
});

test("concurrent retry deliveries create a single notification",async()=>{
  const app=backend({"users/bob":{},"posts/p":{uid:"bob"}});
  const change=event({postId:"p",commentId:"c"},{uid:"alice",text:"Hello"});
  await Promise.all([app.handlers.onNewComment(change),app.handlers.onNewComment(change)]);
  assert.equal(app.notifications().length,1);
});

test("notification IDs do not collide when path components contain underscores",async()=>{
  const app=backend({"users/bob":{},"posts/a_b":{uid:"bob"},"posts/a":{uid:"bob"}});
  await app.handlers.onNewComment(event({postId:"a_b",commentId:"c"},{uid:"alice",text:"First"},"event-a"));
  await app.handlers.onNewComment(event({postId:"a",commentId:"b_c"},{uid:"alice",text:"Second"},"event-b"));
  assert.equal(app.notifications().length,2);
});

test("new follow and like events are delivered after the original event",async()=>{
  const app=backend({"users/bob":{},"posts/p":{uid:"bob"}});
  for(const id of ["event-1","event-2"]) {
    await app.handlers.onNewFollower(event({uid:"bob",followerId:"alice"},{},id));
    await app.handlers.onNewLike(event({uid:"alice",postId:"p"},{},id));
  }
  assert.equal(app.notifications().length,4);
  assert.ok(app.notifications().every(([path])=>path.startsWith("users/bob/notifications/")));
  assert.deepEqual(app.notifications().map(([,n])=>n.kind),["follow","like","follow","like"]);
});

test("message routes only to the other stored participant with a sticker preview",async()=>{
  const app=backend({"users/bob":{},"chats/alice_bob":{participants:["alice","bob"]}});
  await app.handlers.onNewMessage(event({chatId:"alice_bob",messageId:"m"},{
    senderId:"alice",type:"sticker",sticker:"untrusted-url",recipient:"mallory"
  }));
  const [[path,n]]=app.notifications();
  assert.ok(path.startsWith("users/bob/notifications/message_"));
  assert.equal(n.kind,"message");
  assert.equal(n.targetId,"alice_bob");
  assert.equal(n.text,"Новое сообщение: Стикер");
});

test("invalid message senders, types and malformed legacy participants do not notify",async()=>{
  for(const [participants,message] of [
    [["alice","bob"],{senderId:"mallory",type:"text",text:"forged"}],
    [["alice","bob"],{senderId:"alice",type:"system",text:"forged"}],
    [["alice","alice"],{senderId:"alice",type:"text",text:"invalid"}],
    [["alice","bob/notifications/evil"],{senderId:"alice",type:"text",text:"invalid"}],
    [["alice",42],{senderId:"alice",type:"text",text:"invalid"}],
    [["alice","bob","carol"],{senderId:"alice",type:"text",text:"unsupported"}]
  ]) {
    const app=backend({"users/bob":{},"chats/c":{participants}});
    await app.handlers.onNewMessage(event({chatId:"c",messageId:"m"},message));
    assert.equal(app.notifications().length,0);
  }
});

test("self actions and missing recipients or deleted posts are ignored",async()=>{
  const app=backend({"users/alice":{},"posts/p":{uid:"alice"}});
  await app.handlers.onNewComment(event({postId:"p",commentId:"c"},{uid:"alice",text:"Self"}));
  await app.handlers.onNewLike(event({uid:"alice",postId:"p"}));
  await app.handlers.onNewFollower(event({uid:"alice",followerId:"alice"}));
  await app.handlers.onNewFollower(event({uid:"deleted",followerId:"alice"}));
  await app.handlers.onNewComment(event({postId:"deleted",commentId:"c"},{uid:"alice",text:"Gone"}));
  assert.equal(app.notifications().length,0);
});

test("malformed legacy profile IDs cannot be used in privileged notification paths",async()=>{
  for(const uid of ["bob/notifications/injected","..","__reserved__",42,"x".repeat(1501)]) {
    const app=backend({"posts/p":{uid}});
    await app.handlers.onNewComment(event({postId:"p",commentId:"c"},{uid:"alice",text:"Hello"}));
    assert.equal(app.attempts.length,0);
  }
});

test("reports and verification requests notify only the fixed owner",async()=>{
  const app=backend({[`users/${OWNER}`]:{}});
  await app.handlers.onNewReport(event({reportId:"report-1"},{
    reporterId:"alice",status:"pending",targetId:"evil/path",reason:"<script>"
  }));
  await app.handlers.onNewVerificationRequest(event({uid:"alice"},{
    uid:"alice",status:"pending",recipient:"mallory"
  }));
  assert.equal(app.notifications().length,2);
  assert.ok(app.notifications().every(([path,n])=>
    path.startsWith(`users/${OWNER}/notifications/`) && n.actorId==="alice" && !n.text.includes("<script>")
  ));
  assert.deepEqual(app.notifications().map(([,n])=>n.targetId),["report-1","alice"]);
  await app.handlers.onNewReport(event({reportId:"resolved"},{reporterId:"alice",status:"resolved"}));
  await app.handlers.onNewVerificationRequest(event({uid:"alice"},{uid:"mallory",status:"pending"}));
  assert.equal(app.notifications().length,2);
});

test("delivery errors propagate for retry except already-exists",async()=>{
  const app=backend({"users/bob":{}});
  const change=event({uid:"bob",followerId:"alice"});
  const outage=Object.assign(Error("Unavailable"),{code:14});
  app.fail(outage);
  await assert.rejects(app.handlers.onNewFollower(change),error=>error===outage);
  app.fail(Object.assign(Error("Already exists"),{code:"already-exists"}));
  await app.handlers.onNewFollower(change);
});
