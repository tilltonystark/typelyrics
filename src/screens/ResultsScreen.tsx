import { motion } from 'framer-motion';
import { SessionResult, TimerOption } from '../types';
import { useEffect, useRef, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { getSessions } from '../lib/analytics';

const C = {
    bg: '#000000',
    sub: '#646669',
    text: '#d1d0c5',
    error: '#ca4754',
    accent: '#1DB954',
    card: '#111111',
    border: '#2a2a2a',
};

interface ResultsScreenProps {
    result: SessionResult;
    authLoading: boolean;
    user?: User | null;
    onSignIn: () => void;
    onSignOut: () => void;
    onLogoClick: () => void;
    onReplay: () => void;
    onNewSong: () => void;
}

function formatTimerLabel(opt: TimerOption): string {
    if (opt === 'full') return 'full song';
    if (opt === 120) return '2 min';
    return `${opt}s`;
}

// ── SVG WPM Chart (Monkeytype-style) ──
function WpmChart({ history }: { history: { time: number; wpm: number; raw: number }[] }) {
    if (history.length < 2) return null;

    const W = 960;
    const H = 180;
    const PAD = { top: 16, right: 0, bottom: 24, left: 0 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const maxTime = Math.max(...history.map(h => h.time));
    const allWpm = history.flatMap(h => [h.wpm, h.raw]);
    const maxWpm = Math.max(...allWpm, 10);
    const minWpm = Math.min(...allWpm.filter(v => v > 0), 0);
    const yRange = maxWpm - minWpm || 1;

    const xScale = (t: number) => PAD.left + (t / maxTime) * plotW;
    const yScale = (v: number) => PAD.top + plotH - ((v - minWpm) / yRange) * plotH;

    // Build smooth paths
    const wpmPoints = history.map(h => `${xScale(h.time)},${yScale(h.wpm)}`);

    const makePath = (points: string[]) => {
        if (points.length < 2) return '';
        return `M${points[0]} ${points.slice(1).map(p => `L${p}`).join(' ')}`;
    };
    const areaPath = `${makePath(wpmPoints)} L${xScale(maxTime)},${PAD.top + plotH} L${xScale(0)},${PAD.top + plotH} Z`;

    // Y-axis gridlines
    const yTicks: number[] = [];
    const step = Math.max(10, Math.ceil(yRange / 5 / 10) * 10);
    for (let v = Math.floor(minWpm / step) * step; v <= maxWpm + step; v += step) {
        if (v >= 0) yTicks.push(v);
    }

    // X-axis ticks
    const xTicks: number[] = [];
    const xStep = Math.max(1, Math.ceil(maxTime / 8));
    for (let t = 0; t <= maxTime; t += xStep) {
        xTicks.push(t);
    }

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
            {/* Grid lines */}
            {yTicks.map(v => (
                <g key={`y-${v}`}>
                    <line x1={PAD.left} y1={yScale(v)} x2={W - PAD.right} y2={yScale(v)}
                        stroke={C.border} strokeWidth="0.5" strokeDasharray="4,4" />
                </g>
            ))}

            {/* X-axis ticks */}
            {xTicks.map(t => (
                <text key={`x-${t}`} x={xScale(t)} y={H - 6}
                    fill={C.sub} fontSize="9" textAnchor="middle" fontFamily="monospace">
                    {t}
                </text>
            ))}

            <defs>
                <linearGradient id="wpmAreaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.accent} stopOpacity="0.35" />
                    <stop offset="100%" stopColor={C.accent} stopOpacity="0.04" />
                </linearGradient>
            </defs>

            {/* Area fill */}
            <motion.path
                d={areaPath}
                fill="url(#wpmAreaGradient)"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
            />

            {/* WPM line (accent color) */}
            <motion.path
                d={makePath(wpmPoints)}
                fill="none"
                stroke={C.accent}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1, ease: 'easeOut' }}
            />

            {/* Dots on WPM line */}
            {history.map((h, i) => (
                <circle
                    key={i}
                    cx={xScale(h.time)}
                    cy={yScale(h.wpm)}
                    r="2"
                    fill={C.accent}
                    opacity={0.7}
                />
            ))}

            {/* Axis labels */}
            <text x={W - PAD.right + 8} y={H - 6} fill={C.sub} fontSize="8" textAnchor="start" fontFamily="monospace">
                sec
            </text>
        </svg>
    );
}


