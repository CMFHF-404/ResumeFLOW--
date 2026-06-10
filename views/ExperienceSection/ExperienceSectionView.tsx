import type React from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog';
import ExperienceCard, { type ExperienceCardLabels } from '../ExperienceCard';
import { buildExperienceCardData } from './cardDataUtils';
import type { ExperienceSectionModel } from './types';

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  isLoading: boolean;
  count: number;
  isCollapsed: boolean;
  onToggle: () => void;
}> = ({ icon, title, subtitle, isLoading, count, isCollapsed, onToggle }) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <button
        onClick={onToggle}
        className="p-1 -ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <ChevronDown
          className={`w-5 h-5 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
        />
      </button>
      <h2
        className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 cursor-pointer select-none"
        onClick={onToggle}
      >
        {icon}
        {title}
        <span className="text-sm font-normal text-gray-400 ml-2">{subtitle}</span>
      </h2>
    </div>
    <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
      {isLoading ? 'Loading...' : `${count} items`}
    </span>
  </div>
);

const AddExperienceButton: React.FC<{
  onClick: () => void;
  label: string;
  disabled: boolean;
  themeColor?: string;
}> = ({ onClick, label, disabled, themeColor }) => {
  const isPrimary = !themeColor || themeColor === 'primary';
  const containerClass = isPrimary
    ? 'hover:text-primary hover:border-primary hover:bg-primary/5'
    : `hover:text-${themeColor}-600 hover:border-${themeColor}-600 hover:bg-${themeColor}-50`;
  const iconClass = isPrimary
    ? 'group-hover:text-primary'
    : `group-hover:text-${themeColor}-600`;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full group border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-500 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed ${containerClass}`}
      type="button"
    >
      <div className={`p-1 rounded-full bg-gray-200 dark:bg-gray-800 transition-colors group-hover:bg-white ${iconClass}`}>
        <Plus className="w-5 h-5" />
      </div>
      <span className="font-medium">{label}</span>
    </button>
  );
};

const ExperienceCardList: React.FC<{
  items: ExperienceSectionModel['sortedExperiences'];
  labels: ExperienceCardLabels;
  model: ExperienceSectionModel;
  themeColor?: string;
}> = ({ items, labels, model, themeColor }) => (
  <>
    {items.map((item) => {
      const cardId = item.master.id;
      const data = model.cardData.get(cardId) || buildExperienceCardData(item);
      return (
        <ExperienceCard
          key={cardId}
          ref={(el) => model.setCardRef(cardId, el)}
          data={data}
          labels={labels}
          isExpanded={model.expandedCards.has(cardId)}
          isCollapsing={model.collapsingCards.has(cardId)}
          isModified={model.modifiedCards.has(cardId)}
          isSaving={model.isCardBusy(cardId)}
          isPolishing={model.isPolishing(cardId)}
          isPolishPreviewing={model.isPreviewingPolish(cardId)}
          activePolishMode={model.getPolishMode(cardId)}
          customPolishPrompt={model.getCustomPrompt(cardId)}
          onToggle={() => model.onToggle(cardId)}
          onDelete={() => model.onDeleteRequest(cardId)}
          onSave={() => model.onSave(cardId)}
          onFormalizeSimpleEntry={() => model.onFormalizeSimpleEntry(cardId)}
          onCancel={() => model.onCancel(cardId)}
          onFieldChange={(field, value) => model.onFieldChange(cardId, field, value)}
          onEditModeChange={(mode) => model.onEditModeChange(cardId, mode)}
          onPolishModeChange={(mode) => model.onPolishModeChange(cardId, mode)}
          onCustomPolishPromptChange={(value) => model.onCustomPromptChange(cardId, value)}
          onRunPolish={() => model.onRunPolish(cardId)}
          onUndoPolishPreview={() => model.onUndoPolishPreview(cardId)}
          onConfirmPolishPreview={() => model.onConfirmPolishPreview(cardId)}
          onOpenAssistant={() => model.onOpenAssistant(cardId)}
          onUndo={(field) => model.onUndo(cardId, field)}
          themeColor={themeColor}
        />
      );
    })}
  </>
);

const DeleteDialog: React.FC<{
  isOpen: boolean;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ isOpen, description, onCancel, onConfirm }) => (
  <ConfirmDialog
    isOpen={isOpen}
    title="确认删除"
    description={
      <>
        {description}
        <br />
        此操作无法撤销。
      </>
    }
    onCancel={onCancel}
    onConfirm={onConfirm}
  />
);

export const ExperienceSectionView: React.FC<{
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  labels: ExperienceCardLabels;
  addButtonLabel: string;
  deleteConfirmText: string;
  model: ExperienceSectionModel;
  themeColor?: string;
  isCollapsed: boolean;
  onToggle: () => void;
}> = ({ title, subtitle, icon, labels, addButtonLabel, deleteConfirmText, model, themeColor, isCollapsed, onToggle }) => (
  <section className="space-y-6 pt-6 border-t border-gray-200 dark:border-gray-800">
    <SectionHeader
      icon={icon}
      title={title}
      subtitle={subtitle}
      isLoading={model.isLoading}
      count={model.experiences.length}
      isCollapsed={isCollapsed}
      onToggle={onToggle}
    />
    {!isCollapsed && (
      <>
        <AddExperienceButton
          onClick={model.onAdd}
          label={addButtonLabel}
          disabled={model.isCreating}
          themeColor={themeColor}
        />
        <ExperienceCardList items={model.sortedExperiences} labels={labels} model={model} themeColor={themeColor} />
      </>
    )}
    <DeleteDialog
      isOpen={Boolean(model.deletingCardId)}
      description={deleteConfirmText}
      onCancel={model.onDeleteCancel}
      onConfirm={model.onDeleteConfirm}
    />
  </section>
);
