import type { Folder, Position, Resource, ResourceStatus } from "../core/types";

/** SQLite 实例的最小接口，方便业务层测试时换用内存数据库。 */
export interface Database {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...args: any[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...args: any[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...args: any[]): Promise<T | null>;
}
/** 数据库字段使用 snake_case；读取后会转换成应用内 camelCase 类型。 */
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
/** 把 SQLite 行转换为应用模型，并解析以 JSON 文本保存的进度和警告。 */
const toResource = (row: Row): Resource => ({
  id: row.id,
  sourceKey: row.source_key,
  type: row.type,
  title: row.title,
  sourceUri: row.source_uri ?? undefined,
  folderId: row.folder_id ?? undefined,
  relativePath: row.relative_path ?? undefined,
  localPath: row.local_path,
  size: row.size,
  status: row.status,
  lastOpenedAt: row.last_opened_at,
  position: JSON.parse(row.position),
  warnings: JSON.parse(row.warnings),
  mode: row.mode,
});

/** 管理阅读记录、授权目录和本地副本索引；正文数据本身保存在文件系统中。 */
export class Library {
  constructor(readonly db: Database) {}

  /** 创建首版 schema。user_version 让后续数据库结构升级可以逐版迁移。 */
  async initialize() {
    await this.db.execAsync("PRAGMA journal_mode=WAL;");
    const version = await this.db.getFirstAsync<{ user_version: number }>(
      "PRAGMA user_version;",
    );
    if (!version || version.user_version < 1)
      await this.db.execAsync(`
        BEGIN;
        CREATE TABLE resources (
          id TEXT PRIMARY KEY,
          source_key TEXT UNIQUE NOT NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          source_uri TEXT,
          folder_id TEXT,
          relative_path TEXT,
          local_path TEXT NOT NULL,
          size INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'ready',
          last_opened_at INTEGER NOT NULL,
          position TEXT NOT NULL DEFAULT '{}',
          warnings TEXT NOT NULL DEFAULT '[]',
          mode TEXT
        );
        CREATE INDEX recent_order ON resources(last_opened_at DESC);
        CREATE TABLE folders (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          uri TEXT UNIQUE NOT NULL,
          bookmark TEXT,
          last_path TEXT NOT NULL DEFAULT '',
          last_opened_at INTEGER NOT NULL
        );
        CREATE TABLE save_jobs (
          id TEXT PRIMARY KEY,
          resource_id TEXT NOT NULL,
          staging TEXT NOT NULL,
          final_path TEXT NOT NULL,
          status TEXT NOT NULL
        );
        PRAGMA user_version=1;
        COMMIT;
      `);
  }
  async get(id: string) {
    const row = await this.db.getFirstAsync<Row>(
      "SELECT * FROM resources WHERE id=?",
      id,
    );
    return row ? toResource(row) : null;
  }

  /** 按网页 URL 或外部文件身份查找已有记录。 */
  async bySource(key: string) {
    const row = await this.db.getFirstAsync<Row>(
      "SELECT * FROM resources WHERE source_key=?",
      key,
    );
    return row ? toResource(row) : null;
  }

  /** 插入或更新资源；sourceKey 冲突时沿用原 id 和阅读进度，避免重新导入后丢失位置。 */
  async upsert(
    value: Pick<Resource, "id" | "sourceKey" | "type" | "title" | "localPath"> &
      Partial<Resource>,
  ) {
    const existingResource = await this.bySource(value.sourceKey);
    const resourceId = existingResource?.id ?? value.id;
    await this.db.runAsync(
      `INSERT INTO resources (
        id, source_key, type, title, source_uri, folder_id, relative_path,
        local_path, size, status, last_opened_at, position, warnings, mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        title = excluded.title,
        local_path = excluded.local_path,
        size = excluded.size,
        status = excluded.status,
        last_opened_at = excluded.last_opened_at,
        warnings = excluded.warnings,
        source_uri = COALESCE(excluded.source_uri, resources.source_uri),
        folder_id = COALESCE(excluded.folder_id, resources.folder_id),
        relative_path = COALESCE(excluded.relative_path, resources.relative_path),
        mode = excluded.mode`,
      resourceId,
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
      JSON.stringify(existingResource?.position ?? value.position ?? {}),
      JSON.stringify(value.warnings ?? []),
      value.mode ?? null,
    );
    return (await this.get(resourceId))!;
  }

