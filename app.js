import { ObjectDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2";

let objectDetector = undefined;
let runningMode = "VIDEO";
let webcamRunning = false;
let vision = undefined;
let mobilenetModel = undefined;

// 💾 localStorageから保存されたカスタム物体データを復元（なければ空の配列）
let customObjects = JSON.parse(localStorage.getItem("customObjects") || "[]"); 
let useCustomModel = false;
let activeCustomName = customObjects.length > 0 ? customObjects[0].name : "";
let currentAspect = 'square'; // ガイド枠の比率

// 編集モード管理用
let editingObjectIndex = null;
let originalEditingName = "";

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

// PeerJS初期化
const peer = new Peer();
let conn = null;

// 撮影データ一時保存用配列
let capturedObjects = [];     // [{ canvas, dataUrl }]
let capturedBackgrounds = []; // [{ canvas, dataUrl }]

const modelPaths = {
  lite0: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  lite2: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite"
};

// 💾 カスタム物体データをブラウザ（localStorage）に保存する関数
function saveCustomObjectsToStorage() {
  try {
    localStorage.setItem("customObjects", JSON.stringify(customObjects));
  } catch (e) {
    console.error("データの保存に失敗しました:", e);
  }
}

// 初期AIロード
async function initializeAI() {
  status.innerText = "ステータス: AIモデルをロード中...";
  status.style.color = "#ffc107";

  if (customObjects.length > 0) {
    const modelSelect = document.getElementById("modelSelect");
    if (modelSelect && !modelSelect.querySelector('option[value="custom"]')) {
      modelSelect.innerHTML += `<option value="custom">登録した物体の検知</option>`;
    }
    updateRegisteredListUI();
  }

  try {
    vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.2/wasm"
    );
    const selectedModel = document.getElementById("modelSelect").value;
    objectDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: modelPaths[selectedModel] || modelPaths.lite0,
        delegate: "GPU"
      },
      scoreThreshold: 0.3,
      runningMode: runningMode
    });
  } catch (err) {
    console.warn("MediaPipeのロードに失敗しました:", err);
  }

  try {
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
    status.innerText = `ステータス: 探索中... (${useCustomModel ? activeCustomName : currentSearchWord})`;
    status.style.color = "#00ff00";
    video.onloadeddata = () => { predictWebcam(); };
  });
});

// モデル切り替え
window.changeModel = async function() {
  const selectedModel = document.getElementById("modelSelect").value;
  if (selectedModel === "custom") {
    if (customObjects.length === 0) {
      alert("登録された物体がありません。「物体登録モード」から登録してください。");
      document.getElementById("modelSelect").value = "lite0";
      return;
    }
    useCustomModel = true;
    status.innerText = `ステータス: 登録した物体の検知(${activeCustomName})で探索中`;
  } else {
    useCustomModel = false;
    if (!vision) return;
    try {
      objectDetector = await ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelPaths[selectedModel], delegate: "GPU" },
        scoreThreshold: 0.3,
        runningMode: runningMode
      });
      status.innerText = `ステータス: 標準モデル(${selectedModel})で探索中`;
    } catch (err) { console.error(err); }
  }
};

