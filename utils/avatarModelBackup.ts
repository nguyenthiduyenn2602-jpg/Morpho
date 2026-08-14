import JSZip from 'jszip';
import type { CharacterProfile } from '../types';
import { DB } from './db';
import { live2DRuntimeCacheAssetIds } from './avatarModelStore';

export const AVATAR_MODEL_BACKUP_FORMAT = 'sully-avatar-models';
export const AVATAR_MODEL_BACKUP_VERSION = 1;

type VideoAvatarConfig = NonNullable<CharacterProfile['videoAvatar']>;

export interface AvatarModelBackupInventoryItem {
  characterId: string;
  characterName: string;
  format: VideoAvatarConfig['format'];
  fileName: string;
  byteLength: number;
  available: boolean;
}

export interface AvatarModelBackupInventory {
  models: AvatarModelBackupInventoryItem[];
  availableCount: number;
  missingCount: number;
  totalBytes: number;
}

export interface AvatarModelBackupProgress {
  phase: 'scan' | 'pack' | 'restore';
  done: number;
  total: number;
  label: string;
}

interface AvatarModelManifestEntry {
  characterId: string;
  characterName: string;
  path: string;
  byteLength: number;
  config: VideoAvatarConfig;
  slot?: 'active' | 'wardrobe';
}

interface AvatarModelBackupManifest {
  format: typeof AVATAR_MODEL_BACKUP_FORMAT;
  version: typeof AVATAR_MODEL_BACKUP_VERSION;
  createdAt: number;
  models: AvatarModelManifestEntry[];
}

export interface RestoredAvatarModel {
  characterId: string;
  characterName: string;
  config: VideoAvatarConfig;
}

export interface AvatarModelRestoreResult {
  total: number;
  restored: number;
  skipped: number;
  restoredBytes: number;
  models: RestoredAvatarModel[];
  warnings: string[];
}

const modelPath = (index: number, format: VideoAvatarConfig['format']): string => (
  `models/${String(index + 1).padStart(3, '0')}.${format === 'vrm' ? 'vrm' : 'live2d.zip'}`
);

const isSafeModelPath = (value: string): boolean => (
  /^models\/[^/]+$/i.test(value) && !value.includes('..') && !value.includes('\\')
);

const isVideoAvatarConfig = (value: unknown): value is VideoAvatarConfig => {
  if (!value || typeof value !== 'object') return false;
  const config = value as Partial<VideoAvatarConfig>;
  return config.version === 1
    && (config.format === 'vrm' || config.format === 'live2d')
    && typeof config.assetId === 'string'
    && config.assetId.length > 0
    && typeof config.fileName === 'string';
};

const readManifest = async (zip: JSZip): Promise<AvatarModelBackupManifest> => {
  const entry = zip.file('manifest.json');
  if (!entry) throw new Error('这不是 Sully 模型备份：缺少 manifest.json。');

  let value: unknown;
  try {
    value = JSON.parse(await entry.async('string'));
  } catch {
    throw new Error('模型备份清单无法读取，文件可能已损坏。');
  }

  const manifest = value as Partial<AvatarModelBackupManifest>;
  if (manifest.format !== AVATAR_MODEL_BACKUP_FORMAT) {
    throw new Error('这不是 Sully 模型备份，请在上方“导入普通备份”中选择它。');
  }
  if (manifest.version !== AVATAR_MODEL_BACKUP_VERSION) {
    throw new Error(`不支持的模型备份版本：${String(manifest.version ?? '未知')}。`);
  }
  if (!Array.isArray(manifest.models) || manifest.models.length === 0) {
    throw new Error('模型备份中没有可恢复的模型。');
  }
  if (manifest.models.length > 200) {
    throw new Error('模型备份中的模型数量异常，已停止导入。');
  }

  const seenAssetIds = new Set<string>();
  for (const item of manifest.models) {
    if (!item || typeof item.characterId !== 'string' || !item.characterId) {
      throw new Error('模型备份清单缺少角色 ID。');
    }
    if (!isSafeModelPath(item.path) || !zip.file(item.path)) {
      throw new Error(`模型文件缺失或路径不安全：${item.path || '未知路径'}。`);
    }
    if (!Number.isSafeInteger(item.byteLength) || item.byteLength <= 0) {
      throw new Error(`模型 ${item.characterName || item.characterId} 的大小信息无效。`);
    }
    if (!isVideoAvatarConfig(item.config)) {
      throw new Error(`模型 ${item.characterName || item.characterId} 的配置无效。`);
    }
    if (seenAssetIds.has(item.config.assetId)) {
      throw new Error(`模型备份中资源 ${item.config.assetId} 出现了两次。`);
    }
    seenAssetIds.add(item.config.assetId);
  }

  return manifest as AvatarModelBackupManifest;
};

export const getAvatarModelBackupInventory = async (): Promise<AvatarModelBackupInventory> => {
  const characters = await DB.getAllCharacters();
  const models: AvatarModelBackupInventoryItem[] = [];

  for (const character of characters) {
    const configs = [character.videoAvatar, ...(character.videoAvatarWardrobe || [])]
      .filter((config, index, all): config is VideoAvatarConfig => Boolean(config)
        && all.findIndex(item => item?.assetId === config?.assetId) === index);
    for (const config of configs) {
      // Built-in Sully ships with the application and has no IndexedDB blob to
      // back up. Character framing/quality preferences remain in normal data.
      if (config.format === 'live2d' && config.builtIn) continue;
      const blob = await DB.getBlobAsset(config.assetId);
      models.push({
        characterId: character.id,
        characterName: character.name,
        format: config.format,
        fileName: config.fileName,
        byteLength: blob?.size || config.byteLength || 0,
        available: Boolean(blob),
      });
    }
  }

  return {
    models,
    availableCount: models.filter(model => model.available).length,
    missingCount: models.filter(model => !model.available).length,
    totalBytes: models.reduce((sum, model) => sum + (model.available ? model.byteLength : 0), 0),
  };
};

