const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware');

const PROVIDER_CONFIGS = {
  agnes: {
    baseUrl: 'https://apihub.agnes-ai.com',
    defaultModel: 'agnes-image-2.1-flash',
    editModel: 'agnes-image-2.1-flash',  // 2.0-flash 卡死,改 2.1
  },
};

router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { provider, prompt, size, quality, model, imageData } = req.body;
    const cfg = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.agnes;
    console.log(`[proxy] user=${req.user?.userId || '?'} provider=${provider} model=${cfg.editModel || model} size=${size} images=${imageData?.length || 0} imageLen=${imageData && imageData[0] ? imageData[0].length : 0}`);
    const apiKey = req.body.apiKey || '';

    // 限制 imageData 大小(base64 11MB → agnes 处理很慢)
    if (imageData && imageData.length) {
      const totalSize = (imageData.join('') || '').length;
      if (totalSize > 4 * 1024 * 1024) {  // 4MB base64 ≈ 3MB raw
        return res.status(413).json({ error: 'Image too large (max 4MB base64). Please resize to 1024x1024 or smaller.' });
      }
    }
    const headers = {
      'Content-Type': 'application/json',
    };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

    let body;
    if (imageData && imageData.length) {
      // Image-to-image — image 放 extra_body 数组内
      // 图生图(最佳效果):image + response_format 都放 extra_body 内
      // 走 /images/i2i/ 路径(I2I 专用),效果最保留原图 + url 短小,history 渲染快
      body = {
        model: cfg.editModel || model || cfg.defaultModel,
        prompt,
        size: size || '1024x1024',
        extra_body: {
          image: imageData,
          response_format: 'url',
        },
      };
    } else {
      // Text-to-image
      body = {
        model: model || cfg.defaultModel,
        prompt,
        size: size || '1024x1024',
        extra_body: { response_format: 'url' },
      };
    }

    const resp = await fetch(cfg.baseUrl + '/v1/images/generations', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    // 透传上游的 Retry-After 头(429 限速时)
    const retryAfter = resp.headers.get('retry-after');
    if (retryAfter) res.set('Retry-After', retryAfter);

    const data = await resp.json();
    // 5xx / 429 详细 log
    if (resp.status >= 500) {
      console.log(`[proxy] agnes ${resp.status} body:`, JSON.stringify(data).slice(0, 500));
    }
    if (resp.status === 429) {
      console.log(`[proxy] 429 rate limited, retry-after=${retryAfter}`);
      return res.status(429).json({
        error: data && (data.error || data.message) || 'rate_limited',
        message: '供应商速率限制,请稍后再试',
        retry_after: retryAfter || '60',
      });
    }
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;