// COCOデータセット一覧（日本語・英語対応リスト）
const cocoItems = [
  { en: "person", jp: "ヒト" }, { en: "bicycle", jp: "ジテンシャ" }, { en: "car", jp: "クルマ" },
  { en: "motorcycle", jp: "バイク" }, { en: "airplane", jp: "ヒコウキ" }, { en: "bus", jp: "バス" },
  { en: "train", jp: "デンシャ" }, { en: "truck", jp: "トラック" }, { en: "boat", jp: "ボート" },
  { en: "traffic light", jp: "シンゴウ" }, { en: "fire hydrant", jp: "ショウカセン" }, { en: "stop sign", jp: "イチジテイシ" },
  { en: "parking meter", jp: "パーキングメーター" }, { en: "bench", jp: "ベンチ" }, { en: "bird", jp: "トリ" },
  { en: "cat", jp: "ネコ" }, { en: "dog", jp: "イヌ" }, { en: "horse", jp: "ウマ" },
  { en: "sheep", jp: "ヒツジ" }, { en: "cow", jp: "ウシ" }, { en: "elephant", jp: "ゾウ" },
  { en: "bear", jp: "クマ" }, { en: "zebra", jp: "シマウマ" }, { en: "giraffe", jp: "キリン" },
  { en: "backpack", jp: "リュック" }, { en: "umbrella", jp: "カサ" }, { en: "handbag", jp: "ハンドバッグ" },
  { en: "tie", jp: "ネクタイ" }, { en: "suitcase", jp: "スーツケース" }, { en: "frisbee", jp: "フリスビー" },
  { en: "skis", jp: "スキー" }, { en: "snowboard", jp: "スノーボード" }, { en: "sports ball", jp: "ボール" },
  { en: "kite", jp: "タコ" }, { en: "baseball bat", jp: "バット" }, { en: "baseball glove", jp: "グローブ" },
  { en: "skateboard", jp: "スケートボード" }, { en: "surfboard", jp: "サーフボード" }, { en: "tennis racket", jp: "ラケット" },
  { en: "bottle", jp: "ボトル" }, { en: "wine glass", jp: "ワイングラス" }, { en: "cup", jp: "コップ" },
  { en: "fork", jp: "フォーク" }, { en: "knife", jp: "ナイフ" }, { en: "spoon", jp: "スプーン" },
  { en: "bowl", jp: "ボウル" }, { en: "banana", jp: "バナナ" }, { en: "apple", jp: "リンゴ" },
  { en: "sandwich", jp: "サンドイッチ" }, { en: "orange", jp: "オレンジ" }, { en: "broccoli", jp: "ブロッコリー" },
  { en: "carrot", jp: "ニンジン" }, { en: "hot dog", jp: "ホットドッグ" }, { en: "pizza", jp: "ピザ" },
  { en: "donut", jp: "ドーナツ" }, { en: "cake", jp: "ケーキ" }, { en: "chair", jp: "イス" },
  { en: "couch", jp: "ソファ" }, { en: "potted plant", jp: "ショクブツ" }, { en: "bed", jp: "ベッド" },
  { en: "dining table", jp: "テーブル" }, { en: "toilet", jp: "トイレ" }, { en: "tv", jp: "テレビ" },
  { en: "laptop", jp: "パソコン" }, { en: "mouse", jp: "マウス" }, { en: "remote", jp: "リモコン" },
  { en: "keyboard", jp: "キーボード" }, { en: "cell phone", jp: "スマホ" }, { en: "microwave", jp: "レンジ" },
  { en: "oven", jp: "オーブン" }, { en: "toaster", jp: "トースター" }, { en: "sink", jp: "シンク" },
  { en: "refrigerator", jp: "レイゾウコ" }, { en: "book", jp: "ホン" }, { en: "clock", jp: "トケイ" },
  { en: "vase", jp: "カビン" }, { en: "scissors", jp: "ハサミ" }, { en: "teddy bear", jp: "ヌイグルミ" },
  { en: "hair drier", jp: "ドライヤー" }, { en: "toothbrush", jp: "ハブラシ" }
];

window.filterSuggestions = function() {
  const input = document.getElementById("targetObject");
  const query = input.value.trim().toLowerCase();
  const box = document.getElementById("customSuggestions");

  if (!query) {
    box.style.display = "none";
    return;
  }

  const matched = cocoItems.filter(item => 
    item.en.toLowerCase().includes(query) || item.jp.includes(query)
  );

  if (matched.length === 0) {
    box.style.display = "none";
    return;
  }

  box.innerHTML = "";
  matched.forEach(item => {
    const div = document.createElement("div");
    div.style.cssText = "padding: 8px 10px; font-size: 13px; color: #fff; cursor: pointer; border-bottom: 1px solid #333; text-align: left;";
    div.innerHTML = `${item.jp} <span style="color: #aaa; font-size: 11px;">(${item.en})</span>`;
    div.onmousedown = (e) => {
      e.preventDefault(); 
      input.value = item.en;
      box.style.display = "none";
      window.updateTarget();
    };
    box.appendChild(div);
  });

  box.style.display = "block";
};

