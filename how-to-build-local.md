# Hướng dẫn build APK local (không dùng lượt EAS cloud)

> Áp dụng khi hết lượt build trên EAS cloud. Build ngay trên máy Mac, ra file APK y hệt bản build cloud.
> ✅ **Đã setup xong và build thành công lần đầu ngày 30/07/2026** (versionCode 15, APK 79MB, ~19 phút Gradle).

## Build lần sau — chỉ cần 1 lệnh

Môi trường đã cài đặt đầy đủ, chỉ cần chạy:

```bash
eas build --platform android --profile production --local
```

- APK xuất ra tại thư mục gốc project, dạng `build-xxxxxxxxxx.apk` (đã có `*.apk` trong `.gitignore`).
- Các lần build sau nhanh hơn lần đầu nhiều nhờ Gradle cache.
- Muốn build bản preview: đổi `--profile production` thành `--profile preview`.

**Cài APK lên máy Android:**
- Copy file APK qua điện thoại rồi mở để cài, hoặc
- Cắm cáp USB (bật USB debugging): `adb install build-xxxxxxxxxx.apk`

---

## Trạng thái máy (cập nhật 30/07/2026)

| Thành phần | Trạng thái |
|---|---|
| JDK 17 (Homebrew) | ✅ Đã có |
| EAS CLI 20.5.1 | ✅ Đã có |
| Android SDK (`~/Library/Android/sdk`) | ✅ Đã cài (30/07/2026) |
| platform-tools, android-36, build-tools 36.0.0, NDK 27.1.12297006 | ✅ Đã cài, license đã chấp nhận |
| `ANDROID_HOME` trong `~/.zshrc` | ✅ Đã cấu hình |
| Thư mục `android/` (đã prebuild) | ✅ Đã có |

---

## Cách 1 (Khuyên dùng): `eas build --local`

Chạy đúng pipeline EAS ngay trên máy:

- ✅ **Không tốn lượt build** trên EAS cloud
- ✅ Tự tải **keystore production từ server EAS** về để ký → APK có **cùng chữ ký** với các bản đã phát hành, người dùng cài đè được
- ✅ Tự dùng env vars trong `eas.json` (Supabase URL/key production)
- ✅ Tự tăng versionCode (appVersionSource: remote)

```bash
eas build --platform android --profile production --local
```

## Cách 2: Gradle trực tiếp

```bash
cd android && ./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk
```

⚠️ **Nhược điểm:** `android/app/build.gradle` hiện ký bản release bằng **debug.keystore** → APK sẽ **khác chữ ký** với bản build trên EAS, người dùng phải gỡ app cũ mới cài được. Ngoài ra phải tự đảm bảo env vars (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`) trỏ đúng môi trường production trước khi build.

Muốn dùng cách này đúng chuẩn, chạy `eas credentials` trước để tải keystore production về và cấu hình lại `signingConfigs.release`.

---

## Các bước cài đặt lần đầu (✅ ĐÃ HOÀN THÀNH — chỉ cần làm lại nếu đổi máy)

### Bước 1: Cài Android SDK qua Homebrew (không cần Android Studio)

```bash
brew install --cask android-commandlinetools
```

### Bước 2: Cấu hình biến môi trường

Thêm vào `~/.zshrc`:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
```

Sau đó nạp lại shell:

```bash
source ~/.zshrc
```

### Bước 3: Cài các gói SDK cần thiết + chấp nhận license

```bash
sdkmanager --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006"
sdkmanager --sdk_root=$ANDROID_HOME --licenses
```

(CMake 3.22.1 sẽ được Gradle tự cài thêm trong lần build đầu.)

### Bước 4: Đăng nhập EAS (nếu chưa)

```bash
eas whoami          # kiểm tra đã đăng nhập chưa
eas login           # nếu chưa
```

### Bước 5: Build

```bash
eas build --platform android --profile production --local
```

---

## Lưu ý

- **Lần build đầu rất lâu** (thực tế ~19 phút Gradle + thời gian tải dependency): các lần sau nhanh hơn nhiều nhờ cache.
- **Cần ổ trống ~15–20GB** (SDK + NDK + Gradle cache).
- Cần mạng ổn định để tải keystore từ EAS và dependency từ Maven.
- Các warning trong log build (Kotlin/Java deprecated, npm deprecated, Gradle 10 incompatible...) đều **vô hại**, không cần xử lý.
- File `.apk`/`.aab` đã nằm trong `.gitignore` — không commit vào git.
- Nếu gặp lỗi `SDK location not found`: shell chưa có `ANDROID_HOME` → chạy `source ~/.zshrc` hoặc mở terminal mới.
