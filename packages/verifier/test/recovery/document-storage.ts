import type { Page } from "@playwright/test";

export async function readDescriptionRecord(
  page: Page,
  key: string,
): Promise<{ update: string; pending: boolean } | undefined> {
  return page.evaluate(async (recordKey) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("kanbun-documents");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ update: string; pending: boolean } | undefined>((resolve, reject) => {
        const request = db.transaction("states", "readonly").objectStore("states").get(recordKey);
        request.onsuccess = () => resolve(request.result as { update: string; pending: boolean } | undefined);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, key);
}