window.updateTarget = function() {
  const customSuggestions = document.getElementById("customSuggestions");
  if (customSuggestions) customSuggestions.style.display = "none";

  let inputVal = document.getElementById("targetObject").value.trim().toLowerCase();
  if (!inputVal) { alert("探すものを入力してください！"); return; }

  const jpToEnMap = {
    "人": "person", "ひと": "person", "ヒト": "person",
    "自転車": "bicycle", "チャリ": "bicycle", "ジテンシャ": "bicycle",
    "車": "car", "くるま": "car", "クルマ": "car",
    "オートバイ": "motorcycle", "バイク": "motorcycle",
    "飛行機": "airplane", "ヒコウキ": "airplane",
    "バス": "bus",
    "電車": "train", "列車": "train", "デンシャ": "train",
    "トラック": "truck",
    "ボート": "boat", "船": "boat",
    "信号機": "traffic light", "信号": "traffic light", "シンゴウ": "traffic light",
    "消火栓": "fire hydrant", "ショウカセン": "fire hydrant",
    "一時停止標識": "stop sign", "イチジテイシ": "stop sign",
    "パーキングメーター": "parking meter",
    "ベンチ": "bench",
    "鳥": "bird", "とり": "bird", "トリ": "bird",
    "猫": "cat", "ねこ": "cat", "ネコ": "cat",
    "犬": "dog", "いぬ": "dog", "イヌ": "dog",
    "馬": "horse", "うま": "horse", "ウマ": "horse",
    "羊": "sheep", "ひつじ": "sheep", "ヒツジ": "sheep",
    "牛": "cow", "うし": "cow", "ウシ": "cow",
    "象": "elephant", "ぞう": "elephant", "ゾウ": "elephant",
    "熊": "bear", "くま": "bear", "クマ": "bear",
    "シマウマ": "zebra",
    "キリン": "giraffe",
    "リュック": "backpack", "リュックサック": "backpack",
    "傘": "umbrella", "かさ": "umbrella", "カサ": "umbrella",
    "ハンドバッグ": "handbag",
    "ネクタイ": "tie",
    "スーツケース": "suitcase",
    "フリスビー": "frisbee",
    "スキー": "skis",
    "スノーボード": "snowboard",
    "ボール": "sports ball", "スポーツボール": "sports ball",
    "凧": "kite", "たこ": "kite", "タコ": "kite",
    "野球バット": "baseball bat", "バット": "baseball bat",
    "野球グローブ": "baseball glove", "グローブ": "baseball glove",
    "スケートボード": "skateboard",
    "サーフボード": "surfboard",
    "テニスラケット": "tennis racket", "ラケット": "tennis racket",
    "ボトル": "bottle", "ペットボトル": "bottle",
    "ワイングラス": "wine glass",
    "コップ": "cup", "カップ": "cup", "マグカップ": "cup",
    "フォーク": "fork",
    "ナイフ": "knife",
    "スプーン": "spoon",
    "ボウル": "bowl", "お椀": "bowl",
    "バナナ": "banana",
    "りんご": "apple", "リンゴ": "apple",
    "サンドイッチ": "sandwich",
    "オレンジ": "orange",
    "ブロッコリー": "broccoli",
    "にんじん": "carrot", "人参": "carrot", "ニンジン": "carrot",
    "ホットドッグ": "hot dog",
    "ピザ": "pizza",
    "ドーナツ": "donut",
    "ケーキ": "cake",
    "椅子": "chair", "いす": "chair", "イス": "chair",
    "ソファ": "couch", "ソファー": "couch",
    "植木鉢": "potted plant", "植物": "potted plant", "ショクブツ": "potted plant",
    "ベッド": "bed",
    "ダイニングテーブル": "dining table", "テーブル": "dining table", "机": "dining table",
    "トイレ": "toilet",
    "テレビ": "tv",
    "ノートパソコン": "laptop", "パソコン": "laptop", "PC": "laptop",
    "マウス": "mouse",
    "リモコン": "remote",
    "キーボード": "keyboard",
    "スマホ": "cell phone", "スマートフォン": "cell phone", "携帯": "cell phone",
    "電子レンジ": "microwave", "レンジ": "microwave",
    "オーブン": "oven",
    "トースター": "toaster",
    "シンク": "sink", "流し台": "sink",
    "冷蔵庫": "refrigerator", "レイゾウコ": "refrigerator",
    "本": "book", "書籍": "book", "ホン": "book",
    "時計": "clock", "置時計": "clock", "掛け時計": "clock", "トケイ": "clock",
    "花瓶": "vase", "カビン": "vase",
    "はさみ": "scissors", "ハサミ": "scissors",
    "ぬいぐるみ": "teddy bear", "ヌイグルミ": "teddy bear",
    "ドライヤー": "hair drier", "ヘアードライヤー": "hair drier",
    "歯ブラシ": "toothbrush", "ハブラシ": "toothbrush"
  };

  if (jpToEnMap[inputVal]) {
    inputVal = jpToEnMap[inputVal];
    document.getElementById("targetObject").value = inputVal;
  }

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

// ================= 物体登録ページ ＆ ガイド内撮影・比率変更処理 =================
window.startRegCamera = async function() {
  const regVideo = document.getElementById("regVideo");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    regVideo.srcObject = stream;
    document.getElementById("regStatus").innerText = "ステータス: カメラ起動中。ガイド枠に合わせるか手動クロップをご利用ください";
  } catch (err) { alert("カメラ起動失敗: " + err.message); }
};

window.stopRegCamera = function() {
  const regVideo = document.getElementById("regVideo");
  if (regVideo && regVideo.srcObject) {
    const stream = regVideo.srcObject;
    stream.getTracks().forEach(track => track.stop());
    regVideo.srcObject = null;
    document.getElementById("regStatus").innerText = "ステータス: 登録カメラを停止しました";
    document.getElementById("regStatus").style.color = "#aaa";
  }
};

