# React (Vite) + FastAPI + SQLite on Docker

ORM は使わず、標準ライブラリの `sqlite3` で SQL を直接書く構成。
コンテナは **backend / frontend の2つ**（SQLite はサーバーを持たないので DB 用コンテナは不要）。

```
[ブラウザ]
   ↓ :5173
[frontend]  ── /api を proxy ──→  [backend]  ──→  /data/app.db
 Vite dev server                   FastAPI        (./data/app.db)
```

---

## 1. まず動かす

```bash
docker compose up --build
```

- 画面: http://localhost:5173
- API ドキュメント: http://localhost:8000/docs

ここまでは証明書なしの HTTP で動く。PC で触るだけならこれで足りる。

- **WSL2（Windows）で動かす場合** → スマホから届かせるための設定が要る。3章へ
- **スマホのカメラ（QR読み取り）を使う場合** → HTTPS が必須。4章へ

---

## 2. ★環境ごとに変更する場所

セットアップ時に触るのはこの3か所だけ。

### `docker-compose.yml` — CORS_ORIGINS

```yaml
CORS_ORIGINS: "https://localhost:5173,https://192.168.1.50:5173"
```

`192.168.1.50` を**実際のサーバーIP**に変える。カンマ区切りで複数書ける。
（Vite の proxy 経由なら実は不要だが、8000番を直接叩くとき用の保険）

### `frontend/vite.config.js` — allowedHosts

IP直打ちで使うなら**変更不要**。`https://tasks.local:5173` のようにホスト名を使う場合だけコメントを外す。

```js
allowedHosts: ['tasks.local'],
```

### 証明書の発行コマンド — IP

4章参照。ここにもサーバーIPを書く。

> **IPは必ず固定する。** ルーターのDHCP予約などで固定しないと、IPが変わった時点で証明書が無効になりスマホからアクセスできなくなる。

---

> **すでに名前付きボリュームで運用していた場合の移行**
> DBの置き場所を `./data/` に変更した。旧ボリュームのデータは次で取り出す。
>
> ```bash
> mkdir -p data
> docker compose cp backend:/data/app.db ./data/app.db   # 変更前の compose で実行
> docker compose down
> docker compose up -d                                   # 変更後の compose で起動
> docker volume rm react-fastapi-sqlite_sqlite-data      # 確認後に旧ボリュームを削除
> ```

---

## 3. WSL2（Windows）で使う場合

WSL2 内で動かしたコンテナのポートは、Windows 本体ではなく **WSL の仮想マシン内**で開く。
そのままだと `localhost` からは繋がるのに、スマホなど LAN の他の端末からは届かない。

### 3-1. ミラーモードにする

Windows 11 22H2 以降ならこれが一番きれい。`C:\Users\<ユーザー名>\.wslconfig` を作成する。

```ini
[wsl2]
networkingMode=mirrored
firewall=true
```

PowerShell で `wsl --shutdown` してから WSL を起動し直す。

適用されたかは WSL 内で確認する。

```bash
hostname -I
```

Windows と同じ LAN IP（`192.168.x.x`）が出れば OK。`172.x` しか出ないなら NAT のままで、
次のどれかが原因のことが多い。

- **ファイル名が `.wslconfig.txt` になっている**（メモ帳が拡張子を付ける。一番多い）
- WSL が古い → `wsl --version` で 2.0.4 未満なら `wsl --update`
- Windows 10 である → ミラーモードは非対応。3-4 の portproxy を使う

### 3-2. Hyper-V ファイアウォールを開ける

ミラーモードでは通常の Windows Defender ファイアウォールとは**別のレイヤー**が入り、
既定で受信を遮断する。管理者権限の PowerShell で使うポートだけ開ける。

```powershell
$vmCreatorId = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'

New-NetFirewallHyperVRule -Name "WSL-dev" -DisplayName "WSL dev ports" `
  -Direction Inbound -VMCreatorId $vmCreatorId -Protocol TCP -LocalPorts 5173,8000
