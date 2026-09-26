const http = require('http');
const https = require('https');
const zlib = require('zlib');

// Cloud Run 会通过 PORT 环境变量指定监听端口，默认 8080
// 必须监听 '0.0.0.0'，否则 Cloud Run 无法从容器外部访问服务
const PORT = process.env.PORT || 8080;

// 从 JSONL 文件中提取最终文本
function extractTextFromJsonl(jsonlText, modelId) {
    const lines = jsonlText.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return '';

    const resultObj = JSON.parse(lines[0])?.result || {};

    if (modelId === 'baidu-ocrv6' || modelId === 'baidu-ocrv5') {
        return resultObj?.ocrResults
            ?.flatMap(res => res.prunedResult?.rec_texts || [])
            .filter(Boolean)
            .join('\n') || '';
    }
    return resultObj?.layoutParsingResults?.[0]?.markdown?.text || '';
}

http.createServer((req, res) => {
    // 健康检查路由
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

    const options = new URL(targetUrl);
    options.method = req.method;

    // 复制原始请求头，并移除 host
    const headers = { ...req.headers };
    delete headers.host;
    headers.host = options.host;
    options.headers = headers;

    // 发起 HTTPS 转发请求
    const proxyReq = https.request(options, (proxyRes) => {
        console.log(`[${new Date().toLocaleTimeString()}] 目标返回状态码: ${proxyRes.statusCode}`);

        // 判断是否是需要提取文本的结果文件
        const isResultFile = targetUrl.includes('bcebos.com') && targetUrl.includes('.jsonl');

        if (isResultFile && proxyRes.statusCode === 200) {
            const chunks = [];
            proxyRes.on('data', chunk => chunks.push(chunk));
            proxyRes.on('end', () => {
                let body = Buffer.concat(chunks);

                // 处理 gzip 压缩
                const encoding = proxyRes.headers['content-encoding'];
                if (encoding === 'gzip') {
                    body = zlib.gunzipSync(body);
                }

                const jsonlText = body.toString('utf-8');
                const modelId = req.headers['x-model-id'] || 'baidu-vl-1.6';
                const extractedText = extractTextFromJsonl(jsonlText, modelId);

                console.log(`[结果提取] 原始JSONL大小: ${body.length} bytes, 提取后文本长度: ${extractedText.length} 字符`);

                res.writeHead(200, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'x-extracted-text': 'true'
                });
                res.end(extractedText);
            });
        } else {
            // 非结果文件请求，正常透传
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
        }
    });

    proxyReq.on('error', (e) => {
        console.error('代理转发错误:', e.message);
        res.writeHead(500);
        res.end(e.message);
    });

    req.pipe(proxyReq);
}).listen(PORT, '0.0.0.0', () => {
    console.log(`代理服务器正在运行，监听端口 ${PORT}`);
});
