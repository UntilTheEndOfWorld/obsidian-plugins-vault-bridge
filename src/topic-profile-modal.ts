import { App, Modal, Setting } from 'obsidian';
import type { TopicGroupProfile } from './topic-profiles';

interface RuleRow {
	folder: string;
	keywords: string;
}

export class TopicProfileModal extends Modal {
	private profile: TopicGroupProfile;
	private readonly onSave: (profile: TopicGroupProfile) => void;
	private rows: RuleRow[] = [];
	private listEl: HTMLElement | null = null;

	constructor(app: App, profile: TopicGroupProfile, onSave: (profile: TopicGroupProfile) => void) {
		super(app);
		this.profile = { ...profile };
		this.onSave = onSave;
		this.rows = parseRulesToRows(profile.rules || '');
		if (this.rows.length === 0) {
			this.rows.push({ folder: '', keywords: '' });
		}
	}

	onOpen() {
		const { contentEl, titleEl } = this;
		contentEl.empty();
		contentEl.addClass('vb-topic-modal');
		titleEl.setText(`${this.profile.name} · 配置详情`);

		contentEl.createEl('p', {
			cls: 'vb-topic-modal-hint',
			text: '左侧填目录名（支持层级，如 中间件/Kafka），右侧填关键词（逗号分隔）。开启该主题后，同步与整理都会按这些规则匹配。',
		});

		if (!this.profile.builtin) {
			new Setting(contentEl)
				.setName('主题名称')
				.addText((t) =>
					t.setValue(this.profile.name).onChange((v) => {
						this.profile.name = v.trim() || this.profile.name;
					}),
				);
		}

		const header = contentEl.createDiv({ cls: 'vb-rule-header' });
		header.createSpan({ cls: 'vb-rule-col-folder', text: '目录' });
		header.createSpan({ cls: 'vb-rule-eq', text: '=' });
		header.createSpan({ cls: 'vb-rule-col-keywords', text: '关键词' });
		header.createSpan({ cls: 'vb-rule-col-action', text: '' });

		this.listEl = contentEl.createDiv({ cls: 'vb-rule-list' });
		this.renderRows();

		const actions = contentEl.createDiv({ cls: 'vb-topic-modal-actions' });
		actions
			.createEl('button', { text: '+ 添加一行', cls: 'vb-rule-add-btn' })
			.addEventListener('click', () => {
				this.rows.unshift({ folder: '', keywords: '' });
				this.renderRows();
			});

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText('保存').setCta().onClick(() => {
				this.profile.rules = rowsToRulesText(this.rows);
				this.onSave(this.profile);
				this.close();
			}),
		);
	}

	private renderRows() {
		if (!this.listEl) return;
		this.listEl.empty();

		this.rows.forEach((row, index) => {
			const el = this.listEl!.createDiv({ cls: 'vb-rule-row' });

			const folderInput = el.createEl('input', {
				cls: 'vb-rule-folder',
				type: 'text',
				placeholder: '如 数据库 或 中间件/Kafka',
			});
			folderInput.value = row.folder;
			folderInput.addEventListener('input', () => {
				row.folder = folderInput.value;
			});

			el.createSpan({ cls: 'vb-rule-eq', text: '=' });

			const keywordsInput = el.createEl('input', {
				cls: 'vb-rule-keywords',
				type: 'text',
				placeholder: '关键词，逗号分隔',
			});
			keywordsInput.value = row.keywords;
			keywordsInput.addEventListener('input', () => {
				row.keywords = keywordsInput.value;
			});

			const delBtn = el.createEl('button', {
				cls: 'vb-rule-delete-btn',
				text: '删除',
				attr: { type: 'button', 'aria-label': '删除此行' },
			});
			delBtn.addEventListener('click', () => {
				this.rows.splice(index, 1);
				if (this.rows.length === 0) {
					this.rows.push({ folder: '', keywords: '' });
				}
				this.renderRows();
			});
		});
	}

	onClose() {
		this.contentEl.empty();
		this.listEl = null;
	}
}

function parseRulesToRows(rules: string): RuleRow[] {
	const rows: RuleRow[] = [];
	for (const line of rules.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq <= 0) {
			rows.push({ folder: trimmed, keywords: '' });
			continue;
		}
		rows.push({
			folder: trimmed.slice(0, eq).trim(),
			keywords: trimmed.slice(eq + 1).trim(),
		});
	}
	return rows;
}

function rowsToRulesText(rows: RuleRow[]): string {
	return rows
		.map((r) => {
			const folder = r.folder.trim();
			const keywords = r.keywords.trim();
			if (!folder || !keywords) return '';
			return `${folder}=${keywords}`;
		})
		.filter(Boolean)
		.join('\n');
}
