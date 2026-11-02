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

// 登録されたアイテムを保存する配列
let registeredItems = [];

// PeerJS初期化
const peer = new Peer();
let conn = null;

const modelPaths = {
  lite0: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  lite2: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite"
};

// 初期AIロード
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
  try {
    objectDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelPaths[selectedModel], delegate: "GPU" },
      scoreThreshold: 0.3,
      runningMode: runningMode
    });
  } catch (err) { console.error(err); }
};

window.updateTarget = function() {
  const inputVal = document.getElementById("targetObject").value.trim().toLowerCase();
  if (!inputVal) { alert("探すものを入力してください！"); return; }
  currentSearchWord = inputVal;
  status.innerText = `🎯 「${currentSearchWord}」を探します`;
  status.style.color = "#00ff00";
};

// 登録したアイテムをクリックしたときに一発で探索ワードにセットする関数
window.selectSearchTarget = function(name) {
  document.getElementById("targetObject").value = name;
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

// ================= シンプル登録ページ処理 =================
window.startRegCamera = async function() {
  const regVideo = document.getElementById("regVideo");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    regVideo.srcObject = stream;
    document.getElementById("regStatus").innerText = "ステータス: スマホカメラ起動中。アイテムを写してください";
  } catch (err) { alert("カメラ起動失敗: " + err.message); }
};

window.registerItemDirectly = function() {
  const name = document.getElementById("registerName").value.trim().toLowerCase();
  if (!name) { alert("登録するアイテム名を入力してください！"); return; }

  const regVideo = document.getElementById("regVideo");
  if (!regVideo.srcObject) { alert("先にスマホカメラを起動してください！"); return; }

  // プレビュー用のキャンバス作成
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = 100;
  tempCanvas.height = 100;
  tempCanvas.getContext("2d").drawImage(regVideo, 0, 0, tempCanvas.width, tempCanvas.height);
  const dataUrl = tempCanvas.toDataURL("image/jpeg");

  // リストに保持
  registeredItems.push({ name: name, image: dataUrl });

  // 画面下部の「登録済みアイテム一覧」に追加
  const container = document.createElement("div");
  container.style.textAlign = "center";
  container.style.cursor = "pointer";
  container.onclick = () => selectSearchTarget(name);

  const img = document.createElement("img");
  img.src = dataUrl;
  img.style.width = "70px"; img.style.height = "70px"; img.style.objectFit = "cover"; img.style.borderRadius = "6px"; img.style.border = "2px solid #28a745";
  container.appendChild(img);

  const lbl = document.createElement("div");
  lbl.innerText = name;
  lbl.style.fontSize = "11px";
  lbl.style.color = "#fff";
  container.appendChild(lbl);

  document.getElementById("registeredList").appendChild(container);

  // 探索モード側の「クイック選択ボタン」にも追加
  const quickBtn = document.createElement("button");
  quickBtn.innerText = `🔍 ${name}`;
  quickBtn.style.padding = "4px 8px";
  quickBtn.style.background = "#28a745";
  quickBtn.style.color = "#fff";
  quickBtn.style.border = "none";
  quickBtn.style.borderRadius = "4px";
  quickBtn.style.cursor = "pointer";
  quickBtn.style.fontSize = "12px";
  quickBtn.onclick = () => selectSearchTarget(name);
  document.getElementById("quickSelectList").appendChild(quickBtn);

  document.getElementById("regStatus").innerText = `✅ 「${name}」を登録しました！探索タブから検索できます。`;
  document.getElementById("registerName").value = "";
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
        status.innerText = `🔍 探索中... (${currentSearchWord})`;
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

window.clearGallery = function() {
  document.getElementById("imageGallery").innerHTML = "";
};