/**
 * ============================================================================
 * FocusPulse 포모도로 타이머 메인 컨트롤러 (script.js)
 * ----------------------------------------------------------------------------
 * 1. 25분 집중 / 5분 휴식 자동 루프 제어
 * 2. Date.now() 기반 백그라운드 드리프트 없는 정밀 타이머
 * 3. SVG 원형 프로그레스 링 실시간 오프셋 연동
 * 4. 브라우저 탭 타이틀(document.title) 실시간 동기화
 * 5. Web Audio API 사운드 엔진 및 알람 연동
 * 6. LocalStorage 기반 세션 카운터 영구 저장 및 시각화
 * 7. 키보드 단축키 (Space: 시작/일시정지, R: 초기화)
 * ============================================================================
 */

// 엄격 모드 활성화로 안정성 확보
'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // ------------------------------------------------------------------------
    // 1. 상수 및 DOM 엘리먼트 참조
    // ------------------------------------------------------------------------
    // 포모도로 기본 시간 설정 (초 단위: 집중 25분=1500초, 휴식 5분=300초)
    const TIME_CONFIG = {
        FOCUS: 25 * 60,
        BREAK: 5 * 60
    };

    // 원형 프로그레스 링의 원주 길이 (r=145 ➔ 2 * Math.PI * 145 ≈ 911.06)
    const RING_CIRCUMFERENCE = 2 * Math.PI * 145;

    // DOM 엘리먼트 캐싱
    const bodyEl = document.body;
    const modeBadgeEl = document.getElementById('mode-badge');
    const modeTitleTextEl = document.getElementById('mode-title-text');
    const timerDisplayEl = document.getElementById('timer-display');
    const timerStatusHintEl = document.getElementById('timer-sub-status');
    const progressRingEl = document.getElementById('progress-indicator');

    // 제어 버튼 엘리먼트
    const startBtn = document.getElementById('start-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const resetBtn = document.getElementById('reset-btn');

    // 세션 카운터 엘리먼트
    const sessionCountNumberEl = document.getElementById('session-count-number');
    const sessionIconsContainerEl = document.getElementById('session-icons-container');
    const resetCounterBtn = document.getElementById('reset-counter-btn');

    // 백색소음 및 볼륨 제어 엘리먼트
    const soundChipBtns = document.querySelectorAll('.sound-chip-btn');
    const muteToggleBtn = document.getElementById('mute-toggle-btn');
    const muteIconEl = document.getElementById('mute-icon');
    const volumeSlider = document.getElementById('volume-slider');
    const volumePercentEl = document.getElementById('volume-percent');

    // ------------------------------------------------------------------------
    // 2. 타이머 상태 변수 정의
    // ------------------------------------------------------------------------
    let currentMode = 'FOCUS'; // 'FOCUS' 또는 'BREAK'
    let totalDuration = TIME_CONFIG.FOCUS; // 현재 세션 총 시간
    let remainingSeconds = TIME_CONFIG.FOCUS; // 남은 시간 (초)
    let isRunning = false; // 타이머 가동 여부

    // 백그라운드 탭에서도 시간 오차(Drift)가 없도록 Date.now() 타임스탬프 계산
    let timerInterval = null;
    let expectedEndTime = null;

    // 완료된 집중 세션 카운트 (LocalStorage에서 불러옴)
    let completedSessions = parseInt(localStorage.getItem('focuspulse_sessions') || '0', 10);

    // ------------------------------------------------------------------------
    // 3. 브라우저 푸시 알림 권한 사전 요청
    // ------------------------------------------------------------------------
    if ('Notification' in window && Notification.permission === 'default') {
        // 첫 사용자 클릭 시 알림 권한을 요청할 수 있도록 리스너 등록
        const requestNotifyPermission = () => {
            Notification.requestPermission();
            window.removeEventListener('click', requestNotifyPermission);
        };
        window.addEventListener('click', requestNotifyPermission);
    }

    /**
     * 시스템 알림 메시지 발송 함수
     * @param {string} title 
     * @param {string} body 
     */
    function sendSystemNotification(title, body) {
        if ('Notification' in window && Notification.permission === 'granted') {
            try {
                new Notification(title, {
                    body: body,
                    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🍅</text></svg>'
                });
            } catch (e) {
                // 비보안 컨텍스트 등의 환경 예외 처리
            }
        }
    }

    // ------------------------------------------------------------------------
    // 4. 시간 포맷팅 및 UI 렌더링 함수
    // ------------------------------------------------------------------------
    /**
     * 초를 MM:SS 형식 문자열로 변환
     * @param {number} totalSec
     * @returns {string} 예: "25:00", "04:30"
     */
    function formatTime(totalSec) {
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        const pad = (n) => n.toString().padStart(2, '0');
        return `${pad(minutes)}:${pad(seconds)}`;
    }

    /**
     * 원형 진행 링 및 화면 표시 갱신
     */
    function updateDisplay() {
        const timeStr = formatTime(remainingSeconds);
        timerDisplayEl.textContent = timeStr;
        timerDisplayEl.setAttribute('datetime', `PT${Math.floor(remainingSeconds / 60)}M${remainingSeconds % 60}S`);

        // 원형 진행 링 오프셋 계산 (남은 시간에 비례하여 게이지 표시)
        // 남은 비율 (1.0 = 100% 가득 참, 0.0 = 모두 소진)
        const progressRatio = remainingSeconds / totalDuration;
        // SVG stroke-dashoffset: 0일 때 꽉 차고, CIRCUMFERENCE일 때 비어있음
        const offset = RING_CIRCUMFERENCE * (1 - progressRatio);
        progressRingEl.style.strokeDashoffset = offset;

        // 브라우저 탭 타이틀 실시간 연동
        const modeLabel = currentMode === 'FOCUS' ? '집중 중' : '휴식 중';
        const modeIcon = currentMode === 'FOCUS' ? '🎯' : '☕';
        const runningPrefix = isRunning ? '' : '⏸️ ';
        document.title = `${runningPrefix}(${timeStr}) ${modeIcon} ${modeLabel} - FocusPulse`;
    }

    /**
     * 세션 모드에 따른 전역 테마 및 배지 UI 갱신
     */
    function applyModeTheme() {
        if (currentMode === 'FOCUS') {
            // 집중 모드: 따뜻한 코랄/다크 앰버 테마 적용
            bodyEl.className = 'theme-focus';
            modeBadgeEl.className = 'mode-badge mode-focus';
            modeTitleTextEl.textContent = '집중 세션 (25분)';
            timerStatusHintEl.textContent = isRunning 
                ? '온전히 목표에 몰입해보세요' 
                : '시작 버튼을 눌러 집중을 시작하세요';
        } else {
            // 휴식 모드: 청량한 민트/세이지 그린 테마 적용
            bodyEl.className = 'theme-break';
            modeBadgeEl.className = 'mode-badge mode-break';
            modeTitleTextEl.textContent = '휴식 시간 (5분)';
            timerStatusHintEl.textContent = isRunning 
                ? '가벼운 스트레칭과 수분 섭취를 권장합니다' 
                : '편안하게 숨을 고르며 휴식하세요';
        }
    }

    /**
     * 제어 버튼 활성화/비활성화 상태 동기화
     */
    function updateButtonStates() {
        if (isRunning) {
            startBtn.disabled = true;
            pauseBtn.disabled = false;
        } else {
            startBtn.disabled = false;
            pauseBtn.disabled = true;
        }
    }

    /**
     * 세션 카운터 UI 및 토마토 시각화 갱신
     */
    function renderSessionTracker() {
        sessionCountNumberEl.textContent = completedSessions;

        // 토마토 아이콘 렌더링
        sessionIconsContainerEl.innerHTML = '';
        if (completedSessions === 0) {
            const emptyHint = document.createElement('span');
            emptyHint.className = 'empty-hint';
            emptyHint.textContent = '첫 번째 25분 집중을 달성해보세요!';
            sessionIconsContainerEl.appendChild(emptyHint);
        } else {
            // 최대 12개까지 토마토 아이콘으로 시각화 표시 (초과 시 숫자 뱃지 형태)
            const displayCount = Math.min(completedSessions, 12);
            for (let i = 0; i < displayCount; i++) {
                const icon = document.createElement('span');
                icon.className = 'session-tomato-icon';
                icon.textContent = '🍅';
                icon.title = `${i + 1}번째 완료 세션`;
                sessionIconsContainerEl.appendChild(icon);
            }
            if (completedSessions > 12) {
                const moreBadge = document.createElement('span');
                moreBadge.className = 'count-unit';
                moreBadge.textContent = `+${completedSessions - 12}개 더 달성`;
                sessionIconsContainerEl.appendChild(moreBadge);
            }
        }
    }

    // ------------------------------------------------------------------------
    // 5. 타이머 코어 로직 (시작 / 일시정지 / 초기화 / 세션 만료 자동 전환)
    // ------------------------------------------------------------------------
    /**
     * 타이머 시작 함수
     */
    function startTimer() {
        if (isRunning) return;

        // 브라우저 AudioContext 첫 사용자 인터랙션 언락
        if (window.soundEngine) {
            window.soundEngine.initContext();
        }

        isRunning = true;
        updateButtonStates();

        // 현재 시점 기준으로 종료 예정 시각 산출 (백그라운드 지연 방지)
        expectedEndTime = Date.now() + (remainingSeconds * 1000);

        // 100ms마다 체크하여 부드럽고 정확하게 카운트다운
        timerInterval = setInterval(() => {
            const now = Date.now();
            const diffInSeconds = Math.max(0, Math.ceil((expectedEndTime - now) / 1000));

            if (diffInSeconds !== remainingSeconds) {
                remainingSeconds = diffInSeconds;
                updateDisplay();
            }

            // 시간이 모두 소진되었을 때 세션 종료 루틴 실행
            if (remainingSeconds <= 0) {
                clearInterval(timerInterval);
                timerInterval = null;
                handleSessionComplete();
            }
        }, 100);

        applyModeTheme();
    }

    /**
     * 타이머 일시정지 함수
     */
    function pauseTimer() {
        if (!isRunning) return;

        isRunning = false;
        clearInterval(timerInterval);
        timerInterval = null;

        updateButtonStates();
        updateDisplay();
        timerStatusHintEl.textContent = '타이머가 일시정지되었습니다';
    }

    /**
     * 타이머 초기화 함수
     */
    function resetTimer() {
        pauseTimer();
        // 현재 세션의 초기 기준 시간으로 리셋
        remainingSeconds = currentMode === 'FOCUS' ? TIME_CONFIG.FOCUS : TIME_CONFIG.BREAK;
        totalDuration = remainingSeconds;
        updateDisplay();
        applyModeTheme();
    }

    /**
     * 세션 종료 및 자동 전환 핸들러
     * - 25분 집중 완료 ➔ 축하 알람 ➔ 세션 카운트 +1 ➔ 5분 휴식 자동 시작
     * - 5분 휴식 완료 ➔ 휴식 종료 알람 ➔ 25분 집중 자동 시작
     */
    function handleSessionComplete() {
        if (currentMode === 'FOCUS') {
            // [1] 집중 세션 만료 처리
            // 알림 사운드 재생
            if (window.soundEngine) {
                window.soundEngine.playAlarm('focus-done');
            }

            // 데스크톱 푸시 알림 전송
            sendSystemNotification('🎉 25분 집중 완료!', '훌륭합니다! 5분간 편안하게 휴식을 취하세요.');

            // 완료 세션 카운터 증가 및 로컬스토리지 저장
            completedSessions++;
            localStorage.setItem('focuspulse_sessions', completedSessions.toString());
            renderSessionTracker();

            // 5분 휴식 모드로 상태 자동 전환
            currentMode = 'BREAK';
            totalDuration = TIME_CONFIG.BREAK;
            remainingSeconds = TIME_CONFIG.BREAK;

            // 배경색 쿨 민트 테마 전환
            applyModeTheme();
            updateDisplay();

            // 5분 휴식 타이머 자동 즉시 시작
            startTimer();

        } else {
            // [2] 5분 휴식 세션 만료 처리
            // 알림 사운드 재생
            if (window.soundEngine) {
                window.soundEngine.playAlarm('break-done');
            }

            // 데스크톱 푸시 알림 전송
            sendSystemNotification('☕ 휴식 종료!', '충전이 완료되었습니다. 다시 25분 집중을 시작합니다.');

            // 25분 집중 모드로 상태 자동 전환
            currentMode = 'FOCUS';
            totalDuration = TIME_CONFIG.FOCUS;
            remainingSeconds = TIME_CONFIG.FOCUS;

            // 배경색 웜 코랄 테마 전환
            applyModeTheme();
            updateDisplay();

            // 25분 집중 타이머 자동 즉시 시작
            startTimer();
        }
    }

    // ------------------------------------------------------------------------
    // 6. 이벤트 리스너 등록
    // ------------------------------------------------------------------------
    // 타이머 제어 버튼 클릭 이벤트
    startBtn.addEventListener('click', startTimer);
    pauseBtn.addEventListener('click', pauseTimer);
    resetBtn.addEventListener('click', resetTimer);

    // 세션 카운터 기록 초기화 버튼 클릭
    resetCounterBtn.addEventListener('click', () => {
        if (completedSessions > 0) {
            const confirmed = confirm('완료한 집중 세션 기록을 초기화하시겠습니까?');
            if (confirmed) {
                completedSessions = 0;
                localStorage.setItem('focuspulse_sessions', '0');
                renderSessionTracker();
            }
        }
    });

    // 백색소음 칩 선택 토글 이벤트
    soundChipBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const soundType = btn.getAttribute('data-sound');
            if (!window.soundEngine) return;

            const isPlaying = window.soundEngine.toggleSound(soundType);

            // 모든 칩 활성화 상태 초기화 후 현재 선택된 칩에 active 클래스 토글
            soundChipBtns.forEach(b => b.classList.remove('active'));
            if (isPlaying) {
                btn.classList.add('active');
            }
        });
    });

    // 볼륨 조절 슬라이더 이벤트
    volumeSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        volumePercentEl.textContent = `${val}%`;

        if (window.soundEngine) {
            window.soundEngine.setVolume(val);
        }

        // 볼륨이 0이면 음소거 아이콘으로 변경
        if (val === 0) {
            muteIconEl.textContent = '🔇';
        } else {
            muteIconEl.textContent = '🔊';
        }
    });

    // 음소거 토글 버튼 이벤트
    muteToggleBtn.addEventListener('click', () => {
        if (!window.soundEngine) return;
        const isMuted = window.soundEngine.toggleMute();

        if (isMuted) {
            muteIconEl.textContent = '🔇';
            muteToggleBtn.title = '음소거 해제';
        } else {
            muteIconEl.textContent = '🔊';
            muteToggleBtn.title = '음소거';
        }
    });

    // 키보드 단축키 지원 (Space: 시작/일시정지, R: 초기화)
    window.addEventListener('keydown', (e) => {
        // 인풋이나 슬라이더에 포커스가 있을 때는 단축키 무시
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.code === 'Space') {
            e.preventDefault(); // 스크롤 방지
            if (isRunning) {
                pauseTimer();
            } else {
                startTimer();
            }
        } else if (e.code === 'KeyR') {
            resetTimer();
        }
    });

    // ------------------------------------------------------------------------
    // 7. 앱 초기화 구동
    // ------------------------------------------------------------------------
    applyModeTheme();
    updateDisplay();
    updateButtonStates();
    renderSessionTracker();
});
