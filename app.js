// --- グローバル変数・状態管理 ---
let mobilenetModel = null;
let customClassifier = null;
let trainingDataInputs = [];
let trainingDataOutputs = [];
let useCustomModel = false;
let activeCustomName = "登録した物体";
let currentAspect = 'square';
let regStream = null;

let objCount = 0;
let bgCount = 0;

// 探索モード用変数
let searchStream = null;
let vision = null;
let objectDetector = null;
let currentModelName = "lite0";
let isSearching = false;
let lastVideoTime = -1;
let lastSaveTime = 0;

const searchVideo = document.getElementById('video');
const searchCanvas = document.getElementById('outputCanvas');
const searchCtx = searchCanvas ? searchCanvas.getContext('2d') : null;

// 初期化（MobileNet & MediaPipeのロード準備）
async function initApp() {
  const regStatus = document.getElementById('regStatus');
  if (regStatus) regStatus.innerText = "ステータス: MobileNet読み込み中...";
  
  try {
    mobilenetModel = await mobilenet.load();
    if (regStatus) regStatus.innerText = "ステータス: 準備完了。登録カメラを起動してください";
  } catch (e) {
    console.error(e);
    if (regStatus) regStatus.innerText = "ステータス: MobileNetの読み込みに失敗しました";
  }

  // MediaPipe Object Detector の初期化
  try {
    const { ObjectDetector, FilesetResolver } = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2");
    vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm");
    await initObjectDetector("lite0");
  } catch (e) {
    console.error("MediaPipe初期化エラー:", e);
  }
}

async function initObjectDetector(modelName) {
  currentModelName = modelName;
  const modelAssetPath = modelName === "lite2"
    ? "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite"
    : "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";

  objectDetector = await ObjectDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelAssetPath, delegate: "GPU" },
    scoreThreshold: 0.3,
    runningMode: "VIDEO"
  });
  
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.innerText = `ステータス: ${modelName} 準備完了`;
}

// タブ切り替え
window.switchTab = function(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  
  const targetTabBtn = event ? event.target : null;

  if (tabName === 'search') {
    document.getElementById('searchTab').classList.add('active');
    if (targetTabBtn) targetTabBtn.classList.add('active');
  } else if (tabName === 'register') {
    document.getElementById('registerTab').classList.add('active');
    if (targetTabBtn) targetTabBtn.classList.add('active');
  }
};

// ================= 探索モード関連 =================

window.connectToPC = function() {
  const pcId = document.getElementById('pcIdInput').value.trim();
  const connStatus = document.getElementById('connectionStatus');
  const startBtn = document.getElementById('startButton');

  if (!pcId) {
    alert("PC接続用IDを入力してください。");
    return;
  }

  if (connStatus) connStatus.innerText = "ステータス: 接続完了（準備OK）";
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.innerText = "探索カメラ開始";
  }
  alert("PCと接続しました！探索カメラを開始できます。");
};

window.startCamera = async function() {
  try {
    searchStream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: "environment" } 
    });
    searchVideo.srcObject = searchStream;
    searchVideo.addEventListener('loadeddata', predictWebcamSearch);

    document.getElementById('startButton').style.display = 'none';
    document.getElementById('stopButton').style.display = 'inline-block';
    isSearching = true;
    document.getElementById('status').innerText = "ステータス: 探索中...";
  } catch (e) {
    console.error(e);
    alert("探索カメラの起動に失敗しました。");
  }
};

window.stopCamera = function() {
  isSearching = false;
  if (searchStream) {
    searchStream.getTracks().forEach(track => track.stop());
    searchStream = null;
  }
  searchVideo.srcObject = null;
  document.getElementById('startButton').style.display = 'inline-block';
  document.getElementById('stopButton').style.display = 'none';
  document.getElementById('status').innerText = "ステータス: 停止中";
};

window.changeModel = async function() {
  const select = document.getElementById('modelSelect');
  if (select) {
    await initObjectDetector(select.value);
  }
};

window.updateTarget = function() {
  const target = document.getElementById('targetObject').value.trim();
  alert(`探すものを「${target}」に更新しました！`);
};

