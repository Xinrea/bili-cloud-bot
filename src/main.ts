// src/main.ts
import axios from 'axios';
import { config } from './config';
import { CloudAnalyzer } from './cloudAnalyzer';
import { CloudDatabase, CheckInRecord, CloudType, ProcessedAtMessage } from './database';
import { CheckInImageGenerator } from './imageGenerator';
import fs from 'fs';
import { log } from './logger';

// 初始化数据库
const cloudDB = new CloudDatabase();

// 初始化图片生成器
const imageGenerator = new CheckInImageGenerator();

// --- Interfaces for Bilibili API responses ---

// 新增：Dynamic Card 图片检查相关的接口
interface DynamicCardImage {
  url: string;
  type: string;
  description: string;
}

interface OpusPic {
  height: number;
  width: number;
  size: number;
  url: string;
  live_url?: string | null;
}

interface DrawItem {
  src: string;
  width: number;
  height: number;
}

interface ModuleItem {
  module_type?: string;
  module_dynamic?: {
    major?: {
      opus?: {
        pics?: OpusPic[];
      };
      draw?: {
        items?: DrawItem[];
      };
      archive?: {
        pic?: string;
      };
      pgc?: {
        cover?: string;
      };
    };
  };
  module_author?: {
    avatar?: {
      fallback_layers?: {
        layers?: Array<{
          resource?: {
            res_image?: {
              image_src?: {
                remote?: {
                  url?: string;
                };
              };
            };
          };
        }>;
      };
    };
    decoration_card?: {
      card_url?: string;
      big_card_url?: string;
      image_enhance?: string;
    };
    pendant?: {
      image?: string;
      image_enhance?: string;
    };
    vip?: {
      label?: {
        img_label_uri_hans?: string;
        img_label_uri_hans_static?: string;
        img_label_uri_hant?: string;
        img_label_uri_hant_static?: string;
        path?: string;
      };
    };
  };
  module_topic?: {
    id?: number;
    jump_url?: string;
    name?: string;
  };
}

interface DynamicCardItem {
  id_str: string;
  basic?: {
    comment_type: number;
    rid_str: string;
  };
  modules?: ModuleItem[] | ModuleItem; // 支持数组或单个对象
}

// 被@消息相关接口
interface AtUser {
  mid: number;
  fans: number;
  nickname: string;
  avatar: string;
  mid_link: string;
  follow: boolean;
}

interface AtItem {
  type: string;
  business: string;
  business_id: number;
  title: string;
  image: string;
  uri: string;
  subject_id: number;
  root_id: number;
  target_id: number;
  source_id: number;
  source_content: string;
  native_uri: string;
  at_details: AtUser[];
  topic_details: any[];
  hide_reply_button: boolean;
}

interface AtMessage {
  id: number;
  user: AtUser;
  item: AtItem;
  at_time: number;
}

interface AtFeedResponse {
  code: number;
  message: string;
  data?: {
    items: AtMessage[];
  };
}

interface CommentReply {
  member: {
    mid: string;
  };
  content: {
    message: string;
  };
  replies?: CommentReply[];
}

interface CommentAPIResponse {
  code: number;
  message: string;
  data?: {
    replies: CommentReply[];
  };
}

// --- Bilibili API Endpoints ---
const API = {
  getAtFeed: 'https://api.bilibili.com/x/msgfeed/at',
  getComments: 'https://api.bilibili.com/x/v2/reply/main',
  addComment: 'https://api.bilibili.com/x/v2/reply/add',
  getDynamicDetails: 'https://api.bilibili.com/x/polymer/web-dynamic/v1/detail',
  uploadImage: 'https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs', // 动态图片上传
};

// --- Utility Functions ---

/**
 * 检查 dynamic card 中是否包含图片，并返回所有图片 URL
 */
function checkImagesInDynamicCard(dynamicCard: DynamicCardItem): DynamicCardImage[] {
  const images: DynamicCardImage[] = [];
  
  if (!dynamicCard.modules) {
    return images;
  }

  // 将modules统一转换为数组进行处理
  const modulesArray = Array.isArray(dynamicCard.modules) ? dynamicCard.modules : [dynamicCard.modules];
  
  modulesArray.forEach((module: any, moduleIndex: number) => {
    // 检查 MODULE_TYPE_TOP 模块中的album图片
    if (module.module_type === 'MODULE_TYPE_TOP' && module.module_top?.display?.album?.pics) {
      module.module_top.display.album.pics.forEach((pic: any, picIndex: number) => {
        if (pic.url) {
          images.push({
            url: pic.url,
            type: 'album_pic',
            description: `相册图片 ${picIndex + 1} (${pic.width}x${pic.height})`
          });
        }
      });
    }
    
    // 检查 MODULE_TYPE_CONTENT 模块中的图片
    if (module.module_type === 'MODULE_TYPE_CONTENT' && module.module_content?.paragraphs) {
      module.module_content.paragraphs.forEach((paragraph: any, paraIndex: number) => {
        // 检查段落类型为2（图片段落）且包含pic.pics
        if (paragraph.para_type === 2 && paragraph.pic?.pics) {
          paragraph.pic.pics.forEach((pic: any, picIndex: number) => {
            if (pic.url) {
              images.push({
                url: pic.url,
                type: 'content_pic',
                description: `内容图片 ${picIndex + 1} (${pic.width}x${pic.height})`
              });
            }
          });
        }
      });
    }
    
    // 保留原有的检查逻辑作为备用
    if (module.module_dynamic?.major) {
      const major = module.module_dynamic.major;
      
      // 检查 opus 图片 (用于图文动态)
      if (major.opus?.pics) {
        major.opus.pics.forEach((pic: any, index: number) => {
          if (pic.url) {
            images.push({
              url: pic.url,
              type: 'opus_pic',
              description: `Opus图片 ${index + 1} (${pic.width}x${pic.height})`
            });
          }
        });
      }
      
      // 检查 draw 图片 (用于传统动态)
      if (major.draw?.items) {
        major.draw.items.forEach((item: any, index: number) => {
          if (item.src) {
            images.push({
              url: item.src,
              type: 'draw_pic',
              description: `Draw图片 ${index + 1} (${item.width}x${item.height})`
            });
          }
        });
      }
    }
  });
  
  return images;
}

/**
 * 打印 dynamic card 中的所有图片 URL
 */
