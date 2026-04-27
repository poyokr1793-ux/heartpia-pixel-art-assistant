// ==========================================
// 1. 定数・データ管理 (Constants)
// ==========================================
const FLAT_PALETTE = [];
const PALETTE_MAP = [];

// 【安全装置】RAW_PALETTEが存在するか確認してから処理を開始する
if (typeof RAW_PALETTE !== 'undefined') {
    Object.entries(RAW_PALETTE).forEach(([group, data], gIdx) => {
        data.Colors.forEach((rgb, cIdx) => {
            FLAT_PALETTE.push(rgb);
            PALETTE_MAP.push({ group, gIdx, cIdx, rgb });
        });
    });
} else {
    console.error("palette.js が正しく読み込まれていないか、RAW_PALETTE が定義されていません。");
}

const RESOLUTION_OPTIONS = {
    "16:9": [{ label: "30×18", w: 30, h: 18 }, { label: "50×28", w: 50, h: 28 }, { label: "100×56", w: 100, h: 56 }, { label: "150×84", w: 150, h: 84 }],
    "4:3": [{ label: "30×24", w: 30, h: 24 }, { label: "50×38", w: 50, h: 38 }, { label: "100×76", w: 100, h: 76 }, { label: "150×114", w: 150, h: 114 }],
    "1:1": [{ label: "30×30", w: 30, h: 30 }, { label: "50×50", w: 50, h: 50 }, { label: "100×100", w: 100, h: 100 }, { label: "150×150", w: 150, h: 150 }],
    "3:4": [{ label: "24×30", w: 24, h: 30 }, { label: "38×50", w: 38, h: 50 }, { label: "76×100", w: 76, h: 100 }, { label: "114×150", w: 114, h: 150 }],
    "9:16": [{ label: "18×30", w: 18, h: 30 }, { label: "28×50", w: 28, h: 50 }, { label: "56×100", w: 56, h: 100 }, { label: "84×150", w: 84, h: 150 }]
};

// ==========================================
// 2. アプリの状態管理 (Core State)
// ==========================================
const viewport = document.getElementById('viewport');
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');

let state = {
    // ソースデータ
    img: null,
    imgURL: null,
    dots: null,           // 変換後のパレットINDEX配列
    cacheCanvas: null,    // 描画高速化用の中間キャンバス

    // 設定
    w: 150,
    h: 84,
    baseDotSize: 10,
    focusIdx: null,       // 現在選択中のパレットINDEX

    // ビュー（カメラ）状態
    scale: 1,
    offsetX: 0,
    offsetY: 0,

    // 操作状態
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    totalMoved: 0,
    lastPinchDist: 0,
    tick: false           // requestAnimationFrame用
};

// ==========================================
// 3. 画像変換ロジック (Core Logic)
// ==========================================

async function processImage(file) {
    if (!file) return;
    const newURL = URL.createObjectURL(file);
    if (state.imgURL) URL.revokeObjectURL(state.imgURL);

    const img = new Image();
    img.src = newURL;
    state.imgURL = newURL;

    await img.decode();
    state.img = img;

    const prompt = document.getElementById('uploadPrompt');
    if (prompt) prompt.style.display = 'none';

    updateCache();
    requestDraw();
}

