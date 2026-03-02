import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrackSearchResult, LyricsData, TypingMode, TimerOption, SessionResult } from './types';
import { buildWordSegments } from './engine/lyricsParser';
import { cleanAllLyrics } from './engine/lyricsCleaner';
import { useTypingEngine } from './engine/useTypingEngine';
import { useAuth } from './auth/useAuth';
import { useSpotifyPlayer } from './engine/useSpotifyPlayer';
import ResultsScreen from './screens/ResultsScreen';

const DEFAULT_SONGS = [
    'Bohemian Rhapsody Queen',
    'Hotel California Eagles',
    'Imagine John Lennon',
    'Stairway to Heaven Led Zeppelin',
    'Billie Jean Michael Jackson',
    'Yesterday Beatles',
    'Smells Like Teen Spirit Nirvana',
    'Shape of You Ed Sheeran',
    'Blinding Lights The Weeknd',
    'Someone Like You Adele',
    'Rolling in the Deep Adele',
    'Lose Yourself Eminem',
    'Let It Be Beatles',
    'Wonderwall Oasis',
    'Counting Stars OneRepublic',
    'Perfect Ed Sheeran',
    'Viva la Vida Coldplay',
    'Uptown Funk Bruno Mars',
];
const getRandomSong = () => DEFAULT_SONGS[Math.floor(Math.random() * DEFAULT_SONGS.length)];
const TIMER_OPTIONS: { label: string; value: TimerOption }[] = [
    { label: '30', value: 30 },
    { label: '60', value: 60 },
    { label: '120', value: 120 },
    { label: 'full', value: 'full' },
];
const MY_LIST_KEY = 'lyritype_my_list';

const C = {
    bg: '#000000',
    sub: '#646669',
    text: '#d1d0c5',
    error: '#ca4754',
    accent: '#e2b714',
    card: '#111111',
    border: '#2a2a2a',
};

interface SavedTrack {
    id: number;
    track_name: string;
    artist_name: string;
    album_name: string;
    duration: number;
    has_synced_lyrics: boolean;
    has_plain_lyrics: boolean;
}

