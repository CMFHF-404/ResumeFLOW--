import type { AssistantStreamEvent } from '../../services/aiService';
import { extractThoughtHeadline } from '../../utils/aiThought';

export const resolveAssistantStreamThought = (event: AssistantStreamEvent) => {
  if (event.type === 'thought') {
    return extractThoughtHeadline(event.summary) || event.summary;
  }
  if (event.type === 'progress') {
    return event.title?.trim() || '';
  }
  return '';
};
