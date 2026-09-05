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
};

export function getIcon(name: string): string {
  return ICONS[name] ?? "";
}
