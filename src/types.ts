// ── LRCLIB API types ──
export interface TrackSearchResult {
    id: number;
    track_name: string;
    artist_name: string;
    album_name: string;
    duration: number; // seconds
    has_synced_lyrics: boolean;
    has_plain_lyrics: boolean;
}

// ── Lyrics types ──
export interface SyncedLine {
    time: number; // seconds from start
    text: string;
}

export interface LyricsData {
    trackId: number;
    trackName: string;
    artistName: string;
    duration: number;
    synced: boolean;
    lines: SyncedLine[];
    rawText: string;
}

// ── Word-level types for the typing engine ──
export interface WordSegment {
    word: string;
    lineIndex: number;
    wordIndex: number;
    globalIndex: number;
    startTime: number; // seconds
    endTime: number;   // seconds
    duration: number;  // seconds
}

// ── Typing state ──
export type CharState = 'correct' | 'incorrect' | 'current' | 'pending';

export interface WordState {
    segment: WordSegment;
    chars: CharState[];
    typedChars: string;
    startedAt: number | null;   // ms timestamp
    completedAt: number | null; // ms timestamp
    completed: boolean;
    correct: boolean;
}

export type TypingMode = 'structured';

// ── Timer options ──
export type TimerOption = 30 | 60 | 120 | 'full';

export interface TypingStats {
    wpm: number;
    rollingWpm: number;
    accuracy: number;
    tempoStability: number;
    wordsCompleted: number;
    totalWords: number;
    correctWords: number;
    elapsedMs: number;
    wpmHistory: { time: number; wpm: number; raw: number }[];
}

// ── Session result ──
export interface SessionResult {
    trackName: string;
    artistName: string;
    mode: TypingMode;
    avgWpm: number;
    accuracy: number;
    tempoStability: number;
    wordsCompleted: number;
    totalWords: number;
    correctWords: number;
    elapsedMs: number;
    timestamp: number;
    timerOption: TimerOption;
    wpmHistory: { time: number; wpm: number; raw: number }[];
    characters: { correct: number; incorrect: number; extra: number; missed: number };
}

// ── Analytics ──
export interface AnalyticsEvent {
    type: 'session_complete' | 'mode_select' | 'song_select' | 'replay';
    data: Record<string, unknown>;
    timestamp: number;
}

// ── App State ──
export type AppScreen = 'typing' | 'results';
