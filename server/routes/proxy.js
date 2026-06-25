const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware');

const PROVIDER_CONFIGS = {
  agnes: {
    baseUrl: 'https://apihub.agnes-ai.com',
    defaultModel: 'agnes-image-2.1-flash',
    editModel: 'agnes-image-2.0-flash',
  },
};

router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { provider, prompt, size, quality, model, imageData } = req.body;
    const cfg = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.agnes;
    const apiKey = req.body.apiKey || '';

    const headers = {
      'Content-Type': 'application/json',
    };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

    let body;
    if (imageData && imageData.length) {
      // Image-to-image: force edit model + tags (忽略请求体中的文生图模型)
      body = {
        model: cfg.editModel || model || cfg.defaultModel,
        tags: ['img2img'],
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
      signal: AbortSignal.timeout(300000),
    });

    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;