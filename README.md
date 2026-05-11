# Health AI App

Health monitoring app built with React, Vite, Firebase, Capacitor Android, and Firebase Functions.

Core capabilities:
- Login with username or recovery email
- Firebase Auth + Firestore health records
- AI-assisted health education through a server-side OpenAI proxy
- GPS-based activity sync with offline queue
- PWA install flow and Android packaging via Capacitor

## Architecture

- Frontend: React 19 + TypeScript + Vite
- Backend: Firebase Functions v2
- Database: Cloud Firestore
- Native wrapper: Capacitor Android

Important security decisions:
- Frontend no longer keeps a hardcoded fallback Firebase production config
- Username login is resolved server-side, so the browser never receives the user's recovery email
- Admin access is driven by Firebase Auth custom claims, not frontend env flags

## Frontend Setup

1. Copy `.env.example` to `.env.local`
2. Fill all `VITE_FIREBASE_*` values with your Firebase web app config
3. Install dependencies:
   - `npm install`
4. Run development server:
   - `npm run dev`

Local API note:
- In local Vite mode, `/api/*` now proxies to Firebase Function `aiProxy`.
- Default proxy target: `https://asia-southeast2-sehatai-68f20.cloudfunctions.net/aiProxy`
- To override (for another project or emulator), set `VITE_DEV_API_PROXY_TARGET` in `.env.local`.
- If backend proxy is not reachable, localhost can fallback to direct OpenAI call using `VITE_OPENAI_API_KEY` (dev-only).

If Firebase env is incomplete, the app now stops early with a configuration warning instead of silently targeting a production project.

## Backend Setup

Required Firebase Functions env:
- `OPENAI_API_KEY`
- `FIREBASE_WEB_API_KEY`
- `ADMIN_EMAILS`

Optional backend env:
- `SUPER_ADMIN_EMAILS`
- `ALLOWED_ORIGINS`
- `OPENAI_ALLOWED_RESPONSE_MODELS`
- `OPENAI_ALLOWED_TRANSCRIPTION_MODELS`
- `OPENAI_PROXY_ENABLED`
- `DEVICE_INGEST_API_KEYS` (untuk integrasi alat Raspberry Pi)

Recommended:
- Store `OPENAI_API_KEY` as a Functions secret
- Provide `FIREBASE_WEB_API_KEY`, `ADMIN_EMAILS`, and optional `SUPER_ADMIN_EMAILS` through `functions/.env`, `functions/.env.<project>`, or the Cloud Functions runtime environment

Example `functions/.env`:

```bash
OPENAI_API_KEY=...
FIREBASE_WEB_API_KEY=...
ADMIN_EMAILS=admin1@example.com,admin2@example.com
SUPER_ADMIN_EMAILS=admin1@example.com
OPENAI_ALLOWED_RESPONSE_MODELS=gpt-5.2,gpt-4.1-mini,gpt-4.1
```

Install and build functions:

```bash
npm --prefix functions install
npm --prefix functions run build
```

## Auth Notes

- Registration stores the recovery email in Firebase Auth and the chosen username in Firestore
- Login accepts `username` or `email`
- Username resolution happens only inside Firebase Functions `/api/auth/login`
- Admin and super admin access are synchronized to Firebase Auth custom claims via `/api/auth/session/bootstrap`

## AI Proxy

Frontend AI requests use `/api/openai/...` and require a signed-in Firebase user.

Supported endpoints:
- `/api/openai/responses`
- `/api/openai/transcriptions`

The browser never receives the OpenAI secret key.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run preview`
- `npm run cap:sync`
- `npm run cap:android`
- `npm run android:setup`
- `npm run android:debug`
- `npm run android:release`
- `npm run hosting:deploy`
- `npm run hosting:channel`
- `npm run functions:build`
- `npm run functions:deploy`
- `npm run app:deploy:full`

## Android / PWA

PWA:
- Run `npm run dev` or deploy hosting
- Install from mobile browser using the platform install flow

Android:
- Install Android Studio + JDK 17
- Run `npm run cap:sync`
- Run `npm run cap:android`

Android release signing (recommended secure mode):
- `android/app/build.gradle` now supports environment variables:
  - `ANDROID_KEYSTORE_FILE`
  - `ANDROID_KEYSTORE_PASSWORD`
  - `ANDROID_KEY_ALIAS`
  - `ANDROID_KEY_PASSWORD`
- If these variables are set, Gradle can sign release builds without relying on `android/keystore.properties`.
- Keep `android/keystore.properties` and `android/keystore.credentials.txt` local-only and never share them.

## Realtime Activity Sync

The app writes GPS-derived activity samples to Firestore collection `deviceActivity`.

Expected document schema:
- `ownerEmail`: `string`
- `ownerUid`: `string`
- `steps`: `number`
- `calories`: `number`
- `distanceMeters`: `number`
- `speedMps`: `number`
- `source`: `string`
- `timestamp`: Firestore `Timestamp`

When a new `deviceActivity` document arrives, the app writes a normalized record to `healthData` with source `device_activity`.

Notes:
- User must grant location permission in app/browser
- GPS-based step estimation is approximate and not medical-grade

## Raspberry Pi Measurement Ingest

Backend endpoint untuk alat tinggi/berat:

- `POST /device/measurement` via function `aiProxy`
- Header: `x-device-key` (harus cocok dengan salah satu nilai pada `DEVICE_INGEST_API_KEYS`)

Payload minimum:
- `ownerUid`
- `ownerEmail`
- `heightCm`
- `weightKg`

Ketika request valid, backend akan:
- Simpan log ke koleksi `deviceMeasurements`
- Simpan data sinkron ke koleksi `healthData` dengan `source: "raspi_measurement"`

Kode client Python siap pakai ada di:
- `docs/raspberry/`

## Deployment

Hosting is configured for Firebase project `sehatai-68f20`.

Commands:
- `npm run hosting:deploy`
- `npm run hosting:channel`
- `npm run app:deploy:full`

If this machine has not authenticated with Firebase yet:
   
```bash
npx firebase-tools login
```
