// src/imageGenerator.ts
import puppeteer from 'puppeteer';
import handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import { UserStats } from './database';

export class CheckInImageGenerator {
  private templatePath: string;
  
  constructor() {
    // 确保输出目录存在
    const outputDir = path.join(process.cwd(), 'data', 'images');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    this.templatePath = path.join(process.cwd(), 'src', 'templates', 'checkinCard.html');
  }

  /**
   * 生成用户打卡纪念图（原版CSS效果）
   */
  async generateCheckInImage(userStats: UserStats): Promise<string> {
    try {
      // 读取HTML模板
      const templateHtml = fs.readFileSync(this.templatePath, 'utf-8');
      
      // 编译模板
      const template = handlebars.compile(templateHtml);
      
      // 准备模板数据
      const templateData = this.prepareTemplateData(userStats);
      
      // 渲染HTML
      const renderedHtml = template(templateData);
      
      // 使用Puppeteer生成图片
      const imagePath = await this.htmlToImage(renderedHtml, userStats.userName);
      
      console.log(`📸 打卡纪念图已生成: ${imagePath}`);
      return imagePath;
      
    } catch (error) {
      console.error('生成纪念图失败:', error instanceof Error ? error.message : '未知错误');
      throw error;
    }
  }

  /**
   * 准备模板数据
   */
  private prepareTemplateData(userStats: UserStats) {
    // 格式化日期范围
    const firstDate = new Date(userStats.firstCheckIn).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const lastDate = new Date(userStats.lastCheckIn).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    
    // WMO标准的10个基本云属及其图标
    const cloudTypeDefinitions = [
      // 高云族 (5-13km)
      { name: '卷云', icon: '🌤️', code: 'Ci', category: '高云族' },
      { name: '卷积云', icon: '🌨️', code: 'Cc', category: '高云族' },
      { name: '卷层云', icon: '🌫️', code: 'Cs', category: '高云族' },
      
      // 中云族 (2-7km)
      { name: '高积云', icon: '⛅', code: 'Ac', category: '中云族' },
      { name: '高层云', icon: '🌥️', code: 'As', category: '中云族' },
      
      // 低云族 (0-2km)
      { name: '层积云', icon: '⛅', code: 'Sc', category: '低云族' },
      { name: '层云', icon: '🌫️', code: 'St', category: '低云族' },
      { name: '积云', icon: '☁️', code: 'Cu', category: '低云族' },
      { name: '积雨云', icon: '⛈️', code: 'Cb', category: '低云族' },
      
      // 降水云
      { name: '雨层云', icon: '🌧️', code: 'Ns', category: '降水云' }
    ];
    
    // 为每种云彩类型创建集章数据
    const cloudStamps = cloudTypeDefinitions.map((definition, index) => {
      const count = userStats.cloudTypeStats[definition.name] || 0;
      const isCompleted = count > 0;
      
      return {
        name: definition.name,
        icon: definition.icon,
        code: definition.code,
        isCompleted,
        count: count > 0 ? count : 0
      };
    });
    
    return {
      userName: userStats.userName,
      dateRange: firstDate === lastDate ? firstDate : `${firstDate} ~ ${lastDate}`,
      totalCheckIns: userStats.totalCheckIns,
      cloudStamps,
      generateTime: new Date().toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    };
  }

  /**
   * 使用Puppeteer将HTML转换为图片
   */
  private async htmlToImage(html: string, userName: string): Promise<string> {
    let browser;
    
    try {
      // 启动浏览器
      browser = await puppeteer.launch({
        headless: true,
        defaultViewport: {
          width: 700,
          height: 450,
          deviceScaleFactor: 2 // 高DPI支持
        },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });
      
      const page = await browser.newPage();
      
      // 设置页面内容
      await page.setContent(html, {
        waitUntil: ['networkidle0', 'domcontentloaded'],
        timeout: 30000
      });
      
             // 等待字体和动画加载
       await page.evaluateHandle('document.fonts.ready');
       await new Promise(resolve => setTimeout(resolve, 2000)); // 等待动画和样式完全加载
      
             // 生成截图
       const fileName = `checkin_${userName}_${Date.now()}.png`;
       const filePath = path.join(process.cwd(), 'data', 'images', fileName);
       
       // 获取集章册元素的边界
       const bookElement = await page.$('.stamp-book');
       if (!bookElement) {
         throw new Error('找不到集章册元素');
       }
       
       const screenshotBuffer = await bookElement.screenshot({
         type: 'png',
         omitBackground: true,  // 启用透明背景，使圆角外区域透明
         captureBeyondViewport: true
       });
       
       // 保存截图到文件
       fs.writeFileSync(filePath, screenshotBuffer);
       
       return filePath;
      
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * 生成预览HTML文件（用于调试）
   */
  async generatePreviewHtml(userStats: UserStats): Promise<string> {
    try {
      const templateHtml = fs.readFileSync(this.templatePath, 'utf-8');
      const template = handlebars.compile(templateHtml);
      const templateData = this.prepareTemplateData(userStats);
      const renderedHtml = template(templateData);
      
      const previewPath = path.join(process.cwd(), 'data', 'images', `preview_${userStats.userName}_${Date.now()}.html`);
      fs.writeFileSync(previewPath, renderedHtml, 'utf-8');
      
      console.log(`🔍 预览HTML已生成: ${previewPath}`);
      return previewPath;
      
    } catch (error) {
      console.error('生成预览HTML失败:', error instanceof Error ? error.message : '未知错误');
      throw error;
    }
  }
} 