# StartFlow

StartFlow 是一个给“事情一多就启动困难”的人使用的任务规划产品原型。它不做语义拆分，只把任务总时长切成可开始的时间块，并在排程时避开睡眠、课程、聚餐等不可用时间。

## 当前能力

- 登录 / 注册：支持 Supabase Auth；没有配置 Supabase 时会进入本地演示模式。
- 用户数据隔离：每个用户有独立任务、日程、设置和执行历史。
- 云端持久化：配置 Supabase 后，数据保存到规范化表，并由 RLS 限制为本人可读写。
- 任务排程：支持 DDL、最短/最长单次、依赖任务、一次做完/不要一次做完。
- 执行反馈：任务块支持“完成”“做了一部分”“没能做到”，计划会按真实反馈重排。
- 风险提示：容量不足或依赖无法完成时，会显示明确风险。

## 本地运行

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址，通常是：

```text
http://localhost:5173
```

运行测试：

```bash
npm test
```

生产构建：

```bash
npm run build
npm run preview
```

## Supabase 数据库配置

1. 创建 Supabase project。
2. 在 Supabase SQL editor 运行：

```text
supabase/schema.sql
```

3. 在 Supabase Auth 中启用 Email provider。
4. 如果不想要求邮件确认，可以在开发阶段关闭 Confirm email；生产环境建议保留确认。

数据库表：

- `public.user_settings`: 睡眠时间、默认时间块、缓冲和 DDL 提前量。
- `public.tasks`: 用户任务、DDL、依赖、进度、失败次数和启动提示。
- `public.events`: 课程、聚餐、会议等不可用时间。
- `public.task_history`: 完成、部分完成、没能做到等执行记录。

RLS 已开启，所有表都只允许登录用户读写自己的 `user_id`。

## Vercel 部署

Vercel 推荐设置：

```text
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

Environment Variables：

```text
VITE_SUPABASE_URL=<your Supabase project URL>
VITE_SUPABASE_ANON_KEY=<your Supabase anon public key>
```

本地开发可以复制 `.env.example` 为 `.env.local` 后填入同样的值。如果不配置这两个变量，应用会进入本地演示模式，数据只保存在浏览器 localStorage，不会上云。

## 工程结构

```text
.
├── .env.example
├── index.html
├── styles.css
├── vercel.json
├── supabase/
│   └── schema.sql
├── src/
│   ├── main.js
│   ├── data/
│   │   └── store.js
│   ├── domain/
│   │   ├── scheduler.js
│   │   ├── taskValidation.js
│   │   └── time.js
│   ├── services/
│   │   └── auth.js
│   └── ui/
│       ├── dom.js
│       ├── forms.js
│       ├── navigation.js
│       └── render.js
└── tests/
    ├── scheduler.test.mjs
    └── store.test.mjs
```
