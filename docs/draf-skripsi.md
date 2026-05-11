# Draf Skripsi - Implementasi Rumus Dashboard Kesehatan

Tanggal pembaruan: 11 Maret 2026

## Ringkasan Pekerjaan
Pada sesi ini dilakukan implementasi rumus kesehatan pada kartu ringkasan dashboard agar perhitungan tidak lagi berbasis placeholder.

## Rumus yang Diterapkan
1. IMT (BMI): berat (kg) / tinggi (m)^2
2. Skor IMT ideal: 100% pada IMT 18.5-25, menurun di luar rentang
3. BMR (Mifflin-St Jeor):
   - Pria: 10*berat + 6.25*tinggi - 5*usia + 5
   - Wanita: 10*berat + 6.25*tinggi - 5*usia - 161
   - Tidak ditentukan: rata-rata pria dan wanita
4. Skor langkah: langkah/8000 (dibatasi 0-100%)
5. Skor tidur:
   - <7 jam: proporsional ke target 7 jam
   - 7-9 jam: 100%
   - >9 jam: penalti bertahap
6. Skor detak jantung: target normal 60-100 bpm, penalti di bawah/atas batas
7. Skor tekanan darah: gabungan skor sistolik dan diastolik, target <120/<80
8. Skor pola makan: berbasis komponen Isi Piringku (karbo, protein, sayur, buah, air)

## Lokasi Implementasi Kode
File utama:
- `src/pages/Dashboard.tsx`

Bagian fungsi rumus:
- `calculateBmi`
- `scoreBmiIdeal`
- `calculateBmr`
- `scoreSleepDuration`
- `scoreHeartRate`
- `scoreBloodPressure`

Bagian penggunaan rumus:
- `overviewCards` pada `src/pages/Dashboard.tsx`

## Catatan Validasi
Build proyek berhasil dijalankan setelah perubahan:
- perintah: `npm run build`
- hasil: sukses tanpa error TypeScript/Vite

## Catatan untuk Bab Metode Skripsi
1. Jelaskan alasan pemilihan indikator: aktivitas, antropometri, energi, tidur, kardiovaskular, nutrisi.
2. Tulis definisi operasional setiap variabel input.
3. Tampilkan rumus, rentang normal, dan cara konversi ke skor 0-100%.
4. Jelaskan bahwa skor dipakai untuk visualisasi progres pengguna harian.

