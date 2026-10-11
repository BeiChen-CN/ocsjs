import { AIConfig, SearchInformation } from './interface';
import { request } from '../utils/request';
// 只引入 $ 本体，避免把依赖 DOM 的模块一并带入，便于单独测试
import { $ } from '../../utils/common';

/**
 * 默认的 AI 答题系统提示词
 *
 * 强调「只输出答案、不输出解释」，以便答题器能够直接解析出可匹配的答案。
 */
export const DEFAULT_AI_SYSTEM_PROMPT = [
	'你是一个专业的网课答题助手。',
	'请根据题目和选项，直接给出正确答案。',
	'作答时请仔细审题，注意「不正确」「除了」等否定词；不确定时，选择最符合教材标准表述与常识的选项。',
	'禁止输出任何解释、分析、推导过程、多余文字或 markdown 格式。'
].join('\n');

/**
 * 生成提示词占位符文本，例如 PH('title') 会生成 title 的占位符
 *
 * 这里不直接书写占位符字符串，是为了避免触发 eslint 的 no-template-curly-in-string 规则。
 */
function PH(name: string) {
	return '$' + '{' + name + '}';
}

/**
 * 默认的 AI 答题用户提示词模板
 *
 * 支持以下占位符：
 * - type    题型（已转换为中文，例如 单选题）
 * - title   题目内容
 * - options 选项内容（每行一个），无选项时为空
 */
export const DEFAULT_AI_USER_PROMPT = [
	'题型：' + PH('type'),
	'题目：' + PH('title'),
	PH('options'),
	'请直接输出正确答案，要求：',
	'- 单选题：只输出正确选项的字母，例如 A',
	'- 多选题：按字母顺序输出所有正确选项，多个字母连写，例如 ABC',
	'- 判断题：只输出「对」或「错」',
	'- 填空题：多个空使用 # 分隔，例如 答案1#答案2',
	'- 简答/其他：直接输出答案内容，不要输出多余的文字'
].join('\n');

/**
 * 默认 AI 配置
 */
export const DEFAULT_AI_CONFIG: AIConfig = {
	enabled: false,
	// DeepSeek 官方地址，脚本会自动补全 /chat/completions
	baseUrl: 'https://api.deepseek.com',
	apiKey: '',
	// 官方当前模型名为 deepseek-flash / deepseek-v4-pro，deepseek-chat 已不在文档中列出
	model: 'deepseek-flash',
	temperature: 0.3,
	// 只是输出上限，不会增加实际消耗；推理模型（R1/Kimi 等）的思考过程会占用大量额度，太小会导致答案为空
	maxTokens: 8192,
	systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
	userPromptTemplate: DEFAULT_AI_USER_PROMPT,
	// AI 与题库是串行执行的，过长会与题库超时叠加，可能超过答题器的等待上限（题库超时 + 10 秒）
	timeoutSeconds: 30,
	// 请求失败（超时、接口报错、内容无法解析）后的重试次数
	retries: 1,
	// 思考模式：低强度思考在速度与正确率间取得平衡。
	// 完全关闭思考（none）虽然最快，但专业题正确率明显下降；平台默认（high）最准但太慢
	thinkingMode: 'low',
	type: 'GM_xmlhttpRequest',
	extraHeaders: ''
};

/** 请求失败后的重试间隔（毫秒） */
const RETRY_DELAY = 2000;

/** 题型 -> 中文描述 */
const TYPE_LABELS: Record<string, string> = {
	single: '单选题',
	multiple: '多选题',
	judgement: '判断题',
	completion: '填空题'
};

/**
 * 解析 AI 接口地址
 *
 * 允许用户填写 base url（自动补全 /chat/completions），
 * 也允许直接填写完整的 chat/completions 路径。
 */
export function resolveAIUrl(baseUrl: string): string {
	const base = (baseUrl || '').trim().replace(/\/+$/, '');
	if (!base) {
		return '';
	}
	if (/\/chat\/completions$/.test(base)) {
		return base;
	}
	return base + '/chat/completions';
}

