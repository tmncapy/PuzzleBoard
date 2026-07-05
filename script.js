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

// --- QUẢN LÝ ĐƯỜNG DẪN ẢNH TÙY CHỈNH REALTIME ---
let currentImages = {
    BG_BOARD: 'bangochu.png',
    IMG_DEFAULT_BOX: 'defaultbox.png',
    IMG_CHOOSE_BOX: 'choosebox.png',
    IMG_OCCHU_BOX: 'occhu.png',
    IMG_OBOX_BOX: 'obox.png',
    IMG_THUMBNAIL: 'thumbnail.png'
};

// --- HỆ THỐNG ÂM THANH (SFX & MUSIC) ---
const showSound = new Audio("reveal.mp3");
const revealSound = new Audio("ClearTossUp.mp3");
const clearPuzzleSound = new Audio("ClearPuzzle.mp3");
const tossupSound = new Audio("tossup.mp3");
tossupSound.loop = true;

let sfx30s = new Audio("30s.mp3");
let sfx10s = new Audio("10s.mp3");
let activeTimerSound = null;

function initAudioPermission() {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    if (context.state === 'suspended') {
        context.resume();
    }
}

function playDing() {
    const audio = new Audio("ding.wav");
    audio.play().catch(e => console.log(e));
}

function playSecondDing() {
    const audio = new Audio("2nd_ding.wav");
    audio.play().catch(e => console.log(e));
}

function playWrong() {
    const audio = new Audio("wrong.mp3");
    audio.play().catch(e => console.log(e));
}

function stopAllAudio() {
    showSound.pause(); showSound.currentTime = 0;
    revealSound.pause(); revealSound.currentTime = 0;
    clearPuzzleSound.pause(); clearPuzzleSound.currentTime = 0;
    tossupSound.pause(); tossupSound.currentTime = 0;
    if (activeTimerSound) {
        activeTimerSound.pause();
        activeTimerSound.currentTime = 0;
        activeTimerSound = null;
    }
    sfx30s.pause(); sfx30s.currentTime = 0;
    sfx10s.pause(); sfx10s.currentTime = 0;
}

// --- ĐỊNH VỊ TỌA ĐỘ 52 Ô CHỮ (CHIẾC NÓN KỲ DIỆU 12 - 14 - 14 - 12) ---
const cells = [];
// Hàng 1 (12 ô, cách lề trái 1 ô)
for (let i = 0; i < 12; i++) { cells.push({ x: 172 + i * 131, y: 154 }); }
// Hàng 2 (14 ô)
for (let i = 0; i < 14; i++) { cells.push({ x: 41 + i * 131, y: 341 }); }
// Hàng 3 (14 ô)
for (let i = 0; i < 14; i++) { cells.push({ x: 41 + i * 131, y: 528 }); }
// Hàng 4 (12 ô, cách lề trái 1 ô)
for (let i = 0; i < 12; i++) { cells.push({ x: 172 + i * 131, y: 715 }); }

let allCells = []; 
let absoluteCells = new Array(52).fill(null);
let currentQuizIndex = -1;

function clearOldBoardElements() {
    const oldCells = document.querySelectorAll(".cell");
    oldCells.forEach(c => c.remove());
}

function removeVietnameseTones(str) {
    if (!str) return "";
    str = str.replace(/à|á|ạ|ả|ã|â|ần|ấn|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "A");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "E");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, "I");
    str = str.replace(/ò|á|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "O");
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "U");
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "Y");
    str = str.replace(/đ/g, "D");
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
    str = str.replace(/Ì|Í|Ị|ỉ|Ĩ/g, "I");
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
    str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
    str = str.replace(/Đ/g, "D");
    return str;
}

function syncControlUI(type, data) {
    channel.send({
        type: 'broadcast',
        event: 'display-to-control',
        payload: { type: type, data: data }
    });
}

