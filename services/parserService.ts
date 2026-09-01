import apiClient, {
  AuthContextChangedError,
  getAuthorizationHeader,
} from './apiClient';
import {
  isAuthSessionSnapshotCurrent,
  readAuthSessionSnapshot,
} from './authTokenProvider';
import { dispatchLoginRequired } from './authRedirect';
import { handleFetchAuthFailure } from './authRecoveryCoordinator';
import {
  DEFAULT_QUOTA_PURCHASE_MESSAGE,
  dispatchQuotaPurchaseRequired,
} from './quotaPurchasePrompt';
import { parseNdjsonChunk, resolveApiUrl } from './apiStreamUtils';
import type { ExperienceCategory } from './experienceService';

export interface DuplicateMatch {
  is_duplicate: boolean;
  match_type?: 'exact' | 'similar' | 'semantic';
  match_score?: number;
  matched_existing_id?: string;
  match_reason?: string;
}

export interface ParsedExperienceVersion {
  title: string;
  org?: string;
  location?: string;
  start_date?: string;
  end_date?: string;
  is_current?: boolean;
  summary?: string;
  highlights?: string[];
  star?: Record<string, any>;
}

export interface ParsedExperienceItem {
  id: string;
  category: ExperienceCategory;
  version: ParsedExperienceVersion;
  duplicate: DuplicateMatch;
}

export interface ParsedPersonalInfo {
  full_name?: string;
  email?: string;
  phone?: string;
  location?: string;
  links?: string[];
}

export type ParsedPersonalInfoSelection = {
  full_name: boolean;
  email: boolean;
  phone: boolean;
  location: boolean;
};

export interface ParsedCertification {
  name: string;
  issuer?: string;
  issue_date?: string;
  expiry_date?: string;
  credential_id?: string;
  credential_url?: string;
  description?: string;
}

export interface ParsedSkillGroup {
  category: string;
  tags: string[];
}

export interface ResumeParseResponse {
  items: ParsedExperienceItem[];
  personal_info?: ParsedPersonalInfo;
  certifications?: ParsedCertification[];
  skills?: ParsedSkillGroup[];
}

export interface ResumeParseOptions {
  enableThinking?: boolean;
  expectedAuthCacheKey?: string;
}

export type ResumeParseProgressNode =
  | 'receive_file'
  | 'extract_text'
  | 'segment_resume'
  | 'request_ai'
  | 'merge_result'
  | 'dedupe_result'
  | 'finalize';

export type ResumeParseProgressEvent = {
  type: 'progress';
  node: ResumeParseProgressNode;
  title?: string;
};

export type ResumeParseThoughtEvent = {
  type: 'thought';
  summary: string;
};

type ResumeParseThoughtResetEvent = {
  type: 'thought_reset';
};

type ResumeParseFinalEvent = {
  type: 'final';
  result: ResumeParseResponse;
};

type ResumeParseErrorEvent = {
  type: 'error';
  message?: string;
};

export type ResumeParseStreamEvent =
  | ResumeParseProgressEvent
  | ResumeParseThoughtEvent
  | ResumeParseThoughtResetEvent
  | ResumeParseFinalEvent
  | ResumeParseErrorEvent;

const readErrorMessage = async (response: Response) => {
  const contentType = response.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as { detail?: string };
      if (typeof payload.detail === 'string' && payload.detail.trim()) {
        return payload.detail.trim();
      }
    }
    const text = (await response.text()).trim();
    return text || null;
  } catch {
    return null;
  }
};

const streamResumeParseRequest = async (
  file: File,
  onEvent?: (event: ResumeParseStreamEvent) => void,
  signal?: AbortSignal,
  options: ResumeParseOptions = {}
): Promise<ResumeParseResponse> => {
  const authHeader = await getAuthorizationHeader(options.expectedAuthCacheKey);
  if (!authHeader) {
    dispatchLoginRequired('write-operation');
    throw new Error('Authentication required for write operation');
  }
  const dispatchSession = readAuthSessionSnapshot();
  const assertParseSessionCurrent = () => {
    if (
      !isAuthSessionSnapshotCurrent(dispatchSession)
      || (
        options.expectedAuthCacheKey
        && dispatchSession.ownerKey !== options.expectedAuthCacheKey
      )
    ) {
      throw new AuthContextChangedError();
    }
  };
  assertParseSessionCurrent();

  const formData = new FormData();
  formData.append('file', file);
  if (options.enableThinking) {
    formData.append('enable_thinking', 'true');
  }

  const response = await fetch(resolveApiUrl('/parser/parse/stream'), {
    method: 'POST',
    headers: {
      Authorization: authHeader,
    },
    body: formData,
    signal,
  });

  assertParseSessionCurrent();
  if (!response.ok) {
    if (response.status === 401 || response.status === 503) {
      await handleFetchAuthFailure(
        response,
        dispatchSession.ownerKey,
        isAuthSessionSnapshotCurrent(dispatchSession),
      );
    }
    const errorMessage = await readErrorMessage(response);
    if (response.status === 402) {
      const quotaMessage = errorMessage || DEFAULT_QUOTA_PURCHASE_MESSAGE;
      dispatchQuotaPurchaseRequired(quotaMessage);
      throw new Error(quotaMessage);
    }
    throw new Error(errorMessage || `Resume parse stream request failed: ${response.status}`);
  }
  if (!response.body) {
    throw new Error('Resume parse stream response body is empty');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: ResumeParseResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    assertParseSessionCurrent();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const { lines, remainder } = parseNdjsonChunk(buffer, done);
    buffer = remainder;

    for (const line of lines) {
      assertParseSessionCurrent();
      let parsed: ResumeParseStreamEvent;
      try {
        parsed = JSON.parse(line) as ResumeParseStreamEvent;
      } catch (error) {
        console.warn('Failed to parse resume stream line', error);
        continue;
      }
      if (parsed.type === 'progress') {
        onEvent?.(parsed);
        continue;
      }
      if (parsed.type === 'thought') {
        onEvent?.(parsed);
        continue;
      }
      if (parsed.type === 'thought_reset') {
        onEvent?.(parsed);
        continue;
      }
      if (parsed.type === 'error') {
        throw new Error(parsed.message || 'Resume parse stream error');
      }
      if (parsed.type === 'final') {
        finalResult = parsed.result;
      }
    }

    if (done) {
      break;
    }
  }

  if (!finalResult) {
    throw new Error('Resume parse stream did not return final result');
  }
  assertParseSessionCurrent();
  return finalResult;
};

export const parserService = {
  async parseResume(
    file: File,
    onEvent?: (event: ResumeParseStreamEvent) => void,
    signal?: AbortSignal,
    options: ResumeParseOptions = {}
  ) {
    if (onEvent) {
      return streamResumeParseRequest(file, onEvent, signal, options);
    }
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post<ResumeParseResponse>('/parser/parse', formData, {
      headers: {
        'Content-Type': null,
      },
      signal,
      expectedAuthCacheKey: options.expectedAuthCacheKey,
    });
    return response.data;
  },
};
