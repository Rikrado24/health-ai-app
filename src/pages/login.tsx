import { useCallback, useEffect, useState } from "react";
import { FirebaseError } from "firebase/app";
import { auth, db } from "../services/firebase";
import { signInWithIdentifier } from "../services/authSession";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  fetchSignInMethodsForEmail,
  getRedirectResult,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  type User,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

type GenderOption = "pria" | "wanita" | "tidak_ditentukan";

type RegisterProfile = {
  fullName: string;
  birthDate: string;
  age: number;
  username: string;
  gender: GenderOption;
};

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

const calculateAge = (birthDate: string) => {
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return Math.max(0, age);
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const normalizeUsername = (value: string) => value.trim().toLowerCase();
const isEmailIdentifier = (value: string) => value.includes("@");

const buildFallbackUsername = (email: string | null | undefined) => {
  const localPart = String(email ?? "")
    .split("@")[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  return USERNAME_PATTERN.test(localPart) ? localPart : "";
};

const Login = () => {
  const [fullName, setFullName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [ageInput, setAgeInput] = useState("");
  const [username, setUsername] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [gender, setGender] = useState<GenderOption>("tidak_ditentukan");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const reserveUsername = useCallback(async (user: User, rawUsername: string) => {
    const normalizedUsername = normalizeUsername(rawUsername);
    if (!USERNAME_PATTERN.test(normalizedUsername)) {
      throw new Error("INVALID_USERNAME");
    }
    if (!user.email) {
      throw new Error("EMAIL_REQUIRED");
    }

    try {
      await setDoc(
        doc(db, "usernames", normalizedUsername),
        {
          ownerUid: user.uid,
          ownerEmail: normalizeEmail(user.email),
          username: normalizedUsername,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      if (err instanceof FirebaseError && err.code === "permission-denied") {
        throw new Error("USERNAME_TAKEN");
      }
      throw err;
    }
  }, []);

  const ensureUserProfile = useCallback(async (user: User, registerProfile?: RegisterProfile) => {
    const ref = doc(db, "userProfiles", user.uid);
    const snap = await getDoc(ref);
    const profile = (snap.data() ?? {}) as Record<string, unknown>;
    const desiredUsername = normalizeUsername(
      registerProfile?.username ??
        (typeof profile.username === "string" ? profile.username : buildFallbackUsername(user.email))
    );
    const hasValidUsername = USERNAME_PATTERN.test(desiredUsername);
    let usernameReserved = false;

    if (hasValidUsername) {
      try {
        await reserveUsername(user, desiredUsername);
        usernameReserved = true;
      } catch (err) {
        if (registerProfile) {
          throw err;
        }
      }
    }

    if (!snap.exists()) {
      const payload: Record<string, unknown> = {
        ownerUid: user.uid,
        ownerEmail: normalizeEmail(user.email ?? ""),
        fullName: registerProfile?.fullName ?? user.displayName ?? "",
        birthDate: registerProfile?.birthDate ?? "",
        age: Number(registerProfile?.age ?? 0),
        gender: registerProfile?.gender ?? "tidak_ditentukan",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (usernameReserved) {
        payload.username = desiredUsername;
      }
      await setDoc(ref, payload);
      return;
    }

    if (registerProfile) {
      await setDoc(
        ref,
        {
          ownerUid: user.uid,
          ownerEmail: normalizeEmail(user.email ?? ""),
          fullName: registerProfile.fullName,
          birthDate: registerProfile.birthDate,
          age: Number(registerProfile.age ?? 0),
          username: desiredUsername,
          gender: registerProfile.gender,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }

    if (!profile.username && usernameReserved) {
      await setDoc(
        ref,
        {
          ownerUid: user.uid,
          ownerEmail: normalizeEmail(user.email ?? ""),
          username: desiredUsername,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  }, [reserveUsername]);

  const createGoogleProvider = () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: "select_account",
    });
    return provider;
  };

  const mapGoogleError = (err: unknown) => {
    if (!(err instanceof FirebaseError)) {
      return "Gagal login Google. Coba lagi.";
    }

    switch (err.code) {
      case "auth/operation-not-allowed":
        return "Google Sign-In belum aktif di Firebase Authentication.";
      case "auth/popup-blocked":
        return "Popup diblokir browser. Login dialihkan ke halaman Google.";
      case "auth/popup-closed-by-user":
        return "Popup login ditutup sebelum proses selesai.";
      case "auth/unauthorized-domain":
        return "Domain ini belum diizinkan di Firebase Authentication.";
      case "auth/account-exists-with-different-credential":
        return "Email sudah terdaftar dengan metode login yang berbeda.";
      default: {
        const msg = err.message.toLowerCase();
        if (msg.includes("access blocked") || msg.includes("access_denied") || msg.includes("restricted")) {
          return "Akses Google dibatasi. Gunakan login username/password atau email pemulihan.";
        }
        return err.message;
      }
    }
  };

  useEffect(() => {
    const readRedirectResult = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (!result) return;
        await ensureUserProfile(result.user);
      } catch (err: unknown) {
        setError(mapGoogleError(err));
      }
    };

    void readRedirectResult();
  }, [ensureUserProfile]);

  const mapAuthError = (err: unknown, mode: "register" | "login") => {
    if (err instanceof Error) {
      if (err.message === "USERNAME_TAKEN") {
        return "Username sudah dipakai. Gunakan username lain.";
      }
      if (err.message === "INVALID_USERNAME") {
        return "Username hanya boleh berisi huruf kecil, angka, titik, underscore, atau strip (3-32 karakter).";
      }
      if (err.message === "INVALID_CREDENTIALS") {
        return "Username/email atau password salah.";
      }
      if (err.message === "IDENTIFIER_REQUIRED") {
        return "Isi username atau email terlebih dahulu.";
      }
      if (err.message === "RATE_LIMITED") {
        return "Terlalu banyak percobaan login. Coba lagi beberapa menit.";
      }
      if (err.message === "AUTH_PROVIDER_MISCONFIGURED" || err.message === "AUTH_PROVIDER_ERROR") {
        return "Layanan login sedang bermasalah. Coba lagi sebentar.";
      }
      if (err.message === "AUTH_LOGIN_FAILED" || err.message === "INVALID_LOGIN_REQUEST") {
        return "Permintaan login tidak valid. Coba lagi.";
      }
      if (err.message === "USERNAME_LOGIN_REQUIRES_PROXY") {
        return "Login username butuh backend auth aktif. Untuk lokal sekarang, masuk pakai email atau Google.";
      }
    }

    if (!(err instanceof FirebaseError)) {
      return mode === "register" ? "Gagal membuat akun. Coba lagi." : "Gagal masuk. Coba lagi.";
    }

    switch (err.code) {
      case "auth/email-already-in-use":
        return "Email sudah terdaftar. Silakan masuk memakai email pemulihan tersebut.";
      case "auth/invalid-email":
        return "Format email tidak valid.";
      case "auth/weak-password":
        return "Password terlalu lemah. Gunakan minimal 6 karakter.";
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return mode === "login" ? "Username/email atau password salah." : "Data autentikasi tidak valid.";
      case "auth/too-many-requests":
        return "Terlalu banyak percobaan. Coba lagi beberapa menit.";
      default:
        return err.message || "Terjadi kesalahan autentikasi.";
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");
    setNotice("");

    try {
      if (isRegister) {
        const normalizedEmail = normalizeEmail(email);
        const normalizedUsername = normalizeUsername(username);
        if (!fullName.trim()) {
          setError("Nama lengkap wajib diisi.");
          return;
        }
        if (!birthDate) {
          setError("Tanggal lahir wajib diisi.");
          return;
        }
        const ageValue = Number(ageInput);
        if (!Number.isFinite(ageValue) || ageValue <= 0 || ageValue > 120) {
          setError("Umur wajib diisi dengan angka valid (1-120).");
          return;
        }
        if (!USERNAME_PATTERN.test(normalizedUsername)) {
          setError("Username hanya boleh berisi huruf kecil, angka, titik, underscore, atau strip (3-32 karakter).");
          return;
        }
        if (!normalizedEmail) {
          setError("Email wajib diisi sebagai email pemulihan.");
          return;
        }
        if (!password || password.length < 6) {
          setError("Password minimal 6 karakter.");
          return;
        }
        if (gender === "tidak_ditentukan") {
          setError("Pilih jenis kelamin terlebih dahulu.");
          return;
        }

        const calculatedAge = calculateAge(birthDate);
        if (calculatedAge > 0 && Math.abs(calculatedAge - ageValue) > 1) {
          setError(`Umur tidak sesuai tanggal lahir. Perkiraan dari tanggal lahir: ${calculatedAge} tahun.`);
          return;
        }

        const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
        try {
          await ensureUserProfile(credential.user, {
            fullName: fullName.trim(),
            birthDate,
            age: ageValue,
            username: normalizedUsername,
            gender,
          });
        } catch (profileError) {
          await deleteDoc(doc(db, "usernames", normalizedUsername)).catch(() => undefined);
          await deleteUser(credential.user).catch(() => undefined);
          throw profileError;
        }

        setNotice("Akun berhasil dibuat. Kamu bisa masuk memakai username, dan email tetap jadi jalur pemulihan.");
        return;
      }

      const normalizedIdentifier = normalizeUsername(identifier);
      if (!normalizedIdentifier) {
        setError("Isi username atau email terlebih dahulu.");
        return;
      }

      const result = await signInWithIdentifier(auth, normalizedIdentifier, password);
      await ensureUserProfile(result.user);
      if (isEmailIdentifier(normalizedIdentifier)) {
        setNotice("Masuk menggunakan email pemulihan berhasil.");
      }
    } catch (err: unknown) {
      if (err instanceof FirebaseError && err.code === "auth/email-already-in-use") {
        try {
          const methods = await fetchSignInMethodsForEmail(auth, normalizeEmail(email));
          const viaGoogle = methods.includes("google.com");
          setIsRegister(false);
          setError(
            viaGoogle
              ? "Email ini sudah terdaftar via Google. Klik 'Masuk dengan Google'."
              : "Email sudah terdaftar. Silakan masuk dengan username atau email pemulihan."
          );
          return;
        } catch {
          setIsRegister(false);
        }
      }
      setError(mapAuthError(err, isRegister ? "register" : "login"));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordReset = async () => {
    setResetLoading(true);
    setError("");
    setNotice("");

    try {
      const normalizedIdentifier = normalizeUsername(identifier);
      if (!normalizedIdentifier) {
        setError("Masukkan email pemulihan untuk reset sandi.");
        return;
      }
      if (!isEmailIdentifier(normalizedIdentifier)) {
        setError("Untuk reset sandi, masukkan email pemulihan yang terdaftar.");
        return;
      }

      await sendPasswordResetEmail(auth, normalizeEmail(normalizedIdentifier));
      setNotice("Link reset sandi sudah dikirim. Cek inbox atau folder spam email kamu.");
    } catch (err: unknown) {
      if (err instanceof FirebaseError && (err.code === "auth/invalid-email" || err.code === "auth/user-not-found")) {
        setNotice("Jika email terdaftar, link reset sandi akan dikirim ke alamat tersebut.");
      } else {
        setError(mapAuthError(err, "login"));
      }
    } finally {
      setResetLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setError("");
      setNotice("");
      setGoogleLoading(true);
      const provider = createGoogleProvider();
      const result = await signInWithPopup(auth, provider);
      await ensureUserProfile(result.user);
    } catch (err: unknown) {
      if (err instanceof FirebaseError && err.code === "auth/popup-blocked") {
        const provider = createGoogleProvider();
        await signInWithRedirect(auth, provider);
        return;
      }
      setError(mapGoogleError(err));
    } finally {
      setGoogleLoading(false);
    }
  };

  const toggleMode = () => {
    setIsRegister((prev) => !prev);
    setError("");
    setNotice("");
    setPassword("");
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-3 py-4 text-slate-800 sm:min-h-screen sm:px-4 sm:py-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_0%,rgba(16,185,129,0.2),transparent_34%),radial-gradient(circle_at_94%_16%,rgba(56,189,248,0.22),transparent_40%),linear-gradient(165deg,#eff6f4_0%,#f8fbff_48%,#f1f6ff_100%)]" />
      <div className="pointer-events-none absolute -left-16 top-12 h-56 w-56 rounded-full bg-emerald-200/55 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-0 h-56 w-56 rounded-full bg-sky-200/55 blur-3xl" />

      <div className="relative w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/85 bg-white/70 shadow-[0_36px_80px_-40px_rgba(15,23,42,0.5)] backdrop-blur-xl lg:grid lg:grid-cols-[1.03fr_1fr]">
        <section className="relative hidden overflow-hidden bg-gradient-to-br from-[#0f3b4a] via-[#0b4f58] to-[#0e7a7a] p-8 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full border border-white/20 bg-white/10" />
          <div className="pointer-events-none absolute -bottom-16 -left-8 h-48 w-48 rounded-full border border-white/20 bg-white/10" />
          <div className="relative">
            <p className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
              Android Ready
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight [font-family:var(--font-display)]">
              Health Edukasi
              <br />
              Lebih Nyaman
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-cyan-50/95">
              Pantau tidur, langkah, nutrisi, dan edukasi kesehatan dari satu aplikasi yang ringan untuk penggunaan harian.
            </p>
          </div>
          <div className="relative grid grid-cols-1 gap-3 text-sm">
            <div className="rounded-2xl border border-white/30 bg-white/10 px-4 py-3">
              Login utama dengan username, email tetap aman untuk pemulihan.
            </div>
            <div className="rounded-2xl border border-white/30 bg-white/10 px-4 py-3">
              Sinkron data realtime ke dashboard dengan tampilan mobile-first.
            </div>
          </div>
        </section>

        <section className="relative p-5 sm:p-7 lg:p-8">
          <div className="mx-auto max-w-md space-y-4 sm:space-y-5">
            <div className="space-y-2">
              <p className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                {isRegister ? "Registrasi Baru" : "Masuk Akun"}
              </p>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900 [font-family:var(--font-display)] sm:text-3xl">
                Health Edukasi App
              </h2>
              <p className="text-xs text-slate-500 sm:text-sm">
                {isRegister
                  ? "Daftar akun baru dengan username dan email pemulihan."
                  : "Masuk dengan username, atau gunakan email saat pemulihan akun."}
              </p>
            </div>

            {isRegister ? (
              <>
                <input
                  type="text"
                  placeholder="Nama lengkap"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 p-3 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    type="date"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 p-3 text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    value={birthDate}
                    onChange={(e) => {
                      const value = e.target.value;
                      setBirthDate(value);
                      const autoAge = calculateAge(value);
                      if (autoAge > 0) setAgeInput(String(autoAge));
                    }}
                  />
                  <input
                    type="number"
                    min={1}
                    max={120}
                    placeholder="Umur"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 p-3 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    value={ageInput}
                    onChange={(e) => setAgeInput(e.target.value)}
                  />
                </div>
                <input
                  type="text"
                  placeholder="Username unik (3-32 karakter)"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 p-3 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  value={username}
                  onChange={(e) => setUsername(normalizeUsername(e.target.value))}
                />
                <p className="-mt-2 text-xs text-slate-500">
                  Login utama memakai username. Email dipakai untuk pemulihan akun.
                </p>
              </>
            ) : null}

            {isRegister ? (
              <input
                type="email"
                placeholder="Email pemulihan"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 p-3 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            ) : (
              <input
                type="text"
                placeholder="Username atau email"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 p-3 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            )}

            <input
              type="password"
              placeholder="Password"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 p-3 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            {isRegister ? (
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as GenderOption)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 p-3 text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              >
                <option value="tidak_ditentukan">Jenis kelamin (pilih)</option>
                <option value="pria">Pria</option>
                <option value="wanita">Wanita</option>
              </select>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Jika lupa sandi, masukkan email pemulihan lalu tekan reset sandi.
              </div>
            )}

            {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            {!error && notice ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>
            ) : null}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 p-3 font-semibold text-white shadow-lg shadow-emerald-500/25 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? "Memproses..." : isRegister ? "Daftar" : "Masuk"}
            </button>

            {!isRegister ? (
              <button
                onClick={handlePasswordReset}
                disabled={resetLoading}
                className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {resetLoading ? "Mengirim link reset..." : "Reset Sandi via Email"}
              </button>
            ) : null}

            <button
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
                <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.8-5.4 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 4 1.5l2.7-2.6C17 3.1 14.7 2 12 2a10 10 0 100 20c5.8 0 9.7-4 9.7-9.7 0-.7-.1-1.3-.2-1.8H12z" />
              </svg>
              {googleLoading ? "Menghubungkan..." : "Masuk dengan Google"}
            </button>

            <p className="text-center text-xs text-slate-500">
              Aktivitas harian disinkronkan realtime dari mobile ke dashboard Firebase.
            </p>

            <button type="button" className="w-full text-center text-sm font-medium text-slate-600 underline-offset-4 transition hover:text-slate-900 hover:underline" onClick={toggleMode}>
              {isRegister ? "Sudah punya akun? Masuk" : "Belum punya akun? Daftar"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Login;
