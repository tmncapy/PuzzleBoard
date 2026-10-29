// script.js
// Global API URL resolver with subpath support
let isServerApiAvailable = null;

function getApiUrl(endpoint) {
    const clean = endpoint.replace(/^\/+/, '');
    let custom = localStorage.getItem('crossword_backend_url');
    if (custom) {
        try {
            const u = new URL(custom);
            if (u.hostname !== window.location.hostname && u.hostname.includes('github.io') && !window.location.hostname.includes('github.io')) {
                localStorage.removeItem('crossword_backend_url');
                custom = null;
            }
        } catch(e) {
            custom = null;
        }
    }
    if (custom) {
        return custom.replace(/\/+$/, '') + '/' + clean;
    }
    const segments = window.location.pathname.split('/').filter(Boolean);
    let prefix = '';
    if (segments.length > 0 && /^puzzleboard/i.test(segments[0])) {
        prefix = '/' + segments[0];
    }
    return window.location.origin + prefix + '/' + clean;
}

function probeScriptApi() {
    if (isServerApiAvailable !== null) return;
    fetch(getApiUrl('api/get-active-room'))
        .then(r => {
            if (r.ok && r.status === 200) {
                isServerApiAvailable = true;
                return r.json().catch(() => null);
            } else {
                isServerApiAvailable = false;
                return null;
            }
        })
        .then(data => {
            if (data && data.activeRoomId && currentActiveRoomId !== data.activeRoomId) {
                setupActiveRoomSync(data.activeRoomId);
            }
        })
        .catch(() => {
            isServerApiAvailable = false;
        });
}
probeScriptApi();

const globalFavicon = document.createElement('link');
globalFavicon.rel = 'icon';
globalFavicon.type = 'image/x-icon';
globalFavicon.href = 'favicon.ico';
document.head.appendChild(globalFavicon);

// --- KHỞI TẠO ĐỐI TƯỢNG ĐỒNG BỘ SUPABASE & BROADCAST CHANNEL ---
var SUPABASE_URL = window.SUPABASE_URL || "https://tukabyhjmcyptuwmwedp.supabase.co";
var SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1a2FieWhqbWN5cHR1d213ZWRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0NDk3NDksImV4cCI6MjA5NjAyNTc0OX0.gNWdvZ_hRdon_w_KL3C3eXFFiV_EoA4eLgikcYb6dpQ";

if (SUPABASE_URL && !SUPABASE_URL.startsWith("http://") && !SUPABASE_URL.startsWith("https://")) {
    SUPABASE_URL = "https://" + SUPABASE_URL;
}

var supabaseClient = null;
var channel = null;
try {
    if (typeof supabase !== "undefined" && supabase.createClient) {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        channel = supabaseClient.channel('crossword_broadcast_room', {
            config: { broadcast: { ack: false, self: true } }
        });
    }
} catch (err) {
    console.warn("Supabase initialization error, falling back to Server/BroadcastChannel/localStorage:", err);
}

// Fallback local BroadcastChannel for tab-to-tab communication without external server dependency
const localBC = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel('crossword_broadcast_room') : null;

// Giữ nguyên tỷ lệ 16:9 (1920x1080) chuẩn xác trên mọi màn hình và iframe, không bị kéo giãn ngang (wide)
function fitGameContainer() {
    const container = document.getElementById("game-container");
    if (!container) return;
    const w = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth || 1920;
    const h = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight || 1080;
    const scaleX = w / 1920;
    const scaleY = h / 1080;
    const scale = Math.min(scaleX, scaleY);
    container.style.transform = `scale(${scale})`;
}
window.addEventListener("resize", fitGameContainer);
window.addEventListener("orientationchange", fitGameContainer);
window.addEventListener("DOMContentLoaded", () => {
    fitGameContainer();
    updateBoardBackground();
});
setTimeout(() => {
    fitGameContainer();
    updateBoardBackground();
}, 100);

const board = document.getElementById("board");

// Khởi tạo các đối tượng âm thanh hệ thống chính với preload tự động
let masterVolume = 1.0;
try {
    const savedVol = localStorage.getItem('system_master_volume');
    if (savedVol !== null) {
        const v = parseFloat(savedVol);
        if (!isNaN(v) && v >= 0 && v <= 1) masterVolume = v;
    }
} catch(e) {}

const showSound = new Audio("Reveal_the_Letters.mp3");
showSound.preload = "auto";
showSound.volume = masterVolume;
const revealSound = new Audio("ClearTossUp.mp3");
revealSound.preload = "auto";
revealSound.volume = masterVolume;
const clearPuzzleSound = new Audio("ClearPuzzle.mp3");
clearPuzzleSound.preload = "auto";
clearPuzzleSound.volume = masterVolume;
const lettersSolvedSound = new Audio("Letters_Solved.mp3");
lettersSolvedSound.preload = "auto";
lettersSolvedSound.volume = masterVolume;
const tossupSound = new Audio("tossup.mp3");
tossupSound.preload = "auto";
tossupSound.loop = true;
tossupSound.volume = masterVolume;
const round30Sound = new Audio("30s.mp3");
round30Sound.preload = "auto";
round30Sound.loop = false;
round30Sound.volume = masterVolume;
round30Sound.addEventListener('ended', () => {
    round30Sound.pause();
    round30Sound.currentTime = 0;
});
const correctSound = new Audio("Correct.mp3");
correctSound.preload = "auto";
correctSound.volume = masterVolume;

// Centralized Fade Out Manager for Display BGM
let displayBgmFadeInterval = null;
function cancelDisplayBgmFade() {
    if (displayBgmFadeInterval) {
        clearInterval(displayBgmFadeInterval);
        displayBgmFadeInterval = null;
    }
}

function fadeAllBgm(durationMs = 2000) {
    cancelDisplayBgmFade();
    const bgmList = [currentDisplaySoundboardAudio, tossupSound, round30Sound].filter(a => a && !a.paused && a.volume > 0.001);
    if (bgmList.length === 0) return;

    const startVols = bgmList.map(a => a.volume);
    const steps = 40;
    const stepTime = Math.max(16, Math.floor(durationMs / steps));
    let step = 0;

    displayBgmFadeInterval = setInterval(() => {
        step++;
        const factor = Math.max(0, 1 - (step / steps));
        bgmList.forEach((audio, idx) => {
            if (audio && !audio.paused) {
                audio.volume = startVols[idx] * factor;
            }
        });

        if (step >= steps || factor <= 0.001) {
            cancelDisplayBgmFade();
            bgmList.forEach(audio => {
                try {
                    audio.pause();
                    audio.currentTime = 0;
                    audio.volume = masterVolume;
                } catch(e) {}
            });
            if (currentDisplaySoundboardAudio && bgmList.includes(currentDisplaySoundboardAudio)) {
                try { currentDisplaySoundboardAudio.remove(); } catch(e){}
                currentDisplaySoundboardAudio = null;
            }
        }
    }, stepTime);
}

// --- AUDIO POOL & PRELOAD MANAGER FOR 0MS LATENCY ---
const audioPool = {};
function getPooledAudio(src) {
    if (!audioPool[src]) {
        audioPool[src] = [];
    }
    const pool = audioPool[src];
    for (let i = 0; i < pool.length; i++) {
        if (pool[i].paused || pool[i].ended) {
            pool[i].currentTime = 0;
            pool[i].volume = masterVolume;
            return pool[i];
        }
    }
    const a = new Audio(src);
    a.preload = "auto";
    a.volume = masterVolume;
    if (pool.length < 5) pool.push(a);
    return a;
}

function playFastSound(src) {
    if (isMuted) return;
    try {
        const audio = getPooledAudio(src);
        audio.currentTime = 0;
        audio.volume = masterVolume;
        audio.play().catch(() => {});
    } catch(e) {}
}

const CRITICAL_SFX = [
    "A_Letter_gets_Highlighted.mp3",
    "Open_a_Letter.mp3",
    "wrong.mp3",
    "Correct.mp3",
    "ding.mp3",
    "ding.wav",
    "ClearPuzzle.mp3",
    "ClearTossUp.mp3",
    "Letters_Solved.mp3",
    "Reveal_the_Letters.mp3",
    "10s.mp3",
    "30s.mp3"
];

