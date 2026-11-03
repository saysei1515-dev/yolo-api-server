import { ObjectDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2";

let objectDetector = undefined;
let runningMode = "VIDEO";
let webcamRunning = false;
let vision = undefined;
let mobilenetModel = undefined;

// 複数の登録データを管理できるように配列（またはオブジェクトのリスト）に変更、または既存の仕組みに合わせた構造
// ここでは複数のカスタム物体を保持できるよう管理します
let customObjects = []; // 例: [{ name: "pen_case", embeddings: [...], backgrounds: [...] }]
let useCustomModel = false;
let activeCustomName = "";
let currentAspect = 'square'; // ガイド枠の比率

const video = document.getElementById("video");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas.getContext("2d");
const status = document.getElementById("status");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const connStatus = document.getElementById("connectionStatus");

let lastVideoTime = -1;
let currentSearchWord = "cup";
let lastSaveTime = 0; 

// PeerJS初期化
const peer = new Peer();
let conn = null;

// 撮影データ一時保存用配列
let capturedObjects = [];
let capturedBackgrounds = [];

const modelPaths = {
  lite0: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  lite2: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite"
};

// 初期AIロード
async function initializeAI() {
  status.innerText = "ステータス: AIモデルをロード中...";
  status.style.color = "#ffc107";
  try {
    vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm"
    );
    const selectedModel = document.getElementById("modelSelect").value;
    objectDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelPaths[selectedModel],
        delegate: "GPU"
      },
      scoreThreshold: 0.3,
      runningMode: runningMode
    });
  } catch (err) {
    console.warn("MediaPipeのロードに失敗しました:", err);
  }

  try {
    mobilenetModel = await mobilenet.load();
    status.innerText = "ステータス: PCのIDを入力して接続してください";
    status.style.color = "#007bff";
  } catch (err) {
    console.error(err);
    status.innerText = "エラー: AIのロードに失敗しました";
    status.style.color = "#ff4444";
  }
}
initializeAI();

// タブ切り替え
window.switchTab = function(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  if (tabName === 'search') {
    document.querySelector('.tab-menu button:nth-child(1)').classList.add('active');
    document.getElementById('searchTab').classList.add('active');
  } else {
    document.querySelector('.tab-menu button:nth-child(2)').classList.add('active');
    document.getElementById('registerTab').classList.add('active');
  }
};

// PC接続
window.connectToPC = function() {
  const pcId = document.getElementById("pcIdInput").value.trim();
  if (!pcId) { alert("PCのIDを入力してください！"); return; }
  connStatus.innerText = "ステータス: 接続中...";
  conn = peer.connect(pcId);
  conn.on('open', () => {
    connStatus.innerText = "ステータス: 接続完了 ✅";
    connStatus.style.color = "#28a745";
    startButton.disabled = false;
    startButton.innerText = "遠隔カメラ起動 & 探索スタート";
    status.innerText = "ステータス: 準備完了";
    status.style.color = "#00ff00";
  });
};

peer.on('call', (call) => {
  call.answer();
  call.on('stream', (remoteStream) => {
    video.srcObject = remoteStream;
    webcamRunning = true;
    startButton.style.display = "none";
    stopButton.style.display = "block";
    status.innerText = `ステータス: 探索中... (${currentSearchWord})`;
    status.style.color = "#00ff00";
    video.onloadeddata = () => { predictWebcam(); };
  });
});

// モデル切り替え
window.changeModel = async function() {
  const selectedModel = document.getElementById("modelSelect").value;
  if (selectedModel === "custom") {
    if (customObjects.length === 0) {
      alert("登録された物体がありません。「物体登録モード」から登録してください。");
      document.getElementById("modelSelect").value = "lite0";
      return;
    }
    useCustomModel = true;
    status.innerText = `ステータス: 登録した物体の検知(${activeCustomName})で探索中`;
  } else {
    useCustomModel = false;
    if (!vision) return;
    try {
      objectDetector = await ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelPaths[selectedModel], delegate: "GPU" },
        scoreThreshold: 0.3,
        runningMode: runningMode
      });
    } catch (err) { console.error(err); }
  }
};

window.updateTarget = function() {
  const inputVal = document.getElementById("targetObject").value.trim().toLowerCase();
  if (!inputVal) { alert("探すものを入力してください！"); return; }
  currentSearchWord = inputVal;
  status.innerText = `🎯 「${currentSearchWord}」を探します`;
  status.style.color = "#00ff00";
};

