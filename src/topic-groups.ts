import { sanitizeFileName } from './markdown';

export interface TopicGroup {
	/** 归档路径，支持层级如 中间件/Kafka */
	folder: string;
	/** 同义词 / 相关词（标题命中任一即归入 folder） */
	terms: string[];
}

/** 编程开发默认主题（可关闭，也可在设置里追加行业词库） */
export const DEFAULT_TOPIC_GROUPS_TEXT = `线程=线程池,多线程,线程,Thread,并发,CompletableFuture,ThreadLocal,协程,异步,锁,volatile,synchronized
数据库=MySQL,mysql,SQL,数据库,Oracle,PostgreSQL,MongoDB,索引,事务,慢查询,存储引擎,InnoDB,分库分表,SQL优化,查询优化
系统优化=性能优化,系统优化,优化到,性能调优,调优,响应时间,耗时,性能瓶颈,接口优化,接口变慢
工具=监控工具,开发工具,效率工具,排查工具,诊断工具,工具
Java=Java,JVM,Spring,SpringBoot,MyBatis,Maven,Gradle,Kotlin,微服务,GC,类加载,HashMap,ConcurrentHashMap
缓存=Redis,缓存,Memcached,淘汰策略,热点,缓存穿透,缓存雪崩,缓存击穿
网络=HTTP,TCP,UDP,Netty,Nginx,网络,网关,Wireshark,HTTPS,SSL
面试=面试官,面试题,一面,二面,三面,Java面试,后端面试,校招,社招
前端=Vue,React,JavaScript,TypeScript,Node,CSS,HTML,小程序,Webpack,Vite
算法=算法,LeetCode,数据结构,二叉树,动态规划,排序,哈希,链表,栈,队列
Linux=Linux,linux,grep,awk,vim,ssh,shell,命令,运维,服务器,CentOS,Ubuntu,性能监控,IO优化
中间件=消息队列,MQ,中间件,MemQ
中间件/Kafka=Kafka,kafka,Broker,分区,消费组,丢数据,Zookeeper,副本
中间件/RabbitMQ=RabbitMQ,Rabbit,AMQP,Exchange,Queue,死信
中间件/RocketMQ=RocketMQ,Rocket,rocket,NameServer
架构=架构,系统设计,高可用,高并发,分布式,负载均衡,限流,熔断,降级,CAP,秒杀
设计模式=设计模式,单例,工厂,观察者,策略,代理,AOP,IOC,责任链,模板方法
Docker=Docker,docker,Kubernetes,K8s,容器,Pod,Helm,镜像`;

/** 内置词库版本：升级时自动把新增目录/词条合并进「开发编程主题」 */
export const BUILTIN_TOPIC_RULES_VERSION = 2;

/** 将配置中的路径转为安全文件夹路径（支持 / 或 > 表示层级） */
export function sanitizeFolderPath(raw: string): string {
	return raw
		.split(/[/\\>＞]+/)
		.map((part) => sanitizeFileName(part.trim()))
		.filter(Boolean)
		.join('/');
}

/** 解析主题分组：目录名=词1,词2,词3；目录可写 行业/子类 或 行业>子类 */
export function parseTopicGroups(text: string): TopicGroup[] {
	if (!text?.trim()) return [];
	const groups: TopicGroup[] = [];
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq <= 0) continue;
		const folder = sanitizeFolderPath(trimmed.slice(0, eq).trim());
		if (!folder) continue;
		const terms = trimmed
			.slice(eq + 1)
			.split(/[,，;；|]/)
			.map((t) => t.trim())
			.filter((t) => t.length >= 2);
		if (terms.length === 0) continue;
		groups.push({ folder, terms });
	}
	return groups;
}

export function mergeTopicGroups(builtinText: string, customText: string): TopicGroup[] {
	const map = new Map<string, Set<string>>();
	for (const g of parseTopicGroups(builtinText)) {
		const set = map.get(g.folder) || new Set<string>();
		g.terms.forEach((t) => set.add(t));
		map.set(g.folder, set);
	}
	for (const g of parseTopicGroups(customText)) {
		const set = map.get(g.folder) || new Set<string>();
		g.terms.forEach((t) => set.add(t));
		map.set(g.folder, set);
	}
	return [...map.entries()].map(([folder, terms]) => ({
		folder,
		terms: [...terms].sort((a, b) => b.length - a.length),
	}));
}

