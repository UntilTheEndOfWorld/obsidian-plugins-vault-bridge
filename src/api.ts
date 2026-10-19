import { requestUrl, type RequestUrlResponse } from 'obsidian';

export interface BindStartResponse {
	code: string;
	bindCode: string;
	userId: string;
	status: string;
	tip?: string;
}

export interface BindStatusResponse {
	status: 'pending' | 'claimed' | 'confirmed' | 'unbound' | 'invalid' | 'expired';
	bindCode?: string;
	userId?: string;
	accessToken?: string;
	/** 旧后端字段，等同 accessToken */
	token?: string;
	unlimited?: boolean;
	tip?: string;
}

/** 是否已认领成功（兼容 claimed / confirmed） */
export function isBindClaimed(status?: string): boolean {
	return status === 'claimed' || status === 'confirmed';
}

/** 解析长 Token（兼容 accessToken / token） */
export function resolveBindAccessToken(status: BindStatusResponse | null | undefined): string {
	if (!status) return '';
	return String(status.accessToken || status.token || '').trim();
}

export interface SyncArticleItem {
	id: string;
	title?: string;
	sourceUrl?: string;
	markdown?: string;
	parseStatus?: string;
	retryCount?: number;
	maxRetry?: number;
	syncStatus?: string;
	author?: string;
	account?: string;
	publishedAt?: string;
	savedAt?: string;
	contentKind?: string;
}

export interface SyncArticlesResponse {
	articles: SyncArticleItem[];
	abandoned?: Array<{
		id: string;
		sourceUrl?: string;
		title?: string;
		message?: string;
		retryCount?: number;
		errorMsg?: string;
	}>;
	bindCode?: string;
	userId?: string;
	unlimited?: boolean;
	quotaExhausted?: boolean;
	dailyLimit?: number;
	dailySyncUsed?: number;
	vipExpireText?: string;
}

export interface AckResultItem {
	id: string;
	writtenPath?: string;
	title?: string;
	error?: string;
}

export interface AckBatchResponse {
	successCount: number;
	failCount: number;
	abandonedCount: number;
	details: Array<{
		id: string;
		ok?: boolean;
		status?: string;
		tip?: string;
		sourceUrl?: string;
	}>;
}

/**
 * 管理后台 `/jx_slr_admin` 是 Nginx 静态页，POST 会被直接 405，且不会进入 Java。
 * 接口根地址应是 `/jx_slr_api`。
 */
export function migrateApiBaseUrl(raw: string | null | undefined): string {
	const trimmed = String(raw ?? '').trim().replace(/\/+$/, '');
	if (!trimmed) return trimmed;
	return trimmed.replace(/\/jx_slr_admin(?=\/|$)/i, '/jx_slr_api');
}

export async function apiRequest<T>(
	baseUrl: string,
	path: string,
	options: {
		method?: string;
		accessToken?: string;
		body?: unknown;
	} = {},
): Promise<T> {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
	};
	if (options.accessToken) {
		headers['Authorization'] = `Bearer ${options.accessToken}`;
		headers['X-Access-Token'] = options.accessToken;
	}

	const method = (options.method || 'GET').toUpperCase();
	const normalizedBase = migrateApiBaseUrl(baseUrl);
	const url = `${normalizedBase}${path.startsWith('/') ? path : `/${path}`}`;
	if (normalizedBase !== String(baseUrl ?? '').trim().replace(/\/+$/, '')) {
		console.warn(`[SyncBridge] 服务地址已从管理后台改写为 API：${normalizedBase}`);
	}

	let response: RequestUrlResponse;
	try {
		response = await requestUrl({
			url,
			method,
			headers,
			body: options.body ? JSON.stringify(options.body) : undefined,
			// 默认 throw=true 时 4xx 直接抛错，按钮 catch 只弹 Notice，控制台没有任何请求日志
			throw: false,
		});
	} catch (error) {
		console.error(`[SyncBridge] ${method} ${url} 请求未完成`, error);
		throw error;
	}

	const bodyText = typeof response?.text === 'string' ? response.text : '';
	const status = response?.status ?? 0;
	if (status < 200 || status >= 300) {
		console.error(`[SyncBridge] ${method} ${url} -> ${status}`, bodyText.slice(0, 300));
		if (status === 405) {
			throw new Error(
				`API 405：${method} ${url} 被拒绝。服务地址不要填管理后台 /jx_slr_admin，应使用 https://lycc.ltd/jx_slr_api。该 405 由 Nginx 直接返回，Java 控制台不会有日志。`,
			);
		}
		throw new Error(`API ${status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`);
	}

	const trimmedText = bodyText.trimStart();
	const contentType = String(response?.headers?.['content-type'] || response?.headers?.['Content-Type'] || '');
	if (trimmedText.startsWith('<') || /text\/html/i.test(contentType)) {
		console.error(`[SyncBridge] ${method} ${url} 返回了网页而不是 JSON`);
		throw new Error(
			`接口返回了网页：${url}。请把服务地址改成 https://lycc.ltd/jx_slr_api，不要使用管理后台 /jx_slr_admin。`,
		);
	}

	const json = response.json as { code?: number; msg?: string; data?: T } & T;
	if (json && typeof json === 'object' && 'code' in json && 'data' in json) {
		if (json.code !== 200) {
			const err = new Error(json.msg || `业务错误 code=${json.code}`) as Error & { code?: number };
			err.code = typeof json.code === 'number' ? json.code : undefined;
			throw err;
		}
		return json.data as T;
	}
	return json as T;
}

/** 绑定失效 / 小程序已解绑（服务端 401 或明确文案） */
export function isBindAuthLostError(error: unknown): boolean {
	const code = (error as { code?: number } | null)?.code;
	const msg = error instanceof Error ? error.message : String(error ?? '');
	return (
		code === 401 ||
		/小程序已解绑|未绑定|Token\s*无效|请重新生成配对码|登录失效|已解绑|API 401/i.test(msg)
	);
}
