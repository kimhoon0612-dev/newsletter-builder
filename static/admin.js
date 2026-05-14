/* ── State ─────────────────────────────────────────────────────── */
let curNL=null, secs=[], genFile=null, dragIdx=null, allNLs=[], curFilter='all',
    deleteTargetId=null, autoSaveTimer=null, undoStack=[];

/* ── XSS 방지 ─────────────────────────────────────────────────── */
function esc(s){
  if(!s) return '';
  const d=document.createElement('div'); d.textContent=s; return d.innerHTML;
}

/* ── Auth ──────────────────────────────────────────────────────── */
function getKey(){ return localStorage.getItem('nl_api_key')||''; }
function setKey(k){ localStorage.setItem('nl_api_key',k); }

function doLogin(){
  const k=document.getElementById('auth-key-inp').value.trim();
  if(!k){document.getElementById('auth-err').textContent='키를 입력해주세요';return;}
  // 테스트 호출로 키 유효성 확인
  fetch('/api/newsletters',{headers:{'X-API-Key':k}})
    .then(r=>{
      if(r.status===401){document.getElementById('auth-err').textContent='잘못된 API Key입니다';return;}
      setKey(k); showApp();
    }).catch(()=>{document.getElementById('auth-err').textContent='서버 연결 오류';});
}
function doLogout(){ localStorage.removeItem('nl_api_key'); location.reload(); }
function showApp(){
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('sidebar').style.display='';
  document.getElementById('main').style.display='';
  showView('list'); loadAll();
}

/* ── API ──────────────────────────────────────────────────────── */
async function api(m,p,b){
  const o={method:m,headers:{'Content-Type':'application/json','X-API-Key':getKey()}};
  if(b)o.body=JSON.stringify(b);
  try{
    const r=await fetch('/api'+p,o);
    if(r.status===401){toast('인증 만료. 다시 로그인해주세요','err');doLogout();return{error:'auth'};}
    const data=await r.json();
    if(!r.ok&&data.error){toast(data.error,'err');}
    return data;
  }catch(e){toast('서버 연결 오류: '+e.message,'err');return{error:e.message};}
}
async function upload(file){
  const fd=new FormData();fd.append('file',file);
  try{
    const r=await fetch('/api/upload-image',{method:'POST',body:fd,headers:{'X-API-Key':getKey()}});
    if(r.status===401){doLogout();return{error:'auth'};}
    const data=await r.json();
    if(!r.ok&&data.error)toast(data.error,'err');
    return data;
  }catch(e){toast('업로드 오류: '+e.message,'err');return{error:e.message};}
}

/* ── Toast ─────────────────────────────────────────────────────── */
function toast(msg,type=''){
  const t=document.getElementById('toast');
  t.textContent=msg;t.className='toast show '+(type||'');
  setTimeout(()=>t.className='toast',2600);
}

/* ── Views ─────────────────────────────────────────────────────── */
function showView(name){
  ['list','editor','new'].forEach(v=>{
    const el=document.getElementById('view-'+v);
    el.style.display=v===name?'flex':'none';
    if(v===name&&(v==='editor'||v==='new'))el.style.flexDirection='column';
  });
  document.querySelectorAll('.nav-item[data-view]').forEach(n=>{
    n.classList.toggle('active',n.dataset.view===name);
  });
}

/* ── Sidebar NL list ──────────────────────────────────────────── */
async function loadAll(){
  allNLs=await api('GET','/newsletters');
  if(allNLs.error)return;
  renderSidebar();renderGrid();
}
function renderSidebar(){
  const el=document.getElementById('sb-nl-list');
  if(!allNLs||!allNLs.length){el.innerHTML='<div style="padding:10px 12px;font-size:12px;color:#475569">저장된 뉴스레터 없음</div>';return;}
  el.innerHTML=allNLs.map(n=>`
    <button class="sb-nl-item${curNL&&curNL.id===n.id?' active':''}" onclick="openEditor('${esc(n.id)}')">
      ${n.thumbnail?`<img class="sb-nl-thumb" src="${esc(n.thumbnail)}" onerror="this.style.background='#1E2A45'">`
        :'<div class="sb-nl-thumb" style="display:flex;align-items:center;justify-content:center;font-size:14px">📄</div>'}
      <div class="sb-nl-info">
        <div class="sb-nl-title">${esc(n.title)}</div>
        <div class="sb-nl-date">${new Date(n.updated_at).toLocaleDateString('ko-KR')} · 섹션${n.section_count}</div>
      </div>
    </button>`).join('');
}

