/*
 * Browser regression for an isolated, prebuilt demo only. Never point at production.
 * Prerequisites: Node >=22.3, Playwright resolvable by Node (global runtime is supported),
 * Chromium at CHROMIUM_PATH or /usr/bin/chromium. No dependency installation occurs.
 * Start Next with DATA_SOURCE=mock, USE_MOCK_DATA=true, RECORDS_BACKEND=memory,
 * AUTH_MODE=open and empty webhooks/WhatsApp disabled; private env files must be excluded.
 * Usage: node scripts/ux-regression.cjs --base http://127.0.0.1:3003
 *        [--out /tmp/auditoria-ampliada-ux] [--quick]
 * GETs are read-only. All writes are fixtures except demo role/brand cookie setters.
 * Cookie setters run through browser fetch, retaining Secure cookies on localhost.
 * No request/response bodies, cookies, headers or full signed URLs enter evidence.
 */
if (typeof process.getBuiltinModule !== 'function') throw new Error('This harness requires Node 22.3 or newer.');
const fs = process.getBuiltinModule('fs');
const path = process.getBuiltinModule('path');
const { createRequire } = process.getBuiltinModule('module');
const { chromium } = createRequire(__filename)('playwright');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const base = arg('--base', 'http://127.0.0.1:3003');
const out = path.resolve(arg('--out', '/tmp/auditoria-ampliada-ux'));
const quick = args.includes('--quick');
const parsed = new URL(base);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('Only isolated loopback demos are allowed.');
const routes = ['/', '/live', '/platforms', '/platforms/google', '/platforms/meta', '/platforms/tiktok', '/platforms/microsoft', '/platforms/spotify', '/platforms/x', '/campaigns', '/monitoreos', '/alerts', '/incidents', '/tickets', '/novedades', '/novedades/arranque', '/auditoria', '/cliente', '/budget', '/compare', '/historical', '/metricas', '/optimizaciones', '/integrations', '/automation', '/usuarios', '/settings', '/tipo-de-cambio', '/guia', '/sugerencias'];
const profiles = quick ? [{width:390,height:844}, {width:1440,height:1000}] : [{width:320,height:740}, {width:390,height:844}, {width:768,height:1024}, {width:1024,height:900}, {width:1440,height:1000}];
const results = [];
const mutationCounts = {};
const escapedErrors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safe = message => String(message).replace(/https?:\/\/[^\s)]+/g, '[URL]').replace(/[\r\n]+/g, ' ').slice(0, 400);
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const kickoff = (blocking = false, pending = false) => ({ok:true,brand:'izzi',month:'2026-10',today:'2026-10-02',confirmed:!blocking,required:blocking,missingBudgets:[],pending:pending?[{key:'fixture',name:'Campaña de prueba pendiente',platform:'meta',accountName:null,expectedStart:null,overdue:false}]:[],justStarted:[]});
const critical = {id:'INC-UX-FIXTURE',openedAt:'2026-10-02T12:00:00Z',platform:'meta',platformName:'Meta Ads',type:'Entrega',title:'Incidente de prueba UX',entity:'Cuenta ficticia',deviation:-0.5,lastUpdateAt:'2026-10-02T12:00:00Z',diagnosis:null,ackedBy:[],ticketId:null};
const nexusAnswer = brand => ({ok:true,answer:{kind:'guide',title:'Respuesta de prueba UX',paragraphs:['Contenido de prueba sin datos privados.'],facts:[],items:[],sources:[],suggestions:[],context:{brand,brandName:brand==='sky'?'Sky':'izzi',date:'2026-10-02',cutoffHour:12,timezone:'America/Mexico_City',asOf:'2026-10-02T18:00:00Z',mode:'mock'}}});
let browser;
async function fresh(profile = {width:1440,height:1000}, theme = 'light', fixture = {}) {
 const context = await browser.newContext({viewport:profile,colorScheme:theme,reducedMotion:'reduce'});
 await context.addInitScript(theme => { localStorage.setItem('theme',theme); }, theme);
 const page = await context.newPage();
 const runtimeErrors = [];
 page.on('pageerror', err => runtimeErrors.push(safe(err.message)));
 page.on('console', msg => { if(msg.type()==='error' && /hydration|Minified React error|Uncaught/i.test(msg.text())) runtimeErrors.push(safe(msg.text())); });
 await page.route('**/*', async route => {
  const req = route.request(), u = new URL(req.url()), method = req.method();
  if(u.origin !== parsed.origin) { if(['data:','blob:'].includes(u.protocol)) return route.continue(); return route.abort('blockedbyclient'); }
  if(u.pathname==='/api/critical') {
   if(method==='GET') { await sleep(fixture.criticalDelay || 0); return route.fulfill({json:{ok:true,pending:fixture.critical && !fixture.acked?[critical]:[]}}); }
   fixture.acked = true; return route.fulfill({json:{ok:true}});
  }
  if(u.pathname==='/api/kickoff' && method==='GET') { await sleep(fixture.monthDelay || 0); return route.fulfill({json:kickoff(fixture.blocking,fixture.reminder)}); }
  if(u.pathname==='/api/nexus' && method==='POST') {
   if(fixture.nexusMode==='error') return route.fulfill({status:503,json:{ok:false,message:'Fallo de prueba controlado.'}});
   if(fixture.nexusMode==='offline') return route.abort('internetdisconnected');
   if(fixture.nexusMode==='slow') { await sleep(2000); return route.fulfill({json:nexusAnswer('izzi')}).catch(()=>undefined); }
   const body = req.postDataJSON(); return route.fulfill({json:nexusAnswer(body.brand)});
  }
  if(!['GET','HEAD','OPTIONS'].includes(method)) {
   if(['/api/session/role','/api/brand'].includes(u.pathname)) return route.continue();
   const key = `${method} ${u.pathname}`; mutationCounts[key] = (mutationCounts[key] || 0)+1;
   if(fixture.offlineWrites) return route.abort('internetdisconnected');
   return route.fulfill({status:409,json:{ok:false,message:'Escritura interceptada por el harness UX; no se guardaron datos.'}});
  }
  return route.continue();
 });
 return {context,page,runtimeErrors,fixture};
}
async function check(name, fn) {
 const started = Date.now();
 try { const details = await fn(); results.push({name,ok:true,ms:Date.now()-started,...details}); }
 catch(error) { results.push({name,ok:false,ms:Date.now()-started,error:safe(error.message)}); }
 if(results.length % 20 === 0) console.log(JSON.stringify({completed:results.length,failures:results.filter(r=>!r.ok).length}));
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({generatedAt:new Date().toISOString(),results,mutationCounts},null,2));
}
async function changeRole(page, role) {
 const status = await page.evaluate(async role => (await fetch('/api/session/role',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})})).status,role);
 insist(status===200,`Demo role cookie request rejected (${status}).`);
}
async function geometry(page) {
 return page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,headings:document.querySelectorAll('h1').length,unlabelledFields:[...document.querySelectorAll('main input,main textarea,main select')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&!el.closest('[aria-hidden="true"]')&&el.type!=='hidden'&&!el.labels?.length&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')&&!el.title&&!el.getAttribute('placeholder')}).map(el=>({tag:el.tagName,type:el.type||null})),emptyNames:[...document.querySelectorAll('button,a[href]')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&!el.closest('[aria-hidden="true"]')&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')&&!el.title&&!el.labels?.length&&!el.textContent.trim()&&!el.querySelector('[aria-label],title')}).slice(0,8).map(el=>el.tagName),overflow:[...document.querySelectorAll('main *')].filter(el=>{const r=el.getBoundingClientRect(); if(r.width<1||r.right<=innerWidth+3) return false;for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement)if(['auto','scroll','hidden','clip'].includes(getComputedStyle(p).overflowX))return false;return true}).slice(0,8).map(el=>({tag:el.tagName,text:el.textContent.trim().slice(0,70),right:Math.round(el.getBoundingClientRect().right)}))}));
}
async function navigate(page, route) {
 const response = await page.goto(base+route,{waitUntil:'networkidle',timeout:30000});
 insist(response && response.status()<400,`Page HTTP ${response?.status()}`);
 await page.waitForTimeout(100);
 return response;
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const preflight = await fetch(base+'/api/health').then(r=>r.json());
 insist(preflight.mode==='mock','The target must be an isolated mock demo.');
 insist(!preflight.integrations?.n8n&&!preflight.integrations?.whatsapp,'Demo webhooks and WhatsApp must be disabled.');
 browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const demoGuard=await fresh();try{await navigate(demoGuard.page,'/api/health');await changeRole(demoGuard.page,'admin');}finally{await demoGuard.context.close();}
  for(const profile of profiles) for(const theme of ['light','dark']) {
   const run = await fresh(profile,theme);
   try {
    for(const route of routes) await check(`page:${route}:${profile.width}:${theme}`,async()=>{
     run.runtimeErrors.length=0;
     await navigate(run.page,route);
     const g=await geometry(run.page);
     insist(await run.page.locator('html').evaluate((el,theme)=>el.classList.contains('dark')===(theme==='dark'),theme),'Requested theme did not apply.');
     insist(!g.emptyNames.length,`Visible actions without accessible names: ${JSON.stringify(g.emptyNames)}`);
     insist(!g.unlabelledFields.length,`Visible fields without accessible names: ${JSON.stringify(g.unlabelledFields)}`);
     insist(g.width<=g.viewport+3,`Document overflow ${g.width}/${g.viewport}; ${JSON.stringify(g.overflow)}`);
     insist(g.headings>0,'No visible primary page heading.');
     insist(!run.runtimeErrors.length,`Runtime error: ${run.runtimeErrors.join('; ')}`);
     if(['/','/alerts','/settings','/cliente'].includes(route)&&[390,1440].includes(profile.width)) await run.page.screenshot({path:path.join(out,`${route==='/'?'resumen':route.slice(1)}-${profile.width}-${theme}.png`),fullPage:false});
     return {geometry:g};
    });
   } finally {await run.context.close();}
  }
  await check('keyboard:skip-link',async()=>{
   const run=await fresh();try{
    await navigate(run.page,'/'); await run.page.keyboard.press('Tab');
    insist(await run.page.getByRole('link',{name:'Saltar al contenido principal'}).evaluate(el=>document.activeElement===el),'Skip link is not the first keyboard stop.');
    await run.page.keyboard.press('Enter'); insist(await run.page.locator('#contenido-principal').evaluate(el=>document.activeElement===el),'Skip link does not focus main.');
   }finally{await run.context.close();}
  });
  for(const width of [320,390,768]) await check(`keyboard:mobile-navigation:${width}`,async()=>{
   const run=await fresh({width,height:844});try{
    await navigate(run.page,'/'); const opener=run.page.getByRole('button',{name:'Abrir navegación'});
    await opener.focus(); await run.page.keyboard.press('Enter');
    const menu=run.page.getByRole('dialog',{name:'Navegación del monitoreo'}); await menu.waitFor();
    for(let n=0;n<8;n++){await run.page.keyboard.press('Tab');insist(await menu.evaluate(el=>el.contains(document.activeElement)),'Focus escaped mobile menu.');}
    const close=menu.getByRole('button',{name:'Cerrar',exact:true});const rect=await close.boundingBox();insist(rect.width>=44&&rect.height>=44,'Mobile close target smaller than44px.');
    await run.page.keyboard.press('Escape'); await menu.waitFor({state:'hidden'}); insist(await opener.evaluate(el=>document.activeElement===el),'Mobile menu did not restore focus.');
   }finally{await run.context.close();}
  });
  for(const route of ['/alerts','/incidents']) for(const key of ['Enter','Space']) await check(`keyboard:detail:${route}:${key}`,async()=>{
   const run=await fresh();try{
    await navigate(run.page,route);const row=run.page.getByRole('row',{name:route==='/alerts'?/Abrir alerta/:/Abrir incidente/}).first();insist(await row.count()>0,'No demo row available for keyboard interaction.');await row.focus();await run.page.keyboard.press(key==='Space'?' ':key);const detail=run.page.getByRole('dialog');await detail.waitFor();for(let n=0;n<3;n++){await run.page.keyboard.press('Tab');insist(await detail.evaluate(el=>el.contains(document.activeElement)),'Focus escaped detail sheet.');}await run.page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});insist(await row.evaluate(el=>el===document.activeElement),'Detail sheet did not restore row focus.');
   }finally{await run.context.close();}
  });
  const roleExpected={admin:{settings:true,users:true},coadmin:{settings:true,users:true},manager:{settings:false,users:false},viewer:{settings:false,users:false},auditor:{settings:false,users:true},client:{settings:false,users:false}};
  for(const [role,expected] of Object.entries(roleExpected)) await check(`role:${role}`,async()=>{
   const run=await fresh();try{
    await navigate(run.page,'/'); await changeRole(run.page,role); await navigate(run.page,'/settings');
    if(role==='client'){insist(new URL(run.page.url()).pathname==='/cliente','Client can see internal settings.');insist(await run.page.getByRole('button',{name:/Abrir Nexus/}).count()===0,'Client sees internal assistant.');}
    else{insist(await run.page.getByRole('button',{name:'Guardar cambios',exact:true}).count()===(expected.settings?1:0),'Wrong settings edit controls for role.');insist(await run.page.getByRole('link',{name:'Usuarios y accesos',exact:true}).count()===(expected.users?1:0),'Wrong nominal user navigation for role.');}
    return {role,expected};
   }finally{await run.context.close();}
  });
  for(const blocking of [true,false]) for(const [criticalDelay,monthDelay] of [[50,500],[500,50]]) await check(`gates:${blocking?'kickoff':'reminder'}:${criticalDelay}:${monthDelay}`,async()=>{
   const run=await fresh(undefined,undefined,{critical:true,blocking,reminder:true,criticalDelay,monthDelay});try{
    await navigate(run.page,'/');await run.page.waitForTimeout(700);
    const criticalModal=run.page.getByRole('alertdialog');insist(await criticalModal.count()===1&&await run.page.getByRole('dialog').count()===0,'More than one operational dialog or critical hidden.');
    insist(await run.page.locator('#ack-text').evaluate(el=>el===document.activeElement),'Critical focus lost.');await run.page.keyboard.press('Escape');insist(await criticalModal.count()===1,'Critical gate can be bypassed with Escape.');for(let n=0;n<3;n++){await run.page.keyboard.press('Tab');insist(await criticalModal.evaluate(el=>el.contains(document.activeElement)),'Focus escaped the critical gate.');}
    await run.page.locator('#ack-text').fill('Revisé el fixture y confirmé su estado sin modificar datos.');await run.page.locator('#ack-to').fill('Equipo de prueba');await criticalModal.getByRole('checkbox',{name:/Yo,/}).check();await criticalModal.getByRole('button',{name:'Registrar acuse y continuar'}).click();
    await run.page.waitForTimeout(500);const monthly=run.page.getByRole('dialog');insist(await criticalModal.count()===0&&await monthly.count()===1,'Monthly dialog did not resume after acknowledgment.');insist(await monthly.evaluate(el=>el.contains(document.activeElement)),'Monthly focus lost on resume.');
    await run.page.keyboard.press('Escape');insist(await monthly.count()===(blocking?1:0),'Monthly Escape handling is incorrect.');return {criticalFocus:true,monthlyResumed:true,escapeHandled:true};
   }finally{await run.context.close();}
  });
  await check('nexus:error-retry-cancel-and-brand-reset',async()=>{
   const run=await fresh({width:390,height:844},'dark',{nexusMode:'error'});try{
    await navigate(run.page,'/');await run.page.getByRole('button',{name:/Abrir Nexus/}).click();const panel=run.page.getByRole('dialog',{name:/Nexus/});await panel.waitFor();
    const textarea=run.page.getByRole('textbox',{name:'Pregunta para Nexus'});insist(await textarea.evaluate(el=>el===document.activeElement),'Nexus did not autofocus input.');
    await textarea.fill('Pregunta de prueba');await textarea.press('Enter');await panel.getByRole('alert').waitFor();insist(await panel.getByRole('button',{name:'Reintentar'}).count()===1,'Missing retry action.');
    run.fixture.nexusMode='slow';await panel.getByRole('button',{name:'Reintentar'}).click();await panel.getByRole('button',{name:'Cancelar',exact:true}).click();await panel.getByText('Consulta cancelada. Puedes volver a intentarlo.').waitFor();
    run.fixture.nexusMode='ok';await textarea.fill('Prueba antes de cambiar marca');await textarea.press('Enter');await panel.getByRole('heading',{name:'Respuesta de prueba UX'}).waitFor();await panel.getByRole('button',{name:'Limpiar conversación de Nexus'}).click();await panel.getByRole('heading',{name:'¿Qué necesitas revisar?'}).waitFor();await textarea.fill('Prueba antes de cambiar marca');await textarea.press('Enter');await panel.getByRole('heading',{name:'Respuesta de prueba UX'}).waitFor();await run.page.keyboard.press('Escape');insist(await run.page.getByRole('button',{name:/Abrir Nexus/}).evaluate(el=>el===document.activeElement),'Nexus did not restore focus to its trigger.');
    await run.page.getByRole('radio',{name:'Sky',exact:true}).click();await run.page.waitForTimeout(500);await run.page.getByRole('button',{name:/Abrir Nexus/}).click();
    const resetPanel=run.page.getByRole('dialog',{name:/Nexus/});await resetPanel.getByText(/marca Sky seleccionada/).waitFor();insist(await resetPanel.getByText('Prueba antes de cambiar marca',{exact:true}).count()===0,'Conversation leaked across brand reset.');
    return {error:true,retry:true,cancel:true,clearConversation:true,focusRestored:true,brandReset:true};
   }finally{await run.context.close();}
  });
  await check('forms:settings-and-fx-offline-retain-drafts',async()=>{
   const run=await fresh({width:390,height:844},'light',{offlineWrites:true});try{
    await navigate(run.page,'/settings');const first=run.page.locator('main input[type=number]').first();const previous=await first.inputValue();await first.fill(String(Number(previous)+1));const save=run.page.getByRole('button',{name:'Guardar cambios',exact:true});await save.click();await run.page.waitForTimeout(500);insist(await first.inputValue()===String(Number(previous)+1),'Settings draft lost on offline save.');insist(await save.isEnabled(),'Settings save remained disabled after error.');insist(await run.page.getByText(/No se pudo guardar/).count()>0,'Settings missing offline feedback.');
    await navigate(run.page,'/tipo-de-cambio');const rate=run.page.getByRole('textbox',{name:/Tasa de/}).first();await rate.fill('18.45');await rate.locator('xpath=ancestor::tr').getByRole('button',{name:'Guardar',exact:true}).click();await run.page.waitForTimeout(500);insist(await rate.inputValue()==='18.45','FX draft lost on offline save.');insist(await run.page.getByText(/No se pudo guardar/).count()>0,'FX missing offline feedback.');
    return {settingsDraft:true,fxDraft:true,requestsIntercepted:true};
   }finally{await run.context.close();}
  });
 } finally {if(browser)await browser.close();}
 const failures=results.filter(r=>!r.ok);
 const categories=Object.fromEntries([...new Set(results.map(r=>r.name.split(':')[0]))].map(category=>[category,{cases:results.filter(r=>r.name.startsWith(category+':')).length,failed:results.filter(r=>r.name.startsWith(category+':')&&!r.ok).length}]));
 const summary={categories,generatedAt:new Date().toISOString(),base:parsed.origin,mode:'mock',profiles,themes:['light','dark'],cases:results.length,passed:results.length-failures.length,failed:failures.length,failures,mutationCounts,limits:['Browser fixtures do not validate real platform credentials or data reconciliation.','Permission checks exercise demo roles, not real nominal-account credentials.','Geometry/name checks and keyboard tests do not establish full WCAG certification or real screen-reader behavior.','No mutations persisted; role and brand changes are browser-local demo cookies.']};
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({cases:summary.cases,passed:summary.passed,failed:summary.failed,out}));if(failures.length)process.exitCode=1;
})().catch(error=>{escapedErrors.push(safe(error.message));fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'fatal.json'),JSON.stringify({errors:escapedErrors},null,2));console.error(safe(error.message));process.exitCode=1;});
