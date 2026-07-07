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

// Khởi tạo các đối tượng âm thanh
const showSound = new Audio("reveal.mp3");
const revealSound = new Audio("ClearTossUp.mp3");
const clearPuzzleSound = new Audio("ClearPuzzle.mp3");
const tossupSound = new Audio("tossup.mp3");
tossupSound.loop = true;

let currentQuizIndex = 0; 
let allCells = [];
let absoluteCells = new Array(52).fill(null);

function initAudioPermission() {
    showSound.load(); revealSound.load(); clearPuzzleSound.load(); tossupSound.load();
}

function playDing(){
    const audio = new Audio("ding.wav");
    audio.play().then(() => {
        audio.onended = () => { audio.remove(); };
    }).catch(e => console.log(e));
}

function playSecondDing(){
    const audio = new Audio("2nd_ding.wav");
    audio.play().then(() => {
        audio.onended = () => { audio.remove(); };
    }).catch(e => console.log(e));
}

function playWrong() {
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

// Tọa độ cấu trúc ma trận 52 ô thực tế
const cells = [
    { x: 246, y: 240 }, { x: 366, y: 240 }, { x: 486, y: 240 }, { x: 606, y: 240 }, { x: 726, y: 240 }, { x: 846, y: 240 }, { x: 966, y: 240 }, { x: 1086, y: 240 }, { x: 1206, y: 240 }, { x: 1326, y: 240 }, { x: 1446, y: 240 }, { x: 1566, y: 240 },
    { x: 126, y: 390 }, { x: 246, y: 390 }, { x: 366, y: 390 }, { x: 486, y: 390 }, { x: 606, y: 390 }, { x: 726, y: 390 }, { x: 846, y: 390 }, { x: 966, y: 390 }, { x: 1086, y: 390 }, { x: 1206, y: 390 }, { x: 1326, y: 390 }, { x: 1446, y: 390 }, { x: 1566, y: 390 }, { x: 1686, y: 390 },
    { x: 126, y: 540 }, { x: 246, y: 540 }, { x: 366, y: 540 }, { x: 486, y: 540 }, { x: 606, y: 540 }, { x: 726, y: 540 }, { x: 846, y: 540 }, { x: 966, y: 540 }, { x: 1086, y: 540 }, { x: 1206, y: 540 }, { x: 1326, y: 540 }, { x: 1446, y: 540 }, { x: 1566, y: 540 }, { x: 1688, y: 540 },
    { x: 246, y: 690 }, { x: 366, y: 690 }, { x: 486, y: 690 }, { x: 606, y: 690 }, { x: 726, y: 690 }, { x: 846, y: 690 }, { x: 966, y: 690 }, { x: 1086, y: 690 }, { x: 1206, y: 690 }, { x: 1326, y: 690 }, { x: 1446, y: 690 }, { x: 1566, y: 690 }
];

function syncControlUI(type, data) {
    channel.send({
        type: 'broadcast',
        event: 'display-to-control',
        payload: { type: type, data: data }
    });
}

function clearOldBoardElements() {
    // Dọn sạch, giữ lại thẻ ảnh thumbnail nếu có
    const thumbnailImg = document.getElementById("programThumbnail");
    board.innerHTML = "";
    if (thumbnailImg) {
        board.appendChild(thumbnailImg);
    }
}

function loadQuiz(quizPayload) {
    const index = quizPayload.index;
    const letters = quizPayload.letters;

    currentQuizIndex = index;
    tossupSound.load();
    initAudioPermission();

    tossupSound.pause();
    tossupSound.currentTime = 0;
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

        let cellObj = { element: cell, letter: letter, revealed: false, state: 0, absoluteIndex: i + 1 };
        allCells.push(cellObj);
        absoluteCells[i] = cellObj;

        cell.addEventListener("click", () => {
            initAudioPermission();
            if (cellObj.state === 0) {
                cell.style.background = 'url("choosebox.png") center center no-repeat';
                cell.style.backgroundSize = "100% 100%";
                playDing();
                cellObj.state = 1;
            } else if (cellObj.state === 1) {
                cell.style.background = 'url("obox.png") center center no-repeat';
                cell.style.backgroundSize = "100% 100%";
                cell.textContent = removeVietnameseTones(cellObj.letter);
                cellObj.state = 2;
                cellObj.revealed = true;
            }
        });

        board.appendChild(cell);
    });

    syncControlUI("UPDATE_QUIZ_ACTIVE", index);
}

