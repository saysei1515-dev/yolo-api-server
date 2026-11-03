import { ObjectDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2";

let objectDetector = undefined;
let runningMode = "VIDEO";
let webcamRunning = false;
let vision = undefined;
let mobilenetModel = undefined;
let currentModelType = "lite0";

let registeredEmbeddings = []; 
let backgroundEmbeddings = []; 
let useCustomModel = false;
let activeCustomName = "";
let currentAspect = 'square'; 

let video, canvas, ctx, statusEl, startButton, stopButton, connStatusEl;
let lastVideoTime = -1;
let currentSearchWord = "cup";
let lastSaveTime = 0; 

let peer = null;
let conn = null;
let pcYoloDetections = []; // PCから送られてきたYOLO結果格納用

let capturedObjects = [];
let capturedBackgrounds = [];

const modelPaths = {
  lite0: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  lite2: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite"
};

window.addEventListener('DOMContentLoaded', () => {
  video = document.getElementById("video");
  canvas = document.getElementById("outputCanvas");
  if (canvas) ctx = canvas.getContext("2d");
  statusEl = document.getElementById("status");
  startButton = document.getElementById("startButton");
  stopButton = document.getElementById("stopButton");
  connStatusEl = document.getElementById("connectionStatus");

  try {
    peer = new Peer();
    peer.on('error', (err) => { console.error("PeerJSエラー:", err); });
    peer.on('call', (call) => {
      call.answer();
      call.on('stream', (remoteStream) => {
        if (video) video.srcObject = remoteStream;
        webcamRunning = true;
        if (startButton) startButton.style.display = "none";
        if (stopButton) stopButton.style.display = "block";
        if (statusEl) {
          statusEl.innerText = `ステータス: 探索中... (${currentSearchWord})`;
          statusEl.style.color = "#00ff00";
        }
        if (video) video.onloadeddata = () => { predictWebcam(); };
      });
    });
  } catch (e) {
    console.error("PeerJS初期化失敗:", e);
  }

  initializeAI();
});

async function initializeAI() {
  if (statusEl) {
    statusEl.innerText = "ステータス: AIモデルをロード中...";
    statusEl.style.color = "#ffc107";
  }

  try {
    vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm"
    );
    objectDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelPaths["lite0"], delegate: "GPU" },
      scoreThreshold: 0.3,
      runningMode: runningMode
    });
  } catch (err) {
    console.warn("MediaPipeロード失敗:", err);
  }

  try {
    mobilenetModel = await mobilenet.load();
  } catch (err) {
    console.warn("MobileNetロード失敗:", err);
  }

  if (statusEl) {
    statusEl.innerText = "ステータス: PCのIDを入力して接続してください";
    statusEl.style.color = "#007bff";
  }
}

window.switchTab = function(tabName) {
  const buttons = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');

  buttons.forEach(btn => btn.classList.remove('active'));
  contents.forEach(content => content.classList.remove('active'));

  if (tabName === 'search') {
    if (buttons[0]) buttons[0].classList.add('active');
    const searchTab = document.getElementById('searchTab');
    if (searchTab) searchTab.classList.add('active');
  } else {
    if (buttons[1]) buttons[1].classList.add('active');
    const regTab = document.getElementById('registerTab');
    if (regTab) regTab.classList.add('active');
  }
};

window.connectToPC = function() {
  if (!peer) { alert("PeerJSが初期化されていません。"); return; }
  const pcIdInput = document.getElementById("pcIdInput");
  const pcId = pcIdInput ? pcIdInput.value.trim() : "";
  if (!pcId) { alert("PCのIDを入力してください！"); return; }

  if (connStatusEl) {
    connStatusEl.innerText = "ステータス: 接続中...";
    connStatusEl.style.color = "#ffc107";
  }
  
  try {
    conn = peer.connect(pcId);
    conn.on('open', () => {
      if (connStatusEl) {
        connStatusEl.innerText = "ステータス: 接続完了 ✅";
        connStatusEl.style.color = "#28a745";
      }
      if (startButton) {
        startButton.disabled = false;
        startButton.innerText = "遠隔カメラ起動 & 探索スタート";
        startButton.style.background = "#28a745";
      }
      if (statusEl) {
        statusEl.innerText = "ステータス: 準備完了";
        statusEl.style.color = "#00ff00";
      }
    });

    // 📌 PC側からのYOLO検出結果を受信するリスナー
    conn.on('data', (data) => {
      if (data.action === 'yolo_result') {
        pcYoloDetections = data.detections;
      }
    });
  } catch (e) {
    alert("接続エラー: " + e.message);
  }
};