/* ── List View ────────────────────────────────────────────────── */
function setFilter(f,btn){
  curFilter=f;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');renderGrid();
}
function renderGrid(){
  const q=(document.getElementById('search-inp')||{value:''}).value.toLowerCase();
  const list=(allNLs||[]).filter(n=>n.title.toLowerCase().includes(q)&&(curFilter==='all'||n.status===curFilter));
  const el=document.getElementById('nl-grid');
  if(!list.length){el.innerHTML=`<div class="empty-state"><div class="ico">📭</div><p>뉴스레터가 없습니다</p></div>`;return;}
  el.innerHTML=list.map(n=>`
    <div class="card">
      <div class="card-img" onclick="openEditor('${esc(n.id)}')" style="cursor:pointer">
        ${n.thumbnail?`<img src="${esc(n.thumbnail)}" onerror="this.parentNode.innerHTML='<div class=\\'no-img\\'>📄</div>'">`:'<div class="no-img">📄</div>'}
        <span class="card-badge"><span class="badge ${n.status==='sent'?'badge-sent':'badge-draft'}">${n.status==='sent'?'발송완료':'초안'}</span></span>
      </div>
      <div class="card-body">
        <div class="card-title" title="${esc(n.title)}" onclick="openEditor('${esc(n.id)}')" style="cursor:pointer">${esc(n.title)}</div>
        <div class="card-meta">섹션 ${n.section_count}개 · ${new Date(n.updated_at).toLocaleDateString('ko-KR')}</div>
        <div class="card-actions" onclick="event.stopPropagation()">
          <button class="btn btn-blue btn-sm" onclick="openEditor('${esc(n.id)}')">✏️ 편집</button>
          <button class="btn btn-ghost btn-sm" onclick="dupNL('${esc(n.id)}')">📋 복제</button>
          <button class="btn btn-ghost btn-sm" onclick="exportById('${esc(n.id)}')">📤</button>
          <button class="btn btn-red btn-sm" onclick="delNL('${esc(n.id)}')">🗑️</button>
        </div>
      </div>
    </div>`).join('');
}
function delNL(id){ deleteTargetId=id; document.getElementById('del-modal').classList.add('show'); }
async function confirmDelete(){
  if(!deleteTargetId)return;
  document.getElementById('del-modal').classList.remove('show');
  const result=await api('DELETE','/newsletters/'+deleteTargetId);
  if(result.ok){toast('삭제되었습니다','ok');deleteTargetId=null;await loadAll();}
  else{toast('삭제 실패: '+(result.error||'오류'),'err');}
}
function cancelDelete(){ deleteTargetId=null; document.getElementById('del-modal').classList.remove('show'); }
async function dupNL(id){
  toast('복제 중...');
  const nl=await api('POST','/newsletters/'+id+'/duplicate');
  if(nl.error)return;
  toast('복제 완료!','ok'); await loadAll(); setTimeout(()=>openEditor(nl.id),500);
}
function exportById(id){window.location.href='/api/newsletters/'+id+'/export?api_key='+encodeURIComponent(getKey());toast('HTML 다운로드 중...','ok');}