window.setAspectRatio = function(type) {
  currentAspect = type;
  const guideBox = document.getElementById("regGuideBox");
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

// 全体リセット機能
window.clearCustomModel = function() {
  if (!confirm("登録したすべての物体データとモデルを消去しますか？")) return;
  customObjects = [];
  localStorage.removeItem("customObjects");

  useCustomModel = false;
  activeCustomName = "";
  editingObjectIndex = null;
  capturedObjects = [];
  capturedBackgrounds = [];
  document.getElementById("objCount").innerText = "0";
  document.getElementById("bgCount").innerText = "0";
  document.getElementById("objThumbnails").innerHTML = "";
  document.getElementById("bgThumbnails").innerHTML = "";
  document.getElementById("registeredList").innerHTML = "";

  const quickSelectList = document.getElementById("quickSelectList");
  if (quickSelectList) quickSelectList.innerHTML = "";

  const modelSelect = document.getElementById("modelSelect");
  const customOption = modelSelect.querySelector('option[value="custom"]');
  if (customOption) { customOption.remove(); }
  modelSelect.value = "lite0";

  document.getElementById("registerName").value = "";
  document.getElementById("regStatus").innerText = "ステータス: すべての登録データを消去しました";
  document.getElementById("regStatus").style.color = "#ff4444";
};

// 登録済み物体の個別削除（×ボタン）
window.removeCustomObject = function(index) {
  const removedObj = customObjects[index];
  customObjects.splice(index, 1);
  saveCustomObjectsToStorage();

  if (editingObjectIndex === index) {
    editingObjectIndex = null;
    document.getElementById("registerName").value = "";
    document.getElementById("regStatus").innerText = "ステータス: 待機中";
    document.getElementById("regStatus").style.color = "#aaa";
    capturedObjects = [];
    capturedBackgrounds = [];
    document.getElementById("objCount").innerText = "0";
    document.getElementById("bgCount").innerText = "0";
    document.getElementById("objThumbnails").innerHTML = "";
    document.getElementById("bgThumbnails").innerHTML = "";
  } else if (editingObjectIndex !== null && editingObjectIndex > index) {
    editingObjectIndex--;
  }

  if (customObjects.length === 0) {
    useCustomModel = false;
    activeCustomName = "";
    document.getElementById("modelSelect").value = "lite0";
    const customOption = document.getElementById("modelSelect").querySelector('option[value="custom"]');
    if (customOption) customOption.remove();
    const quickSelectList = document.getElementById("quickSelectList");
    if (quickSelectList) quickSelectList.innerHTML = "";
  } else {
    activeCustomName = customObjects[0].name;
  }

  updateRegisteredListUI();
  document.getElementById("regStatus").innerText = `ステータス: 「${removedObj.name}」を削除しました`;
  document.getElementById("regStatus").style.color = "#ffc107";
};

// 撮影中の「背景写真」の個別削除
window.removeBackgroundPhoto = function(index) {
  capturedBackgrounds.splice(index, 1);
  document.getElementById("bgCount").innerText = capturedBackgrounds.length;
  updateBackgroundThumbnailsUI();
};

// 撮影中の「物体写真」の個別削除
window.removeObjectPhoto = function(index) {
  capturedObjects.splice(index, 1);
  document.getElementById("objCount").innerText = capturedObjects.length;
  updateObjectThumbnailsUI();
};

// 物体サムネイルのUI再描画
function updateObjectThumbnailsUI() {
  const thumbContainer = document.getElementById("objThumbnails");
  thumbContainer.innerHTML = "";
  capturedObjects.forEach((item, idx) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position: relative; display: inline-block;";

    const img = document.createElement("img");
    img.src = item.dataUrl;
    img.style.cssText = "width: 40px; height: 40px; object-fit: cover; border-radius: 4px; display: block;";
    wrap.appendChild(img);

    const delBtn = document.createElement("button");
    delBtn.innerText = "×";
    delBtn.style.cssText = "position: absolute; top: -4px; right: -4px; background: #dc3545; color: #fff; border: none; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center;";
    delBtn.onclick = () => removeObjectPhoto(idx);
    wrap.appendChild(delBtn);

    thumbContainer.appendChild(wrap);
  });
}

// 背景サムネイルのUI再描画
function updateBackgroundThumbnailsUI() {
  const bgContainer = document.getElementById("bgThumbnails");
  bgContainer.innerHTML = "";
  capturedBackgrounds.forEach((item, idx) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position: relative; display: inline-block;";

    const img = document.createElement("img");
    img.src = item.dataUrl;
    img.style.cssText = "width: 40px; height: 40px; object-fit: cover; border-radius: 4px; display: block;";
    wrap.appendChild(img);

    const delBtn = document.createElement("button");
    delBtn.innerText = "×";
    delBtn.style.cssText = "position: absolute; top: -4px; right: -4px; background: #dc3545; color: #fff; border: none; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center;";
    delBtn.onclick = () => removeBackgroundPhoto(idx);
    wrap.appendChild(delBtn);

    bgContainer.appendChild(wrap);
  });
}