function updateCache() {
    if (!state.img) return;

    // 1. 小さなキャンバスでドット化
    const tempCanvas = document.createElement('canvas');
    const tCtx = tempCanvas.getContext('2d');
    tempCanvas.width = state.w;
    tempCanvas.height = state.h;
    tCtx.drawImage(state.img, 0, 0, state.w, state.h);
    const imgData = tCtx.getImageData(0, 0, state.w, state.h).data;

    // 2. ドットデータの保存
    if (!state.dots || state.dots.length !== state.w * state.h) {
        state.dots = new Int32Array(state.w * state.h);
    }

    // 3. キャッシュキャンバスの準備
    const cellSize = 10;
    const targetW = state.w * cellSize;
    const targetH = state.h * cellSize;

    if (!state.cacheCanvas) state.cacheCanvas = document.createElement('canvas');
    if (state.cacheCanvas.width !== targetW || state.cacheCanvas.height !== targetH) {
        state.cacheCanvas.width = targetW;
        state.cacheCanvas.height = targetH;
    }

    const cCtx = state.cacheCanvas.getContext('2d');
    const outputImageData = cCtx.createImageData(targetW, targetH);
    const outData = outputImageData.data;

    // フォーカス時の明度計算
    let focusBrightness = 0;
    if (state.focusIdx !== null) {
        const frgb = FLAT_PALETTE[state.focusIdx];
        focusBrightness = frgb[0] * 0.299 + frgb[1] * 0.587 + frgb[2] * 0.114;
    }

    // 4. パレット変換とピクセル埋め
    const paletteLen = FLAT_PALETTE.length;
    for (let i = 0; i < state.w * state.h; i++) {
        const i4 = i * 4;
        const r = imgData[i4], g = imgData[i4 + 1], b = imgData[i4 + 2];

        let minDist = Infinity, closestIdx = 0;
        for (let j = 0; j < paletteLen; j++) {
            const p = FLAT_PALETTE[j];
            const d = Math.pow(r - p[0], 2) + Math.pow(g - p[1], 2) + Math.pow(b - p[2], 2);
            if (d < minDist) { minDist = d; closestIdx = j; if (d === 0) break; }
        }
        state.dots[i] = closestIdx;

        // 色決定（フォーカス外は暗く/明るく）
        const rgb = FLAT_PALETTE[closestIdx];
        let [nr, ng, nb] = rgb;
        if (state.focusIdx !== null && state.focusIdx !== closestIdx) {
            const factor = focusBrightness < 128 ? 0.7 : 0.2;
            if (focusBrightness < 128) {
                nr += (255 - nr) * factor; ng += (255 - ng) * factor; nb += (255 - nb) * factor;
            } else {
                nr *= factor; ng *= factor; nb *= factor;
            }
        }

        const xBase = (i % state.w) * cellSize;
        const yBase = Math.floor(i / state.w) * cellSize;
        for (let dy = 0; dy < cellSize; dy++) {
            const rowOffset = (yBase + dy) * targetW;
            for (let dx = 0; dx < cellSize; dx++) {
                const dstIdx = (rowOffset + (xBase + dx)) * 4;
                outData[dstIdx] = nr; outData[dstIdx + 1] = ng; outData[dstIdx + 2] = nb; outData[dstIdx + 3] = 255;
            }
        }
    }
    cCtx.putImageData(outputImageData, 0, 0);
}

// ==========================================
// 4. 描画処理 (Renderer)
// ==========================================

function requestDraw() {
    if (state.tick) return;
    state.tick = true;
    requestAnimationFrame(() => {
        render();
        state.tick = false;
    });
}

function render() {
    const vW = viewport.clientWidth;
    const vH = viewport.clientHeight;
    if (canvas.width !== vW || canvas.height !== vH) {
        canvas.width = vW; canvas.height = vH;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

   
    if (!state.dots || !state.cacheCanvas) return;

    const dotSize = state.baseDotSize * state.scale;
    const drawX = Math.round(state.offsetX);
    const drawY = Math.round(state.offsetY);
    const totalW = state.w * dotSize;
    const totalH = state.h * dotSize;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.cacheCanvas, drawX, drawY, totalW, totalH);

    if (state.scale >= 1.5) {
        renderGrid(drawX, drawY, dotSize, totalW, totalH);
    }
    renderFocusHighlight(drawX, drawY, dotSize);
}

