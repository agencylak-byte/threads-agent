import { openDB } from 'idb';
import { DB_NAME, DB_VERSION } from '@/shared/constants';
import { upgradeV1, type DB } from './schema';

let dbPromise: Promise<DB> | null = null;

/** Единственная точка открытия БД. Открывается лениво, переживает рестарты service worker. */
export function openDb(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) upgradeV1(db);
      },
      blocking() {
        // другая вкладка/версия хочет обновить схему — закрываемся, откроемся заново при следующем вызове
        void dbPromise?.then((d) => d.close());
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

/** Для тестов: закрыть и забыть соединение. */
export async function resetDbForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
