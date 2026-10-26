# 独立运行依赖

- 系统 Python 3.10+：仅使用标准库，启动器不安装其他组件。
- 现代浏览器：HTML、SVG、Canvas 2D、WebGL、ES Modules、structuredClone。
- vendor/kit：Coopanion 官方身体与网格驱动，来源见 vendor/SOURCE.json，许可见 vendor/kit/LICENSE。
- runtime：基础部件动作、高级动作、表情和轮廓眨眼；预览和导出使用相同模块拼装。
- projects：两份完整可编辑示例和各自 source-pack 原包副本。

日常运行及 Python 测试不需要 Node、npm、Pillow、Playwright、联网或原 xitelali 工作目录。没有捆绑 Python。整个目录可以复制到其他位置使用。

用户运行后生成的 builds、exports 和 project-trash 均位于本目录；projects 中旧来源记录仅作为说明，不参与资源解析。
