import argparse
import os
import statistics
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Callable

import requests
from dotenv import load_dotenv


load_dotenv()


@dataclass
class Config:
    api_endpoint: str
    device_api_key: str
    owner_uid: str
    owner_email: str
    device_id: str
    weight_sensor_mode: str
    height_sensor_mode: str
    hx_dout_pin: int
    hx_sck_pin: int
    hx_gain: int
    hx_scale_kg: float
    hx_offset: int
    mount_height_cm: float
    tof_height_offset_cm: float
    use_mock_sensors: bool
    auto_tare_on_start: bool
    height_sample_count: int
    weight_sample_count: int
    height_stability_threshold: float
    weight_stability_threshold: float
    sensor_ready_timeout_sec: float
    request_timeout_sec: float


def getenv_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        return int(raw)
    except ValueError:
        return default


def getenv_float(name: str, default: float) -> float:
    raw = os.getenv(name, str(default)).strip()
    try:
        return float(raw)
    except ValueError:
        return default


def load_config() -> Config:
    use_mock = os.getenv("USE_MOCK_SENSORS", "1").strip() == "1"
    return Config(
        api_endpoint=os.getenv(
            "API_ENDPOINT",
            "https://asia-southeast2-sehatai-68f20.cloudfunctions.net/aiProxy/device/measurement",
        ).strip(),
        device_api_key=os.getenv("DEVICE_API_KEY", "").strip(),
        owner_uid=os.getenv("OWNER_UID", "").strip(),
        owner_email=os.getenv("OWNER_EMAIL", "").strip().lower(),
        device_id=os.getenv("DEVICE_ID", "raspi-device-1").strip(),
        weight_sensor_mode=os.getenv("WEIGHT_SENSOR_MODE", "hx711").strip().lower(),
        height_sensor_mode=os.getenv("HEIGHT_SENSOR_MODE", "tof").strip().lower(),
        hx_dout_pin=getenv_int("HX711_DOUT_PIN", 5),
        hx_sck_pin=getenv_int("HX711_SCK_PIN", 6),
        hx_gain=getenv_int("HX711_GAIN", 128),
        hx_scale_kg=getenv_float("HX711_SCALE_KG", 100000.0),
        hx_offset=getenv_int("HX711_OFFSET", 0),
        mount_height_cm=getenv_float("MOUNT_HEIGHT_CM", 200.0),
        tof_height_offset_cm=getenv_float("TOF_HEIGHT_OFFSET_CM", 0.0),
        use_mock_sensors=use_mock,
        auto_tare_on_start=os.getenv("AUTO_TARE_ON_START", "1").strip() == "1",
        height_sample_count=max(4, getenv_int("HEIGHT_SAMPLE_COUNT", 8)),
        weight_sample_count=max(4, getenv_int("WEIGHT_SAMPLE_COUNT", 8)),
        height_stability_threshold=max(0.1, getenv_float("HEIGHT_STABILITY_THRESHOLD", 0.8)),
        weight_stability_threshold=max(0.05, getenv_float("WEIGHT_STABILITY_THRESHOLD", 0.2)),
        sensor_ready_timeout_sec=max(0.1, getenv_float("SENSOR_READY_TIMEOUT_SEC", 2.0)),
        request_timeout_sec=max(3.0, getenv_float("REQUEST_TIMEOUT_SEC", 15.0)),
    )


def validate_config(config: Config) -> None:
    missing = []
    if not config.device_api_key:
        missing.append("DEVICE_API_KEY")
    if not config.owner_uid:
        missing.append("OWNER_UID")
    if not config.owner_email:
        missing.append("OWNER_EMAIL")
    if missing:
        raise ValueError(f"Konfigurasi belum lengkap: {', '.join(missing)}")

    if config.weight_sensor_mode not in {"hx711", "mock"}:
        raise ValueError("WEIGHT_SENSOR_MODE harus 'hx711' atau 'mock'.")
    if config.height_sensor_mode not in {"tof", "mock"}:
        raise ValueError("HEIGHT_SENSOR_MODE harus 'tof' atau 'mock'.")
    if config.hx_gain not in {128, 64, 32}:
        raise ValueError("HX711_GAIN hanya boleh 128, 64, atau 32.")
    if config.mount_height_cm < 120 or config.mount_height_cm > 260:
        raise ValueError("MOUNT_HEIGHT_CM disarankan antara 120 sampai 260 cm.")


