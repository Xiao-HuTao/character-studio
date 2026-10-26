(() => {
  const project=location.pathname.match(/^\/p\/([a-z0-9-]+)\//)?.[1]||null;
  const original=window.fetch.bind(window);
  window.fetch=(input,options)=>{
    const url=new URL(input instanceof Request?input.url:String(input),location.href);
    if(project&&url.origin===location.origin&&url.pathname.startsWith('/api/'))url.searchParams.set('project',project);
    return original(input instanceof Request?new Request(url,input):url,options);
  };
  async function api(path,body) {
    const response=await fetch('/api/'+path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw Error(data.error||'操作失败');return data;
  }
  async function go(page) {
    if(window.studioSave&&await window.studioSave()===false)return;
    location.href=page==='/'?'/':`/p/${project}/${page}`;
  }
  window.studio={project,api,go};
  window.studioNavigate=go;
  if(project)api('project').then(config=>{
    document.querySelectorAll('[data-project-name]').forEach(el=>el.textContent=config.name);
    const old=document.querySelector('header .title small');if(old)old.textContent=config.name;
  }).catch(console.error);
})();