function preloadMediaBuffers() {
    CRITICAL_SFX.forEach(src => {
        try {
            const a = getPooledAudio(src);
            a.load();
        } catch(e) {}
    });
    const criticalImages = ["bangochu.png", "defaultbox.png", "thumbnail.png"];
    criticalImages.forEach(src => {
        const img = new Image();
        img.src = src;
    });
}
window.addEventListener('DOMContentLoaded', preloadMediaBuffers);
setTimeout(preloadMediaBuffers, 100);

// Lấy tham chiếu tới các đèn hiệu ứng overlay
const lightWhite = document.getElementById("light-white");
const lightGreen = document.getElementById("light-green");
const lightRed = document.getElementById("light-red");

let activeSFXList = [];
let currentDisplaySoundboardAudio = null;
let tossupTimeoutIds = [];
let allCells = [];
let absoluteCells = new Array(52).fill(null);
let currentQuizIndex = -1;

let isWWFMode = (function() {
    try {
        return localStorage.getItem('crossword_wwf_mode') === '1';
    } catch(e) {
        return false;
    }
})();

// Chế độ Words With Friends CHỈ áp dụng ở các vòng đoán thường (Đề 3, 4, 5, 9 tương ứng index 2, 3, 4, 8)
const WWF_ALLOWED_QUIZ_INDEXES = [2, 3, 4, 8];

function isWWFActiveForCurrentRound() {
    return isWWFMode && (currentQuizIndex === -1 || WWF_ALLOWED_QUIZ_INDEXES.includes(currentQuizIndex));
}

function updateBoardBackground() {
    const bgNormal = document.getElementById("bg-normal");
    const bgWWF = document.getElementById("bg-wwf");
    const boardEl = document.getElementById("board");
    const active = isWWFActiveForCurrentRound();

    if (bgNormal) {
        bgNormal.style.display = active ? "none" : "block";
    }
    if (bgWWF) {
        bgWWF.style.display = active ? "block" : "none";
    }
    if (boardEl) {
        boardEl.style.backgroundImage = active ? 'url("bangochu_WWF.png")' : 'url("bangochu.png")';
    }
}

const boardRowDefinitions = [
    { start: 0, end: 12 },
    { start: 12, end: 26 },
    { start: 26, end: 40 },
    { start: 40, end: 52 }
];

function calculateWWFBonuses(absCells) {
    boardRowDefinitions.forEach(row => {
        let currentWord = [];
        for (let i = row.start; i < row.end; i++) {
            const item = absCells[i];
            if (item && item.letter && item.letter.trim() !== "" && item.letter !== " ") {
                currentWord.push(item);
            } else {
                if (currentWord.length > 0) {
                    assignWordWWFBonuses(currentWord);
                    currentWord = [];
                }
            }
        }
        if (currentWord.length > 0) {
            assignWordWWFBonuses(currentWord);
        }
    });
}

function assignWordWWFBonuses(wordCells) {
    if (!wordCells || wordCells.length === 0) return;
    wordCells.forEach(item => {
        item.wwfBonus = 'NORMAL';
        item.wwfBg = 'url("defaultbox_WWF.png") center center no-repeat';
    });
    // Chọn ngẫu nhiên 1 ô trong mỗi TỪ để thành DL (x2) hoặc TL (x3)
    const randomIdx = Math.floor(Math.random() * wordCells.length);
    const isTL = Math.random() < 0.5;
    const bonusItem = wordCells[randomIdx];
    if (isTL) {
        bonusItem.wwfBonus = 'TL';
        bonusItem.wwfBg = 'url("defaultbox_TL_WWF.png") center center no-repeat';
    } else {
        bonusItem.wwfBonus = 'DL';
        bonusItem.wwfBg = 'url("defaultbox_DL_WWF.png") center center no-repeat';
    }
}

// Mute control: Âm thanh CHỈ phát trên màn hình chính (index.html), tắt hoàn toàn trên frame xem thử / iframe và các trang khác
const urlParams = new URLSearchParams(window.location.search);
const isInIframe = (function() {
    try {
        return window.self !== window.top;
    } catch (e) {
        return true;
    }
})();

let isMuted = urlParams.get('muted') === '1' || urlParams.get('muted') === 'true' || window.name === 'audiencePreviewFrame' || isInIframe;

const originalAudioPlay = Audio.prototype.play;

function updateMuteState(muted) {
    isMuted = !!muted;
    showSound.muted = isMuted;
    revealSound.muted = isMuted;
    clearPuzzleSound.muted = isMuted;
    lettersSolvedSound.muted = isMuted;
    tossupSound.muted = isMuted;
    round30Sound.muted = isMuted;
    correctSound.muted = isMuted;
    if (isMuted) {
        showSound.volume = 0;
        revealSound.volume = 0;
        clearPuzzleSound.volume = 0;
        lettersSolvedSound.volume = 0;
        tossupSound.volume = 0;
        round30Sound.volume = 0;
        correctSound.volume = 0;
        try { tossupSound.pause(); } catch(e){}
        try { round30Sound.pause(); } catch(e){}
        try { correctSound.pause(); } catch(e){}
        Audio.prototype.play = function() {
            return Promise.resolve();
        };
    } else {
        showSound.volume = masterVolume;
        revealSound.volume = masterVolume;
        clearPuzzleSound.volume = masterVolume;
        lettersSolvedSound.volume = masterVolume;
        tossupSound.volume = masterVolume;
        round30Sound.volume = masterVolume;
        correctSound.volume = masterVolume;
        Audio.prototype.play = originalAudioPlay;
    }
}

updateMuteState(isMuted);

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SET_MUTE_STATE') {
        updateMuteState(event.data.muted);
    }
});

function initAudioPermission() {
    if (isMuted) return;
    if (showSound.paused && showSound.readyState === 0) showSound.load();
    if (revealSound.paused && revealSound.readyState === 0) revealSound.load();
    if (clearPuzzleSound.paused && clearPuzzleSound.readyState === 0) clearPuzzleSound.load();
    if (lettersSolvedSound.paused && lettersSolvedSound.readyState === 0) lettersSolvedSound.load();
    if (tossupSound.paused && tossupSound.readyState === 0) tossupSound.load();
    if (round30Sound.paused && round30Sound.readyState === 0) round30Sound.load();
    if (correctSound.paused && correctSound.readyState === 0) correctSound.load();
}

function playDing(){
    if (isMuted) return;
    playFastSound("A_Letter_gets_Highlighted.mp3");
}

function playOpenLetter() {
    if (isMuted) return;
    playFastSound("Open_a_Letter.mp3");
}

function playSecondDing(){
    playOpenLetter();
}

// Sửa hàm phát tiếng đoán sai với 0ms latency
function playWrong() {
    if (isMuted) return;
    initAudioPermission();
    playFastSound("wrong.mp3");
}

function playTimerSound(seconds) {
    if (isMuted) return;
    const filename = seconds === 30 ? "30s.mp3" : "10s.mp3";
    playFastSound(filename);
}

let fadeInterval = null;

function fadeOutTossupMusic(durationMs = 400, resetPosition = false) {
    if (fadeInterval) {
        clearInterval(fadeInterval);
        fadeInterval = null;
    }
    if (tossupSound.paused || isMuted) {
        if (resetPosition) tossupSound.currentTime = 0;
        return;
    }
    const startVolume = tossupSound.volume || masterVolume;
    const steps = 20;
    const stepTime = Math.max(10, durationMs / steps);
    const volumeStep = startVolume / steps;

    fadeInterval = setInterval(() => {
        if (tossupSound.volume - volumeStep > 0) {
            tossupSound.volume -= volumeStep;
        } else {
            tossupSound.volume = 0;
            tossupSound.pause();
            if (resetPosition) {
                tossupSound.currentTime = 0;
            }
            tossupSound.volume = masterVolume;
            clearInterval(fadeInterval);
            fadeInterval = null;
        }
    }, stepTime);
}

function playTossupMusic() {
    if (isMuted || currentQuizIndex === 12) return;
    cancelDisplayBgmFade();
    if (fadeInterval) {
        clearInterval(fadeInterval);
        fadeInterval = null;
    }
    if (!tossupSound.paused && tossupSound.currentTime > 0) {
        tossupSound.volume = masterVolume;
        return;
    }
    tossupSound.volume = masterVolume; 
    let playPromise = tossupSound.play();
    if (playPromise !== undefined) {
        playPromise.catch(() => {
            document.body.addEventListener('click', function memoPlay() {
                if (!isMuted && currentQuizIndex !== 12) tossupSound.play();
                document.body.removeEventListener('click', memoPlay);
            }, { once: true });
        });
    }
}

