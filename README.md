# Talo

Ứng dụng chat thời gian thực, tối giản và riêng tư — xây dựng bằng Expo (React Native) + Supabase, chạy trên Android, iOS và Web.

## Tính năng chính

- 💬 **Nhắn tin thời gian thực** — chat 1-1 và nhóm, typing indicator, trạng thái online, read receipts
- 🖼️ **Media** — gửi ảnh/file, album media theo phòng, xem ảnh toàn màn hình
- 📌 **Tiện ích tin nhắn** — ghim, lưu tin nhắn, trả lời, reaction, sửa/xóa, thu hồi gửi, hẹn giờ gửi
- 📊 **Bình chọn (poll)** trong phòng chat
- 🔔 **Thông báo đẩy** (Android) qua Expo Notifications + Supabase Edge Function
- 🔒 **Quyền riêng tư** — ẩn last seen/online, kiểm soát read receipt, chặn người dùng, khóa ứng dụng bằng sinh trắc học
- 🌐 **Đa ngôn ngữ** — Tiếng Việt & English (i18next)
- 🌓 **Light/Dark mode** tự động theo hệ thống

## Tech stack

| Layer | Công nghệ |
|-------|-----------|
| Framework | Expo SDK 56 · React Native 0.85 (New Architecture, Hermes) |
| Ngôn ngữ | TypeScript (strict) |
| Điều hướng | Expo Router (file-based routing) |
| State | Zustand v5 |
| Styling | NativeWind v4 (TailwindCSS 3.x) |
| Backend | Supabase (PostgreSQL · Auth · Realtime · Storage · Edge Functions) |
| Khác | expo-image · @shopify/flash-list · react-native-reanimated v4 · i18next |

## Bắt đầu nhanh

```bash
npm install
npx expo start          # Dev server (nhấn a/i/w để mở Android/iOS/Web)
```

Cần tạo file `.env.local` với thông tin Supabase trước khi chạy — xem hướng dẫn chi tiết tại [docs/SETUP.md](docs/SETUP.md).

```bash
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

## Scripts

| Lệnh | Mô tả |
|------|-------|
| `npm start` | Chạy dev server |
| `npm run android` / `npm run ios` | Build & chạy native |
| `npm run web` | Chạy bản web |
| `npm run build` | Export web (deploy Vercel) |
| `npm run build:android:preview` | EAS build Android (preview APK) |
| `npm run build:android:prod` | EAS build Android (production) |
| `npm run env:dev` / `npm run env:prod` | Chuyển môi trường Supabase dev/prod |

## Cấu trúc thư mục

```
app/                    # Màn hình & layout (Expo Router)
├── (auth)/             # Đăng nhập, đăng ký, quên mật khẩu
├── (tabs)/             # Tin nhắn · Danh bạ · Cài đặt
└── chat/[roomId].tsx   # Màn hình chat
src/
├── components/         # UI components (chat/, rooms/, ui/)
├── hooks/              # useMessages, useRealtime, usePresence...
├── services/           # Toàn bộ truy vấn Supabase
├── stores/             # Zustand stores
├── lib/                # Supabase client, constants
├── i18n/ + locales/    # Đa ngôn ngữ vi/en
└── types/              # Types sinh từ DB + domain aliases
supabase/
├── migrations/         # SQL migrations tuần tự (00001_...)
└── functions/          # Edge Functions (push notification)
```

Luồng dữ liệu một chiều: **Screen → Hook → Store/Service → Supabase**. Chi tiết kiến trúc xem [AGENTS.md](AGENTS.md).

## Tài liệu

| Tài liệu | Nội dung |
|----------|----------|
| [docs/SETUP.md](docs/SETUP.md) | Hướng dẫn cài đặt & chạy dự án |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Design system (tokens, components, spacing) |
| [docs/BRAND_GUIDELINE.md](docs/BRAND_GUIDELINE.md) | Brand guideline Talo |
| [docs/DATABASE_CHANGES.md](docs/DATABASE_CHANGES.md) | Thiết kế schema các tính năng nhắn tin |
| [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) | Thiết kế & threat model tính năng quyền riêng tư |
| [docs/reports/](docs/reports/) | Các báo cáo audit/phân tích một lần |
| [AGENTS.md](AGENTS.md) | Quy tắc dự án cho AI agents |

## License

[MIT](LICENSE)
