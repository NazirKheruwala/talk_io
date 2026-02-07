// Firebase Client Configuration (v10 Modular SDK)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAVuE-sh2N63FEOPs-EV_R_udhAMCKn3ho",
    authDomain: "talkio-f7365.firebaseapp.com",
    databaseURL: "https://talkio-f7365-default-rtdb.firebaseio.com",
    projectId: "talkio-f7365",
    storageBucket: "talkio-f7365.firebasestorage.app",
    messagingSenderId: "236116066594",
    appId: "1:236116066594:web:e70c79079008ad4e6e657b",
    measurementId: "G-JLGNNVBSWW"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export instances
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
