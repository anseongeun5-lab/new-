/**
 * ============================================================================
 * FocusPulse 오디오 엔진 모듈 (Web Audio API 기반)
 * ----------------------------------------------------------------------------
 * 1. 백색소음 실시간 오디오 신디사이징:
 *    - 파도(Ocean Waves 🌊): 핑크/브라운 노이즈 + LFO 게인/필터 다이내믹 변조로 밀물과 썰물 구현
 *    - 빗소리(Rainfall 🌧️): 밴드패스/로우패스 대역 필터링으로 쏟아지는 시원한 빗소리 구현
 *    - 모닥불(Campfire 🔥): 따뜻한 저음 앰비언스 + 장작이 타닥타닥 튀는 리얼 크랙클(Crackling Pop) 합성
 * 2. 세션 종료 알림 차임벨(Alarm Chime):
 *    - 25분 집중 완료 및 5분 휴식 완료 시 맑은 상승 멜로디 재생
 * 3. 마스터 볼륨 및 음소거(Mute) 제어 및 AudioContext 즉시 언락 보장
 * ============================================================================
 */

class SoundEngine {
    constructor() {
        // 브라우저 AudioContext 클래스 참조
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = null;
        this.AudioContextClass = AudioCtx;

        // 마스터 게인 노드 (전체 백색소음 볼륨 조절)
        this.masterGain = null;
        // 알림음 전용 게인 노드 (백색소음 볼륨과 독립)
        this.alarmGain = null;

        // 기본 볼륨 설정 (0.0 ~ 1.0)
        this.currentVolume = 0.6;
        // 음소거 상태 플래그
        this.isMuted = false;

        // 현재 활성화된 백색소음 종류 ('waves', 'rain', 'fire', null)
        this.activeSound = null;

        // 실행 중인 오디오 노드 및 인터벌 타이머 관리
        this.activeNodes = {
            sources: [],
            intervals: []
        };
    }

    /**
     * 오디오 컨텍스트 초기화 및 브라우저 오디오 언락
     */
    initContext() {
        // 인스턴스가 없으면 새로 생성
        if (!this.ctx) {
            this.ctx = new this.AudioContextClass();

            // 백색소음 마스터 게인 노드 생성
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.setValueAtTime(this.currentVolume, this.ctx.currentTime);

            // 알람 전용 게인 노드 생성 (알람은 명확하게 들리도록 설정)
            this.alarmGain = this.ctx.createGain();
            this.alarmGain.gain.setValueAtTime(0.75, this.ctx.currentTime);

            // 스피커 최종 출력단 연결
            this.masterGain.connect(this.ctx.destination);
            this.alarmGain.connect(this.ctx.destination);
        }

        // 브라우저 자동재생 제한 해제 (suspended 상태 즉시 resume)
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    /**
     * 풍성하고 가청도가 뛰어난 핑크 노이즈 버퍼 생성기
     * @param {number} seconds 버퍼 길이(초)
     * @returns {AudioBuffer}
     */
    createPinkNoiseBuffer(seconds = 6) {
        const sampleRate = this.ctx.sampleRate;
        const bufferSize = sampleRate * seconds;
        const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
        const data = buffer.getChannelData(0);

        // Paul Kellet 필터 알고리즘 (충분한 볼륨 진폭 확보)
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            // 사람이 편안하면서도 또렷하게 들을 수 있도록 게인 스케일 0.32 적용
            data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.32;
            b6 = white * 0.115926;
        }
        return buffer;
    }

    /**
     * 따뜻한 저음역 브라운(레드) 노이즈 버퍼 생성기 (바다 깊은 울림 및 모닥불 베이스)
     * @param {number} seconds 버퍼 길이(초)
     * @returns {AudioBuffer}
     */
    createBrownNoiseBuffer(seconds = 6) {
        const sampleRate = this.ctx.sampleRate;
        const bufferSize = sampleRate * seconds;
        const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
        const data = buffer.getChannelData(0);

        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            // 적분 필터로 브라운 노이즈 생성
            data[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = data[i];
            // 볼륨 부스팅 (저음 에너지 보강)
            data[i] *= 3.5;
        }
        return buffer;
    }

