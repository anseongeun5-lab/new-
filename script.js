/**
 * ============================================================================
 * FocusPulse 포모도로 타이머 메인 컨트롤러 (script.js)
 * ----------------------------------------------------------------------------
 * 1. 8단계 타이머 상태 머신(State Machine) 완벽 구현:
 *    - focus_ready: 집중 시작 대기 (25분 집중 시작 버튼 활성화)
 *    - focus_running: 집중 진행 (일시정지 버튼 활성화)
 *    - focus_paused: 집중 일시정지 (계속하기 버튼 활성화)
 *    - focus_completed: 집중 완료 (세션 +1, 5분 휴식 시작 버튼 활성화)
 *    - break_ready: 휴식 시작 대기 (5분 휴식 시작 버튼 활성화)
 *    - break_running: 휴식 진행 (일시정지 버튼 활성화)
 *    - break_paused: 휴식 일시정지 (계속하기 버튼 활성화)
 *    - break_completed: 휴식 완료 (25분 집중 시작 버튼 활성화)
 * 2. 무한 순환 지원: 25분 집중 ➔ 5분 휴식 ➔ 25분 집중 (무한 반복)
 * 3. Date.now() 기반 백그라운드 드리프트 없는 정밀 타이머
 * 4. SVG 원형 프로그레스 링 오프셋 실시간 연동
 * 5. Web Audio API 사운드 엔진 및 알람 연동
 * 6. LocalStorage 기반 세션 카운터 영구 저장 및 토마토 시각화
 * 7. 키보드 단축키 (Space: 시작/일시정지/계속하기, R: 초기화)
 * ============================================================================
 */

