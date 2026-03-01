import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrackSearchResult, LyricsData, TypingMode, TimerOption, SessionResult } from './types';
import { buildWordSegments } from './engine/lyricsParser';
import { cleanAllLyrics } from './engine/lyricsCleaner';
import { useTypingEngine } from './engine/useTypingEngine';
import { AudioEngine } from './engine/AudioEngine';
import { useAuth } from './auth/useAuth';
import { useSpotifyPlayer } from './engine/useSpotifyPlayer';
import ResultsScreen from './screens/ResultsScreen';

const DEFAULT_SONG_QUERY = 'Bohemian Rhapsody Queen';
const TIMER_OPTIONS: { label: string; value: TimerOption }[] = [
    { label: '30', value: 30 },
    { label: '60', value: 60 },
    { label: '120', value: 120 },
    { label: 'full', value: 'full' },
];

const C = {
    bg: '#323437',
    sub: '#646669',
    text: '#d1d0c5',
    error: '#ca4754',
    accent: '#e2b714',
    card: '#2c2e31',
    border: '#3a3c3f',
};

export default function App() {
    const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth();
    const spotify = useSpotifyPlayer();

    const [screen, setScreen] = useState<'typing' | 'results'>('typing');
    const [lyrics, setLyrics] = useState<LyricsData | null>(null);
    const [currentTrack, setCurrentTrack] = useState<{ name: string; artist: string; id?: number } | null>(null);
    const [mode, setMode] = useState<TypingMode>('flow');
    const [timerOption, setTimerOption] = useState<TimerOption>(30);
    const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
    const [spotifyNudge, setSpotifyNudge] = useState(false);

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<TrackSearchResult[]>([]);
    const [showResults, setShowResults] = useState(false);
    const [searching, setSearching] = useState(false);
    const [loadingLyrics, setLoadingLyrics] = useState(false);

    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
    const timerRef = useRef<ReturnType<typeof setInterval>>();
    const audioEngineRef = useRef<AudioEngine | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const words = useMemo(() => {
        if (!lyrics) return [];
        const cleaned = cleanAllLyrics(lyrics.lines);
        const duration = lyrics.duration || 180;
        return buildWordSegments(cleaned, duration);
    }, [lyrics]);

    const {
        wordStates, currentWordIndex, currentCharIndex,
        stats, isComplete, isStarted, handleKeyDown, reset: resetTyping,
    } = useTypingEngine({
        words, mode,
        onWordComplete: (idx, duration, correct) => {
            if (mode === 'flow' && audioEngineRef.current && correct) {
                const nextWord = words[idx + 1];
                if (nextWord) audioEngineRef.current.playWordSegment(nextWord, duration);
            }
        },
        onSessionComplete: (finalStats) => {
            setSessionResult({
                trackName: currentTrack?.name || 'Unknown',
                artistName: currentTrack?.artist || 'Unknown',
                mode, avgWpm: finalStats.wpm, accuracy: finalStats.accuracy,
                tempoStability: finalStats.tempoStability, wordsCompleted: finalStats.wordsCompleted,
                totalWords: finalStats.totalWords, correctWords: finalStats.correctWords,
                elapsedMs: finalStats.elapsedMs, timestamp: Date.now(), timerOption,
            });
            setScreen('results');
        },
    });

    // Timer
    useEffect(() => {
        if (isStarted && timerOption !== 'full' && timeRemaining === null) setTimeRemaining(timerOption);
    }, [isStarted, timerOption, timeRemaining]);

    useEffect(() => {
        if (timeRemaining !== null && timeRemaining > 0) {
            timerRef.current = setInterval(() => {
                setTimeRemaining(prev => {
                    if (prev === null || prev <= 1) {
                        clearInterval(timerRef.current);
                        setSessionResult({
                            trackName: currentTrack?.name || 'Unknown', artistName: currentTrack?.artist || 'Unknown',
                            mode, avgWpm: stats.wpm, accuracy: stats.accuracy, tempoStability: stats.tempoStability,
                            wordsCompleted: stats.wordsCompleted, totalWords: stats.totalWords,
                            correctWords: stats.correctWords, elapsedMs: stats.elapsedMs,
                            timestamp: Date.now(), timerOption,
                        });
                        setScreen('results');
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
            return () => clearInterval(timerRef.current);
        }
    }, [timeRemaining]);

    useEffect(() => { loadSong(DEFAULT_SONG_QUERY); }, []);

    useEffect(() => {
        if (screen !== 'typing' || !lyrics) return;
        const handler = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement;
            if (t.tagName === 'INPUT') return;
            e.preventDefault();
            handleKeyDown(e);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [screen, lyrics, handleKeyDown]);

    useEffect(() => {
        if (audioFile && mode === 'flow') {
            const engine = new AudioEngine();
            const reader = new FileReader();
            reader.onload = async (e) => {
                const buffer = e.target?.result as ArrayBuffer;
                await engine.loadBuffer(buffer);
                audioEngineRef.current = engine;
            };
            reader.readAsArrayBuffer(audioFile);
            return () => engine.destroy();
        }
    }, [audioFile, mode]);

    // Auto-play Spotify when song changes
    useEffect(() => {
        if (spotify.state.connected && spotify.state.deviceId && currentTrack) {
            spotify.searchTrack(currentTrack.name, currentTrack.artist).then(uri => {
                if (uri) spotify.play(uri);
            });
        }
    }, [currentTrack, spotify.state.connected, spotify.state.deviceId]);

    const handleSearchInput = useCallback((value: string) => {
        setSearchQuery(value);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        if (value.trim().length < 2) { setSearchResults([]); setShowResults(false); return; }
        setSearching(true);
        searchTimeoutRef.current = setTimeout(async () => {
            try {
                const res = await fetch(`/api/search?q=${encodeURIComponent(value.trim())}`);
                if (res.ok) {
                    const data = await res.json();
                    const tracks: TrackSearchResult[] = data.tracks || [];
                    tracks.sort((a, b) => (a.has_synced_lyrics && !b.has_synced_lyrics ? -1 : !a.has_synced_lyrics && b.has_synced_lyrics ? 1 : 0));
                    setSearchResults(tracks.slice(0, 8));
                    setShowResults(true);
                }
            } catch { }
            setSearching(false);
        }, 300);
    }, []);

    const loadSong = useCallback(async (query: string, trackId?: number) => {
        setLoadingLyrics(true);
        try {
            let id = trackId;
            let trackInfo: { name: string; artist: string; id?: number } | null = null;
            if (!id) {
                const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                if (!res.ok) throw new Error('search failed');
                const data = await res.json();
                const tracks: TrackSearchResult[] = data.tracks || [];
                const best = tracks.find(t => t.has_synced_lyrics) || tracks[0];
                if (!best) throw new Error('no results');
                id = best.id; trackInfo = { name: best.track_name, artist: best.artist_name, id: best.id };
            }
            const lyricsRes = await fetch(`/api/lyrics/${id}`);
            if (!lyricsRes.ok) throw new Error('lyrics fetch failed');
            const lyricsData: LyricsData = await lyricsRes.json();
            setLyrics(lyricsData);
            if (trackInfo) setCurrentTrack(trackInfo);
            else setCurrentTrack({ name: lyricsData.trackName, artist: lyricsData.artistName, id });
        } catch (err) { console.error('Failed to load song:', err); }
        setLoadingLyrics(false);
    }, []);

    const selectTrack = useCallback((track: TrackSearchResult) => {
        setCurrentTrack({ name: track.track_name, artist: track.artist_name, id: track.id });
        setShowResults(false); setSearchQuery(''); setTimeRemaining(null);
        loadSong(track.track_name, track.id);
    }, [loadSong]);

    const handleRestart = useCallback(() => {
        resetTyping(); setTimeRemaining(null); setScreen('typing');
    }, [resetTyping]);

    const handleNewSong = useCallback(() => {
        setScreen('typing'); setTimeRemaining(null); resetTyping(); searchInputRef.current?.focus();
    }, [resetTyping]);

    const handleSpotifyClick = useCallback(() => {
        if (spotify.state.connected) {
            // Toggle play/pause
            if (spotify.state.playing) spotify.pause();
            else {
                if (currentTrack) {
                    spotify.searchTrack(currentTrack.name, currentTrack.artist).then(uri => {
                        if (uri) spotify.play(uri);
                        else spotify.resume();
                    });
                } else spotify.resume();
            }
        } else {
            // Not connected — show nudge
            setSpotifyNudge(true);
            setTimeout(() => setSpotifyNudge(false), 4000);
        }
    }, [spotify, currentTrack]);

    const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

    // Results
    if (screen === 'results' && sessionResult) {
        return (
            <ResultsScreen
                result={sessionResult}
                onReplay={handleRestart}
                onNewSong={handleNewSong}
                onSwitchMode={() => { setMode(m => m === 'flow' ? 'structured' : 'flow'); handleRestart(); }}
            />
        );
    }

    return (
        <div className="min-h-screen flex flex-col" style={{ background: C.bg, color: C.text, fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>

            {/* Header */}
            <header className="flex items-center justify-between px-8 py-5">
                <h1 onClick={handleNewSong} className="text-2xl font-bold cursor-pointer tracking-tight" style={{ color: C.accent }}>
                    lyritype
                </h1>
                <div className="flex items-center gap-3">
                    {/* Spotify play/pause */}
                    <div className="relative">
                        <button
                            onClick={handleSpotifyClick}
                            className="text-xs px-3 py-1.5 rounded transition-all flex items-center gap-1"
                            style={{
                                background: spotify.state.connected ? (spotify.state.playing ? '#1DB954' : C.card) : 'transparent',
                                color: spotify.state.connected ? (spotify.state.playing ? '#fff' : '#1DB954') : '#1DB954',
                                border: spotify.state.connected ? 'none' : '1px solid #1DB95440',
                            }}
                        >
                            {spotify.state.connected
                                ? (spotify.state.playing ? '⏸ pause' : '▶ play')
                                : '▶ Spotify'
                            }
                        </button>
                        {/* Nudge tooltip */}
                        <AnimatePresence>
                            {spotifyNudge && (
                                <motion.div
                                    initial={{ opacity: 0, y: -4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -4 }}
                                    className="absolute top-full right-0 mt-2 w-64 p-3 rounded text-xs z-50"
                                    style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
                                >
                                    <p className="mb-2">Connect your Spotify account to play music while typing.</p>
                                    <a
                                        href="http://127.0.0.1:3001/auth/spotify"
                                        className="px-3 py-1.5 rounded inline-block no-underline text-center w-full"
                                        style={{ background: '#1DB954', color: '#fff' }}
                                    >
                                        Connect Spotify
                                    </a>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Spotify now-playing mini */}
                    {spotify.state.connected && spotify.state.playing && spotify.state.trackName && (
                        <span className="text-[10px] max-w-[120px] truncate" style={{ color: C.sub }}>
                            {spotify.state.trackName}
                        </span>
                    )}

                    {/* Auth */}
                    {authLoading ? null : user ? (
                        <div className="flex items-center gap-2">
                            {user.photoURL && <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full" />}
                            <button onClick={signOut} className="text-xs" style={{ color: C.sub }}>sign out</button>
                        </div>
                    ) : (
                        <button onClick={signInWithGoogle} className="text-xs px-3 py-1.5 rounded" style={{ background: '#fff', color: '#333' }}>sign in</button>
                    )}
                </div>
            </header>

            {/* Options bar */}
            <div className="flex items-center justify-center gap-4 px-8 py-3">
                <div className="flex items-center gap-2 text-sm">
                    {(['flow', 'structured'] as TypingMode[]).map(m => (
                        <button key={m} onClick={() => { setMode(m); handleRestart(); }}
                            className="px-3 py-1 rounded transition-colors"
                            style={{ background: mode === m ? C.card : 'transparent', color: mode === m ? C.accent : C.sub }}>
                            {m === 'flow' ? '⚡ flow' : '♫ lyrics'}
                        </button>
                    ))}
                </div>
                <span style={{ color: C.border }}>|</span>
                <div className="flex items-center gap-1 text-sm">
                    {TIMER_OPTIONS.map(opt => (
                        <button key={String(opt.value)} onClick={() => { setTimerOption(opt.value); handleRestart(); }}
                            className="px-3 py-1 rounded transition-colors"
                            style={{ background: timerOption === opt.value ? C.card : 'transparent', color: timerOption === opt.value ? C.accent : C.sub }}>
                            {opt.label}
                        </button>
                    ))}
                </div>
                <span style={{ color: C.border }}>|</span>
                <div className="relative">
                    <input ref={searchInputRef} type="text" value={searchQuery}
                        onChange={e => handleSearchInput(e.target.value)}
                        onFocus={() => searchResults.length > 0 && setShowResults(true)}
                        onBlur={() => setTimeout(() => setShowResults(false), 200)}
                        placeholder="search song..." className="px-3 py-1.5 rounded text-sm outline-none w-48"
                        style={{ background: C.card, color: C.text, border: 'none' }}
                    />
                    {searching && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: C.sub }}>...</span>}
                    <AnimatePresence>
                        {showResults && searchResults.length > 0 && (
                            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                                className="absolute top-full left-0 mt-1 w-80 rounded overflow-hidden z-50"
                                style={{ background: C.card, border: `1px solid ${C.border}` }}>
                                {searchResults.map(track => (
                                    <button key={track.id} onMouseDown={() => selectTrack(track)}
                                        className="w-full px-3 py-2.5 text-left flex items-center justify-between transition-colors"
                                        style={{ borderBottom: `1px solid ${C.border}` }}
                                        onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium truncate" style={{ color: C.text }}>{track.track_name}</p>
                                            <p className="text-xs truncate" style={{ color: C.sub }}>{track.artist_name}{track.album_name && ` · ${track.album_name}`}</p>
                                        </div>
                                        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                                            {track.has_synced_lyrics && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: C.bg, color: C.accent }}>synced</span>}
                                            {track.duration > 0 && <span className="text-xs" style={{ color: C.sub }}>{formatTime(track.duration)}</span>}
                                        </div>
                                    </button>
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                {mode === 'flow' && (
                    <div className="relative group">
                        <button onClick={() => audioFile ? undefined : fileInputRef.current?.click()}
                            className="text-xs px-3 py-1.5 rounded transition-colors"
                            style={{ background: audioFile ? C.card : 'transparent', color: audioFile ? C.accent : C.sub, border: audioFile ? 'none' : `1px solid ${C.border}` }}>
                            {audioFile ? `♫ ${audioFile.name.slice(0, 18)}` : '♫ mp3'}
                        </button>
                        {audioFile && (
                            <button onClick={() => { if (confirm('Remove uploaded audio?')) { setAudioFile(null); audioEngineRef.current?.destroy(); audioEngineRef.current = null; } }}
                                className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px] leading-none"
                                style={{ background: C.error, color: '#fff' }}>×</button>
                        )}
                        <input ref={fileInputRef} type="file" accept="audio/*"
                            onChange={e => { const f = e.target.files?.[0]; if (f?.type.startsWith('audio/')) setAudioFile(f); }} className="hidden" />
                    </div>
                )}
            </div>

            {/* Main typing area */}
            <main className="flex-1 flex flex-col items-center justify-center px-8 py-6">
                {currentTrack && (
                    <p className="text-xs mb-6" style={{ color: C.sub }}>{currentTrack.name} — {currentTrack.artist}</p>
                )}
                <div className="flex items-center gap-6 mb-6">
                    {timerOption !== 'full' && (
                        <span className="text-3xl font-bold" style={{ color: C.accent }}>
                            {timeRemaining !== null ? formatTime(timeRemaining) : formatTime(timerOption as number)}
                        </span>
                    )}
                    {isStarted && (
                        <>
                            <span className="text-lg" style={{ color: C.text }}>{stats.wpm} <span className="text-xs" style={{ color: C.sub }}>wpm</span></span>
                            <span className="text-lg" style={{ color: C.text }}>{stats.accuracy}% <span className="text-xs" style={{ color: C.sub }}>acc</span></span>
                        </>
                    )}
                </div>

                {loadingLyrics ? (
                    <p className="text-sm" style={{ color: C.sub }}>loading lyrics...</p>
                ) : words.length > 0 ? (
                    <TypingRenderer
                        wordStates={wordStates}
                        currentWordIndex={currentWordIndex}
                        currentCharIndex={currentCharIndex}
                        mode={mode}
                    />
                ) : (
                    <p className="text-sm" style={{ color: C.sub }}>no lyrics loaded</p>
                )}

                <button onClick={handleRestart}
                    className="mt-8 text-lg transition-opacity hover:opacity-100"
                    style={{ color: C.sub, opacity: 0.5 }} title="Restart (Tab + Enter)">
                    ↻
                </button>
            </main>

            {/* Footer */}
            <footer className="px-8 py-4 flex items-center justify-center gap-4">
                <KeyBadge keys={['tab']} /> <span style={{ color: C.sub }}>+</span>
                <KeyBadge keys={['enter']} />
                <span className="text-xs" style={{ color: C.sub }}>— restart</span>
                <span className="mx-2" style={{ color: C.border }}>|</span>
                <KeyBadge keys={['space']} />
                <span className="text-xs" style={{ color: C.sub }}>— next word</span>
            </footer>

            <KeyboardShortcuts onRestart={handleRestart} />
        </div>
    );
}

function KeyBadge({ keys }: { keys: string[] }) {
    return (
        <span className="flex gap-1">
            {keys.map(k => (
                <span key={k} className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: C.card, color: C.sub, border: `1px solid ${C.border}` }}>{k}</span>
            ))}
        </span>
    );
}

// ── Typing Renderer: 4-5 lines visible, last faded, smooth cursor ──
function TypingRenderer({
    wordStates, currentWordIndex, currentCharIndex, mode,
}: {
    wordStates: import('./types').WordState[];
    currentWordIndex: number;
    currentCharIndex: number;
    mode: TypingMode;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const activeLineRef = useRef<HTMLDivElement>(null);

    // Group words into visual lines
    const lines = useMemo(() => {
        const lineMap: { lineIndex: number; words: typeof wordStates }[] = [];
        let lastLine = -1;
        for (const ws of wordStates) {
            if (ws.segment.lineIndex !== lastLine) {
                lineMap.push({ lineIndex: ws.segment.lineIndex, words: [] });
                lastLine = ws.segment.lineIndex;
            }
            lineMap[lineMap.length - 1].words.push(ws);
        }
        return lineMap;
    }, [wordStates]);

    const currentLine = wordStates[currentWordIndex]?.segment.lineIndex ?? 0;

    // Smooth scroll: keep active line near top of visible area
    useEffect(() => {
        if (activeLineRef.current && containerRef.current) {
            const container = containerRef.current;
            const activeLine = activeLineRef.current;
            const containerRect = container.getBoundingClientRect();
            const lineRect = activeLine.getBoundingClientRect();
            const offset = lineRect.top - containerRect.top;
            // Keep active line in top third
            if (offset > 60 || offset < 0) {
                container.scrollTo({
                    top: container.scrollTop + offset - 20,
                    behavior: 'smooth',
                });
            }
        }
    }, [currentWordIndex]);

    const renderChar = (char: string, ci: number, ws: typeof wordStates[0], isCurrentWord: boolean) => {
        const state = ws.chars[ci];
        // Cursor is at the position the user is about to type
        const isAtCursor = isCurrentWord && ci === currentCharIndex && state === 'current';
        // Also show cursor after last char when all chars typed but waiting for space
        const isAfterLastChar = isCurrentWord && ci === ws.segment.word.length - 1 &&
            currentCharIndex >= ws.segment.word.length && (state === 'correct' || state === 'incorrect');

        let color = C.sub;
        if (state === 'correct') color = C.text;
        if (state === 'incorrect') color = C.error;

        return (
            <span key={ci} className="relative inline-block">
                {isAtCursor && (
                    <motion.span
                        layoutId="cursor"
                        className="absolute left-0 top-[2px] bottom-[2px] w-[2.5px] rounded-full"
                        style={{ background: C.accent }}
                        animate={{ opacity: [1, 0, 1] }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
                    />
                )}
                <span style={{
                    color,
                    background: state === 'incorrect' ? 'rgba(202,71,84,0.15)' : 'transparent',
                    borderRadius: state === 'incorrect' ? '2px' : '0',
                    paddingLeft: isAtCursor ? '4px' : '0',
                    transition: 'color 0.1s ease, padding-left 0.15s ease',
                }}>
                    {char}
                </span>
                {/* Cursor after last char (waiting for space) */}
                {isAfterLastChar && (
                    <motion.span
                        className="absolute right-[-2px] top-[2px] bottom-[2px] w-[2.5px] rounded-full"
                        style={{ background: C.accent }}
                        animate={{ opacity: [1, 0, 1] }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
                    />
                )}
            </span>
        );
    };

    const renderWord = (ws: typeof wordStates[0], idx: number) => {
        const globalIdx = ws.segment.globalIndex;
        const isCurrentWord = globalIdx === currentWordIndex;
        return (
            <span key={idx} className="inline">
                <span className="inline-block">
                    {ws.segment.word.split('').map((ch, ci) => renderChar(ch, ci, ws, isCurrentWord))}
                </span>
                <span style={{ color: '#3a3c3f' }}>{' '}</span>
            </span>
        );
    };

    // Find which lines to show: show lines around the current line
    const currentLineIdx = lines.findIndex(l => l.lineIndex === currentLine);
    const VISIBLE_LINES = 5;
    const startLine = Math.max(0, currentLineIdx - 0); // active line at top
    const endLine = Math.min(lines.length, startLine + VISIBLE_LINES);

    return (
        <div
            ref={containerRef}
            className="w-full overflow-hidden relative"
            style={{ maxWidth: '75%', maxHeight: '280px' }}
        >
            <div className="space-y-3">
                {lines.slice(startLine, endLine).map((line, li) => {
                    const actualIdx = startLine + li;
                    const isCurrent = line.lineIndex === currentLine;
                    const isLast = li === Math.min(VISIBLE_LINES, endLine - startLine) - 1 && !isCurrent;

                    return (
                        <div
                            key={line.lineIndex}
                            ref={isCurrent ? activeLineRef : undefined}
                            className="text-2xl leading-relaxed transition-opacity duration-500"
                            style={{
                                opacity: isCurrent ? 1 : isLast ? 0.15 : actualIdx < currentLineIdx ? 0.3 : 0.5,
                            }}
                        >
                            {line.words.map((ws, wi) => renderWord(ws, wi))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function KeyboardShortcuts({ onRestart }: { onRestart: () => void }) {
    const tabRef = useRef(false);
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === 'Tab') { e.preventDefault(); tabRef.current = true; }
            if (e.key === 'Enter' && tabRef.current) { e.preventDefault(); onRestart(); tabRef.current = false; }
        };
        const up = (e: KeyboardEvent) => { if (e.key === 'Tab') tabRef.current = false; };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    }, [onRestart]);
    return null;
}
