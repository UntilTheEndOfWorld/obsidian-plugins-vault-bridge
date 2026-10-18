import { normalizePath, TFile, TFolder, type App } from 'obsidian';

export function getFileTitle(app: App, file: TFile): string {
	const cache = app.metadataCache.getFileCache(file);
	const fm = cache?.frontmatter?.title;
	if (typeof fm === 'string' && fm.trim()) return fm.trim();
	const base = file.basename.replace(/\.md$/i, '');
	const dash = base.indexOf(' - ');
	if (dash > 0) return base.slice(dash + 3).trim();
	return base.trim();
}

export async function ensureFolderPath(app: App, folderPath: string): Promise<void> {
	const parts = folderPath.split('/').filter(Boolean);
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		const existing = app.vault.getAbstractFileByPath(current);
		if (!existing) {
			await app.vault.createFolder(current);
		} else if (!(existing instanceof TFolder)) {
			throw new Error(`${current} exists and is not a folder.`);
		}
	}
}

export async function uniquePathInFolder(
	app: App,
	folder: string,
	fileName: string,
): Promise<string> {
	let candidate = normalizePath(`${folder}/${fileName}`);
	if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
	const base = fileName.replace(/\.md$/i, '');
	let i = 2;
	while (app.vault.getAbstractFileByPath(candidate)) {
		candidate = normalizePath(`${folder}/${base} ${i}.md`);
		i++;
	}
	return candidate;
}

export function sleepTick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}
