// src/cloudAnalyzer.ts
import axios from "axios";
import { CloudType } from "./database";

// OpenAI Compatible API 配置接口
interface OpenAIConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

// 默认配置
const defaultConfig: OpenAIConfig = {
  apiKey: process.env.OPENAI_API_KEY || "",
  baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
};

class CloudAnalyzer {
  private config: OpenAIConfig;
  private client: any;

  constructor(config?: Partial<OpenAIConfig>) {
    this.config = { ...defaultConfig, ...config };
    this.client = axios.create({
      baseURL: this.config.baseURL,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * 提取结构化的云朵类型信息
   * @param imageUrl 图片URL
   * @returns 结构化的云朵类型数据
   */
  async extractCloudTypes(imageUrl: string): Promise<CloudType[]> {
    try {
      console.log(`  > 开始提取云朵类型信息: ${imageUrl}`);

      const response = await this.client.post("/chat/completions", {
        model: this.config.model,
        messages: [
          {
            role: "system",
            content: `你是一个专业的气象学家和云朵识别专家。请分析图片中的云朵类型，返回JSON格式的结构化数据。

请识别图片中可能出现的云朵类型，世界气象组织(WMO)标准的10个基本云属：

[高云族 (5-13km)]
卷云：呈丝状、羽毛状或纤维状的白色云彩，质地轻薄，常预示天气变化。由冰晶组成，透明度高。
卷积云：白色小块状云彩排列成行或波浪状，像鱼鳞或羊群，民间称为"鱼鳞天"。通常预示晴好天气。
卷层云：薄薄的白色云幕覆盖整个天空，使阳光或月光产生光晕现象。质地均匀，几乎透明。

[中云族 (2-7km)]
高积云：灰白色块状或波状云团，比卷积云更厚更大，有明显的阴影部分。常出现在天气转变前。
高层云：灰色或蓝灰色的云幕，比卷层云厚，太阳轮廓模糊。常预示降雨在12-24小时内到来。

[低云族 (0-2km)]
层积云：低矮的灰白色云块，呈波浪状或块状排列，云底较平。很少产生降水。
层云：均匀的灰色云层，像雾但离地面较高。常产生毛毛雨或雪花。
积云：白色棉花状云朵，轮廓清晰，底部平坦。晴天常见，象征好天气。
积雨云：巨大的塔状云朵，顶部呈铁砧状。能产生雷雨、冰雹等强对流天气。

[降水云]
雨层云：厚重的暗灰色云层，常带来持续性降雨或降雪。云底模糊不清，降水强度中等。

返回格式：
{
  "cloudTypes": [
    {
      "type": "云朵类型名称",
      "confidence": 0.8,
      "description": "简短描述"
    }
  ]
}

请只返回JSON，不要其他文字。`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "请分析这张图片中的云朵类型，返回结构化的JSON数据。",
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
        temperature: 0.2,
      });

      const content = response.data.choices[0].message.content;
      console.log(`  > 云朵类型提取原始结果: ${content}`);

      try {
        // 尝试解析JSON
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error("无法从响应中提取JSON格式数据");
        }

        const jsonStr = jsonMatch[0];
        const result = JSON.parse(jsonStr);

        if (
          !result.cloudTypes ||
          !Array.isArray(result.cloudTypes) ||
          result.cloudTypes.length === 0
        ) {
          throw new Error("JSON格式不正确或未包含有效的云朵类型数据");
        }

        const cloudTypes = result.cloudTypes.map((cloud: any) => ({
          type: cloud.type || "Unknown",
          confidence: Math.min(1, Math.max(0, cloud.confidence || 0.5)),
          description: cloud.description || "",
        }));

        console.log(`  > 成功提取 ${cloudTypes.length} 种云朵类型`);
        return cloudTypes;
      } catch (parseError) {
        console.log(`  > JSON解析失败，尝试从文本中提取关键词`);
        return this.extractCloudTypesFromText(content);
      }
    } catch (error) {
      console.error(
        "  > 云朵类型提取失败:",
        error instanceof Error ? error.message : "未知错误"
      );
      throw new Error(
        `云朵类型识别失败: ${
          error instanceof Error ? error.message : "未知错误"
        }`
      );
    }
  }

  /**
   * 从文本中提取云朵类型（备用方法）
   */
  private extractCloudTypesFromText(text: string): CloudType[] {
    // WMO标准的10个基本云属
    const cloudTypeKeywords = [
      // 高云族
      { names: ["卷云", "cirrus", "ci"], type: "卷云" },
      { names: ["卷积云", "cirrocumulus", "cc"], type: "卷积云" },
      { names: ["卷层云", "cirrostratus", "cs"], type: "卷层云" },

      // 中云族
      { names: ["高积云", "altocumulus", "ac"], type: "高积云" },
      { names: ["高层云", "altostratus", "as"], type: "高层云" },

      // 低云族
      { names: ["层积云", "stratocumulus", "sc"], type: "层积云" },
      { names: ["层云", "stratus", "st"], type: "层云" },
      { names: ["积云", "cumulus", "cu"], type: "积云" },
      { names: ["积雨云", "cumulonimbus", "cb"], type: "积雨云" },

      // 降水云
      { names: ["雨层云", "nimbostratus", "ns"], type: "雨层云" },
    ];

    const foundTypes: CloudType[] = [];
    const lowerText = text.toLowerCase();

    cloudTypeKeywords.forEach(({ names, type }) => {
      const found = names.some((name) =>
        lowerText.includes(name.toLowerCase())
      );
      if (found) {
        foundTypes.push({
          type,
          confidence: 0.6,
          description: "从文本描述中识别",
        });
      }
    });

    // 如果没有找到任何类型，抛出错误而不是返回默认值
    if (foundTypes.length === 0) {
      throw new Error("无法从文本中识别出任何云朵类型");
    }

    return foundTypes;
  }

  /**
   * 基于云朵类型生成萌妹风格评论
   */
  private async generateCommentFromCloudTypes(
    cloudTypes: CloudType[],
    imageCount: number
  ): Promise<string> {
    try {
      // 构建云朵类型描述
      const cloudTypeNames = cloudTypes.map((c) => c.type).join("、");
      const highConfidenceTypes = cloudTypes.filter((c) => c.confidence > 0.7);

      let baseText = "";
      if (cloudTypes.length === 1) {
        const cloud = cloudTypes[0];
        if (cloud.confidence > 0.8) {
          baseText = `哇！这张图片中的${cloud.type}看起来真的很棒呢！`;
        } else {
          baseText = `看起来像是${cloud.type}诶，天空真美丽～`;
        }
      } else if (cloudTypes.length === 2) {
        baseText = `这天空中有${cloudTypeNames}，好丰富的云朵世界呀！`;
      } else {
        baseText = `哇塞！一次看到了${cloudTypes.length}种云朵：${cloudTypeNames}，这片天空真是太精彩了！`;
      }

      // 添加图片数量相关的评论
      if (imageCount > 1) {
        baseText += `这${imageCount}张图片都拍得很棒呢！`;
      }

      // 使用AI润色生成最终评论
      const polishedComment = await this.polishWithMoeStyle(baseText);

      console.log(`  > 基于云朵类型生成评论: ${polishedComment}`);
      return polishedComment;
    } catch (error) {
      console.error(
        "  > 基于云朵类型生成评论失败:",
        error instanceof Error ? error.message : "未知错误"
      );
      // 失败时返回简单的基础评论
      const cloudTypeNames = cloudTypes.map((c) => c.type).join("、");
      return `哇！看到了${cloudTypeNames}，天空真美丽呢～ ✨`;
    }
  }

  /**
   * 分析多张图片的云朵类型并生成评论（优化流程，去除重复步骤）
   */
  async analyzeMultipleImagesWithTypes(imageUrls: string[]): Promise<{
    cloudTypes: CloudType[];
    comment: string;
  }> {
    try {
      console.log(`  > 开始分析 ${imageUrls.length} 张图片的云朵类型`);

      // 提取每张图片的云朵类型
      const allCloudTypes: CloudType[] = [];
      for (const imageUrl of imageUrls) {
        const types = await this.extractCloudTypes(imageUrl);
        allCloudTypes.push(...types);
      }

      // 合并相同类型的云朵，计算平均置信度
      const mergedTypes = this.mergeCloudTypes(allCloudTypes);

      // 直接基于云朵类型生成评论，无需额外的图片分析步骤
      const comment = await this.generateCommentFromCloudTypes(
        mergedTypes,
        imageUrls.length
      );

      return {
        cloudTypes: mergedTypes,
        comment,
      };
    } catch (error) {
      console.error(
        "  > 批量云朵类型分析失败:",
        error instanceof Error ? error.message : "未知错误"
      );
      throw new Error(
        `批量云朵分析失败: ${
          error instanceof Error ? error.message : "未知错误"
        }`
      );
    }
  }

  /**
   * 合并相同类型的云朵
   */
  private mergeCloudTypes(cloudTypes: CloudType[]): CloudType[] {
    const typeMap = new Map<string, CloudType>();

    cloudTypes.forEach((cloud) => {
      const existing = typeMap.get(cloud.type);
      if (existing) {
        // 计算平均置信度
        existing.confidence = (existing.confidence + cloud.confidence) / 2;
        // 合并描述
        if (
          cloud.description &&
          !existing.description?.includes(cloud.description)
        ) {
          existing.description = existing.description
            ? `${existing.description}; ${cloud.description}`
            : cloud.description;
        }
      } else {
        typeMap.set(cloud.type, { ...cloud });
      }
    });

    return Array.from(typeMap.values()).sort(
      (a, b) => b.confidence - a.confidence
    );
  }

  /**
   * 用二次元萌妹风格润色文本
   * @param originalText 原始文本
   * @returns 润色后的文本
   */
  public async polishWithMoeStyle(originalText: string): Promise<string> {
    try {
      console.log(`  > 开始用萌妹风格润色文本...`);

      const systemPrompt = [
        "你是一个非常可爱的二次元萌妹！请用萌萌的语气来润色用户给出的文本内容。要求：",
        "1. 保持原文的核心信息和意思",
        "2. 语气要很可爱很萌，像二次元萌妹一样",
        "3. 适当加入一些日语词汇，比如：だよ、ですね、すごい、きれい、かわいい等",
        "4. 加入一些可爱的文字表情，比如：(｡･ω･｡) (´∀｀) (◕‿◕) (*´ω｀*) (≧∀≦) ♡",
        "5. 可以用一些萌萌的语气词，比如：呢、哦、呀、嘛、喵",
        "6. 控制在100字以内，要简洁可爱",
        "7. 不要过度使用日语，要让中文读者容易理解",
        "请只返回润色后的文本，不要加任何解释。",
      ].join("\n");

      const response = await this.client.post("/chat/completions", {
        model: this.config.model,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: `请用可爱的二次元萌妹语气润色这段文本：${originalText}`,
          },
        ],
        max_tokens: 300,
        temperature: 0.8,
      });

      const polishedText = response.data.choices[0].message.content.trim();

      console.log(`  > 萌妹风格润色完成: ${polishedText}`);
      return polishedText;
    } catch (error) {
      console.error(
        "  > 文本润色失败:",
        error instanceof Error ? error.message : "未知错误"
      );
      // 如果润色失败，返回原文本
      return originalText;
    }
  }

  /**
   * 生成comment内容
   * @param analysisResults 云朵分析结果数组（现在通常只有一个元素）
   * @returns 生成的comment内容
   */
  async generateComment(analysisResults: string[]): Promise<string | null> {
    if (analysisResults.length === 0) {
      return null;
    }

    // 获取第一个（也是唯一的）分析结果
    const originalResult = analysisResults[0];

    // 使用二次元萌妹风格润色
    const polishedResult = await this.polishWithMoeStyle(originalResult);

    return polishedResult;
  }
}

export { CloudAnalyzer, OpenAIConfig };
