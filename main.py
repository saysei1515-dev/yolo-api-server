from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from ultralytics import YOLO

app = FastAPI()

# 起動確認用のエンドポイント
@app.get("/")
def read_root():
    return {"message": "YOLO API Server is running!"}

# 画像データやリクエストを受け取るためのデータ構造（必要に応じて拡張します）
class ImageRequest(BaseModel):
    image_url: str = None

# YOLO-Worldによる物体検出用エンドポイント
@app.post("/predict")
def predict_objects(request: ImageRequest):
    try:
        # ここにYOLO-Worldの推論処理を記述していきます
        # 例: models = YOLO('yolov8n-world.pt')
        # results = models(request.image_url)
        
        return {
            "status": "success",
            "detected": ["person", "smartphone"] # テスト用のダミー結果
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