```

切り分けのため一時的に全許可にする場合（確認後は必ず戻す）:

```powershell
Set-NetFirewallHyperVVMSetting -Name $vmCreatorId -DefaultInboundAction Allow
# 戻す
Set-NetFirewallHyperVVMSetting -Name $vmCreatorId -DefaultInboundAction Block
```

ネットワークプロファイルがパブリックだとルールが効かないことがある。社内LANならプライベートにする。

```powershell
Get-NetConnectionProfile
Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
```

> Windows の更新後にプロファイルがパブリックへ戻ることがある。
> ある日突然スマホから繋がらなくなったら、まず `Get-NetConnectionProfile` を疑う。

### 3-3. ★確認は必ずスマホから行う

**開発PCのブラウザで `http://<LAN IP>:5173` が開けなくても、異常とは限らない。**

自分宛てのアドレスに自分から繋ぐ経路（ヘアピン接続）は、外部からの接続とは別扱いになり、
ミラーモードでは通らないことがある。スマホなど別の端末からは普通に届く。

| 端末 | 使うURL |
|---|---|
| 開発PC | `http://localhost:5173` |
| スマホ・他PC | `http://<LAN IP>:5173` |

PCのブラウザでLAN IPを開いて「繋がらない」と判断すると、塞がっていないファイアウォールを
延々と設定することになる。**切り分けは実機で行う。**

### 3-4. Windows 10 の場合（portproxy）

ミラーモードが使えないときの代替。管理者権限の PowerShell で実行する。

```powershell
wsl hostname -I        # 例: 172.24.128.1

netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=5173 connectaddress=172.24.128.1 connectport=5173
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8000 connectaddress=172.24.128.1 connectport=8000

netsh interface portproxy show all
```

**この WSL の IP は再起動のたびに変わる。** 変わったら `netsh interface portproxy reset` して登録し直す。
常設サーバーとして置くなら現実的ではないので、可能ならミラーモードにする。

### 3-5. 証明書の注意（4章と関連）

WSL 内で `mkcert -install` した場合、CAが登録されるのは **WSL の証明書ストア**。
Windows 側の Chrome / Edge は信頼しない。

- スマホは `rootCA.pem` を手動で入れるので影響なし
- Windows のブラウザで確認したいなら、`$(mkcert -CAROOT)/rootCA.pem` を Windows にコピーし、
  「信頼されたルート証明機関」にインポートする

証明書に入れるIPは WSL の IP ではなく、**`hostname -I` で出た Windows の LAN IP**。

---

## 4. HTTPS にする（スマホのカメラを使う場合）

外部サービスは使わない。`mkcert` でローカルにCAを作り、それをスマホに手動で入れる。

### 全体の流れ

**証明書は2種類あり、どちらも必要。** ここを混同すると必ず詰まる。

| | 何を | どこへ | 無いとどうなる |
|---|---|---|---|
| **サーバー証明書** | `key.pem` / `cert.pem` | `frontend/certs/` | HTTPS にならない（HTTPのまま起動する） |
| **CA証明書** | `rootCA.pem` / `.crt` | `ca/` → スマホ | スマホで警告が出る |

```
1. mkcert -install                      開発マシンにCAを作る
2. mkcert -key-file ... -cert-file ...  サーバー証明書を発行 → frontend/certs/   ← 4-1
3. cp "$(mkcert -CAROOT)/rootCA.pem" ca/  CA証明書を配布用に置く                ← 4-2
4. スマホで http://<IP>:8000/setup      CAをインストール                        ← 4-2
5. スマホで https://<IP>:5173           アクセスできる                          ← 4-5
```

### 4-1. mkcert を入れてサーバー証明書を発行する

```bash
# macOS
brew install mkcert nss
# Windows: choco install mkcert

# WSL / Linux
sudo apt install -y libnss3-tools
curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
chmod +x mkcert-v*-linux-amd64 && sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert

mkcert -install     # ローカルCAをOSに登録（初回のみ）
```

サーバーのIPを確認する。

```bash
ipconfig getifaddr en0         # macOS
ip -4 addr show scope global   # Linux
```

★ 出てきたIPを含めて発行する。開発PCと常設サーバーが別なら両方並べて1枚にまとめてよい。

```bash
cd frontend && mkdir -p certs
mkcert -key-file certs/key.pem -cert-file certs/cert.pem \
       localhost 127.0.0.1 192.168.1.50
```

`./frontend` はコンテナにマウントされているので、ホストで作れば `/app/certs` から見える。
Dockerfile の変更は不要。反映して確認する。

```bash
cd .. && docker compose restart frontend
docker compose logs frontend | tail -5
```

