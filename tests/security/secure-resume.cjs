// Offline regression tests: in-memory storage only, never contacts a study backend.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const path = require('node:path');
const secure = new Map(), plain = new Map();
let failChunk = false, user = { username: 'a', loginDate: 10 }, ping = {startTime: new Date(11)};
const ss = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  async getItemAsync(k) { return secure.get(k) ?? null; },
  async setItemAsync(k,v) { assert(Buffer.byteLength(v) <= 2048); if(failChunk && /\.0$/.test(k)) throw Error('disk full'); secure.set(k,v); },
  async deleteItemAsync(k) { secure.delete(k); },
};
const as = { async getItem(k) { return plain.get(k) ?? null; }, async setItem(k,v) {plain.set(k,v);}, async removeItem(k) {plain.delete(k);}, async getAllKeys() {return [...plain.keys()];} };
const mocks = {
  'expo-secure-store': ss,
  'expo-crypto': {CryptoDigestAlgorithm:{SHA256:'sha256'}, randomUUID:crypto.randomUUID, async digestStringAsync(_,v) {return crypto.createHash('sha256').update(v).digest('hex');}},
  '@react-native-async-storage/async-storage': {default:as},
  '../secureStore/user': {async secureGetUserAsync(){return user;}},
  '../secureStore/ping': {async secureGetPingAsync(){return ping;}},
  '../secureStore/secureStore': {async getSSKeyAsync(){return 'installation.study';}},
  './asyncStorage': {async getASKeyAsync(k=''){return 'study/'+k;}},
};
function load(file, extra={}) {
  const exports={};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(source,{exports,require(k){ if(k in extra) return extra[k]; if(k in mocks) return mocks[k]; throw Error('Unexpected dependency '+k); },console, setTimeout, Date, Promise});
  return exports;
}
const chunks=load('src/helpers/secureStore/chunkedValue.ts');
const resume=load('src/helpers/asyncStorage/pingState.ts',{'../secureStore/chunkedValue':chunks});
const state = {currentQuestionData:{questionId:'q'},nextQuestionsDataStack:[],answers:{q:'🔐'.repeat(4000)},isInTransition:false,questionsStack:[],startingPoint:null};
(async()=>{
  await chunks.writeChunkedValue('test', JSON.stringify(state));
  assert.equal(await chunks.readChunkedValue('test'),JSON.stringify(state));
  failChunk=true;
  await assert.rejects(chunks.writeChunkedValue('test','replacement'));
  assert.equal(await chunks.readChunkedValue('test'),JSON.stringify(state),'failed write preserves committed snapshot');
  failChunk=false;
  await chunks.writeChunkedValue('test','replacement');
  assert.equal(await chunks.readChunkedValue('test'),'replacement');
  await chunks.clearChunkedValue('test'); assert.equal(secure.size,0);
  plain.set('study/PingsState:p',JSON.stringify(state));
  failChunk=true; await assert.rejects(resume.getPingStateAsync('p')); assert(plain.has('study/PingsState:p'));
  failChunk=false;
  assert.equal(JSON.stringify(await resume.getPingStateAsync('p')),JSON.stringify(state));
  assert(!plain.has('study/PingsState:p'),'verified migration removes plaintext');
  assert(![...plain.values()].some(v=>v.includes('🔐')),'no answer bodies in AsyncStorage');
  user={username:'b',loginDate:20};
  await assert.rejects(resume.getPingStateAsync('p'),'participant cannot read another session');
  plain.set('study/PingsState:old',JSON.stringify(state));
  await assert.rejects(resume.getPingStateAsync('old'),'legacy ownership must be verified');
  assert(plain.has('study/PingsState:old'));
  user={username:'a',loginDate:10};
  await Promise.all([resume.storePingStateAsync('p',{...state,answers:{q:'one'}}),resume.storePingStateAsync('p',{...state,answers:{q:'two'}})]);
  assert.equal((await resume.getPingStateAsync('p')).answers.q,'two','writes serialize');
  await resume.clearAllPingStatesAsync(); assert.equal(secure.size,0);assert.equal(plain.size,0);
  let pending=['p'], pings=[], deleted=0, auth=0;
  const users=load('src/helpers/users.ts',{
    './asyncStorage/unuploadedPingsList':{async getUnuploadedPingsListAsync(){return pending;}},
    './pings':{async getPingsAsync(){return pings;}},
    './asyncStorage/studyFile':{async clearCurrentStudyFileAsync(){deleted++;}},
    './asyncStorage/tempStudyFile':{async clearTempStudyFileAsync(){deleted++;}},
    'expo-notifications':{async cancelAllScheduledNotificationsAsync(){}},
    './beiwe':{}, './cleanup':{async clearAllPingsAndAnswersAsync(){deleted++;}},
    './firebase':{firebaseInitialized(){return true;},async firebaseLogoutAndDeleteAppAsync(){auth++;}},
    './secureStore/user':{async secureClearUserAsync(){deleted++;}}, './server':{},
    './studyFile':{async studyFileExistsAsync(){return true;}},
  });
  await assert.rejects(users.logoutAsync()); assert.equal(deleted,0);assert.equal(auth,0);
  pending=[];pings=[{endTime:null}];await assert.rejects(users.logoutAsync());assert.equal(deleted,0);
  pings=[{endTime:new Date()}];await users.logoutAsync(); assert.equal(auth,1);assert.equal(deleted,4);
  console.log('PASS: Unicode chunk sizes, interrupted writes, verified migration, namespace isolation, serialized writes, cleanup, fail-closed logout.');
})().catch(e=>{console.error(e);process.exitCode=1;});