/** 标题是否命中词条（长词优先在外部循环） */
export function titleMatchesTerm(title: string, term: string): boolean {
	if (!title?.trim() || !term?.trim()) return false;
	if (title.includes(term)) return true;
	if (/^[a-z0-9+#.-]+$/i.test(term)) {
		const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(title);
	}
	return false;
}

/** 按主题分组匹配，返回命中的文件夹路径列表 */
export function collectTopicGroupHits(title: string, groups: TopicGroup[]): string[] {
	const matched = new Set<string>();
	for (const group of groups) {
		for (const term of group.terms) {
			if (titleMatchesTerm(title, term)) {
				matched.add(group.folder);
				break;
			}
		}
	}
	// 标题像「从 2s 优化到 0.1s / 从 12s 到 200ms」→ 系统优化
	if (looksLikePerfOptimizationTitle(title)) {
		matched.add('系统优化');
	}
	return [...matched];
}

/** 「从 Xs 到 Yms / 优化到」这类性能优化标题 */
export function looksLikePerfOptimizationTitle(title: string): boolean {
	if (!title?.trim()) return false;
	if (/优化到/.test(title)) return true;
	if (/\d+\s*[sS秒].{0,16}\d+\s*(ms|毫秒)/.test(title)) return true;
	if (/从\s*\d+\s*[sS秒].{0,20}到\s*\d+/.test(title)) return true;
	return false;
}

/** 序列化主题分组为配置文本 */
export function serializeTopicGroups(groups: TopicGroup[]): string {
	return groups.map((g) => `${g.folder}=${g.terms.join(',')}`).join('\n');
}

/** 把默认词库合并进现有配置（保留用户自定义目录与词条） */
export function enrichRulesWithDefaults(currentRules: string, defaults: string): string {
	return serializeTopicGroups(mergeTopicGroups(defaults, currentRules || ''));
}

function isAncestorPath(ancestor: string, descendant: string): boolean {
	if (ancestor === descendant) return false;
	return descendant.startsWith(`${ancestor}/`);
}

/**
 * 从多个命中路径中选出最终目录：
 * - 父子同时命中 → 保留更具体的子路径（中间件 + 中间件/Kafka → 中间件/Kafka）
 * - 多个互不相关的路径 → 返回 null（由调用方归入「未分类」）
 */
export function resolveTopicFolderFromHits(hits: string[]): string | null {
	if (hits.length === 0) return null;

	const sorted = [...hits].sort((a, b) => {
		const depthDiff = b.split('/').length - a.split('/').length;
		if (depthDiff !== 0) return depthDiff;
		return b.length - a.length;
	});

	const filtered: string[] = [];
	for (const hit of sorted) {
		if (!filtered.some((f) => isAncestorPath(hit, f))) {
			filtered.push(hit);
		}
	}

	if (filtered.length === 1) return filtered[0] ?? null;
	return null;
}

/** 主题分组匹配的最终归档路径（含层级） */
export function matchTopicFolder(title: string, groups: TopicGroup[]): string | null {
	return resolveTopicFolderFromHits(collectTopicGroupHits(title, groups));
}

/**
 * 从多命中中选出「主主题」（整理「未分类」时用）：
 * 优先更深路径、更长命中词条；无法唯一时仍给一个最匹配目录。
 */
export function pickPrimaryTopicFolder(title: string, groups: TopicGroup[]): string | null {
	const hits = collectTopicGroupHits(title, groups);
	if (hits.length === 0) return null;

	const unique = resolveTopicFolderFromHits(hits);
	if (unique) return unique;

	let bestFolder: string | null = null;
	let bestScore = -1;

	for (const folder of hits) {
		const group = groups.find((g) => g.folder === folder);
		let termScore = 0;
		if (group) {
			for (const term of group.terms) {
				if (titleMatchesTerm(title, term)) {
					termScore = Math.max(termScore, term.length);
				}
			}
		}
		if (folder === '系统优化' && looksLikePerfOptimizationTitle(title)) {
			termScore = Math.max(termScore, 6);
		}
		const score = termScore * 20 + folder.split('/').length * 5 + folder.length;
		if (score > bestScore) {
			bestScore = score;
			bestFolder = folder;
		}
	}

	return bestFolder;
}
