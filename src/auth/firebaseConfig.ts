import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
    apiKey: "AIzaSyAVr3xx0KLwaX_XbFuQY3aD1kkErpGzK8A",
    authDomain: "typelyrics-61143.firebaseapp.com",
    projectId: "typelyrics-61143",
    storageBucket: "typelyrics-61143.firebasestorage.app",
    messagingSenderId: "801588447826",
    appId: "1:801588447826:web:6e2c319273e56b2a7eed8b",
    measurementId: "G-94MM661W6Z",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export default app;