// Mount the actual component with dependency stubs to simulate a restart after
// the terminal snapshot was saved but before ping.endTime was durably written.
(async () => {
  let savedPing = {id:'terminal', endTime:null}, completed=0, endWrites=0, clears=0, retry;
  let failEnd = true;
  const stubs = {
    react: {default: {Component: class { constructor(props) {this.props=props;} }}},
    'react-native': {StyleSheet:{create(v){return v;}},Dimensions:{get(){return {height:800,width:400};}},Alert:{alert(_title,_body,buttons){retry=buttons[0].onPress;}}},
    './helpers/asyncStorage/pingState': {async storePingStateAsync(){},async clearPingStateAsync(){clears++;}},
    './helpers/secureStore/ping': {async secureGetPingAsync(){return savedPing;}},
    './helpers/pings': {async addEndTimeToPingAsync(_id,date){if(failEnd)throw Error('disk full');endWrites++;savedPing={...savedPing,endTime:date};return savedPing;}},
  };
  const exports={};
  const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/SurveyScreen.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText;
  vm.runInNewContext(source,{exports,require(k){return stubs[k] || {};},Date,console});
  const terminal={...state,currentQuestionData:{questionId:null}};
  const screen=new exports.default({previousState:terminal,ping:savedPing,onFinish(){completed++;}});
  screen.componentDidMount();
  await new Promise(setImmediate);
  assert.equal(completed,0); assert.equal(clears,0);assert.equal(typeof retry,'function');
  failEnd=false;retry();await new Promise(setImmediate);
  assert.equal(completed,1);assert.equal(endWrites,1);assert.equal(clears,1);
  await screen.finishTerminalResume();assert.equal(completed,1,'completion is idempotent in mounted instance');
  const priorEnd=savedPing.endTime;
  const restarted=new exports.default({previousState:terminal,ping:savedPing,onFinish(){completed++;}});
  restarted.componentDidMount();await new Promise(setImmediate);
  assert.equal(endWrites,1,'existing end time must not be rewritten');assert.equal(savedPing.endTime,priorEnd);assert.equal(completed,2);
  console.log('PASS: terminal snapshot remount recovery, failed completion retry, existing end-time preservation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
