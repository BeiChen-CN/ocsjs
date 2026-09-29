/**
 * AI 答题模块的纯函数测试
 *
 * pnpm test                              运行全部测试
 * tsx tests/ai.test.ts                   仅运行本文件
 *
 * 覆盖：接口地址拼装、提示词渲染、请求头构造、AI 返回内容的答案解析。
 * 不发起任何真实网络请求。
 */

import {
	resolveAIUrl,
	resolveAIPrompt,
	buildAIHeaders,
	parseAIContent,
	buildAIMessages,
	safeStringify,
	extractAIError,
	extractAIContent,
	DEFAULT_AI_CONFIG
} from '../packages/core/src/core/answer-wrapper/ai';

let pass = 0;
let fail = 0;

function check(name: string, actual: any, expected: any) {
	if (JSON.stringify(actual) === JSON.stringify(expected)) {
		pass++;
	} else {
		fail++;
		console.log(`    ❌ ${name}  期望=${JSON.stringify(expected)}  实际=${JSON.stringify(actual)}`);
	}
}

// ========== 接口地址拼装 ==========
console.log('\n  接口地址');
check('自动补全 /chat/completions', resolveAIUrl('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/chat/completions');
check('忽略末尾斜杠', resolveAIUrl('https://api.deepseek.com/v1/'), 'https://api.deepseek.com/v1/chat/completions');
check('已是完整路径则不重复拼接', resolveAIUrl('https://x.com/v1/chat/completions'), 'https://x.com/v1/chat/completions');
check('空地址返回空', resolveAIUrl(''), '');

// ========== 提示词渲染 ==========
console.log('\n  提示词');
const prompt = resolveAIPrompt(DEFAULT_AI_CONFIG.userPromptTemplate, {
	type: 'single',
	title: '1+1=?',
	options: 'A. 1\nB. 2'
});
check('包含题目', prompt.includes('1+1=?'), true);
check('包含选项', prompt.includes('A. 1'), true);
check('题型转为中文', prompt.includes('单选题'), true);
check('占位符已全部替换', /\$\{/.test(prompt), false);
check(
	'无选项时给出兜底文案',
	resolveAIPrompt(DEFAULT_AI_CONFIG.userPromptTemplate, { type: 'completion', title: '填空' }).includes('本题无选项'),
	true
);
// 题目内容里出现 $ 时不应破坏替换（String.replace 的替换串特殊符号问题）
check('题目含 $ 时安全替换', resolveAIPrompt('题目：${title}', { title: '价格是 $& $1 $` 的题' }), '题目：价格是 $& $1 $` 的题');

// ========== 请求头 ==========
console.log('\n  请求头');
const headers = buildAIHeaders({ ...DEFAULT_AI_CONFIG, apiKey: 'sk-1', extraHeaders: 'X-A: 1\nbad\nB:2' });
check('Authorization 带 Bearer', headers.Authorization, 'Bearer sk-1');
check('解析额外请求头', headers['X-A'], '1');
check('额外请求头去除空格', headers.B, '2');
check('空密钥不带 Authorization', buildAIHeaders({ ...DEFAULT_AI_CONFIG, apiKey: '' }).Authorization, undefined);

// ========== 消息构造 ==========
console.log('\n  消息');
const messages = buildAIMessages(DEFAULT_AI_CONFIG, { title: 'q', type: 'judgement' });
check('系统 + 用户两条消息', messages.length, 2);
check('角色顺序正确', messages.map((m) => m.role), ['system', 'user']);

// ========== 答案解析 ==========
console.log('\n  答案解析');
check('纯字母答案', parseAIContent('B'), 'B');
check('去掉末尾句号', parseAIContent('对。'), '对');
check('去掉「正确答案：」前缀', parseAIContent('正确答案：ABC'), 'ABC');
check('去掉「答案是」前缀', parseAIContent('答案是 A'), 'A');
check('去掉 markdown 代码块', parseAIContent('```\nB\n```'), 'B');
check('去掉带语言的代码块', parseAIContent('```text\nA\n```'), 'A');
check('去掉首尾引号', parseAIContent('"B"'), 'B');
check('多行回答取第一行', parseAIContent('答案是 B\n因为 1+1=2'), 'B');
check(
	'长答案保留句末标点',
	parseAIContent('这是一段很长的简答题答案内容，不应该去掉句号。'),
	'这是一段很长的简答题答案内容，不应该去掉句号。'
);
check('空白内容返回空', parseAIContent('   '), '');

// ========== 错误识别（各家网关格式不统一） ==========
console.log('\n  错误识别');
check(
	'OpenAI 标准错误',
	extractAIError({ error: { message: 'Incorrect API key provided' } }),
	'Incorrect API key provided'
);
// 多数中转站/网关不带 error 字段，只有 code + message
check('网关 code+message 错误', extractAIError({ code: 401, message: 'Authentication Fails (governor)' }), 'Authentication Fails (governor)');
check('error 为字符串', extractAIError({ error: '额度不足' }), '额度不足');
check('msg 字段', extractAIError({ msg: 'no such model' }), 'no such model');
check('正常响应不算错误', extractAIError({ choices: [{ message: { content: 'B' } }] }), undefined);

// ========== 内容提取 ==========
console.log('\n  内容提取');
check('标准 choices 格式', extractAIContent({ choices: [{ message: { content: 'B' } }] }), { content: 'B' });
check('data 包裹格式', extractAIContent({ data: { choices: [{ message: { content: 'A' } }] } }), { content: 'A' });
check(
	'推理模型只返回思考过程',
	extractAIContent({ choices: [{ message: { content: '', reasoning_content: '让我想想…' } }] }),
	{ reasoningOnly: true }
);
check('空响应', extractAIContent({}), {});
check('未知结构不算内容', extractAIContent({ foo: 'bar' }), {});

// ========== 安全序列化 ==========
console.log('\n  安全序列化');
check('截断长文本', safeStringify('x'.repeat(50), 10), 'xxxxxxxxxx…（已截断）');
check('对象序列化', safeStringify({ a: 1 }), '{"a":1}');
const circular: any = {};
circular.self = circular;
check('循环引用不抛错', typeof safeStringify(circular), 'string');

// ========== 结果 ==========
console.log(`\n  ✅ ${pass} 通过   ❌ ${fail} 失败   共 ${pass + fail} 项\n`);

if (fail > 0) process.exit(1);
