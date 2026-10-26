# 工程与接口契约

只在需要读写工程、接入功能或排查预览／导出差异时读取本参考。

## 文件职责与单位

| 文件／字段 | 含义 |
| --- | --- |
| `project.json` | 工程身份、包名称／作者／版本、`engine`、功能配置、默认参数、署名和历史来源 |
| `assembly-v4.json.parts` | 基础部件的 `id,x,y,w,h,rot,z,hidden,pinned`；`removed` 为移除清单 |
| `assembly-v4.json.expressionLayouts[state].parts` | 每个表情独立的部件几何、层级与显隐，不是共享基础布局 |
| `authoredLashTransitions[state].start[near/far]` | 特定表情的睫毛起点；终点来自该表情布局与既有形变 |
| `blinkCalibration[near/far][start/end]` | 日常眨眼端点：`box:[x,y,w,h]`、`rotation`、`z` |
| `rig.json` | `nodes[id]:{pivot:[x,y],parent}` 与 `assign[partId]:nodeId`；父子不得成环 |
| `project.model.expressionFace` | `normalEyes`、`assets`、`spriteRoles`、`bindings`、`calibrationFacialIds` 等映射 |
| `project.model.browMotion` | 眉毛 ID、每个表情近／远侧的 `[lift,innerRise,curve,inward]`、`dynamicExpressions` 等 |
| `project.model.physics` | `parts[id]:{group,rootY,tipY,gain}`；`groups[group]:[频率,阻尼,横向上限,纵向上限]` |
| `project.model.seatedLegs` | 替换 PNG、`replaceIds`、`fadeRange`、`bodyDrop`、`calibratedLayers` 等 |
| `project.model.motionGeometry` | 身体／头部形变区和点击、视线、特效锚点；不应写死为某角色坐标 |
| `project.model.motionOptions.dizzyHeadOnly` | 是否在眩晕时固定身体，仅让头部及子节点运动 |
| `source-pack/` | 历史原包；用于原包模式和来源核对，不是编辑副本输出目录 |
| `builds/preview/`、`exports/` | 指纹预览缓存和用户导出结果 |

基础几何、pivot、眼睑端点用原图／主画布像素；旋转用度；`z` 只表示绘制顺序。`logo_scale` 将像素转换为宿主角色单位。`seatedLegs.bodyDrop` 与 `groundOffset` 是角色单位，界面中的“身体下移”会进行转换；`source:[x,y,w,h]` 裁切区域始终使用 PNG 自身像素。

`blinkCalibration` 还包含 `schema` 和 `interpolation`，这两个键不是眼侧。只遍历 `near`、`far`。`effective_model` 会合并配置与已保存端点，缺失端点初始化为当前原睫毛位置；不要自行生成新的缩小幅度覆盖用户数据。

## 面部映射示例

以下 ID 只是演示，可以替换为实际部件名：

```json
{
  "normalEyes": {
    "near": {"ball": "near-white", "iris": "near-iris", "lid": "near-lash"},
    "far": {"ball": "far-white", "iris": "far-iris", "lid": "far-lash"}
  },
  "spriteRoles": {
    "heart-near": {"kind": "eye", "state": "love", "side": "near"},
    "round-mouth": {"kind": "mouth", "state": "surprised"}
  },
  "bindings": {
    "surprised": {"near": null, "far": null, "mouth": "round-mouth"}
  }
}
```

`bindings` 缺少某槽位表示自动选择，`null` 表示保留原部件，字符串表示采用该素材 ID。近／远侧随角色原始视角定义，整体朝向镜像不交换保存映射。

## 本地接口

除工程列表和健康检查外，以下工程 API 都带 `?project=<ID>`；JSON POST 使用 `Content-Type: application/json`。

- `GET /api/health`：工具身份、版本与实际根目录。
- `GET /api/projects`：工程 ID、显示名和基本信息。
- `GET /api/project`、`GET /api/rig`、`GET /api/effective-model`：读取工程和合成模型。
- `GET /p/<ID>/assembly-v4.json`：读取已保存装配／校准，而非未保存页面状态。
- `POST /api/save`：保存基础装配；后端合并原有校准字段，调用者也应保留不在本次修改范围内的数据。
- `POST /api/save-rig`：保存节点与绑定图。
- `POST /api/features`：更新指定功能字段和 `engine`；不通过它覆盖另一个页面刚保存的表情布局。
- `POST /api/calibration`：按作用范围保存，见下面示例。
- `POST /api/rename-part`：`{"old":"原ID","new":"新ID"}`，同步重命名引用。
- `POST /api/preview`、`POST /api/export-pack`：统一构建预览或编辑副本形象包。
- `POST /api/native-preview`、`POST /api/native-export`：历史原包模式。
- `POST /api/export-project`：生成包含校准、PNG 和原包的工程备份。

保存单侧单端点：

```json
{
  "scope": "blink",
  "side": "near",
  "phase": "end",
  "pose": {"box": [500,550,130,95], "rotation": 0, "z": 26}
}
```

保存指定表情：`{"scope":"expression","state":"angry","layout":{"parts":[...]},"transition":原过渡配置或null}`。`transition:null` 表示明确移除该表情的独立过渡；不想更改过渡时不要误传 `null`。

## 构建与验证

在工具根目录运行：

```text
python -S studio_core.py check <ID>
python -S studio_core.py build <ID>
python -S -m unittest discover -s tests -v
```

也可以在已定位的工具环境中调用 `studio_core.project_path(ID)`、`effective_model(path)`、`preview(path)`、`export(path)`。构建指纹覆盖工程内容与运行模块；不要手工改缓存文件来代替源工程修改。

高级运行时由 `runtime/generic.js`、`layered.js`、`face.js`、`calibrated-face.js` 统一拼装为独立入口。一个版本应从同一构建快照预览和打包，不能把旧角色专用代码与新配置随意拼接。

`/web/qa/index.html` 为老酸奶示例的表情／动作回归页：核对 19 表情、四项过渡、眨眼闭合与重开、9 项动作及独立入口。其他角色需要针对其配置验证，不能把示例通过当成任意角色都已通过。

仅改名称与署名时，核对运行代码、几何、绑定和 PNG 哈希未变，并验证导出元数据与页面；不必重跑与此次改动无关的整套动作实验。修改渲染或动作时，按影响范围增加实际浏览器采样；测试或构建执行成功不能替代查看其结果。

## 署名与历史来源

工具作者：`Xiao-HuTao`，`https://github.com/Xiao-HuTao`。老酸奶的制作作者同此账号；角色原型／素材、Coopanion 与 AI 辅助记录分别保留。whale 作者保留其原包清单所记载的 Pal-AI-Lab。

制作中的显示名可以变更，但历史 `source-pack` 清单和 `source.upstream_manifest` 应保留原始名称作为来源证据。修改历史原件必须是用户明确要求的动作，不能因为新显示名不同而自动覆盖。工具源码仓库为 `https://github.com/Xiao-HuTao/character-studio`；作者主页与仓库地址分别保留。
