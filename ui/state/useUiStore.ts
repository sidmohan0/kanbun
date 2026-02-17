import { useEffect, useState } from "preact/hooks";
import { uiStore } from "../../src/shared/ui-store.js";

// Simple Preact hook to subscribe to uiStore
export function useUiStore<T>(selector: (state: ReturnType<typeof uiStore.getState>) => T): T {
  const [slice, setSlice] = useState(() => selector(uiStore.getState()));

  useEffect(() => {
    const unsub = uiStore.subscribe(() => {
      setSlice(selector(uiStore.getState()));
    });
    return () => unsub();
  }, [selector]);

  return slice;
}
