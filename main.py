from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from ultralytics import YOLO
import cv2
import numpy as np

app = FastAPI()

# 標準のYOLOv8nモデルを使用（初回起動時に自動でダウンロードされます）
model = YOLO('yolov8n.pt')

@app.get("/")
def read_root():
    return {"message": "YOLO API Server is running!"}

@app.post("/detect")
async def detect_objects(
    image: UploadFile = File(...),
    target: str = Form("person") # 指定がない場合はデフォルトでperson
):
    try:
        contents = await image.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image file")

        # 推論の実行
        results = model(img)

        detected_items = []
        for r in results:
            boxes = r.boxes
            for box in boxes:
                conf = float(box.conf[0])
                if conf > 0.3: # 信頼度30%以上
                    cls_id = int(box.cls[0])
                    class_name = model.names[cls_id]
                    
                    # ユーザーが探しているもの（target）と一致するもの、またはすべてを返す
                    detected_items.append({"name": class_name, "confidence": conf})

        # 探しているターゲットが含まれているか判定
        found = any(target.lower() in item['name'].lower() for item in detected_items)

        return {
            "status": "success",
            "target": target,
            "detected": detected_items,
            "found": found
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
