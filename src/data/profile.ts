/**
 * 个人信息配置
 * 修改此文件即可更新全站所有引用个人信息的位置
 */
export const profile = {
  name: '黄鑫权',
  role: 'Java / Vue 全栈开发工程师',
  location: '广东',
  availability: '正在寻找 Java 全栈开发相关岗位',
  summary:
    '计算机科学专业，专注 Java 后端与 Vue 前端开发。熟悉 Spring Boot、Vue 3、MySQL、Redis 等技术栈，具备独立完成业务系统全链路开发的能力。目前正在寻找 Java 全栈开发相关岗位。',
  github: 'https://github.com/sindinyellow',
  gitee: 'https://gitee.com/sindinyellow',
  resumeUrl: '#',
  focusAreas: [
    {
      title: '后端业务开发',
      description: '使用 Spring Boot、MyBatis、MySQL、Redis 完成业务建模、接口设计和数据处理。',
    },
    {
      title: '前端工程实现',
      description: '使用 Vue 3、TypeScript、Element Plus 构建管理端页面和清晰的交互流程。',
    },
    {
      title: '全链路交付',
      description: '能从需求拆解、数据库设计、接口联调到前端页面落地，独立推进完整功能。',
    },
  ],
  careerHighlights: [
    '实习期间独立负责 HIS 系统中医生排班、预约挂号、预约签到三个核心模块开发。',
    '围绕校园赛事管理场景完成管理员与学生双角色业务系统设计。',
    '熟悉 CAS 并发控制、RBAC 权限、DDD 分层架构等常见后台系统能力。',
    '持续用博客记录项目复盘、学习笔记和问题排查过程。',
  ],
};

export const skills = [
  'Java',
  'Spring Boot',
  'Spring Security',
  'Vue 3',
  'TypeScript',
  'MySQL',
  'PostgreSQL',
  'Redis',
  'REST API',
  'Element Plus',
  'MyBatis',
  'MyBatis-Plus',
  'Git',
  '前端工程化',
];

export const projects = [
  {
    title: '校园体育赛事管理系统',
    period: '2026',
    role: '全栈开发 / 毕业设计',
    summary:
      '面向校园赛事组织场景的全流程管理系统，覆盖赛事发布、学生报名、自动排程、成绩录入、积分统计等核心业务，支持管理员与学生双角色使用。',
    stack: ['Spring Boot', 'Vue 3', 'Element Plus', 'MySQL', 'Redis'],
    highlights: [
      '基于 Spring Security 实现 RBAC 权限控制，支持管理员和学生角色的差异化操作。',
      '设计自动排程算法，根据报名数据自动生成赛程，支持手动调整和冲突检测。',
      '使用 Redis 处理高并发报名场景下的库存扣减与幂等控制。',
      '集成 AI 助手模块，提供赛事数据智能问答和操作建议。',
    ],
    links: [
      { label: '代码仓库', href: 'https://github.com/sindinyellow' },
    ],
  },
  {
    title: 'HIS 医院信息系统（实习）',
    period: '2026.03 - 2026.04',
    role: '后端开发 / 实习',
    summary:
      '面向医院门诊场景的信息管理系统，实习期间独立负责医生排班、预约挂号、预约签到三个核心模块的前后端开发，涉及 CAS 并发控制、DDD 分层架构和复杂 SQL 设计。',
    stack: ['Spring Boot', 'MyBatis-Plus', 'PostgreSQL', 'Vue 3', 'Element Plus'],
    highlights: [
      '设计号源三层模型（排班模板 → 号源池 → 号源槽位），实现 CAS 原子抢占保证并发安全。',
      '预约流程采用四道防线：取消次数限制、直查物理底座、CAS 原子抢占、数据强覆盖。',
      '使用 PostgreSQL DISTINCT ON、状态归一化 CASE WHEN、五表联查等复杂 SQL 解决业务需求。',
      '前端通过"一次性令牌"模式解决异步签到流程中的防串单问题。',
    ],
    links: [
      { label: '技术博客', href: '/blog/his-internship/' },
    ],
  },
  {
    title: '个人主页与技术博客',
    period: '2026',
    role: '个人项目',
    summary:
      '基于 Astro 构建的静态个人主页，集中呈现个人介绍、项目经历、技术文章和联系方式。',
    stack: ['Astro', 'TypeScript', 'Markdown', 'CSS'],
    highlights: [
      '使用 Content Collections 管理博客文章，Markdown 写作零门槛。',
      '支持暗色模式切换，响应式适配移动端。',
      '静态生成，性能优异，适合放入简历链接。',
    ],
    links: [{ label: '当前站点', href: '/' }],
  },
];
