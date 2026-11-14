import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, serverTimestamp, runTransaction, writeBatch, query, where, orderBy } from "firebase/firestore";

const OWNER = "ElpAtxZIBCZVsLBcLzgdIsr8T1w2";
const ALICE = "alice_test_uid";
const BOB = "bob_test_uid";
const MALLORY = "mallory_test_uid";
let env;
const db = uid => env.authenticatedContext(uid,{email_verified:true}).firestore();
const unverifiedDb = uid => env.authenticatedContext(uid,{email_verified:false}).firestore();
const ref = (uid, ...segments) => doc(db(uid), ...segments);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-nexora-rules-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8") }
  });
  await env.withSecurityRulesDisabled(async context => {
    const firestore = context.firestore();
    for (const [uid,role] of [[OWNER,"owner"],[ALICE,"user"],[BOB,"user"],[MALLORY,"user"]]) {
      await setDoc(doc(firestore,"users",uid),{name:uid,role,createdAt:new Date()});
    }
    await setDoc(doc(firestore,"posts","p1"),{uid:ALICE,text:"Hello",createdAt:new Date()});
    await setDoc(doc(firestore,"chats",ALICE+"_"+BOB),{
      participants:[ALICE,BOB],updatedAt:new Date(),lastText:""
    });
    await setDoc(doc(firestore,"chats",ALICE+"_"+BOB,"messages","m1"),{
      senderId:ALICE,type:"text",text:"Hello",createdAt:new Date()
    });
  });
});

after(async () => { await env?.cleanup(); });

test("unverified email can only bootstrap and read own profile", async () => {
  const fresh = "new_unverified_user";
  const udb = unverifiedDb(fresh);
  await assertSucceeds(setDoc(doc(udb,"users",fresh),{
    name:"Новый пользователь",bio:"Привет!",createdAt:serverTimestamp()
  }));
  await assertSucceeds(getDoc(doc(udb,"users",fresh)));
  await assertFails(updateDoc(doc(udb,"users",fresh),{bio:"Обход подтверждения"}));
  await assertFails(getDocs(collection(udb,"users")));
  await assertFails(getDoc(doc(udb,"users",ALICE)));
  await assertFails(getDoc(doc(udb,"posts","p1")));
  await assertFails(setDoc(doc(udb,"posts","unverified-post"),{
    uid:fresh,text:"Не должно пройти",createdAt:serverTimestamp()
  }));
  await assertFails(getDoc(doc(udb,"chats",ALICE+"_"+BOB)));
  await assertFails(setDoc(doc(udb,"presence",fresh),{
    uid:fresh,lastSeen:serverTimestamp()
  }));
});

test("users cannot grant themselves admin or verification", async () => {
  await assertFails(updateDoc(ref(ALICE,"users",ALICE),{role:"admin"}));
  await assertFails(updateDoc(ref(ALICE,"users",ALICE),{verification:5}));
  await assertSucceeds(updateDoc(ref(ALICE,"users",ALICE),{bio:"New bio"}));
});

test("owner can grant staff role, but not transfer ownership", async () => {
  await assertSucceeds(updateDoc(ref(OWNER,"users",BOB),{role:"moderator"}));
  await assertFails(updateDoc(ref(OWNER,"users",BOB),{role:"owner"}));
});

test("only author can create posts under their UID", async () => {
  await assertSucceeds(setDoc(ref(ALICE,"posts","own-post"),{
    uid:ALICE,text:"A valid post",createdAt:serverTimestamp()
  }));
  await assertFails(setDoc(ref(BOB,"posts","spoof-post"),{
    uid:ALICE,text:"Forged post",createdAt:serverTimestamp()
  }));
});

test("outsiders cannot read private chats or messages", async () => {
  const cid=ALICE+"_"+BOB;
  await assertSucceeds(getDoc(ref(ALICE,"chats",cid)));
  await assertFails(getDoc(ref(MALLORY,"chats",cid)));
  await assertFails(getDocs(collection(db(MALLORY),"chats",cid,"messages")));
});

