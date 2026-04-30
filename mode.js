// ==========================================
// 画像加工アルゴリズム (Mode Logic)
// ==========================================

const ModeProcessor = {
    // 「なめらか」モード：1. ふんわり（ぼかし）処理
    applySmooth: (i, r, g, b, imgData, w, h, errors) => {
        const x = i % w;
        const y = Math.floor(i / w);
        let count = 1;
        [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                const ni4 = (ny * w + nx) * 4;
                r += imgData[ni4];
                g += imgData[ni4 + 1];
                b += imgData[ni4 + 2];
                count++;
            }
        });
        return {
            r: (r / count) + errors[i * 4],
            g: (g / count) + errors[i * 4 + 1],
            b: (b / count) + errors[i * 4 + 2]
        };
    },

 // 「きれい」モード：彩度を上げて色を整理（以前の「くっきり」の計算をそのまま持ってくる）
    applyClean: (r, g, b) => {
        const avg = (r + g + b) / 3;
        const saturation = 1.15; // 鮮やかさの倍率
        return {
            r: Math.max(0, Math.min(255, avg + (r - avg) * saturation)),
            g: Math.max(0, Math.min(255, avg + (g - avg) * saturation)),
            b: Math.max(0, Math.min(255, avg + (b - avg) * saturation))
        };
    },

    // 「くっきり」モード：エッジ強調で輪郭を鋭く（以前の「きれい」の計算をそのまま持ってくる）
    applySharp: (i, r, g, b, imgData, w, h) => {
        const x = i % w;
        const y = Math.floor(i / w);
        if (x > 0 && x < w - 1 && y > 0 && y < h - 1) {
            const up = ((y - 1) * w + x) * 4;
            const down = ((y + 1) * w + x) * 4;
            const left = (y * w + (x - 1)) * 4;
            const right = (y * w + (x + 1)) * 4;

            const currentBright = (r + g + b) / 3;
            const neighborBright = (
                (imgData[up] + imgData[up + 1] + imgData[up + 2]) / 3 +
                (imgData[down] + imgData[down + 1] + imgData[down + 2]) / 3 +
                (imgData[left] + imgData[left + 1] + imgData[left + 2]) / 3 +
                (imgData[right] + imgData[right + 1] + imgData[right + 2]) / 3
            ) / 4;

            const diff = currentBright - neighborBright;
            return {
                r: Math.max(0, Math.min(255, r + diff * 0.7)),
                g: Math.max(0, Math.min(255, g + diff * 0.7)),
                b: Math.max(0, Math.min(255, b + diff * 0.7))
            };
        }
        return { r, g, b };
    },

    // 「なめらか」モード：仕上げのノイズ除去
    cleanupSmooth: (dots, w, h) => {
        const cleanedDots = new Int32Array(dots);
        for (let i = 0; i < w * h; i++) {
            const x = i % w;
            const y = Math.floor(i / w);
            const counts = {};
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        const idx = dots[ny * w + nx];
                        counts[idx] = (counts[idx] || 0) + 1;
                    }
                }
            }
         let maxCount = 0, dominantIdx = dots[i];
            for (const [idx, count] of Object.entries(counts)) {
                if (count > maxCount) {
                    maxCount = count;
                    dominantIdx = parseInt(idx);
                }
            }
            
            // 周辺との色の差（重要度）を簡易計算し、ディテールを保護する
            const centerRGB = FLAT_PALETTE[dots[i]];
            let edgeScore = 0;
            [[0,-1],[0,1],[-1,0],[1,0]].forEach(([dx, dy]) => {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    const neighborRGB = FLAT_PALETTE[dots[ny * w + nx]];
                    edgeScore += Math.abs(centerRGB[0] - neighborRGB[0]) + Math.abs(centerRGB[1] - neighborRGB[1]) + Math.abs(centerRGB[2] - neighborRGB[2]);
                }
            });

            // 重要度が高い（edgeScoreが大きい）場所は、周囲に合わせず元のドットを維持しやすくする
            const threshold = edgeScore > 100 ? 1 : 2; 
            if (counts[dots[i]] <= threshold) cleanedDots[i] = dominantIdx;
        }
        return cleanedDots;
    }
};