document.querySelectorAll('#menupop .menu-view').forEach(b=>b.onclick=()=>{
  navigateWorkspace(b.dataset.v);
  const pop=$('menupop'), btn=$('menubtn');
  if(pop)pop.hidden=true;
  if(btn)btn.setAttribute('aria-expanded','false');
});

// ≡ menu popout. Closes on outside click and on Escape, and returns focus to the button — a menu
// that can only be dismissed by picking something from it traps the keyboard.
(function(){
  const btn=$('menubtn'), pop=$('menupop'); if(!btn||!pop) return;
  const setOpen=(open)=>{ pop.hidden=!open; btn.setAttribute('aria-expanded', String(open)); };
  btn.onclick=(e)=>{ e.stopPropagation(); setOpen(pop.hidden); if(!pop.hidden)loadPanelHealth(); };
  document.addEventListener('click',(e)=>{ if(!pop.hidden && !pop.contains(e.target) && e.target!==btn) setOpen(false); });
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && !pop.hidden){ setOpen(false); btn.focus(); } });
})();
