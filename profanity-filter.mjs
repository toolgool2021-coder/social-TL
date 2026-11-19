import {words,prefixes} from './profanity-words.mjs';
const aliases={а:'aа@4',б:'б6b',в:'вb',е:'еe3',ё:'ёеe3',з:'з3',и:'иu',й:'йиu',к:'кk',м:'мm',н:'нh',о:'оo0',п:'пn',р:'рp',с:'сc',т:'тt7',у:'уy',х:'хx',ы:'ы',ь:'ьb',a:'aа@4',b:'bв6',c:'cс',e:'eе3',h:'hн',i:'i1!',k:'kк',o:'oо0',p:'pр',s:'s5$',t:'tт7',u:'uи',x:'xх',y:'yу'};
const sep='[^\\p{L}\\p{N}]*';
const patterns=words.map(w=>new RegExp('(?<![\\p{L}\\p{N}])'+[...w].map(c=>'['+(aliases[c]||c).replace(/[$]/g,'\\$')+']+').join(sep)+(prefixes.includes(w)?'':'(?![\\p{L}\\p{N}])'),'iu'));
export function containsProfanity(value){const s=String(value??'').normalize('NFKC').toLowerCase().replace(/\p{Cf}/gu,'').replace(/\p{M}/gu,'');return patterns.some(p=>p.test(s));}
export function assertClean(...values){if(values.some(containsProfanity))throw Error('Отправка заблокирована: текст содержит запрещённую лексику. Отредактируйте его.');}
