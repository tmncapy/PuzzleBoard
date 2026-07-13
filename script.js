// script.js
const globalFavicon = document.createElement('link');
globalFavicon.rel = 'icon';
globalFavicon.type = 'image/x-icon';
globalFavicon.href = 'favicon.ico';
document.head.appendChild(globalFavicon);

// --- KHỞI TẠO ĐỐI TƯỢNG ĐỒNG BỘ SUPABASE ---
var SUPABASE_URL = window.SUPABASE_URL || "https://tukabyhjmcyptuwmwedp.supabase.co";
var SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1a2FieWhqbWN5cHR1d213ZWRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0NDk3NDksImV4cCI6MjA5NjAyNTc0OX0.gNWdvZ_hRdon_w_KL3C3eXFFiV_EoA4eLgikcYb6dpQ";

if (SUPABASE_URL && !SUPABASE_URL.startsWith("http://") && !SUPABASE_URL.startsWith("https://")) {
    SUPABASE_URL = "https://" + SUPABASE_URL;
}

var supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const channel = supabaseClient.channel('crossword_broadcast_room', {
    config: { broadcast: { ack: false, self: false } }
});
channel.subscribe();

const board = document.getElementById("board");

// Khởi tạo các đối tượng âm thanh hệ thống chính
const showSound = new Audio("reveal.mp3");
const revealSound = new Audio("ClearTossUp.mp3");
const clearPuzzleSound = new Audio("ClearPuzzle.mp3");
const tossupSound = new Audio("tossup.mp3");
tossupSound.loop = true;

// Lấy tham chiếu tới các đèn hiệu ứng overlay
const lightWhite = document.getElementById("light-white");
const lightGreen = document.getElementById("light-green");
const lightRed = document.getElementById("light-red");

let activeSFXList = [];
let tossupTimeoutIds = [];
let allCells = [];
let absoluteCells = new Array(52).fill(null);
let currentQuizIndex = -1;

function initAudioPermission() {
    showSound.load(); revealSound.load(); clearPuzzleSound.load(); tossupSound.load();
}

function playDing(){
    const audio = new Audio("ding.mp3");
    audio.play().then(() => { audio.onended = () => { audio.remove(); }; }).catch(e => console.log(e));
}

function playSecondDing(){
    const audio = new Audio("2nd_ding.wav");
    audio.play().then(() => { audio.onended = () => { audio.remove(); }; }).catch(e => console.log(e));
}

// Sửa hàm phát tiếng đoán sai để quản lý vòng đời audio tốt hơn
function playWrong() {
    initAudioPermission();
    const audio = new Audio("wrong.mp3");
    audio.play().then(() => { 
        audio.onended = () => { audio.remove(); }; 
    }).catch(e => console.log(e));
}

function playTimerSound(seconds) {
    const filename = seconds === 30 ? "30s.mp3" : "10s.mp3";
    const audio = new Audio(filename);
    audio.play().catch(e => console.log(e));
}

function playTossupMusic() {
    tossupSound.volume = 1.0; 
    let playPromise = tossupSound.play();
    if (playPromise !== undefined) {
        playPromise.catch(() => {
            document.body.addEventListener('click', function memoPlay() {
                tossupSound.play();
                document.body.removeEventListener('click', memoPlay);
            }, { once: true });
        });
    }
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
        "ố": "ô", "ồ": "ô", "ổ": "ô", "ỗ": "ô", "ộ": "ô", "Ố": "Ô", "Ồ": "Ô", "Ổ": "Ô", "Ễ": "Ô", "Ộ": "Ô",
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
    channel.send({ type: 'broadcast', event: 'display-to-control', payload: { type: type, data: data } });
}

function clearOldBoardElements() {
    const oldCells = board.querySelectorAll('.cell');
    oldCells.forEach(c => c.remove());
}

function clearAllTossupTimeouts() {
    tossupTimeoutIds.forEach(id => clearTimeout(id));
    tossupTimeoutIds = [];
}

function loadQuiz(quizPayload) {
    hideAllLights(); 

    const index = quizPayload.index;
    const letters = quizPayload.letters;

    currentQuizIndex = index;
    tossupSound.load();
    initAudioPermission();

    tossupSound.currentTime = 0;
    tossupSound.volume = 1.0;
    clearAllTossupTimeouts(); 
    syncControlUI("UPDATE_CTRL_ACTIVE", null);

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

        let cellObj = { element: cell, letter: letter, revealed: false, state: 0, absoluteIndex: i + 1 };
        allCells.push(cellObj);
        absoluteCells[i] = cellObj;
        board.appendChild(cell);
    });

    syncControlUI("UPDATE_QUIZ_ACTIVE", index);
}