// ✏️ 編集モードに入る関数（✨ 修正：過去の物体写真・背景写真の両方を復元して下部に並べ、×で消去・編集できる状態にする）
window.startEditingObject = function(index) {
  editingObjectIndex = index;
  const obj = customObjects[index];
  document.getElementById("registerName").value = obj.name;

  // 1. 過去に保存された「物体写真」を復元してサムネイルに表示
  capturedObjects = [];
  if (obj.thumbnail) {
    const tempImg = new Image();
    tempImg.onload = function() {
      const c = document.createElement("canvas");
      c.width = 224; c.height = 224;
      c.getContext("2d").drawImage(tempImg, 0, 0, 224, 224);
      capturedObjects.push({ canvas: c, dataUrl: obj.thumbnail });
      document.getElementById("objCount").innerText = capturedObjects.length;
      updateObjectThumbnailsUI();
    };
    tempImg.src = obj.thumbnail;
  }

  // 2. 過去に保存された「背景写真」を復元してサムネイルに表示
  capturedBackgrounds = [];
  if (obj.backgroundThumbnails && Array.isArray(obj.backgroundThumbnails)) {
    obj.backgroundThumbnails.forEach(bgUrl => {
      const tempBgImg = new Image();
      tempBgImg.onload = function() {
        const cBg = document.createElement("canvas");
        cBg.width = 224; cBg.height = 224;
        cBg.getContext("2d").drawImage(tempBgImg, 0, 0, 224, 224);
        capturedBackgrounds.push({ canvas: cBg, dataUrl: bgUrl });
        document.getElementById("bgCount").innerText = capturedBackgrounds.length;
        updateBackgroundThumbnailsUI();
      };
      tempBgImg.src = bgUrl;
    });
  } else {
    document.getElementById("bgCount").innerText = "0";
    document.getElementById("bgThumbnails").innerHTML = "";
  }

  document.getElementById("regStatus").innerText = `✏️ 「${obj.name}」の編集モードです。写真の削除・追加や名前の変更が可能です。`;
  document.getElementById("regStatus").style.color = "#ffc107";

  updateRegisteredListUI();
  document.getElementById("registerName").scrollIntoView({ behavior: 'smooth' });
};

// 編集モードを終了する関数
window.cancelEditingObject = function() {
  if (editingObjectIndex !== null) {
    const objName = customObjects[editingObjectIndex].name;
    editingObjectIndex = null;
    capturedObjects = [];
    capturedBackgrounds = [];
    document.getElementById("objCount").innerText = "0";
    document.getElementById("bgCount").innerText = "0";
    document.getElementById("objThumbnails").innerHTML = "";
    document.getElementById("bgThumbnails").innerHTML = "";
    document.getElementById("registerName").value = "";

    document.getElementById("regStatus").innerText = `ステータス: 「${objName}」の編集をキャンセルしました`;
    document.getElementById("regStatus").style.color = "#aaa";
    updateRegisteredListUI();
  }
};

// 登録リストのUI更新
function updateRegisteredListUI() {
  const registeredList = document.getElementById("registeredList");
  if (!registeredList) return;
  registeredList.innerHTML = "";

  customObjects.forEach((obj, idx) => {
    const container = document.createElement("div");
    container.style.cssText = "position: relative; display: inline-block; text-align: center; margin-right: 12px; background: #222; padding: 8px; border-radius: 8px; vertical-align: top;";

    const isEditing = (editingObjectIndex === idx);

    const thumb = document.createElement("img");
    thumb.src = obj.thumbnail;
    thumb.style.cssText = `width: 60px; height: 60px; object-fit: cover; border-radius: 6px; border: 3px solid ${isEditing ? '#ffc107' : '#28a745'}; display: block; margin: 0 auto; cursor: pointer;`;
    thumb.onclick = () => selectCustomTarget(obj.name);
    container.appendChild(thumb);

    const deleteBtn = document.createElement("button");
    deleteBtn.innerText = "×";
    deleteBtn.style.cssText = "position: absolute; top: -3px; right: -3px; background: #dc3545; color: #fff; border: none; border-radius: 50%; width: 20px; height: 20px; font-size: 12px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center;";
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      removeCustomObject(idx);
    };
    container.appendChild(deleteBtn);

    const lbl = document.createElement("div");
    lbl.innerText = obj.name; 
    lbl.style.cssText = `font-size: 10px; color: ${isEditing ? '#ffc107' : '#fff'}; margin-top: 3px; font-weight: bold;`;
    container.appendChild(lbl);

    const editBtnContainer = document.createElement("div");
    editBtnContainer.style.cssText = "margin-top: 5px; display: flex; gap: 3px; justify-content: center;";

    if (!isEditing) {
      const editBtn = document.createElement("button");
      editBtn.innerText = "✏️編集モード";
      editBtn.style.cssText = "padding: 3px 6px; font-size: 9px; background: #17a2b8; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-weight: bold;";
      editBtn.onclick = () => startEditingObject(idx);
      editBtnContainer.appendChild(editBtn);
    } else {
      const exitEditBtn = document.createElement("button");
      exitEditBtn.innerText = "⏹️終了";
      exitEditBtn.style.cssText = "padding: 3px 8px; font-size: 9px; background: #6c757d; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-weight: bold;";
      exitEditBtn.onclick = () => cancelEditingObject();
      editBtnContainer.appendChild(exitEditBtn);
    }

    container.appendChild(editBtnContainer);
    registeredList.appendChild(container);
  });
}

window.clearGallery = function() {
  document.getElementById("imageGallery").innerHTML = "";
};

