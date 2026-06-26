# Screens & Routing

## File-based routing

- Screens live in `app/` only
- Route groups: `(auth)` unauthenticated, `(tabs)` main app
- Dynamic routes: `chat/[roomId].tsx`
- Use `export default function ScreenName()` — not arrow exports

## Navigation

```typescript
import { useRouter, useLocalSearchParams } from "expo-router";

const router = useRouter();
router.replace("/(tabs)");   // Auth redirect
router.push(`/chat/${roomId}`);

const { roomId } = useLocalSearchParams<{ roomId: string }>();
```

## AuthGate

Root `app/_layout.tsx` wraps `<AuthGate />`:
- Unauthenticated → `/(auth)/login`
- Authenticated in auth group → `/(tabs)`
- Wait for `initialized` before rendering (show `LoadingSpinner`)

## Screen composition

Screens compose hooks + components — keep business logic in hooks:

```typescript
// ✅ GOOD
export default function ChatScreen() {
  const { messages, sendMessage } = useMessages(roomId!);
  return (/* JSX */);
}
```

Use `useSafeAreaInsets()` on full-screen layouts. Typed routes enabled in `app.json`.
