const $=id=>document.getElementById(id),api=studio.api;
const button=(label,href)=>{const a=document.createElement('a');a.className='button';a.textContent=label;a.href=href;return a;};
const deleteDialog=document.createElement('dialog');deleteDialog.className='project-dialog';deleteDialog.setAttribute('aria-label','删除角色工程');
deleteDialog.innerHTML='<h2>删除角色工程</h2><p id="deleteProjectMessage"></p><p>工程会移入回收目录，可从首页的“已删除工程”恢复。</p><div class="buttons"><button type="button" id="cancelProjectDelete">取消</button><button type="button" id="confirmProjectDelete" class="danger">移入回收目录</button></div><p id="deleteProjectError" class="error" role="status"></p>';
document.body.append(deleteDialog);let deletingProject;
$('cancelProjectDelete').onclick=()=>deleteDialog.close();
$('confirmProjectDelete').onclick=async()=>{
  const confirm=$('confirmProjectDelete');confirm.disabled=true;
  try{const result=await api('delete-project',{id:deletingProject.id});deleteDialog.close();$('status').textContent=`已删除工程“${result.name}”，可在已删除工程中恢复。`;await load();}
  catch(error){$('deleteProjectError').textContent=error.message;}
  finally{confirm.disabled=false;}
};
async function load(){
  const projects=await api('projects');$('projects').replaceChildren();
  if(!projects.length)$('projects').textContent='还没有工程。可以新建或导入部件。';
  for(const project of projects){
    const card=document.createElement('div');card.className='project';const info=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('p'),path=document.createElement('div'),actions=document.createElement('div');
    title.textContent=project.name;meta.textContent=`${project.parts} 个部件 · ${project.nodes} 个节点 · ${project.canvas.join(' × ')} · ${project.version}`;path.textContent=`projects/${project.id}`;path.className='path';
    const author=document.createElement('p');author.textContent='作者：'+(project.author||'未填写');if(project.authorUrl&&/^https?:/.test(project.authorUrl)){const a=document.createElement('a');a.href=project.authorUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent=' · 作者主页';author.append(a);}info.append(title,meta,author,path);actions.className='buttons';for(const [text,page]of [['组装','editor.html'],['绑定','bind.html'],['功能配置','features.html'],['表情与眨眼','calibration.html'],['动作','motion/'],['导出','export.html']])actions.append(button(text,`/p/${project.id}/${page}`));
    if(project.hasNative){actions.append(button('原包预览',`/p/${project.id}/motion/?mode=original`));const out=document.createElement('button');out.textContent='导出原包';out.onclick=async()=>{try{const result=await api('native-export?project='+project.id,{});const a=document.createElement('a');a.href=result.url;a.download='';a.click();$('status').textContent='已导出原包；编辑副本的修改不包含在这里。';}catch(e){$('status').textContent=e.message;}};actions.append(out);}
    const remove=document.createElement('button');remove.className='danger';remove.textContent='删除工程';remove.onclick=()=>{deletingProject=project;$('deleteProjectMessage').textContent=`删除“${project.name}”（${project.id}）？`;$('deleteProjectError').textContent='';deleteDialog.showModal();};actions.append(remove);
    card.dataset.project=project.id;card.append(info,actions);$('projects').append(card);
  }
  await loadDeleted();
}
async function loadDeleted(){
  const items=await api('deleted-projects');$('projectTrash').replaceChildren();
  if(!items.length){$('projectTrash').textContent='暂无已删除工程';return;}
  for(const item of items){const row=document.createElement('div'),name=document.createElement('span'),restore=document.createElement('button');row.className='deleted-project';name.textContent=`${item.name} · ${item.id}`;restore.textContent='恢复工程';restore.onclick=async()=>{restore.disabled=true;try{await api('restore-project',{token:item.token});$('status').textContent=`已恢复工程“${item.name}”。`;await load();}catch(error){$('status').textContent=error.message;restore.disabled=false;}};row.append(name,restore);$('projectTrash').append(row);}
}
async function submit(form,status,fn){const controls=[...form.querySelectorAll('input,button,select')];controls.forEach(c=>c.disabled=true);$(status).textContent='处理中…';try{await fn();}catch(e){$(status).textContent=e.message;}finally{controls.forEach(c=>c.disabled=false);}}
$('refresh').onclick=()=>load().catch(e=>$('status').textContent=e.message);
$('newForm').onsubmit=event=>{event.preventDefault();submit(event.target,'newStatus',async()=>{const p=await api('new',{id:$('id').value.trim(),name:$('name').value.trim(),canvas:[+$('width').value,+$('height').value]});location.href=`/p/${p.id}/editor.html`;});};
$('importForm').onsubmit=event=>{event.preventDefault();submit(event.target,'importStatus',async()=>{const p=await api('import',{path:$('source').value.trim(),mode:$('mode').value,name:$('importName').value.trim()});$('importStatus').textContent=`已复制导入：${p.name}${p.notice?'\n'+p.notice:''}`;await load();});};
load().catch(e=>$('status').textContent=e.message);
fetch('/api/legacy-projects').then(r=>r.json()).then(items=>{
  for(const item of items){const p=document.createElement('p'),b=document.createElement('button');p.textContent=item.name+' · '+item.path;b.textContent='填入导入路径';b.onclick=()=>{$('source').value=item.path;$('mode').value='auto';};$('legacy').append(p,b);}
}).catch(()=>{});