/**
 * 解析额外请求头
 *
 * 每行一个，格式为 `key: value`，忽略空行与不合法的行。
 */
export function resolveAIExtraHeaders(extraHeaders?: string): Record<string, string> {
	const headers: Record<string, string> = {};
	if (!extraHeaders) {
		return headers;
	}
	for (const line of extraHeaders.split('\n')) {
		const index = line.indexOf(':');
		if (index === -1) {
			continue;
		}
		const key = line.slice(0, index).trim();
		const value = line.slice(index + 1).trim();
		if (key && value) {
			headers[key] = value;
		}
	}
	return headers;
}

/** 构造 AI 请求头 */
export function buildAIHeaders(config: AIConfig): Record<string, string> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...resolveAIExtraHeaders(config.extraHeaders)
	};
	// 去除粘贴密钥时可能带入的空格或换行，否则会导致 401
	const key = (config.apiKey || '').trim();
	if (key) {
		headers.Authorization = 'Bearer ' + key;
	}
	return headers;
}

/**
 * 将提示词模板中的占位符替换为真实内容
 */
export function resolveAIPrompt(template: string, env: Record<string, any>): string {
	const text = template || DEFAULT_AI_USER_PROMPT;
	return text
		// 使用函数形式替换，避免答案/选项中包含 `$` 导致替换异常
		.replace(/\$\{\s*type\s*\}/g, () => TYPE_LABELS[String(env.type)] || '未知题型')
		.replace(/\$\{\s*title\s*\}/g, () => String(env.title ?? ''))
		.replace(/\$\{\s*options\s*\}/g, () => {
			const options = String(env.options ?? '').trim();
			return options ? '选项：\n' + options : '（本题无选项）';
		});
}

/** 构造发给 AI 的消息列表 */
export function buildAIMessages(
	config: AIConfig,
	env: Record<string, any>
): { role: 'system' | 'user'; content: string }[] {
	return [
		{ role: 'system', content: config.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT },
		{ role: 'user', content: resolveAIPrompt(config.userPromptTemplate, env) }
	];
}

/**
 * 构造发给 AI 接口的请求体
 *
 * 通过 {@link AIConfig.thinkingMode} 控制模型的思考模式（DeepSeek 官方参数）：
 * - none    thinking.type = disabled + reasoning_effort = none，关闭思考，响应最快
 * - low     thinking.type = enabled + reasoning_effort = low，低强度思考，速度与正确率均衡
 * - default 不发送任何控制参数，跟随平台默认（DeepSeek 默认高强度思考）
 *
 * 大多数 OpenAI 兼容网关会忽略不认识的参数，个别严格网关若因此报参数错误，
 * 可将思考模式设为「跟随平台默认」。
 */
export function buildAIData(config: AIConfig, env: Record<string, any>): Record<string, any> {
	const data: Record<string, any> = {
		model: config.model,
		temperature: config.temperature,
		max_tokens: config.maxTokens,
		stream: false,
		messages: buildAIMessages(config, env)
	};
	if (config.thinkingMode === 'none') {
		data.thinking = { type: 'disabled' };
		data.reasoning_effort = 'none';
	} else if (config.thinkingMode === 'low') {
		data.thinking = { type: 'enabled' };
		data.reasoning_effort = 'low';
	}
	return data;
}

/**
 * 解析 AI 返回的文本内容，提取出可被答题器匹配的答案
 *
 * 会处理常见的「模型不听话」情况：
 * - markdown 代码块包裹
 * - 「答案：」「正确答案是」等前缀
 * - 首尾引号、书名号
 * - 多行回答只取第一行有效内容
 * - 短答案末尾的句号
 */
