// src/config.ts

export const config = {
  // IMPORTANT: Fill in your Bilibili cookie here.
  // How to get your cookie:
  // 1. Open your browser and go to bilibili.com.
  // 2. Open the developer tools (usually by pressing F12).
  // 3. Go to the "Network" tab.
  // 4. Refresh the page.
  // 5. Find a request to a bilibili.com domain (e.g., 'www.bilibili.com' or 'api.bilibili.com').
  // 6. In the "Headers" section of that request, find the "Cookie" header and copy its entire value.
  cookie:
    "",
  // The bot will monitor @ messages directed to the account associated with the cookie.
  // No topic ID is needed as it will check all @ messages.

  // The user ID to check for in the comments.
  // The bot will only comment if this user has NOT already commented.
  uidToMonitor: "3493260607622030",

  // The text you want to post as a comment.
  commentText: "好漂亮的☁️！",

  // How often to check for new dynamics, in milliseconds.
  // 1 minute = 60000 ms.
  // Be careful not to set this too low to avoid being rate-limited.
  checkInterval: 10000,

  // 云朵分析功能配置
  // 是否启用云朵分析功能
  enableCloudAnalysis: true,

  // 是否启用打卡纪念图片生成和上传
  // 注意：需要安装puppeteer和相关依赖
  enableCheckInImage: true,

  // OpenAI API 配置
  // 如果使用 OpenAI 官方 API，可以留空 baseURL
  openai: {
    apiKey: "",
    baseURL: "",
    model: "",
  },
};