// 엄격 모드 활성화로 런타임 오류 방지 및 안정성 확보
'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // ------------------------------------------------------------------------
    // 1. 상수 정의 및 URL 테스트 파라미터 확인
    // ------------------------------------------------------------------------
    // 테스트 환경 편의를 위한 URL 파라미터 감지 (?fastTest=true 설정 시 3초/2초 고속 테스트 가능)
    const urlParams = new URLSearchParams(window.location.search);
    const isFastTest = urlParams.get('fastTest') === 'true';

    // 포모도로 기본 시간 설정 (테스트 모드: 3초/2초, 실운영: 25분=1500초, 5분=300초)
    const TIME_CONFIG = {
        FOCUS: isFastTest ? 3 : 25 * 60, // 집중 시간 (초)
        BREAK: isFastTest ? 2 : 5 * 60   // 휴식 시간 (초)
    };

    // 지시서에 명시된 8가지 타이머 상태 상수 정의
    const TIMER_STATES = {
        FOCUS_READY: 'focus_ready',         // 집중 시작 대기
        FOCUS_RUNNING: 'focus_running',     // 집중 진행
        FOCUS_PAUSED: 'focus_paused',       // 집중 일시정지
        FOCUS_COMPLETED: 'focus_completed', // 집중 완료
        BREAK_READY: 'break_ready',         // 휴식 시작 대기
        BREAK_RUNNING: 'break_running',     // 휴식 진행
        BREAK_PAUSED: 'break_paused',       // 휴식 일시정지
        BREAK_COMPLETED: 'break_completed'  // 휴식 완료
    };

    // 원형 프로그레스 링의 원주 길이 (r=145 기준: 2 * Math.PI * 145 ≈ 911.06)
    const RING_CIRCUMFERENCE = 2 * Math.PI * 145;

    // ------------------------------------------------------------------------
    // 2. DOM 엘리먼트 캐싱
    // ------------------------------------------------------------------------
    const bodyEl = document.body; // 전체 배경 테마 전환을 위한 body 엘리먼트
    const modeBadgeEl = document.getElementById('mode-badge'); // 상단 모드 배지 래퍼
    const modeTitleTextEl = document.getElementById('mode-title-text'); // 모드 배지 텍스트
    const timerDisplayEl = document.getElementById('timer-display'); // MM:SS 디지털 시계 표시 요소
    const timerStatusHintEl = document.getElementById('timer-sub-status'); // 타이머 하단 안내 문구 요소
    const progressRingEl = document.getElementById('progress-indicator'); // SVG 원형 프로그레스 바 요소

    // 타이머 제어 버튼 요소
    const startBtn = document.getElementById('start-btn'); // 시작 / 재개 / 다음 세션 시작 버튼
    const pauseBtn = document.getElementById('pause-btn'); // 일시정지 버튼
    const resetBtn = document.getElementById('reset-btn'); // 초기화 버튼

    // 세션 카운터 및 토마토 표시 요소
    const sessionCountNumberEl = document.getElementById('session-count-number'); // 완료 세션 숫자
    const sessionIconsContainerEl = document.getElementById('session-icons-container'); // 토마토 아이콘 컨테이너
    const resetCounterBtn = document.getElementById('reset-counter-btn'); // 세션 통계 전용 초기화 버튼

    // 백색소음 및 볼륨 제어 요소
    const soundChipBtns = document.querySelectorAll('.sound-chip-btn'); // 백색소음 토글 버튼 목록
    const muteToggleBtn = document.getElementById('mute-toggle-btn'); // 음소거 토글 버튼
    const muteIconEl = document.getElementById('mute-icon'); // 음소거 아이콘
    const volumeSlider = document.getElementById('volume-slider'); // 볼륨 슬라이더
    const volumePercentEl = document.getElementById('volume-percent'); // 볼륨 퍼센트 표시 텍스트

    // ------------------------------------------------------------------------
    // 3. 타이머 상태 및 런타임 변수
    // ------------------------------------------------------------------------
    // 현재 타이머 상태 (초기 상태: focus_ready)
    let timerState = TIMER_STATES.FOCUS_READY;
    // 현재 세션 모드 ('FOCUS' 또는 'BREAK')
    let currentMode = 'FOCUS';
    // 현재 진행 중인 세션의 총 시간 (초)
    let totalDuration = TIME_CONFIG.FOCUS;
    // 현재 남은 시간 (초)
    let remainingSeconds = TIME_CONFIG.FOCUS;

    // 카운트다운 타이머 인터벌 ID 및 예상 종료 시각
    let timerInterval = null; // setInterval 핸들
    let expectedEndTime = null; // Date.now() 기준 정확한 종료 시각 타임스탬프

    // 완료된 집중 세션 카운트 (로컬스토리지에서 기존 기록 불러오기)
    let completedSessions = parseInt(localStorage.getItem('focuspulse_sessions') || '0', 10);

    // ------------------------------------------------------------------------
    // 4. 시스템 브라우저 푸시 알림 권한 처리
    // ------------------------------------------------------------------------
    // 브라우저가 알림 API를 지원하고 권한이 기본 상태일 때 최초 클릭 시 권한 요청
    if ('Notification' in window && Notification.permission === 'default') {
        const requestNotifyPermission = () => {
            Notification.requestPermission(); // 권한 팝업 호출
            window.removeEventListener('click', requestNotifyPermission); // 1회 요청 후 리스너 제거
        };
        window.addEventListener('click', requestNotifyPermission); // 창 클릭 시 1회 실행
    }

    /**
     * 시스템 알림 메시지 발송 함수
     * @param {string} title - 알림 제목
     * @param {string} body - 알림 본문 메시지
     */
    function sendSystemNotification(title, body) {
        if ('Notification' in window && Notification.permission === 'granted') {
            try {
                // 브라우저 데스크톱 알림 생성
                new Notification(title, {
                    body: body, // 알림 내용
                    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🍅</text></svg>'
                });
            } catch (e) {
                // 권한 거부 또는 보안 컨텍스트 예외 처리
            }
        }
    }

    // ------------------------------------------------------------------------
    // 5. 버튼 및 UI 렌더링 헬퍼 함수
    // ------------------------------------------------------------------------
    /**
     * 초를 MM:SS 형식 문자열로 변환
     * @param {number} totalSec - 변환할 초 단위 시간
     * @returns {string} - "25:00", "05:00" 형태의 문자열
     */
    function formatTime(totalSec) {
        const minutes = Math.floor(Math.max(0, totalSec) / 60); // 분 계산
        const seconds = Math.floor(Math.max(0, totalSec) % 60); // 초 계산
        const pad = (n) => n.toString().padStart(2, '0'); // 2자리 패딩
        return `${pad(minutes)}:${pad(seconds)}`; // 포맷 문자열 반환
    }

    /**
     * 버튼의 아이콘, 라벨 텍스트, 비활성화(disabled) 속성을 일괄 업데이트
     * @param {HTMLButtonElement} button - 대상 버튼 엘리먼트
     * @param {string} iconText - 아이콘 텍스트 (예: '▶', '⏸', '☕')
     * @param {string} labelText - 버튼 라벨 텍스트 (예: '25분 집중 시작')
     * @param {boolean} isDisabled - disabled 속성 적용 여부
     */
    function updateControlBtn(button, iconText, labelText, isDisabled) {
        const iconEl = button.querySelector('.btn-icon'); // 아이콘 요소 검색
        const labelEl = button.querySelector('.btn-label'); // 라벨 텍스트 요소 검색
        if (iconEl) iconEl.textContent = iconText; // 아이콘 텍스트 갱신
        if (labelEl) labelEl.textContent = labelText; // 라벨 텍스트 갱신
        button.disabled = isDisabled; // 활성화/비활성화 상태 적용
        button.title = `${labelText} (스페이스바)`; // 툴팁 텍스트 동기화
    }

    /**
     * 화면 중앙 디지털 시간 및 SVG 원형 프로그레스 링 갱신
     */
    function updateDisplay() {
        const timeStr = formatTime(remainingSeconds); // MM:SS 문자열 생성
        timerDisplayEl.textContent = timeStr; // 대형 디지털 타이머 텍스트 갱신
        timerDisplayEl.setAttribute('datetime', `PT${Math.floor(remainingSeconds / 60)}M${remainingSeconds % 60}S`); // 접근성 datetime 속성 갱신

        // 원형 진행 링 오프셋 계산 (남은 시간 비율에 비례)
        const safeTotalDuration = totalDuration > 0 ? totalDuration : (currentMode === 'FOCUS' ? TIME_CONFIG.FOCUS : TIME_CONFIG.BREAK);
        const progressRatio = Math.max(0, Math.min(1, remainingSeconds / safeTotalDuration)); // 0.0 ~ 1.0 범위 제한
        // SVG stroke-dashoffset: 0일 때 100% 가득 참, RING_CIRCUMFERENCE일 때 0% 비어있음
        const offset = RING_CIRCUMFERENCE * (1 - progressRatio); // 오프셋 계산
        progressRingEl.style.strokeDashoffset = offset; // SVG 원형 링 진행도 반영

        // 브라우저 탭 타이틀 실시간 연동 (가동 상태 및 모드 직관적 표시)
        const modeLabel = currentMode === 'FOCUS' ? '집중' : '휴식'; // 모드명
        const isRunning = (timerState === TIMER_STATES.FOCUS_RUNNING || timerState === TIMER_STATES.BREAK_RUNNING); // 동작 여부
        const statePrefix = isRunning ? '' : '⏸️ '; // 일시정지 시 접두사
        const icon = currentMode === 'FOCUS' ? '🎯' : '☕'; // 모드 아이콘
        document.title = `${statePrefix}(${timeStr}) ${icon} ${modeLabel} - FocusPulse`; // 탭 타이틀 설정
    }

    /**
     * 완료된 집중 세션 통계 및 토마토 아이콘 렌더링
     */
    function renderSessionTracker() {
        sessionCountNumberEl.textContent = completedSessions; // 총 완료 횟수 표시
        sessionIconsContainerEl.innerHTML = ''; // 기존 아이콘 컨테이너 초기화

        if (completedSessions === 0) {
            // 완료 세션이 0개일 때 안내 문구 노출
            const emptyHint = document.createElement('span'); // 스팬 생성
            emptyHint.className = 'empty-hint'; // 스타일 클래스
            emptyHint.textContent = '첫 번째 25분 집중을 달성해보세요!'; // 문구 지정
            sessionIconsContainerEl.appendChild(emptyHint); // DOM 추가
        } else {
            // 완료 세션이 1개 이상일 때 토마토 아이콘으로 시각화 (최대 12개)
            const displayCount = Math.min(completedSessions, 12); // 최대 12개 제한
            for (let i = 0; i < displayCount; i++) {
                const icon = document.createElement('span'); // 토마토 요소 생성
                icon.className = 'session-tomato-icon'; // 스타일 클래스
                icon.textContent = '🍅'; // 토마토 이모지
                icon.title = `${i + 1}번째 완료 세션`; // 툴팁
                sessionIconsContainerEl.appendChild(icon); // DOM 추가
            }
            if (completedSessions > 12) {
                // 12개 초과 시 추가 달성 뱃지 생성
                const moreBadge = document.createElement('span'); // 뱃지 요소 생성
                moreBadge.className = 'count-unit'; // 스타일 클래스
                moreBadge.textContent = `+${completedSessions - 12}개 더 달성`; // 텍스트 지정
                sessionIconsContainerEl.appendChild(moreBadge); // DOM 추가
            }
        }
    }

    // ------------------------------------------------------------------------
    // 6. 단일 상태 관리자 (State Machine) 및 UI 동기화
    // ------------------------------------------------------------------------
    /**
     * 타이머 상태를 전이하고, 각 상태에 맞는 UI를 일괄 동기화하는 핵심 함수
     * @param {string} newState - 전이할 TIMER_STATES 상수
     */
    function setTimerState(newState) {
        timerState = newState; // 상태 변수 갱신

        switch (newState) {
            // [1] 집중 시작 대기 상태
            case TIMER_STATES.FOCUS_READY:
                currentMode = 'FOCUS'; // 집중 모드 지정
                totalDuration = TIME_CONFIG.FOCUS; // 총 25분(또는 테스트 시간)
                remainingSeconds = TIME_CONFIG.FOCUS; // 남은 시간 25분으로 리셋
                bodyEl.className = 'theme-focus'; // 웜 코랄 다크 테마 적용
                modeBadgeEl.className = 'mode-badge mode-focus'; // 집중 모드 뱃지 스타일
                modeTitleTextEl.textContent = isFastTest ? '집중 세션 (테스트 모드)' : '집중 세션 (25분)'; // 뱃지 텍스트
                timerStatusHintEl.textContent = '시작 버튼을 눌러 집중을 시작하세요'; // 상태 힌트
                updateControlBtn(startBtn, '▶', '25분 집중 시작', false); // 시작 버튼 활성화
                updateControlBtn(pauseBtn, '⏸', '일시정지', true); // 일시정지 버튼 비활성화
                resetBtn.disabled = false; // 초기화 버튼 활성화
                updateDisplay(); // 화면 시간 및 게이지 갱신
                break;

            // [2] 집중 진행 중 상태
            case TIMER_STATES.FOCUS_RUNNING:
                currentMode = 'FOCUS'; // 집중 모드 유지
                bodyEl.className = 'theme-focus'; // 웜 코랄 다크 테마 유지
                modeBadgeEl.className = 'mode-badge mode-focus'; // 집중 모드 뱃지 스타일
                modeTitleTextEl.textContent = isFastTest ? '집중 진행 중 (테스트)' : '집중 진행 중 (25분)'; // 뱃지 텍스트
                timerStatusHintEl.textContent = '온전히 목표에 몰입해보세요'; // 몰입 안내 문구
                updateControlBtn(startBtn, '▶', '집중 진행 중', true); // 시작 버튼 비활성화
                updateControlBtn(pauseBtn, '⏸', '일시정지', false); // 일시정지 버튼 활성화
                resetBtn.disabled = false; // 초기화 버튼 활성화
                break;

            // [3] 집중 일시정지 상태
            case TIMER_STATES.FOCUS_PAUSED:
                timerStatusHintEl.textContent = '타이머가 일시정지되었습니다'; // 일시정지 힌트
                updateControlBtn(startBtn, '▶', '계속하기', false); // 시작 버튼 ➔ 계속하기로 변경 및 활성화
                updateControlBtn(pauseBtn, '⏸', '일시정지', true); // 일시정지 버튼 비활성화
                resetBtn.disabled = false; // 초기화 버튼 활성화
                updateDisplay(); // 일시정지된 시간 반영
                break;

            // [4] 집중 완료 상태 (25분 집중 종료 시점)
            case TIMER_STATES.FOCUS_COMPLETED:
                remainingSeconds = 0; // 00:00으로 안전하게 고정
                bodyEl.className = 'theme-break'; // 다음 휴식을 유도하는 청량한 민트 테마 적용
                modeBadgeEl.className = 'mode-badge mode-break'; // 휴식 배지 스타일
                modeTitleTextEl.textContent = '집중 완료 (휴식 대기)'; // 상태 배지 텍스트
                timerStatusHintEl.textContent = '🎉 25분 집중 완료! 5분 휴식을 시작해보세요'; // 완료 축하 및 휴식 유도 문구
                updateControlBtn(startBtn, '☕', '5분 휴식 시작', false); // 핵심: 5분 휴식 시작 버튼 활성화!
                updateControlBtn(pauseBtn, '⏸', '일시정지', true); // 일시정지 버튼 비활성화
                resetBtn.disabled = false; // 초기화 버튼 활성화
                updateDisplay(); // 00:00 화면 렌더링
                break;

            // [5] 휴식 시작 대기 상태 (초기화 등으로 대기 진입 시)
            case TIMER_STATES.BREAK_READY:
                currentMode = 'BREAK'; // 휴식 모드 지정
                totalDuration = TIME_CONFIG.BREAK; // 총 5분(또는 테스트 시간)
                remainingSeconds = TIME_CONFIG.BREAK; // 남은 시간 5분으로 리셋
                bodyEl.className = 'theme-break'; // 청량한 민트 테마 적용
                modeBadgeEl.className = 'mode-badge mode-break'; // 휴식 배지 스타일
                modeTitleTextEl.textContent = isFastTest ? '휴식 세션 (테스트 모드)' : '휴식 시간 (5분)'; // 배지 텍스트
                timerStatusHintEl.textContent = '편안하게 숨을 고르며 휴식하세요'; // 상태 힌트
                updateControlBtn(startBtn, '☕', '5분 휴식 시작', false); // 5분 휴식 시작 버튼 활성화
                updateControlBtn(pauseBtn, '⏸', '일시정지', true); // 일시정지 버튼 비활성화
                resetBtn.disabled = false; // 초기화 버튼 활성화
                updateDisplay(); // 05:00 화면 렌더링
                break;

            // [6] 휴식 진행 중 상태
            case TIMER_STATES.BREAK_RUNNING:
                currentMode = 'BREAK'; // 휴식 모드 유지
                bodyEl.className = 'theme-break'; // 청량한 민트 테마 유지
                modeBadgeEl.className = 'mode-badge mode-break'; // 휴식 배지 스타일
                modeTitleTextEl.textContent = isFastTest ? '휴식 진행 중 (테스트)' : '휴식 진행 중 (5분)'; // 배지 텍스트
                timerStatusHintEl.textContent = '가벼운 스트레칭과 수분 섭취를 권장합니다'; // 휴식 가이드 문구
                updateControlBtn(startBtn, '☕', '휴식 진행 중', true); // 시작 버튼 비활성화
                updateControlBtn(pauseBtn, '⏸', '일시정지', false); // 일시정지 버튼 활성화
                resetBtn.disabled = false; // 초기화 버튼 활성화
                break;

            // [7] 휴식 일시정지 상태
            case TIMER_STATES.BREAK_PAUSED:
                timerStatusHintEl.textContent = '휴식 타이머가 일시정지되었습니다'; // 일시정지 힌트
                updateControlBtn(startBtn, '▶', '계속하기', false); // 시작 버튼 ➔ 계속하기로 변경 및 활성화
                updateControlBtn(pauseBtn, '⏸', '일시정지', true); // 일시정지 버튼 비활성화
                resetBtn.disabled = false; // 초기화 버튼 활성화
                updateDisplay(); // 일시정지된 시간 반영
                break;

            // [8] 휴식 완료 상태 (5분 휴식 종료 시점)
            case TIMER_STATES.BREAK_COMPLETED:
                remainingSeconds = 0; // 00:00으로 안전하게 고정
                bodyEl.className = 'theme-focus'; // 다시 집중으로 유도하는 웜 코랄 테마 적용
                modeBadgeEl.className = 'mode-badge mode-focus'; // 집중 모드 배지 스타일
                modeTitleTextEl.textContent = '휴식 완료 (집중 대기)'; // 상태 배지 텍스트
                timerStatusHintEl.textContent = '☕ 휴식 완료! 다시 25분 집중을 시작할 준비가 되셨나요?'; // 휴식 완료 안내
                updateControlBtn(startBtn, '▶', '25분 집중 시작', false); // 핵심: 25분 집중 시작 버튼 활성화!
                updateControlBtn(pauseBtn, '⏸', '일시정지', true); // 일시정지 버튼 비활성화
                resetBtn.disabled = false; // 초기화 버튼 활성화
                updateDisplay(); // 00:00 화면 렌더링
                break;

            default:
                break;
        }
    }

    // ------------------------------------------------------------------------
    // 7. 정밀 타이머 인터벌 제어 엔진
    // ------------------------------------------------------------------------
    /**
     * 실행 중인 모든 카운트다운 인터벌과 타임스탬프를 안전하게 정리
     */
    function clearTimerEngine() {
        if (timerInterval !== null) {
            clearInterval(timerInterval); // 이전 타이머 인터벌 클리어
            timerInterval = null; // 인터벌 핸들 null 초기화
        }
        expectedEndTime = null; // 종료 예정 시각 초기화
    }

    /**
     * 카운트다운 루프 구동 함수 (Date.now() 기준 드리프트 없는 초정밀 계산)
     */
    function startCountdownEngine() {
        // 기존 인터벌이 남아있다면 반드시 먼저 정리하여 중복 실행 원천 차단
        clearTimerEngine();

        // 브라우저 AudioContext 첫 사용자 인터랙션 언락 보장
        if (window.soundEngine) {
            window.soundEngine.initContext();
        }

        // 현재 시각 기준 예상 종료 시점 타임스탬프 산출
        expectedEndTime = Date.now() + (remainingSeconds * 1000);

        // 100ms마다 체크하여 오차 없이 부드러운 카운트다운 실행
        timerInterval = setInterval(() => {
            const now = Date.now(); // 현재 시각 밀리초
            // 종료 예정 시각과의 차이로 남은 초 계산 (0 이하로 내려가지 않도록 Math.max 처리)
            const diffInSeconds = Math.max(0, Math.ceil((expectedEndTime - now) / 1000));

            // 초 단위 변화가 있을 때만 DOM 디스플레이 갱신 (불필요한 렌더링 방지)
            if (diffInSeconds !== remainingSeconds) {
                remainingSeconds = diffInSeconds; // 남은 시간 갱신
                updateDisplay(); // 화면 표시 갱신
            }

            // 시간이 00:00에 도달했을 때 세션 만료 핸들러 실행
            if (remainingSeconds <= 0) {
                clearTimerEngine(); // 즉시 인터벌 정리
                handleTimerFinished(); // 세션 완료 이벤트 처리
            }
        }, 100);
    }

    /**
     * 세션 만료 시(시간이 00:00에 도달했을 때) 호출되는 핸들러
     * - 집중 완료 시: 토마토 1회 증가 및 5분 휴식 시작 버튼 활성화
     * - 휴식 완료 시: 세션 횟수 증가 없이 25분 집중 시작 버튼 활성화
     */
    function handleTimerFinished() {
        if (timerState === TIMER_STATES.FOCUS_RUNNING) {
            // [1] 집중 세션 만료 처리
            // 집중 완료 축하 차임벨 알림 사운드 재생
            if (window.soundEngine) {
                window.soundEngine.playAlarm('focus-done');
            }

            // 데스크톱 푸시 알림 전송
            sendSystemNotification('🎉 25분 집중 완료!', '훌륭합니다! 이제 5분 휴식 시작 버튼을 눌러 휴식을 취하세요.');

            // 완료한 집중 세션 카운트 1회 증가 및 영구 저장
            completedSessions++;
            localStorage.setItem('focuspulse_sessions', completedSessions.toString());
            renderSessionTracker(); // 토마토 아이콘 즉시 갱신

            // 타이머 상태를 집중 완료(focus_completed)로 전이 (5분 휴식 시작 버튼 활성화)
            setTimerState(TIMER_STATES.FOCUS_COMPLETED);

        } else if (timerState === TIMER_STATES.BREAK_RUNNING) {
            // [2] 휴식 세션 만료 처리
            // 휴식 종료 알림 차임벨 사운드 재생
            if (window.soundEngine) {
                window.soundEngine.playAlarm('break-done');
            }

            // 데스크톱 푸시 알림 전송
            sendSystemNotification('☕ 휴식 종료!', '충전이 완료되었습니다. 다시 25분 집중을 시작할 수 있습니다.');

            // 지시서 준수: 휴식 완료 시에는 집중 세션 횟수가 증가하지 않음!
            // 타이머 상태를 휴식 완료(break_completed)로 전이 (25분 집중 시작 버튼 활성화)
            setTimerState(TIMER_STATES.BREAK_COMPLETED);
        }
    }

    // ------------------------------------------------------------------------
    // 8. 사용자 인터랙션 제어 핸들러 (시작 / 일시정지 / 계속하기 / 초기화)
    // ------------------------------------------------------------------------
    /**
     * 시작/계속하기/다음단계 시작 버튼 클릭 시의 상태 전이 핸들러
     */
    function handleStartButtonClick() {
        switch (timerState) {
            // ① 집중 시작 대기 ➔ 집중 시작
            case TIMER_STATES.FOCUS_READY:
                remainingSeconds = TIME_CONFIG.FOCUS; // 25분 시간 확정
                totalDuration = TIME_CONFIG.FOCUS; // 전체 길이 확정
                setTimerState(TIMER_STATES.FOCUS_RUNNING); // 상태를 집중 진행으로 변경
                startCountdownEngine(); // 카운트다운 구동
                break;

            // ② 집중 일시정지 ➔ 계속하기
            case TIMER_STATES.FOCUS_PAUSED:
                setTimerState(TIMER_STATES.FOCUS_RUNNING); // 집중 진행으로 복귀
                startCountdownEngine(); // 남은 시간부터 재개
                break;

            // ③ 집중 완료 ➔ 사용자가 '5분 휴식 시작' 버튼 클릭
            case TIMER_STATES.FOCUS_COMPLETED:
            case TIMER_STATES.BREAK_READY:
                currentMode = 'BREAK'; // 휴식 모드로 전환
                remainingSeconds = TIME_CONFIG.BREAK; // 5분(300초)으로 시간 설정
                totalDuration = TIME_CONFIG.BREAK; // 휴식 전체 시간 설정
                setTimerState(TIMER_STATES.BREAK_RUNNING); // 상태를 휴식 진행으로 변경
                startCountdownEngine(); // 5분 카운트다운 시작
                break;

            // ④ 휴식 일시정지 ➔ 계속하기
            case TIMER_STATES.BREAK_PAUSED:
                setTimerState(TIMER_STATES.BREAK_RUNNING); // 휴식 진행으로 복귀
                startCountdownEngine(); // 남은 시간부터 재개
                break;

            // ⑤ 휴식 완료 ➔ 사용자가 '25분 집중 시작' 버튼 클릭 (무한 순환)
            case TIMER_STATES.BREAK_COMPLETED:
                currentMode = 'FOCUS'; // 집중 모드로 전환
                remainingSeconds = TIME_CONFIG.FOCUS; // 다시 25분(1500초)으로 시간 변경
                totalDuration = TIME_CONFIG.FOCUS; // 집중 전체 시간 설정
                setTimerState(TIMER_STATES.FOCUS_RUNNING); // 상태를 집중 진행으로 변경
                startCountdownEngine(); // 다시 25분 카운트다운 정상 시작
                break;

            default:
                break;
        }
    }

    /**
     * 일시정지 버튼 클릭 시의 핸들러
     */
    function handlePauseButtonClick() {
        if (timerState === TIMER_STATES.FOCUS_RUNNING) {
            // 집중 진행 중 ➔ 집중 일시정지
            clearTimerEngine(); // 카운트다운 인터벌 정지
            setTimerState(TIMER_STATES.FOCUS_PAUSED); // 일시정지 상태로 변경 (계속하기 버튼 활성화)
        } else if (timerState === TIMER_STATES.BREAK_RUNNING) {
            // 휴식 진행 중 ➔ 휴식 일시정지
            clearTimerEngine(); // 카운트다운 인터벌 정지
            setTimerState(TIMER_STATES.BREAK_PAUSED); // 일시정지 상태로 변경 (계속하기 버튼 활성화)
        }
    }

    /**
     * 초기화(Reset) 버튼 클릭 핸들러 (지시서 5번 준수)
     * - 현재 진행 중인 타이머 중단
     * - 현재 해당 모드의 기본 시간으로 복원
     * - 시작 버튼 다시 활성화
     * - 세션 통계 기록은 삭제하지 않고 유지
     */
    function handleResetButtonClick() {
        clearTimerEngine(); // 실행 중인 인터벌 즉시 제거

        // 현재 상태가 집중 계열(ready, running, paused, completed)인지 여부 확인
        const isFocusGroup = (
            timerState === TIMER_STATES.FOCUS_READY ||
            timerState === TIMER_STATES.FOCUS_RUNNING ||
            timerState === TIMER_STATES.FOCUS_PAUSED ||
            timerState === TIMER_STATES.FOCUS_COMPLETED
        );

        if (isFocusGroup) {
            // 집중 관련 상태에서의 초기화: 25:00 집중 시작 대기 상태로 복원
            setTimerState(TIMER_STATES.FOCUS_READY);
        } else {
            // 휴식 관련 상태에서의 초기화: 05:00 휴식 시작 대기 상태로 복원
            setTimerState(TIMER_STATES.BREAK_READY);
        }
    }

    // ------------------------------------------------------------------------
    // 9. 이벤트 리스너 등록
    // ------------------------------------------------------------------------
    // 주 제어 버튼 클릭 이벤트 등록
    startBtn.addEventListener('click', handleStartButtonClick); // 시작/재개/전환 버튼
    pauseBtn.addEventListener('click', handlePauseButtonClick); // 일시정지 버튼
    resetBtn.addEventListener('click', handleResetButtonClick); // 타이머 초기화 버튼

    // 완료된 세션 기록 별도 초기화 버튼 클릭 이벤트
    resetCounterBtn.addEventListener('click', () => {
        if (completedSessions > 0) {
            // 사용자 확인 대화상자 표시
            const confirmed = confirm('완료한 집중 세션 기록을 초기화하시겠습니까?');
            if (confirmed) {
                completedSessions = 0; // 카운트 0으로 초기화
                localStorage.setItem('focuspulse_sessions', '0'); // 로컬스토리지 갱신
                renderSessionTracker(); // 토마토 아이콘 UI 즉시 갱신
            }
        }
    });

    // 백색소음 토글 칩 버튼 클릭 이벤트
    soundChipBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const soundType = btn.getAttribute('data-sound'); // 음원 타입 식별자
            if (!window.soundEngine) return;

            // 브라우저 오디오 권한 언락
            window.soundEngine.initContext();

            // 선택된 사운드 토글 재생
            const isPlaying = window.soundEngine.toggleSound(soundType);

            // 칩 버튼 활성화 스타일 업데이트
            soundChipBtns.forEach(b => b.classList.remove('active'));
            if (isPlaying) {
                btn.classList.add('active'); // 활성화 클래스 부여
            }
        });
    });

    // 볼륨 조절 슬라이더 이벤트
    volumeSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10); // 슬라이더 값
        volumePercentEl.textContent = `${val}%`; // 퍼센트 텍스트 갱신

        if (window.soundEngine) {
            window.soundEngine.setVolume(val); // 사운드 엔진 볼륨 적용
        }

        // 음량에 따른 아이콘 변경
        muteIconEl.textContent = val === 0 ? '🔇' : '🔊';
    });

    // 음소거 토글 버튼 이벤트
    muteToggleBtn.addEventListener('click', () => {
        if (!window.soundEngine) return;
        const isMuted = window.soundEngine.toggleMute(); // 사운드 엔진 음소거 토글

        // 음소거 상태에 따라 아이콘 및 툴팁 갱신
        if (isMuted) {
            muteIconEl.textContent = '🔇';
            muteToggleBtn.title = '음소거 해제';
        } else {
            muteIconEl.textContent = '🔊';
            muteToggleBtn.title = '음소거';
        }
    });

    // 키보드 단축키 지원 (스페이스바: 시작/일시정지/계속하기, R: 초기화)
    window.addEventListener('keydown', (e) => {
        // 인풋이나 슬라이더에 포커스가 있을 때는 단축키 입력 방지
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.code === 'Space') {
            e.preventDefault(); // 웹 페이지 스크롤 방지
            // 실행 중이면 일시정지, 그 외 상태면 시작/계속하기 실행
            if (timerState === TIMER_STATES.FOCUS_RUNNING || timerState === TIMER_STATES.BREAK_RUNNING) {
                handlePauseButtonClick();
            } else {
                handleStartButtonClick();
            }
        } else if (e.code === 'KeyR') {
            handleResetButtonClick(); // 초기화 실행
        }
    });

    // ------------------------------------------------------------------------
    // 10. 테스트 검증용 전역 훅 (테스트 자동화 및 상태 확인용)
    // ------------------------------------------------------------------------
    window.__focusPulseTest = {
        getState: () => timerState, // 현재 상태 확인
        getRemainingSeconds: () => remainingSeconds, // 남은 시간 확인
        getCompletedSessions: () => completedSessions, // 세션 횟수 확인
        setFastTime: (focusSec, breakSec) => { // 테스트 시간 동적 설정
            TIME_CONFIG.FOCUS = focusSec;
            TIME_CONFIG.BREAK = breakSec;
        },
        fastForward: (seconds) => { // 테스트 가속을 위한 타임스탬프 앞당기기
            if (expectedEndTime) {
                expectedEndTime -= (seconds * 1000);
            }
        },
        triggerStart: handleStartButtonClick, // 시작 트리거
        triggerPause: handlePauseButtonClick, // 일시정지 트리거
        triggerReset: handleResetButtonClick // 초기화 트리거
    };

    // ------------------------------------------------------------------------
    // 11. 앱 최초 로드 시 초기화 구동
    // ------------------------------------------------------------------------
    setTimerState(TIMER_STATES.FOCUS_READY); // 최초 상태를 focus_ready로 설정
    renderSessionTracker(); // 저장된 세션 카운트 및 토마토 렌더링
});
