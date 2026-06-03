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
type MutationKey =
  | 'load'
  | 'identity-password'
  | 'identity-send-code'
  | 'identity-verify-code'
  | 'email-send-code'
  | 'email-verify-code'
  | 'email-update'
  | 'phone-send-code'
  | 'phone-verify-code'
  | 'phone-update'
  | 'password-update';

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-700/80 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20';
const LABEL_CLASS = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400';
const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50';
const PANEL_CLASS = 'rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-slate-950/20';

const formatAccountValue = (value?: string | null) => value?.trim() || '未绑定';

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
  <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
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
    <div className="grid gap-2 sm:grid-cols-3">
      {steps.map((step, index) => {
        const isActive = index === activeIndex;
        const isDone = index < activeIndex;
        const canSelect = step.key === 'select' && currentStep !== 'select' && !disabled;
        const className = `flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${
          isActive
            ? 'border-cyan-400/70 bg-cyan-400/10 text-cyan-200'
            : isDone
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
              : 'border-slate-800 bg-slate-950/40 text-slate-500'
        } ${canSelect ? 'hover:border-cyan-400/70 hover:bg-cyan-400/10 hover:text-cyan-200' : ''}`;
        const content = (
          <>
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                isActive
                  ? 'bg-cyan-400 text-slate-950'
                  : isDone
                    ? 'bg-emerald-400 text-slate-950'
                    : 'bg-slate-800 text-slate-500'
              }`}
            >
              {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span>{step.label}</span>
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
    className="group flex w-full items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-left transition hover:border-cyan-400/60 hover:bg-slate-900/90 disabled:cursor-not-allowed disabled:opacity-50"
    onClick={onClick}
    type="button"
    disabled={disabled}
  >
    <span className="flex min-w-0 gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-cyan-200">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-100">{title}</span>
        <span className="mt-1 block truncate text-xs text-slate-400">{value}</span>
        <span className="mt-2 block text-xs leading-5 text-slate-500">{description}</span>
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
  const [isNewEmailVerified, setIsNewEmailVerified] = React.useState(false);
  const [newEmailCode, setNewEmailCode] = React.useState('');

  const [newPhone, setNewPhone] = React.useState('');
  const [newPhoneRecord, setNewPhoneRecord] = React.useState<LogtoVerificationRecord | null>(null);
  const [isNewPhoneVerified, setIsNewPhoneVerified] = React.useState(false);
  const [newPhoneCode, setNewPhoneCode] = React.useState('');

  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [activeMutation, setActiveMutation] = React.useState<MutationKey | null>(null);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const tokenGetter = React.useCallback<LogtoTokenGetter>(async () => {
    if (!getAccessToken) {
      return null;
    }
    return getAccessToken();
  }, [getAccessToken]);

  const closeAndRequireLogin = React.useCallback(() => {
    onClose();
    dispatchLoginRequired('unauthorized');
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
    setIsNewEmailVerified(false);
    setNewEmailCode('');
    setNewPhone('');
    setNewPhoneRecord(null);
    setIsNewPhoneVerified(false);
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
      setAccount(data);
      setIdentityIdentifierType(data.primaryEmail ? 'email' : 'phone');
      setIdentityIdentifierValue(data.primaryEmail || data.primaryPhone || '');
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) {
        closeAndRequireLogin();
        return;
      }
      setError(getErrorMessage(loadError, '账号信息加载失败'));
    } finally {
      setActiveMutation((current) => (current === 'load' ? null : current));
    }
  }, [closeAndRequireLogin, isAuthenticated, isOpen, tokenGetter]);

  React.useEffect(() => {
    if (isOpen && !isAuthenticated) {
      onClose();
    }
  }, [isAuthenticated, isOpen, onClose]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    setAccount(null);
    setActiveAction(null);
    setFlowStep('select');
    resetIdentityChallenge(null);
    resetUpdateFields();
    setError('');
    setSuccess('');
    void refreshAccount();
  }, [isOpen, refreshAccount, resetIdentityChallenge, resetUpdateFields]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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
      setError(getErrorMessage(mutationError, fallback));
    } finally {
      setActiveMutation((current) => (current === key ? null : current));
    }
  };

  const beginAction = (action: AccountAction) => {
    setActiveAction(action);
    setFlowStep('verify');
    setError('');
    setSuccess('');
    resetIdentityChallenge(account);
    resetUpdateFields();
  };

  const returnToSelection = () => {
    setActiveAction(null);
    setFlowStep('select');
    setError('');
    resetIdentityChallenge(account);
    resetUpdateFields();
  };

  const handleStepSelect = (step: FlowStep) => {
    if (step === 'select' && flowStep !== 'select') {
      returnToSelection();
    }
  };

  const finishIdentityVerification = (record: LogtoVerificationRecord) => {
    setIdentityVerification(record);
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

  const sendIdentityCode = () => runMutation(
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

  const sendNewEmailCode = () => runMutation(
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
      setIsNewEmailVerified(false);
      setNewEmailCode('');
      setSuccess('新邮箱验证码已发送');
    },
    '新邮箱验证码发送失败'
  );

  const verifyNewEmailCode = () => runMutation(
    'email-verify-code',
    async () => {
      if (!newEmailRecord) {
        throw new Error('请先获取新邮箱验证码');
      }
      if (!newEmailCode.trim()) {
        throw new Error('请输入新邮箱验证码');
      }
      const record = await logtoAccountService.verifyCode(
        tokenGetter,
        { type: 'email', value: newEmail.trim() },
        newEmailRecord.verificationRecordId,
        newEmailCode.trim()
      );
      setNewEmailRecord(record);
      setIsNewEmailVerified(true);
      setSuccess('新邮箱已验证，可以确认更新');
    },
    '新邮箱验证失败'
  );

  const updateEmail = () => runMutation(
    'email-update',
    async () => {
      const identityVerificationId = requireIdentityVerification();
      if (!identityVerificationId) {
        return;
      }
      if (!newEmailRecord || !isNewEmailVerified) {
        throw new Error('请先验证新邮箱');
      }
      await logtoAccountService.updatePrimaryEmail(
        tokenGetter,
        newEmail.trim(),
        identityVerificationId,
        newEmailRecord.verificationRecordId
      );
      await completeUpdate('邮箱已更新');
    },
    '邮箱更新失败'
  );

  const sendNewPhoneCode = () => runMutation(
    'phone-send-code',
    async () => {
      const phone = newPhone.trim();
      if (!phone) {
        throw new Error('请输入新手机号');
      }
      const record = await logtoAccountService.sendVerificationCode(tokenGetter, {
        type: 'phone',
        value: phone,
      });
      setNewPhoneRecord(record);
      setIsNewPhoneVerified(false);
      setNewPhoneCode('');
      setSuccess('新手机号验证码已发送');
    },
    '新手机号验证码发送失败'
  );

  const verifyNewPhoneCode = () => runMutation(
    'phone-verify-code',
    async () => {
      if (!newPhoneRecord) {
        throw new Error('请先获取新手机号验证码');
      }
      if (!newPhoneCode.trim()) {
        throw new Error('请输入新手机号验证码');
      }
      const record = await logtoAccountService.verifyCode(
        tokenGetter,
        { type: 'phone', value: newPhone.trim() },
        newPhoneRecord.verificationRecordId,
        newPhoneCode.trim()
      );
      setNewPhoneRecord(record);
      setIsNewPhoneVerified(true);
      setSuccess('新手机号已验证，可以确认更新');
    },
    '新手机号验证失败'
  );

  const updatePhone = () => runMutation(
    'phone-update',
    async () => {
      const identityVerificationId = requireIdentityVerification();
      if (!identityVerificationId) {
        return;
      }
      if (!newPhoneRecord || !isNewPhoneVerified) {
        throw new Error('请先验证新手机号');
      }
      await logtoAccountService.updatePrimaryPhone(
        tokenGetter,
        newPhone.trim(),
        identityVerificationId,
        newPhoneRecord.verificationRecordId
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
    <div className="space-y-4">
      <div className="grid gap-3">
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
          value={`当前手机号：${formatAccountValue(account?.primaryPhone)}`}
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
    <div className={PANEL_CLASS}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">二次验证</p>
          <h3 className="mt-1 text-lg font-semibold text-white">{actionTitle}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            为了保护账号安全，请先验证当前账号归属。当前密码优先，也可使用验证码。
          </p>
        </div>
        <button className={SECONDARY_BUTTON_CLASS} onClick={returnToSelection} type="button" disabled={mutationInProgress}>
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>
      </div>

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
                  disabled={mutationInProgress}
                  onClick={sendIdentityCode}
                  type="button"
                >
                  {activeMutation === 'identity-send-code' ? <Spinner /> : <Send className="h-3.5 w-3.5" />}
                  发送验证码
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
                setIsNewEmailVerified(false);
                setNewEmailCode('');
              }}
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              disabled={mutationInProgress}
            />
          </div>
          <div className="flex items-end">
            <button className={SECONDARY_BUTTON_CLASS} disabled={mutationInProgress} onClick={sendNewEmailCode} type="button">
              {activeMutation === 'email-send-code' ? <Spinner /> : <Send className="h-4 w-4" />}
              发送验证码
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input
            className={INPUT_CLASS}
            value={newEmailCode}
            onChange={(event) => setNewEmailCode(event.target.value)}
            placeholder="新邮箱验证码"
            type="text"
            inputMode="numeric"
            disabled={mutationInProgress}
          />
          <button className={SECONDARY_BUTTON_CLASS} disabled={mutationInProgress} onClick={verifyNewEmailCode} type="button">
            {activeMutation === 'email-verify-code' ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
            验证邮箱
          </button>
          <button className={PRIMARY_BUTTON_CLASS} disabled={mutationInProgress} onClick={updateEmail} type="button">
            {activeMutation === 'email-update' ? <Spinner /> : <Mail className="h-4 w-4" />}
            确认更新邮箱
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
          <p className="mt-2 text-sm text-slate-400">当前手机号：{formatAccountValue(account?.primaryPhone)}</p>
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
                setIsNewPhoneVerified(false);
                setNewPhoneCode('');
              }}
              type="tel"
              autoComplete="tel"
              placeholder="输入新手机号"
              disabled={mutationInProgress}
            />
          </div>
          <div className="flex items-end">
            <button className={SECONDARY_BUTTON_CLASS} disabled={mutationInProgress} onClick={sendNewPhoneCode} type="button">
              {activeMutation === 'phone-send-code' ? <Spinner /> : <Send className="h-4 w-4" />}
              发送验证码
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input
            className={INPUT_CLASS}
            value={newPhoneCode}
            onChange={(event) => setNewPhoneCode(event.target.value)}
            placeholder="新手机号验证码"
            type="text"
            inputMode="numeric"
            disabled={mutationInProgress}
          />
          <button className={SECONDARY_BUTTON_CLASS} disabled={mutationInProgress} onClick={verifyNewPhoneCode} type="button">
            {activeMutation === 'phone-verify-code' ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
            验证手机号
          </button>
          <button className={PRIMARY_BUTTON_CLASS} disabled={mutationInProgress} onClick={updatePhone} type="button">
            {activeMutation === 'phone-update' ? <Spinner /> : <Phone className="h-4 w-4" />}
            确认更新手机号
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
        <button className={PRIMARY_BUTTON_CLASS} disabled={mutationInProgress} onClick={updateAccountPassword} type="button">
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-management-title"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-slate-100 shadow-2xl shadow-slate-950/70"
        onMouseDown={(event) => event.stopPropagation()}
        tabIndex={-1}
      >
        <div className="border-b border-slate-800 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id="account-management-title" className="text-lg font-semibold">
                账号管理
              </h2>
              <p className="mt-1 text-sm text-slate-400">选择要更新的信息，再完成二次验证和更新。</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                ref={closeButtonRef}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
                onClick={onClose}
                type="button"
                aria-label="关闭账号管理"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <AccountSummaryItem label="邮箱" value={account?.primaryEmail} />
            <AccountSummaryItem label="手机号" value={account?.primaryPhone} />
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
              <div className="text-xs text-slate-500">二次验证</div>
              <div className="mt-1">
                <VerificationBadge record={identityVerification} />
              </div>
            </div>
          </div>
          <div className="mt-4">
            <StepRail currentStep={flowStep} onSelectStep={handleStepSelect} disabled={mutationInProgress} />
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto p-5">
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
