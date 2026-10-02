/*
 * Browser regression for an isolated, prebuilt demo only. Never point at production.
 * Prerequisites: Node >=22.3, Playwright resolvable by Node (global runtime is supported),
 * Chromium at CHROMIUM_PATH or /usr/bin/chromium. No dependency installation occurs.
 * Start Next with DATA_SOURCE=mock, USE_MOCK_DATA=true, RECORDS_BACKEND=memory,
 * AUTH_MODE=open and empty webhooks/WhatsApp disabled; private env files must be excluded.
 * Usage: node scripts/ux-regression.cjs --base http://127.0.0.1:3003
 *        [--out /tmp/auditoria-ampliada-ux] [--quick] [--absolute-top-only]
 *        [--case-filter substring[,substring]] (focal/debug only; report records the filter)
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
const absoluteOnly = args.includes('--absolute-top-only');
const caseFilter = arg('--case-filter', '');
const parsed = new URL(base);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('Only isolated loopback demos are allowed.');
const routes = ['/', '/live', '/platforms', '/platforms/google', '/platforms/meta', '/platforms/tiktok', '/platforms/microsoft', '/platforms/spotify', '/platforms/x', '/campaigns', '/monitoreos', '/absolute-top', '/alerts', '/incidents', '/tickets', '/novedades', '/novedades/arranque', '/auditoria', '/cliente', '/budget', '/compare', '/historical', '/metricas', '/optimizaciones', '/integrations', '/automation', '/usuarios', '/settings', '/tipo-de-cambio', '/guia', '/sugerencias'];
const profiles = quick ? [{width:390,height:844}, {width:1440,height:1000}] : [{width:320,height:740}, {width:390,height:844}, {width:768,height:1024}, {width:1024,height:900}, {width:1440,height:1000}];
const results = [];
const mutationCounts = {};
const escapedErrors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safe = message => String(message).replace(/https?:\/\/[^\s)]+/g, '[URL]').replace(/[\r\n]+/g, ' ').slice(0, 400);
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const kickoff = (blocking = false, pending = false) => ({ok:true,brand:'izzi',month:'2026-10',today:'2026-10-02',confirmed:!blocking,required:blocking,missingBudgets:[],pending:pending?[{key:'fixture',name:'Campaña de prueba pendiente',platform:'meta',accountName:null,expectedStart:null,overdue:false}]:[],justStarted:[]});
const critical = {id:'INC-UX-FIXTURE',openedAt:'2026-10-02T12:00:00Z',platform:'meta',platformName:'Meta Ads',type:'Entrega',title:'Incidente de prueba UX',entity:'Cuenta ficticia',deviation:-0.5,lastUpdateAt:'2026-10-02T12:00:00Z',diagnosis:null,ackedBy:[],ticketId:null};
// Read the public master once, then replace account identities with synthetic data before any browser evidence.
const fixtureConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../unified-ads-api/src/config/google-ads-domains.json'),'utf8'));
let fixtureAccountIndex = 0;
fixtureConfig.domains = fixtureConfig.domains.map(domain => ({...domain,accounts:domain.accounts.map(() => {
 fixtureAccountIndex++; return {customerId:String(1000000000+fixtureAccountIndex),name:`Cuenta ficticia ${fixtureAccountIndex}`};
})}));
const fixtureDomain = id => ({id,name:fixtureConfig.domains.find(domain=>domain.id===id)?.name || (id==='all'?'Todos los dominios':'Sin clasificar'),available:true,configVersion:1});
const nexusAnswer = (brand,domain='all') => ({ok:true,answer:{kind:'guide',title:'Respuesta de prueba UX',paragraphs:['Contenido de prueba sin datos privados.'],facts:[],items:[],sources:[],suggestions:[],context:{brand,brandName:brand==='sky'?'Sky':'izzi',date:'2026-10-02',cutoffHour:12,timezone:'America/Mexico_City',asOf:'2026-10-02T18:00:00Z',mode:'mock',domain:fixtureDomain(domain)}}});
function absoluteTopFixture(selectedDomain='all') {
 const emptyComparison={rate:null,delta_pp:null,samples:0,approximate:false};
 const row=(domain,account,campaign,group,rate,state,score,coverage='complete')=>({
  level:group?'ad_group':'campaign',domain_id:domain?.id || 'unclassified',domain_name:domain?.name || 'Sin clasificar',
  customer_id:account.customerId,account_id:account.customerId,account_name:account.name,campaign_id:campaign,campaign_name:`Campaña ficticia ${campaign}`,campaign_status:'active',
  ad_group_id:group,ad_group_name:group?`Grupo ficticio ${group}`:null,ad_group_status:group?'active':null,
  date:'2026-09-30',hour:null,currency:'MXN',source_timezone:'America/Mexico_City',extracted_at:'2026-10-02T18:00:00Z',
  absolute_top_rate:rate,top_of_page_rate:rate===null?null:0.95,search_impression_share:null,search_lost_is_rank:null,search_lost_is_budget:group?null:0.1,
  impressions:rate===null?null:500,clicks:rate===null?null:20,ctr:rate===null?null:4,cpc:rate===null?null:5,spend:rate===null?null:100,conversions:rate===null?null:2.5,
  bidding_strategy:'TARGET_CPA',daily_budget:group?null:50,share_bounds:{search_impression_share:'lt_10_percent',search_lost_is_rank:'gt_90_percent'},
  warnings:rate===null?['Medición de prueba no disponible. N/D permanece desconocido.']:['Fixture UX sin datos reales. Conversiones: total Google, no evento offline.'],
  entity_key:`${account.customerId}/${campaign}/${group || 'campaign'}`,audit_id:'ux-fixture-audit',audit_at:'2026-10-02T18:05:00Z',coverage,
  target_rate:domain?.absoluteTopMinimum ?? null,gap_pp:rate===null || !domain?null:(rate-domain.absoluteTopMinimum)*100,state,
  severity:state==='below'?'CRITICAL':state==='near'?'ATTENTION':'NORMAL',severity_score:score,score_components:{gap:score,impressions:rate===null?null:10},group_weight:group&&rate!==null?0.6:null,sudden_drop:state==='below',
  persistence:{consecutive_audits:state==='below'?3:1,label:state==='below'?'Alerta persistente':state==='meets'?'Dentro del objetivo':'Sin evaluación',first_detected_at:state==='below'?'2026-10-02T12:00:00Z':null,last_detected_at:state==='below'?'2026-10-02T18:05:00Z':null,hours_since_detection:state==='below'?6:null,worst_rate:rate,best_rate:rate,mean_rate:rate,audit_id:'ux-fixture-audit'},
  comparison:{previous:{rate:rate===null?null:0.75,delta_pp:rate===null?null:(rate-0.75)*100,samples:rate===null?0:1,approximate:false},previous_day:emptyComparison,last_24h:emptyComparison,last_7d:emptyComparison},
  evolution:[{at:'2026-10-02T12:00:00Z',rate:rate===null?null:0.75,impressions:500,audit_id:'ux-previous'},{at:'2026-10-02T15:00:00Z',rate:null,impressions:null,audit_id:'ux-gap'},{at:'2026-10-02T18:05:00Z',rate,impressions:rate===null?null:500,audit_id:'ux-fixture-audit'}],
  cross_status:state==='below'?'localized':state==='meets'?'healthy':'unknown',diagnostics:['Asociación de prueba para revisar; no demuestra causalidad ni recomienda cambios automáticos.'],
 });
 const first=fixtureConfig.domains[0],second=fixtureConfig.domains[1],third=fixtureConfig.domains[2];
 const rows=[row(first,first.accounts[0],'101',null,0.8,'meets',10),{...row(first,first.accounts[0],'101','10101',0.4,'below',95),clicks:600,ctr:120,cpc:100/600},row(first,first.accounts[0],'101','10102',null,'insufficient',0,'unavailable'),row(first,first.accounts[1],'102',null,0.68,'near',40),row(first,first.accounts[1],'102','10201',0.72,'meets',15),row(second,second.accounts[0],'201',null,0.08,'near',30),row(third,third.accounts[0],'301',null,null,'insufficient',0,'unavailable'),row(null,{customerId:'1999999999',name:'Cuenta ficticia sin clasificar'},'401',null,0.9,'unclassified',0)].sort((a,b)=>b.severity_score-a.severity_score);
 const scoped=selectedDomain==='all'?rows:rows.filter(row=>row.domain_id===selectedDomain);
 const summaries=fixtureConfig.domains.filter(domain=>selectedDomain==='all'||domain.id===selectedDomain).map(domain=>{
  const data=rows.filter(row=>row.domain_id===domain.id), evaluable=data.filter(row=>['meets','near','below'].includes(row.state));
  return {domain_id:domain.id,domain_name:domain.name,target_rate:domain.absoluteTopMinimum,campaigns:data.filter(row=>row.level==='campaign').length,ad_groups:data.filter(row=>row.level==='ad_group').length,meets:data.filter(row=>row.state==='meets').length,near:data.filter(row=>row.state==='near').length,below:data.filter(row=>row.state==='below').length,insufficient:data.filter(row=>row.state==='insufficient').length,compliance_rate:evaluable.length?data.filter(row=>row.state==='meets').length/evaluable.length:null,weighted_absolute_top:domain===first?0.74:domain===second?0.08:null,weighting_approximate:true,severity_score:Math.max(0,...data.map(row=>row.severity_score))};
 });
 return {brand:'izzi',selectedDomain,configured:true,available:true,lastAuditAt:'2026-10-02T18:05:00Z',domains:fixtureConfig.domains,policy:fixtureConfig.absoluteTop,rows:scoped,summaries,warnings:['Datos de prueba UX. Esta vista no valida Google Ads ni conciliación real.'],approximationNotice:'Indicador aproximado ponderado por impresiones reportadas; no reproduce exactamente el porcentaje nativo de Google.'};
}
// Client navigation RSC fixtures exercise the real components without changing the server's empty memory store.
function fixtureFlight(text, fixture) {
 let dashboards=0;
 const walk=value=>{
  if(!value || typeof value!=='object') return typeof value==='string'?value.replace('Clasificación de dominios pendiente: el extractor necesita guardar la configuración maestra validada de la API. Absolute Top permanece sin evaluación.','Entorno de prueba UX con datos simulados; no valida proveedores reales.'):value;
  if(Array.isArray(value)) {
   if(value[0]==='$'&&value[3]?.initial&&Object.hasOwn(value[3].initial,'selectedDomain')) return [value[0],walk(value[1]),fixture.selectedDomain || 'all',walk(value[3])];
   return value.map(walk);
  }
  if(Object.hasOwn(value,'configured')&&Object.hasOwn(value,'available')&&Object.hasOwn(value,'rows')&&Object.hasOwn(value,'domains')&&Object.hasOwn(value,'selectedDomain')) {dashboards++;return absoluteTopFixture(fixture.selectedDomain || 'all');}
  if(Object.hasOwn(value,'current')&&Object.hasOwn(value,'options')&&Object.hasOwn(value,'enabled')) return {...value,current:fixtureDomain(fixture.selectedDomain || 'all'),options:[fixtureDomain('all'),...fixtureConfig.domains.map(domain=>({id:domain.id,name:domain.name})),fixtureDomain('unclassified')],enabled:true};
  if(Object.hasOwn(value,'brandId')&&Object.hasOwn(value,'brandName')&&Object.hasOwn(value,'domainId')) return {...value,domainId:fixture.selectedDomain || 'all',domainName:fixtureDomain(fixture.selectedDomain || 'all').name};
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,walk(item)]));
 };
 const patched=text.split('\n').map(line=>{
  const match=/^([0-9a-f]+:)([\[{].*)$/.exec(line);if(!match) return line;
  try{return match[1]+JSON.stringify(walk(JSON.parse(match[2])));}catch{return line;}
 }).join('\n');
 return {body:patched,dashboards};
}
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
  if(u.origin !== parsed.origin) { if(['data:','blob:'].includes(u.protocol)) return route.continue(); fixture.externalRequests=(fixture.externalRequests || 0)+1;return route.abort('blockedbyclient'); }
  if(fixture.absoluteTop&&!['GET','HEAD','OPTIONS'].includes(method)&&!['/api/domain','/api/nexus'].includes(u.pathname))fixture.unexpectedWrites=(fixture.unexpectedWrites || 0)+1;
  if(fixture.absoluteTop && method==='GET' && req.headers().rsc==='1') {
   const response=await route.fetch();
   const body=await response.text();
   if(response.headers()['content-type']?.includes('text/x-component')) {
    const patched=fixtureFlight(body,fixture);fixture.rscPatches=(fixture.rscPatches || 0)+patched.dashboards;
    return route.fulfill({response,body:patched.body});
   }
   return route.fulfill({response,body});
  }
  if(fixture.absoluteTop && u.pathname==='/api/domain' && method==='POST') {
   const domain=req.postDataJSON()?.domain;
   if(domain!=='all'&&domain!=='unclassified'&&!fixtureConfig.domains.some(item=>item.id===domain)) return route.fulfill({status:400,json:{ok:false}});
   fixture.selectedDomain=domain;mutationCounts['POST /api/domain (fixture)']=(mutationCounts['POST /api/domain (fixture)']||0)+1;
   return route.fulfill({json:{ok:true,domain:fixtureDomain(domain)}});
  }
  if(u.pathname==='/api/critical') {
   if(method==='GET') { await sleep(fixture.criticalDelay || 0); return route.fulfill({json:{ok:true,pending:fixture.critical && !fixture.acked?[critical]:[]}}); }
   fixture.acked = true; return route.fulfill({json:{ok:true}});
  }
  if(u.pathname==='/api/kickoff' && method==='GET') { await sleep(fixture.monthDelay || 0); return route.fulfill({json:kickoff(fixture.blocking,fixture.reminder)}); }
  if(u.pathname==='/api/nexus' && method==='POST') {
   if(fixture.nexusMode==='error') return route.fulfill({status:503,json:{ok:false,message:'Fallo de prueba controlado.'}});
   if(fixture.nexusMode==='offline') return route.abort('internetdisconnected');
   const body = req.postDataJSON();
   fixture.nexusRequests=(fixture.nexusRequests || 0)+1;
   fixture.lastNexusScope={brand:body.brand,domain:body.domain || 'all'};
   if(fixture.nexusMode==='slow') { await sleep(2000); return route.fulfill({json:nexusAnswer(body.brand,body.domain || 'all')}).catch(()=>undefined); }
   return route.fulfill({json:nexusAnswer(body.brand,fixture.nexusDomainMismatch?'all':body.domain || 'all')});
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
 if(caseFilter&&!caseFilter.split(',').some(part=>part&&name.includes(part)))return;
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
async function openAbsoluteTop(run) {
 await navigate(run.page,'/');
 const link=run.page.getByRole('link',{name:'Absolute Top',exact:true}).first();
 if(!(await link.isVisible())) {
  await run.page.getByRole('button',{name:'Abrir navegación'}).click();
  await run.page.getByRole('dialog',{name:'Navegación del monitoreo'}).getByRole('link',{name:'Absolute Top',exact:true}).click();
 } else await link.click();
 await run.page.getByRole('combobox',{name:'Cuenta',exact:true}).waitFor({timeout:10000});
 insist((run.fixture.rscPatches || 0)>0,'The isolated RSC fixture did not supply the dashboard.');
 await run.page.getByRole('button',{name:'Releer auditoría',exact:true}).click();
 await run.page.getByRole('combobox',{name:'Dominio de Google Ads',exact:true}).selectOption('all');
 await run.page.waitForTimeout(100);
}
async function visibleEntities(page,count) {
 await page.getByRole('status').filter({hasText:`${count} de`}).first().waitFor();
 const text=await page.getByRole('status').filter({hasText:/entidades visibles/}).first().textContent();
 insist(text.startsWith(`${count} de`),`Expected ${count} visible fixture entities.`);
}
async function visibleKeyboardFocus(page) {
 return page.evaluate(()=>{const el=document.activeElement,r=el.getBoundingClientRect(),center=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {visible:!!center&&(center===el||el.contains(center)),top:Math.round(r.top),bottom:Math.round(r.bottom)};});
}
async function checkAbsoluteTop() {
 for(const profile of profiles) for(const theme of ['light','dark']) await check(`absolute-top:positive:${profile.width}:${theme}`,async()=>{
  const run=await fresh(profile,theme,{absoluteTop:true});try{
   await openAbsoluteTop(run);await visibleEntities(run.page,8);
   if([390,1440].includes(profile.width)) await run.page.screenshot({path:path.join(out,`absolute-top-${profile.width}-${theme}.png`),fullPage:false});
   const g=await geometry(run.page);insist(g.width<=g.viewport+3,`Absolute Top overflow ${g.width}/${g.viewport}; ${JSON.stringify(g.overflow)}`);
   insist(!g.emptyNames.length&&!g.unlabelledFields.length,'Absolute Top controls lack accessible names.');
   insist(!run.runtimeErrors.length,`Absolute Top runtime error: ${run.runtimeErrors.join('; ')}`);
   insist(!(run.fixture.unexpectedWrites || 0)&&!(run.fixture.externalRequests || 0),'Absolute Top attempted a mutation or external request.');
   insist(await run.page.getByText(/indicador aproximado/).count()>0,'Weighted indicator loses its approximation label.');
   const details=run.page.locator('#absolute-top-details');await details.waitFor();
   insist(await details.getByText('<10%',{exact:true}).count()>0&&await details.getByText('>90%',{exact:true}).count()>0,'Censored shares lose their bounds.');
   insist(await details.getByText('N/D',{exact:true}).count()>0,'Ad-group unavailable metrics are presented as numbers.');
   insist(await details.getByText('120.0%',{exact:true}).count()>0,'CTR above100 was hidden or treated as a bounded impression-share rate.');
   const alternative=profile.width<768?run.page.getByRole('button',{name:'Ver detalle',exact:true}).nth(3):run.page.getByRole('button',{name:'Ver detalle de Grupo ficticio 10201',exact:true});
   await alternative.focus();await run.page.keyboard.press('Enter');await run.page.waitForFunction(()=>document.activeElement?.id==='absolute-top-details');await run.page.keyboard.press('Tab');
   const focus=await visibleKeyboardFocus(run.page);insist(focus.visible,`Details keyboard focus hidden by another element (${focus.top}..${focus.bottom}).`);
   return {geometry:g,rscFixture:true,realProviderData:false,boundsVisible:true,unknownVisible:true,ctrAbove100Visible:true,detailsKeyboardFocusVisible:true};
  }finally{await run.context.close();}
 });
 for(const [width,theme] of [[390,'dark'],[1440,'light']]) await check(`absolute-top:filters-and-details:${width}:${theme}`,async()=>{
  const run=await fresh({width,height:1000},theme,{absoluteTop:true});try{
   await openAbsoluteTop(run);await visibleEntities(run.page,8);
   const field=name=>run.page.getByRole('combobox',{name,exact:true});
   const clear=run.page.getByRole('button',{name:'Limpiar filtros locales',exact:true});
   await field('Cuenta').selectOption('1000000001');await visibleEntities(run.page,3);
   await field('Campaña').selectOption('1000000001:101');await field('Grupo de anuncios').selectOption('1000000001/101/10101');await visibleEntities(run.page,1);
   await field('Cuenta').selectOption('1000000002');await visibleEntities(run.page,2);
   insist(await field('Campaña').inputValue()==='all'&&await field('Grupo de anuncios').inputValue()==='all','Account change retained incompatible campaign/group filters.');
   await clear.click();await field('Nivel').selectOption('ad_group');await visibleEntities(run.page,3);
   await clear.click();await field('Estado').selectOption('below');await visibleEntities(run.page,1);
   await clear.click();await field('Severidad').selectOption('CRITICAL');await visibleEntities(run.page,1);
   await field('Estado').selectOption('meets');await run.page.getByText('No hay entidades que coincidan con estos filtros. No se interpreta como cumplimiento.').waitFor();
   await clear.click();await field('Estado').selectOption('insufficient');await visibleEntities(run.page,2);
   const details=run.page.locator('#absolute-top-details');insist(await details.getByText('N/D',{exact:true}).count()>5,'Missing metrics were rendered as zero.');
   await clear.click();await run.page.getByRole('button',{name:'Dominio → Cuenta → Campaña → Grupo',exact:true}).click();
   const accountSummary=run.page.locator('summary').filter({hasText:'Cuenta ficticia 1'}).first();await accountSummary.focus();await run.page.keyboard.press('Enter');
   const campaignSummary=run.page.locator('summary').filter({hasText:'Campaña ficticia 101'}).first();await campaignSummary.focus();await run.page.keyboard.press('Enter');
   await run.page.getByText('1 grupos fuera del objetivo',{exact:true}).first().waitFor();
   insist(await run.page.getByText('Campaña agregada',{exact:true}).count()>0,'Tree hides the campaign parent when a group fails.');
   await run.page.getByRole('button',{name:'Tabla',exact:true}).click();
   const alternative=width<768?run.page.getByRole('button',{name:'Ver detalle',exact:true}).nth(3):run.page.getByRole('button',{name:'Ver detalle de Grupo ficticio 10201',exact:true});
   await alternative.focus();await run.page.keyboard.press('Enter');await run.page.locator('#absolute-top-details').filter({hasText:'Grupo ficticio 10201'}).waitFor();
   insist((await run.page.locator('#absolute-top-details').getAttribute('aria-label'))==='Detalle de Grupo ficticio 10201','Keyboard selection did not change the details entity.');
   await run.page.waitForFunction(()=>document.activeElement?.id==='absolute-top-details');
   await run.page.keyboard.press('Tab');insist(await run.page.locator('#absolute-top-details').evaluate(el=>el.contains(document.activeElement)),'Keyboard focus returned to the listing instead of the selected details.');
   insist((await visibleKeyboardFocus(run.page)).visible,'Selected detail controls are covered by the topbar.');
   await field('Grupo de anuncios').selectOption('1000000001/101/10101');
   const button=width<768?run.page.getByRole('button',{name:'Ver detalle',exact:true}):run.page.getByRole('button',{name:'Ver detalle de Grupo ficticio 10101',exact:true});
   await button.focus();await run.page.keyboard.press('Enter');await details.waitFor();
   insist(await details.getByRole('img',{name:/Evolución de Abs. Top/}).count()===1,'Details chart lacks a named image.');
   await run.context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('Fixture clipboard unavailable'))},configurable:true}));
   await run.page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('Fixture clipboard unavailable'))},configurable:true}));
   await details.getByRole('button',{name:'Copiar alerta',exact:true}).click();await details.getByRole('status').filter({hasText:/no permitió copiar/}).waitFor();
   const manual=details.getByText('Mensaje para copiar manualmente',{exact:true});await manual.focus();await run.page.keyboard.press('Enter');
   insist(await details.locator('pre').isVisible(),'Clipboard denial has no manual fallback.');
   insist((await details.locator('pre').textContent()).includes('Grupo ficticio 10101'),'Manual alert refers to the wrong selected group.');
   insist(!run.runtimeErrors.length,`Filter/detail runtime error: ${run.runtimeErrors.join('; ')}`);
   insist(!(run.fixture.unexpectedWrites || 0)&&!(run.fixture.externalRequests || 0),'The detail flow attempted a mutation or external request.');
   await run.page.screenshot({path:path.join(out,width===390?'absolute-top-manual-movil.png':'absolute-top-detalle-escritorio.png'),fullPage:false});
   return {filters:6,dependentFiltersReset:true,emptyState:true,unknowns:true,independentGroup:true,keyboardDetail:true,detailsFocus:true,manualClipboard:true,noExternalSend:true};
  }finally{await run.context.close();}
 });
 await check('absolute-top:domain-summary-manual-copy',async()=>{
  const run=await fresh({width:390,height:1000},'dark',{absoluteTop:true});try{
   await openAbsoluteTop(run);
   await run.page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('Fixture clipboard unavailable'))},configurable:true}));
   const first=fixtureConfig.domains[0],copy=run.page.getByRole('button',{name:`Copiar resumen de ${first.name}`,exact:true});await copy.click();
   const manual=run.page.getByRole('textbox',{name:`Resumen manual de ${first.name}`,exact:true});await manual.waitFor();
   insist(await manual.getAttribute('readonly')!==null,'Manual domain summary can be modified as if it were a persisted form.');
   const manualId=await manual.getAttribute('id');insist(!!manualId,'Manual summary lacks a stable labelled control.');await run.page.waitForFunction(id=>document.activeElement?.id===id,manualId);
   const value=await manual.inputValue();insist(value.includes(first.name)&&value.includes('Cuenta ficticia 1'),'Manual summary lacks its domain and account context.');
   insist(!value.includes(fixtureConfig.domains[1].name)&&!value.includes('Cuenta ficticia 3'),'Manual summary leaked another domain.');
   insist(value.includes('N/D')&&value.includes('aproximado')&&value.includes('Grupos de anuncios'),'Manual summary hides unknowns, approximation, or independent groups.');
   await run.page.screenshot({path:path.join(out,'absolute-top-resumen-dominio-manual.png'),fullPage:false});
   await run.page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.resolve()},configurable:true}));await copy.click();
   await run.page.getByRole('status').filter({hasText:'Resumen copiado. El envío queda a tu criterio.'}).first().waitFor();
   insist(!(run.fixture.unexpectedWrites || 0)&&!(run.fixture.externalRequests || 0),'Domain summary copy attempted a mutation or external send.');
   return {domainSummary:true,manualFallback:true,readOnly:true,manualFocus:true,scoped:true,clipboardSuccess:true,noExternalSend:true};
  }finally{await run.context.close();}
 });
 await check('absolute-top:domain-nexus-scope-reset',async()=>{
  const run=await fresh({width:1440,height:1000},'light',{absoluteTop:true});try{
   await openAbsoluteTop(run);
   const domain=run.page.getByRole('combobox',{name:'Dominio de Google Ads',exact:true});await domain.waitFor();
   await domain.selectOption('first_domain');await visibleEntities(run.page,5);
   insist(await domain.inputValue()==='first_domain','Global domain label did not follow its selection.');
   await run.page.getByRole('button',{name:/Abrir Nexus/}).click();const panel=run.page.getByRole('dialog',{name:/Nexus/});await panel.waitFor();
   const question=run.page.getByRole('textbox',{name:'Pregunta para Nexus'});await question.fill('Pregunta ficticia del primer dominio');await question.press('Enter');
   await panel.getByRole('heading',{name:'Respuesta de prueba UX'}).waitFor();
   insist(run.fixture.lastNexusScope.domain==='first_domain','Nexus did not send the selected domain.');
   insist(await panel.getByText(/Alcance: Primer Dominio/).count()>0,'Nexus hides the current domain label.');
   await run.page.keyboard.press('Escape');await run.page.getByRole('combobox',{name:'Cuenta',exact:true}).selectOption('1000000001');await visibleEntities(run.page,3);
   await domain.selectOption('second_domain');await visibleEntities(run.page,1);
   insist(await run.page.getByRole('combobox',{name:'Cuenta',exact:true}).inputValue()==='all','Domain change retained local filters from another domain.');
   await run.page.getByRole('button',{name:/Abrir Nexus/}).click();const reset=run.page.getByRole('dialog',{name:/Nexus/});await reset.waitFor();
   insist(await reset.getByText('Pregunta ficticia del primer dominio',{exact:true}).count()===0,'Nexus retained conversation from another domain.');
   run.fixture.nexusDomainMismatch=true;await question.fill('Pregunta ficticia del segundo dominio');await question.press('Enter');await reset.getByRole('alert').filter({hasText:/alcance/}).waitFor();
   insist(await reset.getByRole('heading',{name:'Respuesta de prueba UX'}).count()===0,'Nexus displayed an answer from a different domain.');
   const focusEdge=async(last)=>reset.evaluate((el,last)=>{const fields=[...el.querySelectorAll('button:not([disabled]),a[href],textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter(field=>field.tabIndex>=0&&field.getBoundingClientRect().width&&field.getBoundingClientRect().height&&getComputedStyle(field).visibility!=='hidden');(last?fields.at(-1):fields[0]).focus();return fields.length;},last);
   const atEdge=async(last)=>reset.evaluate((el,last)=>{const fields=[...el.querySelectorAll('button:not([disabled]),a[href],textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter(field=>field.tabIndex>=0&&field.getBoundingClientRect().width&&field.getBoundingClientRect().height&&getComputedStyle(field).visibility!=='hidden');return (last?fields.at(-1):fields[0])===document.activeElement;},last);
   insist(await focusEdge(true)>1,'Nexus lacks a meaningful keyboard focus cycle.');await run.page.keyboard.press('Tab');insist(await atEdge(false),'Nexus did not wrap Tab from last to first.');
   await run.page.keyboard.press('Shift+Tab');insist(await atEdge(true),'Nexus did not wrap Shift+Tab from first to last.');
   await run.page.screenshot({path:path.join(out,'absolute-top-nexus-alcance.png'),fullPage:false});
   await run.page.keyboard.press('Escape');insist(await run.page.getByRole('button',{name:/Abrir Nexus/}).evaluate(el=>el===document.activeElement),'Nexus domain dialog did not restore focus.');
   insist(!(run.fixture.unexpectedWrites || 0)&&!(run.fixture.externalRequests || 0),'Domain/Nexus flow attempted another mutation or an external request.');
   return {domainFixture:true,scopeSent:true,conversationReset:true,localFiltersReset:true,foreignAnswerBlocked:true,keyboardDialog:true,focusWrapBothDirections:true,serverCookieNotValidated:true};
  }finally{await run.context.close();}
 });
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const preflight = await fetch(base+'/api/health').then(r=>r.json());
 insist(preflight.mode==='mock','The target must be an isolated mock demo.');
 insist(!preflight.integrations?.n8n&&!preflight.integrations?.whatsapp,'Demo webhooks and WhatsApp must be disabled.');
 browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const demoGuard=await fresh();try{await navigate(demoGuard.page,'/api/health');await changeRole(demoGuard.page,'admin');}finally{await demoGuard.context.close();}
  await checkAbsoluteTop();
  for(const profile of profiles) for(const theme of ['light','dark']) {
   const run = await fresh(profile,theme);
   try {
    for(const route of absoluteOnly?['/absolute-top']:routes) await check(`page:${route}:${profile.width}:${theme}`,async()=>{
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
  if(!absoluteOnly) {
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
    const brandResponse=run.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/brand'&&response.request().method()==='POST');
    await run.page.getByRole('radio',{name:'Sky',exact:true}).click();insist((await brandResponse).status()===200,'Demo brand change was rejected.');
    await run.page.waitForFunction(()=>[...document.querySelectorAll('[role=radio]')].some(el=>el.textContent.trim()==='Sky'&&el.getAttribute('aria-checked')==='true'));
    await run.page.getByRole('button',{name:/Abrir Nexus/}).click();
    const resetPanel=run.page.getByRole('dialog',{name:/Nexus/});await resetPanel.getByText(/marca Sky seleccionada/).waitFor();insist(await resetPanel.getByText('Prueba antes de cambiar marca',{exact:true}).count()===0,'Conversation leaked across brand reset.');
    await textarea.fill('Pregunta ficticia después de cambiar marca');await textarea.press('Enter');await resetPanel.getByRole('heading',{name:'Respuesta de prueba UX'}).waitFor();
    insist(run.fixture.lastNexusScope.brand==='sky'&&run.fixture.lastNexusScope.domain==='all','Nexus sent a stale brand or domain after changing the brand.');
    return {error:true,retry:true,cancel:true,clearConversation:true,focusRestored:true,brandReset:true,newRequestScopeVerified:true};
   }finally{await run.context.close();}
  });
  await check('forms:settings-and-fx-offline-retain-drafts',async()=>{
   const run=await fresh({width:390,height:844},'light',{offlineWrites:true});try{
    await navigate(run.page,'/settings');const first=run.page.locator('main input[type=number]').first();const previous=await first.inputValue();await first.fill(String(Number(previous)+1));const save=run.page.getByRole('button',{name:'Guardar cambios',exact:true});await save.click();await run.page.waitForTimeout(500);insist(await first.inputValue()===String(Number(previous)+1),'Settings draft lost on offline save.');insist(await save.isEnabled(),'Settings save remained disabled after error.');insist(await run.page.getByText(/No se pudo guardar/).count()>0,'Settings missing offline feedback.');
    await navigate(run.page,'/tipo-de-cambio');const rate=run.page.getByRole('textbox',{name:/Tasa de/}).first();await rate.fill('18.45');await rate.locator('xpath=ancestor::tr').getByRole('button',{name:'Guardar',exact:true}).click();await run.page.waitForTimeout(500);insist(await rate.inputValue()==='18.45','FX draft lost on offline save.');insist(await run.page.getByText(/No se pudo guardar/).count()>0,'FX missing offline feedback.');
    return {settingsDraft:true,fxDraft:true,requestsIntercepted:true};
   }finally{await run.context.close();}
  });
  }
 } finally {if(browser)await browser.close();}
 const failures=results.filter(r=>!r.ok);
 const categories=Object.fromEntries([...new Set(results.map(r=>r.name.split(':')[0]))].map(category=>[category,{cases:results.filter(r=>r.name.startsWith(category+':')).length,failed:results.filter(r=>r.name.startsWith(category+':')&&!r.ok).length}]));
 const summary={categories,generatedAt:new Date().toISOString(),base:parsed.origin,mode:'mock',profiles,themes:['light','dark'],cases:results.length,passed:results.length-failures.length,failed:failures.length,failures,mutationCounts,fixtureMethod:'Synthetic RSC dashboard and browser-intercepted domain/Nexus responses; server domain cookies and Google data are not validated.',caseFilter:caseFilter || null,fullMatrix:!caseFilter&&!quick&&!absoluteOnly,configuredRouteCount:absoluteOnly?1:routes.length,routeCount:new Set(results.filter(row=>row.name.startsWith('page:')).map(row=>row.name.split(':')[1])).size,limits:['Positive Absolute Top data are synthetic fixtures; no real Ads Manager coverage is certified.','Domain selection in positive browser fixtures does not validate server cookie persistence.','Browser fixtures do not validate real platform credentials or data reconciliation.','Permission checks exercise demo roles, not real nominal-account credentials.','Geometry/name checks and keyboard tests do not establish full WCAG certification or real screen-reader behavior.','No mutations persisted; role and brand changes are browser-local demo cookies.']};
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({cases:summary.cases,passed:summary.passed,failed:summary.failed,out}));if(failures.length)process.exitCode=1;
})().catch(error=>{escapedErrors.push(safe(error.message));fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'fatal.json'),JSON.stringify({errors:escapedErrors},null,2));console.error(safe(error.message));process.exitCode=1;});