function renderGrid(offX, offY, dotSize, totalW, totalH) {
    ctx.save();
    
    let focusGridColor = "rgba(0,0,0,0.4)"; 
    let outGridColor = "rgba(255,255,255,0.15)"; // デフォルト（非強調時）

    if (state.focusIdx !== null) {
        const rgb = FLAT_PALETTE[state.focusIdx];
        const brightness = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
        
        if (brightness < 128) {
            focusGridColor = "rgba(255,255,255,0.5)";
            outGridColor = "rgba(0,0,0,0.4)";
        } else {
            focusGridColor = "rgba(0,0,0,0.4)";
            outGridColor = "rgba(255,255,255,0.2)";
        }
    }

    // 1. 垂直線の描画
    for (let x = 0; x <= state.w; x++) {
        const isMain = (x === 0 || x === state.w || x % 5 === 0);
        const lx = offX + Math.floor(x * dotSize) + 0.5;

        if (isMain) {
            ctx.beginPath();
            ctx.moveTo(lx, offY);
            ctx.lineTo(lx, offY + totalH);
            ctx.lineWidth = 10; // 外枠級に太く
            ctx.strokeStyle = "rgba(0,0,0,0.6)";
            ctx.stroke();
            ctx.lineWidth = 6;  // 白芯線も太く
            ctx.strokeStyle = "rgba(255,255,255,0.8)";
            ctx.stroke();
        } else {
            const checkX = (x === state.w) ? x - 1 : x;
            let currentY = 0;
            while (currentY < state.h) {
                const startY = currentY;
                const isFocus = (state.focusIdx !== null && state.dots[currentY * state.w + checkX] === state.focusIdx);
                while (currentY < state.h && (state.focusIdx !== null && state.dots[currentY * state.w + checkX] === state.focusIdx) === isFocus) {
                    currentY++;
                }
                ctx.beginPath();
                ctx.moveTo(lx, offY + startY * dotSize);
                ctx.lineTo(lx, offY + currentY * dotSize);
                ctx.lineWidth = 1;
                ctx.strokeStyle = isFocus ? focusGridColor : outGridColor;
                ctx.stroke();
            }
        }
    }

    // 2. 水平線の描画
    for (let y = 0; y <= state.h; y++) {
        const isMain = (y === 0 || y === state.h || (state.h - y) % 5 === 0);
        const ly = offY + Math.floor(y * dotSize) + 0.5;

        if (isMain) {
            ctx.beginPath();
            ctx.moveTo(offX, ly);
            ctx.lineTo(offX + totalW, ly);
            ctx.lineWidth = 10; // 外枠級に太く
            ctx.strokeStyle = "rgba(0,0,0,0.6)";
            ctx.stroke();
            ctx.lineWidth = 6;  // 白芯線も太く
            ctx.strokeStyle = "rgba(255,255,255,0.8)";
            ctx.stroke();
        } else {
            const checkY = (y === state.h) ? y - 1 : y;
            let currentX = 0;
            while (currentX < state.w) {
                const startX = currentX;
                const isFocus = (state.focusIdx !== null && state.dots[checkY * state.w + currentX] === state.focusIdx);
                while (currentX < state.w && (state.focusIdx !== null && state.dots[checkY * state.w + currentX] === state.focusIdx) === isFocus) {
                    currentX++;
                }
                ctx.beginPath();
                ctx.moveTo(offX + startX * dotSize, ly);
                ctx.lineTo(offX + currentX * dotSize, ly);
                ctx.lineWidth = 1;
                ctx.strokeStyle = isFocus ? focusGridColor : outGridColor;
                ctx.stroke();
            }
        }
    }
    ctx.restore();
}

function renderFocusHighlight(offX, offY, dotSize) {
    if (state.focusIdx === null) return;
    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;

    for (let i = 0; i < state.dots.length; i++) {
        if (state.dots[i] === state.focusIdx) {
            const x = i % state.w;
            const y = Math.floor(i / state.w);

            const drawX = offX + x * dotSize;
            const drawY = offY + y * dotSize;

            if (y === 0 || state.dots[i - state.w] !== state.focusIdx) {
                ctx.beginPath(); ctx.moveTo(drawX, drawY); ctx.lineTo(drawX + dotSize, drawY); ctx.stroke();
            }
            if (y === state.h - 1 || state.dots[i + state.w] !== state.focusIdx) {
                ctx.beginPath(); ctx.moveTo(drawX, drawY + dotSize); ctx.lineTo(drawX + dotSize, drawY + dotSize); ctx.stroke();
            }
            if (x === 0 || state.dots[i - 1] !== state.focusIdx) {
                ctx.beginPath(); ctx.moveTo(drawX, drawY); ctx.lineTo(drawX, drawY + dotSize); ctx.stroke();
            }
            if (x === state.w - 1 || state.dots[i + 1] !== state.focusIdx) {
                ctx.beginPath(); ctx.moveTo(drawX + dotSize, drawY); ctx.lineTo(drawX + dotSize, drawY + dotSize); ctx.stroke();
            }
        }
    }
    ctx.restore();
}

// ==========================================
// 5. 操作イベント (Interaction Handlers)
// ==========================================

function handleZoom(delta, centerX, centerY) {
    const oldScale = state.scale;
    state.scale = Math.max(0.1, Math.min(state.scale * (delta > 0 ? 0.97 : 1.03), 20));
    const ratio = state.scale / oldScale;

    const nextX = centerX - (centerX - state.offsetX) * ratio;
    const nextY = centerY - (centerY - state.offsetY) * ratio;

    const dotSize = state.baseDotSize * state.scale;
    const pX = canvas.width * 0.5, pY = canvas.height * 0.5;
    state.offsetX = Math.max(-(state.w * dotSize - pX), Math.min(nextX, canvas.width - pX));
    state.offsetY = Math.max(-(state.h * dotSize - pY), Math.min(nextY, canvas.height - pY));

    requestDraw();
}

