/**
 * ============================================================================
 * FocusPulse 오디오 엔진 모듈 (Web Audio API 기반)
 * ----------------------------------------------------------------------------
 * 1. 백색소음 실시간 오디오 신디사이징:
 *    - 파도(Ocean Waves): 핑크 노이즈 + LFO 필터/게인 변조로 밀물과 썰물 시뮬레이션
 *    - 빗소리(Rainfall): 필터링된 핑크 노이즈로 쏟아지는 차분한 빗소리 구현
 *    - 새소리(Birds Chirping): 주파수 변조(FM) 알고리즘 기반 청아한 숲속 새소리 생성
 * 2. 세션 종료 알림 차임벨(Alarm Chime):
 *    - 집중 완료(Focus Complete) & 휴식 완료(Break Complete) 축하 멜로디 생성
 * 3. 마스터 볼륨 및 음소거(Mute) 완벽 제어
 * ============================================================================
 */

class SoundEngine {
    constructor() {
        // 브라우저 AudioContext 초기화 (웹 표준 및 웹킷 지원)
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = null;
        this.AudioContextClass = AudioCtx;

        // 마스터 게인 노드 (전체 백색소음 볼륨 제어)
        this.masterGain = null;
        // 알림음 전용 게인 노드 (백색소음 볼륨과 독립적 재생 보장)
        this.alarmGain = null;

        // 현재 볼륨 상태 (0.0 ~ 1.0)
        this.currentVolume = 0.5;
        // 음소거 상태 플래그
        this.isMuted = false;

        // 현재 활성화된 백색소음 종류 ('waves', 'rain', 'birds', null)
        this.activeSound = null;

        // 실행 중인 오디오 노드 및 타이머 핸들 저장소
        this.activeNodes = {
            sources: [],
            intervals: []
        };
    }

    /**
     * 오디오 컨텍스트 초기화 및 사용자 상호작용 후 활성화
     */
    initContext() {
        // 이미 생성되어 실행 중이면 재사용
        if (!this.ctx) {
            this.ctx = new this.AudioContextClass();

            // 백색소음용 마스터 볼륨 게인 생성
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.setValueAtTime(this.currentVolume, this.ctx.currentTime);

            // 알람음용 독립 게인 생성
            this.alarmGain = this.ctx.createGain();
            this.alarmGain.gain.setValueAtTime(0.7, this.ctx.currentTime);

            // 최종 스피커 출력단으로 연결
            this.masterGain.connect(this.ctx.destination);
            this.alarmGain.connect(this.ctx.destination);
        }

        // 브라우저 자동재생 정책에 의해 suspended 상태인 경우 깨움
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    /**
     * 백색/핑크 노이즈 오디오 버퍼 생성 헬퍼 함수
     * @param {number} seconds 버퍼 길이(초)
     * @returns {AudioBuffer}
     */
    createPinkNoiseBuffer(seconds = 5) {
        const sampleRate = this.ctx.sampleRate;
        const bufferSize = sampleRate * seconds;
        const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
        const data = buffer.getChannelData(0);

        // Paul Kellet의 필터링 알고리즘으로 자연스러운 핑크 노이즈 합성
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
            b6 = white * 0.115926;
        }
        return buffer;
    }

