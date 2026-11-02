import { ObjectDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2";

let objectDetector = undefined;
let runningMode = "VIDEO";
let webcamRunning = false;
let vision = undefined;

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

// PeerJSの初期化
const peer = new Peer();
let conn = null;

const modelPaths = {
  lite0: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  lite2: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite"
};

// 1. 初期AIロード
async function initializeAI() {
  status.innerText = "ステータス: AIモデルをロード中...";
  status.style.color = "#ffc107";

  try {
    if (!vision) {
      vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm"
      );
    }
    const selectedModel = document.getElementById("modelSelect").value;
    objectDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelPaths[selectedModel],
        delegate: "GPU"
      },
      scoreThreshold: 0.3,
      runningMode: runningMode
    });

    status.innerText = "ステータス: PCのIDを入力して接続してください";
    status.style.color = "#007bff";
  } catch (err) {
    console.error(err);
    status.innerText = "エラー: AIのロードに失敗しました";
    status.style.color = "#ff4444";
  }
}

initializeAI();

// 🔗 タブ切り替え処理
window.switchTab = function(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

  if (tabName === 'search') {
    document.querySelector('.tab-menu button:nth-child(1)').classList.add('active');
    document.getElementById('searchTab').classList.add('active');
  } else {
    document.querySelector('.tab-menu button:nth-child(2)').classList.add('active');
    document.getElementById('registerTab').classList.add('active');
    
    // 登録タブに切り替えた際、現在の映像ストリームを登録用videoにも共有
    const regVideo = document.getElementById("regVideo");
    if (video.srcObject && !regVideo.srcObject) {
      regVideo.srcObject = video.srcObject;
    }
  }
};

// PCへ接続する処理
window.connectToPC = function() {
  const pcId = document.getElementById("pcIdInput").value.trim();
  if (!pcId) {
    alert("PCのIDを入力してください！");
    return;
  }

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

  conn.on('error', (err) => {
    console.error(err);
    connStatus.innerText = "ステータス: 接続エラー ❌";
    connStatus.style.color = "#dc3545";
  });
};

// PC側から送られてくる遠隔カメラの映像ストリームを受信
peer.on('call', (call) => {
  call.answer();
  call.on('stream', (remoteStream) => {
    video.srcObject = remoteStream;
    document.getElementById("regVideo").srcObject = remoteStream;
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
  try {
    objectDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelPaths[selectedModel],
        delegate: "GPU"
      },
      scoreThreshold: 0.3,
      runningMode: runningMode
    });
  } catch (err) {
    console.error(err);
  }
};

window.updateTarget = function() {
  const inputVal = document.getElementById("targetObject").value.trim().toLowerCase();
  if (inputVal === "") {
    alert("探すものを入力してください！");
    return;
  }
  currentSearchWord = inputVal;
  status.innerText = `🎯 「${currentSearchWord}」を探します`;
  status.style.color = "#00ff00";
};

window.startCamera = function() {
  if (!objectDetector || !conn || !conn.open) {
    alert("先にPCと接続してください！");
    return;
  }
  currentSearchWord = document.getElementById("targetObject").value.trim().toLowerCase();

  conn.send({
    action: 'start',
    keyword: currentSearchWord,
    smartphoneId: peer.id
  });

  status.innerText = "ステータス: 遠隔カメラ起動要求を送信中...";
};

window.stopCamera = function() {
  if (conn && conn.open) {
    conn.send({ action: 'stop' });
  }
  webcamRunning = false;
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach(track => track.stop());
  video.srcObject = null;
  document.getElementById("regVideo").srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  stopButton.style.display = "none";
  startButton.style.display = "block";
  status.innerText = "ステータス: 停止しました（準備完了）";
  status.style.color = "#aaa";
};

