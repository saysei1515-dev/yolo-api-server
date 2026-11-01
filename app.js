import { ObjectDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2";

let objectDetector = undefined;
let runningMode = "VIDEO";
let webcamRunning = false;
let trainCameraRunning = false;
let vision = undefined;

let classifier = undefined;
let mobilenetModel = undefined;
let isCustomAIReady = false;
let isTrained = false;
let customTargetName = "";

const video = document.getElementById("video");
const trainVideo = document.getElementById("trainVideo");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas.getContext("2d");
const status = document.getElementById("status");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");

let capturedImages = [];
let lastCaptureTime = 0;
let lastVideoTime = -1;
let currentSearchWord = "cup";
let searchModeType = "standard";
let capturedCount = 0;

const modelPaths = {
  lite0: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  lite2: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite"
};

window.switchView = function(viewName) {
  if (webcamRunning) stopCamera();
  if (trainCameraRunning) stopTrainCamera();

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

    if (!isCustomAIReady) {
      loadCustomAI();
    }
  }
};

async function initializeStandardAI() {
  startButton.disabled = true;
  status.innerText = "ステータス: 標準AIモデルをロード中...";
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
    console.error(err);
    status.innerText = "エラー: AIのロードに失敗しました";
    status.style.color = "#ff4444";
  }
}

async function loadCustomAI() {
  const trainStatus = document.getElementById("trainStatus");
  trainStatus.innerText = "ステータス: カスタム学習エンジンを準備中...";
  trainStatus.style.color = "#ffc107";

  try {
    if (typeof knnClassifier !== 'undefined' && typeof mobilenet !== 'undefined') {
      classifier = knnClassifier.create();
      mobilenetModel = await mobilenet.load();
      isCustomAIReady = true;

      trainStatus.innerText = "ステータス: 準備完了";
      trainStatus.style.color = "#00ff00";
    } else {
      throw new Error("ライブラリが読み込まれていません");
    }
  } catch (err) {
    console.error(err);
    trainStatus.innerText = "エラー: カスタムAIのロードに失敗しました";
    trainStatus.style.color = "#ff4444";
  }
}

initializeStandardAI();

window.changeModel = async function() {
  const selectedModel = document.getElementById("modelSelect").value;
  const wasRunning = webcamRunning;
  if (webcamRunning) stopCamera();

  try {
    objectDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelPaths[selectedModel],
        delegate: "GPU"
      },
      scoreThreshold: 0.3,
      runningMode: runningMode
    });
    if (wasRunning) startCamera();
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

  if (isTrained && currentSearchWord === customTargetName.toLowerCase()) {
    searchModeType = "custom";
    status.innerText = `🎯 カスタムAIモード: 「${customTargetName}」を探します！`;
  } else {
    searchModeType = "standard";
    status.innerText = `🎯 標準AIモード: 「${currentSearchWord}」を探します`;
  }
  status.style.color = "#00ff00";
};

window.startCamera = async function() {
  if (!objectDetector) return;
  currentSearchWord = document.getElementById("targetObject").value.trim().toLowerCase();

  if (isTrained && currentSearchWord === customTargetName.toLowerCase()) {
    searchModeType = "custom";
  } else {
    searchModeType = "standard";
  }

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

    video.onloadeddata = () => { predictWebcam(); };
  } catch (err) {
    console.error(err);
    alert("カメラを起動できませんでした。");
  }
};

window.stopCamera = function() {
  webcamRunning = false;
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach(track => track.stop());
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  stopButton.style.display = "none";
  startButton.style.display = "block";
  status.innerText = "ステータス: 停止しました（準備完了）";
  status.style.color = "#aaa";
};

// ── 登録モード用カメラ制御 ──
window.startTrainCamera = async function() {
  if (!isCustomAIReady) {
    alert("カスタムAIの準備中です。少し待ってからもう一度押してください。");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    trainVideo.srcObject = stream;
    trainCameraRunning = true;
    document.getElementById("trainCamStartBtn").style.display = "none";
    document.getElementById("captureAngleBtn").style.display = "block";
    document.getElementById("cropGuideBox").style.display = "block";
    document.getElementById("cropControls").style.display = "block";
    document.getElementById("trainStatus").innerText = "ステータス: リモコンの形に枠を合わせよう";
    document.getElementById("trainStatus").style.color = "#00ff00";
  } catch (err) {
    console.error(err);
    alert("登録用カメラを起動できませんでした。");
  }
};

function stopTrainCamera() {
  trainCameraRunning = false;
  const stream = trainVideo.srcObject;
  if (stream) stream.getTracks().forEach(track => track.stop());
  trainVideo.srcObject = null;
}