    /**
     * 파도 소리 (Ocean Waves) 생성 및 루프 재생
     * - 핑크 노이즈에 LFO 저주파 발진기를 걸어 약 8초 주기로 밀려오고 빠져나가는 파도 표현
     */
    playWavesSound() {
        this.stopAmbientSound();
        this.initContext();

        // 핑크 노이즈 소스 노드 생성
        const noiseBuffer = this.createPinkNoiseBuffer(6);
        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        // 파도의 깊은 소리를 위한 로우패스 필터
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(380, this.ctx.currentTime);

        // 파도 볼륨 오르내림을 제어할 다이내믹 게인
        const waveGain = this.ctx.createGain();
        waveGain.gain.setValueAtTime(0.2, this.ctx.currentTime);

        // 밀물-썰물 주기를 시뮬레이션할 LFO 발진기 (약 0.12Hz = 8.3초 주기)
        const lfo = this.ctx.createOscillator();
        lfo.frequency.setValueAtTime(0.12, this.ctx.currentTime);

        // LFO 진폭 제어 노드
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.setValueAtTime(0.3, this.ctx.currentTime);

        // 필터 주파수 변조를 위한 LFO 게인
        const filterLfoGain = this.ctx.createGain();
        filterLfoGain.gain.setValueAtTime(300, this.ctx.currentTime);

        // 노드 연결: 노이즈 ➔ 필터 ➔ 게인 ➔ 마스터 출력
        noiseSource.connect(filter);
        filter.connect(waveGain);
        waveGain.connect(this.masterGain);

        // LFO를 게인 및 필터 주파수에 변조 연결
        lfo.connect(lfoGain);
        lfoGain.connect(waveGain.gain);

        lfo.connect(filterLfoGain);
        filterLfoGain.connect(filter.frequency);

        // 사운드 재생 시작
        noiseSource.start();
        lfo.start();

        // 관리용 활성 노드 등록
        this.activeNodes.sources.push(noiseSource, lfo);
        this.activeSound = 'waves';
    }

    /**
     * 빗소리 (Rainfall) 생성 및 재생
     * - 중고역대가 부드럽게 깎인 핑크 노이즈로 촉촉한 빗줄기 소리 구현
     */
    playRainSound() {
        this.stopAmbientSound();
        this.initContext();

        // 핑크 노이즈 소스 노드 생성
        const noiseBuffer = this.createPinkNoiseBuffer(5);
        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        // 빗소리 질감을 만드는 밴드패스/로우패스 필터
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(850, this.ctx.currentTime);
        filter.Q.setValueAtTime(1.2, this.ctx.currentTime);

        const rainGain = this.ctx.createGain();
        rainGain.gain.setValueAtTime(0.65, this.ctx.currentTime);

        // 노드 체인 연결
        noiseSource.connect(filter);
        filter.connect(rainGain);
        rainGain.connect(this.masterGain);

        noiseSource.start();

        this.activeNodes.sources.push(noiseSource);
        this.activeSound = 'rain';
    }

