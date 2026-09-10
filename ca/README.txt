mkcert のルート証明書をここに置くと、
http://<サーバーIP>:8000/setup からスマホにダウンロードできるようになる。

  cp "$(mkcert -CAROOT)/rootCA.pem" ca/
  cp ca/rootCA.pem ca/rootCA.crt
  docker compose restart backend

置いてよいのは上の2つだけ。
rootCA-key.pem（秘密鍵）は絶対にここに置かないこと。
