import { build } from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '../../tailwind.config.cjs';
import { chromium } from 'playwright';

export async function compileAgentFixture() {
  const result = await build({ entryPoints:['tests/fixtures/agentPageFixture.tsx'], bundle:true, write:false,
    outdir:'out', format:'iife', platform:'browser', define:{'process.env.NODE_ENV':'"test"', 'import.meta.env':JSON.stringify({DEV:true,PROD:false,VITE_API_BASE_URL:'/api'})},
    plugins:[{name:'fixture-auth-only',setup(build) {
      build.onResolve({filter:/^@logto\/react$/},()=>({path:'logto',namespace:'fixture'}));
      build.onResolve({filter:/\/AuthGuard$/},()=>({path:'guard',namespace:'fixture'}));
      build.onResolve({filter:/\/useAuthUserKey$/},()=>({path:'owner',namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',contents:args.path==='guard'
        ? 'export default function Guard({children}) {return children;}'
        : args.path==='owner' ? `export const useAuthUserKey=()=>new URLSearchParams(location.search).has('guest')?null:'agent-fixture'; export const readStoredAuthUserKey=useAuthUserKey; export const writeStoredAuthUserKey=()=>{};`
        : `const noop=async()=>{}; export const useLogto=()=>({isAuthenticated:!new URLSearchParams(location.search).has('guest'),isLoading:false,signIn:noop,signOut:noop}); export const useHandleSignInCallback=()=>({isLoading:false});` }));
    }}],
  });
  const css = await postcss([tailwindcss(tailwindConfig)]).process(readFileSync('styles/tailwind.css','utf8'),{from:'styles/tailwind.css'});
  return {js:result.outputFiles.find(f=>f.path.endsWith('.js')).text,css:css.css+'\n'+(result.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'')};
}

export async function startAgentHarness(bundle) {
  const html=readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('</head>','<link rel="stylesheet" href="/fixture.css"></head>').replace('</body>','<script src="/fixture.js"></script></body>');
  const server=createServer((req,res)=>{
    if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');return res.end(bundle.js);}
    if(req.url==='/fixture.css'){res.setHeader('content-type','text/css');return res.end(bundle.css);}
    const path=resolve('public','.'+new URL(req.url,'http://fixture').pathname);
    if(path.startsWith(resolve('public')+sep) && existsSync(path)){return res.end(readFileSync(path));}
    res.setHeader('content-type','text/html');res.end(html);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try {browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});}
  catch(error) {if(process.env.PLAYWRIGHT_CHANNEL)throw error;browser=await chromium.launch({channel:'msedge',headless:true});}
  return {browser,url:`http://127.0.0.1:${server.address().port}`,close:async()=>{await browser.close();await new Promise(r=>server.close(r));}};
}

export async function mockAgentApi(page) {
  const stamp='2026-09-01T00:00:00Z';
  const resumes=['resume-a','resume-b'].map(id=>({id,user_id:'agent-fixture',title:'同名简历',created_at:stamp,updated_at:stamp,config:{},target_role:'产品经理'}));
  const profile={user_id:'agent-fixture',full_name:'测试用户',title:'产品经理',email:'fixture@example.test',phone:'13800000000',location:'上海',summary:'测试简介',links:[],extra_json:{},updated_at:stamp};
  const requests=[];
  await page.route('**/*',async route=>{
    const request=route.request(), url=new URL(request.url());
    if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
    if(!url.pathname.startsWith('/api'))return route.continue();
    const path=url.pathname.replace(/^\/api/,'');
    // Let the shell's initial owner/cache effects settle before the list arrives,
    // as with a real network response. All tests still wait on rendered controls.
    if(path==='/resumes' && request.method()==='GET') await new Promise(resolve=>setTimeout(resolve,150));
    requests.push({path,method:request.method(),body:request.postDataJSON()});
    let data=[];
    if(path==='/exports/resume-pdf-link') return route.fulfill({json:{downloadUrl:'/exports/fixture.pdf',fileName:'fixture.pdf'}});
    if(path==='/exports/fixture.pdf') return route.fulfill({contentType:'application/pdf',body:'%PDF-1.4\n% UI download fixture only\n%%EOF'});
    if(path==='/profile') {if(request.method()!=='GET')Object.assign(profile,request.postDataJSON());data=profile;}
    else if(path==='/resumes')data=resumes;
    else if(path.startsWith('/resumes/')) {const record=resumes.find(r=>r.id===path.split('/')[2])||resumes[0];if(request.method()!=='GET')Object.assign(record,request.postDataJSON());data=request.method()==='GET'?{resume:record,experiences:[],educations:[],certifications:[]}:record;}
    else if(path.endsWith('/billing/summary'))data={remaining_tokens:10000,token_limit:10000,used_tokens:0,remaining_percent:100,is_unlimited:false};
    else if(path.endsWith('/billing/products'))data={products:[]};
    else if(path.includes('/assistant/sessions')&&request.method()==='POST')data={id:'session-a',title:'新对话',created_at:stamp,updated_at:stamp};
    else if(path.includes('/assistant/sessions/'))data={session:{id:'session-a',title:'新对话'},messages:[]};
    await route.fulfill({json:data});
  });
  return requests;
}
