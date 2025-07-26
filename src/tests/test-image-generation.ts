// test-image-generation.ts
import { CheckInImageGenerator } from '../imageGenerator';
import { UserStats } from '../database';

const testUserStats: UserStats = {
  userName: 'test_user_123456',
  totalCheckIns: 15,
  totalImages: 42,
  cloudTypeStats: {
    '积云': 8,
    '层云': 4,
    '卷云': 3,
    '积雨云': 1,
    '高积云': 2,
    '高层云': 0,
    '卷积云': 2,
    '卷层云': 0,
    '层积云': 3,
    '雨层云': 0,
    '塔状积云': 5,
    '荚状云': 0,
    '乳状云': 6,
    '碎层云': 0,
    '漏斗云': 1
  },
  firstCheckIn: new Date('2025-07-12').getTime(),
  lastCheckIn: new Date('2025-07-26').getTime(),
  checkInRecords: [] // 测试不需要详细记录
};

async function testImageGeneration() {
  console.log('🧪 测试两种印章效果对比...\n');
  
  const imageGenerator = new CheckInImageGenerator();

  try {
    // 测试原版CSS效果
    console.log('📄 生成CSS版本印章...');
    await imageGenerator.generatePreviewHtml(testUserStats);
    const cssImagePath = await imageGenerator.generateCheckInImage(testUserStats);
    console.log(`✅ CSS版本完成！图片路径: ${cssImagePath}\n`);
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

// 运行测试
testImageGeneration(); 