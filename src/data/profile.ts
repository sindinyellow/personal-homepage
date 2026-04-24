export const profile = {
  name: '你的姓名',
  role: 'Java / Vue 全栈开发求职者',
  location: '中国',
  summary:
    '这里写一段 2-3 句话的个人介绍：你的专业背景、主要技术方向、正在寻找的岗位，以及你希望别人记住你的一个优势。',
  email: 'your.email@example.com',
  phone: '138-0000-0000',
  github: 'https://github.com/your-name',
  gitee: 'https://gitee.com/your-name',
  resumeUrl: '#',
};

export const skills = [
  'Java',
  'Spring Boot',
  'Vue 3',
  'TypeScript',
  'MySQL',
  'Redis',
  'REST API',
  '前端工程化',
];

export const projects = [
  {
    title: '校园体育赛事管理系统',
    period: '2026',
    role: '全栈开发 / 毕业设计',
    summary:
      '面向校园赛事组织、报名、赛程、成绩录入和积分统计的管理系统，覆盖管理员、学生等角色的核心业务流程。',
    stack: ['Spring Boot', 'Vue 3', 'Element Plus', 'MySQL'],
    highlights: [
      '实现赛事报名、赛程管理、成绩管理和权限控制等核心模块。',
      '优化后台管理页面的信息密度和操作路径，提升重复录入效率。',
      '沉淀接口、页面和论文材料，可作为求职项目重点展示。',
    ],
    links: [
      { label: '代码仓库', href: '#' },
      { label: '在线演示', href: '#' },
    ],
  },
  {
    title: '个人主页与技术博客',
    period: '2026',
    role: '个人项目',
    summary:
      '用于简历展示的静态个人主页，集中呈现个人介绍、项目经历、技术文章和联系方式。',
    stack: ['Astro', 'Markdown', 'CSS'],
    highlights: [
      '使用 Markdown 管理博客文章，降低长期维护成本。',
      '静态部署，访问速度快，适合放入简历和求职资料。',
    ],
    links: [{ label: '当前站点', href: '/' }],
  },
];
