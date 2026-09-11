import { getApiUrl, getAuthToken, setSession, clearSession } from './connection';

async function request(path, options = {}) {
    const baseUrl = getApiUrl();
    if (!baseUrl) throw new Error('Configure the API URL before using API mode.');

    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}),
            ...(options.headers || {}),
        },
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401) clearSession();
        throw new Error(body.message || body.error || `API request failed (${response.status})`);
    }
    return body.data === undefined ? body : body.data;
}

export const apiClient = {
    call(repository, method, args = []) {
        return request(`/api/rpc/${encodeURIComponent(repository)}/${encodeURIComponent(method)}`, {
            method: 'POST',
            body: JSON.stringify({ args }),
        });
    },

    async login(email, password) {
        const result = await request('/api/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        setSession({ token: result.token, user: result.user || null });
        return result;
    },

    logout() {
        clearSession();
    },

    sync(payload) {
        return request('/api/sync', { method: 'POST', body: JSON.stringify(payload) });
    },
};