export default function ResultsScreen({
    result,
    authLoading,
    user,
    onSignIn,
    onSignOut,
    onLogoClick,
    onReplay,
    onNewSong,
}: ResultsScreenProps) {
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const profileMenuRef = useRef<HTMLDivElement>(null);

    const history = useMemo(() => {
        return getSessions().slice().reverse();
    }, [result.timestamp]);

    // Keyboard shortcuts on results screen
    const tabRef = useRef(false);
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === 'Tab') { e.preventDefault(); tabRef.current = true; }
            if (e.key === 'Escape') { e.preventDefault(); onNewSong(); }
            if (e.key === 'Enter' && tabRef.current) { e.preventDefault(); onReplay(); tabRef.current = false; }
            if (e.key === ' ' && tabRef.current) { e.preventDefault(); onNewSong(); tabRef.current = false; }
        };
        const up = (e: KeyboardEvent) => { if (e.key === 'Tab') tabRef.current = false; };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    }, [onReplay, onNewSong]);

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

    return (
        <div className="min-h-screen flex flex-col" style={{ background: C.bg, color: C.text, fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>

            {/* Logo + user profile at the top */}
            <header className="absolute top-0 left-0 w-full px-6 py-6">
                <div className="w-full max-w-[960px] mx-auto flex items-center justify-between">
                    <h1 onClick={onLogoClick} className="text-[18px] font-bold tracking-tight cursor-pointer" style={{ color: C.accent }}>
                        typelyrics
                    </h1>
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
                        {showProfileMenu && (
                            <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                className="absolute top-full right-0 mt-2 w-40 rounded p-1 z-50"
                                style={{ background: C.card, border: `1px solid ${C.border}` }}
                            >
                                <button
                                    onClick={onNewSong}
                                    className="w-full text-left text-xs px-3 py-2 rounded hover:bg-black/30"
                                    style={{ color: C.text }}
                                >
                                    new song
                                </button>
                                <button
                                    onClick={onSignOut}
                                    className="w-full text-left text-xs px-3 py-2 rounded hover:bg-black/30"
                                    style={{ color: C.sub }}
                                >
                                    sign out
                                </button>
                            </motion.div>
                        )}
                        </div>
                    ) : (
                        <button onClick={onSignIn} className="text-xs px-3 py-2 rounded" style={{ background: '#fff', color: '#333' }}>sign in</button>
                    )}
                </div>
            </header>

            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-[960px] mx-auto px-6 pt-24 pb-8"
            >
                {/* Main section: WPM+ACC on left │ Graph+secondary stats on right */}
                <div className="grid grid-cols-1 lg:grid-cols-[160px_minmax(0,1fr)] gap-6 items-start mb-8">

                    {/* Left: Primary stats */}
                    <div className="flex-shrink-0 w-40 flex flex-col gap-6 lg:justify-self-end">
                        <div>
                            <span className="text-sm block mb-1" style={{ color: C.sub }}>wpm</span>
                            <motion.span
                                className="text-6xl font-bold font-mono block leading-none"
                                style={{ color: C.accent }}
                                initial={{ scale: 0.5, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.2 }}
                            >
                                {result.avgWpm}
                            </motion.span>
                        </div>
                        <div>
                            <span className="text-sm block mb-1" style={{ color: C.sub }}>acc</span>
                            <span className="text-4xl font-bold font-mono block leading-none" style={{ color: C.text }}>
                                {result.accuracy}%
                            </span>
                        </div>
                    </div>

                    {/* Right: Graph + secondary stats below it */}
                    <div className="w-full min-w-0 flex flex-col gap-4 lg:justify-self-start">
                        {/* Chart */}
                        <WpmChart history={result.wpmHistory} />

                        {/* Secondary stats row matches chart width */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 w-full pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
                            <div>
                                <span className="text-xs block" style={{ color: C.sub }}>test type</span>
                                <span className="text-base font-mono" style={{ color: C.text }}>{formatTimerLabel(result.timerOption)}</span>
                            </div>
                            <div>
                                <span className="text-xs block" style={{ color: C.sub }}>raw</span>
                                <span className="text-base font-mono" style={{ color: C.text }}>{result.avgWpm}</span>
                            </div>
                            <div>
                                <span className="text-xs block" style={{ color: C.sub }}>words</span>
                                <span className="text-base font-mono" style={{ color: C.text }}>{result.correctWords}/{result.totalWords}</span>
                            </div>
                            <div>
                                <span className="text-xs block" style={{ color: C.sub }}>time</span>
                                <span className="text-base font-mono" style={{ color: C.text }}>{Math.round(result.elapsedMs / 1000)}s</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Track info */}
                <p className="text-xs mb-6" style={{ color: C.sub }}>
                    {result.trackName} — {result.artistName}
                </p>

                {/* Action buttons */}
                <div className="flex gap-4">
                    <button onClick={onReplay}
                        className="w-48 px-6 py-3 rounded font-medium text-sm flex flex-col items-center gap-1 transition-opacity hover:opacity-90"
                        style={{ background: C.text, color: C.bg }}>
                        <span>restart test</span>
                        <span className="text-[10px] opacity-60">tab + enter</span>
                    </button>
                    <button onClick={onNewSong}
                        className="w-48 px-6 py-3 rounded font-medium text-sm flex flex-col items-center gap-1 transition-opacity hover:opacity-90"
                        style={{ background: C.card, color: C.text }}>
                        <span>new song</span>
                        <span className="text-[10px] opacity-60">esc / tab + space</span>
                    </button>
                </div>

                <div className="w-full mt-8">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-semibold" style={{ color: C.text }}>history</h2>
                        <span className="text-xs" style={{ color: C.sub }}>{history.length} sessions</span>
                    </div>
                    <div className="rounded overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
                        <div className="grid grid-cols-[minmax(0,2fr)_90px_90px_90px_90px] px-3 py-2 text-[14px]" style={{ background: C.card, color: C.sub }}>
                            <span>song</span>
                            <span>mode</span>
                            <span>wpm</span>
                            <span>acc</span>
                            <span>time</span>
                        </div>
                        {history.length === 0 ? (
                            <div className="px-3 py-4 text-[14px]" style={{ color: C.sub }}>No sessions yet.</div>
                        ) : history.map((session, idx) => (
                            <div
                                key={`${session.timestamp}-${idx}`}
                                className="grid grid-cols-[minmax(0,2fr)_90px_90px_90px_90px] px-3 py-2 text-[14px]"
                                style={{ borderTop: idx === 0 ? 'none' : `1px solid ${C.border}`, color: C.text }}
                            >
                                <span className="truncate">{session.trackName} · {session.artistName}</span>
                                <span>{formatTimerLabel(session.timerOption)}</span>
                                <span>{session.avgWpm}</span>
                                <span>{session.accuracy}%</span>
                                <span>{Math.round(session.elapsedMs / 1000)}s</span>
                            </div>
                        ))}
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <div className="text-center py-2">
            <span className="text-xs block mb-1" style={{ color: C.sub }}>{label}</span>
            <span className="text-lg font-mono font-bold block" style={{ color: accent ? C.accent : C.text }}>{value}</span>
        </div>
    );
}
