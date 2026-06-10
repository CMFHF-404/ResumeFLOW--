import React from 'react';
import { useLogto } from '@logto/react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  Send,
  X,
} from 'lucide-react';
import {
  logtoAccountService,
  LogtoAccountApiError,
  normalizeLogtoPhoneIdentifier,
  type LogtoAccountIdentifierType,
  type LogtoAccountProfile,
  type LogtoTokenGetter,
  type LogtoVerificationRecord,
} from '../services/logtoAccountService';
import { dispatchLoginRequired } from '../services/authRedirect';

type AccountManagementModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

type AccountAction = 'email' | 'phone' | 'password';
type FlowStep = 'select' | 'verify' | 'update';
type IdentityMethod = 'password' | 'code';
type VerificationCodeCooldownKey = 'identity' | 'email' | 'phone';
type MutationKey =
  | 'load'
  | 'identity-password'
  | 'identity-send-code'
  | 'identity-verify-code'
  | 'email-send-code'
  | 'email-update'
  | 'phone-send-code'
  | 'phone-update'
  | 'password-update';

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-700/80 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20';
const LABEL_CLASS = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400';
const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50';
const PANEL_CLASS = 'rounded-lg border border-slate-800 bg-slate-900/70 p-3 shadow-lg shadow-slate-950/20 sm:p-4';
const DEFAULT_VERIFICATION_CODE_COOLDOWN_SECONDS = 60;
const IDENTITY_VERIFICATION_CACHE_TTL_MS = 10 * 60 * 1000;
const IDENTITY_VERIFICATION_CACHE_PREFIX = 'resumeflow.account.identityVerification';
const ACCOUNT_MANAGEMENT_DRAFT_STORAGE_KEY = 'resumeflow.accountManagement.draft';
const INITIAL_VERIFICATION_CODE_COOLDOWNS: Record<VerificationCodeCooldownKey, number> = {
  identity: 0,
  email: 0,
  phone: 0,
};

type CachedIdentityVerification = LogtoVerificationRecord & {
  accountId: string;
  expiresAtMs: number;
};

type AccountManagementDraft = {
  accountId?: string;
  activeAction: AccountAction | null;
  flowStep: FlowStep;
  identityMethod: IdentityMethod;
  identityIdentifierType: LogtoAccountIdentifierType;
  identityIdentifierValue: string;
  identityCodeRecord: LogtoVerificationRecord | null;
  identityCode: string;
  newEmail: string;
  newEmailRecord: LogtoVerificationRecord | null;
  newEmailVerifiedRecord: LogtoVerificationRecord | null;
  newEmailCode: string;
  newPhone: string;
  newPhoneRecord: LogtoVerificationRecord | null;
  newPhoneVerifiedRecord: LogtoVerificationRecord | null;
  newPhoneCode: string;
};

const formatAccountValue = (value?: string | null) => value?.trim() || '未绑定';

const formatAccountPhoneValue = (value?: string | null) => {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return '未绑定';
  }

  if (trimmedValue.startsWith('86') && normalizeLogtoPhoneIdentifier(value) === trimmedValue) {
    return trimmedValue.slice(2);
  }

  return trimmedValue;
};

const getCodeCooldownButtonText = (label: string, seconds: number) => (
  seconds > 0 ? `${seconds} 秒后重试` : label
);

const getIdentityVerificationCacheKey = (account: LogtoAccountProfile | null) => (
  account?.id ? `${IDENTITY_VERIFICATION_CACHE_PREFIX}:${account.id}` : ''
);

const getCachedIdentityVerification = (account: LogtoAccountProfile | null): LogtoVerificationRecord | null => {
  const cacheKey = getIdentityVerificationCacheKey(account);
  if (!cacheKey || typeof window === 'undefined') {
    return null;
  }

  try {
    const cached = window.sessionStorage.getItem(cacheKey);
    if (!cached) {
      return null;
    }
    const parsed = JSON.parse(cached) as Partial<CachedIdentityVerification>;
    if (
      parsed.accountId !== account?.id ||
      typeof parsed.verificationRecordId !== 'string' ||
      typeof parsed.expiresAtMs !== 'number' ||
      parsed.expiresAtMs <= Date.now()
    ) {
      window.sessionStorage.removeItem(cacheKey);
      return null;
    }

    return {
      verificationRecordId: parsed.verificationRecordId,
      expiresAt: parsed.expiresAt ?? null,
    };
  } catch {
    window.sessionStorage.removeItem(cacheKey);
    return null;
  }
};

const cacheIdentityVerification = (
  account: LogtoAccountProfile | null,
  record: LogtoVerificationRecord
) => {
  const cacheKey = getIdentityVerificationCacheKey(account);
  const accountId = account?.id;
  if (!cacheKey || !accountId || typeof window === 'undefined') {
    return;
  }

  const payload: CachedIdentityVerification = {
    ...record,
    accountId,
    expiresAtMs: Date.now() + IDENTITY_VERIFICATION_CACHE_TTL_MS,
  };
  window.sessionStorage.setItem(cacheKey, JSON.stringify(payload));
};

const clearCachedIdentityVerification = (account: LogtoAccountProfile | null) => {
  const cacheKey = getIdentityVerificationCacheKey(account);
  if (cacheKey && typeof window !== 'undefined') {
    window.sessionStorage.removeItem(cacheKey);
  }
};

const isAccountAction = (value: unknown): value is AccountAction | null => (
  value === null || value === 'email' || value === 'phone' || value === 'password'
);

const isFlowStep = (value: unknown): value is FlowStep => (
  value === 'select' || value === 'verify' || value === 'update'
);