function playRound30Music() {
    if (isMuted) return;
    cancelDisplayBgmFade();
    if (!round30Sound.paused && round30Sound.currentTime > 0) {
        round30Sound.volume = masterVolume;
        return;
    }
    round30Sound.volume = masterVolume;
    let playPromise = round30Sound.play();
    if (playPromise !== undefined) {
        playPromise.catch(() => {
            document.body.addEventListener('click', function memoPlay() {
                if (!isMuted) round30Sound.play();
                document.body.removeEventListener('click', memoPlay);
            }, { once: true });
        });
    }
}

function stopRound30Music(resetPosition = true) {
    cancelDisplayBgmFade();
    round30Sound.pause();
    if (resetPosition) {
        round30Sound.currentTime = 0;
    }
    round30Sound.volume = masterVolume;
}

// Hàm hỗ trợ ẩn tất cả đèn hiệu ứng màn hình
function hideAllLights() {
    if (lightWhite) lightWhite.style.display = "none";
    if (lightGreen) lightGreen.style.display = "none";
    if (lightRed) lightRed.style.display = "none";
}

// Hàm kích hoạt nháy đèn đỏ khi đoán sai chữ
function triggerRedLight() {
    if (lightRed) {
        lightRed.style.display = "block";
        setTimeout(() => {
            lightRed.style.display = "none";
        }, 1000); // Đèn đỏ sáng trong 1 giây rồi tắt
    }
}

function triggerWhiteLight() {
    const lightWhite = document.getElementById("light-white");
    if (lightWhite) {
        lightWhite.style.display = "block";
        setTimeout(() => {
            lightWhite.style.display = "none";
        }, 1000);
    }
}

function triggerGreenLight() {
    const lightGreen = document.getElementById("light-green");
    if (lightGreen) {
        lightGreen.style.display = "block";
        setTimeout(() => {
            lightGreen.style.display = "none";
        }, 1000);
    }
}

function cleanLetter(letter) {
    if (!letter) return "";
    let cleaned = letter.replace("_", "");
    return removeVietnameseTones(cleaned).toUpperCase();
}

function removeVietnameseTones(str) {
    const map = {
        "á": "a", "à": "a", "ả": "a", "ã": "a", "ạ": "a", "Á": "A", "À": "A", "Ả": "A", "Ã": "A", "Ạ": "A",
        "ấ": "â", "ầ": "â", "ẩ": "â", "ẫ": "â", "ậ": "â", "Ấ": "Â", "Ầ": "Â", "Ẩ": "Â", "Ẫ": "Â", "Ậ": "Â",
        "ắ": "ă", "ằ": "ă", "ẳ": "ă", "ẵ": "ă", "ặ": "ă", "Ắ": "Ă", "Ằ": "Ă", "Ẳ": "Ă", "Ẵ": "Ă", "Ặ": "Ă",
        "é": "e", "è": "e", "ẻ": "e", "ẽ": "e", "ẹ": "e", "É": "E", "È": "E", "Ẻ": "E", "Ẽ": "E", "Ẹ": "E",
        "ế": "ê", "ề": "ê", "ể": "ê", "ễ": "ê", "ệ": "ê", "Ế": "Ê", "Ề": "Ê", "Ể": "Ê", "Ễ": "Ê", "Ệ": "Ê",
        "í": "i", "ì": "i", "ỉ": "i", "ĩ": "i", "ị": "i", "Í": "I", "Ì": "I", "Ỉ": "I", "Ĩ": "I", "Ị": "I",
        "ó": "o", "ò": "o", "ỏ": "o", "õ": "o", "ọ": "o", "Ó": "O", "Ò": "O", "Ỏ": "O", "Õ": "O", "Ọ": "O",
        "ố": "ô", "ồ": "ô", "ổ": "ô", "ỗ": "ô", "ộ": "ô", "Ố": "Ô", "Ồ": "Ô", "Ổ": "Ô", "Ỗ": "Ô", "Ộ": "Ô",
        "ớ": "ơ", "ờ": "ơ", "ở": "ơ", "ỡ": "ơ", "ợ": "ơ", "Ớ": "Ơ", "Ờ": "Ơ", "Ở": "Ơ", "Ỡ": "Ơ", "Ợ": "Ơ",
        "ú": "u", "ù": "u", "ủ": "u", "ũ": "u", "ụ": "u", "Ú": "U", "Ù": "U", "Ủ": "U", "Ũ": "U", "Ụ": "U",
        "ứ": "ư", "ừ": "ư", "ử": "ư", "ữ": "ư", "ự": "ư", "Ứ": "Ư", "Ừ": "Ư", "Ử": "Ư", "Ữ": "Ư", "Ự": "Ư",
        "ý": "y", "ỳ": "y", "ỷ": "y", "ỹ": "y", "ỵ": "y", "Ý": "Y", "Ỳ": "Y", "Ỷ": "Y", "Ỹ": "Y", "Ỵ": "Y"
    };
    return str.split("").map(c => map[c] || c).join("");
}

const cells = [
    { x: 246, y: 240 }, { x: 366, y: 240 }, { x: 486, y: 240 }, { x: 606, y: 240 }, { x: 726, y: 240 }, { x: 846, y: 240 }, { x: 966, y: 240 }, { x: 1086, y: 240 }, { x: 1206, y: 240 }, { x: 1326, y: 240 }, { x: 1446, y: 240 }, { x: 1566, y: 240 },
    { x: 126, y: 390 }, { x: 246, y: 390 }, { x: 366, y: 390 }, { x: 486, y: 390 }, { x: 606, y: 390 }, { x: 726, y: 390 }, { x: 846, y: 390 }, { x: 966, y: 390 }, { x: 1086, y: 390 }, { x: 1206, y: 390 }, { x: 1326, y: 390 }, { x: 1446, y: 390 }, { x: 1566, y: 390 }, { x: 1686, y: 390 },
    { x: 126, y: 540 }, { x: 246, y: 540 }, { x: 366, y: 540 }, { x: 486, y: 540 }, { x: 606, y: 540 }, { x: 726, y: 540 }, { x: 846, y: 540 }, { x: 966, y: 540 }, { x: 1086, y: 540 }, { x: 1206, y: 540 }, { x: 1326, y: 540 }, { x: 1446, y: 540 }, { x: 1566, y: 540 }, { x: 1688, y: 540 },
    { x: 246, y: 690 }, { x: 366, y: 690 }, { x: 486, y: 690 }, { x: 606, y: 690 }, { x: 726, y: 690 }, { x: 846, y: 690 }, { x: 966, y: 690 }, { x: 1086, y: 690 }, { x: 1206, y: 690 }, { x: 1326, y: 690 }, { x: 1446, y: 690 }, { x: 1566, y: 690 }
];

function syncControlUI(type, data) {
    const payload = { type: type, data: data };
    const ts = Date.now();
    const msgObj = { event: 'display-to-control', payload: payload, ts: ts };

    // Universal Multi-Transport Broadcast (Socket.IO + WebRTC + SSE + REST + BroadcastChannel)
    if (window.GameSync) {
        try { window.GameSync.send('display-to-control', payload); } catch(e){}
    }

    // 1. Post to Server API for cross-device sync (only if server confirmed available)
    if (isServerApiAvailable === true) {
        try {
            fetch(getApiUrl('api/broadcast'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(msgObj)
            }).catch(() => {});
        } catch(e) {}
    }

    // 2. Supabase Realtime (with robust send / retry for cross-browser sync)
    [channel, typeof activeRoomSupabaseChannel !== "undefined" ? activeRoomSupabaseChannel : null].forEach(ch => {
        if (ch) {
            try {
                if (ch.state === 'joined') {
                    ch.send({ type: 'broadcast', event: 'display-to-control', payload: payload });
                } else {
                    ch.send({ type: 'broadcast', event: 'display-to-control', payload: payload }).catch(() => {
                        setTimeout(() => { try { ch.send({ type: 'broadcast', event: 'display-to-control', payload: payload }); } catch(e){} }, 400);
                    });
                }
            } catch (e) {}
        }
    });

    // 3. Local BroadcastChannel
    if (localBC) {
        try {
            localBC.postMessage(msgObj);
        } catch (e) {}
    }
    if (typeof activeRoomLocalBC !== "undefined" && activeRoomLocalBC) {
        try {
            activeRoomLocalBC.postMessage(msgObj);
        } catch (e) {}
    }

    // 4. LocalStorage
    try {
        localStorage.setItem('display-to-control-msg', JSON.stringify(msgObj));
        if (typeof currentActiveRoomId !== "undefined" && currentActiveRoomId) {
            localStorage.setItem('display-to-control-msg_' + currentActiveRoomId, JSON.stringify(msgObj));
        }
    } catch(e) {}
}