    /**
     * 숲속 새소리 (Birds Chirping) 알고리즘 재생
     * - 불규칙한 주기(1.5 ~ 4초)마다 주파수가 빠르게 급변하는 사인파 짹짹거림 시뮬레이션
     */
    playBirdsSound() {
        this.stopAmbientSound();
        this.initContext();

        // 개별 새 지저귐 사운드 1회 발생 함수
        const triggerChirp = () => {
            if (this.activeSound !== 'birds' || !this.ctx) return;

            const now = this.ctx.currentTime;
            // 기본 주파수 랜덤 설정 (2000Hz ~ 3200Hz)
            const baseFreq = 2200 + Math.random() * 800;

            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            // 새의 짹짹거리는 주파수 슬라이드 모션 (급상승 후 하강)
            osc.frequency.setValueAtTime(baseFreq, now);
            osc.frequency.exponentialRampToValueAtTime(baseFreq + 1200, now + 0.05);
            osc.frequency.exponentialRampToValueAtTime(baseFreq - 300, now + 0.12);

            // 볼륨 엔벨로프 (부드러운 시작과 페이드아웃)
            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(0.3, now + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

            osc.connect(gain);
            gain.connect(this.masterGain);

            osc.start(now);
            osc.stop(now + 0.16);

            // 30% 확률로 연달아 두 번째 짹(Double Chirp) 발생
            if (Math.random() > 0.4) {
                const secondChirpDelay = 0.12;
                const osc2 = this.ctx.createOscillator();
                const gain2 = this.ctx.createGain();
                const now2 = now + secondChirpDelay;

                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(baseFreq + 400, now2);
                osc2.frequency.exponentialRampToValueAtTime(baseFreq + 1500, now2 + 0.04);
                osc2.frequency.exponentialRampToValueAtTime(baseFreq, now2 + 0.13);

                gain2.gain.setValueAtTime(0.001, now2);
                gain2.gain.linearRampToValueAtTime(0.25, now2 + 0.02);
                gain2.gain.exponentialRampToValueAtTime(0.001, now2 + 0.14);

                osc2.connect(gain2);
                gain2.connect(this.masterGain);

                osc2.start(now2);
                osc2.stop(now2 + 0.15);
            }

            // 다음 지저귐을 1.5초 ~ 4초 사이 랜덤 간격으로 예약
            const nextDelay = 1500 + Math.random() * 2500;
            const timerId = setTimeout(triggerChirp, nextDelay);
            this.activeNodes.intervals.push(timerId);
        };

        // 즉시 첫 번째 지저귐 실행
        triggerChirp();
        this.activeSound = 'birds';
    }

    /**
     * 재생 중인 모든 백색소음 중지 및 리소스 정리
     */
    stopAmbientSound() {
        // 모든 오실레이터/버퍼 소스 중지 및 연결 해제
        this.activeNodes.sources.forEach(source => {
            try {
                source.stop();
                source.disconnect();
            } catch (e) {
                // 이미 정지된 노드 예외 무시
            }
        });
        this.activeNodes.sources = [];

        // 새소리 스케줄링 타이머 정리
        this.activeNodes.intervals.forEach(timerId => clearTimeout(timerId));
        this.activeNodes.intervals = [];

        this.activeSound = null;
    }

    /**
     * 백색소음 특정 사운드 토글 (선택 시 재생, 다시 누르면 정지)
     * @param {string} soundType 'waves' | 'rain' | 'birds'
     * @returns {boolean} 재생 상태 여부
     */
    toggleSound(soundType) {
        if (this.activeSound === soundType) {
            this.stopAmbientSound();
            return false;
        } else {
            if (soundType === 'waves') this.playWavesSound();
            else if (soundType === 'rain') this.playRainSound();
            else if (soundType === 'birds') this.playBirdsSound();
            return true;
        }
    }

    /**
     * 볼륨 설정 (0 ~ 100)
     * @param {number} value
     */
    setVolume(value) {
        this.initContext();
        const normalized = Math.max(0, Math.min(100, value)) / 100;
        this.currentVolume = normalized;

        if (!this.isMuted && this.masterGain) {
            // 부드러운 볼륨 전환 (클릭 노이즈 방지)
            this.masterGain.gain.setTargetAtTime(normalized, this.ctx.currentTime, 0.05);
        }
    }

    /**
     * 음소거 토글
     * @returns {boolean} 현재 음소거 여부
     */
    toggleMute() {
        this.initContext();
        this.isMuted = !this.isMuted;

        if (this.masterGain) {
            const targetGain = this.isMuted ? 0 : this.currentVolume;
            this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.05);
        }
        return this.isMuted;
    }

    /**
     * 세션 전환 알림 사운드 재생 (오픈소스 맑은 벨 차임 멜로디 합성)
     * @param {'focus-done' | 'break-done'} type 세션 완료 종류
     */
    playAlarm(type = 'focus-done') {
        this.initContext();
        const now = this.ctx.currentTime;

        // 멜로디 음계 정의 (Hz): C5=523.25, E5=659.25, G5=783.99, C6=1046.50
        const notes = type === 'focus-done' 
            ? [523.25, 659.25, 783.99, 1046.50] // 집중 완료 시 밝게 상승하는 4음 차임
            : [783.99, 659.25, 523.25];         // 휴식 완료 시 부드럽게 복귀를 알리는 3음 차임

        const noteDuration = 0.22;

        notes.forEach((freq, index) => {
            const startTime = now + (index * 0.16);
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            // 부드러운 사인파와 벨 배음을 위한 트라이앵글 혼합
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startTime);

            // 차임벨 특유의 빠른 어택과 긴 감쇄(Decay) 엔벨로프
            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.linearRampToValueAtTime(0.45, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + noteDuration + 0.4);

            osc.connect(gain);
            gain.connect(this.alarmGain);

            osc.start(startTime);
            osc.stop(startTime + noteDuration + 0.45);
        });
    }
}

// 전역 싱글톤 인스턴스 노출
window.soundEngine = new SoundEngine();