function cropGuideArea() {
  const regVideo = document.getElementById("regVideo");
  const guideBox = document.getElementById("regGuideBox");
  if (!regVideo || !regVideo.srcObject || !guideBox) return null;
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = 224;
  tempCanvas.height = 224;
  const tempCtx = tempCanvas.getContext("2d");
  const vW = regVideo.videoWidth;
  const vH = regVideo.videoHeight;
  const dW = regVideo.clientWidth;
  const dH = regVideo.clientHeight;
  if (vW === 0 || vH === 0) return null;
  const sX = vW / dW;
  const sY = vH / dH;
  const gRect = guideBox.getBoundingClientRect();
  const vRect = regVideo.getBoundingClientRect();
  const cW = gRect.width * sX;
  const cH = gRect.height * sY;
  const cX = (gRect.left - vRect.left) * sX;
  const cY = (gRect.top - vRect.top) * sY;
  tempCtx.drawImage(regVideo, cX, cY, cW, cH, 0, 0, 224, 224);
  return tempCanvas;
}

window.captureObject = function() {
  const canvas = cropGuideArea();
  if (!canvas) { alert("先にカメラを起動してください"); return; }
  const dataUrl = canvas.toDataURL("image/jpeg");
  capturedObjects.push({ canvas, dataUrl });
  document.getElementById("objCount").innerText = capturedObjects.length;
  updateObjectThumbnailsUI();
};

window.captureBackground = function() {
  const canvas = cropGuideArea();
  if (!canvas) { alert("先にカメラを起動してください"); return; }
  const dataUrl = canvas.toDataURL("image/jpeg");
  capturedBackgrounds.push({ canvas, dataUrl });
  document.getElementById("bgCount").innerText = capturedBackgrounds.length;
  updateBackgroundThumbnailsUI();
};

// ✂️ 手動クロップモード
let capturedImageBitmap = null;
let isDrawing = false;
let startX = 0, startY = 0, endX = 0, endY = 0;

window.captureAndCropMode = function() {
    const regVideo = document.getElementById('regVideo');
    if (!regVideo) { alert("登録用カメラの要素が見つかりません。"); return; }
    const width = regVideo.videoWidth;
    const height = regVideo.videoHeight;
    if (!width || !height) { alert("カメラの映像がまだ準備できていません。"); return; }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(regVideo, 0, 0, width, height);

    const img = new Image();
    img.onload = function() {
        const cropCanvas = document.getElementById('cropCanvas');
        const cropSection = document.getElementById('crop-section');
        if (!cropCanvas || !cropSection) return;
        const displayWidth = 320;
        const displayHeight = (img.height / img.width) * displayWidth;
        cropCanvas.width = displayWidth;
        cropCanvas.height = displayHeight;
        cropCanvas.style.width = "100%";
        cropCanvas.style.height = "auto";
        const ctxCrop = cropCanvas.getContext('2d');
        ctxCrop.clearRect(0, 0, displayWidth, displayHeight);
        ctxCrop.drawImage(img, 0, 0, displayWidth, displayHeight);
        capturedImageBitmap = img;
        cropSection.style.display = "block";
        cropSection.scrollIntoView({ behavior: 'smooth' });
    };
    img.src = tempCanvas.toDataURL('image/jpeg');
};

const cropCanvas = document.getElementById('cropCanvas');
if (cropCanvas) {
    const ctxCrop = cropCanvas.getContext('2d');
    function getCursorPos(e) {
        const rect = cropCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const scaleX = cropCanvas.width / rect.width;
        const scaleY = cropCanvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }
    cropCanvas.onmousedown = (e) => { isDrawing = true; const pos = getCursorPos(e); startX = pos.x; startY = pos.y; endX = startX; endY = startY; };
    cropCanvas.ontouchstart = (e) => { isDrawing = true; const pos = getCursorPos(e); startX = pos.x; startY = pos.y; endX = startX; endY = startY; };
    cropCanvas.onmousemove = (e) => {
        if (!isDrawing || !capturedImageBitmap) return;
        const pos = getCursorPos(e); endX = pos.x; endY = pos.y;
        ctxCrop.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
        ctxCrop.drawImage(capturedImageBitmap, 0, 0, cropCanvas.width, cropCanvas.height);
        ctxCrop.strokeStyle = "#ff0055"; ctxCrop.lineWidth = 4;
        ctxCrop.strokeRect(startX, startY, endX - startX, endY - startY);
    };
    cropCanvas.ontouchmove = (e) => {
        if (!isDrawing || !capturedImageBitmap) return;
        const pos = getCursorPos(e); endX = pos.x; endY = pos.y;
        ctxCrop.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
        ctxCrop.drawImage(capturedImageBitmap, 0, 0, cropCanvas.width, cropCanvas.height);
        ctxCrop.strokeStyle = "#ff0055"; ctxCrop.lineWidth = 4;
        ctxCrop.strokeRect(startX, startY, endX - startX, endY - startY);
    };
    cropCanvas.onmouseup = () => { isDrawing = false; };
    cropCanvas.ontouchend = () => { isDrawing = false; };
}