**ログの Local が `https://` になっていれば成功。**
「certs/ が無いため HTTP で起動します」と出たらファイルが置けていない。

```bash
ls -l frontend/certs/                    # key.pem と cert.pem があるか
openssl x509 -in frontend/certs/cert.pem -noout -text | grep -A1 "Subject Alternative Name"
```

`IP Address:192.168.x.x` が、スマホでアクセスするIPと一致している必要がある。

> `certs/` は `.gitignore` と `.dockerignore` に入れてある。**鍵はコミットしない。**
> 証明書はマシンごとに作るもの。もう一人は自分の環境で `mkcert -install` からやり直す。

### 4-2. CAをスマホに渡す

プロジェクトの `ca/` に置くと、アプリのトップ画面と `/setup` ページから配布される。

```bash
mkdir -p ca
cp "$(mkcert -CAROOT)/rootCA.pem" ca/
cp ca/rootCA.pem ca/rootCA.crt          # Android は .crt を使う
docker compose restart backend
```

スマホのブラウザで **HTTP** のセットアップページを開く。

```
http://192.168.1.50:8000/setup
```

> **`https://` ではなく `http://` で開く。** CAを入れる前の端末は https 側の証明書を
> 信頼していないため、警告を踏まないと開けない。backend の 8000 番は平文HTTPなので
> そのまま開ける。

インストール後は、アプリのトップ画面下部にもダウンロードリンクが出る（2台目以降に便利）。

> **`ca/` に置いてよいのは `rootCA.pem` と `rootCA.crt` だけ。**
> `rootCA-key.pem`（秘密鍵）は絶対に置かない。これがあれば任意のドメインの偽証明書を作れてしまう。
> backend 側もこの2つのファイル名以外は配信しない（`backend/app/ca.py` のホワイトリスト）。
> `ca/` は `.gitignore` 済み。

### 4-3. iOS に入れる（2段階。2つめを忘れると信頼されない）

1. Safari で `rootCA.pem` を開く → プロファイルがダウンロードされる
2. 設定 → 一般 → VPNとデバイス管理 → ダウンロード済みプロファイル → インストール
3. **設定 → 一般 → 情報 → 証明書信頼設定** → mkcert のトグルを ON ← ここを忘れがち

### 4-4. Android に入れる

設定 → セキュリティ → 暗号化と認証情報 → 証明書をインストール → **CA証明書**（「VPNとアプリ」ではない）

- 画面ロック（PIN等）が未設定だと登録できない
- `.pem` が選択画面に出ないことがあるので `.crt` を選ぶ

### 4-5. 確認

スマホで `https://192.168.1.50:5173` を開く。鍵アイコンが出て警告が無ければ成功。

| 症状 | 見るべき場所 |
|---|---|
| PCのChromeでも同じURLが警告になる | 証明書にIPが入っていない → 4-1をやり直す |
| PCは通るがスマホだけ警告 | CAのインストール（iOSなら 4-3 の手順3） |
| そもそも接続できない | ファイアウォールで5173番が塞がれていないか |

証明書の有効期限は約2年。切れたら 4-1 を打ち直すだけでよく、CA は10年有効なのでスマホへの再インストールは不要。

---

## 5. 常設サーバーとして置く

```bash
docker compose up -d      # -d を付けないとターミナルを閉じた時点で止まる
```

`restart: unless-stopped` を入れてあるので、サーバー再起動や停電後も自動で復帰する。

このプロジェクトでは本番用のビルドを分けていない（社内LAN・数人での利用を想定）。
外部公開する、人数が増える、といった段階になったら Vite をビルドして nginx で配信する構成に切り替える。

---

## 6. QR読み取り

スマホのカメラでQRコードを読み、中身をタスク入力欄に流し込む。
`frontend/src/QrScanner.jsx` がその実装。

**動かすには HTTPS が必須**（4章）。`http://` で開くと「HTTPSでの接続が必要です」と表示される。
PC の `http://localhost:5173` だけは例外的にカメラが使える。

### 使い方

入力欄の隣の「QR」ボタン → カメラが起動 → 枠内にQRをかざす → 読み取った文字列が入力欄に入る。
**自動では送信しない。** 内容を確認してから「追加」を押す。

テスト用のQRは、任意の生成サイトでテキスト（例: `会議室の備品を補充する`）をエンコードすれば作れる。

### 実装のポイント

