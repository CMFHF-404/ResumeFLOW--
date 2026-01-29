import React, { useState } from 'react';
import { Database, UploadCloud, Download, Moon, Sun, Briefcase, Plus, Sparkles, ChevronUp, ChevronDown, Trash2, GraduationCap, FolderKanban, Wrench, User, Mail, Phone, MapPin, Link as LinkIcon, X } from 'lucide-react';
import { polishExperience } from '../services/geminiService';

const ExperienceBank: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  
  // Personal Info State
  const [name, setName] = useState("陈小象");
  const [email, setEmail] = useState("alex.chen@example.com");
  const [phone, setPhone] = useState("(555) 123-4567");
  const [location, setLocation] = useState("上海, 中国");
  const [link, setLink] = useState("linkedin.com/in/alexchen");

  // Work Experience State
  const [expandedWork, setExpandedWork] = useState(true);
  const [company, setCompany] = useState("腾讯 (Tencent)");
  const [role, setRole] = useState("高级产品经理");
  const [startDate, setStartDate] = useState("2021.03");
  const [endDate, setEndDate] = useState("至今");
  const [situation, setSituation] = useState("负责腾讯云核心PaaS产品的商业化落地，面对竞品激烈的市场环境，需在Q3季度完成200%的增长目标。");
  const [task, setTask] = useState("重构产品定价体系，并主导针对KA客户的定制化解决方案，提升大客户转化率。");
  const [action, setAction] = useState("1. 深入调研50+家头部客户，建立多维度定价模型；\n2. 协调产研团队优化部署流程，将交付周期从2周缩短至3天；\n3. 搭建自动化营销漏斗，实现线索分级管理。");
  const [result, setResult] = useState("Q3季度实现营收增长210%，KA客户签约率提升45%，成功打造3个行业标杆案例。");
  const [isPolishing, setIsPolishing] = useState(false);

  // Skills State
  const [skills, setSkills] = useState(["Product Management", "Figma", "SQL", "Python Analysis", "Axure RP", "Jira/Confluence"]);
  const [newSkill, setNewSkill] = useState("");

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  };

  const handlePolish = async () => {
    setIsPolishing(true);
    const rawText = `Situation: ${situation}\nTask: ${task}\nAction: ${action}\nResult: ${result}`;
    const responseStr = await polishExperience(company, role, rawText);
    try {
        const response = JSON.parse(responseStr);
        if (response.s) setSituation(response.s);
        if (response.t) setTask(response.t);
        if (response.a) setAction(response.a);
        if (response.r) setResult(response.r);
    } catch (e) {
        console.error("Failed to parse AI response", e);
    } finally {
        setIsPolishing(false);
    }
  };

  const handleAddNew = () => {
      setCompany("");
      setRole("");
      setStartDate("");
      setEndDate("");
      setSituation("");
      setTask("");
      setAction("");
      setResult("");
      setExpandedWork(true);
  };

  const handleLoadItem = (title: string, pos: string, start: string, end: string) => {
      setCompany(title);
      setRole(pos);
      setStartDate(start);
      setEndDate(end);
      setExpandedWork(true);
      
      // Reset STAR to dummy text if loading new item to simulate data fetch
      if (title !== "腾讯 (Tencent)") {
         setSituation("负责...");
         setTask("任务...");
         setAction("行动...");
         setResult("结果...");
      }
  };

  const addSkill = () => {
      if (newSkill.trim() && !skills.includes(newSkill.trim())) {
          setSkills([...skills, newSkill.trim()]);
          setNewSkill("");
      }
  };

  const removeSkill = (skillToRemove: string) => {
      setSkills(skills.filter(s => s !== skillToRemove));
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50 dark:bg-gray-900/50">
      <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark flex items-center justify-between px-8 shrink-0 z-20">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight flex items-center gap-3">
            <span className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Database className="w-5 h-5" />
            </span>
            经历库 (Experience Bank)
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <button className="hidden md:flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-700">
            <UploadCloud className="w-4 h-4" />
            导入简历
          </button>
          <button className="hidden md:flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-700">
            <Download className="w-4 h-4" />
            导出全部
          </button>
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-2"></div>
          <button className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors" onClick={toggleTheme}>
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-5xl mx-auto space-y-12 pb-20">
          
          {/* Personal Info Section */}
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <User className="w-5 h-5 text-indigo-500" />
                个人信息
                <span className="text-sm font-normal text-gray-400 ml-2">Personal Info</span>
              </h2>
            </div>
            <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1"><User className="w-3 h-3" /> 姓名</label>
                        <input className="fluid-input text-lg font-bold text-gray-900 dark:text-white w-full" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1"><Mail className="w-3 h-3" /> 邮箱</label>
                        <input className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1"><Phone className="w-3 h-3" /> 电话</label>
                        <input className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full" value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1"><MapPin className="w-3 h-3" /> 地点</label>
                        <input className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full" value={location} onChange={(e) => setLocation(e.target.value)} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1"><LinkIcon className="w-3 h-3" /> 链接 (LinkedIn/Portfolio)</label>
                        <input className="fluid-input text-base text-gray-700 dark:text-gray-300 w-full" value={link} onChange={(e) => setLink(e.target.value)} />
                    </div>
                </div>
            </div>
          </section>

          {/* Work Experience Section */}
          <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-primary" />
                工作经历
                <span className="text-sm font-normal text-gray-400 ml-2">Work Experience</span>
              </h2>
              <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">3 items</span>
            </div>
            
            <button 
                onClick={handleAddNew}
                className="w-full group border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-500 hover:text-primary hover:border-primary hover:bg-primary/5 transition-all duration-300"
            >
              <div className="p-1 rounded-full bg-gray-200 dark:bg-gray-800 group-hover:bg-white group-hover:text-primary transition-colors">
                <Plus className="w-5 h-5" />
              </div>
              <span className="font-medium">新增工作经历</span>
            </button>

            {/* Editable Card */}
            <div className="bg-white dark:bg-surface-dark rounded-xl border border-primary/30 shadow-lg shadow-primary/5 overflow-hidden transition-all duration-300 ring-1 ring-primary/10">
              <div className="p-6 pb-2 border-b border-gray-50 dark:border-gray-800/50">
                <div className="flex flex-col lg:flex-row gap-6 mb-4">
                  <div className="flex-1">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">公司名称</label>
                    <input 
                        className="fluid-input text-xl font-bold text-gray-900 dark:text-white placeholder-gray-300" 
                        placeholder="输入公司名称" 
                        type="text" 
                        value={company} 
                        onChange={(e) => setCompany(e.target.value)}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">担任职位</label>
                    <input 
                        className="fluid-input text-xl font-bold text-gray-900 dark:text-white placeholder-gray-300" 
                        placeholder="输入职位名称" 
                        type="text" 
                        value={role} 
                        onChange={(e) => setRole(e.target.value)}
                    />
                  </div>
                  <div className="w-full lg:w-auto shrink-0">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">时间段</label>
                    <div className="flex items-center gap-2">
                      <input 
                        className="fluid-input w-24 text-center text-base text-gray-600 dark:text-gray-300" 
                        placeholder="YYYY.MM" 
                        type="text" 
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                      <span className="text-gray-400">-</span>
                      <input 
                        className="fluid-input w-24 text-center text-base text-gray-600 dark:text-gray-300" 
                        placeholder="至今" 
                        type="text" 
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
              
              {expandedWork && (
              <div className="p-6 pt-4 space-y-4 relative animate-in fade-in slide-in-from-top-4 duration-300">
                 {/* STAR Sections - Strict Plain Textareas */}
                 {[
                   { id: 's', label: 'S - 情境 (Situation)', val: situation, set: setSituation, color: 'blue', icon: 'Target', ph: 'Describe the context...' },
                   { id: 't', label: 'T - 任务 (Task)', val: task, set: setTask, color: 'orange', icon: 'Flag', ph: 'What were your goals?' },
                   { id: 'a', label: 'A - 行动 (Action)', val: action, set: setAction, color: 'amber', icon: 'Zap', ph: 'What specifically did you do?' },
                   { id: 'r', label: 'R - 结果 (Result)', val: result, set: setResult, color: 'emerald', icon: 'Trophy', ph: 'Quantifiable outcomes...' },
                 ].map((item, idx) => (
                    <div key={item.id} className="flex gap-4 relative group">
                        {idx !== 3 && <div className="absolute left-[19px] top-10 bottom-0 w-[2px] bg-gray-100 dark:bg-gray-800"></div>}
                        <div className={`shrink-0 w-10 h-10 rounded-full bg-${item.color}-50 dark:bg-${item.color}-900/20 text-${item.color}-600 dark:text-${item.color}-400 flex items-center justify-center ring-4 ring-white dark:ring-surface-dark z-10 font-bold`}>
                            {item.id.toUpperCase()}
                        </div>
                        <div className="flex-1 pt-1 pb-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className={`text-xs font-bold text-${item.color}-600 dark:text-${item.color}-400 uppercase tracking-widest`}>{item.label}</span>
                            </div>
                            <textarea 
                                className="w-full bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none leading-relaxed transition-all hover:bg-white dark:hover:bg-gray-800 shadow-sm"
                                rows={item.id === 'a' ? 4 : 2}
                                value={item.val}
                                placeholder={item.ph}
                                onChange={(e) => item.set(e.target.value)}
                            />
                        </div>
                    </div>
                 ))}
              </div>
              )}

              <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <button 
                  onClick={handlePolish}
                  disabled={isPolishing}
                  className="flex items-center gap-2 text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  {isPolishing ? 'AI 润色中...' : 'AI 润色'}
                </button>
                <div className="flex items-center gap-4">
                  <button className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => setExpandedWork(!expandedWork)} className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors flex items-center gap-1 text-sm font-medium px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                    {expandedWork ? '收起' : '展开'}
                    {expandedWork ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Read-only List Items */}
             <div 
                className="group bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md hover:border-primary/50 transition-all duration-200 cursor-pointer"
                onClick={() => handleLoadItem("字节跳动 (ByteDance)", "产品运营实习生", "2020.06", "2020.12")}
            >
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                            <h3 className="font-bold text-gray-900 dark:text-white truncate">字节跳动 (ByteDance)</h3>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <span className="text-gray-700 dark:text-gray-300 font-medium">产品运营实习生</span>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 truncate">负责抖音千万级用户增长活动策划，通过数据分析优化投放策略，ROI提升...</p>
                    </div>
                    <div className="text-right shrink-0">
                        <span className="block text-sm font-mono text-gray-500 mb-2">2020.06 - 2020.12</span>
                        <ChevronDown className="w-5 h-5 text-gray-400 group-hover:text-primary transition-colors ml-auto" />
                    </div>
                </div>
            </div>

          </section>

          {/* Education Section */}
           <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <GraduationCap className="w-5 h-5 text-purple-600" />
                    教育经历
                    <span className="text-sm font-normal text-gray-400 ml-2">Education</span>
                </h2>
            </div>
             <div className="group bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md hover:border-purple-400 transition-all duration-200 cursor-pointer opacity-80 hover:opacity-100">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                            <h3 className="font-bold text-gray-900 dark:text-white truncate">浙江大学</h3>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <span className="text-gray-700 dark:text-gray-300 font-medium">计算机科学与技术</span>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 truncate">主修课程：数据结构、操作系统、计算机网络... GPA: 3.8/4.0</p>
                    </div>
                    <div className="text-right shrink-0">
                        <span className="block text-sm font-mono text-gray-500 mb-2">2017.09 - 2021.06</span>
                        <ChevronDown className="w-5 h-5 text-gray-400 group-hover:text-purple-500 transition-colors ml-auto" />
                    </div>
                </div>
            </div>
          </section>

          {/* Skills Section */}
           <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Wrench className="w-5 h-5 text-rose-500" />
                    专业技能
                    <span className="text-sm font-normal text-gray-400 ml-2">Skills</span>
                </h2>
            </div>
             <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
                <div className="space-y-6">
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">技术栈 / Tech Stack</h4>
                        </div>
                        
                        <div className="flex flex-wrap gap-2 mb-4">
                            {skills.map(skill => (
                                <span key={skill} className="group px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-default flex items-center gap-1">
                                    {skill}
                                    <button onClick={() => removeSkill(skill)} className="hidden group-hover:block hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                                </span>
                            ))}
                        </div>
                        
                        <div className="flex gap-2 max-w-sm">
                             <input 
                                className="fluid-input text-sm" 
                                placeholder="添加新技能 (Add Skill)" 
                                value={newSkill}
                                onChange={(e) => setNewSkill(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && addSkill()}
                             />
                             <button onClick={addSkill} className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors">
                                 <Plus className="w-4 h-4" />
                             </button>
                        </div>
                    </div>
                </div>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
};

export default ExperienceBank;