// 探索モードのリアルタイム推論ループ
async function predictWebcamSearch() {
  if (!isSearching || !searchVideo) return;

  if (searchVideo.videoWidth > 0 && searchVideo.videoHeight > 0) {
    if (searchCanvas.width !== searchVideo.clientWidth || searchCanvas.height !== searchVideo.clientHeight) {
      searchCanvas.width = searchVideo.clientWidth;
      searchCanvas.height = searchVideo.clientHeight;
    }
  }

  if (searchVideo.currentTime !== lastVideoTime) {
    lastVideoTime = searchVideo.currentTime;
    searchCtx.clearRect(0, 0, searchCanvas.width, searchCanvas.height);

    let foundTarget = false;
    const targetInput = document.getElementById('targetObject').value.trim().toLowerCase();

    try {
      // 1. カスタムモデルが有効で、かつターゲット名が一致（またはカスタム学習品を探している）場合
      if (useCustomModel && customClassifier && mobilenetModel) {
        const tensor = tf.browser.fromPixels(searchVideo).toFloat().expandDims(0);
        const embedding = mobilenetModel.infer(tensor, true);
        const prediction = customClassifier.predict(embedding);
        const probabilities = await prediction.data();

        tensor.dispose();
        embedding.dispose();
        prediction.dispose();

        // 閾値 0.3 で判定
        if (probabilities[1] > 0.3) {
          foundTarget = true;
          
          // 画面全体を緑枠で囲む
          searchCtx.strokeStyle = "#00ff00";
          searchCtx.lineWidth = 6;
          searchCtx.strokeRect(10, 10, searchCanvas.width - 20, searchCanvas.height - 20);

          searchCtx.fillStyle = "rgba(0, 255, 0, 0.8)";
          searchCtx.fillRect(10, 10, searchCanvas.width - 20, 40);
          
          searchCtx.fillStyle = "#000000";
          searchCtx.font = "bold 18px sans-serif";
          searchCtx.fillText(`✨ 発見: ${activeCustomName} (${Math.round(probabilities[1] * 100)}%)`, 20, 37);

          // 3秒に1回ギャラリーに自動保存
          const now = Date.now();
          if (now - lastSaveTime > 3000) {
            saveFoundImageToGallery();
            lastSaveTime = now;
          }
        }
      } 
      else if (objectDetector) {
        // 2. 通常のLite AIモデルでの検出
        const detections = objectDetector.detectForVideo(searchVideo, Date.now());
        if (detections && detections.detections) {
          for (let det of detections.detections) {
            const category = det.categories[0];
            const catName = category.categoryName.toLowerCase();
            const score = category.score;

            if (targetInput === "" || catName.includes(targetInput)) {
              foundTarget = true;
              const bbox = det.boundingBox;

              const scaleX = searchCanvas.width / searchVideo.videoWidth;
              const scaleY = searchCanvas.height / searchVideo.videoHeight;
              const x = bbox.originX * scaleX;
              const y = bbox.originY * scaleY;
              const w = bbox.width * scaleX;
              const h = bbox.height * scaleY;

              searchCtx.strokeStyle = "#00ff00";
              searchCtx.lineWidth = 4;
              searchCtx.strokeRect(x, y, w, h);

              searchCtx.fillStyle = "rgba(0, 255, 0, 0.7)";
              searchCtx.fillRect(x, y > 25 ? y - 25 : 0, w, 25);

              searchCtx.fillStyle = "#000";
              searchCtx.font = "bold 14px sans-serif";
              searchCtx.fillText(`${catName} (${Math.round(score * 100)}%)`, x + 5, y > 25 ? y - 7 : 18);

              const now = Date.now();
              if (now - lastSaveTime > 3000) {
                saveFoundImageToGallery();
                lastSaveTime = now;
              }
            }
          }
        }
      }

      if (foundTarget) {
        document.getElementById('status').innerText = "🎉 ターゲットを発見しました！";
        document.getElementById('status').style.color = "#28a745";
      } else {
        document.getElementById('status').innerText = "🔍 探索中...";
        document.getElementById('status').style.color = "#aaa";
      }

    } catch (e) {
      console.error(e);
    }
  }

  if (isSearching) {
    window.requestAnimationFrame(predictWebcamSearch);
  }
};

// 発見時の画像をギャラリーに保存
function saveFoundImageToGallery() {
  const gallery = document.getElementById('imageGallery');
  if (!gallery) return;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = searchVideo.videoWidth;
  tempCanvas.height = searchVideo.videoHeight;
  tempCanvas.getContext('2d').drawImage(searchVideo, 0, 0);

  const img = document.createElement('img');
  img.src = tempCanvas.toDataURL('image/jpeg');
  img.style.width = "80px";
  img.style.height = "80px";
  img.style.objectFit = "cover";
  img.style.borderRadius = "4px";
  img.style.border = "2px solid #00ff00";

  gallery.prepend(img);
}

window.clearGallery = function() {
  const gallery = document.getElementById('imageGallery');
  if (gallery) gallery.innerHTML = "";
};


// ================= 物体登録モード関連 =================

window.setAspectRatio = function(type) {
  currentAspect = type;
  const guideBox = document.getElementById('regGuideBox');
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

window.startRegCamera = async function() {
  const regVideo = document.getElementById('regVideo');
  const regStatus = document.getElementById('regStatus');
  try {
    regStream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: "environment" } 
    });
    regVideo.srcObject = regStream;
    if (regStatus) regStatus.innerText = "ステータス: 登録カメラ起動中。ガイド枠に合わせて撮影してください";
  } catch (e) {
    console.error(e);
    alert("カメラの起動に失敗しました。");
  }
};

window.stopRegCamera = function() {
  if (regStream) {
    regStream.getTracks().forEach(track => track.stop());
    regStream = null;
    const regVideo = document.getElementById('regVideo');
    if (regVideo) regVideo.srcObject = null;
    const regStatus = document.getElementById('regStatus');
    if (regStatus) regStatus.innerText = "ステータス: 登録カメラを停止しました";
  }
};

window.captureObjectWithCrop = function() { captureSample(0); };
window.captureBackgroundWithCrop = function() { captureSample(1); };

