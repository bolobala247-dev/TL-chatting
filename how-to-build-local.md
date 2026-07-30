# Hướng dẫn build APK local (không dùng lượt EAS cloud)

> Áp dụng khi hết lượt build trên EAS cloud. Build ngay trên máy Mac, ra file APK y hệt bản build cloud.

## Trạng thái máy đã kiểm tra (07/2026)

| Thành phần | Trạng thái |
|---|---|
| JDK 17 (Homebrew) | ✅ Đã có |
| EAS CLI 20.5.1 | ✅ Đã có |
| Android SDK | ❌ Chưa có — cần cài (Bước 1–3) |
| Thư mục `android/` (đã prebuild) | ✅ Đã có |

---

## Cách 1 (Khuyên dùng): `eas build --local`

Chạy đúng pipeline EAS ngay trên máy:

- ✅ **Không tốn lượt build** trên EAS cloud
- ✅ Tự tải **keystore production từ server EAS** về để ký → APK có **cùng chữ ký** với các bản đã phát hành, người dùng cài đè được
- ✅ Tự dùng env vars trong `eas.json` (Supabase URL/key production)

```bash
eas build --platform android --profile production --local
```

APK xuất ra ngay tại thư mục gốc project, dạng `build-xxxxxxxxxx.apk`.

## Cách 2: Gradle trực tiếp

```bash
cd android && ./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk
```

⚠️ **Nhược điểm:** `android/app/build.gradle` hiện ký bản release bằng **debug.keystore** → APK sẽ **khác chữ ký** với bản build trên EAS, người dùng phải gỡ app cũ mới cài được. Ngoài ra phải tự đảm bảo env vars (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`) trỏ đúng môi trường production trước khi build.

Muốn dùng cách này đúng chuẩn, chạy `eas credentials` trước để tải keystore production về và cấu hình lại `signingConfigs.release`.

---

## Các bước cài đặt (bắt buộc trước lần build đầu tiên)

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

- **Lần build đầu rất lâu** (30–60 phút): Gradle phải tải toàn bộ dependency. Các lần sau nhanh hơn nhiều nhờ cache.
- **Cần ổ trống ~15–20GB** (SDK + NDK + Gradle cache).
- Cần mạng ổn định để tải keystore từ EAS và dependency từ Maven.
- Muốn build bản preview thay vì production: đổi `--profile production` thành `--profile preview`.
- Không commit file APK và keystore vào git.
