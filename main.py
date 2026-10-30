
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from ultralytics import YOLO
import cv2
import numpy as np
import io
from PIL import Image

app = FastAPI()

# YOLOモデルの読み込み（起動時に1度だけロード）
# YOLO-Worldモデルを使用（指定したキーワードで検出できるモデル）
model = YOLO('yolov8n-world.pt')

@app.get("/")
def read_root():
    return {"message": "YOLO API Server is running!"}

@app.post("/detect")
async def detect_objects(
    image: UploadFile = File(...),
    target: str = Form(...)
):
    try:
        # 1. 送られてきた画像ファイルを開く
        contents = await image.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image file")

        # 2. YOLO-Worldに探したいクラス（target）を設定
        # ユーザーが入力したキーワード（例: "pen", "person"）をセットします
        model.set_classes([target])

        # 3. 推論の実行
        results = model(img)

        # 4. 検出結果から見つかったか判定
        detected_items = []
        for r in results:
            boxes = r.boxes
            for box in boxes:
                # 信頼度（確信度）が一定以上（例: 30%以上）のものを通す
                conf = float(box.conf[0])
                if conf > 0.3:
                    cls_id = int(box.cls[0])
                    class_name = model.names[cls_id]
                    detected_items.append({"name": class_name, "confidence": conf})

        return {
            "status": "success",
            "target": target,
            "detected": detected_items,
            "found": len(detected_items) > 0
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))