function clearOldBoardElements() {
    const oldCells = board.querySelectorAll('.cell');
    oldCells.forEach(c => c.remove());
}

let boardTimeoutIds = [];
function clearAllBoardTimeouts() {
    boardTimeoutIds.forEach(id => clearTimeout(id));
    boardTimeoutIds = [];
    clearAllTossupTimeouts();
}

function clearAllTossupTimeouts() {
    tossupTimeoutIds.forEach(id => clearTimeout(id));
    tossupTimeoutIds = [];
}

function loadQuiz(quizPayload) {
    clearAllBoardTimeouts();
    hideAllLights(); 
    clearBuzzerHighlights();
    lastBuzzedPlayer = null;
    lastBuzzedTime = 0;

    const index = Number(quizPayload.index);
    const letters = quizPayload.letters;

    const prevIndex = currentQuizIndex;
    currentQuizIndex = index;
    updateBoardBackground();
    
    // Nhạc 30s sẽ KHÔNG dừng khi chuyển qua lại các ô con trong Vòng 30s (Đề 13 / Index 12)
    if (index !== 12) {
        stopRound30Music(true);
        tossupSound.currentTime = 0;
        tossupSound.volume = 1.0;
        clearAllTossupTimeouts(); 
        syncControlUI("UPDATE_CTRL_ACTIVE", null);

        // Ẩn hoàn toàn đồng hồ 30s và bộ đếm ô chữ khi chuyển sang đề khác
        const timerBadge = document.getElementById("round30TimerBadge");
        if (timerBadge) {
            timerBadge.style.display = "none";
            timerBadge.classList.remove("warning");
        }
        const subBadge = document.getElementById("round30SubBadge");
        if (subBadge) {
            subBadge.style.display = "none";
        }
    } else {
        clearAllTossupTimeouts();
        if (round30Sound.currentTime > 0) {
            playRound30Music();
        }
    }
    
    if (index !== 12) {
        tossupSound.load();
    }
    initAudioPermission();

    clearOldBoardElements();
    allCells = [];
    absoluteCells = new Array(52).fill(null);

    cells.forEach((p, i) => {
        const letter = letters[i];
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.style.left = p.x + "px";
        cell.style.top = p.y + "px";

        if (letter === "" || letter === " " || !letter) {
            cell.style.background = 'url("defaultbox.png") center center no-repeat';
            cell.style.backgroundSize = "100% 100%";
            cell.style.pointerEvents = "none";
            board.appendChild(cell);
            return;
        }

        cell.style.pointerEvents = "none";

        // Vòng 13 (Vòng 30s Liên Hoàn): BẮT BUỘC hiển thị khung trắng ngay lập tức cho tất cả các ô chữ sử dụng
        if (index === 12) {
            cell.style.background = 'url("obox.png") center center no-repeat';
            cell.style.backgroundSize = "100% 100%";
        }

        let cellObj = { element: cell, letter: letter, revealed: false, state: 0, absoluteIndex: i + 1 };
        allCells.push(cellObj);
        absoluteCells[i] = cellObj;
        board.appendChild(cell);
    });

    if (isWWFActiveForCurrentRound()) {
        calculateWWFBonuses(absoluteCells);
    }

    syncControlUI("UPDATE_QUIZ_ACTIVE", index);
    syncControlUI("FILL_POSITIONS", []);
    syncControlUI("RESET_ALPHABET", null);
}