- `BarcodeDetector`（iOS 17+ / Chrome）があればそれを使い、無ければ `jsQR` にフォールバックする
- 解析は 640px に縮小してから行う（フル解像度だと重い）
- 背面カメラは `facingMode: 'environment'` で明示指定する。省くと前面カメラが起動する
- `<video>` に `playsInline muted` が必要。無いと iOS Safari で再生されない
- 閉じるときに `track.stop()` を呼ぶ。忘れるとカメラのランプが点いたままになる

### カメラが使えないときの表示

原因ごとにメッセージを分けている（`QrScanner.jsx` の `MESSAGES`）。

| 状況 | 表示 |
|---|---|
| `http://` で開いている | HTTPSでの接続が必要 |
| 許可を拒否した | ブラウザ設定でカメラを許可 |
| カメラが無い | カメラが見つからない |
| 他アプリが使用中 | 他のアプリが使用している可能性 |
| 非対応ブラウザ | ブラウザが対応していない |

iOS Safari は許可がタブを閉じるたびにリセットされる。一度拒否すると再度聞かれないので、
その場合は アプリの設定（Safari → Webサイトの設定）から許可し直す。

---

## 7. SQLを書くときのルール

**値は必ず `?` で渡す。** 文字列連結や f-string で値を埋め込むと SQL インジェクションになる。

```python
db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))   # OK
db.execute(f"SELECT * FROM tasks WHERE id = {task_id}")      # NG
```

`main.py` に f-string があるが、展開しているのは列名（`COLUMNS`）だけで外部入力は含まない。
PATCH の列名も `UPDATABLE` のホワイトリストを通してから組み立てている。
**レビューの目印は「f-string の中に値が入っていないか」。**

**書き込んだら `db.commit()`。** INSERT / UPDATE / DELETE のあとに呼ばないと保存されない。SELECT には不要。

**`RETURNING` で書き込んだ行をそのまま受け取れる。** INSERT のあとに SELECT し直す必要はない。

**レスポンスはバックエンドで組み立てる。** テーブルの行をそのまま返してフロントで結合すると、テーブル構造がAPIに漏れるうえN+1になる。JOINして Python で辞書にまとめ、`response_model` で形を宣言する。

---

## 8. ログ

`backend/app/logging_config.py` で設定している。出力先は標準出力（ファイルには書かない）。

```bash
docker compose logs -f backend           # 追いかける
docker compose logs --tail=100 backend   # 直近だけ
docker compose logs --since 10m backend  # 直近10分
```

```
2026-09-08 10:21:09,792 INFO     app.main: タスクを作成しました id=1
2026-09-08 10:21:09,808 WARNING  app.main: 削除対象が見つかりません id=999
2026-09-08 10:21:25,073 ERROR    app.main: 未処理の例外 GET /api/_boom
Traceback (most recent call last):
  ...
```

`LOG_LEVEL` は `docker-compose.yml` で変える。既定は INFO、詳しく見たいときは `DEBUG`。

### 書き方

```python
import logging

log = logging.getLogger(__name__)

log.info("タスクを作成しました id=%s", task_id)      # 値は %s で渡す（f-string は非推奨）
log.warning("更新対象が見つかりません id=%s", task_id)

try:
    ...
except sqlite3.IntegrityError:
    log.exception("作成に失敗しました")              # トレースが自動で付く
    raise HTTPException(status_code=400, detail="登録できませんでした")
```

| レベル | 用途 |
|---|---|
| `debug` | 開発中に見たいだけのもの。本番では出さない |
| `info` | 起きたことの記録。作成・削除・起動など |
| `warning` | 想定内だが気になること |
| `error` / `exception` | 処理が失敗した。`exception` はトレース付き |

### ★リクエストの中身は記録しない

```python
log.info("タスクを作成しました id=%s", task_id)     # OK
log.info("リクエスト: %s", payload.model_dump())    # NG
```

利用者が何を書くか分からないうえ、将来ログインを足したときにパスワードやトークンが残る。
IDや件数など、後から追える最小限にする。

### 補足

- `logging.basicConfig()` を呼ばないと `log.info()` は**表示されない**。uvicorn は自分用のロガーしか設定しないため
- 未処理の例外は `main.py` のハンドラがトレース付きで記録し、利用者には500だけを返す
- Docker の既定のログドライバは上限なく肥大するので、`docker-compose.yml` で 10MB×3 に制限している

