import { TextProcessor } from '@/src/modules/textProcessor';
import { StyleManager } from '@/src/modules/styleManager';
import {
  UserSettings,
  TriggerMode,
  ReplacementConfig,
  OriginalWordDisplayMode,
  TranslationPosition,
} from '@/src/modules/types';
import { StorageManager } from '@/src/modules/storageManager';
import { TextReplacer } from '@/src/modules/textReplacer';
import { FloatingBallManager } from '@/src/modules/floatingBall';
import { BlacklistManager } from '@/src/modules/options/blacklist/manager';
export default defineContentScript({
  // 匹配所有网站
  matches: ['<all_urls>'],

  // 主函数
  async main() {
    const storageManager = new StorageManager();
    const settings = await storageManager.getUserSettings();

    // 黑名单检查
    const blacklistManager = new BlacklistManager();
    if (await blacklistManager.isBlacklisted(window.location.href)) {
      return;
    }

    browser.runtime.sendMessage({
      type: 'validate-configuration',
      source: 'page_load',
    });

    if (!settings.isEnabled) {
      return;
    }

    // --- 语言检测 ---
    if (settings.translationDirection === 'auto') {
      settings.translationDirection = await detectPageLanguage();
    }

    // --- 初始化模块 ---
    const styleManager = new StyleManager();
    const textProcessor = new TextProcessor(
      settings.enablePronunciationTooltip,
      settings.apiConfig,
    );
    const textReplacer = new TextReplacer(createReplacementConfig(settings));
    const floatingBallManager = new FloatingBallManager(settings.floatingBall);

    // --- 应用初始配置 ---
    updateConfiguration(settings, styleManager, textReplacer);

    // --- 初始化悬浮球 ---
    floatingBallManager.init(async () => {
      // 悬浮球点击翻译回调
      // 验证API配置
      const isConfigValid = await browser.runtime.sendMessage({
        type: 'validate-configuration',
        source: 'user_action',
      });

      if (isConfigValid) {
        await processPage(
          textProcessor,
          textReplacer,
          settings.originalWordDisplayMode,
          settings.maxLength,
          settings.translationPosition,
          settings.showParentheses,
        );
      }
    });

    // --- 根据触发模式执行操作 ---
    if (settings.triggerMode === TriggerMode.AUTOMATIC) {
      await processPage(
        textProcessor,
        textReplacer,
        settings.originalWordDisplayMode,
        settings.maxLength,
        settings.translationPosition,
        settings.showParentheses,
      );
    }

    // --- 监听消息和DOM变化 ---
    setupListeners(
      settings,
      styleManager,
      textProcessor,
      textReplacer,
      floatingBallManager,
    );
  },
});

function createReplacementConfig(settings: UserSettings): ReplacementConfig {
  return {
    userLevel: settings.userLevel,
    replacementRate: settings.replacementRate,
    useGptApi: settings.useGptApi,
    apiConfig: settings.apiConfig,
    inlineTranslation: true,
    translationStyle: settings.translationStyle,
    translationDirection: settings.translationDirection,
  };
}

/**
 * 根据最新设置更新所有相关模块的配置
 */
function updateConfiguration(
  settings: UserSettings,
  styleManager: StyleManager,
  textReplacer: TextReplacer,
) {
  styleManager.setTranslationStyle(settings.translationStyle);
  textReplacer.setConfig(createReplacementConfig(settings));
}

/**
 * 处理整个页面或其动态加载的部分
 */
async function processPage(
  textProcessor: TextProcessor,
  textReplacer: TextReplacer,
  originalWordDisplayMode: OriginalWordDisplayMode,
  maxLength: number | undefined,
  translationPosition: TranslationPosition,
  showParentheses: boolean,
) {
  await textProcessor.processRoot(
    document.body,
    textReplacer,
    originalWordDisplayMode,
    maxLength,
    translationPosition,
    showParentheses,
  );
}

/**
 * 设置所有监听器，包括消息和DOM变化
 */