/* ── New View ─────────────────────────────────────────────────── */
function showNew(){
  document.getElementById('blank-form').style.display='none';
  document.getElementById('existing-picker').style.display='none';
  document.getElementById('template-picker').style.display='none';
  showView('new');
}
function showBlankForm(){
  document.getElementById('blank-form').style.display='block';
  document.getElementById('existing-picker').style.display='none';
  document.getElementById('template-picker').style.display='none';
  document.getElementById('new-title').value='';
  document.getElementById('new-title').focus();
}
function hideBlankForm(){ document.getElementById('blank-form').style.display='none'; }
function showExistingPicker(){
  document.getElementById('existing-picker').style.display='block';
  document.getElementById('blank-form').style.display='none';
  document.getElementById('template-picker').style.display='none';
  const list=document.getElementById('picker-list');
  if(!allNLs||!allNLs.length){list.innerHTML='<div style="padding:16px;text-align:center;color:#64748B;font-size:13px">저장된 뉴스레터가 없습니다</div>';return;}
  list.innerHTML=allNLs.map(n=>`
    <div class="picker-item" onclick="useExisting('${esc(n.id)}')">
      ${n.thumbnail?`<img src="${esc(n.thumbnail)}" style="width:52px;height:38px;border-radius:5px;object-fit:cover;flex-shrink:0">`
        :'<div style="width:52px;height:38px;border-radius:5px;background:#1E2A45;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">📄</div>'}
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:#E2E8F0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(n.title)}</div>
        <div style="font-size:11px;color:#64748B;margin-top:2px">섹션 ${n.section_count}개 · ${new Date(n.updated_at).toLocaleDateString('ko-KR')}</div>
      </div>
      <span style="font-size:11px;color:#8B5CF6;flex-shrink:0">복제하여 사용 →</span>
    </div>`).join('');
}
function hideExistingPicker(){ document.getElementById('existing-picker').style.display='none'; }
async function useExisting(id){
  toast('복제 중...');
  const nl=await api('POST','/newsletters/'+id+'/duplicate');
  if(nl.error)return;
  toast('복제 완료!','ok'); await loadAll(); setTimeout(()=>openEditor(nl.id),400);
}
async function createNL(){
  const t=document.getElementById('new-title').value.trim();
  if(!t){toast('제목을 입력해주세요','err');return;}
  const nl=await api('POST','/newsletters',{title:t});
  if(nl.error)return;
  await loadAll();openEditor(nl.id);
}

/* ── 템플릿 ───────────────────────────────────────────────────── */
async function showTemplatePicker(){
  document.getElementById('template-picker').style.display='block';
  document.getElementById('blank-form').style.display='none';
  document.getElementById('existing-picker').style.display='none';
  const tpls=await api('GET','/templates');
  const list=document.getElementById('tpl-list');
  if(!tpls||!tpls.length||tpls.error){list.innerHTML='<div style="padding:16px;text-align:center;color:#64748B;font-size:13px">사용 가능한 템플릿이 없습니다</div>';return;}
  list.innerHTML=tpls.map(t=>`
    <div class="picker-item tpl-highlight" onclick="useTemplate('${esc(t.id)}')">
      ${t.thumbnail?`<img src="${esc(t.thumbnail)}" style="width:52px;height:38px;border-radius:5px;object-fit:cover;flex-shrink:0">`
        :'<div style="width:52px;height:38px;border-radius:5px;background:#1E2A45;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">📌</div>'}
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:#E2E8F0">${esc(t.name)}</div>
        <div style="font-size:11px;color:#64748B;margin-top:2px">${esc(t.description)} · 섹션 ${t.section_count}개</div>
      </div>
      <span style="font-size:11px;color:#10B981;flex-shrink:0">사용하기 →</span>
    </div>`).join('');
}
function hideTemplatePicker(){ document.getElementById('template-picker').style.display='none'; }
async function useTemplate(tid){
  toast('📌 템플릿에서 뉴스레터를 생성 중...');
  const nl=await api('POST','/templates/'+tid+'/create');
  if(nl.error)return;
  toast('✅ 템플릿 뉴스레터가 생성되었습니다!','ok');
  await loadAll(); setTimeout(()=>openEditor(nl.id),400);
}

/* ── Editor ────────────────────────────────────────────────────── */
async function openEditor(id){
  const nl=await api('GET','/newsletters/'+id);
  if(nl.error)return;
  curNL=nl; secs=[...(nl.sections||[])]; undoStack=[];
  document.getElementById('ed-title').value=nl.title;
  setSaved(true);renderSecs();renderPrev();
  renderSidebar();showView('editor');
}
function setSaved(ok){
  const el=document.getElementById('save-status');
  el.textContent=ok?'✓ 저장됨':'● 저장 안됨';
  el.className='save-status'+(ok?' saved':'');
}
function pushUndo(){ undoStack.push({secs:JSON.parse(JSON.stringify(secs)),title:document.getElementById('ed-title').value}); if(undoStack.length>20)undoStack.shift(); }
function undoLast(){
  if(!undoStack.length){toast('되돌릴 변경사항이 없습니다');return;}
  const state=undoStack.pop();
  secs=state.secs; document.getElementById('ed-title').value=state.title;
  renderSecs();renderPrev();setSaved(false);scheduleAutoSave();toast('↩️ 실행 취소됨','ok');
}
function onEditorChange(){ pushUndo(); setSaved(false); scheduleAutoSave(); }

