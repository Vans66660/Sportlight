# 内部协作网站云函数

部署到与小程序相同的 CloudBase 环境后，网站通过 HTTP 入口调用本函数。

## 使用的独立集合

- `internalMembers`
- `internalSessions`
- `internalProjects`
- `internalFolders`
- `internalArchives`
- `internalMessages`
- `internalSchedules`

这些集合不读取或修改小程序的 `users`、赛事、订单、球馆等集合。

## 必须配置

在 CloudBase 云函数环境变量中添加：

`INTERNAL_WORKBENCH_ADMIN_USERNAME`

值为首位管理员自行注册时使用的账号，例如 `chenjr`。该账号首次注册后自动获得 `admin` 角色，可以给其他成员分配部门。

## 部署后

1. 在微信开发者工具中右键 `cloudfunctions/internalWorkbench`，选择“上传并部署：云端安装依赖”。
2. 在 CloudBase 控制台为该函数创建 HTTP 访问路径，例如 `/internalWorkbench`。
3. 创建上述 7 个集合，权限均设为“仅创建者可读写”或“所有用户不可读写”；网站只经由本云函数访问。
4. 网站 API 地址填写为：
   `https://cloud1-d1gc37qacf1fd1eee-1432153437.ap-shanghai.app.tcloudbase.com/internalWorkbench`

## 文件

`uploadFile` 目前支持通过网站上传不超过 5MB 的附件。大视频应当先放至腾讯视频、腾讯文档或其他受控存储，再把链接作为材料提交。
