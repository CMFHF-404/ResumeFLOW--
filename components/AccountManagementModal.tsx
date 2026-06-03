import React from 'react';
import { useLogto } from '@logto/react';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Send,
  ShieldCheck,
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

type AccountManagementModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

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
  'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20';
const LABEL_CLASS = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400';
const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50';

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

const Spinner = () => <Loader2 className="h-4 w-4 animate-spin" />;

const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-100">
      <span className="text-cyan-300">{icon}</span>
      <span>{title}</span>
    </div>
    {children}
  </section>
);

const VerificationBadge: React.FC<{ record: LogtoVerificationRecord | null }> = ({ record }) => {
  if (!record) {
    return <span className="text-xs text-amber-300">未验证</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-xs font-medium text-emerald-300">
      <CheckCircle2 className="h-3.5 w-3.5" />
      已验证
    </span>
  );
};

const AccountManagementModal: React.FC<AccountManagementModalProps> = ({ isOpen, onClose }) => {
  const { getAccessToken, isAuthenticated } = useLogto();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  const [account, setAccount] = React.useState<LogtoAccountProfile | null>(null);
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

  const tokenGetter = React.useCallback<LogtoTokenGetter>(async (resource) => {
    if (!getAccessToken) {
      return null;
    }
    return getAccessToken(resource);
  }, [getAccessToken]);

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
      setError(getErrorMessage(loadError, '账号信息加载失败'));
    } finally {
      setActiveMutation((current) => (current === 'load' ? null : current));
    }
  }, [isAuthenticated, isOpen, tokenGetter]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    setAccount(null);
    setIdentityMethod('password');
    setIdentityPassword('');
    setIdentityIdentifierType('email');
    setIdentityIdentifierValue('');
    setIdentityCodeRecord(null);
    setIdentityCode('');
    setIdentityVerification(null);
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
    setError('');
    setSuccess('');
    void refreshAccount();
  }, [isOpen, refreshAccount]);

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
      setError(getErrorMessage(mutationError, fallback));
    } finally {
      setActiveMutation((current) => (current === key ? null : current));
    }
  };

  const requireIdentityVerification = () => {
    if (!identityVerification) {
      setError('请先完成本人验证');
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
      setIdentityVerification(record);
      setIdentityPassword('');
      setSuccess('本人验证已完成');
    },
    '本人验证失败'
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
      setIdentityVerification(record);
      setIdentityCode('');
      setSuccess('本人验证已完成');
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
      setSuccess('新邮箱已验证');
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
      setNewEmail('');
      setNewEmailRecord(null);
      setIsNewEmailVerified(false);
      setNewEmailCode('');
      setSuccess('邮箱已更新');
      await refreshAccount();
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
      setSuccess('新手机号已验证');
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
      setNewPhone('');
      setNewPhoneRecord(null);
      setIsNewPhoneVerified(false);
      setNewPhoneCode('');
      setSuccess('手机号已更新');
      await refreshAccount();
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
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('密码已更新');
    },
    '密码更新失败'
  );

  if (!isOpen) {
    return null;
  }

  const isLoading = activeMutation === 'load';
  const identityDisabled = Boolean(activeMutation);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-management-title"
    >
      <div
        ref={dialogRef}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl shadow-slate-950/70"
        onMouseDown={(event) => event.stopPropagation()}
        tabIndex={-1}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="min-w-0">
            <h2 id="account-management-title" className="text-lg font-semibold">
              账号管理
            </h2>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
              <span>邮箱：{formatAccountValue(account?.primaryEmail)}</span>
              <span>手机号：{formatAccountValue(account?.primaryPhone)}</span>
              <VerificationBadge record={identityVerification} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={SECONDARY_BUTTON_CLASS}
              disabled={Boolean(activeMutation)}
              onClick={refreshAccount}
              type="button"
              aria-label="刷新账号信息"
            >
              {activeMutation === 'load' ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
              <span className="hidden sm:inline">刷新</span>
            </button>
            <button
              ref={closeButtonRef}
              className="rounded-full p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
              onClick={onClose}
              type="button"
              aria-label="关闭账号管理"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto p-5">
          {error ? (
            <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200">
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">
              {success}
            </div>
          ) : null}
          {isLoading ? (
            <div className="flex min-h-72 items-center justify-center text-slate-400">
              <Spinner />
              <span className="ml-2 text-sm">加载账号信息...</span>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <Section title="本人验证" icon={<ShieldCheck className="h-4 w-4" />}>
                <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-950 p-1">
                  <button
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      identityMethod === 'password' ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                    onClick={() => setIdentityMethod('password')}
                    type="button"
                  >
                    当前密码
                  </button>
                  <button
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      identityMethod === 'code' ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                    onClick={() => setIdentityMethod('code')}
                    type="button"
                  >
                    验证码
                  </button>
                </div>

                {identityMethod === 'password' ? (
                  <div className="space-y-3">
                    <div>
                      <label className={LABEL_CLASS} htmlFor="identity-password">当前密码</label>
                      <input
                        id="identity-password"
                        className={INPUT_CLASS}
                        value={identityPassword}
                        onChange={(event) => setIdentityPassword(event.target.value)}
                        type="password"
                        autoComplete="current-password"
                      />
                    </div>
                    <button
                      className={PRIMARY_BUTTON_CLASS}
                      disabled={identityDisabled}
                      onClick={verifyIdentityPassword}
                      type="button"
                    >
                      {activeMutation === 'identity-password' ? <Spinner /> : <ShieldCheck className="h-4 w-4" />}
                      完成本人验证
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                      <div>
                        <label className={LABEL_CLASS} htmlFor="identity-code-type">方式</label>
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
                          }}
                        >
                          <option value="email">邮箱</option>
                          <option value="phone">手机号</option>
                        </select>
                      </div>
                      <div>
                        <label className={LABEL_CLASS} htmlFor="identity-code-value">当前账号</label>
                        <input
                          id="identity-code-value"
                          className={INPUT_CLASS}
                          value={identityIdentifierValue}
                          onChange={(event) => setIdentityIdentifierValue(event.target.value)}
                          type="text"
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div>
                        <label className={LABEL_CLASS} htmlFor="identity-code">验证码</label>
                        <input
                          id="identity-code"
                          className={INPUT_CLASS}
                          value={identityCode}
                          onChange={(event) => setIdentityCode(event.target.value)}
                          type="text"
                          inputMode="numeric"
                        />
                      </div>
                      <div className="flex items-end gap-2">
                        <button className={SECONDARY_BUTTON_CLASS} disabled={identityDisabled} onClick={sendIdentityCode} type="button">
                          {activeMutation === 'identity-send-code' ? <Spinner /> : <Send className="h-4 w-4" />}
                          发送
                        </button>
                        <button className={PRIMARY_BUTTON_CLASS} disabled={identityDisabled} onClick={verifyIdentityCode} type="button">
                          {activeMutation === 'identity-verify-code' ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
                          验证
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </Section>

              <div className="space-y-4">
                <Section title="更换邮箱" icon={<Mail className="h-4 w-4" />}>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
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
                        }}
                        type="email"
                        autoComplete="email"
                      />
                    </div>
                    <div className="flex items-end">
                      <button className={SECONDARY_BUTTON_CLASS} disabled={Boolean(activeMutation)} onClick={sendNewEmailCode} type="button">
                        {activeMutation === 'email-send-code' ? <Spinner /> : <Send className="h-4 w-4" />}
                        发送验证码
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <input
                      className={INPUT_CLASS}
                      value={newEmailCode}
                      onChange={(event) => setNewEmailCode(event.target.value)}
                      placeholder="新邮箱验证码"
                      type="text"
                      inputMode="numeric"
                    />
                    <button className={SECONDARY_BUTTON_CLASS} disabled={Boolean(activeMutation)} onClick={verifyNewEmailCode} type="button">
                      {activeMutation === 'email-verify-code' ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
                      验证邮箱
                    </button>
                    <button className={PRIMARY_BUTTON_CLASS} disabled={Boolean(activeMutation)} onClick={updateEmail} type="button">
                      {activeMutation === 'email-update' ? <Spinner /> : <Mail className="h-4 w-4" />}
                      更新邮箱
                    </button>
                  </div>
                </Section>

                <Section title={account?.primaryPhone ? '更换手机号' : '绑定手机号'} icon={<Phone className="h-4 w-4" />}>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
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
                        }}
                        type="tel"
                        autoComplete="tel"
                      />
                    </div>
                    <div className="flex items-end">
                      <button className={SECONDARY_BUTTON_CLASS} disabled={Boolean(activeMutation)} onClick={sendNewPhoneCode} type="button">
                        {activeMutation === 'phone-send-code' ? <Spinner /> : <Send className="h-4 w-4" />}
                        发送验证码
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <input
                      className={INPUT_CLASS}
                      value={newPhoneCode}
                      onChange={(event) => setNewPhoneCode(event.target.value)}
                      placeholder="新手机号验证码"
                      type="text"
                      inputMode="numeric"
                    />
                    <button className={SECONDARY_BUTTON_CLASS} disabled={Boolean(activeMutation)} onClick={verifyNewPhoneCode} type="button">
                      {activeMutation === 'phone-verify-code' ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
                      验证手机号
                    </button>
                    <button className={PRIMARY_BUTTON_CLASS} disabled={Boolean(activeMutation)} onClick={updatePhone} type="button">
                      {activeMutation === 'phone-update' ? <Spinner /> : <Phone className="h-4 w-4" />}
                      更新手机号
                    </button>
                  </div>
                </Section>

                <Section title="更改密码" icon={<KeyRound className="h-4 w-4" />}>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className={LABEL_CLASS} htmlFor="new-password">新密码</label>
                      <input
                        id="new-password"
                        className={INPUT_CLASS}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        type="password"
                        autoComplete="new-password"
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
                      />
                    </div>
                  </div>
                  <button
                    className={`mt-3 ${PRIMARY_BUTTON_CLASS}`}
                    disabled={Boolean(activeMutation)}
                    onClick={updateAccountPassword}
                    type="button"
                  >
                    {activeMutation === 'password-update' ? <Spinner /> : <KeyRound className="h-4 w-4" />}
                    更新密码
                  </button>
                </Section>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountManagementModal;