function handleControlCommand(payload) {
    if (!payload) return;
    const type = payload.type || payload.action;
    const data = payload.data;
    if (!type) return;

    if (type === "UPDATE_SCOREBOARD") {
        if (data && data.p1 && document.getElementById("playerName1")) document.getElementById("playerName1").textContent = data.p1.name;
        if (data && data.p1 && document.getElementById("playerScore1")) {
            const score1 = Number(data.p1.score) || 0;
            document.getElementById("playerScore1").textContent = score1.toLocaleString('vi-VN');
        }
        
        if (data && data.p2 && document.getElementById("playerName2")) document.getElementById("playerName2").textContent = data.p2.name;
        if (data && data.p2 && document.getElementById("playerScore2")) {
            const score2 = Number(data.p2.score) || 0;
            document.getElementById("playerScore2").textContent = score2.toLocaleString('vi-VN');
        }
        
        if (data && data.p3 && document.getElementById("playerName3")) document.getElementById("playerName3").textContent = data.p3.name;
        if (data && data.p3 && document.getElementById("playerScore3")) {
            const score3 = Number(data.p3.score) || 0;
            document.getElementById("playerScore3").textContent = score3.toLocaleString('vi-VN');
        }
    }
    else if (type === "LOAD_QUIZ") {
        clearBuzzerHighlights();
        loadQuiz(data);
    }
    else if (type === "SHOW_MANUAL_TEXT") {
        clearBuzzerHighlights();
        hideAllLights(); 
        initAudioPermission();
        currentQuizIndex = -1;
        stopRound30Music(true);
        tossupSound.pause();
        tossupSound.currentTime = 0;
        tossupSound.volume = 1.0;
        clearAllTossupTimeouts();
        syncControlUI("UPDATE_CTRL_ACTIVE", null);

        const timerBadge = document.getElementById("round30TimerBadge");
        if (timerBadge) {
            timerBadge.style.display = "none";
            timerBadge.classList.remove("warning");
        }
        const subBadge = document.getElementById("round30SubBadge");
        if (subBadge) {
            subBadge.style.display = "none";
        }

        clearOldBoardElements();
        allCells = [];
        absoluteCells = new Array(52).fill(null);

        const lines = data;
        const rowConfigs = [
            { startIdx: 0, totalCells: 12 },  
            { startIdx: 12, totalCells: 14 }, 
            { startIdx: 26, totalCells: 14 }, 
            { startIdx: 40, totalCells: 12 }  
        ];

        let manualTextGrid = new Array(52).fill(null);
        let targetRowIndex = 1; 
        if (lines.length === 1) targetRowIndex = 1;
        else if (lines.length === 2) targetRowIndex = 1;
        else if (lines.length === 3) targetRowIndex = 0;
        else if (lines.length === 4) targetRowIndex = 0;

        lines.forEach((lineText, index) => {
            let currentRow = targetRowIndex + index;
            if (currentRow > 3) currentRow = 3; 

            let config = rowConfigs[currentRow];
            let offset = Math.floor((config.totalCells - lineText.length) / 2);
            if (offset < 0) offset = 0; 

            let activeStartIdx = config.startIdx + offset;
            for (let charPos = 0; charPos < lineText.length; charPos++) {
                let gridIndex = activeStartIdx + charPos;
                if (gridIndex < config.startIdx + config.totalCells) {
                    manualTextGrid[gridIndex] = lineText[charPos];
                }
            }
        });

        cells.forEach((p, i) => {
            const cell = document.createElement("div");
            cell.className = "cell cell-manual"; 
            cell.style.left = p.x + "px";
            cell.style.top = p.y + "px";
            cell.style.pointerEvents = "none";

            const charAtPos = manualTextGrid[i];
            if (charAtPos !== null) {
                if (charAtPos === " ") {
                    cell.style.background = 'url("defaultbox.png") center center no-repeat';
                    cell.style.backgroundSize = "100% 100%";
                } else {
                    cell.style.background = 'url("occhu.png") center center no-repeat';
                    cell.style.backgroundSize = "100% 100%";
                    cell.textContent = charAtPos;
                    let cellObj = { element: cell, letter: charAtPos, revealed: true, state: 2, absoluteIndex: i + 1 };
                    allCells.push(cellObj);
                    absoluteCells[i] = cellObj;
                }
            } else {
                cell.style.background = 'url("defaultbox.png") center center no-repeat';
                cell.style.backgroundSize = "100% 100%";
            }
            board.appendChild(cell);
        });

        showSound.currentTime = 0;
        showSound.play().catch(e => console.log(e));
        syncControlUI("UPDATE_QUIZ_ACTIVE", -1);
    }
    else if (type === "SHOW_THUMBNAIL") {
        const thumb = document.getElementById("programThumbnail");
        if (thumb) thumb.style.display = "block";
    }
    else if (type === "HIDE_THUMBNAIL") {
        const thumb = document.getElementById("programThumbnail");
        if (thumb) thumb.style.display = "none";
    }
    else if (type === "PLAY_SFX") {
        initAudioPermission();
        if (!isMuted && data) {
            const sfxAudio = new Audio(data);
            sfxAudio.volume = masterVolume;
            activeSFXList.push(sfxAudio);
            sfxAudio.play().catch(e => console.log(e));
            sfxAudio.onended = () => {
                activeSFXList = activeSFXList.filter(audio => audio !== sfxAudio);
                sfxAudio.remove();
            };
        }

        if (data === "wrong.mp3" || data === "FailBonus.mp3" || data === "FlashRed.mp3") {
            triggerRedLight();
        }
        else if (data === "FlashWhite.mp3") {
            triggerWhiteLight();
        }
        else if (data === "FlashGreen.mp3") {
            triggerGreenLight();
        }

        if (data === "FailBonus.mp3" && [9, 10, 11].includes(currentQuizIndex)) {
            allCells.forEach(item => {
                item.element.style.background = isWWFActiveForCurrentRound() ? 'url("obox_WWF.png") center center no-repeat' : 'url("obox.png") center center no-repeat';
                item.element.style.backgroundSize = "100% 100%";
                item.element.textContent = item.letter;
                item.revealed = true;
                item.state = 2;
            });
        }
    }
    else if (type === "SET_WWF_MODE") {
        const enabled = (data && (data.enabled !== undefined ? !!data.enabled : !!data)) || false;
        isWWFMode = enabled;
        try { localStorage.setItem('crossword_wwf_mode', isWWFMode ? '1' : '0'); } catch(e){}
        updateBoardBackground();
        
        if (allCells.length > 0) {
            const activeWWF = isWWFActiveForCurrentRound();
            if (activeWWF) {
                calculateWWFBonuses(absoluteCells);
            }
            allCells.forEach(item => {
                if (item.state === 1) {
                    item.element.style.background = 'url("highlight.png") center center no-repeat';
                } else if (item.state === 2 || item.revealed) {
                    item.element.style.background = activeWWF ? 'url("obox_WWF.png") center center no-repeat' : 'url("occhu.png") center center no-repeat';
                } else if (item.state === 0 && item.element.style.background && !item.element.style.background.includes('defaultbox.png')) {
                    item.element.style.background = activeWWF ? (item.wwfBg || 'url("defaultbox_WWF.png") center center no-repeat') : 'url("obox.png") center center no-repeat';
                }
                item.element.style.backgroundSize = "100% 100%";
            });
        }
    }
    else if (type === "STOP_ALL_SFX") {
        cancelDisplayBgmFade();
        tossupSound.pause(); showSound.pause(); revealSound.pause(); clearPuzzleSound.pause();
        tossupSound.currentTime = 0; showSound.currentTime = 0; revealSound.currentTime = 0; clearPuzzleSound.currentTime = 0;
        tossupSound.volume = masterVolume;
        if (currentDisplaySoundboardAudio) {
            try { currentDisplaySoundboardAudio.pause(); currentDisplaySoundboardAudio.currentTime = 0; currentDisplaySoundboardAudio.remove(); } catch(e){}
            currentDisplaySoundboardAudio = null;
        }
        activeSFXList.forEach(audio => { try { audio.pause(); audio.currentTime = 0; audio.remove(); } catch (e) {} });
        activeSFXList = [];
    }
    else if (type === "PLAY_SOUNDBOARD") {
        cancelDisplayBgmFade();
        initAudioPermission();
        if (currentDisplaySoundboardAudio) {
            try { currentDisplaySoundboardAudio.pause(); currentDisplaySoundboardAudio.currentTime = 0; currentDisplaySoundboardAudio.remove(); } catch(e){}
            currentDisplaySoundboardAudio = null;
        }
        const file = (data && data.file) ? data.file : (typeof data === 'string' ? data : null);
        if (!isMuted && file) {
            const sfxAudio = new Audio(file);
            sfxAudio.volume = masterVolume;
            currentDisplaySoundboardAudio = sfxAudio;
            activeSFXList.push(sfxAudio);
            sfxAudio.play().catch(e => console.log('[Display Soundboard] play error:', e));
            sfxAudio.onended = () => {
                if (currentDisplaySoundboardAudio === sfxAudio) currentDisplaySoundboardAudio = null;
                activeSFXList = activeSFXList.filter(audio => audio !== sfxAudio);
                sfxAudio.remove();
            };
            sfxAudio.onerror = (e) => {
                console.warn('[Display Soundboard] file error:', file);
                if (currentDisplaySoundboardAudio === sfxAudio) currentDisplaySoundboardAudio = null;
            };
        }
    }
    else if (type === "STOP_SOUNDBOARD") {
        cancelDisplayBgmFade();
        if (currentDisplaySoundboardAudio) {
            try { currentDisplaySoundboardAudio.pause(); currentDisplaySoundboardAudio.currentTime = 0; currentDisplaySoundboardAudio.remove(); } catch(e){}
            currentDisplaySoundboardAudio = null;
        }
    }
    else if (type === "SET_MASTER_VOLUME") {
        const vol = (data && typeof data.volume === 'number') ? data.volume : (typeof data === 'number' ? data : 1.0);
        masterVolume = Math.max(0, Math.min(1, vol));
        try { localStorage.setItem('system_master_volume', masterVolume.toString()); } catch(e){}
        if (!isMuted) {
            if (tossupSound) tossupSound.volume = masterVolume;
            if (round30Sound) round30Sound.volume = masterVolume;
            if (currentDisplaySoundboardAudio) currentDisplaySoundboardAudio.volume = masterVolume;
            activeSFXList.forEach(a => {
                try { a.volume = masterVolume; } catch(e){}
            });
        }
    }
    else if (type === "FADE_OUT_BGM") {
        const durationMs = (data && data.durationMs) ? data.durationMs : 2000;
        fadeAllBgm(durationMs);
    }
    else if (type === "GUESS_LETTER" || type === "CHOOSE_LETTER") {
        initAudioPermission();
        const guessedChar = (typeof data === "string" ? data : String(data)).toUpperCase();
        let matchPositions = [];
        absoluteCells.forEach(item => {
            if (item && cleanLetter(item.letter) === guessedChar && item.state === 0) matchPositions.push(item.absoluteIndex);
        });

        if (matchPositions.length === 0) {
            playWrong();
            triggerRedLight();
        }

        syncControlUI("FILL_POSITIONS", matchPositions);
    }
    else if (type === "GUESS_MULTI_LETTERS" || type === "CONFIRM_EXTRA_LETTERS") {
        initAudioPermission();
        const letterArray = Array.isArray(data) ? data : [data];
        const guessedChars = letterArray.map(c => removeVietnameseTones(String(c)).toUpperCase());
        let matchPositions = [];
        absoluteCells.forEach(item => {
            if (item && item.state === 0 && guessedChars.includes(cleanLetter(item.letter))) matchPositions.push(item.absoluteIndex);
        });

        if (matchPositions.length === 0) {
            playWrong();
            triggerRedLight();
        }

        syncControlUI("FILL_POSITIONS", matchPositions);
    }
    else if (type === "CLEAR_EXTRA_LETTERS") {
        syncControlUI("FILL_POSITIONS", []);
    }
    else if (type === "RESET_BOARD") {
        clearBuzzerHighlights();
        hideAllLights(); 
        if (currentQuizIndex !== 12) {
            const timerBadge = document.getElementById("round30TimerBadge");
            if (timerBadge) {
                timerBadge.style.display = "none";
                timerBadge.classList.remove("warning");
            }
            const subBadge = document.getElementById("round30SubBadge");
            if (subBadge) {
                subBadge.style.display = "none";
            }
        }
        const allDomCells = document.querySelectorAll('.cell');
        allDomCells.forEach(cell => {
            cell.style.background = 'url("defaultbox.png") center center no-repeat';
            cell.style.backgroundSize = "100% 100%";
            cell.textContent = "";
        });
        allCells.forEach(item => { item.revealed = false; item.state = 0; });
        clearAllBoardTimeouts();
        syncControlUI("FILL_POSITIONS", []);
        syncControlUI("RESET_ALPHABET", null);
    }
    else if (type === "MARK_SEQ") {
        initAudioPermission();
        let delay = 0;
        const seq = Array.isArray(data) ? data : [];
        seq.forEach(pos => {
            const tid = setTimeout(() => {
                let item = absoluteCells[pos - 1];
                if (item && item.state === 0) {
                    item.element.style.background = 'url("highlight.png") center center no-repeat';
                    item.element.style.backgroundSize = "100% 100%";
                    item.element.textContent = "";
                    item.state = 1;
                    playDing();
                }
            }, delay);
            boardTimeoutIds.push(tid);
            delay += 1000;
        });
    }
    else if (type === "REVEAL_SEQ") {
        initAudioPermission();
        let delay = 0;
        const seq = Array.isArray(data) ? data : [];
        seq.forEach(pos => {
            const tid = setTimeout(() => {
                let item = absoluteCells[pos - 1];
                if (item && (item.state === 1 || item.state === 0)) {
                    item.element.style.background = isWWFActiveForCurrentRound() ? 'url("obox_WWF.png") center center no-repeat' : 'url("occhu.png") center center no-repeat';
                    item.element.style.backgroundSize = "100% 100%";
                    const cleanChar = removeVietnameseTones(item.letter).replace("_", "").toUpperCase();
                    item.element.innerHTML = `<span class="letter-char letter-reveal-animation">${cleanChar}</span>`;
                    item.revealed = true;
                    item.state = 2;
                    playSecondDing();
                    const animTid = setTimeout(() => {
                        const span = item.element.querySelector('.letter-char');
                        if (span) span.classList.remove('letter-reveal-animation');
                    }, 550);
                    boardTimeoutIds.push(animTid);
                }
            }, delay);
            boardTimeoutIds.push(tid);
            delay += 1000;
        });
    }
    else if (type === "START_TOSSUP") {
        clearBuzzerHighlights();
        initAudioPermission();
        clearAllTossupTimeouts();
        syncControlUI("UPDATE_CTRL_ACTIVE", "startBtn");
        allCells.forEach(item => {
            item.element.style.background = isWWFActiveForCurrentRound() ? (item.wwfBg || 'url("defaultbox_WWF.png") center center no-repeat') : 'url("obox.png") center center no-repeat';
            item.element.style.backgroundSize = "100% 100%";
            item.element.textContent = "";
            item.revealed = false;
            item.state = 0;
        });
        if (currentQuizIndex === 12) {
            tossupSound.pause();
            tossupSound.currentTime = 0;
            if (round30Sound.paused) {
                round30Sound.currentTime = 0;
                playRound30Music();
            }
        } else {
            stopRound30Music(true);
            tossupSound.currentTime = 0;
            playTossupMusic();
        }
    }
    else if (type === "START_ROUND30") {
        clearBuzzerHighlights();
        initAudioPermission();
        clearAllTossupTimeouts();
        allCells.forEach(item => {
            item.element.style.background = isWWFActiveForCurrentRound() ? 'url("obox_WWF.png") center center no-repeat' : 'url("obox.png") center center no-repeat';
            item.element.style.backgroundSize = "100% 100%";
            item.element.textContent = "";
            item.revealed = false;
            item.state = 0;
        });
        tossupSound.pause();
        tossupSound.currentTime = 0;
        if (round30Sound.paused || round30Sound.currentTime === 0) {
            round30Sound.currentTime = 0;
            playRound30Music();
        }
    }
    else if (type === "RESET_ROUND30_GRID") {
        clearBuzzerHighlights();
        clearAllTossupTimeouts();
        allCells.forEach(item => {
            item.element.style.background = isWWFActiveForCurrentRound() ? 'url("obox_WWF.png") center center no-repeat' : 'url("obox.png") center center no-repeat';
            item.element.style.backgroundSize = "100% 100%";
            item.element.textContent = "";
            item.revealed = false;
            item.state = 0;
        });
    }
    else if (type === "STOP_ROUND30_MUSIC") {
        stopRound30Music(true);
    }
    else if (type === "PAUSE_ROUND30_MUSIC") {
        stopRound30Music(false);
    }
    else if (type === "RESUME_ROUND30_MUSIC") {
        playRound30Music();
    }
    else if (type === "REVEAL_CELL" || type === "TOSSUP_REVEAL_CELL") {
        let itemsToReveal = [];
        if (Array.isArray(data)) {
            data.forEach(d => {
                let idx = -1;
                let withSound = true;
                if (typeof d === "number") idx = d;
                else if (typeof d === "object" && d !== null) {
                    if (d.absoluteIndex !== undefined) idx = d.absoluteIndex - 1;
                    else if (d.index !== undefined) idx = d.index;
                    if (d.playSound !== undefined) withSound = !!d.playSound;
                }
                if (idx >= 0 && idx < 52) itemsToReveal.push({ idx, withSound });
            });
        } else {
            let idx = -1;
            let withSound = true;
            if (typeof data === "number") {
                idx = data;
            } else if (typeof data === "object" && data !== null) {
                if (data.absoluteIndex !== undefined) idx = data.absoluteIndex - 1;
                else if (data.index !== undefined) idx = data.index;
                if (data.playSound !== undefined) withSound = !!data.playSound;
            }
            if (idx >= 0 && idx < 52) itemsToReveal.push({ idx, withSound });
        }

        itemsToReveal.forEach(({ idx, withSound }) => {
            const targetItem = absoluteCells[idx];
            if (targetItem && !targetItem.revealed) {
                targetItem.element.style.background = isWWFActiveForCurrentRound() ? 'url("obox_WWF.png") center center no-repeat' : 'url("occhu.png") center center no-repeat';
                targetItem.element.style.backgroundSize = "100% 100%";
                const cleanChar = removeVietnameseTones(targetItem.letter).replace("_", "").toUpperCase();
                targetItem.element.innerHTML = `<span class="letter-char letter-reveal-animation">${cleanChar}</span>`;
                targetItem.revealed = true;
                targetItem.state = 2;
                if (withSound) {
                    initAudioPermission();
                    playSecondDing();
                }
                setTimeout(() => {
                    const span = targetItem.element.querySelector('.letter-char');
                    if (span) span.classList.remove('letter-reveal-animation');
                }, 550);
            }
        });
    }
    else if (type === "MARK_CELL") {
        let idx = -1;
        if (typeof data === "number") idx = data;
        else if (typeof data === "object" && data !== null) {
            if (data.absoluteIndex !== undefined) idx = data.absoluteIndex - 1;
            else if (data.index !== undefined) idx = data.index;
        }
        if (idx >= 0 && idx < 52) {
            const item = absoluteCells[idx];
            if (item && !item.revealed) {
                initAudioPermission();
                item.element.style.background = 'url("highlight.png") center center no-repeat';
                item.element.style.backgroundSize = "100% 100%";
                item.element.textContent = "";
                item.state = 1;
                playDing();
            }
        }
    }
    else if (type === "HIDE_CELL") {
        let idx = -1;
        if (typeof data === "number") idx = data;
        else if (typeof data === "object" && data !== null) {
            if (data.absoluteIndex !== undefined) idx = data.absoluteIndex - 1;
            else if (data.index !== undefined) idx = data.index;
        }
        if (idx >= 0 && idx < 52) {
            const item = absoluteCells[idx];
            if (item) {
                item.element.style.background = isWWFActiveForCurrentRound() ? (item.wwfBg || 'url("defaultbox_WWF.png") center center no-repeat') : 'url("obox.png") center center no-repeat';
                item.element.style.backgroundSize = "100% 100%";
                item.element.textContent = "";
                item.revealed = false;
                item.state = 0;
            }
        }
    }
    else if (type === "PAUSE_TOSSUP") {
        syncControlUI("UPDATE_CTRL_ACTIVE", "pauseBtn");
        clearAllTossupTimeouts(); 
    }
    else if (type === "PLAY_TOSSUP") {
        clearBuzzerHighlights();
        initAudioPermission();
        syncControlUI("UPDATE_CTRL_ACTIVE", "playBtn");
        if (currentQuizIndex === 12) {
            playRound30Music();
        } else {
            playTossupMusic(); 
        }
    }
    else if (type === "STOP_TOSSUP_MUSIC") {
        clearAllTossupTimeouts();
        syncControlUI("UPDATE_CTRL_ACTIVE", null);
        fadeOutTossupMusic(300, true);
    }
    else if (type === "SOLVE_TOSSUP") {
        clearAllBoardTimeouts();
        fadeOutTossupMusic(200, true);
        syncControlUI("UPDATE_CTRL_ACTIVE", null);
        initAudioPermission();
        lettersSolvedSound.currentTime = 0;
        lettersSolvedSound.play().catch(e => console.log(e));
        if (lightGreen) {
            lightGreen.style.display = "block";
        }
        allCells.forEach(item => {
            if (item) {
                item.element.style.background = isWWFActiveForCurrentRound() ? 'url("obox_WWF.png") center center no-repeat' : 'url("obox.png") center center no-repeat';
                item.element.style.backgroundSize = "100% 100%";
                item.element.textContent = item.letter;
                item.revealed = true;
                item.state = 2;
            }
        });
    }
    else if (type === "SHOW_BOARD") {
        hideAllLights(); 
        initAudioPermission();
        showSound.currentTime = 0;
        showSound.play().catch(e => console.log(e));

        if (lightWhite) {
            lightWhite.style.display = "block";
            setTimeout(() => {
                lightWhite.style.display = "none";
            }, 1000); 
        }

        allCells.forEach((item, index) => {
            const tid = setTimeout(() => {
                if (isWWFActiveForCurrentRound()) {
                    item.element.style.background = item.wwfBg || 'url("defaultbox_WWF.png") center center no-repeat';
                } else {
                    item.element.style.background = 'url("obox.png") center center no-repeat';
                }
                item.element.style.backgroundSize = "100% 100%";
                item.element.textContent = "";
                item.revealed = false;
                item.state = 0;
            }, index * 10);
            boardTimeoutIds.push(tid);
        });
    }
    else if (type === "REVEAL_ALL") {
        if (currentQuizIndex !== 12) {
            fadeOutTossupMusic(200, true);
        }
        clearAllTossupTimeouts();
        syncControlUI("UPDATE_CTRL_ACTIVE", null);
        initAudioPermission();
        lettersSolvedSound.currentTime = 0;
        lettersSolvedSound.play().catch(e => console.log(e));

        if (lightGreen) {
            lightGreen.style.display = "block";
        }

        allCells.forEach(item => {
            item.element.style.background = isWWFActiveForCurrentRound() ? 'url("obox_WWF.png") center center no-repeat' : 'url("obox.png") center center no-repeat';
            item.element.style.backgroundSize = "100% 100%";
            item.element.textContent = item.letter;
            item.revealed = true;
            item.state = 2;
        });
    }
    else if (type === "PLAY_TIMER") {
        initAudioPermission();
        playTimerSound(data);
    }
    else if (type === "UPDATE_ROUND30_TIMER") {
        const timerBadge = document.getElementById("round30TimerBadge");
        const timerVal = document.getElementById("round30Val");
        const subBadge = document.getElementById("round30SubBadge");
        const subText = document.getElementById("round30SubIndexText");

        const shouldShow = !!(data && data.visible && currentQuizIndex === 12);

        if (timerBadge && timerVal) {
            if (shouldShow) {
                timerBadge.style.display = "flex";
                timerVal.textContent = (data.seconds !== undefined) ? data.seconds : "30";
                if (data.seconds <= 5 && data.seconds > 0) {
                    timerBadge.classList.add("warning");
                } else {
                    timerBadge.classList.remove("warning");
                }
            } else {
                timerBadge.style.display = "none";
                timerBadge.classList.remove("warning");
            }
        }
        if (subBadge && subText) {
            if (shouldShow && data.subTitle) {
                subBadge.style.display = "flex";
                subText.textContent = data.subTitle;
            } else {
                subBadge.style.display = "none";
            }
        }
    }
    else if (type === "PLAYER_BUZZ_WIN") {
        if (data && data.playerNum) {
            handlePlayerBuzz(data.playerNum);
        }
    }
}

