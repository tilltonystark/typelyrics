import { AnalyticsEvent, SessionResult, TypingMode } from '../types';

const STORAGE_KEY = 'lyritype_analytics';
const SESSIONS_KEY = 'lyritype_sessions';

function getStoredEvents(): AnalyticsEvent[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function storeEvent(event: AnalyticsEvent): void {
    const events = getStoredEvents();
    events.push(event);
    // Keep last 200 events
    const trimmed = events.slice(-200);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

export function trackSessionComplete(result: SessionResult): void {
    storeEvent({
        type: 'session_complete',
        data: result as unknown as Record<string, unknown>,
        timestamp: Date.now(),
    });

    // Also store in sessions list
    const sessions = getSessions();
    sessions.push(result);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(-50)));
}

export function trackModeSelect(mode: TypingMode): void {
    storeEvent({
        type: 'mode_select',
        data: { mode },
        timestamp: Date.now(),
    });
}

export function trackSongSelect(trackName: string, artistName: string): void {
    storeEvent({
        type: 'song_select',
        data: { trackName, artistName },
        timestamp: Date.now(),
    });
}

export function trackReplay(): void {
    storeEvent({
        type: 'replay',
        data: {},
        timestamp: Date.now(),
    });
}

export function getSessions(): SessionResult[] {
    try {
        const raw = localStorage.getItem(SESSIONS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

export function getAverageWpm(): number {
    const sessions = getSessions();
    if (sessions.length === 0) return 0;
    return Math.round(sessions.reduce((sum, s) => sum + s.avgWpm, 0) / sessions.length);
}

export function getModePreference(): TypingMode | null {
    return 'structured';
}
