# TL-Chatting -- Hướng dẫn cài đặt & chạy dự án

## Yêu cầu hệ thống

- **Node.js** >= 18
- **npm** >= 9
- Tài khoản [Supabase](https://supabase.com) (miễn phí)
- (Tuỳ chọn) Xcode cho iOS Simulator, Android Studio cho Android Emulator

---

## Bước 1: Tạo Supabase Project

1. Truy cập [supabase.com/dashboard](https://supabase.com/dashboard)
2. Nhấn **New Project**
3. Điền tên project, database password, chọn region **Singapore** (gần VN nhất)
4. Đợi project khởi tạo xong (~2 phút)

### Lấy credentials

Vào **Project Settings > API**, copy 2 giá trị:

| Tên | Vị trí |
|-----|--------|
| Project URL | `https://abcxyz.supabase.co` |
| anon public key | `eyJhbGci...` (chuỗi dài) |

> **Quan trọng:** KHÔNG bao giờ sử dụng `service_role` key ở phía client.

---

## Bước 2: Cấu hình biến môi trường

Mở file `.env.local` tại thư mục gốc dự án, thay thế giá trị placeholder:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-real-project-id.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...your-real-anon-key...
```

---

## Bước 3: Chạy Database Migration

1. Vào **Supabase Dashboard > SQL Editor**
2. Nhấn **New Query**
3. Copy toàn bộ nội dung file `supabase/migrations/00001_initial_schema.sql`
4. Nhấn **Run**

Migration này sẽ tạo:

- 4 bảng: `profiles`, `rooms`, `room_participants`, `messages`
- Row Level Security (RLS) trên tất cả bảng
- Trigger tự động tạo profile khi user đăng ký
- Function `get_user_rooms` cho danh sách phòng chat
- Bật Realtime cho bảng `messages` và `room_participants`

---

## Bước 4: Cấu hình Supabase Auth

Vào **Supabase Dashboard > Authentication > Providers > Email**:

- Tắt **"Confirm email"** (chỉ cho dev, bật lại khi lên production)
- Giữ nguyên các cài đặt khác

---

## Bước 5: Tạo Storage Buckets

Vào **Supabase Dashboard > Storage**:

1. Tạo bucket **`avatars`** -- chọn **Public bucket**
2. Tạo bucket **`chat-media`** -- chọn **Public bucket**

### Thêm Storage Policies

Cho mỗi bucket, vào tab **Policies** và thêm:

**Policy 1 -- Cho phép upload (INSERT):**

```sql
CREATE POLICY "Allow authenticated uploads"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars');
```

**Policy 2 -- Cho phép đọc (SELECT):**

```sql
CREATE POLICY "Allow public read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');
```

> Lặp lại tương tự cho bucket `chat-media` (thay `'avatars'` thành `'chat-media'`).

---

## Bước 6: Chạy ứng dụng

```bash
# Cài dependencies (nếu chưa)
npm install

# Khởi động dev server
npx expo start
```

### Mở app trên từng nền tảng

| Phím tắt | Nền tảng | Yêu cầu |
|----------|----------|---------|
| `w` | Web browser | Không cần gì thêm |
| `i` | iOS Simulator | Xcode (macOS) |
| `a` | Android Emulator | Android Studio |
| Quét QR | Điện thoại thật | App **Expo Go** |

---

## Kiểm tra hoạt động

1. Mở app trên web (nhấn `w`)
2. Đăng ký tài khoản mới tại màn hình Register
3. Sau khi đăng ký, app tự chuyển sang màn hình chính
4. Vào tab **Danh bạ**, tìm user khác để bắt đầu chat
5. Gửi tin nhắn và kiểm tra realtime bằng cách mở 2 tab browser

---

## Cấu trúc dự án

```
TL-chatting/
├── app/                    # Expo Router -- màn hình & navigation
│   ├── (auth)/             # Login, Register
│   ├── (tabs)/             # Tab chính (Tin nhắn, Danh bạ, Cài đặt)
│   └── chat/[roomId].tsx   # Màn hình chat
├── src/
│   ├── components/         # UI Components (chat/, rooms/, ui/)
│   ├── hooks/              # Custom hooks (useAuth, useMessages, useRealtime...)
│   ├── lib/                # Supabase client, constants
│   ├── services/           # Business logic (message, room, profile)
│   ├── stores/             # Zustand state (auth, chat, room)
│   └── types/              # TypeScript types
├── supabase/migrations/    # SQL migration files
├── .env.local              # Credentials (KHÔNG commit lên git)
└── tailwind.config.ts      # NativeWind/Tailwind config
```

---

## Tech Stack

| Thành phần | Công nghệ |
|------------|-----------|
| Framework | Expo SDK 56 (React Native) |
| Language | TypeScript |
| Navigation | Expo Router |
| State | Zustand |
| UI Styling | NativeWind v4 (Tailwind CSS) |
| Backend | Supabase (PostgreSQL + Auth + Realtime + Storage) |

---

## Troubleshooting

### App trắng hoặc lỗi kết nối

- Kiểm tra `.env.local` đã có URL và key đúng chưa
- Restart dev server: `npx expo start --clear`

### Đăng ký nhưng không vào được app

- Kiểm tra đã tắt "Confirm email" trong Supabase Auth chưa
- Kiểm tra đã chạy SQL migration chưa (trigger tạo profile)

### Upload ảnh lỗi

- Kiểm tra đã tạo storage bucket `avatars` và `chat-media` chưa
- Kiểm tra policies đã thêm đúng chưa

### Tin nhắn không realtime

- Kiểm tra migration đã chạy 2 dòng cuối (ALTER PUBLICATION) chưa
- Vào Supabase Dashboard > Database > Replication, kiểm tra `messages` đã được bật
