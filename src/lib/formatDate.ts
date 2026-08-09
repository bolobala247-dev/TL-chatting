import type { TFunction } from "i18next";

function calendarDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** True when two ISO timestamps fall on the same local calendar day. */
export function isSameCalendarDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return calendarDayKey(da) === calendarDayKey(db);
}

/** Chat date pill: Hôm nay / Hôm qua / localized full date. */
export function formatChatDayLabel(
  dateStr: string,
  locale: string,
  t: TFunction<"chat">
): string {
  const date = new Date(dateStr);
  const now = new Date();

  if (calendarDayKey(date) === calendarDayKey(now)) {
    return t("message.dateToday");
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (calendarDayKey(date) === calendarDayKey(yesterday)) {
    return t("message.dateYesterday");
  }

  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