window.selectCustomTarget = function(name) {
  document.getElementById("targetObject").value = name;
  document.getElementById("modelSelect").value = "custom";
  window.changeModel();
  window.updateTarget();
  window.switchTab('search');
};

window.startCamera = function() {
  if (!conn || !conn.open) { alert("先にPCと接続してください！"); return; }
  currentSearchWord = document.getElementById("targetObject").value.trim().toLowerCase();
  conn.send({ action: 'start', keyword: currentSearchWord, smartphoneId: peer.id });
  status.innerText = "ステータス: 遠隔カメラ起動要求を送信中...";
};

window.stopCamera = function() {
  if (conn && conn.open) conn.send({ action: 'stop' });
  webcamRunning = false;
  if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  stopButton.style.display = "none";
  startButton.style.display = "block";
  status.innerText = "ステータス: 停止しました";
};

// ================= 物体登録ページ ＆ ガイド内撮影・比率変更処理 =================
window.startRegCamera = async function() {
  const regVideo = document.getElementById("regVideo");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    regVideo.srcObject = stream;
    document.getElementById("regStatus").innerText = "ステータス: カメラ起動中。ガイド枠に合わせるか手動クロップをご利用ください";
  } catch (err) { alert("カメラ起動失敗: " + err.message); }
};

window.stopRegCamera = function() {
  const regVideo = document.getElementById("regVideo");
  if (regVideo && regVideo.srcObject) {
    const stream = regVideo.srcObject;
    stream.getTracks().forEach(track => track.stop());
    regVideo.srcObject = null;
    document.getElementById("regStatus").innerText = "ステータス: 登録カメラを停止しました";
    document.getElementById("regStatus").style.color = "#aaa";
  }
};

window.setAspectRatio = function(type) {
  currentAspect = type;
  const guideBox = document.getElementById("regGuideBox");
  if (!guideBox) return;
  if (type === 'square') {
    guideBox.style.width = '160px';
    guideBox.style.height = '160px';
  } else if (type === 'landscape') {
    guideBox.style.width = '240px';
    guideBox.style.height = '120px';
  } else if (type === 'portrait') {
    guideBox.style.width = '120px';
    guideBox.style.height = '240px';
  }
};

// 既存の全体リセット機能
window.clearCustomModel = function() {
  if (!confirm("登録したすべての物体データとモデルを消去しますか？")) return;
  customObjects = [];
  useCustomModel = false;
  activeCustomName = "";
  capturedObjects = [];
  capturedBackgrounds = [];
  document.getElementById("objCount").innerText = "0";
  document.getElementById("bgCount").innerText = "0";
  document.getElementById("objThumbnails").innerHTML = "";
  document.getElementById("bgThumbnails").innerHTML = "";
  document.getElementById("registeredList").innerHTML = "";
  document.getElementById("quickSelectList").innerHTML = "";

  const modelSelect = document.getElementById("modelSelect");
  const customOption = modelSelect.querySelector('option[value="custom"]');
  if (customOption) { customOption.remove(); }
  modelSelect.value = "lite0";

  document.getElementById("registerName").value = "";
  document.getElementById("regStatus").innerText = "ステータス: すべての登録データを消去しました";
  document.getElementById("regStatus").style.color = "#ff4444";
};

// 🔴 個別削除機能
window.removeCustomObject = function(index) {
  const removedObj = customObjects[index];
  customObjects.splice(index, 1);

  if (customObjects.length === 0) {
    useCustomModel = false;
    activeCustomName = "";
    document.getElementById("modelSelect").value = "lite0";
    const customOption = document.getElementById("modelSelect").querySelector('option[value="custom"]');
    if (customOption) customOption.remove();
    document.getElementById("quickSelectList").innerHTML = "";
  } else {
    // まだ残っていれば先頭のものをアクティブに
    activeCustomName = customObjects[0].name;
  }

  updateRegisteredListUI();
  document.getElementById("regStatus").innerText = `ステータス: 「${removedObj.name}」を削除しました`;
  document.getElementById("regStatus").style.color = "#ffc107";
};