async function printImagesInDynamicCard(dynamicCard: DynamicCardItem) {
  const images = checkImagesInDynamicCard(dynamicCard);
  
  if (images.length === 0) {
    log.info('该动态卡片中未发现 Opus 图片');
    return;
  }
  
  log.info(`发现 ${images.length} 张 Opus 图片:`);
  images.forEach((image, index) => {
    log.info(`  ${index + 1}. ${image.description}: ${image.url}`);
  });
}

/**
 * 检查 dynamic card 中是否包含指定的话题ID
 */
function checkTopicIdInDynamicCard(dynamicCard: DynamicCardItem, targetTopicId: number): boolean {
  if (!dynamicCard.modules) {
    return false;
  }

  // 将modules统一转换为数组进行处理
  const modulesArray = Array.isArray(dynamicCard.modules) ? dynamicCard.modules : [dynamicCard.modules];
  
  for (const module of modulesArray) {
    // 检查 MODULE_TYPE_TOPIC 模块
    if (module.module_type === 'MODULE_TYPE_TOPIC' && module.module_topic?.id === targetTopicId) {
      return true;
    }
  }
  
  return false;
}

function getCsrfToken(cookie: string): string {
  const match = cookie.match(/bili_jct=([^;]*)/);
  if (match && match[1]) {
    return match[1];
  }
  throw new Error('Could not find "bili_jct" in the provided cookie. Please ensure your cookie is correct.');
}

/**
 * 从动态数据中提取作者ID
 */
function extractAuthorId(dynamicData: any): string | null {
  try {
    // 优先尝试从basic信息中获取
    if (dynamicData.basic?.rid_str) {
      log.debug(`尝试从basic信息中获取作者ID: ${dynamicData.basic.rid_str}`);
    }
    
    // 尝试从modules中的module_author获取
    if (dynamicData.modules) {
      const modulesArray = Array.isArray(dynamicData.modules) ? dynamicData.modules : [dynamicData.modules];
      
      for (const module of modulesArray) {
        if (module.module_author) {
          // 尝试多种可能的ID字段
          if (module.module_author.mid) {
            log.debug(`从module_author.mid获取作者ID: ${module.module_author.mid}`);
            return String(module.module_author.mid);
          }
          if (module.module_author.uid) {
            log.debug(`从module_author.uid获取作者ID: ${module.module_author.uid}`);
            return String(module.module_author.uid);
          }
          if (module.module_author.face && module.module_author.name) {
            // 如果有头像和名字，说明这是作者信息，但需要进一步查找ID
            log.debug(`发现作者信息 - 名字: ${module.module_author.name}`);
          }
        }
      }
    }
    
    // 尝试从顶级字段获取
    if (dynamicData.uid) {
      log.debug(`从顶级uid字段获取作者ID: ${dynamicData.uid}`);
      return String(dynamicData.uid);
    }
    if (dynamicData.mid) {
      log.debug(`从顶级mid字段获取作者ID: ${dynamicData.mid}`);
      return String(dynamicData.mid);
    }
    
    log.warn(`未能找到作者ID，打印完整数据结构用于调试`);
    log.debug(`完整动态数据键:`, Object.keys(dynamicData));
    
    return null;
  } catch (error) {
    log.error(`提取作者ID时出错:`, error instanceof Error ? error.message : '未知错误');
    return null;
  }
}

/**
 * 从动态数据中提取作者名称
 */
function extractAuthorName(dynamicData: any): string | null {
  try {
    // 尝试从modules中的module_author获取
    if (dynamicData.modules) {
      const modulesArray = Array.isArray(dynamicData.modules) ? dynamicData.modules : [dynamicData.modules];
      
      for (const module of modulesArray) {
        if (module.module_author && module.module_author.name) {
          log.debug(`从module_author.name获取作者名称: ${module.module_author.name}`);
          return module.module_author.name;
        }
      }
    }
    
    // 尝试从其他可能的字段获取
    if (dynamicData.desc?.user_profile?.info?.uname) {
      log.debug(`从desc.user_profile.info.uname获取作者名称: ${dynamicData.desc.user_profile.info.uname}`);
      return dynamicData.desc.user_profile.info.uname;
    }
    
    log.warn(`未能找到作者名称`);
    return null;
  } catch (error) {
    log.error(`提取作者名称时出错:`, error instanceof Error ? error.message : '未知错误');
    return null;
  }
}

// 图片信息接口
interface ImageInfo {
  img_src: string;
  img_width: number;
  img_height: number;
  img_size: number;
}

/**
 * 从cookie中提取csrf token
 */