const isIdentityMethod = (value: unknown): value is IdentityMethod => (
  value === 'password' || value === 'code'
);

const isIdentifierType = (value: unknown): value is LogtoAccountIdentifierType => (
  value === 'email' || value === 'phone'
);

const parseDraftVerificationRecord = (value: unknown): LogtoVerificationRecord | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Partial<LogtoVerificationRecord>;
  if (typeof record.verificationRecordId !== 'string') {
    return null;
  }
  return {
    verificationRecordId: record.verificationRecordId,
    expiresAt: typeof record.expiresAt === 'string' || typeof record.expiresAt === 'number'
      ? record.expiresAt
      : null,
  };
};

const readAccountManagementDraft = (): AccountManagementDraft | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(ACCOUNT_MANAGEMENT_DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<AccountManagementDraft>;
    if (
      !isAccountAction(parsed.activeAction ?? null) ||
      !isFlowStep(parsed.flowStep) ||
      !isIdentityMethod(parsed.identityMethod) ||
      !isIdentifierType(parsed.identityIdentifierType)
    ) {
      window.sessionStorage.removeItem(ACCOUNT_MANAGEMENT_DRAFT_STORAGE_KEY);
      return null;
    }

    return {
      accountId: typeof parsed.accountId === 'string' ? parsed.accountId : undefined,
      activeAction: parsed.activeAction ?? null,
      flowStep: parsed.flowStep,
      identityMethod: parsed.identityMethod,
      identityIdentifierType: parsed.identityIdentifierType,
      identityIdentifierValue: typeof parsed.identityIdentifierValue === 'string' ? parsed.identityIdentifierValue : '',
      identityCodeRecord: parseDraftVerificationRecord(parsed.identityCodeRecord),
      identityCode: typeof parsed.identityCode === 'string' ? parsed.identityCode : '',
      newEmail: typeof parsed.newEmail === 'string' ? parsed.newEmail : '',
      newEmailRecord: parseDraftVerificationRecord(parsed.newEmailRecord),
      newEmailVerifiedRecord: parseDraftVerificationRecord(parsed.newEmailVerifiedRecord),
      newEmailCode: typeof parsed.newEmailCode === 'string' ? parsed.newEmailCode : '',
      newPhone: typeof parsed.newPhone === 'string' ? parsed.newPhone : '',
      newPhoneRecord: parseDraftVerificationRecord(parsed.newPhoneRecord),
      newPhoneVerifiedRecord: parseDraftVerificationRecord(parsed.newPhoneVerifiedRecord),
      newPhoneCode: typeof parsed.newPhoneCode === 'string' ? parsed.newPhoneCode : '',
    };
  } catch {
    window.sessionStorage.removeItem(ACCOUNT_MANAGEMENT_DRAFT_STORAGE_KEY);
    return null;
  }
};

const writeAccountManagementDraft = (draft: AccountManagementDraft) => {
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(ACCOUNT_MANAGEMENT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }
};

const clearAccountManagementDraft = () => {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(ACCOUNT_MANAGEMENT_DRAFT_STORAGE_KEY);
  }
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof LogtoAccountApiError) {
    const message = error.message || fallback;
    if (error.status === 401) {
      return '登录状态已失效，请重新登录后再试';
    }
    if (error.status === 403) {
      return '本人验证已失效或权限不足，请重新完成验证';
    }
    if (error.status === 422) {
      return message.includes('password') ? '新密码不符合当前 Logto 密码规则' : message;
    }
    if (error.status === 429) {
      return error.retryAfterSeconds
        ? `请稍后再试，${error.retryAfterSeconds} 秒后重试`
        : '请稍后再试';
    }
    if (/verification|code/i.test(message)) {
      return '验证码无效或已过期，请重新获取';
    }
    if (/connector|template/i.test(message)) {
      return 'Logto 邮件或短信连接器尚未配置完整';
    }
    if (/exist|already|unique/i.test(message)) {
      return '该邮箱或手机号已被其他账号使用';
    }
    return message;
  }
  return error instanceof Error ? error.message : fallback;
};

const isAuthExpiredError = (error: unknown) => {
  return error instanceof LogtoAccountApiError && error.status === 401;
};

const Spinner = () => <Loader2 className="h-4 w-4 animate-spin" />;

const VerificationBadge: React.FC<{ record: LogtoVerificationRecord | null }> = ({ record }) => {
  if (!record) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-400/10 px-2 py-1 text-xs font-medium text-amber-300">
        未验证
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-xs font-medium text-emerald-300">
      <CheckCircle2 className="h-3.5 w-3.5" />
      已验证
    </span>
  );
};

const AccountSummaryItem: React.FC<{
  label: string;
  value?: string | null;
}> = ({ label, value }) => (
  <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-1.5 sm:px-3 sm:py-2">
    <div className="text-xs text-slate-500">{label}</div>
    <div className="mt-1 truncate text-sm font-medium text-slate-100">{formatAccountValue(value)}</div>
  </div>
);

