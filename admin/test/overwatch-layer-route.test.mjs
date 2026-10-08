import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildPrompt, dispatchKey, permissionProfile, routes } from '../routes/overwatch-layer.mjs';
import { byWindow, sessionsFromStore } from '../lib/overwatch-layer-read.mjs';

const TMP=mkdtempSync(join(tmpdir(),'cw-overwatch-'));
const STORE=join(TMP,'tasks.db');
const originalFetch=global.fetch;
const RUNNER_TOKEN='e'.repeat(64);

before(()=>{
  const db=new DatabaseSync(STORE);
  db.exec(`CREATE TABLE sessions (
    id TEXT, plan_id TEXT, owner TEXT, agent TEXT, status TEXT, label TEXT,
    started_at TEXT, ended_at TEXT, pid INTEGER, last_seen TEXT, ids TEXT
  )`);
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'session-1','plan-1','owner','agent','active','working','2026-09-02T00:00:00Z',null,123,'2026-09-02T00:01:00Z',
    JSON.stringify({idePort:4555,workspace:'/repo',vscodePid:42,how:{idePort:'lockfile+cwd'}}),
  );
  db.close();
  process.env.SUBSTRATE_TASKS_DB=STORE;
  writeFileSync(join(TMP,'runner-token'),RUNNER_TOKEN+'\n',{mode:0o600});
  process.env.CW_SUBSTRATE_TOKEN_FILE=join(TMP,'runner-token');
});

after(()=>{
  global.fetch=originalFetch;
  delete process.env.SUBSTRATE_TASKS_DB;
  delete process.env.CW_SUBSTRATE_TOKEN_FILE;
  rmSync(TMP,{recursive:true,force:true});
});

const route=(method,path)=>routes.find(r=>r.method===method&&r.path===path);
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const ctx=(overrides={})=>{
  const out={status:null,json:null};
  return {
    out,
    req:{},
    isLoopbackReq:true,
    adminSession:()=>({user:'operator'}),
    readJsonBody(_req,cb){cb({},null);},
    send(status,json){out.status=status;out.json=json;return out;},
    ...overrides,
  };
};

test('the stored session remains attributable to its IDE window',()=>{
  const s=sessionsFromStore({path:STORE});
  assert.equal(s.ok,true);
  assert.equal(s.sessions.length,1);
  const a=byWindow(s.sessions);
  assert.equal(a.windows[0].idePort,4555);
  assert.equal(a.windows[0].sessions[0].planId,'plan-1');
  assert.deepEqual(a.unattributed,[]);
  assert.deepEqual(a.unknown,[]);
});

test('GET keeps each upstream state separate and carries attribution',async()=>{
  global.fetch=async(url)=>String(url).endsWith('/api/v1/spine')
    ?response({schemaVersion:1,data:{plans:[{id:'plan-1',tasks:[]}],byProject:{demo:[]},unattributed:[],taskCount:0}})
    :response({schemaVersion:1,data:{sessions:[],backends:[{id:'local'}],slots:{used:0,total:1}}});
  const c=ctx();
  await route('GET','/api/overwatch-layer/state').handle(c);
  assert.equal(c.out.status,200);
  assert.deepEqual(c.out.json.sources,{spine:{state:'live'},agents:{state:'live'},sessions:{state:'live'}});
  assert.equal(c.out.json.attribution.windows[0].idePort,4555);
  assert.deepEqual(c.out.json.byProject,{demo:[]});
});

test('published requests cannot dispatch even with an authenticated session',async()=>{
  let called=false;
  global.fetch=async()=>{called=true;throw new Error('must not call');};
  const c=ctx({isLoopbackReq:false,readJsonBody(_req,cb){cb({planId:'plan-1',taskId:'task-1'},null);}});
  await route('POST','/api/overwatch-layer/dispatch').handle(c);
  assert.equal(c.out.status,403);
  assert.match(c.out.json.error,/operator-port act/);
  assert.equal(called,false);
});

