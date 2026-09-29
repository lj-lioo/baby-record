-- 宝宝记录云同步：每个同步空间（space = sha256(同步令牌)）一组记录。
-- data 为客户端 AES-GCM 加密后的密文，服务端看不到明文。
CREATE TABLE IF NOT EXISTS records (
  space      TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,          -- 客户端修改时间（毫秒），用于「最后写入者胜」
  deleted    INTEGER NOT NULL DEFAULT 0, -- 1 = 删除标记（tombstone），data 为空
  data       TEXT,
  seq        INTEGER NOT NULL,           -- 本空间内单调递增的变更序号（增量拉取游标）
  PRIMARY KEY (space, id)
);
CREATE INDEX IF NOT EXISTS records_space_seq ON records (space, seq);
