import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../App';
import ConfirmDialog from '../../components/ConfirmDialog';
import RenameResumeDialog from '../../views/Dashboard/components/RenameResumeDialog';
import RichTextEditor from '../../components/RichTextEditor';
import MonthPicker from '../../components/MonthPicker';
import ExperienceCard from '../../views/ExperienceCard';
import { ChatInputBox } from '../../views/AIAssistant/ChatInputBox';
import { setAuthSessionOwner, setAuthTokenProvider } from '../../services/authTokenProvider';

const token = `e30.${btoa(JSON.stringify({sub:'agent-fixture',exp:4102444800}))}.fixture`;
setAuthTokenProvider(async () => token);
setAuthSessionOwner('agent-fixture');
localStorage.setItem('yuanzijianli.authUserKey', 'agent-fixture');
const params = new URLSearchParams(location.search);
localStorage.setItem('yuanzijianli.currentView', params.get('view') || 'DASHBOARD');
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');

function Controls() {
  const [dialog, setDialog] = useState(params.get('dialog'));
  const [name, setName] = useState('同名简历');
  const [text, setText] = useState('<p>原有内容</p>');
  const [month, setMonth] = useState('2024.01');
  const [chat, setChat] = useState('');
  const [sent, setSent] = useState(0);
  return <div className="p-6 space-y-6">
    <button onClick={() => setDialog('rename')}>重命名</button>
    <button onClick={() => setDialog('confirm')}>删除简历</button>
    <p>{name}</p>
    <RichTextEditor value={text} onChange={setText} ariaLabel="经历描述" />
    <MonthPicker value={month} onChange={setMonth} placeholder="开始月份" />
    <ChatInputBox value={chat} onChange={setChat} isSending={false} onSubmit={() => {setSent(n=>n+1);setChat('');}} />
    <output aria-label="发送次数">{sent}</output>
    <RenameResumeDialog isOpen={dialog === 'rename'} initialName={name} onCancel={()=>setDialog(null)} onConfirm={next=>{setName(next);setDialog(null);}} />
    <ConfirmDialog isOpen={dialog === 'confirm'} title="删除简历" description="确定删除这份简历吗？" onCancel={()=>setDialog(null)} onConfirm={()=>{setName('已删除');setDialog(null);}} />
  </div>;
}
function ExperienceFixture() {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deletes, setDeletes] = useState(0);
  const [saves, setSaves] = useState(0);
  const [data, setData] = useState({org:'同名公司', title:'产品经理', start_date:'2024.01', end_date:'至今', star:{s:'原有背景',t:'',a:'',r:''}, editMode:'expert' as const, simpleText:''});
  const noop=()=>{};
  return <div className="p-6">
    <ExperienceCard agentItemId="experience-a" data={data} labels={{orgLabel:'公司名称',titleLabel:'职位名称',orgPlaceholder:'公司',titlePlaceholder:'职位',summaryPlaceholder:'经历'}}
      isExpanded={expanded} isCollapsing={false} isModified isSaving={busy} isPolishing={false} isPolishPreviewing={false} activePolishMode="default" customPolishPrompt=""
      onToggle={()=>setExpanded(v=>!v)} onDelete={()=>setDeletes(v=>v+1)} onSave={()=>{setBusy(true);setSaves(v=>v+1);setTimeout(()=>setBusy(false),350);}}
      onFieldChange={(key,value)=>setData(current=>({...current,[key]:value}))} onCancel={()=>setExpanded(false)}
      onPreviewSimpleEntry={noop} onEditModeChange={noop} onPolishModeChange={noop} onCustomPolishPromptChange={noop} onRunPolish={noop} onUndoPolishPreview={noop} onConfirmPolishPreview={noop} onOpenAssistant={noop} onUndo={()=>false} />
    <output aria-label="删除次数">{deletes}</output><output aria-label="保存次数">{saves}</output>
  </div>;
}
createRoot(document.getElementById('root')!).render(params.has('experience') ? <ExperienceFixture /> : params.has('controls') ? <Controls /> : <App />);
