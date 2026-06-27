# Components & UI

## Styling

Use NativeWind `className` — never `StyleSheet.create()` unless NativeWind cannot express it.

```tsx
// ✅ GOOD
<View className="flex-1 bg-surface px-4">
  <Text className="text-base font-semibold text-gray-900">Tiêu đề</Text>
</View>

// ❌ BAD
const styles = StyleSheet.create({ container: { flex: 1 } });
```

Palette: `primary-50`–`primary-900`, `surface`, `surface-secondary`, `surface-dark` from `tailwind.config.ts`.

## Images & lists

```typescript
import { Image } from "expo-image";           // ✅ not react-native Image
import { FlashList } from "@shopify/flash-list"; // ✅ long lists
```

## Icons

```tsx
import { SymbolView } from "expo-symbols";

<SymbolView
  name={{ ios: "bubble.left", android: "chat_bubble", web: "chat_bubble" }}
  size={24}
  tintColor="#2563EB"
/>
```

## Shared UI

Reuse `src/components/ui/`: `Button`, `Avatar`, `LoadingSpinner`, `ConfirmDialog`.

Destructive actions → `ConfirmDialog` (not `Alert.alert`):

```tsx
<ConfirmDialog
  visible={showConfirm}
  title="Đăng xuất"
  message="Bạn có chắc muốn đăng xuất?"
  destructive
  onConfirm={handleSignOut}
  onCancel={() => setShowConfirm(false)}
/>
```

## User feedback (no `Alert.alert`)

`Alert.alert` is unreliable on Expo web — avoid it for validation, success, and error messages.

| Case | Pattern |
|------|---------|
| Field validation | Inline `<Text className="text-sm text-red-600">` under the input; optional red border |
| Form / API error | Inline message above submit button + `console.error("[ScreenName]", error)` |
| Success with next step | Dedicated success view (see `forgot-password.tsx`, `reset-password.tsx`) |

```tsx
const [error, setError] = useState("");

// validation
if (!email.trim()) {
  setError("Vui lòng nhập email");
  return;
}

// API catch
catch (error: unknown) {
  console.error("[ForgotPassword]", error);
  setError(error instanceof Error ? error.message : "Đã xảy ra lỗi");
}
```

Use RN primitives only (`View`, `Text`, `Pressable`) — no HTML elements.
