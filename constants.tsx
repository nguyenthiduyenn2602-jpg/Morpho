import React from 'react';
import { AppConfig, AppID } from './types';
import {
  UserCircle,
  IdentificationCard,
  ChatTeardrop,
  UsersThree,
  GearSix,
  Images,
  PaintBrush,
  Palette,
  Heart,
  BookOpenText,
  SealCheck,
  House,
  DeviceMobileCamera,
  Fire,
  Books,
  Question,
  GameController,
  Globe,
  PenNib,
  PiggyBank,
  Compass,
  Camera,
  Sparkle,
  GlobeSimple,
  MusicNotes,
  PhoneCall,
  Crosshair,
  Smiley,
  Brain,
  Notebook,
  Plugs,
  Newspaper,
  Planet,
  Wrench,
  HouseLine,
  CirclesFour,
} from '@phosphor-icons/react';

// SVG 图标库 - Phosphor Icons
export const Icons: Record<string, React.FC<{ className?: string }>> = {
  User: ({ className }) => <IdentificationCard className={className} weight="regular" />,
  Character: ({ className }) => <UserCircle className={className} weight="regular" />,
  Chat: ({ className }) => <ChatTeardrop className={className} weight="regular" />,
  GroupChat: ({ className }) => <UsersThree className={className} weight="regular" />,
  Settings: ({ className }) => <GearSix className={className} weight="regular" />,
  Gallery: ({ className }) => <Images className={className} weight="regular" />,
  ThemeMaker: ({ className }) => <PaintBrush className={className} weight="regular" />,
  FAQ: ({ className }) => <Question className={className} weight="regular" />,
  Worldbook: ({ className }) => <Globe className={className} weight="regular" />,
  Browser: ({ className }) => <GlobeSimple className={className} weight="regular" />,
  Call: ({ className }) => <PhoneCall className={className} weight="regular" />,
  Date: ({ className }) => <Sparkle className={className} weight="regular" />,
  MemoryPalace: ({ className }) => <Brain className={className} weight="regular" />,
  Handbook: ({ className }) => <Notebook className={className} weight="regular" />,
  QQBridge: ({ className }) => <Plugs className={className} weight="regular" />,
  CharCreatorDev: ({ className }) => <Wrench className={className} weight="regular" />,
  Moments: ({ className }) => <CirclesFour className={className} weight="fill" />,
};

export const INSTALLED_APPS: AppConfig[] = [
  { id: AppID.User, name: '个人档案', icon: 'User', color: 'rose' },
  { id: AppID.Character, name: '神经链接', icon: 'Character', color: 'indigo' },
  { id: AppID.MemoryPalace, name: '记忆宫殿', icon: 'MemoryPalace', color: 'violet' },
  { id: AppID.Chat, name: 'Message', icon: 'Chat', color: 'green' },
  { id: AppID.Call, name: '电话', icon: 'Call', color: 'emerald' },
  { id: AppID.Date, name: '见面', icon: 'Date', color: 'pink' },
  { id: AppID.GroupChat, name: '群聊', icon: 'GroupChat', color: 'violet' },
  { id: AppID.Moments, name: '朋友圈', icon: 'Moments', color: 'green' },
  // 家园不再做独立桌面图标，改从「小小窝 · 像素家园」里进入（openApp(AppID.WorldHome) 仍可渲染）
  // { id: AppID.Browser, name: '浏览器', icon: 'Browser', color: 'blue' }, // Hidden
  // { id: AppID.Handbook, name: '手账', icon: 'Handbook', color: 'fuchsia' }, // Hidden temporarily, pending update
  { id: AppID.Worldbook, name: '世界书', icon: 'Worldbook', color: 'indigo' },
  { id: AppID.FAQ, name: '使用帮助', icon: 'FAQ', color: 'indigo' },
  { id: AppID.Gallery, name: '相册', icon: 'Gallery', color: 'orange' },
  { id: AppID.ThemeMaker, name: '气泡工坊', icon: 'ThemeMaker', color: 'purple' },
  { id: AppID.Settings, name: '设置', icon: 'Settings', color: 'slate' },
  { id: AppID.CharCreatorDev, name: '捏脸·开发', icon: 'CharCreatorDev', color: 'amber' }, // 仅开发模式显示（Launcher 过滤）
  // { id: AppID.QQBridge, name: 'QQ 桥', icon: 'QQBridge', color: 'sky' }, // Hidden temporarily
];

export const DOCK_APPS = [AppID.Chat, AppID.GroupChat, AppID.Settings];
