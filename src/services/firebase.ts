import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const isUnsetPlaceholder = (value: string | undefined) => {
  const normalized = value?.trim() ?? "";
  if (!normalized) return true;
  return /your_|your-project-id/i.test(normalized);
};

const readFirebaseEnv = (key: keyof Pick<
  ImportMetaEnv,
  | "VITE_FIREBASE_API_KEY"
  | "VITE_FIREBASE_AUTH_DOMAIN"
  | "VITE_FIREBASE_PROJECT_ID"
  | "VITE_FIREBASE_STORAGE_BUCKET"
  | "VITE_FIREBASE_MESSAGING_SENDER_ID"
  | "VITE_FIREBASE_APP_ID"
  | "VITE_FIREBASE_MEASUREMENT_ID"
  | "VITE_FIREBASE_DATABASE_URL"
>) => {
  const value = import.meta.env[key]?.trim();
  return isUnsetPlaceholder(value) ? "" : value ?? "";
};

const requiredFirebaseEnvByField = {
  apiKey: "VITE_FIREBASE_API_KEY",
  authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
  projectId: "VITE_FIREBASE_PROJECT_ID",
  storageBucket: "VITE_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID",
  appId: "VITE_FIREBASE_APP_ID",
} as const;

const optionalFirebaseEnvByField = {
  measurementId: "VITE_FIREBASE_MEASUREMENT_ID",
  databaseURL: "VITE_FIREBASE_DATABASE_URL",
} as const;

const firebaseConfigValues = {
  apiKey: readFirebaseEnv(requiredFirebaseEnvByField.apiKey),
  authDomain: readFirebaseEnv(requiredFirebaseEnvByField.authDomain),
  projectId: readFirebaseEnv(requiredFirebaseEnvByField.projectId),
  storageBucket: readFirebaseEnv(requiredFirebaseEnvByField.storageBucket),
  messagingSenderId: readFirebaseEnv(requiredFirebaseEnvByField.messagingSenderId),
  appId: readFirebaseEnv(requiredFirebaseEnvByField.appId),
  measurementId: readFirebaseEnv(optionalFirebaseEnvByField.measurementId),
  databaseURL: readFirebaseEnv(optionalFirebaseEnvByField.databaseURL),
};

const missingFirebaseEnvKeys = Object.entries(requiredFirebaseEnvByField)
  .filter(([field]) => !firebaseConfigValues[field as keyof typeof requiredFirebaseEnvByField])
  .map(([, envKey]) => envKey);

export const firebaseConfigError =
  missingFirebaseEnvKeys.length > 0
    ? `Konfigurasi Firebase belum lengkap. Isi variabel ini di .env.local: ${missingFirebaseEnvKeys.join(
        ", "
      )}.`
    : "";

const firebaseConfig = {
  ...firebaseConfigValues,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
