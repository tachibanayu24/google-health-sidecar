-- BMR(基礎代謝)算出のための身体プロフィールを settings に追加(work-plan A-1 / BMR基盤)。
-- Mifflin-St Jeor: BMR = 10*kg + 6.25*cm - 5*age + (男 +5 / 女 -161)。総消費 = BMR + active_energy の定義に使う。
-- すべて任意(NULL 可)。入力が揃わなければ BMR は出さない(実測主義: 推測しない)。
ALTER TABLE settings ADD COLUMN height_cm REAL;
ALTER TABLE settings ADD COLUMN birth_year INTEGER;
ALTER TABLE settings ADD COLUMN sex TEXT CHECK (sex IN ('male', 'female'));