const startDrag = (x, y) => {
    state.isDragging = true;
    state.dragStart = { x: x - state.offsetX, y: y - state.offsetY };
    state.totalMoved = 0;
};

const moveDrag = (x, y) => {
    if (!state.isDragging) return;
    const dotSize = state.baseDotSize * state.scale;
    const pX = canvas.width * 0.5, pY = canvas.height * 0.5;
    state.offsetX = Math.max(-(state.w * dotSize - pX), Math.min(x - state.dragStart.x, canvas.width - pX));
    state.offsetY = Math.max(-(state.h * dotSize - pY), Math.min(y - state.dragStart.y, canvas.height - pY));
    state.totalMoved++;
    requestDraw();
};

const endDrag = (x, y) => {
    if (state.isDragging && state.totalMoved < 5) {
        const rect = canvas.getBoundingClientRect();
        const dotSize = state.baseDotSize * state.scale;
        const dotX = Math.floor((x - rect.left - state.offsetX) / dotSize);
        const dotY = Math.floor((y - rect.top - state.offsetY) / dotSize);
        if (dotX >= 0 && dotX < state.w && dotY >= 0 && dotY < state.h) {
            const idx = state.dots[dotY * state.w + dotX];
            state.focusIdx = (state.focusIdx === idx) ? null : idx;
            updateCache();
            updateUI(state.focusIdx);
        }
    }
    state.isDragging = false;
    requestDraw();
};

// ==========================================
// 6. UI・初期化 (Initialization)
// ==========================================

function applyResolution(resValue) {
    const [w, h] = resValue.split('x').map(Number);
    state.w = w; state.h = h;
    const rect = viewport.getBoundingClientRect();
    const margin = 0.9;
    state.scale = Math.min((rect.width * margin) / (w * state.baseDotSize), (rect.height * margin) / (h * state.baseDotSize));
    state.offsetX = (rect.width - (w * state.baseDotSize * state.scale)) / 2;
    state.offsetY = (rect.height - (h * state.baseDotSize * state.scale)) / 2;
    if (state.img) { updateCache(); }
    requestDraw();
}

function updateResButtons(aspect) {
    const options = RESOLUTION_OPTIONS[aspect];
    const container = document.getElementById('resButtons');
    const buttons = container.querySelectorAll('.toggle-btn');
    
    buttons.forEach((btn, idx) => {
        const opt = options[idx];
        btn.dataset.value = `${opt.w}x${opt.h}`; // 縦横比と同じdata-valueに統一
    });

    const activeBtn = container.querySelector('.toggle-btn.active') || buttons[0];
    applyResolution(activeBtn.dataset.value);
}

document.querySelectorAll('#resButtons .toggle-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('#resButtons .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyResolution(btn.dataset.value); // 縦横比と同じプロパティを参照
    };
});

function updateUI(idx) {
    const panel = document.getElementById('uiPanel');
    const header = document.getElementById('uiHeader');
    const colors = document.getElementById('uiColors');

    if (idx === null) {
        panel.classList.remove('is-visible');
        return;
    }
    
    panel.classList.add('is-visible');

    const info = PALETTE_MAP[idx];
    const groupKeys = Object.keys(RAW_PALETTE);
    const gIdx = groupKeys.indexOf(info.group);

// ヘッダーの更新（5個並べるロジック）
    header.innerHTML = '';
    
    // 1. 左端 (2つ前)
    const farLeft = gIdx > 1 ? RAW_PALETTE[groupKeys[gIdx - 2]].Header : null;
    header.appendChild(createNavChip(farLeft, 'far-left'));

    // 2. 左隣 (1つ前)
    const nearLeft = gIdx > 0 ? RAW_PALETTE[groupKeys[gIdx - 1]].Header : null;
    header.appendChild(createNavChip(nearLeft, 'near-left'));
    
    // 3. 中央 (現在)
    const mid = document.createElement('div');
    mid.className = 'current-group-label';
    mid.style.backgroundColor = `rgb(${RAW_PALETTE[info.group].Header.join(',')})`;
    header.appendChild(mid);
    
    // 4. 右隣 (1つ後)
    const nearRight = gIdx < groupKeys.length - 1 ? RAW_PALETTE[groupKeys[gIdx + 1]].Header : null;
    header.appendChild(createNavChip(nearRight, 'near-right'));

    // 5. 右端 (2つ後)
    const farRight = gIdx < groupKeys.length - 2 ? RAW_PALETTE[groupKeys[gIdx + 2]].Header : null;
    header.appendChild(createNavChip(farRight, 'far-right'));

    // カラーリストの更新
    colors.innerHTML = '';
    RAW_PALETTE[info.group].Colors.forEach((rgb, i) => {
        const box = document.createElement('div');
        box.className = `color-box ${i === info.cIdx ? 'selected' : ''}`;
        box.style.backgroundColor = `rgb(${rgb.join(',')})`;
        
        box.onclick = () => {
            const newIdx = PALETTE_MAP.findIndex(m => m.group === info.group && m.cIdx === i);
            state.focusIdx = newIdx;
            updateCache();
            updateUI(newIdx);
            requestDraw();
        };
        colors.appendChild(box);
    });
}

