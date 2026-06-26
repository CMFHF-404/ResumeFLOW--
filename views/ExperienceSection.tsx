import { useEffect, useState } from 'react';
import type React from 'react';
import { ExperienceSectionView } from './ExperienceSection/ExperienceSectionView';
import { useExperienceSectionModel } from './ExperienceSection/model';
import type { ExperienceSectionProps } from './ExperienceSection/types';

const ExperienceSection: React.FC<ExperienceSectionProps> = (props) => {
  const model = useExperienceSectionModel(props);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    props.onCountChange?.(model.isLoading ? null : model.experiences.length);
  }, [model.experiences.length, model.isLoading, props.onCountChange]);

  useEffect(() => {
    if (props.focusRequest?.targetId && props.focusRequest.category === props.category) {
      setIsCollapsed(false);
    }
  }, [props.category, props.focusRequest]);

  return (
    <ExperienceSectionView
      title={props.title}
      subtitle={props.subtitle}
      icon={props.icon}
      labels={props.labels}
      addButtonLabel={props.addButtonLabel}
      deleteConfirmText={props.deleteConfirmText}
      model={model}
      themeColor={props.themeColor}
      isCollapsed={isCollapsed}
      onToggle={() => setIsCollapsed(!isCollapsed)}
    />
  );
};

export default ExperienceSection;
