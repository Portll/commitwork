import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPanelDocument, inlineStyleSources } from '../lib/panel-document.mjs';
import { panelSource } from './lib/panel-source.mjs';

const html=readPanelDocument();
const SRC=panelSource('index.html');
const nav=readFileSync(new URL('../menus/navigation.js',import.meta.url),'utf8');
const model=new Function('curView', 'TAB_GROUPS_EXTRA', nav.slice(0,nav.indexOf("$('check-picker').onchange"))+';return {workspaceOf,findingCategory,WORKSPACE_DEFAULTS,scopeOf};')('fleet', {newscanner:'static',newunknown:'other'});
const railRoutes=[...readFileSync(new URL('../menus/section-rail.html',import.meta.url),'utf8').matchAll(/data-route="([a-z]+)"/g)].map(m=>m[1]);

test('all six project tasks have real existing landing views, each about the project',()=>{
  assert.deepEqual(Object.keys(model.WORKSPACE_DEFAULTS),['summary','findings','surface','map','work','history']);
  for(const [section,view] of Object.entries(model.WORKSPACE_DEFAULTS)){
    assert.equal(model.workspaceOf(view),section);
    assert.equal(model.scopeOf(view),'project',view);
  }
});
test('fleet and project pages never share a workspace',()=>{
  for(const v of ['fleet','projects','verdicts','oversight','overwatch','cra','stpa','bola'])assert.equal(model.workspaceOf(v),'fleet',v);
  for(const v of ['overview','dashboard','lanes','posture','sast','sitemap','remediation','timeline','report'])assert.equal(model.scopeOf(v),'project',v);
  assert.equal(model.scopeOf('profile'),'account');
});
test('every All-projects rail link opens a fleet page, and the picker sits in the top bar after the rollup countdown',()=>{
  const fleetLinks=railRoutes.filter(r=>model.workspaceOf(r)==='fleet');
  assert.deepEqual(fleetLinks,['fleet','rollups','remfleet','projects','overwatch','verdicts','cra']);
  for(const r of railRoutes)assert.notEqual(model.scopeOf(r),'project',r);
  const rail=html.slice(html.indexOf('id="workspace-rail"'),html.indexOf('</aside>'));
  assert.doesNotMatch(rail,/id="proj"/);
  const bar=html.slice(html.indexOf('<header class="bar">'),html.indexOf('</header>'));
  assert.ok(bar.indexOf('id="gen"')>-1&&bar.indexOf('id="proj"')>bar.indexOf('id="gen"'),'the picker follows the rollup countdown in the top bar');
  assert.match(html,/id="scope-chip"/);
});
test('specialist and generated checks stay reachable and quality stays separate',()=>{
  for(const v of ['sast','secrets','depsgo','newscanner']){
    assert.equal(model.workspaceOf(v),'findings');assert.equal(model.findingCategory(v),'security');
  }
  for(const v of ['denolint','denotypes','stubs','comments'])assert.equal(model.findingCategory(v),'quality');
  assert.equal(model.findingCategory('a11y'),'accessibility');
  assert.equal(model.findingCategory('newunknown'),'other');
  assert.equal(model.workspaceOf('held'),'manage');
  assert.equal(model.workspaceOf('delivery'),'work');
  assert.equal(model.workspaceOf('verdicts'),'fleet');
});
test('composition resolves every marker and preserves security form IDs exactly once',()=>{
  assert.doesNotMatch(html,/<!-- menu:|^\/\/ menu:/m);
  for(const id of ['workspace-rail','menupop','proj','logout','reauth','pwblock','pkenroll','health','ph-restart'])assert.equal([...html.matchAll(new RegExp(`id="${id}"`,'g'))].length,1,id);
  const account=readFileSync(new URL('../menus/account-menu.html',import.meta.url),'utf8');
  assert.doesNotMatch(account,/id="pwblock"|id="pkenroll"|role="menu"/);
  assert.match(html.slice(html.indexOf('id="view-profile"')),/id="pwblock"/);
  assert.match(inlineStyleSources(html),/^'sha256-[A-Za-z0-9+/]+=*'$/);
});
test('every assembled script parses after the component split',()=>{
  for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script\b[^>]*>/gi))if(m[1].trim())assert.doesNotThrow(()=>new Function(m[1]));
});

test('the compatibility entry is complete and matches the component sources',()=>{
  const entry=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.equal(entry.slice(entry.indexOf('\n')+1),html,'run node bin/build-admin-panel.mjs after editing components');
  assert.match(entry,/id="proj"/);
  assert.match(entry,/id="workspace-rail"/);
  assert.doesNotMatch(entry,/<!-- menu:|^\/\/ menu:/m);
});

// The handler is lifted from the assembled panel and run against stubs, so this asserts what a
// project change DOES, not what its source says.
function runProjectChange(curView,value){
  const start=SRC.indexOf("$('proj').onchange=e=>{");
  assert.ok(start>-1,'the project picker handler moved; update this lift');
  const end=SRC.indexOf('};\n',start);
  const calls=[];
  const handlerSrc=SRC.slice(start+"$('proj').onchange=".length,end+1);
  const handler=new Function('scopeOf','setView','applyGroup','load','localStorage','curViewRef',
    `let curProj='',curView=curViewRef;const $=()=>({style:{}});return ${handlerSrc};`)(
    model.scopeOf,(v)=>calls.push(['setView',v]),(v)=>calls.push(['applyGroup',v]),()=>calls.push(['load']),
    {setItem(){}},curView);
  try{handler({target:{value}});}catch(e){/* the project-page branch touches history/iframes; its calls are already recorded */}
  return calls;
}
test('choosing a project on a fleet page keeps the reader on that page',()=>{
  for(const v of ['fleet','projects','settings','verdicts']){
    const calls=runProjectChange(v,'commitwork');
    assert.ok(!calls.some(c=>c[0]==='setView'),`${v}: a project change must not move the view (${JSON.stringify(calls)})`);
    assert.ok(calls.some(c=>c[0]==='applyGroup'&&c[1]===v),`${v}: the rail re-evaluates for the new project`);
  }
});
test('clearing the project on a project page is the one move that leaves it',()=>{
  assert.deepEqual(runProjectChange('sast','')[0],['setView','fleet']);
});
