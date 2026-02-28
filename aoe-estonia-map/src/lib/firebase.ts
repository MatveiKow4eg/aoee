import { initializeApp, getApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

// NOTE: as requested, config is inlined (no .env.local).
// This config is *public* for web apps (not a secret), but anyone can see it in the client bundle.
const firebaseConfig = {
  apiKey: "AIzaSyALK8zwrweJb5zCalD4KdjiTUccctEkAAs",
  authDomain: "oaee-e12aa.firebaseapp.com",
  projectId: "oaee-e12aa",
  storageBucket: "oaee-e12aa.firebasestorage.app",
  messagingSenderId: "835554405323",
  appId: "1:835554405323:web:ea854fa8552421dd58244e",
  measurementId: "G-EEDNZ7BBDG",
} as const;

export function getFirebaseApp(): FirebaseApp {
  if (getApps().length) return getApp();
  return initializeApp(firebaseConfig);
}

export function getDb(): Firestore {
  return getFirestore(getFirebaseApp());
}
