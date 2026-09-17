/** Copy dictionaries for the token-usage Settings section. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.usage'

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  nav: '用量',
  title: 'Token 用量与费用',
  intro: '已记录的模型请求用量，按路由拆分。费用由当前生效的价目表在读取时计算，未定价的路由单独列出。',
  refresh: '刷新',
  loading: '正在读取用量…',
  failed: '暂时无法读取用量，请重试。',
  'totals.heading': '总计',
  'totals.sessions': '会话',
  'totals.turns': '轮次',
  'totals.steps': '步骤',
  'totals.unknownSteps': '未上报用量的步骤',
  'tokens.uncachedInput': '未缓存输入',
  'tokens.output': '输出',
  'tokens.cacheRead': '缓存读取',
  'tokens.cacheWrite': '缓存写入',
  'routes.heading': '按路由',
  'routes.empty': '所选范围内没有任何路由上报用量。',
  'routes.route': '路由',
  'routes.sessions': '会话',
  'routes.steps': '步骤',
  'cost.heading': '费用',
  'cost.none': '本次部署未挂载价目表，因此不报告费用。',
  'cost.amount': '{amount} {currency}',
  'cost.version': '价目表版本 {version}',
  'cost.incomplete': '金额不完整：至少一条贡献路由没有价格，因此它是下限，而不是实测值。',
  'unpriced.heading': '未定价路由',
}

/** Every localized key of the usage section. */
export type UsageLocaleKey = keyof typeof zh

/** English dictionary, typed against the Chinese key set. */
export const en = {
  nav: 'Usage',
  title: 'Token usage and cost',
  intro: 'Recorded model-request usage, split by route. Cost is computed at read time from the rate card in effect, and unpriced routes are listed separately.',
  refresh: 'Refresh',
  loading: 'Reading usage…',
  failed: 'Usage is unavailable right now. Try again.',
  'totals.heading': 'Totals',
  'totals.sessions': 'Sessions',
  'totals.turns': 'Turns',
  'totals.steps': 'Steps',
  'totals.unknownSteps': 'Steps without a usage record',
  'tokens.uncachedInput': 'Uncached input',
  'tokens.output': 'Output',
  'tokens.cacheRead': 'Cache read',
  'tokens.cacheWrite': 'Cache write',
  'routes.heading': 'By route',
  'routes.empty': 'No route reported usage in this selection.',
  'routes.route': 'Route',
  'routes.sessions': 'Sessions',
  'routes.steps': 'Steps',
  'cost.heading': 'Cost',
  'cost.none': 'This deployment mounts no rate card, so no cost is reported.',
  'cost.amount': '{amount} {currency}',
  'cost.version': 'Rate card {version}',
  'cost.incomplete': 'Incomplete amount: at least one contributing route has no price, so this total is a floor rather than a measurement.',
  'unpriced.heading': 'Unpriced routes',
} satisfies Record<UsageLocaleKey, string>