let lastProcessedControlTs = 0;
const processedControlMsgIds = new Set();

function handleControlCommandWrapper(payload, ts, msgId) {
    if (!payload) return;
    const type = payload.type || payload.action;
    if (!type) return;

    // Normalizing type/action
    payload.type = type;
    payload.action = type;

    const id = msgId || payload.msgId || payload.id;
    if (id && processedControlMsgIds.has(id)) {
        return;
    }
    if (id) {
        processedControlMsgIds.add(id);
        if (processedControlMsgIds.size > 300) {
            const first = processedControlMsgIds.values().next().value;
            processedControlMsgIds.delete(first);
        }
    }
    handleControlCommand(payload);
}

function clearBuzzerHighlights() {
    document.querySelectorAll('.player-box').forEach(box => box.classList.remove('buzzed-active'));
    try {
        localStorage.removeItem('tossup-buzzer-winner');
    } catch(e){}
}

let lastBuzzedPlayer = null;
let lastBuzzedTime = 0;

function handlePlayerBuzz(playerNum) {
    if (!playerNum) return;
    const now = Date.now();
    if (now - lastBuzzedTime < 800 && lastBuzzedPlayer === playerNum) {
        return; // prevent duplicate buzz trigger
    }
    lastBuzzedTime = now;
    lastBuzzedPlayer = playerNum;

    clearAllTossupTimeouts();
    // Ở các vòng đoán nhanh & vòng 30s, nhạc nền tiếp tục phát khi người chơi bấm chuông cho đến khi mở toàn bộ ô chữ
    document.querySelectorAll('.player-box').forEach(box => box.classList.remove('buzzed-active'));
    const pBox = document.querySelector(`.player-box.player-${playerNum}`);
    if (pBox) {
        pBox.classList.add('buzzed-active');
    }
    // Play instant ding with zero latency audio pool
    if (!isMuted) {
        playFastSound("ding.mp3");
    }
}

