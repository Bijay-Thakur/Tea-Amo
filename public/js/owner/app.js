const LEGACY_KEY='teaAmoReadyV1';
const $=id=>document.getElementById(id);
const clone=x=>structuredClone(x);
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function debounce(fn,ms=100){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
function freshState(){return{version:1,schemaVersion:3,menuCatalogVersion:MENU_CATALOG_VERSION,setup:false,passwordAuth:null,business:{name:'TEA AMO',branch:'Main Branch',currency:'Rs',taxRate:0,payment_qr:{eSewa:'',Khalti:'',Fonepay:''}},passwordHash:'',menu:clone(MENU_SEED),ingredients:clone(INGREDIENT_SEED),recipes:clone(RECIPE_SEED),staff:[],attendance:[],bills:[],vendors:[],purchases:[],waste:[],expenses:[],customers:[],complaints:[],accountTransfers:[],inventoryLog:[],businessDays:[],auditLog:[],cart:[],dailyBusinessReports:[],dashboardBaseline:null,tables:clone(DEFAULT_TABLES),tableOrders:{},floorLayoutVersion:'TEA-AMO-FLOOR-1'}}
let state=freshState();
let activeSection='dashboard',activeInvTab='stock',editingIngredientKey=null,lastPaidBill=null;
const index={menu:new Map(),ingredients:new Map(),vendors:new Map(),customers:new Map(),recipeCost:new Map()};
function rebuildIndex(){index.menu=new Map(state.menu.map(x=>[x.id,x]));index.ingredients=new Map(state.ingredients.map(x=>[x.key,x]));index.vendors=new Map(state.vendors.map(x=>[x.id,x]));index.customers=new Map(state.customers.map(x=>[x.id,x]));index.recipeCost.clear()}
function repairState(s){
  s=s&&typeof s==='object'?s:freshState();
  const f=freshState();
  s.version=1;s.schemaVersion=3;s.passwordAuth=s.passwordAuth||null;s.business={...f.business,...(s.business||{})};s.business.payment_qr={...f.business.payment_qr,...(s.business.payment_qr||{})};for(const k of ['eSewa','Khalti','Fonepay'])if(!s.business.payment_qr[k])s.business.payment_qr[k]=f.business.payment_qr[k];s.setup=!!s.setup;s.passwordHash=s.passwordHash||'';
  // Self-heal menu by stable name while preserving edited price/active.
  // One-time menu migration. After this catalog is installed, the saved menu is authoritative.
  // Never rebuild or trim the owner's menu during startup/repair.
  const knownPreFinalCatalogs=new Set([undefined,null,"","2026-10-06-photo-menu-v1"]);
  if(knownPreFinalCatalogs.has(s.menuCatalogVersion)){
    // One-time migration to the exact handwritten menu supplied by the owner.
    // After this migration, the saved menu is authoritative and is never reseeded automatically.
    s.menu=clone(MENU_SEED);
    s.menuCatalogVersion=MENU_CATALOG_VERSION;
  }else if(!Array.isArray(s.menu)){
    s.menu=clone(MENU_SEED);
    s.menuCatalogVersion=MENU_CATALOG_VERSION;
  }else{
    s.menu=s.menu.filter(x=>x&&typeof x==='object').map((x,i)=>({
      ...x,
      id:x.id??`menu-${Date.now()}-${i}`,
      name:String(x.name||'').trim(),
      category:String(x.category||'Menu').trim()||'Menu',
      price:x.price==null?null:Number(x.price),
      active:x.active!==false
    })).filter(x=>x.name);
  }
  // Self-heal ingredients by normalized name/key, preserving stock and setup values.
  const oldIng=Array.isArray(s.ingredients)?s.ingredients:[];
  const oldIngByName=new Map(oldIng.map(i=>[String(i.name||'').toLowerCase(),i]));
  s.ingredients=INGREDIENT_SEED.map(seed=>{
    let old=oldIngByName.get(seed.name.toLowerCase())||oldIng.find(i=>i.key===seed.key)||{};
    return {...seed,...old,key:seed.key,name:seed.name,unit:old.unit||seed.unit,stock:Number(old.stock||0),avg_cost:Number(old.avg_cost||0),reorder:Number(old.reorder||0),target:Number(old.target??old.reorder??0),active:old.active!==false};
  });
  // Keep custom ingredients too.
  const seedNames=new Set(s.ingredients.map(i=>i.name.toLowerCase()));
  oldIng.forEach(i=>{if(i.name&&!seedNames.has(i.name.toLowerCase()))s.ingredients.push({key:i.key||slugKey(i.name),name:i.name,unit:i.unit||'g',stock:Number(i.stock||0),avg_cost:Number(i.avg_cost||0),reorder:Number(i.reorder||0),target:Number(i.target||0),shelf_life_days:Number(i.shelf_life_days||0),preferred_vendor_id:i.preferred_vendor_id||null,notes:i.notes||'',active:i.active!==false})});
  // Always guarantee complete standard recipes. Preserve valid user recipe edits when stored in new format.
  s.recipes=s.recipes&&typeof s.recipes==='object'?s.recipes:{};
  for(const [name,seedRecipe] of Object.entries(RECIPE_SEED)){
    const r=Array.isArray(s.recipes[name])?s.recipes[name]:seedRecipe;
    s.recipes[name]=r.filter(x=>x&&x.ingredient_key&&Number.isFinite(Number(x.qty))).map(x=>({ingredient_key:x.ingredient_key,qty:Number(x.qty)}));
    if(!s.recipes[name].length)s.recipes[name]=clone(seedRecipe);
  }
  for(const k of ['staff','attendance','bills','vendors','purchases','waste','expenses','customers','complaints','accountTransfers','inventoryLog','businessDays','auditLog','cart','ownerCapital','dailyBusinessReports'])if(!Array.isArray(s[k]))s[k]=[];
  s.menu.forEach(m=>{if(!Array.isArray(s.recipes[m.name]))s.recipes[m.name]=[]});
  s.ingredients.forEach(i=>{if(!['kitchen','bar'].includes(i.location))i.location=guessInventoryLocation(i.name)});
  if(!s.dashboardBaseline||typeof s.dashboardBaseline!=='object')s.dashboardBaseline=null;
  s.staff=(s.staff||[]).map(st=>({
    ...st,
    phone:st.phone||'',
    email:st.email||'',
    address:st.address||'',
    emergency_name:st.emergency_name||'',
    emergency_relation:st.emergency_relation||'',
    emergency_phone:st.emergency_phone||'',
    notes:st.notes||'',
    order_pin:st.order_pin||'',
    can_take_orders:!!st.can_take_orders
  }));
  if(!s.tableOrders||typeof s.tableOrders!=='object'||Array.isArray(s.tableOrders))s.tableOrders={};
  if(s.floorLayoutVersion!=='TEA-AMO-FLOOR-1'){
    const oldTables=Array.isArray(s.tables)?s.tables:[],oldOrders=s.tableOrders||{},migratedOrders={},oldByNumber=new Map();
    oldTables.forEach(t=>{const mm=String(t.name||'').match(/(?:Table\s*)?(\d+)/i);if(mm)oldByNumber.set(Number(mm[1]),t)});
    const rebuilt=clone(DEFAULT_TABLES).map(t=>{const num=Number(String(t.name).replace(/\D/g,'')),old=num?oldByNumber.get(num):null;if(old){if(oldOrders[old.id])migratedOrders[t.id]=oldOrders[old.id];return{...t,seats:Math.max(1,Number(old.seats||t.seats)),active:old.active!==false,attention:!!old.attention,reservation:old.reservation||null}}return t});
    ['A','B','C','D'].forEach(letter=>{const old=oldTables.find(x=>String(x.name||'').toUpperCase()===letter),target=rebuilt.find(x=>x.name===letter);if(old&&target){target.seats=Math.max(1,Number(old.seats||target.seats));target.active=old.active!==false;target.attention=!!old.attention;target.reservation=old.reservation||null;if(oldOrders[old.id])migratedOrders[target.id]=oldOrders[old.id]}});
    s.tables=rebuilt;s.tableOrders=migratedOrders;s.floorLayoutVersion='TEA-AMO-FLOOR-1';
  }else{
    const existing=new Map((Array.isArray(s.tables)?s.tables:[]).map(t=>[t.id,t]));
    s.tables=DEFAULT_TABLES.map(seed=>({...seed,...(existing.get(seed.id)||{}),x:seed.x,y:seed.y,w:seed.w,h:seed.h,kind:seed.kind,name:seed.name}));
  }
  return s;
}
function slugKey(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'item'}
function legacyToNew(old){
  const n=freshState();if(!old||typeof old!=='object')return n;
  for(const k of ['setup','passwordHash','passwordAuth','staff','attendance','bills','vendors','expenses','customers','businessDays','auditLog','cart','tables','tableOrders','dailyBusinessReports'])if(old[k]!=null)n[k]=clone(old[k]);if(old.dashboardBaseline)n.dashboardBaseline=clone(old.dashboardBaseline);if(old.floorLayoutVersion)n.floorLayoutVersion=old.floorLayoutVersion;
  if(old.business)n.business={...n.business,...old.business};
  if(Array.isArray(old.menu)){n.menu=clone(old.menu);n.menuCatalogVersion=old.menuCatalogVersion||''}
  const oldIdToKey=new Map();
  if(Array.isArray(old.ingredients)){
    const byName=new Map(old.ingredients.map(x=>[String(x.name||'').toLowerCase(),x]));
    n.ingredients=n.ingredients.map(i=>{let o=byName.get(i.name.toLowerCase())||{};if(o.id!=null)oldIdToKey.set(o.id,i.key);return{...i,stock:Number(o.stock||0),avg_cost:Number(o.avg_cost||0),reorder:Number(o.reorder||0),target:Number(o.target??o.reorder??0),shelf_life_days:Number(o.shelf_life_days||0),preferred_vendor_id:o.preferred_vendor_id||null,notes:o.notes||'',active:o.active!==false}});
  }
  n.inventoryLog=(old.inventoryLog||[]).map(x=>({...x,ingredient_key:x.ingredient_key||oldIdToKey.get(x.ingredient_id)||''}));
  n.purchases=(old.purchases||[]).map(x=>({...x,ingredient_key:x.ingredient_key||oldIdToKey.get(x.ingredient_id)||''}));
  n.waste=(old.waste||[]).map(x=>({...x,ingredient_key:x.ingredient_key||oldIdToKey.get(x.ingredient_id)||''}));
  return n;
}

const LAN_ENABLED=location.protocol==='http:'||location.protocol==='https:';
let lanOnline=false,lanPollTimer=null,lanPushTimers={},lanApplyingRemote=false,lanPullInFlight=false;

async function lanFetch(path,opts={}){
  if(!LAN_ENABLED)throw new Error('LAN server not active');
  const headers={'Content-Type':'application/json',...(opts.headers||{})};
  const r=await fetch(path,{...opts,headers,cache:'no-store'});
  if(!r.ok)throw new Error(`LAN ${r.status}`);
  return r.status===204?null:r.json()
}
async function updateLanUI(){
  const status=$('lanSyncStatus'),detail=$('lanSyncDetail'),url=$('lanStaffUrl');
  if(!LAN_ENABLED){
    if(status){status.textContent='NOT CONNECTED';status.className='bad'}
    if(detail)detail.textContent='Start RUN_TEA_AMO_SERVER.bat and use the browser page it opens automatically.';
    if(url)url.textContent='—';
    return
  }
  try{
    const r=await fetch('/api/network',{cache:'no-store'});if(!r.ok)throw new Error('network');
    const d=await r.json(),staffUrl=(d.staff_urls||[])[0]||'';
    if(status){status.textContent=lanOnline?'CONNECTED':'SERVER RUNNING';status.className=lanOnline?'good':'warn'}
    if(detail)detail.textContent=lanOnline?'Shared table orders are syncing with staff phones.':'Server is running. Press Sync Menu, Tables & Staff Access.';
    if(url)url.textContent=staffUrl||'Wi-Fi IP not detected — connect laptop to cafe Wi-Fi and restart server';
  }catch{
    if(status){status.textContent='NOT CONNECTED';status.className='bad'}
    if(detail)detail.textContent='Start RUN_TEA_AMO_SERVER.bat and use the POS browser page that opens automatically.';
    if(url)url.textContent='—';
  }
}
async function pushLanConfig(){
  if(!LAN_ENABLED)return false;
  try{
    let pinMigrated=false;const enabledStaff=[];
    for(const st of state.staff.filter(s=>s.can_take_orders)){
      const hadHash=!!st.order_pin_hash;
      if(await ensureStaffOrderPinCredential(st)){
        if(!hadHash)pinMigrated=true;
        enabledStaff.push({id:st.id,name:st.name,role:st.role,pin_hash:st.order_pin_hash,pin_salt:st.order_pin_salt,pin_iterations:Number(st.order_pin_iterations||120000),enabled:true});
      }
    }
    if(pinMigrated)await persistNow('staff_pin_migration');
    const payload={
      business:{name:state.business.name,branch:state.business.branch,currency:state.business.currency,taxRate:Number(state.business.taxRate||0),payment_qr:state.business.payment_qr||{},payment_methods:(state.business.payment_methods||[]).map(x=>typeof x==='string'?{name:x,kind:'other'}:{name:x.name,kind:x.kind||'other'})},
      tables:state.tables.filter(t=>t.active).map(t=>({id:t.id,name:t.name,seats:t.seats,x:t.x,y:t.y,w:t.w,h:t.h,kind:t.kind,active:t.active})),
      menu:state.menu.filter(m=>m.active!==false).map(m=>({id:m.id,name:m.name,category:m.category,price:m.price,active:m.active!==false})),
      staff:enabledStaff
    };
    await lanFetch('/api/admin/config',{method:'POST',body:JSON.stringify(payload)});
    lanOnline=true;updateLanUI();return true
  }catch(e){console.error('LAN config sync failed',e);lanOnline=false;updateLanUI();return false}
}

function calcOrderSnapshot(order){
  let subtotal=0;for(const row of(order?.cart||[])){const m=menuItem(row.id);if(m)subtotal+=Number(m.price||0)*Number(row.qty||0)}
  const v=Math.max(0,Number(order?.discountValue||0)),discount=order?.discountType==='amount'?Math.min(v,subtotal):subtotal*Math.min(v,100)/100,tax=(subtotal-discount)*Number(state.business.taxRate||0)/100;
  return{subtotal,discount,tax,total:subtotal-discount+tax}
}
async function processStaffCompletion(req){
  if(!req||state.bills.some(b=>b.source_completion_id===req.id))return;
  const t=tableById(req.table_id),order=req.order||{},cart=order.cart||[];if(!t||!cart.length)return;
  // Staff completion belongs to the day/time it was submitted from the phone, not whatever day the owner happens to be viewing later.
  const completionTime=req.created_at||new Date().toISOString(),staffBusinessDay=realBusinessDayKey(new Date(completionTime));
  if(dayRecord(staffBusinessDay).finalized){console.warn('Staff completion held because business day is finalized',req.id,staffBusinessDay);return}
  const snapshot=clone(state),c=calcOrderSnapshot(order),id=newReceiptId(),items=[];
  for(const row of cart){const m=menuItem(row.id),q=Number(row.qty||0);if(!m||!q)continue;items.push({id:m.id,name:m.name,price:m.price,qty:q,served_qty:Number(row.served||0),cogs:recipeCost(m)*q});deductRecipe(m,q,id)}
  if(!items.length)return;
  const bill={id,time:completionTime,businessDay:staffBusinessDay,type:'Dine-in',ref:t.name,table_id:t.id,guest_count:Math.max(1,Number(order.guestCount||1)),payment:req.payment||'Cash',customer_id:null,items,subtotal:c.subtotal,discount:c.discount,tax:c.tax,total:c.total,cogs:items.reduce((s,x)=>s+x.cogs,0),source_completion_id:req.id,completed_by_staff:req.staff_name||'Staff'};
  state.bills.unshift(bill);delete state.tableOrders[t.id];t.attention=false;t.reservation=null;audit('staff_sale_completed',`${bill.id} ${t.name}`);await persistOrRollback(snapshot,'staff_completion');
  try{await lanFetch(`/api/admin/completions/${encodeURIComponent(req.id)}/ack`,{method:'POST',body:'{}'})}catch{}
  // Remove the completed LAN order so a phone cannot reopen stale items and accidentally submit them twice.
  try{await deleteLanOrder(t.id)}catch{}
  if(activeSection==='pos')renderPOS();if(activeSection==='dashboard')renderDashboard();if(activeSection==='reports')renderReports()
}

async function pullLanOrders(force=false){
  if(!LAN_ENABLED||lanApplyingRemote||lanPullInFlight)return false;lanPullInFlight=true;
  try{const data=await lanFetch('/api/admin/orders');lanOnline=true;for(const req of(data.completions||[])){try{await processStaffCompletion(req)}catch(err){console.error('Staff completion processing failed',err)}}
    const remote=data.orders||{},changed=[];lanApplyingRemote=true;
    for(const t of state.tables){const ro=remote[t.id],lo=state.tableOrders[t.id];if(!ro||lanPushTimers[t.id])continue;const rv=Number(ro.version||0),lv=Number(lo?._lan_version||0);if(rv>lv){state.tableOrders[t.id]={...ro.order,_lan_version:rv,_lan_updated_by:ro.updated_by||''};t.attention=!!ro.attention;changed.push(t.id)}}
    lanApplyingRemote=false;if(changed.length){await dbPutLocal(state);if(activeSection==='pos'){if(activeTableId)renderPOSWorkspace();else renderTableFloor()}else if(activeSection==='dashboard')renderDashboard()}updateLanUI();return true
  }catch(e){lanApplyingRemote=false;lanOnline=false;updateLanUI();return false}finally{lanPullInFlight=false}
}
function queueLanOrderPush(tableId){
  if(!LAN_ENABLED||!tableId||tableId==='counter'||lanApplyingRemote)return;
  clearTimeout(lanPushTimers[tableId]);lanPushTimers[tableId]=setTimeout(()=>pushLanOrder(tableId),90)
}
async function pushLanOrder(tableId){
  if(!LAN_ENABLED||!tableId||tableId==='counter')return;
  const t=tableById(tableId),o=state.tableOrders[tableId];if(!t)return;
  try{
    if(!o||!Array.isArray(o.cart)||!o.cart.length)await lanFetch(`/api/admin/orders/${encodeURIComponent(tableId)}`,{method:'DELETE'});
    else{
      const clean={...o};delete clean._lan_version;delete clean._lan_updated_by;
      const result=await lanFetch(`/api/admin/orders/${encodeURIComponent(tableId)}`,{method:'PUT',body:JSON.stringify({order:clean,attention:!!t.attention})});
      if(result?.version)o._lan_version=result.version
    }
    lanOnline=true;updateLanUI()
  }catch(e){lanOnline=false;updateLanUI()}
}

async function pushLanAttention(tableId){
  if(!LAN_ENABLED||!tableId)return;
  const t=tableById(tableId);if(!t)return;
  try{
    const o=state.tableOrders[tableId]||{cart:[],openedAt:null,customerId:null,discountType:'percent',discountValue:0,orderRef:t.name,orderType:'Dine-in'};
    const clean={...o};delete clean._lan_version;delete clean._lan_updated_by;
    const r=await lanFetch(`/api/admin/orders/${encodeURIComponent(tableId)}`,{method:'PUT',body:JSON.stringify({order:clean,attention:!!t.attention})});
    if(state.tableOrders[tableId]&&r?.version)state.tableOrders[tableId]._lan_version=r.version;
    lanOnline=true;updateLanUI()
  }catch{lanOnline=false;updateLanUI()}
}

async function deleteLanOrder(tableId){
  if(!LAN_ENABLED||!tableId)return;
  try{await lanFetch(`/api/admin/orders/${encodeURIComponent(tableId)}`,{method:'DELETE'});lanOnline=true}catch{lanOnline=false}
  updateLanUI()
}
function startLanPolling(){if(!LAN_ENABLED)return;clearInterval(lanPollTimer);pushLanConfig();pullLanOrders(true);lanPollTimer=setInterval(()=>{if(document.visibilityState==='visible')pullLanOrders()},2000);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')pullLanOrders(true)})}

async function serverStateGet(){
  if(!LAN_ENABLED)return null;
  try{const r=await fetch('/api/admin/state',{cache:'no-store'});if(!r.ok)return null;const d=await r.json();return d&&d.state?d.state:null}catch{return null}
}
async function serverStatePut(data){
  if(!LAN_ENABLED)return false;
  try{const r=await fetch('/api/admin/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:data})});return r.ok}catch{return false}
}
function openDB(){return new Promise((resolve,reject)=>{if(!('indexedDB'in window))return reject(new Error('IndexedDB unavailable'));const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('snapshots'))db.createObjectStore('snapshots')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function dbGet(){try{const db=await openDB();return await new Promise((res,rej)=>{const tx=db.transaction('snapshots','readonly'),r=tx.objectStore('snapshots').get(SNAPSHOT_KEY);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)})}catch{return null}}
async function dbPutLocal(data){try{const db=await openDB();await new Promise((res,rej)=>{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(data,SNAPSHOT_KEY);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)});return true}catch{try{localStorage.setItem(DB_NAME,JSON.stringify(data));return true}catch{return false}}}
async function dbPut(data){const localOk=await dbPutLocal(data);const serverOk=await serverStatePut(data);return !!(localOk||serverOk)}
let saveTimer=null,savePending=false;
function saveSoon(){savePending=true;clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,120)}
async function saveNow(){clearTimeout(saveTimer);saveTimer=null;if(!savePending)return;savePending=false;state.stateUpdatedAt=new Date().toISOString();await dbPut(state)}

async function persistNow(reason=''){
  let localOk=false,idbOk=false,serverOk=false;
  state.stateUpdatedAt=new Date().toISOString();
  try{localStorage.setItem(DB_NAME,JSON.stringify(state));localOk=true}catch(err){console.error('localStorage backup failed',reason,err)}
  try{idbOk=await dbPutLocal(state)}catch(err){console.error('IndexedDB save failed',reason,err)}
  try{serverOk=await serverStatePut(state)}catch(err){console.error('Server master-state save failed',reason,err)}
  const ok=!!(localOk||idbOk||serverOk);
  if(!ok)console.error('CRITICAL: no durable copy was written.',reason);
  if(LAN_ENABLED&&!serverOk)console.warn('Server master-state copy was not written; local browser copy retained.',reason);
  return ok
}
async function persistOrRollback(snapshot,reason){
  const ok=await persistNow(reason);
  if(ok)return true;
  state=snapshot;rebuildIndex();
  throw new Error('The transaction could not be saved. All in-memory changes were rolled back. No receipt was issued.')
}
function setActionStatus(msg,kind='good'){
  const el=$('actionStatus');if(!el)return;
  el.className=`notice ${kind==='bad'?'bad':kind==='warn'?'warn':'good'}`;
  el.textContent=msg;
}

function audit(action,detail=''){state.auditLog.unshift({time:new Date().toISOString(),action,detail,businessDay:businessDayKey()});if(state.auditLog.length>20000)state.auditLog.length=20000}
function nptParts(d=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kathmandu',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d);const o={};parts.forEach(p=>o[p.type]=p.value);return{y:+o.year,m:+o.month,d:+o.day,h:+o.hour,min:+o.minute,s:+o.second}}
function businessDayKey(d=new Date()){const p=nptParts(d),base=new Date(Date.UTC(p.y,p.m-1,p.d));if(p.h<7)base.setUTCDate(base.getUTCDate()-1);return base.toISOString().slice(0,10)}
function isCafeOpen(d=new Date()){const p=nptParts(d);return p.h>=7&&p.h<21}
function nptDateTime(v=new Date()){return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kathmandu',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v))}
function inBusinessDay(ts,key){return businessDayKey(new Date(ts))===key}
function sameMonth(ts){const a=nptParts(new Date(ts)),b=nptParts();return a.y===b.y&&a.m===b.m}
function rs(n){return`${state.business.currency||'Rs'} ${Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2})}`}
async function hashText(t){const b=new TextEncoder().encode(t);const h=await crypto.subtle.digest('SHA-256',b);return[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function bytesToB64(bytes){let x='';bytes.forEach(b=>x+=String.fromCharCode(b));return btoa(x)}
function b64ToBytes(x){return Uint8Array.from(atob(x),c=>c.charCodeAt(0))}
async function deriveOwnerPassword(password,saltB64,iterations=210000){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:b64ToBytes(saltB64),iterations,hash:'SHA-256'},key,256);return bytesToB64(new Uint8Array(bits))}
async function setOwnerPassword(password){if(String(password).length<8)throw new Error('Owner password must be at least 8 characters.');const salt=crypto.getRandomValues(new Uint8Array(16)),saltB64=bytesToB64(salt),iterations=210000,hash=await deriveOwnerPassword(password,saltB64,iterations);state.passwordAuth={algorithm:'PBKDF2-SHA256',iterations,salt:saltB64,hash};state.passwordHash='';return true}
async function verifyOwnerPassword(password){if(state.passwordAuth?.hash&&state.passwordAuth?.salt){const got=await deriveOwnerPassword(String(password),state.passwordAuth.salt,Number(state.passwordAuth.iterations||210000));return got===state.passwordAuth.hash}if(state.passwordHash){const ok=await hashText(String(password))===state.passwordHash;if(ok&&String(password).length>=8){try{await setOwnerPassword(password);await persistNow('password_hash_upgrade')}catch{}}return ok}return false}
async function setStaffOrderPinCredential(staff,pin){const salt=crypto.getRandomValues(new Uint8Array(16)),saltB64=bytesToB64(salt),iterations=120000,hash=await deriveOwnerPassword(String(pin),saltB64,iterations);staff.order_pin_hash=hash;staff.order_pin_salt=saltB64;staff.order_pin_iterations=iterations;staff.order_pin='';return staff}
async function ensureStaffOrderPinCredential(staff){if(staff.order_pin_hash&&staff.order_pin_salt)return true;const legacy=String(staff.order_pin||'');if(!/^\d{4,6}$/.test(legacy))return false;await setStaffOrderPinCredential(staff,legacy);return true}
function newId(prefix='ID'){if(crypto.randomUUID)return `${prefix}-${crypto.randomUUID()}`;return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`}
function newReceiptId(){const d=businessDayKey().replaceAll('-','');const tail=(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)).replaceAll('-','').slice(0,8).toUpperCase();return `TA-${d}-${tail}`}
function validateBackupPayload(x){if(!x||typeof x!=='object'||Array.isArray(x))throw new Error('Backup root must be an object.');for(const k of ['business','menu','ingredients','staff','bills','businessDays'])if(x[k]==null)throw new Error(`Backup is missing required field: ${k}`);if(!Array.isArray(x.menu)||!Array.isArray(x.ingredients)||!Array.isArray(x.bills))throw new Error('Backup contains invalid collection types.');return true}
function downloadSafetyBackup(label='SAFETY'){try{download(`TEA_AMO_${label}_${businessDayKey()}_${Date.now()}.json`,JSON.stringify(state,null,2));return true}catch(e){console.error('Safety backup failed',e);return false}}

function ingredient(key){return index.ingredients.get(key)}
function menuItem(id){return index.menu.get(id)}
function recipeFor(m){return state.recipes[m.name]||[]}
function recipeCost(m){if(index.recipeCost.has(m.id))return index.recipeCost.get(m.id);let v=recipeFor(m).reduce((s,r)=>s+(ingredient(r.ingredient_key)?.avg_cost||0)*r.qty,0);index.recipeCost.set(m.id,v);return v}
function canMake(m,qty=1){return recipeFor(m).every(r=>(ingredient(r.ingredient_key)?.stock??0)>=r.qty*qty)}
function dayRecord(key=businessDayKey()){let r=state.businessDays.find(x=>x.key===key);if(!r){r={key,openingCash:0,openingCashSet:false,finalized:false,finalizedAt:null,actualCash:null,note:''};state.businessDays.unshift(r)}return r}
function dayBills(key=businessDayKey()){return state.bills.filter(b=>inBusinessDay(b.time,key))}
function daySummary(key=businessDayKey()){const bills=dayBills(key),rec=dayRecord(key);let payMethods={};bills.forEach(b=>payMethods[b.payment]=(payMethods[b.payment]||0)+b.total);const expenses=state.expenses.filter(e=>(e.businessDay||e.date)===key),purchases=state.purchases.filter(p=>(p.businessDay||businessDayKey(new Date(p.time)))===key),waste=state.waste.filter(w=>(w.businessDay||businessDayKey(new Date(w.time)))===key);const gross=bills.reduce((s,b)=>s+b.subtotal,0),discount=bills.reduce((s,b)=>s+b.discount,0),tax=bills.reduce((s,b)=>s+b.tax,0),sales=bills.reduce((s,b)=>s+b.total,0),cogs=bills.reduce((s,b)=>s+(b.cogs||0),0),cashSales=payMethods.Cash||0,cashExpenses=expenses.filter(e=>e.payment==='Cash').reduce((s,e)=>s+e.amount,0),cashPurchases=purchases.filter(p=>p.payment==='Cash').reduce((s,p)=>s+p.total_cost,0),expectedCash=(rec.openingCash||0)+cashSales-cashExpenses-cashPurchases;return{key,rec,bills,orders:bills.length,gross,discount,tax,sales,cogs,payMethods,cashSales,cashExpenses,cashPurchases,expectedCash,expenses:expenses.reduce((s,e)=>s+e.amount,0),purchases:purchases.reduce((s,p)=>s+p.total_cost,0),waste:waste.reduce((s,w)=>s+w.cost,0)}}
function posAllowed(){return isCafeOpen()&&!dayRecord().finalized}
function markDataChanged(...views){index.recipeCost.clear();saveSoon();if(views.includes(activeSection)||views.includes('all'))renderActive()}

// ===== DAILY BUSINESS REPORT =====
let dailyReportSelectedDate=null;
let dailyCalendarCursor=null;
const DR_NUMERIC_IDS=['drTotalSales','drTotalOrders','drOpeningCash','drClosingCash','drNonChargeOrders','drNonChargeValue','drCash','drESewa','drKhalti','drFonepay','drCard','drOtherPayment','drExpenses','drPurchases','drWaste','drOwnerInvestment','drOwnerWithdrawal'];
function ymdToday(){const p=nptParts();return `${p.y}-${String(p.m).padStart(2,'0')}-${String(p.d).padStart(2,'0')}`}
function parseYMDLocal(key){const [y,m,d]=String(key||'').split('-').map(Number);return new Date(y,m-1,d,12,0,0)}
function formatReportDate(key){try{return new Intl.DateTimeFormat('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}).format(parseYMDLocal(key))}catch{return key}}
function dateKeyFromTime(ts){if(!ts)return'';try{return businessDayKey(new Date(ts))}catch{return''}}
function reportByDate(key){return (state.dailyBusinessReports||[]).find(r=>r.date===key)||null}
function recordDateKey(x){if(!x)return'';if(x.businessDay)return x.businessDay;if(/^\d{4}-\d{2}-\d{2}$/.test(String(x.date||'')))return String(x.date);return dateKeyFromTime(x.time||x.createdAt||x.date)}
function hasSystemActivityForDate(key){return state.bills.some(b=>recordDateKey(b)===key)||state.expenses.some(x=>recordDateKey(x)===key)||state.purchases.some(x=>recordDateKey(x)===key)||state.waste.some(x=>recordDateKey(x)===key)||state.ownerCapital.some(x=>recordDateKey(x)===key)}
function dailySystemSnapshot(key){
  const allBills=state.bills.filter(b=>recordDateKey(b)===key);
  const bills=allBills.filter(b=>!b.non_chargeable),nc=allBills.filter(b=>b.non_chargeable);
  const payments={Cash:0,eSewa:0,Khalti:0,Fonepay:0,Card:0,Other:0};
  bills.forEach(b=>{
    const ps=b.payments&&Object.keys(b.payments).length?b.payments:{[b.payment||'Other']:Number(b.total||0)};
    Object.entries(ps).forEach(([method,amount])=>{const m=String(method||'').toLowerCase();let k='Other';if(m==='cash')k='Cash';else if(m.includes('esewa'))k='eSewa';else if(m.includes('khalti'))k='Khalti';else if(m.includes('fonepay'))k='Fonepay';else if(m.includes('card')||m.includes('bank'))k='Card';payments[k]+=Number(amount||0)});
  });
  const ex=state.expenses.filter(x=>recordDateKey(x)===key);
  const pu=state.purchases.filter(x=>recordDateKey(x)===key);
  const wa=state.waste.filter(x=>recordDateKey(x)===key);
  const cap=state.ownerCapital.filter(x=>recordDateKey(x)===key);
  const br=state.businessDays.find(x=>x.key===key)||null;
  const totalSales=bills.reduce((z,b)=>z+Number(b.total||0),0),expenses=ex.reduce((z,x)=>z+Number(x.amount||0),0),purchases=pu.reduce((z,x)=>z+Number(x.total_cost||0),0),waste=wa.reduce((z,x)=>z+Number(x.cost||0),0),ownerInvestment=cap.filter(x=>x.type!=='withdrawal').reduce((z,x)=>z+Number(x.amount||0),0),ownerWithdrawal=cap.filter(x=>x.type==='withdrawal').reduce((z,x)=>z+Number(x.amount||0),0);
  return {date:key,totalSales,totalOrders:allBills.length,openingCash:Number(br?.openingCash||0),closingCash:Number(br?.actualCash??0),nonChargeOrders:nc.length,nonChargeValue:nc.reduce((z,b)=>z+Number(b.menu_value??(b.subtotal||0)),0),cash:payments.Cash,eSewa:payments.eSewa,khalti:payments.Khalti,fonepay:payments.Fonepay,card:payments.Card,otherPayment:payments.Other,expenses,purchases,waste,ownerInvestment,ownerWithdrawal,notes:'',source:'system'};
}
function drNum(id){return Number($(id)?.value||0)||0}
function dailyReportFormData(){const date=$('dailyReportDate')?.value||dailyReportSelectedDate||ymdToday();return{date,totalSales:drNum('drTotalSales'),totalOrders:Math.max(0,Math.round(drNum('drTotalOrders'))),openingCash:drNum('drOpeningCash'),closingCash:drNum('drClosingCash'),nonChargeOrders:Math.max(0,Math.round(drNum('drNonChargeOrders'))),nonChargeValue:drNum('drNonChargeValue'),cash:drNum('drCash'),eSewa:drNum('drESewa'),khalti:drNum('drKhalti'),fonepay:drNum('drFonepay'),card:drNum('drCard'),otherPayment:drNum('drOtherPayment'),expenses:drNum('drExpenses'),purchases:drNum('drPurchases'),waste:drNum('drWaste'),ownerInvestment:drNum('drOwnerInvestment'),ownerWithdrawal:drNum('drOwnerWithdrawal'),notes:$('drNotes')?.value.trim()||''}}
function dailyNet(r){return Number(r.totalSales||0)-Number(r.expenses||0)-Number(r.purchases||0)-Number(r.waste||0)}
function fillDailyReportForm(r){const map={drTotalSales:r.totalSales,drTotalOrders:r.totalOrders,drOpeningCash:r.openingCash,drClosingCash:r.closingCash,drNonChargeOrders:r.nonChargeOrders,drNonChargeValue:r.nonChargeValue,drCash:r.cash,drESewa:r.eSewa,drKhalti:r.khalti,drFonepay:r.fonepay,drCard:r.card,drOtherPayment:r.otherPayment,drExpenses:r.expenses,drPurchases:r.purchases,drWaste:r.waste,drOwnerInvestment:r.ownerInvestment,drOwnerWithdrawal:r.ownerWithdrawal};Object.entries(map).forEach(([id,v])=>{if($(id))$(id).value=Number(v||0)});if($('drNotes'))$('drNotes').value=r.notes||'';updateDailyNet()}
function updateDailyNet(){if($('drNetBusiness'))$('drNetBusiness').textContent=rs(dailyNet(dailyReportFormData()))}
function dailyReportDateChanged(){const key=$('dailyReportDate')?.value||ymdToday();dailyReportSelectedDate=key;const d=parseYMDLocal(key);dailyCalendarCursor=new Date(d.getFullYear(),d.getMonth(),1);renderDailyBusinessReport()}
function dailyReportToday(){dailyReportSelectedDate=ymdToday();const d=parseYMDLocal(dailyReportSelectedDate);dailyCalendarCursor=new Date(d.getFullYear(),d.getMonth(),1);renderDailyBusinessReport()}
function dailyReportStep(delta){const d=parseYMDLocal($('dailyReportDate')?.value||dailyReportSelectedDate||ymdToday());d.setDate(d.getDate()+delta);dailyReportSelectedDate=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;dailyCalendarCursor=new Date(d.getFullYear(),d.getMonth(),1);renderDailyBusinessReport()}
function dailyCalendarMove(delta){if(!dailyCalendarCursor){const d=parseYMDLocal(dailyReportSelectedDate||ymdToday());dailyCalendarCursor=new Date(d.getFullYear(),d.getMonth(),1)}dailyCalendarCursor=new Date(dailyCalendarCursor.getFullYear(),dailyCalendarCursor.getMonth()+delta,1);renderDailyCalendar()}
function dailyCalendarSelect(key){dailyReportSelectedDate=key;if($('dailyReportDate'))$('dailyReportDate').value=key;renderDailyBusinessReport()}
function renderDailyCalendar(){const grid=$('dailyCalendarGrid');if(!grid)return;const sel=dailyReportSelectedDate||ymdToday();if(!dailyCalendarCursor){const d=parseYMDLocal(sel);dailyCalendarCursor=new Date(d.getFullYear(),d.getMonth(),1)}const y=dailyCalendarCursor.getFullYear(),m=dailyCalendarCursor.getMonth(),first=new Date(y,m,1),days=new Date(y,m+1,0).getDate(),start=first.getDay();if($('dailyCalendarTitle'))$('dailyCalendarTitle').textContent=new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric'}).format(first);let h='';for(let i=0;i<start;i++)h+='<button class="daily-cal-day outside" tabindex="-1" disabled></button>';for(let day=1;day<=days;day++){const key=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`,saved=!!reportByDate(key),activity=hasSystemActivityForDate(key),today=key===ymdToday();h+=`<button class="daily-cal-day${saved?' saved':''}${activity?' activity':''}${today?' today':''}${key===sel?' selected':''}" type="button" onclick="dailyCalendarSelect('${key}')">${day}</button>`}grid.innerHTML=h}
function renderDailyBusinessReport(){if(!dailyReportSelectedDate)dailyReportSelectedDate=ymdToday();if(!dailyCalendarCursor){const d=parseYMDLocal(dailyReportSelectedDate);dailyCalendarCursor=new Date(d.getFullYear(),d.getMonth(),1)}if($('dailyReportDate'))$('dailyReportDate').value=dailyReportSelectedDate;if($('dailyReportHeading'))$('dailyReportHeading').textContent=formatReportDate(dailyReportSelectedDate);const saved=reportByDate(dailyReportSelectedDate);const r=saved||dailySystemSnapshot(dailyReportSelectedDate);fillDailyReportForm(r);const st=$('dailyReportStatus');if(st){st.textContent=saved?'Saved report':'Not saved';st.className='daily-report-status'+(saved?' saved':'')}if($('deleteDailyReportBtn'))$('deleteDailyReportBtn').disabled=!saved;DR_NUMERIC_IDS.forEach(id=>{const el=$(id);if(el&&!el.dataset.drBound){el.addEventListener('input',updateDailyNet);el.dataset.drBound='1'}});renderDailyCalendar();renderDailyReportHistory()}
function loadDailyReportFromSystem(confirmOverwrite=false){const key=$('dailyReportDate')?.value||dailyReportSelectedDate||ymdToday(),saved=reportByDate(key);if(confirmOverwrite&&saved&&!confirm('Replace the form values with data currently recorded in TEA AMO for this date? Your saved report is not changed until you press Save / Update Report.'))return;const r=dailySystemSnapshot(key);if(saved)r.notes=saved.notes||'';fillDailyReportForm(r);setActionStatus(`Loaded recorded TEA AMO activity for ${key}. Review it, then save the report.`,'good')}
async function saveDailyBusinessReport(){const data=dailyReportFormData();if(!/^\d{4}-\d{2}-\d{2}$/.test(data.date))return alert('Select a valid report date.');const existing=reportByDate(data.date),now=new Date().toISOString();const record={...(existing||{}),...data,id:existing?.id||`DR-${data.date}`,createdAt:existing?.createdAt||now,updatedAt:now,source:hasSystemActivityForDate(data.date)?'system+manual':'manual',netBusiness:dailyNet(data)};state.dailyBusinessReports=state.dailyBusinessReports||[];const i=state.dailyBusinessReports.findIndex(x=>x.date===data.date);if(i>=0)state.dailyBusinessReports[i]=record;else state.dailyBusinessReports.push(record);state.dailyBusinessReports.sort((a,b)=>String(b.date).localeCompare(String(a.date)));audit(existing?'daily_report_updated':'daily_report_created',data.date);await persistNow('daily_business_report');setActionStatus(`Daily business report saved for ${data.date}.`,'good');renderDailyBusinessReport()}
async function deleteDailyBusinessReport(){const key=$('dailyReportDate')?.value||dailyReportSelectedDate,saved=reportByDate(key);if(!saved)return;if(!confirm(`Delete the saved Daily Business Report for ${key}? This does not delete POS sales, expenses, inventory or other operational records.`))return;state.dailyBusinessReports=state.dailyBusinessReports.filter(x=>x.date!==key);audit('daily_report_deleted',key);await persistNow('delete_daily_report');setActionStatus(`Saved report for ${key} deleted. Operational records were not changed.`,'good');renderDailyBusinessReport()}
function renderDailyReportHistory(){const body=$('dailyReportHistory');if(!body)return;const q=String($('dailyReportSearch')?.value||'').toLowerCase().trim();const rows=(state.dailyBusinessReports||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).filter(r=>!q||String(r.date).includes(q)||String(r.notes||'').toLowerCase().includes(q));body.innerHTML=rows.map(r=>`<tr><td><b>${esc(r.date)}</b></td><td>${rs(r.totalSales)}</td><td>${Number(r.totalOrders||0)}</td><td>${rs(r.expenses)}</td><td>${rs(r.purchases)}</td><td><b>${rs(dailyNet(r))}</b></td><td>${r.updatedAt?nptDateTime(r.updatedAt):'—'}</td><td><button class="btn alt small" type="button" onclick="dailyCalendarSelect('${r.date}')">Open</button></td></tr>`).join('')||'<tr><td colspan="8" class="muted">No daily business reports saved yet. Select a date above and create your first report.</td></tr>'}
function downloadDailyBusinessReport(){const data=dailyReportFormData(),saved=reportByDate(data.date),r={...(saved||{}),...data,netBusiness:dailyNet(data)};const lines=[['TEA AMO DAILY BUSINESS REPORT'],['Date',r.date],['Total Sales',r.totalSales],['Total Orders',r.totalOrders],['Opening Cash',r.openingCash],['Closing Cash',r.closingCash],['Cash',r.cash],['eSewa',r.eSewa],['Khalti',r.khalti],['Fonepay',r.fonepay],['Card / Bank',r.card],['Other Payments',r.otherPayment],['Expenses',r.expenses],['Purchases',r.purchases],['Wastage',r.waste],['Non-Chargeable Orders',r.nonChargeOrders],['Non-Chargeable Value',r.nonChargeValue],['Owner Investment',r.ownerInvestment],['Owner Withdrawal',r.ownerWithdrawal],['Net Cash Movement',dailyNet(r)],['Notes',r.notes||'']];const csv=lines.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n'),blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`TEA-AMO-Daily-Business-${r.date}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
// ===== END DAILY BUSINESS REPORT =====

function hardNav(sec){
  const target=document.getElementById(sec);if(!target)return false;
  if(sec==='pos'&&activeSection!=='pos')activeTableId=null;
  activeSection=sec;
  document.querySelectorAll('section').forEach(s=>s.classList.toggle('active',s.id===sec));
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.sec===sec));
  const label=document.querySelector(`#nav button[data-sec="${sec}"] span`);
  if(label&&$('pageTitle'))$('pageTitle').textContent=label.textContent;
  try{renderActive()}catch(err){console.error('Page render error',sec,err)}
  return false
}
function nav(sec){return hardNav(sec)}
function renderActive(){
  try{updateTop()}catch(err){console.error('Top render error',err)}
  const fn={dashboard:renderDashboard,pos:renderPOS,menuadmin:renderMenuAdmin,dayclose:renderDayClose,staff:renderStaff,inventory:renderInventoryActive,recipes:renderRecipes,wastage:renderWaste,vendors:renderVendors,expenses:renderExpenses,capital:renderCapital,customers:renderCustomers,reports:renderReports,dailyreport:renderDailyBusinessReport,dining:renderDining,settings:renderSettings}[activeSection];
  if(fn){try{fn()}catch(err){console.error('Section widget error',activeSection,err)}}
}
function updateTop(){const open=isCafeOpen(),final=dayRecord().finalized;$('clockText').textContent=`${nptDateTime()} NPT · Business day ${businessDayKey()}`;$('branchBadge').textContent=state.business.branch;$('openBadge').innerHTML=open&&!final?'<span class="good">● OPEN</span>':open&&final?'<span class="warn">● FINALIZED</span>':'<span class="bad">● CLOSED</span>'}
function currentMonthTotals(){
  const bills=state.bills.filter(b=>sameMonth(b.time));
  const sales=bills.reduce((s,b)=>s+b.total,0);
  const cogs=bills.reduce((s,b)=>s+(b.cogs||0),0);
  const exp=state.expenses.filter(e=>sameMonth(e.date)).reduce((s,e)=>s+e.amount,0);
  const pay=state.staff.reduce((s,x)=>s+staffMonthHours(x)*x.rate,0);
  const waste=state.waste.filter(w=>sameMonth(w.time)).reduce((s,w)=>s+w.cost,0);
  return {sales,cogs,exp,pay,waste};
}
function dashboardDisplayTotals(){
  const d=daySummary(),m=currentMonthTotals(),base=state.dashboardBaseline;
  if(!base)return {daySales:d.sales,dayOrders:d.orders,monthSales:m.sales,monthCogs:m.cogs,monthExp:m.exp,monthPay:m.pay,monthWaste:m.waste};
  const sameDayBase=!!base&&base.businessDay===businessDayKey();
  const sameMonthBase=!!base&&base.monthKey===`${nptParts().y}-${String(nptParts().m).padStart(2,'0')}`;
  return {
    daySales:Math.max(0,d.sales-(sameDayBase?(Number.isFinite(Number(base.daySales))?Number(base.daySales):0):0)),
    dayOrders:Math.max(0,d.orders-(sameDayBase?(Number.isFinite(Number(base.dayOrders))?Number(base.dayOrders):0):0)),
    monthSales:Math.max(0,m.sales-(sameMonthBase?(Number.isFinite(Number(base.monthSales))?Number(base.monthSales):0):0)),
    monthCogs:Math.max(0,m.cogs-(sameMonthBase?(Number.isFinite(Number(base.monthCogs))?Number(base.monthCogs):0):0)),
    monthExp:Math.max(0,m.exp-(sameMonthBase?(Number.isFinite(Number(base.monthExp))?Number(base.monthExp):0):0)),
    monthPay:Math.max(0,m.pay-(sameMonthBase?(Number.isFinite(Number(base.monthPay))?Number(base.monthPay):0):0)),
    monthWaste:Math.max(0,m.waste-(sameMonthBase?(Number.isFinite(Number(base.monthWaste))?Number(base.monthWaste):0):0))
  };
}

function chargeableBills(){return state.bills.filter(b=>!b.non_chargeable)}
function localYMD(ts){const p=nptParts(new Date(ts));return{y:p.y,m:p.m,d:p.d}}
function availableSalesYears(){const years=new Set([nptParts().y]);state.bills.forEach(b=>years.add(localYMD(b.time).y));return[...years].sort((a,b)=>b-a)}
function syncIncomeSelectors(){const now=nptParts(),months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],ys=availableSalesYears();const ms=$('incomeMonthSelect'),mys=$('incomeMonthYearSelect'),ysel=$('incomeYearSelect');if(ms&&!ms.options.length){ms.innerHTML=months.map((x,i)=>`<option value="${i+1}">${x}</option>`).join('');ms.value=String(now.m);ms.onchange=renderDashboardCharts}if(mys){const old=mys.value||String(now.y);mys.innerHTML=ys.map(y=>`<option>${y}</option>`).join('');mys.value=ys.includes(Number(old))?old:String(now.y);if(!mys.onchange)mys.onchange=renderDashboardCharts}if(ysel){const old=ysel.value||String(now.y);ysel.innerHTML=ys.map(y=>`<option>${y}</option>`).join('');ysel.value=ys.includes(Number(old))?old:String(now.y);if(!ysel.onchange)ysel.onchange=renderDashboardCharts}}
function setupCanvas(canvas){if(!canvas)return null;const rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1,w=Math.max(320,Math.floor(rect.width||canvas.parentElement?.clientWidth||600)),h=Math.max(180,Math.floor(rect.height||280));canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return{ctx,w,h}}
function drawLineChart(id,labels,values){const c=$(id),o=setupCanvas(c);if(!o)return;const{ctx,w,h}=o,p={l:54,r:14,t:18,b:42};ctx.clearRect(0,0,w,h);const max=Math.max(1,...values),min=0;ctx.font='11px system-ui';ctx.fillStyle='#64748b';ctx.strokeStyle='rgba(100,116,139,.25)';ctx.lineWidth=1;for(let i=0;i<=4;i++){const y=p.t+(h-p.t-p.b)*i/4;ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(w-p.r,y);ctx.stroke();const v=max*(1-i/4);ctx.fillText(Math.round(v).toLocaleString(),4,y+4)}const step=Math.max(1,Math.ceil(labels.length/8));labels.forEach((lab,i)=>{if(i%step&&i!==labels.length-1)return;const x=p.l+(w-p.l-p.r)*(labels.length===1?0:i/(labels.length-1));ctx.fillText(String(lab),x-8,h-16)});ctx.strokeStyle='#161616';ctx.lineWidth=2.5;ctx.beginPath();values.forEach((v,i)=>{const x=p.l+(w-p.l-p.r)*(values.length===1?0:i/(values.length-1)),y=p.t+(h-p.t-p.b)*(1-(v-min)/(max-min||1));if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.stroke();ctx.fillStyle='#161616';values.forEach((v,i)=>{const x=p.l+(w-p.l-p.r)*(values.length===1?0:i/(values.length-1)),y=p.t+(h-p.t-p.b)*(1-v/max);ctx.beginPath();ctx.arc(x,y,2.6,0,Math.PI*2);ctx.fill()})}
function drawBarChart(id,labels,values){const c=$(id),o=setupCanvas(c);if(!o)return;const{ctx,w,h}=o,p={l:54,r:14,t:18,b:74};ctx.clearRect(0,0,w,h);const max=Math.max(1,...values);ctx.font='11px system-ui';ctx.fillStyle='#64748b';ctx.strokeStyle='rgba(100,116,139,.25)';for(let i=0;i<=4;i++){const y=p.t+(h-p.t-p.b)*i/4;ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(w-p.r,y);ctx.stroke();ctx.fillText(Math.round(max*(1-i/4)).toLocaleString(),4,y+4)}const inner=w-p.l-p.r,n=Math.max(1,labels.length),bw=Math.max(8,Math.min(42,inner/n*.68));labels.forEach((lab,i)=>{const x=p.l+inner*(i+.5)/n,y=p.t+(h-p.t-p.b)*(1-values[i]/max);ctx.fillStyle='#161616';ctx.fillRect(x-bw/2,y,bw,h-p.b-y);ctx.save();ctx.translate(x,h-p.b+8);ctx.rotate(-Math.PI/5);ctx.fillStyle='#64748b';ctx.textAlign='right';ctx.fillText(String(lab).slice(0,18),0,0);ctx.restore()})}
function renderDashboardCharts(){syncIncomeSelectors();const now=nptParts(),m=Number($('incomeMonthSelect')?.value||now.m),my=Number($('incomeMonthYearSelect')?.value||now.y),y=Number($('incomeYearSelect')?.value||now.y);const days=new Date(my,m,0).getDate(),daily=Array(days).fill(0);chargeableBills().forEach(b=>{const d=localYMD(b.time);if(d.y===my&&d.m===m)daily[d.d-1]+=Number(b.total||0)});drawLineChart('dailyIncomeChart',Array.from({length:days},(_,i)=>i+1),daily);if($('dailyIncomeTotal'))$('dailyIncomeTotal').textContent=rs(daily.reduce((a,b)=>a+b,0));const yearly=Array(12).fill(0);chargeableBills().forEach(b=>{const d=localYMD(b.time);if(d.y===y)yearly[d.m-1]+=Number(b.total||0)});drawLineChart('yearIncomeChart',['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],yearly);if($('yearIncomeTotal'))$('yearIncomeTotal').textContent=rs(yearly.reduce((a,b)=>a+b,0))}
function paymentAccount(method){const m=String(method||'').toLowerCase();if(m==='cash')return'Cash';if(m.includes('credit'))return'Payable';if(m.includes('card')||m.includes('bank'))return'Bank';return'Online'}
function billPaymentMovements(){const rows=[];chargeableBills().forEach(b=>{if(b.payments&&Object.keys(b.payments).length){Object.entries(b.payments).forEach(([method,amount])=>{if(Number(amount)>0)rows.push({time:b.time,direction:'in',source:'Sale',account:paymentAccount(method),amount:Number(amount),note:`${b.id} · ${method}`})})}else if(Number(b.total)>0)rows.push({time:b.time,direction:'in',source:'Sale',account:paymentAccount(b.payment),amount:Number(b.total),note:`${b.id} · ${b.payment||''}`})});return rows}
function moneyMovementLedger(){const rows=billPaymentMovements();state.ownerCapital.forEach(x=>rows.push({time:x.time,direction:x.type==='withdrawal'?'out':'in',source:x.type==='withdrawal'?'Owner Withdrawal':'Owner Investment',account:x.destination||'Cash',amount:Number(x.amount||0),note:x.note||''}));state.expenses.forEach(x=>rows.push({time:x.time||x.createdAt||x.date,direction:'out',source:'Expense',account:paymentAccount(x.payment||'Cash'),amount:Number(x.amount||0),note:x.description||x.category||x.note||''}));state.purchases.forEach(x=>rows.push({time:x.time||x.date,direction:'out',source:'Purchase',account:paymentAccount(x.payment||'Cash'),amount:Number(x.total_cost||0),note:x.invoice||x.note||''}));(state.accountTransfers||[]).forEach(x=>{rows.push({time:x.time,direction:'out',source:'Account Transfer',account:x.from,amount:Number(x.amount||0),note:(x.note||'')+' → '+x.to});rows.push({time:x.time,direction:'in',source:'Account Transfer',account:x.to,amount:Number(x.amount||0),note:(x.note||'')+' ← '+x.from})});return rows.filter(x=>x.time&&x.amount>0).sort((a,b)=>new Date(b.time)-new Date(a.time))}
function itemSalesRows(period='daily'){const now=nptParts(),map=new Map();let targetY=now.y,targetM=now.m,targetD=now.d;if(period==='daily'&&$('sellerDate')?.value){const [y,m,d]=$('sellerDate').value.split('-').map(Number);targetY=y;targetM=m;targetD=d}if(period==='monthly'&&$('sellerMonth')?.value){const [y,m]=$('sellerMonth').value.split('-').map(Number);targetY=y;targetM=m}state.bills.filter(b=>!b.non_chargeable).forEach(b=>{const d=localYMD(b.time);const ok=period==='daily'?(d.y===targetY&&d.m===targetM&&d.d===targetD):(d.y===targetY&&d.m===targetM);if(!ok)return;(b.items||[]).forEach(it=>{const name=it.name||menuItem(it.id)?.name||'Unknown',qty=Number(it.qty||0),price=Number(it.price??menuItem(it.id)?.price??0),cur=map.get(name)||{name,qty:0,revenue:0};cur.qty+=qty;cur.revenue+=qty*price;map.set(name,cur)})});return[...map.values()]}
function syncSellerControls(){const now=nptParts(),date=$('sellerDate'),month=$('sellerMonth'),period=$('sellerPeriod')?.value||'daily';if(date&&!date.value)date.value=`${now.y}-${String(now.m).padStart(2,'0')}-${String(now.d).padStart(2,'0')}`;if(month&&!month.value)month.value=`${now.y}-${String(now.m).padStart(2,'0')}`;if(date)date.style.display=period==='daily'?'':'none';if(month)month.style.display=period==='monthly'?'':'none'}
function addAccountTransfer(){const from=$('transferFrom')?.value,to=$('transferTo')?.value,amount=Number($('transferAmount')?.value||0),note=$('transferNote')?.value.trim()||'';if(!from||!to)return alert('Choose both accounts.');if(from===to)return alert('Choose two different accounts.');if(!(amount>0))return alert('Enter a transfer amount.');const ledger=moneyMovementLedger(),bal={Cash:0,Bank:0,Online:0};ledger.forEach(x=>{if(x.account in bal)bal[x.account]+=(x.direction==='in'?1:-1)*Number(x.amount||0)});if((bal[from]||0)<amount&&!confirm(`${from} recorded balance is ${rs(bal[from]||0)}. Record this transfer anyway?`))return;state.accountTransfers=state.accountTransfers||[];state.accountTransfers.unshift({id:'TR-'+Date.now(),time:workingNowIso(),businessDay:businessDayKey(),from,to,amount,note});$('transferAmount').value='';$('transferNote').value='';audit('account_transfer',`${from} to ${to} ${amount}`);saveSoon();renderCapital()}
function renderSellerAnalytics(){syncSellerControls();const period=$('sellerPeriod')?.value||'daily',metric=$('sellerMetric')?.value||'qty',rows=itemSalesRows(period).sort((a,b)=>b[metric]-a[metric]);const best=rows[0],least=rows.length?rows.slice().sort((a,b)=>a[metric]-b[metric])[0]:null;if($('bestSellerName'))$('bestSellerName').textContent=best?.name||'—';if($('bestSellerValue'))$('bestSellerValue').textContent=best?(metric==='qty'?`${best.qty} sold`:rs(best.revenue)):'No sales';if($('leastSellerName'))$('leastSellerName').textContent=least?.name||'—';if($('leastSellerValue'))$('leastSellerValue').textContent=least?(metric==='qty'?`${least.qty} sold`:rs(least.revenue)):'No sales';if($('sellerBody'))$('sellerBody').innerHTML=rows.map((x,i)=>`<tr><td>${i+1}</td><td><b>${esc(x.name)}</b></td><td>${x.qty}</td><td>${rs(x.revenue)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No item sales for this period.</td></tr>';const chartRows=rows.slice(0,12);drawBarChart('sellerChart',chartRows.map(x=>x.name),chartRows.map(x=>x[metric]));}

function ymdToUtcDate(key){const [y,m,d]=String(key||'').split('-').map(Number);return new Date(Date.UTC(y,m-1,d))}
function utcDateToYmd(d){return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`}
function addYmdDays(key,days){const d=ymdToUtcDate(key);d.setUTCDate(d.getUTCDate()+days);return utcDateToYmd(d)}
function itemSalesPeriodRange(){
  const period=$('itemSalesPeriod')?.value||'daily',today=activeDateKey();
  if(period==='monthly'){
    const month=$('itemSalesMonth')?.value||today.slice(0,7),[y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate();
    return{period,start:`${month}-01`,end:`${month}-${String(last).padStart(2,'0')}`,label:`${month}`};
  }
  if(period==='yearly'){
    const y=Number($('itemSalesYear')?.value||today.slice(0,4));return{period,start:`${y}-01-01`,end:`${y}-12-31`,label:String(y)};
  }
  const anchor=$('itemSalesDate')?.value||today;
  if(period==='weekly'){
    const d=ymdToUtcDate(anchor),dow=d.getUTCDay(),mondayOffset=dow===0?-6:1-dow,start=addYmdDays(anchor,mondayOffset),end=addYmdDays(start,6);
    return{period,start,end,label:`${start} to ${end}`};
  }
  return{period,start:anchor,end:anchor,label:anchor};
}
function syncItemSalesControls(){
  const period=$('itemSalesPeriod')?.value||'daily',today=activeDateKey(),date=$('itemSalesDate'),month=$('itemSalesMonth'),year=$('itemSalesYear');
  if(date&&!date.value)date.value=today;if(month&&!month.value)month.value=today.slice(0,7);
  if(year){const years=new Set([Number(today.slice(0,4))]);state.bills.forEach(b=>{const k=recordBusinessDate(b);if(k)years.add(Number(k.slice(0,4)))});const cur=year.value||today.slice(0,4);year.innerHTML=[...years].sort((a,b)=>b-a).map(y=>`<option value="${y}">${y}</option>`).join('');if([...years].map(String).includes(String(cur)))year.value=cur}
  if(date)date.style.display=(period==='daily'||period==='weekly')?'':'none';if(month)month.style.display=period==='monthly'?'':'none';if(year)year.style.display=period==='yearly'?'':'none';
}
function itemSalesSummaryData(){
  syncItemSalesControls();const range=itemSalesPeriodRange(),map=new Map(),tx=[],billIds=new Set();
  chargeableBills().forEach(b=>{const key=recordBusinessDate(b);if(!key||key<range.start||key>range.end)return;billIds.add(String(b.id));(b.items||[]).forEach(it=>{const m=menuItem(it.id),name=it.name||m?.name||'Unknown',category=m?.category||it.category||'Uncategorized',qty=Math.max(0,Number(it.qty||0)),price=Number(it.price??m?.price??0),revenue=qty*price;if(!qty)return;const k=String(it.id??name),cur=map.get(k)||{id:it.id,name,category,qty:0,revenue:0};cur.qty+=qty;cur.revenue+=revenue;map.set(k,cur);tx.push({bill:b.id,date:key,time:b.time,item:name,category,qty,unit_price:price,revenue,payment:b.payment||'',type:b.type||'',table:b.ref||''})})});
  const rows=[...map.values()].sort((a,b)=>b.qty-a.qty||b.revenue-a.revenue||a.name.localeCompare(b.name)),totalQty=rows.reduce((s,x)=>s+x.qty,0),revenue=rows.reduce((s,x)=>s+x.revenue,0);
  return{range,rows,totalQty,revenue,orders:billIds.size,transactions:tx};
}
function renderItemSalesSummary(){
  if(!$('itemSalesBody'))return;const data=itemSalesSummaryData(),q=($('itemSalesSearch')?.value||'').trim().toLowerCase(),rows=data.rows.filter(x=>!q||x.name.toLowerCase().includes(q)||x.category.toLowerCase().includes(q));
  $('itemSalesRangeLabel').textContent=`Period: ${data.range.label} · ${data.range.start} through ${data.range.end}`;$('itemSalesTotalQty').textContent=Number(data.totalQty).toLocaleString();$('itemSalesUnique').textContent=data.rows.length.toLocaleString();$('itemSalesOrders').textContent=data.orders.toLocaleString();$('itemSalesRevenue').textContent=rs(data.revenue);
  $('itemSalesBody').innerHTML=rows.map((x,i)=>`<tr><td>${i+1}</td><td><b>${esc(x.name)}</b></td><td>${esc(x.category)}</td><td><b>${Number(x.qty).toLocaleString()}</b></td><td>${rs(x.revenue)}</td><td>${rs(x.qty?x.revenue/x.qty:0)}</td><td>${data.totalQty?(x.qty/data.totalQty*100).toFixed(1):'0.0'}%</td></tr>`).join('')||'<tr><td colspan="7" class="muted">No item sales for this period.</td></tr>';
}
function excelXmlEscape(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
function excelCell(v,type='String',style=''){return `<Cell${style?` ss:StyleID="${style}"`:''}><Data ss:Type="${type}">${excelXmlEscape(v)}</Data></Cell>`}
function excelRow(values,style=''){return `<Row>${values.map(v=>excelCell(v,typeof v==='number'?'Number':'String',style)).join('')}</Row>`}
function exportItemSalesExcel(){
  const d=itemSalesSummaryData(),generated=nptDateTime(),name=`tea-amo-item-sales-${d.range.period}-${d.range.start}-${d.range.end}.xls`,currency=state.business.currency||'Rs';
  const summary=[['TEA AMO Item Sales Report'],['Period',d.range.period],['Range',`${d.range.start} to ${d.range.end}`],['Generated',generated],['Total Units Sold',d.totalQty],['Unique Items Sold',d.rows.length],['Orders',d.orders],['Item Revenue',d.revenue]];
  const summaryXml=summary.map((r,i)=>excelRow(r,i===0?'Title':i>3?'Kpi':'' )).join('');
  const itemHeader=['Rank','Item','Category','Qty Sold',`Revenue (${currency})`,`Avg Unit Price (${currency})`,'% of Units'];
  const itemsXml=excelRow(itemHeader,'Header')+d.rows.map((x,i)=>excelRow([i+1,x.name,x.category,x.qty,x.revenue,x.qty?x.revenue/x.qty:0,d.totalQty?Number((x.qty/d.totalQty*100).toFixed(2)):0])).join('');
  const txHeader=['Bill','Business Date','Time','Item','Category','Qty',`Unit Price (${currency})`,`Line Revenue (${currency})`,'Payment','Order Type','Table / Ref'];
  const txXml=excelRow(txHeader,'Header')+d.transactions.map(x=>excelRow([x.bill,x.date,nptDateTime(x.time),x.item,x.category,x.qty,x.unit_price,x.revenue,x.payment,x.type,x.table])).join('');
  const xml=`<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="11"/></Style><Style ss:ID="Title"><Font ss:FontName="Calibri" ss:Size="16" ss:Bold="1"/><Interior ss:Color="#E8F2EF" ss:Pattern="Solid"/></Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#153C35" ss:Pattern="Solid"/></Style><Style ss:ID="Kpi"><Font ss:Bold="1"/></Style></Styles><Worksheet ss:Name="Summary"><Table>${summaryXml}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet><Worksheet ss:Name="Item Sales"><Table>${itemsXml}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet><Worksheet ss:Name="Transactions"><Table>${txXml}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet></Workbook>`;
  download(name,xml,'application/vnd.ms-excel');
}
function exportItemSalesCsv(){const d=itemSalesSummaryData();exportRows(`tea-amo-item-sales-${d.range.period}-${d.range.start}-${d.range.end}.csv`,['rank','item','category','qty_sold','revenue','avg_unit_price','percent_of_units'],d.rows.map((x,i)=>[i+1,x.name,x.category,x.qty,x.revenue,x.qty?x.revenue/x.qty:0,d.totalQty?Number((x.qty/d.totalQty*100).toFixed(2)):0]))}

function renderDashboard(){
  const d=daySummary(),view=dashboardDisplayTotals();
  const low=state.ingredients.filter(i=>i.active&&(i.stock<=0||(i.reorder>0&&i.stock<=i.reorder)));
  $('dSales').textContent=rs(view.daySales);
  $('dOrders').textContent=view.dayOrders;
  $('dLow').textContent=low.length;
  $('dWaste').textContent=rs(view.monthWaste);
  let alerts=[];
  if(state.dashboardBaseline)alerts.push(`<div class="good">• Dashboard was cleared on ${esc(nptDateTime(state.dashboardBaseline.clearedAt))} NPT. Reports and all business data remain intact.</div>`);
  if(!isCafeOpen())alerts.push('<div class="warn">• POS & Billing is manually closed.</div>');
  if(d.rec.finalized)alerts.push('<div class="good">• Current business day is finalized.</div>');
  low.slice(0,12).forEach(i=>alerts.push(`<div class="${i.stock<=0?'bad':'warn'}">• ${esc(i.name)}: ${Number(i.stock).toFixed(3)} ${esc(i.unit)}</div>`));
  $('alerts').innerHTML=alerts.join('')||'No operational alerts.';
  $('monthSnapshot').innerHTML=`<div class="srow"><span>Sales</span><b>${rs(view.monthSales)}</b></div><div class="srow"><span>Theoretical COGS</span><b>${rs(view.monthCogs)}</b></div><div class="srow"><span>Expenses</span><b>${rs(view.monthExp)}</b></div><div class="srow"><span>Payroll estimate</span><b>${rs(view.monthPay)}</b></div><div class="srow total"><span>Operating contribution</span><span>${rs(view.monthSales-view.monthCogs-view.monthExp-view.monthPay)}</span></div>`;const ts=tableStatusCounts();$('dashTableAvailable').textContent=ts.available;$('dashTableOccupied').textContent=ts.occupied;$('dashTableReserved').textContent=ts.reserved;$('dashTableAttention').textContent=ts.attention;
  requestAnimationFrame(renderDashboardCharts);
}
let menuSearchCache='',activeTableId=null,reservationTableId=null,checkoutBusy=false;
function tableById(id){return state.tables.find(t=>t.id===id)}
function ensureTableOrder(id){
  if(id==='counter')return null;
  if(!state.tableOrders[id])state.tableOrders[id]={cart:[],openedAt:null,customerId:null,discountType:'percent',discountValue:0,orderRef:'',orderType:'Dine-in',guestCount:1};
  const o=state.tableOrders[id];
  if(!Array.isArray(o.cart))o.cart=[];
  o.guestCount=Math.max(1,Number(o.guestCount||1));
  for(const x of o.cart){
    x.qty=Math.max(1,Number(x.qty||1));
    x.served=Math.max(0,Math.min(Number(x.served||0),x.qty))
  }
  return o
}
function tableHasOrder(id){const o=state.tableOrders[id];return !!(o&&Array.isArray(o.cart)&&o.cart.some(x=>x.qty>0))}
function tableVisualStatus(t){if(t.attention)return'attention';if(tableHasOrder(t.id)||t.seated)return'occupied';if(t.reservation)return'reserved';return'available'}
function tableStatusCounts(){let available=0,occupied=0,reserved=0,attention=0;state.tables.filter(t=>t.active).forEach(t=>{if(t.attention)attention++;if(tableHasOrder(t.id)||t.seated)occupied++;else if(t.reservation)reserved++;else available++});return{available,occupied,reserved,attention}}
function tableOrderTotal(id){const o=state.tableOrders[id];if(!o)return 0;return(o.cart||[]).reduce((s,c)=>{const m=menuItem(c.id);return s+(m?m.price*c.qty:0)},0)}
function unservedCountForOrder(o){return(o?.cart||[]).reduce((s,x)=>s+Math.max(0,Number(x.qty||0)-Number(x.served||0)),0)}
function servedCountForOrder(o){return(o?.cart||[]).reduce((s,x)=>s+Math.min(Number(x.qty||0),Number(x.served||0)),0)}
function tableUnservedCount(id){return unservedCountForOrder(state.tableOrders[id])}

function elapsedText(ts){if(!ts)return'';let mins=Math.max(0,Math.floor((Date.now()-new Date(ts))/60000));if(mins<60)return`${mins} min`;return`${Math.floor(mins/60)}h ${mins%60}m`}
function currentCart(){if(activeTableId&&activeTableId!=='counter')return ensureTableOrder(activeTableId).cart;return state.cart}
function currentOrderMeta(){return activeTableId&&activeTableId!=='counter'?ensureTableOrder(activeTableId):null}
function saveCurrentOrderUI(){
  const o=currentOrderMeta();if(!o)return;
  o.customerId=Number($('posCustomer').value)||null;
  o.discountType=$('discountType').value;
  o.discountValue=Number($('discountValue').value||0);
  o.orderRef=$('orderRef').value.trim();
  o.orderType='Dine-in';
  o.guestCount=Math.max(1,Number($('guestCount').value||1));
  saveSoon();queueLanOrderPush(activeTableId)
}
function openTable(id){
  const t=tableById(id);if(!t||!t.active)return;
  activeTableId=id;const o=ensureTableOrder(id);
  $('tableSelectView').classList.add('hidden');$('tableOrderView').classList.remove('hidden');
  $('activeTableLabel').textContent=`${t.name} · ${t.seats} seats`;
  $('orderType').value='Dine-in';$('orderType').disabled=true;$('orderRef').value=o.orderRef||t.name;
  $('discountType').value=o.discountType||'percent';$('discountValue').value=Number(o.discountValue||0);
  $('guestCount').value=Math.max(1,Number(o.guestCount||1));
  renderPOSWorkspace()
}
function openCounter(){
  activeTableId='counter';$('tableSelectView').classList.add('hidden');$('tableOrderView').classList.remove('hidden');
  $('activeTableLabel').textContent='Counter / Takeaway';
  $('orderType').disabled=false;if($('orderType').value==='Dine-in')$('orderType').value='Takeaway';$('orderRef').value='';
  $('discountType').value='percent';$('discountValue').value=0;$('guestCount').value=1;renderPOSWorkspace()
}
function backToTables(){saveCurrentOrderUI();activeTableId=null;$('tableOrderView').classList.add('hidden');$('tableSelectView').classList.remove('hidden');renderTableFloor()}
function renderPOS(){if(activeTableId)renderPOSWorkspace();else{$('tableOrderView').classList.add('hidden');$('tableSelectView').classList.remove('hidden');renderTableFloor()}}
function renderTableFloor(){
  const counts=tableStatusCounts();$('floorAvailable').textContent=counts.available;$('floorOccupied').textContent=counts.occupied;$('floorReserved').textContent=counts.reserved;$('floorAttention').textContent=counts.attention;
  const floor=$('tableFloor');floor.querySelectorAll('.floor-table').forEach(x=>x.remove());
  state.tables.filter(t=>t.active).forEach(t=>{
    const st=tableVisualStatus(t),o=state.tableOrders[t.id],items=(o?.cart||[]).reduce((s,x)=>s+x.qty,0),total=tableOrderTotal(t.id),res=t.reservation;
    const b=document.createElement('button');b.type='button';b.className=`floor-table ${t.kind==='floor'?'floor-seat ':''}${st}`;b.style.left=`${t.x}%`;b.style.top=`${t.y}%`;b.style.width=`${t.w}%`;b.style.height=`${t.h}%`;b.title=`${t.name} · ${t.seats} seats · ${st==='attention'?'Unattended':st}`;
    b.innerHTML=`<div class="floor-table-name">${esc(t.name)}</div><div class="floor-table-sub">${t.kind==='floor'?'Floor seating · ':''}${t.seats} seats</div>${items?`<div class="floor-table-sub"><b>${items} item${items===1?'':'s'} · ${rs(total)}</b></div>`:''}${o?.openedAt?`<div class="floor-table-sub">Open ${elapsedText(o.openedAt)}</div>`:''}${tableUnservedCount(t.id)?`<div class="floor-table-sub"><b>${tableUnservedCount(t.id)} unserved</b></div>`:''}${res?`<div class="floor-table-sub">Reserved: ${esc(res.guest||'Guest')}</div>`:''}<span class="floor-table-state">${st==='attention'?'UNATTENDED':st.toUpperCase()}</span>`;
    b.onclick=()=>openTable(t.id);b.oncontextmenu=e=>{e.preventDefault();openReservation(t.id)};floor.appendChild(b)
  });
  const openRows=state.tables.filter(t=>t.active&&tableHasOrder(t.id)).sort((a,b)=>(state.tableOrders[a.id]?.openedAt||'').localeCompare(state.tableOrders[b.id]?.openedAt||''));
  $('floorOpenList').innerHTML=openRows.length?openRows.map(t=>`<div class="floor-list-row"><button onclick="openTable('${esc(t.id)}')"><b>${esc(t.name)}</b><div class="sub">${elapsedText(state.tableOrders[t.id]?.openedAt)} · ${rs(tableOrderTotal(t.id))}</div></button><span class="pill">${(state.tableOrders[t.id]?.cart||[]).reduce((s,x)=>s+x.qty,0)} items</span></div>`).join(''):'<div class="muted">No open orders.</div>';
  const reservations=state.tables.filter(t=>t.active&&t.reservation).sort((a,b)=>String(a.reservation?.time||'').localeCompare(String(b.reservation?.time||'')));
  $('floorReservationList').innerHTML=reservations.length?reservations.map(t=>`<div class="floor-list-row"><button onclick="openReservation('${esc(t.id)}')"><b>${esc(t.name)} · ${esc(t.reservation.guest||'Guest')}</b><div class="sub">${esc((t.reservation.time||'').replace('T',' '))}${t.reservation.party?' · '+t.reservation.party+' guests':''}</div></button></div>`).join(''):'<div class="muted">No reservations.</div>';
}
function renderPOSWorkspace(){
  renderMenu();fillCustomerSelect();updateMainPaymentQr();
  const o=currentOrderMeta();
  if(o&&o.customerId)$('posCustomer').value=String(o.customerId);
  if(o)$('guestCount').value=Math.max(1,Number(o.guestCount||1));
  renderCart();
  const t=activeTableId&&activeTableId!=='counter'?tableById(activeTableId):null;
  $('posStatus').innerHTML=posAllowed()?`<span class="good">POS OPEN</span> · ${t?`Order stays attached to <b>${esc(t.name)}</b> until payment.`:'Counter order'} Changes save automatically.`:dayRecord().finalized?'<span class="warn">DAY FINALIZED</span> · Billing is locked.':'<span class="bad">POS CLOSED</span> · Reopen it from Finalize Day when needed.';
  $('checkout').disabled=!posAllowed();$('checkout').style.opacity=posAllowed()?'1':'.55';
  $('tableReserveBtn').style.display=t?'inline-block':'none';$('tableAttentionBtn').style.display=t?'inline-block':'none';
  if(t)$('tableAttentionBtn').textContent=t.attention?'Clear Unattended Flag':'Mark Unattended'
}
function renderMenu(){const q=$('menuSearch').value.trim().toLowerCase(),cat=$('catFilter').value;if($('catFilter').options.length===1)[...new Set(state.menu.map(m=>m.category))].forEach(c=>$('catFilter').add(new Option(c,c)));const rows=state.menu.filter(m=>m.active!==false&&(!cat||m.category===cat)&&(!q||m.name.toLowerCase().includes(q)));$('menuGrid').innerHTML=rows.map(m=>`<button class="menuitem" onclick="addCart(${m.id})"><b>${esc(m.name)}</b><small>${esc(m.category)}</small><div class="price">${rs(m.price)}</div><small class="${canMake(m)?'good':'warn'}">${canMake(m)?'Stock ready':'Check stock'}</small></button>`).join('')}
function calcCart(){let subtotal=0;currentCart().forEach(c=>{const m=menuItem(c.id);if(m)subtotal+=m.price*c.qty});const v=Math.max(0,Number($('discountValue').value||0)),discount=$('discountType').value==='percent'?subtotal*Math.min(v,100)/100:Math.min(v,subtotal),tax=(subtotal-discount)*Number(state.business.taxRate||0)/100;return{subtotal,discount,tax,total:subtotal-discount+tax}}
function renderCart(){
  const cart=currentCart(),rows=[];
  for(const c of cart){
    const m=menuItem(c.id);if(!m)continue;
    c.qty=Math.max(1,Number(c.qty||1));c.served=Math.max(0,Math.min(Number(c.served||0),c.qty));
    const remain=Math.max(0,c.qty-c.served),done=remain===0;
    rows.push(`<div class="cartrow ${done?'served-row':''}">
      <div><b style="font-size:13px">${esc(m.name)}</b><div class="sub">${esc(m.category||'Menu')} · ${rs(m.price)} each</div>
      <div class="service-line"><span class="service-chip">Ordered: ${c.qty}</span><span class="service-chip done">Served: ${c.served}</span><span class="service-chip ${done?'done':''}">Remaining: ${remain}</span></div></div>
      <div><div class="qty"><button type="button" class="mini" onclick="changeQty(${c.id},-1)">−</button><b>${c.qty}</b><button type="button" class="mini" onclick="changeQty(${c.id},1)">+</button></div>
      <div class="service-line">${remain?`<button type="button" class="serve-btn" onclick="markServed(${c.id},1)">Serve 1</button><button type="button" class="serve-btn" onclick="markAllServed(${c.id})">Serve All</button>`:`<button type="button" class="serve-btn undo" onclick="markServed(${c.id},-1)">Undo Served</button>`}</div></div>
      <b>${rs(m.price*c.qty)}</b></div>`)
  }
  $('cartRows').innerHTML=rows.length?rows.join(''):'<div class="notice">No menu items in this order yet. Select an item from the menu.</div>';
  const totals=calcCart();$('subtotal').textContent=rs(totals.subtotal);$('discountAmount').textContent='- '+rs(totals.discount);$('taxAmount').textContent=rs(totals.tax);$('grandTotal').textContent=rs(totals.total);
  const units=cart.reduce((s,x)=>s+Number(x.qty||0),0),lines=cart.length,served=servedCountForOrder({cart}),unserved=unservedCountForOrder({cart});
  $('serviceProgress').innerHTML=units?`<b>${lines} menu item${lines===1?'':'s'}</b> · ${units} total unit${units===1?'':'s'} · <span class="good">${served} served</span> · <span class="${unserved?'warn':'good'}">${unserved} remaining</span>`:'No items selected yet.'
}
function addCart(id){
  const cart=currentCart(),c=cart.find(x=>String(x.id)===String(id));
  if(c)c.qty=Number(c.qty||0)+1;
  else cart.push({id:Number(id),qty:1,served:0});
  const o=currentOrderMeta();
  if(o&&!o.openedAt){
    o.openedAt=workingNowIso();
    const t=tableById(activeTableId);
    if(t&&t.reservation){
      o.guestCount=Math.max(1,Number(t.reservation.party||o.guestCount||1));
      $('guestCount').value=o.guestCount;t.reservation=null
    }
  }
  saveCurrentOrderUI();saveSoon();queueLanOrderPush(activeTableId);renderCart()
}
function changeQty(id,d){
  const cart=currentCart(),c=cart.find(x=>String(x.id)===String(id));if(!c)return;
  c.qty=Number(c.qty||0)+Number(d||0);
  c.served=Math.max(0,Math.min(Number(c.served||0),Math.max(0,c.qty)));
  if(c.qty<=0){const ix=cart.indexOf(c);if(ix>=0)cart.splice(ix,1)}
  const o=currentOrderMeta();if(o&&!cart.length)o.openedAt=null;
  saveCurrentOrderUI();saveSoon();queueLanOrderPush(activeTableId);renderCart()
}

function markServed(id,delta=1){
  const c=currentCart().find(x=>String(x.id)===String(id));if(!c)return;
  c.served=Math.max(0,Math.min(Number(c.qty||0),Number(c.served||0)+Number(delta||0)));
  saveCurrentOrderUI();saveSoon();queueLanOrderPush(activeTableId);renderCart()
}
function markAllServed(id){
  const c=currentCart().find(x=>String(x.id)===String(id));if(!c)return;
  c.served=Number(c.qty||0);
  saveCurrentOrderUI();saveSoon();queueLanOrderPush(activeTableId);renderCart()
}
function deductRecipe(m,qty,billId){for(const r of recipeFor(m)){const i=ingredient(r.ingredient_key);if(!i)continue;const used=r.qty*qty;i.stock-=used;state.inventoryLog.unshift({id:Date.now()+Math.random(),time:new Date().toISOString(),ingredient_key:i.key,qty_delta:-used,reason:'sale',ref:billId,note:m.name})}}
async function checkout(){
  if(checkoutBusy)return;
  const btn=$('checkout');
  checkoutBusy=true;
  btn.disabled=true;
  const oldText=btn.textContent;
  btn.textContent='Processing…';

  try{
    if(!posAllowed())return alert('POS is closed or this business day is finalized.');
    const cart=currentCart();
    if(!cart.length)return alert('Add at least one item.');

    const pendingService=unservedCountForOrder({cart});
    if(pendingService&&!confirm(`${pendingService} item(s) are still unserved. Complete payment anyway?`))return;

    saveCurrentOrderUI();
    const c=calcCart(),id=newReceiptId(),items=[];
    for(const row of cart){
      const m=menuItem(row.id);if(!m)continue;
      const qty=Math.max(1,Number(row.qty||1));
      items.push({id:m.id,name:m.name,price:m.price,qty,served_qty:Number(row.served||0),cogs:recipeCost(m)*qty});
    }
    if(!items.length)return alert('The order contains no valid menu items.');

    const customerId=Number($('posCustomer').value)||null;
    const t=activeTableId&&activeTableId!=='counter'?tableById(activeTableId):null;
    const bill={
      id,time:workingNowIso(),businessDay:businessDayKey(),
      type:t?'Dine-in':$('orderType').value,
      ref:t?t.name:$('orderRef').value.trim(),
      table_id:t?t.id:null,
      guest_count:t?Math.max(1,Number(currentOrderMeta()?.guestCount||$('guestCount').value||1)):1,
      payment:$('payment').value,
      customer_id:customerId,
      items,subtotal:c.subtotal,discount:c.discount,tax:c.tax,total:c.total,
      cogs:items.reduce((s,x)=>s+x.cogs,0)
    };

    // Commit local business state first.
    for(const row of cart){
      const m=menuItem(row.id);if(m)deductRecipe(m,Math.max(1,Number(row.qty||1)),id)
    }
    state.bills.unshift(bill);
    if(customerId){
      const cu=index.customers.get(customerId);
      if(cu){cu.visits=(cu.visits||0)+1;cu.spend=(cu.spend||0)+bill.total}
    }

    const tableId=t?.id||null;
    if(t){
      delete state.tableOrders[t.id];
      t.attention=false;
      t.reservation=null;
    }else{
      state.cart=[];
    }

    audit('sale_completed',`${bill.id} ${bill.payment} ${bill.total}${t?' '+t.name:''}`);
    await persistNow('checkout');

    lastPaidBill=bill;
    activeTableId=null;
    $('tableOrderView').classList.add('hidden');
    $('tableSelectView').classList.remove('hidden');
    renderTableFloor();
    showReceipt(bill);
    setActionStatus(`Payment completed: ${bill.id} · ${rs(bill.total)}`,'good');

    // LAN cleanup must never block checkout.
    if(tableId)Promise.resolve(deleteLanOrder(tableId)).catch(err=>console.error('LAN table cleanup failed',err));
    if(activeSection==='dashboard')renderDashboard();
  }catch(err){
    console.error('Checkout failed',err);
    setActionStatus(`Payment could not complete: ${err?.message||'unknown error'}`,'bad');
    alert(`Payment could not complete: ${err?.message||'unknown error'}`);
  }finally{
    checkoutBusy=false;
    btn.disabled=!posAllowed();
    btn.textContent=oldText;
  }
}
function fillCustomerSelect(){const el=$('posCustomer'),v=currentOrderMeta()?.customerId||el.value;el.innerHTML='<option value="">Walk-in customer</option>'+state.customers.map(c=>`<option value="${c.id}">${esc(c.name)}${c.phone?' · '+esc(c.phone):''}</option>`).join('');if(v)el.value=String(v)}
function openReservation(id){reservationTableId=id;const t=tableById(id),r=t?.reservation||{};$('reservationTitle').textContent=`Reservation · ${t?.name||'Table'}`;$('reservationGuest').value=r.guest||'';$('reservationPhone').value=r.phone||'';$('reservationTime').value=r.time||'';$('reservationParty').value=r.party||t?.seats||'';$('reservationNote').value=r.note||'';$('tableReservationModal').classList.add('show')}
function saveReservation(){const t=tableById(reservationTableId);if(!t)return;if(tableHasOrder(t.id)&&!confirm(`${t.name} already has an open order. Save a reservation anyway?`))return;t.reservation={guest:$('reservationGuest').value.trim(),phone:$('reservationPhone').value.trim(),time:$('reservationTime').value,party:Math.max(1,Number($('reservationParty').value||1)),note:$('reservationNote').value.trim(),createdAt:new Date().toISOString()};audit('table_reserved',`${t.name} ${t.reservation.guest}`);saveSoon();$('tableReservationModal').classList.remove('show');renderTableFloor();if(activeSection==='dashboard')renderDashboard()}
function clearReservation(){const t=tableById(reservationTableId);if(t){t.reservation=null;audit('table_reservation_cleared',t.name);saveSoon()}$('tableReservationModal').classList.remove('show');renderTableFloor();if(activeSection==='dashboard')renderDashboard()}
function toggleTableAttention(id){const t=tableById(id);if(!t)return;t.attention=!t.attention;audit('table_attention',`${t.name}: ${t.attention}`);saveSoon();pushLanAttention(id);if(activeTableId===id)renderPOSWorkspace();else renderTableFloor();if(activeSection==='dashboard')renderDashboard()}
function renderManageTables(){$('manageTableBody').innerHTML=state.tables.map(t=>`<tr><td><b>${esc(t.name)}</b><div class="sub">${t.kind==='floor'?'Floor seating':'Dining table'}</div></td><td><input type="number" min="1" value="${t.seats}" onchange="setTableSeats('${esc(t.id)}',this.value)" style="width:70px"></td><td>${tableVisualStatus(t)}</td><td><input type="checkbox" ${t.active?'checked':''} onchange="setTableActive('${esc(t.id)}',this.checked)"></td><td><button class="btn small alt" onclick="openReservation('${esc(t.id)}')">Reservation</button></td></tr>`).join('')}


function setTableSeats(id,v){const t=tableById(id);if(t){t.seats=Math.max(1,Number(v||1));saveSoon();renderTableFloor()}}
function setTableActive(id,v){const t=tableById(id);if(!t)return;if(!v&&tableHasOrder(id))return alert('Cannot deactivate a table with an open order.');t.active=!!v;saveSoon();renderManageTables();renderTableFloor()}

function receiptHTML(b){const customer=b.customer_id?index.customers.get(b.customer_id):null;return`<div class="print-logo">${esc(state.business.name)}</div><div class="print-subtitle">${esc(state.business.branch)}</div><div class="print-subtitle">Business day managed manually</div><div class="print-title">PAID CUSTOMER RECEIPT</div><div class="print-meta"><div class="print-meta-row"><span>Bill</span><b>${esc(b.id)}</b></div><div class="print-meta-row"><span>Date</span><b>${esc(nptDateTime(b.time))}</b></div><div class="print-meta-row"><span>Order</span><b>${esc(b.type)}${b.ref?' · '+esc(b.ref):''}</b></div><div class="print-meta-row"><span>Payment</span><b>${esc(b.payment)}</b></div>${customer?`<div class="print-meta-row"><span>Customer</span><b>${esc(customer.name)}</b></div>`:''}</div><table class="print-table"><thead><tr><th>Item</th><th class="num">Amount</th></tr></thead><tbody>${b.items.map(x=>`<tr><td><b>${esc(x.name)}</b><div>${x.qty} × ${rs(x.price)}</div></td><td class="num">${rs(x.qty*x.price)}</td></tr>`).join('')}</tbody></table><div class="print-summary"><div class="print-summary-row"><span>Subtotal</span><b>${rs(b.subtotal)}</b></div>${b.discount?`<div class="print-summary-row"><span>Discount</span><b>- ${rs(b.discount)}</b></div>`:''}${b.tax?`<div class="print-summary-row"><span>Tax</span><b>${rs(b.tax)}</b></div>`:''}<div class="print-summary-row total"><span>TOTAL</span><span>${rs(b.total)}</span></div></div><div class="print-footer"><b>Thank you for visiting ${esc(state.business.name)}.</b><br>Generated by TEA AMO Cafe OS</div>`}
function showReceipt(b){$('receipt').innerHTML=receiptHTML(b);$('receiptModal').classList.add('show')}

async function saveOpeningCashNow(){
  const btn=$('saveOpeningCash'),old=btn.textContent;
  btn.disabled=true;btn.textContent='Saving…';
  try{
    const r=dayRecord(),v=Number($('openingCash').value);
    if(!Number.isFinite(v)||v<0)return alert('Enter valid opening cash.');
    if(r.finalized)return alert('This business day is finalized and cannot be changed.');
    const snapshot=clone(state);r.openingCash=v;r.openingCashSet=true;
    audit('opening_cash_saved',`${r.key} ${v}`);
    await persistOrRollback(snapshot,'opening_cash');
    renderDayClose();
    setActionStatus(`Opening cash saved: ${rs(v)}`,'good');
  }catch(err){
    console.error('Opening cash save failed',err);
    setActionStatus('Opening cash could not be saved.','bad');
    alert('Opening cash could not be saved.');
  }finally{
    btn.disabled=false;btn.textContent=old
  }
}
async function finalizeBusinessDay(){
  const btn=$('finalizeDay'),old=btn.textContent;
  btn.disabled=true;btn.textContent='Finalizing…';
  try{
    const r=dayRecord();
    if(r.finalized)return alert('This business day is already finalized.');
    const password=$('closePassword').value;
    if(!await verifyOwnerPassword(password))return alert('Incorrect password.');
    const actual=Number($('actualCash').value);
    if(!Number.isFinite(actual)||actual<0)return alert('Enter actual cash counted.');
    if(!confirm('Finalize and lock this business day?'))return;
    const snapshot=clone(state);r.actualCash=actual;r.note=$('closeNote').value.trim();r.finalized=true;r.finalizedAt=workingNowIso();
    audit('business_day_finalized',r.key);
    await persistOrRollback(snapshot,'finalize_day');
    $('closePassword').value='';
    renderDayClose();updateTop();
    setActionStatus(`Business day ${r.key} finalized.`,'good');
  }catch(err){
    console.error('Finalize day failed',err);
    setActionStatus('Business day could not be finalized.','bad');
    alert('Business day could not be finalized.');
  }finally{
    btn.disabled=false;btn.textContent=old
  }
}

function renderDayClose(){const s=daySummary(),r=s.rec;$('dayControl').innerHTML=`<div class="grid g3"><div class="statbox"><div class="sub">Business Day</div><b>${s.key}</b></div><div class="statbox"><div class="sub">POS</div><b>${posAllowed()?'<span class="good">OPEN</span>':'<span class="bad">CLOSED</span>'}</b></div><div class="statbox"><div class="sub">Closing</div><b>${r.finalized?'<span class="good">FINALIZED</span>':'<span class="warn">OPEN</span>'}</b></div></div>`;$('openingCash').value=r.openingCashSet?r.openingCash:'';const actual=$('actualCash').value===''?null:Number($('actualCash').value);$('cashDiff').textContent=actual===null?'':`Difference if finalized: ${rs(actual-s.expectedCash)}`;$('zLive').innerHTML=`<div class="srow"><span>Orders</span><b>${s.orders}</b></div><div class="srow"><span>Gross sales</span><b>${rs(s.gross)}</b></div><div class="srow"><span>Discount</span><b>- ${rs(s.discount)}</b></div><div class="srow"><span>Tax</span><b>${rs(s.tax)}</b></div><div class="srow total"><span>Net sales</span><span>${rs(s.sales)}</span></div><hr style="border:0;border-top:1px solid var(--line)"><div class="srow"><span>Opening cash</span><b>${rs(r.openingCash||0)}</b></div><div class="srow"><span>Cash sales</span><b>${rs(s.cashSales)}</b></div><div class="srow"><span>Cash expenses</span><b>- ${rs(s.cashExpenses)}</b></div><div class="srow"><span>Cash purchases</span><b>- ${rs(s.cashPurchases)}</b></div><div class="srow total"><span>Expected cash</span><span>${rs(s.expectedCash)}</span></div>`}
function zHTML(){const s=daySummary(),r=s.rec,diff=r.actualCash==null?null:r.actualCash-s.expectedCash;return`<div class="print-logo">${esc(state.business.name)}</div><div class="print-subtitle">${esc(state.business.branch)}</div><div class="print-title">BUSINESS DAY Z-REPORT</div><div class="print-meta"><div class="print-meta-row"><span>Business Day</span><b>${s.key}</b></div><div class="print-meta-row"><span>Status</span><b>${r.finalized?'FINALIZED':'LIVE'}</b></div></div><div class="print-section"><div class="print-section-title">Sales</div><div class="print-summary-row"><span>Orders</span><b>${s.orders}</b></div><div class="print-summary-row"><span>Gross</span><b>${rs(s.gross)}</b></div><div class="print-summary-row"><span>Discount</span><b>- ${rs(s.discount)}</b></div><div class="print-summary-row"><span>Tax</span><b>${rs(s.tax)}</b></div><div class="print-summary-row total"><span>NET SALES</span><span>${rs(s.sales)}</span></div></div><div class="print-section"><div class="print-section-title">Cash Drawer</div><div class="print-summary-row"><span>Opening</span><b>${rs(r.openingCash||0)}</b></div><div class="print-summary-row"><span>Cash sales</span><b>${rs(s.cashSales)}</b></div><div class="print-summary-row"><span>Cash expenses</span><b>- ${rs(s.cashExpenses)}</b></div><div class="print-summary-row"><span>Cash purchases</span><b>- ${rs(s.cashPurchases)}</b></div><div class="print-summary-row"><span>Expected</span><b>${rs(s.expectedCash)}</b></div><div class="print-summary-row"><span>Actual</span><b>${r.actualCash==null?'—':rs(r.actualCash)}</b></div><div class="print-summary-row total"><span>Difference</span><span>${diff==null?'—':rs(diff)}</span></div></div><div class="print-footer">TEA AMO Cafe OS · ${nptDateTime()} NPT</div>`}


function staffMonthHours(s){
  const p=nptParts();
  let sum=state.attendance.filter(a=>a.staff_id===s.id).reduce((z,a)=>{
    const q=nptParts(new Date(a.in||a.out));
    return z+(q.y===p.y&&q.m===p.m?Number(a.hours||0):0)
  },0);
  if(s.clockIn){
    const q=nptParts(new Date(s.clockIn));
    if(q.y===p.y&&q.m===p.m)sum+=(Date.now()-new Date(s.clockIn))/36e5
  }
  return sum
}
let editingStaffId=null;
function renderStaff(){
  const q=($('staffSearch')?.value||'').toLowerCase().trim(),filter=$('staffStatusFilter')?.value||'';
  const list=state.staff.filter(s=>{
    if(filter==='clocked'&&!s.clockIn)return false;
    if(filter==='off'&&s.clockIn)return false;
    if(!q)return true;
    return `${s.name} ${s.role} ${s.phone||''} ${s.email||''} ${s.emergency_name||''} ${s.emergency_phone||''}`.toLowerCase().includes(q)
  });

  const totalHours=state.staff.reduce((sum,s)=>sum+staffMonthHours(s),0);
  const payroll=state.staff.reduce((sum,s)=>sum+staffMonthHours(s)*Number(s.rate||0),0);
  $('staffKpiTotal').textContent=state.staff.length;
  $('staffKpiClocked').textContent=state.staff.filter(s=>s.clockIn).length;
  $('staffKpiHours').textContent=totalHours.toFixed(1)+' h';
  $('staffKpiPayroll').textContent=rs(payroll);

  $('staffCards').innerHTML=list.length?list.map(s=>{
    const h=staffMonthHours(s);
    return `<div class="statbox" style="background:#fff;border:1px solid var(--line)">
      <div class="floor-head" style="margin-bottom:8px">
        <div>
          <div style="font-size:16px;font-weight:900">${esc(s.name)}</div>
          <div class="sub">${esc(s.role)} · ${rs(s.rate)}/hr</div>
        </div>
        <span class="pill ${s.clockIn?'good':''}">${s.clockIn?'CLOCKED IN':'OFF DUTY'}</span>
      </div>
      <div class="srow"><span>Phone</span><b>${esc(s.phone||'—')}</b></div>
      <div class="srow"><span>Email</span><b style="font-size:11px">${esc(s.email||'—')}</b></div>
      <div class="srow"><span>Month hours</span><b>${h.toFixed(2)} h</b></div>
      <div class="srow"><span>Est. pay</span><b>${rs(h*s.rate)}</b></div>
      <div class="srow"><span>Emergency</span><b>${esc(s.emergency_name||'—')}${s.emergency_phone?' · '+esc(s.emergency_phone):''}</b></div><div class="srow"><span>Phone Orders</span><b class="${s.can_take_orders?'good':'muted'}">${s.can_take_orders?'ENABLED':'DISABLED'}</b></div>
      <div class="toolbar" style="margin:10px 0 0">
        <button class="btn small ${s.clockIn?'orange':''}" onclick="toggleClock(${s.id})">${s.clockIn?'Clock Out':'Clock In'}</button>
        <button class="btn small alt" onclick="openAttendanceEditor(null,${s.id})">Add Shift</button>
        <button class="btn small alt" onclick="openStaffProfile(${s.id})">Edit Profile</button>
        ${s.clockIn?`<button class="btn small alt" onclick="editCurrentClockIn(${s.id})">Correct Clock-in</button>`:''}
      </div>
    </div>`
  }).join(''):'<div class="muted">No staff match this filter.</div>';

  $('quickAttendanceList').innerHTML=state.staff.length?state.staff.map(s=>`<div class="floor-list-row">
    <div><b>${esc(s.name)}</b><div class="sub">${esc(s.role)}${s.clockIn?' · since '+nptDateTime(s.clockIn)+' NPT':''}</div></div>
    <button class="btn small ${s.clockIn?'orange':''}" onclick="toggleClock(${s.id})">${s.clockIn?'Clock Out':'Clock In'}</button>
  </div>`).join(''):'<div class="muted">No staff added yet.</div>';

  fillAttendanceFilters();
  renderAttendanceHistory()
}
function openStaffProfile(id=null){
  editingStaffId=id;
  const s=id?state.staff.find(x=>x.id===id):{name:'',role:'Barista',rate:0,phone:'',email:'',address:'',emergency_name:'',emergency_relation:'',emergency_phone:'',notes:'',order_pin:'',can_take_orders:false};
  $('staffProfileTitle').textContent=id?'Edit Staff Profile':'Add Staff';
  $('staffEditName').value=s.name||'';
  $('staffEditRole').value=s.role||'Barista';
  $('staffEditRate').value=s.rate||0;
  $('staffEditPhone').value=s.phone||'';
  $('staffEditEmail').value=s.email||'';$('staffOrderPin').value='';$('staffOrderPin').placeholder=(s.order_pin_hash||s.order_pin)?'Leave blank to keep existing PIN':'4–6 digit PIN';$('staffCanOrder').checked=!!s.can_take_orders;
  $('staffEditAddress').value=s.address||'';
  $('staffEmergencyName').value=s.emergency_name||'';
  $('staffEmergencyRelation').value=s.emergency_relation||'';
  $('staffEmergencyPhone').value=s.emergency_phone||'';
  $('staffEditNotes').value=s.notes||'';
  $('deleteStaffProfile').style.display=id?'inline-block':'none';
  $('staffProfileModal').classList.add('show')
}
async function saveStaffProfile(){
  const name=$('staffEditName').value.trim();if(!name)return alert('Staff name is required.');
  const email=$('staffEditEmail').value.trim();if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return alert('Enter a valid email address.');
  const pin=$('staffOrderPin').value.trim(),canOrder=$('staffCanOrder').checked;
  const existing=editingStaffId?state.staff.find(x=>x.id===editingStaffId):null;
  if(canOrder&&pin&&!/^\d{4,6}$/.test(pin))return alert('Phone ordering PIN must be 4–6 digits.');
  if(canOrder&&!pin&&!existing?.order_pin_hash&&!/^\d{4,6}$/.test(String(existing?.order_pin||'')))return alert('Set a 4–6 digit phone ordering PIN.');
  const values={name,role:$('staffEditRole').value,rate:Math.max(0,Number($('staffEditRate').value||0)),phone:$('staffEditPhone').value.trim(),email,can_take_orders:canOrder,address:$('staffEditAddress').value.trim(),emergency_name:$('staffEmergencyName').value.trim(),emergency_relation:$('staffEmergencyRelation').value.trim(),emergency_phone:$('staffEmergencyPhone').value.trim(),notes:$('staffEditNotes').value.trim()};
  let st;
  if(editingStaffId){st=existing;if(!st)return alert('Staff profile not found.');Object.assign(st,values);audit('staff_profile_updated',st.name)}
  else{st={id:Date.now(),...values,order_pin:'',order_pin_hash:'',order_pin_salt:'',order_pin_iterations:120000,clockIn:null};state.staff.push(st);audit('staff_added',name)}
  if(pin)await setStaffOrderPinCredential(st,pin);else if(canOrder&&st.order_pin&&!st.order_pin_hash)await ensureStaffOrderPinCredential(st);
  if(!canOrder){st.order_pin='';st.order_pin_hash='';st.order_pin_salt='';st.order_pin_iterations=120000}
  rebuildIndex();if(!await persistNow('staff_profile'))return alert('Staff profile could not be saved.');$('staffProfileModal').classList.remove('show');editingStaffId=null;renderStaff();
  Promise.resolve(pushLanConfig()).catch(err=>console.error('Staff phone sync failed',err))
}
async function deleteStaffProfile(){
  if(!editingStaffId)return;
  const s=state.staff.find(x=>x.id===editingStaffId);if(!s)return;
  if(s.clockIn)return alert('Clock this staff member out before deleting.');
  const hasAttendance=state.attendance.some(a=>a.staff_id===s.id);
  if(hasAttendance&&!confirm(`${s.name} has attendance history. Deleting the profile will keep historical attendance records but the name will no longer be linked. Continue?`))return;
  if(!hasAttendance&&!confirm(`Delete ${s.name}?`))return;
  state.staff=state.staff.filter(x=>x.id!==s.id);
  audit('staff_deleted',s.name);
  rebuildIndex();saveSoon();pushLanConfig();$('staffProfileModal').classList.remove('show');editingStaffId=null;renderStaff()
}
function nepaliLocalParts(iso){
  const p=nptParts(new Date(iso));
  return {
    date:`${p.y}-${String(p.m).padStart(2,'0')}-${String(p.d).padStart(2,'0')}`,
    time:`${String(p.h).padStart(2,'0')}:${String(p.min).padStart(2,'0')}`
  }
}
function nptLocalToISO(dateStr,timeStr){
  if(!dateStr||!timeStr)return null;
  const d=new Date(`${dateStr}T${timeStr}:00+05:45`);
  return Number.isNaN(d.getTime())?null:d.toISOString()
}
function attendanceHours(inIso,outIso){
  if(!inIso||!outIso)return 0;
  return Math.max(0,(new Date(outIso)-new Date(inIso))/36e5)
}
function fillAttendanceFilters(){
  const filter=$('attendanceStaffFilter'),edit=$('attendanceEditStaff');
  if(filter){
    const v=filter.value;
    filter.innerHTML='<option value="">All staff</option>'+state.staff.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
    if(v)filter.value=v
  }
  if(edit){
    const v=edit.value;
    edit.innerHTML=state.staff.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
    if(v)edit.value=v
  }
  if($('attendanceMonthFilter')&&!$('attendanceMonthFilter').value){
    const p=nptParts();
    $('attendanceMonthFilter').value=`${p.y}-${String(p.m).padStart(2,'0')}`
  }
}
function renderAttendanceHistory(){
  const body=$('attendanceBody');if(!body)return;
  const sid=$('attendanceStaffFilter').value,month=$('attendanceMonthFilter').value;
  const rows=state.attendance.slice().sort((a,b)=>new Date(b.in)-new Date(a.in)).filter(a=>{
    if(sid&&String(a.staff_id)!==String(sid))return false;
    if(month){
      const p=nepaliLocalParts(a.in);
      if(p.date.slice(0,7)!==month)return false
    }
    return true
  });
  body.innerHTML=rows.map(a=>{
    const s=state.staff.find(x=>x.id===a.staff_id),pi=nepaliLocalParts(a.in),po=nepaliLocalParts(a.out);
    return `<tr>
      <td>${pi.date}</td>
      <td><b>${esc(s?.name||'Unknown staff')}</b></td>
      <td>${pi.time}</td>
      <td>${po.time}</td>
      <td><b>${Number(a.hours||0).toFixed(2)} h</b></td>
      <td>${esc(a.note||'')}</td>
      <td><button class="btn small alt" onclick="openAttendanceEditor(${a.id})">Edit</button></td>
    </tr>`
  }).join('')||'<tr><td colspan="7" class="muted">No attendance records for this filter.</td></tr>'
}
let editingAttendanceId=null;
function openAttendanceEditor(attendanceId=null,staffId=null){
  if(!state.staff.length)return alert('Add a staff member first.');
  editingAttendanceId=attendanceId;
  fillAttendanceFilters();
  let a=attendanceId?state.attendance.find(x=>x.id===attendanceId):null;
  $('attendanceModalTitle').textContent=a?'Edit Attendance Shift':'Add Missed Shift';
  $('deleteAttendanceEdit').style.display=a?'inline-block':'none';
  $('attendanceEditStaff').disabled=!!a;
  if(a){
    const pi=nepaliLocalParts(a.in),po=nepaliLocalParts(a.out);
    $('attendanceEditStaff').value=String(a.staff_id);
    $('attendanceEditDate').value=pi.date;
    $('attendanceEditIn').value=pi.time;
    $('attendanceEditOut').value=po.time;
    $('attendanceEditNote').value=a.note||''
  }else{
    const p=nptParts(),today=`${p.y}-${String(p.m).padStart(2,'0')}-${String(p.d).padStart(2,'0')}`;
    $('attendanceEditStaff').value=String(staffId||state.staff[0].id);
    $('attendanceEditDate').value=today;
    $('attendanceEditIn').value='07:00';
    $('attendanceEditOut').value='16:00';
    $('attendanceEditNote').value=''
  }
  $('attendanceEditPassword').value='';
  updateAttendancePreview();
  $('attendanceModal').classList.add('show')
}
function updateAttendancePreview(){
  const inIso=nptLocalToISO($('attendanceEditDate').value,$('attendanceEditIn').value);
  const outIso=nptLocalToISO($('attendanceEditDate').value,$('attendanceEditOut').value);
  let hrs=attendanceHours(inIso,outIso);
  if(!inIso||!outIso)return $('attendanceEditPreview').innerHTML='<span class="warn">Enter valid clock-in and clock-out times.</span>';
  if(new Date(outIso)<=new Date(inIso))return $('attendanceEditPreview').innerHTML='<span class="bad">Clock-out must be after clock-in.</span>';
  $('attendanceEditPreview').innerHTML=`Shift length: <b>${hrs.toFixed(2)} hours</b> · Monthly hours will update automatically after saving.`
}
async function saveAttendanceCorrection(){
  if(!await verifyOwnerPassword($('attendanceEditPassword').value))return alert('Incorrect owner password.');
  const staffId=Number($('attendanceEditStaff').value),date=$('attendanceEditDate').value;
  const inIso=nptLocalToISO(date,$('attendanceEditIn').value),outIso=nptLocalToISO(date,$('attendanceEditOut').value);
  if(!staffId||!inIso||!outIso)return alert('Complete staff, date, clock-in and clock-out.');
  if(new Date(outIso)<=new Date(inIso))return alert('Clock-out must be after clock-in.');
  const hours=attendanceHours(inIso,outIso);
  if(hours>18&&!confirm(`This shift is ${hours.toFixed(2)} hours long. Save it anyway?`))return;
  // Warn on overlapping completed shifts for the same employee.
  const overlap=state.attendance.find(a=>a.staff_id===staffId&&a.id!==editingAttendanceId&&new Date(inIso)<new Date(a.out)&&new Date(outIso)>new Date(a.in));
  if(overlap&&!confirm('This shift overlaps another attendance record for this staff member. Save anyway?'))return;
  const note=$('attendanceEditNote').value.trim();
  if(editingAttendanceId){
    const a=state.attendance.find(x=>x.id===editingAttendanceId);
    if(!a)return alert('Attendance record no longer exists.');
    const before=`${nptDateTime(a.in)}-${nptDateTime(a.out)}`;
    Object.assign(a,{in:inIso,out:outIso,hours,businessDay:businessDayKey(new Date(inIso)),note,editedAt:new Date().toISOString()});
    audit('attendance_edited',`${state.staff.find(s=>s.id===staffId)?.name||staffId}: ${before} -> ${nptDateTime(inIso)}-${nptDateTime(outIso)}`)
  }else{
    state.attendance.unshift({id:Date.now(),staff_id:staffId,in:inIso,out:outIso,hours,businessDay:businessDayKey(new Date(inIso)),note,manual:true,createdAt:new Date().toISOString()});
    audit('attendance_manual_added',`${state.staff.find(s=>s.id===staffId)?.name||staffId}: ${nptDateTime(inIso)}-${nptDateTime(outIso)}`)
  }
  await dbPut(state);
  $('attendanceModal').classList.remove('show');
  editingAttendanceId=null;
  renderStaff();
  if(activeSection==='dashboard')renderDashboard()
}
async function deleteAttendanceCorrection(){
  if(!editingAttendanceId)return;
  if(!await verifyOwnerPassword($('attendanceEditPassword').value))return alert('Incorrect owner password.');
  const a=state.attendance.find(x=>x.id===editingAttendanceId);if(!a)return;
  const s=state.staff.find(x=>x.id===a.staff_id);
  if(!confirm(`Delete this attendance shift for ${s?.name||'staff'}? Monthly hours will be recalculated.`))return;
  state.attendance=state.attendance.filter(x=>x.id!==editingAttendanceId);
  audit('attendance_deleted',`${s?.name||a.staff_id}: ${nptDateTime(a.in)}-${nptDateTime(a.out)}`);
  await dbPut(state);
  $('attendanceModal').classList.remove('show');editingAttendanceId=null;renderStaff()
}
function editCurrentClockIn(staffId){
  const s=state.staff.find(x=>x.id===staffId);if(!s||!s.clockIn)return;
  const p=nepaliLocalParts(s.clockIn);
  const newTime=prompt(`Correct clock-in time for ${s.name} on ${p.date} (HH:MM, Nepal time):`,p.time);
  if(newTime===null)return;
  const iso=nptLocalToISO(p.date,newTime);
  if(!iso||new Date(iso)>new Date())return alert('Enter a valid time that is not in the future.');
  s.clockIn=iso;
  audit('active_clockin_corrected',`${s.name}: ${p.time} -> ${newTime}`);
  saveSoon();renderStaff()
}
function renderInventoryActive(){({stock:renderInventoryStock,receive:renderReceive,adjust:renderAdjust,stocktake:renderStocktake,usage:renderUsage,history:renderHistory,bulk:renderBulk}[activeInvTab]||renderInventoryStock)()}
function fillIngredientSelect(el,includeAll=false){const v=el.value;el.innerHTML=(includeAll?'<option value="">All ingredients</option>':'')+state.ingredients.filter(i=>i.active).map(i=>`<option value="${esc(i.key)}">${esc(i.name)} (${esc(i.unit)})</option>`).join('');if(v)el.value=v}
function preferredVendor(i){return index.vendors.get(i.preferred_vendor_id)?.name||'—'}
function suggested(i){return Math.max(0,Number(i.target||0)-Number(i.stock||0))}
function renderInventoryStock(){const q=$('stockSearch').value.trim().toLowerCase(),f=$('stockFilter').value;let rows=state.ingredients.filter(i=>!q||i.name.toLowerCase().includes(q)).filter(i=>f==='low'?i.active&&(i.stock<=0||(i.reorder>0&&i.stock<=i.reorder)):f==='out'?i.active&&i.stock<=0:f==='inactive'?!i.active:true).sort((a,b)=>a.name.localeCompare(b.name));$('inventoryBody').innerHTML=rows.map(i=>`<tr><td><b>${esc(i.name)}</b></td><td class="${i.stock<=0?'bad':''}">${Number(i.stock).toFixed(3)}</td><td>${esc(i.unit)}</td><td>${rs(i.avg_cost)}</td><td>${Number(i.reorder||0).toFixed(3)}</td><td>${Number(i.target||0).toFixed(3)}</td><td class="${suggested(i)>0?'warn':''}">${suggested(i).toFixed(3)}</td><td>${esc(preferredVendor(i))}</td><td>${!i.active?'<span class="muted">INACTIVE</span>':i.stock<=0?'<span class="bad">OUT / NEG</span>':i.reorder>0&&i.stock<=i.reorder?'<span class="warn">LOW</span>':'<span class="good">OK</span>'}</td><td><button class="btn small alt" onclick="openIngredientEditor('${esc(i.key)}')">Edit</button> <button class="btn small" onclick="jumpAdjust('${esc(i.key)}')">Adjust</button></td></tr>`).join('');const active=state.ingredients.filter(i=>i.active),low=active.filter(i=>i.stock<=0||(i.reorder>0&&i.stock<=i.reorder));$('invValue').textContent=rs(active.reduce((s,i)=>s+i.stock*i.avg_cost,0));$('invLowCount').textContent=low.length;$('invReorderCount').textContent=active.filter(i=>suggested(i)>0&&(i.stock<=i.reorder||i.stock<=0)).length;$('invActiveCount').textContent=active.length}
function renderReceive(){fillIngredientSelect($('recvIng'));const vv=$('recvVendor').value;$('recvVendor').innerHTML='<option value="">Select vendor</option>'+state.vendors.map(v=>`<option value="${v.id}">${esc(v.name)}</option>`).join('');if(vv)$('recvVendor').value=vv;updateReceivePreview()}
function updateReceivePreview(){const i=ingredient($('recvIng').value),q=Number($('recvQty').value||0),c=Number($('recvTotalCost').value||0);if(!i)return $('receivePreview').textContent='';const ns=i.stock+q,avg=ns?(i.stock*i.avg_cost+c)/ns:0;$('receivePreview').innerHTML=`Current <b>${i.stock.toFixed(3)} ${esc(i.unit)}</b> → After <b>${ns.toFixed(3)} ${esc(i.unit)}</b> · New avg cost <b>${rs(avg)}</b>`}
function renderAdjust(){fillIngredientSelect($('adjustIng'));updateAdjustInfo()}
function updateAdjustInfo(){const i=ingredient($('adjustIng').value);$('adjustInfo').innerHTML=i?`Current: <b>${i.stock.toFixed(3)} ${esc(i.unit)}</b> · Reorder: ${i.reorder} · Target: ${i.target} · Suggested: ${suggested(i).toFixed(3)}`:''}
function renderStocktake(){fillIngredientSelect($('countIng'));updateStocktakePreview()}
function updateStocktakePreview(){const i=ingredient($('countIng').value);if(!i||$('countQty').value==='')return $('stocktakePreview').textContent='';const p=Number($('countQty').value),d=p-i.stock;$('stocktakePreview').innerHTML=`System: <b>${i.stock.toFixed(3)}</b> · Physical: <b>${p.toFixed(3)}</b> · Variance: <b class="${d<0?'bad':d>0?'warn':'good'}">${d.toFixed(3)} ${esc(i.unit)}</b>`}
function usageBills(){const k=$('usagePeriod').value,now=Date.now();if(k==='all')return state.bills;if(k==='today')return dayBills();if(k==='month')return state.bills.filter(b=>sameMonth(b.time));const days=Number(k);return state.bills.filter(b=>Date.now()-new Date(b.time).getTime()<=days*864e5)}
function renderUsage(){const bills=usageBills(),used={};bills.forEach(b=>b.items.forEach(it=>{const m=menuItem(it.id);if(!m)return;recipeFor(m).forEach(r=>used[r.ingredient_key]=(used[r.ingredient_key]||0)+r.qty*it.qty)}));const q=$('usageSearch').value.trim().toLowerCase(),period=$('usagePeriod').value,days=period==='today'?1:period==='month'?Math.max(1,nptParts().d):period==='all'?Math.max(1,new Set(bills.map(b=>businessDayKey(new Date(b.time)))).size):Number(period);const rows=state.ingredients.filter(i=>i.active&&(!q||i.name.toLowerCase().includes(q))).map(i=>{const u=used[i.key]||0,avg=u/days,left=avg>0?i.stock/avg:null;return{i,u,avg,left}}).sort((a,b)=>(a.i.stock<=a.i.reorder?0:1)-(b.i.stock<=b.i.reorder?0:1)||b.u-a.u);$('usageBody').innerHTML=rows.map(r=>`<tr><td><b>${esc(r.i.name)}</b></td><td class="${r.i.stock<=0?'bad':''}">${r.i.stock.toFixed(3)} ${esc(r.i.unit)}</td><td>${r.u.toFixed(3)}</td><td>${r.avg.toFixed(3)}</td><td>${r.left==null?'—':r.left.toFixed(1)}</td><td>${r.i.reorder}</td><td>${r.i.target}</td><td>${suggested(r.i).toFixed(3)}</td><td>${r.i.stock<=0?'<span class="bad">OUT</span>':r.i.reorder>0&&r.i.stock<=r.i.reorder?'<span class="warn">REORDER</span>':'<span class="good">OK</span>'}</td></tr>`).join('')}
function renderHistory(){fillIngredientSelect($('historyIng'),true);const key=$('historyIng').value,reason=$('historyReason').value,q=$('historySearch').value.trim().toLowerCase();const rows=state.inventoryLog.filter(m=>(!key||m.ingredient_key===key)&&(!reason||m.reason===reason)&&(!q||`${m.ref||''} ${m.note||''}`.toLowerCase().includes(q))).slice(0,1000);$('movementBody').innerHTML=rows.map(m=>{const i=ingredient(m.ingredient_key);return`<tr><td>${nptDateTime(m.time)}</td><td>${esc(i?.name||m.ingredient_key)}</td><td class="${m.qty_delta<0?'bad':'good'}">${m.qty_delta>0?'+':''}${Number(m.qty_delta).toFixed(3)}</td><td>${esc(i?.unit||'')}</td><td>${esc(m.reason)}</td><td>${esc(m.note||m.ref||'')}</td></tr>`}).join('')||'<tr><td colspan="6" class="muted">No movements.</td></tr>'}
function renderBulk(){const q=$('bulkSearch').value.trim().toLowerCase();$('bulkInventoryBody').innerHTML=state.ingredients.filter(i=>!q||i.name.toLowerCase().includes(q)).map(i=>`<tr data-key="${esc(i.key)}"><td><input data-f="name" value="${esc(i.name)}" style="min-width:140px"></td><td><input data-f="unit" value="${esc(i.unit)}" style="width:65px"></td><td><input data-f="stock" type="number" step=".001" value="${i.stock}" style="width:85px"></td><td><input data-f="avg_cost" type="number" step=".0001" value="${i.avg_cost}" style="width:85px"></td><td><input data-f="reorder" type="number" step=".001" value="${i.reorder}" style="width:85px"></td><td><input data-f="target" type="number" step=".001" value="${i.target}" style="width:85px"></td><td><select data-f="preferred_vendor_id"><option value="">—</option>${state.vendors.map(v=>`<option value="${v.id}" ${i.preferred_vendor_id===v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select></td><td><input data-f="active" type="checkbox" ${i.active?'checked':''}></td></tr>`).join('')}
let selectedRecipeId=null;
function renderRecipes(){const q=$('recipeSearch').value.trim().toLowerCase();$('recipeList').innerHTML=state.menu.filter(m=>!q||m.name.toLowerCase().includes(q)).map(m=>`<button class="menuitem" onclick="selectRecipe(${m.id})"><b>${esc(m.name)}</b><small>${esc(m.category)}</small><div class="price">Cost ${rs(recipeCost(m))}</div><small>${m.price?((recipeCost(m)/m.price)*100).toFixed(1):0}% food cost</small></button>`).join('');if(selectedRecipeId)drawRecipeEditor()}
function selectRecipe(id){selectedRecipeId=id;drawRecipeEditor()}
function drawRecipeEditor(){const m=menuItem(selectedRecipeId);if(!m)return;$('recipeTitle').textContent=m.name;const rows=recipeFor(m);$('recipeEditor').innerHTML=`<div class="srow"><span>Selling price</span><b>${rs(m.price)}</b></div><div class="srow"><span>Recipe cost</span><b>${rs(recipeCost(m))}</b></div><hr style="border:0;border-top:1px solid var(--line)">`+rows.map((r,ix)=>`<div class="toolbar"><select onchange="recipeIngredient(${ix},this.value)" style="flex:1">${state.ingredients.filter(i=>i.active).map(i=>`<option value="${esc(i.key)}" ${i.key===r.ingredient_key?'selected':''}>${esc(i.name)} (${esc(i.unit)})</option>`).join('')}</select><input type="number" step=".001" min="0" value="${r.qty}" onchange="recipeQty(${ix},this.value)" style="width:100px"><button class="mini" onclick="recipeRemove(${ix})">×</button></div>`).join('')+`<button class="btn alt" onclick="recipeAdd()">+ Ingredient</button>`}
function renderWaste(){fillIngredientSelect($('wasteIng'));$('wasteBody').innerHTML=state.waste.slice(0,500).map(w=>{const i=ingredient(w.ingredient_key);return`<tr><td>${nptDateTime(w.time)}</td><td>${esc(i?.name||'')}</td><td>${w.qty} ${esc(i?.unit||'')}</td><td>${esc(w.reason)}</td><td>${rs(w.cost)}</td></tr>`}).join('')||'<tr><td colspan="5" class="muted">No wastage recorded.</td></tr>'}
function renderVendors(){$('vendorBody').innerHTML=state.vendors.map(v=>`<tr><td><b>${esc(v.name)}</b></td><td>${esc(v.phone||'')}</td><td>${esc(v.email||'')}</td><td>${esc(v.address||'')}</td><td>${esc(v.tax||'')}</td><td>${rs(state.purchases.filter(p=>p.vendor_id===v.id).reduce((s,p)=>s+p.total_cost,0))}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">No vendors.</td></tr>'}
function renderExpenses(){const m=state.expenses.filter(e=>recordBusinessDate(e).slice(0,7)===activeMonthKey()),sum=m.reduce((s,e)=>s+e.amount,0);$('expenseSummary').innerHTML=`<div class="srow total"><span>This month</span><span>${rs(sum)}</span></div>`;$('expenseBody').innerHTML=state.expenses.slice(0,700).map(e=>`<tr><td>${esc(e.date)}</td><td>${esc(e.category)}</td><td>${esc(e.vendor||'')}</td><td>${esc(e.payment||'')}</td><td>${rs(e.amount)}</td><td>${esc(e.note||'')}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">No expenses.</td></tr>'}
function renderCustomers(){
  $('customerBody').innerHTML=state.customers.map(c=>`<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone||'')}</td><td>${esc(c.email||'')}</td><td>${c.visits||0}</td><td>${rs(c.spend||0)}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">No customers.</td></tr>';
  const sel=$('complaintCustomer');if(sel){const keep=sel.value;sel.innerHTML='<option value="">Walk-in / Other customer</option>'+state.customers.map(c=>`<option value="${c.id}">${esc(c.name)}${c.phone?' · '+esc(c.phone):''}</option>`).join('');sel.value=keep;if(!sel.onchange)sel.onchange=()=>{const c=index.customers.get(Number(sel.value));if(c){$('complaintName').value=c.name||'';$('complaintPhone').value=c.phone||''}}}
  const rows=(state.complaints||[]).slice().sort((a,b)=>new Date(b.time)-new Date(a.time));const open=rows.filter(x=>x.status!=='closed').length;if($('complaintOpenBadge'))$('complaintOpenBadge').textContent=`${open} open`;
  if($('complaintBody'))$('complaintBody').innerHTML=rows.map(x=>`<tr><td>${nptDateTime(x.time)}</td><td><b>${esc(x.customer_name||'Walk-in')}</b></td><td>${esc(x.phone||'')}</td><td style="min-width:220px">${esc(x.text||'')}</td><td><span class="complaint-${esc(x.priority||'medium')}">${esc((x.priority||'medium').toUpperCase())}</span></td><td><select onchange="updateComplaintStatus('${esc(String(x.id))}',this.value)"><option value="open" ${x.status==='open'?'selected':''}>Open</option><option value="followup" ${x.status==='followup'?'selected':''}>Follow-up</option><option value="resolved" ${x.status==='resolved'?'selected':''}>Resolved</option><option value="closed" ${x.status==='closed'?'selected':''}>Closed</option></select></td><td><input value="${esc(x.resolution||'')}" placeholder="Resolution note" onchange="updateComplaintResolution('${esc(String(x.id))}',this.value)"></td><td><button class="btn small danger" onclick="deleteComplaint('${esc(String(x.id))}')">Delete</button></td></tr>`).join('')||'<tr><td colspan="8" class="muted">No complaints recorded.</td></tr>';
}
function addCustomerComplaint(){const text=$('complaintText').value.trim();if(!text)return alert('Enter the complaint details.');const cid=Number($('complaintCustomer').value)||null,c=cid?index.customers.get(cid):null;state.complaints=state.complaints||[];state.complaints.unshift({id:'CMP-'+Date.now(),time:workingNowIso(),businessDay:businessDayKey(),customer_id:cid,customer_name:$('complaintName').value.trim()||c?.name||'Walk-in',phone:$('complaintPhone').value.trim()||c?.phone||'',text,priority:$('complaintPriority').value||'medium',status:'open',resolution:$('complaintResolution').value.trim()});$('complaintText').value=$('complaintResolution').value='';audit('customer_complaint',text.slice(0,80));saveSoon();renderCustomers()}
function updateComplaintStatus(id,status){const x=(state.complaints||[]).find(c=>String(c.id)===String(id));if(!x)return;x.status=status;x.updatedAt=new Date().toISOString();saveSoon();renderCustomers()}
function updateComplaintResolution(id,value){const x=(state.complaints||[]).find(c=>String(c.id)===String(id));if(!x)return;x.resolution=value;x.updatedAt=new Date().toISOString();saveSoon()}
function deleteComplaint(id){if(!confirm('Delete this complaint record?'))return;state.complaints=(state.complaints||[]).filter(c=>String(c.id)!==String(id));saveSoon();renderCustomers()}
function renderReports(){
  const bills=state.bills.filter(b=>sameMonth(b.time)),sales=bills.reduce((s,b)=>s+b.total,0),cogs=bills.reduce((s,b)=>s+(b.cogs||0),0),exp=state.expenses.filter(e=>sameMonth(e.date)).reduce((s,e)=>s+e.amount,0);
  $('rSales').textContent=rs(sales);$('rMargin').textContent=rs(sales-cogs);$('rOp').textContent=rs(sales-cogs-exp);
  $('salesBody').innerHTML=state.bills.slice(0,1000).map(b=>`<tr><td>${esc(b.id)}</td><td>${nptDateTime(b.time)}</td><td>${esc(b.type)}</td><td>${paymentDisplayHTML(b)}</td><td>${rs(b.subtotal)}</td><td>${rs(b.discount)}</td><td>${rs(b.tax)}</td><td>${rs(b.total)}</td><td>${rs(b.cogs)}</td><td>${b.non_chargeable?'—':`<button class="btn alt small" type="button" onclick="openPaymentCorrection('${String(b.id).replaceAll("'","\\'")}')">Correct Payment</button>`}</td></tr>`).join('')||'<tr><td colspan="10" class="muted">No sales.</td></tr>';
  const usage=state.tables.map(t=>{
    const all=state.bills.filter(b=>b.table_id===t.id),month=all.filter(b=>sameMonth(b.time));
    const guests=a=>a.reduce((s,b)=>s+Math.max(1,Number(b.guest_count||1)),0);
    const last=all.slice().sort((a,b)=>new Date(b.time)-new Date(a.time))[0];
    return{t,mu:month.length,mg:guests(month),au:all.length,ag:guests(all),last:last?.time||null}
  });
  $('tableVisitsMonth').textContent=usage.reduce((s,x)=>s+x.mu,0);$('tableGuestsMonth').textContent=usage.reduce((s,x)=>s+x.mg,0);
  $('tableVisitsAll').textContent=usage.reduce((s,x)=>s+x.au,0);$('tableGuestsAll').textContent=usage.reduce((s,x)=>s+x.ag,0);
  $('tableUsageBody').innerHTML=usage.map(x=>`<tr><td><b>${esc(x.t.name)}</b></td><td>${x.mu}</td><td>${x.mg}</td><td>${x.au}</td><td>${x.ag}</td><td>${x.au?(x.ag/x.au).toFixed(1):'0.0'}</td><td>${x.last?nptDateTime(x.last):'—'}</td></tr>`).join('')
}

const _renderReportsV3=renderReports;renderReports=function(){_renderReportsV3();requestAnimationFrame(()=>{renderSellerAnalytics();renderItemSalesSummary()})};


let paymentCorrectionBillId=null;
function paymentDisplayText(b){
  if(!b)return '—';
  if(b.payment==='Mixed'&&b.payments){const parts=Object.entries(b.payments).filter(([,v])=>Number(v)>0).map(([k,v])=>`${k} ${rs(v)}`);return parts.length?`Mixed · ${parts.join(' + ')}`:'Mixed'}
  return b.payment||'—'
}
function paymentDisplayHTML(b){
  const txt=esc(paymentDisplayText(b));
  const n=Array.isArray(b.payment_corrections)?b.payment_corrections.length:0;
  return n?`${txt}<div class="sub"><span class="good">Corrected ${n} time${n===1?'':'s'}</span></div>`:txt
}
function billById(id){return state.bills.find(b=>String(b.id)===String(id))}
function openPaymentCorrection(id){
  const b=billById(id);if(!b||b.non_chargeable)return;
  paymentCorrectionBillId=String(id);
  $('paymentCorrectionBillInfo').innerHTML=`<div class="srow"><span>Bill</span><b>${esc(b.id)}</b></div><div class="srow"><span>Date</span><b>${nptDateTime(b.time)}</b></div><div class="srow"><span>Total</span><b>${rs(b.total)}</b></div><div class="srow"><span>Current payment</span><b>${esc(paymentDisplayText(b))}</b></div>${(state.businessDays||[]).find(x=>x.key===recordBusinessDate(b)&&x.finalized)?'<div class="notice warn" style="margin-top:8px">This business day is finalized. The correction will be recorded as a post-close accounting correction and will not alter the sale amount.</div>':''}`;
  const methods=paymentMethods().filter(m=>m.name!=='Mixed'&&m.name!=='Non-Chargeable');
  $('paymentCorrectionMethod').innerHTML=methods.map(m=>`<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('');
  const isMixed=b.payment==='Mixed'&&b.payments&&Object.values(b.payments).filter(v=>Number(v)>0).length>1;
  $('paymentCorrectionMode').value=isMixed?'mixed':'single';
  if(!isMixed&&methods.some(m=>m.name===b.payment))$('paymentCorrectionMethod').value=b.payment;
  $('paymentCorrectionReason').value='';$('paymentCorrectionPassword').value='';
  renderPaymentCorrectionFields();$('paymentCorrectionModal').classList.add('show')
}
function closePaymentCorrection(){paymentCorrectionBillId=null;closeModal('paymentCorrectionModal')}
function renderPaymentCorrectionFields(){
  const b=billById(paymentCorrectionBillId);if(!b)return;
  const mixed=$('paymentCorrectionMode').value==='mixed';
  $('paymentCorrectionSingle').style.display=mixed?'none':'';$('paymentCorrectionMixed').style.display=mixed?'':'none';
  if(!mixed)return;
  const methods=paymentMethods().filter(m=>m.name!=='Mixed'&&m.name!=='Non-Chargeable');
  $('paymentCorrectionMixedFields').innerHTML=methods.map(m=>{const old=Number(b.payments?.[m.name]||0);return `<label>${esc(m.name)}<input class="payment-correction-amount" data-method="${esc(m.name)}" type="number" min="0" step="0.01" value="${old}" oninput="updatePaymentCorrectionPreview()"></label>`}).join('');
  updatePaymentCorrectionPreview()
}
function paymentCorrectionMixedValues(){const out={};document.querySelectorAll('.payment-correction-amount').forEach(el=>{const v=Number(el.value||0);if(v>0)out[el.dataset.method]=v});return out}
function updatePaymentCorrectionPreview(){
  const b=billById(paymentCorrectionBillId),el=$('paymentCorrectionMixedPreview');if(!b||!el)return;
  const vals=paymentCorrectionMixedValues(),applied=Object.values(vals).reduce((a,v)=>a+Number(v||0),0),diff=Number(b.total||0)-applied;
  el.className=`notice ${Math.abs(diff)<.01?'good':'warn'}`;el.innerHTML=`Applied: <b>${rs(applied)}</b> · Bill total: <b>${rs(b.total)}</b> · Difference: <b>${rs(diff)}</b>`
}
async function savePaymentCorrection(){
  const b=billById(paymentCorrectionBillId);if(!b)return alert('Bill could not be found.');
  const reason=$('paymentCorrectionReason').value.trim();if(reason.length<4)return alert('Enter a clear reason for this correction.');
  if(!await verifyOwnerPassword($('paymentCorrectionPassword').value))return alert('Incorrect owner password.');
  const mode=$('paymentCorrectionMode').value,total=Number(b.total||0);let nextPayment='',nextPayments={};
  if(mode==='mixed'){
    nextPayments=paymentCorrectionMixedValues();const applied=Object.values(nextPayments).reduce((a,v)=>a+Number(v||0),0);
    if(Object.keys(nextPayments).length<2)return alert('Mixed payment requires at least two payment methods with an amount greater than zero.');
    if(Math.abs(applied-total)>.01)return alert(`Mixed payment amounts must equal the bill total of ${rs(total)}.`);
    nextPayment='Mixed';
  }else{
    nextPayment=$('paymentCorrectionMethod').value;if(!nextPayment)return alert('Select the correct payment method.');nextPayments={[nextPayment]:total};
  }
  const old={payment:b.payment||'',payments:clone(b.payments||{}),cash_received:Number(b.cash_received||0),change_due:Number(b.change_due||0)};
  const same=old.payment===nextPayment&&JSON.stringify(old.payments||{})===JSON.stringify(nextPayments||{});if(same)return alert('No payment change was made.');
  const snapshot=clone(state),correction={id:newId('PAYCORR'),time:new Date().toISOString(),businessDay:recordBusinessDate(b),reason,old_payment:old.payment,old_payments:old.payments,new_payment:nextPayment,new_payments:clone(nextPayments),bill_total:total};
  b.payment=nextPayment;b.payments=nextPayments;b.cash_received=Number(nextPayments.Cash||0);b.change_due=0;b.payment_corrections=Array.isArray(b.payment_corrections)?b.payment_corrections:[];b.payment_corrections.push(correction);b.last_payment_correction_at=correction.time;
  const day=(state.businessDays||[]).find(x=>x.key===correction.businessDay);if(day){day.paymentCorrectionCount=Number(day.paymentCorrectionCount||0)+1;day.lastPaymentCorrectionAt=correction.time}
  audit('payment_method_corrected',`${b.id} | ${paymentDisplayText({payment:old.payment,payments:old.payments})} -> ${paymentDisplayText(b)} | ${reason}`);
  try{await persistOrRollback(snapshot,'payment_method_correction')}catch(err){return alert(err.message||'Correction could not be saved.');}
  closePaymentCorrection();renderReports();if(activeSection==='dayclose')renderDayClose();if(activeSection==='dailyreport')renderDailyBusinessReport();setActionStatus(`Payment corrected for ${b.id}: ${paymentDisplayText(b)}.`,'good');alert(`Payment correction saved for ${b.id}.\n\nSale total was not changed.\nAudit history was preserved.`)
}
function renderPaymentCorrectionSalesTable(){
  const body=$('salesBody');if(!body)return;
  body.innerHTML=state.bills.slice(0,1000).map(b=>`<tr><td>${esc(b.id)}</td><td>${nptDateTime(b.time)}</td><td>${esc(b.type||'')}</td><td>${paymentDisplayHTML(b)}</td><td>${rs(b.subtotal)}</td><td>${rs(b.discount)}</td><td>${rs(b.tax)}</td><td>${rs(b.total)}</td><td>${rs(b.cogs)}</td><td>${b.non_chargeable?'—':`<button class="btn alt small" type="button" onclick="openPaymentCorrection('${String(b.id).replaceAll("'","\\'")}')">Correct Payment</button>`}</td></tr>`).join('')||'<tr><td colspan="10" class="muted">No sales.</td></tr>'
}
function paymentQrFor(method){
  return state.business?.payment_qr?.[method]||''
}
function updateMainPaymentQr(){
  const method=$('payment')?.value||'Cash',panel=$('mainPaymentQrPanel'),img=$('mainPaymentQrImage'),label=$('mainPaymentQrLabel'),missing=$('mainPaymentQrMissing');
  if(!panel||!img||!label||!missing)return;
  const digital=['eSewa','Khalti','Fonepay'].includes(method);
  panel.classList.toggle('hidden',!digital);
  if(!digital)return;
  label.textContent=`${method} · Scan to Pay`;
  const qr=paymentQrFor(method);
  img.classList.toggle('hidden',!qr);
  missing.classList.toggle('hidden',!!qr);
  if(qr)img.src=qr;else img.removeAttribute('src')
}
async function imageFileToQrData(file){
  if(!file||!file.type.startsWith('image/'))throw new Error('Select an image file.');
  const src=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(file)});
  const im=await new Promise((res,rej)=>{const x=new Image();x.onload=()=>res(x);x.onerror=()=>rej(new Error('Invalid image'));x.src=src});
  const max=640,scale=Math.min(1,max/Math.max(im.width,im.height)),w=Math.max(1,Math.round(im.width*scale)),h=Math.max(1,Math.round(im.height*scale));
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(im,0,0,w,h);
  return c.toDataURL('image/jpeg',0.88)
}
function renderQrSettings(){
  const map=[['eSewa','qrPreviewESewa'],['Khalti','qrPreviewKhalti'],['Fonepay','qrPreviewFonepay']];
  for(const [method,id] of map){
    const el=$(id),qr=paymentQrFor(method);if(!el)continue;
    el.classList.toggle('hidden',!qr);if(qr)el.src=qr;else el.removeAttribute('src')
  }
}
async function setPaymentQr(method,file){
  try{
    const data=await imageFileToQrData(file);
    state.business.payment_qr=state.business.payment_qr||{};
    state.business.payment_qr[method]=data;
    await persistNow('payment_qr');
    renderQrSettings();updateMainPaymentQr();
    Promise.resolve(pushLanConfig()).catch(()=>{});
    setActionStatus(`${method} QR saved.`,'good')
  }catch(err){alert(err?.message||'Could not save QR image.')}
}
async function clearPaymentQr(method){
  state.business.payment_qr=state.business.payment_qr||{};
  state.business.payment_qr[method]='';
  await persistNow('payment_qr_clear');
  renderQrSettings();updateMainPaymentQr();
  Promise.resolve(pushLanConfig()).catch(()=>{});
  setActionStatus(`${method} QR removed.`,'good')
}

function renderSettings(){
  $('businessName').value=state.business.name;
  $('branchName').value=state.business.branch;
  $('currency').value=state.business.currency;
  $('taxRate').value=state.business.taxRate;
  renderQrSettings()
}


function download(name,text,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function exportRows(name,headers,rows){download(name,[headers,...rows].map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n'),'text/csv')}
function inventoryPrintHTML(){const rows=state.ingredients.filter(i=>i.active).sort((a,b)=>a.name.localeCompare(b.name));return`<div class="print-logo">${esc(state.business.name)}</div><div class="print-subtitle">${esc(state.business.branch)}</div><div class="print-title">INVENTORY STOCK REPORT</div><div class="print-meta-row"><span>Generated</span><b>${nptDateTime()} NPT</b></div><table class="print-table"><thead><tr><th>Ingredient</th><th class="num">Stock</th><th class="num">Reorder</th><th class="num">Target</th><th class="num">Suggested</th></tr></thead><tbody>${rows.map(i=>`<tr><td>${esc(i.name)}</td><td class="num">${i.stock.toFixed(3)} ${esc(i.unit)}</td><td class="num">${i.reorder}</td><td class="num">${i.target}</td><td class="num">${suggested(i).toFixed(3)}</td></tr>`).join('')}</tbody></table>`}
function openIngredientEditor(key=null){editingIngredientKey=key;const i=key?ingredient(key):{name:'',unit:'g',stock:0,avg_cost:0,reorder:0,target:0,shelf_life_days:0,preferred_vendor_id:null,notes:'',active:true,location:inventoryArea};$('ingredientModalTitle').textContent=key?'Edit Ingredient':'Add Ingredient';$('editIngName').value=i.name;$('editIngUnit').value=i.unit;$('editIngStock').value=i.stock;$('editIngCost').value=i.avg_cost;$('editIngReorder').value=i.reorder;$('editIngTarget').value=i.target;$('editIngShelfLife').value=i.shelf_life_days||0;$('editIngLocation').value=i.location||guessInventoryLocation(i.name);$('editIngNotes').value=i.notes||'';$('editIngActive').checked=i.active!==false;$('editIngVendor').innerHTML='<option value="">No preferred vendor</option>'+state.vendors.map(v=>`<option value="${v.id}">${esc(v.name)}</option>`).join('');$('editIngVendor').value=i.preferred_vendor_id||'';$('ingredientModal').classList.add('show')}
function jumpAdjust(key){activeInvTab='adjust';document.querySelectorAll('.invtab').forEach(x=>x.classList.add('hidden'));$('inv-adjust').classList.remove('hidden');document.querySelectorAll('#inventoryTabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='adjust'));renderAdjust();$('adjustIng').value=key;updateAdjustInfo()}
function updateStaffRate(id,v){const s=state.staff.find(x=>x.id===id);if(!s)return;s.rate=Number(v||0);audit('hourly_rate_changed',s.name);saveSoon();renderStaff()}
function toggleClock(id){const s=state.staff.find(x=>x.id===id);if(!s)return;if(s.clockIn){const out=workingNowIso(),hours=Math.max(0,(new Date(out)-new Date(s.clockIn))/36e5);state.attendance.unshift({id:Date.now(),staff_id:id,in:s.clockIn,out,hours,businessDay:businessDayKey(new Date(s.clockIn)),note:'',manual:false,createdAt:workingNowIso()});s.clockIn=null}else s.clockIn=workingNowIso();audit(s.clockIn?'clock_in':'clock_out',s.name);saveSoon();renderStaff()}
function recipeIngredient(ix,key){const m=menuItem(selectedRecipeId);state.recipes[m.name][ix].ingredient_key=key;index.recipeCost.clear();saveSoon();drawRecipeEditor()}
function recipeQty(ix,v){const m=menuItem(selectedRecipeId);state.recipes[m.name][ix].qty=Number(v||0);index.recipeCost.clear();saveSoon();drawRecipeEditor()}
function recipeRemove(ix){const m=menuItem(selectedRecipeId);state.recipes[m.name].splice(ix,1);index.recipeCost.clear();saveSoon();drawRecipeEditor()}
function recipeAdd(){const m=menuItem(selectedRecipeId);state.recipes[m.name].push({ingredient_key:state.ingredients[0].key,qty:0});saveSoon();drawRecipeEditor()}

async function getLanNetworkInfo(){
  if(!LAN_ENABLED)throw new Error('LAN server is not active');
  const r=await fetch('/api/network',{cache:'no-store'});
  if(!r.ok)throw new Error('network');
  return r.json()
}
async function refreshStaffUrlUI(){
  try{
    const d=await getLanNetworkInfo();
    const u=(d.staff_urls||[])[0]||'';
    if($('lanStaffUrl'))$('lanStaffUrl').textContent=u||'Wi-Fi address not detected';
    return u
  }catch{
    if($('lanStaffUrl'))$('lanStaffUrl').textContent='—';
    return ''
  }
}


function receivePurchaseNow(){
  const vid=Number($('recvVendor').value),i=ingredient($('recvIng').value),q=Number($('recvQty').value),cost=Number($('recvTotalCost').value);
  if(!vid||!i||!(q>0)||cost<0)return alert('Complete vendor, ingredient, quantity and cost.');
  const oldValue=i.stock*i.avg_cost,newStock=i.stock+q;i.avg_cost=newStock?(oldValue+cost)/newStock:0;i.stock=newStock;
  const p={id:Date.now(),time:workingNowIso(),businessDay:businessDayKey(),vendor_id:vid,ingredient_key:i.key,qty:q,total_cost:cost,payment:$('recvPayment').value,invoice:$('recvInvoice').value.trim(),expiry:$('recvExpiry').value};
  state.purchases.unshift(p);state.inventoryLog.unshift({id:Date.now()+1,time:p.time,ingredient_key:i.key,qty_delta:q,reason:'purchase',ref:p.invoice||p.id,note:index.vendors.get(vid)?.name||''});
  index.recipeCost.clear();$('recvQty').value=$('recvTotalCost').value=$('recvInvoice').value=$('recvExpiry').value='';saveSoon();renderReceive();setActionStatus('Purchase received.','good')
}
function postAdjustmentNow(){
  const i=ingredient($('adjustIng').value),q=Number($('adjustQty').value),mode=$('adjustMode').value;if(!i||!Number.isFinite(q)||q<0)return alert('Enter a valid quantity.');
  const old=i.stock;if(mode==='add')i.stock+=q;else if(mode==='subtract')i.stock-=q;else i.stock=q;
  state.inventoryLog.unshift({id:Date.now(),time:new Date().toISOString(),ingredient_key:i.key,qty_delta:i.stock-old,reason:'manual_adjustment',note:`${$('adjustReason').value}: ${$('adjustNote').value.trim()}`});
  $('adjustQty').value=$('adjustNote').value='';saveSoon();updateAdjustInfo();setActionStatus('Inventory adjustment posted.','good')
}
function postStocktakeNow(){
  const i=ingredient($('countIng').value),p=Number($('countQty').value);if(!i||!Number.isFinite(p)||p<0)return alert('Enter physical quantity.');
  const d=p-i.stock;i.stock=p;state.inventoryLog.unshift({id:Date.now(),time:new Date().toISOString(),ingredient_key:i.key,qty_delta:d,reason:'stocktake',note:$('countReason').value.trim()});
  $('countQty').value=$('countReason').value='';saveSoon();updateStocktakePreview();setActionStatus('Stocktake posted.','good')
}
function postWasteNow(){
  const i=ingredient($('wasteIng').value),q=Number($('wasteQty').value);if(!i||!(q>0))return alert('Enter waste quantity.');
  i.stock-=q;const w={id:Date.now(),time:workingNowIso(),businessDay:businessDayKey(),ingredient_key:i.key,qty:q,reason:$('wasteReason').value,note:$('wasteNote').value.trim(),cost:q*i.avg_cost};
  state.waste.unshift(w);state.inventoryLog.unshift({id:Date.now()+1,time:w.time,ingredient_key:i.key,qty_delta:-q,reason:'waste',ref:w.id,note:w.reason});
  $('wasteQty').value=$('wasteNote').value='';saveSoon();renderWaste();setActionStatus('Wastage recorded.','good')
}
function saveBusinessNow(){
  state.business={...state.business,name:$('businessName').value.trim()||'TEA AMO',branch:$('branchName').value.trim()||'Main Branch',currency:$('currency').value.trim()||'Rs',taxRate:Number($('taxRate').value||0)};
  saveSoon();renderSettings();updateTop();setActionStatus('Business settings saved.','good')
}

function fallbackAddExpense(){const amt=Number($('expenseAmount').value);if(!(amt>0))return alert('Enter amount.');state.expenses.unshift({id:Date.now(),date:$('expenseDate').value||businessDayKey(),businessDay:businessDayKey(),category:$('expenseCategory').value,vendor:$('expenseVendor').value.trim(),payment:$('expensePayment').value,amount:amt,ref:$('expenseRef').value.trim(),note:$('expenseNote').value.trim()});$('expenseAmount').value=$('expenseVendor').value=$('expenseRef').value=$('expenseNote').value='';saveSoon();renderExpenses()}
function fallbackAddCustomer(){const name=$('custName').value.trim();if(!name)return alert('Customer name is required.');state.customers.push({id:Date.now(),name,phone:$('custPhone').value.trim(),email:$('custEmail').value.trim(),visits:0,spend:0});rebuildIndex();$('custName').value=$('custPhone').value=$('custEmail').value='';saveSoon();renderCustomers()}
function fallbackAddVendor(){const name=$('vendorName').value.trim();if(!name)return alert('Vendor name is required.');state.vendors.push({id:Date.now(),name,phone:$('vendorPhone').value.trim(),email:$('vendorEmail').value.trim(),address:$('vendorAddress').value.trim(),tax:$('vendorTax').value.trim()});rebuildIndex();['vendorName','vendorPhone','vendorEmail','vendorAddress','vendorTax'].forEach(id=>$(id).value='');saveSoon();renderVendors()}
function installCriticalFallbacks(){const map={openAddStaff:()=>openStaffProfile(),saveStaffProfile:()=>saveStaffProfile(),newIngredient:()=>openIngredientEditor(),addExpense:()=>fallbackAddExpense(),addCustomer:()=>fallbackAddCustomer(),addVendor:()=>fallbackAddVendor(),backToTables:()=>backToTables(),checkout:()=>checkout(),openCounterOrder:()=>openCounter()};for(const [id,fn] of Object.entries(map)){const el=$(id);if(el&&typeof el.onclick!=='function')el.onclick=fn}}


// ===== OWNER WORKING-DATE MODE =====
let ownerWorkingDate=null;
let ownerWorkingDateUnlocked=false;
let ownerDateLiveWorkspace=null;
const ownerDateWorkspaces={};
const realBusinessDayKey=businessDayKey;
const realDayBills=dayBills;
const realSameMonth=sameMonth;
function currentRealBusinessDate(){return realBusinessDayKey(new Date())}
function selectedWorkingDate(){return ownerWorkingDateUnlocked&&ownerWorkingDate?ownerWorkingDate:null}
function workingDateParts(){const key=selectedWorkingDate()||currentRealBusinessDate(),a=key.split('-').map(Number);return{y:a[0],m:a[1],d:a[2]}}
function workingNowIso(){
  if(!selectedWorkingDate())return new Date().toISOString();
  const p=nptParts(new Date()),hh=String(p.h).padStart(2,'0'),mm=String(p.min).padStart(2,'0'),ss=String(p.s).padStart(2,'0');
  return new Date(`${ownerWorkingDate}T${hh}:${mm}:${ss}+05:45`).toISOString();
}
function recordBusinessDate(x){
  if(!x)return'';
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(x.businessDay||'')))return String(x.businessDay);
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(x.date||'')))return String(x.date);
  const ts=x.time||x.createdAt||x.in||x.out;
  return ts?realBusinessDayKey(new Date(ts)):'';
}
function monthKeyForRecord(x){const k=recordBusinessDate(x);return k?k.slice(0,7):''}
function activeMonthKey(){const p=workingDateParts();return`${p.y}-${String(p.m).padStart(2,'0')}`}
function activeYear(){return workingDateParts().y}
function activeDateKey(){return selectedWorkingDate()||currentRealBusinessDate()}

businessDayKey=function(d){
  if(arguments.length===0&&selectedWorkingDate())return ownerWorkingDate;
  return realBusinessDayKey(d===undefined?new Date():d)
};
dayBills=function(key=businessDayKey()){return state.bills.filter(b=>recordBusinessDate(b)===key)};
sameMonth=function(ts){
  const key=typeof ts==='object'&&ts?recordBusinessDate(ts):realBusinessDayKey(new Date(ts));
  return key.slice(0,7)===activeMonthKey();
};

function updateWorkingDateUI(){
  const active=!!selectedWorkingDate(),key=active?ownerWorkingDate:currentRealBusinessDate();
  document.body.classList.toggle('historical-date-mode',active&&key!==currentRealBusinessDate());
  const banner=$('workDateBanner');if(banner)banner.classList.toggle('show',active&&key!==currentRealBusinessDate());
  if($('workDateBannerTitle'))$('workDateBannerTitle').textContent=`Working on ${formatReportDate(key)} (${key})`;
  if($('workDateState')){$('workDateState').textContent=active?`ACTIVE · Entire system working on ${formatReportDate(key)}`:'Today / normal operation';$('workDateState').classList.toggle('active',active)}
  if($('exitWorkDateBtn'))$('exitWorkDateBtn').disabled=!active;
  if($('activateWorkDateBtn'))$('activateWorkDateBtn').textContent=active?'🔒 Change Working Date':'🔒 Work on Selected Date';
}
function requestWorkingDateMode(){
  const key=$('dailyReportDate')?.value||dailyReportSelectedDate||ymdToday();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return alert('Select a valid date first.');
  if($('workDateConfirmLabel'))$('workDateConfirmLabel').textContent=`Selected date: ${formatReportDate(key)} (${key})`;
  if($('workDatePassword'))$('workDatePassword').value='';
  $('workDateModal')?.classList.add('show');setTimeout(()=>$('workDatePassword')?.focus(),60)
}
async function confirmWorkingDateMode(){
  const key=$('dailyReportDate')?.value||dailyReportSelectedDate||ymdToday(),pass=$('workDatePassword')?.value||'';
  if(!await verifyOwnerPassword(pass))return alert('Incorrect owner password.');
  const realKey=currentRealBusinessDate(),wasHistorical=!!selectedWorkingDate()&&ownerWorkingDate!==realKey;
  // Preserve today's open POS workspace before entering a historical day.
  if(!ownerDateLiveWorkspace&&key!==realKey){ownerDateLiveWorkspace={cart:clone(state.cart||[]),tableOrders:clone(state.tableOrders||{}),activeTableId:activeTableId||null}}
  // If switching away from another historical day, keep that temporary open workspace in memory.
  if(wasHistorical&&ownerWorkingDate&&ownerWorkingDate!==key){ownerDateWorkspaces[ownerWorkingDate]={cart:clone(state.cart||[]),tableOrders:clone(state.tableOrders||{})}}
  ownerWorkingDate=key;ownerWorkingDateUnlocked=true;
  if(key!==realKey){const ws=ownerDateWorkspaces[key]||{cart:[],tableOrders:{}};state.cart=clone(ws.cart||[]);state.tableOrders=clone(ws.tableOrders||{});activeTableId=null}
  try{sessionStorage.setItem('teaAmoWorkingDate',key)}catch{}
  closeModal('workDateModal');
  audit('owner_working_date_enabled',key);
  updateWorkingDateUI();
  if($('expenseDate'))$('expenseDate').value=key;
  const [y,m]=key.split('-');if($('sellerDate'))$('sellerDate').value=key;if($('sellerMonth'))$('sellerMonth').value=`${y}-${m}`;
  if($('incomeMonthSelect'))$('incomeMonthSelect').value=String(Number(m));if($('incomeMonthYearSelect'))$('incomeMonthYearSelect').value=y;if($('incomeYearSelect'))$('incomeYearSelect').value=y;
  await persistNow('working_date_enabled');
  renderActive();
  setActionStatus(`Owner date mode active: TEA AMO is now working on ${key}.`,'warn')
}
async function exitWorkingDateMode(){
  const old=ownerWorkingDate,realKey=currentRealBusinessDate();
  if(old&&old!==realKey)ownerDateWorkspaces[old]={cart:clone(state.cart||[]),tableOrders:clone(state.tableOrders||{})};
  ownerWorkingDate=null;ownerWorkingDateUnlocked=false;
  if(ownerDateLiveWorkspace){state.cart=clone(ownerDateLiveWorkspace.cart||[]);state.tableOrders=clone(ownerDateLiveWorkspace.tableOrders||{});activeTableId=ownerDateLiveWorkspace.activeTableId||null;ownerDateLiveWorkspace=null}
  try{sessionStorage.removeItem('teaAmoWorkingDate')}catch{}
  audit('owner_working_date_disabled',old||'');updateWorkingDateUI();
  if($('expenseDate'))$('expenseDate').value=currentRealBusinessDate();
  await persistNow('working_date_disabled');
  renderActive();setActionStatus('Returned to today / normal operation.','good')
}

// Historical owner mode may select an old date, but finalized/closed days remain immutable.
const normalPosAllowed=posAllowed;
posAllowed=function(){const r=dayRecord();return !r.finalized&&!r.posClosed};
isCafeOpen=function(){const r=dayRecord();return !r.finalized&&!r.posClosed};

// Keep the dashboard and analytics anchored to the selected working date/month.
currentMonthTotals=function(){
  const mk=activeMonthKey(),bills=state.bills.filter(b=>!b.non_chargeable&&recordBusinessDate(b).slice(0,7)===mk),sales=bills.reduce((s,b)=>s+Number(b.total||0),0),cogs=bills.reduce((s,b)=>s+Number(b.cogs||0),0);
  const exp=state.expenses.filter(e=>recordBusinessDate(e).slice(0,7)===mk).reduce((s,e)=>s+Number(e.amount||0),0);
  const waste=state.waste.filter(w=>recordBusinessDate(w).slice(0,7)===mk).reduce((s,w)=>s+Number(w.cost||0),0);
  const pay=state.attendance.filter(a=>recordBusinessDate(a).slice(0,7)===mk).reduce((sum,a)=>{const st=state.staff.find(x=>x.id===a.staff_id);return sum+Number(a.hours||0)*Number(st?.rate||0)},0);
  return{sales,cogs,exp,pay,waste}
};
availableSalesYears=function(){const years=new Set([activeYear()]);state.bills.forEach(b=>{const k=recordBusinessDate(b);if(k)years.add(Number(k.slice(0,4)))});return[...years].sort((a,b)=>b-a)};
localYMD=function(ts){const k=typeof ts==='object'&&ts?recordBusinessDate(ts):realBusinessDayKey(new Date(ts)),a=k.split('-').map(Number);return{y:a[0],m:a[1],d:a[2]}};
renderDashboardCharts=function(){
  syncIncomeSelectors();const wp=workingDateParts(),m=Number($('incomeMonthSelect')?.value||wp.m),my=Number($('incomeMonthYearSelect')?.value||wp.y),y=Number($('incomeYearSelect')?.value||wp.y),days=new Date(my,m,0).getDate(),daily=Array(days).fill(0);
  chargeableBills().forEach(b=>{const d=recordBusinessDate(b).split('-').map(Number);if(d[0]===my&&d[1]===m)daily[d[2]-1]+=Number(b.total||0)});
  drawLineChart('dailyIncomeChart',Array.from({length:days},(_,i)=>i+1),daily);if($('dailyIncomeTotal'))$('dailyIncomeTotal').textContent=rs(daily.reduce((a,b)=>a+b,0));
  const yearly=Array(12).fill(0);chargeableBills().forEach(b=>{const d=recordBusinessDate(b).split('-').map(Number);if(d[0]===y)yearly[d[1]-1]+=Number(b.total||0)});
  drawLineChart('yearIncomeChart',['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],yearly);if($('yearIncomeTotal'))$('yearIncomeTotal').textContent=rs(yearly.reduce((a,b)=>a+b,0))
};
itemSalesRows=function(period='daily'){
  const wp=workingDateParts(),map=new Map();let targetY=wp.y,targetM=wp.m,targetD=wp.d;
  if(period==='daily'&&$('sellerDate')?.value){const [y,m,d]=$('sellerDate').value.split('-').map(Number);targetY=y;targetM=m;targetD=d}
  if(period==='monthly'&&$('sellerMonth')?.value){const [y,m]=$('sellerMonth').value.split('-').map(Number);targetY=y;targetM=m}
  state.bills.filter(b=>!b.non_chargeable).forEach(b=>{const [y,m,d]=recordBusinessDate(b).split('-').map(Number),ok=period==='daily'?(y===targetY&&m===targetM&&d===targetD):(y===targetY&&m===targetM);if(!ok)return;(b.items||[]).forEach(it=>{const name=it.name||menuItem(it.id)?.name||'Unknown',qty=Number(it.qty||0),price=Number(it.price??menuItem(it.id)?.price??0),cur=map.get(name)||{name,qty:0,revenue:0};cur.qty+=qty;cur.revenue+=qty*price;map.set(name,cur)})});return[...map.values()]
};
syncSellerControls=function(){const p=workingDateParts(),date=$('sellerDate'),month=$('sellerMonth'),period=$('sellerPeriod')?.value||'daily',dk=`${p.y}-${String(p.m).padStart(2,'0')}-${String(p.d).padStart(2,'0')}`;if(date&&(!date.value||selectedWorkingDate()))date.value=dk;if(month&&(!month.value||selectedWorkingDate()))month.value=`${p.y}-${String(p.m).padStart(2,'0')}`;if(date)date.style.display=period==='daily'?'':'none';if(month)month.style.display=period==='monthly'?'':'none'};
diningBillsByPeriod=function(){const p=$('diningPeriod')?.value||'30',anchor=parseYMDLocal(activeDateKey()).getTime()+12*36e5;return state.bills.filter(b=>b.table_id&&b.dining_session_complete&&Number.isFinite(Number(b.dining_minutes))).filter(b=>{if(p==='all')return true;if(p==='today')return recordBusinessDate(b)===activeDateKey();const t=parseYMDLocal(recordBusinessDate(b)).getTime()+12*36e5;return anchor-t>=0&&anchor-t<=Number(p)*864e5})};

// Use selected working date for new operational records while keeping unique IDs based on real clock.
const _ensureTableOrderWD=ensureTableOrder;
ensureTableOrder=function(id){const o=_ensureTableOrderWD(id);return o};
const _saveCurrentOrderUIWD=saveCurrentOrderUI;
saveCurrentOrderUI=function(){const o=currentOrderMeta();if(o&&!o.openedAt&&o.cart?.length)o.openedAt=workingNowIso();return _saveCurrentOrderUIWD()};

// Daily report UI reflects whether the date is controlling the system.
const _renderDailyBusinessReportWD=renderDailyBusinessReport;
renderDailyBusinessReport=function(){_renderDailyBusinessReportWD();updateWorkingDateUI()};
const _updateTopWD=updateTop;
updateTop=function(){_updateTopWD();const key=businessDayKey(),real=currentRealBusinessDate();if($('clockText'))$('clockText').textContent=`${nptDateTime()} NPT · ${selectedWorkingDate()?'Working date':'Business day'} ${key}${selectedWorkingDate()&&key!==real?' · OWNER EDIT MODE':''}`;updateWorkingDateUI()};
// ===== END OWNER WORKING-DATE MODE =====

function withTimeout(promise,ms,fallback=null){
  return Promise.race([
    Promise.resolve(promise).catch(()=>fallback),
    new Promise(resolve=>setTimeout(()=>resolve(fallback),ms))
  ])
}
async function init(){
  state=repairState(freshState());
  rebuildIndex();
  document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>hardNav(b.dataset.sec));
  installCriticalFallbacks();
  try{renderActive()}catch(err){console.error('Initial UI error',err)}

  const serverLoaded=await withTimeout(serverStateGet(),30000,null);
  let browserLoaded=await withTimeout(dbGet(),1200,null);
  if(!browserLoaded){try{browserLoaded=JSON.parse(localStorage.getItem(DB_NAME)||'null')}catch{}}
  if(!browserLoaded){try{const legacy=JSON.parse(localStorage.getItem(LEGACY_KEY)||'null');if(legacy)browserLoaded=legacyToNew(legacy)}catch{}}
  const stamp=x=>{const t=Date.parse(x?.stateUpdatedAt||'');return Number.isFinite(t)?t:0};
  let loaded=browserLoaded||serverLoaded;
  if(serverLoaded&&browserLoaded){
    if(serverLoaded.setup&&!browserLoaded.setup)loaded=serverLoaded;
    else if(browserLoaded.setup&&!serverLoaded.setup)loaded=browserLoaded;
    else loaded=stamp(browserLoaded)>=stamp(serverLoaded)?browserLoaded:serverLoaded;
  }
  if(loaded){state=repairState(loaded);rebuildIndex()}
  ownerWorkingDate=null;ownerWorkingDateUnlocked=false;try{sessionStorage.removeItem('teaAmoWorkingDate')}catch{}
  updateWorkingDateUI();

  if(loaded)Promise.resolve(persistNow('startup_sync')).catch(err=>console.error('Background save error',err));
  document.querySelectorAll('#inventoryTabs button').forEach(b=>b.onclick=()=>{activeInvTab=b.dataset.tab;document.querySelectorAll('.invtab').forEach(x=>x.classList.toggle('hidden',x.id!==`inv-${activeInvTab}`));document.querySelectorAll('#inventoryTabs button').forEach(x=>x.classList.toggle('active',x===b));renderInventoryActive()});
  window.addEventListener('resize',debounce(()=>{if(activeSection==='dashboard')renderDashboardCharts();if(activeSection==='reports')renderSellerAnalytics()},120));
  $('menuSearch').oninput=debounce(renderMenu,60);$('catFilter').onchange=renderMenu;
  $('discountType').onchange=()=>{saveCurrentOrderUI();renderCart()};$('discountValue').oninput=()=>{saveCurrentOrderUI();renderCart()};
  $('posCustomer').onchange=saveCurrentOrderUI;$('orderRef').onchange=saveCurrentOrderUI;$('orderType').onchange=saveCurrentOrderUI;$('guestCount').onchange=saveCurrentOrderUI;$('payment').onchange=updateMainPaymentQr;
  $('clearCart').onclick=()=>{const cart=currentCart();if(cart.length&&!confirm('Clear this open order?'))return;cart.splice(0,cart.length);const o=currentOrderMeta();if(o)o.openedAt=null;saveCurrentOrderUI();saveSoon();if(activeTableId&&activeTableId!=='counter')deleteLanOrder(activeTableId);renderCart()};
  $('checkout').onclick=checkout;
  $('openCounterOrder').onclick=openCounter;$('backToTables').onclick=backToTables;
  $('tableReserveBtn').onclick=()=>{if(activeTableId&&activeTableId!=='counter')openReservation(activeTableId)};
  $('tableAttentionBtn').onclick=()=>{if(activeTableId&&activeTableId!=='counter')toggleTableAttention(activeTableId)};
  $('manageTablesBtn').onclick=()=>{renderManageTables();$('tableManageModal').classList.add('show')};
  $('closeTableManage').onclick=()=>$('tableManageModal').classList.remove('show');
  $('saveReservationBtn').onclick=saveReservation;$('clearReservationBtn').onclick=clearReservation;$('closeReservationBtn').onclick=()=>$('tableReservationModal').classList.remove('show');
  $('printReceipt').onclick=()=>window.print();$('closeReceipt').onclick=()=>$('receiptModal').classList.remove('show');
  
  $('actualCash').oninput=renderDayClose;
  $('printZ').onclick=()=>{$('zPrint').innerHTML=zHTML();$('zModal').classList.add('show')};$('exportZ').onclick=()=>{const s=daySummary();exportRows(`TEA_AMO_Z_${s.key}.csv`,['metric','value'],[['orders',s.orders],['gross',s.gross],['discount',s.discount],['tax',s.tax],['sales',s.sales],['expected_cash',s.expectedCash]])};
  
  $('staffSearch').oninput=debounce(renderStaff,70);
  $('staffStatusFilter').onchange=renderStaff;
  
  
  
  $('attendanceStaffFilter').onchange=renderAttendanceHistory;
  $('attendanceMonthFilter').onchange=renderAttendanceHistory;
  $('attendanceEditDate').onchange=updateAttendancePreview;
  $('attendanceEditIn').oninput=updateAttendancePreview;
  $('attendanceEditOut').oninput=updateAttendancePreview;
  $('saveAttendanceEdit').onclick=saveAttendanceCorrection;
  $('deleteAttendanceEdit').onclick=deleteAttendanceCorrection;
  $('cancelAttendanceEdit').onclick=()=>{$('attendanceModal').classList.remove('show');editingAttendanceId=null};
  $('exportAttendance').onclick=()=>exportRows('tea-amo-attendance.csv',
    ['staff','phone','email','clock_in_npt','clock_out_npt','hours','business_day','note','manual'],
    state.attendance.slice().sort((a,b)=>new Date(b.in)-new Date(a.in)).map(a=>{
      const s=state.staff.find(x=>x.id===a.staff_id);
      return[s?.name||a.staff_id,s?.phone||'',s?.email||'',nptDateTime(a.in),nptDateTime(a.out),Number(a.hours||0).toFixed(2),a.businessDay||businessDayKey(new Date(a.in)),a.note||'',a.manual?'yes':'no']
    })
  );
  $('stockSearch').oninput=debounce(renderInventoryStock,70);$('stockFilter').onchange=renderInventoryStock;$('newIngredient').onclick=()=>openIngredientEditor();$('printInventory').onclick=()=>{$('inventoryPrint').innerHTML=inventoryPrintHTML();$('inventoryPrintModal').classList.add('show')};$('exportInventory').onclick=()=>exportRows('tea-amo-inventory.csv',['name','unit','stock','avg_cost','reorder','target','vendor','active'],state.ingredients.map(i=>[i.name,i.unit,i.stock,i.avg_cost,i.reorder,i.target,preferredVendor(i),i.active]));
  $('recvIng').onchange=updateReceivePreview;$('recvQty').oninput=updateReceivePreview;$('recvTotalCost').oninput=updateReceivePreview;$('receiveBtn').onclick=()=>{const vid=Number($('recvVendor').value),i=ingredient($('recvIng').value),q=Number($('recvQty').value),cost=Number($('recvTotalCost').value);if(!vid||!i||!(q>0)||cost<0)return alert('Complete vendor, ingredient, quantity and cost.');const oldValue=i.stock*i.avg_cost,newStock=i.stock+q;i.avg_cost=newStock?(oldValue+cost)/newStock:0;i.stock=newStock;const p={id:Date.now(),time:workingNowIso(),businessDay:businessDayKey(),vendor_id:vid,ingredient_key:i.key,qty:q,total_cost:cost,payment:$('recvPayment').value,invoice:$('recvInvoice').value.trim(),expiry:$('recvExpiry').value};state.purchases.unshift(p);state.inventoryLog.unshift({id:Date.now()+1,time:p.time,ingredient_key:i.key,qty_delta:q,reason:'purchase',ref:p.invoice||p.id,note:index.vendors.get(vid)?.name||''});saveSoon();index.recipeCost.clear();$('recvQty').value=$('recvTotalCost').value=$('recvInvoice').value=$('recvExpiry').value='';renderReceive()};
  $('adjustIng').onchange=updateAdjustInfo;$('adjustBtn').onclick=()=>{const i=ingredient($('adjustIng').value),q=Number($('adjustQty').value),mode=$('adjustMode').value;if(!i||!Number.isFinite(q)||q<0)return alert('Enter a valid quantity.');const old=i.stock;if(mode==='add')i.stock+=q;else if(mode==='subtract')i.stock-=q;else i.stock=q;state.inventoryLog.unshift({id:Date.now(),time:new Date().toISOString(),ingredient_key:i.key,qty_delta:i.stock-old,reason:'manual_adjustment',note:`${$('adjustReason').value}: ${$('adjustNote').value.trim()}`});$('adjustQty').value=$('adjustNote').value='';saveSoon();updateAdjustInfo()};
  $('countIng').onchange=updateStocktakePreview;$('countQty').oninput=updateStocktakePreview;$('countBtn').onclick=()=>{const i=ingredient($('countIng').value),p=Number($('countQty').value);if(!i||!Number.isFinite(p)||p<0)return alert('Enter physical quantity.');const d=p-i.stock;i.stock=p;state.inventoryLog.unshift({id:Date.now(),time:new Date().toISOString(),ingredient_key:i.key,qty_delta:d,reason:'stocktake',note:$('countReason').value.trim()});$('countQty').value=$('countReason').value='';saveSoon();updateStocktakePreview()};
  $('usagePeriod').onchange=renderUsage;$('usageSearch').oninput=debounce(renderUsage,70);$('exportUsage').onclick=()=>exportRows('tea-amo-usage.csv',['ingredient','stock','reorder','target','suggested'],state.ingredients.map(i=>[i.name,i.stock,i.reorder,i.target,suggested(i)]));
  $('historyIng').onchange=renderHistory;$('historyReason').onchange=renderHistory;$('historySearch').oninput=debounce(renderHistory,80);$('exportMovementHistory').onclick=()=>exportRows('tea-amo-inventory-movements.csv',['time','ingredient','change','type','ref','note'],state.inventoryLog.map(m=>[m.time,ingredient(m.ingredient_key)?.name||m.ingredient_key,m.qty_delta,m.reason,m.ref||'',m.note||'']));
  $('bulkSearch').oninput=debounce(renderBulk,70);$('saveBulkInventory').onclick=()=>{document.querySelectorAll('#bulkInventoryBody tr[data-key]').forEach(row=>{const i=ingredient(row.dataset.key),old=i.stock;if(!i)return;row.querySelectorAll('[data-f]').forEach(el=>{const f=el.dataset.f;let v=el.type==='checkbox'?el.checked:el.value;if(['stock','avg_cost','reorder','target'].includes(f))v=Number(v||0);if(f==='preferred_vendor_id')v=v?Number(v):null;i[f]=v});if(old!==i.stock)state.inventoryLog.unshift({id:Date.now()+Math.random(),time:new Date().toISOString(),ingredient_key:i.key,qty_delta:i.stock-old,reason:'manual_adjustment',note:'Bulk edit'})});rebuildIndex();saveSoon();renderBulk();alert('Bulk changes saved.')};
  $('recipeSearch').oninput=debounce(renderRecipes,70);
  $('wasteBtn').onclick=()=>{const i=ingredient($('wasteIng').value),q=Number($('wasteQty').value);if(!i||!(q>0))return alert('Enter waste quantity.');i.stock-=q;const w={id:Date.now(),time:workingNowIso(),businessDay:businessDayKey(),ingredient_key:i.key,qty:q,reason:$('wasteReason').value,note:$('wasteNote').value.trim(),cost:q*i.avg_cost};state.waste.unshift(w);state.inventoryLog.unshift({id:Date.now()+1,time:w.time,ingredient_key:i.key,qty_delta:-q,reason:'waste',ref:w.id,note:w.reason});$('wasteQty').value=$('wasteNote').value='';saveSoon();renderWaste()};
  $('addVendor').onclick=()=>{const name=$('vendorName').value.trim();if(!name)return;state.vendors.push({id:Date.now(),name,phone:$('vendorPhone').value.trim(),email:$('vendorEmail').value.trim(),address:$('vendorAddress').value.trim(),tax:$('vendorTax').value.trim()});rebuildIndex();['vendorName','vendorPhone','vendorEmail','vendorAddress','vendorTax'].forEach(id=>$(id).value='');saveSoon();renderVendors()};
  $('expenseDate').value=businessDayKey();$('addExpense').onclick=()=>{const amt=Number($('expenseAmount').value);if(!(amt>0))return alert('Enter amount.');state.expenses.unshift({id:Date.now(),date:$('expenseDate').value||businessDayKey(),businessDay:businessDayKey(),category:$('expenseCategory').value,vendor:$('expenseVendor').value.trim(),payment:$('expensePayment').value,amount:amt,ref:$('expenseRef').value.trim(),note:$('expenseNote').value.trim()});$('expenseAmount').value=$('expenseVendor').value=$('expenseRef').value=$('expenseNote').value='';saveSoon();renderExpenses()};
  $('addCustomer').onclick=()=>{const name=$('custName').value.trim();if(!name)return;state.customers.push({id:Date.now(),name,phone:$('custPhone').value.trim(),email:$('custEmail').value.trim(),visits:0,spend:0});rebuildIndex();$('custName').value=$('custPhone').value=$('custEmail').value='';saveSoon();renderCustomers()};
  $('exportSales').onclick=()=>exportRows('tea-amo-sales.csv',['bill','date','type','payment','payment_breakdown','payment_corrections','subtotal','discount','tax','total','cogs'],state.bills.map(b=>[b.id,b.time,b.type,b.payment,b.payments?Object.entries(b.payments).filter(([,v])=>Number(v)>0).map(([k,v])=>`${k}:${v}`).join(' | '):'',Array.isArray(b.payment_corrections)?b.payment_corrections.length:0,b.subtotal,b.discount,b.tax,b.total,b.cogs]));$('exportExpenses').onclick=()=>exportRows('tea-amo-expenses.csv',['date','category','vendor','payment','amount','note'],state.expenses.map(e=>[e.date,e.category,e.vendor,e.payment,e.amount,e.note]));$('exportWaste').onclick=()=>exportRows('tea-amo-waste.csv',['date','ingredient','qty','reason','cost'],state.waste.map(w=>[w.time,ingredient(w.ingredient_key)?.name||'',w.qty,w.reason,w.cost]));
  if($('exportItemSalesExcel'))$('exportItemSalesExcel').onclick=exportItemSalesExcel;if($('exportItemSalesCsv'))$('exportItemSalesCsv').onclick=exportItemSalesCsv;
  $('saveBusiness').onclick=()=>{state.business={...state.business,name:$('businessName').value.trim()||'TEA AMO',branch:$('branchName').value.trim()||'Main Branch',currency:$('currency').value.trim()||'Rs',taxRate:Number($('taxRate').value||0)};saveSoon();renderSettings();updateTop()};
  $('changePass').onclick=async()=>{if(!await verifyOwnerPassword($('oldPass').value))return alert('Incorrect current password.');if($('newPass').value.length<8)return alert('Use at least 8 characters.');await setOwnerPassword($('newPass').value);$('oldPass').value=$('newPass').value='';if(!await persistNow('password_changed'))return alert('Password changed in memory but could not be saved. Try again before closing the app.');audit('owner_password_changed','PBKDF2 credential updated');alert('Password changed securely.')};
  $('lanSyncNow').onclick=async()=>{const ok=await pushLanConfig();await pullLanOrders(true);alert(ok?'Staff phone access synced.':'LAN server is not connected. Launch RUN_TEA_AMO_SERVER.bat first.')};
  $('lanCopyStaffUrl').onclick=async()=>{
    try{
      const d=await getLanNetworkInfo(),u=(d.staff_urls||[])[0];
      if(!u)return alert('No Wi-Fi Staff URL detected.');
      try{await navigator.clipboard.writeText(u);alert('Staff URL copied: '+u)}catch{prompt('Copy this Staff URL:',u)}
    }catch{alert('LAN server is not connected. Start RUN_TEA_AMO_SERVER.bat first.')}
  };

  $('lanRefreshNetwork').onclick=async()=>{
    const u=await refreshStaffUrlUI();
    alert(u?'Staff link refreshed.':'No usable Wi-Fi address detected. Connect the laptop to café Wi-Fi and restart the server.');
  };
  
  $('qrUploadESewa').onchange=e=>{const f=e.target.files?.[0];if(f)setPaymentQr('eSewa',f);e.target.value=''};
  $('qrUploadKhalti').onchange=e=>{const f=e.target.files?.[0];if(f)setPaymentQr('Khalti',f);e.target.value=''};
  $('qrUploadFonepay').onchange=e=>{const f=e.target.files?.[0];if(f)setPaymentQr('Fonepay',f);e.target.value=''};
  $('qrRemoveMethodESewa').onclick=()=>removePaymentMethod('eSewa');
  $('qrRemoveMethodKhalti').onclick=()=>removePaymentMethod('Khalti');
  $('qrRemoveMethodFonepay').onclick=()=>removePaymentMethod('Fonepay');
  $('addPaymentMethodBtn').onclick=addPaymentMethodFromSettings;
  $('fullSystemReset').onclick=completeOperationalReset;

  $('lanOpenStaffTest').onclick=async()=>{
    const u=await refreshStaffUrlUI();
    if(!u)return alert('No Staff URL detected yet.');
    window.open(u,'_blank');
  };
$('backupBtn').onclick=()=>download(`TEA_AMO_BACKUP_${businessDayKey()}.json`,JSON.stringify(state,null,2));$('restoreFile').onchange=e=>{const f=e.target.files[0];e.target.value='';if(!f)return;const r=new FileReader();r.onload=async()=>{try{const pass=prompt('Owner password required to restore a backup:');if(pass==null)return;if(!await verifyOwnerPassword(pass))throw new Error('Incorrect owner password.');const incoming=JSON.parse(r.result);validateBackupPayload(incoming);if(!confirm('Restore this backup? A safety backup of the current system will be downloaded first.'))return;downloadSafetyBackup('PRE_RESTORE');const previous=clone(state);state=repairState(incoming);rebuildIndex();audit('backup_restored',f.name);if(!await persistNow('backup_restore')){state=previous;rebuildIndex();throw new Error('Restore could not be persisted; the previous state was restored in memory.')}renderActive();alert('Backup restored and validated.')}catch(err){alert('Restore blocked: '+err.message)}};r.readAsText(f)};
  $('resetAll').onclick=async()=>{
    if(!await verifyOwnerPassword($('resetPassword').value))return alert('Incorrect password.');
    if(!confirm('Clear only the Dashboard counters and month snapshot? Bills, reports, sales history, inventory, recipes, ingredients, vendors, purchases, staff, attendance, expenses, customers, wastage, Z-reports and movement history will remain unchanged.'))return;
    const d=daySummary(),m=currentMonthTotals(),p=nptParts();
    state.dashboardBaseline={
      clearedAt:new Date().toISOString(),
      businessDay:businessDayKey(),
      monthKey:`${p.y}-${String(p.m).padStart(2,'0')}`,
      daySales:d.sales,
      dayOrders:d.orders,
      monthSales:m.sales,
      monthCogs:m.cogs,
      monthExp:m.exp,
      monthPay:m.pay,
      monthWaste:m.waste
    };
    audit('dashboard_cleared_only',state.dashboardBaseline.clearedAt);
    $('resetPassword').value='';
    await dbPut(state);
    renderDashboard();
    alert('Dashboard cleared. All business data remains intact.');
  };
  $('restoreDashboard').onclick=async()=>{
    if(!await verifyOwnerPassword($('resetPassword').value))return alert('Incorrect password.');
    if(!state.dashboardBaseline)return alert('Dashboard is already showing the full business totals.');
    state.dashboardBaseline=null;
    audit('dashboard_view_restored','Full dashboard totals restored');
    $('resetPassword').value='';
    await dbPut(state);
    renderDashboard();
    alert('Full Dashboard view restored. No business data was changed.');
  };
  $('saveIngredientEdit').onclick=()=>{const name=$('editIngName').value.trim(),unit=$('editIngUnit').value.trim();if(!name||!unit)return alert('Name and unit are required.');if(editingIngredientKey){const i=ingredient(editingIngredientKey),old=i.stock;Object.assign(i,{name,unit,stock:Number($('editIngStock').value||0),avg_cost:Number($('editIngCost').value||0),reorder:Number($('editIngReorder').value||0),target:Number($('editIngTarget').value||0),shelf_life_days:Number($('editIngShelfLife').value||0),preferred_vendor_id:Number($('editIngVendor').value)||null,notes:$('editIngNotes').value.trim(),location:$('editIngLocation').value,active:$('editIngActive').checked});if(old!==i.stock)state.inventoryLog.unshift({id:Date.now(),time:new Date().toISOString(),ingredient_key:i.key,qty_delta:i.stock-old,reason:'manual_adjustment',note:'Ingredient editor'})}else{let key=slugKey(name),base=key,n=2;while(index.ingredients.has(key))key=base+'-'+n++;state.ingredients.push({key,name,unit,stock:Number($('editIngStock').value||0),avg_cost:Number($('editIngCost').value||0),reorder:Number($('editIngReorder').value||0),target:Number($('editIngTarget').value||0),shelf_life_days:Number($('editIngShelfLife').value||0),preferred_vendor_id:Number($('editIngVendor').value)||null,notes:$('editIngNotes').value.trim(),location:$('editIngLocation').value,active:$('editIngActive').checked})}rebuildIndex();saveSoon();$('ingredientModal').classList.remove('show');renderInventoryStock()};
  $('cancelIngredientEdit').onclick=()=>$('ingredientModal').classList.remove('show');
  window.addEventListener('beforeunload',()=>{if(savePending)dbPut(state)});
  setInterval(()=>{updateTop();if(document.visibilityState!=='visible')return;if(activeSection==='dashboard')renderDashboard();else if(activeSection==='dayclose')renderDayClose();else if(activeSection==='staff')renderStaff()},45000);

  if($('payment')){$('payment').addEventListener('change',updateChangeDue);$('cashReceived')?.addEventListener('input',updateChangeDue);updateChangeDue()}
  installCriticalFallbacks();renderActive();updateLanUI();startLanPolling();
}
// ===== TEA AMO REMASTERED MANAGEMENT FEATURES =====
let inventoryArea='kitchen',mixedPaymentContext=null;
function guessInventoryLocation(name){
  const n=String(name||'').toLowerCase();
  return /(tea|coffee|coke|fanta|sprite|dew|soda|juice|syrup|sheesha|shisha|tobacco|cigarette|beer|vodka|whisky|whiskey|rum|gin|wine|water|ice|milk)/.test(n)?'bar':'kitchen'
}
function closeModal(id){$(id)?.classList.remove('show')}

// POS intentionally has no visible category headings.
renderMenu=function(){
  const q=($('menuSearch')?.value||'').trim().toLowerCase();
  const rows=state.menu.filter(m=>m.active!==false&&(!q||m.name.toLowerCase().includes(q)));
  $('menuGrid').innerHTML=rows.map(m=>`<button class="menuitem" onclick="addCart(${m.id})"><b>${esc(m.name)}</b><div class="price">${rs(m.price)}</div><small class="${canMake(m)?'good':'warn'}">${canMake(m)?'Stock ready':'Check stock'}</small></button>`).join('')||'<div class="notice">No menu items match.</div>'
};

function renderMenuAdmin(){
  $('menuAdminBody').innerHTML=state.menu.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(m=>`<tr><td><input value="${esc(m.name)}" onchange="editMenuName(${m.id},this.value)" style="min-width:220px"></td><td><input type="number" min="0" step=".01" value="${m.price==null?'':Number(m.price)}" placeholder="Set price" onchange="editMenuPrice(${m.id},this.value)"></td><td><input type="checkbox" ${m.active!==false?'checked':''} onchange="toggleMenuActive(${m.id},this.checked)"></td><td><button class="btn small danger" onclick="deleteMenuItemAdmin(${m.id})">Delete</button></td></tr>`).join('')
}
function addMenuItemAdmin(){const name=$('newMenuName').value.trim(),price=Number($('newMenuPrice').value);if(!name)return alert('Enter item name.');if(!Number.isFinite(price)||price<0)return alert('Enter a valid price.');if(state.menu.some(m=>m.name.toLowerCase()===name.toLowerCase()))return alert('This item already exists.');const id=Math.max(0,...state.menu.map(m=>Number(m.id)||0))+1;state.menu.push({id,name,category:'Menu',price,active:true});state.recipes[name]=[];rebuildIndex();$('newMenuName').value=$('newMenuPrice').value='';saveSoon();renderMenuAdmin();pushLanConfig()}
function editMenuName(id,v){const m=menuItem(id),name=String(v||'').trim();if(!m||!name)return renderMenuAdmin();if(state.menu.some(x=>x.id!==id&&x.name.toLowerCase()===name.toLowerCase()))return alert('Another item already uses this name.');const old=m.name;m.name=name;if(state.recipes[old]&&!state.recipes[name]){state.recipes[name]=state.recipes[old];delete state.recipes[old]}rebuildIndex();saveSoon();pushLanConfig();renderMenuAdmin()}
function editMenuPrice(id,v){const m=menuItem(id),p=Number(v);if(!m||!Number.isFinite(p)||p<0)return alert('Enter a valid price.');m.price=p;saveSoon();pushLanConfig();renderMenuAdmin()}
function toggleMenuActive(id,v){const m=menuItem(id);if(!m)return;if(v&&(m.price==null||!Number.isFinite(Number(m.price)))){alert('Set a price before enabling this item.');return renderMenuAdmin()}m.active=!!v;saveSoon();pushLanConfig();renderMenuAdmin()}
function deleteMenuItemAdmin(id){const m=menuItem(id);if(!m)return;if(currentCart().some(x=>String(x.id)===String(id)))return alert('Remove this item from the current order before deleting it.');if(!confirm(`Delete ${m.name} from the menu? Historical bills are not deleted.`))return;state.menu=state.menu.filter(x=>x.id!==id);delete state.recipes[m.name];rebuildIndex();saveSoon();pushLanConfig();renderMenuAdmin()}

function setInventoryArea(area){inventoryArea=area==='bar'?'bar':'kitchen';$('invKitchenBtn')?.classList.toggle('active',inventoryArea==='kitchen');$('invKitchenBtn')?.classList.toggle('alt',inventoryArea!=='kitchen');$('invBarBtn')?.classList.toggle('active',inventoryArea==='bar');$('invBarBtn')?.classList.toggle('alt',inventoryArea!=='bar');renderInventoryActive()}
fillIngredientSelect=function(el,includeAll=false){if(!el)return;const v=el.value;let rows=state.ingredients.filter(i=>i.active);if(activeSection==='inventory')rows=rows.filter(i=>(i.location||guessInventoryLocation(i.name))===inventoryArea);el.innerHTML=(includeAll?'<option value="">All ingredients</option>':'')+rows.map(i=>`<option value="${esc(i.key)}">${esc(i.name)} (${esc(i.unit)})</option>`).join('');if(v&&rows.some(i=>i.key===v))el.value=v};
renderInventoryStock=function(){const q=($('stockSearch')?.value||'').trim().toLowerCase(),f=$('stockFilter')?.value||'';let rows=state.ingredients.filter(i=>(i.location||guessInventoryLocation(i.name))===inventoryArea).filter(i=>!q||i.name.toLowerCase().includes(q)).filter(i=>f==='low'?i.active&&(i.stock<=0||(i.reorder>0&&i.stock<=i.reorder)):f==='out'?i.active&&i.stock<=0:f==='inactive'?!i.active:true).sort((a,b)=>a.name.localeCompare(b.name));$('inventoryBody').innerHTML=rows.map(i=>`<tr><td><b>${esc(i.name)}</b><div class="sub">${inventoryArea==='bar'?'Bar':'Kitchen'}</div></td><td class="${i.stock<=0?'bad':''}">${Number(i.stock).toFixed(3)}</td><td>${esc(i.unit)}</td><td>${rs(i.avg_cost)}</td><td>${Number(i.reorder||0).toFixed(3)}</td><td>${Number(i.target||0).toFixed(3)}</td><td class="${suggested(i)>0?'warn':''}">${suggested(i).toFixed(3)}</td><td>${esc(preferredVendor(i))}</td><td>${!i.active?'<span class="muted">INACTIVE</span>':i.stock<=0?'<span class="bad">OUT / NEG</span>':i.reorder>0&&i.stock<=i.reorder?'<span class="warn">LOW</span>':'<span class="good">OK</span>'}</td><td><button class="btn small alt" onclick="openIngredientEditor('${esc(i.key)}')">Edit</button> <button class="btn small" onclick="jumpAdjust('${esc(i.key)}')">Adjust</button></td></tr>`).join('');const active=rows.filter(i=>i.active),low=active.filter(i=>i.stock<=0||(i.reorder>0&&i.stock<=i.reorder));$('invValue').textContent=rs(active.reduce((z,i)=>z+i.stock*i.avg_cost,0));$('invLowCount').textContent=low.length;$('invReorderCount').textContent=active.filter(i=>suggested(i)>0&&(i.stock<=i.reorder||i.stock<=0)).length;$('invActiveCount').textContent=active.length};
inventoryPrintHTML=function(){const rows=state.ingredients.filter(i=>i.active&&(i.location||guessInventoryLocation(i.name))===inventoryArea).sort((a,b)=>a.name.localeCompare(b.name));return`<div class="print-logo">${esc(state.business.name)}</div><div class="print-subtitle">${esc(state.business.branch)}</div><div class="print-title">${inventoryArea==='bar'?'BAR':'KITCHEN'} INVENTORY STOCK REPORT</div><div class="print-meta-row"><span>Generated</span><b>${nptDateTime()} NPT</b></div><table class="print-table"><thead><tr><th>Ingredient</th><th class="num">Stock</th><th class="num">Reorder</th><th class="num">Target</th><th class="num">Suggested</th></tr></thead><tbody>${rows.map(i=>`<tr><td>${esc(i.name)}</td><td class="num">${i.stock.toFixed(3)} ${esc(i.unit)}</td><td class="num">${i.reorder}</td><td class="num">${i.target}</td><td class="num">${suggested(i).toFixed(3)}</td></tr>`).join('')}</tbody></table>`};

function selectedTotals(selection){const full=calcCart(),subtotal=selection.reduce((z,r)=>{const m=menuItem(r.id);return z+(m?m.price*r.qty:0)},0),ratio=full.subtotal?subtotal/full.subtotal:1,discount=full.discount*ratio,tax=(subtotal-discount)*Number(state.business.taxRate||0)/100;return{subtotal,discount,tax,total:subtotal-discount+tax}}
function normalPaymentInfo(total,method,cashReceived){let change=0;if(method==='Cash'){const rec=cashReceived===''||cashReceived==null?total:Number(cashReceived);if(!Number.isFinite(rec)||rec<total-0.009)throw new Error('Cash received is less than the amount due.');change=Math.max(0,rec-total);return{payment:'Cash',payments:{Cash:total},cash_received:rec,change_due:change}}return{payment:method,payments:{[method]:total},cash_received:0,change_due:0}}
async function completeSelection(selection,paymentInfo,{nonChargeable=false,reason='',note=''}={}){
  if(!posAllowed())throw new Error('POS is closed or this business day is finalized.');
  if(!selection.length)throw new Error('Select at least one item.');
  const cart=currentCart(),order=currentOrderMeta(),t=activeTableId&&activeTableId!=='counter'?tableById(activeTableId):null;
  for(const r of selection){const c=cart.find(x=>String(x.id)===String(r.id));if(!c||r.qty<=0||r.qty>c.qty)throw new Error('Split selection is no longer valid.');}
  const snapshot=clone(state);
  const calc=selectedTotals(selection),id=newReceiptId(),items=[];
  for(const row of selection){const m=menuItem(row.id);if(!m)continue;items.push({id:m.id,name:m.name,price:m.price,qty:row.qty,served_qty:Math.min(row.qty,Number(cart.find(x=>String(x.id)===String(row.id))?.served||0)),cogs:recipeCost(m)*row.qty})}
  const remainingAfter=cart.reduce((z,c)=>z+c.qty,0)-selection.reduce((z,r)=>z+r.qty,0);
  const tableFinishes=!!t&&remainingAfter<=0;
  const endAt=tableFinishes?workingNowIso():null,startAt=tableFinishes?(order?.openedAt||null):null;
  const menuValue=calc.total;
  const bill={id,time:workingNowIso(),businessDay:businessDayKey(),type:t?'Dine-in':$('orderType').value,ref:t?t.name:$('orderRef').value.trim(),table_id:t?t.id:null,guest_count:t?Math.max(1,Number(order?.guestCount||$('guestCount').value||1)):1,payment:nonChargeable?'Non-Chargeable':paymentInfo.payment,payments:nonChargeable?{}:(paymentInfo.payments||{}),cash_received:nonChargeable?0:Number(paymentInfo.cash_received||0),change_due:nonChargeable?0:Number(paymentInfo.change_due||0),customer_id:Number($('posCustomer').value)||null,items,subtotal:calc.subtotal,discount:calc.discount,tax:calc.tax,total:nonChargeable?0:calc.total,menu_value:menuValue,cogs:items.reduce((z,x)=>z+x.cogs,0),non_chargeable:!!nonChargeable,non_chargeable_reason:reason||'',non_chargeable_note:note||'',dining_session_complete:tableFinishes,dining_started_at:startAt,dining_ended_at:endAt,dining_minutes:startAt&&endAt?Math.max(0,(new Date(endAt)-new Date(startAt))/60000):null};
  for(const row of selection){const m=menuItem(row.id);if(m)deductRecipe(m,row.qty,id)}
  state.bills.unshift(bill);
  const customerId=bill.customer_id;if(customerId){const cu=index.customers.get(customerId);if(cu){if(!t||tableFinishes)cu.visits=(cu.visits||0)+1;cu.spend=(cu.spend||0)+bill.total}}
  for(const r of selection){const c=cart.find(x=>String(x.id)===String(r.id));if(!c)continue;c.qty-=r.qty;c.served=Math.max(0,Math.min(c.qty,Number(c.served||0)-Math.min(Number(c.served||0),r.qty)));if(c.qty<=0)cart.splice(cart.indexOf(c),1)}
  if(t&&tableFinishes){delete state.tableOrders[t.id];t.attention=false;t.reservation=null}else if(!t&&cart.length===0){state.cart=[]}else if(remainingAfter>0&&$('discountType')?.value==='amount'){const left=Math.max(0,Number($('discountValue').value||0)-Number(calc.discount||0));$('discountValue').value=left.toFixed(2)}
  audit(nonChargeable?'non_chargeable_order':'sale_completed',`${bill.id} ${bill.payment} ${bill.total}${t?' '+t.name:''}${reason?' '+reason:''}`);await persistOrRollback(snapshot,'checkout-remastered');lastPaidBill=bill;
  if(t&&tableFinishes){const tid=t.id;activeTableId=null;$('tableOrderView').classList.add('hidden');$('tableSelectView').classList.remove('hidden');renderTableFloor();Promise.resolve(deleteLanOrder(tid)).catch(()=>{})}else if(t){saveCurrentOrderUI();queueLanOrderPush(t.id);renderPOSWorkspace()}else{renderCart()}
  showReceipt(bill);setActionStatus(`${nonChargeable?'Non-chargeable order':'Payment'} completed: ${bill.id}${nonChargeable?'':` · ${rs(bill.total)}`}`,'good');if(activeSection==='dashboard')renderDashboard();return bill
}

checkout=async function(){if(checkoutBusy)return;const cart=currentCart();if(!cart.length)return alert('Add at least one item.');const pending=unservedCountForOrder({cart});if(pending&&!confirm(`${pending} item(s) are still unserved. Complete payment anyway?`))return;const btn=$('checkout');checkoutBusy=true;btn.disabled=true;const txt=btn.textContent;btn.textContent='Processing…';try{const sel=cart.map(c=>({id:c.id,qty:c.qty})),total=selectedTotals(sel).total,info=normalPaymentInfo(total,$('payment').value,$('cashReceived').value);await completeSelection(sel,info);$('cashReceived').value='';updateChangeDue()}catch(e){alert(e.message||e);console.error(e)}finally{checkoutBusy=false;btn.disabled=!posAllowed();btn.textContent=txt}}
function updateChangeDue(){if(!$('changeDueBadge'))return;const total=calcCart().total,method=$('payment').value,received=Number($('cashReceived').value||0);$('cashReceived').style.display=method==='Cash'?'':'none';$('changeDueBadge').style.display=method==='Cash'?'':'none';$('changeDueBadge').textContent=`Change: ${rs(Math.max(0,received-total))}`}
function openSplitBill(){const cart=currentCart();if(!cart.length)return alert('Add items first.');$('splitBillRows').innerHTML=cart.map(c=>{const m=menuItem(c.id);return`<div class="split-line"><div><b>${esc(m?.name||'Item')}</b><div class="sub">${c.qty} ordered × ${rs(m?.price||0)}</div></div><input type="number" min="0" max="${c.qty}" step="1" value="0" data-split="${c.id}" oninput="updateSplitTotal()"><b>${rs(m?.price||0)}</b></div>`}).join('');$('splitCashReceived').value='';updateSplitTotal();$('splitBillModal').classList.add('show')}
function getSplitSelection(){return [...document.querySelectorAll('[data-split]')].map(i=>({id:Number(i.dataset.split),qty:Math.max(0,Math.min(Number(i.max),Math.floor(Number(i.value||0))))})).filter(x=>x.qty>0)}
function updateSplitTotal(){const s=getSplitSelection();$('splitSelectedTotal').textContent=rs(s.length?selectedTotals(s).total:0)}
async function paySplitSelected(mixed){const s=getSplitSelection();if(!s.length)return alert('Choose at least one item/quantity.');if(mixed){closeModal('splitBillModal');openMixedPayment(s,{split:true});return}try{const total=selectedTotals(s).total,info=normalPaymentInfo(total,$('splitPaymentMethod').value,$('splitCashReceived').value);await completeSelection(s,info);closeModal('splitBillModal')}catch(e){alert(e.message||e)}}
function openMixedPayment(selection=null,opts={}){const sel=selection||currentCart().map(c=>({id:c.id,qty:c.qty}));if(!sel.length)return alert('Add items first.');mixedPaymentContext={selection:sel,opts};['mixCash','mixCashReceived','mixESewa','mixKhalti','mixFonepay','mixCard'].forEach(id=>$(id).value=0);$('mixedDue').textContent=rs(selectedTotals(sel).total);updateMixedPaymentPreview();$('mixedPaymentModal').classList.add('show')}
function mixedValues(){return{Cash:Number($('mixCash').value||0),eSewa:Number($('mixESewa').value||0),Khalti:Number($('mixKhalti').value||0),Fonepay:Number($('mixFonepay').value||0),Card:Number($('mixCard').value||0)}}
function updateMixedPaymentPreview(){if(!mixedPaymentContext)return;const due=selectedTotals(mixedPaymentContext.selection).total,v=mixedValues(),applied=Object.values(v).reduce((a,b)=>a+b,0),remaining=due-applied,received=Number($('mixCashReceived').value||0),change=v.Cash?Math.max(0,received-v.Cash):0;$('mixedPreview').innerHTML=`Applied: <b>${rs(applied)}</b> · Remaining: <b class="${Math.abs(remaining)<.01?'good':'warn'}">${rs(Math.max(0,remaining))}</b> · Cash change: <b>${rs(change)}</b>`}
async function confirmMixedPayment(){if(!mixedPaymentContext)return;const due=selectedTotals(mixedPaymentContext.selection).total,v=mixedValues(),applied=Object.values(v).reduce((a,b)=>a+b,0);if(Math.abs(applied-due)>.01)return alert(`Applied payments must equal ${rs(due)}.`);const rec=Number($('mixCashReceived').value||0);if(v.Cash>0&&rec<v.Cash-.009)return alert('Cash received cannot be less than cash applied.');const info={payment:'Mixed',payments:v,cash_received:rec,change_due:v.Cash?Math.max(0,rec-v.Cash):0};try{await completeSelection(mixedPaymentContext.selection,info);mixedPaymentContext=null;closeModal('mixedPaymentModal')}catch(e){alert(e.message||e)}}
function openNonChargeable(){if(!currentCart().length)return alert('Add items first.');$('nonChargePassword').value=$('nonChargeOther').value='';$('nonChargeModal').classList.add('show')}
async function confirmNonChargeable(){if(!await verifyOwnerPassword($('nonChargePassword').value))return alert('Incorrect owner password.');const reason=$('nonChargeReason').value,note=$('nonChargeOther').value.trim(),sel=currentCart().map(c=>({id:c.id,qty:c.qty}));try{await completeSelection(sel,{payment:'Non-Chargeable',payments:{},cash_received:0,change_due:0},{nonChargeable:true,reason,note});closeModal('nonChargeModal')}catch(e){alert(e.message||e)}}

function formatMinutes(v){if(v==null||!Number.isFinite(Number(v)))return '—';v=Math.round(Number(v));const h=Math.floor(v/60),m=v%60;return h?`${h} hr ${m} min`:`${m} min`}
function diningBillsByPeriod(){const p=$('diningPeriod')?.value||'30',now=Date.now();return state.bills.filter(b=>b.table_id&&b.dining_session_complete&&Number.isFinite(Number(b.dining_minutes))).filter(b=>p==='all'?true:p==='today'?inBusinessDay(b.time,businessDayKey()):now-new Date(b.time).getTime()<=Number(p)*864e5)}
function renderDining(){const bills=diningBillsByPeriod(),vals=bills.map(b=>Number(b.dining_minutes)),active=state.tables.filter(t=>tableHasOrder(t.id));$('diningOverall').textContent=vals.length?formatMinutes(vals.reduce((a,b)=>a+b,0)/vals.length):'—';$('diningSessions').textContent=bills.length;$('diningActive').textContent=active.length;$('diningBody').innerHTML=state.tables.map(t=>{const rows=bills.filter(b=>b.table_id===t.id),avg=rows.length?rows.reduce((z,b)=>z+Number(b.dining_minutes),0)/rows.length:null,o=state.tableOrders[t.id],cur=o?.openedAt?`Active · ${formatMinutes((Date.now()-new Date(o.openedAt))/60000)}`:(rows[0]?`Last: ${formatMinutes(rows[0].dining_minutes)}`:'—');return`<tr><td><b>${esc(t.name)}</b></td><td>${formatMinutes(avg)}</td><td>${rows.length}</td><td>${cur}</td></tr>`}).join('')}

function addCapitalMovement(){const amount=Number($('capitalAmount').value);if(!(amount>0))return alert('Enter an amount.');const type=$('capitalType').value,destination=$('capitalDestination').value,note=$('capitalNote').value.trim();state.ownerCapital.unshift({id:Date.now(),time:workingNowIso(),businessDay:businessDayKey(),type,destination,amount,note});$('capitalAmount').value=$('capitalNote').value='';audit('owner_capital',`${type} ${destination} ${amount}`);saveSoon();renderCapital()}
function renderCapital(){
  const inv=state.ownerCapital.filter(x=>x.type==='investment').reduce((z,x)=>z+Number(x.amount||0),0),wd=state.ownerCapital.filter(x=>x.type==='withdrawal').reduce((z,x)=>z+Number(x.amount||0),0),cash=state.ownerCapital.filter(x=>x.destination==='Cash').reduce((z,x)=>z+(x.type==='withdrawal'?-1:1)*Number(x.amount||0),0);
  $('capitalInvested').textContent=rs(inv);$('capitalWithdrawn').textContent=rs(wd);$('capitalNet').textContent=rs(inv-wd);$('capitalCash').textContent=rs(cash);
  $('capitalBody').innerHTML=state.ownerCapital.map(x=>`<tr><td>${nptDateTime(x.time)}</td><td>${x.type==='investment'?'<span class="good">Investment</span>':'<span class="warn">Withdrawal</span>'}</td><td>${esc(x.destination)}</td><td>${x.type==='withdrawal'?'- ':''}${rs(x.amount)}</td><td>${esc(x.note||'')}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">No owner capital movements yet.</td></tr>';
  const ledger=moneyMovementLedger(),balances={Cash:0,Bank:0,Online:0};ledger.filter(x=>x.account in balances).forEach(x=>balances[x.account]+=(x.direction==='in'?1:-1)*x.amount);const total=balances.Cash+balances.Bank+balances.Online,payable=ledger.filter(x=>x.source==='Purchase'&&x.account==='Payable').reduce((a,b)=>a+b.amount,0),sales=ledger.filter(x=>x.source==='Sale').reduce((a,b)=>a+b.amount,0),expenses=ledger.filter(x=>x.source==='Expense').reduce((a,b)=>a+b.amount,0),purchases=ledger.filter(x=>x.source==='Purchase').reduce((a,b)=>a+b.amount,0);
  if($('balanceCash'))$('balanceCash').textContent=rs(balances.Cash||0);if($('balanceBank'))$('balanceBank').textContent=rs(balances.Bank||0);if($('balanceOnline'))$('balanceOnline').textContent=rs(balances.Online||0);if($('balanceTotal'))$('balanceTotal').textContent=rs(total);if($('balancePayable'))$('balancePayable').textContent=rs(payable);if($('balanceSales'))$('balanceSales').textContent=rs(sales);if($('balanceExpenses'))$('balanceExpenses').textContent=rs(expenses);if($('balancePurchases'))$('balancePurchases').textContent=rs(purchases);
  const filter=$('moneyLedgerFilter')?.value||'all',rows=filter==='all'?ledger:ledger.filter(x=>x.direction===filter);if($('moneyLedgerBody'))$('moneyLedgerBody').innerHTML=rows.slice(0,1500).map(x=>`<tr><td>${nptDateTime(x.time)}</td><td class="${x.direction==='in'?'money-ledger-in':'money-ledger-out'}">${x.direction==='in'?'IN':'OUT'}</td><td>${esc(x.source)}</td><td>${esc(x.account)}</td><td>${x.direction==='out'?'- ':''}${rs(x.amount)}</td><td>${esc(x.note||'')}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">No money movements yet.</td></tr>';
}

// Cash summary understands mixed payments and owner cash movements; non-chargeable orders stay out of revenue.
daySummary=function(key=businessDayKey()){const all=dayBills(key),bills=all.filter(b=>!b.non_chargeable),rec=dayRecord(key),payMethods={};bills.forEach(b=>{if(b.payments&&Object.keys(b.payments).length){Object.entries(b.payments).forEach(([k,v])=>payMethods[k]=(payMethods[k]||0)+Number(v||0))}else payMethods[b.payment]=(payMethods[b.payment]||0)+Number(b.total||0)});const expenses=state.expenses.filter(e=>(e.businessDay||e.date)===key),purchases=state.purchases.filter(p=>(p.businessDay||businessDayKey(new Date(p.time)))===key),waste=state.waste.filter(w=>(w.businessDay||businessDayKey(new Date(w.time)))===key);const gross=bills.reduce((z,b)=>z+Number(b.subtotal||0),0),discount=bills.reduce((z,b)=>z+Number(b.discount||0),0),tax=bills.reduce((z,b)=>z+Number(b.tax||0),0),sales=bills.reduce((z,b)=>z+Number(b.total||0),0),cogs=all.reduce((z,b)=>z+Number(b.cogs||0),0),cashSales=payMethods.Cash||0,cashExpenses=expenses.filter(e=>e.payment==='Cash').reduce((z,e)=>z+e.amount,0),cashPurchases=purchases.filter(p=>p.payment==='Cash').reduce((z,p)=>z+p.total_cost,0),capitalCash=state.ownerCapital.filter(x=>x.businessDay===key&&x.destination==='Cash').reduce((z,x)=>z+(x.type==='withdrawal'?-1:1)*Number(x.amount||0),0),expectedCash=(rec.openingCash||0)+cashSales+capitalCash-cashExpenses-cashPurchases;return{key,rec,bills:all,orders:all.length,gross,discount,tax,sales,cogs,payMethods,cashSales,cashExpenses,cashPurchases,capitalCash,expectedCash,expenses:expenses.reduce((z,e)=>z+e.amount,0),purchases:purchases.reduce((z,p)=>z+p.total_cost,0),waste:waste.reduce((z,w)=>z+w.cost,0)}};
const _renderDayClose=renderDayClose;renderDayClose=function(){_renderDayClose();const s=daySummary();const z=$('zLive');if(z&&!z.querySelector('[data-capital-cash]')){const total=z.querySelector('.srow.total:last-child');if(total)total.insertAdjacentHTML('beforebegin',`<div class="srow" data-capital-cash><span>Owner capital cash</span><b>${s.capitalCash>=0?'+ ':''}${rs(s.capitalCash)}</b></div>`)}};
const _zHTML=zHTML;zHTML=function(){const s=daySummary(),h=_zHTML();return h.replace('<div class="print-summary-row total"><span>Difference</span>',`<div class="print-summary-row"><span>Owner capital cash</span><b>${s.capitalCash>=0?'+ ':''}${rs(s.capitalCash)}</b></div><div class="print-summary-row total"><span>Difference</span>`)};

const _renderReports=renderReports;renderReports=function(){_renderReports();const visitBills=state.bills.filter(b=>b.table_id&&b.dining_session_complete!==false),usage=state.tables.map(t=>{const all=visitBills.filter(b=>b.table_id===t.id),month=all.filter(b=>sameMonth(b.time)),guests=a=>a.reduce((z,b)=>z+Math.max(1,Number(b.guest_count||1)),0),last=all.slice().sort((a,b)=>new Date(b.time)-new Date(a.time))[0];return{t,mu:month.length,mg:guests(month),au:all.length,ag:guests(all),last:last?.time||null}});if($('tableVisitsMonth'))$('tableVisitsMonth').textContent=usage.reduce((z,x)=>z+x.mu,0);if($('tableGuestsMonth'))$('tableGuestsMonth').textContent=usage.reduce((z,x)=>z+x.mg,0);if($('tableVisitsAll'))$('tableVisitsAll').textContent=usage.reduce((z,x)=>z+x.au,0);if($('tableGuestsAll'))$('tableGuestsAll').textContent=usage.reduce((z,x)=>z+x.ag,0);if($('tableUsageBody'))$('tableUsageBody').innerHTML=usage.map(x=>`<tr><td><b>${esc(x.t.name)}</b></td><td>${x.mu}</td><td>${x.mg}</td><td>${x.au}</td><td>${x.ag}</td><td>${x.au?(x.ag/x.au).toFixed(1):'0.0'}</td><td>${x.last?nptDateTime(x.last):'—'}</td></tr>`).join('');const rows=state.bills.filter(b=>b.non_chargeable),val=rows.reduce((z,b)=>z+Number((b.menu_value??(b.subtotal-b.discount+b.tax))||0),0),cost=rows.reduce((z,b)=>z+Number(b.cogs||0),0);if($('ncCount'))$('ncCount').textContent=rows.length;if($('ncValue'))$('ncValue').textContent=rs(val);if($('ncCost'))$('ncCost').textContent=rs(cost);if($('ncBody'))$('ncBody').innerHTML=rows.map(b=>`<tr><td>${nptDateTime(b.time)}</td><td>${esc(b.id)}</td><td>${esc(b.ref||b.type||'')}</td><td>${esc(b.non_chargeable_reason||'')}</td><td>${rs(b.menu_value??0)}</td><td>${rs(b.cogs||0)}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">No non-chargeable orders.</td></tr>'};
const _renderReportsPaymentCorrection=renderReports;renderReports=function(){_renderReportsPaymentCorrection();renderPaymentCorrectionSalesTable()};
const _receiptHTML=receiptHTML;receiptHTML=function(b){let h=_receiptHTML(b);if(b.non_chargeable){h=h.replace('PAID CUSTOMER RECEIPT','NON-CHARGEABLE ORDER').replace('<span>TOTAL</span><span>'+rs(b.total)+'</span>','<span>AMOUNT DUE</span><span>'+rs(0)+'</span>');h=h.replace('</div><table class="print-table">',`<div class="print-meta-row"><span>Reason</span><b>${esc(b.non_chargeable_reason||'Owner approved')}</b></div></div><table class="print-table">`)}else if(b.payment==='Mixed'&&b.payments){h=h.replace(`<div class="print-meta-row"><span>Payment</span><b>Mixed</b></div>`,`<div class="print-meta-row"><span>Payment</span><b>Mixed</b></div><div class="print-meta-row"><span>Breakdown</span><b>${Object.entries(b.payments).filter(([,v])=>Number(v)>0).map(([k,v])=>`${esc(k)} ${rs(v)}`).join(' · ')}</b></div>${b.change_due?`<div class="print-meta-row"><span>Change</span><b>${rs(b.change_due)}</b></div>`:''}`)}else if(b.payment==='Cash'&&b.change_due){h=h.replace(`<div class="print-meta-row"><span>Payment</span><b>Cash</b></div>`,`<div class="print-meta-row"><span>Payment</span><b>Cash</b></div><div class="print-meta-row"><span>Cash received</span><b>${rs(b.cash_received)}</b></div><div class="print-meta-row"><span>Change</span><b>${rs(b.change_due)}</b></div>`)}return h};
const _renderCartRemastered=renderCart;renderCart=function(){_renderCartRemastered();try{updateChangeDue()}catch{}};
// ===== END REMASTERED FEATURES =====


// ===== TEA AMO OPERATIONS PATCH: dynamic payments + manual POS close + complete reset =====
const DEFAULT_PAYMENT_METHODS=[
  {name:'Cash',kind:'cash'},
  {name:'eSewa',kind:'digital'},
  {name:'Khalti',kind:'digital'},
  {name:'Fonepay',kind:'digital'},
  {name:'Card',kind:'card'}
];
function normalizePaymentMethods(){
  if(!state.business)state.business={};
  if(!Array.isArray(state.business.payment_methods))state.business.payment_methods=clone(DEFAULT_PAYMENT_METHODS);
  const seen=new Set();
  state.business.payment_methods=state.business.payment_methods.map(x=>typeof x==='string'?{name:x,kind:x==='Cash'?'cash':['eSewa','Khalti','Fonepay'].includes(x)?'digital':x==='Card'?'card':'other'}:x).filter(x=>{
    x.name=String(x.name||'').trim();x.kind=x.kind||'other';
    if(!x.name||seen.has(x.name.toLowerCase()))return false;seen.add(x.name.toLowerCase());return true
  });
  if(!state.business.payment_methods.some(x=>x.name==='Cash'))state.business.payment_methods.unshift({name:'Cash',kind:'cash'});
  state.business.payment_qr=state.business.payment_qr||{};
  state.businessDays=(state.businessDays||[]).map(r=>({...r,posClosed:!!r.posClosed}));
}
const _repairStateOps=repairState;
repairState=function(s){s=_repairStateOps(s);state=s;normalizePaymentMethods();return s};

function paymentMethods(){normalizePaymentMethods();return state.business.payment_methods}
function paymentMethodKind(name){return paymentMethods().find(x=>x.name===name)?.kind||'other'}
function isDigitalPayment(name){return paymentMethodKind(name)==='digital'}
function renderPaymentMethodOptions(){
  const methods=paymentMethods(),current=$('payment')?.value,splitCurrent=$('splitPaymentMethod')?.value;
  const html=methods.map(m=>`<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('');
  if($('payment')){$('payment').innerHTML=html;if(methods.some(m=>m.name===current))$('payment').value=current}
  if($('splitPaymentMethod')){$('splitPaymentMethod').innerHTML=html;if(methods.some(m=>m.name===splitCurrent))$('splitPaymentMethod').value=splitCurrent}
  const setOperationalSelect=(id,extra=[])=>{const el=$(id);if(!el)return;const cur=el.value,names=[...methods.map(m=>m.name),...extra.filter(x=>!methods.some(m=>m.name===x))];el.innerHTML=names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');if(names.includes(cur))el.value=cur};
  setOperationalSelect('expensePayment',['Bank']);setOperationalSelect('recvPayment',['Bank','Credit']);
  ['eSewa','Khalti','Fonepay'].forEach(name=>{const box=document.querySelector(`[data-quick-method="${name}"]`);if(box)box.classList.toggle('hidden',!methods.some(m=>m.name===name))});
}
function renderPaymentMethodSettings(){
  renderPaymentMethodOptions();renderQrSettings();
  const body=$('paymentMethodBody');if(!body)return;
  const base=new Set(['Cash','eSewa','Khalti','Fonepay']);
  const rows=paymentMethods().filter(m=>!base.has(m.name));
  body.innerHTML=rows.map(m=>`<tr><td><b>${esc(m.name)}</b></td><td>${esc(m.kind)}</td><td>${m.kind==='digital'?(paymentQrFor(m.name)?'<span class="good">Configured</span>':'<span class="warn">Not uploaded</span>'):'—'}</td><td><div class="toolbar">${m.kind==='digital'?`<button class="btn alt" type="button" onclick="choosePaymentQr('${String(m.name).replaceAll("'","\\'")}')">Upload QR</button>`:''}<button class="btn danger" type="button" onclick="removePaymentMethod('${String(m.name).replaceAll("'","\\'")}')">Remove</button></div></td></tr>`).join('')||'<tr><td colspan="4" class="muted">No additional payment methods. Card can also be removed and re-added if you do not use it.</td></tr>';
}
function addPaymentMethodFromSettings(){
  const name=$('newPaymentMethodName').value.trim(),kind=$('newPaymentMethodKind').value;
  if(!name)return alert('Enter the payment method name.');
  if(paymentMethods().some(x=>x.name.toLowerCase()===name.toLowerCase()))return alert('That payment method already exists.');
  state.business.payment_methods.push({name,kind});$('newPaymentMethodName').value='';saveSoon();renderPaymentMethodSettings();setActionStatus(`${name} added as a payment method.`,'good')
}
async function removePaymentMethod(name){
  if(name==='Cash')return alert('Cash is kept as a core payment method because cash/change calculations depend on it.');
  if(!paymentMethods().some(x=>x.name===name))return;
  if(!confirm(`Remove ${name} completely from payment options? Existing historical bills will not be changed.`))return;
  state.business.payment_methods=state.business.payment_methods.filter(x=>x.name!==name);
  if(state.business.payment_qr)delete state.business.payment_qr[name];
  await persistNow('payment_method_removed');renderPaymentMethodSettings();updateMainPaymentQr();Promise.resolve(pushLanConfig()).catch(()=>{});setActionStatus(`${name} removed from payment options.`,'good')
}
function choosePaymentQr(method){
  const input=document.createElement('input');input.type='file';input.accept='image/*';input.onchange=()=>{const f=input.files?.[0];if(f)setPaymentQr(method,f).then(renderPaymentMethodSettings)};input.click()
}

const _renderSettingsOps=renderSettings;
renderSettings=function(){_renderSettingsOps();renderPaymentMethodSettings()};
const _renderPOSOps=renderPOS;
renderPOS=function(){renderPaymentMethodOptions();_renderPOSOps();renderPaymentMethodOptions();updateMainPaymentQr()};
const _openSplitBillOps=openSplitBill;
openSplitBill=function(){renderPaymentMethodOptions();return _openSplitBillOps()};

updateMainPaymentQr=function(){
  const method=$('payment')?.value||'Cash',panel=$('mainPaymentQrPanel'),img=$('mainPaymentQrImage'),label=$('mainPaymentQrLabel'),missing=$('mainPaymentQrMissing');if(!panel)return;
  const digital=isDigitalPayment(method);panel.classList.toggle('hidden',!digital);if(!digital)return;
  label.textContent=`${method} QR`;const qr=paymentQrFor(method);img.classList.toggle('hidden',!qr);missing.classList.toggle('hidden',!!qr);if(qr)img.src=qr;else img.removeAttribute('src')
};

openMixedPayment=function(selection=null,opts={}){
  const sel=selection||currentCart().map(c=>({id:c.id,qty:c.qty}));if(!sel.length)return alert('Add items first.');mixedPaymentContext={selection:sel,opts};
  const fields=$('mixedPaymentFields');fields.innerHTML=paymentMethods().map(m=>m.name==='Cash'?`<label>Cash applied<input data-mix-method="Cash" type="number" min="0" step=".01" value="0" oninput="updateMixedPaymentPreview()"></label><label>Cash received<input id="mixCashReceived" type="number" min="0" step=".01" value="0" oninput="updateMixedPaymentPreview()"></label>`:`<label>${esc(m.name)}<input data-mix-method="${esc(m.name)}" type="number" min="0" step=".01" value="0" oninput="updateMixedPaymentPreview()"></label>`).join('');
  $('mixedDue').textContent=rs(selectedTotals(sel).total);updateMixedPaymentPreview();$('mixedPaymentModal').classList.add('show')
};
mixedValues=function(){const out={};document.querySelectorAll('#mixedPaymentFields [data-mix-method]').forEach(el=>out[el.dataset.mixMethod]=Number(el.value||0));return out};
updateMixedPaymentPreview=function(){if(!mixedPaymentContext)return;const due=selectedTotals(mixedPaymentContext.selection).total,v=mixedValues(),applied=Object.values(v).reduce((a,b)=>a+b,0),remaining=due-applied,received=Number($('mixCashReceived')?.value||0),cash=Number(v.Cash||0),change=cash?Math.max(0,received-cash):0;$('mixedPreview').innerHTML=`Applied: <b>${rs(applied)}</b> · Remaining: <b class="${Math.abs(remaining)<.01?'good':'warn'}">${rs(Math.max(0,remaining))}</b> · Cash change: <b>${rs(change)}</b>`};
confirmMixedPayment=async function(){if(!mixedPaymentContext)return;const due=selectedTotals(mixedPaymentContext.selection).total,v=mixedValues(),applied=Object.values(v).reduce((a,b)=>a+b,0);if(Math.abs(applied-due)>.01)return alert(`Applied payments must equal ${rs(due)}.`);const rec=Number($('mixCashReceived')?.value||0),cash=Number(v.Cash||0);if(cash>0&&rec<cash-.009)return alert('Cash received cannot be less than cash applied.');const info={payment:'Mixed',payments:v,cash_received:rec,change_due:cash?Math.max(0,rec-cash):0};try{await completeSelection(mixedPaymentContext.selection,info);mixedPaymentContext=null;closeModal('mixedPaymentModal')}catch(e){alert(e.message||e)}};

// Manual POS opening/closing. No clock-time shutdown.
isCafeOpen=function(){const r=dayRecord();return !r.finalized&&!r.posClosed};
posAllowed=function(){const r=dayRecord();return !r.finalized&&!r.posClosed};
const _dayRecordOps=dayRecord;
dayRecord=function(key=businessDayKey()){const r=_dayRecordOps(key);if(typeof r.posClosed!=='boolean')r.posClosed=false;return r};
updateTop=function(){const r=dayRecord(),open=posAllowed();$('clockText').textContent=`${nptDateTime()} NPT · Business day ${businessDayKey()}`;$('branchBadge').textContent=state.business.branch;$('openBadge').innerHTML=r.finalized?'<span class="warn">● FINALIZED</span>':open?'<span class="good">● POS OPEN</span>':'<span class="bad">● POS CLOSED</span>'};
async function togglePosBilling(closeIt){
  const r=dayRecord();if(r.finalized&&!closeIt)return alert('This business day is finalized and cannot be reopened.');
  const password=$('closePassword').value;if(!await verifyOwnerPassword(password))return alert('Incorrect owner password.');
  if(closeIt&&!confirm('Close POS & Billing now? Open table orders are preserved, but no new payment can be completed until you reopen it.'))return;
  r.posClosed=!!closeIt;r.posClosedAt=closeIt?workingNowIso():null;audit(closeIt?'pos_closed':'pos_reopened',r.key);await persistNow(closeIt?'pos_closed':'pos_reopened');$('closePassword').value='';renderDayClose();updateTop();if(activeSection==='pos')renderPOS();setActionStatus(closeIt?'POS & Billing closed manually.':'POS & Billing reopened.','good')
}
const _finalizeBusinessDayOps=finalizeBusinessDay;
finalizeBusinessDay=async function(){const r=dayRecord();if(!r.posClosed&&!confirm('POS & Billing is still open. Finalizing will close it automatically. Continue?'))return;await _finalizeBusinessDayOps();if(r.finalized){r.posClosed=true;r.posClosedAt=r.posClosedAt||workingNowIso();await persistNow('finalize_pos_closed');renderDayClose();updateTop()}};
const _renderDayCloseOps2=renderDayClose;
renderDayClose=function(){_renderDayCloseOps2();const r=dayRecord();if($('closePosBilling'))$('closePosBilling').disabled=r.finalized||r.posClosed;if($('reopenPosBilling'))$('reopenPosBilling').disabled=r.finalized||!r.posClosed};

async function completeOperationalReset(){
  if(!await verifyOwnerPassword($('fullResetPassword').value))return alert('Incorrect owner password.');
  if($('fullResetConfirm').value.trim()!=='RESET TEA AMO')return alert('Type RESET TEA AMO exactly to continue.');
  if(!confirm('This will clear operational/test data and reset stock quantities to zero. A safety backup will be downloaded first. Menu, prices, recipes, staff profiles, vendors, payment methods, QR codes, business settings and owner password will be kept. Continue?'))return;
  downloadSafetyBackup('PRE_RESET');
  // Keep configuration; clear operational history and open work.
  state.bills=[];state.attendance=[];state.purchases=[];state.waste=[];state.expenses=[];state.customers=[];state.inventoryLog=[];state.businessDays=[];state.auditLog=[];state.ownerCapital=[];state.dailyBusinessReports=[];state.cart=[];state.tableOrders={};state.dashboardBaseline=null;
  state.ingredients.forEach(i=>{i.stock=0;i.avg_cost=0});state.staff.forEach(st=>{st.clockIn=null});state.tables.forEach(t=>{t.attention=false;t.reservation=null});
  activeTableId=null;lastPaidBill=null;rebuildIndex();
  await Promise.allSettled(state.tables.map(t=>deleteLanOrder(t.id)));
  if(!await persistNow('complete_operational_reset'))return alert('Reset changes could not be saved. Restore from the automatic PRE_RESET backup before continuing.');
  $('fullResetPassword').value=$('fullResetConfirm').value='';
  renderActive();updateTop();setActionStatus('System reset complete. TEA AMO is ready for a fresh operational start.','good');alert('Complete operational reset finished. Your setup/menu/payment configuration was preserved.')
}
// ===== END OPERATIONS PATCH =====

// ===== FINAL WORKING-DATE OVERRIDES =====
// Applied after the operations patch so historical owner mode cannot be overwritten by later POS helpers.
isCafeOpen=function(){const r=dayRecord();return !r.finalized&&!r.posClosed};
posAllowed=function(){const r=dayRecord();return !r.finalized&&!r.posClosed};
updateTop=function(){
  const r=dayRecord(),open=posAllowed(),key=businessDayKey(),real=currentRealBusinessDate();
  if($('clockText'))$('clockText').textContent=`${nptDateTime()} NPT · ${selectedWorkingDate()?'Working date':'Business day'} ${key}${selectedWorkingDate()&&key!==real?' · OWNER EDIT MODE':''}`;
  if($('branchBadge'))$('branchBadge').textContent=state.business.branch;
  if($('openBadge'))$('openBadge').innerHTML=selectedWorkingDate()?'<span class="warn">● OWNER DATE MODE</span>':r.finalized?'<span class="warn">● FINALIZED</span>':open?'<span class="good">● POS OPEN</span>':'<span class="bad">● POS CLOSED</span>';
  updateWorkingDateUI()
};
const _renderDayCloseWorkingDate=renderDayClose;
renderDayClose=function(){
  _renderDayCloseWorkingDate();const r=dayRecord();
  if(selectedWorkingDate()){
    if($('closePosBilling'))$('closePosBilling').disabled=false;
    if($('reopenPosBilling'))$('reopenPosBilling').disabled=false;
    if($('dayControl'))$('dayControl').insertAdjacentHTML('afterbegin','<div class="notice warn" style="margin-bottom:10px"><b>Owner date mode:</b> Business Day controls and Z-Report are showing '+esc(businessDayKey())+'. Historical viewing uses the selected business date. Finalized days remain locked; corrections must be entered as new adjustment/refund records.</div>')
  }
};
// ===== END FINAL WORKING-DATE OVERRIDES =====

window.TEA_AMO_BOOT = init;
if (!window.TEA_AMO_CLOUD) init();
