// admin/serve.mjs's login page, lifted verbatim. LOCAL_PORT is a required option rather than a
// module-level read, so this module has no hidden coupling to the server it was cut from.
import { esc } from '../../lib/html-escape.mjs';
import { THEME_LINKS, THEME_SCRIPT, THEME_SWITCH } from './theme-head.mjs';
export function loginPage({ bootstrapOpen, providers = {}, override = null, notice = null, enroll = false, ssoTotp = false, ssoFactor = 'totp', ssoMailed = null, localPort }) {
  // fact: an emailed code replaces the authenticator wording
  const emailLede = ssoMailed && ssoMailed.sent
    ? 'You are signed in with your provider. A 6-digit code was emailed to you; enter it to finish.'
    : `You are signed in with your provider, but the sign-in code could NOT be sent (${esc((ssoMailed && ssoMailed.detail) || 'mail is not configured')}). Ask the operator.`;
  // Eye / eye-with-a-diagonal-slash, inline: the CSP forbids an external request and this is
  // the first page a stranger sees, so the control cannot arrive a frame late. currentColor
  // lets both states inherit the one hover rule the text label used to carry.
  // Convention: the glyph depicts the CURRENT STATE, not the action — a slashed eye while the
  // password is hidden, an open eye while it is showing. aria-label names the ACTION instead
  // ("Show password" while hidden), so the two deliberately disagree: an icon reads as a
  // picture of what is true, a label reads as what pressing it will do.
  const EYE_A = `viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const EYE_D = `<path d="M1.9 12S5.6 5.5 12 5.5 22.1 12 22.1 12 18.4 18.5 12 18.5 1.9 12 1.9 12Z"/><circle cx="12" cy="12" r="3"/>`;
  const EYE = `<svg ${EYE_A}>${EYE_D}</svg>`;
  const EYE_OFF = `<svg ${EYE_A}>${EYE_D}<path d="M3.9 3.9 20.1 20.1"/></svg>`;
  // The seal and the wordmark as live text, so the accessible name is the word itself. On a light
  // ground panel-light.css recolours the seal to the default mark.
  const LOGO = `<div class="mark"><span class="seal"><svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="16" fill="#14161A"/><circle cx="16" cy="16" r="14.5" fill="none" stroke="#C9A227" stroke-width="1"/><circle cx="12" cy="20" r="2.4" fill="#C9A227"/><circle cx="21" cy="11" r="2.4" fill="none" stroke="#C9A227" stroke-width="1.3"/><path d="M13.7 18.3 L19.3 12.7" stroke="#C9A227" stroke-width="1.3" fill="none"/></svg></span><span class="wordmark">commitwork</span></div>`;

  // HIDDEN unless it can actually succeed. `providers.google` now means configured AND external
  // sign-in enabled — because this page is only ever served on the PUBLISHED port, where every
  // request is external by definition (loopback privilege is keyed to the operator port's socket,
  // serve.mjs:1307). With external sign-in off, the flow completes at Google, redirects back, and
  // is refused at the gate — so the button was an invitation to a dead end, and the operator who
  // took it got "external sign-in is disabled" after handing Google a consent screen.
  //
  // Absent beats disabled-with-an-explanation here: a greyed button still advertises a route that
  // does not exist on this deployment, and the switch that would open it is deliberately not
  // reachable from this page (it lives on the operator port, on the machine).
  const googleOn = !!providers.google;
  const googleBlock = !googleOn ? '' : `
    <button type="button" id="google" class="sso">
      <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45 24.5c0-1.6-.1-2.7-.4-4H24v7.3h12c-.2 2-1.5 5-4.4 7l-.1.4 6.4 4.9.4.1C42.4 36.5 45 31 45 24.5"/><path fill="#34A853" d="M24 46c5.8 0 10.7-1.9 14.3-5.2l-6.8-5.3c-1.8 1.3-4.3 2.2-7.5 2.2-5.7 0-10.6-3.8-12.3-9l-.4.1-6.6 5.1-.1.4C8.2 41.1 15.5 46 24 46"/><path fill="#FBBC05" d="M11.7 28.7c-.5-1.4-.7-2.8-.7-4.2s.3-2.9.7-4.2v-.4l-6.7-5.2-.2.1C3.4 17.6 2.7 20.7 2.7 24s.7 6.4 2.1 9.2z"/><path fill="#EA4335" d="M24 10.6c4 0 6.7 1.7 8.3 3.2l6-5.9C34.7 4.5 29.8 2.4 24 2.4 15.5 2.4 8.2 7.3 4.8 14.8l6.9 5.3c1.7-5.1 6.6-9.5 12.3-9.5"/></svg>
      Sign in with Google
    </button>
    <div class="or"><span>or</span></div>`;

  // Offered to EVERY sign-in page, not gated on a provider being configured, because a passkey
  // needs no provider — the authenticator and this panel are the only two parties. Hidden by the
  // script below when the browser has no WebAuthn at all, so the page never shows a control that
  // cannot work (the house rule the login page already follows for an unconfigured Google button).
  const passkeyBtn = `
    <button type="button" id="passkey" class="sso" hidden>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h1"/><circle cx="17" cy="15" r="3"/><path d="M17 18v3l1.5-1 1.5 1v-3"/></svg>
      Sign in with a passkey
    </button>`;

  // THE SSO SECOND FACTOR. An OAuth flow proved an identity and stopped, because the account has a
  // confirmed authenticator; this is where it resumes. Rendered BEFORE the bootstrap branch because
  // a pending challenge outranks every other state — the caller has already been identified, and
  // showing them a sign-in form would send them back through a flow they have completed.
  //
  // No email field, deliberately: the account is already known, it is named by the challenge the
  // server holds, and re-asking would invite a caller to name a DIFFERENT one. Nothing this form
  // sends selects an account.
  const ssoTotpBody = `<h1>One more step</h1>
       ${ssoFactor === 'email' ? `<p class="lede">${emailLede}</p>` : `<p class="lede">You are signed in with your provider. This account also has an authenticator,
         so the code completes it. A recovery code works here too.</p>`}
       <form id="sf" autocomplete="off">
         <label>${ssoFactor === 'email' ? 'Emailed code' : 'Authenticator code'}
           <input name="token" inputmode="numeric" autocomplete="one-time-code" spellcheck="false"
             autofocus required aria-describedby="sm"></label>
         <button id="sgo" class="pri" type="submit">Finish signing in</button>
       </form>
       <p class="msg" id="sm" role="status"></p>
       <p class="hint">Lost the authenticator? A recovery code goes in the same box. If you have
         neither, <code>node bin/panel-breakglass.mjs</code> on the box is the way back in.</p>
       <script>
       /* Its own script, not the layered one above: that state machine starts at email+password,
          and here the identity is already settled. Nothing this form sends names an account —
          the server reads that from the challenge behind the HttpOnly cookie. */
       (function(){
         var f=document.getElementById('sf'), m=document.getElementById('sm'), go=document.getElementById('sgo');
         var csrf=function(){ return fetch('/api/csrf').then(function(r){return r.json();})
           .then(function(j){return (j&&j.token)||'';}).catch(function(){return '';}); };
         f.onsubmit=function(e){
           e.preventDefault(); go.disabled=true; m.className='msg'; m.textContent='Checking…';
           var token=new FormData(f).get('token');
           csrf().then(function(t){
             return fetch('/auth/sso/totp',{method:'POST',
               headers:{'content-type':'application/json','x-cw-csrf':t},
               body:JSON.stringify({token:token})});
           }).then(function(r){ return r.json().then(function(j){ return {ok:r.ok,j:j}; }); })
           .then(function(res){
             if(!res.ok){
               go.disabled=false; m.className='msg err';
               /* The server's own words. A code that is merely WRONG and a challenge that has
                  EXPIRED want different actions from the reader, and only the server knows which. */
               m.textContent=(res.j&&res.j.error)||'That code was not accepted';
               f.querySelector('input').select();
               return;
             }
             m.className='msg ok'; m.textContent='Signed in — loading…';
             location.assign((res.j&&res.j.returnTo)||'/');
           }).catch(function(){ go.disabled=false; m.className='msg err'; m.textContent='Could not reach the server'; });
         };
       })();
       </script>`;

  const body = ssoTotp ? ssoTotpBody : override ? override : (bootstrapOpen && !enroll)
    ? `<h1>No account yet</h1>
       <p class="lede">This panel has no users. The first one can only be created <b>on the operator port</b> — that window closes permanently once an account exists, so a published panel can never mint its own admin.</p>
       <p class="hint">Open <code>http://127.0.0.1:${localPort}</code> on the box and create it there — that is the operator port, and it is the only one that will accept it. This page will accept a sign-in afterwards.</p>`
    : `<h1 id="ht">${enroll ? 'Create the first account' : 'Sign in'}</h1>
       ${enroll ? '<p class="lede">This window is open only from the operator port, and only while no account exists — it closes permanently the moment this succeeds.</p>' : ''}
       ${notice ? `<p class="hint" role="status">${String(notice).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</p>` : ''}
       ${enroll ? '' : passkeyBtn}
       ${enroll ? '' : googleBlock}
       <form id="f" novalidate>
         <div id="l1">
           <label>Email
             <input name="email" type="email" autocomplete="username" inputmode="email"
                    placeholder="you@example.com" required autofocus>
           </label>
           <label>Password
             <div class="pwrap"><input name="password" type="password" autocomplete="${enroll ? 'new-password' : 'current-password'}" ${enroll ? 'minlength="12"' : ''} required>
             <button type="button" class="pv" tabindex="-1" aria-label="Show password" aria-pressed="false">${EYE_OFF}</button></div>
           </label>
           ${enroll ? `<label>Confirm password
             <div class="pwrap"><input name="password2" type="password" autocomplete="new-password" minlength="12" required>
             <button type="button" class="pv" tabindex="-1" aria-label="Show password" aria-pressed="false">${EYE_OFF}</button></div>
           </label>` : ''}
         </div>
         <div id="l2" hidden>
           <p class="lede">Enter the 6-digit code from your authenticator app. Lost the phone? A recovery code works here once.</p>
           <label>Authenticator code
             <input name="token" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code">
           </label>
         </div>
         <div id="l3" hidden>
           <p class="lede">Point your phone's camera at the code: it offers to add Commitwork to the phone's own authenticator (Passwords on an iPhone, the default authenticator on Android), and any authenticator app can scan it too. On the phone itself, use the link below instead. Then enter the 6-digit code it shows — that switches the second factor on.</p>
           <div id="qr" class="qr"></div>
           <p><code id="sk"></code></p>
           <p><a id="oa" href="#">Add to this device's authenticator</a></p>
           <label>Code from the app
             <input name="etoken" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code">
           </label>
         </div>
         <button type="submit" id="go">Sign in</button>
         <p id="msg" class="msg" role="status" aria-live="polite"></p>
         <button type="button" class="secondary" id="ska" hidden>Skip for now — enrol later from the profile page</button>
       </form>
       <script>
       /* Layered sign-in. Layer 1: email+password only. Layer 2 (own screen, never inline):
          the TOTP code, shown only after the password verified — the server's distinct
          'invalid second factor' on a token-less attempt is that signal. Layer 3 (own screen):
          first-time enrolment for an account whose secret was issued but never confirmed —
          one-shot reissue, setup key, QR code and otpauth link (admin/static/qrcode.mjs is a
          zero-dependency encoder, so a vendored generator is no longer the blocker it was), then
          /api/me/totp/confirm flips enforcement ON. */
       const f=document.getElementById('f'), msg=document.getElementById('msg'), go=document.getElementById('go');
       const g=document.getElementById('google');
       // Dynamic import, not a static one: this script runs unconditionally on every login-page
       // load, but the QR container only exists (and is only needed) on the layer-3 branch —
       // fetching the encoder module for every sign-in would be pure waste on the common path.
       const renderQr = async (otpauth) => {
         const box = document.getElementById('qr');
         if (!box) return;
         try {
           const { encodeQR, qrToSvg } = await import('/static/qrcode.mjs');
           box.innerHTML = qrToSvg(encodeQR(otpauth), { moduleSize: 8 });
         } catch (e) {
           // Fails open to the text/link fallback that already exists beside it — a broken QR
           // render must never block enrolment, only lose its shortcut.
           box.textContent = '';
         }
       };
       const el=(i)=>document.getElementById(i);
       /* Handed down from the server-side constants so one edit changes both the initial
          render and the toggled state — two hand-kept copies drift. */
       const EYE=${JSON.stringify(EYE)}, EYE_OFF=${JSON.stringify(EYE_OFF)};
       for(const btn of document.querySelectorAll('.pv')){
         const inp=btn.previousElementSibling;
         btn.onclick=()=>{ const show=inp.type==='password'; inp.type=show?'text':'password'; btn.innerHTML=show?EYE:EYE_OFF; btn.setAttribute('aria-label',show?'Hide password':'Show password'); btn.setAttribute('aria-pressed',show?'true':'false'); inp.focus(); };
       }
       /* This page is served AT the path the operator was on, so the current pathname IS the view
          to come back to. */
       if(g&&!g.disabled) g.onclick=()=>{location.href='/auth/login/google?return='+encodeURIComponent(location.pathname+location.search);};

       /* ── PASSKEY CEREMONY ────────────────────────────────────────────────────────────────
          WebAuthn speaks ArrayBuffers and this panel's JSON speaks base64. The two conversions
          below are the entire integration, and getting either backwards produces a signature over
          bytes the server never checks — which VERIFIES AS A FAILURE, not as a pass, because the
          server compares the challenge it issued against the one inside clientDataJSON.

          Two different base64 alphabets are in play ON PURPOSE and they are not interchangeable:
            · the CHALLENGE and credential ids are base64URL (-_ , no padding) — that is what
              WebAuthn puts inside clientDataJSON, and what the server compares against;
            · the three response blobs go back as STANDARD base64, because the route decodes them
              with Buffer.from(x,'base64').
          Mixing them fails only for inputs containing + or /, i.e. intermittently and on about a
          quarter of random challenges, which is the worst possible failure schedule.

          The button is hidden unless the browser actually has WebAuthn — a control that cannot
          work is the same lie as a green light on a scan that never ran. */
       const pk=document.getElementById('passkey');
       const hasWebAuthn = !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.get);
       if(pk && hasWebAuthn) pk.hidden=false;
       const b64uToBuf=(s)=>{ const t=String(s).replace(/-/g,'+').replace(/_/g,'/'); const pad=t+'='.repeat((4-t.length%4)%4);
         const bin=atob(pad); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return u.buffer; };
       const bufToB64=(b)=>{ const u=new Uint8Array(b); let s=''; for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]); return btoa(s); };
       if(pk) pk.onclick=async()=>{
         msg.className='msg'; msg.textContent='Waiting for your passkey…'; pk.disabled=true;
         try{
           const b=await post('/auth/passkey/login/begin',{});
           if(!b.ok) throw new Error(b.j.error||'could not start');
           /* No allowCredentials when the list is empty: that is the DISCOVERABLE flow, where the
              authenticator offers whichever account it holds. Sending an empty array instead means
              "no credential is acceptable" and the browser refuses outright. */
           const pub={ challenge:b64uToBuf(b.j.challenge), rpId:b.j.rpId, userVerification:'preferred', timeout:60000 };
           if((b.j.allowCredentials||[]).length) pub.allowCredentials=b.j.allowCredentials.map((id)=>({type:'public-key',id:b64uToBuf(id)}));
           const c=await navigator.credentials.get({publicKey:pub});
           if(!c) throw new Error('no credential was returned');
           const r=await post('/auth/passkey/login/finish',{
             challengeId:b.j.challengeId,
             credentialId:c.id,                                   /* already base64url, as the server stores it */
             clientDataJSON:bufToB64(c.response.clientDataJSON),
             authenticatorData:bufToB64(c.response.authenticatorData),
             signature:bufToB64(c.response.signature),
           });
           if(!r.ok) throw new Error(r.j.error||'that passkey was not accepted');
           msg.className='msg ok'; msg.textContent='Signed in — loading…'; return location.reload();
         }catch(e){
           /* A user who dismisses the system prompt gets NotAllowedError. That is a cancellation,
              not a rejected credential, and saying "not accepted" would tell them their passkey is
              broken when they simply changed their mind. */
           const cancelled = e && (e.name==='NotAllowedError' || e.name==='AbortError');
           msg.className='msg'+(cancelled?'':' err');
           msg.textContent = cancelled ? 'Passkey sign-in cancelled.' : (e.message||'Passkey sign-in failed');
           pk.disabled=false;
         }
       };

       let layer=1, cred=null;
       const show=(n,title,btn)=>{layer=n; el('ht').textContent=title; go.textContent=btn;
         for(const [id,on] of [['l1',n===1],['l2',n===2],['l3',n===3]]){ el(id).hidden=!on; }
         el('ska').hidden=n!==3; msg.className='msg'; msg.textContent='';
         const inp=el(n===1?'l1':n===2?'l2':'l3').querySelector('input'); if(inp) inp.focus(); };
       const csrf=async()=>((await (await fetch('/api/csrf')).json().catch(()=>({}))).token||'');
       const post=async(url,body)=>{ const r=await fetch(url,{method:'POST',
         headers:{'content-type':'application/json','x-cw-csrf':await csrf()},
         body:JSON.stringify(body)}); return { ok:r.ok, j:await r.json().catch(()=>({})) }; };
       /* Offer the credential to the browser's password manager, explicitly.

          A manager offers to save on a real form submission, or by heuristic on an XHR login. This
          page gives it NEITHER: every path calls preventDefault() and finishes with
          location.reload(), and on the two-factor path l1 is hidden before that navigation — so by
          the time anything navigates, the password field a heuristic would key on is already gone.

          The markup was already correct: a real <form>, autocomplete="username" beside
          "current-password", a real submit button. Correct markup is necessary and NOT sufficient,
          and that is the whole difficulty here — nothing was ever wrong to look at, so this reads
          as a browser failing to do its job rather than as a page that never asked.

          The Credential Management API is that request stated outright, and it is what Chrome/Edge
          — and Google Password Manager behind them — honour. Safari and Firefox do not implement
          PasswordCredential and stay on their heuristics, so this is ADDITIVE: it never replaces
          the markup, which remains the only thing those two have to work with.

          Fails open, and guarded to fire once: a store that throws must not break a sign-in that
          has already succeeded, and prompting twice for one credential teaches people to dismiss
          the prompt. */
       let stored=false;
       const remember=async()=>{
         if(stored||!cred||!cred.email||!cred.password)return;
         stored=true;
         try{
           if(window.PasswordCredential&&navigator.credentials&&navigator.credentials.store){
             await navigator.credentials.store(new PasswordCredential(
               {id:cred.email,password:cred.password,name:cred.email}));
           }
         }catch(e){}
       };
       const fail=(t)=>{ msg.className='msg err'; msg.textContent=t; go.disabled=false; };
       const afterLogin=async()=>{
         const me=await (await fetch('/api/me')).json().catch(()=>({}));
         if(me.ok && !me.totpConfirmed){
           const { ok, j }=await post('/api/me/totp/reissue',{});
           if(ok){ el('sk').textContent=j.totpSecret; el('oa').href=j.otpauth; renderQr(j.otpauth); show(3,'Add your authenticator','Confirm code'); go.disabled=false; return; }
         }
         msg.className='msg ok'; msg.textContent='Signed in — loading…'; location.reload(); };
       el('ska').onclick=(e)=>{ e.preventDefault(); location.reload(); };
       const ENROLL = ${enroll ? 'true' : 'false'};
       f.onsubmit=async(e)=>{
         e.preventDefault(); msg.className='msg'; msg.textContent='Checking…'; go.disabled=true;
         const d=Object.fromEntries(new FormData(f));
         try{
           if(layer===1 && ENROLL){
             if(d.password!==d.password2){ go.disabled=false; return fail('Passwords do not match'); }
             cred={email:d.email,password:d.password};
             const { ok, j }=await post('/auth/bootstrap',cred);
             if(!ok) return fail(j.error||'Could not create the account');
             await remember();
             el('sk').textContent=j.totpSecret; el('oa').href=j.otpauth; renderQr(j.otpauth);
             return show(3,'Add your authenticator','Confirm code'), go.disabled=false;
           }
           if(layer===1){
             cred={email:d.email,password:d.password};
             const { ok, j }=await post('/auth/login',cred);
             if(ok){ await remember(); return afterLogin(); }
             if(j.factor==='email'||(j.error||'')==='invalid second factor'||(j.error||'')==='second factor required'){
               /* an emailed code: say whether it went out, never pretend it did */
               if(j.factor==='email'){ const l=el('l2').querySelector('.lede'); if(l) l.textContent=j.sent?'A 6-digit code was emailed to you. Enter it to finish signing in.':(j.sent===false?('The sign-in code could not be sent ('+(j.detail||'mail not configured')+'). Ask the operator.'):'Enter the 6-digit code that was emailed to you.'); }
               return show(2,'Second factor','Verify'), go.disabled=false;
             }
             return fail(j.error||'Sign-in failed');
           }
           if(layer===2){
             const { ok, j }=await post('/auth/login',{...cred,token:d.token});
             if(ok){ await remember(); msg.className='msg ok'; msg.textContent='Signed in — loading…'; return location.reload(); }
             return fail(j.error||'That code did not verify');
           }
           // layer 3: ENROLL confirms via /auth/totp/confirm (email+password, no session yet);
           // the post-login reissue path confirms via /api/me/totp/confirm (session-authenticated,
           // email implicit) — same screen, different endpoint, because only one of the two has
           // an account to attach a session to yet.
           const confirmUrl = ENROLL ? '/auth/totp/confirm' : '/api/me/totp/confirm';
           const confirmBody = ENROLL ? {email:cred.email,password:cred.password,token:d.etoken} : {password:cred.password,token:d.etoken};
           const { ok, j }=await post(confirmUrl,confirmBody);
           if(ok){
             await remember();
             msg.className='msg ok';
             msg.textContent=ENROLL ? 'Account created — sign in below.' : 'Second factor is on — loading…';
             return location.reload();
           }
           return fail(j.error||'Could not confirm — check the code');
         }catch(err){ fail('Could not reach the server'); }
       };
       </script>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>commitwork · sign in</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/svg+xml" href="/cw-favicon.svg">
${THEME_LINKS}
<script>
/* Same responsive-root rule as the panel (admin/index.html): 1080p-class = 16px root, scaling up
   on large displays, keyed to TRUE device pixels (screen.height*dpr) so OS HiDPI scaling cannot
   hide it. Every size below is rem, so the whole card scales consistently — no per-element
   overrides. The CSS clamp in the stylesheet is the no-JS fallback; this overrides it.

   WIDTH-GATED at 900 CSS px, because device pixels alone mis-read a phone: an iPhone 15 Pro
   reports screen.height 852 at dpr 3 = 2556 device px, which is 4K-class by this rule and would
   pin the root font up on a 393px-wide viewport — the 24rem card becomes enormous and the page
   renders at 200% on the smallest screen. A high-density phone is not a big display, so below
   900px the root stays at the 16px base and the phone rules in the stylesheet take over.

   Above 900px it also takes the MIN of the height and width ratios, and caps at 24px rather than
   32px. The screen-only form gave a merely NARROW WINDOW on a 4K panel the full 200%, which on
   the panel proper overflowed the tab strip and cut the right-hand columns off every table. */
(function(){function px(){var w=window.innerWidth||1600;var dpr=window.devicePixelRatio||1;var h=(window.screen&&screen.height?screen.height:1080)*dpr;var s=w<900?16:Math.max(16,Math.min(24,16*Math.min(h/1080,w/1600)));document.documentElement.style.fontSize=s+'px';}px();addEventListener('resize',px);})();
</script>
<style>
 /* The tokens, fonts and light values come from the panel's own sheets, linked above and served
    unauthenticated for this page (PUBLIC_ASSETS in admin/serve.mjs). These rules are its layout. */
 body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem 1.25rem;
   background:var(--bg);color:var(--ink);font-family:var(--mono);font-size:.875rem;line-height:1.6;
   background-image:radial-gradient(120% 55% at 50% -10%,color-mix(in srgb,var(--acc) 9%,transparent),transparent 60%)}
 main{width:100%;max-width:24rem}
 .brand{display:flex;align-items:center;gap:.625rem;margin-bottom:1.25rem}
 /* The mark, set as commitwork-doc.css sets it for the published documents. The seal is a fixed
    square: it is 1:1, so there is no aspect ratio to preserve by leaving an axis auto. */
 .brand .mark{display:flex;align-items:center;gap:.31rem}
 .brand .mark .seal{flex:none;display:block;width:1.75rem;height:1.75rem}
 .brand .mark svg{width:100%;height:100%;display:block;border-radius:50%}
 .brand .mark .wordmark{font-family:var(--sans);font-size:.78rem;font-weight:700;letter-spacing:.16em;
   text-transform:uppercase;color:var(--ink)}
 .card{background:var(--panel);border:1px solid var(--line);border-radius:.75rem;padding:1.5rem}
 h1{font-family:var(--sans);font-size:1.1875rem;font-weight:650;letter-spacing:-.015em;margin:0 0 .5rem}
 .lede{color:var(--mut);font-size:.8125rem;margin:0 0 1.125rem}
 label{display:block;margin:.875rem 0;font-size:.75rem;color:var(--mut)}
 /* Square, system-ui, tracked: operator's rule of 2026-09-02. No border-radius on inputs — the
    radius is the button's, so the field and the action stop looking like the same control. */
 input{width:100%;margin-top:.3125rem;padding:.5625rem .6875rem;background:var(--bg);color:var(--ink);
   border:1px solid var(--line2);border-radius:0;font-family:system-ui;font-size:.8125rem;letter-spacing:.05em}
 input:focus{outline:2px solid var(--acc);outline-offset:1px;border-color:transparent}
 input::placeholder{color:var(--dim)}
 .hint{display:block;margin-top:.375rem;font-size:.6875rem;color:var(--dim);line-height:1.5}
 code{color:var(--acc);font-size:.9em}
 a{color:var(--ink)}
 a:hover{color:var(--acc)}
 /* The QR frame (background/padding/radius) lives on the WRAPPER, never on the svg itself — a
    border-radius on the svg clips its own rendered corners, and a QR's corners are its finder
    patterns: rounding them is not a cosmetic trim, it is scanner-breaking data loss. The svg's own
    quiet-zone margin already keeps modules off the wrapper's edge, so the wrapper needs no padding
    of its own either — padding on both would double the margin. */
 .qr{display:flex;justify-content:center;margin:0 0 1rem;background:#fff;border-radius:.375rem;border:1px solid var(--line2);padding:.5rem}
 .qr svg{width:13rem;height:13rem;display:block}
 .pwrap{position:relative}
 .pwrap input{padding-right:2.5rem}
 /* fact: top:.3125rem was a guessed offset that only centred at one font size / the root font
    scales with the viewport on this page, so the control drifted off the input's midline at
    every other size — centring on the axis itself is size-independent (expiry: never, prev: drifted) */
 /* fact: .pwrap wraps the input INCLUDING its .3125rem top margin, so the wrapper midline sits
    half that margin above the input's own / centring on the parent is only centring on the
    child when they share a box, and here they do not (expiry: if input margin-top changes,
    prev: drifted) */
 .pwrap .pv{position:absolute;top:calc(50% + .15625rem);transform:translateY(-50%);right:.4375rem;width:auto;height:auto;
   display:inline-flex;align-items:center;justify-content:center;background:none;border:0;
   color:var(--mut);padding:.25rem;border-radius:.25rem;transition:color .14s}
 .pwrap .pv svg{display:block}
 .pwrap .pv:hover{color:var(--acc)}
 .pwrap .pv:focus-visible{outline:2px solid var(--acc);outline-offset:1px;color:var(--ink)}
 button{width:100%;padding:.5625rem;border-radius:0;font:inherit;font-size:.8125rem;cursor:pointer;transition:.14s}
 /* Secondary action, reversed: the heading ink is its ground and the page ground its ink and edge.
    The tokens swap between themes, so it reads near-white on dark and near-black on light with no
    rule per theme: --bg on --head is 16.00:1 dark and 17.13:1 light. */
 button.secondary{background:var(--head);color:var(--bg);border:1px solid var(--bg);margin-top:.5rem}
 button.secondary:hover{background:var(--ink)}
 /* Primary shares the SSO buttons' body; the gold rule at its foot is the only thing that ranks
    it. Type is the wordmark's voice: system-ui, uppercase, .16em tracking. */
 #go,.pri{position:relative;margin-top:1rem;background:linear-gradient(180deg,var(--panel2),var(--panel));color:var(--ink);
   border:1px solid var(--line2);border-bottom:2px solid var(--acc);padding:.6875rem;
   font-family:system-ui;font-weight:600;font-size:.75rem;letter-spacing:.16em;text-transform:uppercase}
 /* Enter keycap as a pseudo-element: the layer script rewrites the label with textContent, which
    would drop a child node. Enter already submits; this only says so. */
 #go::after,.pri::after{content:"↵";position:absolute;right:.5rem;top:50%;transform:translateY(-50%);
   font-size:.625rem;letter-spacing:.06em;line-height:1;padding:.2rem .35rem;color:var(--mut);
   border:1px solid var(--line2);border-bottom-width:2px;background:var(--panel2);transition:.14s}
 #go:hover:not(:disabled),.pri:hover:not(:disabled){border-color:var(--acc);color:var(--acc)}
 #go:hover:not(:disabled)::after,.pri:hover:not(:disabled)::after{color:var(--acc);border-color:var(--acc)}
 #go:disabled,.pri:disabled{opacity:.6;cursor:default}
 .sso{display:flex;align-items:center;justify-content:center;gap:.5rem;background:var(--panel);
   color:var(--ink);border:1px solid var(--line2);font-family:system-ui;letter-spacing:.05em}
 .sso:hover:not(:disabled){border-color:var(--acc)} .sso:disabled{opacity:.45;cursor:not-allowed}
 /* fix: .sso's display:flex is an author rule, so it beat the UA [hidden] and the passkey button
    rendered even without WebAuthn — restore it, or the gap below lands under nothing. */
 .sso[hidden]{display:none}
 .sso:not([hidden])+.sso{margin-top:10px}
 .or{display:flex;align-items:center;gap:.75rem;margin:1.125rem 0 .25rem;color:var(--dim);font-size:.6875rem}
 .or::before,.or::after{content:"";flex:1;height:1px;background:var(--line)}
 .msg{min-height:1.3em;margin:.75rem 0 0;font-size:.75rem}
 .msg.err{color:var(--crit)} .msg.ok{color:var(--live)}
 .foot{margin-top:1rem;color:var(--dim);font-size:.6875rem;text-align:center}
 .theme-switch{position:fixed;top:.75rem;right:.75rem}
 button:focus-visible,input:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
 /* ── phones ───────────────────────────────────────────────────────────────────────────────────
    Two things break a login card on a handset, and neither is layout width. First, iOS zooms the
    viewport when a focused input's font is under 16px — at .8125rem (13px) the page lurches
    sideways mid-password and never fully returns, which reads as a broken site. So inputs go to a
    literal 16px here, not a rem, because the whole point is to clear the browser's threshold.
    Second, taps need a target: 44px is the platform minimum, and .5625rem of padding is 27px.
    The card also loses its vertical centring — with a keyboard open, centred content is pushed
    off-screen, so it anchors to the top instead. */
 @media (max-width:520px){
   body{padding:1.25rem .875rem;align-items:flex-start}
   main{max-width:none}
   .card{padding:1.125rem 1rem;border-radius:.625rem}
   h1{font-size:1.125rem}
   .lede{font-size:.8125rem}
   .brand{margin-bottom:1rem}
   input{font-size:16px;padding:.6875rem .75rem;min-height:2.75rem}
   button{min-height:2.75rem;font-size:.9375rem}
   .hint{font-size:.75rem}
 }
</style>
<style data-light media="(prefers-color-scheme: light)">
 /* Pure black field text is the operator's rule; it lives HERE and not in the base rule because
    #000 on the dark theme's #17181a field would be invisible. Dark keeps var(--ink). */
 input{color:#000000}
 /* On light the panel gradient is white on white, so the primary is reversed: a --head ground,
    lifted 12% toward the page at the top, with --bg as its ink, 12.7:1 at the lightest point. The
    keycap is a step lighter, and its glyph measures 4.9:1 on it. */
 #go,.pri{background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 12%,var(--head)),color-mix(in srgb,var(--bg) 4%,var(--head)));
   color:var(--bg);border-color:var(--head);border-bottom-color:var(--acc)}
 #go::after,.pri::after{color:color-mix(in srgb,var(--bg) 60%,var(--head));border-color:color-mix(in srgb,var(--bg) 20%,var(--head));
   background:color-mix(in srgb,var(--bg) 12%,var(--head))}
</style>
${THEME_SCRIPT}</head>
<body><main>
  <div class="brand">${LOGO}</div>
  <div class="card">${body}</div>
</main>${THEME_SWITCH}</body></html>`;
}
