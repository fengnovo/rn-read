import type { Folder, Position, Resource, ResourceStatus } from "../core/types";
export interface Database {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...args: any[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...args: any[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...args: any[]): Promise<T | null>;
}
type Row = {
  id: string;
  source_key: string;
  type: Resource["type"];
  title: string;
  source_uri: string | null;
  folder_id: string | null;
  relative_path: string | null;
  local_path: string;
  size: number;
  status: ResourceStatus;
  last_opened_at: number;
  position: string;
  warnings: string;
  mode: Resource["mode"];
};
const resource = (r: Row): Resource => ({
  id: r.id,
  sourceKey: r.source_key,
  type: r.type,
  title: r.title,
  sourceUri: r.source_uri ?? undefined,
  folderId: r.folder_id ?? undefined,
  relativePath: r.relative_path ?? undefined,
  localPath: r.local_path,
  size: r.size,
  status: r.status,
  lastOpenedAt: r.last_opened_at,
  position: JSON.parse(r.position),
  warnings: JSON.parse(r.warnings),
  mode: r.mode,
});
export class Library {
  constructor(readonly db: Database) {}
  async initialize() {
    await this.db.execAsync("PRAGMA journal_mode=WAL;");
    const version = await this.db.getFirstAsync<{ user_version: number }>(
      "PRAGMA user_version;",
    );
    if (!version || version.user_version < 1)
      await this.db.execAsync(`BEGIN;
      CREATE TABLE resources(id TEXT PRIMARY KEY,source_key TEXT UNIQUE NOT NULL,type TEXT NOT NULL,title TEXT NOT NULL,source_uri TEXT,folder_id TEXT,relative_path TEXT,local_path TEXT NOT NULL,size INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'ready',last_opened_at INTEGER NOT NULL,position TEXT NOT NULL DEFAULT '{}',warnings TEXT NOT NULL DEFAULT '[]',mode TEXT);
      CREATE INDEX recent_order ON resources(last_opened_at DESC);
      CREATE TABLE folders(id TEXT PRIMARY KEY,name TEXT NOT NULL,uri TEXT UNIQUE NOT NULL,bookmark TEXT,last_path TEXT NOT NULL DEFAULT '',last_opened_at INTEGER NOT NULL);
      CREATE TABLE save_jobs(id TEXT PRIMARY KEY,resource_id TEXT NOT NULL,staging TEXT NOT NULL,final_path TEXT NOT NULL,status TEXT NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
  }
  async get(id: string) {
    const r = await this.db.getFirstAsync<Row>(
      "SELECT * FROM resources WHERE id=?",
      id,
    );
    return r ? resource(r) : null;
  }
  async bySource(key: string) {
    const r = await this.db.getFirstAsync<Row>(
      "SELECT * FROM resources WHERE source_key=?",
      key,
    );
    return r ? resource(r) : null;
  }
  async upsert(
    value: Pick<Resource, "id" | "sourceKey" | "type" | "title" | "localPath"> &
      Partial<Resource>,
  ) {
    const old = await this.bySource(value.sourceKey);
    const id = old?.id ?? value.id;
    await this.db.runAsync(
      `INSERT INTO resources(id,source_key,type,title,source_uri,folder_id,relative_path,local_path,size,status,last_opened_at,position,warnings,mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET title=excluded.title,local_path=excluded.local_path,size=excluded.size,status=excluded.status,last_opened_at=excluded.last_opened_at,warnings=excluded.warnings,source_uri=COALESCE(excluded.source_uri,resources.source_uri),folder_id=COALESCE(excluded.folder_id,resources.folder_id),relative_path=COALESCE(excluded.relative_path,resources.relative_path),mode=excluded.mode`,
      id,
      value.sourceKey,
      value.type,
      value.title,
      value.sourceUri ?? null,
      value.folderId ?? null,
      value.relativePath ?? null,
      value.localPath,
      value.size ?? 0,
      value.status ?? "ready",
      Date.now(),
      JSON.stringify(old?.position ?? value.position ?? {}),
      JSON.stringify(value.warnings ?? []),
      value.mode ?? null,
    );
    return (await this.get(id))!;
  }
  async recent(type?: Resource["type"], includeForgotten = false) {
    const rows = await this.db.getAllAsync<Row>(
      `SELECT * FROM resources WHERE status IN ('ready','ready_with_warnings') ${type ? "AND type=?" : ""} ${includeForgotten ? "" : "AND last_opened_at>0"} ORDER BY last_opened_at DESC LIMIT 200`,
      ...(type ? [type] : []),
    );
    return rows.map(resource);
  }
  async savedPage(kind: "files" | "web", offset = 0, limit = 60) {
    const types = kind === "files" ? ["markdown", "pdf"] : ["web"];
    const rows = await this.db.getAllAsync<Row>(
      `SELECT * FROM resources WHERE status IN ('ready','ready_with_warnings') AND type IN (${types.map(() => "?").join(",")}) ORDER BY last_opened_at DESC,id DESC LIMIT ? OFFSET ?`,
      ...types,
      limit,
      offset,
    );
    return rows.map(resource);
  }
  async touch(id: string) {
    await this.db.runAsync(
      "UPDATE resources SET last_opened_at=? WHERE id=?",
      Date.now(),
      id,
    );
  }
  async savePosition(id: string, position: Position) {
    await this.db.runAsync(
      "UPDATE resources SET position=? WHERE id=?",
      JSON.stringify({ ...position, version: 1 }),
      id,
    );
  }
  async setStatus(id: string, status: ResourceStatus) {
    await this.db.runAsync(
      "UPDATE resources SET status=? WHERE id=?",
      status,
      id,
    );
  }
  async forget(id: string) {
    await this.db.runAsync(
      "UPDATE resources SET last_opened_at=0 WHERE id=?",
      id,
    );
  }
  async remove(id: string) {
    await this.db.runAsync("DELETE FROM resources WHERE id=?", id);
  }
  async folders(): Promise<Folder[]> {
    const rows = await this.db.getAllAsync<{
      id: string;
      name: string;
      uri: string;
      bookmark: string | null;
      last_path: string;
      last_opened_at: number;
    }>("SELECT * FROM folders ORDER BY last_opened_at DESC");
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      uri: r.uri,
      bookmark: r.bookmark ?? undefined,
      lastPath: r.last_path,
      lastOpenedAt: r.last_opened_at,
    }));
  }
  async saveFolder(f: Folder) {
    await this.db.runAsync(
      `INSERT INTO folders(id,name,uri,bookmark,last_path,last_opened_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,uri=excluded.uri,bookmark=excluded.bookmark,last_path=excluded.last_path,last_opened_at=excluded.last_opened_at`,
      f.id,
      f.name,
      f.uri,
      f.bookmark ?? null,
      f.lastPath,
      Date.now(),
    );
  }
  async mergeFolder(from: string, to: string) {
    await this.db.runAsync(
      "UPDATE resources SET folder_id=? WHERE folder_id=?",
      to,
      from,
    );
    await this.removeFolder(from);
  }
  async removeFolder(id: string) {
    await this.db.runAsync("DELETE FROM folders WHERE id=?", id);
  }
  async startJob(
    id: string,
    resourceId: string,
    staging: string,
    finalPath: string,
  ) {
    await this.db.runAsync(
      "INSERT INTO save_jobs VALUES(?,?,?,?,?)",
      id,
      resourceId,
      staging,
      finalPath,
      "saving",
    );
  }
  async finishJob(id: string) {
    await this.db.runAsync("DELETE FROM save_jobs WHERE id=?", id);
  }
  async jobs() {
    return this.db.getAllAsync<{
      id: string;
      resource_id: string;
      staging: string;
      final_path: string;
      status: string;
    }>("SELECT * FROM save_jobs");
  }
  async deleting() {
    return (
      await this.db.getAllAsync<Row>(
        "SELECT * FROM resources WHERE status='deleting'",
      )
    ).map(resource);
  }
}
