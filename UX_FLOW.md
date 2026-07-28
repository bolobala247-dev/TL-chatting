# Talo — UX Flows: Core Messaging Features

> All copy in Vietnamese (UI language). All components reuse the design system:
> semantic tokens (`bg-surface`, `text-fg`, `border-divider`, `danger`), `Sheet`, `Dialog`,
> `ConfirmDialog`, `Icon` (SymbolView), Inter type scale, 8pt spacing. Light/Dark automatic
> via tokens. Lists use FlashList with cursor pagination.

## 1. Message Action Sheet (entry point for most features)

Long-press any live bubble → `MessageActions` sheet (existing pattern, extended):

| Action | Shown when | Icon | Copy |
|---|---|---|---|
| Trả lời | always | arrowshape.turn.up.left / reply | "Trả lời" |
| Ghim / Bỏ ghim | any participant, message not recalled | pin / keep | "Ghim tin nhắn" / "Bỏ ghim" |
| Lưu / Bỏ lưu | any participant | bookmark / bookmark_add | "Lưu tin nhắn" / "Bỏ lưu" |
| Chỉnh sửa | own text message | pencil / edit | "Chỉnh sửa" |
| Thu hồi | own message | trash / delete (destructive) | "Thu hồi tin nhắn" |

Recalled (tombstone) messages do not open the action sheet.

## 2. Pinned Messages

**Pin:** long-press → "Ghim tin nhắn" → instant (RPC), banner appears for everyone via realtime.
**Banner:** slim bar under the chat header — pin icon + latest pinned text (1 line) + count badge
when >1. Tap → **Pinned sheet**: newest-first list (sender, time, full text/thumbnail),
each row has "Bỏ ghim" affordance. Empty state never shown (banner hidden when 0 pins).
**Unpin:** from sheet or from the message's action sheet.
**Bubble meta:** small pin glyph next to the timestamp on pinned messages.

Failure: inline error text inside the sheet (no Alert.alert).

## 3. Saved Messages (Favorite)

**Save:** action sheet → "Lưu tin nhắn" → bookmark toggles silently (optimistic).
**Browse:** Cài đặt → "Tin nhắn đã lưu" → full screen list (route `/saved-messages`):
- Row: sender avatar + name, room name, message preview (text / 「Hình ảnh」/「Tệp」), saved date.
- Tap row → opens that chat room. Trailing bookmark button → "Bỏ lưu" (removes row optimistically).
- Empty state: bookmark icon + "Chưa có tin nhắn đã lưu" + hint text.
- Paginated (20/lần) by `saved_messages.created_at`.

## 4. Shared Media

**Entry:** photo-stack icon button in the chat header → route `/chat/media?roomId=…`.
**Layout:** header (back + room name) + segmented control:

| Tab | Content | Layout |
|---|---|---|
| Ảnh & video | `type IN (image, video)` | 3-column square grid (FlashList `numColumns=3`) |
| Tệp | `type = file` | rows: doc icon, file name from URL, date |
| Liên kết | `has_link = true` | rows: link icon, first URL highlighted, message text, date |

- Tap grid item → full-width preview (image) / open URL (video, file, link) via `Linking`.
- Recalled messages excluded server-side.
- Each tab paginates independently (30/lần) and shows its own empty state
  ("Chưa có ảnh hoặc video nào" / "Chưa có tệp nào" / "Chưa có liên kết nào").

## 5. Edit Message (existing flow, unchanged)

Long-press own text message → "Chỉnh sửa" → dialog with multiline input → Lưu.
Bubble shows "(đã sửa)". Errors inline under the input. Recalled messages cannot be edited
(action hidden + DB trigger).

## 6. Delete for Everyone (Thu hồi)

1. Long-press own message → "Thu hồi tin nhắn" (destructive, red).
2. `ConfirmDialog`: "Thu hồi tin nhắn?" / "Tin nhắn sẽ bị thu hồi với tất cả mọi người." →
   [Hủy] [Thu hồi].
3. Bubble becomes a tombstone for **everyone** (realtime UPDATE): italic tertiary text
   "Tin nhắn đã bị thu hồi", no content/media, no long-press.
4. Replies to it keep rendering, quoting the tombstone text.
5. Room list preview of a recalled last message falls back to "Chưa có tin nhắn" style copy.

## 7. Undo Send (8 giây)

1. User sends a message → optimistic bubble as today.
2. On confirmed send, a floating pill appears above the composer:
   "Đã gửi · **Hoàn tác**" with the remaining seconds.
3. Press Hoàn tác → message hard-deleted (disappears for everyone via realtime DELETE),
   its text is restored into the composer so nothing is lost.
4. Pill auto-dismisses after 8 s or when a new message is sent.
5. Failure to undo (e.g. offline): inline chat error bar (existing pattern).

Rationale: sending stays instant (realtime chat), undo is a short grace window — not delayed send.

## 8. Scheduled Messages

**Create:** type a message → **long-press** the send button → "Gửi theo lịch" sheet with presets:
- Sau 30 phút · Sau 1 giờ · Sau 3 giờ · Tối nay 20:00 · Sáng mai 08:00
- Footnote: "Tin nhắn sẽ được gửi trong vòng 1 phút quanh thời điểm đã chọn."
Select → composer clears, chip confirms.

**Pending chip:** above the composer when the room has pending items:
"🕐 N tin nhắn đã lên lịch" → tap opens **Scheduled sheet**:
- Rows: content preview + "Sẽ gửi lúc HH:mm dd/MM" + Hủy button (ConfirmDialog-free; the row
  action is reversible only by re-scheduling, so a single tap with destructive styling + confirm).
- Cancel removes the row optimistically.

**Delivery:** at fire time the message appears in the chat like any other (server-side cron);
recipients get the normal push notification. If the sender left the room first, nothing is sent.

## 9. States & Theming Matrix

| Surface | Light/Dark | Loading | Empty | Error |
|---|---|---|---|---|
| Pinned banner/sheet | tokens only | n/a (instant) | banner hidden | inline text in sheet |
| Saved screen | tokens only | spinner center | icon + copy | inline FormMessage |
| Media screen | tokens only | spinner center per tab | per-tab copy | inline FormMessage |
| Undo pill | `bg-ink` pill + `text-ink-inverse` (auto-inverts) | n/a | n/a | chat error bar |
| Schedule sheets | tokens only | disabled rows | "Chưa có tin nhắn đã lên lịch" | inline text |

## 10. Performance Notes

- Chat list untouched — tombstones/pins are plain bubble variants (no extra queries per row).
- Pinned list, media tabs, saved list: separate cursor-paginated queries backed by partial
  indexes; never loaded unless opened (banner uses one 10-row query per room open).
- Saved-state lookup for the action sheet: one `message_id` set per room open, kept in memory.
- FlashList everywhere; images through `expo-image` with `recyclingKey`.
