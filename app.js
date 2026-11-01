import { ObjectDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2";
// ブラウザ上で超高速に画像分類・学習を行うためのTensorFlow.jsとKNN分類器を読み込み
import * as tf from "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.10.0/dist/tf.min.js";
import * as knnClassifier from "https://cdn.jsdelivr.net/npm/@tensorflow-models/knn-classifier@1.2.2/dist/knn-classifier.min.js";
import * as mobilenet from "https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.0/dist/mobilenet.min.js";

let objectDetector = undefined;
let runningMode = "VIDEO";
let webcamRunning = false;
let trainCameraRunning = false;
let vision = undefined;

// カスタムAI学習用の変数
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
let searchModeType = "standard"; // "standard" または "custom"

// 登録用データの管理
let trainingData = {
  front: [],  // 正面
  angle: [],  // 斜め
  far: []     // 遠く/離れ
};
let currentStep = 1; // 1:正面, 2:斜め, 3:遠く

const modelPaths = {
  lite0: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  lite2: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite"
};

// タブ切り替えの関数
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
  }
};

// 初期化：MediaPipeと、カスタム学習用のMobileNet/KNNモデルを同時にロード
async function initializeAllModels() {
  startButton.disabled = true;
  status.innerText = "ステータス: AIモデル（標準＆カスタム）をロード中...";
  status.style.color = "#aaa";

  try {
    // 1. MediaPipeの初期化
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

    // 2. TensorFlow.js / KNN / MobileNet（特徴抽出用）の初期化
    classifier = knnClassifier.create();
    mobilenetModel = await mobilenet.load();
    isCustomAIReady = true;

    startButton.disabled = false;
    startButton.innerText = "カメラ起動 & 探索スタート";
    status.innerText = "ステータス: 準備完了 (標準AI & カスタムAI待機中)";
    status.style.color = "#00ff00";
  } catch (err) {
    console.error(err);
    status.innerText = "エラー: AIのロードに失敗しました";
    status.style.color = "#ff4444";
  }
}

initializeAllModels();

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

  // もし自分が学習させたカスタムアイテムの名前と一致していれば、カスタム探索モードに切り替える
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
    status.innerText = `ステータス: 探索中... (${currentSearchWord} [モード: ${searchModeType}])`;

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

// ── AI登録モード用カメラ制御 ──
window.startTrainCamera = async function() {
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

// 角度別の撮影＆KNNモデルへの特徴量学習
window.captureAngleImage = async function() {
  if (!trainCameraRunning || !isCustomAIReady) return;

  // 1. 映像からテンソル（画像データ）を切り出してMobileNetで特徴量を取り出し、KNNに学習させる
  const activation = mobilenetModel.infer(trainVideo, true);
  classifier.addExample(activation, 0); // クラスID 0 として登録

  // 2. 視覚確認用のサムネイル画像作成
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
    document.getElementById("trainStatus").innerText = `🎉 成功！「${customTargetName}」を覚えました！（探索モードに入力すると検出できます）`;
    document.getElementById("trainStatus").style.color = "#00ff00";
    document.getElementById("targetObject").value = customTargetName;
  }, 1000);
};

// ── メインのリアルタイム推論ループ ──
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

      // モードに応じた推論処理
      if (searchModeType === "custom" && isTrained && classifier.getNumClasses() > 0) {
        // --- ① 自作カスタムAIによる判定 ---
        const activation = mobilenetModel.infer(video, true);
        const result = await classifier.predictClass(activation);

        // クラス0（登録したアイテム）と判定され、確信度が高い場合
        if (result.classIndex === 0 && result.confidences[0] > 0.75) {
          foundTarget = true;
          const conf = Math.round(result.confidences[0] * 100);

          // 画面全体に枠と検出結果を表示
          ctx.strokeStyle = "#00ff00";
          ctx.lineWidth = 4;
          ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

          ctx.fillStyle = "#00ff00";
          ctx.font = "20px sans-serif";
          ctx.fillText(`🎉 ${customTargetName} (${conf}%)`, 30, 50);

          status.innerText = `🎉 発見！カスタムアイテム: ${customTargetName} (${conf}%)`;
          status.style.color = "#00ff00";
        } else {
          status.innerText = `🔍 カスタム探索中... (探している物: ${customTargetName})`;
          status.style.color = "#aaa";
        }

      } else {
        // --- ② 標準MediaPipeによる判定 ---
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
