import type { AssistantStreamEvent } from '../../services/aiService';
import { resolveThoughtDisplayEvent } from '../../utils/aiThought';

export const resolveAssistantStreamThoughtDisplay = (event: AssistantStreamEvent) => resolveThoughtDisplayEvent(event, {
  includeProgress: true,
});

export const resolveAssistantStreamThought = (event: AssistantStreamEvent) => {
  const resolution = resolveAssistantStreamThoughtDisplay(event);
  return resolution?.kind === 'model_thought' || resolution?.kind === 'status'
    ? resolution.text
    : '';
};