---

## 9. DBを手で触る

```bash
docker compose exec backend sqlite3 /data/app.db
```

```sql
.tables            -- テーブル一覧
.schema tasks      -- 定義を見る
.headers on
.mode column
SELECT * FROM tasks;
.quit
```

アプリと同じSQLをここで試してから `main.py` に書く、という進め方ができる。

`sqlite3: not found` と出たら Dockerfile 変更後に再ビルドしていない。

```bash
docker compose build backend && docker compose up -d
```

---

## 10. テーブルを変更する

`backend/app/schema.sql` を編集する。ただし `CREATE TABLE IF NOT EXISTS` なので**既存のテーブルには反映されない**。

**開発中（データを捨ててよい）:**

```bash
docker compose stop backend
rm data/app.db
docker compose up -d
```

DBは `./data/app.db` という**ただのファイル**なので、消せば次回起動時に `schema.sql` から作り直される。
消す前にコピーを取っておけば戻せる。

```bash
cp data/app.db data/app.db.bak    # 念のため
```

**データを残す場合:** SQLite は列の制約を後から変更できないので、作り直して移し替える。

```bash
docker compose exec -T backend python - << 'PY'
import sqlite3
c = sqlite3.connect('/data/app.db')
c.executescript("""
CREATE TABLE tasks_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO tasks_new (id, title, done, created_at)
  SELECT id, title, done, created_at FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
""")
c.commit()
PY
```

**列を追加したら3か所セットで直す。** ここは自動同期されない。

1. `backend/app/schema.sql` — テーブル定義
2. `backend/app/main.py` の `COLUMNS` — SELECTする列
3. `backend/app/schemas.py` の `TaskOut` — レスポンスの型

現在の定義は次で確認できる。

```bash
docker compose exec backend python -c "import sqlite3;print(sqlite3.connect('/data/app.db').execute(\"SELECT sql FROM sqlite_master WHERE name='tasks'\").fetchone()[0])"
```

---

## 11. バックアップ

**実データが入り始めたら必ず設定する。** DBは1ファイルなので、消えるときは丸ごと消える。

DBは `./data/app.db` にあるので、単純にコピーするだけでもよい。
ただし**書き込み中のコピーは壊れた状態を掴むことがある**ので、動かしたまま取るなら `.backup` を使う。

```bash
# 動かしたまま安全にコピー
docker compose exec -T backend python -c "import sqlite3;s=sqlite3.connect('/data/app.db');d=sqlite3.connect('/data/backup.db');s.backup(d);d.close();s.close()"
mv data/backup.db data/backup-$(date +%F).db

# SQLとして書き出す（テキストなので差分が見える／別マシンへ移すとき向き）
docker compose exec -T backend python -c "import sqlite3,sys;[sys.stdout.write(l+'\n') for l in sqlite3.connect('/data/app.db').iterdump()]" > backup-$(date +%F).sql
```

書き戻し。

```bash
# .db から戻す場合
docker compose stop backend
cp data/backup-2026-09-07.db data/app.db
docker compose up -d

# .sql から戻す場合
docker compose stop backend && rm data/app.db && docker compose up -d
docker compose exec -T backend python -c "import sqlite3,sys;sqlite3.connect('/data/app.db').executescript(sys.stdin.read())" < backup-2026-09-07.sql
```

`-T` はTTYを無効にする指定。付けないとリダイレクトした内容に改行コードが混ざって壊れる。
これを cron や systemd timer で1日1回回し、生成された `.sql` を別の場所にコピーしておけば十分。

> `data/` はプロジェクト内にあるだけで、**それ自体はバックアップではない**。
> マシンが壊れれば一緒に失われる。別の場所へコピーして初めてバックアップになる。

### コマンドとデータの関係

| コマンド | コンテナ | DB |
|---|---|---|
| `docker compose stop` | 停止 | 残る |
| `docker compose down` | 削除 | 残る |
| `docker compose down -v` | 削除 | 残る |
| `docker compose up --build` | 作り直し | 残る |
| `rm data/app.db` | — | **消える** |

DBは名前付きボリュームではなく `./data/` に置いてあるので、`-v` を打っても消えない。
消えるのはファイルを直接消したときだけ。

---

## 12. よくあるエラー

**`NOT NULL constraint failed: tasks.done`**
古いスキーマのテーブルがボリュームに残っている。10章の手順で作り直す。

