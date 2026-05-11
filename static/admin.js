let curNL=null, secs=[], genFile=null, dragIdx=null, allNLs=[], curFilter='all', deleteTargetId=null;

// ── API ─────────────────────────────────────────────────────────
async function api(m,p,b){
  const o={method:m,headers:{'Content-Type':'application/json'}};
  if(b)o.body=JSON.stringify(b);
  const r=await fetch('/api'+p,o);return r.json();
}
async function upload(file){
  const fd=new FormData();fd.append('file',file);
  const r=await fetch('/api/upload-image',{method:'POST',body:fd});
  return r.json();
}

// ── Toast ────────────────────────────────────────────────────────
function toast(msg,type=''){
  const t=document.getElementById('toast');
  t.textContent=msg;t.className='toast show '+(type||'');
  setTimeout(()=>t.className='toast',2600);
}

// ── Views ────────────────────────────────────────────────────────
function showView(name){
  ['list','editor','new'].forEach(v=>{
    const el=document.getElementById('view-'+v);
    el.style.display=v===name?(v==='editor'?'flex':v==='new'?'flex':'flex'):'none';
    if(v===name&&(v==='editor'||v==='new'))el.style.flexDirection='column';
  });
  document.querySelectorAll('.nav-item[data-view]').forEach(n=>{
    n.classList.toggle('active',n.dataset.view===name);
  });
}

// ── Sidebar NL list ──────────────────────────────────────────────
async function loadAll(){
  allNLs=await api('GET','/newsletters');
  renderSidebar();renderGrid();
}
function renderSidebar(){
  const el=document.getElementById('sb-nl-list');
  if(!allNLs.length){el.innerHTML='<div style="padding:10px 12px;font-size:12px;color:#475569">저장된 뉴스레터 없음</div>';return;}
  el.innerHTML=allNLs.map(n=>`
    <button class="sb-nl-item${curNL&&curNL.id===n.id?' active':''}" onclick="openEditor('${n.id}')">
      ${n.thumbnail?`<img class="sb-nl-thumb" src="/uploads/${n.thumbnail}" onerror="this.style.background='#1E2A45'">`
        :'<div class="sb-nl-thumb" style="display:flex;align-items:center;justify-content:center;font-size:14px">📄</div>'}
      <div class="sb-nl-info">
        <div class="sb-nl-title">${n.title}</div>
        <div class="sb-nl-date">${new Date(n.updated_at).toLocaleDateString('ko-KR')} · 섹션${n.section_count}</div>
      </div>
    </button>`).join('');
}

// ── List View ────────────────────────────────────────────────────
function setFilter(f,btn){
  curFilter=f;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');renderGrid();
}
function renderGrid(){
  const q=(document.getElementById('search-inp')||{value:''}).value.toLowerCase();
  const list=allNLs.filter(n=>{
    return n.title.toLowerCase().includes(q)&&(curFilter==='all'||n.status===curFilter);
  });
  const el=document.getElementById('nl-grid');
  if(!list.length){el.innerHTML=`<div class="empty-state"><div class="ico">📭</div><p>뉴스레터가 없습니다</p></div>`;return;}
  el.innerHTML=list.map(n=>`
    <div class="card">
      <div class="card-img" onclick="openEditor('${n.id}')" style="cursor:pointer">
        ${n.thumbnail?`<img src="/uploads/${n.thumbnail}" onerror="this.parentNode.innerHTML='<div class=\\'no-img\\'>📄</div>'">`:'<div class="no-img">📄</div>'}
        <span class="card-badge"><span class="badge ${n.status==='sent'?'badge-sent':'badge-draft'}">${n.status==='sent'?'발송완료':'초안'}</span></span>
      </div>
      <div class="card-body">
        <div class="card-title" title="${n.title}" onclick="openEditor('${n.id}')" style="cursor:pointer">${n.title}</div>
        <div class="card-meta">섹션 ${n.section_count}개 · ${new Date(n.updated_at).toLocaleDateString('ko-KR')}</div>
        <div class="card-actions" onclick="event.stopPropagation()">
          <button class="btn btn-blue btn-sm" onclick="openEditor('${n.id}')">✏️ 편집</button>
          <button class="btn btn-ghost btn-sm" onclick="dupNL('${n.id}')">📋 복제</button>
          <button class="btn btn-ghost btn-sm" onclick="exportById('${n.id}')">📤</button>
          <button class="btn btn-red btn-sm" onclick="delNL('${n.id}')">🗑️</button>
        </div>
      </div>
    </div>`).join('');
}
function delNL(id){
  deleteTargetId=id;
  document.getElementById('del-modal').classList.add('show');
}
async function confirmDelete(){
  if(!deleteTargetId)return;
  document.getElementById('del-modal').classList.remove('show');
  try{
    const result=await api('DELETE','/newsletters/'+deleteTargetId);
    if(result.ok){
      toast('삭제되었습니다','ok');
      deleteTargetId=null;
      await loadAll();
    } else {
      toast('삭제 실패: '+(result.error||'오류'),'err');
    }
  }catch(e){toast('삭제 오류: '+e.message,'err');}
}
function cancelDelete(){
  deleteTargetId=null;
  document.getElementById('del-modal').classList.remove('show');
}
async function dupNL(id){
  toast('복제 중...');
  const nl=await api('POST','/newsletters/'+id+'/duplicate');
  toast('복제 완료! 편집기로 이동합니다','ok');
  await loadAll();setTimeout(()=>openEditor(nl.id),500);
}
function exportById(id){window.location.href='/api/newsletters/'+id+'/export';toast('HTML 다운로드 중...','ok');}

