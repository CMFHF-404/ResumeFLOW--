import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import ResumePdfDocument from '../../../views/ResumeEditor/components/ResumePdfDocument';
import {measureResumePrintLayout} from '../../../utils/resumePrintLayout';
import {waitForResumeRenderReady} from '../../../utils/resumeRenderReadiness';
import type {ResumePdfRenderSnapshot} from '../../../types/resume';
import '../../../styles/tailwind.css';

const snapshot: ResumePdfRenderSnapshot = {
  resumeName:'Pagination QA', targetRole:'Engineer',
  profile:{name:'QA CANDIDATE',email:'qa@example.test',phone:'',location:'',linkedin:'',summary:'SHORT SUMMARY',avatarDataUrl:''},
  lineHeight:1.35,fontSize:13,listSpacingValue:'0.25em',bulletSpacingValue:'0.1em',topPaddingPx:15,
  sectionSpacingClass:'mb-2',listSpacingClass:'space-y-[var(--rf-list-spacing)]',
  sectionOrder:['summary','work'],selectedWorkItems:[{id:'work-1',company:'COMPANY',title:'ENGINEER',date:'2020 - 2026',category:'work',star:{s:'',t:'',a:'LINE 01',r:''}}],
  selectedProjectItems:[],educations:[],selectedEduIds:[],sortedCertifications:[],selectedCertIds:[],selectedSkillGroups:[],
  templateId:'modern-slate',themeColorPresetId:'slate',experienceListMarkerStyle:'none',skillTagSeparator:'，',
};
const root = createRoot(document.getElementById('root')!);
const api = {
  ready: waitForResumeRenderReady,
  async render(overrides: Partial<ResumePdfRenderSnapshot> = {}) {
    document.querySelectorAll('[data-rf-print-flow="probe"]').forEach(node=>node.remove());
    const value = {...snapshot,...overrides};
    flushSync(()=>root.render(<><div id="measure"><ResumePdfDocument snapshot={value} previewScope="measure" /></div><div id="pdf"><ResumePdfDocument snapshot={value}/></div></>));
    document.body.getBoundingClientRect();
    await Promise.race([document.fonts.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Fixture fonts timed out')),10000))]);
  },
  measure(scope='measure') {
    const page = document.querySelector<HTMLElement>(`#${scope} .a4-preview`)!;
    return measureResumePrintLayout(page,page.querySelector<HTMLElement>('.rf-template-content-layout')!);
  },
  snapshot,
};
Object.assign(window,{paginationQA:api});
void api.render();
