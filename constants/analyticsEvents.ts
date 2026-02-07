export const ANALYTICS_EVENTS = {
  PAGE_VIEW: 'page_view',
  SIGN_UP_SUCCESS: 'sign_up_success',
  FIRST_EXPERIENCE_CREATED: 'first_experience_created',
  RESUME_EXPORTED: 'resume_exported',
  AI_POLISH_START: 'ai_polish_start',
  AI_POLISH_RESULT: 'ai_polish_result',
  JD_ANALYSIS_START: 'jd_analysis_start',
  JD_ANALYSIS_COMPLETE: 'jd_analysis_complete',
  LAYOUT_MODE_CHANGE: 'layout_mode_change',
  SMART_ONE_PAGE_TRIGGERED: 'smart_one_page_triggered',
  MODULE_REORDERED: 'module_reordered',
} as const;

export const ANALYTICS_PROPERTIES = {
  VIEW: 'view',
  PATH: 'path',
  CATEGORY: 'category',
  SOURCE: 'source',
  FIELD: 'field',
  ACTION: 'action',
  DURATION_MS: 'duration_ms',
  MATCH_SCORE: 'match_score',
  FROM: 'from',
  TO: 'to',
  LINE_HEIGHT: 'line_height',
  FONT_SIZE: 'font_size',
  MODULE_TYPE: 'module_type',
  MODULE_KEY: 'module_key',
  SECTION_ID: 'section_id',
  RESUME_ID: 'resume_id',
  FROM_POSITION: 'from_position',
  TO_POSITION: 'to_position',
} as const;

export type AiPolishAction = 'applied' | 'edited' | 'discarded';