const StepRail: React.FC<{
  currentStep: FlowStep;
  onSelectStep: (step: FlowStep) => void;
  disabled: boolean;
}> = ({ currentStep, onSelectStep, disabled }) => {
  const steps: Array<{ key: FlowStep; label: string }> = [
    { key: 'select', label: '选择更新项' },
    { key: 'verify', label: '二次验证' },
    { key: 'update', label: '填写并更新' },
  ];
  const activeIndex = steps.findIndex((step) => step.key === currentStep);

  return (
    <div className="relative grid grid-cols-3 gap-2 pt-1" aria-label="账号更新步骤">
      <div className="absolute left-0 right-0 top-[14px] h-px bg-slate-800" aria-hidden="true" />
      {steps.map((step, index) => {
        const isActive = index === activeIndex;
        const isDone = index < activeIndex;
        const canSelect = step.key === 'select' && currentStep !== 'select' && !disabled;
        const className = `relative z-10 flex min-w-0 flex-col items-center text-center text-xs font-medium transition ${
          isActive
            ? 'text-cyan-200'
            : isDone
              ? 'text-emerald-200'
              : 'text-slate-500'
        } ${canSelect ? 'hover:text-cyan-200' : ''}`;
        const content = (
          <>
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs shadow-sm shadow-slate-950/30 ${
                isActive
                  ? 'border-cyan-300 bg-cyan-400 text-slate-950'
                  : isDone
                    ? 'border-emerald-300 bg-emerald-400 text-slate-950'
                    : 'border-slate-700 bg-slate-800 text-slate-500'
              }`}
            >
              {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className="mt-2 block max-w-full truncate">{step.label}</span>
          </>
        );

        if (canSelect) {
          return (
            <button
              key={step.key}
              className={className}
              onClick={() => onSelectStep(step.key)}
              type="button"
            >
              {content}
            </button>
          );
        }

        return (
          <div
            key={step.key}
            className={className}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
};

const TaskCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  value: string;
  description: string;
  actionText: string;
  onClick: () => void;
  disabled: boolean;
}> = ({ icon, title, value, description, actionText, onClick, disabled }) => (
  <button
    className="group flex w-full items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-left transition hover:border-cyan-400/60 hover:bg-slate-900/90 disabled:cursor-not-allowed disabled:opacity-50 sm:gap-4 sm:p-4"
    onClick={onClick}
    type="button"
    disabled={disabled}
  >
    <span className="flex min-w-0 gap-2.5 sm:gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-cyan-200 sm:h-9 sm:w-9">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-100">{title}</span>
        <span className="mt-1 block truncate text-xs text-slate-400">{value}</span>
        <span className="mt-1.5 block text-xs leading-4 text-slate-500 sm:mt-2 sm:leading-5">{description}</span>
      </span>
    </span>
    <span className="mt-1 flex shrink-0 items-center gap-1 text-xs font-semibold text-cyan-300 transition group-hover:text-cyan-200">
      {actionText}
      <ChevronRight className="h-4 w-4" />
    </span>
  </button>
);

const getActionTitle = (action: AccountAction | null, account: LogtoAccountProfile | null) => {
  if (action === 'email') {
    return '更换邮箱';
  }
  if (action === 'phone') {
    return account?.primaryPhone ? '更换手机号' : '绑定手机号';
  }
  if (action === 'password') {
    return '更改密码';
  }
  return '账号管理';
};

const AccountManagementModal: React.FC<AccountManagementModalProps> = ({ isOpen, onClose }) => {
  const { getAccessToken, isAuthenticated } = useLogto();
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const codeRequestInFlightRef = React.useRef<Set<VerificationCodeCooldownKey>>(new Set());
  const skipNextDraftPersistRef = React.useRef(false);

  const [account, setAccount] = React.useState<LogtoAccountProfile | null>(null);
  const [activeAction, setActiveAction] = React.useState<AccountAction | null>(null);
  const [flowStep, setFlowStep] = React.useState<FlowStep>('select');
  const [identityMethod, setIdentityMethod] = React.useState<IdentityMethod>('password');
  const [identityPassword, setIdentityPassword] = React.useState('');
  const [identityIdentifierType, setIdentityIdentifierType] = React.useState<LogtoAccountIdentifierType>('email');
  const [identityIdentifierValue, setIdentityIdentifierValue] = React.useState('');
  const [identityCodeRecord, setIdentityCodeRecord] = React.useState<LogtoVerificationRecord | null>(null);
  const [identityCode, setIdentityCode] = React.useState('');
  const [identityVerification, setIdentityVerification] = React.useState<LogtoVerificationRecord | null>(null);

  const [newEmail, setNewEmail] = React.useState('');
  const [newEmailRecord, setNewEmailRecord] = React.useState<LogtoVerificationRecord | null>(null);
  const [newEmailVerifiedRecord, setNewEmailVerifiedRecord] = React.useState<LogtoVerificationRecord | null>(null);
  const [newEmailCode, setNewEmailCode] = React.useState('');

  const [newPhone, setNewPhone] = React.useState('');
  const [newPhoneRecord, setNewPhoneRecord] = React.useState<LogtoVerificationRecord | null>(null);
  const [newPhoneVerifiedRecord, setNewPhoneVerifiedRecord] = React.useState<LogtoVerificationRecord | null>(null);
  const [newPhoneCode, setNewPhoneCode] = React.useState('');

  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [activeMutation, setActiveMutation] = React.useState<MutationKey | null>(null);
  const [verificationCodeCooldowns, setVerificationCodeCooldowns] = React.useState(INITIAL_VERIFICATION_CODE_COOLDOWNS);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const tokenGetter = React.useCallback<LogtoTokenGetter>(async () => {
    if (!getAccessToken) {
      return null;
    }
    return getAccessToken();
  }, [getAccessToken]);

  const closeAndRequireLogin = React.useCallback(() => {
    clearAccountManagementDraft();
    onClose();
    dispatchLoginRequired('unauthorized');
  }, [onClose]);

  const closeAccountManagement = React.useCallback(() => {
    clearAccountManagementDraft();
    onClose();
  }, [onClose]);

  const resetIdentityChallenge = React.useCallback((profile: LogtoAccountProfile | null) => {
    setIdentityMethod('password');
    setIdentityPassword('');
    setIdentityIdentifierType(profile?.primaryEmail ? 'email' : 'phone');
    setIdentityIdentifierValue(profile?.primaryEmail || profile?.primaryPhone || '');
    setIdentityCodeRecord(null);
    setIdentityCode('');
    setIdentityVerification(null);
  }, []);

  const resetUpdateFields = React.useCallback(() => {
    setNewEmail('');
    setNewEmailRecord(null);
    setNewEmailVerifiedRecord(null);
    setNewEmailCode('');
    setNewPhone('');
    setNewPhoneRecord(null);
    setNewPhoneVerifiedRecord(null);
    setNewPhoneCode('');
    setNewPassword('');
    setConfirmPassword('');
  }, []);

  const refreshAccount = React.useCallback(async () => {
    if (!isOpen || !isAuthenticated) {
      return;
    }
    setActiveMutation('load');
    setError('');
    try {
      const data = await logtoAccountService.getAccountProfile(tokenGetter);
      const draft = readAccountManagementDraft();
      const canUseDraft = !draft?.accountId || draft.accountId === data.id;
      if (draft && !canUseDraft) {
        clearAccountManagementDraft();
        setActiveAction(null);
        setFlowStep('select');
        resetUpdateFields();
      }
      setAccount(data);
      setIdentityIdentifierType(canUseDraft && draft?.identityIdentifierType
        ? draft.identityIdentifierType
        : data.primaryEmail ? 'email' : 'phone');
      setIdentityIdentifierValue(canUseDraft && draft?.identityIdentifierValue
        ? draft.identityIdentifierValue
        : data.primaryEmail || data.primaryPhone || '');
      setIdentityVerification(getCachedIdentityVerification(data));
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) {
        closeAndRequireLogin();
        return;
      }
      setError(getErrorMessage(loadError, '账号信息加载失败'));
    } finally {
      setActiveMutation((current) => (current === 'load' ? null : current));
    }
  }, [closeAndRequireLogin, isAuthenticated, isOpen, resetUpdateFields, tokenGetter]);

  React.useEffect(() => {
    if (isOpen && !isAuthenticated) {
      closeAccountManagement();
    }
  }, [closeAccountManagement, isAuthenticated, isOpen]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    skipNextDraftPersistRef.current = true;
    const draft = readAccountManagementDraft();
    setAccount(null);
    setActiveAction(draft?.activeAction ?? null);
    setFlowStep(draft?.flowStep ?? 'select');
    resetIdentityChallenge(null);
    resetUpdateFields();
    if (draft) {
      setIdentityMethod(draft.identityMethod);
      setIdentityIdentifierType(draft.identityIdentifierType);
      setIdentityIdentifierValue(draft.identityIdentifierValue);
      setIdentityCodeRecord(draft.identityCodeRecord);
      setIdentityCode(draft.identityCode);
      setNewEmail(draft.newEmail);
      setNewEmailRecord(draft.newEmailRecord);
      setNewEmailVerifiedRecord(draft.newEmailVerifiedRecord);
      setNewEmailCode(draft.newEmailCode);
      setNewPhone(draft.newPhone);
      setNewPhoneRecord(draft.newPhoneRecord);
      setNewPhoneVerifiedRecord(draft.newPhoneVerifiedRecord);
      setNewPhoneCode(draft.newPhoneCode);
    }
    setError('');
    setSuccess('');
    void refreshAccount();
  }, [isOpen, refreshAccount, resetIdentityChallenge, resetUpdateFields]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (skipNextDraftPersistRef.current) {
      skipNextDraftPersistRef.current = false;
      return;
    }

    writeAccountManagementDraft({
      accountId: account?.id,
      activeAction,
      flowStep,
      identityMethod,
      identityIdentifierType,
      identityIdentifierValue,
      identityCodeRecord,
      identityCode,
      newEmail,
      newEmailRecord,
      newEmailVerifiedRecord,
      newEmailCode,
      newPhone,
      newPhoneRecord,
      newPhoneVerifiedRecord,
      newPhoneCode,
    });
  }, [
    account?.id,
    activeAction,
    flowStep,
    identityCode,
    identityCodeRecord,
    identityIdentifierType,
    identityIdentifierValue,
    identityMethod,
    isOpen,
    newEmail,
    newEmailCode,
    newEmailRecord,
    newEmailVerifiedRecord,
    newPhone,
    newPhoneCode,
    newPhoneRecord,
    newPhoneVerifiedRecord,
  ]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAccountManagement();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeAccountManagement, isOpen]);

  React.useEffect(() => {
    if (!isOpen || !Object.values(verificationCodeCooldowns).some((seconds) => seconds > 0)) {
      return;
    }

    const timerId = window.setInterval(() => {
      setVerificationCodeCooldowns((current) => ({
        identity: Math.max(0, current.identity - 1),
        email: Math.max(0, current.email - 1),
        phone: Math.max(0, current.phone - 1),
      }));
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [isOpen, verificationCodeCooldowns]);

  const startVerificationCodeCooldown = React.useCallback((
    key: VerificationCodeCooldownKey,
    seconds = DEFAULT_VERIFICATION_CODE_COOLDOWN_SECONDS
  ) => {
    setVerificationCodeCooldowns((current) => ({
      ...current,
      [key]: Math.max(1, seconds),
    }));
  }, []);

  const runMutation = async (key: MutationKey, action: () => Promise<void>, fallback: string) => {
    setActiveMutation(key);
    setError('');
    setSuccess('');
    try {
      await action();
    } catch (mutationError) {
      if (isAuthExpiredError(mutationError)) {
        closeAndRequireLogin();
        return;
      }
      if (mutationError instanceof LogtoAccountApiError && mutationError.status === 403) {
        clearCachedIdentityVerification(account);
        setIdentityVerification(null);
        setFlowStep('verify');
      }
      setError(getErrorMessage(mutationError, fallback));
    } finally {
      setActiveMutation((current) => (current === key ? null : current));
    }
  };

  const runCodeSendMutation = (
    cooldownKey: VerificationCodeCooldownKey,
    mutationKey: MutationKey,
    action: () => Promise<void>,
    fallback: string
  ) => {
    if (codeRequestInFlightRef.current.has(cooldownKey) || verificationCodeCooldowns[cooldownKey] > 0) {
      setError('请稍后再试');
      setSuccess('');
      return;
    }

    codeRequestInFlightRef.current.add(cooldownKey);
    return runMutation(
      mutationKey,
      async () => {
        try {
          await action();
          startVerificationCodeCooldown(cooldownKey);
        } catch (codeSendError) {
          if (codeSendError instanceof LogtoAccountApiError && codeSendError.status === 429) {
            startVerificationCodeCooldown(
              cooldownKey,
              codeSendError.retryAfterSeconds || DEFAULT_VERIFICATION_CODE_COOLDOWN_SECONDS
            );
          }
          throw codeSendError;
        } finally {
          codeRequestInFlightRef.current.delete(cooldownKey);
        }
      },
      fallback
    );
  };

  const beginAction = (action: AccountAction) => {
    const cachedIdentityVerification = getCachedIdentityVerification(account);
    setActiveAction(action);
    setFlowStep(cachedIdentityVerification ? 'update' : 'verify');
    setError('');
    setSuccess('');
    resetIdentityChallenge(account);
    setIdentityVerification(cachedIdentityVerification);
    resetUpdateFields();
  };

  const returnToSelection = () => {
    setActiveAction(null);
    setFlowStep('select');
    setError('');
    resetIdentityChallenge(account);
    setIdentityVerification(getCachedIdentityVerification(account));
    resetUpdateFields();
  };

  const handleStepSelect = (step: FlowStep) => {
    if (step === 'select' && flowStep !== 'select') {
      returnToSelection();
    }
  };

  const finishIdentityVerification = (record: LogtoVerificationRecord) => {
    setIdentityVerification(record);
    cacheIdentityVerification(account, record);
    setIdentityPassword('');
    setIdentityCode('');
    setFlowStep('update');
    setSuccess('二次验证已完成，请继续填写更新信息');
  };

  const completeUpdate = async (message: string) => {
    resetUpdateFields();
    resetIdentityChallenge(null);
    setActiveAction(null);
    setFlowStep('select');
    setSuccess(message);
    await refreshAccount();
  };

  const requireIdentityVerification = () => {
    if (!identityVerification) {
      setFlowStep('verify');
      setError('请先完成二次验证');
      return null;
    }
    return identityVerification.verificationRecordId;
  };

  const verifyIdentityPassword = () => runMutation(
    'identity-password',
    async () => {
      if (!identityPassword.trim()) {
        throw new Error('请输入当前密码');
      }
      const record = await logtoAccountService.verifyIdentityByPassword(tokenGetter, identityPassword);
      finishIdentityVerification(record);
    },
    '二次验证失败'
  );

  const sendIdentityCode = () => runCodeSendMutation(
    'identity',
    'identity-send-code',
    async () => {
      const value = identityIdentifierValue.trim();
      if (!value) {
        throw new Error(identityIdentifierType === 'email' ? '请输入当前邮箱' : '请输入当前手机号');
      }
      const record = await logtoAccountService.sendVerificationCode(tokenGetter, {
        type: identityIdentifierType,
        value,
      });
      setIdentityCodeRecord(record);
      setIdentityCode('');
      setSuccess('验证码已发送');
    },
    '验证码发送失败'
  );

  const verifyIdentityCode = () => runMutation(
    'identity-verify-code',
    async () => {
      if (!identityCodeRecord) {
        throw new Error('请先获取验证码');
      }
      if (!identityCode.trim()) {
        throw new Error('请输入验证码');
      }
      const record = await logtoAccountService.verifyCode(
        tokenGetter,
        { type: identityIdentifierType, value: identityIdentifierValue.trim() },
        identityCodeRecord.verificationRecordId,
        identityCode.trim()
      );
      finishIdentityVerification(record);
    },
    '验证码验证失败'
  );

  const sendNewEmailCode = () => runCodeSendMutation(
    'email',
    'email-send-code',
    async () => {
      const email = newEmail.trim();
      if (!/\S+@\S+\.\S+/.test(email)) {
        throw new Error('请输入有效邮箱');
      }
      const record = await logtoAccountService.sendVerificationCode(tokenGetter, {
        type: 'email',
        value: email,
      });
      setNewEmailRecord(record);
      setNewEmailVerifiedRecord(null);
      setNewEmailCode('');
      setSuccess('新邮箱验证码已发送');
    },
    '新邮箱验证码发送失败'
  );

  const updateEmailWithCode = () => runMutation(
    'email-update',
    async () => {
      const identityVerificationId = requireIdentityVerification();
      if (!identityVerificationId) {
        return;
      }
      const email = newEmail.trim();
      if (!/\S+@\S+\.\S+/.test(email)) {
        throw new Error('请输入有效邮箱');
      }
      if (!newEmailVerifiedRecord && !newEmailCode.trim()) {
        throw new Error('请输入新邮箱验证码');
      }
      if (!newEmailVerifiedRecord && !newEmailRecord) {
        throw new Error('验证码记录已失效，请重新发送验证码');
      }
      const emailVerificationRecord = newEmailVerifiedRecord ?? await logtoAccountService.verifyCode(
        tokenGetter,
        { type: 'email', value: email },
        newEmailRecord!.verificationRecordId,
        newEmailCode.trim()
      );
      setNewEmailVerifiedRecord(emailVerificationRecord);
      await logtoAccountService.updatePrimaryEmail(
        tokenGetter,
        email,
        identityVerificationId,
        emailVerificationRecord.verificationRecordId
      );
      await completeUpdate('邮箱已更新');
    },
    '邮箱更新失败'
  );

  const sendNewPhoneCode = () => runCodeSendMutation(
    'phone',
    'phone-send-code',
    async () => {
      const normalizedPhone = normalizeLogtoPhoneIdentifier(newPhone);
      if (!normalizedPhone) {
        throw new Error('请输入 11 位中国大陆手机号');
      }
      const record = await logtoAccountService.sendVerificationCode(tokenGetter, {
        type: 'phone',
        value: normalizedPhone,
      });
      setNewPhoneRecord(record);
      setNewPhoneVerifiedRecord(null);
      setNewPhoneCode('');
      setSuccess('新手机号验证码已发送');
    },
    '新手机号验证码发送失败'
  );

  const updatePhoneWithCode = () => runMutation(
    'phone-update',
    async () => {
      const identityVerificationId = requireIdentityVerification();
      if (!identityVerificationId) {
        return;
      }
      if (!newPhoneVerifiedRecord && !newPhoneCode.trim()) {
        throw new Error('请输入新手机号验证码');
      }
      if (!newPhoneVerifiedRecord && !newPhoneRecord) {
        throw new Error('验证码记录已失效，请重新发送验证码');
      }
      const normalizedPhone = normalizeLogtoPhoneIdentifier(newPhone);
      const phoneVerificationRecord = newPhoneVerifiedRecord ?? await logtoAccountService.verifyCode(
        tokenGetter,
        { type: 'phone', value: normalizedPhone },
        newPhoneRecord!.verificationRecordId,
        newPhoneCode.trim()
      );
      setNewPhoneVerifiedRecord(phoneVerificationRecord);
      await logtoAccountService.updatePrimaryPhone(
        tokenGetter,
        normalizedPhone,
        identityVerificationId,
        phoneVerificationRecord.verificationRecordId
      );
      await completeUpdate('手机号已更新');
    },
    '手机号更新失败'
  );

  const updateAccountPassword = () => runMutation(
    'password-update',
    async () => {
      const identityVerificationId = requireIdentityVerification();
      if (!identityVerificationId) {
        return;
      }
      if (newPassword.length < 8) {
        throw new Error('新密码至少 8 位');
      }
      if (newPassword !== confirmPassword) {
        throw new Error('两次输入的新密码不一致');
      }
      await logtoAccountService.updatePassword(tokenGetter, newPassword, identityVerificationId);
      await completeUpdate('密码已更新');
    },
    '密码更新失败'
  );

  if (!isOpen) {
    return null;
  }

  const isLoading = activeMutation === 'load';
  const mutationInProgress = Boolean(activeMutation);
  const actionTitle = getActionTitle(activeAction, account);
  const canUseEmailCode = Boolean(account?.primaryEmail);
  const canUsePhoneCode = Boolean(account?.primaryPhone);

  const renderSelectionStep = () => (
    <div className="space-y-3 sm:space-y-4">
      <div className="grid gap-2.5 sm:gap-3">
        <TaskCard
          icon={<Mail className="h-5 w-5" />}
          title="更换邮箱"
          value={`当前邮箱：${formatAccountValue(account?.primaryEmail)}`}
          description="用于登录、通知和账号找回。更新前需要验证新邮箱验证码。"
          actionText="选择"
          onClick={() => beginAction('email')}
          disabled={mutationInProgress}
        />
        <TaskCard
          icon={<Phone className="h-5 w-5" />}
          title={account?.primaryPhone ? '更换手机号' : '绑定手机号'}
          value={`当前手机号：${formatAccountPhoneValue(account?.primaryPhone)}`}
          description="用于短信验证和账号恢复。更新前需要验证新手机号验证码。"
          actionText="选择"
          onClick={() => beginAction('phone')}
          disabled={mutationInProgress}
        />
        <TaskCard
          icon={<KeyRound className="h-5 w-5" />}
          title="更改密码"
          value="建议使用至少 8 位的强密码"
          description="先完成二次验证，再输入并确认新密码。"
          actionText="选择"
          onClick={() => beginAction('password')}
          disabled={mutationInProgress}
        />
      </div>
    </div>
  );

  const renderVerificationStep = () => (
    <div className={`${PANEL_CLASS} relative`}>
      <div className="pr-20 sm:pr-24">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">二次验证</p>
          <h3 className="mt-1 text-lg font-semibold text-white">{actionTitle}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            为了保护账号安全，请先验证当前账号归属。当前密码优先，也可使用验证码。
          </p>
        </div>
      </div>
      <button
        className={`${SECONDARY_BUTTON_CLASS} absolute right-3 top-3 px-2.5 py-1.5 text-xs sm:right-4 sm:top-4 sm:px-3 sm:py-2 sm:text-sm`}
        onClick={returnToSelection}
        type="button"
        disabled={mutationInProgress}
      >
        <ArrowLeft className="h-4 w-4" />
        返回
      </button>

      <div className="mt-5 grid grid-cols-2 rounded-lg border border-slate-800 bg-slate-950/80 p-1">
        <button
          className={`rounded-md px-3 py-2 text-sm font-medium transition ${
            identityMethod === 'password' ? 'bg-cyan-400 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
          }`}
          onClick={() => setIdentityMethod('password')}
          type="button"
          disabled={mutationInProgress}
        >
          当前密码
        </button>
        <button
          className={`rounded-md px-3 py-2 text-sm font-medium transition ${
            identityMethod === 'code' ? 'bg-cyan-400 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
          }`}
          onClick={() => setIdentityMethod('code')}
          type="button"
          disabled={mutationInProgress}
        >
          验证码
        </button>
      </div>

      {identityMethod === 'password' ? (
        <div
          className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
          data-testid="identity-password-row"
        >
          <div>
            <label className={LABEL_CLASS} htmlFor="identity-password">当前密码</label>
            <input
              id="identity-password"
              className={INPUT_CLASS}
              value={identityPassword}
              onChange={(event) => setIdentityPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="输入当前密码"
            />
          </div>
          <button
            className={`${PRIMARY_BUTTON_CLASS} h-[42px] self-end`}
            disabled={mutationInProgress}
            onClick={verifyIdentityPassword}
            type="button"
          >
            {activeMutation === 'identity-password' ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
            继续
          </button>
        </div>
      ) : (
        <div className="mt-5">
          <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-end">
            <div>
              <label className={LABEL_CLASS} htmlFor="identity-code-type">验证方式</label>
              <select
                id="identity-code-type"
                className={INPUT_CLASS}
                value={identityIdentifierType}
                onChange={(event) => {
                  const type = event.target.value as LogtoAccountIdentifierType;
                  setIdentityIdentifierType(type);
                  setIdentityIdentifierValue(type === 'email'
                    ? account?.primaryEmail || ''
                    : account?.primaryPhone || '');
                  setIdentityCodeRecord(null);
                  setIdentityCode('');
                }}
                disabled={mutationInProgress}
              >
                <option value="email" disabled={!canUseEmailCode}>邮箱</option>
                <option value="phone" disabled={!canUsePhoneCode}>手机号</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="identity-code">验证码</label>
              <div className="relative">
                <input
                  id="identity-code"
                  className={INPUT_CLASS}
                  style={{ paddingRight: '7.75rem' }}
                  value={identityCode}
                  onChange={(event) => setIdentityCode(event.target.value)}
                  type="text"
                  inputMode="numeric"
                  placeholder="输入验证码"
                />
                <button
                  className="absolute right-1 top-1/2 inline-flex -translate-y-1/2 items-center justify-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={mutationInProgress || verificationCodeCooldowns.identity > 0}
                  onClick={sendIdentityCode}
                  type="button"
                >
                  {activeMutation === 'identity-send-code' ? <Spinner /> : <Send className="h-3.5 w-3.5" />}
                  {getCodeCooldownButtonText('发送验证码', verificationCodeCooldowns.identity)}
                </button>
              </div>
            </div>
            <button className={`${PRIMARY_BUTTON_CLASS} h-[42px] self-end`} disabled={mutationInProgress} onClick={verifyIdentityCode} type="button">
              {activeMutation === 'identity-verify-code' ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
              继续
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderEmailUpdate = () => (
    <div className={PANEL_CLASS}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">填写并更新</p>
          <h3 className="mt-1 text-lg font-semibold text-white">更换邮箱</h3>
          <p className="mt-2 text-sm text-slate-400">当前邮箱：{formatAccountValue(account?.primaryEmail)}</p>
        </div>
        <button className={SECONDARY_BUTTON_CLASS} onClick={() => setFlowStep('verify')} type="button" disabled={mutationInProgress}>
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>
      </div>

      <div className="mt-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <label className={LABEL_CLASS} htmlFor="new-email">新邮箱</label>
            <input
              id="new-email"
              className={INPUT_CLASS}
              value={newEmail}
              onChange={(event) => {
                setNewEmail(event.target.value);
                setNewEmailRecord(null);
                setNewEmailVerifiedRecord(null);
                setNewEmailCode('');
              }}
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              disabled={mutationInProgress}
            />
          </div>
          <div className="flex items-end">
            <button
              className={`${SECONDARY_BUTTON_CLASS} w-full sm:w-auto`}
              disabled={mutationInProgress || verificationCodeCooldowns.email > 0}
              onClick={sendNewEmailCode}
              type="button"
            >
              {activeMutation === 'email-send-code' ? <Spinner /> : <Send className="h-4 w-4" />}
              {getCodeCooldownButtonText('发送验证码', verificationCodeCooldowns.email)}
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            className={INPUT_CLASS}
            value={newEmailCode}
            onChange={(event) => setNewEmailCode(event.target.value)}
            placeholder="新邮箱验证码"
            type="text"
            inputMode="numeric"
            disabled={mutationInProgress}
          />
          <button className={`${PRIMARY_BUTTON_CLASS} w-full sm:w-auto`} disabled={mutationInProgress} onClick={updateEmailWithCode} type="button">
            {activeMutation === 'email-update' ? <Spinner /> : <Mail className="h-4 w-4" />}
            确认更新
          </button>
        </div>
      </div>
    </div>
  );

  const renderPhoneUpdate = () => (
    <div className={PANEL_CLASS}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">填写并更新</p>
          <h3 className="mt-1 text-lg font-semibold text-white">{account?.primaryPhone ? '更换手机号' : '绑定手机号'}</h3>
          <p className="mt-2 text-sm text-slate-400">当前手机号：{formatAccountPhoneValue(account?.primaryPhone)}</p>
        </div>
        <button className={SECONDARY_BUTTON_CLASS} onClick={() => setFlowStep('verify')} type="button" disabled={mutationInProgress}>
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>
      </div>

      <div className="mt-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <label className={LABEL_CLASS} htmlFor="new-phone">新手机号</label>
            <input
              id="new-phone"
              className={INPUT_CLASS}
              value={newPhone}
              onChange={(event) => {
                setNewPhone(event.target.value);
                setNewPhoneRecord(null);
                setNewPhoneVerifiedRecord(null);
                setNewPhoneCode('');
              }}
              type="tel"
              autoComplete="tel"
              placeholder="新手机号"
              disabled={mutationInProgress}
            />
          </div>
          <div className="flex items-end">
            <button
              className={`${SECONDARY_BUTTON_CLASS} w-full sm:w-auto`}
              disabled={mutationInProgress || verificationCodeCooldowns.phone > 0}
              onClick={sendNewPhoneCode}
              type="button"
            >
              {activeMutation === 'phone-send-code' ? <Spinner /> : <Send className="h-4 w-4" />}
              {getCodeCooldownButtonText('发送验证码', verificationCodeCooldowns.phone)}
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            className={INPUT_CLASS}
            value={newPhoneCode}
            onChange={(event) => setNewPhoneCode(event.target.value)}
            placeholder="新手机号验证码"
            type="text"
            inputMode="numeric"
            disabled={mutationInProgress}
          />
          <button className={`${PRIMARY_BUTTON_CLASS} w-full sm:w-auto`} disabled={mutationInProgress} onClick={updatePhoneWithCode} type="button">
            {activeMutation === 'phone-update' ? <Spinner /> : <Phone className="h-4 w-4" />}
            确认更新
          </button>
        </div>
      </div>
    </div>
  );

  const renderPasswordUpdate = () => (
    <div className={PANEL_CLASS}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">填写并更新</p>
          <h3 className="mt-1 text-lg font-semibold text-white">更改密码</h3>
          <p className="mt-2 text-sm text-slate-400">新密码至少 8 位，请避免重复使用旧密码。</p>
        </div>
        <button className={SECONDARY_BUTTON_CLASS} onClick={() => setFlowStep('verify')} type="button" disabled={mutationInProgress}>
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>
      </div>

      <div className="mt-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLASS} htmlFor="new-password">新密码</label>
            <input
              id="new-password"
              className={INPUT_CLASS}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              placeholder="至少 8 位"
              disabled={mutationInProgress}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="confirm-password">确认新密码</label>
            <input
              id="confirm-password"
              className={INPUT_CLASS}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              placeholder="再次输入新密码"
              disabled={mutationInProgress}
            />
          </div>
        </div>
        <button className={`${PRIMARY_BUTTON_CLASS} w-full sm:w-auto`} disabled={mutationInProgress} onClick={updateAccountPassword} type="button">
          {activeMutation === 'password-update' ? <Spinner /> : <KeyRound className="h-4 w-4" />}
          确认更新密码
        </button>
      </div>
    </div>
  );

  const renderUpdateStep = () => {
    if (activeAction === 'email') {
      return renderEmailUpdate();
    }
    if (activeAction === 'phone') {
      return renderPhoneUpdate();
    }
    if (activeAction === 'password') {
      return renderPasswordUpdate();
    }
    return renderSelectionStep();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-3 pb-[max(12px,env(safe-area-inset-bottom,0px))] pt-[max(12px,env(safe-area-inset-top,0px))] backdrop-blur-sm sm:px-4 sm:py-6"
      onMouseDown={closeAccountManagement}
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-management-title"
    >
      <div
        className="flex max-h-[calc(100dvh_-_env(safe-area-inset-top,0px)_-_env(safe-area-inset-bottom,0px)_-_24px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-slate-100 shadow-2xl shadow-slate-950/70 sm:max-h-[92vh]"
        onMouseDown={(event) => event.stopPropagation()}
        tabIndex={-1}
      >
        <div className="border-b border-slate-800 px-3 py-3 sm:px-5 sm:py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h2 id="account-management-title" className="text-lg font-semibold">
                  账号管理
                </h2>
                <VerificationBadge record={identityVerification} />
              </div>
              <p className="mt-1 text-sm text-slate-400">选择要更新的信息，再完成二次验证和更新。</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                ref={closeButtonRef}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
                onClick={closeAccountManagement}
                type="button"
                aria-label="关闭账号管理"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:mt-4 sm:gap-2">
            <AccountSummaryItem label="邮箱" value={account?.primaryEmail} />
            <AccountSummaryItem label="手机号" value={formatAccountPhoneValue(account?.primaryPhone)} />
          </div>
          <div className="mt-3 sm:mt-4">
            <StepRail currentStep={flowStep} onSelectStep={handleStepSelect} disabled={mutationInProgress} />
          </div>
        </div>

        <div className="min-h-0 touch-pan-y overflow-y-auto overscroll-contain px-3 pb-[calc(env(safe-area-inset-bottom,0px)_+_12px)] pt-3 [-webkit-overflow-scrolling:touch] sm:p-5">
          {error ? (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200">
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">
              {success}
            </div>
          ) : null}
          {isLoading ? (
            <div className="flex min-h-72 items-center justify-center text-slate-400">
              <Spinner />
              <span className="ml-2 text-sm">加载账号信息...</span>
            </div>
          ) : (
            <div>
              {flowStep === 'select' ? renderSelectionStep() : null}
              {flowStep === 'verify' ? renderVerificationStep() : null}
              {flowStep === 'update' ? renderUpdateStep() : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountManagementModal;