window.changeModel = async function() {
  const modelSelectElem = document.getElementById("modelSelect");
  if (!modelSelectElem) return;
  const selectedModel = modelSelectElem.value;
  currentModelType = selectedModel;

  if (selectedModel === "custom") {
    if (registeredEmbeddings.length === 0) {
      alert("カスタムモデルがありません。物体登録モードから登録してください。");
      modelSelectElem.value = "lite0";
      currentModelType = "lite0";
      return;
    }
    useCustomModel = true;
    if (statusEl) statusEl.innerText = `ステータス: AIカスタムモデル(${activeCustomName})で探索中`;
  } else if (selectedModel === "yolov8") {
    useCustomModel = false;
    if (statusEl) {
      statusEl.innerText = "ステータス: YOLOv8モード選択 (PC側で処理を実行します)";
      statusEl.style.color = "#00ff00";
    }
  } else {
    useCustomModel = false;
    if (!vision) return;
    try {
      objectDetector = await ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelPaths[selectedModel], delegate: "GPU" },
        scoreThreshold: 0.3,
        runningMode: runningMode
      });
      if (statusEl) statusEl.innerText = `ステータス: 標準AI(${selectedModel})で探索中`;
    } catch (err) { console.error(err); }
  }
};

window.updateTarget = function() {
  const targetInput = document.getElementById("targetObject");
  const inputVal = targetInput ? targetInput.value.trim().toLowerCase() : "";
  if (!inputVal) { alert("探すものを入力してください！"); return; }
  currentSearchWord = inputVal;
  if (statusEl) {
    statusEl.innerText = `🎯 「${currentSearchWord}」を探します`;
    statusEl.style.color = "#00ff00";
  }
};

window.selectCustomTarget = function(name) {
  const targetInput = document.getElementById("targetObject");
  const modelSelectElem = document.getElementById("modelSelect");
  if (targetInput) targetInput.value = name;
  if (modelSelectElem) modelSelectElem.value = "custom";
  window.changeModel();
  window.updateTarget();
  window.switchTab('search');
};

window.startCamera = function() {
  if (!conn || !conn.open) { alert("先にPCと接続してください！"); return; }
  const targetInput = document.getElementById("targetObject");
  currentSearchWord = targetInput ? targetInput.value.trim().toLowerCase() : "cup";
  
  // 📌 選択されているモデル情報もPCに送る
  conn.send({ 
    action: 'start', 
    keyword: currentSearchWord, 
    smartphoneId: peer.id, 
    model: currentModelType 
  });
  if (statusEl) statusEl.innerText = "ステータス: 遠隔カメラ起動要求を送信中...";
};

window.stopCamera = function() {
  if (conn && conn.open) conn.send({ action: 'stop' });
  webcamRunning = false;
  if (video && video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
  if (video) video.srcObject = null;
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (stopButton) stopButton.style.display = "none";
  if (startButton) startButton.style.display = "block";
  if (statusEl) statusEl.innerText = "ステータス: 停止しました";
};

// 登録カメラ関連（変更なし）
window.startRegCamera = async function() {
  const regVideo = document.getElementById("regVideo");
  const regStatus = document.getElementById("regStatus");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (regVideo) regVideo.srcObject = stream;
    if (regStatus) regStatus.innerText = "ステータス: カメラ起動中。";
  } catch (err) { alert("カメラ起動失敗: " + err.message); }
};

window.stopRegCamera = function() {
  const regVideo = document.getElementById("regVideo");
  const regStatus = document.getElementById("regStatus");
  if (regVideo && regVideo.srcObject) {
    regVideo.srcObject.getTracks().forEach(track => track.stop());
    regVideo.srcObject = null;
    if (regStatus) regStatus.innerText = "ステータス: 登録カメラ停止";
  }
};

window.setAspectRatio = function(type) {
  currentAspect = type;
  const guideBox = document.getElementById("regGuideBox");
  if (!guideBox) return;
  if (type === 'square') {
    guideBox.style.width = '160px'; guideBox.style.height = '160px';
  } else if (type === 'landscape') {
    guideBox.style.width = '240px'; guideBox.style.height = '120px';
  } else if (type === 'portrait') {
    guideBox.style.width = '120px'; guideBox.style.height = '240px';
  }
};