function setupListeners(
  settings: UserSettings,
  styleManager: StyleManager,
  textProcessor: TextProcessor,
  textReplacer: TextReplacer,
  floatingBallManager: FloatingBallManager,
) {
  // 监听来自 popup 的消息
  browser.runtime.onMessage.addListener(async (message) => {
    if (message.type === 'settings_updated') {
      // 设置已更新
      const newSettings: UserSettings = message.settings;

      // 检查是否需要刷新页面的关键设置
      const needsPageReload =
        settings.triggerMode !== newSettings.triggerMode ||
        settings.isEnabled !== newSettings.isEnabled ||
        settings.enablePronunciationTooltip !==
          newSettings.enablePronunciationTooltip ||
        settings.translationDirection !== newSettings.translationDirection ||
        settings.userLevel !== newSettings.userLevel ||
        settings.useGptApi !== newSettings.useGptApi;

      if (needsPageReload) {
        window.location.reload();
        return;
      }

      // 更新本地设置对象
      Object.assign(settings, newSettings);

      // 应用新配置
      updateConfiguration(settings, styleManager, textReplacer);

      // 更新API配置
      textProcessor.updateApiConfig(settings.apiConfig);

      // 更新悬浮球配置
      floatingBallManager.updateConfig(settings.floatingBall);
    } else if (message.type === 'MANUAL_TRANSLATE') {
      // 收到手动翻译请求
      if (settings.triggerMode === TriggerMode.MANUAL) {
        const isConfigValid = await browser.runtime.sendMessage({
          type: 'validate-configuration',
          source: 'user_action',
        });
        if (isConfigValid) {
          await processPage(
            textProcessor,
            textReplacer,
            settings.originalWordDisplayMode,
            settings.maxLength,
            settings.translationPosition,
            settings.showParentheses,
          );
        }
      }
    }
  });

  // 仅在自动模式下观察DOM变化
  if (settings.triggerMode === TriggerMode.AUTOMATIC) {
    setupDomObserver(
      textProcessor,
      textReplacer,
      settings.originalWordDisplayMode,
      settings.maxLength,
      settings.translationPosition,
      settings.showParentheses,
    );
  }
}

/**
 * 设置 DOM 观察器以处理动态内容
 * 使用新的状态管理器进行更智能的重复处理检测
 */
function setupDomObserver(
  textProcessor: TextProcessor,
  textReplacer: TextReplacer,
  originalWordDisplayMode: OriginalWordDisplayMode,
  maxLength: number | undefined,
  translationPosition: TranslationPosition,
  showParentheses: boolean,
) {
  let debounceTimer: number;
  const nodesToProcess = new Set<Node>();
  const observerConfig = {
    childList: true,
    subtree: true,
    characterData: true,
  };

  const observer = new MutationObserver((mutations) => {
    let hasValidChanges = false;

    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          // 跳过已知的处理结果元素
          if (isProcessingResultNode(node)) {
            return;
          }

          // 对所有新添加的元素节点都进行处理尝试
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            const textContent = element.textContent?.trim();

            // 只要有足够的文本内容就尝试处理
            if (textContent && textContent.length > 15) {
              nodesToProcess.add(node);
              hasValidChanges = true;
            }
          }
        });
      } else if (
        mutation.type === 'characterData' &&
        mutation.target.parentElement
      ) {
        const parentElement = mutation.target.parentElement;
        if (!isProcessingResultNode(parentElement)) {
          nodesToProcess.add(parentElement);
          hasValidChanges = true;
        }
      }
    });

    // 只有在有有效变化时才进行处理
    if (!hasValidChanges) {
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(async () => {
      if (nodesToProcess.size === 0) return;

      const topLevelNodes = new Set<Node>();
      nodesToProcess.forEach((node) => {
        if (
          document.body.contains(node) &&
          !isDescendant(node, nodesToProcess)
        ) {
          topLevelNodes.add(node);
        }
      });

      // 暂停观察器避免处理过程中的循环触发
      observer.disconnect();

      try {
        for (const node of topLevelNodes) {
          await textProcessor.processRoot(
            node,
            textReplacer,
            originalWordDisplayMode,
            maxLength,
            translationPosition,
            showParentheses,
          );
        }
      } catch (_) {
        // 静默处理错误
      }

      nodesToProcess.clear();
      observer.observe(document.body, observerConfig);
    }, 150);
  });

  observer.observe(document.body, observerConfig);
}

/**
 * 检查节点是否是处理结果节点（翻译、发音等功能元素）
 */
function isProcessingResultNode(node: Node): boolean {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;

    // 检查是否是翻译或发音相关的元素
    const processingClasses = [
      'wxt-translation-term',
      'wxt-original-word',
      'wxt-pronunciation-tooltip',
      'wxt-phonetic-text',
      'wxt-tts-button',
      'wxt-processing',
    ];

    for (const className of processingClasses) {
      if (element.classList.contains(className)) {
        return true;
      }
    }

    // 检查是否包含处理标记属性
    if (
      element.hasAttribute('data-wxt-word-processed') ||
      element.hasAttribute('data-pronunciation-added')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 检查一个节点是否是节点集合中任何其他节点的后代
 */
function isDescendant(node: Node, nodeSet: Set<Node>): boolean {
  let parent = node.parentElement;
  while (parent) {
    if (nodeSet.has(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
}

/**
 * 使用 browser.i18n.detectLanguage API 自动检测页面主要语言
 */
async function detectPageLanguage(): Promise<string> {
  try {
    const textSample = document.body.innerText.substring(0, 1000);
    if (!textSample.trim()) return 'zh-to-en';

    const result = await browser.i18n.detectLanguage(textSample);

    if (result?.languages?.[0]?.language === 'en') {
      return 'en-to-zh';
    }
    return 'zh-to-en';
  } catch (_) {
    return 'zh-to-en'; // 出错时默认
  }
}
