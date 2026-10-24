/**
 * ============================================================================
 * FocusPulse 로컬 테스트용 경량 Node.js 웹 서버
 * 외부 패키지 설치 없이 Node 내장 http, fs, path 모듈만으로 구동됩니다.
 * ============================================================================
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// 서비스 포트 설정 (기본 3000번 포트)
const PORT = 3000;

// 지원하는 MIME 타입 매핑 정의
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

// HTTP 서버 인스턴스 생성
const server = http.createServer((req, res) => {
    // URL 요청 경로 디코딩 및 정규화
    let safeUrl = decodeURI(req.url.split('?')[0]);
    if (safeUrl === '/') safeUrl = '/index.html';

    const filePath = path.join(__dirname, safeUrl);

    // 요청 파일 확인 및 스트리밍 응답
    fs.readFile(filePath, (err, data) => {
        if (err) {
            // 파일을 찾을 수 없는 경우 404 반환
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

// 서버 바인딩 및 시작
server.listen(PORT, () => {
    console.log(`FocusPulse 서버가 시작되었습니다: http://localhost:${PORT}`);
});
