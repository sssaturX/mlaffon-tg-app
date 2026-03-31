import { useEffect, useState } from "react";

/** `true`, если вкладка видима (`document.visibilityState === "visible"`). */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () =>
      typeof document === "undefined" ||
      document.visibilityState === "visible"
  );

  useEffect(() => {
    const onVis = () =>
      setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return visible;
}
