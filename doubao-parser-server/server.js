const express = require('express')
const cors = require('cors')

const app = express()

app.use(cors())
app.use(express.json())

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: '服务器运行中（简化版）'
  })
})

// 首页
app.get('/', (req, res) => {
  res.send(`
    <h1>✅ 豆包视频解析服务器</h1>
    <p>简化版 - 先测试部署</p>
    <p>时间: ${new Date().toLocaleString('zh-CN')}</p>
  `)
})

// 解析接口（临时返回测试数据）
app.post('/parse', (req, res) => {
  const { url } = req.body
  
  if (!url) {
    return res.status(400).json({ 
      success: false, 
      error: '缺少URL参数' 
    })
  }
  
  // 临时返回测试数据
  res.json({
    success: true,
    video: {
      url: 'https://example.com/test-video.mp4',
      width: 1280,
      height: 720,
      definition: '720p',
      message: '这是测试数据（简化版）',
      note: 'Puppeteer版本待部署'
    }
  })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log('='.repeat(60))
  console.log('🚀 服务器启动成功！')
  console.log(`📍 监听端口: ${PORT}`)
  console.log('='.repeat(60))
})
