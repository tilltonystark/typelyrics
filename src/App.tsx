import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrackSearchResult, LyricsData, TypingMode, TimerOption, SessionResult } from './types';
import { buildWordSegments } from './engine/lyricsParser';
import { cleanAllLyrics } from './engine/lyricsCleaner';
import { useTypingEngine } from './engine/useTypingEngine';
import { useAuth } from './auth/useAuth';
import { useSpotifyPlayer } from './engine/useSpotifyPlayer';
import { getSessions, trackSessionComplete } from './lib/analytics';
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
    accent: '#1DB954',
    card: '#111111',
    border: '#2a2a2a',
};

interface SavedTrack {
    id: number;
    track_name: string;
    artist_name: string;
    album_name: string;
    album_art?: string;
    duration: number;
    has_synced_lyrics: boolean;
    has_plain_lyrics: boolean;
}

export default function App() {
    const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth();
    const spotify = useSpotifyPlayer();

    const [screen, setScreen] = useState<'typing' | 'results'>('typing');
    const [lyrics, setLyrics] = useState<LyricsData | null>(null);
    const [currentTrack, setCurrentTrack] = useState<{ name: string; artist: string; id?: number; albumArt?: string } | null>(null);
    const [timerOption, setTimerOption] = useState<TimerOption>(30);
    const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
    const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
    const [spotifyLoading, setSpotifyLoading] = useState(false);
    const [savedTracks, setSavedTracks] = useState<SavedTrack[]>([]);
    const [showMyList, setShowMyList] = useState(false);
    const [showProfileMenu, setShowProfileMenu] = useState(false);

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<TrackSearchResult[]>([]);
    const [showResults, setShowResults] = useState(false);
    const [searching, setSearching] = useState(false);
    const [loadingLyrics, setLoadingLyrics] = useState(false);
    const [seekStartSec, setSeekStartSec] = useState(0);
    const [linkedTrackId, setLinkedTrackId] = useState<number | null>(null);

    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
    const timerRef = useRef<ReturnType<typeof setInterval>>();
    const searchInputRef = useRef<HTMLInputElement>(null);
    const myListPanelRef = useRef<HTMLDivElement>(null);
    const profileMenuRef = useRef<HTMLDivElement>(null);
    const coverCacheRef = useRef<Map<number, string>>(new Map());

    const baseWords = useMemo(() => {
        if (!lyrics) return [];
        const cleaned = cleanAllLyrics(lyrics.lines);
        const duration = lyrics.duration || 180;
        return buildWordSegments(cleaned, duration);
    }, [lyrics]);

    const words = useMemo(() => {
        const firstIdx = baseWords.findIndex(w => w.endTime >= seekStartSec);
        const filtered = firstIdx >= 0 ? baseWords.slice(firstIdx) : baseWords;
        return filtered.map((segment, idx) => ({ ...segment, globalIndex: idx }));
    }, [baseWords, seekStartSec]);

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
            const nextResult: SessionResult = {
                trackName: currentTrack?.name || 'Unknown',
                artistName: currentTrack?.artist || 'Unknown',
                mode: 'structured', avgWpm: finalStats.wpm, accuracy: finalStats.accuracy,
                tempoStability: finalStats.tempoStability, wordsCompleted: finalStats.wordsCompleted,
                totalWords: finalStats.totalWords, correctWords: finalStats.correctWords,
                elapsedMs: finalStats.elapsedMs, timestamp: Date.now(), timerOption,
                wpmHistory: finalStats.wpmHistory,
                characters: { correct: 0, incorrect: 0, extra: 0, missed: 0 },
            };
            trackSessionComplete(nextResult);
            setSessionResult(nextResult);
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
                        const nextResult: SessionResult = {
                            trackName: currentTrack?.name || 'Unknown', artistName: currentTrack?.artist || 'Unknown',
                            mode: 'structured', avgWpm: stats.wpm, accuracy: stats.accuracy, tempoStability: stats.tempoStability,
                            wordsCompleted: stats.wordsCompleted, totalWords: stats.totalWords,
                            correctWords: stats.correctWords, elapsedMs: stats.elapsedMs,
                            timestamp: Date.now(), timerOption,
                            wpmHistory: stats.wpmHistory,
                            characters: { correct: 0, incorrect: 0, extra: 0, missed: 0 },
                        };
                        trackSessionComplete(nextResult);
                        setSessionResult(nextResult);
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
        if (!showProfileMenu) return;
        const onClickOutside = (e: MouseEvent) => {
            if (!profileMenuRef.current) return;
            if (!profileMenuRef.current.contains(e.target as Node)) {
                setShowProfileMenu(false);
            }
        };
        window.addEventListener('mousedown', onClickOutside);
        return () => window.removeEventListener('mousedown', onClickOutside);
    }, [showProfileMenu]);

    useEffect(() => {
        const duration = lyrics?.duration || 0;
        if (duration > 0 && seekStartSec > duration) {
            setSeekStartSec(0);
        }
    }, [lyrics, seekStartSec]);

    useEffect(() => {
        if (screen !== 'typing' || !lyrics) return;
        const handler = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement;
            if (t.tagName === 'INPUT') return;
            if (e.key === 'Tab') { e.preventDefault(); return; }
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (!isStarted && !e.metaKey && !e.ctrlKey && !e.altKey) {
                if (e.key === '1') { e.preventDefault(); setTimerOption(30); resetTyping(); setTimeRemaining(null); setScreen('typing'); return; }
                if (e.key === '2') { e.preventDefault(); setTimerOption(60); resetTyping(); setTimeRemaining(null); setScreen('typing'); return; }
                if (e.key === '3') { e.preventDefault(); setTimerOption(120); resetTyping(); setTimeRemaining(null); setScreen('typing'); return; }
                if (e.key === '4') { e.preventDefault(); setTimerOption('full'); resetTyping(); setTimeRemaining(null); setScreen('typing'); return; }
            }
            // "/" is reserved for search shortcut and should not type into lyrics.
            if (e.key === '/') return;
            e.preventDefault();
            handleKeyDown(e);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [screen, lyrics, handleKeyDown, isStarted, resetTyping]);

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
                    const topTracks = tracks.slice(0, 8);
                    setSearchResults(topTracks);
                    setShowResults(true);
                    void Promise.all(topTracks.map(async (track) => {
                        if (coverCacheRef.current.has(track.id)) return;
                        try {
                            const q = `${track.track_name} ${track.artist_name}`;
                            const artRes = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}`);
                            if (!artRes.ok) return;
                            const artData = await artRes.json();
                            const art = artData.albumArt as string | undefined;
                            if (!art) return;
                            coverCacheRef.current.set(track.id, art);
                            setSearchResults(prev => prev.map(t => t.id === track.id ? { ...t, album_art: art } : t));
                        } catch {
                            // ignore missing album art
                        }
                    }));
                }
            } catch { }
            setSearching(false);
        }, 300);
    }, []);

    const loadSong = useCallback(async (query: string, trackId?: number) => {
        setLoadingLyrics(true);
        try {
            let id = trackId;
            let trackInfo: { name: string; artist: string; id?: number; albumArt?: string } | null = null;
            if (!id) {
                const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                if (!res.ok) throw new Error('search failed');
                const data = await res.json();
                const tracks: TrackSearchResult[] = data.tracks || [];
                const best = tracks.find(t => t.has_synced_lyrics) || tracks[0];
                if (!best) throw new Error('no results');
                id = best.id; trackInfo = { name: best.track_name, artist: best.artist_name, id: best.id, albumArt: best.album_art || coverCacheRef.current.get(best.id) };
            }
            const lyricsRes = await fetch(`/api/lyrics/${id}`);
            if (!lyricsRes.ok) throw new Error('lyrics fetch failed');
            const lyricsData: LyricsData = await lyricsRes.json();
            setSeekStartSec(0);
            setLinkedTrackId(null);
            setLyrics(lyricsData);
            if (trackInfo) setCurrentTrack(trackInfo);
            else setCurrentTrack({ name: lyricsData.trackName, artist: lyricsData.artistName, id, albumArt: id ? coverCacheRef.current.get(id) : undefined });
        } catch (err) { console.error('Failed to load song:', err); }
        setLoadingLyrics(false);
    }, []);

    const toSavedTrack = useCallback((track: TrackSearchResult | SavedTrack): SavedTrack => ({
        id: track.id,
        track_name: track.track_name,
        artist_name: track.artist_name,
        album_name: track.album_name || '',
        album_art: track.album_art,
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
        setLinkedTrackId(null);
        setCurrentTrack({ name: track.track_name, artist: track.artist_name, id: track.id, albumArt: track.album_art || coverCacheRef.current.get(track.id) });
        setShowResults(false); setSearchQuery(''); setTimeRemaining(null);
        loadSong(track.track_name, track.id);
    }, [loadSong, spotify]);

    const selectSavedTrack = useCallback((track: SavedTrack) => {
        if (spotify.state.connected && spotify.state.playing) {
            spotify.pause();
        }
        setLinkedTrackId(null);
        setCurrentTrack({ name: track.track_name, artist: track.artist_name, id: track.id, albumArt: track.album_art || coverCacheRef.current.get(track.id) });
        setShowMyList(false);
        setTimeRemaining(null);
        loadSong(track.track_name, track.id);
    }, [loadSong, spotify]);

    const handleRestart = useCallback(async () => {
        resetTyping();
        setTimeRemaining(null);
        setScreen('typing');
        const trackLoaded = Boolean(currentTrack?.id && linkedTrackId === currentTrack.id);
        if (spotify.state.connected && trackLoaded) {
            spotify.seek(Math.max(0, Math.round(seekStartSec * 1000)));
            return;
        }
        if (spotify.state.connected && currentTrack) {
            try {
                const uri = await spotify.searchTrack(currentTrack.name, currentTrack.artist);
                if (uri) {
                    await spotify.play(uri, Math.max(0, Math.round(seekStartSec * 1000)));
                    if (currentTrack.id) setLinkedTrackId(currentTrack.id);
                }
            } catch {
                // keep restart resilient even if Spotify reload fails
            }
        }
    }, [resetTyping, spotify, seekStartSec, currentTrack, linkedTrackId]);

    const handleNewSong = useCallback(() => {
        if (spotify.state.connected && spotify.state.playing) {
            spotify.pause();
        }
        setScreen('typing'); setTimeRemaining(null); resetTyping(); searchInputRef.current?.focus();
    }, [resetTyping, spotify]);

    const isSameTrackLoaded = Boolean(currentTrack?.id && linkedTrackId === currentTrack.id);
    const songProgressSec = isSameTrackLoaded ? Math.max(0, Math.round(spotify.state.positionMs / 1000)) : seekStartSec;
    const currentCoverArt = currentTrack?.albumArt || spotify.state.albumArt || '';

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
            if (isSameTrackLoaded) {
                if (!isStarted) {
                    spotify.seek(Math.max(0, Math.round(seekStartSec * 1000)));
                }
                spotify.resume();
            } else if (currentTrack) {
                const uri = await spotify.searchTrack(currentTrack.name, currentTrack.artist);
                if (uri) {
                    await spotify.play(uri, Math.max(0, Math.round(seekStartSec * 1000)));
                    if (currentTrack.id) setLinkedTrackId(currentTrack.id);
                }
                else spotify.resume();
            } else {
                spotify.resume();
            }
        } catch { /* ignore */ }
        setSpotifyLoading(false);
    }, [spotify, currentTrack, seekStartSec, isSameTrackLoaded, isStarted]);

    const handleCurrentTrackBookmark = useCallback(() => {
        if (!currentTrack?.id) return;
        const fallbackTrack: SavedTrack = {
            id: currentTrack.id,
            track_name: currentTrack.name,
            artist_name: currentTrack.artist,
            album_name: '',
            album_art: currentTrack.albumArt || coverCacheRef.current.get(currentTrack.id),
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

    const handleSeekStartChange = useCallback((value: number) => {
        if (isStarted) return;
        const next = Math.max(0, Math.min(value, lyrics?.duration || 0));
        setSeekStartSec(next);
        if (spotify.state.connected && isSameTrackLoaded) {
            spotify.seek(Math.round(next * 1000));
        }
    }, [isStarted, lyrics?.duration, spotify, isSameTrackLoaded]);

    const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const canAdjustSeek = Boolean(lyrics?.synced) && !isStarted;
    const shouldFollowSong = isSameTrackLoaded && spotify.state.connected && (spotify.state.playing || spotify.state.positionMs > 0);
    const showGhostCursor = isSameTrackLoaded && spotify.state.connected && spotify.state.playing;
    const songPlaybackSec = spotify.state.positionMs / 1000;

    const ghostCursor = useMemo(() => {
        if (!showGhostCursor || words.length === 0) return null;

        const absoluteProgressSec = shouldFollowSong
            ? songPlaybackSec
            : seekStartSec + (stats.elapsedMs / 1000);
        const timelineSec = Math.max(0, absoluteProgressSec - seekStartSec);

        let ghostWordIndex = words.findIndex(w => (w.endTime - seekStartSec) > timelineSec);
        if (ghostWordIndex === -1) ghostWordIndex = words.length - 1;
        const ghostWord = words[ghostWordIndex];
        if (!ghostWord) return null;

        const wordStartSec = Math.max(0, ghostWord.startTime - seekStartSec);
        const wordDuration = Math.max(ghostWord.duration, 0.05);
        const wordProgress = Math.max(0, Math.min((timelineSec - wordStartSec) / wordDuration, 1));
        const ghostCharIndex = Math.min(ghostWord.word.length, Math.floor(wordProgress * ghostWord.word.length));

        return { wordIndex: ghostWordIndex, charIndex: ghostCharIndex };
    }, [showGhostCursor, words, songPlaybackSec, seekStartSec]);

    const handleOpenHistory = useCallback(() => {
        const sessions = getSessions();
        const latest = sessions[sessions.length - 1];
        if (!latest) return;
        setSessionResult(latest);
        setScreen('results');
        setShowProfileMenu(false);
    }, []);

    // Results
    if (screen === 'results' && sessionResult) {
        return (
            <ResultsScreen
                result={sessionResult}
                user={user}
                authLoading={authLoading}
                onSignIn={signInWithGoogle}
                onSignOut={signOut}
                onLogoClick={handleNewSong}
                onReplay={handleRestart}
                onNewSong={handleNewSong}
            />
        );
    }

    return (
        <div className="min-h-screen flex flex-col" style={{ background: C.bg, color: C.text, fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>

            {/* Header */}
            <header className="w-full px-6 py-6">
                <div className="w-full max-w-[960px] mx-auto flex items-center justify-between">
                    <h1 onClick={handleNewSong} className="text-[18px] font-bold cursor-pointer tracking-tight" style={{ color: C.accent }}>
                        typelyrics
                    </h1>
                    <div className="flex items-center gap-3">
                    <div className="relative" ref={myListPanelRef}>
                        <button
                            onClick={() => setShowMyList(prev => !prev)}
                                className="text-xs px-3 py-2 rounded transition-all"
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
                                                        className="flex-1 text-left min-w-0 flex items-center gap-2"
                                                    >
                                                        {track.album_art ? (
                                                            <img src={track.album_art} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                                                        ) : (
                                                            <span className="w-8 h-8 rounded flex items-center justify-center text-[10px] flex-shrink-0" style={{ background: C.border, color: C.sub }}>♪</span>
                                                        )}
                                                        <span className="min-w-0">
                                                            <p className="truncate text-sm" style={{ color: C.text }}>{track.track_name}</p>
                                                            <p className="truncate text-[11px]" style={{ color: C.sub }}>{track.artist_name}</p>
                                                        </span>
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
                                        className="mt-3 px-3 py-2 rounded inline-block no-underline text-center w-full cursor-pointer text-xs"
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
                        <div className="relative" ref={profileMenuRef}>
                            <button
                                onClick={() => setShowProfileMenu(prev => !prev)}
                                className="flex items-center gap-2 px-2 py-1 rounded"
                                style={{ border: `1px solid ${C.border}` }}
                            >
                                {user.photoURL && <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full" />}
                                <span className="text-xs" style={{ color: C.text }}>{user.displayName || 'profile'}</span>
                                <span className="text-[10px]" style={{ color: C.sub }}>▾</span>
                            </button>
                            <AnimatePresence>
                                {showProfileMenu && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -4 }}
                                        className="absolute top-full right-0 mt-2 w-40 rounded p-1 z-50"
                                        style={{ background: C.card, border: `1px solid ${C.border}` }}
                                    >
                                        <button
                                            onClick={handleOpenHistory}
                                            className="w-full text-left text-xs px-3 py-2 rounded hover:bg-black/30"
                                            style={{ color: C.text }}
                                        >
                                            history
                                        </button>
                                        <button
                                            onClick={signOut}
                                            className="w-full text-left text-xs px-3 py-2 rounded hover:bg-black/30"
                                            style={{ color: C.sub }}
                                        >
                                            sign out
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        ) : (
                            <button onClick={signInWithGoogle} className="text-xs px-3 py-2 rounded" style={{ background: '#fff', color: '#333' }}>sign in</button>
                        )}
                    </div>
                </div>
            </header>

            {/* Options bar */}
            <div className="w-full px-6 py-2">
                <div className="w-full max-w-[960px] mx-auto flex items-center gap-4">
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
                        placeholder="search song..." className="px-3 py-2 rounded text-sm outline-none w-48"
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
                                        className="group w-full px-3 py-3 flex items-center justify-between transition-colors"
                                        style={{ borderBottom: `1px solid ${C.border}` }}
                                        onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                        <button
                                            onMouseDown={() => selectTrack(track)}
                                            className="text-left min-w-0 flex-1 flex items-center gap-2"
                                        >
                                            {loadingLyrics && currentTrack?.id === track.id ? (
                                                <span className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0" style={{ background: C.border }}>
                                                    <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" style={{ color: C.accent, animation: 'spin 0.6s linear infinite' }} />
                                                </span>
                                            ) : track.album_art ? (
                                                <img src={track.album_art} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" />
                                            ) : (
                                                <span className="w-9 h-9 rounded flex items-center justify-center text-[10px] flex-shrink-0" style={{ background: C.border, color: C.sub }}>♪</span>
                                            )}
                                            <span className="min-w-0">
                                                <p className="text-sm font-medium truncate" style={{ color: C.text }}>{track.track_name}</p>
                                                <p className="text-xs truncate" style={{ color: C.sub }}>{track.artist_name}{track.album_name && ` · ${track.album_name}`}</p>
                                            </span>
                                        </button>
                                        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                                            <button
                                                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); toggleSavedTrack(track); }}
                                                className="h-8 w-8 rounded-full flex items-center justify-center transition-opacity opacity-0 group-hover:opacity-100"
                                                style={{ color: isSavedTrack(track.id) ? C.accent : C.sub }}
                                                title={isSavedTrack(track.id) ? 'Remove from my list' : 'Save to my list'}
                                            >
                                                <BookmarkIcon active={isSavedTrack(track.id)} />
                                            </button>
                                            {track.has_synced_lyrics && <span className="text-xs px-2 py-1 rounded" style={{ background: C.bg, color: C.accent }}>synced</span>}
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
            </div>

            {/* Main typing area */}
            <main className="flex-1 w-full px-6 pt-6 pb-6">
                <div className="w-full max-w-[960px] mx-auto flex flex-col gap-6">
                {/* Song Info & Stats Header */}
                <div className="flex items-start w-full gap-6">
                    {/* Left: Song Info + Seek */}
                    <div className="w-fit min-w-0 max-w-[640px] space-y-4">
                        {timerOption !== 'full' && (
                            <div className="text-xl font-bold font-mono" style={{ color: C.accent }}>
                                {timeRemaining !== null ? formatTime(timeRemaining) : formatTime(timerOption as number)}
                            </div>
                        )}
                        {currentTrack && (
                            <AnimatePresence mode="popLayout">
                                <motion.div
                                    key={currentTrack.id || currentTrack.name}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className="flex items-center gap-3"
                                >
                                    {spotify.state.connected && (
                                        <button
                                            onClick={handleSpotifyClick}
                                            disabled={spotifyLoading}
                                            className="h-8 w-8 rounded-full flex items-center justify-center text-sm"
                                            style={{
                                                background: spotify.state.playing ? '#1DB954' : C.card,
                                                color: spotify.state.playing ? '#fff' : '#1DB954',
                                                border: 'none',
                                                opacity: spotifyLoading ? 0.6 : 1,
                                            }}
                                            title={spotify.state.playing ? 'Pause Spotify' : 'Play from Spotify'}
                                        >
                                            {spotify.state.playing ? '⏸' : '▶'}
                                        </button>
                                    )}
                                    {loadingLyrics ? (
                                        <span className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0" style={{ background: C.border }}>
                                            <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full" style={{ color: C.accent, animation: 'spin 0.6s linear infinite' }} />
                                        </span>
                                    ) : currentCoverArt ? (
                                        <img src={currentCoverArt} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                                    ) : (
                                        <span className="w-10 h-10 rounded flex items-center justify-center text-xs flex-shrink-0" style={{ background: C.border, color: C.sub }}>♪</span>
                                    )}
                                    <div className="flex flex-col min-w-0">
                                        <span
                                            className="font-bold uppercase tracking-widest truncate"
                                            style={{ color: C.sub, fontSize: '11px', letterSpacing: '0.12em' }}
                                        >
                                            ♪ now playing
                                        </span>
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span
                                                className="font-sans truncate"
                                                style={{ color: C.text, fontSize: '15px', fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 500 }}
                                            >
                                                {currentTrack.name}
                                                <span style={{ color: C.sub, fontWeight: 400, fontSize: '13px' }}> · {currentTrack.artist}</span>
                                            </span>
                                            {!spotify.state.connected && (
                                                <button
                                                    onClick={handleSpotifyClick}
                                                    disabled={spotifyLoading}
                                                    className="px-2 py-1 rounded text-[11px] uppercase tracking-wide flex-shrink-0"
                                                    style={{
                                                        background: 'transparent',
                                                        color: '#1DB954',
                                                        border: '1px solid #1DB95466',
                                                        opacity: spotifyLoading ? 0.6 : 1,
                                                    }}
                                                    title="Connect it to play the song. Spotify Premium needed."
                                                >
                                                    connect spotify
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleCurrentTrackBookmark}
                                        className="h-8 w-8 rounded-full flex items-center justify-center"
                                        style={{
                                            background: C.card,
                                            color: isSavedTrack(currentTrack.id) ? C.accent : C.sub,
                                            border: `1px solid ${C.border}`,
                                        }}
                                        title={isSavedTrack(currentTrack.id) ? 'Remove from my list' : 'Save to my list'}
                                    >
                                        <BookmarkIcon active={isSavedTrack(currentTrack.id)} />
                                    </button>
                                </motion.div>
                            </AnimatePresence>
                        )}
                        {lyrics && (
                            <div className="w-[480px] max-w-full">
                                <div className="flex items-center gap-3 text-xs">
                                <span style={{ color: C.sub }}>start</span>
                                <input
                                    type="range"
                                    min={0}
                                    max={Math.max(0, lyrics.duration || 0)}
                                    step={1}
                                    value={Math.min(shouldFollowSong ? songProgressSec : seekStartSec, lyrics.duration || 0)}
                                    disabled={!canAdjustSeek}
                                    onChange={(e) => handleSeekStartChange(Number(e.target.value))}
                                    className="flex-1 seek-slider"
                                    title={!lyrics.synced ? 'Seek requires synced lyrics for reliable alignment' : isStarted ? 'Locked after typing starts' : 'Choose where practice starts'}
                                />
                                <span className="font-mono" style={{ color: C.text }}>{formatTime(Math.round(shouldFollowSong ? songProgressSec : seekStartSec))}</span>
                                <span style={{ color: C.sub }}>/ {formatTime(Math.round(lyrics.duration || 0))}</span>
                                {!lyrics.synced && <span style={{ color: C.sub }}>sync required</span>}
                            </div>
                        </div>
                        )}
                    </div>

                    {/* Right: Stats */}
                    <div className="flex items-center gap-6 justify-end flex-shrink-0">
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
                    <div className="w-full">
                        <TypingRenderer
                            wordStates={wordStates}
                            currentWordIndex={currentWordIndex}
                            currentCharIndex={currentCharIndex}
                            ghostWordIndex={ghostCursor?.wordIndex ?? null}
                            ghostCharIndex={ghostCursor?.charIndex ?? null}
                            showGhostCursor={showGhostCursor}
                            mode="structured"
                        />
                        {!isStarted && (
                            <p className="mt-3 text-xs text-center" style={{ color: C.sub }}>
                                Press "space bar" to start typing.
                            </p>
                        )}
                    </div>
                ) : (
                    <p className="text-sm" style={{ color: C.sub }}>no lyrics loaded</p>
                )}

                <button onClick={handleRestart}
                    className="text-lg transition-opacity hover:opacity-100"
                    style={{ color: C.sub, opacity: 0.5 }} title="Restart (Tab + Enter)">
                    ↻
                </button>
                </div>
            </main>

            {/* Footer */}
            <footer className="w-full px-6 py-4">
                <div className="w-full max-w-[960px] mx-auto flex items-center gap-4">
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
                    <span className="mx-2" style={{ color: C.border }}>|</span>
                    <KeyBadge keys={['cmd']} /> <span style={{ color: C.sub }}>+</span>
                    <KeyBadge keys={['k']} />
                    <span className="text-xs" style={{ color: C.sub }}>— play/pause</span>
                    <span className="mx-2" style={{ color: C.border }}>|</span>
                    <span className="text-xs" style={{ color: C.sub }}>1/2/3/4 — 30s/60s/120s/full</span>
                </div>
            </footer>

            <KeyboardShortcuts
                onRestart={handleRestart}
                onNewSong={handleNewSong}
                onSearch={() => { setTimeout(() => searchInputRef.current?.focus(), 0); }}
                onTogglePlayback={handleSpotifyClick}
            />
        </div>
    );
}

function KeyBadge({ keys }: { keys: string[] }) {
    return (
        <span className="flex gap-1">
            {keys.map(k => (
                <span key={k} className="text-[10px] px-2 py-1 rounded"
                    style={{ background: C.card, color: C.sub, border: `1px solid ${C.border}` }}>{k}</span>
            ))}
        </span>
    );
}

function BookmarkIcon({ active }: { active: boolean }) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path
                d="M7 4.75C7 4.06 7.56 3.5 8.25 3.5H15.75C16.44 3.5 17 4.06 17 4.75V20.2C17 20.58 16.57 20.8 16.25 20.58L12 17.6L7.75 20.58C7.43 20.8 7 20.58 7 20.2V4.75Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
            />
        </svg>
    );
}

// ── Typing Renderer: 5 lines visible, last faded, smooth cursor ──
function TypingRenderer({
    wordStates, currentWordIndex, currentCharIndex, ghostWordIndex, ghostCharIndex, showGhostCursor,
}: {
    wordStates: import('./types').WordState[];
    currentWordIndex: number;
    currentCharIndex: number;
    ghostWordIndex?: number | null;
    ghostCharIndex?: number | null;
    showGhostCursor?: boolean;
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
                    top: container.scrollTop + offset - 24,
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

    const GhostCursor = ({ position }: { position: 'before' | 'after' }) => (
        <span
            className="absolute top-[4px] bottom-[4px] w-[1.5px] rounded-full"
            style={{
                background: '#8a8c90',
                [position === 'before' ? 'left' : 'right']: '-1px',
                zIndex: 1,
                pointerEvents: 'none',
            }}
        />
    );

    const renderChar = (char: string, ci: number, ws: typeof wordStates[0], isCurrentWord: boolean) => {
        const state = ws.chars[ci];
        const isAtCursor = isCurrentWord && ci === currentCharIndex && state === 'current';
        const isAfterLastChar = isCurrentWord && ci === ws.segment.word.length - 1 &&
            currentCharIndex >= ws.segment.word.length && (state === 'correct' || state === 'incorrect');
        const isGhostWord = Boolean(showGhostCursor) && ws.segment.globalIndex === ghostWordIndex;
        const isAtGhostCursor = isGhostWord && ci === ghostCharIndex;
        const isGhostAfterLastChar = isGhostWord && ci === ws.segment.word.length - 1 &&
            (ghostCharIndex ?? 0) >= ws.segment.word.length;

        let color = C.sub;
        if (state === 'correct') color = C.text;
        if (state === 'incorrect') color = C.error;

        return (
            <span key={ci} className="relative inline-block">
                {isAtCursor && <Cursor position="before" />}
                {isAtGhostCursor && <GhostCursor position="before" />}
                <span style={{
                    color,
                    background: state === 'incorrect' ? 'rgba(202,71,84,0.15)' : 'transparent',
                    borderRadius: state === 'incorrect' ? '2px' : '0',
                }}>
                    {char}
                </span>
                {isAfterLastChar && <Cursor position="after" />}
                {isGhostAfterLastChar && <GhostCursor position="after" />}
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

function KeyboardShortcuts({
    onRestart,
    onNewSong,
    onSearch,
    onTogglePlayback,
}: {
    onRestart: () => void,
    onNewSong: () => void,
    onSearch?: () => void,
    onTogglePlayback?: () => void,
}) {
    const tabRef = useRef(false);
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT') return;
            const isTogglePlayback = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
            if (isTogglePlayback) { e.preventDefault(); onTogglePlayback?.(); return; }
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
    }, [onRestart, onNewSong, onSearch, onTogglePlayback]);
    return null;
}
