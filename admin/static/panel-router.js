// admin/static/panel-router.js — part 5 of 8 of the panel client.
//
// the operator-port views, Profile, ROUTER STATE, the R1 integrity renderers, Projects, vision
// palettes and the URL routes. The two-level navigation is admin/menus/navigation.js, loaded next.
//
// Classic scripts, not modules. The eight parts, and the two menu components admin/panel.html
// inlines between them from admin/menus/*.js, share one global lexical scope and run in the order
// panel.html lists them, so reordering them changes when a top-level declaration becomes visible.
// A function declaration is hoisted only within its own script: top-level code may call what an
// earlier script declares, never a later one. That is why panel-boot.js, whose setView() reaches
// loaders in every part, is loaded last.
//
// Every part is declared in STATIC_JS_MODULES in admin/serve.mjs; static/ is an allowlist, so a
// file added here without that entry is never served.

// ── the source-bearing three (operator port only; the server refuses off it regardless) ─────────
async function issCopy(d,b,st){
  st.textContent='';
  try{
    const r=await fetch('/api/issue/prompt?id='+encodeURIComponent(d.id));
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||('HTTP '+r.status));
    await navigator.clipboard.writeText(j.prompt);
    b.textContent='copied ✓'; setTimeout(()=>{ b.textContent='copy prompt'; },1400);
  }catch(e){ st.textContent='could not copy — '+e.message; }
}

async function issClaude(d,st){
  st.textContent='launching…';
  try{
    const r=await cwPost('/api/issue/claude',{headers:{'content-type':'application/json'},body:JSON.stringify({id:d.id})});
    const j=await r.json().catch(()=>({}));
    st.textContent=(r.ok&&j.started)
      ?'launched via '+esc(j.via)+' — handoff saved: '+esc(j.file||'')+(j.watch?' · '+esc(j.watch):'')
      :(j.error||('refused ('+r.status+')'));
  }catch(err){ st.textContent='could not reach the server: '+err.message; }
}

