# StartFlow

StartFlow 是一个给“事情一多就启动困难”的人使用的任务规划原型。它不做语义拆解，只把任务总时长拆成可开始的时间块，并在排程时避开睡眠、课程、聚餐等不可用时间。

## 产品特质

- 低输入负担：任务只需要名称、预计时长、DDL、完成方式和可选依赖。
- 真实反馈：任务块提供“完成”“做了一部分”“没能做到”，后续计划会随反馈重排。
- 时间可信：睡眠、固定日程和手动添加的不可用时间都会进入排程约束。
- 依赖清晰：后置任务只会排在依赖任务完成之后。
- 风险显式：容量不足或依赖无法完成时，系统会给出风险提示。

## 工程特质

- 领域逻辑独立：`src/domain/scheduler.js` 不依赖 DOM，可直接测试。
- 状态层独立：`src/data/store.js` 负责默认数据、迁移、localStorage 和状态更新。
- UI 层独立：`src/ui/` 只负责渲染、表单和导航。
- 可测试：`tests/scheduler.test.mjs` 覆盖避开日程、依赖顺序和容量不足。
- 可扩展：以后接 Google Calendar、后端 API 或替换成 React/Vue 时，排程核心可以保留。

## 运行

```bash
npm test
python -m http.server 4173 --directory .
```

然后打开：

```text
http://localhost:4173
```

## Vercel 部署

这个项目是纯静态前端，可以直接发布到 Vercel。

推荐设置：

```text
Framework Preset: Other
Build Command: 留空
Output Directory: 留空
Install Command: npm install
```

`vercel.json` 已经配置了静态资源缓存和 SPA fallback。即使之后加了前端路由，刷新页面也会回到 `index.html`。

## 结构

```text
.
├── index.html
├── styles.css
├── vercel.json
├── src/
│   ├── main.js
│   ├── data/
│   │   └── store.js
│   ├── domain/
│   │   ├── scheduler.js
│   │   └── time.js
│   └── ui/
│       ├── dom.js
│       ├── forms.js
│       ├── navigation.js
│       └── render.js
└── tests/
    └── scheduler.test.mjs
```
