
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS area (
    id         INTEGER PRIMARY KEY,              -- 壁QRに入るのはこの数字
    floor      INTEGER NOT NULL CHECK (floor IN (1, 2)),
    map_no     INTEGER NOT NULL,                 -- ロボット（Atmobi）の地図番号。2F=14, 1F=13
    label      TEXT    NOT NULL,                 -- '2Fエレベータ付近'
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS street_address (
    id         INTEGER PRIMARY KEY,
    area_id    INTEGER NOT NULL REFERENCES area(id),
    address_no INTEGER NOT NULL,                 -- 1,2,3 → 番地1/番地2/番地3
    path_no    INTEGER NOT NULL,                 -- 経路番号 → 生成器へ
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (area_id, address_no)
);

CREATE TRIGGER IF NOT EXISTS trg_sa_path_ins BEFORE INSERT ON street_address
WHEN EXISTS (SELECT 1 FROM street_address sa
             JOIN area a1 ON a1.id = sa.area_id
             JOIN area a2 ON a2.id = NEW.area_id
             WHERE a1.map_no = a2.map_no AND sa.path_no = NEW.path_no AND sa.id IS NOT NEW.id)
BEGIN SELECT RAISE(ABORT, 'path_no duplicated on the same map_no'); END;

CREATE TRIGGER IF NOT EXISTS trg_sa_path_upd BEFORE UPDATE OF path_no, area_id ON street_address
WHEN EXISTS (SELECT 1 FROM street_address sa
             JOIN area a1 ON a1.id = sa.area_id
             JOIN area a2 ON a2.id = NEW.area_id
             WHERE a1.map_no = a2.map_no AND sa.path_no = NEW.path_no AND sa.id <> NEW.id)
BEGIN SELECT RAISE(ABORT, 'path_no duplicated on the same map_no'); END;

CREATE TABLE IF NOT EXISTS rack (
    id                INTEGER PRIMARY KEY,
    marker_id         INTEGER NOT NULL UNIQUE,   -- 荷台に貼ってあるARマーカーのID（システム全体で一意）
    street_address_id INTEGER REFERENCES street_address(id),
    is_empty          INTEGER NOT NULL DEFAULT 1 CHECK (is_empty IN (0, 1)),  -- 1 = 空荷
    is_deleted        INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_rack_address
    ON rack(street_address_id) WHERE street_address_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE,
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS robot (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,          -- '宅配ロボット'。2台目からは 1号機 / 2号機 など
    phase         TEXT NOT NULL DEFAULT 'idle'
                  CHECK (phase IN ('idle','delivery','return','homing','error')),
    at_home       INTEGER NOT NULL DEFAULT 1 CHECK (at_home IN (0, 1)),
    floor         INTEGER NOT NULL DEFAULT 2,
    homing_floor  INTEGER,
    stuck_reason  TEXT,
    action        TEXT,
    action_index  INTEGER,
    -- そのアクションが始まった時刻(ブリッジの stamp、ISO8601)。断面図が区間の中の
    -- 進みを「始まってからの経過」で出すために使う。画面を開き直しても位置がずれない
    action_since  TEXT,
    -- 走行中の一時停止の理由(エンジンの reason。"emergency stop" など)。通常は NULL。
    -- Atmobi は非常停止の解除後に自分で走り出すので、依頼は running のまま
    pause_reason  TEXT,
    scenario_name TEXT,                          -- 走行中の断片 run_<id>_<NN>_<kind>
    step_index    INTEGER,                       -- その断片の中での位置
    step_total    INTEGER,
    is_deleted    INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS request (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL DEFAULT 'delivery'
                  CHECK (kind IN ('delivery', 'collect')),
    created_by    TEXT NOT NULL DEFAULT 'user'
                  CHECK (created_by IN ('user', 'system')),
    tracking_no   TEXT UNIQUE,                 -- 送り状番号。二重送信を弾く
    item          TEXT,
    receiver_name TEXT,                        -- 伝票の記載そのもの
    receiver_user_id INTEGER REFERENCES user(id),       -- 照合できたら埋まる
    rack_id         INTEGER NOT NULL REFERENCES rack(id),
    from_area_id    INTEGER NOT NULL REFERENCES area(id),            -- 壁QRで読んだエリア
    from_address_id INTEGER NOT NULL REFERENCES street_address(id),  -- 荷台の位置から確定
    to_area_id      INTEGER NOT NULL REFERENCES area(id),            -- 人が選んだ／サーバーが決めた
    to_address_id   INTEGER          REFERENCES street_address(id),  -- サーバーが選んだ
    assigned_robot_id INTEGER        REFERENCES robot(id),  -- queued の間は NULL
    priority      INTEGER NOT NULL DEFAULT 2      -- 1=急ぎ 2=通常 3=低。ORDER BY で使う
                  CHECK (priority IN (1, 2, 3)),
    status        TEXT NOT NULL,
    is_deleted    INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    started_at    TEXT,
    from_home     INTEGER NOT NULL DEFAULT 0 CHECK (from_home IN (0, 1)),
    delivered_at  TEXT,                          -- collect では「戻し終わった時刻」
    confirmed_at  TEXT,                          -- delivery だけ
    cancelled_at  TEXT,                          -- 取消した時刻
    CHECK (
        (kind = 'delivery'
         AND status IN ('queued','running','delivered','confirmed','failed','cancelled'))
        OR
        (kind = 'collect'
         AND tracking_no IS NULL AND item IS NULL AND receiver_name IS NULL
         AND receiver_user_id IS NULL AND confirmed_at IS NULL
         AND status IN ('queued','running','done','failed','cancelled'))
    )
);
CREATE INDEX IF NOT EXISTS ix_request_status ON request(status, created_at);

CREATE INDEX IF NOT EXISTS ix_request_queue ON request(status, priority, created_at, id);

CREATE INDEX IF NOT EXISTS ix_request_receiver ON request(receiver_user_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS ux_request_running_robot
    ON request(assigned_robot_id)
    WHERE status = 'running' AND assigned_robot_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_request_area_ins BEFORE INSERT ON request
WHEN (SELECT area_id FROM street_address WHERE id = NEW.from_address_id) <> NEW.from_area_id
  OR (NEW.to_address_id IS NOT NULL
      AND (SELECT area_id FROM street_address WHERE id = NEW.to_address_id) <> NEW.to_area_id)
BEGIN SELECT RAISE(ABORT, 'address does not belong to the given area'); END;

CREATE TRIGGER IF NOT EXISTS trg_request_area_upd
BEFORE UPDATE OF from_area_id, from_address_id, to_area_id, to_address_id ON request
WHEN (SELECT area_id FROM street_address WHERE id = NEW.from_address_id) <> NEW.from_area_id
  OR (NEW.to_address_id IS NOT NULL
      AND (SELECT area_id FROM street_address WHERE id = NEW.to_address_id) <> NEW.to_area_id)
BEGIN SELECT RAISE(ABORT, 'address does not belong to the given area'); END;

CREATE TRIGGER IF NOT EXISTS trg_area_updated AFTER UPDATE ON area
WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE area SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_sa_updated AFTER UPDATE ON street_address
WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE street_address SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_rack_updated AFTER UPDATE ON rack
WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE rack SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_user_updated AFTER UPDATE ON user
WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE user SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_robot_updated AFTER UPDATE ON robot
WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE robot SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_request_updated AFTER UPDATE ON request
WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE request SET updated_at = datetime('now') WHERE id = NEW.id; END;

INSERT OR IGNORE INTO area (id, floor, map_no, label) VALUES
    (1, 2, 19, '2Fエレベータ付近'),
    (2, 1, 18, '1Fエレベータ付近');

INSERT OR IGNORE INTO street_address (id, area_id, address_no, path_no) VALUES
    (1, 1, 1, 3),   -- 2F 番地1
    (2, 1, 2, 4),   -- 2F 番地2
    (3, 1, 3, 5),   -- 2F 番地3
    (4, 2, 1, 3),   -- 1F 番地1
    (5, 2, 2, 4),   -- 1F 番地2
    (6, 2, 3, 5);   -- 1F 番地3

INSERT OR IGNORE INTO rack (id, marker_id, street_address_id, is_empty) VALUES
    (1, 3, 1, 1),   -- 荷台3 → 2F 番地1
    (2, 2, 2, 1),   -- 荷台2 → 2F 番地2
    (3, 1, 3, 1),   -- 荷台1 → 2F 番地3
    (4, 4, 4, 1),   -- 荷台4 → 1F 番地1
    (5, 5, 6, 1);   -- 荷台5 → 1F 番地3   （1F 番地2 は空き）

INSERT OR IGNORE INTO user (id, name) VALUES (1, '田中'), (2, '鈴木'), (3, '佐藤');

INSERT OR IGNORE INTO robot (id, name, phase) VALUES (1, '宅配ロボット', 'idle');