**`Could not find the file ... in container`（`docker compose cp`）**
コピー元のファイルが作られていない。その前のコマンドが失敗している。

**`sqlite3: not found`**
Dockerfile を変更した後に再ビルドしていない。`docker compose build backend`

**スマホでカメラが起動しない**
HTTPSになっているか確認する。`http://localhost` はPCのみ例外的にカメラが使える。
背面カメラは明示指定が必要。

```js
navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
```

**npmパッケージを追加したのに反映されない**
`docker compose build frontend` でイメージを作り直す。

**スマホから `http://<LAN IP>:5173` に繋がらない（WSL2）**
3章。順に確認する。

1. WSL内: `curl -sI http://127.0.0.1:5173` → 200 が返るか
2. Windows: `http://localhost:5173` → 開けるか
3. WSL内: `hostname -I` → Windows と同じ LAN IP が出るか（ミラーモードの確認）
4. Hyper-V ファイアウォールのルール（3-2）
5. ネットワークプロファイルが Private か

**開発PCのブラウザでは LAN IP で確認しない**（3-3）。繋がらなくても正常なことがある。

**スマホにCAを入れたのに `https://<IP>:5173` が開けない**
サーバー証明書（`frontend/certs/`）を発行し忘れていることが多い。CAを配っただけではHTTPSにならない。
4章の「全体の流れ」の表を参照。確認は次の順。

1. `ls -l frontend/certs/` → `key.pem` と `cert.pem` があるか
2. `docker compose logs frontend | tail -5` → Local が `https://` か
3. 証明書のSANにアクセス先のIPが入っているか（4-1の openssl コマンド）
4. iOS: 設定 → 一般 → 情報 → 証明書信頼設定 のトグルがONか（4-3）

---

## 13. ファイル構成

```
.
├── docker-compose.yml        ★CORS_ORIGINS を環境に合わせる
├── ca/                       ★mkcertのCAを置く（Git管理外）
├── data/                     DBの実体 app.db（Git管理外）
├── backend/
│   ├── Dockerfile            sqlite3 CLI 入り
│   ├── requirements.txt      fastapi / uvicorn / pydantic のみ
│   └── app/
│       ├── main.py           エンドポイント（SQLはここに直接書く）
│       ├── ca.py             証明書の配布と /setup ページ
│       ├── logging_config.py ログ設定
│       ├── db.py             接続とスキーマ初期化
│       ├── schema.sql        テーブル定義
│       └── schemas.py        リクエスト/レスポンスの型
└── frontend/
    ├── Dockerfile
    ├── vite.config.js        ★ホスト名を使うなら allowedHosts
    ├── package-lock.json      必ずコミットする
    ├── certs/                ★mkcertで作る（Git管理外）
    └── src/
        ├── App.jsx
        ├── QrScanner.jsx      QR読み取り
        ├── main.jsx
        └── index.css
```

## 14. 依存バージョン

2026年9月時点の最新安定版で固定している。

| | バージョン | 備考 |
|---|---|---|
| Python | 3.13 (slim) | 3.14 も可。wheel の揃い方を優先して3.13 |
| FastAPI | 0.141.1 | |
| uvicorn | 0.52.4 | |
| pydantic | 2.13.5 | |
| Node | 24 (alpine) | Vite 8 の要件は `^20.19 \|\| >=22.12` |
| React | 19.2.8 | |
| jsQR | 1.4.0 | BarcodeDetector 非対応ブラウザ用 |
| Vite | 8.2.2 | |
| @vitejs/plugin-react | 6.1.1 | Vite 8 専用。Vite 7 に戻すなら 5.x |

**`package-lock.json` は必ずコミットする。** `package.json` の `^` は「その範囲で最新」を意味するので、
lock が無いと2人の環境で別のバージョンが入る。バグの再現性が落ちる。

更新の確認方法:

```bash
docker compose exec frontend npm outdated
docker compose exec backend pip list --outdated
```

---

## 15. よく使うコマンド

```bash
docker compose up -d              # バックグラウンド起動
docker compose logs -f backend    # ログ確認
docker compose restart frontend   # 設定変更を反映
docker compose exec backend bash  # コンテナに入る
docker compose ps                 # 状態確認（2コンテナ出る）
docker compose down               # 停止 + コンテナ削除（DBは残る）
```
