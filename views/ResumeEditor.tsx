import React, { useState, useRef } from 'react';
import { 
    Moon, Sun, Download, LayoutTemplate, 
    Target, Wand2, RefreshCw,
    Edit3, Eye, EyeOff, GripVertical, CheckCircle2,
    ChevronDown, ChevronUp, ArrowLeft, Database, User
} from 'lucide-react';
import { analyzeJobDescription } from '../services/geminiService';

// Mock Data with STAR structure
const initialExperienceItems = [
    { 
        id: 1, 
        title: "高级产品经理", 
        company: "腾讯 (Tencent)", 
        date: "2021.03 - 至今",
        star: {
            s: "负责腾讯云核心PaaS产品的商业化落地，面对竞品激烈的市场环境。",
            t: "需在Q3季度完成200%的增长目标，并提升KA客户续费率。",
            a: "1. 深入调研50+家头部客户，建立多维度定价模型；\n2. 协调产研团队优化部署流程，将交付周期从2周缩短至3天。",
            r: "Q3季度实现营收增长210%，KA客户签约率提升45%。"
        }
    },
    { 
        id: 2, 
        title: "产品运营实习生", 
        company: "字节跳动 (ByteDance)", 
        date: "2020.06 - 2020.12",
        star: {
            s: "负责抖音千万级用户增长活动策划。",
            t: "提升新用户留存率，优化投放ROI。",
            a: "策划'春节红包'活动，通过数据分析优化投放策略，设计A/B测试方案。",
            r: "活动期间DAU提升15%，投放ROI提升30%。"
        }
    },
    { 
        id: 3, 
        title: "主席", 
        company: "校学生会", 
        date: "2022 - 2023",
         star: {
            s: "管理全校最大的学生组织，成员超过200人。",
            t: "组织年度校园文化节，提升学生活跃度。",
            a: "统筹策划15场全校性活动，管理5万美元运营预算，优化供应商合同。",
            r: "年度学生活跃度同比增长30%，活动成本降低15%。"
        }
    }
];