    /**
     * 1. 파도 소리 (Ocean Waves 🌊) 재생
     * - 핑크 노이즈(파도 거품) + 브라운 노이즈(깊은 파도 웅장함)
     * - 4.5초 주기의 LFO로 밀려오고 쓸려나가는 다이내믹 파도 사운드 실시간 합성
     */
    playWavesSound() {
        this.stopAmbientSound();
        this.initContext();

        // 핑크 노이즈 버퍼 소스 (부서지는 포말)
        const pinkBuffer = this.createPinkNoiseBuffer(6);
        const pinkSource = this.ctx.createBufferSource();
        pinkSource.buffer = pinkBuffer;
        pinkSource.loop = true;

        // 브라운 노이즈 버퍼 소스 (깊은 바다 파도 몸통)
        const brownBuffer = this.createBrownNoiseBuffer(6);
        const brownSource = this.ctx.createBufferSource();
        brownSource.buffer = brownBuffer;
        brownSource.loop = true;

        // 파도 필터: 로우패스 필터로 부드럽게 감싸줌
        const waveFilter = this.ctx.createBiquadFilter();
        waveFilter.type = 'lowpass';
        waveFilter.frequency.setValueAtTime(450, this.ctx.currentTime);
        waveFilter.Q.setValueAtTime(1.0, this.ctx.currentTime);

        // 파도 다이내믹 게인: LFO를 통해 0.15 ~ 0.85 사이를 주기적으로 왕복
        const waveGain = this.ctx.createGain();
        waveGain.gain.setValueAtTime(0.48, this.ctx.currentTime);

        // LFO 저주파 발진기 (주기 약 4.2초 = 0.24Hz로 시원시원하게 파도가 침)
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(0.24, this.ctx.currentTime);

        // LFO 게인 변조 깊이 노드 (진폭 0.35)
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.setValueAtTime(0.35, this.ctx.currentTime);

        // LFO 필터 컷오프 변조 (파도가 밀려올 때 고음역 개방)
        const lfoFilterMod = this.ctx.createGain();
        lfoFilterMod.gain.setValueAtTime(320, this.ctx.currentTime);

        // 노드 체인 연결
        pinkSource.connect(waveFilter);
        brownSource.connect(waveFilter);
        waveFilter.connect(waveGain);
        waveGain.connect(this.masterGain);

        // LFO를 게인과 필터 주파수에 변조 연결
        lfo.connect(lfoGain);
        lfoGain.connect(waveGain.gain);

        lfo.connect(lfoFilterMod);
        lfoFilterMod.connect(waveFilter.frequency);

        // 재생 시작
        pinkSource.start();
        brownSource.start();
        lfo.start();

        this.activeNodes.sources.push(pinkSource, brownSource, lfo);
        this.activeSound = 'waves';
    }

    /**
     * 2. 빗소리 (Rainfall 🌧️) 재생
     * - 중역대와 고역대가 풍성한 핑크 노이즈로 촉촉하게 쏟아지는 빗소리 구현
     */
    playRainSound() {
        this.stopAmbientSound();
        this.initContext();

        const noiseBuffer = this.createPinkNoiseBuffer(6);
        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        // 빗소리의 바스락거리는 촉촉함을 살리는 하이패스 & 로우패스 밴드 구성
        const highpass = this.ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.setValueAtTime(250, this.ctx.currentTime);

        const lowpass = this.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(2800, this.ctx.currentTime);

        const rainGain = this.ctx.createGain();
        rainGain.gain.setValueAtTime(0.75, this.ctx.currentTime);

        // 노드 연결
        noiseSource.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(rainGain);
        rainGain.connect(this.masterGain);

        noiseSource.start();

        this.activeNodes.sources.push(noiseSource);
        this.activeSound = 'rain';
    }

