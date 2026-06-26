const express = require('express')
const puppeteer = require('puppeteer')
const cors = require('cors')
const path = require('path')

const app = express()

// 中间件
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// 请求日志
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
  next()
})

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

// 首页
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>豆包视频解析服务</title>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial; max-width: 800px; margin: 50px auto; padding: 20px; }
        h1 { color: #333; }
        .status { padding: 10px; background: #e8f5e9; border-radius: 5px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <h1>🎬 豆包视频解析服务</h1>
      <div class="status">
        <strong>✅ 服务运行中</strong><br>
        时间: ${new Date().toLocaleString('zh-CN')}
      </div>
      <h2>API 使用说明</h2>
      <pre>
POST /parse
Body: { "url": "豆包视频分享链接" }
Response: { "success": true, "video": { "url": "...", ... } }
      </pre>
    </body>
    </html>
  `)
})

// 解析豆包视频 - 使用Puppeteer
app.post('/parse', async (req, res) => {
  const { url } = req.body

  if (!url) {
    return res.status(400).json({
      success: false,
      error: '缺少URL参数'
    })
  }

  if (!url.includes('doubao.com')) {
    return res.status(400).json({
      success: false,
      error: '仅支持豆包视频链接'
    })
  }

  console.log('开始解析URL:', url)

  let browser = null
  let page = null

  try {
    // 启动浏览器
    console.log('启动Puppeteer浏览器...')

    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions'
      ]
    }

    // Render环境特殊处理
    if (process.env.RENDER) {
      console.log('检测到Render环境')
      launchOptions.executablePath = '/usr/bin/google-chrome-stable'
    }

    browser = await puppeteer.launch(launchOptions)
    console.log('浏览器启动成功')

    page = await browser.newPage()

    // 设置视口和User-Agent
    await page.setViewport({ width: 1920, height: 1080 })
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )

    // 设置额外的请求头
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    })

    console.log('访问页面:', url)

    // 访问页面
    const response = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    })

    if (!response || !response.ok()) {
      throw new Error(`页面访问失败: ${response ? response.status() : '无响应'}`)
    }

    console.log('页面加载成功，等待内容渲染...')

    // 等待页面渲染
    await page.waitForTimeout(3000)

    // 从页面中提取视频ID
    console.log('开始提取视频ID...')
    const videoId = await page.evaluate(() => {
      const html = document.documentElement.innerHTML

      // 多种方式提取videoId
      let matches = html.match(/"vid"\s*:\s*"([^"]+)"/)
      if (matches && matches[1]) return matches[1]

      matches = html.match(/vid[^:]*:\s*["']([^"']+)/i)
      if (matches && matches[1]) return matches[1]

      matches = html.match(/video_id[^=]*=\s*["']([^"']+)/i)
      if (matches && matches[1]) return matches[1]

      return null
    })

    if (!videoId) {
      // 尝试从URL中提取
      const urlMatch = window.location.href.match(/video_id=([^&]+)/)
      if (urlMatch && urlMatch[1]) {
        return urlMatch[1]
      }
      throw new Error('无法从页面提取视频ID')
    }

    console.log('成功提取videoId:', videoId)

    // 监听网络请求，捕获API响应
    let apiResponse = null
    let apiRequestUrl = null

    page.on('response', async (response) => {
      const requestUrl = response.url()

      // 监听get_play_info请求
      if (requestUrl.includes('/get_play_info') || requestUrl.includes('/media/')) {
        console.log('捕获到API请求:', requestUrl)
        apiRequestUrl = requestUrl

        try {
          const contentType = response.headers()['content-type'] || ''
          if (contentType.includes('application/json')) {
            apiResponse = await response.json()
            console.log('成功获取API响应')
          }
        } catch (e) {
          console.error('解析API响应失败:', e.message)
        }
      }
    })

    // 触发视频加载 - 尝试点击播放按钮或等待自动加载
    console.log('触发视频加载...')

    try {
      // 尝试点击播放按钮
      await page.click('video', { timeout: 3000 })
      console.log('点击了video元素')
    } catch (e) {
      console.log('未找到video元素或点击失败，继续等待...')
    }

    // 等待API请求完成
    await page.waitForTimeout(5000)

    // 如果还未捕获到API响应，尝试直接从页面获取
    if (!apiResponse) {
      console.log('未捕获到API响应，尝试从页面提取...')

      apiResponse = await page.evaluate(() => {
        // 从window对象中查找数据
        if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.video) {
          return window.__INITIAL_STATE__.video
        }

        // 查找页面中的JSON数据
        const scripts = document.querySelectorAll('script')
        for (let script of scripts) {
          const text = script.textContent || ''
          if (text.includes('get_play_info') || text.includes('original_media_info')) {
            try {
              const match = text.match(/\{[^}]*"original_media_info"[^}]*\}/)
              if (match) {
                return JSON.parse(match[0])
              }
            } catch (e) {}
          }
        }

        return null
      })
    }

    if (!apiResponse) {
      throw new Error('未能获取视频信息，可能页面结构已变化')
    }

    console.log('API响应数据:', JSON.stringify(apiResponse).substring(0, 200))

    // 解析视频信息
    let videoInfo = null
    let posterUrl = null

    if (apiResponse.data && apiResponse.data.original_media_info) {
      videoInfo = apiResponse.data.original_media_info
      posterUrl = apiResponse.data.poster_url
    } else if (apiResponse.original_media_info) {
      videoInfo = apiResponse.original_media_info
      posterUrl = apiResponse.poster_url
    } else {
      // 尝试其他可能的结构
      console.log('未知的API响应结构，原始数据:', JSON.stringify(apiResponse).substring(0, 500))
      throw new Error('API返回数据格式异常')
    }

    if (!videoInfo || !videoInfo.main_url) {
      throw new Error('无法提取视频地址')
    }

    const meta = videoInfo.meta || {}

    console.log('解析成功！视频地址:', videoInfo.main_url)

    // 返回结果
    return res.json({
      success: true,
      video: {
        url: videoInfo.main_url,
        width: meta.width || 0,
        height: meta.height || 0,
        definition: meta.definition || '',
        duration: meta.duration || 0,
        poster: posterUrl || '',
        videoId: videoId
      },
      message: '解析成功'
    })

  } catch (error) {
    console.error('解析错误:', error)
    console.error('错误堆栈:', error.stack)

    return res.status(500).json({
      success: false,
      error: error.message || '服务器内部错误',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })

  } finally {
    // 清理资源
    if (page) {
      try {
        await page.close()
      } catch (e) {}
    }
    if (browser) {
      try {
        await browser.close()
        console.log('浏览器已关闭')
      } catch (e) {
        console.error('关闭浏览器失败:', e)
      }
    }
  }
})

// 404处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'API路径不存在',
    availablePaths: ['GET /', 'GET /health', 'POST /parse']
  })
})

// 错误处理
app.use((err, req, res, next) => {
  console.error('全局错误:', err)
  res.status(500).json({
    success: false,
    error: '服务器内部错误',
    message: err.message
  })
})

// 启动服务器
const PORT = process.env.PORT || 3000
const server = app.listen(PORT, () => {
  console.log('='.repeat(60))
  console.log(`🚀 豆包视频解析服务器启动成功！`)
  console.log(`📍 监听端口: ${PORT}`)
  console.log(`🌍 环境: ${process.env.NODE_ENV || 'development'}`)
  console.log(`⏰ 启动时间: ${new Date().toLocaleString('zh-CN')}`)
  console.log('='.repeat(60))
})

// 优雅退出
process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，准备关闭服务器...')
  server.close(() => {
    console.log('服务器已关闭')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('\n收到SIGINT信号，准备关闭服务器...')
  server.close(() => {
    console.log('服务器已关闭')
    process.exit(0)
  })
})