window.clearCustomModel = function() {
  if (!confirm("登録データを消去しますか？")) return;
  registeredEmbeddings = []; backgroundEmbeddings = [];
  useCustomModel = false; activeCustomName = "";
  capturedObjects = []; capturedBackgrounds = [];
  document.getElementById("objCount").innerText = "0";
  document.getElementById("bgCount").innerText = "0";
  document.getElementById("objThumbnails").innerHTML = "";
  document.getElementById("bgThumbnails").innerHTML = "";
  document.getElementById("registeredList").innerHTML = "";
  const modelSelect = document.getElementById("modelSelect");
  if (modelSelect) {
    const customOpt = modelSelect.querySelector('option[value="custom"]');
    if (customOpt) customOpt.remove();
    modelSelect.value = "lite0";
  }
};

window.clearGallery = function() {
  const gallery = document.getElementById("imageGallery");
  if (gallery) gallery.innerHTML = "";
};

function cropGuideArea() {
  const regVideo = document.getElementById("regVideo");
  const guideBox = document.getElementById("regGuideBox");
  if (!regVideo || !regVideo.srcObject || !guideBox) return null;
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = 224; tempCanvas.height = 224;
  const tempCtx = tempCanvas.getContext("2d");
  const vW = regVideo.videoWidth; const vH = regVideo.videoHeight;
  const dW = regVideo.clientWidth; const dH = regVideo.clientHeight;
  if (vW === 0 || vH === 0) return null;
  const sX = vW / dW; const sY = vH / dH;
  const gRect = guideBox.getBoundingClientRect();
  const vRect = regVideo.getBoundingClientRect();
  tempCtx.drawImage(regVideo, (gRect.left - vRect.left) * sX, (gRect.top - vRect.top) * sY, gRect.width * sX, gRect.height * sY, 0, 0, 224, 224);
  return tempCanvas;
}

window.captureObject = function() {
  const canvasElem = cropGuideArea();
  if (!canvasElem) { alert("先にカメラを起動してください"); return; }
  capturedObjects.push(canvasElem);
  document.getElementById("objCount").innerText = capturedObjects.length;
  const img = document.createElement("img");
  img.src = canvasElem.toDataURL("image/jpeg");
  img.style.width = "40px"; img.style.height = "40px"; img.style.objectFit = "cover"; img.style.borderRadius = "4px";
  document.getElementById("objThumbnails").appendChild(img);
};

window.captureBackground = function() {
  const canvasElem = cropGuideArea();
  if (!canvasElem) { alert("先にカメラを起動してください"); return; }
  capturedBackgrounds.push(canvasElem);
  document.getElementById("bgCount").innerText = capturedBackgrounds.length;
  const img = document.createElement("img");
  img.src = canvasElem.toDataURL("image/jpeg");
  img.style.width = "40px"; img.style.height = "40px"; img.style.objectFit = "cover"; img.style.borderRadius = "4px";
  document.getElementById("bgThumbnails").appendChild(img);
};

// クロップ処理（変更なし）
let capturedImageBitmap = null;
let isDrawing = false;
let startX = 0, startY = 0, endX = 0, endY = 0;

window.captureAndCropMode = function() {
    const regVideo = document.getElementById('regVideo');
    if (!regVideo || !regVideo.videoWidth) { alert("カメラを起動してください。"); return; }
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = regVideo.videoWidth; tempCanvas.height = regVideo.videoHeight;
    tempCanvas.getContext('2d').drawImage(regVideo, 0, 0);
    const img = new Image();
    img.onload = function() {
        const cropCanvas = document.getElementById('cropCanvas');
        const cropSection = document.getElementById('crop-section');
        cropCanvas.width = 320; cropCanvas.height = (img.height / img.width) * 320;
        cropCanvas.getContext('2d').drawImage(img, 0, 0, cropCanvas.width, cropCanvas.height);
        capturedImageBitmap = img;
        cropSection.style.display = "block";
    };
    img.src = tempCanvas.toDataURL('image/jpeg');
};