// ── New View ─────────────────────────────────────────────────────
function showNew(){
  document.getElementById('blank-form').style.display='none';
  document.getElementById('existing-picker').style.display='none';
  showView('new');
}
function showBlankForm(){
  document.getElementById('blank-form').style.display='block';
  document.getElementById('existing-picker').style.display='none';
  document.getElementById('new-title').value='';
  document.getElementById('new-title').focus();
}
function hideBlankForm(){
  document.getElementById('blank-form').style.display='none';
}
function showExistingPicker(){
  document.getElementById('existing-picker').style.display='block';
  document.getElementById('blank-form').style.display='none';
  const list=document.getElementById('picker-list');
  if(!allNLs.length){
    list.innerHTML='<div style="padding:16px;text-align:center;color:#64748B;font-size:13px">저장된 뉴스레터가 없습니다</div>';
    return;
  }
  list.innerHTML=allNLs.map(n=>`
    <div style="display:flex;align-items:center;gap:12px;padding:12px;background:#0A0F1E;border:1px solid rgba(255,255,255,.08);border-radius:9px;cursor:pointer;transition:.15s"
         onmouseenter="this.style.borderColor='#8B5CF6'" onmouseleave="this.style.borderColor='rgba(255,255,255,.08)'"
         onclick="useExisting('${n.id}')">
      ${n.thumbnail?`<img src="/uploads/${n.thumbnail}" style="width:52px;height:38px;border-radius:5px;object-fit:cover;flex-shrink:0">`
        :'<div style="width:52px;height:38px;border-radius:5px;background:#1E2A45;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">📄</div>'}
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:#E2E8F0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.title}</div>
        <div style="font-size:11px;color:#64748B;margin-top:2px">섹션 ${n.section_count}개 · ${new Date(n.updated_at).toLocaleDateString('ko-KR')}</div>
      </div>
      <span style="font-size:11px;color:#8B5CF6;flex-shrink:0">복제하여 사용 →</span>
    </div>`).join('');
}
function hideExistingPicker(){
  document.getElementById('existing-picker').style.display='none';
}
async function useExisting(id){
  toast('복제 중...');
  const nl=await api('POST','/newsletters/'+id+'/duplicate');
  toast('복제 완료! 편집기로 이동합니다','ok');
  await loadAll();
  setTimeout(()=>openEditor(nl.id),400);
}
async function createNL(){
  const t=document.getElementById('new-title').value.trim();
  if(!t){toast('제목을 입력해주세요','err');return;}
  const nl=await api('POST','/newsletters',{title:t});
  await loadAll();openEditor(nl.id);
}

