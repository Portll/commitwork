// lib/theme-follower.mjs — the panel's light/dark choice, followed by every page it embeds.
//
// The panel keeps the choice in localStorage['cw-theme']: 'light' or 'dark', absent = auto, which
// resolves through (prefers-color-scheme: light) exactly as admin/panel.html's CW_THEME_MEDIA does.
// Embedded pages share the panel's origin, so their windows receive the `storage` event when the
// reader changes the choice, and follow it without a reload.
//
// FOLLOWER_JS sets <html data-mode="light|dark"> before first paint and dispatches `cw-mode` on
// window whenever the mode changes; pages key their palettes on html[data-mode]. ?mode=light|dark
// pins a page, for a screenshot or a link. It never writes the key on load: a page that did would
// turn the reader's auto into a fixed choice they never made.
//
// Generated pages inline it through followerScript(). A static page carries a pasted copy, and a
// drift test holds that copy byte-equal to this one.

export const THEME_KEY = 'cw-theme';
export const LIGHT_QUERY = '(prefers-color-scheme: light)';

export const FOLLOWER_JS = `(function(){
var K='${THEME_KEY}',d=document.documentElement,q=null,own=null;
try{q=matchMedia('${LIGHT_QUERY}');}catch(e){}
function pick(v){return v==='light'||v==='dark'?v:null;}
function pinned(){try{return pick(new URLSearchParams(location.search).get('mode'));}catch(e){return null;}}
function stored(){try{return pick(localStorage.getItem(K));}catch(e){return null;}}
function apply(){
  var m=pinned()||own||stored()||(q&&q.matches?'light':'dark');
  if(d.getAttribute('data-mode')===m)return;
  d.setAttribute('data-mode',m);d.style.colorScheme=m;
  try{dispatchEvent(new CustomEvent('cw-mode',{detail:m}));}catch(e){}
}
apply();
addEventListener('storage',function(e){if(e.key===K||e.key===null)apply();});
if(q){if(q.addEventListener)q.addEventListener('change',apply);else if(q.addListener)q.addListener(apply);}
window.cwMode={get:function(){return d.getAttribute('data-mode');},
  set:function(t){if(!pick(t))return;own=t;try{localStorage.setItem(K,t);}catch(e){}apply();}};
})();`;

// A standalone page's own toggle (#theme). Embedded pages hide it: there the panel's menu owns the
// choice, and a second control would write the same key from inside the frame.
export const TOGGLE_JS = `(function(){
var b=document.getElementById('theme');if(!b||!window.cwMode)return;
function glyph(){var dark=cwMode.get()==='dark';b.textContent=dark?'\\u2600':'\\u263e';b.title=dark?'light mode':'dark mode';}
b.onclick=function(){cwMode.set(cwMode.get()==='dark'?'light':'dark');};
addEventListener('cw-mode',glyph);glyph();
})();`;

export const followerScript = () => `<script>${FOLLOWER_JS}</script>`;
export const toggleScript = () => `<script>${TOGGLE_JS}</script>`;