const cropCanvasEl = document.getElementById('cropCanvas');
if (cropCanvasEl) {
    const ctxCrop = cropCanvasEl.getContext('2d');
    function getCursorPos(e) {
        const rect = cropCanvasEl.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: (clientX - rect.left) * (cropCanvasEl.width / rect.width), y: (clientY - rect.top) * (cropCanvasEl.height / rect.height) };
    }
    cropCanvasEl.onmousedown = (e) => { isDrawing = true; const p = getCursorPos(e); startX = p.x; startY = p.y; };
    cropCanvasEl.ontouchstart = (e) => { isDrawing = true; const p = getCursorPos(e); startX = p.x; startY = p.y; };
    cropCanvasEl.onmousemove = (e) => {
        if (!isDrawing || !capturedImageBitmap) return;
        const p = getCursorPos(e); endX = p.x; endY = p.y;
        ctxCrop.clearRect(0, 0, cropCanvasEl.width, cropCanvasEl.height);
        ctxCrop.drawImage(capturedImageBitmap, 0, 0, cropCanvasEl.width, cropCanvasEl.height);
        ctxCrop.strokeStyle = "#ff0055"; ctxCrop.lineWidth = 4;
        ctxCrop.strokeRect(startX, startY, endX - startX, endY - startY);
    };
    cropCanvasEl.ontouchmove = (e) => {
        if (!isDrawing || !capturedImageBitmap) return;
        const p = getCursorPos(e); endX = p.x; endY = p.y;
        ctxCrop.clearRect(0, 0, cropCanvasEl.width, cropCanvasEl.height);
        ctxCrop.drawImage(capturedImageBitmap, 0, 0, cropCanvasEl.width, cropCanvasEl.height);
        ctxCrop.strokeStyle = "#ff0055"; ctxCrop.lineWidth = 4;
        ctxCrop.strokeRect(startX, startY, endX - startX, endY - startY);
    };
    cropCanvasEl.onmouseup = () => { isDrawing = false; };
    cropCanvasEl.ontouchend = () => { isDrawing = false; };
}

window.confirmCrop = function() {
    if (Math.abs(endX - startX) < 10) { alert("範囲を囲んでください"); return; }
    const cutCanvas = document.createElement('canvas');
    cutCanvas.width = 224; cutCanvas.height = 224;
    const sX = capturedImageBitmap.width / cropCanvasEl.width;
    const sY = capturedImageBitmap.height / cropCanvasEl.height;
    cutCanvas.getContext('2d').drawImage(capturedImageBitmap, Math.min(startX, endX)*sX, Math.min(startY, endY)*sY, Math.abs(endX-startX)*sX, Math.abs(endY-startY)*sY, 0, 0, 224, 224);
    capturedObjects.push(cutCanvas);
    document.getElementById("objCount").innerText = capturedObjects.length;
    const img = document.createElement("img");
    img.src = cutCanvas.toDataURL("image/jpeg");
    img.style.width = "40px"; img.style.height = "40px"; img.style.objectFit = "cover"; img.style.borderRadius = "4px";
    document.getElementById("objThumbnails").appendChild(img);
    document.getElementById('crop-section').style.display = "none";
};

window.cancelCrop = function() {
    document.getElementById('crop-section').style.display = "none";
};

window.trainAndRegister = async function() {
  const name = document.getElementById("registerName").value.trim().toLowerCase();
  if (!name) { alert("物体名を入力してください！"); return; }
  if (capturedObjects.length === 0) { alert("画像を撮影してください！"); return; }
  if (!mobilenetModel) { alert("MobileNetモデルが未ロードです。"); return; }

  try {
    registeredEmbeddings = []; backgroundEmbeddings = [];
    for (let objCanvas of capturedObjects) {
      tf.tidy(() => {
        registeredEmbeddings.push(Array.from(mobilenetModel.infer(tf.browser.fromPixels(objCanvas).toFloat().expandDims(0), true).dataSync()));
      });
    }
    for (let bgCanvas of capturedBackgrounds) {
      tf.tidy(() => {
        backgroundEmbeddings.push(Array.from(mobilenetModel.infer(tf.browser.fromPixels(bgCanvas).toFloat().expandDims(0), true).dataSync()));
      });
    }

    activeCustomName = name;
    const modelSelect = document.getElementById("modelSelect");
    if (!modelSelect.querySelector('option[value="custom"]')) {
      modelSelect.innerHTML += `<option value="custom">AIカスタム: ${name}</option>`;
    } else {
      modelSelect.querySelector('option[value="custom"]').innerText = `AIカスタム: ${name}`;
    }
    modelSelect.value = "custom";
    currentModelType = "custom";
    useCustomModel = true;

    alert(`「${name}」の登録が完了しました！`);
  } catch (err) { alert("登録エラー: " + err.message); }
};

