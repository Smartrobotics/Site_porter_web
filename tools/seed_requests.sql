-- SitePorter — テスト用の搬送依頼4件（プレスリリース時の配置）
--   sqlite3 siteporter.db < seed_requests.sql
-- 2回目は tracking_no UNIQUE で失敗する（二重送信の検査。正常）
-- to_address_id は入れない。番地を決めるのはサーバー（走行開始時に空きから選ぶ）
INSERT INTO request
    (tracking_no,      item,                   receiver_name, receiver_user_id,
     rack_id, from_area_id, from_address_id, to_area_id, priority, status)
VALUES
    ('4888-1091-8164', '手袋 #1166',           '田中', 1,    2, 1, 2, 2, 1, 'queued'),
    ('4888-1091-8231', '安全帯 #2043',          '鈴木', 2,    1, 1, 1, 2, 2, 'queued'),
    ('4888-1091-8355', 'レーザー距離計 #0577',  '佐藤', 3,    3, 1, 3, 2, 2, 'queued'),
    ('4888-1091-8402', 'ヘルメット #0088',      '三井', NULL, 4, 2, 4, 1, 3, 'queued');

-- 依頼受付で荷台は is_empty 1→0（docs/siteporter-db.ja.md §11）
UPDATE rack SET is_empty = 0 WHERE id IN (1, 2, 3, 4);
