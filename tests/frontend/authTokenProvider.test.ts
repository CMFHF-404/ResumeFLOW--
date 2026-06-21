import {
    createLogtoAuthSessionRefresher,
    resolveUsableAuthToken,
} from '../../services/authTokenProvider.ts';

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

const nowInSeconds = 2_000_000_000;
const expiredToken = buildJwt({ sub: 'user-1', exp: nowInSeconds - 1 });
const freshToken = buildJwt({ sub: 'user-1', exp: nowInSeconds + 120 });

{
    let refreshCalls = 0;
    const resolvedToken = await resolveUsableAuthToken(
        async () => freshToken,
        async () => {
            refreshCalls += 1;
        },
        nowInSeconds
    );

    assert(resolvedToken === freshToken, 'returns a currently usable token');
    assert(refreshCalls === 0, 'does not refresh when the ID token is still usable');
}

{
    let refreshCalls = 0;
    let readCalls = 0;
    const resolvedToken = await resolveUsableAuthToken(
        async () => {
            readCalls += 1;
            return readCalls === 1 ? expiredToken : freshToken;
        },
        async () => {
            refreshCalls += 1;
        },
        nowInSeconds
    );

    assert(resolvedToken === freshToken, 'returns the refreshed ID token');
    assert(refreshCalls === 1, 'refreshes once when the ID token is expired');
    assert(readCalls === 2, 're-reads the ID token after refreshing the Logto session');
}

{
    const resolvedToken = await resolveUsableAuthToken(
        async () => expiredToken,
        null,
        nowInSeconds
    );

    assert(resolvedToken === null, 'does not return an expired token without a refresh path');
}

{
    const calls: string[] = [];
    const refreshAuthSession = createLogtoAuthSessionRefresher(
        async () => {
            calls.push('clear');
        },
        async () => {
            calls.push('refresh');
        }
    );

    assert(refreshAuthSession, 'creates a Logto session refresher when refresh is available');
    await refreshAuthSession();
    assert(
        calls.join(',') === 'clear,refresh',
        'clears cached access tokens before requesting a refreshed Logto token'
    );
}

{
    const refreshAuthSession = createLogtoAuthSessionRefresher(null, null);
    assert(refreshAuthSession === null, 'does not create a refresher without getAccessToken');
}