  /** 最近列表仅返回可读副本；默认排除用户从“最近阅读”里隐藏的记录。 */
  async recent(type?: Resource["type"], includeForgotten = false) {
    const rows = await this.db.getAllAsync<Row>(
      `
        SELECT *
        FROM resources
        WHERE status IN ('ready', 'ready_with_warnings')
          ${type ? "AND type=?" : ""}
          ${includeForgotten ? "" : "AND last_opened_at>0"}
        ORDER BY last_opened_at DESC
        LIMIT 200
      `,
      ...(type ? [type] : []),
    );
    return rows.map(toResource);
  }

  /** 按资料类型分页；文件页包括 Markdown/PDF，离线页只包括网页快照。 */
  async savedPage(kind: "files" | "web", offset = 0, limit = 60) {
    const resourceTypes = kind === "files" ? ["markdown", "pdf"] : ["web"];
    const rows = await this.db.getAllAsync<Row>(
      `
        SELECT *
        FROM resources
        WHERE status IN ('ready', 'ready_with_warnings')
          AND type IN (${resourceTypes.map(() => "?").join(", ")})
        ORDER BY last_opened_at DESC, id DESC
        LIMIT ? OFFSET ?
      `,
      ...resourceTypes,
      limit,
      offset,
    );
    return rows.map(toResource);
  }

  /** 打开资料时更新时间，用于最近阅读顺序。 */
  async touch(id: string) {
    await this.db.runAsync(
      "UPDATE resources SET last_opened_at=? WHERE id=?",
      Date.now(),
      id,
    );
  }

  /** 保存阅读位置时标记格式版本，便于将来调整进度字段。 */
  async savePosition(id: string, position: Position) {
    await this.db.runAsync(
      "UPDATE resources SET position=? WHERE id=?",
      JSON.stringify({ ...position, version: 1 }),
      id,
    );
  }

  /** 设置中间状态供删除/恢复流程使用，避免记录与磁盘文件失去同步。 */
  async setStatus(id: string, status: ResourceStatus) {
    await this.db.runAsync(
      "UPDATE resources SET status=? WHERE id=?",
      status,
      id,
    );
  }

  /** 从“最近阅读”隐藏记录，但保留本地副本和资料库条目。 */
  async forget(id: string) {
    await this.db.runAsync(
      "UPDATE resources SET last_opened_at=0 WHERE id=?",
      id,
    );
  }

  /** 只删除索引行；文件系统清理由 maintenance 服务负责。 */
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
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      uri: row.uri,
      bookmark: row.bookmark ?? undefined,
      lastPath: row.last_path,
      lastOpenedAt: row.last_opened_at,
    }));
  }

  /** 记录系统目录授权、bookmark 和上次访问的子路径。 */
  async saveFolder(folder: Folder) {
    await this.db.runAsync(
      `INSERT INTO folders (
        id, name, uri, bookmark, last_path, last_opened_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        uri = excluded.uri,
        bookmark = excluded.bookmark,
        last_path = excluded.last_path,
        last_opened_at = excluded.last_opened_at`,
      folder.id,
      folder.name,
      folder.uri,
      folder.bookmark ?? null,
      folder.lastPath,
      Date.now(),
    );
  }

  /** 将旧目录下的资料记录迁移到替换目录，再删除旧目录记录。 */
  async mergeFolder(sourceFolderId: string, targetFolderId: string) {
    await this.db.runAsync(
      "UPDATE resources SET folder_id=? WHERE folder_id=?",
      targetFolderId,
      sourceFolderId,
    );
    await this.removeFolder(sourceFolderId);
  }

  /** 移除目录授权记录，不删除用户原始文件或已导入的本地副本。 */
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

  /** 资源已完成提交或失败回滚后，移除对应的恢复任务。 */
  async finishJob(id: string) {
    await this.db.runAsync("DELETE FROM save_jobs WHERE id=?", id);
  }

  /** 启动时由 maintenance 服务读取未完成任务，检查并恢复磁盘副本。 */
  async jobs() {
    return this.db.getAllAsync<{
      id: string;
      resource_id: string;
      staging: string;
      final_path: string;
      status: string;
    }>("SELECT * FROM save_jobs");
  }

  /** 返回正在删除的记录，以便启动恢复中断的删除流程。 */
  async deleting() {
    return (
      await this.db.getAllAsync<Row>(
        "SELECT * FROM resources WHERE status='deleting'",
      )
    ).map(toResource);
  }
}
