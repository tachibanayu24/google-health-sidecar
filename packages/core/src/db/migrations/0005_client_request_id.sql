-- 0005: オフライン下書きの冪等キー(§9.8)。
-- 圏外で記録→復帰時に再送した際、レスポンス消失で二重登録しないよう client 生成 UUID で重複排除。
ALTER TABLE meals ADD COLUMN client_request_id TEXT;
ALTER TABLE workout_sessions ADD COLUMN client_request_id TEXT;
CREATE UNIQUE INDEX idx_meals_creq ON meals(client_request_id) WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX idx_ws_creq ON workout_sessions(client_request_id) WHERE client_request_id IS NOT NULL;
