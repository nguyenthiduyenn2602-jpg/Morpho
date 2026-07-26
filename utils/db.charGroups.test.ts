import { describe, it, expect } from 'vitest';
import { DB } from './db';
import type { CharacterProfile, CharacterGroup } from '../types';

// 角色分组的导出/导入 round-trip：
// 分组定义存独立 store（character_groups），角色只带 groupId 指针——
// 两边必须同进退，漏掉任何一边都会让导入端全员回落「未分组」。
describe('角色分组 (character_groups + groupId) 导出/导入 round-trip', () => {
  it('exportFullData → JSON → importFullData 后分组定义与角色 groupId 都在', async () => {
    const group: CharacterGroup = { id: 'cgroup-rt-1', name: '测试分组', createdAt: 1718900000000 };
    const char = {
      id: 'cgroup-rt-char',
      name: '小组员',
      avatar: '',
      description: '',
      systemPrompt: '',
      memories: [],
      groupId: 'cgroup-rt-1',
    } as unknown as CharacterProfile;

    await DB.saveCharacterGroup(group);
    await DB.saveCharacter(char);

    // 1) 导出 + 模拟写文件/读文件
    const exported = await DB.exportFullData();
    const onDisk = JSON.parse(JSON.stringify(exported));

    // 导出物里必须同时带着分组定义和角色的 groupId
    expect((onDisk.characterGroups as CharacterGroup[]).find(g => g.id === 'cgroup-rt-1')?.name).toBe('测试分组');
    expect((onDisk.characters as CharacterProfile[]).find(c => c.id === 'cgroup-rt-char')?.groupId).toBe('cgroup-rt-1');

    // 2) 清掉本地再导入（模拟换设备：分组被删、角色 groupId 被清）
    await DB.deleteCharacterGroup('cgroup-rt-1');
    await DB.saveCharacter({ ...char, groupId: undefined } as any);
    await DB.importFullData(onDisk as any, {});

    // 3) 导入后分组定义与指针都应恢复
    const groups = await DB.getCharacterGroups();
    expect(groups.find(g => g.id === 'cgroup-rt-1')?.name).toBe('测试分组');
    const restored = (await DB.getAllCharacters()).find(c => c.id === 'cgroup-rt-char');
    expect(restored?.groupId).toBe('cgroup-rt-1');
  });
});
