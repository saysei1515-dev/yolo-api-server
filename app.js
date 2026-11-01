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

let capturedImages = [];
let lastCaptureTime = 0;
let lastVideoTime = -1;
let currentSearchWord = "cup";

const modelPaths = {
  lite0: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  lite2: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite"
};

// タブ切り替えの関数
window.switchView = function(viewName) {
  if (webcamRunning) stopCamera();

  const searchView = document.getElementById("searchView");
  const trainView = document.getElementById("trainView");
  const tabSearch = document.getElementById("tabSearch");
  const tabTrain = document.getElementById("tabTrain");

  if (viewName === 'search') {
    searchView.classList.add("active");
    trainView.classList.remove("active");
    tabSearch.classList.add("active");
    tabTrain.classList.remove("active");
  } else {
    searchView.classList.remove("active");
    trainView.classList.add("active");
    tabSearch.classList.remove("active");
    tabTrain.classList.add("active");
    document.getElementById("trainStatus").innerText = "ステータス: 登録モード準備OK";
  }
};

// 安全かつ確実なAI初期化
async function initializeAI() {
  startButton.disabled = true;
  status.innerText = "ステータス: AIモデルをロード中...";
  status.style.color = "#aaa";

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

    startButton.disabled = false;
    startButton.innerText = "カメラ起動 & 探索スタート";
    status.innerText = "ステータス: 準備完了";
    status.style.color = "#00ff00";
  } catch (err) {
    console.error("AIロードエラー:", err);
    status.innerText = "エラー: AIのロードに失敗しました";
    status.style.color = "#ff4444";
  }
}

// 起動時に自動実行
initializeAI();

window.changeModel = async function() {
  const selectedModel = document.getElementById("modelSelect").value;
  const wasRunning = webcamRunning;
  if (webcamRunning) stopCamera();
  await initializeAI();
  if (wasRunning) startCamera();
};

window.updateTarget = function() {
  const inputVal = document.getElementById("targetObject").value.trim().toLowerCase();
  if (inputVal === "") {
    alert("探すものを入力してください！");
    return;
  }
  currentSearchWord = inputVal;
  status.innerText = `🎯 探すものを「${currentSearchWord}」に変更しました`;
  status.style.color = "#00ff00";
};

window.startCamera = async function() {
  if (!objectDetector) {
    alert("AIモデルの準備がまだ完了していません。");
    return;
  }
  currentSearchWord = document.getElementById("targetObject").value.trim().toLowerCase();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });

    video.srcObject = stream;
    webcamRunning = true;
    startButton.style.display = "none";
    stopButton.style.display = "block";
    status.innerText = `ステータス: 探索中... (${currentSearchWord})`;

    video.onloadeddata = () => {
      predictWebcam();
    };
  } catch (err) {
    console.error("カメラ起動エラー:", err);
    alert("カメラを起動できませんでした。権限を確認してください。");
  }
};

window.stopCamera = function() {
  webcamRunning = false;
  const stream = video.srcObject;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  stopButton.style.display = "none";
  startButton.style.display = "block";
  status.innerText = "ステータス: 停止しました（準備完了）";
  status.style.color = "#aaa";
};

// ── 探索中のリアルタイム推論ループ ──
async function predictWebcam() {
  if (!webcamRunning) return;

  if (video.videoWidth > 0 && video.videoHeight > 0) {
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
  }

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;

    try {
      const startTimeMs = performance.now();
      const detections = objectDetector.detectForVideo(video, startTimeMs);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let foundTarget = false;
      let detectedNames = [];

      if (detections && detections.detections) {
        for (let detection of detections.detections) {
          const categoryName = detection.categories[0].categoryName.toLowerCase();
          const score = Math.round(detection.categories[0].score * 100);
          detectedNames.push(`${categoryName}(${score}%)`);

          if (categoryName.includes(currentSearchWord)) {
            foundTarget = true;

            const bbox = detection.boundingBox;
            ctx.strokeStyle = "#00ff00";
            ctx.lineWidth = 4;
            ctx.strokeRect(bbox.originX, bbox.originY, bbox.width, bbox.height);

            ctx.fillStyle = "#00ff00";
            ctx.font = "16px sans-serif";
            ctx.fillText(`${categoryName} ${score}%`, bbox.originX, bbox.originY > 20 ? bbox.originY - 5 : 20);
          }
        }
      }

      if (foundTarget) {
        status.innerText = `🎉 発見！ (${currentSearchWord})`;
        status.style.color = "#00ff00";

        const now = Date.now();
        if (now - lastCaptureTime > 3000) {
          saveCapturedImage();
          lastCaptureTime = now;
        }
      } else {
        if (detectedNames.length > 0) {
          status.innerText = `👀 検出中: ${detectedNames.join(', ')} (探している物: ${currentSearchWord})`;
        } else {
          status.innerText = `🔍 探索中... (探している物: ${currentSearchWord})`;
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

function saveCapturedImage() {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 160;
  tempCanvas.height = 120;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

  const dataUrl = tempCanvas.toDataURL('image/jpeg');
  capturedImages.unshift(dataUrl);

  if (capturedImages.length > 10) {
    capturedImages.pop();
  }

  const gallery = document.getElementById('imageGallery');
  gallery.innerHTML = '';
  capturedImages.forEach(src => {
    const img = document.createElement('img');
    img.src = src;
    img.className = 'captured-thumb';
    gallery.appendChild(img);
  });
}