class HX711Reader:
    def __init__(self, dout_pin: int, sck_pin: int, gain: int = 128, offset: int = 0, scale_kg: float = 100000.0):
        try:
            import RPi.GPIO as GPIO  # type: ignore
        except Exception as err:
            raise RuntimeError(
                "RPi.GPIO belum tersedia. Install dengan: pip install RPi.GPIO"
            ) from err

        self.GPIO = GPIO
        self.dout_pin = dout_pin
        self.sck_pin = sck_pin
        self.gain = gain
        self.offset = offset
        self.scale_kg = scale_kg

        self.GPIO.setmode(self.GPIO.BCM)
        self.GPIO.setup(self.sck_pin, self.GPIO.OUT)
        self.GPIO.setup(self.dout_pin, self.GPIO.IN)
        self.GPIO.output(self.sck_pin, False)
        self._set_gain(self.gain)

    def _set_gain(self, gain: int) -> None:
        self.gain = gain
        if gain == 128:
            self._gain_pulses = 1
        elif gain == 64:
            self._gain_pulses = 3
        elif gain == 32:
            self._gain_pulses = 2
        else:
            raise ValueError("Gain HX711 tidak valid.")

    def _wait_ready(self, timeout_sec: float) -> None:
        start = time.time()
        while self.GPIO.input(self.dout_pin) == 1:
            if time.time() - start > timeout_sec:
                raise TimeoutError("HX711 timeout: data tidak siap.")
            time.sleep(0.001)

    def read_raw(self, timeout_sec: float = 2.0) -> int:
        self._wait_ready(timeout_sec)

        value = 0
        for _ in range(24):
            self.GPIO.output(self.sck_pin, True)
            value = (value << 1) | int(self.GPIO.input(self.dout_pin))
            self.GPIO.output(self.sck_pin, False)

        for _ in range(self._gain_pulses):
            self.GPIO.output(self.sck_pin, True)
            self.GPIO.output(self.sck_pin, False)

        if value & 0x800000:
            value -= 0x1000000
        return value

    def read_average_raw(self, samples: int = 8, timeout_sec: float = 2.0) -> int:
        values = [self.read_raw(timeout_sec=timeout_sec) for _ in range(samples)]
        return int(sum(values) / len(values))

    def tare(self, samples: int = 12, timeout_sec: float = 2.0) -> int:
        self.offset = self.read_average_raw(samples=samples, timeout_sec=timeout_sec)
        return self.offset

    def read_weight_kg(self, timeout_sec: float = 2.0) -> float:
        if self.scale_kg == 0:
            raise RuntimeError("HX711_SCALE_KG tidak boleh 0.")
        raw = self.read_raw(timeout_sec=timeout_sec)
        return (raw - self.offset) / self.scale_kg

    def cleanup(self) -> None:
        try:
            self.GPIO.cleanup()
        except Exception:
            pass


class ToFHeightReader:
    def __init__(self, mount_height_cm: float, offset_cm: float = 0.0):
        try:
            import board  # type: ignore
            import busio  # type: ignore
            import adafruit_vl53l0x  # type: ignore
        except Exception as err:
            raise RuntimeError(
                "Library ToF belum tersedia. Install: pip install adafruit-blinka adafruit-circuitpython-vl53l0x"
            ) from err

        i2c = busio.I2C(board.SCL, board.SDA)
        self.sensor = adafruit_vl53l0x.VL53L0X(i2c)
        self.mount_height_cm = mount_height_cm
        self.offset_cm = offset_cm

    def read_height_cm(self) -> float:
        distance_mm = int(self.sensor.range)
        if distance_mm <= 0:
            raise RuntimeError("Sensor ToF mengembalikan jarak tidak valid.")
        distance_cm = distance_mm / 10.0
        height_cm = self.mount_height_cm - distance_cm + self.offset_cm
        return height_cm