function extractCsrfFromCookie(cookie: string): string | null {
  const match = cookie.match(/bili_jct=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * 上传图片到B站图床
 */
async function uploadImageToBiliBili(imagePath: string): Promise<ImageInfo | null> {
  try {
    const FormData = require('form-data');
    const formData = new FormData();
    
    // 获取文件统计信息以设置正确的Content-Type
    const fileBuffer = fs.readFileSync(imagePath);
    const fileName = imagePath.split('/').pop() || 'image.jpg';
    
    // 根据文件扩展名设置Content-Type
    let contentType = 'image/jpeg';
    if (fileName.toLowerCase().endsWith('.png')) {
      contentType = 'image/png';
    } else if (fileName.toLowerCase().endsWith('.gif')) {
      contentType = 'image/gif';
    } else if (fileName.toLowerCase().endsWith('.webp')) {
      contentType = 'image/webp';
    }
    
    formData.append('file_up', fileBuffer, {
      filename: fileName,
      contentType: contentType
    });
    formData.append('biz', 'new_dyn');
    formData.append('category', 'daily');
    
    // 从cookie中提取csrf token
    const csrf = extractCsrfFromCookie(config.cookie);
    if (!csrf) {
      log.error('  > 无法从cookie中提取csrf token');
      return null;
    }
    formData.append('csrf', csrf);

    const response = await axios.post(API.uploadImage, formData, {
      headers: {
        ...formData.getHeaders(),
        'Cookie': config.cookie,
      },
    });

    if (response.data.code === 0) {
      const imageData = response.data.data;
      log.info(`图片上传成功！URL: ${imageData.image_url}`);
      
      // 返回完整的图片信息
      return {
        img_src: imageData.image_url,
        img_width: imageData.image_width || 0,
        img_height: imageData.image_height || 0,
        img_size: imageData.image_size || 0
      };
    } else {
      log.error(`图片上传失败. Bilibili API response: ${response.data.message} (Code: ${response.data.code})`);
      return null;
    }
  } catch (error) {
    log.error('上传图片到B站图床失败:', error instanceof Error ? error.message : '未知错误');
    return null;
  }
}

// --- Main Application Logic ---

const apiClient = axios.create({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Cookie': config.cookie,
  },
});

// 标记是否正在处理中
let isProcessing = false;

/**
 * Main workflow function.
 */
async function checkAndComment() {
  if (isProcessing) {
    log.info(`Previous check still running, skipping...`);
    return;
  }
  
  isProcessing = true;
  log.info(`Checking for new @ messages...`);
  try {
    const response = await apiClient.get<AtFeedResponse>(API.getAtFeed, {
      params: { 
        platform: 'web',
        build: 0,
        mobi_app: 'web',
        web_location: '333.40164'
      },
    });

    const atMessages = response.data?.data?.items;
    if (!atMessages || atMessages.length === 0) {
      log.info(`No @ messages found. Message: ${response.data?.message}`);
      return;
    }

    log.info(`Found ${atMessages.length} @ messages, checking which ones need processing...`);

    // 处理所有@消息，依赖数据库记录来过滤已处理的
    let processedCount = 0;
    let skippedCount = 0;
    
    for (const atMessage of atMessages) {
      // 检查是否已处理过
      const isProcessed = await cloudDB.isAtMessageProcessed(atMessage.id);
      if (isProcessed) {
        skippedCount++;
        continue;
      }
      
      log.info(`Processing @ message! ID: ${atMessage.id}, From: ${atMessage.user.nickname}`);
      log.info(`Message title: ${atMessage.item.title}`);
      log.info(`URI: ${atMessage.item.uri}`);
      
      // 处理这个@消息
      await processAtMessage(atMessage);
      processedCount++;
    }

    log.info(`处理完成：新处理 ${processedCount} 条@消息，跳过 ${skippedCount} 条已处理的消息`);
  } catch (error) {
    log.error('Error fetching @ messages:', error instanceof Error ? error.message : 'An unknown error occurred.');
  } finally {
    isProcessing = false;
  }
}

/**
 * 处理@消息，获取动态详情并评论
 */
async function processAtMessage(atMessage: AtMessage) {
  try {
    // 从URI中提取动态ID
    let dynamicId: string;
    
    // 检查URI格式并提取正确的动态ID
    const uri = atMessage.item.uri;
    if (uri.includes('/opus/')) {
      // 处理 opus 格式的URI: https://www.bilibili.com/opus/1093350140720185351
      const opusMatch = uri.match(/\/opus\/(\d+)/);
      if (opusMatch && opusMatch[1]) {
        dynamicId = opusMatch[1];
      } else {
        log.info(`  > Could not extract opus ID from URI: ${uri}`);
        
        // 将无法解析opus ID的URI视为已处理，避免重复处理
        const processedMessage: ProcessedAtMessage = {
          atMessageId: atMessage.id,
          dynamicId: 'unparseable_opus_uri',
          processedAt: Date.now(),
          fromUser: atMessage.user.nickname,
          uri: uri
        };
        await cloudDB.recordProcessedAtMessage(processedMessage);
        log.info(`  > ✅ 无法解析opus URI的@消息 ${atMessage.id} 已标记为已处理，避免重复尝试`);
        
        return;
      }
    } else if (uri.includes('t.bilibili.com/')) {
      // 处理传统动态格式的URI: https://t.bilibili.com/1017882063465873410
      const dynamicMatch = uri.match(/t\.bilibili\.com\/(\d+)/);
      if (dynamicMatch && dynamicMatch[1]) {
        dynamicId = dynamicMatch[1];
      } else {
        log.info(`  > Could not extract dynamic ID from URI: ${uri}`);
        
        // 将无法解析的URI视为已处理，避免重复处理
        const processedMessage: ProcessedAtMessage = {
          atMessageId: atMessage.id,
          dynamicId: 'unparseable_uri',
          processedAt: Date.now(),
          fromUser: atMessage.user.nickname,
          uri: uri
        };
        await cloudDB.recordProcessedAtMessage(processedMessage);
        log.info(`  > ✅ 无法解析URI的@消息 ${atMessage.id} 已标记为已处理，避免重复尝试`);
        
        return;
      }
    } else {
      log.info(`  > Unsupported URI format: ${uri}`);
      
      // 将无效的URI格式视为已处理，避免重复处理
      const processedMessage: ProcessedAtMessage = {
        atMessageId: atMessage.id,
        dynamicId: 'invalid_uri',
        processedAt: Date.now(),
        fromUser: atMessage.user.nickname,
        uri: uri
      };
      await cloudDB.recordProcessedAtMessage(processedMessage);
      log.info(`  > ✅ 无效URI格式的@消息 ${atMessage.id} 已标记为已处理，避免重复尝试`);
      
      return;
    }
    
    log.info(`  > Processing dynamic ID: ${dynamicId} (extracted from URI: ${uri})`);
    
    // 获取动态详情
    let dynamicResponse;
    let dynamicData;
    
    if (uri.includes('/opus/')) {
      // 对于opus格式，使用opus专用API
      try {
        log.info(`  > Fetching opus details using opus API...`);
        dynamicResponse = await apiClient.get('https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/detail', {
          params: { id: dynamicId }
        });
        dynamicData = dynamicResponse.data?.data?.item;
        log.info(`  > Opus API response code: ${dynamicResponse.data?.code}, message: ${dynamicResponse.data?.message}`);
      } catch (error) {
        log.info(`  > Failed to get opus details: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    // 如果opus API失败或者不是opus格式，尝试使用通用动态API
    if (!dynamicData) {
      try {
        log.info(`  > Fetching dynamic details using general API...`);
        dynamicResponse = await apiClient.get(API.getDynamicDetails, {
          params: { id: dynamicId }
        });
        dynamicData = dynamicResponse.data?.data?.item;
        log.info(`  > General API response code: ${dynamicResponse.data?.code}, message: ${dynamicResponse.data?.message}`);
      } catch (error) {
        log.info(`  > Failed to get dynamic details: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    if (!dynamicData) {
      log.info(`  > Could not get dynamic details for ID: ${dynamicId} using any API`);
      return;
    }

    // 检查动态创建时间，如果超过1天则跳过评论
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000; // 24小时的毫秒数
    
    // 尝试从多个可能的字段获取创建时间
    let createTime: number | null = null;
    
    // 常见的时间字段（通常是秒级时间戳）
    const timeFields = ['pub_time', 'pub_ts', 'ctime', 'timestamp', 'create_time'];
    for (const field of timeFields) {
      if (dynamicData[field]) {
        // B站时间戳通常是秒级，需要转换为毫秒
        createTime = Number(dynamicData[field]) * 1000;
        log.info(`  > 从字段 ${field} 获取到创建时间: ${new Date(createTime).toLocaleString()}`);
        break;
      }
    }
    
    // 如果顶级字段没有，尝试从basic字段获取
    if (!createTime && dynamicData.basic) {
      for (const field of timeFields) {
        if (dynamicData.basic[field]) {
          createTime = Number(dynamicData.basic[field]) * 1000;
          log.info(`  > 从basic.${field} 获取到创建时间: ${new Date(createTime).toLocaleString()}`);
          break;
        }
      }
    }
    
    // 如果还是没有，尝试从modules中的module_author获取
    if (!createTime && dynamicData.modules) {
      const modulesArray = Array.isArray(dynamicData.modules) ? dynamicData.modules : [dynamicData.modules];
      for (const module of modulesArray) {
        if (module.module_author && module.module_author.pub_ts) {
          createTime = Number(module.module_author.pub_ts) * 1000;
          log.info(`  > 从module_author.pub_ts 获取到创建时间: ${new Date(createTime).toLocaleString()}`);
          break;
        }
      }
    }
    
    if (createTime) {
      const timeDiff = now - createTime;
      log.info(`  > 动态创建时间: ${new Date(createTime).toLocaleString()}`);
      log.info(`  > 距离现在: ${Math.round(timeDiff / (1000 * 60 * 60))} 小时`);
      
      if (timeDiff > oneDayMs) {
        log.info(`  > ⚠️ 动态创建时间超过24小时，跳过评论`);
        
        // 仍然记录已处理的@消息，避免下次重复检查
        const processedMessage: ProcessedAtMessage = {
          atMessageId: atMessage.id,
          dynamicId: dynamicId,
          processedAt: Date.now(),
          fromUser: atMessage.user.nickname,
          uri: uri
        };
        await cloudDB.recordProcessedAtMessage(processedMessage);
        return;
      } else {
        log.info(`  > ✅ 动态创建时间在24小时内，继续处理`);
      }
    } else {
      log.info(`  > ⚠️ 无法获取动态创建时间，继续处理（假设是新动态）`);
    }

    // 将动态数据转换为我们的格式，使用动态本身的basic信息
    const dynamicCard: DynamicCardItem = {
      id_str: dynamicId,
      basic: dynamicData.basic || {
        comment_type: atMessage.item.business_id,
        rid_str: dynamicId
      },
      modules: dynamicData.modules
    };

    // 添加调试信息
    log.info(`  > Dynamic data structure keys:`, Object.keys(dynamicData));
    log.info(`  > Basic info:`, dynamicData.basic);
    
    if (dynamicData.modules) {
      log.info(`  > Modules keys:`, Object.keys(dynamicData.modules));
      log.info(`  > Modules is array:`, Array.isArray(dynamicData.modules));
      
      if (Array.isArray(dynamicData.modules)) {
        // modules 是数组，遍历每个模块
        dynamicData.modules.forEach((module: any, index: number) => {
          log.info(`  > Module ${index} keys:`, Object.keys(module));
          if (module.module_dynamic) {
            log.info(`  > Module ${index} dynamic keys:`, Object.keys(module.module_dynamic));
            if (module.module_dynamic.major) {
              log.info(`  > Module ${index} major keys:`, Object.keys(module.module_dynamic.major));
            }
          }
        });
      } else {
        // modules 是对象
        if (dynamicData.modules.module_dynamic) {
          log.info(`  > Module_dynamic keys:`, Object.keys(dynamicData.modules.module_dynamic));
          if (dynamicData.modules.module_dynamic.major) {
            log.info(`  > Major keys:`, Object.keys(dynamicData.modules.module_dynamic.major));
          }
        }
      }
    }
    
    // 检查并打印图片信息
    await printImagesInDynamicCard(dynamicCard);
    
    // 检查是否需要评论，使用动态本身的comment参数
    const commentType = dynamicCard.basic?.comment_type || atMessage.item.business_id;
    const commentRid = dynamicCard.basic?.rid_str || dynamicId;
    
    log.info(`  > Using comment parameters - type: ${commentType}, rid: ${commentRid}`);
    const success = await checkIfUserCommentedAndPost(commentType, commentRid, dynamicCard, dynamicData);
    
    if (success) {
      // 只有成功处理时才记录已处理的@消息
      const processedMessage: ProcessedAtMessage = {
        atMessageId: atMessage.id,
        dynamicId: dynamicId,
        processedAt: Date.now(),
        fromUser: atMessage.user.nickname,
        uri: uri
      };
      await cloudDB.recordProcessedAtMessage(processedMessage);
      log.info(`  > ✅ @消息 ${atMessage.id} 处理成功并已记录`);
    } else {
      log.info(`  > ❌ @消息 ${atMessage.id} 处理失败，未记录，下次将重试`);
    }

  } catch (error) {
    log.error(`  > Error processing @ message:`, error instanceof Error ? error.message : 'An unknown error occurred.');
    log.info(`  > ❌ @消息 ${atMessage.id} 处理出错，未记录，下次将重试`);
  }
}

/**
 * Step 2: Check if the monitored user has already commented.
 * @returns {Promise<boolean>} 返回true表示成功处理，false表示失败或跳过
 */
async function checkIfUserCommentedAndPost(type: number, rid: string, dynamicCard: DynamicCardItem, dynamicData?: any): Promise<boolean> {
  // 首先检查动态卡片是否包含图片，如果没有图片就不需要评论
  const images = checkImagesInDynamicCard(dynamicCard);
  if (images.length === 0) {
    log.info(`  > 动态卡片中未发现图片，跳过评论`);
    return true; // 跳过但不是错误，返回true避免重试
  }
  
  // 检查动态作者今天是否已经被评论过（每日限制）
  if (dynamicData) {
    const authorId = extractAuthorId(dynamicData);
    if (authorId) {
      log.info(`  > 检查作者 ${authorId} 的每日评论限制...`);
      const hasCommentedToday = await cloudDB.hasUserCommentedToday(authorId);
      if (hasCommentedToday) {
        log.info(`  > 作者 ${authorId} 今天已经被评论过，跳过本次评论`);
        return true; // 跳过但不是错误，返回true避免重试
      }
      log.info(`  > 作者 ${authorId} 今天尚未被评论，可以继续检查具体动态`);
    }
  }
  
  log.info(`  > Checking comments for dynamic (oid: ${rid}, type: ${type})`);
  try {
    const response = await apiClient.get<CommentAPIResponse>(API.getComments, {
      params: { oid: rid, type: type, mode: 3, ps: 30 },
    });

    const comments = response.data?.data?.replies;
    if (comments) {
      for (const comment of comments) {
        if (comment.member.mid === config.uidToMonitor) {
          log.info(`  > User ${config.uidToMonitor} has already commented. Skipping. Comment content: ${comment.content.message}`);
          return true; // 已评论，跳过但不是错误
        }
        if (comment.replies) {
          for (const subReply of comment.replies) {
            if (subReply.member.mid === config.uidToMonitor) {
              log.info(`  > User ${config.uidToMonitor} has already commented (in a sub-reply). Skipping.`);
              return true; // 已评论，跳过但不是错误
            }
          }
        }
      }
    }
    
    log.info(`  > User ${config.uidToMonitor} has not commented. Proceeding to post.`);
    return await postComment(type, rid, dynamicCard, dynamicData);

  } catch (error) {
    log.error('  > Error fetching comments:', error instanceof Error ? error.message : 'An unknown error occurred.');
    return false; // 发生异常，返回失败
  }
}

/**
 * Step 3: Post the actual comment.
 * @returns {Promise<boolean>} 返回true表示成功，false表示失败
 */
async function postComment(type: number, rid: string, dynamicCard: DynamicCardItem, dynamicData?: any): Promise<boolean> {
  let authorId: string | null = null;
  let recordSaved = false; // 记录是否已保存
  
  try {
    const csrf = getCsrfToken(config.cookie);
    
    let commentText = config.commentText;
    let cloudTypes: CloudType[] = [];
    
    // 提取作者ID
    if (dynamicData) {
      authorId = extractAuthorId(dynamicData);
      if (authorId) {
        log.info(`  > 成功提取动态作者ID: ${authorId}`);
      } else {
        log.info(`  > 无法提取动态作者ID，将跳过数据库记录`);
      }
    }
    
    // 只有在需要评论时才进行云朵分析
    if (config.enableCloudAnalysis) {
      const images = checkImagesInDynamicCard(dynamicCard);
      
      if (images.length > 0) {
        try {
          const cloudAnalyzer = new CloudAnalyzer(config.openai);
          const imageUrls = images.map(img => img.url);
          
          log.info('  > 开始分析图片中的云朵类型...');
          
          // 使用优化后的方法，直接获取云朵类型和生成的评论
          const analysisResult = await cloudAnalyzer.analyzeMultipleImagesWithTypes(imageUrls);
          
          cloudTypes = analysisResult.cloudTypes;
          commentText = analysisResult.comment;
          
          log.info(`  > 检测到 ${cloudTypes.length} 种云彩类型:`);
          cloudTypes.forEach(cloud => {
            log.info(`    - ${cloud.type} (置信度: ${cloud.confidence.toFixed(2)})`);
          });
          
          log.info('  > 使用基于云朵分析生成的comment内容');
          
        } catch (error) {
          log.error('  > 云朵分析失败:', error instanceof Error ? error.message : '未知错误');
          log.error('  > 分析失败，停止处理该@消息，下次重试');
          return false; // 返回失败状态，不进行后续处理
        }
      } else {
        log.info('  > 未发现图片，无法进行云朵分析');
        log.info('  > 停止处理该@消息');
        return false; // 没有图片也返回失败，避免发送无意义评论
      }
    } else {
      log.info('  > 云朵分析功能未启用，使用默认comment内容');
      // 云朵分析功能未启用时，使用默认内容，这是正常情况
      cloudTypes = [{
        type: '云朵',
        confidence: 0.5,
        description: '云朵分析功能未启用'
      }];
    }
    
    // 保存打卡记录到数据库
    let userStats = null;
    if (authorId && cloudTypes.length > 0) {
      try {
        const images = checkImagesInDynamicCard(dynamicCard);
        const authorName = extractAuthorName(dynamicData) || `用户${authorId}`;
        const checkInRecord: CheckInRecord = {
          dynamicId: dynamicCard.id_str,
          timestamp: Date.now(),
          cloudTypes: cloudTypes,
          imageCount: images.length,
          analysis: commentText
        };
        
        await cloudDB.recordCheckIn(authorId, authorName, checkInRecord);
        recordSaved = true; // 标记记录已保存
        log.info(`  > ✅ 用户 ${authorName} (${authorId}) 的云朵打卡记录已保存`);
        
        // 获取用户最新统计，用于生成打卡图片
        userStats = await cloudDB.getUserStats(authorId);
        
      } catch (dbError) {
        log.error('  > 保存打卡记录失败:', dbError instanceof Error ? dbError.message : '未知错误');
      }
    }
    
    // 生成并上传打卡纪念图片
    let imageInfo: ImageInfo | null = null;
    if (userStats && config.enableCheckInImage) {
      try {
        log.info('  > 📸 开始生成打卡纪念图片...');
        const imagePath = await imageGenerator.generateCheckInImage(userStats);
        log.info(`  > 打卡图片生成成功: ${imagePath}`);
        
        log.info('  > 📤 开始上传图片到B站图床...');
        imageInfo = await uploadImageToBiliBili(imagePath);
        
        if (imageInfo) {
          log.info('  > ✅ 打卡图片上传成功，将添加到评论表单中');
        } else {
          log.info('  > ❌ 图片上传失败，跳过图片部分');
        }
        
        // 删除本地临时图片文件
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
          log.info('  > 🗑️ 已清理本地临时图片文件');
        }
        
      } catch (imageError) {
        log.error('  > 生成或上传打卡图片失败:', imageError instanceof Error ? imageError.message : '未知错误');
        log.info('  > 继续发送文本评论...');
      }
    }
    
    log.info(`  > 最终comment内容: ${commentText}`);
    
    // 构建评论payload
    const payloadData: Record<string, string> = {
      oid: rid,
      type: String(type),
      message: commentText,
      plat: '1',
      csrf: csrf,
      at_name_to_mid: '{}',
      gaia_source: 'main_web',
      statistics: JSON.stringify({ appId: 100, platform: 5 }),
    };

    // 如果有图片，添加到pictures字段
    if (imageInfo) {
      payloadData.pictures = JSON.stringify([imageInfo]);
      log.info(`  > 添加图片到评论: ${imageInfo.img_src} (${imageInfo.img_width}x${imageInfo.img_height})`);
    }

    const payload = new URLSearchParams(payloadData).toString();

    log.info(`  > Attempting to post comment: "${commentText.substring(0, 100)}${commentText.length > 100 ? '...' : ''}"`);
    log.info(`  > Comment payload:`, payload);
    
    const response = await apiClient.post<CommentAPIResponse>(API.addComment, payload, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (response.data.code === 0) {
      log.info('  > Successfully posted comment!');
      
      // 记录作者今天已经被评论过
      if (authorId) {
        try {
          await cloudDB.recordDailyComment(authorId);
        } catch (dailyRecordError) {
          log.error('  > 记录每日评论失败:', dailyRecordError instanceof Error ? dailyRecordError.message : '未知错误');
          // 每日评论记录失败不影响主流程，继续执行
        }
      }
      
      return true; // 评论发送成功
    } else {
      log.info(
        `  > Comment API response:`,
        JSON.stringify(response.data, null, 2)
      );
      
      // 评论失败，撤销已保存的记录
      if (recordSaved && authorId) {
        log.info('  > 评论发送失败，正在撤销打卡记录...');
        try {
          const rollbackSuccess = await cloudDB.rollbackLastCheckIn(authorId);
          if (rollbackSuccess) {
            log.info('  > ✅ 打卡记录已成功撤销');
          } else {
            log.info('  > ❌ 撤销打卡记录失败');
          }
        } catch (rollbackError) {
          log.error('  > 撤销打卡记录时发生错误:', rollbackError instanceof Error ? rollbackError.message : '未知错误');
        }
      }
      
      return false; // 评论发送失败
    }
  } catch (error) {
    log.error('  > Error posting comment:', error instanceof Error ? error.message : 'An unknown error occurred.');
    
    // 发生异常，撤销已保存的记录
    if (recordSaved && authorId) {
      log.info('  > 评论发送异常，正在撤销打卡记录...');
      try {
        const rollbackSuccess = await cloudDB.rollbackLastCheckIn(authorId);
        if (rollbackSuccess) {
          log.info('  > ✅ 打卡记录已成功撤销');
        } else {
          log.info('  > ❌ 撤销打卡记录失败');
        }
      } catch (rollbackError) {
        log.error('  > 撤销打卡记录时发生错误:', rollbackError instanceof Error ? rollbackError.message : '未知错误');
      }
    }
    
    return false; // 发生异常，返回失败
  }
}

/**
 * 查询用户打卡统计模式
 */
async function queryUserStats(userId: string) {
  log.info(`正在查询用户 ${userId} 的打卡统计...`);
  
  try {
    const userStats = await cloudDB.getUserStats(userId);
    
    if (!userStats) {
      log.info(`❌ 用户 ${userId} 还没有打卡记录`);
      return;
    }
    
    // 生成用户报告
    const report = await cloudDB.generateUserReport(userId);
    log.info('\n' + '='.repeat(50));
    log.info(report || '用户没有打卡记录');
    log.info('='.repeat(50));
    
    // 显示最近的打卡记录
    const recentCheckIns = await cloudDB.getRecentCheckIns(userId, 5);
    if (recentCheckIns.length > 0) {
      log.info('\n📋 最近5次打卡记录:');
      recentCheckIns.forEach((record, index) => {
        const date = new Date(record.timestamp).toLocaleString('zh-CN');
        const cloudTypesStr = record.cloudTypes.map(c => c.type).join(', ');
        log.info(`${index + 1}. ${date}`);
        log.info(`   动态ID: ${record.dynamicId}`);
        log.info(`   云彩类型: ${cloudTypesStr}`);
        log.info(`   图片数量: ${record.imageCount}`);
        log.info(`   分析结果: ${record.analysis.substring(0, 100)}...`);
        log.info('');
      });
    }
    
    // 生成打卡纪念图
    try {
      log.info('\n🎨 正在生成打卡纪念图...');
      const imagePath = await imageGenerator.generateCheckInImage(userStats);
      log.info(`🖼️  纪念图保存位置: ${imagePath}`);
      log.info('💡 您可以在文件管理器中打开查看纪念图！');
    } catch (imageError) {
      log.error('🚫 生成纪念图失败:', imageError instanceof Error ? imageError.message : '未知错误');
      log.info('💭 不过您的统计数据都是正确的，图片功能是额外的小彩蛋～');
    }
    
  } catch (error) {
    log.error('查询用户统计失败:', error instanceof Error ? error.message : '未知错误');
  }
}

/**
 * 显示全局统计信息
 */
async function showGlobalStats() {
  log.info('正在获取全局统计信息...');
  
  try {
    // 云彩类型排行榜
    const cloudRanking = await cloudDB.getGlobalCloudTypeRanking();
    if (cloudRanking.length > 0) {
      log.info('\n☁️ 全球云彩类型排行榜:');
      cloudRanking.slice(0, 10).forEach((item, index) => {
        const emoji = ['🥇', '🥈', '🥉'][index] || '🏅';
        log.info(`${emoji} ${item.type}: ${item.count} 次`);
      });
    }
    
    // 活跃用户排行榜
    const activeUsers = await cloudDB.getActiveUsersRanking(10);
    if (activeUsers.length > 0) {
      log.info('\n🏆 活跃用户排行榜:');
      activeUsers.forEach((user, index) => {
        const emoji = ['🥇', '🥈', '🥉'][index] || '🏅';
        log.info(`${emoji} 用户 ${user.userId}: ${user.checkIns} 次打卡, ${user.cloudTypes} 种云彩`);
      });
    }
    
  } catch (error) {
    log.error('获取全局统计失败:', error instanceof Error ? error.message : '未知错误');
  }
}

/**
 * 测试模式：获取最近的@消息，生成comment内容但不发布
 */
async function testMode() {
  log.info('Starting Test Mode - 测试comment生成效果...');
  
  if (config.cookie === 'YOUR_COOKIE_STRING_HERE') {
    log.error('Please fill in your cookie in src/config.ts before running the bot.');
    return;
  }

  try {
    log.info('正在获取最近的@消息...');
    const response = await apiClient.get<AtFeedResponse>(API.getAtFeed, {
      params: { 
        platform: 'web',
        build: 0,
        mobi_app: 'web',
        web_location: '333.40164'
      },
    });

    const atMessages = response.data?.data?.items;
    if (!atMessages || atMessages.length === 0) {
      log.info('未找到@消息');
      return;
    }

    // 获取最新的@消息
    const latestAtMessage = atMessages[0];
    log.info(`找到最新@消息! ID: ${latestAtMessage.id}, 来自: ${latestAtMessage.user.nickname}`);
    log.info(`消息标题: ${latestAtMessage.item.title}`);
    log.info(`URI: ${latestAtMessage.item.uri}`);

    // 从URI中提取动态ID
    let dynamicId: string;
    const uri = latestAtMessage.item.uri;
    
    if (uri.includes('/opus/')) {
      const opusMatch = uri.match(/\/opus\/(\d+)/);
      if (opusMatch && opusMatch[1]) {
        dynamicId = opusMatch[1];
      } else {
        log.info(`无法从URI中提取opus ID: ${uri}`);
        return;
      }
    } else if (uri.includes('t.bilibili.com/')) {
      const dynamicMatch = uri.match(/t\.bilibili\.com\/(\d+)/);
      if (dynamicMatch && dynamicMatch[1]) {
        dynamicId = dynamicMatch[1];
      } else {
        log.info(`无法从URI中提取动态ID: ${uri}`);
        return;
      }
    } else {
      log.info(`不支持的URI格式: ${uri}`);
      return;
    }

    log.info(`正在处理动态ID: ${dynamicId}`);

    // 获取动态详情
    let dynamicResponse;
    let dynamicData;
    
    if (uri.includes('/opus/')) {
      try {
        log.info('使用opus API获取动态详情...');
        dynamicResponse = await apiClient.get('https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/detail', {
          params: { id: dynamicId }
        });
        dynamicData = dynamicResponse.data?.data?.item;
      } catch (error) {
        log.info(`获取opus详情失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }
    
    if (!dynamicData) {
      try {
        log.info('使用通用API获取动态详情...');
        dynamicResponse = await apiClient.get(API.getDynamicDetails, {
          params: { id: dynamicId }
        });
        dynamicData = dynamicResponse.data?.data?.item;
      } catch (error) {
        log.info(`获取动态详情失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }

    if (!dynamicData) {
      log.info(`无法获取动态详情，动态ID: ${dynamicId}`);
      return;
    }

    // 转换为我们的格式
    const dynamicCard: DynamicCardItem = {
      id_str: dynamicId,
      basic: dynamicData.basic || {
        comment_type: latestAtMessage.item.business_id,
        rid_str: dynamicId
      },
      modules: dynamicData.modules
    };

    // 检查图片
    const images = checkImagesInDynamicCard(dynamicCard);
    if (images.length === 0) {
      log.info('该动态中未发现图片，无法生成云朵分析comment');
      log.info(`默认comment内容: "${config.commentText}"`);
      return;
    }
    
    // 检查话题ID
    const targetTopicId = 38405;
    const hasTargetTopic = checkTopicIdInDynamicCard(dynamicCard, targetTopicId);
    if (!hasTargetTopic) {
      log.info(`该动态中未发现话题ID ${targetTopicId}（云有所伊），无法生成comment`);
      log.info(`默认comment内容: "${config.commentText}"`);
      return;
    }
    
    log.info(`验证通过：动态包含图片且话题ID为 ${targetTopicId}（云有所伊）`);

    log.info(`发现 ${images.length} 张图片:`);
    images.forEach((image, index) => {
      log.info(`  ${index + 1}. ${image.description}: ${image.url}`);
    });

    // 生成comment内容并记录打卡数据
    let commentText = config.commentText;
    let cloudTypes: CloudType[] = [];
    
    // 提取作者ID
    const authorId = extractAuthorId(dynamicData);
    if (authorId) {
      log.info(`\n📝 检测到动态作者ID: ${authorId}`);
    } else {
      log.info(`\n⚠️  无法提取动态作者ID，将跳过数据库记录`);
    }
    
    if (config.enableCloudAnalysis) {
      try {
        const cloudAnalyzer = new CloudAnalyzer(config.openai);
        const imageUrls = images.map(img => img.url);
        
        log.info('\n=== 开始云朵分析 ===');
        
        // 使用优化后的方法，直接获取云朵类型和生成的评论
        const analysisResult = await cloudAnalyzer.analyzeMultipleImagesWithTypes(imageUrls);
        
        cloudTypes = analysisResult.cloudTypes;
        commentText = analysisResult.comment;
        
        log.info(`\n=== 检测到 ${cloudTypes.length} 种云彩类型 ===`);
        cloudTypes.forEach(cloud => {
          log.info(`☁️  ${cloud.type} (置信度: ${cloud.confidence.toFixed(2)})`);
        });
        
        log.info('\n=== 生成的comment内容 ===');
        log.info(`"${commentText}"`);
        
      } catch (error) {
        log.error('\n=== 云朵分析失败 ===');
        log.error(error instanceof Error ? error.message : '未知错误');
        log.info('❌ 分析失败，跳过后续处理');
        return; // 直接返回，跳过后续的数据库保存和图片生成
      }
    } else {
      log.info('\n=== 云朵分析功能未启用，使用默认comment ===');
      log.info(`"${commentText}"`);
      
      // 未启用分析时也记录基础信息
      cloudTypes = [{
        type: '云朵',
        confidence: 0.5,
        description: '云朵分析功能未启用'
      }];
    }
    
    // 保存打卡记录到数据库（测试模式也记录）
    if (authorId && cloudTypes.length > 0) {
      try {
        log.info('\n=== 保存打卡记录到数据库 ===');
        
        const authorName = extractAuthorName(dynamicData) || `用户${authorId}`;
        const checkInRecord: CheckInRecord = {
          dynamicId: dynamicId,
          timestamp: Date.now(),
          cloudTypes: cloudTypes,
          imageCount: images.length,
          analysis: commentText
        };
        
        await cloudDB.recordCheckIn(authorId, authorName, checkInRecord);
        log.info(`✅ 用户 ${authorName} (${authorId}) 的云朵打卡记录已保存到数据库`);
        
        // 显示用户最新统计
        const userStats = await cloudDB.getUserStats(authorId);
        if (userStats) {
          log.info(`📊 用户当前统计: 总打卡 ${userStats.totalCheckIns} 次, 发现 ${Object.keys(userStats.cloudTypeStats).length} 种云彩`);
          
          // 在测试模式中生成打卡纪念图片（但不上传）
          if (config.enableCheckInImage) {
            try {
              log.info('\n=== 生成打卡纪念图片（测试模式）===');
              const imagePath = await imageGenerator.generateCheckInImage(userStats);
              log.info(`📸 打卡纪念图片已生成: ${imagePath}`);
              log.info('💡 在测试模式下，图片已保存到本地，但不会上传到B站图床');
            } catch (imageError) {
              log.error('❌ 生成打卡图片失败:', imageError instanceof Error ? imageError.message : '未知错误');
            }
          }
        }
        
      } catch (dbError) {
        log.error('❌ 保存打卡记录失败:', dbError instanceof Error ? dbError.message : '未知错误');
      }
    }

    log.info('\n=== 测试完成 ===');
    log.info('注意：在测试模式下，comment不会被实际发布，但打卡数据已记录到数据库');

  } catch (error) {
    log.error('测试模式出错:', error instanceof Error ? error.message : '未知错误');
  }
}

/**
 * 清除指定@消息的处理记录
 */
async function clearProcessedMessage(atMessageId: number) {
  log.info(`正在清除@消息 ${atMessageId} 的处理记录...`);
  
  // 检查记录是否存在
  const existingRecord = await cloudDB.getProcessedAtMessage(atMessageId);
  if (!existingRecord) {
    log.info(`❌ @消息 ${atMessageId} 的处理记录不存在`);
    return;
  }
  
  log.info(`📋 找到记录:`);
  log.info(`  - @消息ID: ${existingRecord.atMessageId}`);
  log.info(`  - 动态ID: ${existingRecord.dynamicId}`);
  log.info(`  - 处理时间: ${new Date(existingRecord.processedAt).toLocaleString()}`);
  log.info(`  - 来源用户: ${existingRecord.fromUser}`);
  log.info(`  - URI: ${existingRecord.uri}`);
  
  // 删除记录
  const success = await cloudDB.deleteProcessedAtMessage(atMessageId);
  if (success) {
    log.info(`✅ @消息 ${atMessageId} 的处理记录已清除，下次运行时将重新处理`);
  } else {
    log.info(`❌ 清除@消息 ${atMessageId} 的处理记录失败`);
  }
}

/**
 * 列出所有已处理的@消息
 */
async function listProcessedMessages() {
  log.info('正在获取所有已处理的@消息记录...');
  
  const processedIds = await cloudDB.listProcessedAtMessages();
  if (processedIds.length === 0) {
    log.info('📭 没有找到已处理的@消息记录');
    return;
  }
  
  log.info(`📋 找到 ${processedIds.length} 条已处理的@消息记录:`);
  log.info('');
  
  // 显示前10条记录的详细信息
  const displayCount = Math.min(10, processedIds.length);
  for (let i = 0; i < displayCount; i++) {
    const atMessageId = processedIds[i];
    const record = await cloudDB.getProcessedAtMessage(atMessageId);
    if (record) {
      log.info(`${i + 1}. @消息ID: ${record.atMessageId}`);
      log.info(`   动态ID: ${record.dynamicId}`);
      log.info(`   处理时间: ${new Date(record.processedAt).toLocaleString()}`);
      log.info(`   来源用户: ${record.fromUser}`);
      log.info('');
    }
  }
  
  if (processedIds.length > 10) {
    log.info(`... 还有 ${processedIds.length - 10} 条记录`);
  }
  
  log.info('💡 使用 --clear-message <消息ID> 来清除指定消息的处理记录');
}

/**
 * 主函数 - 处理命令行参数
 */
function main() {
  // 检查命令行参数
  const args = process.argv.slice(2);
  
  if (args.includes('--test')) {
    testMode();
    return;
  }
  
  if (args.includes('--stats')) {
    // 查询用户统计
    const userIdIndex = args.indexOf('--user');
    if (userIdIndex !== -1 && args[userIdIndex + 1]) {
      const userId = args[userIdIndex + 1];
      queryUserStats(userId);
    } else {
      log.info('请指定用户ID: --stats --user <用户ID>');
    }
    return;
  }
  
  if (args.includes('--global')) {
    // 显示全局统计
    showGlobalStats();
    return;
  }

  if (args.includes('--clear-message')) {
    const messageIdIndex = args.indexOf('--clear-message');
    if (messageIdIndex !== -1 && args[messageIdIndex + 1]) {
      const atMessageId = parseInt(args[messageIdIndex + 1], 10);
      if (!isNaN(atMessageId)) {
        clearProcessedMessage(atMessageId);
      } else {
        log.info('请提供有效的@消息ID (数字)');
      }
    } else {
      log.info('请提供@消息ID: --clear-message <消息ID>');
    }
    return;
  }

  if (args.includes('--list-messages')) {
    listProcessedMessages();
    return;
  }

  if (args.includes('--help')) {
    log.info('云朵打卡机器人使用说明:');
    log.info('');
    log.info('命令行参数:');
    log.info('  无参数           - 启动机器人监听模式');
    log.info('  --test          - 测试模式，分析最新@消息但不发布评论（包含图片生成）');
    log.info('  --stats --user <ID>  - 查询指定用户的打卡统计');
    log.info('  --global        - 显示全局统计信息');
    log.info('  --clear-message <消息ID> - 清除指定@消息的处理记录');
    log.info('  --list-messages - 列出所有已处理的@消息');
    log.info('  --help          - 显示此帮助信息');
    log.info('');
    log.info('示例:');
    log.info('  npm start                    # 启动机器人');
    log.info('  npm start -- --test          # 测试模式');
    log.info('  npm start -- --stats --user 123456  # 查询用户统计');
    log.info('  npm start -- --global        # 全局统计');
    log.info('  npm start -- --list-messages # 列出已处理的@消息');
    log.info('  npm start -- --clear-message 12345  # 清除@消息12345的处理记录');
    return;
  }

  log.info('Starting Bilibili @ Message Comment Bot...');
  log.info('💡 提示: 使用 --help 查看所有可用命令');

  if (config.cookie === 'YOUR_COOKIE_STRING_HERE') {
    log.error('Please fill in your cookie in src/config.ts before running the bot.');
    return;
  }

  // 启动定时循环
  const scheduleNext = () => {
    setTimeout(async () => {
      await checkAndComment();
      scheduleNext(); // 递归调度下一次执行
    }, config.checkInterval);
  };
  
  // 立即执行第一次，然后开始循环
  checkAndComment().then(() => {
    scheduleNext();
  });
}

main();