// src/database.ts
import { Level } from 'level';
import path from 'path';

// 云彩类型数据结构
export interface CloudType {
  type: string;        // 云朵类型名称，如"积云"、"层云"等
  confidence: number;  // 识别置信度 0-1
  description?: string; // 描述信息
}

// 单次打卡记录
export interface CheckInRecord {
  dynamicId: string;    // 动态ID
  timestamp: number;    // 时间戳
  cloudTypes: CloudType[]; // 检测到的云彩类型列表
  imageCount: number;   // 图片数量
  analysis: string;     // AI分析结果文本
}

// 已处理的@消息记录
export interface ProcessedAtMessage {
  atMessageId: number;  // @消息ID
  dynamicId: string;    // 对应的动态ID
  processedAt: number;  // 处理时间戳
  fromUser: string;     // 来源用户
  uri: string;          // 原始URI
}

// 用户打卡统计
export interface UserStats {
  userName: string;
  totalCheckIns: number;                    // 总打卡次数
  totalImages: number;                      // 总图片数
  cloudTypeStats: { [cloudType: string]: number }; // 各云彩类型统计
  firstCheckIn: number;                     // 首次打卡时间戳
  lastCheckIn: number;                      // 最后打卡时间戳
  checkInRecords: CheckInRecord[];          // 打卡记录列表
}

export class CloudDatabase {
  private db: Level<string, any>;

  constructor(dbPath?: string) {
    const defaultPath = path.join(process.cwd(), 'data', 'cloud-checkins');
    this.db = new Level(dbPath || defaultPath, { valueEncoding: 'json' });
  }

  /**
   * 检查用户今天是否已经评论过
   */
  async hasUserCommentedToday(authorId: string): Promise<boolean> {
    try {
      const today = new Date();
      const dateKey = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
      const key = `daily_comment:${authorId}:${dateKey}`;
      
      const result = await this.db.get(key);
      return result !== undefined && result !== null;
    } catch (error) {
      // 如果抛出错误（通常表示key不存在），返回false
      return false;
    }
  }

  /**
   * 记录用户今天已经评论过
   */
  async recordDailyComment(authorId: string): Promise<void> {
    try {
      const today = new Date();
      const dateKey = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
      const key = `daily_comment:${authorId}:${dateKey}`;
      
      const record = {
        authorId: authorId,
        date: dateKey,
        timestamp: Date.now()
      };
      
      await this.db.put(key, record);
      console.log(`✅ 已记录用户 ${authorId} 在 ${dateKey} 的评论记录`);
    } catch (error) {
      console.error('记录每日评论失败:', error);
      throw error;
    }
  }

  /**
   * 记录已处理的@消息
   */
  async recordProcessedAtMessage(processedMessage: ProcessedAtMessage): Promise<void> {
    try {
      const key = `processed_at:${processedMessage.atMessageId}`;
      await this.db.put(key, processedMessage);
      console.log(`✅ 已记录处理过的@消息 ${processedMessage.atMessageId}`);
    } catch (error) {
      console.error('记录已处理@消息失败:', error);
      throw error;
    }
  }

  /**
   * 检查@消息是否已处理过
   */
  async isAtMessageProcessed(atMessageId: number): Promise<boolean> {
    try {
      const key = `processed_at:${atMessageId}`;
      const result = await this.db.get(key);
      // 确保返回的结果不是 undefined 或 null
      return result !== undefined && result !== null;
    } catch (error) {
      // 如果抛出错误（通常表示key不存在），返回false
      return false;
    }
  }

  /**
   * 获取已处理的@消息详情
   */
  async getProcessedAtMessage(atMessageId: number): Promise<ProcessedAtMessage | null> {
    try {
      const key = `processed_at:${atMessageId}`;
      return await this.db.get(key);
    } catch (error) {
      return null;
    }
  }

  /**
   * 删除已处理的@消息记录
   */
  async deleteProcessedAtMessage(atMessageId: number): Promise<boolean> {
    try {
      const key = `processed_at:${atMessageId}`;
      await this.db.del(key);
      console.log(`✅ 已删除@消息 ${atMessageId} 的处理记录`);
      return true;
    } catch (error) {
      console.error('删除已处理@消息记录失败:', error);
      return false;
    }
  }