// 登録リストのUI更新と×ボタン描画関数
function updateRegisteredListUI() {
  const registeredList = document.getElementById("registeredList");
  registeredList.innerHTML = "";

  customObjects.forEach((obj, idx) => {
    const container = document.createElement("div");
    container.style.cssText = "position: relative; display: inline-block; text-align: center; margin-right: 10px;";
    
    // サムネイル画像
    const thumb = document.createElement("img");
    thumb.src = obj.thumbnail;
    thumb.style.cssText = "width: 70px; height: 70px; object-fit: cover; border-radius: 6px; border: 2px solid #28a745; cursor: pointer;";
    thumb.onclick = () => selectCustomTarget(obj.name);
    container.appendChild(thumb);

    // ×ボタン（個別に消す）
    const deleteBtn = document.createElement("button");
    deleteBtn.innerText = "×";
    deleteBtn.style.cssText = "position: absolute; top: -5px; right: -5px; background: #dc3545; color: #fff; border: none; border-radius: 50%; width: 20px; height: 20px; font-size: 12px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center;";
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      removeCustomObject(idx);
    };
    container.appendChild(deleteBtn);

    // 名前ラベル
    const lbl = document.createElement("div");
    lbl.innerText = obj.name; 
    lbl.style.cssText = "font-size: 10px; color: #fff; margin-top: 2px;";
    container.appendChild(lbl);

    registeredList.appendChild(container);
  });
}

window.clearGallery = function() {
  document.getElementById("imageGallery").innerHTML = "";
};

function cropGuideArea() {
  const regVideo = document.getElementById("regVideo");
  const guideBox = document.getElementById("regGuideBox");
  if (!regVideo || !regVideo.srcObject || !guideBox) return null;
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = 224;
  tempCanvas.height = 224;
  const tempCtx = tempCanvas.getContext("2d");
  const vW = regVideo.videoWidth;
  const vH = regVideo.videoHeight;
  const dW = regVideo.clientWidth;
  const dH = regVideo.clientHeight;
  if (vW === 0 || vH === 0) return null;
  const sX = vW / dW;
  const sY = vH / dH;
  const gRect = guideBox.getBoundingClientRect();
  const vRect = regVideo.getBoundingClientRect();
  const cW = gRect.width * sX;
  const cH = gRect.height * sY;
  const cX = (gRect.left - vRect.left) * sX;
  const cY = (gRect.top - vRect.top) * sY;
  tempCtx.drawImage(regVideo, cX, cY, cW, cH, 0, 0, 224, 224);
  return tempCanvas;
}

window.captureObject = function() {
  const canvas = cropGuideArea();
  if (!canvas) { alert("先にカメラを起動してください"); return; }
  capturedObjects.push(canvas);
  document.getElementById("objCount").innerText = capturedObjects.length;
  const img = document.createElement("img");
  img.src = canvas.toDataURL("image/jpeg");
  img.style.width = "40px"; img.style.height = "40px"; img.style.objectFit = "cover"; img.style.borderRadius = "4px";
  document.getElementById("objThumbnails").appendChild(img);
};

window.captureBackground = function() {
  const canvas = cropGuideArea();
  if (!canvas) { alert("先にカメラを起動してください"); return; }
  capturedBackgrounds.push(canvas);
  document.getElementById("bgCount").innerText = capturedBackgrounds.length;
  const img = document.createElement("img");
  img.src = canvas.toDataURL("image/jpeg");
  img.style.width = "40px"; img.style.height = "40px"; img.style.objectFit = "cover"; img.style.borderRadius = "4px";
  document.getElementById("bgThumbnails").appendChild(img);
};

// ✂️ 手動クロップモード
let capturedImageBitmap = null;
let isDrawing = false;
let startX = 0, startY = 0, endX = 0, endY = 0;

window.captureAndCropMode = function() {
    const regVideo = document.getElementById('regVideo');
    if (!regVideo) { alert("登録用カメラの要素が見つかりません。"); return; }
    const width = regVideo.videoWidth;
    const height = regVideo.videoHeight;
    if (!width || !height) { alert("カメラの映像がまだ準備できていません。"); return; }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(regVideo, 0, 0, width, height);

    const img = new Image();
    img.onload = function() {
        const cropCanvas = document.getElementById('cropCanvas');
        const cropSection = document.getElementById('crop-section');
        if (!cropCanvas || !cropSection) return;
        const displayWidth = 320;
        const displayHeight = (img.height / img.width) * displayWidth;
        cropCanvas.width = displayWidth;
        cropCanvas.height = displayHeight;
        cropCanvas.style.width = "100%";
        cropCanvas.style.height = "auto";
        const ctxCrop = cropCanvas.getContext('2d');
        ctxCrop.clearRect(0, 0, displayWidth, displayHeight);
        ctxCrop.drawImage(img, 0, 0, displayWidth, displayHeight);
        capturedImageBitmap = img;
        cropSection.style.display = "block";
        cropSection.scrollIntoView({ behavior: 'smooth' });
    };
    img.src = tempCanvas.toDataURL('image/jpeg');
};

