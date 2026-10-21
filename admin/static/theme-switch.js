/* The Appearance choice for every admin page outside the panel shell (docs/THEME.md §2.1).
   Load it synchronously in <head>, after the theme links and any <style data-light>, so the stored
   choice applies before first paint. It switches the media attribute of the light sheets and of
   every data-light element, as the panel's head script does, and sets html[data-mode] for pages
   keyed on that instead. A [data-theme-switch] element becomes the AUTO / LIGHT / DARK control. An
   embedded page hides it, because there the panel's account menu owns the choice and a second
   control would write the same key from inside the frame. */
(function(){
  var MEDIA={auto:'(prefers-color-scheme: light)',light:'all',dark:'not all'};
  var CVD=['protanopia','deuteranopia','tritanopia','achromatopsia'];
  var TITLES={
    auto:"follow this machine's light/dark setting, and keep following it when it changes",
    light:"always light, regardless of this machine's setting",
    dark:"always dark, regardless of this machine's setting"};
  var root=document.documentElement,q=null;
  try{q=matchMedia(MEDIA.auto);}catch(e){}
  function read(k){try{return localStorage.getItem(k);}catch(e){return null;}}
  function pick(v){return v==='light'||v==='dark'?v:null;}
  function pinned(){try{return pick(new URLSearchParams(location.search).get('mode'));}catch(e){return null;}}
  function choice(){return pinned()||pick(read('cw-theme'))||'auto';}
  function sync(c){
    var bs=document.querySelectorAll('[data-theme-switch] [data-theme-set]');
    for(var i=0;i<bs.length;i++)bs[i].setAttribute('aria-checked',String(bs[i].getAttribute('data-theme-set')===c));
  }
  function apply(){
    var c=choice(),m=c==='auto'?(q&&q.matches?'light':'dark'):c;
    var ls=document.querySelectorAll('#theme-light,#cvd-light,[data-light]');
    for(var i=0;i<ls.length;i++)ls[i].media=MEDIA[c];
    var v=read('cw-cvd');
    if(CVD.indexOf(v)>=0)root.setAttribute('data-cvd',v);else root.removeAttribute('data-cvd');
    root.setAttribute('data-mode',m);root.style.colorScheme=m;
    sync(c);
  }
  function set(c){
    try{if(c==='auto')localStorage.removeItem('cw-theme');else localStorage.setItem('cw-theme',c);}catch(e){}
    apply();
  }
  function mount(){
    var embedded;
    try{embedded=window.top!==window.self;}catch(e){embedded=true;}
    var hosts=document.querySelectorAll('[data-theme-switch]');
    for(var i=0;i<hosts.length;i++){
      var h=hosts[i];
      if(embedded){h.hidden=true;continue;}
      if(h.querySelector('[data-theme-set]'))continue;
      h.classList.add('theme-switch');
      h.setAttribute('role','radiogroup');
      h.setAttribute('aria-label','Appearance');
      ['auto','light','dark'].forEach(function(c){
        var b=document.createElement('button');
        b.type='button';b.className='theme-opt';b.setAttribute('role','radio');
        b.setAttribute('data-theme-set',c);b.title=TITLES[c];b.textContent=c.toUpperCase();
        b.onclick=function(){set(c);};
        h.appendChild(b);
      });
    }
    apply();
  }
  apply();
  addEventListener('storage',function(e){if(e.key==='cw-theme'||e.key==='cw-cvd'||e.key===null)apply();});
  if(q){if(q.addEventListener)q.addEventListener('change',apply);else if(q.addListener)q.addListener(apply);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
