import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';

async function loadExecution(h) {
  globalThis.__pageLifecycle=h;
  const result=await build({entryPoints:['views/ResumeEditor/hooks/useSmartPageExecution.ts'],bundle:true,write:false,format:'esm',plugins:[{
    name:'lifecycle-boundaries',setup(b){
      b.onResolve({filter:/^(react|.*analyticsTracker|.*resumeRenderReadiness|.*snapshotUtils|.*smartPageExecutionUtils|.*helpers)$/},args=>({path:args.path,namespace:'stub'}));
      b.onLoad({filter:/.*/,namespace:'stub'},({path})=>({loader:'js',contents:
        path==='react' ? `const h=globalThis.__pageLifecycle; export const useCallback=f=>f; export const useRef=v=>{const i=h.cursor++;return h.refs[i]??(h.refs[i]={current:v});}; export const useLayoutEffect=(f,deps)=>{const i=h.cursor++;if(!h.effects[i]||h.effects[i].deps[0]!==deps[0]){h.effects[i]?.cleanup?.();h.effects[i]={deps,cleanup:f()};}};` :
        path.endsWith('resumeRenderReadiness') ? `export const waitForResumeRenderReady=(...args)=>globalThis.__pageLifecycle.ready(...args);` :
        path.endsWith('snapshotUtils') ? `export const measureResumeLayout=()=>globalThis.__pageLifecycle.measure();` :
        path.endsWith('smartPageExecutionUtils') ? `export const resolveSmartPageExpansionFit=async({initialFit})=>initialFit; export const resolveSmartPageShrinkFit=async({defaultLayout})=>({fitLayout:null,hardFallbackLayout:defaultLayout});` :
        path.endsWith('helpers') ? `export const getA4PixelHeight=()=>1122;` : `export const trackSmartOnePageTriggered=()=>{};`
      }));
    },
  }]});
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
}

const layout={topPaddingPx:15,sectionSpacingKey:2,itemSpacingEm:0.25,lineHeight:1.35,fontSize:13};
function harness(){
  const h={refs:[],effects:[],cursor:0,ready:async()=>{},measure:()=>({fits:true}),visible:[],paused:[]};
  const noop=()=>{};
  h.params={currentLayout:layout,contentRevision:'revision-a',density:'standard',a4HeightRef:{current:1122},smartPageAdjustingRef:{current:false},measurePreviewRef:{current:{}},measurePreviewContentRef:{current:{}},
    setTopPaddingPx:v=>h.visible.push(v),setSectionSpacingKey:noop,setItemSpacingEm:noop,setLineHeight:noop,setFontSize:noop,setMeasureLayout:noop,setIsSmartPageApplied:noop,setIsAutoSavePaused:v=>h.paused.push(v),buildDefaultSmartPageLayout:()=>layout,showToastInfo:noop};
  return h;
}

test('candidate fit is rejected when final resource-ready measurement overflows',async()=>{
  const h=harness();let count=0;h.measure=()=>({fits:++count===1});
  globalThis.requestAnimationFrame=f=>setImmediate(f);
  const {useSmartPageExecution}=await loadExecution(h);
  const api=useSmartPageExecution(h.params);
  assert.equal((await api.executeSmartPageAdjustment()).status,'overflow');
  assert.equal(api.isSinglePageVerified(layout),false);
  assert.deepEqual(h.paused,[true,false]);
});

test('editing while resources load invalidates old run and never commits it',async()=>{
  const h=harness();let release;h.ready=()=>new Promise(resolve=>{release=resolve;});
  const {useSmartPageExecution}=await loadExecution(h);
  let api=useSmartPageExecution(h.params);
  const pending=api.executeSmartPageAdjustment();
  h.cursor=0;api=useSmartPageExecution({...h.params,contentRevision:'revision-b'});
  release();
  assert.equal((await pending).status,'skipped');
  assert.deepEqual(h.visible,[]);
  assert.equal(api.isSinglePageVerified(layout),false);
});

