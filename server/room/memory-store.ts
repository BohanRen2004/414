import { RoomRecord } from './engine';
import { RoomStore } from './handler';

/** In-memory room store for tests and the local preview; behaves like the cloud store, conflicts included. */
export class MemoryRoomStore implements RoomStore {
  public readonly rooms = new Map<string, RoomRecord>();
  /** Notifications sent so far, oldest first. */
  public readonly notifications: { readonly openid: string; readonly roomId: string }[] = [];
  private readonly listeners = new Map<string, Set<() => void>>();

  public async get(id: string): Promise<RoomRecord | null> {
    return this.rooms.get(id) ?? null;
  }

  public async findOpenByCode(code: string): Promise<RoomRecord | null> {
    let found: RoomRecord | null = null;
    for (const room of this.rooms.values()) {
      if (room.code === code && room.status !== 'closed' && (found === null || room.updatedAt > found.updatedAt)) found = room;
    }
    return found;
  }

  public async insert(room: RoomRecord): Promise<void> {
    if (this.rooms.has(room.id)) throw new Error(`duplicate room id ${room.id}`);
    this.rooms.set(room.id, room);
  }

  public async replace(room: RoomRecord, expectedRevision: number): Promise<boolean> {
    if (this.rooms.get(room.id)?.revision !== expectedRevision) return false;
    this.rooms.set(room.id, room);
    return true;
  }

  public async notify(openids: readonly string[], roomId: string): Promise<void> {
    for (const openid of openids) {
      this.notifications.push({ openid, roomId });
      for (const listener of this.listeners.get(openid) ?? []) listener();
    }
  }

  /** Watch one player's inbox, like the client's realtime listener. */
  public watch(openid: string, listener: () => void): () => void {
    const set = this.listeners.get(openid) ?? new Set();
    set.add(listener);
    this.listeners.set(openid, set);
    return () => set.delete(listener);
  }
}