// 枠の動きをスライダーに連動させる
window.updateCropBox = function() {
  const size = document.getElementById("cropSizeRange").value;
  const x = document.getElementById("cropXRange").value;
  const y = document.getElementById("cropYRange").value;

  const box = document.getElementById("cropGuideBox");
  box.style.width = size + "%";
  box.style.height = size + "%";
  box.style.left = (x - size / 2) + "%";
  box.style.top = (y - size / 2) + "%";
};

// スライダーの位置を元に、ビデオ映像からピンポイントで切り抜いて学習
window.captureAngleImage = async function() {
  if (!trainCameraRunning || !isCustomAIReady) return;

  const vWidth = trainVideo.videoWidth;
  const vHeight = trainVideo.videoHeight;
  if (vWidth === 0 || vHeight === 0) return;

  const sizeVal = document.getElementById("cropSizeRange").value / 100;
  const xVal = document.getElementById("cropXRange").value / 100;
  const yVal = document.getElementById("cropYRange").value / 100;

  const cropW = vWidth * sizeVal;
  const cropH = vHeight * sizeVal;
  const cropX = (vWidth * xVal) - (cropW / 2);
  const cropY = (vHeight * yVal) - (cropH / 2);

  // 切り抜き用のキャンバスを作成
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = 224;
  cropCanvas.height = 224;
  const cropCtx = cropCanvas.getContext('2d');

  cropCtx.drawImage(
    trainVideo,
    Math.max(0, cropX), Math.max(0, cropY), cropW, cropH,
    0, 0, 224, 224
  );

  // 切り抜いた部分だけをAIに覚えさせる
  const activation = mobilenetModel.infer(cropCanvas, true);
  classifier.addExample(activation, 0);

  capturedCount++;

  // ギャラリーに切り抜き後のお手本画像を表示
  const dataUrl = cropCanvas.toDataURL('image/jpeg');
  const gallery = document.getElementById('trainGallery');
  const img = document.createElement('img');
  img.src = dataUrl;
  img.className = 'captured-thumb';
  gallery.appendChild(img);

  document.getElementById("trainStatus").innerText = `ステータス: 切り抜き写真 ${capturedCount}枚目を学習しました！`;
};

window.trainAIModel = function() {
  const nameInput = document.getElementById("newObjectName").value.trim();
  if (!nameInput) {
    alert("アイテム名を入力してください！");
    return;
  }
  if (capturedCount < 3) {
    alert("もう少し写真を撮影してからトレーニングしてください！");
    return;
  }

  customTargetName = nameInput;
  isTrained = true;

  document.getElementById("trainStatus").innerText = `🎉 成功！「${customTargetName}」の切り抜き学習を完了しました！`;
  document.getElementById("trainStatus").style.color = "#00ff00";
  document.getElementById("targetObject").value = customTargetName;
};

// ── 探索時も同様に中央または指定範囲をトリミングして厳格に判定 ──
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
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let foundTarget = false;

      if (searchModeType === "custom" && isTrained && classifier && classifier.getNumClasses() > 0) {
        const vWidth = video.videoWidth;
        const vHeight = video.videoHeight;
        const cropSize = Math.min(vWidth, vHeight) * 0.6;
        const startX = (vWidth - cropSize) / 2;
        const startY = (vHeight - cropSize) / 2;

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = 224;
        cropCanvas.height = 224;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(video, startX, startY, cropSize, cropSize, 0, 0, 224, 224);

        const activation = mobilenetModel.infer(cropCanvas, true);
        const result = await classifier.predictClass(activation);

        // 誤作動を防ぐため信頼度を 0.85 以上に厳格化
        if (result.classIndex === 0 && result.confidences[0] > 0.85) {
          foundTarget = true;
          const conf = Math.round(result.confidences[0] * 100);

          ctx.strokeStyle = "#00ff00";
          ctx.lineWidth = 4;
          ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

          ctx.fillStyle = "#00ff00";
          ctx.font = "20px sans-serif";
          ctx.fillText(`🎉 ${customTargetName} (${conf}%)`, 30, 50);

          status.innerText = `🎉 発見！自作アイテム: ${customTargetName} (${conf}%)`;
          status.style.color = "#00ff00";
        } else {
          status.innerText = `🔍 カスタム探索中... (${customTargetName})`;
          status.style.color = "#aaa";
        }

      } else {
        const startTimeMs = performance.now();
        const detections = objectDetector.detectForVideo(video, startTimeMs);

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
        } else {
          if (detectedNames.length > 0) {
            status.innerText = `👀 検出中: ${detectedNames.join(', ')} (探している物: ${currentSearchWord})`;
          } else {
            status.innerText = `🔍 探索中... (${currentSearchWord})`;
          }
          status.style.color = "#aaa";
        }
      }

    } catch (e) {
      console.error("推論エラー:", e);
    }
  }

  if (webcamRunning) {
    window.requestAnimationFrame(predictWebcam);
  }
}