async function issLocal(d,out,st){
  if(out.dataset.open==='1'){ out.innerHTML=''; out.dataset.open=''; return; }
  st.textContent='detecting local engines…';
  let t;
  try{ const r=await fetch('/api/issue/llm/targets'); t=await r.json(); if(!r.ok)throw new Error(t.error||('HTTP '+r.status)); }
  catch(e){ st.textContent='could not reach the server — '+e.message; return; }
  const engines=t.engines||[];
  // THREE STATES, NOT ONE. "switched off", "on but nothing enabled" and "enabled, nothing answered"
  // are different facts and only the last is about the machine. Collapsing them — which this line
  // used to do — tells an operator who deliberately disabled runners that no model is installed.
  if(t.posture==='disabled'){ st.textContent=(t.why||'local model runners are switched off')+' — Settings \u25b8 Local models'; return; }
  if(t.posture==='none-enabled'){ st.textContent='runners are allowed but no host is switched on yet — Settings \u25b8 Local models'; return; }
  if(!engines.some(x=>x.up&&(x.models||[]).length)){ st.textContent='no enabled host answered — start one and click again'; return; }
  st.textContent='';
  // A DOWN engine keeps its row with a stated reason rather than vanishing: "not detected" and
  // "not offered" must not look alike. Order and label both come from the server, which reads
  // manifests/llm-hosts.json; the client keeps no host list of its own.
  const MARK={lmstudio:'<span aria-hidden="true" class="mark-lm">LM</span>'};
  const LABEL=Object.fromEntries(engines.map(e=>[e.name,e.label||e.name]));
  out.innerHTML=engines.map(x=>{
    // See the same note on the remediation panel: a shared port cannot identify a host.
    const named=esc(LABEL[x.name]||x.name)+(x.identified===false?' <span class="mut t-note">(port shared — unconfirmed)</span>':'');
    const head='<span class="eng-head">'+(MARK[x.name]||'')+'<b class="sans t-body">'+named+'</b></span>';
    if(!x.up)return '<div class="rp-eng eng-down">'+head+'<span class="mut t-note">down — nothing listening at '+esc(x.url)+'</span></div>';
    if(!(x.models||[]).length)return '<div class="rp-eng eng-down">'+head+'<span class="mut t-note">up, but no models loaded</span></div>';
    return '<div class="rp-eng">'+head
      +'<select class="rp-model" data-engine="'+esc(x.name)+'" aria-label="'+esc('model for the '+(LABEL[x.name]||x.name)+' run on '+d.id)+'">'
      +x.models.map(m=>'<option value="'+esc(m)+'">'+esc(m)+'</option>').join('')+'</select>'
      +'<button type="button" data-run="'+esc(x.name)+'">run triage</button></div>';
  }).join('')+'<div class="rp-out"></div>';
  out.dataset.open='1';
  out.querySelectorAll('button[data-run]').forEach(btn=>{ btn.onclick=async()=>{
    const engine=btn.dataset.run;
    const model=btn.parentElement.querySelector('.rp-model').value;
    const box=out.querySelector('.rp-out');
    btn.disabled=true;
    box.innerHTML='<div class="mut t-note">running '+esc(engine)+':'+esc(model)+' — a cold load of a big model can take minutes…</div>';
    try{
      const r=await cwPost('/api/issue/llm',{headers:{'content-type':'application/json'},
        body:JSON.stringify({id:d.id,engine,model})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){ box.innerHTML='<div class="mut t-note">'+esc(j.error||('refused ('+r.status+')'))+'</div>'; return; }
      box.innerHTML='<div class="verdict-line">verdict <b>'+esc(j.verdict||'none — the model gave no VERDICT line')+'</b>'
        +(j.confidence?' · confidence '+esc(j.confidence):'')
        +(j.truncated?' · <span class="pill part">truncated</span>':'')
        +' <span class="mut">recorded as evidence of a claim; it closes nothing</span></div>'
        +(j.thinking?'<pre class="blk-pre blk-thinking">'+esc(j.thinking)+'</pre>':'')
        +'<pre class="blk-pre">'+esc(j.answer||'')+'</pre>';
    }catch(err){ box.innerHTML='<div class="pk-err">could not reach the server: '+esc(err.message)+'</div>'; }
    finally{ btn.disabled=false; }
  }; });
}

// Delegated, so a re-rendered table keeps the handler. A click inside an open detail panel must not
// collapse the row out from under the form being filled in.
document.addEventListener('click',(e)=>{
  if(!e.target.closest)return;
  if(e.target.closest('tr.iss-det'))return;
  const tr=e.target.closest('tr.iss-row'); if(!tr)return;
  issToggle(tr.dataset.iss);
},false);
// ── Profile — the account this browser is signed in as ────────────────────────────────────────
// One fetch (/api/me), three renderers. Everything here turns on a THREE-valued read of that
// route — signed in, nobody signed in (401), or could not tell (any other status, an unreachable
// server, a body that will not parse) — because the third must never collapse into the second.
// "The request failed" is not "you have no second factor and no linked GitHub": one is an unread
// account, the other is a description of one, and rendering them alike is the grey-as-green
// mistake this panel exists to refuse.
//
// Declared above setView so the router can call into it (and clear the enrolment secret) without
// tripping the temporal dead zone on the state below during the boot-time setView().
let pfMe=null;           // last good /api/me payload
let pfKind='loading';    // 'loading' | 'ok' | 'anon' | 'error'
let pfError='';
// The GitHub link callback returns to /profile/?github=<outcome>. Read at load, because the
// router's boot-time replaceState drops the query before /api/me answers. Codes, not text: an
// unknown code shows nothing, so the URL can never put words on the page.
let pfGhOutcome=(()=>{try{return new URLSearchParams(location.search).get('github');}catch(_){return null;}})();
const PF_GH_OUTCOME={
  linked:['linked — for display only; it grants no way in','ok'],
  denied:['GitHub reported that access was not granted — nothing was linked','err'],
  session:['that link was started by another session, or this one ended — nothing was linked. Start again from this page.','err'],
  unavailable:['GitHub linking is not available on this box — nothing was linked','err'],
  failed:['GitHub did not complete the exchange or did not identify the account — nothing was linked (the panel log has the detail)','err'],
  refused:['GitHub returned an account this panel could not record — nothing was linked','err'],
  taken:['that GitHub account is already linked to another panel user — nothing was linked','err'],
};
// ── ROUTER STATE — every `let` setView() touches MUST be declared here, above it ────────────────
// setView() runs at BOOT (`setView(urlView(),true)`), before the rest of the script has executed.
// Any `let`/`const` it reads that is declared further down is in its temporal dead zone at that
// moment, so touching it throws a ReferenceError out of the top level — and everything after that
// line never runs: the initial load(), the 8s poll, initOauth(). The panel renders its static shell
// and nothing else, which looks like "the project picker is empty" rather than like a crash.
//
// This is the SECOND time: the note above says pfMe/pfKind/pfError were moved here for exactly this
// reason, and craTickTimer was then added below setView and re-broke it — live, on the published
// panel, for as long as it took someone to restart the process. A hoist fixes one variable; the
// test that boots this script (admin/test/panel-boot.test.mjs) is what makes the next one fail in
// CI instead of in production.
let craSkewMs=0, craCases=[], craTickTimer=null, craClockSpec=null, craPaged=new Set();
let dtData=null;
// THE FOURTH TIME, and it hid behind TWO gaps the earlier three did not have.
//
// setView calls loadCodeql() when the view is codeql, and boot enters whatever view the URL names,
// so on /codeql/ these were read ~950 lines above their old declaration site. Reported live on
// commitwork.online/codeql/ 2026-08-27: `Cannot access 'cqJobsError' before initialization`.
//
// GAP 1 — only one view. The previous three (pfMe, craTickTimer, LEARN) broke the DEFAULT view, so
// booting at '/' caught them. A `let` that only ONE loader touches is in its dead zone only when
// that view is the entry point.
//
// GAP 2 — and this is the one that makes it quiet. loadCodeql is ASYNC and setView does not await
// it, so the ReferenceError becomes an UNHANDLED REJECTION, not a top-level throw. Unlike the
// earlier three this does NOT kill the script: the panel boots, the picker fills, the poll runs,
// and only the codeql view is left empty — reading as "no CodeQL data" rather than as a crash. A
// test that wrapped boot in assert.doesNotThrow would go green on it, and did.
//
// The boot test now boots EVERY view AND captures unhandled rejections. Both halves were needed:
// with only the first it still passed against this exact defect.
let cqFleet=null, cqJobs={}, cqJobsArr=[], cqJobsError=null, cqOpen=null, cqPoll=null, cqConsoleOn=false;
// The enrolment secret lives HERE and nowhere else — no localStorage, no data- attribute, no copy
// left behind in the markup. /api/me/totp/reissue hands it over exactly once and the server has no
// route that will ever show it again, so this variable IS the operator's only copy: dropping it
// and re-rendering is the whole of "forget it". Cleared on confirm, on disable, on the dismiss
// button, and on leaving the tab.
let pfEnrolOnce=null;
// Forgetting SCRUBS THE MARKUP too, not just the variable: hiding the tab leaves the section's
// innerHTML intact, so dropping the variable alone would leave the secret sitting in the DOM of a
// page the operator has walked away from.
function forgetEnrolSecret(){ if(!pfEnrolOnce)return; pfEnrolOnce=null; renderProfile(); }
const pfOn=(id,fn)=>{const el=$(id); if(el)el.onclick=fn;};
// status line under a control group. kind: '' | 'ok' | 'err' — colour is never the only channel,
// the sentence itself says which way it went.
function pfMsg(id,text,kind){const el=$(id); if(!el)return; el.textContent=text; el.className='pf-msg'+(kind?' '+kind:'');}
// cwPost RETURNS the response rather than throwing on a refusal (same trap the SSO switch
// documents), so every caller must read r.ok — otherwise a server that said no reads as a yes.
async function pfPost(url,body){
  let r;
  try{ r=await cwPost(url, body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}); }
  catch(e){ return {ok:false,error:'could not reach the server'}; }
  let j={}; try{ j=await r.json(); }catch(_){ /* a refusal with no JSON body is still a refusal */ }
  return r.ok ? {ok:true,data:j} : {ok:false,error:j.error||('HTTP '+r.status)};
}
async function loadProfile(){
  let r;
  try{ r=await fetch('/api/me'); }
  catch(e){ pfMe=null; pfKind='error'; pfError='could not reach the server ('+e.message+')'; return renderProfile(); }
  // 401 is the ONLY status that means "nobody is logged in" — every other failure leaves the
  // account unread, which is a different sentence on screen.
  if(r.status===401){ pfMe=null; pfKind='anon'; pfError=''; return renderProfile(); }
  if(!r.ok){ pfMe=null; pfKind='error'; pfError='the server refused the request (HTTP '+r.status+')'; return renderProfile(); }
  let d; try{ d=await r.json(); }catch(e){ pfMe=null; pfKind='error'; pfError='the reply was not readable JSON'; return renderProfile(); }
  if(!d||d.ok===false||!d.email){ pfMe=null; pfKind='error'; pfError=(d&&d.error)||'the reply did not describe an account'; return renderProfile(); }
  pfMe=d; pfKind='ok'; pfError=''; renderProfile();
}
// The linked-GitHub card as HTML, so every state renders without a DOM. "not linked" is a settled
// answer (the account was read and holds nothing), so it gets the quiet n/a pill rather than grey —
// grey is renderProfile's unread branch.
function pfGithubCard(me){
  const gh=me.github&&me.github.login?me.github.login:null;
  const msg='<div class="pf-msg" id="pf-gh-msg" role="status"></div>';
  if(gh)return '<div class="card"><div class="pf-state">'+pill('live','linked')+'<code class="pf-who">@'+esc(gh)+'</code></div>'
    +'<div class="pf-acts"><button type="button" id="pf-gh-unlink">unlink</button></div>'
    +'<div class="pf-note">Unlinking removes the recorded login and id. The panel keeps no GitHub token, so there is nothing here to revoke; an authorisation granted by signing in is listed under GitHub → Settings → Applications.</div>'
    +msg+'</div>';
  // no status is the server not saying, which is not the same as available
  const st=me.githubLink||{available:false,reason:'this server did not report whether GitHub linking is available'};
  const why=st.available?'':(st.reason||'GitHub linking is not available on this box');
  return '<div class="card"><div class="pf-state">'+pill('na','not linked')+'</div>'
    +'<div class="pf-acts"><button type="button" class="pri" id="pf-gh-oauth"'+(why?' disabled aria-describedby="pf-gh-why"':'')+'>sign in with GitHub to link</button></div>'
    +(why
      ? '<div class="pf-note" id="pf-gh-why">'+esc(why)+'</div>'
      : '<div class="pf-note">GitHub is asked for your public profile only (<code>read:user</code>). The login and numeric id it returns are recorded; the token is discarded.</div>')
    +'<details class="pf-manual"><summary>enter manually</summary><div class="pf-form">'
      +'<div class="pf-field"><label for="pf-gh-login">github login</label><input class="pf-input" id="pf-gh-login" type="text" autocomplete="off" spellcheck="false" maxlength="39"></div>'
      +'<div class="pf-field"><label for="pf-gh-id">numeric user id</label><input class="pf-input" id="pf-gh-id" type="text" inputmode="numeric" autocomplete="off" spellcheck="false"></div>'
      +'<button type="button" id="pf-gh-link">link</button></div>'
      +'<div class="pf-note">The id is the numeric one GitHub itself issues (<code>api.github.com/users/&lt;login&gt;</code> → <code>id</code>), not the login again — the server records only what an OAuth response could have resolved.</div>'
    +'</details>'
    +msg+'</div>';
}
function renderProfile(){
  const idBox=$('pf-identity'), tBox=$('pf-totp'), gBox=$('pf-github');
  if(!idBox||!tBox||!gBox)return;
  const n=$('pf-n'), tn=$('pf-totp-n'), gn=$('pf-gh-n');
  if(pfKind==='loading'){
    if(n)n.textContent='—'; if(tn)tn.textContent='—'; if(gn)gn.textContent='—';
    idBox.innerHTML='<span class="mut">loading…</span>'; tBox.innerHTML='<span class="mut">loading…</span>'; gBox.innerHTML='<span class="mut">loading…</span>';
    return;
  }
  if(pfKind!=='ok'){
    const anon=pfKind==='anon';
    if(n)n.textContent=anon?'no session':'identity unreadable';
    if(tn)tn.textContent='unknown'; if(gn)gn.textContent='unknown';
    idBox.innerHTML='<div class="card"><div class="pf-state">'+pill(anon?'plan':'crit',anon?'nobody signed in':'could not read the identity')+'</div>'
      +'<div class="pf-note">'+(anon
        ? 'This browser holds no session, so there is no account to describe and no signature to record. Anything accepted or annotated from here is filed as <b>unknown</b> — which is exactly how it will read to whoever audits it later. Sign in from the ≡ menu, top right. (The boards on this panel are ungated on the operator port; an identity is not something loopback can supply, so this page asks for a session either way.)'
        : 'The identity request failed — '+esc(pfError)+'. Nothing below was read, so nothing below is a finding about this account.')
      +'</div><div class="pf-acts"><button type="button" id="pf-retry">check again</button></div></div>';
    // Both panels below say UNKNOWN, not "off" and not "none". The whole point of the tab is the
    // signature, and inventing a benign answer about an account we never saw is how a page starts
    // lying about credentials.
    const why=anon
      ? 'No account is in view, so this is neither on nor off — it is not something this page can see while nobody is signed in.'
      : 'The identity request failed, so this was never read. It is not a determination that nothing is enrolled.';
    tBox.innerHTML='<div class="card"><div class="pf-state">'+pill('plan','unknown')+'</div><div class="pf-note">'+why+'</div></div>';
    gBox.innerHTML='<div class="card"><div class="pf-state">'+pill('plan','unknown')+'</div><div class="pf-note">'+(anon
      ? 'No account is in view, so whether a GitHub login is linked is unknown — a failed or absent read is never "not linked".'
      : 'The identity request failed, so whether a GitHub login is linked was never read — that is not the same as "not linked".')+'</div></div>';
    pfOn('pf-retry',()=>loadProfile());
    return;
  }

  // ── identity ────────────────────────────────────────────────────────────────────────────────
  const unk='<span class="who-unknown" title="not reported — not a value to be guessed at">unknown</span>';
  const age=(typeof pfMe.sessionAgeMs==='number'&&isFinite(pfMe.sessionAgeMs)&&pfMe.sessionAgeMs>=0)?esc(AGO(pfMe.sessionAgeMs)):unk;
  if(n)n.textContent=pfMe.email;
  idBox.innerHTML='<div class="card">'
    +'<div class="pf-state">'+pill('live','signed in')+'<b class="pf-who">'+esc(pfMe.email)+'</b></div>'
    +'<div class="kv"><span class="mut">auth provider</span><span>'+(pfMe.provider?esc(pfMe.provider):unk)+'</span></div>'
    +'<div class="kv"><span class="mut">session opened</span><span class="tnum">'+age+'</span></div>'
    // the class here is the same one the ledger feeds use, so this row and an annotation's
    // signature are rendered by one rule rather than two that can drift apart
    +'<div class="kv"><span class="mut">signs ledger entries as</span><span class="who-human" title="classified human — a person signed in, not an agent writing on one’s behalf">'+esc(pfMe.email)+'</span></div>'
    +'</div>';

  // ── second factor · three states, and the middle one is real ────────────────────────────────
  // confirmed: enforced. enrolled-not-confirmed: a secret exists that no code has ever been
  // checked against — provisioned-looking, enforcement OFF. off: no secret at all. Each gets its
  // own pill, and grey stays reserved for the unknown branch above.
  const confirmed=!!pfMe.totpConfirmed, enrolled=!!pfMe.totpEnrolled;
  const tState=confirmed?['live','on — confirmed','A code from your authenticator is required at sign-in.']
    :enrolled?['part','enrolled, never proven','A secret is on the account but no code has ever been checked against it, so enforcement is <b>off</b>. Confirm it below, or issue a new one if the old QR is gone.']
    :['high','off — no second factor','This account signs in with its password alone. On a panel published through a tunnel, that is the whole of the front door.'];
  if(tn)tn.textContent=confirmed?'confirmed':enrolled?'enrolled, unconfirmed':'off';
  let t='<div class="card"><div class="pf-state">'+pill(tState[0],tState[1])+'</div><div class="pf-note">'+tState[2]+'</div>';
  if(pfEnrolOnce){
    // Shown once, in this render only. Both fields carry the same secret — the URI for a scanner,
    // the base32 for an authenticator that wants it typed.
    t+='<div class="pf-once"><b>Shown once.</b> Neither string is stored by this page or retrievable from the server again; if it is lost the only way forward is another re-issue, which invalidates this one.'
      +'<div class="pf-note">Point your phone\'s camera at the code: it offers to add Commitwork to the phone\'s own authenticator (Passwords on an iPhone, the default authenticator on Android), and any authenticator app can scan it too. On the phone itself, use the link. Then enter the 6-digit code it shows below.</div>'
      +'<div class="pf-qr" id="pf-qr" aria-hidden="true"></div>'
      +'<p><a class="pf-oa" href="'+esc(pfEnrolOnce.otpauth||'#')+'">Add to this device\'s authenticator</a></p>'
      +'<code>'+esc(pfEnrolOnce.otpauth||'')+'</code><code>'+esc(pfEnrolOnce.secret||'')+'</code>'
      +'<div class="pf-acts"><button type="button" id="pf-forget">I have scanned it — hide</button></div></div>';
  }
  if(confirmed){
    t+='<div class="pf-form">'
      +'<div class="pf-field"><label for="pf-dcode">current code</label><input class="pf-input" id="pf-dcode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" spellcheck="false"></div>'
      +'<button type="button" id="pf-disable">turn off</button>'
      +'<button type="button" id="pf-enrol">re-issue a secret</button></div>'
      +'<div class="pf-note">Turning it off needs a valid code from the authenticator you have now — a session cookie alone must not be enough to strip the second factor. Re-issuing turns enforcement <b>off</b> until the new secret is confirmed.</div>';
  }else if(enrolled){
    t+='<div class="pf-form">'
      +'<div class="pf-field"><label for="pf-pass">account password</label><input class="pf-input" id="pf-pass" type="password" autocomplete="current-password"></div>'
      +'<div class="pf-field"><label for="pf-code">code from the authenticator</label><input class="pf-input" id="pf-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" spellcheck="false"></div>'
      +'<button type="button" class="pri" id="pf-confirm">confirm and turn on</button>'
      +'<button type="button" id="pf-enrol">issue a new secret</button></div>'
      +'<div class="pf-note">The password is asked for as well as the code: confirming is the act that flips enforcement on, and that is the one moment a stolen session cookie must not be sufficient by itself.</div>';
  }else{
    t+='<div class="pf-acts"><button type="button" class="pri" id="pf-enrol">issue a secret</button></div>';
  }
  // role=status: the outcome of confirming or disabling a second factor is the one thing on this
  // page a screen reader must hear without going looking for it. The element is written by the
  // render and only ever updated by textContent afterwards, so it is live before the change lands.
  t+='<div class="pf-msg" id="pf-totp-msg" role="status"></div></div>';
  tBox.innerHTML=t;
  // email code — the second factor by mail
  const ef=!!(pfMe.emailFactor??(pfMe.factors&&pfMe.factors.emailFactor));
  tBox.insertAdjacentHTML('beforeend','<div class="card"><div class="pf-state">'+pill(ef?'live':'plan',ef?'email code — on':'email code — off')+'</div><div class="pf-note">'
    +(ef?'A 6-digit code is emailed at sign-in while no authenticator is confirmed, and accepted beside one when it is.':'Turn on to receive a 6-digit sign-in code by email. The box needs a mail transport (RESEND_API_KEY in the keychain, or SMTP) or the code cannot be sent.')
    +'</div><div class="pf-acts"><input id="pf-ef-pw" type="password" placeholder="current password" autocomplete="current-password"> <button type="button" id="pf-ef-toggle">'+(ef?'turn off':'turn on')+'</button> <span class="mut" id="pf-ef-msg"></span></div></div>');
  pfOn('pf-ef-toggle',async()=>{
    const msg=$('pf-ef-msg'); msg.textContent='saving…';
    try{
      const r=await cwPost('/api/me/email-factor',{headers:{'content-type':'application/json'},body:JSON.stringify({enabled:!ef,password:$('pf-ef-pw').value})});
      const j=await r.json();
      if(!j.ok){msg.innerHTML='<b>refused:</b> '+esc(j.error||'unknown');return;}
      loadProfile();
    }catch(e){msg.innerHTML='<b>failed: '+esc(String(e.message))+' — nothing changed</b>';}
  });
  // fact: the hide button has read 'I have scanned it' since it was written, above two strings
  // and no QR / one change wired the encoder into the LOGIN page's enrolment screen and stopped
  // there, so the panel's own re-issue still asked for a 32-character key to be retyped — the
  // same defect one screen over, and the button's wording is what makes it visible
  // (expiry: never, prev: missing)
  // Dynamic import for the same reason the login page uses one: renderProfile runs on every
  // visit to the view, and the encoder is only needed in the one-shot branch below.
  if(pfEnrolOnce&&pfEnrolOnce.otpauth){
    (async()=>{
      const box=$('pf-qr'); if(!box)return;
      try{
        const {encodeQR,qrToSvg}=await import('/static/qrcode.mjs');
        box.innerHTML=qrToSvg(encodeQR(pfEnrolOnce.otpauth),{moduleSize:6});
      }catch(e){
        // Fails OPEN to the two strings beside it: a broken encoder must cost the shortcut,
        // never the enrolment. Left empty rather than showing a broken-image state.
        box.textContent='';
      }
    })();
  }

  // ── linked GitHub ───────────────────────────────────────────────────────────────────────────
  const gh=pfMe.github&&pfMe.github.login?pfMe.github.login:null;
  if(gn)gn.textContent=gh?'linked':'not linked';
  gBox.innerHTML=pfGithubCard(pfMe);
  if(pfGhOutcome){
    const o=Object.prototype.hasOwnProperty.call(PF_GH_OUTCOME,pfGhOutcome)?PF_GH_OUTCOME[pfGhOutcome]:null;
    pfGhOutcome=null; if(o)pfMsg('pf-gh-msg',o[0],o[1]);
  }

  // ── handlers, rebound on every render (innerHTML replaced the elements they sat on) ──────────
  pfOn('pf-forget',()=>forgetEnrolSecret());
  pfOn('pf-enrol',async()=>{
    pfMsg('pf-totp-msg','issuing a new secret…');
    const r=await pfPost('/api/me/totp/reissue');
    if(!r.ok){ pfMsg('pf-totp-msg','could not issue a secret — '+r.error,'err'); return; }
    // a re-issue resets totpConfirmed server-side, so re-read the account rather than patching
    // the copy in hand — the state on screen must be the state on disk
    pfEnrolOnce={secret:r.data.totpSecret,otpauth:r.data.otpauth};
    await loadProfile();
    pfMsg('pf-totp-msg','secret issued — scan it, then confirm with a code. Enforcement stays off until you do.');
  });
  pfOn('pf-confirm',async()=>{
    const pass=$('pf-pass'), code=$('pf-code');
    pfMsg('pf-totp-msg','confirming…');
    const r=await pfPost('/api/me/totp/confirm',{password:pass?pass.value:'',token:code?code.value.trim():''});
    if(pass)pass.value='';   // never leave the password sitting in a field behind a re-render
    if(!r.ok){ pfMsg('pf-totp-msg',r.error,'err'); return; }
    forgetEnrolSecret();     // enrolment is over — the secret leaves the page with this render
    await loadProfile();
    pfMsg('pf-totp-msg','confirmed — sign-in now requires a code','ok');
  });
  pfOn('pf-disable',async()=>{
    const code=$('pf-dcode');
    pfMsg('pf-totp-msg','checking the code…');
    const r=await pfPost('/api/me/totp/disable',{token:code?code.value.trim():''});
    if(!r.ok){ pfMsg('pf-totp-msg',r.error,'err'); return; }
    forgetEnrolSecret();
    await loadProfile();
    pfMsg('pf-totp-msg','second factor off — the secret was deleted, so enrolling again issues a new one','ok');
  });
  pfOn('pf-gh-oauth',()=>{ location.assign('/auth/github/link'); });
  pfOn('pf-gh-link',async()=>{
    const l=$('pf-gh-login'), i=$('pf-gh-id');
    const raw=i?i.value.trim():'';
    // the server insists on a positive integer; checking here keeps the refusal legible instead of
    // bouncing a 400 whose message has to explain the field
    if(!/^[1-9][0-9]*$/.test(raw)){ pfMsg('pf-gh-msg','the numeric GitHub user id is required — that is the id, not the login','err'); return; }
    const r=await pfPost('/api/me/github',{login:l?l.value.trim():'',id:Number(raw)});
    if(!r.ok){ pfMsg('pf-gh-msg',r.error,'err'); return; }
    await loadProfile();
    pfMsg('pf-gh-msg','linked — for display only; it grants no way in','ok');
  });
  pfOn('pf-gh-unlink',async()=>{
    const r=await pfPost('/api/me/github/unlink');
    if(!r.ok){ pfMsg('pf-gh-msg',r.error,'err'); return; }
    await loadProfile();
    pfMsg('pf-gh-msg','unlinked','ok');
  });
}
let curView='overview';
// native (non-iframe) views: rendered in-page from static JSON snapshots under /reports/
// loadVerdicts — the Verdicts tab: one authed endpoint, three tables. Absence renders as its own
// state in every row; an error renders as an error, never as an empty (clean-looking) table.
async function loadOversight(){
  try{
    const d=await (await fetch('/api/oversight')).json();
    if(d.ok===false){throw new Error(d.error||'refused');}
    const rows=d.records||[];
    $('ov-n').textContent=rows.length?`${rows.length} record${rows.length===1?'':'s'}`:'none recorded';
    // The chain is stated whatever it says. A broken or torn chain beside a list of signatures is
    // the whole point of chaining them; hiding it would leave the rows looking equally trustworthy.
    const c=d.chain||{};
    const bad=(c.broken||0)+(d.torn||0);
    $('ov-chain').innerHTML=d.absent
      ?'<b>absent \u2014 no oversight has ever been recorded.</b> That is a void, not a clean read: nobody has checked anything here.'
      :`chain: ${c.verified||0} verified${c.raced?` \u00b7 ${c.raced} raced (an overlap, not an edit)`:''}${c.unchained?` \u00b7 ${c.unchained} unchained`:''}${bad?` \u00b7 <b>BROKEN \u00d7${c.broken||0}${d.torn?` + ${d.torn} torn`:''} \u2014 these rows cannot be trusted as a sequence</b>`:''}`;
    $('ov-rows').innerHTML=rows.slice().reverse().map(r=>{
      const s2=r.subject||{};
      const subj=[s2.repo,s2.file,s2.rule,s2.package].filter(Boolean).map(esc).join(' \u00b7 ')||'<span class="mut">\u2014</span>';
      const stance=r.stance==='dispute'?'<b>dispute</b>':r.stance==='corroborate'?'corroborate':`<b>${esc(String(r.stance||'?'))}</b>`;
      return `<tr><td class="mut">${esc(r.at||'\u2014')}</td><td><b class="name">${esc(r.who||'\u2014')}</b></td><td>${stance}</td><td>${subj}</td><td class="mut">${esc(r.basis||'')}</td></tr>`;
    }).join('')||'<tr><td colspan="5" class="mut">no oversight recorded \u2014 nobody has checked a determination yet. This is a void, not a pass.</td></tr>';
  }catch(e){
    $('ov-n').textContent='\u2014';
    $('ov-chain').innerHTML='';
    $('ov-rows').innerHTML='<tr><td colspan="5"><b>could not load /api/oversight \u2014 oversight state is UNKNOWN, not empty</b></td></tr>';
  }
}