export function parseAIContent(content: string): string {
	let text = String(content ?? '').trim();

	// 去掉 markdown 代码块
	text = text.replace(/^```[a-zA-Z0-9]*\s*/, '').replace(/```\s*$/, '').trim();
	// 去掉常见前缀
	text = text.replace(/^(?:正确答案|正确选项|参考答案|答案|答|选)\s*[:：是]\s*/, '').trim();
	// 去掉首尾引号/书名号
	text = text.replace(/^["'“”‘’《》【】\s]+/, '').replace(/["'“”‘’《》【】\s]+$/, '').trim();
	// 多行回答只取第一行有效内容
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length > 1) {
		text = lines[0];
	}
	// 短答案（例如 对 / 错 / A）末尾的句号属于语气标点，去掉以免影响判断题匹配
	if (text.length <= 8) {
		text = text.replace(/[。．.]+$/, '').trim();
	}

	return text;
}

/**
 * 安全地把任意响应转成可读文本，用于错误信息展示
 *
 * 响应可能非常大或不可序列化（循环引用），这里统一截断处理。
 */
export function safeStringify(value: any, limit = 300): string {
	try {
		const text = typeof value === 'string' ? value : JSON.stringify(value);
		if (!text) {
			return String(value);
		}
		return text.length > limit ? text.slice(0, limit) + '…（已截断）' : text;
	} catch {
		try {
			return String(value).slice(0, limit);
		} catch {
			return '（无法序列化）';
		}
	}
}

/**
 * 从响应中提取错误信息
 *
 * 各家网关的错误格式并不统一，常见有：
 * - `{ error: { message } }`（OpenAI 标准）
 * - `{ error: "文本" }`
 * - `{ code: 401, message: "Authentication Fails" }`（多数中转站/网关）
 * - `{ msg }` / `{ error_msg }`
 */
export function extractAIError(response: any): string | undefined {
	if (!response || typeof response !== 'object') {
		return undefined;
	}
	if (typeof response.error === 'string' && response.error.trim()) {
		return response.error.trim();
	}
	const candidates = [response.error?.message, response.message, response.msg, response.error_msg];
	for (const item of candidates) {
		if (typeof item === 'string' && item.trim()) {
			return item.trim();
		}
	}
	return undefined;
}

/**
 * 从响应中提取模型输出的内容
 *
 * 兼容 OpenAI 标准格式与部分网关的变体（data 包裹、text / result / output.text）。
 * 推理模型（DeepSeek-R1、Kimi 等）在输出长度不足时只返回 reasoning_content 而没有 content，
 * 这种情况通过 reasoningOnly 标记返回，便于给出针对性的提示。
 */
export function extractAIContent(response: any): { content?: string; reasoningOnly?: boolean } {
	const choice = Array.isArray(response?.choices) ? response.choices[0] : undefined;
	if (choice) {
		const content = choice.message?.content ?? choice.text ?? choice.delta?.content;
		if (typeof content === 'string' && content.trim()) {
			return { content };
		}
		const reasoning = choice.message?.reasoning_content ?? choice.reasoning_content;
		if (typeof reasoning === 'string' && reasoning.trim()) {
			return { reasoningOnly: true };
		}
	}

	/** 部分网关会把结果包在 data 里 */
	if (response?.data && typeof response.data === 'object') {
		const inner = extractAIContent(response.data);
		if (inner.content || inner.reasoningOnly) {
			return inner;
		}
	}

	const fallback = response?.output?.text ?? response?.result ?? response?.content;
	if (typeof fallback === 'string' && fallback.trim()) {
		return { content: fallback };
	}

	return {};
}

/**
 * 请求 AI 并返回题库格式的搜索结果（带重试）
 *
 * 无论成功与否都会返回一个 {@link SearchInformation}：
 * - 成功时 results 中带有 `extra_data.ai = true`，答题结果面板会显示「AI」标记
 * - 失败时通过 error 字段返回错误信息，便于在面板上展示
 *
 * 请求失败（超时、接口报错、内容无法解析）时，按 {@link AIConfig.retries}
 * 指定的次数自动重试，每次间隔 {@link RETRY_DELAY} 毫秒。
 *
 * @param config AI 配置
 * @param env    题目环境，包含 title / options / type
 * @param opts   可选配置，logger 用于输出调试日志
 */
export async function requestAIAnswer(
	config: AIConfig,
	env: Record<string, any>,
	opts?: { logger?: (...args: any[]) => void }
): Promise<SearchInformation> {
	const retries = Math.max(0, Math.floor(Number(config.retries) || 0));
	const total = retries + 1;
	let info: SearchInformation | undefined;

	for (let attempt = 1; attempt <= total; attempt++) {
		info = await requestAIAnswerOnce(config, env, opts);
		if (!info.error) {
			info.attempts = attempt;
			return info;
		}
		if (attempt < total) {
			opts?.logger?.(`[AI-重试] 第 ${attempt} 次请求失败，${RETRY_DELAY / 1000} 秒后重试：`, info.error);
			await $.sleep(RETRY_DELAY);
		}
	}

	if (total > 1) {
		info!.error = `已重试 ${retries} 次仍失败：` + info!.error;
	}
	return info!;
}

/**
 * 单次请求 AI（不做重试，失败时通过 error 字段返回）
 */
async function requestAIAnswerOnce(
	config: AIConfig,
	env: Record<string, any>,
	opts?: { logger?: (...args: any[]) => void }
): Promise<SearchInformation> {
	const name = `AI 答题（${config.model || '未知模型'}）`;
	const info: SearchInformation = {
		name,
		homepage: config.baseUrl,
		results: []
	};

	const logger = opts?.logger;

	try {
		const url = resolveAIUrl(config.baseUrl);
		if (!url) {
			throw new Error('AI 接口地址未配置');
		}
		if (!config.model) {
			throw new Error('AI 模型未配置');
		}

		const headers = buildAIHeaders(config);
		const data = buildAIData(config, env);

		logger?.('[AI-请求]', url, JSON.stringify(data));

		const timeoutSeconds = config.timeoutSeconds || DEFAULT_AI_CONFIG.timeoutSeconds;

		const response: any = await Promise.race([
			request(url, {
				method: 'post',
				type: config.type,
				responseType: 'json',
				headers,
				data
			}).catch((error: any) => {
				// 请求层失败（非 200、跨域被拦截、响应不是合法 JSON 等）
				throw new Error('请求失败（' + safeStringify(error, 300) + '）');
			}),
			$.sleep(timeoutSeconds * 1000)
		]);

		if (response === undefined) {
			throw new Error(`AI 请求超时（${timeoutSeconds} 秒），请检查网络或接口地址。`);
		}

		/** 无论成功失败都保留原始响应，方便排查 */
		info.response = response;
		logger?.('[AI-响应]', safeStringify(response, 800));

		/** 兼容各家网关的错误格式 */
		const errorMessage = extractAIError(response);
		if (errorMessage) {
			throw new Error(errorMessage);
		}

		const extracted = extractAIContent(response);
		if (!extracted.content) {
			if (extracted.reasoningOnly) {
				throw new Error(
					'模型没有输出答案：本次输出长度被「思考过程」占满，请调大「最大输出长度」（建议 4096 以上），或换用非推理模型。'
				);
			}
			throw new Error('AI 返回内容无法识别，原始响应：' + safeStringify(response, 300));
		}

		const answer = parseAIContent(extracted.content);
		if (!answer) {
			throw new Error('AI 返回的内容无法解析为答案，原始响应：' + safeStringify(response, 300));
		}

		info.results = [
			{
				question: String(env.title ?? ''),
				answer,
				extra_data: { ai: true, model: config.model, raw: extracted.content }
			}
		];

		return info;
	} catch (error) {
		info.error = (error as any)?.message || String(error);
		logger?.('[AI-错误]', info.error);
		return info;
	}
}
