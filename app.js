import { ObjectDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2";

// ── 状態管理変数 ──
let objectDetector = undefined;
let runningMode = "VIDEO";
let webcamRunning = false;
let trainCameraRunning = false;
let vision = undefined;

// カスタムAI学習用
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

// 登録用データの管理
let trainingData = {
  front: [],
  angle: [],
  far: []
};
let currentStep = 1;

const modelPaths = {
  lite0: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  lite2: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite"
};

// ── タブ切り替え ──
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

    // 登録タブを開いたときにカスタムAIを初期化
    if (!isCustomAIReady) {
      loadCustomAI();
    }
  }
};

// 1. 標準AI（MediaPipe）の初期化
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
    status.innerText = "ステータス: 準備完了 (探索できます)";
    status.style.color = "#00ff00";
  } catch (err) {
    console.error("標準AIロードエラー:", err);
    status.innerText = "エラー: AIのロードに失敗しました";
    status.style.color = "#ff4444";
  }
}

// 2. カスタムAI（HTML側で読み込んだグローバル変数を利用）の初期化
async function loadCustomAI() {
  const trainStatus = document.getElementById("trainStatus");
  trainStatus.innerText = "ステータス: カスタム学習エンジンを準備中...";
  trainStatus.style.color = "#ffc107";

  try {
    // windowオブジェクトに展開されたモデルを安全にロード
    if (typeof knnClassifier !== 'undefined' && typeof mobilenet !== 'undefined') {
      classifier = knnClassifier.create();
      mobilenetModel = await mobilenet.load();
      isCustomAIReady = true;

      trainStatus.innerText = "ステータス: 準備完了（マルチアングル撮影できます）";
      trainStatus.style.color = "#00ff00";
    } else {
      throw new Error("ライブラリが読み込まれていません");
    }
  } catch (err) {
    console.error("カスタムAIロードエラー:", err);
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
    status.innerText = `🎯 カスタムAIモード: 自作アイテム「${customTargetName}」を探します！`;
  } else {
    searchModeType = "standard";
    status.innerText = `🎯 標準AIモード: 「${currentSearchWord}」を探します`;
  }
  status.style.color = "#00ff00";
};

window.startCamera = async function() {
  if (!objectDetector) return;
  const inputVal = document.getElementById("targetObject").value.trim().toLowerCase();
  currentSearchWord = inputVal;

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
    alert("カスタムAIの準備中です。数秒待ってからもう一度押してください。");
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
    document.getElementById("trainStatus").innerText = "ステータス: 撮影準備OK";
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

window.captureAngleImage = async function() {
  if (!trainCameraRunning || !isCustomAIReady) return;

  const activation = mobilenetModel.infer(trainVideo, true);
  classifier.addExample(activation, 0);

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 160;
  tempCanvas.height = 120;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(trainVideo, 0, 0, tempCanvas.width, tempCanvas.height);
  const dataUrl = tempCanvas.toDataURL('image/jpeg');

  if (currentStep === 1) {
    trainingData.front.push(dataUrl);
    if (trainingData.front.length >= 3) currentStep = 2;
  } else if (currentStep === 2) {
    trainingData.angle.push(dataUrl);
    if (trainingData.angle.length >= 3) currentStep = 3;
  } else if (currentStep === 3) {
    trainingData.far.push(dataUrl);
    if (trainingData.far.length >= 3) currentStep = 1;
  }

  updateGuideUI();
  updateTrainGallery();
};

function updateGuideUI() {
  const guideText = document.getElementById("angleGuideText");
  const countText = document.getElementById("angleCountText");

  const fCount = trainingData.front.length;
  const aCount = trainingData.angle.length;
  const dCount = trainingData.far.length;

  countText.innerText = `現在の登録枚数: 正面(${fCount}/3) | 斜め(${aCount}/3) | 遠く(${dCount}/3)`;

  if (currentStep === 1) {
    guideText.innerText = "📸 ステップ1: 正面から撮影してください（あと " + (3 - fCount) + " 枚）";
    guideText.style.color = "#00ff00";
  } else if (currentStep === 2) {
    guideText.innerText = "📸 ステップ2: 斜め・横から撮影してください（あと " + (3 - aCount) + " 枚）";
    guideText.style.color = "#ffc107";
  } else if (currentStep === 3) {
    guideText.innerText = "📸 ステップ3: 少し離して・別角度で撮影してください（あと " + (3 - dCount) + " 枚）";
    guideText.style.color = "#17a2b8";
  }
}

function updateTrainGallery() {
  const gallery = document.getElementById('trainGallery');
  gallery.innerHTML = '';
  
  const allImgs = [...trainingData.front, ...trainingData.angle, ...trainingData.far];
  allImgs.forEach(src => {
    const img = document.createElement('img');
    img.src = src;
    img.className = 'captured-thumb';
    gallery.appendChild(img);
  });
}

window.trainAIModel = function() {
  const nameInput = document.getElementById("newObjectName").value.trim();
  if (!nameInput) {
    alert("アイテム名を入力してください！");
    return;
  }
  const totalPhotos = trainingData.front.length + trainingData.angle.length + trainingData.far.length;
  if (totalPhotos < 3) {
    alert("もう少し写真を撮影してからトレーニングしてください！");
    return;
  }

  customTargetName = nameInput;
  isTrained = true;

  document.getElementById("trainStatus").innerText = `ステータス: 「${customTargetName}」のAI学習を完了しました！`;
  document.getElementById("trainStatus").style.color = "#ffc107";

  setTimeout(() => {
    document.getElementById("trainStatus").innerText = `🎉 成功！「${customTargetName}」を覚えました！（探索モードで検索できます）`;
    document.getElementById("trainStatus").style.color = "#00ff00";
    document.getElementById("targetObject").value = customTargetName;
  }, 1000);
};

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
        const activation = mobilenetModel.infer(video, true);
        const result = await classifier.predictClass(activation);

        if (result.classIndex === 0 && result.confidences[0] > 0.75) {
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
          status.innerText = `🔍 カスタム探索中... (探している物: ${customTargetName})`;
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
            status.innerText = `🔍 探索中... (探している物: ${currentSearchWord})`;
          }
          status.style.color = "#aaa";
        }
      }

      if (foundTarget) {
        const now = Date.now();
        if (now - lastCaptureTime > 3000) {
          saveCapturedImage();
          lastCaptureTime = now;
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

function saveCapturedImage() {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 160;
  tempCanvas.height = 120;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

  const dataUrl = tempCanvas.toDataURL('image/jpeg');
  capturedImages.unshift(dataUrl);

  if (capturedImages.length > 10) capturedImages.pop();

  const gallery = document.getElementById('imageGallery');
  gallery.innerHTML = '';
  capturedImages.forEach(src => {
    const img = document.createElement('img');
    img.src = src;
    img.className = 'captured-thumb';
    gallery.appendChild(img);
  });
}