test("chat reaction belongs only to its author", async () => {
  const cid=ALICE+"_"+BOB;
  const reaction=ref(ALICE,"chats",cid,"reactions","m1_"+ALICE);
  await assertSucceeds(setDoc(reaction,{
    uid:ALICE,messageId:"m1",emoji:"👍",createdAt:serverTimestamp()
  }));
  await assertFails(updateDoc(ref(BOB,"chats",cid,"reactions","m1_"+ALICE),{emoji:"🔥"}));
  await assertSucceeds(updateDoc(reaction,{emoji:"🔥",createdAt:serverTimestamp()}));
  await assertFails(deleteDoc(ref(BOB,"chats",cid,"reactions","m1_"+ALICE)));
  await assertSucceeds(deleteDoc(reaction));
});

test("forged chat identifiers and participants are rejected", async () => {
  await assertFails(setDoc(ref(ALICE,"chats","fake-chat"),{
    participants:[ALICE,BOB],lastText:"",updatedAt:serverTimestamp()
  }));
  await assertFails(setDoc(ref(ALICE,"chats","other-chat"),{
    participants:[BOB,MALLORY],lastText:"",updatedAt:serverTimestamp()
  }));
});

test("client cannot fabricate notifications", async () => {
  await assertFails(setDoc(ref(ALICE,"users",BOB,"notifications","fake"),{
    text:"fake",read:false
  }));
});

test("new private chat can be created before listening to messages", async () => {
  const cid=ALICE+"_"+MALLORY;
  await assertSucceeds(setDoc(ref(ALICE,"chats",cid),{
    participants:[ALICE,MALLORY],updatedAt:serverTimestamp(),lastText:""
  }));
  await assertSucceeds(getDocs(collection(db(ALICE),"chats",cid,"messages")));
  await assertSucceeds(getDocs(collection(db(MALLORY),"chats",cid,"reactions")));
  await assertFails(getDocs(collection(db(BOB),"chats",cid,"reactions")));
});

test("only the recipient may mark a message read", async () => {
  const cid=ALICE+"_"+BOB;
  const message=ref(BOB,"chats",cid,"messages","m1");
  await assertFails(updateDoc(ref(ALICE,"chats",cid,"messages","m1"),{
    readAt:serverTimestamp()
  }));
  await assertSucceeds(updateDoc(message,{readAt:serverTimestamp()}));
});

test("timestamps cannot be backdated for social actions", async () => {
  await assertFails(setDoc(ref(ALICE,"users",ALICE,"likes","p1"),{
    createdAt:new Date("2001-01-01T00:00:00Z")
  }));
  await assertSucceeds(setDoc(ref(ALICE,"users",ALICE,"likes","p1"),{
    createdAt:serverTimestamp()
  }));
  await assertFails(setDoc(ref(ALICE,"presence",ALICE),{
    uid:ALICE,lastSeen:new Date("2001-01-01T00:00:00Z")
  }));
  await assertSucceeds(setDoc(ref(ALICE,"presence",ALICE),{
    uid:ALICE,lastSeen:serverTimestamp()
  }));
});

test("typing timestamps must be generated by Firestore", async () => {
  const cid=ALICE+"_"+BOB;
  await assertFails(setDoc(ref(ALICE,"chats",cid,"typing",ALICE),{
    uid:ALICE,typing:true,updatedAt:new Date("2001-01-01T00:00:00Z")
  }));
  await assertSucceeds(setDoc(ref(ALICE,"chats",cid,"typing",ALICE),{
    uid:ALICE,typing:true,updatedAt:serverTimestamp()
  }));
});

test("users can submit reports but cannot approve their own reports", async () => {
  const report = ref(ALICE,"reports","test-report");
  await assertSucceeds(setDoc(report,{
    reporterId:ALICE,kind:"post",targetId:"p1",
    reason:"Проверить эту публикацию на нарушение правил",
    status:"pending",createdAt:serverTimestamp()
  }));
  await assertFails(updateDoc(report,{status:"resolved",reviewedBy:ALICE}));
  await assertSucceeds(updateDoc(ref(OWNER,"reports","test-report"),{
    status:"dismissed",reviewedBy:OWNER,reviewedAt:serverTimestamp()
  }));
});

test("verification requests cannot be approved by the applicant", async () => {
  const request=ref(ALICE,"verificationRequests",ALICE);
  await assertSucceeds(setDoc(request,{
    uid:ALICE,type:2,reason:"Подтверждение авторства аккаунта в проекте",
    status:"pending",createdAt:serverTimestamp()
  }));
  await assertFails(updateDoc(request,{status:"approved",reviewedBy:ALICE}));
  await assertSucceeds(updateDoc(ref(OWNER,"verificationRequests",ALICE),{
    status:"approved",reviewedBy:OWNER,reviewedAt:serverTimestamp()
  }));
});