def read_weight_sensor_once(config: Config, hx_reader: HX711Reader | None) -> float:
    if config.use_mock_sensors or config.weight_sensor_mode == "mock":
        baseline = 63.0
        noise = (time.time() % 1) - 0.5
        return baseline + noise * 0.4
    if hx_reader is None:
        raise RuntimeError("HX711 reader belum diinisialisasi.")
    weight = hx_reader.read_weight_kg(timeout_sec=config.sensor_ready_timeout_sec)
    if weight < 10 or weight > 350:
        raise RuntimeError(f"Berat di luar batas masuk akal: {weight:.2f} kg")
    return weight


def read_height_sensor_once(config: Config, tof_reader: ToFHeightReader | None) -> float:
    if config.use_mock_sensors or config.height_sensor_mode == "mock":
        baseline = 170.0
        noise = (time.time() % 1) - 0.5
        return baseline + noise * 1.2
    if tof_reader is None:
        raise RuntimeError("ToF reader belum diinisialisasi.")
    height = tof_reader.read_height_cm()
    if height < 50 or height > 250:
        raise RuntimeError(f"Tinggi di luar batas masuk akal: {height:.2f} cm")
    return height


def stabilize_reading(sample_fn: Callable[[], float], sample_count: int, threshold: float, label: str) -> float:
    samples = []
    attempts = 0
    max_attempts = sample_count * 6

    while attempts < max_attempts:
        value = sample_fn()
        samples.append(value)
        if len(samples) > sample_count:
            samples.pop(0)

        if len(samples) >= sample_count:
            stdev = statistics.pstdev(samples)
            mean_value = statistics.mean(samples)
            print(f"{label} stabilitas: mean={mean_value:.2f}, stdev={stdev:.3f}")
            if stdev <= threshold:
                return round(mean_value, 1)

        attempts += 1
        time.sleep(0.2)

    raise RuntimeError(f"{label} tidak stabil. Coba ulangi pengukuran.")