let currentActiveRoomId = (typeof urlParams !== "undefined" && urlParams.get('roomid')) || localStorage.getItem('crossword_control_roomid') || '123456';
let activeRoomSupabaseChannel = null;
let activeRoomLocalBC = null;
let activeRoomInterval = null;

if (currentActiveRoomId) {
    setupActiveRoomSync(currentActiveRoomId);
}

function setupActiveRoomSync(roomId) {
    if (!roomId) return;
    if (currentActiveRoomId === roomId && activeRoomLocalBC) return;
    console.log("Setting up active room sync for Room ID:", roomId);
    currentActiveRoomId = roomId;

    // Clean up old channels/intervals if any
    if (activeRoomSupabaseChannel) {
        try { activeRoomSupabaseChannel.unsubscribe(); } catch(e){}
        activeRoomSupabaseChannel = null;
    }
    if (activeRoomLocalBC) {
        try { activeRoomLocalBC.close(); } catch(e){}
        activeRoomLocalBC = null;
    }
    if (activeRoomInterval) {
        clearInterval(activeRoomInterval);
        activeRoomInterval = null;
    }

    // Universal Multi-Transport Bridge (Socket.IO + WebRTC + SSE + BroadcastChannel)
    if (window.GameSync) {
        window.GameSync.init({
            role: 'display',
            roomId: roomId,
            onMessage: (msg) => {
                if (msg.event === 'control-to-display' && msg.payload) {
                    handleControlCommandWrapper(msg.payload, msg.ts, msg.msgId);
                } else if (msg.event === 'player-buzz' && msg.payload && msg.payload.playerNum) {
                    handlePlayerBuzz(msg.payload.playerNum);
                }
            }
        });
    }

    // Re-bind SSE to active room
    if (typeof setupDisplaySSE === "function") {
        setupDisplaySSE();
    }

    // 1. Supabase Realtime for specific active room
    if (supabaseClient && roomId) {
        try {
            const channelName = 'crossword_broadcast_room_' + roomId;
            activeRoomSupabaseChannel = supabaseClient.channel(channelName, {
                config: { broadcast: { ack: false, self: true } }
            });
            activeRoomSupabaseChannel.on('broadcast', { event: 'control-to-display' }, ({ payload }) => {
                handleControlCommandWrapper(payload, payload ? payload.ts : null, payload ? payload.msgId : null);
            });
            activeRoomSupabaseChannel.on('broadcast', { event: 'player-buzz' }, ({ payload }) => {
                if (payload && payload.playerNum) {
                    handlePlayerBuzz(payload.playerNum);
                }
            });
            activeRoomSupabaseChannel.subscribe();
            console.log("Subscribed to Supabase active room channel:", channelName);
        } catch(e) {
            console.warn("Error subscribing to Supabase active room:", e);
        }
    }

    // 2. Local BroadcastChannel for specific active room
    if (typeof BroadcastChannel !== "undefined" && roomId) {
        try {
            const channelName = 'crossword_broadcast_room_' + roomId;
            activeRoomLocalBC = new BroadcastChannel(channelName);
            activeRoomLocalBC.onmessage = (event) => {
                if (event.data) {
                    if (event.data.event === 'control-to-display') {
                        handleControlCommandWrapper(event.data.payload, event.data.ts || (event.data.payload ? event.data.payload.ts : null), event.data.msgId || (event.data.payload ? event.data.payload.msgId : null));
                    } else if (event.data.event === 'player-buzz' && event.data.payload) {
                        handlePlayerBuzz(event.data.payload.playerNum);
                    }
                }
            };
            console.log("Connected to local BroadcastChannel for active room:", channelName);
        } catch(e) {
            console.warn("Error creating local BroadcastChannel for active room:", e);
        }
    }

    // 3. LocalStorage Interval check for specific active room
    if (roomId) {
        activeRoomInterval = setInterval(() => {
            try {
                const raw = localStorage.getItem('control-to-display-msg_' + roomId);
                if (raw) {
                    const data = JSON.parse(raw);
                    if (data && data.payload && data.ts && data.ts > lastProcessedControlTs) {
                        handleControlCommandWrapper(data.payload, data.ts, data.msgId);
                    }
                }
            } catch (err) {}
        }, 100);
    }
}