test("the owner alone may create immutable audit records", async () => {
  const log={actorId:OWNER,action:"report.dismiss",targetId:"test-report",
    details:{reason:"reviewed"},createdAt:serverTimestamp()};
  await assertFails(setDoc(ref(BOB,"auditLogs","fake"),log));
  await assertSucceeds(setDoc(ref(OWNER,"auditLogs","test-log"),log));
  await assertFails(deleteDoc(ref(OWNER,"auditLogs","test-log")));
});

test("ordinary users cannot create owner notification alerts", async () => {
  await assertFails(setDoc(ref(ALICE,"users",OWNER,"notifications","report_fake"),{
    actorId:ALICE,kind:"report",targetId:"test-report",
    text:"Fake moderation alert",read:false,createdAt:serverTimestamp()
  }));
});

test("participants may check for a missing chat before creating it", async () => {
  const cid=BOB+"_"+MALLORY;
  const missing=await assertSucceeds(getDoc(ref(BOB,"chats",cid)));
  assert.equal(missing.exists(),false);
  await assertFails(getDoc(ref(ALICE,"chats",cid)));
});

test("a valid missing-chat probe does not reveal an existing private chat", async () => {
  const cid=ALICE+"_"+BOB;
  await assertSucceeds(getDoc(ref(ALICE,"chats",cid)));
  await assertFails(getDoc(ref(MALLORY,"chats",cid)));
});

test("opening an existing conversation does not overwrite its preview", async () => {
  const cid=ALICE+"_"+BOB;
  const firestore=db(ALICE);
  const chat=doc(firestore,"chats",cid);
  await assertSucceeds(updateDoc(chat,{
    lastText:"Existing message preview",updatedAt:serverTimestamp()
  }));
  await assertSucceeds(runTransaction(firestore,async tx=>{
    const existing=await tx.get(chat);
    if(!existing.exists()){
      tx.set(chat,{participants:[ALICE,BOB],lastText:"",updatedAt:serverTimestamp()});
    }
  }));
  const snapshot=await getDoc(chat);
  assert.equal(snapshot.data().lastText,"Existing message preview");
});

test("legacy profile without optional name remains editable", async () => {
  const legacy="legacy_profile_test";
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),"users",legacy),{
      role:"user",createdAt:new Date()
    });
  });
  await assertSucceeds(updateDoc(ref(legacy,"users",legacy),{
    bio:"Обновлённая биография"
  }));
  await assertFails(updateDoc(ref(legacy,"users",legacy),{
    role:"admin"
  }));
});

test("saved posts support harmless repeated saves but not forged timestamps", async () => {
  const item=ref(BOB,"users",BOB,"saved","p1");
  await assertSucceeds(setDoc(item,{createdAt:serverTimestamp()}));
  await assertSucceeds(setDoc(item,{createdAt:serverTimestamp()}));
  await assertFails(setDoc(item,{createdAt:new Date("2001-01-01T00:00:00Z")}));
  await assertFails(setDoc(ref(BOB,"users",ALICE,"saved","p1"),{
    createdAt:serverTimestamp()
  }));
});


test("registration accepts the browser payload and rejects privileged or malformed profiles", async () => {
  const register = (uid, extra = {}) => setDoc(ref(uid,"users",uid),{
    name:"Новый пользователь",bio:"Привет! Я в NEXORA.",
    createdAt:serverTimestamp(),...extra
  });
  await assertSucceeds(register("new_account"));
  await assertFails(register("bad_role",{role:"owner"}));
  await assertFails(register("bad_badge",{verification:5}));
  await assertFails(register("bad_bio",{bio:["invalid"]}));
  await assertFails(register("bad_avatar",{avatarUrl:"javascript:alert(1)"}));
  await assertFails(register("bad_profile_time",{createdAt:new Date("2001-01-01")}));
});