export default function App() {
    const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth();
    const spotify = useSpotifyPlayer();

    const [screen, setScreen] = useState<'typing' | 'results'>('typing');
    const [lyrics, setLyrics] = useState<LyricsData | null>(null);
    const [currentTrack, setCurrentTrack] = useState<{ name: string; artist: string; id?: number } | null>(null);
    const [timerOption, setTimerOption] = useState<TimerOption>(30);
    const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
    const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
    const [spotifyLoading, setSpotifyLoading] = useState(false);
    const [savedTracks, setSavedTracks] = useState<SavedTrack[]>([]);
    const [showMyList, setShowMyList] = useState(false);

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<TrackSearchResult[]>([]);
    const [showResults, setShowResults] = useState(false);
    const [searching, setSearching] = useState(false);
    const [loadingLyrics, setLoadingLyrics] = useState(false);

    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
    const timerRef = useRef<ReturnType<typeof setInterval>>();
    const searchInputRef = useRef<HTMLInputElement>(null);
    const myListPanelRef = useRef<HTMLDivElement>(null);

    const words = useMemo(() => {
        if (!lyrics) return [];
        const cleaned = cleanAllLyrics(lyrics.lines);
        const duration = lyrics.duration || 180;
        return buildWordSegments(cleaned, duration);
    }, [lyrics]);

    const {
        wordStates, currentWordIndex, currentCharIndex,
        stats, isComplete, isStarted, handleKeyDown, reset: resetTyping, stop: stopTyping,
    } = useTypingEngine({
        words, mode: 'structured',
        onSessionComplete: (finalStats) => {
            // Stop Spotify when session ends
            if (spotify.state.connected && spotify.state.playing) {
                spotify.pause();
            }
            setSessionResult({
                trackName: currentTrack?.name || 'Unknown',
                artistName: currentTrack?.artist || 'Unknown',
                mode: 'structured', avgWpm: finalStats.wpm, accuracy: finalStats.accuracy,
                tempoStability: finalStats.tempoStability, wordsCompleted: finalStats.wordsCompleted,
                totalWords: finalStats.totalWords, correctWords: finalStats.correctWords,
                elapsedMs: finalStats.elapsedMs, timestamp: Date.now(), timerOption,
                wpmHistory: finalStats.wpmHistory,
                characters: { correct: 0, incorrect: 0, extra: 0, missed: 0 },
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
                        // Stop WPM recording and Spotify when timer runs out
                        stopTyping();
                        if (spotify.state.connected && spotify.state.playing) {
                            spotify.pause();
                        }
                        setSessionResult({
                            trackName: currentTrack?.name || 'Unknown', artistName: currentTrack?.artist || 'Unknown',
                            mode: 'structured', avgWpm: stats.wpm, accuracy: stats.accuracy, tempoStability: stats.tempoStability,
                            wordsCompleted: stats.wordsCompleted, totalWords: stats.totalWords,
                            correctWords: stats.correctWords, elapsedMs: stats.elapsedMs,
                            timestamp: Date.now(), timerOption,
                            wpmHistory: stats.wpmHistory,
                            characters: { correct: 0, incorrect: 0, extra: 0, missed: 0 },
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

    useEffect(() => { loadSong(getRandomSong()); }, []);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(MY_LIST_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            if (Array.isArray(parsed)) {
                setSavedTracks(parsed);
            }
        } catch {
            setSavedTracks([]);
        }
    }, []);

    useEffect(() => {
        localStorage.setItem(MY_LIST_KEY, JSON.stringify(savedTracks));
    }, [savedTracks]);

    useEffect(() => {
        if (!showMyList) return;
        const onClickOutside = (e: MouseEvent) => {
            if (!myListPanelRef.current) return;
            if (!myListPanelRef.current.contains(e.target as Node)) {
                setShowMyList(false);
            }
        };
        window.addEventListener('mousedown', onClickOutside);
        return () => window.removeEventListener('mousedown', onClickOutside);
    }, [showMyList]);

    useEffect(() => {
        if (screen !== 'typing' || !lyrics) return;
        const handler = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement;
            if (t.tagName === 'INPUT') return;
            // "/" is reserved for search shortcut and should not type into lyrics.
            if (e.key === '/') return;
            e.preventDefault();
            handleKeyDown(e);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [screen, lyrics, handleKeyDown]);

    // Removed auto-play effect. User must explicitly click play.

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

    const toSavedTrack = useCallback((track: TrackSearchResult | SavedTrack): SavedTrack => ({
        id: track.id,
        track_name: track.track_name,
        artist_name: track.artist_name,
        album_name: track.album_name || '',
        duration: track.duration || 0,
        has_synced_lyrics: track.has_synced_lyrics,
        has_plain_lyrics: track.has_plain_lyrics,
    }), []);

    const isSavedTrack = useCallback((trackId?: number) => {
        if (!trackId) return false;
        return savedTracks.some(t => t.id === trackId);
    }, [savedTracks]);

    const toggleSavedTrack = useCallback((track: TrackSearchResult | SavedTrack) => {
        setSavedTracks(prev => {
            if (prev.some(t => t.id === track.id)) {
                return prev.filter(t => t.id !== track.id);
            }
            return [toSavedTrack(track), ...prev];
        });
    }, [toSavedTrack]);

    const selectTrack = useCallback((track: TrackSearchResult) => {
        if (spotify.state.connected && spotify.state.playing) {
            spotify.pause();
        }
        setCurrentTrack({ name: track.track_name, artist: track.artist_name, id: track.id });
        setShowResults(false); setSearchQuery(''); setTimeRemaining(null);
        loadSong(track.track_name, track.id);
    }, [loadSong, spotify]);

    const selectSavedTrack = useCallback((track: SavedTrack) => {
        if (spotify.state.connected && spotify.state.playing) {
            spotify.pause();
        }
        setCurrentTrack({ name: track.track_name, artist: track.artist_name, id: track.id });
        setShowMyList(false);
        setTimeRemaining(null);
        loadSong(track.track_name, track.id);
    }, [loadSong, spotify]);

    const handleRestart = useCallback(() => {
        resetTyping(); setTimeRemaining(null); setScreen('typing');
    }, [resetTyping]);

    const handleNewSong = useCallback(() => {
        if (spotify.state.connected && spotify.state.playing) {
            spotify.pause();
        }
        setScreen('typing'); setTimeRemaining(null); resetTyping(); searchInputRef.current?.focus();
    }, [resetTyping, spotify]);

    const handleSpotifyClick = useCallback(async () => {
        if (!spotify.state.connected) {
            window.location.href = '/auth/spotify';
            return;
        }
        if (spotify.state.playing) {
            spotify.pause();
            return;
        }
        setSpotifyLoading(true);
        try {
            if (currentTrack) {
                const uri = await spotify.searchTrack(currentTrack.name, currentTrack.artist);
                if (uri) await spotify.play(uri);
                else spotify.resume();
            } else {
                spotify.resume();
            }
        } catch { /* ignore */ }
        setSpotifyLoading(false);
    }, [spotify, currentTrack]);

    const handleCurrentTrackBookmark = useCallback(() => {
        if (!currentTrack?.id) return;
        const fallbackTrack: SavedTrack = {
            id: currentTrack.id,
            track_name: currentTrack.name,
            artist_name: currentTrack.artist,
            album_name: '',
            duration: lyrics?.duration || 0,
            has_synced_lyrics: Boolean(lyrics?.synced),
            has_plain_lyrics: Boolean(lyrics),
        };
        toggleSavedTrack(fallbackTrack);
    }, [currentTrack, lyrics, toggleSavedTrack]);

    const focusSearch = useCallback(() => {
        setShowMyList(false);
        setTimeout(() => searchInputRef.current?.focus(), 0);
    }, []);

    const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

    // Results
    if (screen === 'results' && sessionResult) {
        return (
            <ResultsScreen
                result={sessionResult}
                user={user}
                onReplay={handleRestart}
                onNewSong={handleNewSong}
            />
        );
    }

    return (
        <div className="min-h-screen flex flex-col" style={{ background: C.bg, color: C.text, fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>

            {/* Header */}
            <header className="flex items-center justify-between px-8 py-5">
                <h1 onClick={handleNewSong} className="text-2xl font-bold cursor-pointer tracking-tight" style={{ color: C.accent }}>
                    lyricstype
                </h1>
                <div className="flex items-center gap-3">
                    <div className="relative" ref={myListPanelRef}>
                        <button
                            onClick={() => setShowMyList(prev => !prev)}
                            className="text-xs px-3 py-1.5 rounded transition-all"
                            style={{
                                background: showMyList ? C.card : 'transparent',
                                color: showMyList ? C.accent : C.sub,
                            }}
                        >
                            my list ({savedTracks.length})
                        </button>
                        <AnimatePresence>
                            {showMyList && (
                                <motion.div
                                    initial={{ opacity: 0, y: -4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -4 }}
                                    className="absolute top-full right-0 mt-2 w-80 max-h-80 overflow-auto p-3 rounded text-xs z-50"
                                    style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-sm font-medium">Saved Songs</p>
                                        <button
                                            onClick={focusSearch}
                                            className="px-2 py-1 rounded text-[11px]"
                                            style={{ color: C.accent, background: 'transparent', border: `1px solid ${C.border}` }}
                                        >
                                            + add new
                                        </button>
                                    </div>
                                    {savedTracks.length === 0 ? (
                                        <p style={{ color: C.sub }}>No saved songs yet. Search and bookmark tracks to build your list.</p>
                                    ) : (
                                        <div className="space-y-1">
                                            {savedTracks.map(track => (
                                                <div key={track.id} className="flex items-center gap-2 rounded px-2 py-2 hover:bg-black/40">
                                                    <button
                                                        onMouseDown={() => selectSavedTrack(track)}
                                                        className="flex-1 text-left min-w-0"
                                                    >
                                                        <p className="truncate text-sm" style={{ color: C.text }}>{track.track_name}</p>
                                                        <p className="truncate text-[11px]" style={{ color: C.sub }}>{track.artist_name}</p>
                                                    </button>
                                                    <button
                                                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); toggleSavedTrack(track); }}
                                                        className="text-sm px-1"
                                                        style={{ color: C.sub }}
                                                        title="Remove from my list"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <button
                                        onClick={focusSearch}
                                        className="mt-3 px-3 py-1.5 rounded inline-block no-underline text-center w-full cursor-pointer text-xs"
                                        style={{ background: C.bg, color: C.text, border: `1px solid ${C.border}` }}
                                    >
                                        Add from search
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

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
                <div className="flex items-center gap-1 text-sm">
                    {TIMER_OPTIONS.map(opt => (
                        <button key={String(opt.value)} onClick={() => { setTimerOption(opt.value); handleRestart(); }}
                            className="px-3 py-1 rounded transition-colors"
                            style={{ background: timerOption === opt.value ? C.card : 'transparent', color: timerOption === opt.value ? C.accent : C.sub }}>
                            {opt.label}
                        </button>
                    ))}
                </div>
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
                                    <div key={track.id}
                                        className="group w-full px-3 py-2.5 flex items-center justify-between transition-colors"
                                        style={{ borderBottom: `1px solid ${C.border}` }}
                                        onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                        <button
                                            onMouseDown={() => selectTrack(track)}
                                            className="text-left min-w-0 flex-1"
                                        >
                                            <p className="text-sm font-medium truncate" style={{ color: C.text }}>{track.track_name}</p>
                                            <p className="text-xs truncate" style={{ color: C.sub }}>{track.artist_name}{track.album_name && ` · ${track.album_name}`}</p>
                                        </button>
                                        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                                            <button
                                                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); toggleSavedTrack(track); }}
                                                className="text-base transition-opacity opacity-0 group-hover:opacity-100"
                                                style={{ color: isSavedTrack(track.id) ? C.accent : C.sub }}
                                                title={isSavedTrack(track.id) ? 'Remove from my list' : 'Save to my list'}
                                            >
                                                {isSavedTrack(track.id) ? '★' : '☆'}
                                            </button>
                                            {track.has_synced_lyrics && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: C.bg, color: C.accent }}>synced</span>}
                                            {track.duration > 0 && <span className="text-xs" style={{ color: C.sub }}>{formatTime(track.duration)}</span>}
                                        </div>
                                    </div>
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                {/* Removed flow mode audio upload button */}
            </div>

            {/* Main typing area */}
            <main className="flex-1 flex flex-col items-center justify-center px-8 py-6 w-full max-w-5xl mx-auto">
                {/* Song Info & Stats Header */}
                <div className="flex items-center justify-between w-full mb-8 h-10">
                    {/* Left: Song Info */}
                    <div className="flex-1 min-w-0">
                        {currentTrack && (
                            <AnimatePresence mode="popLayout">
                                <motion.div
                                    key={currentTrack.id || currentTrack.name}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className="flex items-center gap-3"
                                >
                                    <button
                                        onClick={handleSpotifyClick}
                                        disabled={spotifyLoading}
                                        className="h-8 w-8 rounded-full flex items-center justify-center text-sm"
                                        style={{
                                            background: spotify.state.connected ? (spotify.state.playing ? '#1DB954' : C.card) : 'transparent',
                                            color: spotify.state.connected ? (spotify.state.playing ? '#fff' : '#1DB954') : '#1DB954',
                                            border: spotify.state.connected ? 'none' : '1px solid #1DB95440',
                                            opacity: spotifyLoading ? 0.6 : 1,
                                        }}
                                        title={spotify.state.connected ? (spotify.state.playing ? 'Pause Spotify' : 'Play from Spotify') : 'Connect Spotify'}
                                    >
                                        {spotify.state.connected ? (spotify.state.playing ? '⏸' : '▶') : '♫'}
                                    </button>
                                    <div className="flex flex-col">
                                        <span
                                            className="font-bold uppercase tracking-widest truncate"
                                            style={{ color: C.sub, fontSize: '11px', letterSpacing: '0.12em' }}
                                        >
                                            ♪ now playing
                                        </span>
                                        <span
                                            className="font-sans truncate"
                                            style={{ color: C.text, fontSize: '15px', fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 500 }}
                                        >
                                            {currentTrack.name}
                                            <span style={{ color: C.sub, fontWeight: 400, fontSize: '13px' }}> · {currentTrack.artist}</span>
                                        </span>
                                    </div>
                                    <button
                                        onClick={handleCurrentTrackBookmark}
                                        className="text-xl leading-none px-1"
                                        style={{ color: isSavedTrack(currentTrack.id) ? C.accent : C.sub }}
                                        title={isSavedTrack(currentTrack.id) ? 'Remove from my list' : 'Save to my list'}
                                    >
                                        {isSavedTrack(currentTrack.id) ? '★' : '☆'}
                                    </button>
                                </motion.div>
                            </AnimatePresence>
                        )}
                    </div>

                    {/* Right: Stats */}
                    <div className="flex items-center gap-6 justify-end flex-shrink-0">
                        {timerOption !== 'full' && (
                            <span className="text-3xl font-bold font-mono" style={{ color: C.accent }}>
                                {timeRemaining !== null ? formatTime(timeRemaining) : formatTime(timerOption as number)}
                            </span>
                        )}
                        {isStarted && (
                            <>
                                <span className="text-lg font-mono" style={{ color: C.text }}>{stats.wpm} <span className="text-xs font-sans" style={{ color: C.sub }}>wpm</span></span>
                                <span className="text-lg font-mono" style={{ color: C.text }}>{stats.accuracy}% <span className="text-xs font-sans" style={{ color: C.sub }}>acc</span></span>
                            </>
                        )}
                    </div>
                </div>

                {loadingLyrics ? (
                    <p className="text-sm" style={{ color: C.sub }}>loading lyrics...</p>
                ) : words.length > 0 ? (
                    <TypingRenderer
                        wordStates={wordStates}
                        currentWordIndex={currentWordIndex}
                        currentCharIndex={currentCharIndex}
                        mode="structured"
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
            <footer className="px-8 py-4 flex flex-col items-center justify-center gap-2">
                <div className="flex items-center gap-4">
                    <KeyBadge keys={['tab']} /> <span style={{ color: C.sub }}>+</span>
                    <KeyBadge keys={['enter']} />
                    <span className="text-xs" style={{ color: C.sub }}>— restart test</span>
                    <span className="mx-2" style={{ color: C.border }}>|</span>
                    <KeyBadge keys={['esc']} /> <span className="text-xs mx-1" style={{ color: C.sub }}>or</span>
                    <KeyBadge keys={['tab']} /> <span style={{ color: C.sub }}>+</span>
                    <KeyBadge keys={['space']} />
                    <span className="text-xs" style={{ color: C.sub }}>— new song</span>
                    <span className="mx-2" style={{ color: C.border }}>|</span>
                    <KeyBadge keys={['/']} />
                    <span className="text-xs" style={{ color: C.sub }}>— search</span>
                </div>
            </footer>

            <KeyboardShortcuts onRestart={handleRestart} onNewSong={handleNewSong} onSearch={() => { setTimeout(() => searchInputRef.current?.focus(), 0); }} />
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

// ── Typing Renderer: 5 lines visible, last faded, smooth cursor ──
function TypingRenderer({
    wordStates, currentWordIndex, currentCharIndex,
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
            if (offset > 60 || offset < 0) {
                container.scrollTo({
                    top: container.scrollTop + offset - 20,
                    behavior: 'smooth',
                });
            }
        }
    }, [currentWordIndex]);

    // Cursor element — absolutely positioned, never shifts text
    const Cursor = ({ position }: { position: 'before' | 'after' }) => (
        <span
            className="absolute top-[2px] bottom-[2px] w-[2.5px] rounded-full"
            style={{
                background: C.accent,
                animation: 'blink 1s ease-in-out infinite',
                [position === 'before' ? 'left' : 'right']: '-1px',
                zIndex: 2,
                pointerEvents: 'none',
            }}
        />
    );

    const renderChar = (char: string, ci: number, ws: typeof wordStates[0], isCurrentWord: boolean) => {
        const state = ws.chars[ci];
        const isAtCursor = isCurrentWord && ci === currentCharIndex && state === 'current';
        const isAfterLastChar = isCurrentWord && ci === ws.segment.word.length - 1 &&
            currentCharIndex >= ws.segment.word.length && (state === 'correct' || state === 'incorrect');

        let color = C.sub;
        if (state === 'correct') color = C.text;
        if (state === 'incorrect') color = C.error;

        return (
            <span key={ci} className="relative inline-block">
                {isAtCursor && <Cursor position="before" />}
                <span style={{
                    color,
                    background: state === 'incorrect' ? 'rgba(202,71,84,0.15)' : 'transparent',
                    borderRadius: state === 'incorrect' ? '2px' : '0',
                }}>
                    {char}
                </span>
                {isAfterLastChar && <Cursor position="after" />}
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
                <span style={{ color: 'transparent' }}>{' '}</span>
            </span>
        );
    };

    // Find which lines to show
    const currentLineIdx = lines.findIndex(l => l.lineIndex === currentLine);
    const VISIBLE_LINES = 5;
    const startLine = Math.max(0, currentLineIdx);
    const endLine = Math.min(lines.length, startLine + VISIBLE_LINES);

    return (
        <div
            ref={containerRef}
            className="overflow-hidden relative w-full"
            style={{ maxHeight: '280px', textAlign: 'left' }}
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
                            className="text-3xl leading-relaxed"
                            style={{
                                opacity: isCurrent ? 1 : isLast ? 0.15 : actualIdx < currentLineIdx ? 0.3 : 0.5,
                                transition: 'opacity 0.5s ease',
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

function KeyboardShortcuts({ onRestart, onNewSong, onSearch }: { onRestart: () => void, onNewSong: () => void, onSearch?: () => void }) {
    const tabRef = useRef(false);
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT') return;
            if (e.key === 'Tab') { e.preventDefault(); tabRef.current = true; }
            if (e.key === 'Escape') { e.preventDefault(); onNewSong(); }
            if (e.key === 'Enter' && tabRef.current) { e.preventDefault(); onRestart(); tabRef.current = false; }
            if (e.key === ' ' && tabRef.current) { e.preventDefault(); onNewSong(); tabRef.current = false; }
            if (e.key === '/' && onSearch) { e.preventDefault(); onSearch(); }
        };
        const up = (e: KeyboardEvent) => { if (e.key === 'Tab') tabRef.current = false; };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    }, [onRestart, onNewSong, onSearch]);
    return null;
}