test('external density/layout changes invalidate a running search',async()=>{
  const h=harness();let release;h.ready=()=>new Promise(resolve=>{release=resolve;});
  const {useSmartPageExecution}=await loadExecution(h);
  let api=useSmartPageExecution(h.params);
  const pending=api.executeSmartPageAdjustment();
  h.cursor=0;api=useSmartPageExecution({...h.params,currentLayout:{...layout,itemSpacingEm:0.6}});
  release();
  assert.equal((await pending).status,'skipped');
  assert.deepEqual(h.visible,[]);
});

test('verification is tied to content and exact layout; manual restore invalidates it',async()=>{
  const h=harness();globalThis.requestAnimationFrame=f=>setImmediate(f);
  const {useSmartPageExecution}=await loadExecution(h);
  const api=useSmartPageExecution(h.params);
  assert.equal((await api.executeSmartPageAdjustment()).status,'fit');
  assert.equal(api.isSinglePageVerified({...layout}),true);
  assert.equal(api.isSinglePageVerified({...layout,fontSize:14}),false);
  api.restoreDefaultLayout();
  assert.equal(api.isSinglePageVerified(layout),false);
});

test('layout stays busy and autosave paused through final readiness',async()=>{
  const h=harness();let calls=0;let release;
  h.ready=async()=>{if(++calls===2) await new Promise(resolve=>{release=resolve;});};
  globalThis.requestAnimationFrame=f=>setImmediate(f);
  const {useSmartPageExecution}=await loadExecution(h);
  const api=useSmartPageExecution(h.params);
  const pending=api.executeSmartPageAdjustment();
  while(!release) await new Promise(setImmediate);
  assert.equal(h.params.smartPageAdjustingRef.current,true);
  assert.deepEqual(h.paused,[true]);
  assert.equal((await api.executeSmartPageAdjustment()).reason,'busy');
  release();
  assert.equal((await pending).status,'fit');
  assert.deepEqual(h.paused,[true,false]);
});