// 📦 手動クロップ＆物体登録機能
let croppedDataUrl = null;
window.captureForCrop = function() {
  const regVideo = document.getElementById("regVideo");
  if (!regVideo.srcObject) {
    alert("先にPCカメラを起動してください！");
    return;
  }
  const regCanvas = document.getElementById("regCanvas");
  regCanvas.width = regVideo.clientWidth;
  regCanvas.height = regVideo.clientHeight;
  const regCtx = regCanvas.getContext("2d");

  // 中央部分を切り抜くサンプル（手動クロップ枠）
  const cropWidth = 150;
  const cropHeight = 150;
  const cropX = (regVideo.videoWidth - cropWidth) / 2;
  const cropY = (regVideo.videoHeight - cropHeight) / 2;

  regCtx.drawImage(regVideo, 0, 0, regVideo.videoWidth, regVideo.videoHeight, 0, 0, regCanvas.width, regCanvas.height);
  
  // 枠線の描画
  regCtx.strokeStyle = "#ffc107";
  regCtx.lineWidth = 3;
  regCtx.strokeRect(regCanvas.width / 2 - 75, regCanvas.height / 2 - 75, 150, 150);

  document.getElementById("regStatus").innerText = "ステータス: 中央の枠内を切り取りました。「この範囲を登録する」を押してください";
};

window.saveRegisteredItem = function() {
  const name = document.getElementById("registerName").value.trim();
  if (!name) {
    alert("登録するアイテム名を入力してください！");
    return;
  }

  const regVideo = document.getElementById("regVideo");
  if (!regVideo.srcObject) { alert("カメラが起動していません"); return; }

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = 100;
  tempCanvas.height = 100;
  tempCanvas.getContext("2d").drawImage(regVideo, 0, 0, tempCanvas.width, tempCanvas.height);

  const img = document.createElement("img");
  img.src = tempCanvas.toDataURL("image/jpeg");
  img.style.width = "70px";
  img.style.height = "70px";
  img.style.objectFit = "cover";
  img.style.borderRadius = "6px";
  img.style.border = "2px solid #28a745";

  const container = document.createElement("div");
  container.style.textAlign = "center";
  container.appendChild(img);
  const label = document.createElement("div");
  label.innerText = name;
  label.style.fontSize = "10px";
  container.appendChild(label);

  document.getElementById("registeredList").appendChild(container);
  document.getElementById("regStatus").innerText = `✅ 「${name}」を登録しました！`;
  document.getElementById("registerName").value = "";
};

function saveFoundImage(bbox) {
  const gallery = document.getElementById("imageGallery");
  if (!gallery) return;

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = bbox.width;
  tempCanvas.height = bbox.height;
  const tempCtx = tempCanvas.getContext("2d");

  tempCtx.drawImage(
    video,
    bbox.originX, bbox.originY, bbox.width, bbox.height,
    0, 0, bbox.width, bbox.height
  );

  const img = document.createElement("img");
  img.src = tempCanvas.toDataURL("image/jpeg");
  img.style.width = "80px";
  img.style.height = "80px";
  img.style.objectFit = "cover";
  img.style.borderRadius = "8px";
  img.style.border = "2px solid #00ff00";

  gallery.prepend(img);
}

window.clearGallery = function() {
  const gallery = document.getElementById("imageGallery");
  if (gallery) {
    gallery.innerHTML = "";
  }
};

// リアルタイム推論ループ
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

      const startTimeMs = performance.now();
      const detections = objectDetector.detectForVideo(video, startTimeMs);

      let detectedNames = [];
      if (detections && detections.detections) {
        const scaleX = canvas.width / video.videoWidth;
        const scaleY = canvas.height / video.videoHeight;

        for (let detection of detections.detections) {
          const categoryName = detection.categories[0].categoryName.toLowerCase();
          const score = Math.round(detection.categories[0].score * 100);
          detectedNames.push(`${categoryName}(${score}%)`);

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

            ctx.fillStyle = "#00ff00";
            ctx.font = "16px sans-serif";
            ctx.fillText(`${categoryName} ${score}%`, x, y > 20 ? y - 5 : 20);

            const now = Date.now();
            if (now - lastSaveTime > 3000) {
              saveFoundImage(bbox);
              lastSaveTime = now;
            }
          }
        }
      }

      if (foundTarget) {
        status.innerText = `🎉 発見！ (${currentSearchWord})`;
        status.style.color = "#00ff00";
      } else {
        if (detectedNames.length > 0) {
          status.innerText = `👀 検出中: ${detectedNames.join(', ')} (探す物: ${currentSearchWord})`;
        } else {
          status.innerText = `🔍 探索中... (${currentSearchWord})`;
        }
        status.style.color = "#aaa";
      }

    } catch (e) {
      console.error("推論エラー:", e);
    }
  }

  if (webcamRunning) {
    window.requestAnimationFrame(predictWebcam);
  }
}