const cropCanvas = document.getElementById('cropCanvas');
if (cropCanvas) {
    const ctxCrop = cropCanvas.getContext('2d');
    function getCursorPos(e) {
        const rect = cropCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const scaleX = cropCanvas.width / rect.width;
        const scaleY = cropCanvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }
    cropCanvas.onmousedown = (e) => { isDrawing = true; const pos = getCursorPos(e); startX = pos.x; startY = pos.y; endX = startX; endY = startY; };
    cropCanvas.ontouchstart = (e) => { isDrawing = true; const pos = getCursorPos(e); startX = pos.x; startY = pos.y; endX = startX; endY = startY; };
    cropCanvas.onmousemove = (e) => {
        if (!isDrawing || !capturedImageBitmap) return;
        const pos = getCursorPos(e); endX = pos.x; endY = pos.y;
        ctxCrop.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
        ctxCrop.drawImage(capturedImageBitmap, 0, 0, cropCanvas.width, cropCanvas.height);
        ctxCrop.strokeStyle = "#ff0055"; ctxCrop.lineWidth = 4;
        ctxCrop.strokeRect(startX, startY, endX - startX, endY - startY);
    };
    cropCanvas.ontouchmove = (e) => {
        if (!isDrawing || !capturedImageBitmap) return;
        const pos = getCursorPos(e); endX = pos.x; endY = pos.y;
        ctxCrop.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
        ctxCrop.drawImage(capturedImageBitmap, 0, 0, cropCanvas.width, cropCanvas.height);
        ctxCrop.strokeStyle = "#ff0055"; ctxCrop.lineWidth = 4;
        ctxCrop.strokeRect(startX, startY, endX - startX, endY - startY);
    };
    cropCanvas.onmouseup = () => { isDrawing = false; };
    cropCanvas.ontouchend = () => { isDrawing = false; };
}

window.confirmCrop = function() {
    if (startX === undefined || endX === undefined || Math.abs(endX - startX) < 10) {
        alert("切り取りたい範囲をしっかり囲んでください！");
        return;
    }
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);
    const cutCanvas = document.createElement('canvas');
    cutCanvas.width = 224; cutCanvas.height = 224;
    const cutCtx = cutCanvas.getContext('2d');
    const scaleX = capturedImageBitmap.width / cropCanvas.width;
    const scaleY = capturedImageBitmap.height / cropCanvas.height;
    cutCtx.drawImage(capturedImageBitmap, x * scaleX, y * scaleY, w * scaleX, h * scaleY, 0, 0, 224, 224);
    capturedObjects.push(cutCanvas);
    document.getElementById("objCount").innerText = capturedObjects.length;
    const thumbContainer = document.getElementById("objThumbnails");
    if (thumbContainer) {
        const img = document.createElement("img");
        img.src = cutCanvas.toDataURL("image/jpeg");
        img.style.width = "40px"; img.style.height = "40px"; img.style.objectFit = "cover"; img.style.borderRadius = "4px";
        thumbContainer.appendChild(img);
    }
    document.getElementById('crop-section').style.display = "none";
};

window.cancelCrop = function() {
    document.getElementById('crop-section').style.display = "none";
};