// --- KHỞI TẠO BẢNG ĐỀ BÀI TỪ FILE EXCEL ---
function loadQuiz(quizLetters) {
    clearOldBoardElements();
    allCells = [];
    absoluteCells = new Array(52).fill(null);

    cells.forEach((p, i) => {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.style.left = p.x + "px";
        cell.style.top = p.y + "px";

        const letter = quizLetters[i] ? quizLetters[i].trim().toUpperCase() : "";

        if (letter === "" || letter === " " || !letter) {
            cell.style.background = `url("${currentImages.IMG_DEFAULT_BOX}") center center no-repeat`;
            cell.style.backgroundSize = "100% 100%";
            cell.style.pointerEvents = "none";
            board.appendChild(cell);
            return;
        }

        cell.style.background = `url("${currentImages.IMG_DEFAULT_BOX}") center center no-repeat`;
        cell.style.backgroundSize = "100% 100%";
        cell.textContent = "";

        let cellObj = {
            element: cell,
            letter: letter,
            revealed: false,
            state: 0, // 0: Đóng, 1: Đang chọn (Xanh), 2: Lật chữ
            absoluteIndex: i + 1
        };

        // Click trực tiếp vào ô chữ trên màn hình hiển thị để tương tác nhanh
        cell.addEventListener("click", () => {
            initAudioPermission();
            if (cellObj.state === 0) {
                cell.style.background = `url("${currentImages.IMG_CHOOSE_BOX}") center center no-repeat`;
                cell.style.backgroundSize = "100% 100%";
                playDing();
                cellObj.state = 1;
            } else if (cellObj.state === 1) {
                // Tùy biến: Nếu nạp thủ công giữ nguyên chữ gốc, nếu là đề thường thì bỏ dấu tiếng Việt (Toss-up/Đoán chữ)
                if (cell.classList.contains("cell-manual")) {
                    cell.style.background = `url("${currentImages.IMG_OCCHU_BOX}") center center no-repeat`;
                    cell.textContent = cellObj.letter;
                } else {
                    cell.style.background = `url("${currentImages.IMG_OBOX_BOX}") center center no-repeat`;
                    cell.textContent = removeVietnameseTones(cellObj.letter);
                }
                cell.style.backgroundSize = "100% 100%";
                playSecondDing();
                cellObj.state = 2;
                cellObj.revealed = true;
            }
        });

        allCells.push(cellObj);
        absoluteCells[i] = cellObj;
        board.appendChild(cell);
    });
}

