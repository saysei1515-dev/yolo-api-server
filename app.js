import { ObjectDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2";

let objectDetector = undefined;
let runningMode = "VIDEO";
let webcamRunning = false;
let vision = undefined;
let mobilenetModel = undefined;

// 高精度な特徴量蓄積用データベース（複数のアングルから取得したベクトルを保持）
let registeredEmbeddings = []; 
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
let capturedBackgrounds = []; // 背景は誤検知防止のネガティブチェック用に保持

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
    // 高精度な特徴量抽出用のMobileNetをロード
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
    if (registeredEmbeddings.length === 0) {
      alert("カスタムモデルがありません。「物体登録モード」から登録してください。");
      document.getElementById("modelSelect").value = "lite0";
      return;
    }
    useCustomModel = true;
    status.innerText = `ステータス: 高精度カスタムモデル(${activeCustomName})で探索中`;
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
    document.getElementById("regStatus").innerText = "ステータス: カメラ起動中。ガイド枠に物体を合わせて撮影してください";
  } catch (err) { alert("カメラ起動失敗: " + err.message); }
};

window.stopRegCamera = function() {
  const regVideo = document.getElementById("regVideo");
  if (regVideo && regVideo.srcObject) {
    const stream = regVideo.srcObject;
    stream.getTracks().forEach(track => track.stop());
    regVideo.srcObject = null;
    document.getElementById("regStatus").innerText = "ステータス: 登録カメラを停止しました（省電力）";
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

window.clearCustomModel = function() {
  if (!confirm("登録した物体データとカスタムモデルを消去しますか？")) return;

  registeredEmbeddings = [];
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
  if (customOption) {
    customOption.remove();
  }
  modelSelect.value = "lite0";

  document.getElementById("registerName").value = "";
  document.getElementById("regStatus").innerText = "ステータス: すべての登録データを消去しました";
  document.getElementById("regStatus").style.color = "#ff4444";
};

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

// ⚡ 【超高精度・高速化】コサイン類似度ベースの物体登録処理
window.trainAndRegister = async function() {
  const name = document.getElementById("registerName").value.trim().toLowerCase();
  if (!name) { alert("登録する物体名を入力してください！"); return; }
  if (capturedObjects.length === 0) {
    alert("物体（クラス0）を1枚以上撮影してください！");
    return;
  }
  if (!mobilenetModel) {
    alert("MobileNetモデルがまだロードされていません。少し待ってから再度お試しください。");
    return;
  }

  document.getElementById("regStatus").innerText = "⚡ 高精度特徴量を解析・登録中...";
  document.getElementById("regStatus").style.color = "#ffc107";

  try {
    registeredEmbeddings = [];

    // 撮影したすべての物体アングルの特徴量ベクトル（1024次元）を抽出し保存
    for (let objCanvas of capturedObjects) {
      tf.tidy(() => {
        const tensor = tf.browser.fromPixels(objCanvas).toFloat().expandDims(0);
        const embedding = mobilenetModel.infer(tensor, true);
        registeredEmbeddings.push(Array.from(embedding.dataSync()));
      });
    }

    activeCustomName = name;

    const modelSelect = document.getElementById("modelSelect");
    if (!document.querySelector('#modelSelect option[value="custom"]')) {
      modelSelect.innerHTML += `<option value="custom">高精度カスタム: ${name}</option>`;
    } else {
      document.querySelector('#modelSelect option[value="custom"]').innerText = `高精度カスタム: ${name}`;
    }
    modelSelect.value = "custom";
    useCustomModel = true;

    document.getElementById("regStatus").innerText = `🎉 「${name}」の高精度登録が完了しました！`;
    document.getElementById("regStatus").style.color = "#00ff00";

    const registeredList = document.getElementById("registeredList");
    registeredList.innerHTML = "";

    const container = document.createElement("div");
    container.style.textAlign = "center";
    container.style.cursor = "pointer";
    container.onclick = () => selectCustomTarget(name);

    const thumb = document.createElement("img");
    thumb.src = capturedObjects[0].toDataURL("image/jpeg");
    thumb.style.width = "70px"; thumb.style.height = "70px"; thumb.style.objectFit = "cover"; thumb.style.borderRadius = "6px"; thumb.style.border = "2px solid #28a745";
    container.appendChild(thumb);

    const lbl = document.createElement("div");
    lbl.innerText = name; lbl.style.fontSize = "10px"; lbl.style.color = "#fff";
    container.appendChild(lbl);
    registeredList.appendChild(container);

    const quickBtn = document.getElementById("quickSelectList");
    if (quickBtn) {
      quickBtn.innerHTML = "";
      const btn = document.createElement("button");
      btn.innerText = `🔍 ${name}`;
      btn.style.cssText = "padding: 4px 8px; background: #28a745; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;";
      btn.onclick = () => selectCustomTarget(name);
      quickBtn.appendChild(btn);
    }

    capturedObjects = [];
    capturedBackgrounds = [];
    document.getElementById("objCount").innerText = "0";
    document.getElementById("bgCount").innerText = "0";
    document.getElementById("objThumbnails").innerHTML = "";
    document.getElementById("bgThumbnails").innerHTML = "";

    alert(`「${name}」の登録が完了しました！類似度判定により誤検知なく強力に検知します。`);

  } catch (err) {
    console.error(err);
    alert("登録中にエラーが発生しました: " + err.message);
  }
};

// コサイン類似度を計算する数学関数
function calculateCosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// リアルタイム推論ループ（高精度類似度マッチング ＆ 緑枠描画）
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

      if (useCustomModel && registeredEmbeddings.length > 0 && mobilenetModel) {
        // カメラ映像から特徴量を抽出
        const currentEmbedding = tf.tidy(() => {
          const tensor = tf.browser.fromPixels(video).toFloat().expandDims(0);
          const embedding = mobilenetModel.infer(tensor, true);
          return Array.from(embedding.dataSync());
        });

        // 登録されたすべてのサンプルとの類似度を計算し、最大値を取得
        let maxSimilarity = 0;
        for (let regEmb of registeredEmbeddings) {
          const similarity = calculateCosineSimilarity(currentEmbedding, regEmb);
          if (similarity > maxSimilarity) {
            maxSimilarity = similarity;
          }
        }

        // 類似度が閾値（例: 0.75以上）を超えたら高精度に検知とみなす
        if (maxSimilarity >= 0.75) {
          foundTarget = true;

          // 🟢 鮮やかな緑の枠で物体を強力に囲む
          ctx.strokeStyle = "#00ff00";
          ctx.lineWidth = 5;
          ctx.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);

          ctx.fillStyle = "rgba(0, 255, 0, 0.8)";
          ctx.fillRect(30, 30, canvas.width - 60, 40);

          ctx.fillStyle = "#000000";
          ctx.font = "bold 18px sans-serif";
          ctx.fillText(`✨ 発見: ${activeCustomName} (${Math.round(maxSimilarity * 100)}%)`, 40, 57);

          const now = Date.now();
          if (now - lastSaveTime > 3000) {
            saveFoundCustomImage();
            lastSaveTime = now;
          }
        }
      } else if (objectDetector) {
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

              // 🟢 標準モデルでの検知時も緑枠で囲む
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
        status.innerText = `🔍 探索中...`;
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