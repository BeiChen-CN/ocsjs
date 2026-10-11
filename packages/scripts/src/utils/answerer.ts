import {
	AnswererWrapper,
	AIConfig,
	DEFAULT_AI_CONFIG,
	SearchInformation,
	defaultAnswerWrapperHandler,
	requestAIAnswer
} from '@ocsjs/core';
import { CommonProject } from '../projects/common';

/**
 * 搜题环境
 */
export interface SearchEnv {
	title?: string;
	options?: string;
	type?: string;
	[x: string]: any;
}

function toNumber(value: any, fallback: number) {
	const num = typeof value === 'string' ? parseFloat(value) : value;
	return typeof num === 'number' && isNaN(num) === false ? num : fallback;
}

/**
 * 从「通用-全局设置」中读取 AI 答题配置
 */
export function getAIConfig(): AIConfig {
	// 使用 any 避免配置项类型推导受循环依赖影响
	const cfg: any = CommonProject.scripts.settings.cfg;
	return {
		enabled: cfg.aiEnabled === true,
		baseUrl: cfg.aiBaseUrl || DEFAULT_AI_CONFIG.baseUrl,
		apiKey: cfg.aiApiKey || '',
		model: cfg.aiModel || DEFAULT_AI_CONFIG.model,
		temperature: toNumber(cfg.aiTemperature, DEFAULT_AI_CONFIG.temperature),
		maxTokens: toNumber(cfg.aiMaxTokens, DEFAULT_AI_CONFIG.maxTokens),
		systemPrompt: cfg.aiSystemPrompt || DEFAULT_AI_CONFIG.systemPrompt,
		userPromptTemplate: cfg.aiPrompt || DEFAULT_AI_CONFIG.userPromptTemplate,
		timeoutSeconds: toNumber(cfg.aiTimeoutSeconds, DEFAULT_AI_CONFIG.timeoutSeconds),
		retries: toNumber(cfg.aiRetryCount, DEFAULT_AI_CONFIG.retries),
		// 兼容 4.16.0 的「禁止模型思考」开关：显式开启过的用户迁移到 none 档
		thinkingMode:
			cfg.aiThinkingMode ||
			(cfg.aiDisableThinking === true ? 'none' : DEFAULT_AI_CONFIG.thinkingMode),
		type: cfg.aiType === 'fetch' ? 'fetch' : 'GM_xmlhttpRequest',
		extraHeaders: cfg.aiExtraHeaders || ''
	};
}

/**
 * AI 答题是否已启用且可用
 */
export function isAIEnabled(): boolean {
	const config = getAIConfig();
	return config.enabled && !!config.baseUrl && !!config.model;
}

/**
 * 搜题入口
 *
 * 策略为「题库优先，AI 兜底」：
 * 1. 先使用配置的题库进行搜索
 * 2. 只要任意题库返回了非空答案，则直接使用题库结果
 * 3. 题库全部搜不到（或请求失败）时，若已启用 AI，则调用 AI 作答并追加到结果中
 *
 * 返回结构与 {@link defaultAnswerWrapperHandler} 完全一致，
 * 因此可以直接替换原有的题库调用，不影响后续的答案匹配逻辑。
 *
 * @param bankWrappers 题库配置，可以为空
 * @param env          题目环境（title / options / type）
 */
export async function searchAnswers(
	bankWrappers: AnswererWrapper[] | undefined,
	env: SearchEnv
): Promise<SearchInformation[]> {
	const wrappers = bankWrappers || [];

	let bankInfos: SearchInformation[] = [];
	if (wrappers.length) {
		try {
			bankInfos = (await defaultAnswerWrapperHandler(wrappers, env)) || [];
		} catch (error) {
			// 题库请求异常时不影响 AI 兜底
			console.error(error);
			bankInfos = [];
		}
	}

	/** 题库已搜到答案，直接返回 */
	const hasBankAnswer = bankInfos.some((info) => info.results.some((res) => String(res?.answer ?? '').trim() !== ''));
	if (hasBankAnswer || !isAIEnabled()) {
		return bankInfos;
	}

	/** 题库未搜到答案，使用 AI 兜底 */
	const aiInfo = await requestAIAnswer(getAIConfig(), env, {
		logger: (...args) => console.debug(...args)
	});

	return [...bankInfos, aiInfo];
}