test("profile settings accept empty URLs without requiring changes to legacy fields", async () => {
  const legacy="legacy_invalid_profile";
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),"users",legacy),{
      name:"x",bio:42,avatarUrl:"http://legacy.example/avatar.png",role:"user"
    });
  });
  // Fields that the user is not editing must not block a legacy profile update.
  await assertSucceeds(updateDoc(ref(legacy,"users",legacy),{websiteUrl:""}));
  await assertSucceeds(updateDoc(ref(legacy,"users",legacy),{
    bio:"Исправленная биография",avatarUrl:"",bannerUrl:"",websiteUrl:""
  }));
  await assertFails(updateDoc(ref(legacy,"users",legacy),{bio:42}));
  await assertFails(updateDoc(ref(legacy,"users",legacy),{avatarUrl:"http://invalid.example/x"}));
  await assertFails(updateDoc(ref(legacy,"users",legacy),{updatedAt:new Date("2001-01-01")}));
});

test("editing a post cannot bypass image or timestamp validation", async () => {
  const post=ref(ALICE,"posts","edit-validation");
  await assertSucceeds(setDoc(post,{
    uid:ALICE,text:"Публикация",createdAt:serverTimestamp()
  }));
  await assertFails(updateDoc(post,{imageUrl:"javascript:alert(1)"}));
  await assertFails(updateDoc(post,{editedAt:new Date("2001-01-01")}));
  await assertSucceeds(updateDoc(post,{
    text:"Исправлено",imageUrl:"https://example.com/image.png",editedAt:serverTimestamp()
  }));
  await assertFails(updateDoc(ref(BOB,"posts","edit-validation"),{text:"Подмена"}));
});