/* ── Auto Save ────────────────────────────────────────────────── */
function scheduleAutoSave(){
  if(autoSaveTimer)clearTimeout(autoSaveTimer);
  autoSaveTimer=setTimeout(async()=>{
    if(!curNL)return;
    await saveNL(true);
  },3000);
}

function renderSecs(){
  const el=document.getElementById('sec-list');
  if(!secs.length){el.innerHTML='<div style="padding:20px;text-align:center;font-size:12px;color:#64748B">섹션이 없습니다<br>아래 버튼으로 추가하세요</div>';return;}
  el.innerHTML=secs.map((s,i)=>`
    <div class="sec-item" draggable="true" data-i="${i}"
      ondragstart="dStart(event,${i})" ondragover="dOver(event)" ondrop="dDrop(event,${i})">
      <div class="sec-hdr">
        <span class="drag-h">⠿</span>
        <img class="sec-thumb" src="${esc(s.image_url)}" onerror="this.style.background='#1E2A45'">
        <div class="sec-info">
          <div class="sec-num">섹션 ${i+1}</div>
          <div class="sec-url">${esc(s.click_url)||'링크 없음'}</div>
        </div>
        <button class="btn btn-red btn-sm" onclick="removeSec(${i})">✕</button>
      </div>
      <div class="sec-detail">
        <span class="lbl">클릭 URL (선택사항)</span>
        <input class="inp" style="font-size:12px" placeholder="https://example.com" value="${esc(s.click_url)}"
          oninput="pushUndo();secs[${i}].click_url=this.value;renderPrev();setSaved(false);scheduleAutoSave()">
        <span class="lbl">이미지 설명 (alt text)</span>
        <input class="inp" style="font-size:12px" placeholder="이미지 내용 설명" value="${esc(s.alt_text)}"
          oninput="pushUndo();secs[${i}].alt_text=this.value;setSaved(false);scheduleAutoSave()">
        <div style="margin-top:9px;display:flex;gap:6px">
          <label class="btn btn-ghost btn-sm" style="cursor:pointer">
            🔄 이미지 교체<input type="file" accept="image/*" style="display:none" onchange="replaceImg(event,${i})">
          </label>
        </div>
      </div>
    </div>`).join('');
}
function renderPrev(){
  const el=document.getElementById('preview-frame');
  if(!secs.length){el.innerHTML='<div style="padding:40px;text-align:center;color:#9CA3AF;font-size:13px">섹션을 추가하면 여기에 미리보기가 표시됩니다</div>';return;}
  el.innerHTML=secs.map(s=>{
    const img=`<img src="${esc(s.image_url)}" style="display:block;width:100%;border:0" alt="${esc(s.alt_text)}">`;
    return s.click_url?`<a href="${esc(s.click_url)}" target="_blank" style="display:block">${img}</a>`:img;
  }).join('')+'<div style="padding:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#9CA3AF">본 메일은 수신동의를 하신 회원님께 발송되었습니다.</div>';
}
function removeSec(i){pushUndo();secs.splice(i,1);renderSecs();renderPrev();setSaved(false);scheduleAutoSave();}
async function replaceImg(e,i){
  const f=e.target.files[0];if(!f)return;
  toast('교체 중...');e.target.value=''; pushUndo();
  const d=await upload(f);
  if(d.error)return;
  secs[i].image_url=d.image_url;renderSecs();renderPrev();setSaved(false);scheduleAutoSave();toast('이미지 교체됨','ok');
}
async function saveNL(isAuto){
  if(!curNL)return;
  const title=document.getElementById('ed-title').value;
  const r=await api('PUT','/newsletters/'+curNL.id,{title,sections:secs,status:curNL.status||'draft'});
  if(r.error)return;
  setSaved(true);
  if(isAuto)toast('✓ 자동 저장됨','ok');
  else{toast('저장되었습니다 ✅','ok');await loadAll();}
}
async function exportNL(){
  await saveNL();
  window.location.href='/api/newsletters/'+curNL.id+'/export?api_key='+encodeURIComponent(getKey());
  toast('HTML 다운로드 중...','ok');
}
function previewNL(){
  if(!curNL)return;
  saveNL().then(()=>window.open('/api/newsletters/'+curNL.id+'/preview','_blank'));
}
async function markSent(){
  if(!curNL)return;
  await api('PUT','/newsletters/'+curNL.id+'/status',{status:'sent'});
  curNL.status='sent';toast('발송완료로 표시됨 ✉️','ok');await loadAll();
}