function calculateCosineSimilarity(vecA, vecB) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 📌 リアルタイム推論ループ（YOLOはPC結果を描画、その他はスマホで従来通り処理）
async function predictWebcam() {
  if (!webcamRunning) return;
  if (video && video.videoWidth > 0 && video.videoHeight > 0 && canvas) {
    if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;
    }
  }

  if (video && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
      let foundTarget = false;

      // 1. カスタムモデルモード（スマホ側処理）
      if (currentModelType === "custom" && registeredEmbeddings.length > 0 && mobilenetModel) {
        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = 224; cropCanvas.height = 224;
        const cropCtx = cropCanvas.getContext("2d");
        cropCtx.drawImage(video, video.videoWidth * 0.2, video.videoHeight * 0.2, video.videoWidth * 0.6, video.videoHeight * 0.6, 0, 0, 224, 224);

        const currentEmbedding = tf.tidy(() => {
          return Array.from(mobilenetModel.infer(tf.browser.fromPixels(cropCanvas).toFloat().expandDims(0), true).dataSync());
        });

        let maxObjSimilarity = 0;
        for (let regEmb of registeredEmbeddings) {
          const sim = calculateCosineSimilarity(currentEmbedding, regEmb);
          if (sim > maxObjSimilarity) maxObjSimilarity = sim;
        }

        if (maxObjSimilarity >= 0.3) {
          foundTarget = true;
          const boxX = canvas.width * 0.2, boxY = canvas.height * 0.2, boxW = canvas.width * 0.6, boxH = canvas.height * 0.6;
          ctx.strokeStyle = "#00ff00"; ctx.lineWidth = 5;
          ctx.strokeRect(boxX, boxY, boxW, boxH);
          ctx.fillStyle = "rgba(0, 0, 0, 0.7)"; ctx.fillRect(boxX, boxY, boxW, 35);
          ctx.fillStyle = "#00ff00"; ctx.font = "bold 16px sans-serif";
          ctx.fillText(`✨ ${activeCustomName} (${Math.round(maxObjSimilarity * 100)}%)`, boxX + 10, boxY + 23);
        }
      } 
      // 2. YOLOv8モード（PC側から送られてきた検出結果を描画）
      else if (currentModelType === "yolov8") {
        if (pcYoloDetections && pcYoloDetections.length > 0) {
          const scaleX = canvas.width / 640;
          const scaleY = canvas.height / 640;

          for (let det of pcYoloDetections) {
            foundTarget = true;
            const x = det.x * scaleX;
            const y = det.y * scaleY;
            const w = det.w * scaleX;
            const h = det.h * scaleY;

            ctx.strokeStyle = "#00ff00"; ctx.lineWidth = 4;
            ctx.strokeRect(x, y, w, h);
            ctx.fillStyle = "rgba(0, 255, 0, 0.7)"; ctx.fillRect(x, y > 25 ? y - 25 : 0, w, 25);
            ctx.fillStyle = "#000"; ctx.font = "bold 14px sans-serif";
            ctx.fillText(`YOLOv8 (${det.score}%)`, x + 5, y > 25 ? y - 7 : 18);
          }
        }
      } 
      // 3. 標準 MediaPipe 検出モード（スマホ側処理）
      else if (objectDetector) {
        const detections = objectDetector.detectForVideo(video, performance.now());
        if (detections && detections.detections && canvas && ctx) {
          const scaleX = canvas.width / video.videoWidth;
          const scaleY = canvas.height / video.videoHeight;
          for (let detection of detections.detections) {
            const categoryName = detection.categories[0].categoryName.toLowerCase();
            const score = Math.round(detection.categories[0].score * 100);
            if (categoryName.includes(currentSearchWord)) {
              foundTarget = true;
              const bbox = detection.boundingBox;
              const x = bbox.originX * scaleX, y = bbox.originY * scaleY;
              const width = bbox.width * scaleX, height = bbox.height * scaleY;
              ctx.strokeStyle = "#00ff00"; ctx.lineWidth = 4;
              ctx.strokeRect(x, y, width, height);
              ctx.fillStyle = "rgba(0, 255, 0, 0.7)"; ctx.fillRect(x, y > 25 ? y - 25 : 0, width, 25);
              ctx.fillStyle = "#000"; ctx.font = "bold 14px sans-serif";
              ctx.fillText(`${categoryName} ${score}%`, x + 5, y > 25 ? y - 7 : 18);
            }
          }
        }
      }

      if (statusEl) {
        statusEl.innerText = foundTarget ? "🎉 発見しました！" : "🔍 探索中...";
        statusEl.style.color = foundTarget ? "#00ff00" : "#aaa";
      }
    } catch (e) { console.error(e); }
  }

  if (webcamRunning) {
    window.requestAnimationFrame(predictWebcam);
  }
}