test("two accounts can publish, comment, follow, save and exchange private messages", async () => {
  const cid=ALICE+"_"+BOB;
  const messageId="integration-message";
  const postId="integration-post";
  await assertSucceeds(setDoc(ref(ALICE,"posts",postId),{
    uid:ALICE,text:"Интеграция 3.2",createdAt:serverTimestamp()
  }));
  await assertSucceeds(setDoc(ref(BOB,"posts",postId,"comments","c1"),{
    uid:BOB,text:"Комментарий второго аккаунта",createdAt:serverTimestamp()
  }));
  await assertSucceeds(setDoc(ref(BOB,"users",BOB,"saved",postId),{createdAt:serverTimestamp()}));
  const bobFirestore=db(BOB);
  const follow=writeBatch(bobFirestore);
  follow.set(doc(bobFirestore,"users",BOB,"following",ALICE),{createdAt:serverTimestamp()});
  follow.set(doc(bobFirestore,"users",ALICE,"followers",BOB),{createdAt:serverTimestamp()});
  await assertSucceeds(follow.commit());
  const aliceFirestore=db(ALICE);
  const send=writeBatch(aliceFirestore);
  send.set(doc(aliceFirestore,"chats",cid),{
    participants:[ALICE,BOB],updatedAt:serverTimestamp(),lastText:"Привет"
  },{merge:true});
  send.set(doc(aliceFirestore,"chats",cid,"messages",messageId),{
    senderId:ALICE,type:"text",text:"Привет",sticker:"",createdAt:serverTimestamp()
  });
  await assertSucceeds(send.commit());
  await assertSucceeds(getDocs(query(collection(db(BOB),"chats"),where("participants","array-contains",BOB))));
  await assertSucceeds(getDocs(query(collection(db(BOB),"chats",cid,"messages"),orderBy("createdAt"))));
  await assertSucceeds(updateDoc(ref(BOB,"chats",cid,"messages",messageId),{readAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref(ALICE,"chats",cid,"messages",messageId),{
    text:"Привет ещё раз",editedAt:serverTimestamp()
  }));
  await assertSucceeds(setDoc(ref(BOB,"chats",cid,"reactions",messageId+"_"+BOB),{
    uid:BOB,messageId,emoji:"❤️",createdAt:serverTimestamp()
  }));
  await assertFails(getDocs(query(collection(db(MALLORY),"chats"),where("participants","array-contains",BOB))));
});

test("comments cannot be added to a missing post", async () => {
  await assertFails(setDoc(ref(BOB,"posts","deleted-post","comments","orphan"),{
    uid:BOB,text:"Нет публикации",createdAt:serverTimestamp()
  }));
});

test("reaction updates require a message but stale reactions can still be removed", async () => {
  const cid=ALICE+"_"+BOB;
  const mid="reaction-deleted-message";
  await assertSucceeds(setDoc(ref(ALICE,"chats",cid,"messages",mid),{
    senderId:ALICE,type:"text",text:"Будет удалено",createdAt:serverTimestamp()
  }));
  const reaction=ref(BOB,"chats",cid,"reactions",mid+"_"+BOB);
  await assertSucceeds(setDoc(reaction,{uid:BOB,messageId:mid,emoji:"👍",createdAt:serverTimestamp()}));
  await assertSucceeds(deleteDoc(ref(ALICE,"chats",cid,"messages",mid)));
  await assertFails(updateDoc(reaction,{emoji:"🔥",createdAt:serverTimestamp()}));
  await assertSucceeds(deleteDoc(reaction));
});

test("message edits preserve recipient receipts and cannot forge their timestamp", async () => {
  const cid=ALICE+"_"+BOB;
  const mid="receipt-validation";
  const message=ref(ALICE,"chats",cid,"messages",mid);
  await assertSucceeds(setDoc(message,{
    senderId:ALICE,type:"text",text:"Hello",createdAt:serverTimestamp()
  }));
  await assertFails(updateDoc(message,{text:""}));
  await assertFails(updateDoc(message,{editedAt:new Date("2001-01-01")}));
  await assertFails(updateDoc(ref(BOB,"chats",cid,"messages",mid),{
    text:"Forged",readAt:serverTimestamp()
  }));
  await assertSucceeds(updateDoc(ref(BOB,"chats",cid,"messages",mid),{readAt:serverTimestamp()}));
  await assertFails(updateDoc(ref(BOB,"chats",cid,"messages",mid),{readAt:new Date("2001-01-01")}));
});

test("owner moderation and audit records require trusted timestamps", async () => {
  const id="review-time-validation";
  await assertSucceeds(setDoc(ref(ALICE,"reports",id),{
    reporterId:ALICE,kind:"post",targetId:"p1",reason:"Проверка правил модерации",
    status:"pending",createdAt:serverTimestamp()
  }));
  await assertFails(updateDoc(ref(OWNER,"reports",id),{
    status:"dismissed",reviewedBy:OWNER,reviewedAt:new Date("2001-01-01")
  }));
  await assertSucceeds(updateDoc(ref(OWNER,"reports",id),{
    status:"dismissed",reviewedBy:OWNER,reviewedAt:serverTimestamp()
  }));
  await assertFails(setDoc(ref(OWNER,"auditLogs","backdated-audit"),{
    actorId:OWNER,action:"report.dismiss",targetId:id,details:{},createdAt:new Date("2001-01-01")
  }));
});

test("chat participants cannot rewrite membership or message identity", async () => {
  const cid=ALICE+"_"+BOB;
  await assertFails(updateDoc(ref(ALICE,"chats",cid),{participants:[ALICE,MALLORY]}));
  const message=ref(ALICE,"chats",cid,"messages","identity-validation");
  await assertSucceeds(setDoc(message,{
    senderId:ALICE,type:"text",text:"Immutable identity",createdAt:serverTimestamp()
  }));
  await assertFails(updateDoc(message,{senderId:BOB}));
  await assertFails(updateDoc(message,{type:"sticker",sticker:"pack/file.png"}));
  await assertFails(updateDoc(message,{createdAt:serverTimestamp()}));
  await assertFails(updateDoc(message,{reactions:{"👍":[BOB]}}));
  await assertFails(setDoc(ref(BOB,"chats",cid,"reactions","identity-validation_"+ALICE),{
    uid:ALICE,messageId:"identity-validation",emoji:"👍",createdAt:serverTimestamp()
  }));
});

test("anonymous clients cannot access profiles, posts or private conversations", async () => {
  const firestore=env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(firestore,"users",ALICE)));
  await assertFails(getDocs(collection(firestore,"posts")));
  await assertFails(getDoc(doc(firestore,"chats",ALICE+"_"+BOB)));
  await assertFails(setDoc(doc(firestore,"users","anonymous"),{
    name:"Anonymous",createdAt:serverTimestamp()
  }));
});


test("legacy null read receipts can be completed once by the recipient", async () => {
  const cid=ALICE+"_"+BOB;
  const mid="legacy-null-receipt";
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),"chats",cid,"messages",mid),{
      senderId:ALICE,type:"text",text:"Legacy message",createdAt:new Date(),readAt:null
    });
  });
  await assertFails(updateDoc(ref(ALICE,"chats",cid,"messages",mid),{readAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref(BOB,"chats",cid,"messages",mid),{readAt:serverTimestamp()}));
  await assertFails(updateDoc(ref(BOB,"chats",cid,"messages",mid),{readAt:serverTimestamp()}));
});
