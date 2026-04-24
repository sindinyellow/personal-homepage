# 个人主页

这是一个用于简历链接的中文静态博客型个人主页，基于 Astro 构建。

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 替换内容

- 个人信息：`src/data/profile.ts`
- 首页/项目页样式与结构：`src/pages/index.astro`、`src/pages/projects.astro`
- 博客文章：`src/content/blog/*.md`
- 站点地址：`astro.config.mjs` 中的 `site`

## 部署建议

第一版可部署到 GitHub Pages、Netlify 或 Vercel，生成后的静态文件在 `dist/` 目录。
