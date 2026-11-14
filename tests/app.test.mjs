import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Run the actual browser module, replacing only browser/Firebase boundaries.
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8')
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];/g, '');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.events = {};
    this.style = {};
    this.classes = new Set();
    this.classList = {
      add: value => this.classes.add(value),
      remove: value => this.classes.delete(value),
      contains: value => this.classes.has(value),
      toggle: (value, force = !this.classes.has(value)) => {
        if (force) this.classes.add(value); else this.classes.delete(value);
      }
    };
  }
  set innerHTML(value) {
    this.html = value;
    this.replaceChildren();
    // Only DOM structures used by these flows are needed by the boundary stub.
    if (this.tagName === 'form') this.append(new Element('input'), new Element('button'));
    for (const match of value.matchAll(/data-comments-for="([^"]+)"/g)) {
      const box = new Element();
      box.dataset.commentsFor = match[1];
      box.classList.add('hidden');
      this.append(box);
    }
  }
  get innerHTML() { return this.html || ''; }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentElement) {
        node.parentElement.children = node.parentElement.children.filter(item => item !== node);
      }
      node.parentElement = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.children.forEach(node => { node.parentElement = null; });
    this.children = [];
    this.append(...nodes);
  }
  replaceWith(node) {
    const parent = this.parentElement;
    const index = parent.children.indexOf(this);
    parent.children[index] = node;
    node.parentElement = parent;
    this.parentElement = null;
  }
  setAttribute() {}
  addEventListener(name, callback) { this.events[name] = callback; }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    return descendants.filter(node => selector === '*' ||
      (selector === '[data-comments-for]' ? node.dataset.commentsFor : node.tagName === selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  get isConnected() { return this.root || Boolean(this.parentElement?.isConnected); }
}

function harness(initialProfiles = {}) {
  const elements = new Map();
  const writes = [];
  const profiles = new Map(Object.entries(initialProfiles));
  const listeners = [];
  const authTasks = [];
  const auth = {currentUser:null};
  let authListener;
  let transactionQueue = Promise.resolve();
  const doc = (_db, ...parts) => parts.join('/');
  const snapshot = data => ({exists:() => data !== undefined, data:() => data});
  const context = vm.createContext({
    console: {info(){}, warn(){}, error(){}},
    setTimeout:() => 1, clearTimeout(){}, URL, Date,
    SOCIAL:{}, TRUSTED_HOSTS:[],
    document: {
      activeElement:null,
      getElementById(id) {
        if (!elements.has(id)) {
          const node = new Element(id === 'authForm' ? 'form' : 'div');
          node.root = true;
          elements.set(id, node);
        }
        return elements.get(id);
      },
      querySelectorAll:() => [],
      addEventListener(){},
      createElement:tag => new Element(tag)
    },
    window:{addEventListener(){}},
    getApps:() => [{}], initializeApp:() => ({}),
    getAuth:() => auth, getFirestore:() => ({}),
    doc, collection:doc, query:(path, ...constraints) => ({path, constraints}),
    limit:value => ({limit:value}), orderBy:(field, direction) => ({field, direction}),
    serverTimestamp:() => 'SERVER_TIMESTAMP',
    onAuthStateChanged(_auth, callback) { authListener = callback; },
    createUserWithEmailAndPassword:async (_auth, email) => {
      const user = {uid:'new-user', email};
      auth.currentUser = user;
      // Emit BEFORE the registration promise resolves: the original race.
      authTasks.push(authListener(user));
      return {user};
    },
    signInWithEmailAndPassword(){}, signOut(){},
    getDoc:async path => snapshot(profiles.get(path)),
    getDocs:async () => ({forEach(){}}),
    runTransaction(_db, callback) {
      const run = transactionQueue.then(() => callback({
        get:async path => snapshot(profiles.get(path)),
        set(path, data) {
          writes.push({path, data});
          profiles.set(path, data);
        }
      }));
      transactionQueue = run.catch(() => {});
      return run;
    },
    onSnapshot(target, next, error) {
      const listener = {target, next, error, stopped:false};
      listeners.push(listener);
      return () => { listener.stopped = true; };
    },
    addDoc:async (path, data) => { writes.push({path, data}); },
    setDoc(){ throw Error('Profile initialization must not overwrite with setDoc'); },
    deleteDoc(){}
  });
  vm.runInContext(source, context, {filename:'app.js'});
  const evaluate = code => vm.runInContext(code, context);
  return {
    context, evaluate, elements, writes, profiles, listeners, authTasks,
    async authenticate(user) { auth.currentUser = user; await authListener(user); },
    async signup(name = 'Алиса') {
      evaluate('setAuthMode("register")');
      elements.get('username').value = name;
      context.document.getElementById('email').value = 'alice@example.test';
      elements.get('password').value = 'test-password';
      await elements.get('authForm').events.submit({preventDefault(){}});
      await Promise.all(authTasks);
    }
  };
}

const plain = value => JSON.parse(JSON.stringify(value));

test('registration auth event arriving before profile write keeps requested name and starts feed', async () => {
  const app = harness();
  await app.signup('Алиса');
  assert.equal(app.profiles.get('users/new-user').name, 'Алиса');
  assert.equal(app.writes.length, 1);
  assert.equal(app.listeners.filter(item => item.target.path === 'posts').length, 1);
  assert.equal(app.elements.get('topName').textContent, 'Алиса');
});

test('a partially registered account is recovered without privileged fields', async () => {
  const app = harness();
  await app.authenticate({uid:'partial', email:'partial@example.test'});
  assert.deepEqual(plain(app.writes), [{path:'users/partial', data:{
    name:'Пользователь', bio:'Привет! Я в NEXORA.', createdAt:'SERVER_TIMESTAMP'
  }}]);
  assert.equal(app.listeners.filter(item => item.target.path === 'posts').length, 1);
});

test('existing legacy and owner profiles survive login without writes', async () => {
  const profile = {role:'owner', verification:3, unknownLegacyField:'keep'};
  const app = harness({'users/existing':profile});
  await app.authenticate({uid:'existing', email:'owner@example.test'});
  assert.equal(app.writes.length, 0);
  assert.deepEqual(plain(app.profiles.get('users/existing')), profile);
});

async function commentsHarness() {
  const app = harness({'users/alice':{name:'Alice'}});
  await app.authenticate({uid:'alice', email:'alice@example.test'});
  const container = app.elements.get('feedList');
  container.innerHTML = '<article><div data-comments-for="p1"></div></article>';
  const box = container.querySelector('[data-comments-for]');
  app.context.testBox = box;
  await app.evaluate('openComments("p1", testBox)');
  return {app, container, box, input:box.querySelector('input'), form:box.querySelector('form'),
    listener:app.listeners.find(item => item.target.path === 'posts/p1/comments')};
}

test('realtime comments update without replacing the draft form; feed rerender retains its nodes', async () => {
  const {app, container, box, input, listener} = await commentsHarness();
  input.value = 'Unsent draft';
  listener.next({docs:[{data:() => ({uid:'bob', text:'A realtime comment'})}]});
  assert.match(box.children[0].innerHTML, /A realtime comment/);
  assert.equal(box.querySelector('input'), input);
  app.evaluate('renderPostList($("feedList"), \'<article><div data-comments-for="p1"></div></article>\')');
  assert.equal(container.querySelector('[data-comments-for]'), box);
  assert.equal(box.querySelector('input'), input);
  assert.equal(input.value, 'Unsent draft');
  assert.equal(listener.stopped, false);
});

test('closing a thread or removing its post stops listening; a stale callback cannot render it', async () => {
  const {app, box, listener} = await commentsHarness();
  const list = box.children[0];
  await app.evaluate('openComments("p1", testBox)');
  assert.equal(listener.stopped, true);
  const old = list.innerHTML;
  listener.next({docs:[{data:() => ({uid:'bob', text:'Too late'})}]});
  assert.equal(list.innerHTML, old);
  await app.evaluate('openComments("p1", testBox)');
  const next = app.listeners.at(-1);
  app.evaluate('renderPostList($("feedList"), "")');
  assert.equal(next.stopped, true);
  assert.equal(app.evaluate('commentThreads.size'), 0);
});

test('logout stops comment listeners and prevents a detached old-account form submitting', async () => {
  const {app, input, form, listener} = await commentsHarness();
  input.value = 'Do not submit as another account';
  const count = app.writes.length;
  await app.authenticate(null);
  await form.events.submit({preventDefault(){}});
  assert.equal(listener.stopped, true);
  assert.equal(app.writes.length, count);
  assert.equal(app.evaluate('commentThreads.size'), 0);
});

test('comment completion preserves a newer draft and blocks duplicate in-flight submissions', async () => {
  const {app, input, form} = await commentsHarness();
  let finish;
  const sent = [];
  app.context.addDoc = (path, data) => {
    sent.push({path, data});
    return new Promise(resolve => { finish = resolve; });
  };
  input.value = 'First comment';
  const submission = form.events.submit({preventDefault(){}});
  input.value = 'My next draft';
  await form.events.submit({preventDefault(){}});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.text, 'First comment');
  finish();
  await submission;
  assert.equal(input.value, 'My next draft');
  assert.equal(form.querySelector('button').disabled, false);
});
