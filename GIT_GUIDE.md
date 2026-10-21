# Sportlight Git 使用指南

## 前置条件

项目已与 Gitee 远程仓库绑定：

- **远程仓库**：https://gitee.com/Sportlight/sportlight.git
- **本地路径**：`C:\Users\Administrator\WorkBuddy\2026-07-05-18-10-43\sportlight`

所有命令均在该目录下执行。

---

## 一、修改代码并上传到 Gitee

### 三步法（最常用）

```bash
# 1. 查看改了哪些文件
cd C:\Users\Administrator\WorkBuddy\2026-07-05-18-10-43\sportlight
git status

# 2. 暂存修改
git add .

# 3. 提交并推送
git commit -m "描述你的改动"
git push origin master
```

### 示例

```bash
git add .
git commit -m "feat: 修改首页运动打卡按钮样式"
git push origin master
```

### 提交信息规范（推荐）

| 前缀 | 用途 | 示例 |
|------|------|------|
| `feat:` | 新功能 | `feat: 添加运动数据图表` |
| `fix:` | 修复 bug | `fix: 修复打卡记录时间显示错误` |
| `style:` | 样式调整 | `style: 统一按钮圆角为 16rpx` |
| `refactor:` | 代码重构 | `refactor: 简化 getUserInfo 逻辑` |
| `chore:` | 杂项/配置 | `chore: 更新 cloudbase env 配置` |

---

## 二、同步协作者的新版本

### 拉取最新代码

```bash
# 每次开始修改前，先拉取最新版本
git pull origin master
```

### 重要原则

> ⚠️ **每次开始写代码前，先 `git pull`，避免冲突。**

工作流程：

```
写代码前 pull → 本地修改代码 → add → commit → push
```

---

## 三、常见场景处理

### 场景 1：本地有修改未提交，但远程有更新

```bash
# 先暂存本地修改
git stash

# 拉取远程更新
git pull origin master

# 恢复本地修改
git stash pop

# 然后正常 add → commit → push
```

### 场景 2：推送时提示冲突

```bash
# 报错类似：! [rejected] master -> master (fetch first)

# 拉取并合并
git pull origin master

# 如果有冲突文件，手动解决后：
git add .
git commit -m "merge: 合并远程更新"
git push origin master
```

### 场景 3：想撤销本地修改

```bash
# 撤销某个文件的修改
git checkout -- 文件路径

# 撤销所有本地修改
git checkout -- .
```

### 场景 4：查看提交历史

```bash
# 查看最近提交
git log --oneline -10

# 查看某个文件的修改历史
git log --oneline -- miniprogram/pages/index/index.js
```

---

## 四、微信开发者工具中使用 Git

微信开发者工具内置了 Git 支持：

1. 打开微信开发者工具，加载 Sportlight 项目
2. 点击菜单栏 **「版本管理」**（或快捷键 `Ctrl + Shift + G`）
3. 在版本管理面板可以直接：
   - 查看文件修改状态
   - 暂存、提交代码
   - 推送到远程 / 拉取远程更新
4. **推荐**：推送和拉取用命令行更稳定，日常提交可以用图形界面

---

## 五、协作注意事项

1. **不要修改 `project.private.config.json`** —— 这个文件存放个人开发者工具的私有配置，已在 `.gitignore` 中忽略
2. **云函数修改后需重新部署** —— 修改 `cloudfunctions/` 下的代码后，需要在微信开发者工具中手动上传并部署云函数
3. **注意 `project.config.json`** —— 包含 AppID 和云环境信息，如更换环境需同步修改
4. **大文件慎重** —— 避免提交大尺寸图片或视频资源，如需添加建议使用云存储链接

---

## 快速参考卡片

| 操作 | 命令 |
|------|------|
| 拉取最新代码 | `git pull origin master` |
| 查看改动 | `git status` |
| 暂存所有改动 | `git add .` |
| 提交 | `git commit -m "说明"` |
| 推送 | `git push origin master` |
| 暂存本地+拉取 | `git stash && git pull && git stash pop` |
