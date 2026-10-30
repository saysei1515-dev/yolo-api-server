FROM python:3.10-slim

WORKDIR /app

# 必要なシステムパッケージのインストール（パッケージ名を最新の標準に変更）
RUN apt-get update && apt-get install -y \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 依存関係のインストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# アプリケーションコードのコピー
COPY . .

# FastAPIの起動
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "10000"]

