import { DB } from './db';
import type { CharacterProfile } from '../types';

export type VideoAvatarConfig = NonNullable<CharacterProfile['videoAvatar']>;

export type AvatarFileInspection =
  | { kind: 'vrm'; fileName: string; byteLength: number }
  | { kind: 'vroid-project'; fileName: string; byteLength: number }
  | { kind: 'unsupported'; fileName: string; byteLength: number; reason: string };

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
};

/**
 * Cheap validation before GLTFLoader touches the file. VRM is a binary glTF
 * container and therefore begins with the ASCII magic `glTF`.
 */
export async function inspectAvatarFile(file: Blob & { name?: string }): Promise<AvatarFileInspection> {
  const fileName = file.name || 'avatar';
  const ext = extensionOf(fileName);

  if (ext === '.vroid') {
    return { kind: 'vroid-project', fileName, byteLength: file.size };
  }

  if (ext !== '.vrm') {
    return {
      kind: 'unsupported',
      fileName,
      byteLength: file.size,
      reason: '目前仅支持 .vrm；VRoid 工程请先从 VRoid Studio 导出。',
    };
  }

  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isGlb = magic.length === 4
    && magic[0] === 0x67
    && magic[1] === 0x6c
    && magic[2] === 0x54
    && magic[3] === 0x46;

  if (!isGlb) {
    return {
      kind: 'unsupported',
      fileName,
      byteLength: file.size,
      reason: '文件扩展名是 .vrm，但内容不是有效的二进制 glTF。',
    };
  }

  return { kind: 'vrm', fileName, byteLength: file.size };
}

const makeAssetId = (): string => {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `video-avatar-${id}`;
};

/** Existing compressed Live2D packages get a derived persistent STORE cache. */
export type Live2DTextureQuality = 'balanced' | 'hd';

export const live2DRuntimeCacheAssetId = (
  assetId: string,
  quality?: Live2DTextureQuality,
): string => `${assetId}:live2d-runtime-store-v1${quality ? `:${quality}` : ''}`;

export const live2DRuntimeCacheAssetIds = (assetId: string): string[] => [
  live2DRuntimeCacheAssetId(assetId),
  live2DRuntimeCacheAssetId(assetId, 'balanced'),
  live2DRuntimeCacheAssetId(assetId, 'hd'),
];

export async function saveAvatarModel(file: File): Promise<VideoAvatarConfig> {
  const inspection = await inspectAvatarFile(file);
  if (inspection.kind !== 'vrm') {
    throw new Error(inspection.kind === 'unsupported'
      ? inspection.reason
      : '这是 VRoid Studio 工程文件，请先导出为 VRM 1.0。');
  }

  const assetId = makeAssetId();
  await DB.putBlobAsset(assetId, file);
  return {
    version: 1,
    format: 'vrm',
    assetId,
    fileName: inspection.fileName,
    byteLength: inspection.byteLength,
    importedAt: Date.now(),
  };
}

export const getAvatarModelBlob = async (config?: VideoAvatarConfig | null): Promise<Blob | null> => {
  if (!config?.assetId) return null;
  return DB.getBlobAsset(config.assetId);
};

export const deleteAvatarModel = async (config?: VideoAvatarConfig | null): Promise<void> => {
  if (!config?.assetId) return;
  if (config.format === 'live2d' && config.builtIn) return;
  await DB.deleteBlobAsset(config.assetId);
  if (config.format === 'live2d') {
    await Promise.all(live2DRuntimeCacheAssetIds(config.assetId).map(id => DB.deleteBlobAsset(id)));
  }
};
