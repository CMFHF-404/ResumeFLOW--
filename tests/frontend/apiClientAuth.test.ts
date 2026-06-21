import {
    isAuthTokenUsable,
    readAuthUserKeyFromToken,
} from '../../services/apiClientAuth.ts';

const assert = (condition: unknown, message: string) => {
    if (!condition) {
        throw new Error(message);
    }
};

const encodeBase64Url = (value: unknown): string => {
    return Buffer.from(JSON.stringify(value), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/u, '');
};

const buildJwt = (payload: unknown): string => {
    return [
        encodeBase64Url({ alg: 'RS256', typ: 'JWT' }),
        encodeBase64Url(payload),
        'signature',
    ].join('.');
};

const token = buildJwt({
    sub: 'user-id-from-id-token',
    aud: 'resume-spa-app-id',
});

assert(
    readAuthUserKeyFromToken(token) === 'user-id-from-id-token',
    'reads the user key from the ID token subject'
);

assert(
    readAuthUserKeyFromToken(buildJwt({ aud: 'resume-spa-app-id' })) === null,
    'returns null when the token has no subject'
);

assert(
    readAuthUserKeyFromToken('not-a-jwt') === null,
    'returns null for malformed tokens'
);

const nowInSeconds = 2_000_000_000;

assert(
    isAuthTokenUsable(buildJwt({ exp: nowInSeconds + 120 }), nowInSeconds),
    'treats a token outside the expiry skew window as usable'
);

assert(
    !isAuthTokenUsable(buildJwt({ exp: nowInSeconds + 10 }), nowInSeconds),
    'treats a token inside the expiry skew window as unusable'
);

assert(
    !isAuthTokenUsable(buildJwt({ exp: nowInSeconds - 1 }), nowInSeconds),
    'treats an expired token as unusable'
);