// --- CỔNG LẮNG NGHE TÍN HIỆU TỪ BẢNG ĐIỀU KHIỂN (SUPABASE REALTIME) ---
channel.on('broadcast', { event: 'control-to-display' }, ({ payload }) => {
    const { type, data } = payload;

    if (type === "LOAD_QUIZ") {
        loadQuiz(data);
    }
   else if (type === "SHOW_MANUAL_TEXT") {
        initAudioPermission();
        tossupSound.pause();
        tossupSound.currentTime = 0;
        syncControlUI("UPDATE_CTRL_ACTIVE", null);

        clearOldBoardElements();
        allCells = [];
        absoluteCells = new Array(52).fill(null);

        // Tách văn bản thành các dòng dựa theo phím Enter (dấu xuống dòng)
        const lines = data.split('\n').map(line => line.trim().toUpperCase()).filter(line => line !== "");
        
        // Cấu hình ma trận ô chữ theo từng hàng thực tế của Chiếc nón kỳ diệu
        // Hàng 1: 12 ô (index 0->11), Hàng 2: 14 ô (index 12->25), Hàng 3: 14 ô (index 26->39), Hàng 4: 12 ô (index 40->51)
        const rowConfigs = [
            { startIdx: 0, totalCells: 12 },  // Hàng 1
            { startIdx: 12, totalCells: 14 }, // Hàng 2
            { startIdx: 26, totalCells: 14 }, // Hàng 3
            { startIdx: 40, totalCells: 12 }  // Hàng 4
        ];

        // Mảng đánh dấu xem ô nào trên bảng (0-51) sẽ chứa ký tự hiển thị
        let manualTextGrid = new Array(52).fill(null);

        // Xác định hàng bắt đầu hiển thị trên bảng dựa trên số lượng dòng bạn nhập
        // Nếu nhập 1 dòng -> Hiện ở hàng số 2 (Row index 1). Nếu nhập 2 dòng -> Hiện ở hàng 2 và hàng 3 (Row index 1 và 2)
        let targetRowIndex = lines.length === 1 ? 1 : 1; 

        lines.forEach((lineText, index) => {
            let currentRow = targetRowIndex + index;
            if (currentRow > 3) currentRow = 3; // Giới hạn không vượt quá hàng số 4

            let config = rowConfigs[currentRow];
            
            // Tính toán khoảng trống thụt lề (Offset) để chữ nằm chính giữa hàng này
            let offset = Math.floor((config.totalCells - lineText.length) / 2);
            if (offset < 0) offset = 0; // Phòng trường hợp chữ quá dài tràn hàng

            let activeStartIdx = config.startIdx + offset;

            // Điền các ký tự của dòng hiện tại vào mảng lưới tọa độ
            for (let charPos = 0; charPos < lineText.length; charPos++) {
                let gridIndex = activeStartIdx + charPos;
                if (gridIndex < config.startIdx + config.totalCells) {
                    manualTextGrid[gridIndex] = lineText[charPos];
                }
            }
        });

        // Tiến hành vẽ toàn bộ giao diện 52 ô lên màn hình khán giả
        cells.forEach((p, i) => {
            const cell = document.createElement("div");
            cell.className = "cell cell-manual"; // Giữ font chữ UTMHelvetIns chuẩn của dự án
            cell.style.left = p.x + "px";
            cell.style.top = p.y + "px";

            const charAtPos = manualTextGrid[i];

            if (charAtPos !== null) {
                if (charAtPos === " ") {
                    // Xử lý khoảng trắng giữa các từ trong câu thủ công
                    cell.style.background = 'url("defaultbox.png") center center no-repeat';
                    cell.style.backgroundSize = "100% 100%";
                    cell.style.pointerEvents = "none";
                } else {
                    // Ô chứa chữ cái: Giữ nguyên vẹn dấu tiếng Việt và ký tự đặc biệt trên nền trắng occhu.png
                    cell.style.background = 'url("occhu.png") center center no-repeat';
                    cell.style.backgroundSize = "100% 100%";
                    cell.textContent = charAtPos;
                    
                    let cellObj = { element: cell, letter: charAtPos, revealed: true, state: 2, absoluteIndex: i + 1 };
                    allCells.push(cellObj);
                    absoluteCells[i] = cellObj;
                }
            } else {
                // Các ô trống không chứa chữ xung quanh bảng
                cell.style.background = 'url("defaultbox.png") center center no-repeat';
                cell.style.backgroundSize = "100% 100%";
                cell.style.pointerEvents = "none";
            }

            board.appendChild(cell);
        });

        // Phát hiệu ứng âm thanh nạp ô chữ mượt mà
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
        const sfxAudio = new Audio(data);
        sfxAudio.play().catch(e => console.log("Lỗi phát SFX từ xa:", e));
    }
    else if (type === "STOP_ALL_SFX") {
        tossupSound.pause();
        showSound.pause();
        revealSound.pause();
        clearPuzzleSound.pause();
    }
    else if (type === "GUESS_LETTER") {
        initAudioPermission();
        const guessedChar = data.toUpperCase();
        let matchPositions = [];

        absoluteCells.forEach(item => {
            if (item && cleanLetter(item.letter) === guessedChar && item.state === 0) {
                matchPositions.push(item.absoluteIndex);
            }
        });

        if (matchPositions.length === 0) {
            playWrong();
        }
        syncControlUI("FILL_POSITIONS", matchPositions);
    }
    else if (type === "GUESS_MULTI_LETTERS") {
        initAudioPermission();
        const guessedChars = data.map(c => removeVietnameseTones(c).toUpperCase());
        let matchPositions = [];

        absoluteCells.forEach(item => {
            if (item && item.state === 0 && guessedChars.includes(cleanLetter(item.letter))) {
                matchPositions.push(item.absoluteIndex);
            }
        });

        if (matchPositions.length === 0) {
            playWrong();
        }
        syncControlUI("FILL_POSITIONS", matchPositions);
    }
    else if (type === "RESET_BOARD") {
        const allDomCells = document.querySelectorAll('.cell');
        allDomCells.forEach(cell => {
            cell.style.background = 'url("defaultbox.png") center center no-repeat';
            cell.style.backgroundSize = "100% 100%";
            cell.textContent = "";
        });
        allCells.forEach(item => {
            item.revealed = false;
            item.state = 0;
        });
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
                    // Nếu là đề gốc từ Excel, ta hiển thị dạng không dấu khi lật bình thường
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
        tossupSound.pause();
        playDing();
    }
    else if (type === "PLAY_TOSSUP") {
        initAudioPermission();
        syncControlUI("UPDATE_CTRL_ACTIVE", "playBtn");
        playTossupMusic();
    }
    else if (type === "STOP_TOSSUP_MUSIC") {
        tossupSound.pause();
        syncControlUI("UPDATE_CTRL_ACTIVE", null);
    }
    else if (type === "SHOW_BOARD") {
        initAudioPermission();
        showSound.currentTime = 0;
        showSound.play();
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
        syncControlUI("UPDATE_CTRL_ACTIVE", null);

        if ([2, 3, 4, 8].includes(currentQuizIndex)) {
            clearPuzzleSound.currentTime = 0;
            clearPuzzleSound.play().catch(e => console.log(e));
        } else {
            revealSound.currentTime = 0;
            revealSound.play().catch(e => console.log(e));
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
