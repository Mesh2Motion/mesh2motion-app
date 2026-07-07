/**
 * Mesh2Motion 生产环境静态服务器
 * 用于 Windows 服务部署（NSSM）
 * 端口: 20002
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 20002;
const DIST_DIR = path.join(__dirname, 'dist');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json; charset=utf-8',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.wasm': 'application/wasm',
    '.map': 'application/octet-stream',
};

const server = http.createServer((req, res) => {
    let urlPath = req.url.split('?')[0]; // 去掉 query string

    // 默认首页
    if (urlPath === '/') {
        urlPath = '/index.html';
    }

    const filePath = path.join(DIST_DIR, urlPath);

    // 安全检查：防止路径穿越
    if (!filePath.startsWith(DIST_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();

    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // SPA fallback: 对于找不到的文件，尝试返回 index.html
                const fallback = path.join(DIST_DIR, 'index.html');
                fs.readFile(fallback, (err2, data2) => {
                    if (err2) {
                        res.writeHead(404);
                        res.end('Not Found');
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(data2);
                });
            } else {
                res.writeHead(500);
                res.end('Internal Server Error');
            }
            return;
        }

        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Mesh2Motion] 服务已启动 → http://localhost:${PORT}`);
    console.log(`[Mesh2Motion] 静态目录: ${DIST_DIR}`);
});
