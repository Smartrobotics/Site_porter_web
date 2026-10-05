# SitePorter

建物内で宅配ロボットを動かす Web アプリ。配送員が壁の QR コードを読み取り、荷台の搬送先を選ぶと、サーバーがロボットをそこまで走らせる。階をまたぐときはエレベーターにも乗る。

```
スマホ / PC ──:5173──▶ frontend ──/api──▶ backend ──:8080──▶ scenario_bridge ──▶ ロボット
                       React + Vite      FastAPI + SQLite     (ロボット側リポジトリ, ROS1)
```

すべて Docker で動くので、Node や Python のインストールは不要。

## まず動かす(ロボットなし)

Docker と Compose があればよい。

1. ロボットをシミュレーションにする。`docker-compose.yml` を次のように変える:

   ```yaml
   ROBOT_MODE: mock        # リポジトリでは bridge
   ```

2. 起動する:

   ```bash
   docker compose up --build
   ```

3. **http://localhost:5173** を開く。API は http://localhost:8000/docs にある。

初回起動時に `data/app.db` が作られ、サンプルデータ(2フロア、荷台5台、ユーザー3人)が入る。

### 搬送を試す

ログインはない。利用者は QR コードを読み取ってアプリに入る。代わりに次のリンクを開く:

| リンク | 何の代わりか |
|---|---|
| http://localhost:5173/?area=1 | 2F の壁の QR — ここから搬送依頼を出す |
| http://localhost:5173/?user=1 | 受取人の QR — その人宛ての搬送 |

`mock` ではロボットはタイマーで「走る」。搬送1件はおよそ1分。

## スマホで使う

QR コードと荷台のマーカーはスマホのカメラで読み取るが、ブラウザがカメラを許可するのは **HTTPS** のときだけ。証明書がなければアプリは HTTP で起動する。PC ならそれで足りるが、スマホでは使えない。

マシンの LAN の IP(ここでは `192.168.1.50`)で証明書を発行する:

```bash
sudo apt install mkcert libnss3-tools     # Ubuntu
mkcert -install
mkdir -p frontend/certs
mkcert -key-file frontend/certs/key.pem -cert-file frontend/certs/cert.pem \
       localhost 127.0.0.1 192.168.1.50
cp "$(mkcert -CAROOT)/rootCA.pem" ca/
docker compose restart frontend
```

次にスマホで:

1. `http://192.168.1.50:8000/setup` を開き、証明書をインストールする。
2. `https://192.168.1.50:5173` を開く。

IP は固定しておく(DHCP 予約など)。IP が変わると証明書が使えなくなる。
iOS・Android・Windows(WSL2)の詳しい手順: [INSTRUCTION.md](INSTRUCTION.md) の 3〜4 章。

## ロボットと動かす

`ROBOT_MODE: bridge` のとき、サーバーは各走行をロボット PC 上の `scenario_bridge` に送る。さらに走行ファイルをロボット側リポジトリに書き込むので、2つのリポジトリは並べて置く:

```
takuhai_project/
├── Site_porter_web/                          ← このリポジトリ
└── takuhai_container_ws/Taisei_takuhai_system/
```

(`mock` でもファイルは書き込まれる。ロボット側リポジトリが無ければ、Docker がその場所に空のフォルダを作る。問題はない。)

ロボットは無いが、この経路を試したい場合は、手元でブリッジの代役を起動する:

```bash
python3 tools/fake_bridge.py --host 172.17.0.1
```

アドレスは必ずこれにする。サーバーは Docker の中で動いているので、手元の `127.0.0.1` には届かない。`--fail-at 2`、`--hang` などで異常系を再現できる(一覧は `--help`)。

## 更新する

```bash
git pull
docker compose up -d --build -V
```

`-V` は省略しない。frontend は `node_modules` を Docker のボリュームに置いているため、`-V` がないと追加された npm パッケージがコンテナに入らず、`Failed to resolve import` で動かなくなる。

## 知っておくと便利

- コードの変更は自動で反映される。両方のコンテナがファイルの変更で再読み込みする。
- ログ: `docker compose logs -f backend`
- DB を空にしてやり直す: `docker compose down && rm -f data/app.db* && docker compose up -d`
- ロボットが頼る現地の実測値(HOME の位置、エレベーター前の地点)は `backend/app/scenario/floors.json` にある。現地で測り直したときだけ変える。

## どこに何があるか

```
backend/app/
  main.py          HTTP API
  engine.py        ロボットのループ: 待ち行列、走行、異常
  scenario/        走行をロボットのコマンドファイルに変換する
  schema.sql       テーブルとサンプルデータ
frontend/src/
  screens/         画面ごとに1ファイル
tools/
  fake_bridge.py   テスト用のロボットの代役
data/app.db        データベース(git には入れない)
INSTRUCTION.md     詳しい手順書
```
