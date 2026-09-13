const kinds=new Set(['education_courses','education_notes','certification_order','certification_hide','experience_order','experience_hide','experience_restructure','skill_create']);
export function validSelectionActions(report){
  const sources=new Map(report.sources.map(s=>[s.sourceId,s]));
  for(const s of report.suggestions){
    if(!['information_selection','evidence_enrichment','technical_restructure','skill_creation','existing_edit'].includes(s.strategyType))return false;
    if(!Array.isArray(s.selectedItems)||!s.selectedItems.every(x=>typeof x==='string')||new Set(s.selectedItems).size!==s.selectedItems.length)return false;
    if(!Array.isArray(s.operations)||s.operations.length!==1)return false;
    const op=s.operations[0];if(op.kind!==s.moduleType||op.moduleId!==s.moduleId||op.fieldPath!==s.fieldPath||JSON.stringify(op.selectedItems)!==JSON.stringify(s.selectedItems))return false;
    if(!Array.isArray(s.availableItems)||!Array.isArray(s.executionRequirements)||!s.executionRequirements.every(x=>typeof x==='string'))return false;
    if(kinds.has(s.moduleType)&&s.fieldPath!==s.moduleType)return false;
    if(['education_courses','certification_order','experience_order'].includes(s.moduleType)){
      const ids=s.availableItems.map(x=>x.id);
      if(s.selectedItems.some(x=>!ids.includes(x))||(s.moduleType!=='education_courses'&&s.selectedItems.length!==ids.length))return false;
    }else if(s.selectedItems.length)return false;
    if(s.moduleType==='skill_create'){
      const source=sources.get(s.candidateSourceRef);
      if(!source||!source.path.startsWith('resume.experiences[')||typeof s.candidateText!=='string'||!s.candidateText.trim()||!source.text.includes(s.candidateText)||!s.needsFacts||s.handling!=='ask_user')return false;
    }else if(s.candidateText!==null||s.candidateSourceRef!==null)return false;
  }
  return true;
}
