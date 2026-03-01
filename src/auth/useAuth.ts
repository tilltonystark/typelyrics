import { useState, useEffect, useCallback } from 'react';
import {
    User,
    signInWithPopup,
    GoogleAuthProvider,
    signOut as firebaseSignOut,
    onAuthStateChanged,
} from 'firebase/auth';
import { auth } from './firebaseConfig';

interface UseAuthReturn {
    user: User | null;
    loading: boolean;
    signInWithGoogle: () => Promise<void>;
    signOut: () => Promise<void>;
}

const googleProvider = new GoogleAuthProvider();

export function useAuth(): UseAuthReturn {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            setUser(firebaseUser);
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    const signInWithGoogle = useCallback(async () => {
        try {
            await signInWithPopup(auth, googleProvider);
        } catch (err) {
            console.error('Google sign-in failed:', err);
        }
    }, []);

    const signOut = useCallback(async () => {
        try {
            await firebaseSignOut(auth);
        } catch (err) {
            console.error('Sign-out failed:', err);
        }
    }, []);

    return { user, loading, signInWithGoogle, signOut };
}
