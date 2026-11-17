import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSearch,searchExplore} from '../explore-search.mjs';

const users={
 a:{name:'Александр',username:'alex'},
 b:{name:'Алексей',username:'alexey'},
 c:{name:'NEXORA',username:'nexora'}
};
const posts=[
 {id:'1',text:'Обновление NEXORA #Новости'},
 {id:'2',text:'Привет #Новости и #Релиз'},
 {id:'3',text:'Другая публикация'}
];
test('normalization handles case, whitespace and Unicode',()=>{
 assert.equal(normalizeSearch('  НЕХОРА   Beta  '),'нехора beta');
});
test('exact username ranks before partial username and display names',()=>{
 const result=searchExplore('@alex',users,posts);
 assert.deepEqual(result.users.map(x=>x.uid),['a','b']);
});
test('partial display name search is case-insensitive',()=>{
 assert.deepEqual(searchExplore('АЛЕКС',users,posts).users.map(x=>x.uid),['a','b']);
});
test('searches text and hashtags without duplicating tags',()=>{
 const result=searchExplore('#новости',users,posts);
 assert.deepEqual(result.posts.map(x=>x.id),['1','2']);
 assert.deepEqual(result.tags,[['#новости',2]]);
});
test('empty and nonmatching terms return empty results',()=>{
 assert.deepEqual(searchExplore(' ',users,posts),{users:[],posts:[],tags:[]});
 const result=searchExplore('nothingmatches',users,posts);
 assert.equal(result.users.length+result.posts.length+result.tags.length,0);
});
test('limits results and safely handles missing fields',()=>{
 const result=searchExplore('a',{a:{username:'a'},b:null},[{text:'a'},{text:'a'}],1);
 assert.equal(result.users.length,1);
 assert.equal(result.posts.length,1);
});

test('multiword searches match terms in any order across profile fields',()=>{
 const result=searchExplore('alex александр',users,posts);
 assert.deepEqual(result.users.map(x=>x.uid),['a']);
});
test('post search matches multiple words regardless of order',()=>{
 assert.deepEqual(searchExplore('nexora обновление',users,posts).posts.map(x=>x.id),['1']);
});
test('hashtags are case-folded before deduplication',()=>{
 const result=searchExplore('#news',{},[{text:'#NEWS #news'}]);
 assert.deepEqual(result.tags,[['#news',1]]);
});
test('result limits are bounded and invalid caps return empty results',()=>{
 assert.deepEqual(searchExplore('alex',users,posts,-1),{users:[],posts:[],tags:[]});
 assert.equal(searchExplore('alex',users,posts,1).users.length,1);
});
