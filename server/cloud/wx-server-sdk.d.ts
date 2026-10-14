/** The parts of wx-server-sdk (WeChat cloud functions) used by the room function. */
declare module 'wx-server-sdk' {
  interface Command {
    neq(value: unknown): unknown;
    set(value: unknown): unknown;
  }
  interface Query {
    where(condition: Record<string, unknown>): Query;
    orderBy(field: string, order: 'asc' | 'desc'): Query;
    limit(count: number): Query;
    get(): Promise<{ data: Record<string, unknown>[] }>;
    update(options: { data: Record<string, unknown> }): Promise<{ stats: { updated: number } }>;
  }
  interface DocumentReference {
    get(): Promise<{ data: Record<string, unknown> }>;
    set(options: { data: Record<string, unknown> }): Promise<unknown>;
  }
  interface CollectionReference extends Query {
    doc(id: string): DocumentReference;
    add(options: { data: Record<string, unknown> }): Promise<{ _id: string }>;
  }
  interface Database {
    readonly command: Command;
    collection(name: string): CollectionReference;
    createCollection(name: string): Promise<unknown>;
  }
  const DYNAMIC_CURRENT_ENV: unique symbol;
  function init(options?: { env?: unknown }): void;
  function database(): Database;
  function getWXContext(): { OPENID: string; APPID: string };
}
