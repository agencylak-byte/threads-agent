// Глобальная подготовка тестов: IndexedDB в памяти + сброс fake-browser между тестами.
import 'fake-indexeddb/auto';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach } from 'vitest';

beforeEach(() => {
  fakeBrowser.reset();
});