window.confirmCrop = function() {
    if (startX === undefined || endX === undefined || Math.abs(endX - startX) < 10) {
        alert("切り取りたい範囲をしっかり囲んでください！");
        return;
    }
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);
    const cutCanvas = document.createElement('canvas');
    cutCanvas.width = 224; cutCanvas.height = 224;
    const cutCtx = cutCanvas.getContext('2d');
    const scaleX = capturedImageBitmap.width / cropCanvas.width;
    const scaleY = capturedImageBitmap.height / cropCanvas.height;
    cutCtx.drawImage(capturedImageBitmap, x * scaleX, y * scaleY, w * scaleX, h * scaleY, 0, 0, 224, 224);
    const dataUrl = cutCanvas.toDataURL("image/jpeg");
    capturedObjects.push({ canvas: cutCanvas, dataUrl });
    document.getElementById("objCount").innerText = capturedObjects.length;
    updateObjectThumbnailsUI();
    document.getElementById('crop-section').style.display = "none";
};

window.cancelCrop = function() {
    document.getElementById('crop-section').style.display = "none";
};

// ⚡ 【精度向上・自動回転(データ拡張)】AI特徴量ベクトル抽出・登録 / 更新処理
window.trainAndRegister = async function() {
  const name = document.getElementById("registerName").value.trim().toLowerCase();
  if (!name) { alert("登録する物体名を入力してください！"); return; }
  
  // ✨ 修正：新規登録時だけでなく編集モード時も、写真をすべて消して0枚になった場合はエラーにする
  if (capturedObjects.length === 0) { 
    alert("物体を1枚以上撮影してください！"); 
    return; 
  }
  if (!mobilenetModel) { alert("MobileNetモデルがまだロードされていません。"); return; }

  document.getElementById("regStatus").innerText = "⚡ 回転データ拡張 & AI特徴量を解析中...";
  document.getElementById("regStatus").style.color = "#ffc107";
  try {
    let objEmbeddings = [];
    let bgEmbeddings = [];
    let bgThumbnailsList = [];

    const angles = [0, 45, 90, 135, 180, 225, 270, 315];

    for (let item of capturedObjects) {
      if (!item.canvas) continue; 

      for (let angle of angles) {
        const rotCanvas = document.createElement("canvas");
        rotCanvas.width = 224;
        rotCanvas.height = 224;
        const rotCtx = rotCanvas.getContext("2d");

        rotCtx.translate(112, 112);
        rotCtx.rotate((angle * Math.PI) / 180);
        rotCtx.drawImage(item.canvas, -112, -112);

        tf.tidy(() => {
          const tensor = tf.browser.fromPixels(rotCanvas).toFloat().expandDims(0);
          const embedding = mobilenetModel.infer(tensor, true);
          objEmbeddings.push(Array.from(embedding.dataSync()));
        });
      }
    }

    for (let item of capturedBackgrounds) {
      if (!item.canvas) continue;
      bgThumbnailsList.push(item.dataUrl);
      tf.tidy(() => {
        const tensor = tf.browser.fromPixels(item.canvas).toFloat().expandDims(0);
        const embedding = mobilenetModel.infer(tensor, true);
        bgEmbeddings.push(Array.from(embedding.dataSync()));
      });
    }

    if (editingObjectIndex !== null) {
      const targetObj = customObjects[editingObjectIndex];
      targetObj.name = name;
      targetObj.embeddings = objEmbeddings;
      targetObj.backgrounds = bgEmbeddings;
      targetObj.backgroundThumbnails = bgThumbnailsList;
      targetObj.thumbnail = capturedObjects[0].dataUrl;

      document.getElementById("regStatus").innerText = `🎉 「${name}」のデータを更新しました！`;
      alert(`「${name}」のデータを更新しました！`);
      editingObjectIndex = null;
    } else {
      const newObjectData = {
        name: name,
        embeddings: objEmbeddings,
        backgrounds: bgEmbeddings,
        backgroundThumbnails: bgThumbnailsList,
        thumbnail: capturedObjects[0].dataUrl
      };
      customObjects.push(newObjectData);
      document.getElementById("regStatus").innerText = `🎉 「${name}」の登録が完了しました！`;
      alert(`「${name}」の登録が完了しました！`);
    }

    saveCustomObjectsToStorage(); // 💾 ストレージに永続保存

    activeCustomName = name;
    const modelSelect = document.getElementById("modelSelect");
    if (!modelSelect.querySelector('option[value="custom"]')) {
      modelSelect.innerHTML += `<option value="custom">登録した物体の検知</option>`;
    }
    modelSelect.value = "custom";
    useCustomModel = true;

    document.getElementById("regStatus").style.color = "#00ff00";

    updateRegisteredListUI();

    capturedObjects = [];
    capturedBackgrounds = [];
    document.getElementById("objCount").innerText = "0";
    document.getElementById("bgCount").innerText = "0";
    document.getElementById("objThumbnails").innerHTML = "";
    document.getElementById("bgThumbnails").innerHTML = "";
    document.getElementById("registerName").value = "";
  } catch (err) {
    console.error(err);
    alert("登録・更新中にエラーが発生しました: " + err.message);
  }
};

