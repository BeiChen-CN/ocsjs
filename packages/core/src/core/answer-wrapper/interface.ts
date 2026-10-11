/** 题目答案 */
export interface Result {
	question: string;
	answer: string;
	extra_data?: object;
}

/** 题库查询信息 */
export interface SearchInformation {
	results: Result[];
	name: string;
	url?: string;
	/** 主页 */
	homepage?: string;
	/** 题目答案 */
	/** 请求响应内容 */
	response?: any;
	/** 请求发起内容 */
	data?: any;
	/** 错误数据 */
	error?: string;
	/** 实际请求次数（含重试），仅 AI 答题结果携带 */
	attempts?: number;
}

/**
 * 题库配置器
 */
export interface AnswererWrapper {
	/** 答题器请求路径 */
	url: string;
	/** 题库名字 */
	name: string;
	/** 题库网址 */
	homepage?: string;
	/** 请求数据 */
	data?: Record<string, any>;
	/** 请求方法 */
	method: 'post' | 'get';
	/** 定义 handler 中的参数类型 */
	contentType: 'json' | 'text';
	/** 请求模式 */
	type: 'fetch' | 'GM_xmlhttpRequest';
	/** 附带请求头 */
	headers: Record<string, string>;
	/**
	 * 此选项是个字符串， 使用 [Function(string)](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Function) 构造方法进行解析生成方法
	 *
	 * 方法传入一个参数 : 请求获取到的文本 ，可以使用 contentType 定义文本类型
	 *
	 * 对返回的数据进行自定义解析
	 *
	 * 并且返回一个数组 : `[题目, 答案]`
	 *
	 * 或者二维数据 : `[[题目1, 答案1],[题目2, 答案2], ...`
	 *
	 * 如果搜不到则返回 undefined
	 *
	 * @example
	 *
	 * ```js
	 * {
	 *      handler: `return (res)=> res.code === 0 ? undefined : [res.question, undefined]`
	 * }
	 * ```
	 *
	 */
	handler: string;
}

/**
 * AI 答题配置（基于 OpenAI 兼容接口，可通用于 DeepSeek / 硅基流动 / 通义 / 智谱 / 本地 Ollama 等）
 */
export interface AIConfig {
	/** 是否启用 AI 答题 */
	enabled: boolean;
	/** OpenAI 兼容接口的 Base URL，例如 https://api.deepseek.com/v1（会自动补全 /chat/completions） */
	baseUrl: string;
	/** API Key，本地模型可留空 */
	apiKey: string;
	/** 模型名称，例如 deepseek-flash */
	model: string;
	/** 采样温度 */
	temperature: number;
	/** 最大输出 token 数 */
	maxTokens: number;
	/** 系统提示词 */
	systemPrompt: string;
	/** 用户提示词模板，支持 ${type} ${title} ${options} 占位符 */
	userPromptTemplate: string;
	/** 请求超时时间（秒） */
	timeoutSeconds: number;
	/** 请求失败后的重试次数，0 表示不重试 */
	retries: number;
	/** 是否禁止模型思考（发送 DeepSeek 官方参数 thinking: disabled 与 reasoning_effort: none，大幅缩短响应时间） */
	disableThinking: boolean;
	/** 请求方式，GM_xmlhttpRequest 可跨域，fetch 需要接口支持 CORS */
	type: 'GM_xmlhttpRequest' | 'fetch';
	/** 额外的请求头，每行一个，格式为 key: value */
	extraHeaders: string;
}
