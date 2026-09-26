const http = require('http');
const https = require('https');

// 云函数计算 Web 函数会通过环境变量 FC_SERVER_PORT 指定监听端口
const PORT = process.env.PORT || 8080;

http.createServer((req, res) => {
    // 健康检查路由，用于函数计算平台确认服务已启动
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('OK');
    }

    // 请求路径去掉开头的 "/"，然后解码为完整的目标 URL
    const targetUrl = decodeURIComponent(req.url.slice(1));
    console.log(`[${new Date().toLocaleTimeString()}] 收到请求: ${req.method} ${targetUrl}`);

    // 安全校验：只允许代理百度相关域名
    if (!targetUrl || (!targetUrl.includes('aistudio-app.com') && !targetUrl.includes('bcebos.com'))) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    // 解析目标 URL，准备转发
    const options = new URL(targetUrl);
    options.method = req.method;

    // 复制原始请求头，并移除 host（因为目标 host 需要重新设置）
    const headers = { ...req.headers };
    delete headers.host;
    // 必须保留 authorization，百度接口需要 Bearer Token 鉴权
    // 同时保留 content-type、content-length 等用于文件上传的头部
    headers.host = options.host;
    options.headers = headers;

    // 发起 HTTPS 转发请求
    const proxyReq = https.request(options, (proxyRes) => {
        console.log(`[${new Date().toLocaleTimeString()}] 百度返回状态码: ${proxyRes.statusCode}`);
        // 将百度返回的响应头和状态码原样转发给客户端
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    // 转发错误处理
    proxyReq.on('error', (e) => {
        console.error('代理转发错误:', e.message);
        res.writeHead(500);
        res.end(e.message);
    });

    // 将客户端请求体流式转发到百度
    req.pipe(proxyReq);

}).listen(PORT, '0.0.0.0', () => {
    console.log(`代理服务器正在运行，监听端口 ${PORT}`);
});