  /**
   * 列出所有已处理的@消息ID
   */
  async listProcessedAtMessages(): Promise<number[]> {
    try {
      const processedIds: number[] = [];
      
      for await (const [key, value] of this.db.iterator()) {
        if (key.startsWith('processed_at:')) {
          const atMessageId = parseInt(key.replace('processed_at:', ''));
          if (!isNaN(atMessageId)) {
            processedIds.push(atMessageId);
          }
        }
      }
      
      return processedIds.sort((a, b) => b - a); // 降序排列，最新的在前
    } catch (error) {
      console.error('获取已处理@消息列表失败:', error);
      return [];
    }
  }

  /**
   * 记录用户打卡
   */
  async recordCheckIn(userId: string, userName: string, record: CheckInRecord): Promise<void> {
    try {
      const userKey = `user:${userId}`;
      let userStats: UserStats;
      
      try {
        userStats = await this.db.get(userKey);
        // 检查是否获取到有效数据
        if (!userStats || typeof userStats !== 'object') {
          throw new Error('No user data found');
        }
      } catch (error) {
        // 用户首次打卡，初始化数据
        console.log(`  > 初始化用户 ${userId} (${userName}) 的打卡数据`);
        userStats = {
          userName: userName,
          totalCheckIns: 0,
          totalImages: 0,
          cloudTypeStats: {},
          firstCheckIn: record.timestamp,
          lastCheckIn: record.timestamp,
          checkInRecords: []
        };
      }

      // 更新用户名（可能会变化）
      userStats.userName = userName;

      // 更新统计信息
      userStats.totalCheckIns += 1;
      userStats.totalImages += record.imageCount;
      userStats.lastCheckIn = record.timestamp;
      
      // 更新云彩类型统计
      record.cloudTypes.forEach(cloud => {
        const typeName = cloud.type;
        userStats.cloudTypeStats[typeName] = (userStats.cloudTypeStats[typeName] || 0) + 1;
      });
      
      // 添加打卡记录（保留最近100条）
      userStats.checkInRecords.push(record);
      if (userStats.checkInRecords.length > 100) {
        userStats.checkInRecords = userStats.checkInRecords.slice(-100);
      }

      // 保存到数据库
      await this.db.put(userKey, userStats);
      
      // 同时保存单条记录便于查询
      const recordKey = `record:${userId}:${record.timestamp}`;
      await this.db.put(recordKey, record);
      
      console.log(`✅ 用户 ${userId} 打卡记录已保存，累计打卡 ${userStats.totalCheckIns} 次`);
      
    } catch (error) {
      console.error('保存打卡记录失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户统计信息
   */
  async getUserStats(userId: string): Promise<UserStats | null> {
    try {
      const userKey = `user:${userId}`;
      const userStats = await this.db.get(userKey);
      
      // 检查是否获取到有效数据
      if (!userStats || typeof userStats !== 'object') {
        return null;
      }
      
      return userStats;
    } catch (error) {
      return null;
    }
  }

  /**
   * 撤销用户最后一次打卡记录（用于评论失败时回滚）
   */
  async rollbackLastCheckIn(userId: string): Promise<boolean> {
    try {
      const userKey = `user:${userId}`;
      let userStats: UserStats;
      
      try {
        userStats = await this.db.get(userKey);
        if (!userStats || typeof userStats !== 'object' || userStats.checkInRecords.length === 0) {
          console.log(`❌ 用户 ${userId} 没有可撤销的打卡记录`);
          return false;
        }
      } catch (error) {
        console.log(`❌ 用户 ${userId} 不存在，无法撤销记录`);
        return false;
      }

      // 获取最后一条记录
      const lastRecord = userStats.checkInRecords[userStats.checkInRecords.length - 1];
      
      // 移除最后一条记录
      userStats.checkInRecords.pop();
      
      // 更新统计信息
      userStats.totalCheckIns -= 1;
      userStats.totalImages -= lastRecord.imageCount;
      
      // 减少云彩类型统计
      lastRecord.cloudTypes.forEach(cloud => {
        const typeName = cloud.type;
        if (userStats.cloudTypeStats[typeName]) {
          userStats.cloudTypeStats[typeName] -= 1;
          // 如果数量为0，删除该类型
          if (userStats.cloudTypeStats[typeName] <= 0) {
            delete userStats.cloudTypeStats[typeName];
          }
        }
      });
      
      // 更新最后打卡时间（如果还有记录的话）
      if (userStats.checkInRecords.length > 0) {
        userStats.lastCheckIn = userStats.checkInRecords[userStats.checkInRecords.length - 1].timestamp;
      } else {
        // 如果没有记录了，重置为首次打卡时间
        userStats.lastCheckIn = userStats.firstCheckIn;
      }

      // 删除单条记录
      const recordKey = `record:${userId}:${lastRecord.timestamp}`;
      try {
        await this.db.del(recordKey);
      } catch (error) {
        console.error('删除单条记录失败:', error);
      }

      // 保存更新后的用户统计
      await this.db.put(userKey, userStats);
      
      console.log(`✅ 已撤销用户 ${userId} 的最后一次打卡记录 (动态ID: ${lastRecord.dynamicId})`);
      console.log(`  > 当前累计打卡: ${userStats.totalCheckIns} 次`);
      
      return true;
      
    } catch (error) {
      console.error('撤销打卡记录失败:', error);
      return false;
    }
  }

  /**
   * 获取用户最近的打卡记录
   */
  async getRecentCheckIns(userId: string, limit: number = 10): Promise<CheckInRecord[]> {
    try {
      const userStats = await this.getUserStats(userId);
      if (!userStats) return [];
      
      return userStats.checkInRecords.slice(-limit).reverse();
    } catch (error) {
      console.error('获取用户打卡记录失败:', error);
      return [];
    }
  }

  /**
   * 获取全局云彩类型排行榜
   */
  async getGlobalCloudTypeRanking(): Promise<Array<{type: string, count: number}>> {
    try {
      const globalStats: { [cloudType: string]: number } = {};
      
      // 遍历所有用户统计
      for await (const [key, value] of this.db.iterator()) {
        if (key.startsWith('user:')) {
          const userStats = value as UserStats;
          Object.entries(userStats.cloudTypeStats).forEach(([type, count]) => {
            globalStats[type] = (globalStats[type] || 0) + count;
          });
        }
      }
      
      // 转换为排序数组
      return Object.entries(globalStats)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);
        
    } catch (error) {
      console.error('获取全局统计失败:', error);
      return [];
    }
  }

  /**
   * 获取活跃用户排行榜
   */
  async getActiveUsersRanking(limit: number = 10): Promise<Array<{userId: string, checkIns: number, cloudTypes: number}>> {
    try {
      const users: Array<{userId: string, checkIns: number, cloudTypes: number}> = [];
      
      for await (const [key, value] of this.db.iterator()) {
        if (key.startsWith('user:')) {
          const userStats = value as UserStats;
          const userId = key.replace('user:', ''); // 从key中提取userId
          users.push({
            userId: userId,
            checkIns: userStats.totalCheckIns,
            cloudTypes: Object.keys(userStats.cloudTypeStats).length
          });
        }
      }
      
      return users
        .sort((a, b) => b.checkIns - a.checkIns)
        .slice(0, limit);
        
    } catch (error) {
      console.error('获取用户排行榜失败:', error);
      return [];
    }
  }

  /**
   * 生成用户打卡报告
   */
  async generateUserReport(userId: string): Promise<string | null> {
    try {
      const userStats = await this.getUserStats(userId);
      if (!userStats) {
        return `用户 ${userId} 还没有打卡记录哦～快来发布带有"云有所伊"话题的云朵图片开始打卡吧！`;
      }

      const daysSinceFirst = Math.floor((Date.now() - userStats.firstCheckIn) / (1000 * 60 * 60 * 24));
      const topCloudTypes = Object.entries(userStats.cloudTypeStats)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3);

      let report = `🌤️ ${userId} 的云朵打卡报告\n\n`;
      report += `📊 总打卡次数: ${userStats.totalCheckIns} 次\n`;
      report += `📸 总图片数: ${userStats.totalImages} 张\n`;
      report += `📅 打卡天数: ${daysSinceFirst} 天\n`;
      report += `🏆 发现云彩种类: ${Object.keys(userStats.cloudTypeStats).length} 种\n\n`;
      
      if (topCloudTypes.length > 0) {
        report += `☁️ 最常见的云彩类型:\n`;
        topCloudTypes.forEach(([type, count], index) => {
          const emoji = ['🥇', '🥈', '🥉'][index] || '🏅';
          report += `${emoji} ${type}: ${count} 次\n`;
        });
      }

      return report;
    } catch (error) {
      console.error('生成用户报告失败:', error);
      return null;
    }
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    await this.db.close();
  }
} 