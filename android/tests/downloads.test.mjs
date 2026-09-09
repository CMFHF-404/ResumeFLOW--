import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const script = readFileSync(new URL('../app/src/main/assets/downloads.js', import.meta.url),'utf8');
function harness({bytes=new Uint8Array([1,2,3]),main=true,rejectType}={}) {
  const calls=[],alerts=[],chunks=[];
  let click;
  const window = {};
  window.top = main ? window : {};
  window.ResumeFlowDownload = {postMessage(raw) {
    const payload=JSON.parse(raw); calls.push(payload);
    if(payload.type==='chunk') chunks.push(Buffer.from(payload.data,'base64'));
    queueMicrotask(()=>window.ResumeFlowDownload.onmessage({data:JSON.stringify({ok:payload.type!==rejectType})}));
  }};
  const context=vm.createContext({window,location:{origin:'https://resumeflow.preview.aliyun-zeabur.cn'},
    document:{addEventListener(type,fn){click=fn;}},
    Blob, URL:{createObjectURL:()=> 'blob:https://resumeflow.preview.aliyun-zeabur.cn/123',revokeObjectURL(){}},
    fetch:async()=>{throw new Error('CSP blocks Blob fetch');},
    Uint8Array,Date,Math,JSON,Promise,Error,setTimeout,clearTimeout,
    btoa:s=>Buffer.from(s,'binary').toString('base64'),alert:s=>alerts.push(s)});
  vm.runInContext(script,context);
  return {calls,alerts,chunks,click:(href)=> {
    href ??= context.URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    let prevented=false;
    click?.({target:{closest:()=>({href,download:'张三简历.pdf'})},preventDefault(){prevented=true},stopImmediatePropagation(){}});
    return prevented;
  }, get installed(){return !!click;}};
}
async function settle(h){for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,5));if(h.calls.at(-1)?.type==='end'||h.alerts.length)break;}}
test('Blob bytes are preserved without fetch even when CSP forbids blob connections', async()=>{
  const bytes=new Uint8Array(150000).map((_,i)=>i%255),h=harness({bytes});
  assert.ok(h.click());await settle(h);
  assert.equal(h.calls[0].name,'张三简历.pdf');assert.equal(h.calls[0].size,bytes.length);
  assert.equal(h.calls.at(-1).type,'end');assert.deepEqual(Buffer.concat(h.chunks),Buffer.from(bytes));
  assert.ok(h.chunks.every(c=>c.length<=48*1024));assert.deepEqual(h.alerts,[]);
});
test('ordinary links and foreign Blob origins are untouched',()=>{
  const h=harness();assert.equal(h.click('https://example.com/file.pdf'),false);
  assert.equal(h.click('blob:https://evil.com/123'),false);assert.equal(h.calls.length,0);
});
test('bridge is never installed in an iframe',()=>{assert.equal(harness({main:false}).installed,false);});
test('chunk rejection aborts transfer and reports an error',async()=>{
  const h=harness({rejectType:'chunk'});h.click();await settle(h);
  assert.ok(h.calls.some(x=>x.type==='abort'));assert.equal(h.calls.some(x=>x.type==='end'),false);assert.equal(h.alerts.length,1);
});
test('rejected begin does not abort an already pending native save',async()=>{
  const h=harness({rejectType:'begin'});h.click();await settle(h);
  assert.deepEqual(h.calls.map(x=>x.type),['begin']);assert.equal(h.alerts.length,1);
});
