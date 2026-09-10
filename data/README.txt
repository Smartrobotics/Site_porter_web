SQLite の実体（app.db）がここに作られる。

  - docker compose down -v を打っても消えない
  - テーブルを作り直したいときは rm data/app.db してから docker compose up -d
  - バックアップは README の「バックアップ」を参照
