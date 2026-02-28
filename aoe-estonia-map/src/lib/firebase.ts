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

const missingFirebaseKeys = () =>
  Object.entries(firebaseConfig)
    .filter(([, v]) => !v)
    .map(([k]) => k);

let warnedMissing = false;

function warnMissingOnce(missing: string[]) {
  if (warnedMissing) return;
  warnedMissing = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[Firebase] Missing env vars:",
    missing.join(", "),
    "(set NEXT_PUBLIC_FIREBASE_* in Vercel env vars / .env.local)"
  );
}

/**
 * Returns Firebase app or null if config is missing.
 * This allows the UI to work with local fallback data in environments without Firebase configured.
 */
export function getFirebaseApp(): FirebaseApp | null {
  if (getApps().length) return getApp();

  const missing = missingFirebaseKeys();
  if (missing.length) {
    warnMissingOnce(missing);
    return null;
  }

  return initializeApp(firebaseConfig as any);
}

/**
 * Returns Firestore instance or null if Firebase is not configured.
 */
export function getDb(): Firestore | null {
  const app = getFirebaseApp();
  if (!app) return null;
  return getFirestore(app);
}
