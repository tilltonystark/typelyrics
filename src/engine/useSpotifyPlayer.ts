import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Spotify Web Playback SDK hook.
 *
 * Flow:
 * 1. User clicks "Connect Spotify" → redirected to /auth/spotify
 * 2. After OAuth, backend stores token in session
 * 3. SDK loads and creates a player device in the browser
 * 4. When user selects a song, we search Spotify for the track URI
 * 5. We start playback on the in-browser device
 */

interface SpotifyPlayerState {
    connected: boolean;
    playing: boolean;
    trackName: string;
    artistName: string;
    albumArt: string;
    positionMs: number;
    durationMs: number;
    deviceId: string | null;
}

interface UseSpotifyPlayerReturn {
    state: SpotifyPlayerState;
    connect: () => void;
    play: (spotifyUri: string) => Promise<void>;
    pause: () => void;
    resume: () => void;
    seek: (positionMs: number) => void;
    searchTrack: (trackName: string, artistName: string) => Promise<string | null>;
    disconnect: () => void;
}

const INITIAL_STATE: SpotifyPlayerState = {
    connected: false,
    playing: false,
    trackName: '',
    artistName: '',
    albumArt: '',
    positionMs: 0,
    durationMs: 0,
    deviceId: null,
};

// Extend window for Spotify SDK
declare global {
    interface Window {
        Spotify: typeof Spotify;
        onSpotifyWebPlaybackSDKReady: () => void;
    }
}

export function useSpotifyPlayer(): UseSpotifyPlayerReturn {
    const [state, setState] = useState<SpotifyPlayerState>(INITIAL_STATE);
    const playerRef = useRef<Spotify.Player | null>(null);
    const tokenRef = useRef<string | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval>>();

    // Load SDK script
    const loadSDK = useCallback(() => {
        if (document.getElementById('spotify-sdk')) return;
        const script = document.createElement('script');
        script.id = 'spotify-sdk';
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        document.body.appendChild(script);
    }, []);

    // Get token from our backend
    const getToken = useCallback(async (): Promise<string | null> => {
        try {
            const res = await fetch('/auth/spotify/token', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                tokenRef.current = data.access_token;
                return data.access_token;
            }
        } catch { /* not connected */ }
        return null;
    }, []);

    // Initialize player when SDK is ready
    const initPlayer = useCallback(async () => {
        const token = await getToken();
        if (!token) return;

        const player = new window.Spotify.Player({
            name: 'Lyritype',
            getOAuthToken: (cb: (token: string) => void) => {
                getToken().then(t => cb(t || ''));
            },
            volume: 0.8,
        });

        player.addListener('ready', ({ device_id }: { device_id: string }) => {
            setState(prev => ({ ...prev, connected: true, deviceId: device_id }));
        });

        player.addListener('not_ready', () => {
            setState(prev => ({ ...prev, connected: false, deviceId: null }));
        });

        player.addListener('player_state_changed', (playerState: Spotify.PlaybackState | null) => {
            if (!playerState) return;
            const track = playerState.track_window.current_track;
            setState(prev => ({
                ...prev,
                playing: !playerState.paused,
                trackName: track.name,
                artistName: track.artists.map((a: { name: string }) => a.name).join(', '),
                albumArt: track.album.images[0]?.url || '',
                positionMs: playerState.position,
                durationMs: playerState.duration,
            }));
        });

        player.addListener('initialization_error', ({ message }: { message: string }) => {
            console.error('Spotify init error:', message);
        });

        player.addListener('authentication_error', ({ message }: { message: string }) => {
            console.error('Spotify auth error:', message);
            setState(prev => ({ ...prev, connected: false }));
        });

        await player.connect();
        playerRef.current = player;

        // Position update interval
        intervalRef.current = setInterval(async () => {
            const s = await player.getCurrentState();
            if (s) {
                setState(prev => ({ ...prev, positionMs: s.position }));
            }
        }, 500);
    }, [getToken]);

    // Check if already connected on mount
    useEffect(() => {
        let cancelled = false;
        getToken().then(token => {
            if (token && !cancelled) {
                // Token exists — load SDK and init player
                // connected will be set to true only when SDK fires 'ready' event
                loadSDK();
                window.onSpotifyWebPlaybackSDKReady = () => {
                    if (!cancelled) initPlayer();
                };
                if (window.Spotify) initPlayer();
            }
        });
        return () => {
            cancelled = true;
            clearInterval(intervalRef.current);
            playerRef.current?.disconnect();
        };
    }, []);

    const connect = useCallback(() => {
        // Redirect to Spotify OAuth
        window.location.href = '/auth/spotify';
    }, []);

    const play = useCallback(async (spotifyUri: string) => {
        if (!state.deviceId || !tokenRef.current) return;
        try {
            await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${state.deviceId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${tokenRef.current}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ uris: [spotifyUri] }),
            });
        } catch (err) {
            console.error('Play failed:', err);
        }
    }, [state.deviceId]);

    const pause = useCallback(() => {
        playerRef.current?.pause();
    }, []);

    const resume = useCallback(() => {
        playerRef.current?.resume();
    }, []);

    const seek = useCallback((positionMs: number) => {
        playerRef.current?.seek(positionMs);
    }, []);

    const searchTrack = useCallback(async (trackName: string, artistName: string): Promise<string | null> => {
        try {
            const q = `${trackName} ${artistName}`;
            const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}`);
            if (res.ok) {
                const data = await res.json();
                return data.uri || null;
            }
        } catch { /* ignore */ }
        return null;
    }, []);

    const disconnect = useCallback(() => {
        playerRef.current?.disconnect();
        playerRef.current = null;
        clearInterval(intervalRef.current);
        setState(INITIAL_STATE);
    }, []);

    return { state, connect, play, pause, resume, seek, searchTrack, disconnect };
}
