import { apiClient } from './api-client';
import { connectionState, getAuthToken } from './connection';

export async function syncPendingChanges() {
    if (connectionState.mode !== 'local') {
        throw new Error('Sync is started from local mode so pending offline changes can be uploaded safely.');
    }
    if (!connectionState.apiUrl || !getAuthToken()) {
        throw new Error('Configure the API and sign in before syncing.');
    }

    const pending = await window.dbBridge.call('sync', 'pending');
    const cursor = await window.dbBridge.call('sync', 'getCursor');
    const result = await apiClient.sync({ changes: pending, cursor });
    await window.dbBridge.call('sync', 'acknowledge', {
        ids: result.acceptedIds || pending.map((change) => change.id),
        cursor: result.cursor || cursor,
    });

    return {
        uploaded: (result.acceptedIds || []).length,
        conflicts: result.conflicts || [],
        downloaded: (result.changes || []).length,
    };
}
