import { describe, expect, it } from 'vitest';
import { sampleSnapshot } from '../src/sample.js';
import { PositionStore } from '../src/store.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('PositionStore', () => {
  it('stores and returns the snapshot together with its PNG', () => {
    const store = new PositionStore(':memory:');
    const snapshot = sampleSnapshot({ id: 'pos-1', telegramUserId: '42' });
    store.save(snapshot, png, '42');

    const stored = store.get('pos-1');
    expect(stored?.snapshot).toEqual(snapshot);
    expect(stored?.png.equals(png)).toBe(true);
    store.close();
  });

  it('cannot overwrite an existing card', () => {
    const store = new PositionStore(':memory:');
    const snapshot = sampleSnapshot({ id: 'pos-1' });
    store.save(snapshot, png, '42');
    expect(() => store.save(snapshot, Buffer.from([1, 2, 3]), '42')).toThrow();
    expect(store.get('pos-1')?.png.equals(png)).toBe(true);
    store.close();
  });

  it('stores the per-user card brand', () => {
    const store = new PositionStore(':memory:');
    expect(store.getBrand('42')).toBeNull();
    store.setBrand('42', 'BUDI');
    expect(store.getBrand('42')).toBe('BUDI');
    store.setBrand('42', 'RANI');
    expect(store.getBrand('42')).toBe('RANI');
    store.clearBrand('42');
    expect(store.getBrand('42')).toBeNull();
    store.close();
  });

  it('lists only closed positions and bumps the calendar version', () => {
    const store = new PositionStore(':memory:');
    store.save(sampleSnapshot({ id: 'closed', telegramUserId: '42', status: 'closed' }), png, '42');
    store.save(sampleSnapshot({ id: 'open', telegramUserId: '42', status: 'open' }), png, '42');
    expect(store.listClosed('42').map((position) => position.id)).toEqual(['closed']);

    const before = store.calendarVersion('42');
    store.save(sampleSnapshot({ id: 'newer', telegramUserId: '42', status: 'closed' }), png, '42');
    expect(store.calendarVersion('42')).not.toBe(before);
    store.close();
  });

  it('caches calendar file ids per user and clears them on demand', () => {
    const store = new PositionStore(':memory:');
    const key = '42|month|2026-10|IDR|1:x';
    expect(store.getCalendarCache(key)).toBeNull();

    store.setCalendarCache(key, 'file-1', 'caption');
    expect(store.getCalendarCache(key)).toEqual({ fileId: 'file-1', caption: 'caption' });

    store.clearCalendarCache('42');
    expect(store.getCalendarCache(key)).toBeNull();
    store.close();
  });

  it('lists only the caller cards, newest first', () => {
    const store = new PositionStore(':memory:');
    store.save(sampleSnapshot({ id: 'old', createdAt: '2026-10-01T00:00:00.000Z' }), png, '42');
    store.save(sampleSnapshot({ id: 'new', createdAt: '2026-10-20T00:00:00.000Z' }), png, '42');
    store.save(sampleSnapshot({ id: 'other', createdAt: '2026-10-21T00:00:00.000Z' }), png, '99');

    expect(store.list('42').map((position) => position.id)).toEqual(['new', 'old']);
    expect(store.list('99').map((position) => position.id)).toEqual(['other']);
    store.close();
  });
});