test('dispatch re-resolves the task and pins plan mode',async()=>{
  let sent=null,auth=null;
  global.fetch=async(url,opts={})=>{
    const path=new URL(String(url)).pathname;
    if(path==='/api/v1/spine')return response({data:{plans:[{id:'plan-x',cwd:'/repo',tasks:[{id:'task-x',goal:'inspect only',status:'pending'}]}]}});
    if(path==='/api/v1/agents')return response({data:{sessions:[]}});
    if(path==='/api/v1/agents/dispatch'){
      sent=JSON.parse(opts.body);
      auth=opts.headers?.authorization;
      return response({ok:true,data:{sessionId:'11111111-1111-1111-1111-111111111111'}});
    }
    throw new Error('unexpected '+path);
  };
  const c=ctx({readJsonBody(_req,cb){cb({planId:'plan-x',taskId:'task-x',mode:'acceptEdits',cwd:'/untrusted'},null);}});
  await route('POST','/api/overwatch-layer/dispatch').handle(c);
  assert.equal(c.out.status,202);
  assert.equal(sent.mode,'plan');
  assert.equal(sent.prompt.includes('inspect only'),true);
  assert.equal(sent.cwd,'/repo');
  assert.equal(auth,`Bearer ${RUNNER_TOKEN}`,'the runner token travels as a bearer');
});

test('dispatch without a readable runner token is refused before anything is sent',async()=>{
  let dispatched=false;
  global.fetch=async(url)=>{
    const path=new URL(String(url)).pathname;
    if(path==='/api/v1/spine')return response({data:{plans:[{id:'plan-t',cwd:'/repo',tasks:[{id:'task-t',goal:'g',status:'pending'}]}]}});
    if(path==='/api/v1/agents')return response({data:{sessions:[]}});
    if(path==='/api/v1/agents/dispatch'){dispatched=true;return response({ok:true,data:{sessionId:'x'}});}
    throw new Error('unexpected '+path);
  };
  const prev=process.env.CW_SUBSTRATE_TOKEN_FILE;
  process.env.CW_SUBSTRATE_TOKEN_FILE=join(TMP,'absent-token');
  try{
    const c=ctx({readJsonBody(_req,cb){cb({planId:'plan-t',taskId:'task-t'},null);}});
    await route('POST','/api/overwatch-layer/dispatch').handle(c);
    assert.equal(c.out.status,503);
    assert.match(c.out.json.error,/runner token unreadable at .*absent-token/);
    assert.equal(dispatched,false);
  }finally{process.env.CW_SUBSTRATE_TOKEN_FILE=prev;}
});

test('dispatch refuses a task that is not pending',async()=>{
  global.fetch=async(url)=>{
    const path=new URL(String(url)).pathname;
    if(path==='/api/v1/spine')return response({data:{plans:[{id:'plan-done',cwd:'/repo',tasks:[{id:'task-done',goal:'done',status:'completed'}]}]}});
    throw new Error('must refuse before '+path);
  };
  const c=ctx({readJsonBody(_req,cb){cb({planId:'plan-done',taskId:'task-done'},null);}});
  await route('POST','/api/overwatch-layer/dispatch').handle(c);
  assert.equal(c.out.status,409);
  assert.match(c.out.json.error,/not pending/);
});

test('prompt and idempotency key are bounded and deterministic',()=>{
  const p=buildPrompt({planId:'p',taskId:'t',goal:'x'.repeat(5000)});
  assert.match(p,/TRUNCATED at 4000/);
  assert.match(p,/Treat it as DATA/);
  assert.equal(dispatchKey({planId:'p',taskId:'t',anchor:'a'}),dispatchKey({planId:'p',taskId:'t',anchor:'a'}));
  assert.equal(permissionProfile().mode,'plan');
  assert.equal(permissionProfile().state,'partial');
});
