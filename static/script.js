// =============================================
// Korean → Vietnamese Real-time Speech Translator
// =============================================

(function () {
  'use strict';

  // --- Constants ---
  const TRANSLATION_API = 'https://api.mymemory.translated.net/get';
  const LANG_PAIR = 'ko|vi';
  const DEBOUNCE_MS = 200;
  const HISTORY_KEY = 'kr_vi_translator_history';
  const MAX_HISTORY = 50;
  const VISUALIZER_BARS = 32;

  // --- DOM Elements ---
  const recordBtn = document.getElementById('recordBtn');
  const recordIcon = document.getElementById('recordIcon');
  const recordStatus = document.getElementById('recordStatus');
  const visualizer = document.getElementById('visualizer');
  const koreanText = document.getElementById('koreanText');
  const vietnameseText = document.getElementById('vietnameseText');
  const historyList = document.getElementById('historyList');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const copyKoreanBtn = document.getElementById('copyKoreanBtn');
  const copyVietnameseBtn = document.getElementById('copyVietnameseBtn');
  const errorBanner = document.getElementById('errorBanner');
  const errorMessage = document.getElementById('errorMessage');
  const errorClose = document.getElementById('errorClose');

  // --- State ---
  let isRecording = false;
  let recognition = null;
  let audioContext = null;
  let analyser = null;
  let mediaStream = null;
  let animationFrameId = null;
  let translationTimeout = null;
  let currentFinalTranscript = '';
  let currentInterimTranscript = '';
  let lastTranslation = '';
  let translationInFlight = false;
  let history = [];

  // --- Initialize ---
  function init() {
    loadHistory();
    renderHistory();
    setupSpeechRecognition();
    setupEventListeners();
    createVisualizerBars();
  }

  // --- Speech Recognition Setup ---
  function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      showError('Trình duyệt không hỗ trợ nhận dạng giọng nói. Vui lòng sử dụng Google Chrome.');
      recordBtn.disabled = true;
      recordBtn.style.opacity = '0.5';
      return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = handleResult;
    recognition.onerror = handleRecognitionError;
    recognition.onend = handleRecognitionEnd;
  }

  // --- Event Listeners ---
  function setupEventListeners() {
    recordBtn.addEventListener('click', toggleRecording);
    clearHistoryBtn.addEventListener('click', clearHistory);
    copyKoreanBtn.addEventListener('click', () => copyText(currentFinalTranscript, 'Đã copy tiếng Hàn!'));
    copyVietnameseBtn.addEventListener('click', () => {
      const viText = vietnameseText.textContent;
      if (viText && !viText.includes('Bản dịch') && !viText.includes('Đang dịch')) {
        copyText(viText, 'Đã copy bản dịch!');
      }
    });
    errorClose.addEventListener('click', hideError);
  }

  // --- Recording Toggle ---
  async function toggleRecording() {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  }

  async function startRecording() {
    if (!recognition) return;

    try {
      // Request microphone access for visualizer
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setupAudioVisualizer(mediaStream);

      // Reset transcripts
      currentFinalTranscript = '';
      currentInterimTranscript = '';
      lastTranslation = '';
      koreanText.innerHTML = '<span class="placeholder">Đang lắng nghe...</span>';
      vietnameseText.innerHTML = '<span class="placeholder">Bản dịch sẽ hiển thị ở đây...</span>';

      recognition.start();
      isRecording = true;

      recordBtn.classList.add('recording');
      recordIcon.textContent = '⏹';
      recordStatus.textContent = 'Đang thu âm...';
      recordStatus.classList.add('active');
      visualizer.classList.add('active');
      hideError();
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        showError('Không có quyền truy cập microphone. Vui lòng cho phép truy cập mic trong trình duyệt.');
      } else {
        showError('Lỗi khởi tạo microphone: ' + err.message);
      }
    }
  }

  function stopRecording() {
    if (recognition) {
      recognition.stop();
    }

    isRecording = false;
    recordBtn.classList.remove('recording');
    recordIcon.textContent = '🎙';
    recordStatus.textContent = 'Nhấn để thu âm';
    recordStatus.classList.remove('active');
    visualizer.classList.remove('active');

    stopAudioVisualizer();

    // Save to history if there's content
    if (currentFinalTranscript.trim()) {
      const viText = vietnameseText.textContent;
      if (viText && !viText.includes('Bản dịch') && !viText.includes('Đang dịch')) {
        addToHistory(currentFinalTranscript.trim(), viText);
      } else {
        translateText(currentFinalTranscript.trim()).then(translated => {
          if (translated) {
            addToHistory(currentFinalTranscript.trim(), translated);
            vietnameseText.textContent = translated;
          }
        });
      }
    }
  }

  // --- Speech Recognition Handlers ---
  function handleResult(event) {
    let interim = '';
    let final = '';
    let hasFinal = false;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += transcript;
        hasFinal = true;
      } else {
        interim += transcript;
      }
    }

    if (final) {
      currentFinalTranscript += final;
    }
    currentInterimTranscript = interim;

    // Display Korean text
    let displayHTML = '';
    if (currentFinalTranscript) {
      displayHTML += `<span>${escapeHTML(currentFinalTranscript)}</span>`;
    }
    if (currentInterimTranscript) {
      displayHTML += `<span class="interim">${escapeHTML(currentInterimTranscript)}</span>`;
    }
    if (!displayHTML) {
      displayHTML = '<span class="placeholder">Đang lắng nghe...</span>';
    }
    koreanText.innerHTML = displayHTML;

    // Translate: immediately for final results, debounced for interim
    const fullText = (currentFinalTranscript + currentInterimTranscript).trim();
    if (fullText) {
      if (hasFinal) {
        if (translationTimeout) clearTimeout(translationTimeout);
        translateAndShow(fullText);
      } else {
        if (lastTranslation) {
          vietnameseText.innerHTML = `<span>${escapeHTML(lastTranslation)}</span><span class="interim"> ...</span>`;
        }
        debouncedTranslate(fullText);
      }
    }
  }

  function handleRecognitionError(event) {
    console.error('Speech recognition error:', event.error);

    const errorMessages = {
      'no-speech': 'Không phát hiện giọng nói. Vui lòng thử lại.',
      'audio-capture': 'Không tìm thấy microphone. Vui lòng kiểm tra thiết bị.',
      'not-allowed': 'Không có quyền truy cập microphone.',
      'network': 'Lỗi mạng. Vui lòng kiểm tra kết nối internet.',
      'aborted': '',
    };

    const msg = errorMessages[event.error] || `Lỗi nhận dạng: ${event.error}`;
    if (msg) showError(msg);

    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      stopRecording();
    }
  }

  function handleRecognitionEnd() {
    if (isRecording) {
      try {
        recognition.start();
      } catch (e) {
        // Ignore if already started
      }
    }
  }

  // --- Translation ---
  async function translateAndShow(text) {
    if (translationInFlight) return;
    translationInFlight = true;
    try {
      const translated = await translateText(text);
      if (translated) {
        lastTranslation = translated;
        vietnameseText.textContent = translated;
      }
    } finally {
      translationInFlight = false;
    }
  }

  function debouncedTranslate(text) {
    if (translationTimeout) {
      clearTimeout(translationTimeout);
    }

    translationTimeout = setTimeout(async () => {
      await translateAndShow(text);
    }, DEBOUNCE_MS);
  }

  async function translateText(text) {
    if (!text.trim()) return null;

    try {
      const url = `${TRANSLATION_API}?q=${encodeURIComponent(text)}&langpair=${LANG_PAIR}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.responseStatus === 200 && data.responseData) {
        return data.responseData.translatedText;
      } else {
        console.warn('Translation API error:', data);
        return null;
      }
    } catch (err) {
      console.error('Translation fetch error:', err);
      showError('Lỗi dịch thuật. Vui lòng kiểm tra kết nối mạng.');
      return null;
    }
  }

  // --- Audio Visualizer ---
  function createVisualizerBars() {
    visualizer.innerHTML = '';
    for (let i = 0; i < VISUALIZER_BARS; i++) {
      const bar = document.createElement('div');
      bar.className = 'visualizer__bar';
      visualizer.appendChild(bar);
    }
  }

  function setupAudioVisualizer(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 64;

    animateVisualizer();
  }

  function animateVisualizer() {
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const bars = visualizer.querySelectorAll('.visualizer__bar');

    function draw() {
      animationFrameId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      bars.forEach((bar, index) => {
        const value = dataArray[index] || 0;
        const height = Math.max(4, (value / 255) * 36);
        bar.style.height = `${height}px`;
      });
    }

    draw();
  }

  function stopAudioVisualizer() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }

    if (audioContext) {
      audioContext.close();
      audioContext = null;
      analyser = null;
    }

    const bars = visualizer.querySelectorAll('.visualizer__bar');
    bars.forEach(bar => {
      bar.style.height = '4px';
    });
  }

  // --- History ---
  function loadHistory() {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      history = stored ? JSON.parse(stored) : [];
    } catch {
      history = [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      console.warn('Cannot save history to localStorage:', e);
    }
  }

  function addToHistory(korean, vietnamese) {
    const item = {
      ko: korean,
      vi: vietnamese,
      time: new Date().toISOString(),
    };

    history.unshift(item);
    if (history.length > MAX_HISTORY) {
      history = history.slice(0, MAX_HISTORY);
    }

    saveHistory();
    renderHistory();
  }

  function renderHistory() {
    if (history.length === 0) {
      historyList.innerHTML = '<div class="history-empty">Chưa có lịch sử dịch</div>';
      return;
    }

    historyList.innerHTML = history.map(item => {
      const time = formatTime(item.time);
      return `
        <div class="history-item">
          <div class="history-item__ko">${escapeHTML(item.ko)}</div>
          <div class="history-item__vi">${escapeHTML(item.vi)}</div>
          <div class="history-item__time">${time}</div>
        </div>`;
    }).join('');
  }

  function clearHistory() {
    if (history.length === 0) return;
    history = [];
    saveHistory();
    renderHistory();
  }

  // --- Utilities ---
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTime(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const time = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    if (isToday) return `Hôm nay, ${time}`;
    return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) + `, ${time}`;
  }

  function copyText(text, successMsg) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg);
    }).catch(() => {
      showError('Không thể copy. Vui lòng copy thủ công.');
    });
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
      background: rgba(16, 185, 129, 0.9); color: white; padding: 10px 24px;
      border-radius: 8px; font-size: 13px; font-weight: 500; z-index: 1000;
      animation: fadeIn 0.3s ease-out;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorBanner.classList.add('show');
  }

  function hideError() {
    errorBanner.classList.remove('show');
  }

  // --- Start ---
  init();
})();
