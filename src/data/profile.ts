/**
 * 个人信息配置
 * 修改此文件即可更新全站所有引用个人信息的位置
 */
export const profile = {
  name: '黄鑫权',
  role: 'Java / Vue 全栈开发工程师',
  location: '广东',
  summary:
    '计算机科学专业，专注 Java 后端与 Vue 前端开发。熟悉 Spring Boot、Vue 3、MySQL、Redis 等技术栈，具备独立完成业务系统全链路开发的能力。目前正在寻找 Java 全栈开发相关岗位。',
  email: 'huangxinquan@example.com',
  phone: '138-xxxx-xxxx',
  github: 'https://github.com/sindinyellow',
  gitee: 'https://gitee.com/sindinyellow',
  resumeUrl: '#',
};

export const skills = [
  'Java',
  'Spring Boot',
  'Spring Security',
  'Vue 3',
  'TypeScript',
  'MySQL',
  'Redis',
  'REST API',
  'Element Plus',
  'MyBatis',
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