export const createAvatarModelBackup = async (
  onProgress?: (progress: AvatarModelBackupProgress) => void,
): Promise<Blob> => {
  const characters = await DB.getAllCharacters();
  const candidates = characters.flatMap(character => {
    const configs = [character.videoAvatar, ...(character.videoAvatarWardrobe || [])]
      .filter((config, index, all): config is VideoAvatarConfig => Boolean(config)
        && all.findIndex(item => item?.assetId === config?.assetId) === index);
    return configs
      .filter(config => !(config.format === 'live2d' && config.builtIn))
      .map(config => ({
        character,
        config,
        slot: config.assetId === character.videoAvatar?.assetId ? 'active' as const : 'wardrobe' as const,
      }));
  });
  if (!candidates.length) throw new Error('当前没有需要备份的自定义模型；Sully 内置模型会随应用自动提供。');

  const zip = new JSZip();
  const models: AvatarModelManifestEntry[] = [];

  for (let index = 0; index < candidates.length; index++) {
    const { character, config, slot } = candidates[index];
    onProgress?.({ phase: 'scan', done: index, total: candidates.length, label: `正在读取 ${character.name} 的模型…` });
    const blob = await DB.getBlobAsset(config.assetId);
    if (!blob) continue;
    const path = modelPath(models.length, config.format);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    zip.file(path, bytes, { compression: 'STORE' });
    models.push({
      characterId: character.id,
      characterName: character.name,
      path,
      byteLength: blob.size,
      config: { ...config, byteLength: blob.size },
      slot,
    });
    onProgress?.({ phase: 'scan', done: index + 1, total: candidates.length, label: `已加入 ${character.name}` });
  }

  if (!models.length) throw new Error('角色资料里有模型索引，但本地模型文件已经丢失。');

  const manifest: AvatarModelBackupManifest = {
    format: AVATAR_MODEL_BACKUP_FORMAT,
    version: AVATAR_MODEL_BACKUP_VERSION,
    createdAt: Date.now(),
    models,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  return zip.generateAsync(
    { type: 'blob', streamFiles: true, compression: 'STORE' },
    metadata => onProgress?.({
      phase: 'pack',
      done: Math.round(metadata.percent),
      total: 100,
      label: `正在生成模型备份 ${Math.round(metadata.percent)}%…`,
    }),
  );
};

export const restoreAvatarModelBackup = async (
  file: Blob,
  onProgress?: (progress: AvatarModelBackupProgress) => void,
): Promise<AvatarModelRestoreResult> => {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifest = await readManifest(zip);
  const characters = await DB.getAllCharacters();
  const byId = new Map(characters.map(character => [character.id, character]));
  const byName = new Map<string, CharacterProfile | null>();
  for (const character of characters) {
    const existing = byName.get(character.name);
    byName.set(character.name, existing === undefined ? character : null);
  }

  const result: AvatarModelRestoreResult = {
    total: manifest.models.length,
    restored: 0,
    skipped: 0,
    restoredBytes: 0,
    models: [],
    warnings: [],
  };

  for (let index = 0; index < manifest.models.length; index++) {
    const item = manifest.models[index];
    const target = byId.get(item.characterId) || byName.get(item.characterName) || null;
    if (!target) {
      result.skipped += 1;
      result.warnings.push(`未找到角色“${item.characterName}”，已跳过其模型。`);
      continue;
    }

    onProgress?.({
      phase: 'restore',
      done: index,
      total: manifest.models.length,
      label: `正在恢复 ${item.characterName}（${index + 1}/${manifest.models.length}）…`,
    });
    const bytes = await zip.file(item.path)!.async('uint8array');
    if (bytes.byteLength !== item.byteLength) {
      throw new Error(`模型 ${item.characterName} 大小校验失败，已停止导入。`);
    }
    const blob = new Blob([bytes.slice().buffer], {
      type: item.config.format === 'vrm' ? 'model/gltf-binary' : 'application/zip',
    });

    const config = { ...item.config, byteLength: blob.size } as VideoAvatarConfig;
    await DB.putBlobAsset(config.assetId, blob);
    if (config.format === 'live2d') {
      await Promise.all(live2DRuntimeCacheAssetIds(config.assetId).map(id => DB.deleteBlobAsset(id)));
    }
    const updatedTarget = item.slot === 'wardrobe'
      ? {
          ...target,
          videoAvatarWardrobe: [
            ...(target.videoAvatarWardrobe || []).filter(model => model.assetId !== config.assetId),
            config,
          ],
        }
      : { ...target, videoAvatar: config };
    await DB.saveCharacter(updatedTarget);
    byId.set(target.id, updatedTarget);
    result.restored += 1;
    result.restoredBytes += blob.size;
    result.models.push({ characterId: target.id, characterName: target.name, config });
    onProgress?.({
      phase: 'restore',
      done: index + 1,
      total: manifest.models.length,
      label: `已恢复 ${target.name}`,
    });
  }

  return result;
};
