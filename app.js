import { ObjectDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2";

let objectDetector = undefined;
let runningMode = "VIDEO";
let webcamRunning = false;
let vision = undefined;
let mobilenetModel = undefined;
let customClassifier = null; // 独自学習モデル

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
let useCustomModel = false;
let activeCustomName = "";

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

    // 特徴量抽出用のMobileNetをロード
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
    if (!customClassifier) {
      alert("カスタムモデルがありません。「物体登録モード」から学習させてください。");
      document.getElementById("modelSelect").value = "lite0";
      return;
    }
    useCustomModel = true;
    status.innerText = `ステータス: カスタムモデル(${activeCustomName})で探索中`;
  } else {
    useCustomModel = false;
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

// ================= 物体登録ページ ＆ ガイド内撮影処理 =================
window.startRegCamera = async function() {
  const regVideo = document.getElementById("regVideo");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    regVideo.srcObject = stream;
    document.getElementById("regStatus").innerText = "ステータス: カメラ起動中。ガイド枠に物体を合わせて撮影してください";
  } catch (err) { alert("カメラ起動失敗: " + err.message); }
};

// 🛑 登録用カメラを停止して軽量化する関数
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

// 🗑️ 登録した物体・モデルをすべて消去・リセットする関数
window.clearCustomModel = function() {
  if (!confirm("登録した物体データとカスタムモデルを消去しますか？")) return;

  if (customClassifier) {
    customClassifier.dispose();
    customClassifier = null;
  }
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

// ガイド枠（中央160x160）の部分を正確にクロップして224x224（MobileNet用）にする関数
function cropGuideArea() {
  const regVideo = document.getElementById("regVideo");
  if (!regVideo.srcObject) return null;

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = 224;
  tempCanvas.height = 224;
  const tempCtx = tempCanvas.getContext("2d");

  const vW = regVideo.videoWidth;
  const vH = regVideo.videoHeight;
  const dW = regVideo.clientWidth;
  const dH = regVideo.clientHeight;

  const sX = vW / dW;
  const sY = vH / dH;
  const guideSize = 160;
  const cW = guideSize * sX;
  const cH = guideSize * sY;
  const cX = (vW - cW) / 2;
  const cY = (vH - cH) / 2;

  tempCtx.drawImage(regVideo, cX, cY, cW, cH, 0, 0, 224, 224);
  return tempCanvas;
}

// 物体（クラス0）撮影
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

// 背景（クラス1）撮影
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

// ⚡ 撮影した複数枚の画像からブラウザ上でAI学習を実行
window.trainAndRegister = async function() {
  const name = document.getElementById("registerName").value.trim().toLowerCase();
  if (!name) { alert("登録する物体名を入力してください！"); return; }
  if (capturedObjects.length === 0 || capturedBackgrounds.length === 0) {
    alert("物体（クラス0）と背景（クラス1）をそれぞれ1枚以上撮影してください！");
    return;
  }

  document.getElementById("regStatus").innerText = "⚡ AI学習中... しばらくお待ちください";
  document.getElementById("regStatus").style.color = "#ffc107";

  try {
    customClassifier = tf.sequential();
    customClassifier.add(tf.layers.dense({ units: 16, activation: 'relu', inputShape: [1024] }));
    customClassifier.add(tf.layers.dense({ units: 2, activation: 'softmax' })); // [背景, 物体]
    customClassifier.compile({ optimizer: tf.train.adam(0.0001), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

    let inputs = [];
    let labels = [];

    for (let bgCanvas of capturedBackgrounds) {
      const tensor = tf.browser.fromPixels(bgCanvas).toFloat().expandDims(0);
      const embedding = mobilenetModel.infer(tensor, true);
      inputs.push(embedding);
      labels.push([1, 0]);
      tensor.dispose();
    }

    for (let objCanvas of capturedObjects) {
      const tensor = tf.browser.fromPixels(objCanvas).toFloat().expandDims(0);
      const embedding = mobilenetModel.infer(tensor, true);
      inputs.push(embedding);
      labels.push([0, 1]);
      tensor.dispose();
    }

    const xs = tf.concat(inputs);
    const ys = tf.tensor2d(labels);

    await customClassifier.fit(xs, ys, {
      epochs: 15,
      shuffle: true
    });

    xs.dispose();
    ys.dispose();

    activeCustomName = name;

    const modelSelect = document.getElementById("modelSelect");
    if (!document.querySelector('#modelSelect option[value="custom"]')) {
      modelSelect.innerHTML += `<option value="custom">カスタム: ${name}</option>`;
    } else {
      document.querySelector('#modelSelect option[value="custom"]').innerText = `カスタム: ${name}`;
    }
    modelSelect.value = "custom";
    useCustomModel = true;

    document.getElementById("regStatus").innerText = `🎉 「${name}」のAI学習が完了しました！探索モードで使えます。`;
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

    const quickBtn = document.createElement("button");
    quickBtn.innerText = `🔍 ${name}`;
    quickBtn.style.padding = "4px 8px"; quickBtn.style.background = "#28a745"; quickBtn.style.color = "#fff"; quickBtn.style.border = "none"; quickBtn.style.borderRadius = "4px"; quickBtn.style.cursor = "pointer"; quickBtn.style.fontSize = "12px";
    quickBtn.onclick = () => selectCustomTarget(name);
    document.getElementById("quickSelectList").appendChild(quickBtn);

    capturedObjects = [];
    capturedBackgrounds = [];
    document.getElementById("objCount").innerText = "0";
    document.getElementById("bgCount").innerText = "0";
    document.getElementById("objThumbnails").innerHTML = "";
    document.getElementById("bgThumbnails").innerHTML = "";

  } catch (err) {
    console.error(err);
    alert("学習中にエラーが発生しました: " + err.message);
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

      if (useCustomModel && customClassifier) {
        const tensor = tf.browser.fromPixels(video).toFloat().expandDims(0);
        const embedding = mobilenetModel.infer(tensor, true);
        const prediction = customClassifier.predict(embedding);
        const probabilities = await prediction.data();

        tensor.dispose();
        embedding.dispose();
        prediction.dispose();

        if (probabilities[1] > 0.8) {
          foundTarget = true;
          ctx.strokeStyle = "#00ff00";
          ctx.lineWidth = 4;
          ctx.strokeRect(40, 40, canvas.width - 80, canvas.height - 80);
          ctx.fillStyle = "#00ff00";
          ctx.font = "18px sans-serif";
          ctx.fillText(`✨ ${activeCustomName} (${Math.round(probabilities[1] * 100)}%)`, 50, 70);
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
      }

      if (foundTarget) {
        status.innerText = `🎉 発見！`;
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

window.clearGallery = function() {
  document.getElementById("imageGallery").innerHTML = "";
};
