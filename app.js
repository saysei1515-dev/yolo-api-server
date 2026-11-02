let mobilenetModel;
let customClassifier = null;
let trainingDataInputs = [];
let trainingDataOutputs = [];
let webcamRunning = false;
let useCustomModel = false;
let activeCustomName = "登録した物体";
let currentAspect = 'square';
let lastVideoTime = -1;
let lastSaveTime = 0;

const video = document.getElementById('webcam');
const canvas = document.getElementById('output_canvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');

// 初期化とカメラ起動
async function init() {
  status.innerText = "MobileNet読み込み中...";
  mobilenetModel = await mobilenet.load();
  status.innerText = "カメラ起動中...";

  const stream = await navigator.mediaDevices.getUserMedia({ 
    video: { facingMode: "environment" } 
  });
  video.srcObject = stream;
  video.addEventListener('loadeddata', () => {
    webcamRunning = true;
    status.innerText = "準備完了！ガイド枠を合わせて撮影してください";
    predictWebcam();
  });
}

// ガイド枠の縦横比率を変更
function setAspectRatio(type) {
  currentAspect = type;
  const guideBox = document.getElementById('guideBox');
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
}

// ガイド枠に合わせて精密にクロップしてサンプル追加
function captureSampleWithCrop(label) {
  if (!mobilenetModel || video.videoWidth === 0 || video.videoHeight === 0) {
    alert("カメラの準備ができていません！");
    return;
  }

  const guideBox = document.getElementById('guideBox');
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

  const countObj = trainingDataOutputs.filter(v => v === 0).length;
  const countBg = trainingDataOutputs.filter(v => v === 1).length;
  status.innerText = `サンプル追加成功！ (物体: ${countObj}枚, 背景: ${countBg}枚)`;
}

// エポック30 & 2層Dense構造によるパワーアップ学習
async function trainAndRegister() {
  if (trainingDataInputs.length === 0) {
    alert("学習データがありません！まずは撮影してください。");
    return;
  }

  status.innerText = "🧠 パワーアップ学習中 (Epochs: 30)...";

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
    shuffle: true
  });

  xs.dispose();
  ys.dispose();

  useCustomModel = true;
  status.innerText = "✨ 学習完了！カスタム認識が有効になりました";
  status.style.color = "#00ff00";
}

// データリセット
function resetTrainingData() {
  trainingDataInputs = [];
  trainingDataOutputs = [];
  useCustomModel = false;
  if (customClassifier) {
    customClassifier.dispose();
    customClassifier = null;
  }
  status.innerText = "🔄 データをリセットしました。再度撮影してください。";
  status.style.color = "#aaa";
}

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
          ctx.lineWidth = 6;
          ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

          ctx.fillStyle = "rgba(0, 255, 0, 0.8)";
          ctx.fillRect(10, 10, canvas.width - 20, 40);
          
          ctx.fillStyle = "#000000";
          ctx.font = "bold 20px sans-serif";
          ctx.fillText(`✨ 発見: ${activeCustomName} (${Math.round(probabilities[1] * 100)}%)`, 25, 37);

          const now = Date.now();
          if (now - lastSaveTime > 3000) {
            saveCustomFoundImage();
            lastSaveTime = now;
          }
        }
      }

      if (foundTarget) {
        status.innerText = `🎉 発見！ (${activeCustomName})`;
        status.style.color = "#00ff00";
      } else if (useCustomModel) {
        status.innerText = `🔍 探索中... (${activeCustomName})`;
        status.style.color = "#aaa";
      }
    } catch (e) { console.error(e); }
  }

  if (webcamRunning) {
    window.requestAnimationFrame(predictWebcam);
  }
}

// 発見時の画像保存
function saveCustomFoundImage() {
  const gallery = document.getElementById("imageGallery");
  if (!gallery) return;
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = video.videoWidth; 
  tempCanvas.height = video.videoHeight;
  tempCanvas.getContext("2d").drawImage(video, 0, 0);
  const img = document.createElement("img");
  img.src = tempCanvas.toDataURL("image/jpeg");
  img.style.width = "80px"; 
  img.style.height = "80px"; 
  img.style.objectFit = "cover"; 
  img.style.borderRadius = "8px"; 
  img.style.border = "2px solid #00ff00";
  gallery.prepend(img);
}

// 起動実行
init();