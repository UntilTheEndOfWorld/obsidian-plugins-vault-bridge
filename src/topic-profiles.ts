import {
	BUILTIN_TOPIC_RULES_VERSION,
	DEFAULT_TOPIC_GROUPS_TEXT,
	enrichRulesWithDefaults,
} from './topic-groups';

export interface TopicGroupProfile {
	id: string;
	name: string;
	enabled: boolean;
	/** 每行：目录=关键词1,关键词2；支持 行业/子类 或 行业>子类 */
	rules: string;
	/** 内置主题不可删除 */
	builtin?: boolean;
}

export function createTopicProfileId(): string {
	return `topic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const DEFAULT_TOPIC_PROFILES: TopicGroupProfile[] = [
	{
		id: 'builtin-dev',
		name: '开发编程主题',
		enabled: true,
		builtin: true,
		rules: DEFAULT_TOPIC_GROUPS_TEXT,
	},
];

export function migrateTopicProfiles(
	loaded: Partial<{
		topicProfiles?: TopicGroupProfile[];
		useBuiltinTopicGroups?: boolean;
		topicSynonymGroups?: string;
		builtinTopicRulesVersion?: number;
	}>,
): TopicGroupProfile[] {
	if (loaded.topicProfiles?.length) {
		return loaded.topicProfiles.map((p) => ({
			id: p.id || createTopicProfileId(),
			name: p.name || '未命名主题',
			enabled: p.enabled !== false,
			rules: p.rules || '',
			builtin: p.builtin,
		}));
	}

	const profiles = DEFAULT_TOPIC_PROFILES.map((p) => ({ ...p }));
	const builtin = profiles.find((p) => p.builtin);
	if (builtin && loaded.useBuiltinTopicGroups !== undefined) {
		builtin.enabled = loaded.useBuiltinTopicGroups;
	}
	if (loaded.topicSynonymGroups?.trim()) {
		profiles.push({
			id: createTopicProfileId(),
			name: '自定义主题',
			enabled: true,
			rules: loaded.topicSynonymGroups.trim(),
		});
	}
	return profiles;
}

/** 把新增的内置目录/词条合并进「开发编程主题」 */
export function syncBuiltinTopicRules(
	profiles: TopicGroupProfile[],
	currentVersion: number | undefined,
): { profiles: TopicGroupProfile[]; version: number; changed: boolean } {
	if ((currentVersion || 0) >= BUILTIN_TOPIC_RULES_VERSION) {
		return {
			profiles,
			version: currentVersion || BUILTIN_TOPIC_RULES_VERSION,
			changed: false,
		};
	}

	const next = profiles.map((p) => {
		if (!(p.builtin || p.id === 'builtin-dev')) return p;
		return {
			...p,
			name: p.name || '开发编程主题',
			builtin: true,
			rules: enrichRulesWithDefaults(p.rules || '', DEFAULT_TOPIC_GROUPS_TEXT),
		};
	});

	const hasBuiltin = next.some((p) => p.builtin || p.id === 'builtin-dev');
	if (!hasBuiltin) {
		next.unshift({ ...DEFAULT_TOPIC_PROFILES[0]! });
	}

	return { profiles: next, version: BUILTIN_TOPIC_RULES_VERSION, changed: true };
}

export function nextCustomTopicName(profiles: TopicGroupProfile[]): string {
	const used = new Set(profiles.map((p) => p.name));
	let i = profiles.filter((p) => !p.builtin).length + 1;
	while (used.has(`自定义主题 ${i}`)) i++;
	return `自定义主题 ${i}`;
}