for (const scenario of ['same resume', 'different resume', 'switch away and back']) {
test(`export waiting for layout stays bound to its resume: ${scenario}`,async()=>{
  let release; const refs=[]; const effects=[]; let cursor=0; const snapshots=[];
  globalThis.__exportLifecycle={
    ref(value){const i=cursor++;return refs[i]??(refs[i]={current:value});},
    effect(fn,deps){const i=cursor++;if(!deps||!effects[i]||deps.some((v,j)=>v!==effects[i].deps[j])){effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};}},
    snapshot(value){snapshots.push(value);},
  };
  const result=await build({entryPoints:['views/ResumeEditor/hooks/useResumePdfExport.ts'],bundle:true,write:false,format:'esm',plugins:[{
    name:'export-boundaries',setup(b){
      b.onResolve({filter:/^(react|.*exportService|.*resumeService|.*downloadUrlFile|.*analyticsTracker)$/},args=>({path:args.path,namespace:'stub'}));
      b.onLoad({filter:/.*/,namespace:'stub'},({path})=>({loader:'js',contents:
        path==='react' ? `const h=globalThis.__exportLifecycle;export const useRef=v=>h.ref(v);export const useCallback=f=>f;export const useEffect=(f,d)=>h.effect(f,d);export const useLayoutEffect=useEffect;` :
        path.endsWith('exportService') ? `export const exportService={createResumePdfDownloadLink:async snapshot=>{globalThis.__exportLifecycle.snapshot(snapshot);return {downloadUrl:'/pdf',fileName:'qa.pdf'};}};` :
        path.endsWith('resumeService') ? `export const captureResumeAuthCacheKey=async()=> 'owner-a'; export const assertResumeAuthContext=async()=>{};` :
        path.endsWith('downloadUrlFile') ? `export const downloadUrlFile=async()=>{};` : `export const trackResumeExported=()=>{};`
      }));
    },
  }]});
  const {useResumePdfExport}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${encodeURIComponent(scenario)}`);
  const noop=()=>{};
  const props={resumeId:'resume-a',isSmartPageAdjusting:()=>false,waitForSmartPageIdle:()=>new Promise(resolve=>{release=resolve;}),isSinglePageVerified:()=>true,authUserKey:'owner-a',isExportingPdf:false,setIsExportingPdf:noop,showToastLoading:()=> 'toast',updateToast:noop,closeToast:noop,
    resumeName:'old',targetRole:'',profile:{},lineHeight:1.35,fontSize:13,listSpacingValue:'0.25em',bulletSpacingValue:'0.1em',topPaddingPx:15,sectionSpacingClass:'mb-2',listSpacingClass:'',sectionOrder:[],selectedWorkItems:[],selectedProjectItems:[],educations:[],selectedEduIds:new Set(),sortedCertifications:[],selectedCertIds:new Set(),selectedSkillGroups:[],templateId:'modern-slate',themeColorPresetId:'slate',experienceListMarkerStyle:'none',skillTagSeparator:','};
  globalThis.requestAnimationFrame=f=>setImmediate(f);
  const pending=useResumePdfExport(props)();
  while(!release) await new Promise(setImmediate);
  cursor=0;useResumePdfExport({...props,resumeId:scenario === 'same resume' ? 'resume-a' : 'resume-b',resumeName:'latest committed'});
  if (scenario === 'switch away and back') {
    cursor=0;useResumePdfExport(props);
  }
  release();await pending;
  if (scenario !== 'same resume') {
    assert.equal(snapshots.length,0,'the cancelled export must not submit either resume');
    // A fresh export in the new context must still work.
    cursor=0;
    await useResumePdfExport({...props,resumeId:'resume-b',resumeName:'new export',waitForSmartPageIdle:async()=>{}})();
    assert.equal(snapshots.length,1);
    assert.equal(snapshots[0].resumeName,'new export');
    return;
  }
  assert.equal(snapshots.length,1);
  assert.equal(snapshots[0].resumeName,'latest committed');
  assert.deepEqual(snapshots[0].pageConstraint,{maxPages:1});
});
}

test('readiness waits for cold fonts and image decoding, and rejects failure/abort/deadline',async()=>{
  const result=await build({entryPoints:['utils/resumeRenderReadiness.ts'],bundle:true,write:false,format:'esm'});
  const {waitForResumeRenderReady}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const saved={document:globalThis.document,MutationObserver:globalThis.MutationObserver,getComputedStyle:globalThis.getComputedStyle};
  let fontLoaded,imageDecoded;
  const fonts=[];fonts.status='loading';fonts.ready=new Promise(resolve=>{fontLoaded=()=>{fonts.status='loaded';resolve();};});
  const image={src:'image.png',currentSrc:'image.png',complete:false,naturalWidth:0,decode:()=>new Promise(resolve=>{imageDecoded=()=>{image.complete=true;image.naturalWidth=80;resolve();};})};
  const root={isConnected:true,querySelectorAll:selector=>selector==='img'?[image]:[]};
  globalThis.document={fonts};globalThis.MutationObserver=class {observe(){}disconnect(){}};
  globalThis.getComputedStyle=()=>({backgroundImage:'none'});
  globalThis.requestAnimationFrame=f=>setImmediate(f);
  try {
    let ready=false;
    const pending=waitForResumeRenderReady(root,{signal:new AbortController().signal,deadlineMs:Date.now()+2000}).then(()=>{ready=true;});
    await new Promise(setImmediate);assert.equal(ready,false);assert.equal(imageDecoded,undefined);
    fontLoaded();await new Promise(setImmediate);assert.equal(ready,false);
    imageDecoded();await pending;assert.equal(ready,true);
    image.decode=async()=>{throw new Error('broken image');};
    await assert.rejects(waitForResumeRenderReady(root,{signal:new AbortController().signal,deadlineMs:Date.now()+2000}),/broken image/);
    image.decode=()=>new Promise(()=>{});
    const controller=new AbortController();
    const aborted=waitForResumeRenderReady(root,{signal:controller.signal,deadlineMs:Date.now()+2000});
    controller.abort();await assert.rejects(aborted,/取消/);
    await assert.rejects(waitForResumeRenderReady(root,{signal:new AbortController().signal,deadlineMs:Date.now()+15}),/超时/);
  } finally {Object.assign(globalThis,saved);}
});
