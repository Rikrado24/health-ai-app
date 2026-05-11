# Integrasi Raspberry Pi (Tinggi + Berat)

Folder ini berisi kode siap pakai agar alat Raspberry Pi bisa kirim hasil pengukuran ke aplikasi.

Alur:
1. Tekan Enter (atau nanti bisa diganti tombol fisik).
2. Python membaca tinggi + berat hingga stabil.
3. Python kirim 1 payload pengukuran ke endpoint backend.
4. Backend menyimpan ke `healthData` dengan source `raspi_measurement`.

## 1) Siapkan Endpoint Backend

Endpoint sudah disiapkan pada Firebase Function:

- `POST https://asia-southeast2-sehatai-68f20.cloudfunctions.net/aiProxy/device/measurement`

Header wajib:

- `x-device-key: <DEVICE_INGEST_API_KEY>`

Payload wajib:

```json
{
  "ownerUid": "uid-user",
  "ownerEmail": "user@email.com",
  "heightCm": 170.2,
  "weightKg": 63.4,
  "measuredAtMs": 1778486400000,
  "deviceId": "raspi-clinic-01",
  "sessionId": "raspi-1715410000000"
}
```

## 2) Setup Python di Raspberry

Masuk ke folder `docs/raspberry`, lalu:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Isi `.env`:

- `API_ENDPOINT`
- `DEVICE_API_KEY`
- `OWNER_UID`
- `OWNER_EMAIL`

## 3) Jalankan

```bash
python raspi_measurement_client.py
```

Mode tambahan:

```bash
# Ambil nilai offset tare (timbangan kosong)
python raspi_measurement_client.py --mode tare

# Kalibrasi scale factor HX711 dengan beban referensi (contoh 10 kg)
python raspi_measurement_client.py --mode calibrate --known-weight 10
```

Saat hardware belum siap, gunakan mode mock:

- `USE_MOCK_SENSORS=1`

Saat hardware siap:

- set `USE_MOCK_SENSORS=0`
- pakai `WEIGHT_SENSOR_MODE=hx711`
- pakai `HEIGHT_SENSOR_MODE=tof`
- isi pin HX711 dan parameter tinggi pada `.env`

## 4) Catatan Sensor

- Berat: load cell + HX711
- Tinggi: ToF (mis. VL53L0X) lebih stabil untuk tinggi badan
- Kode sudah disiapkan dengan stabilisasi bacaan agar data tidak loncat-loncat.
- Tinggi dihitung dari rumus: `tinggi = MOUNT_HEIGHT_CM - jarak_sensor_cm + TOF_HEIGHT_OFFSET_CM`