// ── Editor ───────────────────────────────────────────────────────
async function openEditor(id){
  const nl=await api('GET','/newsletters/'+id);
  curNL=nl;secs=[...nl.sections||[]];
  document.getElementById('ed-title').value=nl.title;
  setSaved(true);renderSecs();renderPrev();
  renderSidebar();showView('editor');
}
function setSaved(ok){
  const el=document.getElementById('save-status');
  el.textContent=ok?'✓ 저장됨':'● 저장 안됨';
  el.className='save-status'+(ok?' saved':'');
}
function renderSecs(){
  const el=document.getElementById('sec-list');
  if(!secs.length){el.innerHTML='<div style="padding:20px;text-align:center;font-size:12px;color:#64748B">섹션이 없습니다<br>아래 버튼으로 추가하세요</div>';return;}
  el.innerHTML=secs.map((s,i)=>`
    <div class="sec-item" draggable="true" data-i="${i}"
      ondragstart="dStart(event,${i})" ondragover="dOver(event)" ondrop="dDrop(event,${i})">
      <div class="sec-hdr">
        <span class="drag-h">⠿</span>
        <img class="sec-thumb" src="${s.image_url||''}" onerror="this.style.background='#1E2A45'">
        <div class="sec-info">
          <div class="sec-num">섹션 ${i+1}</div>
          <div class="sec-url">${s.click_url||'링크 없음'}</div>
        </div>
        <button class="btn btn-red btn-sm" onclick="removeSec(${i})">✕</button>
      </div>
      <div class="sec-detail">
        <span class="lbl">클릭 URL (선택사항)</span>
        <input class="inp" style="font-size:12px" placeholder="https://example.com" value="${s.click_url||''}"
          oninput="secs[${i}].click_url=this.value;renderPrev();setSaved(false)">
        <span class="lbl">이미지 설명 (alt text)</span>
        <input class="inp" style="font-size:12px" placeholder="이미지 내용 설명" value="${s.alt_text||''}"
          oninput="secs[${i}].alt_text=this.value;setSaved(false)">
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
    const img=`<img src="${s.image_url||''}" style="display:block;width:100%;border:0" alt="${s.alt_text||''}">`;
    return s.click_url?`<a href="${s.click_url}" target="_blank" style="display:block">${img}</a>`:img;
  }).join('')+'<div style="padding:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#9CA3AF">본 메일은 수신동의를 하신 회원님께 발송되었습니다.</div>';
}
function removeSec(i){secs.splice(i,1);renderSecs();renderPrev();setSaved(false);}
async function replaceImg(e,i){
  const f=e.target.files[0];if(!f)return;
  toast('교체 중...');e.target.value='';
  const fd=new FormData();fd.append('file',f);
  const r=await fetch('/api/upload-image',{method:'POST',body:fd});
  const d=await r.json();
  if(d.error){toast('실패: '+d.error,'err');return;}
  secs[i].image_url=d.image_url;renderSecs();renderPrev();setSaved(false);toast('이미지 교체됨','ok');
}
async function saveNL(){
  if(!curNL)return;
  const title=document.getElementById('ed-title').value;
  await api('PUT','/newsletters/'+curNL.id,{title,sections:secs,status:curNL.status||'draft'});
  setSaved(true);toast('저장되었습니다 ✅','ok');await loadAll();
}
async function exportNL(){
  await saveNL();
  window.location.href='/api/newsletters/'+curNL.id+'/export';
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

// ── Upload / AI ──────────────────────────────────────────────────
async function doUpload(e){
  const f=e.target.files[0];if(!f)return;
  toast('업로드 중...');e.target.value='';
  const d=await upload(f);
  if(d.error){toast('실패: '+d.error,'err');return;}
  secs.push({image_url:d.image_url||d.url,click_url:'',alt_text:''});
  renderSecs();renderPrev();setSaved(false);toast('이미지 추가됨 ✅','ok');
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
    const r=await fetch('/api/generate-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
    const d=await r.json();
    if(d.error){toast(d.error,'err');document.getElementById('ai-msg').textContent='오류: '+d.error;return;}
    genFile=d.image_url;
    document.getElementById('ai-preview').innerHTML=`<img src="${d.url}" style="max-width:100%;max-height:200px">`;
    document.getElementById('ai-use-btn').style.display='';
    document.getElementById('ai-msg').textContent='✅ 완료! 이미지를 사용하려면 아래 버튼을 누르세요.';
  }catch(e){toast('오류 발생','err');}
  finally{btn.innerHTML='✨ 생성하기';btn.disabled=false;}
}
function useAI(){
  if(!genFile)return;
  secs.push({image_url:genFile,click_url:'',alt_text:''});
  renderSecs();renderPrev();setSaved(false);closeAI();toast('AI 이미지 추가됨 ✅','ok');
}

// ── Drag & Drop ──────────────────────────────────────────────────
function dStart(e,i){dragIdx=i;}
function dOver(e){e.preventDefault();}
function dDrop(e,i){
  e.preventDefault();if(dragIdx===null||dragIdx===i)return;
  const tmp=secs[dragIdx];secs[dragIdx]=secs[i];secs[i]=tmp;
  renderSecs();renderPrev();setSaved(false);dragIdx=null;
}

// ── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  showView('list');loadAll();
});
