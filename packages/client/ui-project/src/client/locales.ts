/** Copy dictionaries for the project-board global panel. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'projects'

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  nav: '项目',
  title: '项目看板',
  intro: '这里列出本机存储的持久项目看板。选一份项目可读取它的状态泳道；看板由模型通过 `project` 工具维护。',
  refresh: '刷新',
  loading: '正在读取项目…',
  failed: '暂时无法读取项目，请重试。',
  'projects.heading': '项目',
  'projects.empty': '当前没有存储任何项目。',
  'projects.truncated': '列表已被部署上界截断，只显示了一部分项目。',
  'projects.tasks': '任务 {count}',
  'projects.ready': '可开工 {count}',
  'projects.stranded': '受阻 {count}',
  'board.heading': '看板',
  'board.hint': '选择一个项目以读取它的看板。',
  'board.loading': '正在读取看板…',
  'board.failed': '暂时无法读取该看板，请重试。',
  'board.empty': '该项目还没有任务。',
  'board.ready': '可开工：{titles}',
  'board.stranded': '受阻：{titles}',
  'board.blockedBy': '依赖 {count}',
  'board.sessions': '会话 {count}',
  'status.todo': '待办',
  'status.doing': '进行中',
  'status.blocked': '阻塞',
  'status.done': '已完成',
  'status.cancelled': '已取消',
  'projectStatus.active': '进行中',
  'projectStatus.closed': '已关闭',
}

/** Every localized key of the project section. */
export type ProjectLocaleKey = keyof typeof zh

/** English dictionary, typed against the Chinese key set. */
export const en = {
  nav: 'Projects',
  title: 'Project boards',
  intro: 'Durable project boards stored on this host. Open one to read its status lanes; the board is maintained by the model through the `project` tool.',
  refresh: 'Refresh',
  loading: 'Reading projects…',
  failed: 'Projects are unavailable right now. Try again.',
  'projects.heading': 'Projects',
  'projects.empty': 'No project is stored yet.',
  'projects.truncated': 'The deployment bound cut this listing to a part of the stored projects.',
  'projects.tasks': '{count} tasks',
  'projects.ready': '{count} ready',
  'projects.stranded': '{count} stranded',
  'board.heading': 'Board',
  'board.hint': 'Select a project to read its board.',
  'board.loading': 'Reading the board…',
  'board.failed': 'This board is unavailable right now. Try again.',
  'board.empty': 'This project holds no tasks yet.',
  'board.ready': 'Ready to start: {titles}',
  'board.stranded': 'Stranded: {titles}',
  'board.blockedBy': '{count} dependencies',
  'board.sessions': '{count} sessions',
  'status.todo': 'To do',
  'status.doing': 'In progress',
  'status.blocked': 'Blocked',
  'status.done': 'Done',
  'status.cancelled': 'Cancelled',
  'projectStatus.active': 'Active',
  'projectStatus.closed': 'Closed',
} satisfies Record<ProjectLocaleKey, string>