// ── R1 INTEGRITY RENDERERS — pure (served state → html), extracted whole by
// admin/test/integrity-render.test.mjs. The rules, applied to EVERY cell: grey ≠ green (an
// unknown/absent state renders as its own state, never clean/fresh), violet ≠ grey (an
// uncorroborated zero is its own state, distinct from unknown), and over-reporting is as wrong
// as under (unverified-legacy is drawn, never alarmed).
function renderConservation(c){
  if(!c||c.state==='never-checked') return '<span class="pill unk">never checked</span> <span class="mut">these results predate the completeness check — no result, not a pass</span>';
  const n=(c.checked||[]).length, v=c.violations||[];
  if(!n&&!v.length) return '<span class="pill unk">nothing checkable</span> <span class="mut">no category declared a total this run — not a pass</span>';
  if(!v.length) return `<span class="pill live">conserved</span> <span class="mut">${n} categor${n===1?'y':'ies'} checked — published + truncated reconstruct every declared total</span>`;
  return `<span class="pill crit">${v.length} violation${v.length===1?'':'s'}</span>`
    +v.map(x=>`<div class="kv"><span class="mut">${esc(x.category)}</span><span>declared ${x.declared} ≠ published ${x.published} + truncated ${x.truncated} — rows minted or lost between extract and publish</span></div>`).join('');
}
function renderTimelineVerify(tv){
  if(!tv||tv.state==='no-history') return '<span class="pill unk">no history</span> <span class="mut">no scan history recorded here — nothing verified, no claim either way</span>';
  if(tv.state==='unreadable') return `<span class="pill unk">index unreadable</span> <span class="mut">history EXISTS but its index cannot be read (${esc(tv.detail||'error')}) — this is not "no history"</span>`;
  const c=tv.counts||{};
  const bits=[`<span class="pill ${(c.verified||0)>0?'live':'plan'}">${c.verified||0} verified</span>`];
  if(c['unverified-legacy']) bits.push(`<span class="pill plan">${c['unverified-legacy']} unverified-legacy</span> <span class="mut">predates sliceSha256 — its own state, drawn, never alarmed</span>`);
  // A hash mismatch is a measured integrity failure and alarms; a slice that could not be read is
  // unknown (THEME Rule 7). The server counts both as unreadable, so the slices tell them apart.
  const mism=Array.isArray(tv.slices)?tv.slices.filter(s=>s&&s.verify==='unreadable'&&s.detail==='sha256-mismatch').length:0;
  const unread=(c.unreadable||0)-mism;
  if(mism) bits.push(`<span class="pill crit">${mism} hash mismatch</span> <span class="mut">bytes do not match the recorded hash — never rendered absent</span>`);
  if(unread>0) bits.push(`<span class="pill unk">${unread} unreadable</span> <span class="mut">could not be read, so not verified either way — never rendered absent</span>`);
  return bits.join(' ')+`<div class="mut t-meta">window: newest ${tv.window} of ${tv.total} slice(s)</div>`;
}
function renderAnomalies(a){
  if(!a||a.state==='never-measured') return '<tr><td colspan="5"><span class="pill unk">never measured</span> <span class="mut">no artifact-anomalies.json — the husk detector has not run here; a void, not a pass</span></td></tr>';
  if(a.state==='unreadable') return `<tr><td colspan="5"><span class="pill unk">unreadable</span> <span class="mut">artifact-anomalies.json exists and cannot be read (${esc(a.detail||'error')}) — not zero anomalies</span></td></tr>`;
  if(!a.count) return '<tr><td colspan="5"><span class="pill live">no husks</span> <span class="mut">measured — no byte-identical zero-finding artifact group spans enough repos</span></td></tr>';
  return (a.anomalies||[]).map(x=>`<tr><td><b class="name">${esc(x.category)}</b></td><td><code>${esc(x.hash)}…</code></td><td class="tnum">${x.repoCount}</td><td class="tnum">${x.bytes}</td><td class="mut">${esc((x.repos||[]).join(', '))}${x.truncated?` <span class="mut">+${x.truncated} more</span>`:''}</td></tr>`).join('');
}
function renderFatigue(f){
  if(!f) return '<tr><td colspan="4"><span class="pill unk">not served</span> <span class="mut">the server sent no fatigue section — state UNKNOWN, not zero</span></td></tr>';
  if(f.state==='no-journal') return '<tr><td colspan="4"><span class="pill unk">no journal</span> <span class="mut">no adjudications journal has ever been written — fatigue is UNKNOWN, not zero</span></td></tr>';
  if(f.state==='unreadable') return `<tr><td colspan="4"><span class="pill unk">unreadable</span> <span class="mut">the adjudications journal cannot be read (${esc(f.detail||'error')}) — never "nothing suppressed"</span></td></tr>`;
  if(f.state==='zero-unreinforced') return '<tr><td colspan="4"><span class="pill unrf">0 — uncorroborated</span> <span class="mut">no suppression label has ever been recorded: nothing feeds this measure, which is not the same as a measured zero</span></td></tr>';
  if(f.state==='zero-corroborated') return '<tr><td colspan="4"><span class="pill live">0 — corroborated</span> <span class="mut">suppression labels exist and every target has been adjudicated</span></td></tr>';
  return (f.targets||[]).map(t=>`<tr><td><code>${esc(t.target)}</code></td><td class="tnum">${t.count}</td><td class="tnum">${t.labels}</td><td>${t.everExpiring?'<span class="mut">some expire</span>':'<span class="pill part" title="no expiry on any label — a suppression that never lapses is never re-examined">never expires</span>'}</td></tr>`).join('');
}
function renderCalibration(c){
  if(!c) return '<tr><td colspan="6"><span class="pill unk">not served</span> <span class="mut">the server sent no calibration section — state UNKNOWN, not zero</span></td></tr>';
  if(c.state==='no-records') return '<tr><td colspan="6"><span class="pill unk">no records</span> <span class="mut">no finding adjudications — calibration is UNKNOWN, not zero</span></td></tr>';
  if(c.state==='unreadable') return `<tr><td colspan="6"><span class="pill unk">unreadable</span> <span class="mut">the adjudications journal cannot be read (${esc(c.detail||'error')}) — never "calibrated clean"</span></td></tr>`;
  const rate=(r)=>r==null?'<span class="mut" title="nothing adjudicated — a rate here would be an invention">—</span>':`${Math.round(r*100)}%`;
  const rows=[];
  for(const [check,models] of Object.entries(c.checks||{})) for(const [model,m] of Object.entries(models||{}))
    rows.push(`<tr><td><b class="name">${esc(check)}</b></td><td class="mut">${esc(model)}</td><td class="tnum">${m.adjudicated}</td><td class="tnum">${m.unadjudicated}</td><td>${rate(m.falseAlarmRate)}</td><td>${rate(m.falseCleanRate)}</td></tr>`);
  return rows.join('');
}
function renderEscalations(e){
  if(!e) return '<tr><td colspan="7"><span class="pill unk">not served</span> <span class="mut">the server sent no escalations section — state UNKNOWN, not empty</span></td></tr>';
  if(e.state==='no-journal') return '<tr><td colspan="7"><span class="pill unk">no journal</span> <span class="mut">no adjudications journal has ever been written — escalation state is UNKNOWN, not empty</span></td></tr>';
  if(e.state==='unreadable') return `<tr><td colspan="7"><span class="pill unk">unreadable</span> <span class="mut">the adjudications journal cannot be read (${esc(e.detail||'error')}) — "none recorded" is not a claim this load can make</span></td></tr>`;
  if(e.state==='zero-unreinforced') return '<tr><td colspan="7"><span class="pill unrf">0 — uncorroborated</span> <span class="mut">the N-chain reviewer has never written here: an empty queue nothing feeds, not a worked-off one</span></td></tr>';
  if(e.state==='zero-corroborated') return '<tr><td colspan="7"><span class="pill live">none recorded</span> <span class="mut">the reviewer writes here and no chain run has escalated</span></td></tr>';
  const reasonTitle={'disagreement':'chains returned different verdicts','chain-error':'one or more chains failed to complete','lint-flagged':'the reasoning lint flagged a chain','unparsed':'provenance did not parse — reason unknown, not any particular one'};
  const rows=(e.rows||[]).map(r=>`<tr><td class="mut">${esc(r.at||'—')}</td><td><code>${esc(r.findingKey||'—')}</code></td><td>${esc(r.category||'—')}</td><td><span class="pill part" title="${esc(reasonTitle[r.reason]||r.reason)} — truth is null by design; this row needs a person, it is not a finding and not a pass">${esc(r.reason)}</span></td><td class="tnum">${r.chains!=null?r.chains:'<span class="mut">?</span>'}</td><td class="mut">${esc(r.model||'—')}</td><td class="mut">${r.evidenceSealed?`sealed${r.chains!=null?` · ${r.chains} chain(s)`:''}`:'<span class="pill unk" title="no sealed evidence envelope on this row — the record is thinner than the writer promises">no envelope</span>'}</td></tr>`).join('');
  const more=e.truncated?`<tr><td colspan="7" class="mut">+${e.truncated} older pending escalation(s) not shown</td></tr>`:'';
  const resolved=e.resolved?`<tr><td colspan="7" class="mut">${e.resolved} earlier escalation(s) since adjudicated by a person — resolved out of this queue, still in the ledger</td></tr>`:'';
  return rows+more+resolved;
}
function intgSummary(d){
  const cons=d.conservation, tv=d.timelineVerify, an=d.artifactAnomalies;
  const c=!cons||cons.state==='never-checked'?'never checked':((cons.violations||[]).length?`${cons.violations.length} violation(s)`:'conserved');
  const t=!tv||tv.state==='no-history'?'no history':(tv.state==='unreadable'?'index unreadable':`${(tv.counts||{}).verified||0}v/${(tv.counts||{})['unverified-legacy']||0}l/${(tv.counts||{}).unreadable||0}u`);
  const h=!an||an.state==='never-measured'?'never measured':(an.state==='unreadable'?'unreadable':`${an.count} husk(s)`);
  return `conservation: ${c} · husks: ${h} · verify: ${t}`;
}
// ── END R1 INTEGRITY RENDERERS ─────────────────────────────────────────────────────────────────
async function loadVerdicts(){
  try{
    const d=await (await fetch('/api/verdicts')).json();
    const gs=d.gates||[];
    $('vd-n').textContent=gs.length?`${gs.filter(g=>g.state==='ok').length}/${gs.length} ok`:'—';
    $('vd-gates').innerHTML=gs.map(g=>{
      const l=g.last||{};
      const state=g.state==='ok'?'ok':g.state==='absent-not-running'?'<span class="mut">no result — guard not running</span>':`<b>${esc(g.state)}</b>`;
      const trail=(g.recent||[]).length>1?(g.recent||[]).slice(-5).map(r=>r.verdict+(r.suppressed?'ˢ':'')).join(' → '):'';
      return `<tr><td><b class="name">${esc(g.gate)}</b></td><td>${state}</td><td>${esc(l.verdict||g.lastVerdict||'—')}${l.suppressed?' <span class="mut">(suppressed)</span>':''}${trail?`<br><span class="mut t-meta">${esc(trail)}</span>`:''}</td><td class="mut">${esc(l.at||g.lastAt||'—')}</td><td>${l.silenced!=null?l.silenced:'—'}</td><td>${g.entries!=null?g.entries:0}${g.torn?` <b>+${g.torn} torn</b>`:''}${g.chain&&g.chain.broken?` <b>CHAIN BROKEN ×${g.chain.broken}</b>`:''}</td></tr>`;
    }).join('')||'<tr><td colspan="6" class="mut">no gates in the roster</td></tr>';
    const ar=d.areas||[];
    $('vd-areas').innerHTML=(d.sweepError?`<tr><td colspan="7"><b>${esc(d.sweepError)}</b></td></tr>`:'')+(ar.map(a=>{
      const l=a.last||{};
      const iss=l.issues&&typeof l.issues==='object'?`+${l.issues.created} new · ${l.issues.closed} closed`:esc(String(l.issues!=null?l.issues:'—'));
      const state=a.state==='ok'?'ok':a.state==='absent'?'<span class="mut">none recorded</span>':`<b>${esc(a.state)}</b>`;
      return `<tr><td><b class="name">${esc(a.area)}</b></td><td>${state}</td><td class="mut">${esc(l.sliceId||'—')}</td><td>${esc(String(l.rollup!=null?l.rollup:'—'))}</td><td class="mut">${iss}</td><td class="mut">${l.durationSecs!=null?l.durationSecs+'s':'—'}</td><td class="mut">${esc(l.at||'—')}</td></tr>`;
    }).join('')||'<tr><td colspan="7" class="mut">no areas declared</td></tr>');
    const f=d.fleet;
    $('vd-fleet').textContent=f?(f.state==='absent'?'fleet journal: none recorded':`fleet journal: ${f.state}${f.last?` · ${f.last.clean!=null?f.last.clean+' clean':''} · last ${f.last.at||'?'}`:''}`):'';
    // R1: --tally's fatigue + calibration, through the served allowlist
    $('vd-fatigue').innerHTML=renderFatigue(d.fatigue);
    $('vd-fat-n').textContent=d.fatigue?(d.fatigue.state==='ok'?`${(d.fatigue.targets||[]).length} target(s)`:d.fatigue.state):'—';
    $('vd-calib').innerHTML=renderCalibration(d.calibration);
    $('vd-cal-n').textContent=d.calibration?(d.calibration.state==='ok'?`${Object.keys(d.calibration.checks||{}).length} check(s)`:d.calibration.state):'—';
    $('vd-esc').innerHTML=renderEscalations(d.escalations);
    $('vd-esc-n').textContent=d.escalations?(d.escalations.state==='ok'?`${d.escalations.pending} awaiting`:d.escalations.state):'—';
  }catch(e){
    $('vd-gates').innerHTML='<tr><td colspan="6"><b>could not load /api/verdicts — verdict state is UNKNOWN, not clean</b></td></tr>';
    $('vd-fatigue').innerHTML='<tr><td colspan="4"><b>could not load — fatigue state is UNKNOWN, not zero</b></td></tr>';
    $('vd-calib').innerHTML='<tr><td colspan="6"><b>could not load — calibration state is UNKNOWN, not zero</b></td></tr>';
    $('vd-esc').innerHTML='<tr><td colspan="7"><b>could not load — escalation state is UNKNOWN, not empty</b></td></tr>';
  }
  loadTriage();
}
// triage queue: ranked rows and the write path
const TRI_TRUTHS=['true-alarm','false-alarm','true-clean','false-clean'];
const TRI_STATE_MSG={
  'no-rollup':'no rollup for this project — nothing has been counted, which is not an empty queue',
  'unresolved':'the project name did not resolve to an area — pick a project first',
  'unreadable':'the rollup or the adjudications ledger could not be read — queue state is UNKNOWN, not empty',
};
function renderTriageRow(r){
  const sev=r.claimedSeverity?`<span class="pill ${esc(r.claimedSeverity)}" title="the severity the lane claimed before the row was demoted">${esc(r.claimedSeverity)}</span>`:'<span class="mut">ungraded</span>';
  const finding=r.source==='cve'?`<code>${esc(r.id||'')}</code> <span class="mut">${esc(r.package||'')}</span>`:`<code>${esc(r.place||r.findingKey)}</code>`;
  const flags=[r.own?'<span class="pill live" title="a repo in an area this fleet owns — ranks first (P0: own code secure)">own</span>':'',r.kev?'<span class="pill crit" title="on the CISA KEV list">KEV</span>':'',r.state==='persisting'?'<span class="pill part" title="seen across more than one sweep">persisting</span>':''].filter(Boolean).join(' ');
  const opts=TRI_TRUTHS.map(t=>`<option value="${t}">${t}</option>`).join('');
  return `<tr data-key="${esc(r.findingKey)}" data-cat="${esc(r.category)}" data-repo="${esc(r.repo)}">
    <td class="tnum">${r.rank}</td><td><b class="name">${esc(r.repo)}</b></td><td>${esc(r.category)} ${flags}</td><td>${finding}</td><td>${sev}</td>
    <td class="mut t-meta" title="${esc(r.reason||'')}">${esc(r.code||'')}${r.reason?` — ${esc(String(r.reason).slice(0,140))}${String(r.reason).length>140?'…':''}`:''}</td>
    <td><select class="tri-truth">${opts}</select> <input class="tri-basis" placeholder="basis — what you looked at" size="28"> <button type="button" class="tri-go">record</button> <span class="tri-msg mut"></span></td></tr>`;
}
async function loadTriage(){
  const el=$('vd-tri'); if(!el)return;
  try{
    const q=await (await fetch('/api/verdicts/triage?project='+encodeURIComponent(curProj||''))).json();
    $('vd-tri-rules').innerHTML=(q.rules||[]).map(r=>`<li><b>${esc(r.id)}</b> — ${esc(r.text)}</li>`).join('');
    if(q.state!=='ok'){
      $('vd-tri-n').textContent=q.state||'—';
      $('vd-tri-sum').textContent='';$('vd-tri-def').textContent='';
      el.innerHTML=`<tr><td colspan="7"><span class="pill unk">${esc(q.state||'?')}</span> <span class="mut">${esc(TRI_STATE_MSG[q.state]||'')}${q.detail?` (${esc(q.detail)})`:''}</span></td></tr>`;
      return;
    }
    $('vd-tri-n').textContent=`${q.admitted.length} of ${q.pending} this cycle`;
    const ex=q.excluded||{};
    const exM=Object.entries(ex.metricLanes||{}).map(([k,n])=>`${k} ${n} (metric)`).join(', ');
    const exD=Object.entries(ex.defectSignature||{}).map(([k,v])=>`${k} ${v.rowsExcluded} (lane grades ${Math.round((1-v.share)*100)}% of ${v.total} — a lane defect, routed to its owner)`).join(', ');
    $('vd-tri-sum').innerHTML=[
      `area <b>${esc(q.area)}</b> · population <b>${q.population}</b> undetermined across lanes · rows in this rollup <b>${q.rowsAvailable}</b>${q.rowsCapped?' <span class="pill part" title="the rollup carries capped detail per lane; the counter is the whole, the rows are a sample">capped</span>':''}`,
      `queue <b>${q.pending}</b> · capacity <b>${q.capacityItems}</b> items/cycle (${q.budget.capacityMinutes} min at ${q.budget.minutesPerItem} min each) · ${q.budget.overBy!=null?`<b>${q.budget.overBy}×</b> one cycle`:''}`,
      `excluded — adjudicated ${ex.adjudicated||0}${exM?` · ${esc(exM)}`:''}${exD?` · ${esc(exD)}`:''}${Object.keys(ex.unkeyed||{}).length?` · unkeyed ${esc(Object.entries(ex.unkeyed).map(([k,n])=>`${k} ${n}`).join(', '))}`:''}`,
    ].join('<br>');
    el.innerHTML=(q.admitted||[]).map(renderTriageRow).join('')||'<tr><td colspan="7"><span class="pill live">queue empty</span> <span class="mut">a rollup was read and every undetermined row is adjudicated, excluded by rule, or absent</span></td></tr>';
    const d=q.deferred||{count:0,byLane:{}};
    $('vd-tri-def').innerHTML=d.count?`<b>${d.count} deferred</b> past this cycle's capacity — ${esc(Object.entries(d.byLane).map(([k,n])=>`${k} ${n}`).join(', '))} · deferred is a stated state, not a drop`:'nothing deferred';
  }catch(e){
    $('vd-tri-n').textContent='—';
    el.innerHTML='<tr><td colspan="7"><b>could not load /api/verdicts/triage — queue state is UNKNOWN, not empty</b></td></tr>';
  }
}
async function adjudicateTriageRow(btn){
  const tr=btn.closest('tr'); if(!tr)return;
  const msg=tr.querySelector('.tri-msg');
  const body={findingKey:tr.dataset.key,category:tr.dataset.cat,repo:tr.dataset.repo,truth:tr.querySelector('.tri-truth').value,basis:tr.querySelector('.tri-basis').value.trim()};
  if(!body.basis){msg.innerHTML='<b>basis required</b> — say what you looked at';return;}
  msg.textContent='writing…';btn.disabled=true;
  try{
    const r=await cwPost('/api/verdicts/adjudicate',{headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json();
    if(!j.ok){msg.innerHTML='<b>refused:</b> '+esc(j.error||'unknown');btn.disabled=false;return;}
    msg.textContent='recorded';
    loadTriage();
  }catch(e){msg.innerHTML='<b>failed: '+esc(String(e.message))+' — nothing was written</b>';btn.disabled=false;}
}
document.addEventListener('click',(ev)=>{const b=ev.target&&ev.target.closest&&ev.target.closest('#vd-tri button.tri-go');if(b)adjudicateTriageRow(b);});
// ── Projects — the designated folder walked as laid out on disk, joined against the registry ────
// pjNodes is the flat render-order list so row clicks and per-row review buttons resolve to the
// same node objects the server sent — never re-derived from cell text.
let pjNodes=[],pjSelected=null;
function pjPill(n){
  const map={registered:['live','registered'],self:['live','registered · this panel'],discovered:['attest','discovered'],excluded:['plan','excluded'],unlisted:['high','unlisted'],'not-a-repo':['na','not a repo'],'structural-skip':['na','skipped'],dangling:['crit','dangling']};
  const m=map[n.status]||['na',n.status];
  return pill(m[0],m[1])+(n.superseded?' '+pill('part','superseded'):'');
}
function pjTable(nodes){
  return '<div class="tw"><table><thead><tr><th></th><th>Project</th><th>Path</th><th>Status</th><th>Area</th><th>Manifest</th><th></th></tr></thead><tbody>'
    +nodes.map(n=>{const i=pjNodes.push(n)-1;
      const mani=Array.isArray(n.manifest)?n.manifest.join(', '):(n.manifest||'');
      return `<tr data-pj="${i}"><td class="mut">${pjSelected===n?'▸':''}</td><td><b class="name">${esc(n.name)}</b></td><td class="mut">${esc(n.rel||n.path||'')}</td><td>${pjPill(n)}${n.reason?` <span class="mut t-meta">${esc(n.reason)}</span>`:''}</td><td>${esc(n.areaLabel||n.area||'—')}</td><td class="mut">${esc(mani)}</td><td>${(n.area||n.project)?`<button type="button" class="vtab vtab-sm" data-rv="${i}" title="open this project's area on the Overview tab">review</button>`:''}</td></tr>`;}).join('')
    +'</tbody></table></div>';
}
function pjReview(n){
  if(!n)return;
  const opts=[...$('proj').options].map(o=>o.value);
  // the picker's vocabulary is the server's — try the area's picker identities in order and fall
  // back to just switching views if none match, rather than inventing an option
  const pick=[n.areaLabel,n.area,n.project,n.name].find(v=>v&&opts.includes(v));
  if(pick){curProj=pick;try{localStorage.setItem('cw-proj',curProj)}catch(_){}$('proj').value=pick;}
  setView('overview');load();
}
// ── ROLLUPS: last and next rollup per project, 30 days of outcomes (GET /api/rollups) ────────────
const RU_STATES=['good','warn','broken','none','empty'];
const RU_LABEL={good:'good',warn:'warn',broken:'broken',none:'did not run',empty:'nothing in scope'};
const WORST_LABEL={kev:'known-exploited (KEV) open',crit:'critical open',high:'high open',med:'medium open',low:'low open',none:'no open findings',unknown:'exposure unknown'};
// Calendar-grid icon: seven cells, one per weekday. Daily fills all seven, weekly fills one.
function cadenceIcon(kind){
  const on=kind==='daily'?7:kind==='weekly'?1:kind==='custom'?3:0;
  const cells=Array.from({length:7},(_,i)=>`<rect x="${1+i*3}" y="4" width="2.4" height="2.4" class="${i<on?'on':''}"/>`).join('');
  const label=kind==='none'?'not scheduled':kind;
  return `<svg class="ru-cad ru-cad-${esc(kind)}" viewBox="0 0 23 9" role="img" aria-label="${esc(label)} scans"><title>${esc(label)} scans</title><rect x=".5" y=".5" width="22" height="8" rx="1.5" class="frame"/><line x1=".5" y1="2.6" x2="22.5" y2="2.6" class="frame"/>${cells}</svg>`;
}
function dayTitle(d){
  const x=d.exposure||{};
  const exp=x.state?'exposure '+x.state:(x.cve!=null||x.kev!=null?'CVE '+(x.cve??'—')+' · KEV '+(x.kev??'—'):'no slice that day');
  return d.day+' · '+(d.state?RU_LABEL[d.state]:'not scheduled')+(d.runs?' · '+d.runs+' run'+(d.runs===1?'':'s'):'')+' · '+exp;
}
function dayStrip(days){
  return '<span class="ru-strip">'+(days||[]).map(d=>`<i class="ru-d ${d.state||'na'}" title="${esc(dayTitle(d))}"></i>`).join('')+'</span>';
}
function projectName(a){
  const w=a.worst||'unknown';
  return `<b class="ru-name w-${esc(w)}" title="${esc(WORST_LABEL[w]||w)}">${esc(a.label)}</b>`;
}
function nextCell(a){
  const s=a.schedule||{};
  if(s.next)return `<span class="ru-next" data-countdown="${esc(s.next)}" title="${esc(ABS(new Date(s.next)))}">${esc(COUNTDOWN(s.next))}</span>`;
  return `<span class="mut">${esc(s.state==='paused'?'paused':s.state==='absent'?'no job installed':s.state==='disabled'?'job disabled':s.state==='unreadable'?'job unreadable':'not scheduled')}</span>`;
}
function lastCell(a){
  if(!a.last)return '<span class="mut">no rollup yet</span>';
  const t=new Date(a.last.at);return `<span title="${esc(ABS(t))}">${esc(AGO(Date.now()-t.getTime()))}</span>`;
}
// Bars: projects that ran each day. Hover names the day's counts.
function rollupChartSvg(fleet,total){
  const W=300,H=70,n=fleet.days.length,bw=W/n,max=Math.max(1,total);
  return `<svg viewBox="0 0 ${W} ${H+12}" class="ru-chart" role="img" aria-label="projects that ran per day, last ${n} days">`
    +fleet.days.map((d,i)=>{const h=Math.round(d.ran/max*H);return `<rect x="${(i*bw+.5).toFixed(1)}" y="${H-h}" width="${(bw-1).toFixed(1)}" height="${h}" class="bar"><title>${esc(d.day)} · ${d.ran} of ${total} projects ran · ${d.runs} runs · CVE ${d.cve} · KEV ${d.kev}</title></rect>`;}).join('')
    +`<line x1="0" y1="${H+.5}" x2="${W}" y2="${H+.5}" class="axis"/><text x="0" y="${H+10}" class="lbl">${esc(fleet.days[0]?.day||'')}</text><text x="${W}" y="${H+10}" class="lbl" text-anchor="end">today</text></svg>`;
}
// Clock: one wedge per day, oldest at twelve o'clock and running clockwise. Each wedge is banded from
// the centre outward by how many projects were good, warn, broken, did not run or had nothing in scope.
function rollupClockSvg(fleet){
  const n=fleet.days.length,R=64,r0=24,cx=70,cy=70;
  const pt=(a,r)=>[cx+r*Math.sin(a),cy-r*Math.cos(a)];
  let out=`<svg viewBox="0 0 140 140" class="ru-clock" role="img" aria-label="run outcomes per day, last ${n} days">`;
  fleet.days.forEach((d,i)=>{
    const a0=i/n*2*Math.PI,a1=(i+1)/n*2*Math.PI-.012;
    const tot=RU_STATES.reduce((s,k)=>s+(d[k]||0),0);
    const title=`${d.day} · good ${d.good} · warn ${d.warn} · broken ${d.broken} · did not run ${d.none}${d.empty?' · nothing in scope '+d.empty:''} · CVE ${d.cve} · KEV ${d.kev}`;
    if(!tot){const [x0,y0]=pt(a0,R),[x1,y1]=pt(a1,R),[x2,y2]=pt(a1,r0),[x3,y3]=pt(a0,r0);
      out+=`<path d="M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}A${r0} ${r0} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z" class="seg na"><title>${esc(d.day)} · nothing scheduled</title></path>`;return;}
    let ra=r0;
    for(const k of RU_STATES){
      const c=d[k]||0;if(!c)continue;const rb=ra+(R-r0)*c/tot;
      const [x0,y0]=pt(a0,rb),[x1,y1]=pt(a1,rb),[x2,y2]=pt(a1,ra),[x3,y3]=pt(a0,ra);
      out+=`<path d="M${x0.toFixed(2)} ${y0.toFixed(2)}A${rb.toFixed(2)} ${rb.toFixed(2)} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}A${ra.toFixed(2)} ${ra.toFixed(2)} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z" class="seg ${k}"><title>${esc(title)}</title></path>`;
      ra=rb;
    }
  });
  const t=fleet.totals||{};
  return out+`<circle cx="${cx}" cy="${cy}" r="${r0-1.5}" class="hub"/><text x="${cx}" y="${cy-1}" text-anchor="middle" class="lbl big">${t.good||0}/${RU_STATES.reduce((s,k)=>s+(t[k]||0),0)}</text><text x="${cx}" y="${cy+9}" text-anchor="middle" class="lbl">good</text></svg>`;
}
// The gate's own error rate from the sweep's canary (W1). A stratum with nothing scored, and a canary
// that did not run, read as words — never as 0%, which would be a measurement nobody took.
function canaryRateText(label,r){
  if(!r||r.state!=='measured')return label+' not measured';
  return label+' '+r.n+'/'+r.of+' ('+Math.round(r.rate*100)+'%)';
}
function canaryText(c){
  if(!c)return 'not measured';
  if(c.state==='measured')return canaryRateText('false-clean',c.falseClean)+' · '+canaryRateText('false-alarm',c.falseAlarm)
    +(c.requiredSkipped&&c.requiredSkipped.length?' · '+c.requiredSkipped.length+' required scenario(s) did not run':'');
  return (c.state==='failed'?'canary failed':c.state==='unreadable'?'unreadable':'not measured')+(c.why?' — '+c.why:'');
}
function canaryCell(c){
  const bad=c&&c.state==='measured'&&((c.falseClean&&c.falseClean.n>0)||(c.requiredSkipped&&c.requiredSkipped.length));
  const cls=!c||c.state!=='measured'?'mut':bad?'pk-err':'';
  return `<span class="${cls}" title="${esc((c&&c.at?c.at+' · ':'')+canaryText(c))}">${esc(c&&c.state==='measured'?canaryRateText('FC',c.falseClean)+' · '+canaryRateText('FA',c.falseAlarm):(c&&c.state)||'not measured')}</span>`;
}
function canaryHeadline(c){
  return `<div class="pf-note ru-gate"><b>Gate error rate</b> (scan canary, latest sweep${c&&c.area?' · '+esc(c.area):''}${c&&c.at?' · '+esc(c.at):''}): ${esc(canaryText(c))}</div>`;
}
function rollupRows(areas,{strip=true}={}){
  // `tw` and not `tablewrap`: tw is the panel's table wrapper everywhere else and carries
  // overflow-x:auto plus the border, so under the old name this table had neither. `ru-table`
  // is dropped rather than given a rule — the global table{} rule already styles it, and no
  // other .ru-* rule exists for it to sit beside.
  return '<div class="tw"><table><thead><tr><th>Project</th><th>Cadence</th><th>Last rollup</th><th>Next rollup</th>'+(strip?'<th>Last 30 days</th><th title="false-clean (FC) and false-alarm (FA) rate of the gates, from this area\'s latest sweep canary">Gate canary</th>':'<th>Last run</th>')+'</tr></thead><tbody>'
    +areas.map(a=>{
      const lastRun=[...(a.days||[])].reverse().find(d=>d.state);
      return `<tr><td><button type="button" class="lnk ru-open" data-proj="${esc(a.label)}" title="open ${esc(a.label)}'s summary">${projectName(a)}</button></td><td>${cadenceIcon((a.cadence||{}).kind||'none')}</td><td>${lastCell(a)}</td><td>${nextCell(a)}</td><td>${strip?dayStrip(a.days):(lastRun?`<i class="ru-d ${lastRun.state}" title="${esc(dayTitle(lastRun))}"></i> ${esc(RU_LABEL[lastRun.state])}`:'<span class="mut">—</span>')}</td>${strip?`<td>${canaryCell(a.canary)}</td>`:''}</tr>`;
    }).join('')+'</tbody></table></div>';
}
function bindRollupOpen(root){
  root.querySelectorAll('.ru-open').forEach(b=>b.onclick=()=>{
    const ps=$('proj');const opts=ps?[...ps.options].map(o=>o.value):[];
    if(!opts.includes(b.dataset.proj))return;
    curProj=b.dataset.proj;try{localStorage.setItem('cw-proj',curProj)}catch(_){}ps.value=curProj;setView('overview');load();
  });
}
async function fetchRollups(){
  const r=await fetch('/api/rollups');
  if(r.status===401)return {error:'Nobody is signed in, so the schedule was not read. This is NOT an empty fleet.'};
  const d=await r.json().catch(()=>null);
  if(!d||!d.ok)return {error:(d&&d.reason)||('the schedule could not be read (HTTP '+r.status+')')};
  rollupSched=d;return {data:d};
}
async function loadRollups(){
  const box=$('ru-table');
  let res;try{res=await fetchRollups();}catch(e){res={error:'Could not read /api/rollups: '+e.message+'. Nothing here is a statement about the schedule.'};}
  if(res.error){$('ru-n').textContent='unknown';box.innerHTML='<div class="pk-err">'+esc(res.error)+'</div>';$('ru-chart').innerHTML='';$('ru-clock').innerHTML='';return;}
  const d=res.data,areas=d.areas.filter(a=>!a.misdeclared);
  const t=d.fleet.totals;
  $('ru-n').textContent=`${areas.length} projects · next ${d.fleet.next?d.fleet.next.area:'none scheduled'} · 30 days: ${t.good} good · ${t.warn} warn · ${t.broken} broken · ${t.none} did not run`+(d.slicesPending?' · exposure still being read':'');
  $('ru-chart').innerHTML=rollupChartSvg(d.fleet,areas.length);
  $('ru-clock').innerHTML=rollupClockSvg(d.fleet);
  box.innerHTML=canaryHeadline(d.fleet.canary)+rollupRows(areas);bindRollupOpen(box);
}
// /projects/ opens on the projects themselves; the folder walk below it is how they were found.
async function loadProjectList(){
  const box=$('pj-list');if(!box)return;
  let res;try{res=await fetchRollups();}catch(e){res={error:'Could not read /api/rollups: '+e.message};}
  if(res.error){box.innerHTML='<div class="pk-err">'+esc(res.error)+'</div>';return;}
  const areas=res.data.areas.filter(a=>!a.misdeclared);
  box.innerHTML=`<div class="hd"><h2>Project list</h2><span class="n">${areas.length} projects</span></div>`+rollupRows(areas,{strip:false});
  bindRollupOpen(box);
}
async function loadProjectsView(){
  const g=$('pj-groups');
  let d;
  try{
    const r=await fetch('/api/projects/tree');
    if(r.status===401){$('pj-n').textContent='not signed in';g.innerHTML='<div class="cred-msg cred-unknown">Nobody is signed in, so the folder was not walked. This is NOT an empty folder.</div>';return;}
    d=await r.json();
  }catch(e){
    // FAIL CLOSED: an unreachable route is not an empty folder
    $('pj-n').textContent='unreachable';g.innerHTML='<div class="pk-err">Could not read /api/projects/tree: '+esc(String(e.message))+'. Nothing below is a statement about the folder.</div>';return;
  }
  if(!d.ok){$('pj-n').textContent='unknown';g.innerHTML='<div class="pk-err">'+esc(d.reason||'the tree could not be built')+'</div>';return;}
  pjNodes=[];pjSelected=null;
  const c=d.counts||{};
  $('pj-n').textContent=`${c.repos||0} repos · ${c.registered||0} registered · ${c.discovered||0} discovered · ${c.excluded||0} excluded`+(c.unlisted?` · ${c.unlisted} unlisted`:'');
  $('vn-projects').textContent=c.unlisted?String(c.unlisted):'';
  $('pj-root').innerHTML=(d.roots||[]).map(r=>`<code>${esc(r.declared||r.path)}</code> <span class="mut">(${esc(r.source)})</span>`+(r.state!=='walked'?` <b>${esc(r.state)}${r.reason?' — '+esc(r.reason):''}</b>`:'')).join(' · ');
  const areas=[...new Set([].concat(...(d.roots||[]).map(r=>[].concat(...(r.groups||[]).map(gr=>gr.nodes.map(n=>n.area))))).concat((d.outside||[]).map(n=>n.area)).filter(Boolean))].sort();
  $('pjf-areas').innerHTML=areas.map(a=>`<option value="${esc(a)}">`).join('');
  let h='';
  for(const r of d.roots||[]){
    if(r.state!=='walked'){h+=`<div class="pk-err"><span><code>${esc(r.declared||r.path)}</code>: <b>${esc(r.state)}</b>${r.reason?' — '+esc(r.reason):''}</span></div>`;continue;}
    for(const gr of r.groups||[]){
      h+=`<div class="hd"><h2>${esc(gr.dir||'(top level)')}</h2><span class="n">${gr.nodes.length} entries</span></div>`;
      h+=gr.state&&gr.state!=='walked'&&gr.state!=='empty'?`<div class="pk-err">${esc(gr.state)}${gr.reason?' — '+esc(gr.reason):''}</div>`
        :gr.nodes.length?pjTable(gr.nodes):'<div class="mut">no folders</div>';
    }
  }
  if((d.outside||[]).length){h+=`<div class="hd"><h2>outside the designated folder</h2><span class="n">${d.outside.length} declared</span></div>`+pjTable(d.outside);}
  if((d.notes||[]).length)h+='<div class="mut t-meta">'+d.notes.map(esc).join('<br>')+'</div>';
  g.innerHTML=h;
}
$('pj-rescan').onclick=()=>loadProjectsView();
$('pj-add').onclick=()=>{$('pj-form').classList.toggle('jshide');$('pjf-msg').textContent='';};
$('pjf-cancel').onclick=()=>$('pj-form').classList.add('jshide');
// no row selected = review the area the picker already points at — the button always goes somewhere
$('pj-review').onclick=()=>{if(pjSelected)pjReview(pjSelected);else{setView('overview');load();}};
$('pj-groups').onclick=(e)=>{
  const rv=e.target.closest('button[data-rv]');
  if(rv){pjReview(pjNodes[Number(rv.dataset.rv)]);return;}
  const tr=e.target.closest('tr[data-pj]');
  if(tr){pjSelected=pjNodes[Number(tr.dataset.pj)];tr.parentElement.querySelectorAll('tr>td:first-child').forEach(td=>td.textContent='');tr.firstElementChild.textContent='▸';}
};
$('pj-form').onsubmit=async(ev)=>{
  ev.preventDefault();
  const msg=$('pjf-msg');msg.textContent='registering…';
  const body={name:$('pjf-name').value.trim(),path:$('pjf-path').value.trim(),area:$('pjf-area').value.trim(),manifest:$('pjf-manifest').value.trim(),createArea:$('pjf-newarea').checked};
  let r,j;
  try{r=await cwPost('/api/projects/add',{headers:{'content-type':'application/json'},body:JSON.stringify(body)});j=await r.json();}
  catch(e){msg.innerHTML='<b>the request failed: '+esc(String(e.message))+' — nothing was written</b>';return;}
  if(!j.ok){msg.innerHTML='<b>refused:</b> '+esc(j.error||'unknown')+((j.errors||[]).length?'<br>'+j.errors.map(esc).join('<br>'):'');return;}
  msg.textContent=`registered '${j.entry.name}' → area '${j.entry.area||j.entry.name}'`+(j.areaCreated?' (new area declared)':'')+(j.alreadyDiscovered?' — it was already auto-discovered; the explicit entry now pins its area and manifest':'');
  $('pj-form').classList.add('jshide');
  ['pjf-name','pjf-path','pjf-area','pjf-manifest'].forEach(id=>$(id).value='');$('pjf-newarea').checked=false;
  loadProjectsView();
};
const NATIVE={overview:'overview',fleet:'view-fleet',lanes:'view-lanes',held:'view-held',posture:'view-posture',delivery:'view-delivery',a11y:'view-a11y',codeql:'view-codeql',renovate:'view-renovate',report:'view-report',allfindings:'view-allfindings',feed:'view-feed',journey:'view-journey',remediation:'view-remediation',issues:'view-issues',daily:'view-daily',exposure:'view-exposure',secrets:'view-secrets',malware:'view-malware',supplychain:'view-supplychain',socket:'view-socket',stubs:'view-lane',denolint:'view-lane',denotypes:'view-lane',secretshistory:'view-lane',cspm:'view-lane',depsjvm:'view-lane',depsgo:'view-lane',depsretire:'view-lane',vendor:'view-lane',tls:'view-lane',apifuzz:'view-lane',sast:'view-sast',iac:'view-iac',dast:'view-dast',actions:'view-actions',minify:'view-minify',bola:'view-bola',stpa:'view-stpa',profile:'view-profile',verdicts:'view-verdicts',oversight:'view-oversight',correlations:'view-correlations',projects:'view-projects',cra:'view-cra',determinations:'view-determinations',settings:'view-settings',perf:'view-perf',comments:'view-comments',spinecomments:'view-comments',overwatch:'view-overwatch',rollups:'view-rollups',remfleet:'view-remfleet'};
function setView(v,replace){
  // leaving Profile drops any one-shot enrolment secret still on the page — a tab you navigated
  // away from is not a place to leave a TOTP secret sitting in the markup
  if(v!=='profile'){forgetEnrolSecret();clearAccountSecrets();}
  curView=v;
  document.querySelectorAll('#views .vtab').forEach(b=>b.classList.toggle('pri',b.dataset.v===v));
  // the section strip follows the view, never the other way round — one source of truth
  if(typeof applyGroup==='function')applyGroup(v);
  // a fleet page and a project page see different jobs (jobSel)
  if(typeof rescopeJobs==='function')rescopeJobs();
  const fr=$('viewframe');
  // .vhide is the pre-route hide for views that carry no style attribute of their own (visibility
  // belongs in the stylesheet); from the first pass on, the router owns display for all of them
  // A view whose experimental flag is off shows a notice naming the flag instead (static/features.js).
  const offFlag=typeof featureOffFlag==='function'?featureOffFlag(v):null;
  const notice=$('feature-off-notice');
  if(notice){notice.classList.toggle('vhide',!offFlag);$('feature-off-text').textContent=offFlag?featureOffText(offFlag):'';}
  for(const id of Object.values(NATIVE)){const el=$(id); el.classList.remove('vhide'); el.style.display=(!offFlag&&NATIVE[v]===id)?'':'none';}
  if(offFlag){fr.style.display='none';fr.removeAttribute('src');}
  else if(NATIVE[v]){fr.style.display='none';fr.removeAttribute('src');
    if(v==='fleet')loadFleet();if(v==='held')loadCredentials();if(v==='codeql')loadCodeql();if(v==='renovate')loadRenovate();if(v==='report')loadReport();if(v==='remediation')loadRemediation();if(v==='exposure')loadExposure();if(v==='posture'||v==='delivery')loadPosture();if(v==='a11y')loadA11y();if(v==='issues')loadIssuesTab();if(v==='daily')loadDaily();if(v==='bola')loadBola();if(v==='profile')loadProfile();if(v==='verdicts')loadVerdicts();if(v==='oversight')loadOversight();if(v==='projects'){loadProjectList();loadProjectsView();}if(v==='rollups')loadRollups();if(v==='remfleet')loadRemFleet();if(v==='settings')loadSettings();if(v==='determinations')loadDeterminations();if(v==='cra')loadCra();if(v==='perf')loadPerf();if(v==='comments')loadComments();if(v==='spinecomments')loadComments('spine');if(v==='overwatch')loadOverwatch();learnPaint();if(v==='lanes')loadLanes();
    // The 1s countdown only runs while the CRA view is visible — a background interval ticking a
    // deadline nobody is looking at is pure wakeup cost.
    if(v!=='cra'&&craTickTimer){clearInterval(craTickTimer);craTickTimer=null;}
    // The three scanner-detail tabs ride the /api/state payload, so entering one re-renders from
    // the state already in hand; only a cold open (no poll yet) needs to fetch.
    // DERIVED from SCANNER_TABS, not hand-listed. The literal disjunction it replaces named six
    // views and silently excluded every lane added after it was written — the eleven generic lanes
    // rendered nothing at all, because entering one never asked for a re-render. A view that a
    // scanner lane serves is a view that re-renders, by construction.
    if(SCANNER_VIEWS.has(v)){lastState?renderScannerTabs(lastState):load();}
    if(v==='allfindings'){lastState?renderAllFindings(lastState):load();}
    // panel-feed.js owns the view; the typeof guard keeps a boot into /feed/ from throwing before that script runs
    if(v==='feed'&&typeof loadFeed==='function')loadFeed();
    if(v==='journey'&&typeof loadJourney==='function')loadJourney();
    if(v==='correlations'&&typeof loadCorrelations==='function')loadCorrelations();}
  else{fr.style.display='block';const s=viewSrc(v);if(fr.getAttribute('src')!==s)fr.src=s;}
  // URL sync: every tab lives at a real PATH (/name/ — served by serve.mjs, linkable, survives
  // hash-stripping tooling); #name persists only as the legacy form, honoured then normalised.
  // pushState on user navigation so back/forward keeps working; replaceState when we are only
  // normalising the URL we just read (boot, popstate/hashchange, a legacy #name) so no ghost
  // history entry is minted.
  // A SECTION path is not overwritten by the view it lands on. /section/<id>/ names the section;
  // setView then opens that section's first tab, and writing viewUrl() here would replace the URL
  // the operator navigated to with the tab's own path — a deep link that half-works.
  if(sectionPathHolds(v)) return;
  try{const u=viewUrl(v);if(location.pathname+location.search+location.hash!==u)history[replace?'replaceState':'pushState'](null,'',u);}catch(e){}
}
// BUGFIX: bind the view switcher to the NAV tabs only (#views .vtab). The bare `.vtab` selector
// also matched #sw-hide (the sweep-console hide button, styled with the same class), overwriting
// its own handler — clicking "hide" then called setView(undefined): every tab lost its highlight,
// the overview vanished and the iframe navigated to the literal URL "undefined" (the panel's 404).
document.querySelectorAll('#views .vtab').forEach(b=>b.onclick=()=>setView(b.dataset.v));
// The two fleet-configuration entries live in the ≡ menu now and route exactly as tabs did — same
// setView, same #hash, same NATIVE view. Bound separately because the selector above is scoped to
// #views on purpose (a bare `.vtab` once matched the sweep console's hide button and overwrote its
// handler), and the menu closes after a choice like every other item in it.


// 'auto' removes data-theme, so the OS setting stays in force. The head script owns startup.
// Four states, and the fourth is the one that matters: a lane can be switched on and still unable
// to run. `blocked` outranks the box, because forcing a lane on does not supply the tool it lacks.
function laneBox(s){
  // Clickable, and it cycles inherit -> on -> off -> inherit. A dashed lane is still clickable: it
  // can be forced on, and the honest outcome is that it reports FORCED ON BUT BLOCKED rather than
  // running. Hiding the control would be the panel deciding the operator may not try.
  const d=` data-lane="${esc(s.id)}" data-cur="${esc(s.override||'')}" role="button" tabindex="0"`;
  if(s.blocked||s.enabled===null)
    return `<span class="lane-box dash"${d} title="${esc(s.reason||'cannot run here')} — click to force it on anyway; it will report blocked, not running">—</span>`;
  if(s.override==='on') return `<span class="lane-box on"${d} title="forced ON for this project — click for OFF">✓</span>`;
  if(s.override==='off')return `<span class="lane-box off"${d} title="forced OFF for this project — click to return to inherited">✕</span>`;
  return `<span class="lane-box inherit"${d} title="inherited from the fleet derivation — click to force ON">${s.enabled?'✓':'✕'}</span>`;
}
const LANE_CYCLE={'':'on',on:'off',off:''};
// READ-MODIFY-WRITE, and the read happens LATE. POST /api/perf is a whole-state write — profileId,
// depth, intensity and the entire override map — so posting a map assembled at render time would
// drop any lane another operator changed since. The state is refetched immediately before the
// write and the flip is applied to THAT, so the window is one request rather than one page view.
async function setLaneOverride(id,cur){
  const msg=$('ln-msg');
  const say=(t,bad)=>{ if(msg){msg.textContent=t; msg.className=bad?'mut bad':'mut';} };
  say('saving…');
  let fresh;
  try{ fresh=await (await fetch('/api/perf?project='+encodeURIComponent(curProj||''))).json(); }
  catch(e){ say('could not reach the panel — nothing was written',true); return; }
  if(!fresh||!fresh.ok){ say(((fresh&&fresh.error)||'perf state unavailable')+' — nothing was written',true); return; }
  const next=LANE_CYCLE[cur||''];
  const overrides={...(fresh.overrides||{})};
  if(next)overrides[id]=next; else delete overrides[id];
  let r,j;
  try{
    r=await cwPost('/api/perf',{headers:{'content-type':'application/json'},
      body:JSON.stringify({profileId:fresh.profileId??null,depth:fresh.depth,intensity:fresh.intensity,overrides})});
    j=await r.json().catch(()=>({}));
  }catch(e){ say('could not reach the panel — nothing was written',true); return; }
  if(!j.ok){ say((j.error||('HTTP '+r.status))+' — nothing was written',true); return; }
  say(next?`${id} forced ${next}`:`${id} back to inherited`);
  loadLanes();
}
document.addEventListener('click',(e)=>{
  const b=e.target.closest&&e.target.closest('.lane-box[data-lane]'); if(!b)return;
  setLaneOverride(b.dataset.lane,b.dataset.cur||'');
});
document.addEventListener('keydown',(e)=>{
  if(e.key!=='Enter'&&e.key!==' ')return;
  const b=e.target.closest&&e.target.closest('.lane-box[data-lane]'); if(!b)return;
  e.preventDefault(); setLaneOverride(b.dataset.lane,b.dataset.cur||'');
});
// ── FLEET (the no-project-selected dashboard) ───────────────────────────────────────────────────
// Renders /api/fleet/overview. Three rules run through every line of this and are the reason the
// payload is shaped the way it is:
//
//   1. A TOTAL WITHOUT ITS DENOMINATOR IS NOT A READING. Each tile's sub-line says how many areas
//      the number was summed over, because the areas that could not contribute — never swept,
//      unreadable, or a rollup predating the field — are not zeros in the sum, they are absent
//      from it. Printing 206 crit without "over 36 of 39 areas" invites it to be read as the box.
//   2. THE HEALTH VERDICT IS THE DEADMAN'S. The server calls monitor/liveness.mjs's checkOne(), so
//      the state on this page is the state that decides whether the hourly agent alarms. The one
//      thing this renderer must not do is invent its own opinion of what a state means, which is
//      why the rank comes from the payload's own copy of liveness's RANK table: a state added to
//      the deadman tomorrow renders as ALARMING here by construction rather than as clean-by-
//      omission, which is what a hand-kept client-side list would give it.
//   3. UNKNOWN IS ITS OWN COLUMN. never-swept, unreadable and no-KEV-catalogue are three different
//      absences with three different fixes, and none of them is a zero.
// ── FLEET RENDERERS (lifted whole by admin/test/fleet-render.test.mjs — keep the markers) ───────
const FL_TONE={0:'live',1:'part',2:'crit',3:'crit'};
// Rank 0 states that are QUIET rather than GOOD. `fresh` is a measurement that came back clean;
// these three are the absence of an alarm, which is a different claim and gets grey, not green.
// Ranking them 0 is right (nobody can act on them) — colouring them green would say a sweep
// confirmed something, and for a paused or unscheduled area no sweep ran at all.
const FL_QUIET=new Set(['paused','unscheduled','pending']);
// KIND OUTRANKS RANK FOR COLOUR, because they answer different questions and only one of them is
// about what the reader should do. `overrunning` ranks 1 — the deadman does warn on it — but it
// means a sweep is RUNNING, so amber would put a live sweep in the same colour as a missed one.
// Grey is the honest answer there and it is grey for the usual reason: while a sweep is rewriting an
// area, what is on screen is the previous slice, so the reading is not settled rather than bad.
// Absent `kind` falls back to the rank behaviour, so an older payload still renders.
const FL_KIND_TONE={ok:'live','in-flight':'plan',behind:'part',broken:'crit'};
function flPill(h){
  if(!h||!h.state)return pill('unk','unknown');
  if(FL_QUIET.has(h.state))return pill('plan',esc(h.state));
  if(h.kind)return pill(FL_KIND_TONE[h.kind]||'crit',esc(h.state));
  return pill(FL_TONE[h.rank]||'crit',esc(h.state));
}
// Age from a fixed instant — the payload's own `generatedAt`, not this browser's clock. The two
// disagree by however far the laptop has drifted, and every age on this page must share one basis or
// the ordering the server computed stops matching the numbers rendered beside it.
function flAge(ms){
  if(ms==null)return '—';
  const h=ms/3.6e6;
  if(h<1)return Math.max(0,Math.round(ms/6e4))+'m';
  if(h<48)return Math.round(h)+'h';
  return Math.round(h/24)+'d';
}
// THE MEMORY EXPORT TILE. Its own renderer and not an inline expression, because the rule it holds
// is the one this whole lane exists for and an untestable copy of it is worth nothing: the export
// that pushes each slice into the memory layer exits 0 on every outcome, so a slice whose records
// never reached the backend is identical to a clean one on every other number on this page.
// Measured 2026-10-03: 42 writes across 6 areas had FAILED and nothing here said so.
//
// THREE ANSWERS, NOT TWO. Failed is red. Degraded — accepted and never read back — is amber.
// Unmeasured (no receipt, or one older than the rollup it was meant to export) is GREY: it must
// not be published as a pass and must not be published as a finding either, and an area with no
// receipt is absent from the clean count rather than a zero in it.
function flMemoryExport(mx,denom){
  const m=mx||{}, by=m.byState||{};
  if(!m.areasCounted)return ['','Memory export','&mdash;',
    'no report directory carries an export receipt — the export has never been observed on this box, which is not a clean run'];
  const unmeasured=(by.absent||0)+(by.stale||0);
  const cl=(m.failedReceipts||0)>0?'bad':((by.degraded||0)||(by.unreadable||0))?'warn':'';
  return [cl,'Memory export',`${m.failedReceipts||0}<span class="u"> writes failed</span>`,
    `${by.verified||0} of ${m.areasCounted} area(s) measured a clean export ${denom(m.areasCounted)}`
    +((m.unverifiedReceipts||0)?` · ${m.unverifiedReceipts} accepted and never read back — neither a pass nor a failure`:'')
    +((by.absent||0)?` · <b>${by.absent} wrote no receipt</b> — the lane exits 0, so that is silence`:'')
    +((by.stale||0)?` · ${by.stale} carry receipts older than their own rollup`:'')
    +((by.unreadable||0)?` · ${by.unreadable} unreadable — a fault, so their outcome is UNKNOWN`:'')
    +(unmeasured?` · ${unmeasured} area(s) unmeasured and excluded from the clean count`:'')];
}
// ── END FLEET RENDERERS ─────────────────────────────────────────────────────────────────────────
async function loadFleet(){
  const rowsEl=$('fl-rows'), kEl=$('fl-kpis'), hEl=$('fl-health');
  if(!rowsEl)return;
  if(hEl&&!hEl.dataset.loaded)hEl.innerHTML='<span class="mut">loading…</span>';
  let d;
  try{ d=await (await fetch('/api/fleet/overview')).json(); }
  catch(e){
    // A fetch that failed is not an empty fleet, and the page must not be left showing the last
    // reading with no sign that it is now unbacked.
    kEl.innerHTML='<div class="kpi bad"><div class="k">fleet</div><div class="v">unreachable</div>'
      +'<div class="s">the panel could not be reached ('+esc(e.message)+') — the fleet is UNKNOWN, not empty</div></div>';
    if(hEl)hEl.innerHTML='<div class="pk-err">health could not be read</div>';
    rowsEl.innerHTML='<tr><td colspan="7"><span class="pill unk">no reading</span></td></tr>';
    setTabN('fleet',null); return;
  }
  if(!d||!d.ok){
    kEl.innerHTML='<div class="kpi bad"><div class="k">fleet</div><div class="v">—</div><div class="s">'
      +esc((d&&(d.reason||d.error))||'the fleet overview could not be assembled')+'</div></div>';
    if(hEl)hEl.innerHTML='<div class="pk-err">health could not be read</div>';
    rowsEl.innerHTML='<tr><td colspan="7"><span class="pill unk">no reading</span></td></tr>';
    setTabN('fleet',null); return;
  }
  if(hEl)hEl.dataset.loaded='1';
  const now=Date.parse(d.generatedAt), st=d.status||{}, t=d.totals||{}, h=d.health||{}, ls=d.lastScanned||{};
  genFleetNewest=ls.newest&&Number.isFinite(ls.newest.ageMs)?{ageMs:ls.newest.ageMs,area:ls.newest.area}:null;
  renderGen();
  // The server's remedy partition. Defaulted rather than assumed: a payload from a panel older than
  // the partition carries no `counts`, and the tile must degrade to zeros it can render rather than
  // throwing and taking the whole page with it.
  const hc=h.counts||{};
  const areas=d.areas||[];
  const swept=st.swept||0, total=areas.length;
  const denom=(n)=>`over ${n} of ${total} area${total===1?'':'s'}`;

  // Banners for the two conditions that make everything below it less than it appears. Both are
  // rendered as their own state above the numbers rather than as a footnote under them.
  const banners=[];
  if(d.registryStale)banners.push(`<div class="card card-tight"><b>the registry is being served from cache</b> — it could not be re-read at ${esc(String(d.registryStale.at).slice(0,19))} (${esc(d.registryStale.error)}). The areas below describe the last registry that loaded, which may not be the one on disk.</div>`);
  if(d.undeclaredScan&&!d.undeclaredScan.ok)banners.push(`<div class="card card-tight"><b>${esc(d.undeclaredScan.reason)}</b></div>`);
  if((st.unreadable||[]).length)banners.push(`<div class="card card-tight"><b>${st.unreadable.length} rollup(s) could not be read</b> — ${st.unreadable.map(u=>esc(u.area)+' ('+esc(u.detail||'unknown')+')').join(', ')}. These contribute to no total on this page; an unreadable rollup is never an empty one.</div>`);
  for(const m of (st.areasMisdeclared||[]))banners.push(`<div class="card card-tight"><b>${esc(m.label||m.slug||'an area')} is misdeclared</b> — ${esc(m.reason)}</div>`);
  $('fl-banner').innerHTML=banners.join('');

  const cve=t.cve||{}, kev=t.kev||{}, all=t.all||{};
  // Defaulted, not assumed: a payload from a panel older than this lane carries no memoryExport,
  // and the tile must then say the outcome is unobserved rather than render a confident zero.
  const mx=d.memoryExport||{areasCounted:0};
  const kevKnown=kev.areasConsulted>0;
  kEl.innerHTML=[
    // The CVE feed alone — what the word "CVE" names. Never the all-lane figure, which is 200x
    // larger and would make "CVEs" mean "everything any scanner said".
    [(cve.crit>0||cve.high>0)?'bad':(cve.med>0?'warn':'good'),'Fleet CVEs',
      `${cve.crit||0}<span class="u">C</span> · ${cve.high||0}<span class="u">H</span> · ${cve.med||0}<span class="u">M</span> · ${cve.low||0}<span class="u">L</span>`,
      `${cve.cves||0} advisory rows ${denom(cve.areasCounted||0)}`
      +((cve.unknown||0)?` · ${cve.unknown} unscored`:'')
      +((cve.areasWithoutCveTotals||[]).length?` · ${cve.areasWithoutCveTotals.length} area(s) predate the CVE split and are absent from this sum, not zero in it`:'')],
    // KEV is the tile most likely to be misread, so its sub-line always names the catalogue
    // denominator — including when the answer is a clean 0.
    kevKnown
      ? [(kev.count>0)?'bad':'good','KEV — exploited',`${kev.count||0}`,
        `${denom(kev.areasConsulted)} that consulted the catalogue`
        +((kev.claimed||0)>(kev.count||0)?` · ${kev.claimed-kev.count} further claim(s) demoted: the repo never declared the affected version`:'')
        +((kev.areasUnknown||[]).length?` · ${kev.areasUnknown.length} area(s) never recorded whether they consulted it`:'')
        +((kev.areasNotConsulted||[]).length?` · ${kev.areasNotConsulted.length} area(s) could not load it`:'')]
      : ['','KEV — exploited','&mdash;','no area recorded a successful check against the actively-exploited list (CISA KEV) — this is unmeasured, not zero'],
    [swept<total?'warn':'good','Areas swept',`${swept}<span class="u">/${total}</span>`,
      `${st.areasDeclared||0} declared · ${st.areasUndeclaredOnDisk||0} on disk that nothing schedules`
      +((st.neverSwept||[]).length?` · <b>${st.neverSwept.length} never swept</b> — a coverage void, not a clean area`:'')
      +((st.paused||[]).length?` · ${st.paused.length} paused by declaration`:'')],
    // HEADLINES WHAT WANTS A HUMAN, which is not the same as what ranks above clean. This read
    // `${clean}/${total} ok` over a count of everything ranked, and on a box mid-sweep that is a
    // sentence about nothing: measured 2026-09-11, 18 areas had a sweep RUNNING in them and the
    // tile said "7/39 ok · 27 need attention · worst: hung" — burying the 3 areas whose sweep had
    // actually died inside a number 15 of whose members wanted no action at all. `in-flight` is
    // therefore stated and never added in; the server's kind partition decides which is which.
    [(hc.broken||0)>0?'bad':((hc.behind||0)>0?'warn':'good'),'Fleet health',
      `${h.needsAttention||0}<span class="u"> need a human</span>`,
      ((hc.broken||0)+(hc.behind||0))
        ? `<b>${hc.broken||0} broken</b> · ${hc.behind||0} behind · ${hc['in-flight']||0} sweeping now · ${hc.ok||0} ok`
          +((hc.broken||0)?` · worst: ${esc((h.alarming[0]||{}).state||'—')}`:'')
        : ((hc['in-flight']||0)
          ? `nothing is broken or behind · ${hc['in-flight']} area(s) are being swept right now`
          : 'every area is fresh, paused or unscheduled — nothing is alarming')],
    // A SEPARATE LANE, AND NEVER FOLDED INTO FLEET HEALTH — see flMemoryExport above.
    flMemoryExport(mx, denom),
    ls.newest
      ? ['','Last scanned',`${flAge(ls.newest.ageMs)}<span class="u"> ago</span>`,
        `newest: ${esc(ls.newest.area)} · oldest: ${esc((ls.oldest||{}).area||'—')} at ${flAge((ls.oldest||{}).ageMs)}`
        +((ls.undated||[]).length?` · ${ls.undated.length} area(s) carry no parseable timestamp`:'')]
      : ['','Last scanned','&mdash;','no area on this box carries a parseable scan time'],
    ['','Repos scanned',`${(st.repos||{}).scanned||0}`,
      `${denom((st.repos||{}).areasCounted||0)} that reported a figure`
      +(((st.repos||{}).resolvedSeen||0)?` · largest in-scope set seen by one area: ${(st.repos||{}).resolvedSeen}`:'')],
    // Deliberately last and deliberately NOT called "findings". This is every lane's output summed,
    // hygiene and lint included, which is a different population from the CVE tile above it — and
    // adding the two would be the category error the rollup keeps them apart to prevent.
    ['','All lanes, all areas',
      `${all.crit||0}<span class="u">C</span> · ${all.high||0}<span class="u">H</span> · ${all.med||0}<span class="u">M</span> · ${all.low||0}<span class="u">L</span>`,
      `${denom(all.areasCounted||0)} · ${all.undetermined||0} graded by nothing`
      +' · every check, housekeeping included — not comparable to the known-vulnerabilities figure'],
  ].map(([cl,k,v,s])=>`<div class="kpi ${cl}"><div class="k">${k}</div><div class="v tnum">${v}</div><div class="s">${s}</div></div>`).join('');
  $('fl-n').textContent=`${total} area${total===1?'':'s'} · ${swept} swept`;

  // ── health: the state tally, then every area that is not quiet, worst first ────────────────────
  const byState=h.byState||{};
  const order=Object.keys(byState).sort((a,b)=>((h.rankOf||{})[b]??3)-((h.rankOf||{})[a]??3)||a.localeCompare(b));
  const chips=order.map(s=>{
    // Same discrimination as the rows below: the server's kind decides the colour, rank only breaks
    // ties in the ordering. A chip reading `overrunning 15` in amber is the summary-level version of
    // exactly the conflation this partition exists to undo.
    const kind=(h.kindOf||{})[s];
    const tone=FL_QUIET.has(s)?'plan':(kind?(FL_KIND_TONE[kind]||'crit'):(FL_TONE[(h.rankOf||{})[s]??3]||'crit'));
    return `<span class="kv"><span class="pill ${tone}">${esc(s)}</span><span class="tnum">${byState[s]}</span></span>`;
  }).join('');
  // ROWS GROUPED BY REMEDY, BROKEN FIRST. One flat worst-first list sorted `hung` above
  // `overrunning` correctly and still read as a single 27-row wall of problems, because rank orders
  // severity and says nothing about whether a row wants an action. Three headed groups, each with
  // the sentence that says what the group MEANS, so a reader scrolling past in-flight knows they are
  // skipping progress rather than skipping findings. A group with no members is not drawn at all.
  const KIND_HEAD={
    broken:['the sweep or its evidence FAILED — these want a human now',''],
    behind:['swept, but not recently or not completely enough — a scheduling gap, not a failure','warn'],
    'in-flight':['a sweep is RUNNING in these right now. Nothing to do: their numbers are about to change, and until it finishes what is on screen is the previous slice','plan'],
  };
  const byKind=(k)=>(h.alarming||[]).filter(a=>(a.kind||'broken')===k);
  const groupTable=(k)=>{
    const rows=byKind(k); if(!rows.length)return '';
    const [why]=KIND_HEAD[k]||['',''];
    return `<div class="gap-t"><b>${esc(k)}</b> <span class="mut">— ${esc(why)}</span></div>`
      +'<div class="tw"><table><thead><tr><th>Area</th><th>State</th><th>What the deadman says</th></tr></thead><tbody>'
      +rows.map(a=>`<tr><td><b>${esc(a.area)}</b></td><td>${flPill(a)}</td><td class="mut">${esc(a.line)}</td></tr>`).join('')
      +'</tbody></table></div>';
  };
  hEl.innerHTML=chips
    +((h.alarming||[]).length
      ? ['broken','behind','in-flight'].map(groupTable).join('')
      : '<div class="gap-t mut">Nothing is alarming. That is a statement about sweep liveness only — it says every area was swept recently enough to be believed, not that any of them are clean.</div>');
  // The heading counts what wants a human. A box mid-sweep should not read as 27 problems.
  $('fl-hn').textContent=(h.needsAttention||0)
    ? `${hc.broken||0} broken · ${hc.behind||0} behind`+((hc['in-flight']||0)?` · ${hc['in-flight']} sweeping`:'')
    : ((hc['in-flight']||0)?`${hc['in-flight']} sweeping · none broken`:'none alarming');
  // The badge counts areas needing attention, matching every other tab's convention that a number
  // in the strip is work rather than volume — and "work" excludes an area a sweep is inside of. A
  // badge that hit 27 every time the nightly fleet wave ran is a badge an operator stops reading,
  // which is the alarm-fatigue death monitor/liveness.mjs names in its own header.
  setTabN('fleet',h.needsAttention??null,
    `${hc.broken||0} broken · ${hc.behind||0} behind. Areas being swept right now are excluded — they are progress, not work.`);

  // ── the areas table ───────────────────────────────────────────────────────────────────────────
  const ageOf=(iso)=>{const ms=iso?Date.parse(iso):NaN;return Number.isFinite(ms)?Math.max(0,now-ms):null;};
  rowsEl.innerHTML=areas.map(a=>{
    // A slug is what the URL carries; an undeclared area has none, so its name is not a link rather
    // than a link that guesses a slug nobody declared.
    const name=a.slug
      ? `<a href="/${esc(a.slug)}/">${esc(a.label)}</a>`
      : `${esc(a.label)} <span class="mut">(undeclared)</span>`;
    if(a.read!=='ok'){
      const why=a.read==='never-swept'
        ? 'no results recorded yet — this is missing data, not a clean area'
        : `the rollup could not be read (${esc(a.readDetail||'unknown')}) — this is never an empty one`;
      return `<tr><td>${name}${a.paused?' '+pill('plan','paused'):''}</td><td>${flPill(a.health)}</td>`
        +`<td colspan="5" class="mut">${why}</td></tr>`;
    }
    const age=ageOf(a.lastScannedAt||a.lastRolledUpAt);
    const basis=a.lastScannedAt?'scan time, from the slice stamp':'ROLL-UP time — this slice carries no parseable scan stamp, so this is when it was aggregated, not when it ran';
    const kv=a.kev||{};
    const kevCell=kv.consulted===true
      ? `<span class="tnum${(kv.count||0)>0?' txt-crit':''}">${kv.count||0}</span>`
      : `<span class="pill unk" title="${kv.consulted===false?'the KEV catalogue could not be loaded for this slice':'this rollup predates the kevConsulted flag'}">?</span>`;
    const c=a.cve, al=a.all||{};
    const cveCell=c
      ? `<span class="tnum">${c.crit||0}<span class="u">C</span> ${c.high||0}<span class="u">H</span> ${c.med||0}<span class="u">M</span> ${c.low||0}<span class="u">L</span></span>`
      : '<span class="pill unk" title="this rollup predates the CVE/all-lane split, so its CVE-only figure does not exist — absent, not zero">n/a</span>';
    const cov=a.coverage;
    // scanned/intended, because a slice that swept 1 of 34 repos is the single most misleading row
    // this table can carry — it looks like a normal result and describes a 3% sample.
    const reposCell=(a.repos&&a.repos.scanned!=null)
      ? `<span class="tnum${(a.repos.intended!=null&&a.repos.intended>a.repos.scanned)?' txt-part':''}" title="${cov?esc(`${cov.swept??'?'} swept of ${cov.resolved??'?'} discovery-resolved`+(cov.unsweptInScope?`; ${cov.unsweptInScope} declared in scope and never scanned`:'')):'no coverage block'}">${a.repos.scanned}${(a.repos.intended!=null&&a.repos.intended!==a.repos.scanned)?`<span class="u">/${a.repos.intended}</span>`:''}</span>`
      : '<span class="mut">—</span>';
    return `<tr>
      <td>${name}${a.paused?' '+pill('plan','paused'):''}${a.batch?` <span class="mut">${esc(a.batch)}</span>`:''}</td>
      <td title="${esc(a.health&&a.health.line||'')}">${flPill(a.health)}</td>
      <td class="mut tnum" title="${esc(basis)} · ${esc(a.lastScannedAt||a.lastRolledUpAt||'')}">${flAge(age)}${a.lastScannedAt?'':' <span class="pill unk">roll</span>'}</td>
      <td>${reposCell}</td>
      <td>${cveCell}</td>
      <td>${kevCell}</td>
      <td class="mut tnum">${al.crit||0}<span class="u">C</span> ${al.high||0}<span class="u">H</span> ${al.med||0}<span class="u">M</span> ${al.low||0}<span class="u">L</span></td>
    </tr>`;
  }).join('')||'<tr><td colspan="7" class="mut">the registry declares no areas and no report directory holds a rollup — this is an empty registry, not an empty fleet</td></tr>';
  $('fl-an').textContent=`${areas.length} row${areas.length===1?'':'s'}`;
}

async function loadLanes(){
  const body=$('ln-rows'); if(!body)return;
  body.innerHTML='<tr><td colspan="6" class="mut">loading…</td></tr>';
  let d;
  try{ d=await (await fetch('/api/perf?project='+encodeURIComponent(curProj||''))).json(); }
  catch(e){ body.innerHTML='<tr><td colspan="6"><div class="pk-err">could not reach the panel — lane state is UNKNOWN, not empty</div></td></tr>'; setTabN('lanes',null); return; }
  if(!d||!d.ok){ body.innerHTML=`<tr><td colspan="6" class="mut">${esc((d&&d.error)||'lane state unavailable')}</td></tr>`; setTabN('lanes',null); return; }
  const rows=(d.tuning&&d.tuning.scanners)||[];
  if(d.tuningError){ body.innerHTML=`<tr><td colspan="6" class="mut">the tuning model could not be read (${esc(d.tuningError)}) — lane state is UNKNOWN, not off</td></tr>`; setTabN('lanes',null); return; }
  if(!rows.length){ body.innerHTML='<tr><td colspan="6" class="mut">the tuning model returned no lanes — this is a fault, not an empty roster</td></tr>'; setTabN('lanes',null); return; }
  body.innerHTML=rows.map(s=>`<tr>
    <td>${esc(s.label||s.id)}</td>
    <td><code class="t-loc">${esc(s.id)}</code></td>
    <td class="mut">${esc(s.costClass||'—')}</td>
    <td>${laneBox(s)}</td>
    <td class="mut">${s.derivedEnabled===null?'—':(s.derivedEnabled?'on':'off')}</td>
    <td class="mut">${esc(s.reason||s.derivedReason||'')}</td>
  </tr>`).join('');
  const off=rows.filter(s=>s.enabled===false&&!s.blocked).length;
  const blocked=rows.filter(s=>s.blocked).length;
  $('ln-n').textContent=`${rows.length} lanes`+(off?` · ${off} off`:'')+(blocked?` · ${blocked} blocked`:'');
  setTabN('lanes',blocked||null,blocked?`${blocked} lane(s) are forced on but cannot run here`:'');
}

// The verdict is the model's and is labelled as the model's — it writes no annotation, so it cannot
// be mistaken for a signed human judgment.
// The run button. Delegated, like every other action on this page, and DISABLED the moment it is
// pressed: a second click while the first request is in flight would ask for a sweep that is
// already starting, and `trigger` answers "already running" — a refusal the operator reads as a
// failure of their button rather than as the guard doing its job.
document.addEventListener('click',async(e)=>{
  const b=e.target.closest&&e.target.closest('.lane-run'); if(!b||b.disabled)return;
  const check=b.dataset.check; if(!check)return;
  b.disabled=true; const was=b.textContent; b.textContent='starting…';
  const box=b.closest('.lane-void-acts');
  const say=(cls,msg)=>{ if(box){const d=box.querySelector('.lane-run-msg')||box.appendChild(Object.assign(document.createElement('div'),{className:'lane-run-msg mut'})); d.className=`lane-run-msg mut ${cls}`; d.textContent=msg;} };
  try{
    const proj=(typeof curProj==='string'&&curProj)?`&project=${encodeURIComponent(curProj)}`:'';
    const r=await cwPost(`/api/sweep?check=${encodeURIComponent(check)}${proj}`,{});
    const j=await r.json().catch(()=>({}));
    if(j&&j.started){ say('','started — this lane is running now; the tab will fill when it finishes.'); }
    // `started:false` is not an error: "already running" is the honest answer and the reason is the
    // server's own words, not a sentence invented here.
    else say('bad',`not started — ${esc(j&&j.reason?j.reason:('HTTP '+r.status))}`);
  }catch(err){ say('bad','could not reach the panel to start it'); }
  b.textContent=was; b.disabled=false;
});

// Tier, not verdict: weak is UNVERIFIED in both directions — never corroborated, never refuted.
const VERIFY_TIER_PILL={strong:'live',medium:'part',weak:'plan'};
document.addEventListener('click',async(e)=>{
  const b=e.target.closest&&e.target.closest('.llm-verify'); if(!b||b.disabled)return;
  const out=b.parentElement.querySelector('.llm-verdict');
  b.disabled=true; const was=b.textContent; b.textContent='verifying…';
  if(out)out.innerHTML='';
  try{
    const r=await cwPost('/api/leaks/verify',{headers:{'content-type':'application/json'},
      body:JSON.stringify({repo:b.dataset.repo,rule:b.dataset.rule,file:b.dataset.file,line:Number(b.dataset.line)||0})});
    const j=await r.json().catch(()=>({}));
    if(!j.ok){ if(out)out.innerHTML=`<span class="pk-err">verify failed — ${esc(j.error||('HTTP '+r.status))}</span>`; }
    else if(out){
      const tier=(j.evidence&&j.evidence.tier)||'weak';
      const tone=VERIFY_TIER_PILL[tier]||'plan';
      out.innerHTML=`<span class="pill ${tone}" title="${esc((j.evidence&&j.evidence.detail)||'')}">${esc(j.status||tier)} · ${esc(tier)}</span>`
        +` <span class="mut">the stated reason, checked — advisory, nothing recorded</span>`;
    }
  }catch(err){ if(out)out.innerHTML='<span class="pk-err">verify failed — could not reach the panel</span>'; }
  b.disabled=false; b.textContent=was;
});

const LLM_VERDICT_PILL={fixture:'live',real:'crit',undetermined:'plan'};
document.addEventListener('click',async(e)=>{
  const b=e.target.closest&&e.target.closest('.llm-check'); if(!b||b.disabled)return;
  const out=b.parentElement.querySelector('.llm-verdict');
  b.disabled=true; const was=b.textContent; b.textContent='asking…';
  if(out)out.innerHTML='';
  try{
    const r=await cwPost('/api/leaks/check',{headers:{'content-type':'application/json'},
      body:JSON.stringify({repo:b.dataset.repo,rule:b.dataset.rule,file:b.dataset.file,line:Number(b.dataset.line)||0})});
    const j=await r.json().catch(()=>({}));
    if(!j.ok){ if(out)out.innerHTML=`<span class="pk-err">check failed — ${esc(j.error||('HTTP '+r.status))}</span>`; }
    else if(out){
      const tone=LLM_VERDICT_PILL[j.verdict]||'plan';
      const eng=j.engine?`${j.engine.engine} · ${j.engine.model}`:'local model';
      // The verdict pill stays in the cell; the EVIDENCE expands onto its own full-width row, so a
      // long reason no longer squeezes the columns it is about.
      renderVerdictRow(b,j,tone,eng);
      out.innerHTML=`<span class="pill ${tone}" title="${esc(j.reasoning||'')}">${esc(j.verdict)} · ${esc(j.confidence||'?')}</span>`;
      return;
    }
    else if(false){
      // The reasoning and the SOURCE both render. A verdict whose evidence sits only in a tooltip is
      // a claim the operator is asked to take on trust, and they are the adjudicator here. The
      // matched line arrives already masked by the server; nothing unredacted reaches this script.
      out.innerHTML=`<span class="pill ${tone}" title="${esc(j.reasoning||'')}">${esc(j.verdict)} · ${esc(j.confidence||'?')}</span>`
        +` <span class="mut">${esc(eng)}${j.salvaged?' · salvaged':''} — advisory, nothing recorded</span>`
        +(j.reasoning?`<div class="llm-why mut">${esc(j.reasoning)}</div>`:'')
        +((j.signals&&j.signals.length)?`<div class="llm-why mut">signals: ${j.signals.map(x=>esc(x)).join(' · ')}</div>`:'')
        +(j.excerpt?`<pre class="llm-src">${esc(j.excerpt)}</pre>`
          +`<div class="llm-why mut">line ${esc(j.matchedLine||'?')} — ${esc(j.redaction||'redacted')}</div>`:'');
    }
  }catch(err){ if(out)out.innerHTML='<span class="pk-err">check failed — could not reach the panel</span>'; }
  b.disabled=false; b.textContent=was;
});

// ── VISION (colour-vision-deficiency palettes) ──────────────────────────────────────────────────
// 'normal' REMOVES the attribute rather than setting data-cvd="normal": panel-cvd.css deliberately
// defines no normal block, so the default palette is the absence of a selection and not a fifth
// palette competing with it. Anything unrecognised also reads as normal — a stale or corrupt
// storage value must not leave the panel in a palette nobody chose.
const CVD_MODES=['protanopia','deuteranopia','tritanopia','achromatopsia'];
const CVD_NOTE={achromatopsia:'severity, status and attribution each separate on lightness; across those groups, position carries the distinction, not colour.'};
function applyCvd(choice){
  if(!CVD_MODES.includes(choice))choice='normal';
  if(choice==='normal')document.documentElement.removeAttribute('data-cvd');
  else document.documentElement.setAttribute('data-cvd',choice);
  try{
    if(choice==='normal')localStorage.removeItem('cw-cvd');
    else localStorage.setItem('cw-cvd',choice);
  }catch(e){}
  const s=document.getElementById('cvd-sel'); if(s)s.value=choice;
  const n=document.getElementById('cvd-note'); if(n)n.textContent=CVD_NOTE[choice]||'';
}
(function(){
  const s=document.getElementById('cvd-sel'); if(!s)return;
  s.onchange=()=>applyCvd(s.value);
  let stored=null;
  try{ stored=localStorage.getItem('cw-cvd'); }catch(e){ /* unreadable storage reads as normal */ }
  applyCvd(CVD_MODES.includes(stored)?stored:'normal');
})();

function applyTheme(choice){
  if(choice!=='light'&&choice!=='dark')choice='auto';
  const l=document.getElementById('theme-light');
  if(l)l.media=CW_THEME_MEDIA[choice];
  // The cvd light sheet tracks the theme sheet. Flipping one without the other is the defect this
  // line exists to prevent: a manual LIGHT choice would otherwise keep the DARK cvd palette, whose
  // colours are graded for #0f1319 and fail AA on #f6f7f9 — the same leak as task 31.
  const c=document.getElementById('cvd-light');
  if(c)c.media=CW_THEME_MEDIA[choice];
  try{
    if(choice==='auto')localStorage.removeItem('cw-theme');
    else localStorage.setItem('cw-theme',choice);
  }catch(e){}
  syncThemeButtons(choice);
}
function syncThemeButtons(choice){
  document.querySelectorAll('#menupop .theme-opt').forEach(b=>{
    b.setAttribute('aria-checked', String(b.dataset.themeSet===choice));
  });
}
document.querySelectorAll('#menupop .theme-opt').forEach(b=>{
  b.onclick=()=>applyTheme(b.dataset.themeSet);
});
(function(){
  let stored=null;
  try{ stored=localStorage.getItem('cw-theme'); }catch(e){ /* unreadable storage reads as auto */ }
  syncThemeButtons(stored==='light'||stored==='dark'?stored:'auto');
})();

// Every tab is a #hash route that survives reload. The valid set is DERIVED — the native views
// plus the iframe views — because a hand-maintained whitelist drifted twice (exposure and
// remediation wrote hashes a reload then ignored, silently landing on Overview): a tab that
// exists is a tab that restores, by construction.
const VALID_VIEWS=new Set([...Object.keys(NATIVE),'dashboard','timeline','runtime','modmap','sitemap']);
// PATH VIEWS: every tab lives at a real path (/name/ — served by serve.mjs's page route, whose
// PANEL_VIEWS list is pinned to this one by admin/test/panel-view-paths.test.mjs so neither can
// drift alone). Paths reach the server — loggable, redirectable after login, and they survive
// hash-stripping tooling — which is why /codeql/ pioneered the shape. A valid legacy #hash still
// wins when present (old bookmarks and the skip-link write one) and setView then normalises it,
// so #sitemap becomes /sitemap/ rather than lingering. DERIVED from VALID_VIEWS, never
// hand-listed: the hand-maintained whitelist above drifted twice before it was derived.
// RETIRED VIEW NAMES -> the view they became. `/leaks/` was the gitleaks tab; the lane it renders
// has been keyed `secrets` everywhere else since it was written (scanners.secrets, the rollup, the
// annotations), so the URL was the one place still using the old word. An alias, not a deletion: a
// link pasted into an issue outlives the name it was written with, and 404ing one is a worse answer
// than serving it. setView normalises on arrival, so an old link lands on the right page AND the
// address bar stops repeating the retired name.
//
// It cannot express the OTHER half of this rename. `/secrets/` used to mean the Held tab (the
// credentials this box holds) and now means the opposite direction (credentials found in the code).
// One name cannot alias to two views, so an old /secrets/ bookmark silently changes subject — the
// tab header and the selected tab both say which one you are on, and that is the whole mitigation.
const VIEW_ALIAS={leaks:'secrets'};
const knownView=(v)=>VALID_VIEWS.has(v)||Object.prototype.hasOwnProperty.call(VIEW_ALIAS,v);
const deAlias=(v)=>VIEW_ALIAS[v]||v;
// Aliases resolve here too, so `/leaks/` and `/<slug>/leaks/` both reach the view rather than
// falling through to Overview — a fall-through would look like a working link to the wrong page.
// `let`, and rebuildable: generated lane tabs (addDerivedLaneTabs) add to VALID_VIEWS after this
// runs, and a path table computed once would 404 every tab the page had just drawn — a link the
// user can see and the router denies, which is the worst of the two failures available here.
let PATH_VIEWS=buildPathViews();
function buildPathViews(){
  return Object.fromEntries(
    [...[...VALID_VIEWS].map(v=>[v,v]),...Object.entries(VIEW_ALIAS)]
      .flatMap(([seg,v])=>[['/'+seg,v],['/'+seg+'/',v]]));
}
function rebuildViewPaths(){ PATH_VIEWS=buildPathViews(); }
// THE PROJECT IS PART OF THE ROUTE, not a hidden preference.
//
// It lived only in localStorage, so a URL named a VIEW and not a SUBJECT: /leaks/ meant "leaks for
// whatever this browser last chose", two people opening the same link saw different findings, and a
// link pasted into an issue could not be trusted to show what its author saw. For an instrument
// whose entire claim is that a number belongs to a named project, an unattributable URL is the same
// defect one layer up.
//
// THE PATH CARRIES THE SLUG, NOT THE LABEL. `commitwork admin` is the label an operator reads and
// it contains a space; `commitwork-admin` is the declared slug and is URL-safe. The registry
// already owns that mapping (payload.slugs, label -> slug), so the panel reads it back rather than
// slugifying the label itself — deriving a slug here would be a second implementation of a rule the
// registry declares, and the two would disagree the first time a label was renamed.
//
// Because the slug map arrives WITH the payload, boot can only hold the slug; load() resolves it to
// a label once `slugs` is in hand. That ordering is why `pendingProjSlug` exists.
const viewUrl=(v,proj)=>{
  // A fleet or account page is not about a project, so its URL names none: /commitwork-admin/fleet/
  // claimed a project for a page that ignores it.
  // /perf/<scanner>/ is owned by static/perf-console.js; writing /perf/ here would drop the scanner.
  if(v==='perf'&&typeof pcUrl==='function')return pcUrl();
  if(scopeOf(v)!=='project')return '/'+v+'/';
  const p=proj===undefined?curProj:proj;
  const slug=p?(SLUGS&&SLUGS[p])||null:null;
  const view=v==='overview'?'':(v+'/');
  // No project selected, or a label with no declared slug: fall back to the plain view path rather
  // than inventing a segment. A guessed slug in a URL is a claim about identity nobody declared.
  if(!slug)return v==='overview'?'/':('/'+v+'/');
  return '/'+slug+'/'+(view||'overview/');
};
// The project slug named by the URL, or null. Read at CALL time so back/forward is seen.
// Two-segment only: `/leaks/` is a view, never a project.
const urlProjectSlug=()=>{
  const m=location.pathname.match(/^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9-]+)\/?$/);
  // /perf/<scanner>/ names a scanner, never a project — /perf/sast/ is not project `perf`, view `sast`.
  if(m&&(m[1]==='section'||m[1]==='perf'))return null;
  return m&&knownView(m[2])?m[1]:null;
};
// Boot reads the slug before `slugs` exists; load() resolves it. Null once resolved or absent.
let pendingProjSlug=null;
// Set when the URL named a slug the registry does not declare. Distinct from 'nothing selected'.
let unknownSlug=null;
// SECTION ROUTES — /section/<id>/, prefixed on purpose. Two group ids collide with live view
// names (overview, secrets), so a bare /secrets/ would silently change what an existing link
// resolves to. The prefix costs a segment and buys every section the same shape.
const SECTION_RE=/^\/section\/([a-z0-9-]+)\/?$/;
const urlSection=()=>{ const m=location.pathname.match(SECTION_RE); return (m&&GROUP_ORDER.includes(m[1]))?m[1]:null; };
// The first tab of a section, which is its most-summary view.
function firstViewOfSection(g){
  const tabs=tabsByGroup().get(g)||[];
  const t=tabs[0]; return t?t.dataset.v:null;
}
// True when the URL already names the section this view belongs to — so setView leaves it alone.
function sectionPathHolds(v){
  const g=urlSection(); if(!g)return false;
  return firstViewOfSection(g)===v;
}
const urlView=()=>{
  const h=location.hash.slice(1); if(h&&knownView(h))return deAlias(h);
  const sec=urlSection(); if(sec){ const fv=firstViewOfSection(sec); if(fv)return fv; }
  if(/^\/perf\/[a-z0-9][a-z0-9._-]{0,63}\/?$/.test(location.pathname))return 'perf';

  // two-segment form first: /<slug>/<view>/ — the VIEW is the second segment
  const m=location.pathname.match(/^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9-]+)\/?$/);
  if(m&&knownView(m[2]))return deAlias(m[2]);
  return PATH_VIEWS[location.pathname]||'overview';
};
