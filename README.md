<div align="center">
  <div>
    <img
    src="./lol-record-analysis-app/public/assets/logo.png"
    width="128"
    height="128"
    />
  </div>
  基于 LCU API 的英雄联盟排位分析工具
</div>

<p align="center">
    <a href="https://github.com/wnzzer/lol-rank-record-analysis/releases"><img src="https://img.shields.io/github/release/wnzzer/lol-rank-record-analysis.svg?style=flat-square&maxAge=600" alt="Downloads"></a>
    <a href="https://github.com/wnzzer/lol-rank-record-analysis/releases">
    <img src="https://img.shields.io/github/downloads/wnzzer/lol-rank-record-analysis/total?style=flat&label=Downloads"></a>
    <a href="https://github.com/wnzzer/lol-rank-record-analysis/stargazers">
    <img src="https://img.shields.io/github/stars/wnzzer/lol-rank-record-analysis?style=flat&label=Stars">
  </a>
</p>



# 1. Rank Analysis



## 1.1 已支持功能

- **战绩查询**
  - 同大区玩家战绩查询
- **对局分析**
  - 战绩分析



## 1.2 使用方法

在右侧 Release 中寻找最新的构建版本压缩包，解压后即可运行。

运行时无管理员权限

目前仅支持腾讯服

> [!NOTE]
> 一旦检测到游戏客户端，则会自动连接，无需考虑启动顺序。
>
> Rank Analysis 会很好地处理中途启动的情景，并始终维持合适的连接状态。


## 1.3 软件预览
   ![本地路径](./lol-record-analysis-app/public/one.png "相对路径演示") 

   ![本地路径](./lol-record-analysis-app/public/two.png "相对路径演示") 




# 2. 加入到开发

百密一疏，各种问题总是难以避免，作为使用者，您可以：

## 2.1 GitHub Issues

GitHub Issues 是最重要的反馈渠道，请精准描述您的需求、遇到的问题或任何可行的想法。

## 2.2 加入开发

如果您对此项目感兴趣，欢迎加入到开发之中，提交 PR，为其添加更多功能。

# 3. 编译 & 构建 & 运行

本章节指示如何通过源码构建 Rank-Analysis。

## 3.1 Electron 主程序（前端）
切换到 electron主程序  `cd .\lol-record-analysis-app`

安装依赖：`npm i`

dev：`npm run dev`

build（for Windows only）: `npm build:win`

## 3.2 Golang 服务端 (后端)
切换到 Golang主程序  `cd .\lol-record-client-golang\`

编译为二进制版本 `go build`


之后将 `lol-record-analysis.exe`  复制到打包后的 `lol-rank-record-analysis\lol-record-analysis-app\dist\win-unpacked\resources\backend\` 目录下

# 4. 参考

Rank Analysis 的实现参考了许多现有的优秀开源项目，这些项目为软件的部分模块开发提供了清晰的思路指导，特此表示感谢。❤️

| 项目名称                                                                                                  | 描述                                |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| ⭐⭐⭐ [LeagueAkari](https://github.com/Hanxven/LeagueAkari)                                         | 游戏风风格和设计思路参考   |
| ⭐⭐⭐ [League of Legends LCU and Riot Client API Docs](https://github.com/KebsCS/lcu-and-riotclient-api) | LCU API 文档参考                    |
| ⭐⭐ [Seraphine](https://github.com/Zzaphkiel/Seraphine)                                                  | 缝合重灾区，提供了集成思路          
| ⭐ [LCU API](https://www.mingweisamuel.com/lcu-schema/tool/#/)                                            | LCU API 早期参考文档                |



# 5. 免责声明

本软件作为基于 Riot 提供的 League Client Update (LCU) API 开发的辅助工具，由于其设计和实施均未采用侵入性技术手段，理论上不会直接干预或修改游戏数据。然而，需明确指出的是，虽然本软件在原理上并未直接修改游戏内部数据，但在游戏环境的持续更新和演变中 (如未来腾讯可能的反作弊系统或其他保护服务的更新)，无法完全排除由于版本更新导致的兼容性问题或其他意外后果。

特此强调，对于使用本软件可能带来的任何后果，包括但不限于游戏账户的封禁、数据损坏或其他任何形式的游戏体验负面影响，本软件的开发者将不承担任何责任。用户在决定使用本软件时，应充分考虑并自行承担由此产生的所有风险和后果。

本声明旨在全面而详尽地通知用户关于本软件使用的可能风险，以便用户在使用过程中做出充分的风险评估和明智的决策。感谢您的关注，同时敬请遵守相关游戏规则和使用指南，确保一种健康和公平的游戏环境。

[![Star History Chart](https://api.star-history.com/svg?repos=wnzzer/lol-rank-record-analysis&type=Date)](https://star-history.com/#wnzzer/lol-rank-record-analysis&Date)