const ResumeEditor: React.FC = () => {
    const [isDarkMode, setIsDarkMode] = useState(false);
    
    // 1. Profile State
    const [profile, setProfile] = useState({
        name: "陈小象",
        email: "alex.chen@example.com",
        phone: "(555) 123-4567",
        location: "上海, 中国",
        linkedin: "linkedin.com/in/alexchen",
        summary: "以结果为导向的产品经理，拥有学生领导力和社区组织经验。在提高参与度（提升30%）和管理预算（高达5万美元）方面有良好记录。热衷于构建以用户为中心的产品，并利用数据驱动决策。"
    });

    // 2. Experience State
    const [experienceItems, setExperienceItems] = useState(initialExperienceItems);
    const [selectedExpIds, setSelectedExpIds] = useState<Set<number>>(new Set([1, 2]));
    const [editingExpId, setEditingExpId] = useState<number | null>(null);

    // 3. JD Analysis State
    const [jdText, setJdText] = useState("JD 要求：3年以上产品经验，精通 Python 数据分析，熟练使用 SQL，有 PMP 证书优先...");
    const [analysisResult, setAnalysisResult] = useState<{ matchPercentage: number; missingKeywords: string[]; summary: string } | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isJDCollapsed, setIsJDCollapsed] = useState(false);
    
    // 4. UI State
    const [sidebarTab, setSidebarTab] = useState<'profile' | 'experience'>('profile');
    const [density, setDensity] = useState<'compact' | 'standard' | 'spacious'>('standard');
    
    // Drag & Drop State
    const [draggedItemId, setDraggedItemId] = useState<number | null>(null);

    const toggleTheme = () => {
        setIsDarkMode(!isDarkMode);
        document.documentElement.classList.toggle('dark');
    };

    const handleAnalyze = async () => {
        setIsAnalyzing(true);
        const resultStr = await analyzeJobDescription(jdText, JSON.stringify(experienceItems));
        try {
            const result = JSON.parse(resultStr);
            setAnalysisResult(result);
            setIsJDCollapsed(true);
        } catch (e) {
            console.error("Failed to parse analysis");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const toggleExperienceSelection = (id: number) => {
        const newSet = new Set(selectedExpIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedExpIds(newSet);
    };

    const updateExperienceItem = (id: number, field: 's' | 't' | 'a' | 'r', value: string) => {
        setExperienceItems(items => items.map(item => 
            item.id === id ? { ...item, star: { ...item.star, [field]: value } } : item
        ));
    };

    const handleDragStart = (e: React.DragEvent, id: number) => {
        setDraggedItemId(id);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent, id: number) => {
        e.preventDefault();
        if (draggedItemId === null || draggedItemId === id) return;
        
        // Simple reorder logic
        const draggedIndex = experienceItems.findIndex(i => i.id === draggedItemId);
        const hoverIndex = experienceItems.findIndex(i => i.id === id);
        
        const newItems = [...experienceItems];
        const [draggedItem] = newItems.splice(draggedIndex, 1);
        newItems.splice(hoverIndex, 0, draggedItem);
        
        setExperienceItems(newItems);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDraggedItemId(null);
    };

    const editingItem = experienceItems.find(i => i.id === editingExpId);

    // Spacing classes based on density
    const spacingClass = {
        compact: 'mb-3',
        standard: 'mb-6',
        spacious: 'mb-8'
    }[density];
    
    const listSpacingClass = {
        compact: 'space-y-2',
        standard: 'space-y-4',
        spacious: 'space-y-6'
    }[density];

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-background-light dark:bg-background-dark">
            {/* Top Header */}
            <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark flex items-center justify-between px-6 shrink-0 z-20">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity cursor-pointer">
                        <LayoutTemplate className="w-8 h-8" />
                        <span className="font-bold text-xl tracking-tight text-gray-900 dark:text-white">Elephant</span>
                    </div>
                    <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
                    <div className="flex items-center gap-2">
                         <span className="text-sm font-medium text-gray-500">简历工厂 / Resume Factory</span>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                        <button 
                            onClick={() => setDensity('compact')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${density === 'compact' ? 'bg-white dark:bg-gray-600 shadow text-primary dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'}`}
                        >
                            紧凑
                        </button>
                        <button 
                            onClick={() => setDensity('standard')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${density === 'standard' ? 'bg-white dark:bg-gray-600 shadow text-primary dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'}`}
                        >
                            标准
                        </button>
                        <button 
                            onClick={() => setDensity('spacious')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${density === 'spacious' ? 'bg-white dark:bg-gray-600 shadow text-primary dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'}`}
                        >
                            宽敞
                        </button>
                    </div>
                    <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
                    <button className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400" onClick={toggleTheme}>
                        {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    </button>
                    <button className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm">
                        <Download className="w-4 h-4" />
                        导出 PDF
                    </button>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar: Analysis & Modules */}
                <aside className="w-[420px] flex flex-col border-r border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shrink-0 z-10 hidden md:flex">
                    
                    {/* Compact JD Panel */}
                    <div className={`border-b border-border-light dark:border-border-dark bg-gray-50/50 dark:bg-gray-800/30 transition-all duration-300 ease-in-out flex flex-col ${isJDCollapsed ? 'h-auto py-3' : 'h-auto py-4'}`}>
                        <div className="px-4 flex items-center justify-between mb-2">
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <Target className="w-4 h-4 text-primary" />
                                职位分析 (JD Analysis)
                            </h3>
                            <button 
                                onClick={() => setIsJDCollapsed(!isJDCollapsed)} 
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                                {isJDCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                            </button>
                        </div>

                        <div className="px-4">
                            {isJDCollapsed ? (
                                // Collapsed State
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1.5 bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800/50 rounded-full pl-3 pr-2 py-1 shadow-sm">
                                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                            匹配度: {analysisResult?.matchPercentage || 0}%
                                        </span>
                                        <button onClick={handleAnalyze} disabled={isAnalyzing} className="p-1 text-gray-400 hover:text-emerald-600">
                                            <RefreshCw className={`w-3 h-3 ${isAnalyzing ? 'animate-spin' : ''}`} />
                                        </button>
                                    </div>
                                    <div className="flex gap-1 overflow-hidden">
                                        <span className="text-[10px] px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">Python</span>
                                        <span className="text-[10px] px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">Product</span>
                                    </div>
                                </div>
                            ) : (
                                // Expanded State
                                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                                    <div className="relative group">
                                        <textarea 
                                            className="w-full h-24 p-3 text-xs bg-white dark:bg-gray-900 border border-border-light dark:border-border-dark rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent resize-none text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 shadow-sm" 
                                            placeholder="在此粘贴职位要求 (Job Description)..."
                                            value={jdText}
                                            onChange={(e) => setJdText(e.target.value)}
                                        />
                                        <button onClick={handleAnalyze} className="absolute bottom-2 right-2 p-1.5 bg-primary text-white rounded-md shadow hover:bg-primary-dark transition-colors flex items-center gap-1 text-[10px] font-bold px-2">
                                            <Wand2 className="w-3 h-3" />
                                            {isAnalyzing ? '分析中...' : '开始分析'}
                                        </button>
                                    </div>
                                    {analysisResult && (
                                        <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800/30 rounded-lg p-3">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">匹配度: {analysisResult.matchPercentage}%</span>
                                                <span className="text-[10px] text-emerald-600/80">Missing: {analysisResult.missingKeywords.join(', ')}</span>
                                            </div>
                                            <p className="text-[10px] text-emerald-800 dark:text-emerald-300/80 leading-relaxed">{analysisResult.summary}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tab Navigation (Swapped order) */}
                    <div className="flex border-b border-border-light dark:border-border-dark bg-white dark:bg-surface-dark">
                        <button 
                            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${sidebarTab === 'profile' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                            onClick={() => { setSidebarTab('profile'); setEditingExpId(null); }}
                        >
                            <User className="w-4 h-4" /> 个人档案
                        </button>
                        <button 
                            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${sidebarTab === 'experience' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                            onClick={() => setSidebarTab('experience')}
                        >
                            <Database className="w-4 h-4" /> 经历库
                        </button>
                    </div>

                    {/* Sidebar Content */}
                    <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-gray-50/30 dark:bg-black/20">
                         {sidebarTab === 'profile' ? (
                             // 1. Profile FORM Input
                             <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                                 <div className="space-y-1">
                                     <label className="text-xs font-semibold text-gray-500 uppercase">姓名</label>
                                     <input 
                                        className="w-full text-sm p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                                        value={profile.name}
                                        onChange={(e) => setProfile({...profile, name: e.target.value})}
                                     />
                                 </div>
                                 <div className="grid grid-cols-2 gap-3">
                                     <div className="space-y-1">
                                        <label className="text-xs font-semibold text-gray-500 uppercase">电话</label>
                                        <input 
                                            className="w-full text-sm p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                                            value={profile.phone}
                                            onChange={(e) => setProfile({...profile, phone: e.target.value})}
                                        />
                                     </div>
                                     <div className="space-y-1">
                                        <label className="text-xs font-semibold text-gray-500 uppercase">邮箱</label>
                                        <input 
                                            className="w-full text-sm p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                                            value={profile.email}
                                            onChange={(e) => setProfile({...profile, email: e.target.value})}
                                        />
                                     </div>
                                 </div>
                                 <div className="space-y-1">
                                     <label className="text-xs font-semibold text-gray-500 uppercase">地点</label>
                                     <input 
                                        className="w-full text-sm p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                                        value={profile.location}
                                        onChange={(e) => setProfile({...profile, location: e.target.value})}
                                     />
                                 </div>
                                 <div className="space-y-1">
                                     <label className="text-xs font-semibold text-gray-500 uppercase">链接</label>
                                     <input 
                                        className="w-full text-sm p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                                        value={profile.linkedin}
                                        onChange={(e) => setProfile({...profile, linkedin: e.target.value})}
                                     />
                                 </div>
                                 <div className="space-y-1">
                                     <label className="text-xs font-semibold text-gray-500 uppercase">职业总结</label>
                                     <textarea 
                                        className="w-full text-sm p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all h-32 leading-relaxed resize-none"
                                        value={profile.summary}
                                        onChange={(e) => setProfile({...profile, summary: e.target.value})}
                                     />
                                 </div>
                             </div>
                         ) : (
                             // 2. Experience Selection & STAR Editing
                             editingExpId ? (
                                 // Editing Mode (STAR Inputs)
                                 <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                                     <button 
                                        onClick={() => setEditingExpId(null)}
                                        className="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white mb-2"
                                     >
                                        <ArrowLeft className="w-3 h-3" /> 返回列表
                                     </button>
                                     <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 mb-2">
                                         <h4 className="font-bold text-gray-900 dark:text-white">{editingItem?.company}</h4>
                                         <p className="text-xs text-gray-500">{editingItem?.title}</p>
                                     </div>
                                     
                                     {['s', 't', 'a', 'r'].map((key) => {
                                         const labelMap: any = { s: 'Situation (情境)', t: 'Task (任务)', a: 'Action (行动)', r: 'Result (结果)' };
                                         const colorMap: any = { s: 'text-blue-600', t: 'text-orange-600', a: 'text-amber-600', r: 'text-emerald-600' };
                                         return (
                                             <div key={key} className="space-y-1">
                                                 <label className={`text-[10px] font-bold uppercase tracking-wider ${colorMap[key]} pl-1`}>
                                                    {labelMap[key]}
                                                 </label>
                                                 <textarea 
                                                    className="w-full text-sm p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all h-24 resize-none leading-relaxed"
                                                    value={editingItem?.star?.[key as 's'|'t'|'a'|'r']}
                                                    onChange={(e) => updateExperienceItem(editingItem!.id, key as any, e.target.value)}
                                                    placeholder={`Enter ${key.toUpperCase()}...`}
                                                 />
                                             </div>
                                         )
                                     })}
                                 </div>
                             ) : (
                                 // List Mode (Checkboxes)
                                 <div className="space-y-3 animate-in fade-in slide-in-from-left-4 duration-300">
                                    <p className="text-xs text-gray-400 px-1 flex items-center gap-2">
                                        <CheckCircle2 className="w-3 h-3" /> 勾选以添加到简历
                                    </p>
                                    {experienceItems.map((item) => {
                                        const isSelected = selectedExpIds.has(item.id);
                                        return (
                                            <div key={item.id} className={`bg-white dark:bg-gray-800 border rounded-xl p-3 shadow-sm transition-all group relative ${isSelected ? 'border-primary ring-1 ring-primary/10' : 'border-gray-200 dark:border-gray-700 opacity-70 hover:opacity-100'}`}>
                                                <div className="flex items-start gap-3">
                                                    <div className="pt-1">
                                                        <input 
                                                            type="checkbox" 
                                                            checked={isSelected}
                                                            onChange={() => toggleExperienceSelection(item.id)}
                                                            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                                                        />
                                                    </div>
                                                    <div className="flex-1 cursor-pointer" onClick={() => setEditingExpId(item.id)}>
                                                        <div className="flex justify-between items-start">
                                                            <div>
                                                                <h4 className={`font-bold text-sm ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>{item.company}</h4>
                                                                <p className="text-xs text-gray-500">{item.title}</p>
                                                            </div>
                                                            <button className="p-1.5 text-gray-300 hover:text-primary hover:bg-primary/5 rounded transition-colors">
                                                                <Edit3 className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                        <p className="text-[10px] text-gray-400 mt-2 font-mono">{item.date}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {/* Removed the "Import More" card placeholder as per requirement */}
                                 </div>
                             )
                         )}
                    </div>
                </aside>

                {/* Main Preview Area (Connected to State) */}
                <main className="flex-1 bg-gray-100 dark:bg-gray-900/50 overflow-y-auto relative flex justify-center p-8 scroll-smooth">
                     <div className="a4-preview text-gray-900 p-[20mm] relative">
                        {/* 1. Header (Basic Info) */}
                        <div id="basic-info" className={`border-b-2 border-gray-900 pb-4 ${spacingClass} text-center scroll-mt-8`}>
                            <h1 className="text-3xl font-bold uppercase tracking-widest mb-2 text-gray-900">{profile.name}</h1>
                            <div className="text-[11px] text-gray-600 flex justify-center flex-wrap gap-x-4 gap-y-1 font-medium">
                                <span>{profile.email}</span>
                                <span>{profile.phone}</span>
                                <span>{profile.location}</span>
                                <span>{profile.linkedin}</span>
                            </div>
                        </div>

                        {/* 2. Summary - Conditional Rendering */}
                        {profile.summary && (
                            <div id="summary" className={`${spacingClass} relative group hover:bg-primary/5 -m-2 p-2 rounded transition-colors`}>
                                <h2 className="text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 pb-1 mb-2">职业总结</h2>
                                <p className="text-xs leading-relaxed text-gray-800">{profile.summary}</p>
                            </div>
                        )}
                        
                        {/* 3. Experience (Mapped from Selected Items) - Conditional Rendering */}
                         {selectedExpIds.size > 0 && (
                             <div id="experience" className={`${spacingClass} scroll-mt-20`}>
                                <h2 className="text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 pb-1 mb-3">工作/项目经历</h2>
                                <div className={listSpacingClass}>
                                    {experienceItems
                                        .filter(item => selectedExpIds.has(item.id))
                                        .map(item => (
                                            <div 
                                                key={item.id} 
                                                className="relative group hover:bg-primary/5 -m-2 p-2 rounded transition-colors cursor-move"
                                                onClick={() => {setSidebarTab('experience'); setEditingExpId(item.id)}}
                                                draggable
                                                onDragStart={(e) => handleDragStart(e, item.id)}
                                                onDragOver={(e) => handleDragOver(e, item.id)}
                                                onDrop={handleDrop}
                                            >
                                                <div className="flex justify-between items-baseline mb-1">
                                                    <h3 className="text-sm font-bold text-gray-900">{item.company}</h3>
                                                    <span className="text-xs font-medium text-gray-600">{item.date}</span>
                                                </div>
                                                <p className="text-xs font-semibold text-gray-800 mb-1.5">{item.title}</p>
                                                
                                                {/* Render STAR content if available */}
                                                <ul className="list-disc list-outside ml-4 text-xs text-gray-700 space-y-1.5 leading-relaxed">
                                                    {item.star?.s && <li><span className="font-semibold text-gray-900">S:</span> {item.star.s}</li>}
                                                    {item.star?.t && <li><span className="font-semibold text-gray-900">T:</span> {item.star.t}</li>}
                                                    {item.star?.a && (
                                                        <li>
                                                            <span className="font-semibold text-gray-900">A:</span> 
                                                            <span className="whitespace-pre-line block mt-1">{item.star.a}</span>
                                                        </li>
                                                    )}
                                                    {item.star?.r && <li><span className="font-semibold text-gray-900">R:</span> {item.star.r}</li>}
                                                </ul>

                                                <div className="absolute top-2 right-2 hidden group-hover:block text-primary">
                                                     <Edit3 className="w-4 h-4" />
                                                </div>
                                            </div>
                                    ))}
                                </div>
                            </div>
                        )}

                         <div id="education" className={`${spacingClass} scroll-mt-20`}>
                            <h2 className="text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 pb-1 mb-3">教育背景</h2>
                            <div className="mb-2">
                                <div className="flex justify-between items-baseline mb-0.5">
                                    <h3 className="text-sm font-bold text-gray-900">浙江大学</h3>
                                    <span className="text-xs font-medium text-gray-600">杭州, 中国 | 2021</span>
                                </div>
                                <p className="text-xs text-gray-800">计算机科学与技术，学士学位</p>
                            </div>
                        </div>

                        {/* Skills Block */}
                        <div id="skills" className={`${spacingClass} scroll-mt-20`}>
                             <h2 className="text-xs font-bold uppercase tracking-widest text-primary border-b border-gray-200 pb-1 mb-2">专业技能</h2>
                             <div className="text-xs text-gray-800 grid grid-cols-[100px_1fr] gap-y-1.5">
                                <span className="font-bold text-gray-900">技术栈:</span>
                                <span>Python, SQL, HTML/CSS, JavaScript, React, Figma, Tableau</span>
                                <span className="font-bold text-gray-900">产品方法:</span>
                                <span>敏捷/Scrum, 用户研究, A/B测试, 路线图规划, Jira</span>
                             </div>
                        </div>
                     </div>
                </main>
            </div>
        </div>
    );
};

export default ResumeEditor;