import test from "node:test";
import assert from "node:assert/strict";
import {filterGroups} from "../groups-search.mjs";
const groups=[
 {id:"a",kind:"clan",name:"NEXORA",tag:"NXR",category:"Игры",description:"Клан",verified:true,memberCount:4},
 {id:"b",kind:"clan",name:"Альфа",tag:"ALF",category:"Игры",description:"Общение",verified:false,memberCount:30},
 {id:"c",kind:"community",name:"NEXORA Fans",category:"Новости",verified:true,memberCount:10}
];
test("catalog filters by group type",()=>assert.deepEqual(filterGroups(groups,"community").map(g=>g.id),["c"]));
test("catalog searches names, tags and categories case-insensitively",()=>{
 assert.deepEqual(filterGroups(groups,"clan","nxr").map(g=>g.id),["a"]);
 assert.deepEqual(filterGroups(groups,"clan","ИГРЫ").map(g=>g.id),["a","b"]);
});
test("catalog verified-only filter does not expose unverified entries",()=>assert.deepEqual(filterGroups(groups,"clan","",true).map(g=>g.id),["a"]));
test("catalog ranks verified groups before larger unverified groups",()=>assert.deepEqual(filterGroups(groups,"clan").map(g=>g.id),["a","b"]));
test("catalog handles missing fields and multiple tokens",()=>{
 assert.deepEqual(filterGroups([...groups,{id:"d",kind:"clan"}],"clan","nexora игры").map(g=>g.id),["a"]);
});
