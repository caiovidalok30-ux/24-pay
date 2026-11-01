const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000, SECRET=process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex');
const DB=path.join(__dirname,'data.json');
const USE_PG=Boolean(process.env.DATABASE_URL);
let pool=null;
let db={users:[],orders:[]};
if(!USE_PG&&fs.existsSync(DB)){try{db=JSON.parse(fs.readFileSync(DB))}catch{}}
async function save(){
 if(USE_PG){await pool.query('UPDATE app_state SET payload=$1::jsonb WHERE id=1',[JSON.stringify(db)]);}
 else fs.writeFileSync(DB,JSON.stringify(db,null,2));
}
async function initialize(){
 if(USE_PG){
  const {Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==='disable'?false:{rejectUnauthorized:true},max:3});
  await pool.query('CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY, payload JSONB NOT NULL)');
  await pool.query('INSERT INTO app_state(id,payload) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING',[JSON.stringify(db)]);
  const r=await pool.query('SELECT payload FROM app_state WHERE id=1');db=r.rows[0].payload;
 }
 db.users ||= [];db.orders ||= [];
 db.pricing={...defaults,...(db.pricing||{})};
 const adminEmail=(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
 if(adminEmail){let admin=db.users.find(u=>u.email===adminEmail);if(admin&&!admin.admin){admin.admin=true;await save();console.log('Administrador autorizado via ADMIN_EMAIL');}}
}
const hash=(p,s)=>crypto.scryptSync(p,s,64).toString('hex');const tokens=new Map();
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
function user(req){let token=(req.headers.authorization||'').replace(/^Bearer /,'');let id=tokens.get(token);return db.users.find(x=>x.id===id&&!x.blocked)}
function publicUser(u){return {id:u.id,name:u.name,email:u.email,admin:u.admin,blocked:!!u.blocked,createdAt:u.createdAt}}
async function body(req){let str='';for await(const c of req){str+=c;if(str.length>10000)throw Error('Requisição muito grande')}return JSON.parse(str||'{}')}
const services={mobile:'Recarga de celular',sky:'Recarga SKY',boleto:'Pagamento de boleto',gift:'Gift card'};
// Valores em centavos. Configuração inicial ilustrativa, sem contrato de fornecedor.
const defaults={mobile:{supplierPct:92,feePct:1,commissionPct:3,minProfitPct:2},sky:{supplierPct:93,feePct:1,commissionPct:2,minProfitPct:2},boleto:{supplierPct:96,feePct:1,commissionPct:1,minProfitPct:1},gift:{supplierPct:91,feePct:2,commissionPct:3,minProfitPct:2}};
const cents=v=>Math.round(Number(v)*100);
function calculate(service,amount){const c=db.pricing[service];if(!c)return null;const gross=cents(amount);if(!Number.isSafeInteger(gross)||gross<100||gross>500000)return null;
 const supplier=Math.round(gross*c.supplierPct/100),fee=Math.round(gross*c.feePct/100),commission=Math.round(gross*c.commissionPct/100),profit=gross-supplier-fee-commission,minProfit=Math.ceil(gross*c.minProfitPct/100);
 return {amountCents:gross,supplierCents:supplier,feeCents:fee,commissionCents:commission,ownerProfitCents:profit,minProfitCents:minProfit,eligible:profit>=minProfit&&profit>=0};}
function validPricing(c){return c&&['supplierPct','feePct','commissionPct','minProfitPct'].every(k=>typeof c[k]==='number'&&Number.isFinite(c[k])&&c[k]>=0&&c[k]<=100)&&c.supplierPct+c.feePct+c.commissionPct+c.minProfitPct<=100;}

