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

// 初期化（MobileNetのロード）
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
}

// タブ切り替え
window.switchTab = function(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  
  if (tabName === 'search') {
    document.getElementById('searchTab').classList.add('active');
    event.target.classList.add('active');
  } else if (tabName === 'register') {
    document.getElementById('registerTab').classList.add('active');
    event.target.classList.add('active');
  }
};

// 📌 ガイド枠の縦横比率を変更
window.setAspectRatio = function(type) {
  currentAspect = type;
  const guideBox = document.getElementById('regGuideBox');
  if (!guideBox) return;

  if (type === 'square') {
    guideBox.style.width = '160px';
    guideBox.style.height = '160px';
  } else if (type === 'landscape') {
    guideBox.style.width = '240px';
    guideBox.style.height = '120px'; // 横長
  } else if (type === 'portrait') {
    guideBox.style.width = '120px';
    guideBox.style.height = '240px'; // 縦長
  }
};

// 📱 登録用カメラ起動
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

// ⏹️ 登録用カメラ停止
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

// ✂️ ガイド枠に合わせて精密にクロップして物体(クラス0)を撮影・登録
window.captureObjectWithCrop = function() {
  captureSample(0);
};

// ✂️ ガイド枠に合わせて精密にクロップして背景(クラス1)を撮影・登録
window.captureBackgroundWithCrop = function() {
  captureSample(1);
};

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

  // 画面上の表示サイズと実際のカメラ解像度の比率を計算して精密に切り抜く
  const vRect = video.getBoundingClientRect();
  const gRect = guideBox.getBoundingClientRect();

  const scaleX = video.videoWidth / vRect.width;
  const scaleY = video.videoHeight / vRect.height;

  const sx = (gRect.left - vRect.left) * scaleX;
  const sy = (gRect.top - vRect.top) * scaleY;
  const sWidth = gRect.width * scaleX;
  const sHeight = gRect.height * scaleY;

  // 224x224のキャンバスに綺麗にリサイズ＆切り出し
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 224;
  tempCanvas.height = 224;
  const tCtx = tempCanvas.getContext('2d');
  tCtx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, 224, 224);

  // TensorFlow.jsでMobileNet特徴量抽出
  tf.tidy(() => {
    const tensor = tf.browser.fromPixels(tempCanvas).toFloat().expandDims(0);
    const embedding = mobilenetModel.infer(tensor, true);
    const data = embedding.dataSync();
    
    trainingDataInputs.push(Array.from(data));
    trainingDataOutputs.push(label);
  });

  // カウントとサムネイルの更新
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

// ⚡ エポック数30 ＆ 2層Dense層によるパワーアップ学習
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

  // 隠れ層を2層化（32 ➡️ 16）したリッチな分類モデル
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

  // エポック数を30に設定してじっくり学習
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
  
  // 登録済みリストに反映
  updateRegisteredListUI();
  alert(`「${activeCustomName}」のカスタム学習が完了しました！`);
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