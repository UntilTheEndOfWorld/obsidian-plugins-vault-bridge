import { Platform, requestUrl } from 'obsidian';

const DEFAULT_MEDIA_HEADERS: Record<string, string> = {
	'User-Agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	Referer: 'https://mp.weixin.qq.com/',
	Origin: 'https://mp.weixin.qq.com',
	Accept: '*/*',
};

/** 强制 https，避免微信 CDN 的 http 被拦截或 403 */
export function forceHttpsUrl(url: string): string {
	const trimmed = (url || '').trim();
	if (!trimmed) return '';
	if (trimmed.startsWith('//')) return `https:${trimmed}`;
	if (trimmed.startsWith('http://')) return `https://${trimmed.slice('http://'.length)}`;
	return trimmed;
}

function headersForUrl(url: string, referer?: string): Record<string, string> {
	const headers = { ...DEFAULT_MEDIA_HEADERS };
	const u = (url || '').toLowerCase();
	if (referer) {
		headers.Referer = referer;
		try {
			headers.Origin = new URL(referer).origin;
		} catch {
			/* ignore */
		}
	} else if (/qcloudimg|tencent\.com|tencent-cloud/i.test(u)) {
		headers.Referer = 'https://cloud.tencent.com/';
		headers.Origin = 'https://cloud.tencent.com';
	} else if (/alicdn|aliyun\.com/i.test(u)) {
		headers.Referer = 'https://developer.aliyun.com/';
		headers.Origin = 'https://developer.aliyun.com';
	} else if (/xhscdn|xiaohongshu|xhslink/i.test(u)) {
		headers.Referer = 'https://www.xiaohongshu.com/';
		headers.Origin = 'https://www.xiaohongshu.com';
	}
	return headers;
}

/**
 * 下载远程媒体。
 * 桌面端优先走 Node https（绕过 Chromium 的 ERR_BLOCKED_BY_CLIENT，常见于广告拦截规则）。
 * 失败再回退 Obsidian requestUrl。
 */
export async function downloadRemoteMedia(
	url: string,
	options?: { referer?: string },
): Promise<ArrayBuffer | null> {
	const httpsUrl = forceHttpsUrl(url);
	if (!httpsUrl) return null;
	const headers = headersForUrl(httpsUrl, options?.referer);

	if (Platform.isDesktopApp) {
		try {
			const buffer = await downloadWithNodeHttps(httpsUrl, headers);
			if (buffer && buffer.byteLength > 0) return buffer;
		} catch (err) {
			console.warn('SyncBridge node download failed, fallback to requestUrl', httpsUrl, err);
		}
	}

	try {
		const response = await requestUrl({
			url: httpsUrl,
			headers,
		});
		if (response.status >= 200 && response.status < 300) {
			return response.arrayBuffer;
		}
	} catch (err) {
		console.warn('SyncBridge requestUrl download failed', httpsUrl, err);
	}
	return null;
}

type NodeHttpModule = {
	get: (
		url: string,
		options: { headers?: Record<string, string>; timeout?: number },
		callback: (res: NodeIncomingMessage) => void,
	) => NodeClientRequest;
};

type NodeIncomingMessage = {
	statusCode?: number;
	headers: { location?: string };
	on: (event: string, cb: (...args: unknown[]) => void) => void;
	resume: () => void;
};

type NodeClientRequest = {
	on: (event: string, cb: (...args: unknown[]) => void) => void;
	destroy: () => void;
};

function downloadWithNodeHttps(
	url: string,
	headers: Record<string, string>,
): Promise<ArrayBuffer> {
	return new Promise((resolve, reject) => {
		let httpsMod: NodeHttpModule | null = null;
		let httpMod: NodeHttpModule | null = null;
		try {
			const reqFn = (window as { require?: (id: string) => unknown }).require;
			if (!reqFn) {
				reject(new Error('Node require unavailable'));
				return;
			}
			httpsMod = reqFn('https') as NodeHttpModule;
			httpMod = reqFn('http') as NodeHttpModule;
		} catch (err) {
			reject(err instanceof Error ? err : new Error(String(err)));
			return;
		}
		if (!httpsMod || !httpMod) {
			reject(new Error('Node http modules unavailable'));
			return;
		}

		const lib = url.startsWith('https:') ? httpsMod : httpMod;
		const request = lib.get(
			url,
			{
				headers,
				timeout: 120_000,
			},
			(res) => {
				const status = res.statusCode || 0;
				if (status >= 300 && status < 400 && res.headers.location) {
					const next = forceHttpsUrl(res.headers.location);
					res.resume();
					downloadWithNodeHttps(next, headers).then(resolve, reject);
					return;
				}
				if (status < 200 || status >= 300) {
					res.resume();
					reject(new Error(`HTTP ${status}`));
					return;
				}
				const chunks: Uint8Array[] = [];
				res.on('data', (...args: unknown[]) => {
					const chunk = args[0];
					if (chunk instanceof Uint8Array) chunks.push(chunk);
					else if (typeof chunk === 'string') {
						chunks.push(new TextEncoder().encode(chunk));
					}
				});
				res.on('end', () => {
					const total = chunks.reduce((n, c) => n + c.byteLength, 0);
					const out = new Uint8Array(total);
					let offset = 0;
					for (const c of chunks) {
						out.set(c, offset);
						offset += c.byteLength;
					}
					resolve(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
				});
				res.on('error', (...args: unknown[]) => {
					const err = args[0];
					reject(err instanceof Error ? err : new Error(String(err)));
				});
			},
		);
		request.on('error', (...args: unknown[]) => {
			const err = args[0];
			reject(err instanceof Error ? err : new Error(String(err)));
		});
		request.on('timeout', () => {
			request.destroy();
			reject(new Error('download timeout'));
		});
	});
}
