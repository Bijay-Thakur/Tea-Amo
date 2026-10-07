'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');

const HOST='0.0.0.0';
const PORT=Number(process.env.TEA_AMO_PORT||8787);
const ROOT=__dirname;
const PUBLIC=path.join(ROOT,'public');
const OWNER_SECTIONS=['dashboard','pos','dayclose','staff','menuadmin','inventory','recipes','wastage','vendors','expenses','capital','customers','dailyreport','reports','dining','settings'];
const STORE=path.join(ROOT,'lan-state.json');
const MASTER_STORE=path.join(ROOT,'master-state.json');
const sessions=new Map();

function emptyStore(){return{config:{business:{name:'TEA AMO',branch:'Main Branch',currency:'Rs',taxRate:0,payment_qr:{}},tables:[],menu:[],staff:[]},orders:{},completions:[]}}
function load(){try{return {...emptyStore(),...JSON.parse(fs.readFileSync(STORE,'utf8'))}}catch{return emptyStore()}}
let db=load();
function loadMaster(){try{return JSON.parse(fs.readFileSync(MASTER_STORE,'utf8'))}catch{return null}}
let masterState=loadMaster();
function saveMaster(next){const tmp=MASTER_STORE+'.tmp',bak=MASTER_STORE+'.bak';try{if(fs.existsSync(MASTER_STORE))fs.copyFileSync(MASTER_STORE,bak)}catch{}fs.writeFileSync(tmp,JSON.stringify(next,null,2));fs.renameSync(tmp,MASTER_STORE);masterState=next}
function save(){const tmp=STORE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,STORE)}
function json(res,code,data){const body=JSON.stringify(data);res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(body)});res.end(body)}
function text(res,code,body,type='text/plain; charset=utf-8'){res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body)}
function isLocal(req){const ip=(req.socket.remoteAddress||'').replace('::ffff:','');return ip==='127.0.0.1'||ip==='::1'}
function parseBody(req,limit=1024*1024){return new Promise((resolve,reject)=>{let data='',size=0;req.on('data',c=>{size+=c.length;if(size>limit){reject(new Error('Request too large'));req.destroy();return}data+=c});req.on('end',()=>{if(!data)return resolve({});try{resolve(JSON.parse(data))}catch{reject(new Error('Invalid JSON'))}});req.on('error',reject)})}
function authStaff(req){const h=String(req.headers.authorization||'');const token=h.startsWith('Bearer ')?h.slice(7):'';const s=sessions.get(token);if(!s||s.expires<Date.now()){if(token)sessions.delete(token);return null}return s}
function verifyPin(st,pin){try{if(!st?.pin_hash||!st?.pin_salt)return false;const got=crypto.pbkdf2Sync(String(pin),Buffer.from(st.pin_salt,'base64'),Number(st.pin_iterations||120000),32,'sha256').toString('base64');return crypto.timingSafeEqual(Buffer.from(got),Buffer.from(st.pin_hash))}catch{return false}}
function safeStaff(){return(db.config.staff||[]).filter(x=>x.enabled).map(({id,name,role})=>({id,name,role}))}
function networkUrls(){const urls=[];for(const group of Object.values(os.networkInterfaces()))for(const n of group||[])if(n.family==='IPv4'&&!n.internal)urls.push(`http://${n.address}:${PORT}/staff`);return urls}
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon','.json':'application/json; charset=utf-8'};
function resolvePublic(urlPath){const clean=decodeURIComponent(urlPath).replace(/^[/\\]+/,'');const file=path.resolve(PUBLIC,clean);const rel=path.relative(PUBLIC,file);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))return null;return file}
function serveStatic(res,urlPath){const file=resolvePublic(urlPath);if(!file)return text(res,403,'Forbidden');try{const body=fs.readFileSync(file);res.writeHead(200,{'Content-Type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store','Content-Length':body.length});res.end(body)}catch{text(res,404,'Not found')}}
function ownerPage(){const read=rel=>fs.readFileSync(path.join(PUBLIC,rel),'utf8');const sections=OWNER_SECTIONS.map(name=>read(path.join('owner','sections',name+'.html'))).join('\n');return read(path.join('owner','shell.html')).replace('<!--SIDEBAR-->',read(path.join('owner','partials','sidebar.html'))).replace('<!--TOPBAR-->',read(path.join('owner','partials','topbar.html'))).replace('<!--SECTIONS-->',sections).replace('<!--MODALS-->',read(path.join('owner','partials','modals.html')))}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`),p=u.pathname;
    if(p==='/api/network'&&req.method==='GET')return json(res,200,{staff_urls:networkUrls(),port:PORT});

    // Owner/admin API is intentionally available only from the laptop itself.
    if(p.startsWith('/api/admin/')){
      if(!isLocal(req))return json(res,403,{error:'Owner API is restricted to the TEA AMO laptop.'});
      if(p==='/api/admin/state'&&req.method==='GET')return json(res,200,{state:masterState});
      if(p==='/api/admin/state'&&req.method==='PUT'){
        const body=await parseBody(req,128*1024*1024),next=body&&body.state;
        if(!next||typeof next!=='object'||!Array.isArray(next.menu))return json(res,400,{error:'Invalid TEA AMO state payload'});
        saveMaster(next);return json(res,200,{ok:true,saved_at:new Date().toISOString()});
      }
      if(p==='/api/admin/config'&&req.method==='POST'){
        const body=await parseBody(req,16*1024*1024);db.config={...db.config,...body};save();return json(res,200,{ok:true});
      }
      if(p==='/api/admin/orders'&&req.method==='GET')return json(res,200,{orders:db.orders,completions:db.completions.filter(x=>!x.acked)});
      let m=p.match(/^\/api\/admin\/orders\/([^/]+)$/);
      if(m&&req.method==='PUT'){
        const id=decodeURIComponent(m[1]),body=await parseBody(req),old=db.orders[id]||{};const version=Number(old.version||0)+1;
        db.orders[id]={version,order:body.order||{},attention:!!body.attention,updated_by:'owner',updated_at:new Date().toISOString()};save();return json(res,200,{ok:true,version});
      }
      if(m&&req.method==='DELETE'){delete db.orders[decodeURIComponent(m[1])];save();return json(res,200,{ok:true})}
      m=p.match(/^\/api\/admin\/completions\/([^/]+)\/ack$/);
      if(m&&req.method==='POST'){const id=decodeURIComponent(m[1]);const c=db.completions.find(x=>x.id===id);if(c)c.acked=true;save();return json(res,200,{ok:true})}
      return json(res,404,{error:'Unknown admin endpoint'});
    }

    if(p.startsWith('/api/staff/')&&process.env.TEA_AMO_LEGACY_LAN!=='1')return json(res,410,{error:'LAN PIN login is retired. Sign in at the TEA AMO home page.'});
    if(p==='/api/staff/bootstrap'&&req.method==='GET')return json(res,200,{business:db.config.business||{},staff:safeStaff()});
    if(p==='/api/staff/login'&&req.method==='POST'){
      const body=await parseBody(req),st=(db.config.staff||[]).find(x=>String(x.id)===String(body.staff_id)&&x.enabled);
      if(!st||!verifyPin(st,body.pin))return json(res,401,{error:'Invalid staff or PIN'});
      const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{staff_id:st.id,staff_name:st.name,role:st.role,expires:Date.now()+12*3600e3});
      return json(res,200,{token,staff:{id:st.id,name:st.name,role:st.role}});
    }

    if(p.startsWith('/api/staff/')){
      const session=authStaff(req);if(!session)return json(res,401,{error:'Staff login required'});
      if(p==='/api/staff/config'&&req.method==='GET')return json(res,200,{business:db.config.business||{},tables:db.config.tables||[],menu:db.config.menu||[],staff:{id:session.staff_id,name:session.staff_name,role:session.role}});
      let m=p.match(/^\/api\/staff\/orders\/([^/]+)$/);
      if(m&&req.method==='GET'){const id=decodeURIComponent(m[1]);return json(res,200,db.orders[id]||{version:0,order:null,attention:false})}
      if(m&&req.method==='PUT'){
        const id=decodeURIComponent(m[1]),body=await parseBody(req),old=db.orders[id]||{};const expected=Number(body.expected_version??old.version??0);
        if(old.version!=null&&Number(old.version)!==expected)return json(res,409,{error:'Order changed on another device',current:old});
        const version=Number(old.version||0)+1;db.orders[id]={version,order:body.order||{},attention:!!body.attention,updated_by:session.staff_name,updated_at:new Date().toISOString()};save();return json(res,200,{ok:true,version});
      }
      if(p==='/api/staff/completions'&&req.method==='POST'){
        const body=await parseBody(req);if(!body.table_id||!body.order)return json(res,400,{error:'table_id and order are required'});
        const existing=db.completions.find(x=>x.table_id===body.table_id&&!x.acked);if(existing)return json(res,409,{error:'A completion request is already pending for this table.'});
        const id='SC-'+crypto.randomUUID();db.completions.push({id,table_id:body.table_id,order:body.order,payment:body.payment||'Cash',staff_id:session.staff_id,staff_name:session.staff_name,created_at:new Date().toISOString(),acked:false});save();return json(res,200,{ok:true,id});
      }
      return json(res,404,{error:'Unknown staff endpoint'});
    }

    if(p==='/'||p==='/index.html'){
      if(process.env.TEA_AMO_LEGACY_LAN!=='1')return text(res,200,'TEA AMO sign-in is the Vercel deployment, or npm run dev on this computer.\nThe laptop JSON server is only a fallback: set TEA_AMO_LEGACY_LAN=1.\n');
      if(!isLocal(req))return res.writeHead(302,{Location:'/staff'}).end();
      return text(res,200,ownerPage(),'text/html; charset=utf-8');
    }
    if(p==='/favicon.ico')return serveStatic(res,'/assets/favicon.ico');
    if((p==='/staff'||p==='/staff.html')&&process.env.TEA_AMO_LEGACY_LAN!=='1')return text(res,410,'The staff PIN page has been retired. Open /server on the TEA AMO deployment.\n');
    if(p==='/staff'||p==='/staff.html')return serveStatic(res,'/staff.html');
    if(p==='/tea-amo-floor-plan.png')return serveStatic(res,'/assets/tea-amo-floor-plan.png');
    if(p.startsWith('/styles/')||p.startsWith('/js/')||p.startsWith('/assets/'))return serveStatic(res,p);
    text(res,404,'Not found');
  }catch(err){console.error(err);if(!res.headersSent)json(res,500,{error:err.message||'Server error'});else res.end()}
});

server.listen(PORT,HOST,()=>{
  if(process.env.TEA_AMO_LEGACY_LAN==='1'){
    console.log(`TEA AMO legacy owner POS: http://127.0.0.1:${PORT}`);
    console.log('Legacy staff URLs:');for(const u of networkUrls())console.log('  '+u);
    console.log('This JSON/LAN mode is a fallback. Production sign-in is the Vercel deployment.');
    return;
  }
  console.log('TEA AMO laptop JSON server is in retired mode.');
  console.log('Use npm run dev, or the Vercel deployment, for Administration and Server sign-in.');
  console.log('Set TEA_AMO_LEGACY_LAN=1 only if you intentionally need the old Wi-Fi PIN flow.');
});
