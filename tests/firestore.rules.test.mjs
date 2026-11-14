import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, serverTimestamp } from "firebase/firestore";

const OWNER = "FXtmMsn8JYfx04zpxiSaXZ0iHWg2";
const ALICE = "alice_test_uid";
const BOB = "bob_test_uid";
const MALLORY = "mallory_test_uid";
let env;
const db = uid => env.authenticatedContext(uid).firestore();
const ref = (uid, ...segments) => doc(db(uid), ...segments);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "nexora-rules-test",
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
