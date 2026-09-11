import { reactive } from 'vue';

const STORAGE_KEY = 'erp-connection-settings';

function readSettings() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

const stored = typeof localStorage === 'undefined' ? {} : readSettings();

export const connectionState = reactive({
    mode: stored.mode === 'api' ? 'api' : 'local',
    apiUrl: String(stored.apiUrl || '').replace(/\/$/, ''),
    user: null,
    authenticated: false,
});

export function isApiMode() {
    return connectionState.mode === 'api';
}

export function getApiUrl() {
    return connectionState.apiUrl;
}

export function getAuthToken() {
    return typeof localStorage === 'undefined' ? '' : localStorage.getItem('erp-api-token') || '';
}

export function setConnectionSettings({ mode, apiUrl }) {
    const next = {
        mode: mode === 'api' ? 'api' : 'local',
        apiUrl: String(apiUrl || '').trim().replace(/\/$/, ''),
    };
    Object.assign(connectionState, next, { authenticated: !!getAuthToken() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function setSession({ token, user = null }) {
    if (token) localStorage.setItem('erp-api-token', token);
    else localStorage.removeItem('erp-api-token');
    Object.assign(connectionState, { user, authenticated: !!token });
}

export function clearSession() {
    setSession({ token: '', user: null });
}