channel.on('broadcast', { event: 'control-to-display' }, ({ payload }) => {
    const { type, data } = payload;

    if (type === "UPDATE_SCOREBOARD") {
        if (document.getElementById("playerName1")) document.getElementById("playerName1").textContent = data.p1.name;
        if (document.getElementById("playerScore1")) {
            const score1 = Number(data.p1.score) || 0;
            document.getElementById("playerScore1").textContent = score1.toLocaleString('vi-VN');
        }
        
        if (document.getElementById("playerName2")) document.getElementById("playerName2").textContent = data.p2.name;
        if (document.getElementById("playerScore2")) {
            const score2 = Number(data.p2.score) || 0;
            document.getElementById("playerScore2").textContent = score2.toLocaleString('vi-VN');
        }
        
        if (document.getElementById("playerName3")) document.getElementById("playerName3").textContent = data.p3.name;
        if (document.getElementById("playerScore3")) {
            const score3 = Number(data.p3.score) || 0;
            document.getElementById("playerScore3").textContent = score3.toLocaleString('vi-VN');
        }
    }
    else if (type === "LOAD_QUIZ") {
        loadQuiz(data);
    }
    else if (type === "SHOW_MANUAL_TEXT") {
        hideAllLights(); 
        initAudioPermission();
        tossupSound.pause();
        tossupSound.currentTime = 0;
        tossupSound.volume = 1.0;
        clearAllTossupTimeouts();
        syncControlUI("UPDATE_CTRL_ACTIVE", null);

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
        const sfxAudio = new Audio(data);
        activeSFXList.push(sfxAudio);
        sfxAudio.play().catch(e => console.log(e));
        sfxAudio.onended = () => {
            activeSFXList = activeSFXList.filter(audio => audio !== sfxAudio);
            sfxAudio.remove();
        };

        if (data === "wrong.mp3" || data === "FailBonus.mp3" || data === "FlashRed.mp3") {
            triggerRedLight();
        }
        else if (data === "FlashWhite.mp3") {
            triggerWhiteLight();
        }
        else if (data === "FlashGreen.mp3") {
            triggerGreenLight();
        }

        // KHI GIẢI SAI Ô CHỮ BONUS Ở ĐỀ 10, 11, 12 (Index tương ứng 9, 10, 11) -> HIỆN TOÀN BỘ Ô CHỮ
        if (data === "FailBonus.mp3" && [9, 10, 11].includes(currentQuizIndex)) {
            allCells.forEach(item => {
                item.element.style.background = 'url("obox.png") center center no-repeat';
                item.element.style.backgroundSize = "100% 100%";
                item.element.textContent = item.letter;
                item.revealed = true;
                item.state = 2;
            });
        }
    }
    else if (type === "STOP_ALL_SFX") {
        tossupSound.pause(); showSound.pause(); revealSound.pause(); clearPuzzleSound.pause();
        tossupSound.currentTime = 0; showSound.currentTime = 0; revealSound.currentTime = 0; clearPuzzleSound.currentTime = 0;
        tossupSound.volume = 1.0;
        activeSFXList.forEach(audio => { try { audio.pause(); audio.currentTime = 0; audio.remove(); } catch (e) {} });
        activeSFXList = [];
    }
    else if (type === "GUESS_LETTER") {
        initAudioPermission();
        const guessedChar = data.toUpperCase();
        let matchPositions = [];
        absoluteCells.forEach(item => {
            if (item && cleanLetter(item.letter) === guessedChar && item.state === 0) matchPositions.push(item.absoluteIndex);
        });

        // SỬA LỖI: Phát ngay âm thanh wrong.mp3 và nháy đèn đỏ nếu không có chữ nào khớp trên bảng
        if (matchPositions.length === 0) {
            playWrong();
            triggerRedLight();
        }

        syncControlUI("FILL_POSITIONS", matchPositions);
    }
    else if (type === "GUESS_MULTI_LETTERS") {
        initAudioPermission();
        const guessedChars = data.map(c => removeVietnameseTones(c).toUpperCase());
        let matchPositions = [];
        absoluteCells.forEach(item => {
            if (item && item.state === 0 && guessedChars.includes(cleanLetter(item.letter))) matchPositions.push(item.absoluteIndex);
        });

        // SỬA LỖI: Phát tiếng wrong.mp3 và nháy đèn đỏ nếu chuỗi ký tự đoán không có ký tự nào trùng khớp
        if (matchPositions.length === 0) {
            playWrong();
            triggerRedLight();
        }

        syncControlUI("FILL_POSITIONS", matchPositions);
    }
    else if (type === "RESET_BOARD") {
        hideAllLights(); 
        const allDomCells = document.querySelectorAll('.cell');
        allDomCells.forEach(cell => {
            cell.style.background = 'url("defaultbox.png") center center no-repeat';
            cell.style.backgroundSize = "100% 100%";
            cell.textContent = "";
        });
        allCells.forEach(item => { item.revealed = false; item.state = 0; });
        clearAllTossupTimeouts();
    }
    else if (type === "MARK_SEQ") {
        initAudioPermission();
        let delay = 0;
        data.forEach(pos => {
            setTimeout(() => {
                let item = absoluteCells[pos - 1];
                if (item && item.state === 0) {
                    item.element.style.background = 'url("choosebox.png") center center no-repeat';
                    item.element.style.backgroundSize = "100% 100%";
                    item.state = 1;
                    playDing();
                }
            }, delay);
            delay += 1000;
        });
    }
    else if (type === "REVEAL_SEQ") {
        initAudioPermission();
        let delay = 0;
        data.forEach(pos => {
            setTimeout(() => {
                let item = absoluteCells[pos - 1];
                if (item && (item.state === 1 || item.state === 0)) {
                    item.element.style.background = 'url("occhu.png") center center no-repeat';
                    item.element.style.backgroundSize = "100% 100%";
                    item.element.textContent = removeVietnameseTones(item.letter).replace("_", "").toUpperCase();
                    item.revealed = true;
                    item.state = 2;
                    playSecondDing();
                }
            }, delay);
            delay += 1000;
        });
    }
    else if (type === "START_TOSSUP") {
        initAudioPermission();
        clearAllTossupTimeouts();
        syncControlUI("UPDATE_CTRL_ACTIVE", "startBtn");
        allCells.forEach(item => {
            item.element.style.background = 'url("obox.png") center center no-repeat';
            item.element.style.backgroundSize = "100% 100%";
            item.element.textContent = "";
            item.revealed = false;
            item.state = 0;
        });
        tossupSound.currentTime = 0;
        playTossupMusic();
    }
    else if (type === "TOSSUP_REVEAL_CELL") {
        const idx = data.absoluteIndex;
        const targetItem = absoluteCells[idx - 1];
        if (targetItem && !targetItem.revealed) {
            targetItem.element.style.background = 'url("obox.png") center center no-repeat';
            targetItem.element.style.backgroundSize = "100% 100%";
            targetItem.element.textContent = removeVietnameseTones(targetItem.letter);
            targetItem.revealed = true;
            targetItem.state = 2;
        }
    }
    else if (type === "PAUSE_TOSSUP") {
        syncControlUI("UPDATE_CTRL_ACTIVE", "pauseBtn");
        clearAllTossupTimeouts(); 
        playDing(); 
    }
    else if (type === "PLAY_TOSSUP") {
        initAudioPermission();
        syncControlUI("UPDATE_CTRL_ACTIVE", "playBtn");
        playTossupMusic(); 
    }
    else if (type === "STOP_TOSSUP_MUSIC") {
        clearAllTossupTimeouts();
        syncControlUI("UPDATE_CTRL_ACTIVE", null);
        tossupSound.pause();
        tossupSound.currentTime = 0;
    }
    else if (type === "SHOW_BOARD") {
        hideAllLights(); 
        initAudioPermission();
        showSound.currentTime = 0;
        showSound.play();

        if (lightWhite) {
            lightWhite.style.display = "block";
            setTimeout(() => {
                lightWhite.style.display = "none";
            }, 1000); 
        }

        allCells.forEach((item, index) => {
            setTimeout(() => {
                item.element.style.background = 'url("obox.png") center center no-repeat';
                item.element.style.backgroundSize = "100% 100%";
                item.element.textContent = "";
                item.revealed = false;
                item.state = 0;
            }, index * 10);
        });
    }
    else if (type === "REVEAL_ALL") {
        tossupSound.pause();
        tossupSound.volume = 1.0;
        clearAllTossupTimeouts();
        syncControlUI("UPDATE_CTRL_ACTIVE", null);
        if ([9, 10, 11].includes(currentQuizIndex)) {
            const bonusWinSound = new Audio("ClearBonus.mp3");
            activeSFXList.push(bonusWinSound);
            bonusWinSound.play().catch(e => console.log(e));
            bonusWinSound.onended = () => {
                activeSFXList = activeSFXList.filter(audio => audio !== bonusWinSound);
                bonusWinSound.remove();
            };
        } else if ([2, 3, 4, 8].includes(currentQuizIndex)) {
            clearPuzzleSound.currentTime = 0; clearPuzzleSound.play().catch(e => console.log(e));
        } else {
            revealSound.currentTime = 0; revealSound.play().catch(e => console.log(e));
        }

        if (lightGreen) {
            lightGreen.style.display = "block";
        }

        allCells.forEach(item => {
            item.element.style.background = 'url("obox.png") center center no-repeat';
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
});