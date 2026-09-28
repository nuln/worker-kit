/**
 * @nuln/worker-kit/ui/icons
 *
 * 标准 Lucide / Feather 风格 24x24 矢量 SVG 图标字典。
 * 规范：viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
 *       stroke-linecap/linejoin="round"；按钮内 18px，侧边导航内 20px。
 */

export const ICON_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

function svg(inner: string): string {
  return `<svg ${ICON_ATTRS}>${inner}</svg>`;
}

/** 语言切换（Globe）。 */
export const GlobeIcon = svg(
  '<circle cx="12" cy="12" r="10"></circle>' +
    '<line x1="2" y1="12" x2="22" y2="12"></line>' +
    '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>',
);

/** 主题-浅色（Sun）。 */
export const SunIcon = svg(
  '<circle cx="12" cy="12" r="5"></circle>' +
    '<line x1="12" y1="1" x2="12" y2="3"></line>' +
    '<line x1="12" y1="21" x2="12" y2="23"></line>' +
    '<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>' +
    '<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>' +
    '<line x1="1" y1="12" x2="3" y2="12"></line>' +
    '<line x1="21" y1="12" x2="23" y2="12"></line>' +
    '<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>' +
    '<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>',
);

/** 主题-深色（Moon）。 */
export const MoonIcon = svg(
  '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>',
);

/** 主题-跟随系统（Monitor）。 */
export const MonitorIcon = svg(
  '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>' +
    '<line x1="8" y1="21" x2="16" y2="21"></line>' +
    '<line x1="12" y1="17" x2="12" y2="21"></line>',
);

/** 退出登录（LogOut）。 */
export const LogOutIcon = svg(
  '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>' +
    '<polyline points="16 17 21 12 16 7"></polyline>' +
    '<line x1="21" y1="12" x2="9" y2="12"></line>',
);

/** 系统设置（Settings）。 */
export const SettingsIcon = svg(
  '<circle cx="12" cy="12" r="3"></circle>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>',
);

/** 用户头像（User）。 */
export const UserIcon = svg(
  '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>' +
    '<circle cx="12" cy="7" r="4"></circle>',
);

/** 通知铃铛（Bell）。 */
export const BellIcon = svg(
  '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>' +
    '<path d="M13.73 21a2 2 0 0 1-3.46 0"></path>',
);

/** 安全/盾牌（Shield）。 */
export const ShieldIcon = svg(
  '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>',
);

/** 数据库/存储（Database）。 */
export const DatabaseIcon = svg(
  '<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>' +
    '<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>' +
    '<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>',
);

/** 插件/滑块（Sliders）。 */
export const SlidersIcon = svg(
  '<line x1="4" y1="21" x2="4" y2="14"></line>' +
    '<line x1="4" y1="10" x2="4" y2="3"></line>' +
    '<line x1="12" y1="21" x2="12" y2="12"></line>' +
    '<line x1="12" y1="8" x2="12" y2="3"></line>' +
    '<line x1="20" y1="21" x2="20" y2="16"></line>' +
    '<line x1="20" y1="12" x2="20" y2="3"></line>' +
    '<line x1="1" y1="14" x2="7" y2="14"></line>' +
    '<line x1="9" y1="8" x2="15" y2="8"></line>' +
    '<line x1="17" y1="16" x2="23" y2="16"></line>',
);

/** 关于/信息（Info）。 */
export const InfoIcon = svg(
  '<circle cx="12" cy="12" r="10"></circle>' +
    '<line x1="12" y1="16" x2="12" y2="12"></line>' +
    '<line x1="12" y1="8" x2="12.01" y2="8"></line>',
);

/** 对勾（Check）。 */
export const CheckIcon = svg('<polyline points="20 6 9 17 4 12"></polyline>');

/** 复制（Copy）。 */
export const CopyIcon = svg(
  '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
);

/** 添加（Plus）。 */
export const PlusIcon = svg(
  '<line x1="12" y1="5" x2="12" y2="19"></line>' +
    '<line x1="5" y1="12" x2="19" y2="12"></line>',
);

/** 搜索（Search）。 */
export const SearchIcon = svg(
  '<circle cx="11" cy="11" r="8"></circle>' +
    '<line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
);

/** 删除（Trash）。 */
export const TrashIcon = svg(
  '<polyline points="3 6 5 6 21 6"></polyline>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>',
);

/** 上传（Upload）。 */
export const UploadIcon = svg(
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>' +
    '<polyline points="17 8 12 3 7 8"></polyline>' +
    '<line x1="12" y1="3" x2="12" y2="15"></line>',
);

/** 下载（Download）。 */
export const DownloadIcon = svg(
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>' +
    '<polyline points="7 10 12 15 17 10"></polyline>' +
    '<line x1="12" y1="15" x2="12" y2="3"></line>',
);

/** 密钥（Key）。 */
export const KeyIcon = svg(
  '<path d="M21 2l-2 2m-1.5 1.5L14 9l-3 3-2 2-3-3-4 4 4 4 3-3 2-2 3-3 3.5-3.5L21 2z"></path>',
);

/** 邮件（Mail）。 */
export const MailIcon = svg(
  '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>' +
    '<polyline points="22,6 12,13 2,6"></polyline>',
);

/** 终端（Terminal）。 */
export const TerminalIcon = svg(
  '<polyline points="4 17 10 11 4 5"></polyline>' +
    '<line x1="12" y1="19" x2="20" y2="19"></line>',
);

/** 活动/监控（Activity）。 */
export const ActivityIcon = svg(
  '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>',
);

/** 外部链接（ExternalLink）。 */
export const ExternalLinkIcon = svg(
  '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>' +
    '<polyline points="15 3 21 3 21 9"></polyline>' +
    '<line x1="10" y1="14" x2="21" y2="3"></line>',
);

/** 刷新/同步（Refresh）。 */
export const RefreshIcon = svg(
  '<polyline points="23 4 23 10 17 10"></polyline>' +
    '<polyline points="1 20 1 14 7 14"></polyline>' +
    '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>',
);

/** 按名取图标，未知名称返回空字符串（调用方自行回退）。 */
export const ICONS: Record<string, string> = {
  globe: GlobeIcon,
  sun: SunIcon,
  moon: MoonIcon,
  monitor: MonitorIcon,
  logout: LogOutIcon,
  settings: SettingsIcon,
  user: UserIcon,
  bell: BellIcon,
  shield: ShieldIcon,
  database: DatabaseIcon,
  sliders: SlidersIcon,
  info: InfoIcon,
  check: CheckIcon,
  copy: CopyIcon,
  plus: PlusIcon,
  search: SearchIcon,
  trash: TrashIcon,
  upload: UploadIcon,
  download: DownloadIcon,
  key: KeyIcon,
  mail: MailIcon,
  terminal: TerminalIcon,
  activity: ActivityIcon,
  externalLink: ExternalLinkIcon,
  refresh: RefreshIcon,
};

export function getIcon(name: string): string {
  return ICONS[name] ?? "";
}