// 1. Supabase Realtime Listener (Global fallback)
if (channel) {
    try {
        channel.on('broadcast', { event: 'control-to-display' }, ({ payload }) => {
            handleControlCommandWrapper(payload, payload ? payload.ts : null, payload ? payload.msgId : null);
        });
        channel.on('broadcast', { event: 'player-buzz' }, ({ payload }) => {
            if (payload && payload.playerNum) {
                handlePlayerBuzz(payload.playerNum);
            }
        });
        channel.subscribe();
    } catch (e) {}
}

// 2. Server-Sent Events (SSE) Listener for cross-device sync
let displaySSE = null;
let displaySSEReconnectTimer = null;
let displaySSEFailCount = 0;
function setupDisplaySSE() {
    if (typeof EventSource === "undefined" || isServerApiAvailable !== true) return;
    if (displaySSE) {
        try { displaySSE.close(); } catch(e) {}
        displaySSE = null;
    }
    if (displaySSEFailCount > 2) return;
    const sseUrl = getApiUrl(currentActiveRoomId ? ('api/events?roomid=' + encodeURIComponent(currentActiveRoomId)) : 'api/events');
    try {
        displaySSE = new EventSource(sseUrl);
        displaySSE.onopen = () => {
            displaySSEFailCount = 0;
        };
        displaySSE.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (!msg) return;
                if (msg.event === 'control-to-display' && msg.payload) {
                    handleControlCommandWrapper(msg.payload, msg.ts || (msg.payload ? msg.payload.ts : null), msg.msgId || (msg.payload ? msg.payload.msgId : null));
                } else if (msg.event === 'player-buzz' && msg.payload && msg.payload.playerNum) {
                    handlePlayerBuzz(msg.payload.playerNum);
                } else if (msg.event === 'active-room-changed' && msg.activeRoomId) {
                    setupActiveRoomSync(msg.activeRoomId);
                }
            } catch(err){}
        };
        displaySSE.onerror = () => {
            try { displaySSE.close(); } catch(e) {}
            displaySSE = null;
            displaySSEFailCount++;
            isServerApiAvailable = false;
        };
    } catch(e) {}
}

// Fallback HTTP polling for buzzer events on display only if API is verified available
let lastProcessedServerBuzzTs = 0;
let displayPollFails = 0;
setInterval(() => {
    const rid = currentActiveRoomId || 'default';
    if (isServerApiAvailable !== true) return;
    fetch(getApiUrl('api/get-room-state?roomid=' + encodeURIComponent(rid)))
        .then(r => {
            if (!r.ok) {
                isServerApiAvailable = false;
                return null;
            }
            return r.json();
        })
        .then(data => {
            if (data && data.latestWinner && data.latestBuzzTs) {
                if (data.latestBuzzTs > lastProcessedServerBuzzTs) {
                    lastProcessedServerBuzzTs = data.latestBuzzTs;
                    handlePlayerBuzz(data.latestWinner);
                }
            }
        })
        .catch(() => {
            isServerApiAvailable = false;
        });
}, 1500);

// 3. Local BroadcastChannel (Global fallback)
if (localBC) {
    localBC.onmessage = (event) => {
        if (event.data) {
            if (event.data.event === 'control-to-display') {
                handleControlCommandWrapper(event.data.payload, event.data.ts || (event.data.payload ? event.data.payload.ts : null), event.data.msgId || (event.data.payload ? event.data.payload.msgId : null));
            } else if (event.data.event === 'player-buzz' && event.data.payload) {
                handlePlayerBuzz(event.data.payload.playerNum);
            }
        }
    };
}

window.addEventListener('message', (event) => {
    if (event.data) {
        if (event.data.event === 'control-to-display') {
            handleControlCommandWrapper(event.data.payload, event.data.ts || (event.data.payload ? event.data.payload.ts : null), event.data.msgId || (event.data.payload ? event.data.payload.msgId : null));
        } else if (event.data.event === 'player-buzz' && event.data.payload) {
            handlePlayerBuzz(event.data.payload.playerNum);
        }
    }
});

window.addEventListener('storage', (e) => {
    if (e.key === 'control-to-display-msg' && e.newValue) {
        try {
            const data = JSON.parse(e.newValue);
            if (data && data.payload) {
                handleControlCommandWrapper(data.payload, data.ts, data.msgId);
            }
        } catch (err) {}
    }
    if (e.key === 'player-buzz-msg' && e.newValue) {
        try {
            const data = JSON.parse(e.newValue);
            if (data && data.payload && data.payload.playerNum) {
                handlePlayerBuzz(data.payload.playerNum);
            }
        } catch (err) {}
    }
    if (currentActiveRoomId) {
        if (e.key === 'control-to-display-msg_' + currentActiveRoomId && e.newValue) {
            try {
                const data = JSON.parse(e.newValue);
                if (data && data.payload) {
                    handleControlCommandWrapper(data.payload, data.ts, data.msgId);
                }
            } catch (err) {}
        }
        if (e.key === 'player-buzz-msg_' + currentActiveRoomId && e.newValue) {
            try {
                const data = JSON.parse(e.newValue);
                if (data && data.payload && data.payload.playerNum) {
                    handlePlayerBuzz(data.payload.playerNum);
                }
            } catch (err) {}
        }
    }
});

setInterval(() => {
    try {
        const raw = localStorage.getItem('control-to-display-msg');
        if (raw) {
            const data = JSON.parse(raw);
            if (data && data.payload && data.ts && data.ts > lastProcessedControlTs) {
                handleControlCommandWrapper(data.payload, data.ts, data.msgId);
            }
        }
    } catch (err) {}
}, 100);

function initEmptyBoard() {
    if (allCells.length > 0) return;
    clearOldBoardElements();
    allCells = [];
    absoluteCells = new Array(52).fill(null);
    cells.forEach((p, i) => {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.style.left = p.x + "px";
        cell.style.top = p.y + "px";
        cell.style.background = 'url("defaultbox.png") center center no-repeat';
        cell.style.backgroundSize = "100% 100%";
        cell.style.pointerEvents = "none";
        board.appendChild(cell);
    });
}
window.addEventListener('DOMContentLoaded', initEmptyBoard);
setTimeout(initEmptyBoard, 50);

// Startup check to load active room ID if API server is available
function checkActiveRoomDisplay() {
    if (isServerApiAvailable !== true) return;
    fetch(getApiUrl('api/get-active-room'))
        .then(res => {
            if (!res.ok) {
                isServerApiAvailable = false;
                return null;
            }
            return res.json();
        })
        .then(data => {
            if (data && data.activeRoomId) {
                if (currentActiveRoomId !== data.activeRoomId) {
                    setupActiveRoomSync(data.activeRoomId);
                }
            }
        })
        .catch(() => {
            isServerApiAvailable = false;
        });
}
if (isServerApiAvailable === true) {
    checkActiveRoomDisplay();
}
setInterval(checkActiveRoomDisplay, 5000);