// ⚡ AI特徴量ベクトル抽出・登録処理
window.trainAndRegister = async function() {
  const name = document.getElementById("registerName").value.trim().toLowerCase();
  if (!name) { alert("登録する物体名を入力してください！"); return; }
  if (capturedObjects.length === 0) { alert("物体を1枚以上撮影してください！"); return; }
  if (!mobilenetModel) { alert("MobileNetモデルがまだロードされていません。"); return; }

  document.getElementById("regStatus").innerText = "⚡ AI特徴量を解析・登録中...";
  document.getElementById("regStatus").style.color = "#ffc107";
  try {
    let objEmbeddings = [];
    let bgEmbeddings = [];

    for (let objCanvas of capturedObjects) {
      tf.tidy(() => {
        const tensor = tf.browser.fromPixels(objCanvas).toFloat().expandDims(0);
        const embedding = mobilenetModel.infer(tensor, true);
        objEmbeddings.push(Array.from(embedding.dataSync()));
      });
    }
    for (let bgCanvas of capturedBackgrounds) {
      tf.tidy(() => {
        const tensor = tf.browser.fromPixels(bgCanvas).toFloat().expandDims(0);
        const embedding = mobilenetModel.infer(tensor, true);
        bgEmbeddings.push(Array.from(embedding.dataSync()));
      });
    }

    // 新しい物体データをカスタムオブジェクトリストに追加
    const newObjectData = {
      name: name,
      embeddings: objEmbeddings,
      backgrounds: bgEmbeddings,
      thumbnail: capturedObjects[0].toDataURL("image/jpeg")
    };
    customObjects.push(newObjectData);

    activeCustomName = name;
    const modelSelect = document.getElementById("modelSelect");
    if (!modelSelect.querySelector('option[value="custom"]')) {
      modelSelect.innerHTML += `<option value="custom">登録した物体の検知</option>`;
    }
    modelSelect.value = "custom";
    useCustomModel = true;

    document.getElementById("regStatus").innerText = `🎉 「${name}」の登録が完了しました！`;
    document.getElementById("regStatus").style.color = "#00ff00";

    // リストのUIを更新（×ボタン付きで再描画）
    updateRegisteredListUI();

    capturedObjects = [];
    capturedBackgrounds = [];
    document.getElementById("objCount").innerText = "0";
    document.getElementById("bgCount").innerText = "0";
    document.getElementById("objThumbnails").innerHTML = "";
    document.getElementById("bgThumbnails").innerHTML = "";
    document.getElementById("registerName").value = "";
    alert(`「${name}」の登録が完了しました！`);
  } catch (err) {
    console.error(err);
    alert("登録中にエラーが発生しました: " + err.message);
  }
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

// ================= リアルタイム推論ループ =================
async function predictWebcam() {
  if (!webcamRunning) return;

  if (video.videoWidth > 0 && video.videoHeight > 0) {
    const displayWidth = video.clientWidth;
    const displayHeight = video.clientHeight;
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }
  }

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let foundTarget = false;

      // 【カスタム検知モード】
      if (useCustomModel && customObjects.length > 0 && mobilenetModel && objectDetector) {
        const detections = objectDetector.detectForVideo(video, performance.now());

        if (detections && detections.detections) {
          const scaleX = canvas.width / video.videoWidth;
          const scaleY = canvas.height / video.videoHeight;

          for (let detection of detections.detections) {
            const bbox = detection.boundingBox;
            const x = bbox.originX;
            const y = bbox.originY;
            const width = bbox.width;
            const height = bbox.height;

            if (width < 20 || height < 20) continue;

            const cropCanvas = document.createElement("canvas");
            cropCanvas.width = 224;
            cropCanvas.height = 224;
            const cropCtx = cropCanvas.getContext("2d");
            cropCtx.drawImage(video, x, y, width, height, 0, 0, 224, 224);

            const currentEmbedding = tf.tidy(() => {
              const tensor = tf.browser.fromPixels(cropCanvas).toFloat().expandDims(0);
              const embedding = mobilenetModel.infer(tensor, true);
              return Array.from(embedding.dataSync());
            });

            // 登録されているすべてのカスタム物体と比較して、最も一致するものを探す
            let bestMatchName = "";
            let maxOverallSimilarity = 0;

            for (let obj of customObjects) {
              let maxObjSimilarity = 0;
              for (let regEmb of obj.embeddings) {
                const similarity = calculateCosineSimilarity(currentEmbedding, regEmb);
                if (similarity > maxObjSimilarity) maxObjSimilarity = similarity;
              }

              let maxBgSimilarity = 0;
              for (let bgEmb of obj.backgrounds) {
                const bgSimilarity = calculateCosineSimilarity(currentEmbedding, bgEmb);
                if (bgSimilarity > maxBgSimilarity) maxBgSimilarity = bgSimilarity;
              }

              const threshold = 0.3;
              if (maxObjSimilarity >= threshold && maxObjSimilarity > maxBgSimilarity) {
                if (maxObjSimilarity > maxOverallSimilarity) {
                  maxOverallSimilarity = maxObjSimilarity;
                  bestMatchName = obj.name;
                }
              }
            }

            if (bestMatchName) {
              foundTarget = true;
              activeCustomName = bestMatchName;
              const drawX = x * scaleX;
              const drawY = y * scaleY;
              const drawW = width * scaleX;
              const drawH = height * scaleY;

              ctx.strokeStyle = "#00ff00";
              ctx.lineWidth = 4;
              ctx.strokeRect(drawX, drawY, drawW, drawH);

              ctx.fillStyle = "rgba(0, 255, 0, 0.7)";
              ctx.fillRect(drawX, drawY > 25 ? drawY - 25 : 0, drawW, 25);

              ctx.fillStyle = "#000";
              ctx.font = "bold 14px sans-serif";
              ctx.fillText(`✨ ${bestMatchName} (${Math.round(maxOverallSimilarity * 100)}%)`, drawX + 5, drawY > 25 ? drawY - 7 : 18);

              const now = Date.now();
              if (now - lastSaveTime > 3000) {
                saveFoundCustomImage();
                lastSaveTime = now;
              }
            }
          }
        }

      } else if (objectDetector) {
        // 【標準モデルモード】
        const detections = objectDetector.detectForVideo(video, performance.now());
        if (detections && detections.detections) {
          const scaleX = canvas.width / video.videoWidth;
          const scaleY = canvas.height / video.videoHeight;
          for (let detection of detections.detections) {
            const categoryName = detection.categories[0].categoryName.toLowerCase();
            const score = Math.round(detection.categories[0].score * 100);
            
            if (categoryName.includes(currentSearchWord)) {
              foundTarget = true;
              const bbox = detection.boundingBox;
              const x = bbox.originX * scaleX;
              const y = bbox.originY * scaleY;
              const width = bbox.width * scaleX;
              const height = bbox.height * scaleY;

              ctx.strokeStyle = "#00ff00";
              ctx.lineWidth = 4;
              ctx.strokeRect(x, y, width, height);
              ctx.fillStyle = "rgba(0, 255, 0, 0.7)";
              ctx.fillRect(x, y > 25 ? y - 25 : 0, width, 25);
              ctx.fillStyle = "#000";
              ctx.font = "bold 14px sans-serif";
              ctx.fillText(`${categoryName} ${score}%`, x + 5, y > 25 ? y - 7 : 18);

              const now = Date.now();
              if (now - lastSaveTime > 3000) {
                saveFoundImage(bbox);
                lastSaveTime = now;
              }
            }
          }
        }
      }

      if (foundTarget) {
        status.innerText = `🎉 発見しました！`;
        status.style.color = "#00ff00";
      } else {
        status.innerText = `🔍 探索中... (${useCustomModel ? activeCustomName : currentSearchWord})`;
        status.style.color = "#aaa";
      }
    } catch (e) { console.error(e); }
  }

  if (webcamRunning) {
    window.requestAnimationFrame(predictWebcam);
  }
}

function saveFoundImage(bbox) {
  const gallery = document.getElementById("imageGallery");
  if (!gallery) return;
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = bbox.width; tempCanvas.height = bbox.height;
  tempCanvas.getContext("2d").drawImage(video, bbox.originX, bbox.originY, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
  const img = document.createElement("img");
  img.src = tempCanvas.toDataURL("image/jpeg");
  img.style.width = "80px"; img.style.height = "80px"; img.style.objectFit = "cover"; img.style.borderRadius = "8px"; img.style.border = "2px solid #00ff00";
  gallery.prepend(img);
}

function saveFoundCustomImage() {
  const gallery = document.getElementById("imageGallery");
  if (!gallery) return;
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = video.videoWidth; tempCanvas.height = video.videoHeight;
  tempCanvas.getContext("2d").drawImage(video, 0, 0);
  const img = document.createElement("img");
  img.src = tempCanvas.toDataURL("image/jpeg");
  img.style.width = "80px"; img.style.height = "80px"; img.style.objectFit = "cover"; img.style.borderRadius = "8px"; img.style.border = "2px solid #00ff00";
  gallery.prepend(img);
}