const server=http.createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:");let url=new URL(req.url,'http://localhost');if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return fs.createReadStream(path.join(__dirname,'index.html')).pipe(res)}
if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,mode:'demonstration',paymentsEnabled:false});
if(!url.pathname.startsWith('/api/'))return json(res,404,{error:'Não encontrado'});
try{
if(req.method==='POST'&&url.pathname==='/api/register'){let b=await body(req),name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');if(name.length<2||!/^\S+@\S+\.\S+$/.test(email)||password.length<8)return json(res,400,{error:'Informe nome, e-mail válido e senha de 8 caracteres ou mais.'});if(db.users.some(x=>x.email===email))return json(res,409,{error:'E-mail já cadastrado.'});let salt=crypto.randomBytes(16).toString('hex'),u={id:crypto.randomUUID(),name,email,salt,passwordHash:hash(password,salt),admin:false,createdAt:new Date().toISOString()};db.users.push(u);await save();return json(res,201,{ok:true})}
if(req.method==='POST'&&url.pathname==='/api/login'){let b=await body(req),u=db.users.find(x=>x.email===String(b.email||'').trim().toLowerCase());if(!u||u.blocked)return json(res,401,{error:'Credenciais inválidas ou conta bloqueada.'});let h=hash(String(b.password||''),u.salt);if(!crypto.timingSafeEqual(Buffer.from(h,'hex'),Buffer.from(u.passwordHash,'hex')))return json(res,401,{error:'Credenciais inválidas.'});let token=crypto.randomBytes(32).toString('hex');tokens.set(token,u.id);return json(res,200,{token,user:publicUser(u)})}
let u=user(req);if(!u)return json(res,401,{error:'Faça login para continuar.'});
if(req.method==='POST'&&url.pathname==='/api/account/password'){
 let b=await body(req),oldPassword=String(b.currentPassword||''),newPassword=String(b.newPassword||'');
 if(newPassword.length<12||newPassword.length>128)return json(res,400,{error:'A nova senha deve ter entre 12 e 128 caracteres.'});
 const oldHash=hash(oldPassword,u.salt);
 if(!crypto.timingSafeEqual(Buffer.from(oldHash,'hex'),Buffer.from(u.passwordHash,'hex')))return json(res,403,{error:'Senha atual incorreta.'});
 u.salt=crypto.randomBytes(16).toString('hex');u.passwordHash=hash(newPassword,u.salt);
 await save();
 for(const [t,id] of tokens){if(id===u.id&&t!==((req.headers.authorization||'').replace(/^Bearer /,'')))tokens.delete(t)}
 return json(res,200,{ok:true,message:'Senha alterada.'});
}
if(req.method==='GET'&&url.pathname==='/api/me')return json(res,200,{user:publicUser(u)});
if(req.method==='POST'&&url.pathname==='/api/logout'){tokens.delete((req.headers.authorization||'').replace(/^Bearer /,''));return json(res,200,{ok:true})}
if(req.method==='GET'&&url.pathname==='/api/pricing'){return json(res,200,{pricing:u.admin?db.pricing:Object.fromEntries(Object.entries(db.pricing).map(([k,v])=>[k,{commissionPct:v.commissionPct}]))});}
if(req.method==='POST'&&url.pathname==='/api/quote'){let b=await body(req),q=calculate(String(b.service||''),b.amount);if(!q)return json(res,400,{error:'Serviço ou valor inválido.'});return json(res,200,{quote:{amountCents:q.amountCents,commissionCents:q.eligible?q.commissionCents:0,eligible:q.eligible},message:'Prévia demonstrativa; nenhuma comissão foi creditada.'});}
if(req.method==='PUT'&&url.pathname==='/api/admin/pricing'){if(!u.admin)return json(res,403,{error:'Acesso restrito.'});let b=await body(req),service=String(b.service||''),config=b.config;if(!services[service]||!validPricing(config))return json(res,400,{error:'Configuração inválida ou margem mínima não protegida. A soma dos percentuais não pode superar 100%.'});db.pricing[service]={supplierPct:config.supplierPct,feePct:config.feePct,commissionPct:config.commissionPct,minProfitPct:config.minProfitPct};await save();return json(res,200,{ok:true,pricing:db.pricing});}
if(req.method==='GET'&&url.pathname==='/api/admin/summary'){if(!u.admin)return json(res,403,{error:'Acesso restrito.'});return json(res,200,{mode:'demonstration',realizedProfitCents:0,paidCommissionCents:0,simulationCount:db.orders.length,byService:Object.fromEntries(Object.keys(services).map(k=>[k,{simulations:db.orders.filter(o=>o.service===k).length,realizedProfitCents:0}]))});}
if(req.method==='GET'&&url.pathname==='/api/orders'){let orders=u.admin?db.orders:db.orders.filter(x=>x.userId===u.id);return json(res,200,{orders:orders.slice().reverse()})}
if(req.method==='POST'&&url.pathname==='/api/orders'){let b=await body(req),amount=Number(b.amount),service=String(b.service||''),target=String(b.target||'').trim();if(!services[service]||!Number.isFinite(amount)||amount<1||amount>5000||target.length<3||target.length>150)return json(res,400,{error:'Preencha os dados corretamente. Valor entre R$ 1 e R$ 5.000.'});let q=calculate(service,amount);if(!q||!q.eligible)return json(res,400,{error:'Operação bloqueada: margem do proprietário insuficiente para pagar a comissão e os custos.'});let o={id:crypto.randomUUID(),userId:u.id,userName:u.name,service,serviceName:services[service],amount:Math.round(amount*100)/100,target,status:'simulação',commission:0,simulationQuote:{...q},pricingSnapshot:{...db.pricing[service]},createdAt:new Date().toISOString()};db.orders.push(o);await save();return json(res,201,{order:o,message:'Solicitação de demonstração registrada. Nenhum pagamento ou recarga foi realizado.'})}

if(req.method==='GET'&&url.pathname==='/api/finance/summary'){
 const own=db.orders.filter(o=>o.userId===u.id);
 const projected=own.reduce((sum,o)=>sum+(o.simulationQuote?.commissionCents||0),0);
 return json(res,200,{mode:'demonstration',availableCommissionCents:0,paidCommissionCents:0,projectedCommissionCents:projected,simulations:own.length});
}
if(req.method==='GET'&&url.pathname==='/api/admin/finance'){
 if(!u.admin)return json(res,403,{error:'Acesso restrito.'});
 const byService=Object.fromEntries(Object.keys(services).map(service=>{
  const orders=db.orders.filter(o=>o.service===service);
  const sum=field=>orders.reduce((total,o)=>total+(o.simulationQuote?.[field]||0),0);
  return [service,{
   simulations:orders.length,
   projectedRevenueCents:sum('amountCents'),
   projectedSupplierCostCents:sum('supplierCents'),
   projectedFeesCents:sum('feeCents'),
   projectedCommissionCents:sum('commissionCents'),
   projectedOwnerProfitCents:sum('ownerProfitCents')
  }];
 }));
 return json(res,200,{mode:'demonstration',realizedOwnerProfitCents:0,paidCommissionCents:0,availableCommissionCents:0,byService});
}
if(req.method==='PUT'&&url.pathname==='/api/admin/users/status'){
 if(!u.admin)return json(res,403,{error:'Acesso restrito.'});
 const b=await body(req);
 if(typeof b.blocked!=='boolean')return json(res,400,{error:'Status inválido.'});
 const target=db.users.find(x=>x.id===String(b.userId||''));
 if(!target)return json(res,404,{error:'Usuário não encontrado.'});
 if(target.id===u.id||target.admin)return json(res,403,{error:'Não é permitido alterar o acesso de administradores.'});
 target.blocked=b.blocked;await save();
 if(target.blocked){for(const [t,id] of tokens){if(id===target.id)tokens.delete(t)}}
 return json(res,200,{ok:true,user:{...publicUser(target),blocked:!!target.blocked}});
}
if(req.method==='GET'&&url.pathname==='/api/admin/users'){if(!u.admin)return json(res,403,{error:'Acesso restrito.'});return json(res,200,{users:db.users.map(publicUser)})}
return json(res,404,{error:'Rota inexistente'});
}catch(e){return json(res,400,{error:'Não foi possível processar a solicitação.'})}});
initialize().then(()=>server.listen(PORT,'0.0.0.0',()=>console.log(`24 PAY v1.5 na porta ${PORT} (modo demonstração)`))).catch(e=>{console.error('Erro ao inicializar banco:',e.message);process.exit(1)});