// --- LẮNG NGHE LỆNH ĐIỀU KHIỂN TỪ CONTROL ---
channel.on('broadcast', { event: 'control-to-display' }, ({ payload }) => {
    const { type, data } = payload;

    if (type === "LOAD_QUIZ") {
        initAudioPermission();
        stopAllAudio();
        
        currentQuizIndex = data.index;
        loadQuiz(data.letters);
        
        // Ẩn ảnh bìa nếu đang hiển thị
        const thumb = document.getElementById("programThumbnail");
        if (thumb) thumb.style.display = "none";

        syncControlUI("UPDATE_QUIZ_ACTIVE", currentQuizIndex);
        syncControlUI("UPDATE_CTRL_ACTIVE", null);
    }
    else if (type === "START_TOSSUP") {
        initAudioPermission();
        stopAllAudio();
        tossupSound.play().catch(e => console.log(e));
        syncControlUI("UPDATE_CTRL_ACTIVE", "startBtn");
    }
    else if (type === "PAUSE_TOSSUP") {
        tossupSound.pause();
        syncControlUI("UPDATE_CTRL_ACTIVE", "pauseBtn");
    }
    else if (type === "PLAY_TOSSUP") {
        initAudioPermission();
        tossupSound.play().catch(e => console.log(e));
        syncControlUI("UPDATE_CTRL_ACTIVE", "playBtn");
    }
    else if (type === "SOLVE_TOSSUP") {
        stopAllAudio();
        revealSound.currentTime = 0;
        revealSound.play().catch(e => console.log(e));
        syncControlUI("UPDATE_CTRL_ACTIVE", "solveBtn");
    }
    else if (type === "STOP_TOSSUP_MUSIC") {
        tossupSound.pause();
        syncControlUI("UPDATE_CTRL_ACTIVE", null);
    }
    else if (type === "SHOW_BOARD") {
        initAudioPermission();
        showSound.currentTime = 0;
        showSound.play().catch(e => console.log(e));
        
        allCells.forEach((item, index) => {
            setTimeout(() => {
                // Đề thường hiện ô màu xanh obox.png
                item.element.style.background = `url("${currentImages.IMG_OBOX_BOX}") center center no-repeat`;
                item.element.style.backgroundSize = "100% 100%";
                item.element.textContent = "";
                item.revealed = false;
                item.state = 0;
            }, index * 10);
        });
    }
    else if (type === "REVEAL_ALL") {
        stopAllAudio();
        if ([2, 3, 4, 8].includes(currentQuizIndex)) {
            clearPuzzleSound.currentTime = 0;
            clearPuzzleSound.play().catch(e => console.log(e));
        } else {
            revealSound.currentTime = 0;
            revealSound.play().catch(e => console.log(e));
        }

        allCells.forEach(item => {
            if (item.element.classList.contains("cell-manual")) {
                item.element.style.background = `url("${currentImages.IMG_OCCHU_BOX}") center center no-repeat`;
                item.element.textContent = item.letter;
            } else {
                item.element.style.background = `url("${currentImages.IMG_OBOX_BOX}") center center no-repeat`;
                item.element.textContent = removeVietnameseTones(item.letter);
            }
            item.element.style.backgroundSize = "100% 100%";
            item.revealed = true;
            item.state = 2;
        });
    }
    else if (type === "RESET_BOARD") {
        stopAllAudio();
        clearOldBoardElements();
        allCells = [];
        absoluteCells = new Array(52).fill(null);
        currentQuizIndex = -1;
        syncControlUI("UPDATE_QUIZ_ACTIVE", -1);
        syncControlUI("UPDATE_CTRL_ACTIVE", null);
    }
    else if (type === "SHOW_THUMBNAIL") {
        let thumb = document.getElementById("programThumbnail");
        if (!thumb) {
            thumb = document.createElement("img");
            thumb.id = "programThumbnail";
            thumb.style.cssText = "position:absolute; top:0; left:0; width:1920px; height:1080px; z-index:9999; object-fit:cover;";
            document.body.appendChild(thumb);
        }
        thumb.src = currentImages.IMG_THUMBNAIL;
        thumb.style.display = "block";
    }
    else if (type === "HIDE_THUMBNAIL") {
        const thumb = document.getElementById("programThumbnail");
        if (thumb) thumb.style.display = "none";
    }
    else if (type === "TOSSUP_REVEAL_CELL") {
        initAudioPermission();
        const idx = data.absoluteIndex - 1;
        const cellObj = absoluteCells[idx];
        if (cellObj && !cellObj.revealed) {
            cellObj.element.style.background = `url("${currentImages.IMG_OBOX_BOX}") center center no-repeat`;
            cellObj.element.style.backgroundSize = "100% 100%";
            cellObj.element.textContent = removeVietnameseTones(cellObj.letter);
            cellObj.revealed = true;
            cellObj.state = 2;
            playSecondDing();
        }
    }
    else if (type === "GUESS_LETTER") {
        initAudioPermission();
        const guessedChar = data.toUpperCase();
        let matchedPositions = [];

        allCells.forEach(item => {
            if (!item.revealed && removeVietnameseTones(item.letter) === guessedChar) {
                matchedPositions.push(item.absoluteIndex);
            }
        });

        if (matchedPositions.length > 0) {
            syncControlUI("FILL_POSITIONS", matchedPositions);
        } else {
            playWrong();
            syncControlUI("FILL_POSITIONS", []);
        }
    }
    else if (type === "MARK_SEQ") {
        initAudioPermission();
        playDing();
        data.forEach(pos => {
            const cellObj = absoluteCells[pos - 1];
            if (cellObj && cellObj.state === 0) {
                cellObj.element.style.background = `url("${currentImages.IMG_CHOOSE_BOX}") center center no-repeat`;
                cellObj.element.style.backgroundSize = "100% 100%";
                cellObj.state = 1;
            }
        });
    }
    else if (type === "REVEAL_SEQ") {
        initAudioPermission();
        playSecondDing();
        data.forEach(pos => {
            const cellObj = absoluteCells[pos - 1];
            if (cellObj && cellObj.state === 1) {
                cellObj.element.style.background = `url("${currentImages.IMG_OBOX_BOX}") center center no-repeat`;
                cellObj.element.style.backgroundSize = "100% 100%";
                cellObj.element.textContent = removeVietnameseTones(cellObj.letter);
                cellObj.revealed = true;
                cellObj.state = 2;
            }
        });
        syncControlUI("FILL_POSITIONS", []);
    }
    else if (type === "GUESS_MULTI_LETTERS") {
        initAudioPermission();
        const listLetters = data;
        let hasMatch = false;

        allCells.forEach(item => {
            if (!item.revealed && listLetters.includes(removeVietnameseTones(item.letter))) {
                item.element.style.background = `url("${currentImages.IMG_OBOX_BOX}") center center no-repeat`;
                item.element.style.backgroundSize = "100% 100%";
                item.element.textContent = removeVietnameseTones(item.letter);
                item.revealed = true;
                item.state = 2;
                hasMatch = true;
            }
        });

        if (hasMatch) {
            playSecondDing();
        } else {
            playWrong();
        }
    }
    else if (type === "PLAY_TIMER") {
        initAudioPermission();
        if (activeTimerSound) { activeTimerSound.pause(); activeTimerSound.currentTime = 0; }
        
        if (data === 30) {
            activeTimerSound = sfx30s;
        } else if (data === 10) {
            activeTimerSound = sfx10s;
        }
        if (activeTimerSound) {
            activeTimerSound.currentTime = 0;
            activeTimerSound.play().catch(e => console.log(e));
        }
    }
    else if (type === "PLAY_SFX") {
        initAudioPermission();
        const sfxAudio = new Audio(data);
        sfxAudio.play().catch(e => console.log(e));
    }
    else if (type === "STOP_ALL_SFX") {
        stopAllAudio();
    }
    
    // --- XỬ LÝ NHẬP VĂN BẢN THỦ CÔNG ĐA DÒNG (ENTER XUỐNG HÀNG) ---
    else if (type === "SHOW_MANUAL_TEXT") {
        initAudioPermission();
        stopAllAudio();
        clearOldBoardElements();
        
        allCells = [];
        absoluteCells = new Array(52).fill(null);
        currentQuizIndex = -1;

        // Tách chuỗi nhận được từ ô textarea dựa theo ký tự xuống dòng (\n)
        const lines = data.split('\n').map(l => l.trim().toUpperCase()).filter(l => l !== "");
        
        // Cấu hình số ô tối đa của từng hàng trên khung hình thực tế
        const rowConfigs = [
            { startIdx: 0, totalCells: 12 },  // Hàng 1
            { startIdx: 12, totalCells: 14 }, // Hàng 2
            { startIdx: 26, totalCells: 14 }, // Hàng 3
            { startIdx: 40, totalCells: 12 }  // Hàng 4
        ];

        let manualTextGrid = new Array(52).fill(null);
        // Nếu gõ 1 dòng -> Ưu tiên hiện hàng số 2. Nếu 2 dòng -> Hiện hàng 2 và hàng 3
        let targetRowIndex = lines.length === 1 ? 1 : 1; 

        lines.forEach((lineText, index) => {
            let currentRow = targetRowIndex + index;
            if (currentRow > 3) currentRow = 3; // Không cho tràn quá hàng số 4

            let config = rowConfigs[currentRow];
            
            // Tính toán khoảng thụt đầu dòng (offset) để chuỗi nằm chính giữa hàng
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

        // Vẽ 52 ô chứa chuỗi đa dòng lên màn hình
        cells.forEach((p, i) => {
            const cell = document.createElement("div");
            cell.className = "cell cell-manual"; // Thêm class đánh dấu ô nhập thủ công để giữ font chữ gốc
            cell.style.left = p.x + "px";
            cell.style.top = p.y + "px";

            const charAtPos = manualTextGrid[i];

            if (charAtPos !== null) {
                if (charAtPos === " ") {
                    cell.style.background = `url("${currentImages.IMG_DEFAULT_BOX}") center center no-repeat`;
                    cell.style.backgroundSize = "100% 100%";
                    cell.style.pointerEvents = "none";
                } else {
                    // Ô chữ thủ công: dùng ảnh occhu.png thiết kế riêng và hiển thị nguyên vẹn kí tự tiếng Việt
                    cell.style.background = `url("${currentImages.IMG_OCCHU_BOX}") center center no-repeat`;
                    cell.style.backgroundSize = "100% 100%";
                    cell.textContent = charAtPos;
                    
                    let cellObj = { element: cell, letter: charAtPos, revealed: true, state: 2, absoluteIndex: i + 1 };
                    allCells.push(cellObj);
                    absoluteCells[i] = cellObj;
                }
            } else {
                cell.style.background = `url("${currentImages.IMG_DEFAULT_BOX}") center center no-repeat`;
                cell.style.backgroundSize = "100% 100%";
                cell.style.pointerEvents = "none";
            }
            board.appendChild(cell);
        });

        showSound.currentTime = 0;
        showSound.play().catch(e => console.log(e));
        
        syncControlUI("UPDATE_QUIZ_ACTIVE", -1);
        syncControlUI("UPDATE_CTRL_ACTIVE", null);
    }
    
    // --- THAY ĐỔI GIAO DIỆN ẢNH TÙY CHỈNH THEO THỜI GIAN THỰC (REALTIME) ---
    else if (type === "CHANGE_CUSTOM_IMAGE") {
        const targetType = data.type;
        const base64Src = data.src;

        currentImages[targetType] = base64Src;

        if (targetType === "BG_BOARD") {
            board.style.backgroundImage = `url("${base64Src}")`;
        } 
        else if (targetType === "IMG_THUMBNAIL") {
            const thumb = document.getElementById("programThumbnail");
            if (thumb) thumb.src = base64Src;
        }
        else {
            allCells.forEach(item => {
                if (item.state === 0 && targetType === "IMG_DEFAULT_BOX") {
                    item.element.style.backgroundImage = `url("${base64Src}")`;
                }
                else if (item.state === 1 && targetType === "IMG_CHOOSE_BOX") {
                    item.element.style.backgroundImage = `url("${base64Src}")`;
                }
                else if (item.state === 2) {
                    if (targetType === "IMG_OCCHU_BOX" && item.element.classList.contains("cell-manual")) {
                        item.element.style.backgroundImage = `url("${base64Src}")`;
                    } else if (targetType === "IMG_OBOX_BOX" && !item.element.classList.contains("cell-manual")) {
                        item.element.style.backgroundImage = `url("${base64Src}")`;
                    }
                }
            });
            
            document.querySelectorAll('.cell').forEach(cell => {
                if (cell.textContent === "" && !cell.style.pointerEvents) {
                    if (targetType === "IMG_DEFAULT_BOX") {
                        cell.style.backgroundImage = `url("${base64Src}")`;
                    }
                }
            });
        }
    }
    else if (type === "RESET_CUSTOM_IMAGES") {
        currentImages = {
            BG_BOARD: 'bangochu.png',
            IMG_DEFAULT_BOX: 'defaultbox.png',
            IMG_CHOOSE_BOX: 'choosebox.png',
            IMG_OCCHU_BOX: 'occhu.png',
            IMG_OBOX_BOX: 'obox.png',
            IMG_THUMBNAIL: 'thumbnail.png'
        };
        board.style.backgroundImage = `url("bangochu.png")`;
        const thumb = document.getElementById("programThumbnail");
        if (thumb) thumb.src = "thumbnail.png";
        
        document.querySelectorAll('.cell').forEach(cell => {
            if (cell.textContent === "") {
                cell.style.backgroundImage = `url("defaultbox.png")`;
            } else if (cell.classList.contains("cell-manual")) {
                cell.style.backgroundImage = `url("occhu.png")`;
            } else {
                cell.style.backgroundImage = `url("obox.png")`;
            }
        });
    }
});