def send_measurement(config: Config, height_cm: float, weight_kg: float) -> None:
    measured_at_ms = int(time.time() * 1000)
    session_id = f"raspi-{measured_at_ms}"
    payload = {
        "ownerUid": config.owner_uid,
        "ownerEmail": config.owner_email,
        "heightCm": float(height_cm),
        "weightKg": float(weight_kg),
        "measuredAtMs": measured_at_ms,
        "deviceId": config.device_id,
        "sessionId": session_id,
    }
    headers = {
        "Content-Type": "application/json",
        "x-device-key": config.device_api_key,
    }

    response = requests.post(
        config.api_endpoint,
        json=payload,
        headers=headers,
        timeout=config.request_timeout_sec,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Gagal kirim data ({response.status_code}): {response.text}")
    print("Kirim data berhasil:", response.text)


def run_tare_mode(config: Config, hx_reader: HX711Reader | None) -> None:
    if hx_reader is None:
        raise RuntimeError("Mode tare butuh sensor HX711 real (bukan mock).")
    print("Pastikan timbangan kosong, lalu tunggu tare selesai...")
    offset = hx_reader.tare(samples=15, timeout_sec=config.sensor_ready_timeout_sec)
    print(f"Tare selesai. Simpan nilai ini ke .env -> HX711_OFFSET={offset}")


def run_calibration_mode(config: Config, hx_reader: HX711Reader | None, known_weight_kg: float) -> None:
    if hx_reader is None:
        raise RuntimeError("Mode kalibrasi butuh sensor HX711 real (bukan mock).")
    if known_weight_kg <= 0:
        raise ValueError("--known-weight harus lebih dari 0.")

    print("Langkah kalibrasi:")
    print("1) Pastikan timbangan kosong -> tare")
    offset = hx_reader.tare(samples=15, timeout_sec=config.sensor_ready_timeout_sec)
    print(f"Offset tare: {offset}")

    print(f"2) Letakkan beban referensi {known_weight_kg:.3f} kg, lalu tunggu...")
    loaded_raw = hx_reader.read_average_raw(samples=20, timeout_sec=config.sensor_ready_timeout_sec)
    delta = loaded_raw - offset
    if delta == 0:
        raise RuntimeError("Selisih kalibrasi 0. Periksa wiring/load cell.")

    scale = delta / known_weight_kg
    print(f"Kalibrasi selesai. Simpan nilai ini ke .env -> HX711_SCALE_KG={scale:.3f}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Raspberry measurement client (height + weight).")
    parser.add_argument(
        "--mode",
        choices=["run", "tare", "calibrate"],
        default="run",
        help="run=ukur+kirim, tare=ambil offset kosong, calibrate=hitung skala HX711",
    )
    parser.add_argument(
        "--known-weight",
        type=float,
        default=0.0,
        help="Berat referensi (kg) untuk mode calibrate.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = load_config()
    validate_config(config)

    print("Raspberry Measurement Client siap.")
    print(f"Target user: {config.owner_email} ({config.owner_uid})")
    print(
        f"Mode sensor: weight={config.weight_sensor_mode}, height={config.height_sensor_mode}, "
        f"mock={'YA' if config.use_mock_sensors else 'TIDAK'}"
    )

    hx_reader = None
    tof_reader = None
    try:
        if not config.use_mock_sensors and config.weight_sensor_mode == "hx711":
            hx_reader = HX711Reader(
                dout_pin=config.hx_dout_pin,
                sck_pin=config.hx_sck_pin,
                gain=config.hx_gain,
                offset=config.hx_offset,
                scale_kg=config.hx_scale_kg,
            )
            if config.auto_tare_on_start and args.mode == "run":
                print("AUTO_TARE_ON_START aktif: tare timbangan kosong...")
                offset = hx_reader.tare(samples=12, timeout_sec=config.sensor_ready_timeout_sec)
                print(f"Offset runtime: {offset}")

        if not config.use_mock_sensors and config.height_sensor_mode == "tof":
            tof_reader = ToFHeightReader(
                mount_height_cm=config.mount_height_cm,
                offset_cm=config.tof_height_offset_cm,
            )

        if args.mode == "tare":
            run_tare_mode(config, hx_reader)
            return
        if args.mode == "calibrate":
            run_calibration_mode(config, hx_reader, args.known_weight)
            return

        while True:
            try:
                input("\nTekan Enter untuk mulai pengukuran (Ctrl+C untuk keluar)... ")
                print("Mengukur berat...")
                weight_kg = stabilize_reading(
                    lambda: read_weight_sensor_once(config, hx_reader),
                    sample_count=config.weight_sample_count,
                    threshold=config.weight_stability_threshold,
                    label="Berat",
                )
                print("Mengukur tinggi...")
                height_cm = stabilize_reading(
                    lambda: read_height_sensor_once(config, tof_reader),
                    sample_count=config.height_sample_count,
                    threshold=config.height_stability_threshold,
                    label="Tinggi",
                )

                print(
                    f"Hasil final: tinggi={height_cm:.1f} cm, berat={weight_kg:.1f} kg "
                    f"({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})"
                )
                send_measurement(config, height_cm=height_cm, weight_kg=weight_kg)
            except KeyboardInterrupt:
                print("\nKeluar dari client.")
                break
            except Exception as err:
                print(f"Error pengukuran: {err}")
    finally:
        if hx_reader is not None:
            hx_reader.cleanup()


if __name__ == "__main__":
    main()
