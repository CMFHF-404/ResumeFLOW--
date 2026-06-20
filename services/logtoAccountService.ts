export type LogtoAccountIdentifierType = 'email' | 'phone';

const CHINA_MAINLAND_PHONE_PATTERN = /^1[3-9]\d{9}$/;

export const normalizeLogtoPhoneIdentifier = (value: string): string => {
    const digits = value.replace(/\D/g, '');
    const nationalPhone = digits.startsWith('86') ? digits.slice(2) : digits;
    if (CHINA_MAINLAND_PHONE_PATTERN.test(nationalPhone)) {
        return `86${nationalPhone}`;
    }

    return digits;
};
