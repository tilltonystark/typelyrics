import { motion } from 'framer-motion';
import { SessionResult, TimerOption } from '../types';
import { useEffect, useRef, useMemo } from 'react';

const C = {
    bg: '#323437',
    sub: '#646669',
    text: '#d1d0c5',
    error: '#ca4754',
    accent: '#e2b714',
    card: '#2c2e31',
    border: '#3a3c3f',
};

interface ResultsScreenProps {
    result: SessionResult;
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

    const W = 700;
    const H = 180;
    const PAD = { top: 20, right: 40, bottom: 30, left: 50 };
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
    const rawPoints = history.map(h => `${xScale(h.time)},${yScale(h.raw)}`);

    const makePath = (points: string[]) => {
        if (points.length < 2) return '';
        return `M${points[0]} ${points.slice(1).map(p => `L${p}`).join(' ')}`;
    };

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
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: '700px' }}>
            {/* Grid lines */}
            {yTicks.map(v => (
                <g key={`y-${v}`}>
                    <line x1={PAD.left} y1={yScale(v)} x2={W - PAD.right} y2={yScale(v)}
                        stroke={C.border} strokeWidth="0.5" strokeDasharray="4,4" />
                    <text x={PAD.left - 8} y={yScale(v) + 4}
                        fill={C.sub} fontSize="9" textAnchor="end" fontFamily="monospace">
                        {v}
                    </text>
                </g>
            ))}

            {/* X-axis ticks */}
            {xTicks.map(t => (
                <text key={`x-${t}`} x={xScale(t)} y={H - 6}
                    fill={C.sub} fontSize="9" textAnchor="middle" fontFamily="monospace">
                    {t}
                </text>
            ))}

            {/* Raw WPM line (lighter) */}
            <motion.path
                d={makePath(rawPoints)}
                fill="none"
                stroke={C.sub}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.5}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
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
            <text x={PAD.left - 8} y={12} fill={C.sub} fontSize="8" textAnchor="end" fontFamily="monospace">
                wpm
            </text>
            <text x={W - PAD.right + 8} y={H - 6} fill={C.sub} fontSize="8" textAnchor="start" fontFamily="monospace">
                sec
            </text>
        </svg>
    );
}


export default function ResultsScreen({ result, onReplay, onNewSong }: ResultsScreenProps) {
    // Keyboard shortcuts on results screen
    const tabRef = useRef(false);
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === 'Tab') { e.preventDefault(); tabRef.current = true; }
            if (e.key === 'Enter' && tabRef.current) { e.preventDefault(); onReplay(); tabRef.current = false; }
        };
        const up = (e: KeyboardEvent) => { if (e.key === 'Tab') tabRef.current = false; };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    }, [onReplay]);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: C.bg, color: C.text, fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-2xl"
            >
                {/* Top section: WPM + Accuracy + Chart */}
                <div className="flex gap-8 items-start mb-6">
                    {/* Left: Big stats */}
                    <div className="flex-shrink-0">
                        <div className="mb-4">
                            <span className="text-sm block" style={{ color: C.sub }}>wpm</span>
                            <motion.span
                                className="text-6xl font-bold font-mono block"
                                style={{ color: C.accent }}
                                initial={{ scale: 0.5, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.2 }}
                            >
                                {result.avgWpm}
                            </motion.span>
                        </div>
                        <div>
                            <span className="text-sm block" style={{ color: C.sub }}>acc</span>
                            <span className="text-4xl font-bold font-mono block" style={{ color: C.text }}>
                                {result.accuracy}%
                            </span>
                        </div>
                    </div>

                    {/* Right: WPM Chart */}
                    <div className="flex-1 min-w-0">
                        <WpmChart history={result.wpmHistory} />
                    </div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-4 gap-3 p-4 rounded mb-6" style={{ background: C.card }}>
                    <Stat label="test type" value={formatTimerLabel(result.timerOption)} accent />
                    <Stat label="raw" value={`${result.avgWpm}`} />
                    <Stat label="words" value={`${result.correctWords}/${result.totalWords}`} />
                    <Stat label="time" value={`${Math.round(result.elapsedMs / 1000)}s`} />
                </div>

                {/* Track info */}
                <p className="text-xs text-center mb-6" style={{ color: C.sub }}>
                    {result.trackName} — {result.artistName}
                </p>

                {/* Action buttons */}
                <div className="flex gap-3">
                    <button onClick={onReplay}
                        className="flex-1 py-3 rounded font-medium text-sm flex flex-col items-center gap-1"
                        style={{ background: '#fff', color: '#333' }}>
                        <span>restart</span>
                        <span className="text-[10px] opacity-60">tab + enter</span>
                    </button>
                    <button onClick={onNewSong}
                        className="flex-1 py-3 rounded font-medium text-sm"
                        style={{ background: C.card, color: C.text }}>
                        new song
                    </button>
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
