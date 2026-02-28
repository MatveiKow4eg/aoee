import { initializeApp, getApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

// Firebase web config must be provided via environment variables (Vercel -> Project Settings -> Environment Variables)
// For client-side access in Next.js these MUST be prefixed with NEXT_PUBLIC_.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
} as const;

function assertFirebaseConfig() {
  const missing = Object.entries(firebaseConfig)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    // eslint-disable-next-line no-console
    console.warn(
      "[Firebase] Missing env vars:",
      missing.join(", "),
      "(set NEXT_PUBLIC_FIREBASE_* in Vercel env vars / .env.local)"
    );
  }
}

export function getFirebaseApp(): FirebaseApp {
  if (getApps().length) return getApp();
  assertFirebaseConfig();
  return initializeApp(firebaseConfig as any);
}

export function getDb(): Firestore {
  return getFirestore(getFirebaseApp());
}
