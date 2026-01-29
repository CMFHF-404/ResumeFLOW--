import React, { useState, useEffect, useRef } from 'react';
import { Plus, LayoutGrid, List, FileText, MoreHorizontal, Moon, Sun, Bell, Trash2, Copy, Edit2, LayoutTemplate } from 'lucide-react';
import { Resume, ViewState } from '../types';

interface DashboardProps {
  setView: (view: ViewState) => void;
}

const mockResumesInitial: Resume[] = [
  { id: '1', name: '产品经理 - 腾讯', targetRole: '产品实习生', matchRate: 85, lastModified: '2小时前', status: 'final', type: 'internship' },
  { id: '2', name: '产品运营 - 字节跳动', targetRole: '暑期实习生', matchRate: 92, lastModified: '3天前', status: 'final', type: 'internship' },
  { id: '3', name: '未命名简历 - 2025', targetRole: '通用模版', matchRate: 0, lastModified: '1周前', status: 'draft', type: 'general' },
];

const Dashboard: React.FC<DashboardProps> = ({ setView }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [resumes, setResumes] = useState<Resume[]>(mockResumesInitial);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number, left: number } | null>(null);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  };

  const handleDropdownClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (openDropdownId === id) {
      setOpenDropdownId(null);
      setDropdownPos(null);
    } else {
      const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
      setOpenDropdownId(id);
      // Position the fixed dropdown near the button
      setDropdownPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.right - 192 + window.scrollX // 192px is w-48
      });
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setResumes(resumes.filter(r => r.id !== id));
    setOpenDropdownId(null);
  };

  const handleCopy = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const resume = resumes.find(r => r.id === id);
    if (resume) {
      const newResume = { ...resume, id: Date.now().toString(), name: `${resume.name} (副本)` };
      setResumes([...resumes, newResume]);
    }
    setOpenDropdownId(null);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // If clicking outside the dropdown menu
      const target = event.target as Element;
      if (!target.closest('.dropdown-menu') && !target.closest('.dropdown-trigger')) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', () => setOpenDropdownId(null), true); // Close on scroll
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', () => setOpenDropdownId(null), true);
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50 dark:bg-gray-900/50">
      {/* Header */}
      <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-border-light dark:border-border-dark flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity cursor-pointer">
            <LayoutTemplate className="w-8 h-8" />
            <span className="font-bold text-xl tracking-tight text-gray-900 dark:text-white">Elephant</span>
          </div>
          <div className="h-6 w-px bg-border-light dark:bg-border-dark"></div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-500">仪表盘 / Dashboard</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
            onClick={toggleTheme}
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500">
            <Bell className="w-4 h-4" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto space-y-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">欢迎回来，陈小象</h1>
              <p className="text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                你已创建了 <span className="font-bold text-gray-900 dark:text-white">{resumes.length}</span> 份简历，本周有 3 次优化建议。
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center bg-white dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-lg p-1 shadow-sm">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-gray-100 dark:bg-gray-700 text-primary dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >
                  <LayoutGrid className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-gray-100 dark:bg-gray-700 text-primary dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >
                  <List className="w-5 h-5" />
                </button>
              </div>
              <button
                onClick={() => setView(ViewState.EDITOR)}
                className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-xl text-base font-semibold transition-all shadow-lg shadow-primary/20 hover:shadow-primary/40 transform hover:-translate-y-0.5"
              >
                <Plus className="w-5 h-5" />
                创建新简历
              </button>
            </div>
          </div>

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {resumes.map(resume => (
                <div key={resume.id} onClick={() => setView(ViewState.EDITOR)} className="group bg-white dark:bg-surface-dark rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-xl hover:border-primary/30 transition-all duration-300 flex flex-col relative cursor-pointer">
                  <div className="aspect-[210/297] bg-gray-100 dark:bg-gray-900 relative p-6 overflow-hidden border-b border-gray-100 dark:border-gray-800">
                    <div className="w-full h-full bg-white dark:bg-gray-800 shadow-sm p-3 md:p-4 transform group-hover:scale-[1.02] transition-transform duration-500 origin-top opacity-90 flex flex-col gap-2">
                      {/* Mini Resume Visuals */}
                      <div className="h-3 w-1/3 bg-gray-200 dark:bg-gray-700 rounded-sm mb-2"></div>
                      <div className="h-1.5 w-full bg-gray-100 dark:bg-gray-700 rounded-sm"></div>
                      <div className="h-1.5 w-5/6 bg-gray-100 dark:bg-gray-700 rounded-sm"></div>
                      <div className="h-1.5 w-full bg-gray-100 dark:bg-gray-700 rounded-sm"></div>
                      <div className="h-2 w-1/4 bg-gray-200 dark:bg-gray-700 rounded-sm mt-2 mb-1"></div>
                      <div className="space-y-1">
                        <div className="h-1 w-full bg-gray-100 dark:bg-gray-700 rounded-sm"></div>
                        <div className="h-1 w-11/12 bg-gray-100 dark:bg-gray-700 rounded-sm"></div>
                        <div className="h-1 w-full bg-gray-100 dark:bg-gray-700 rounded-sm"></div>
                      </div>
                    </div>
                  </div>
                  <div className="p-5 flex-1 flex flex-col">
                    <div className="flex justify-between items-start mb-1">
                      <h3 className="font-bold text-gray-900 dark:text-white truncate pr-2 text-lg">{resume.name}</h3>
                    </div>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm text-gray-500 dark:text-gray-400">针对: {resume.targetRole}</p>
                      {resume.matchRate > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 font-bold border border-emerald-200 dark:border-emerald-500/20">
                          匹配度: {resume.matchRate}%
                        </span>
                      )}
                    </div>
                    <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between relative">
                      <span className="text-xs text-gray-400 font-medium">{resume.lastModified}</span>
                      <div className="relative">
                        <button
                          className="p-1.5 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors dropdown-trigger"
                          onClick={(e) => handleDropdownClick(e, resume.id)}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <button
                onClick={() => setView(ViewState.EDITOR)}
                className="group flex flex-col items-center justify-center h-full min-h-[400px] rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-primary/50 hover:bg-primary/5 transition-all duration-300"
              >
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400 group-hover:text-primary group-hover:bg-white dark:group-hover:bg-gray-700 shadow-sm transition-colors mb-4">
                  <Plus className="w-8 h-8" />
                </div>
                <h3 className="font-semibold text-gray-500 dark:text-gray-400 group-hover:text-primary transition-colors">创建新简历</h3>
                <p className="text-xs text-gray-400 mt-2">从空白开始或使用模版</p>
              </button>
            </div>
          ) : (
            <div className="bg-white dark:bg-surface-dark rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm min-h-[500px]">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      <th className="px-6 py-4">简历名称</th>
                      <th className="px-6 py-4">针对岗位</th>
                      <th className="px-6 py-4 w-40">匹配度</th>
                      <th className="px-6 py-4 w-40">最后修改</th>
                      <th className="px-6 py-4 w-32 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {resumes.map(resume => (
                      <tr key={resume.id} className="group hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer" onClick={() => setView(ViewState.EDITOR)}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-4">
                            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg shrink-0">
                              <FileText className="w-5 h-5" />
                            </div>
                            <h3 className="font-bold text-gray-900 dark:text-white text-base leading-tight">{resume.name}</h3>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">{resume.targetRole}</span>
                        </td>
                        <td className="px-6 py-4">
                          {resume.matchRate > 0 ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 text-xs font-bold border border-emerald-200 dark:border-emerald-500/20 whitespace-nowrap">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              {resume.matchRate}%
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400 text-xs font-bold border border-gray-200 dark:border-gray-700 whitespace-nowrap">
                              草稿
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-600 dark:text-gray-300">
                          {resume.lastModified}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <button className="px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 rounded-md transition-colors border border-transparent hover:border-primary/20 whitespace-nowrap">
                              编辑
                            </button>
                            <button
                              className="p-1.5 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors dropdown-trigger"
                              onClick={(e) => handleDropdownClick(e, resume.id)}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Global Portal-like Dropdown */}
      {openDropdownId && dropdownPos && (
        <div
          className="dropdown-menu fixed w-48 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-[9999]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <button onClick={() => setView(ViewState.EDITOR)} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2">
            <Edit2 className="w-4 h-4" /> 编辑
          </button>
          <button onClick={(e) => handleCopy(openDropdownId, e)} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2">
            <Copy className="w-4 h-4" /> 创建副本
          </button>
          <div className="h-px bg-gray-100 dark:bg-gray-700 my-1"></div>
          <button onClick={(e) => handleDelete(openDropdownId, e)} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> 删除
          </button>
        </div>
      )}
    </div>
  );
};

export default Dashboard;