function createNavChip(rgb, position) {
    const div = document.createElement('div');
    div.className = 'nav-color-chip';
    if (rgb) {
        div.style.backgroundColor = `rgb(${rgb.join(',')})`;
        div.style.border = '2px solid #fff';
        
        // 隣り合う境界線の重なりを防ぐ処理
        if (position === 'far-left') {
            div.style.borderRight = 'none';
        } else if (position === 'near-left') {
            div.style.borderRight = 'none';
        } else if (position === 'near-right') {
            div.style.borderLeft = 'none';
        } else if (position === 'far-right') {
            div.style.borderLeft = 'none';
        }
    } else {
        div.style.border = 'none';
        div.style.backgroundColor = 'transparent';
    }
    return div;
}

viewport.addEventListener('dragover', e => e.preventDefault());
viewport.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) processImage(file);
});
viewport.onwheel = e => { e.preventDefault(); handleZoom(e.deltaY, e.clientX, e.clientY); };
viewport.onmousedown = e => { if (!e.target.closest('#uploadPrompt')) startDrag(e.clientX, e.clientY); };
window.onmousemove = e => moveDrag(e.clientX, e.clientY);
window.onmouseup = e => endDrag(e.clientX, e.clientY);

viewport.ontouchstart = e => {
    if (e.target.closest('#uploadPrompt')) return;
    if (e.touches.length === 1) startDrag(e.touches[0].clientX, e.touches[0].clientY);
    else if (e.touches.length === 2) {
        state.isDragging = false;
        state.lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
};
window.ontouchmove = e => {
    if (e.touches.length === 1 && state.isDragging) moveDrag(e.touches[0].clientX, e.touches[0].clientY);
    else if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        handleZoom((state.lastPinchDist - dist) * 2, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
        state.lastPinchDist = dist;
    }
};
window.ontouchend = e => {
    if (e.touches.length < 2) state.lastPinchDist = 0;
    if (e.changedTouches.length === 1 && state.totalMoved < 5 && !state.lastPinchDist) endDrag(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
};

document.querySelectorAll('#aspectButtons .toggle-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('#aspectButtons .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateResButtons(btn.dataset.value);
    };
});

window.addEventListener('resize', () => {
    const oldW = canvas.width, oldH = canvas.height;
    canvas.width = viewport.clientWidth;
    canvas.height = viewport.clientHeight;
    state.offsetX += (canvas.width - oldW) / 2;
    state.offsetY += (canvas.height - oldH) / 2;
    requestDraw();
});

document.getElementById('imageInput').onchange = e => processImage(e.target.files[0]);
updateResButtons("16:9");
// ==========================================
// 7. メッセージ送信機能 (Discord Webhook)
// ==========================================
async function sendToDiscord() {
    const msgInput = document.getElementById('userMsg');
    const message = msgInput.value.trim();

    if (!message) {
        alert("メッセージを入力してください。");
        return;
    }

    // ユーザーが作成したWebhook URL
    const webhookURL = "https://discord.com/api/webhooks/1498062675769294848/s4-73OZa10q3ufKGfN6DbV8p1Q9dM6Sjpbm4AQMM8nnSYS84BaSwhZ3hLH-Bx0B632rR";

    const payload = {
        content: `【ツールへの要望・メッセージ】\n--------------------------------\n${message}\n--------------------------------`
    };

    try {
        const response = await fetch(webhookURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert("メッセージを送信しました！ありがとうございます。");
            msgInput.value = ""; // 送信成功時に入力欄をクリア
        } else {
            alert("送信に失敗しました。URLが正しいか確認するか、時間を置いて試してください。");
        }
    } catch (error) {
        console.error("Fetch Error:", error);
        alert("通信エラーが発生しました。インターネット接続を確認してください。");
    }
}