function captureSample(label) {
  if (!mobilenetModel) {
    alert("MobileNetがまだロードされていません！");
    return;
  }
  const video = document.getElementById('regVideo');
  const guideBox = document.getElementById('regGuideBox');
  
  if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
    alert("登録用カメラが起動していません！");
    return;
  }

  const vRect = video.getBoundingClientRect();
  const gRect = guideBox.getBoundingClientRect();

  const scaleX = video.videoWidth / vRect.width;
  const scaleY = video.videoHeight / vRect.height;

  const sx = (gRect.left - vRect.left) * scaleX;
  const sy = (gRect.top - vRect.top) * scaleY;
  const sWidth = gRect.width * scaleX;
  const sHeight = gRect.height * scaleY;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 224;
  tempCanvas.height = 224;
  const tCtx = tempCanvas.getContext('2d');
  tCtx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, 224, 224);

  tf.tidy(() => {
    const tensor = tf.browser.fromPixels(tempCanvas).toFloat().expandDims(0);
    const embedding = mobilenetModel.infer(tensor, true);
    const data = embedding.dataSync();
    
    trainingDataInputs.push(Array.from(data));
    trainingDataOutputs.push(label);
  });

  const dataUrl = tempCanvas.toDataURL();
  if (label === 0) {
    objCount++;
    document.getElementById('objCount').innerText = objCount;
    addThumbnail('objThumbnails', dataUrl);
  } else {
    bgCount++;
    document.getElementById('bgCount').innerText = bgCount;
    addThumbnail('bgThumbnails', dataUrl);
  }
}

function addThumbnail(containerId, dataUrl) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.width = '40px';
  img.style.height = '40px';
  img.style.objectFit = 'cover';
  img.style.borderRadius = '3px';
  container.appendChild(img);
}

// ⚡ エポック30 ＆ 2層Dense層によるパワーアップ学習
window.trainAndRegister = async function() {
  if (trainingDataInputs.length === 0) {
    alert("学習データがありません！物体と背景を撮影してください。");
    return;
  }

  const nameInput = document.getElementById('registerName');
  if (nameInput && nameInput.value.trim() !== "") {
    activeCustomName = nameInput.value.trim();
  }

  const regStatus = document.getElementById('regStatus');
  if (regStatus) regStatus.innerText = "ステータス: 🧠 パワーアップ学習中 (Epochs: 30)...";

  customClassifier = tf.sequential();
  customClassifier.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [1024] }));
  customClassifier.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  customClassifier.add(tf.layers.dense({ units: 2, activation: 'softmax' }));

  customClassifier.compile({
    optimizer: tf.train.adam(0.0001),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy']
  });

  const xs = tf.tensor2d(trainingDataInputs, [trainingDataInputs.length, 1024]);
  const ys = tf.oneHot(tf.tensor1d(trainingDataOutputs, 'int32'), 2);

  await customClassifier.fit(xs, ys, {
    epochs: 30,
    shuffle: true,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        console.log(`Epoch ${epoch + 1}/30 - loss: ${logs.loss.toFixed(4)}, acc: ${logs.acc || logs.accuracy}`);
      }
    }
  });

  xs.dispose();
  ys.dispose();

  useCustomModel = true;
  if (regStatus) {
    regStatus.innerText = `ステータス: ✨ 学習完了！「${activeCustomName}」の登録が完了しました`;
    regStatus.style.color = "#28a745";
  }
  
  updateRegisteredListUI();
  
  // クイック選択肢にも自動追加
  const quickList = document.getElementById('quickSelectList');
  if (quickList) {
    const btn = document.createElement('button');
    btn.innerText = activeCustomName;
    btn.style.cssText = "padding: 4px 8px; background: #28a745; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;";
    btn.onclick = () => { document.getElementById('targetObject').value = activeCustomName; };
    quickList.appendChild(btn);
  }

  alert(`「${activeCustomName}」のカスタム学習が完了しました！探索モードで使えます。`);
};

// 🗑️ データ・モデルのリセット
window.clearCustomModel = function() {
  trainingDataInputs = [];
  trainingDataOutputs = [];
  objCount = 0;
  bgCount = 0;
  useCustomModel = false;

  if (customClassifier) {
    customClassifier.dispose();
    customClassifier = null;
  }

  document.getElementById('objCount').innerText = '0';
  document.getElementById('bgCount').innerText = '0';
  document.getElementById('objThumbnails').innerHTML = '';
  document.getElementById('bgThumbnails').innerHTML = '';
  document.getElementById('registeredList').innerHTML = '';

  const regStatus = document.getElementById('regStatus');
  if (regStatus) {
    regStatus.innerText = "ステータス: データをすべてリセットしました。";
    regStatus.style.color = "#aaa";
  }
};

function updateRegisteredListUI() {
  const listDiv = document.getElementById('registeredList');
  if (!listDiv) return;
  listDiv.innerHTML = `<span style="padding: 5px 10px; background: #28a745; color: #fff; border-radius: 4px; font-size: 13px;">✓ ${activeCustomName} (学習済み)</span>`;
}

// アプリ起動時に初期化を実行
initApp();