function calculateCosineSimilarity(vecA, vecB) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ================= リアルタイム推論ループ =================
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

      // 【カスタム検知モード】
      if (useCustomModel && customObjects.length > 0 && mobilenetModel && objectDetector) {
        const detections = objectDetector.detectForVideo(video, performance.now());

        if (detections && detections.detections) {
          const scaleX = canvas.width / video.videoWidth;
          const scaleY = canvas.height / video.videoHeight;

          for (let detection of detections.detections) {
            const bbox = detection.boundingBox;
            const x = bbox.originX;
            const y = bbox.originY;
            const width = bbox.width;
            const height = bbox.height;

            if (width < 20 || height < 20) continue;

            const cropCanvas = document.createElement("canvas");
            cropCanvas.width = 224;
            cropCanvas.height = 224;
            const cropCtx = cropCanvas.getContext("2d");
            cropCtx.drawImage(video, x, y, width, height, 0, 0, 224, 224);

            const currentEmbedding = tf.tidy(() => {
              const tensor = tf.browser.fromPixels(cropCanvas).toFloat().expandDims(0);
              const embedding = mobilenetModel.infer(tensor, true);
              return Array.from(embedding.dataSync());
            });

            let bestMatchName = "";
            let maxOverallSimilarity = 0;

            for (let obj of customObjects) {
              let maxObjSimilarity = 0;
              for (let regEmb of obj.embeddings) {
                const similarity = calculateCosineSimilarity(currentEmbedding, regEmb);
                if (similarity > maxObjSimilarity) maxObjSimilarity = similarity;
              }

              let maxBgSimilarity = 0;
              for (let bgEmb of obj.backgrounds) {
                const bgSimilarity = calculateCosineSimilarity(currentEmbedding, bgEmb);
                if (bgSimilarity > maxBgSimilarity) maxBgSimilarity = bgSimilarity;
              }

              const threshold = 0.3;
              if (maxObjSimilarity >= threshold && maxObjSimilarity > maxBgSimilarity) {
                if (maxObjSimilarity > maxOverallSimilarity) {
                  maxOverallSimilarity = maxObjSimilarity;
                  bestMatchName = obj.name;
                }
              }
            }

            if (bestMatchName) {
              foundTarget = true;
              activeCustomName = bestMatchName;
              const drawX = x * scaleX;
              const drawY = y * scaleY;
              const drawW = width * scaleX;
              const drawH = height * scaleY;

              ctx.strokeStyle = "#00ff00";
              ctx.lineWidth = 4;
              ctx.strokeRect(drawX, drawY, drawW, drawH);

              ctx.fillStyle = "rgba(0, 255, 0, 0.7)";
              ctx.fillRect(drawX, drawY > 25 ? drawY - 25 : 0, drawW, 25);

              ctx.fillStyle = "#000";
              ctx.font = "bold 14px sans-serif";
              ctx.fillText(`✨ ${bestMatchName} (${Math.round(maxOverallSimilarity * 100)}%)`, drawX + 5, drawY > 25 ? drawY - 7 : 18);

              const now = Date.now();
              if (now - lastSaveTime > 3000) {
                saveFoundCustomImage();
                lastSaveTime = now;
              }
            }
          }
        }

      } else if (objectDetector) {
        // 【標準モデルモード（Lite0 / Lite2）】
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
              ctx.fillStyle = "rgba(0, 255, 0, 0.7)";
              ctx.fillRect(x, y > 25 ? y - 25 : 0, width, 25);
              ctx.fillStyle = "#000";
              ctx.font = "bold 14px sans-serif";
              ctx.fillText(`${categoryName} ${score}%`, x + 5, y > 25 ? y - 7 : 18);

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
        status.innerText = `🎉 発見しました！`;
        status.style.color = "#00ff00";
      } else {
        status.innerText = `🔍 探索中... (${useCustomModel ? activeCustomName : currentSearchWord})`;
        status.style.color = "#aaa";
      }
    } catch (e) { console.error(e); }
  }

  if (webcamRunning) {
    window.requestAnimationFrame(predictWebcam);
  }
}

// 発見した履歴画像をタップしてプレビューする機能
function addGalleryThumbnail(dataUrl) {
  const gallery = document.getElementById("imageGallery");
  if (!gallery) return;

  const img = document.createElement("img");
  img.src = dataUrl;
  img.style.cssText = "width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 2px solid #00ff00; cursor: pointer; flex-shrink: 0;";

  img.onclick = () => {
    const modal = document.getElementById("imagePreviewModal");
    const previewImg = document.getElementById("previewImage");
    if (modal && previewImg) {
      previewImg.src = dataUrl;
      modal.style.display = "flex";
    }
  };

  gallery.prepend(img);
}

// プレビュー画面を閉じる関数
window.closePreview = function() {
  const modal = document.getElementById("imagePreviewModal");
  if (modal) {
    modal.style.display = "none";
  }
};

function saveFoundImage(bbox) {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = bbox.width; tempCanvas.height = bbox.height;
  tempCanvas.getContext("2d").drawImage(video, bbox.originX, bbox.originY, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
  addGalleryThumbnail(tempCanvas.toDataURL("image/jpeg"));
}

function saveFoundCustomImage() {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = video.videoWidth; tempCanvas.height = video.videoHeight;
  tempCanvas.getContext("2d").drawImage(video, 0, 0);
  addGalleryThumbnail(tempCanvas.toDataURL("image/jpeg"));
}