    /**
     * 3. 모닥불 소리 (Campfire 🔥 - 새소리 대체 추천 백색소음) 재생
     * - 따뜻한 저음의 불꽃 럼블(Low Rumble) + 장작이 '타닥! 틱! 톡!' 튀는 크랙클(Crackling Pop) 합성
     */
    playFireSound() {
        this.stopAmbientSound();
        this.initContext();

        // 1) 모닥불의 은은한 기본 불길 소리 (브라운 노이즈)
        const rumbleBuffer = this.createBrownNoiseBuffer(6);
        const rumbleSource = this.ctx.createBufferSource();
        rumbleSource.buffer = rumbleBuffer;
        rumbleSource.loop = true;

        const rumbleFilter = this.ctx.createBiquadFilter();
        rumbleFilter.type = 'lowpass';
        rumbleFilter.frequency.setValueAtTime(220, this.ctx.currentTime);

        const rumbleGain = this.ctx.createGain();
        rumbleGain.gain.setValueAtTime(0.55, this.ctx.currentTime);

        rumbleSource.connect(rumbleFilter);
        rumbleFilter.connect(rumbleGain);
        rumbleGain.connect(this.masterGain);
        rumbleSource.start();

        this.activeNodes.sources.push(rumbleSource);

        // 2) 장작이 타닥타닥 튀는 크랙클(Crackle) 생성기
        const triggerCrackle = () => {
            if (this.activeSound !== 'fire' || !this.ctx) return;

            const now = this.ctx.currentTime;
            const popCount = 1 + Math.floor(Math.random() * 3); // 한 번에 1~3개 팝

            for (let i = 0; i < popCount; i++) {
                const popTime = now + (i * 0.03) + (Math.random() * 0.02);
                
                // 크랙클용 숏 노이즈 버퍼 생성 (0.01초 미세 펄스)
                const crackleLength = Math.floor(this.ctx.sampleRate * 0.015);
                const crackleBuf = this.ctx.createBuffer(1, crackleLength, this.ctx.sampleRate);
                const cData = crackleBuf.getChannelData(0);
                for (let j = 0; j < crackleLength; j++) {
                    cData[j] = (Math.random() * 2 - 1) * Math.exp(-j / (crackleLength * 0.25));
                }

                const popSource = this.ctx.createBufferSource();
                popSource.buffer = crackleBuf;

                // 톡 튀는 고역대 강조 밴드패스 필터
                const bpf = this.ctx.createBiquadFilter();
                bpf.type = 'bandpass';
                bpf.frequency.setValueAtTime(1400 + Math.random() * 2600, popTime);
                bpf.Q.setValueAtTime(3.0, popTime);

                const popGain = this.ctx.createGain();
                popGain.gain.setValueAtTime(0.4 + Math.random() * 0.5, popTime);

                popSource.connect(bpf);
                bpf.connect(popGain);
                popGain.connect(this.masterGain);

                popSource.start(popTime);
            }

            // 다음 장작 튀는 간격을 60ms ~ 280ms 랜덤 간격으로 예약
            const nextCrackleDelay = 60 + Math.random() * 220;
            const timerId = setTimeout(triggerCrackle, nextCrackleDelay);
            this.activeNodes.intervals.push(timerId);
        };

        // 크랙클 루프 개시
        triggerCrackle();
        this.activeSound = 'fire';
    }

    /**
     * 재생 중인 모든 백색소음 정지 및 노드 해제
     */
    stopAmbientSound() {
        this.activeNodes.sources.forEach(src => {
            try {
                src.stop();
                src.disconnect();
            } catch (e) {
                // 이미 정지된 노드 무시
            }
        });
        this.activeNodes.sources = [];

        this.activeNodes.intervals.forEach(timerId => clearTimeout(timerId));
        this.activeNodes.intervals = [];

        this.activeSound = null;
    }

    /**
     * 백색소음 토글 (선택 시 재생, 다시 누르면 정지)
     * @param {'waves' | 'rain' | 'fire'} soundType
     * @returns {boolean} 재생 상태 여부
     */
    toggleSound(soundType) {
        if (this.activeSound === soundType) {
            this.stopAmbientSound();
            return false;
        } else {
            if (soundType === 'waves') this.playWavesSound();
            else if (soundType === 'rain') this.playRainSound();
            else if (soundType === 'fire') this.playFireSound();
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
            this.masterGain.gain.setTargetAtTime(normalized, this.ctx.currentTime, 0.05);
        }
    }

    /**
     * 음소거 토글
     * @returns {boolean} 음소거 여부
     */
    toggleMute() {
        this.initContext();
        this.isMuted = !this.isMuted;

        if (this.masterGain) {
            const target = this.isMuted ? 0 : this.currentVolume;
            this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
        }
        return this.isMuted;
    }

    /**
     * 세션 전환 알림 사운드 재생 (차임벨)
     * @param {'focus-done' | 'break-done'} type
     */
    playAlarm(type = 'focus-done') {
        this.initContext();
        const now = this.ctx.currentTime;

        // C5-E5-G5-C6 화음 멜로디
        const notes = type === 'focus-done'
            ? [523.25, 659.25, 783.99, 1046.50]
            : [783.99, 659.25, 523.25];

        notes.forEach((freq, index) => {
            const startTime = now + (index * 0.15);
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startTime);

            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.linearRampToValueAtTime(0.5, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.5);

            osc.connect(gain);
            gain.connect(this.alarmGain);

            osc.start(startTime);
            osc.stop(startTime + 0.55);
        });
    }
}

// 전역 싱글톤 인스턴스
window.soundEngine = new SoundEngine();
