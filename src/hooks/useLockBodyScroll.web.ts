import { useEffect } from "react";

/** Prevent page scroll while a full-screen call modal is open on web. */
export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    const { body, documentElement: html } = document;
    const root = document.getElementById("root");
    const prevBodyOverflow = body.style.overflow;
    const prevBodyHeight = body.style.height;
    const prevHtmlOverflow = html.style.overflow;
    const prevHtmlHeight = html.style.height;
    const prevRootOverflow = root?.style.overflow ?? "";
    const prevRootHeight = root?.style.height ?? "";

    body.style.overflow = "hidden";
    body.style.height = "100dvh";
    html.style.overflow = "hidden";
    html.style.height = "100dvh";
    if (root) {
      root.style.overflow = "hidden";
      root.style.height = "100dvh";
    }

    return () => {
      body.style.overflow = prevBodyOverflow;
      body.style.height = prevBodyHeight;
      html.style.overflow = prevHtmlOverflow;
      html.style.height = prevHtmlHeight;
      if (root) {
        root.style.overflow = prevRootOverflow;
        root.style.height = prevRootHeight;
      }
    };
  }, [locked]);
}