/* ── Upload / AI ──────────────────────────────────────────────── */
async function doUpload(e){
  const f=e.target.files[0];if(!f)return;
  toast('업로드 중...');e.target.value='';pushUndo();
  const d=await upload(f);
  if(d.error)return;
  secs.push({image_url:d.image_url||d.url,click_url:'',alt_text:''});
  renderSecs();renderPrev();setSaved(false);scheduleAutoSave();toast('이미지 추가됨 ✅','ok');
}
function showAI(){document.getElementById('ai-modal').classList.add('show');}
function closeAI(){document.getElementById('ai-modal').classList.remove('show');}
async function doGenerate(){
  const prompt=document.getElementById('ai-prompt').value.trim();
  if(!prompt){toast('프롬프트 입력 필요','err');return;}
  const btn=document.getElementById('ai-btn');
  btn.innerHTML='<span class="spin-ico"></span>생성 중...';btn.disabled=true;
  document.getElementById('ai-msg').textContent='약 10~20초 소요됩니다...';
  document.getElementById('ai-use-btn').style.display='none';
  try{
    const r=await fetch('/api/generate-image',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':getKey()},body:JSON.stringify({prompt})});
    const d=await r.json();
    if(d.error){toast(d.error,'err');document.getElementById('ai-msg').textContent='오류: '+d.error;return;}
    genFile=d.image_url;
    document.getElementById('ai-preview').innerHTML=`<img src="${esc(d.url)}" style="max-width:100%;max-height:200px">`;
    document.getElementById('ai-use-btn').style.display='';
    document.getElementById('ai-msg').textContent='✅ 완료! 이미지를 사용하려면 아래 버튼을 누르세요.';
  }catch(e){toast('오류 발생','err');}
  finally{btn.innerHTML='✨ 생성하기';btn.disabled=false;}
}
function useAI(){
  if(!genFile)return;pushUndo();
  secs.push({image_url:genFile,click_url:'',alt_text:''});
  renderSecs();renderPrev();setSaved(false);scheduleAutoSave();closeAI();toast('AI 이미지 추가됨 ✅','ok');
}

/* ── Drag & Drop ──────────────────────────────────────────────── */
function dStart(e,i){dragIdx=i;}
function dOver(e){e.preventDefault();}
function dDrop(e,i){
  e.preventDefault();if(dragIdx===null||dragIdx===i)return;pushUndo();
  const tmp=secs[dragIdx];secs[dragIdx]=secs[i];secs[i]=tmp;
  renderSecs();renderPrev();setSaved(false);scheduleAutoSave();dragIdx=null;
}

/* ── EML Import ───────────────────────────────────────────────── */
async function importEML(e){
  const f=e.target.files[0];if(!f)return;
  e.target.value='';
  toast('📧 EML 파일 분석 중... (이미지 다운로드에 시간이 걸릴 수 있습니다)');
  const fd=new FormData();fd.append('file',f);
  try{
    const r=await fetch('/api/parse-eml',{method:'POST',body:fd,headers:{'X-API-Key':getKey()}});
    const d=await r.json();
    if(d.error){toast('EML 파싱 실패: '+d.error,'err');return;}
    toast(`✅ "${esc(d.title)}" 뉴스레터가 생성되었습니다! (섹션 ${(d.sections||[]).length}개)`,'ok');
    await loadAll(); setTimeout(()=>openEditor(d.id),500);
  }catch(err){toast('EML 처리 오류: '+err.message,'err');}
}

/* ── Keyboard Shortcuts ───────────────────────────────────────── */
document.addEventListener('keydown',(e)=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='z'&&document.getElementById('view-editor').style.display!=='none'){
    e.preventDefault(); undoLast();
  }
});

/* ── Init ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded',()=>{
  const key=getKey();
  if(key){
    // 저장된 키로 자동 로그인 시도
    fetch('/api/newsletters',{headers:{'X-API-Key':key}})
      .then(r=>{if(r.status===401){document.getElementById('auth-screen').style.display='';}else{showApp();}})
      .catch(()=>{document.getElementById('auth-screen').style.display='';});
  } else {
    // 키 미설정(로컬 개발) 테스트
    fetch('/api/newsletters').then(r=>{
      if(r.status===401){document.getElementById('auth-screen').style.display='';}
      else{showApp();}
    }).catch(()=>{document.getElementById('auth-screen').style.display='';});
  }
});
